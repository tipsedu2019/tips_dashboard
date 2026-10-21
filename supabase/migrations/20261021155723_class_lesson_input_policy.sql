begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Manual dated lesson input is not an occupancy assertion. The capability is
-- private, bound to one exact SQL statement, and never supplied by a client GUC.
create table dashboard_private.class_lesson_input_scopes (
 transaction_id bigint primary key,
 actor_id uuid not null,
 api_role text not null,
 class_id uuid not null,
 request_key uuid not null,
 operation text not null,
 relation_id regclass not null,
 write_operation text not null check(write_operation in('INSERT','UPDATE')),
 expected_rows jsonb not null check(jsonb_typeof(expected_rows)='object'),
 consumed_ids text[] not null default '{}',
 statement_started boolean not null default false,
 statement_finished boolean not null default false
);
alter table dashboard_private.class_lesson_input_scopes owner to postgres;
alter table dashboard_private.class_lesson_input_scopes enable row level security;
revoke all on dashboard_private.class_lesson_input_scopes from public,anon,authenticated,service_role;

create function dashboard_private.begin_class_lesson_input_scope_v1(
 p_class_id uuid,p_request_key uuid,p_operation text,p_relation regclass,p_write_operation text,p_expected_rows jsonb)
returns void language plpgsql security definer set search_path='' as $f$
declare actor uuid; oldref jsonb; currentref jsonb;
begin
 actor:=dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 if pg_trigger_depth()<>0 or p_class_id is null or p_request_key is null or p_operation is null or p_relation is null or p_write_operation is null
 or p_operation not in('update_class_operational_v1','generate_class_lesson_sessions_v1','save_class_lesson_session_v1')
 or p_relation not in('public.classes'::regclass,'public.class_lesson_sessions'::regclass)
 or p_write_operation not in('INSERT','UPDATE')
 or (p_relation='public.classes'::regclass and p_write_operation<>'UPDATE')
 or jsonb_typeof(p_expected_rows) is distinct from 'object' then
  raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
 end if;
 -- Finish the preceding strict segment before opening this input scope.
 -- Its immutable baseline must never include the newly accepted input. Queued
 -- constraint events see no baseline, or a subsequent strict segment's own one.
 if exists(select 1 from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()) then
  raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
 end if;
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is not null then
  currentref:=dashboard_private.validate_timetable_operating_reference_v1();
  if oldref->>'shadowFingerprint' is distinct from currentref->>'shadowFingerprint' then
   update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';
  end if;
  delete from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 end if;
 insert into dashboard_private.class_lesson_input_scopes(transaction_id,actor_id,api_role,class_id,request_key,operation,relation_id,write_operation,expected_rows)
 values(txid_current(),actor,coalesce(current_setting('role',true),'none'),p_class_id,p_request_key,p_operation,p_relation,p_write_operation,p_expected_rows);
end $f$;

create function dashboard_private.end_class_lesson_input_scope_v1()
returns void language plpgsql security definer set search_path='' as $f$
declare scope dashboard_private.class_lesson_input_scopes;
begin
 delete from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current() returning * into scope;
 if not found or pg_trigger_depth()<>0 or scope.actor_id is distinct from auth.uid()
 or scope.api_role is distinct from coalesce(current_setting('role',true),'none')
 or not scope.statement_started or not scope.statement_finished
 or cardinality(scope.consumed_ids)<>(select count(*) from jsonb_object_keys(scope.expected_rows)) then
  raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
 end if;
end $f$;

create or replace function dashboard_private.timetable_operating_before_statement_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
declare scope dashboard_private.class_lesson_input_scopes;
begin
 select * into scope from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current();
 if found then
  if pg_trigger_depth()<>1 or scope.actor_id is distinct from auth.uid()
  or scope.api_role is distinct from coalesce(current_setting('role',true),'none')
  or scope.relation_id<>tg_relid or scope.write_operation<>tg_op
  or scope.statement_started or scope.statement_finished then
   raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
  end if;
  update dashboard_private.class_lesson_input_scopes set statement_started=true where transaction_id=txid_current();
  return null;
 end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();
 if not exists(select 1 from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()) then
  insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
  values(txid_current(),dashboard_private.read_timetable_operating_reference_v1());
 end if;
 return null;
end $f$;

create function dashboard_private.class_lesson_input_after_row_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
declare scope dashboard_private.class_lesson_input_scopes; ident text; before_row jsonb; after_row jsonb; expected jsonb;
begin
 select * into scope from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current();
 if not found then return null;end if;
 if pg_trigger_depth()<>1 or scope.actor_id is distinct from auth.uid()
 or scope.api_role is distinct from coalesce(current_setting('role',true),'none')
 or scope.relation_id<>tg_relid or scope.write_operation<>tg_op
 or not scope.statement_started or scope.statement_finished then
  raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
 end if;
 ident:=new.id::text;
 if ident=any(scope.consumed_ids) or not scope.expected_rows ? ident then
  raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
 end if;
 expected:=scope.expected_rows->ident;
 after_row:=to_jsonb(new)-'updated_at';
 if tg_op='INSERT' then
  before_row:='null'::jsonb;after_row:=after_row-'created_at';
 else before_row:=to_jsonb(old)-'updated_at';end if;
 if before_row is distinct from expected->'before' or after_row is distinct from expected->'after'
 or (tg_relid='public.classes'::regclass and new.id<>scope.class_id)
 or (tg_relid='public.class_lesson_sessions'::regclass and (after_row->>'class_id')::uuid<>scope.class_id) then
  raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
 end if;
 update dashboard_private.class_lesson_input_scopes set consumed_ids=array_append(consumed_ids,ident) where transaction_id=txid_current();
 return null;
