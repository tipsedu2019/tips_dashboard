begin;
set local lock_timeout='5s';
set local statement_timeout='8s';

-- One-use evidence for the immediate outer close assertion. The initial
-- baseline remains immutable and its unchanged finalizer always reads afresh.
create table dashboard_private.timetable_close_validation_proofs (
 transaction_id bigint primary key references dashboard_private.timetable_operating_write_baselines(transaction_id) on delete cascade,
 baseline_hash bytea not null,
 actor_context jsonb not null,
 class_id uuid,
 class_row jsonb,
 reuse_requested boolean not null default false
);
alter table dashboard_private.timetable_close_validation_proofs enable row level security;
revoke all on dashboard_private.timetable_close_validation_proofs from public,anon,authenticated,service_role;

create function dashboard_private.timetable_validation_actor_context_v1()
returns jsonb language sql stable security definer set search_path='' as $f$
 select jsonb_build_object('actor',auth.uid(),'apiRole',current_setting('role',true),
  'dashboardRole',public.current_dashboard_role(),'deletedAt',u.deleted_at,'bannedUntil',u.banned_until,
  'closeContext',current_setting('app.class_close_mutation',true),
  'scheduleContext',current_setting('app.class_schedule_mutation',true),
  'timeZone',current_setting('TimeZone'),'dateStyle',current_setting('DateStyle'))
 from auth.users u where u.id=auth.uid()
$f$;

