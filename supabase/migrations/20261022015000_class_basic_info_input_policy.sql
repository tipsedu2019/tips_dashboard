begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Preserve the private exact-statement capability installed by PR161.
-- This replaces one public function; no data, table, trigger or ACL changes.
create or replace function public.update_class_operational_v1(p_class_id uuid,p_patch jsonb,p_request_key uuid,p_expected_schedule_plan jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldrow public.classes; nextrow public.classes; result jsonb; receipt jsonb; h text; closure jsonb; close_replay boolean:=false; input_field text; label text; piece text; parts text[]; a int; b int;
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
 -- Preserve the established lesson-only CAS writer and retry contract.
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
 -- Ordinary class edits describe input, not a claim about historic occupancy.
 -- Real lifecycle transitions/closing remain with their existing atomic workflow.
 if closure is null and not (p_patch ? 'schedule_plan') and nextrow.status is not distinct from oldrow.status then
  -- Validate changed legacy references only; missing historical defaults are
  -- not reinterpreted just because a different field was edited.
  for input_field in select unnest(array['teacher','room']) loop
   if not p_patch ? input_field or p_patch->input_field is not distinct from to_jsonb(oldrow)->input_field then continue;end if;
   if jsonb_typeof(p_patch->input_field) not in('string','null') then raise exception using errcode='22023',message='class_schedule_validation';end if;
   for label in select btrim(regexp_replace(x,'[(][월화수목금토일][)]','','g')) from regexp_split_to_table(coalesce(p_patch->>input_field,''),'[,，/]+') x loop
    if input_field='teacher' and label='' and nullif(btrim(nextrow.schedule),'') is not null then
     raise exception using errcode='22023',message='class_schedule_catalog_invalid';end if;
    if label='' or (input_field='room' and label in('미정','강의실 미정')) then continue;end if;
    if (input_field='teacher' and (select count(*) from public.teacher_catalogs where name=label)<>1)
     or (input_field='room' and (select count(*) from public.classroom_catalogs where name=label)<>1) then
     raise exception using errcode='22023',message='class_schedule_catalog_invalid';end if;
   end loop;
  end loop;
  if p_patch ? 'schedule' and nextrow.schedule is distinct from oldrow.schedule then
   if jsonb_typeof(p_patch->'schedule') not in('string','null') then raise exception using errcode='22023',message='class_schedule_validation';end if;
   for piece in select btrim(x) from regexp_split_to_table(coalesce(nextrow.schedule,''), E'[\\n;]+|,[[:space:]]*(?=[월화수목금토일][월화수목금토일 /,]*[[:space:]]+[0-9])') x where btrim(x)<>'' loop
    parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~–][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^,()]*),[[:space:]]*([^()]*)[)])?$');
    if parts is null then raise exception using errcode='22023',message='class_schedule_validation';end if;
    a:=split_part(parts[2],':',1)::int*60+split_part(parts[2],':',2)::int;
    b:=split_part(parts[3],':',1)::int*60+split_part(parts[3],':',2)::int;
    if split_part(parts[2],':',1)::int>23 or split_part(parts[2],':',2)::int>59 or split_part(parts[3],':',2)::int>59 or a>=b or b>1440 then
     raise exception using errcode='22023',message='class_schedule_validation';end if;
    if parts[5] is not null and btrim(parts[5])<>'' and (select count(*) from public.teacher_catalogs where name=btrim(parts[5]))<>1 then
     raise exception using errcode='22023',message='class_schedule_catalog_invalid';end if;
    if parts[6] is not null and btrim(parts[6]) not in('','미정','강의실 미정') and (select count(*) from public.classroom_catalogs where name=btrim(parts[6]))<>1 then
     raise exception using errcode='22023',message='class_schedule_catalog_invalid';end if;
   end loop;
  end if;
  -- Account for the existing deterministic textbook retirement trigger in the
  -- exact expected row. Unexpected trigger changes must still fail the guard.
  if p_patch ?| array['textbook_ids','textbook_usage'] and nextrow.textbook_ids is distinct from oldrow.textbook_ids
   and nextrow.textbook_usage is not distinct from oldrow.textbook_usage then
   select coalesce(jsonb_object_agg(key,value),'{}') into nextrow.textbook_usage
    from jsonb_each(coalesce(nextrow.textbook_usage,'{}')) where coalesce(nextrow.textbook_ids,'[]') ? key;
  end if;
  -- Include the unchanged room value on metadata-only updates so the existing
  -- statement guards verify the exact row for every ordinary class edit.
  perform dashboard_private.begin_class_lesson_input_scope_v1(p_class_id,p_request_key,'update_class_operational_v1','public.classes'::regclass,'UPDATE',
    jsonb_build_object(p_class_id::text,jsonb_build_object('before',to_jsonb(oldrow)-'updated_at','after',to_jsonb(nextrow)-'updated_at')));
  execute format('update public.classes set %s where id=$2 returning to_jsonb(classes)',(select string_agg(format('%I=($1).%I',k,k),', ' order by k) from jsonb_object_keys(p_patch||jsonb_build_object('room',nextrow.room)) k)) using nextrow,p_class_id into result;
  perform dashboard_private.end_class_lesson_input_scope_v1();
  if (oldrow.name,oldrow.subject,oldrow.grade,oldrow.schedule,oldrow.teacher,oldrow.room,oldrow.schedule_plan)
   is distinct from (nextrow.name,nextrow.subject,nextrow.grade,nextrow.schedule,nextrow.teacher,nextrow.room,nextrow.schedule_plan) then
   update public.timetable_invalidation_signals set change_sequence=change_sequence+1,updated_at=clock_timestamp() where id='operating';
  end if;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('update_class_operational_v1',p_request_key,h,jsonb_build_object('classRow',result,'closeResult',null));
 end if;
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

commit;