end $f$;

-- AFTER ROW sees the actual row after every BEFORE ROW trigger. Statement
-- completion below also rejects suppressed rows, extra rows and zero-row drift.
create trigger class_lesson_input_after_row after insert or update or delete on public.classes
 for each row execute function dashboard_private.class_lesson_input_after_row_v1();
create trigger class_lesson_input_after_row after insert or update or delete on public.class_lesson_sessions
 for each row execute function dashboard_private.class_lesson_input_after_row_v1();
create trigger class_lesson_input_after_row after insert or update or delete on public.class_schedule_slots
 for each row execute function dashboard_private.class_lesson_input_after_row_v1();
create trigger class_lesson_input_after_row after insert or update or delete on public.teacher_catalogs
 for each row execute function dashboard_private.class_lesson_input_after_row_v1();
create trigger class_lesson_input_after_row after insert or update or delete on public.classroom_catalogs
 for each row execute function dashboard_private.class_lesson_input_after_row_v1();

create or replace function dashboard_private.timetable_operating_after_statement_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
declare scope dashboard_private.class_lesson_input_scopes;
begin
 select * into scope from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current();
 if found then
  if pg_trigger_depth()<>1 or scope.actor_id is distinct from auth.uid()
  or scope.api_role is distinct from coalesce(current_setting('role',true),'none')
  or scope.relation_id<>tg_relid or scope.write_operation<>tg_op
  or not scope.statement_started or scope.statement_finished
  or cardinality(scope.consumed_ids)<>(select count(*) from jsonb_object_keys(scope.expected_rows)) then
   raise exception using errcode='42501',message='class_lesson_input_scope_invalid';
  end if;
  update dashboard_private.class_lesson_input_scopes set statement_finished=true where transaction_id=txid_current();
  return null;
 end if;
 delete from dashboard_private.timetable_close_validation_proofs where transaction_id=txid_current();
 update dashboard_private.timetable_operating_write_baselines set ready=true where transaction_id=txid_current();
 return null;
end $f$;

-- Validate changed wire values, not availability or completeness of occupancy.
-- Absent/null time/resources are legitimate input; unchanged historical values
-- are never reinterpreted because another month is being saved.
create function dashboard_private.assert_class_lesson_input_fields_v1(p_row jsonb,p_old_row jsonb)
returns void language plpgsql stable security definer set search_path='' as $f$
declare k text; value text; parsed_date date; parsed_time time; resource_id uuid;
begin
 if jsonb_typeof(p_row) is distinct from 'object' then raise exception using errcode='22023',message='class_schedule_validation';end if;
 for k in select unnest(array['state','scheduleState']) loop
  if not p_row ? k or p_row->k='null'::jsonb or p_row->k is not distinct from p_old_row->k then continue;end if;
  if jsonb_typeof(p_row->k) is distinct from 'string' or p_row->>k not in('active','exception','makeup','tbd','skipped','force_active') then
   raise exception using errcode='22023',message='class_schedule_validation';
  end if;
 end loop;
 for k in select unnest(array['memo','publicNote','teacherNote','makeupMemo','teacherName','classroomName']) loop
  if not p_row ? k or p_row->k='null'::jsonb or p_row->k is not distinct from p_old_row->k then continue;end if;
  if jsonb_typeof(p_row->k) is distinct from 'string' then
   raise exception using errcode='22023',message='class_schedule_validation';
  end if;
 end loop;
 for k in select unnest(array['id','sessionKey','session_key']) loop
  if not p_row ? k or p_row->k is not distinct from p_old_row->k then continue;end if;
  if jsonb_typeof(p_row->k) is distinct from 'string' or nullif(btrim(p_row->>k),'') is null then
   raise exception using errcode='22023',message='class_schedule_validation';
  end if;
 end loop;
 for k in select unnest(array['date','session_date','originalDate','makeupDate']) loop
  if not p_row ? k or p_row->k='null'::jsonb or p_row->k is not distinct from p_old_row->k then continue;end if;
  value:=p_row->>k;
  if k in('originalDate','makeupDate') and p_row->k='""'::jsonb then continue;end if;
  if jsonb_typeof(p_row->k)<>'string' or value!~'^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='class_schedule_validation';end if;
  parsed_date:=value::date;
  if to_char(parsed_date,'YYYY-MM-DD')<>value then raise exception using errcode='22023',message='class_schedule_validation';end if;
 end loop;
 for k in select unnest(array['startTime','endTime']) loop
  if not p_row ? k or p_row->k in('null'::jsonb,'""'::jsonb) or p_row->k is not distinct from p_old_row->k then continue;end if;
  value:=p_row->>k;
  if jsonb_typeof(p_row->k)<>'string' or value!~'^(\d{2}:\d{2})(:\d{2}(\.\d{1,6})?)?$' then raise exception using errcode='22023',message='class_schedule_validation';end if;
  parsed_time:=value::time;
 end loop;
 if (p_row->'startTime' is distinct from p_old_row->'startTime' or p_row->'endTime' is distinct from p_old_row->'endTime')
 and nullif(p_row->>'startTime','') is not null and nullif(p_row->>'endTime','') is not null
 and (p_row->>'startTime')::time >= (p_row->>'endTime')::time then
  raise exception using errcode='22023',message='class_schedule_validation';
 end if;
 for k in select unnest(array['teacherCatalogId','classroomCatalogId']) loop
  if not p_row ? k or p_row->k in('null'::jsonb,'""'::jsonb) or p_row->k is not distinct from p_old_row->k then continue;end if;
  if jsonb_typeof(p_row->k)<>'string' then raise exception using errcode='22023',message='class_schedule_validation';end if;
  resource_id:=(p_row->>k)::uuid;
  if (k='teacherCatalogId' and not exists(select 1 from public.teacher_catalogs where id=resource_id))
  or (k='classroomCatalogId' and not exists(select 1 from public.classroom_catalogs where id=resource_id)) then
   raise exception using errcode='22023',message='class_schedule_catalog_invalid';
  end if;
 end loop;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
 raise exception using errcode='22023',message='class_schedule_validation';