-- Calendar/history rows can be written without the operating lock. They only
-- supply approved fallback for legacy makeup identities, so any such identity
-- anywhere in the complete history disables reuse. Missing normalized resource
-- IDs also disable it: untracked snapshot-name edits can then affect resolution.
-- Do not infer eligibility merely from the class being closed or row counts.
create function dashboard_private.timetable_close_validation_reuse_eligible_v1()
returns boolean language sql stable security definer set search_path='' as $f$
 select not exists(select 1 from dashboard_private.past_lesson_state_correction_contexts where transaction_id=txid_current())
 and not exists(select 1 from public.classes c where c.schedule_storage_mode<>'normalized' and (
  (c.schedule_plan ? 'sessions' and jsonb_typeof(c.schedule_plan->'sessions') is distinct from 'array')
  or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array'
    then c.schedule_plan->'sessions' else '[]'::jsonb end) v
    where jsonb_typeof(v) is distinct from 'object'
     or coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active')='makeup')))
 and not exists(select 1 from public.class_schedule_slots where teacher_catalog_id is null or classroom_catalog_id is null)
 and not exists(select 1 from public.class_lesson_sessions where teacher_catalog_id is null or classroom_catalog_id is null)
$f$;

create function dashboard_private.arm_timetable_close_validation_reuse_v1(p_class_row public.classes)
returns boolean language plpgsql security definer set search_path='' as $f$
declare p dashboard_private.timetable_close_validation_proofs;
begin
 if p_class_row.status is distinct from '종강' or p_class_row.closed_at is null
 or p_class_row.closed_by is null or not dashboard_private.timetable_close_validation_reuse_eligible_v1() then return false;end if;
 select * into p from dashboard_private.timetable_close_validation_proofs where transaction_id=txid_current();
 if not found or p.reuse_requested
 or p.actor_context is distinct from dashboard_private.timetable_validation_actor_context_v1()
 or not exists(select 1 from dashboard_private.timetable_operating_write_baselines b
   where b.transaction_id=txid_current() and sha256(convert_to(b.reference::text,'UTF8'))=p.baseline_hash)
 then return false;end if;
 update dashboard_private.timetable_close_validation_proofs
 set class_id=p_class_row.id,class_row=to_jsonb(p_class_row),reuse_requested=true where transaction_id=txid_current();
 return true;
end $f$;

create or replace function dashboard_private.assert_timetable_operational_conflicts_v1()
returns void language plpgsql security definer set search_path='' as $f$
declare p dashboard_private.timetable_close_validation_proofs; r jsonb; baseline jsonb; actor jsonb;
begin
 -- Consume before checking. No user-set GUC, request key or saved client draft
 -- can manufacture this private capability or make it affect another boundary.
 delete from dashboard_private.timetable_close_validation_proofs where transaction_id=txid_current() returning * into p;
 if found and p.reuse_requested and p.class_row is not null
 and dashboard_private.timetable_close_validation_reuse_eligible_v1()
 and p.actor_context=dashboard_private.timetable_validation_actor_context_v1()
 and exists(select 1 from dashboard_private.timetable_operating_write_baselines b
   where b.transaction_id=txid_current() and sha256(convert_to(b.reference::text,'UTF8'))=p.baseline_hash)
 and exists(select 1 from public.classes c where c.id=p.class_id and to_jsonb(c)=p.class_row)
 then return;end if;
 -- Capture the exact baseline/context being validated, not a changed baseline
 -- observed later after close returns. Further operating writes invalidate it.
 select reference into baseline from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 actor:=dashboard_private.timetable_validation_actor_context_v1();
 r:=dashboard_private.validate_timetable_operating_reference_v1();
 if r is not null and baseline is not null and actor is not null
 and actor=dashboard_private.timetable_validation_actor_context_v1()
 and dashboard_private.timetable_close_validation_reuse_eligible_v1()
 and exists(select 1 from dashboard_private.timetable_operating_write_baselines b
   where b.transaction_id=txid_current() and b.reference=baseline) then
  insert into dashboard_private.timetable_close_validation_proofs(transaction_id,baseline_hash,actor_context)
  values(txid_current(),sha256(convert_to(baseline::text,'UTF8')),actor);
 end if;
end $f$;

create or replace function dashboard_private.timetable_operating_after_statement_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 delete from dashboard_private.timetable_close_validation_proofs where transaction_id=txid_current();
 -- Preserve the existing UPDATE event, including immediate constraints and
 -- zero-row statements; it queues the unchanged fresh deferred finalizer.
 update dashboard_private.timetable_operating_write_baselines set ready=true where transaction_id=txid_current();
 return null;
end $f$;

-- UUID identities also determine occupancy. Existing direct table privileges
-- must not permit identity changes outside the same lock/invalidation boundary.
create or replace trigger timetable_operating_before before insert or delete or update of id,schedule,teacher,room,status,start_date,end_date,schedule_storage_mode,schedule_plan on public.classes for each statement execute function dashboard_private.timetable_operating_before_statement_v1();
create or replace trigger timetable_operating_after after insert or delete or update of id,schedule,teacher,room,status,start_date,end_date,schedule_storage_mode,schedule_plan on public.classes for each statement execute function dashboard_private.timetable_operating_after_statement_v1();
create or replace trigger timetable_operating_before before insert or delete or update of id,name,is_visible,subjects on public.teacher_catalogs for each statement execute function dashboard_private.timetable_operating_before_statement_v1();
create or replace trigger timetable_operating_after after insert or delete or update of id,name,is_visible,subjects on public.teacher_catalogs for each statement execute function dashboard_private.timetable_operating_after_statement_v1();
create or replace trigger timetable_operating_before before insert or delete or update of id,name,is_visible,subjects on public.classroom_catalogs for each statement execute function dashboard_private.timetable_operating_before_statement_v1();
create or replace trigger timetable_operating_after after insert or delete or update of id,name,is_visible,subjects on public.classroom_catalogs for each statement execute function dashboard_private.timetable_operating_after_statement_v1();

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

alter function dashboard_private.timetable_validation_actor_context_v1() owner to postgres;
alter function dashboard_private.timetable_close_validation_reuse_eligible_v1() owner to postgres;
alter function dashboard_private.arm_timetable_close_validation_reuse_v1(public.classes) owner to postgres;
revoke all on function dashboard_private.timetable_validation_actor_context_v1(),
 dashboard_private.timetable_close_validation_reuse_eligible_v1(),
 dashboard_private.arm_timetable_close_validation_reuse_v1(public.classes) from public,anon,authenticated,service_role;
-- Existing wrapper/trigger/gateway signatures, owners and ACLs are preserved
-- by CREATE OR REPLACE. No validator, reader or finalizer definition is changed.
commit;