end $f$;

create function dashboard_private.assert_legacy_lesson_input_v1(p_old_plan jsonb,p_new_plan jsonb)
returns void language plpgsql stable security definer set search_path='' as $f$
declare old_sessions jsonb; new_sessions jsonb; entry jsonb; previous jsonb; ident text; id_field text; k text; pair record; parsed_date date;
begin
 if p_new_plan is not distinct from p_old_plan then return;end if;
 if jsonb_typeof(p_new_plan) is distinct from 'object' then raise exception using errcode='22023',message='class_schedule_validation';end if;
 if p_new_plan->'sessions' is distinct from p_old_plan->'sessions' then
  if jsonb_typeof(p_new_plan->'sessions') is distinct from 'array' then raise exception using errcode='22023',message='class_schedule_validation';end if;
  old_sessions:=case when jsonb_typeof(p_old_plan->'sessions')='array' then p_old_plan->'sessions' else '[]'::jsonb end;
  new_sessions:=p_new_plan->'sessions';
  for entry in select value from jsonb_array_elements(new_sessions) loop
   -- Preserve a historical malformed/partial row only at its old multiplicity.
   if (select count(*) from jsonb_array_elements(new_sessions) n where n=entry)
    <=(select count(*) from jsonb_array_elements(old_sessions) o where o=entry) then continue;end if;
   if jsonb_typeof(entry) is distinct from 'object' then raise exception using errcode='22023',message='class_schedule_validation';end if;
   id_field:=case when nullif(entry->>'id','') is not null then 'id' when nullif(entry->>'sessionKey','') is not null then 'sessionKey' else 'session_key' end;
   ident:=entry->>id_field;
   if jsonb_typeof(entry->id_field) is distinct from 'string' or nullif(btrim(ident),'') is null
   or (select count(*) from jsonb_array_elements(new_sessions) n where coalesce(nullif(n->>'id',''),nullif(n->>'sessionKey',''),n->>'session_key')=ident)<>1 then
    raise exception using errcode='22023',message='class_schedule_validation';
   end if;
   select o into previous from jsonb_array_elements(old_sessions) o
    where coalesce(nullif(o->>'id',''),nullif(o->>'sessionKey',''),o->>'session_key')=ident limit 1;
   if previous is null and coalesce(nullif(entry->>'date',''),nullif(entry->>'session_date','')) is null then
    raise exception using errcode='22023',message='class_schedule_validation';
   end if;
   perform dashboard_private.assert_class_lesson_input_fields_v1(entry,previous);
  end loop;
 end if;
 for k in select unnest(array['sessionSchedules','sessionStates']) loop
  if p_new_plan->k is not distinct from p_old_plan->k then continue;end if;
  if not p_new_plan ? k then continue;end if;
  if jsonb_typeof(p_new_plan->k) is distinct from 'object' then raise exception using errcode='22023',message='class_schedule_validation';end if;
  for pair in select key,value from jsonb_each(p_new_plan->k) loop
   if pair.value is not distinct from p_old_plan->k->pair.key then continue;end if;
   if pair.key!~'^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='class_schedule_validation';end if;
   parsed_date:=pair.key::date;
   if to_char(parsed_date,'YYYY-MM-DD')<>pair.key then raise exception using errcode='22023',message='class_schedule_validation';end if;
   perform dashboard_private.assert_class_lesson_input_fields_v1(pair.value,p_old_plan->k->pair.key);
  end loop;
 end loop;
exception when invalid_datetime_format or datetime_field_overflow then
 raise exception using errcode='22023',message='class_schedule_validation';
end $f$;

create function dashboard_private.write_class_lesson_plan_input_v1(p_class_id uuid,p_old_plan jsonb,p_new_plan jsonb,p_request_key uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldrow public.classes; nextrow public.classes; result jsonb;
begin
 select * into oldrow from public.classes where id=p_class_id for update;
 if not found then raise exception using errcode='P0002',message='class_schedule_not_found';end if;
 if coalesce(oldrow.schedule_plan,'{}') is distinct from p_old_plan then raise exception using errcode='P0001',message='class_schedule_stale';end if;
 if oldrow.schedule_plan is not distinct from p_new_plan then return to_jsonb(oldrow);end if;
 nextrow:=oldrow;nextrow.schedule_plan:=p_new_plan;
 perform dashboard_private.begin_class_lesson_input_scope_v1(p_class_id,p_request_key,p_operation,'public.classes'::regclass,'UPDATE',
  jsonb_build_object(p_class_id::text,jsonb_build_object('before',to_jsonb(oldrow)-'updated_at','after',to_jsonb(nextrow)-'updated_at')));
 update public.classes set schedule_plan=p_new_plan where id=p_class_id returning to_jsonb(classes) into result;
 perform dashboard_private.end_class_lesson_input_scope_v1();
 return result;
end $f$;

-- Only the supplied session keys are projected, in their original array slots.
-- Unrelated periods, lesson content, ordering and unmaterialized history survive.
create function dashboard_private.project_class_lesson_input_sessions_v1(p_class_id uuid,p_session_ids uuid[],p_request_key uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldplan jsonb; nextplan jsonb; sessions jsonb; patches jsonb:='{}'; row public.class_lesson_sessions;
 entry jsonb; key text; seen text[]:='{}'; projected jsonb:='[]'; patch jsonb;
begin
 select coalesce(schedule_plan,'{}') into oldplan from public.classes where id=p_class_id for update;
 sessions:=case when jsonb_typeof(oldplan->'sessions')='array' then oldplan->'sessions' else '[]'::jsonb end;
 for row in select * from public.class_lesson_sessions where class_id=p_class_id and id=any(p_session_ids) order by session_date,start_time nulls last,session_key loop
  patch:=jsonb_build_object('id',row.session_key,'date',row.session_date,'scheduleState',row.schedule_state,
   'startTime',row.start_time,'endTime',row.end_time,'teacherCatalogId',row.teacher_catalog_id,'teacherName',row.teacher_name_snapshot,
   'classroomCatalogId',row.classroom_catalog_id,'classroomName',row.classroom_name_snapshot,'memo',row.memo,
   'publicNote',row.public_note,'teacherNote',row.teacher_note,'revision',row.revision,
   'legacyBillingId',row.legacy_billing_id,'legacyBillingLabel',row.legacy_billing_label,'legacyBillingColor',row.legacy_billing_color);
  patches:=patches||jsonb_build_object(row.session_key,patch);
 end loop;
 for entry in select value from jsonb_array_elements(sessions) loop
  key:=coalesce(entry->>'id',entry->>'sessionKey',entry->>'session_key');
  if patches ? key and not key=any(seen) then
   entry:=entry||(patches->key);seen:=array_append(seen,key);
  end if;
  projected:=projected||jsonb_build_array(entry);
 end loop;
 for row in select * from public.class_lesson_sessions where class_id=p_class_id and id=any(p_session_ids) order by session_date,start_time nulls last,session_key loop
  if not row.session_key=any(seen) then projected:=projected||jsonb_build_array(patches->row.session_key);end if;
 end loop;
 nextplan:=jsonb_set(oldplan,'{sessions}',projected,true);
 perform dashboard_private.write_class_lesson_plan_input_v1(p_class_id,oldplan,nextplan,p_request_key,p_operation);
 return nextplan;
end $f$;

create or replace function public.update_class_operational_v1(p_class_id uuid,p_patch jsonb,p_request_key uuid,p_expected_schedule_plan jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldrow public.classes; nextrow public.classes; result jsonb; receipt jsonb; h text; closure jsonb; close_replay boolean:=false;
begin
 perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 if p_class_id is null or p_request_key is null or p_patch='{}'::jsonb or jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in('name','class_type','subject','subject_area_key','grade','teacher','schedule','room','capacity','fee','status','textbook_ids','textbook_usage','schedule_plan')) then raise exception using errcode='22023',message='class_schedule_validation';end if;
 h:=dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId',p_class_id,'patch',p_patch,'expectedSchedulePlan',p_expected_schedule_plan));
 receipt:=dashboard_private.continuous_class_schedule_request_replay_v1('update_class_operational_v1',p_request_key,h);
 if receipt is not null then return receipt;end if;
 if p_patch->>'status'='종강' then
  select exists(select 1 from dashboard_private.class_schedule_mutation_receipts
   where actor_profile_id=auth.uid() and request_key=p_request_key and operation='close_class_atomic_v1') into close_replay;
  closure:=public.close_class_atomic_v1(p_class_id,p_request_key);
 end if;
 select * into oldrow from public.classes where id=p_class_id for update;
 if not found then raise exception using errcode='P0002',message='class_schedule_not_found';end if;
 if p_patch ? 'schedule_plan' then
 if oldrow.schedule_storage_mode='normalized' then raise exception using errcode='22023',message='class_schedule_validation';end if;
 if p_expected_schedule_plan is null or coalesce(oldrow.schedule_plan,'{}') is distinct from p_expected_schedule_plan then raise exception using errcode='P0001',message='class_schedule_stale';end if;
 end if;
 -- Only the complete schedule_plan-only command has the input policy. All
 -- mixed/basic-info/close commands keep the original occupancy boundaries.
 if p_patch ? 'schedule_plan' and p_patch-'schedule_plan'='{}'::jsonb then
  perform dashboard_private.assert_legacy_lesson_input_v1(coalesce(oldrow.schedule_plan,'{}'),p_patch->'schedule_plan');
  result:=dashboard_private.write_class_lesson_plan_input_v1(p_class_id,p_expected_schedule_plan,p_patch->'schedule_plan',p_request_key,'update_class_operational_v1');
  if oldrow.schedule_plan is distinct from p_patch->'schedule_plan' then
   update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';
  end if;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('update_class_operational_v1',p_request_key,h,jsonb_build_object('classRow',result,'closeResult',null));
 end if;
 if oldrow.schedule_storage_mode='normalized' and (p_patch ?| array['teacher','schedule','room']) then raise exception using errcode='22023',message='class_schedule_validation';end if;
 if p_patch ? 'status' and p_patch->>'status' not in('수강','개강 준비','종강') then raise exception using errcode='22023',message='class_schedule_validation';end if;
 nextrow:=jsonb_populate_record(oldrow,p_patch);
 -- Preserve UPDATE-only science catalogue validation. Inner close already
 -- checks row constraints; a true residual edit keeps every original trigger.
 if closure is not null and not close_replay and nextrow is not distinct from oldrow
 and not (oldrow.subject='과학' and p_patch ?| array['subject','subject_area_key'])
 and dashboard_private.arm_timetable_close_validation_reuse_v1(oldrow) then
  result:=to_jsonb(oldrow);
 else
  execute format('update public.classes set %s where id=$2 returning to_jsonb(classes)',(select string_agg(format('%I=($1).%I',k,k),', ' order by k) from jsonb_object_keys(p_patch) k)) using nextrow,p_class_id into result;
 end if;
 -- Retain this boundary even on the no-op branch; a changed proof falls back
 -- to complete validation. Finalization always validates a fresh reference.
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
 if not exists(select 1 from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()) and (oldrow.name,oldrow.subject,oldrow.grade) is distinct from (nextrow.name,nextrow.subject,nextrow.grade) then
 update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';end if;
 return dashboard_private.record_continuous_class_schedule_receipt_v1('update_class_operational_v1',p_request_key,h,jsonb_build_object('classRow',result,'closeResult',closure));
end $f$;

create or replace function public.generate_class_lesson_sessions_v1(p_class_id uuid,p_expected_schedule_revision bigint,p_date_from date,p_date_to date,p_request_key uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_class public.classes; v_hash text; v_replay jsonb; v_actor uuid; v_response jsonb;
 rows_to_insert jsonb; expected jsonb; session_ids uuid[];
begin
 perform dashboard_private.lock_timetable_operating_resources_v1();
 v_hash:=dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId',p_class_id,'revision',p_expected_schedule_revision,'dateFrom',p_date_from,'dateTo',p_date_to,'reason',p_reason));
 v_replay:=dashboard_private.continuous_class_schedule_request_replay_v1('generate_class_lesson_sessions_v1',p_request_key,v_hash);
 if v_replay is not null then return v_replay;end if;
 v_class:=dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id,true,true,false,p_reason);
 if v_class.schedule_revision<>p_expected_schedule_revision then raise exception using errcode='P0001',message='class_schedule_stale';end if;
 if p_date_from is null or p_date_to is null or p_date_from>p_date_to or p_date_to-p_date_from>366 then raise exception using errcode='22023',message='class_schedule_validation';end if;
 perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id,p_request_key,'generate_class_lesson_sessions_v1',p_reason);
 v_actor:=dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 -- Allocate exact IDs first, preserving the existing generation/deduplication
 -- query. No inserted row can fall outside the private statement target set.
 select coalesce(jsonb_agg(to_jsonb(s) order by (s).session_date,(s).start_time,(s).session_key),'[]'::jsonb) into rows_to_insert
 from (
  select jsonb_populate_record(null::public.class_lesson_sessions,jsonb_build_object(
   'id',gen_random_uuid(),'class_id',p_class_id,'session_key',candidate.session_key,
   'source_schedule_slot_id',candidate.source_schedule_slot_id,'session_date',candidate.session_date,'schedule_state','active',
   'start_time',candidate.start_time,'end_time',candidate.end_time,'teacher_catalog_id',candidate.teacher_catalog_id,
   'teacher_name_snapshot',candidate.teacher_name_snapshot,'classroom_catalog_id',candidate.classroom_catalog_id,
   'classroom_name_snapshot',candidate.classroom_name_snapshot,'origin','default','makeup_of_session_id',null,
   'legacy_billing_id','period:'||to_char(candidate.session_date,'YYYY-MM'),
   'legacy_billing_label',to_char(candidate.session_date,'YYYY"년" FMMonth "월"'),'legacy_billing_color','#3182f6',
   'memo','','public_note','','teacher_note','','revision',0,'created_by',v_actor,'updated_by',v_actor)) s
  from dashboard_private.continuous_class_schedule_generation_candidates_v1(p_class_id,p_date_from,p_date_to) candidate where not candidate.existing
 ) candidate_rows;
 select coalesce(jsonb_object_agg(s.id::text,jsonb_build_object('before',null,'after',to_jsonb(s)-'created_at'-'updated_at')),'{}'::jsonb),
  coalesce(array_agg(s.id),'{}'::uuid[]) into expected,session_ids
 from jsonb_populate_recordset(null::public.class_lesson_sessions,rows_to_insert) s;
 perform dashboard_private.begin_class_lesson_input_scope_v1(p_class_id,p_request_key,'generate_class_lesson_sessions_v1','public.class_lesson_sessions'::regclass,'INSERT',expected);
 insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,
  teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin,legacy_billing_id,legacy_billing_label,
  legacy_billing_color,created_by,updated_by)
 select s.id,s.class_id,s.session_key,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,
  s.teacher_catalog_id,s.teacher_name_snapshot,s.classroom_catalog_id,s.classroom_name_snapshot,s.origin,s.legacy_billing_id,s.legacy_billing_label,
  s.legacy_billing_color,s.created_by,s.updated_by
 from jsonb_populate_recordset(null::public.class_lesson_sessions,rows_to_insert) s;
 perform dashboard_private.end_class_lesson_input_scope_v1();
 if cardinality(session_ids)>0 then
  perform dashboard_private.project_class_lesson_input_sessions_v1(p_class_id,session_ids,p_request_key,'generate_class_lesson_sessions_v1');
  update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';
 end if;
 select jsonb_build_object('generatedCount',count(*),'scheduleRevision',v_class.schedule_revision) into v_response
 from public.class_lesson_sessions where class_id=p_class_id and session_date between p_date_from and p_date_to;
 return dashboard_private.record_continuous_class_schedule_receipt_v1('generate_class_lesson_sessions_v1',p_request_key,v_hash,v_response);
end $f$;

create or replace function public.save_class_lesson_session_v1(p_session_id uuid,p_expected_revision bigint,p_schedule_state text,p_session_date date,p_start_time time without time zone,p_end_time time without time zone,p_teacher_catalog_id uuid,p_classroom_catalog_id uuid,p_memo text,p_public_note text,p_teacher_note text,p_request_key uuid,p_correction_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_session public.class_lesson_sessions; next_session public.class_lesson_sessions; v_class public.classes;
 v_hash text; v_replay jsonb; v_actor uuid; v_teacher text; v_room text; v_response jsonb;
begin
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into v_session from public.class_lesson_sessions where id=p_session_id;
 if not found then raise exception using errcode='P0002',message='class_schedule_not_found';end if;
 v_hash:=dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('sessionId',p_session_id,'revision',p_expected_revision,'state',p_schedule_state,'date',p_session_date,'start',p_start_time,'end',p_end_time,'teacher',p_teacher_catalog_id,'room',p_classroom_catalog_id,'memo',p_memo,'publicNote',p_public_note,'teacherNote',p_teacher_note,'reason',p_correction_reason));
 v_replay:=dashboard_private.continuous_class_schedule_request_replay_v1('save_class_lesson_session_v1',p_request_key,v_hash);
 if v_replay is not null then return v_replay;end if;
 v_class:=dashboard_private.require_continuous_class_schedule_mutation_v1(v_session.class_id,true,true,true,p_correction_reason);
 select * into v_session from public.class_lesson_sessions where id=p_session_id for update;
 if v_session.revision<>p_expected_revision then raise exception using errcode='P0001',message='class_schedule_stale';end if;
 if p_schedule_state not in('active','exception','makeup','tbd','skipped') or p_session_date is null
 or (p_start_time is null)<>(p_end_time is null) or (p_start_time is not null and p_start_time>=p_end_time) then
  raise exception using errcode='22023',message='class_schedule_validation';
 end if;
 v_teacher:=dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher',p_teacher_catalog_id,v_class.subject);
 v_room:=dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom',p_classroom_catalog_id,v_class.subject);
 perform dashboard_private.with_continuous_class_schedule_audit_context_v1(v_class.id,p_request_key,'save_class_lesson_session_v1',p_correction_reason);
 v_actor:=dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 next_session:=v_session;
 next_session.schedule_state:=p_schedule_state;next_session.session_date:=p_session_date;
 next_session.start_time:=p_start_time;next_session.end_time:=p_end_time;
 next_session.teacher_catalog_id:=p_teacher_catalog_id;next_session.teacher_name_snapshot:=v_teacher;
 next_session.classroom_catalog_id:=p_classroom_catalog_id;next_session.classroom_name_snapshot:=v_room;
 next_session.memo:=coalesce(p_memo,'');next_session.public_note:=coalesce(p_public_note,'');next_session.teacher_note:=coalesce(p_teacher_note,'');
 next_session.revision:=v_session.revision+1;next_session.updated_by:=v_actor;
 perform dashboard_private.begin_class_lesson_input_scope_v1(v_class.id,p_request_key,'save_class_lesson_session_v1','public.class_lesson_sessions'::regclass,'UPDATE',
  jsonb_build_object(p_session_id::text,jsonb_build_object('before',to_jsonb(v_session)-'updated_at','after',to_jsonb(next_session)-'updated_at')));
 update public.class_lesson_sessions set schedule_state=next_session.schedule_state,session_date=next_session.session_date,
  start_time=next_session.start_time,end_time=next_session.end_time,teacher_catalog_id=next_session.teacher_catalog_id,
  teacher_name_snapshot=next_session.teacher_name_snapshot,classroom_catalog_id=next_session.classroom_catalog_id,
  classroom_name_snapshot=next_session.classroom_name_snapshot,memo=next_session.memo,public_note=next_session.public_note,
  teacher_note=next_session.teacher_note,revision=next_session.revision,updated_by=next_session.updated_by where id=p_session_id;
 perform dashboard_private.end_class_lesson_input_scope_v1();
 perform dashboard_private.project_class_lesson_input_sessions_v1(v_class.id,array[p_session_id],p_request_key,'save_class_lesson_session_v1');
 update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';
 select to_jsonb(s) into v_response from public.class_lesson_sessions s where id=p_session_id;
 return dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_lesson_session_v1',p_request_key,v_hash,v_response);
end $f$;

-- CREATE OR REPLACE preserves all pre-existing public/private ACLs and owners.
-- New implementation objects have no direct API entry point, including service_role.
alter function dashboard_private.begin_class_lesson_input_scope_v1(uuid,uuid,text,regclass,text,jsonb) owner to postgres;
alter function dashboard_private.end_class_lesson_input_scope_v1() owner to postgres;
alter function dashboard_private.class_lesson_input_after_row_v1() owner to postgres;
alter function dashboard_private.assert_class_lesson_input_fields_v1(jsonb,jsonb) owner to postgres;
alter function dashboard_private.assert_legacy_lesson_input_v1(jsonb,jsonb) owner to postgres;
alter function dashboard_private.write_class_lesson_plan_input_v1(uuid,jsonb,jsonb,uuid,text) owner to postgres;
alter function dashboard_private.project_class_lesson_input_sessions_v1(uuid,uuid[],uuid,text) owner to postgres;
revoke all on function
 dashboard_private.begin_class_lesson_input_scope_v1(uuid,uuid,text,regclass,text,jsonb),
 dashboard_private.end_class_lesson_input_scope_v1(),
 dashboard_private.class_lesson_input_after_row_v1(),
 dashboard_private.assert_class_lesson_input_fields_v1(jsonb,jsonb),
 dashboard_private.assert_legacy_lesson_input_v1(jsonb,jsonb),
 dashboard_private.write_class_lesson_plan_input_v1(uuid,jsonb,jsonb,uuid,text),
 dashboard_private.project_class_lesson_input_sessions_v1(uuid,uuid[],uuid,text)
 from public,anon,authenticated,service_role;
-- Align saved per-ID input with the editor and both operating readers.
create or replace function dashboard_private.resolve_legacy_effective_schedule_v1(p jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare
 lesson jsonb:=coalesce(p->'session','{}'); d text:=coalesce(lesson->>'date',''); dt date;
 state text:=coalesce(nullif(lesson->>'scheduleState',''),nullif(lesson->>'state',''),'active');
 kind text:='unresolved'; vals jsonb:='{}'; provenance jsonb:='{}'; missing jsonb:='[]'; errors jsonb:='[]';
 allslots jsonb:=coalesce(p->'basicSlots','[]'); slots jsonb; basic_source text;
 sources jsonb; source jsonb; chosen jsonb; source_name text; source_error text;
 field text; name_field text; catalogs jsonb; candidate text; value text;
 n int; distinct_n int; common_value jsonb; has_choice boolean; request_owned boolean:=false; request_id text:=lesson->>'makeupRequestId'; prefix text; unassigned_room boolean;
begin
 if jsonb_typeof(p->'session') is distinct from 'object' then errors:=errors||'"invalid_session"'::jsonb;end if;
 if coalesce(nullif(lesson->>'id',''),nullif(lesson->>'sessionKey',''),'')='' or coalesce((p->>'identityCount')::int,1)<>1 then errors:=errors||'"ambiguous_identity"'::jsonb;end if;
 begin
  dt:=d::date;
  if d!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or dt::text<>d then raise exception 'invalid date';end if;
 exception when others then errors:=errors||'"invalid_date"'::jsonb;end;
 if state not in('active','makeup','exception','skipped','tbd') then errors:=errors||'"invalid_state"'::jsonb;end if;
 if errors<>'[]'::jsonb and not (errors='["invalid_date"]'::jsonb and lesson ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName']) then
  return jsonb_build_object('date',d,'state',state,'kind',kind,'values',vals,'provenance',provenance,'missing',missing,'errors',errors);
 end if;
 if errors='[]'::jsonb and state in('exception','skipped','tbd') then
  return jsonb_build_object('date',d,'state',state,'kind','cancelled','values',vals,'provenance',provenance,'missing',missing,'errors',errors);
 end if;
 if errors ? 'invalid_date' then allslots:='[]';dt:=null;end if;
 if lesson ? 'sourceSlotId' then
  select coalesce(jsonb_agg(s),'[]') into slots from jsonb_array_elements(allslots) s where coalesce(lesson->>'sourceSlotId','')<>'' and s->>'id'=lesson->>'sourceSlotId';
  basic_source:='basic_bound_slot';
 else
  select coalesce(jsonb_agg(s),'[]') into slots from jsonb_array_elements(allslots) s where (s->>'weekday')::int=extract(dow from dt)::int;
  basic_source:=case when slots='[]'::jsonb then 'basic_shared' else 'basic_weekday' end;
  if slots='[]'::jsonb then slots:=allslots;end if;
 end if;
 -- Field-level authored scalar priority; keep request-lesson map bypass.
 if request_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  prefix:='makeup-request:'||request_id||':';
  request_owned:=coalesce((lesson->>'makeupRequestRole'='cancel' and jsonb_typeof(coalesce(nullif(lesson->'id','""'::jsonb),lesson->'sessionKey'))='string')
   or (lesson->>'id'='makeup-cancel:'||request_id and lesson->>'sessionKey'=lesson->>'id')
   or (left(lesson->>'id',length(prefix))=prefix and substring(lesson->>'id' from length(prefix)+1)~'^[0-9]+$' and lesson->>'sessionKey'=lesson->>'id'),false);
 end if;
 -- A date map masks legacy raw names, but not explicit row times/catalog IDs.
 -- Shared dates inherit missing fields; stable identity remains independently checked.
 if not request_owned and jsonb_typeof(p->'dateOverride')='object' then
  select jsonb_build_array(jsonb_build_object('name','session','value',coalesce(jsonb_object_agg(k,v),'{}'::jsonb)),
   jsonb_build_object('name','date_override','value',p->'dateOverride')) into sources
  from jsonb_each(lesson) e(k,v) where k=any(array['startTime','endTime','teacherCatalogId','classroomCatalogId','classroomUnresolved']);
 else sources:=jsonb_build_array(jsonb_build_object('name','session','value',lesson));end if;
 if jsonb_typeof(p->'approvedOverride')='object' then sources:=sources||jsonb_build_array(jsonb_build_object('name','approved_override','value',p->'approvedOverride'));end if;
 foreach field in array array['startTime','endTime','teacherCatalogId','classroomCatalogId'] loop
  name_field:=case field when 'teacherCatalogId' then 'teacherName' when 'classroomCatalogId' then 'classroomName' end;
  catalogs:=case field when 'teacherCatalogId' then coalesce(p#>'{catalogs,teachers}','[]') when 'classroomCatalogId' then coalesce(p#>'{catalogs,rooms}','[]') end;
  has_choice:=false; chosen:='{}';source_error:=null;source_name:=basic_source;value:=null;
  for source in select s from jsonb_array_elements(sources) s loop
   if (source->'value') ? field or (name_field is not null and (source->'value') ? name_field) then
    has_choice:=true; chosen:=source->'value';source_name:=source->>'name';
    if source_name='approved_override' and (p->'approvedOverrideVerified') is distinct from 'true'::jsonb then source_error:='unverified_approved_override';end if;
    if source_error is null and field='classroomCatalogId' and chosen->'classroomUnresolved'='true'::jsonb then source_error:='invalid_resource';end if;
    exit;
   end if;
  end loop;
  if not has_choice then
   select count(*),count(distinct coalesce(s->field,'null'::jsonb)),(jsonb_agg(coalesce(s->field,'null'::jsonb)))->0 into n,distinct_n,common_value from jsonb_array_elements(slots) s;
   if n>0 and distinct_n=1 then chosen:=jsonb_build_object(field,common_value);end if;
   if field='classroomCatalogId' then
    if exists(select 1 from jsonb_array_elements(slots) s where s->'classroomUnresolved'='true'::jsonb) then source_error:='invalid_resource';
    elsif n>0 and distinct_n>1 then source_error:='ambiguous_basic_resource';end if;
   end if;
  end if;
  provenance:=provenance||jsonb_build_object(field,source_name);
  unassigned_room:=field='classroomCatalogId' and source_error is null;
  if source_error is not null then errors:=errors||to_jsonb(field||':'||source_error);
  elsif name_field is not null then
   if chosen ? field then
    candidate:=btrim(coalesce(chosen->>field,''));
    if candidate<>'' and (select count(*) from jsonb_array_elements(catalogs) c where c->>'id'=candidate)=1 then value:=candidate;end if;
    if field='classroomCatalogId' and (candidate<>'' or jsonb_typeof(chosen->field) not in('null','string')) then
     unassigned_room:=false;
     if value is null then errors:=errors||to_jsonb(field||':invalid_resource');end if;
    end if;
   elsif chosen ? name_field then
    candidate:=btrim(coalesce(chosen->>name_field,''));
    select count(*),min(c->>'id') into n,value from jsonb_array_elements(catalogs) c where candidate<>'' and btrim(c->>'name')=candidate;
    if n<>1 or coalesce(value,'')='' then value:=null;end if;
    if field='classroomCatalogId' then
     unassigned_room:=jsonb_typeof(chosen->name_field) in('null','string') and n=0 and candidate in('','미정','강의실 미정');
     if value is null and not unassigned_room then errors:=errors||to_jsonb(field||':invalid_resource');end if;
    end if;
   end if;
  else
   candidate:=btrim(coalesce(chosen->>field,''));
   if candidate~'^[0-9]{1,2}:[0-5][0-9](:00([.]0+)?)?$' then
    if split_part(candidate,':',1)::int<=23 or (field='endTime' and split_part(candidate,':',1)::int=24 and split_part(candidate,':',2)='00') then
     value:=lpad(split_part(candidate,':',1),2,'0')||':'||split_part(candidate,':',2);
    end if;
   end if;
  end if;
  vals:=vals||jsonb_build_object(field,value);
  if value is null and not unassigned_room then missing:=missing||to_jsonb(field);end if;
 end loop;
 if vals->>'startTime' is not null and vals->>'endTime' is not null and vals->>'startTime'>=vals->>'endTime' then errors:=errors||'"invalid_time_range"'::jsonb;end if;
 if missing='[]'::jsonb and errors='[]'::jsonb then kind:='resolved';end if;
 return jsonb_build_object('date',d,'state',state,'kind',kind,'values',vals,'provenance',provenance,'missing',missing,'errors',errors);
end $fn$;

commit;
