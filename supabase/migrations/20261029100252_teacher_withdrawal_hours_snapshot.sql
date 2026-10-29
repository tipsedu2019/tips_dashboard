begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Extend only the owner-request input/readback boundary. The existing writer,
-- owner/effect/revision checks, transaction marker and request receipt remain
-- authoritative. Existing rows and management calculations are not rewritten.
-- Deploy the compatible optional-field client before applying this migration;
-- older open clients must reload before reading the extended own-request DTO.
do $teacher_withdrawal_hours$
declare
 target regprocedure;
 definition text;
 before_contract jsonb;
 after_contract jsonb;
 anchors text[];
 replacements text[];
 n integer;
begin
 target:='dashboard_private.teacher_request_ops_input_v1(text,jsonb,uuid)'::regprocedure;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig)
 into before_contract from pg_catalog.pg_proc where oid=target;
 definition:=pg_catalog.pg_get_functiondef(target);
 anchors:=array[
 $a$declare keys text[];ids text[];dates text[];k text;s public.students%rowtype;c public.classes%rowtype;dest public.classes%rowtype;
 old_task public.ops_tasks%rowtype;old_detail public.ops_transfer_details%rowtype;task_input jsonb;detail jsonb;$a$,
 $a$ if jsonb_typeof(p) is distinct from 'object' or not(p ?& keys) or p-keys<>'{}' then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;$a$,
 $a$  detail:=(dashboard_private.teacher_request_json_pick_v1(p,keys)-array['student_id','memo','class_id'])||jsonb_build_object('school_grade',s.grade,'teacher_name',c.teacher);$a$
 ];
 replacements:=array[
 $r$declare keys text[];ids text[];dates text[];k text;s public.students%rowtype;c public.classes%rowtype;dest public.classes%rowtype;
 old_task public.ops_tasks%rowtype;old_detail public.ops_transfer_details%rowtype;task_input jsonb;detail jsonb;
 allowed_keys text[];hour_keys text[]:=array['completed_lesson_hours','four_week_lesson_hours'];
 old_withdrawal public.ops_withdrawal_details%rowtype;$r$,
 $r$ allowed_keys:=keys||case when d='withdrawal' then hour_keys else array[]::text[] end;
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& keys) or p-allowed_keys<>'{}' then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if d='withdrawal' and p ?| hour_keys then
  if not(p ?& hour_keys) then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  foreach k in array hour_keys loop
   -- Empty means not calculated. Zero is an actual snapshot, never NULL.
   -- The plain-decimal bound matches the existing numeric(8,2) storage.
   if jsonb_typeof(p->k) is distinct from 'string'
     or (p->>k<>'' and (p->>k)!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$') then
    raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
  end loop;
 end if;$r$,
 $r$  detail:=(dashboard_private.teacher_request_json_pick_v1(p,keys)-array['student_id','memo','class_id'])||jsonb_build_object('school_grade',s.grade,'teacher_name',c.teacher);
  if p ?& hour_keys then
   detail:=detail||dashboard_private.teacher_request_json_pick_v1(p,hour_keys);
  elsif p_existing_id is not null then
   -- The outer owner mutation already locks this detail. An old eight-key
   -- client may keep an unchanged snapshot on a note edit, but cannot carry it
   -- onto a different selected date/session without a new calculation.
   select * into old_withdrawal from public.ops_withdrawal_details where task_id=p_existing_id;
   if (p->>'withdrawal_date')::date is distinct from old_withdrawal.withdrawal_date
     or nullif(p->>'withdrawal_session','') is distinct from nullif(old_withdrawal.withdrawal_session,'') then
    detail:=detail||jsonb_build_object('completed_lesson_hours',null,'four_week_lesson_hours',null);
   end if;
  end if;$r$
 ];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_hours_input_version_mismatch' using errcode='55000';end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig)
 into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_hours_input_contract_changed' using errcode='55000';end if;

 target:='dashboard_private.teacher_request_state_v1(text,uuid)'::regprocedure;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig)
 into before_contract from pg_catalog.pg_proc where oid=target;
 definition:=pg_catalog.pg_get_functiondef(target);
 anchors:=array[
 $a$representable boolean:=true;$a$,
 $a$  elsif d='withdrawal' then
   input:=dashboard_private.teacher_request_json_pick_v1(coalesce(detail,'{}'),array['withdrawal_date','withdrawal_session','customer_reason','teacher_opinion','undistributed_textbooks'])$a$,
 $a$    'teacher_opinion',coalesce(input->>'teacher_opinion',''),'undistributed_textbooks',coalesce(input->>'undistributed_textbooks',''));
  elsif d='makeup' then$a$];
 replacements:=array[
 $r$representable boolean:=true;hours_snapshot boolean:=false;$r$,
 $r$  elsif d='withdrawal' then
   hours_snapshot:=input ?| array['completed_lesson_hours','four_week_lesson_hours'];
   input:=dashboard_private.teacher_request_json_pick_v1(coalesce(detail,'{}'),array['withdrawal_date','withdrawal_session','customer_reason','teacher_opinion','undistributed_textbooks'])$r$,
 $r$    'teacher_opinion',coalesce(input->>'teacher_opinion',''),'undistributed_textbooks',coalesce(input->>'undistributed_textbooks',''));
   -- Only the owner detail gets this pair. Common teacher lists/details keep
   -- their existing redaction. After effects, preserve the original immutable
   -- teacher snapshot exactly as this function did before this extension.
   -- Unrepresentable historical management values are not silently corrected
   -- or allowed to make the strict own-request DTO unreadable.
   if (hours_snapshot or detail->>'completed_lesson_hours' is not null or detail->>'four_week_lesson_hours' is not null)
     and not exists(select 1 from unnest(array['completed_lesson_hours','four_week_lesson_hours']) k
     where detail->>k is not null and (detail->>k)!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$') then
    input:=input||jsonb_build_object('completed_lesson_hours',coalesce(detail->>'completed_lesson_hours',''),
      'four_week_lesson_hours',coalesce(detail->>'four_week_lesson_hours',''));
   end if;
  elsif d='makeup' then$r$];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_hours_state_version_mismatch' using errcode='55000';end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig)
 into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_hours_state_contract_changed' using errcode='55000';end if;
end;
$teacher_withdrawal_hours$;

-- Preserve the duration/cycle metadata used by the existing management form
-- in the already-authorized class schedule projection. Personal text stays
-- excluded. Unsupported duration values are never coerced into a confirmed
-- numeric snapshot: the client treats the safe availability flag as unknown.
do $teacher_withdrawal_schedule$
declare
 target regprocedure:='dashboard_private.teacher_common_schedule_plan_v1(jsonb)'::regprocedure;
 definition text;
 before_contract jsonb;
 after_contract jsonb;
 anchors text[];
 replacements text[];
 n integer;
begin
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig)
 into before_contract from pg_catalog.pg_proc where oid=target;
 definition:=pg_catalog.pg_get_functiondef(target);
 anchors:=array[
 $a$declare result jsonb;map_key text;map_value jsonb;$a$,
 $a$array['version','selectedDays','startTime'$a$,
 $a$where key=any(array['id','sessionKey','sessionNumber','date','day','label','billingId','billingLabel','billingColor','startTime','endTime','teacherName','classroomName','teacherCatalogId','classroomCatalogId','classroomUnresolved','state','scheduleState','originalDate','originalSessionId','makeupRequestId','makeupRequestRole','isForced','makeupDate','sourceSlotId','approvedOverrideVerified'])$a$,
 $a$case when jsonb_typeof(p->'sessions')='array' then p->'sessions' else '[]'::jsonb end$a$,
 $a$array['id','label','color','startDate','endDate','totalSessions']$a$,
 $a$case when jsonb_typeof(p->'billingPeriods')='array' then p->'billingPeriods' else '[]'::jsonb end$a$,
 $a$ return result;$a$
 ];
 replacements:=array[
 $r$declare result jsonb;map_key text;map_value jsonb;
 hour_keys text[]:=array['lessonHours','lesson_hours','durationHours','duration_hours','sessionHours','session_hours','hours',
  'lessonMinutes','lesson_minutes','durationMinutes','duration_minutes','minutes'];$r$,
 $r$array['version','selectedDays','selected_days','startTime'$r$,
 $r$where key=any(array['id','sessionKey','sessionNumber','date','day','label','billingId','billingLabel','billingColor','startTime','endTime','teacherName','classroomName','teacherCatalogId','classroomCatalogId','classroomUnresolved','state','scheduleState','originalDate','originalSessionId','makeupRequestId','makeupRequestRole','isForced','makeupDate','sourceSlotId','approvedOverrideVerified',
 'sessionId','session_id','session_key','session_date','dateValue','date_value','schedule_state','session_number','start_time','end_time',
 'billing_id','periodId','period_id','legacyBillingId','legacy_billing_id','billing_label','periodLabel','period_label','legacyBillingLabel','legacy_billing_label'])
 or (key=any(hour_keys) and (value in('null'::jsonb,'""'::jsonb)
  or (jsonb_typeof(value) in('number','string') and (value#>>'{}')~'^(0|[1-9][0-9]*)(\.[0-9]+)?$')))$r$,
 $r$case when jsonb_typeof(p->'sessions')='array' then p->'sessions'
  when jsonb_typeof(p->'session_list')='array' then p->'session_list' else '[]'::jsonb end$r$,
 $r$array['id','label','color','startDate','endDate','totalSessions','billingId','billing_id','periodId','period_id',
 'billingLabel','billing_label','periodLabel','period_label','start_date','end_date']$r$,
 $r$case when jsonb_typeof(p->'billingPeriods')='array' then p->'billingPeriods'
  when jsonb_typeof(p->'billing_periods')='array' then p->'billing_periods' else '[]'::jsonb end$r$,
 $r$ if exists(
  select 1 from jsonb_array_elements(case when jsonb_typeof(p->'sessions')='array' then p->'sessions'
   when jsonb_typeof(p->'session_list')='array' then p->'session_list' else '[]'::jsonb end) a(session)
  cross join lateral jsonb_each(case when jsonb_typeof(session)='object' then session else '{}'::jsonb end) duration
  where duration.key=any(hour_keys) and not(duration.value in('null'::jsonb,'""'::jsonb)
   or (jsonb_typeof(duration.value) in('number','string') and (duration.value#>>'{}')~'^(0|[1-9][0-9]*)(\.[0-9]+)?$'))
 ) then result:=result||jsonb_build_object('withdrawalHoursUnavailable',true);end if;
 return result;$r$
 ];
 for n in 1..array_length(anchors,1) loop
  if length(definition)-length(replace(definition,anchors[n],''))<>length(anchors[n]) then
   raise exception 'teacher_withdrawal_hours_schedule_version_mismatch' using errcode='55000';end if;
  definition:=replace(definition,anchors[n],replacements[n]);
 end loop;
 execute definition;
 select jsonb_build_array(proowner,proacl,provolatile,prosecdef,proconfig)
 into after_contract from pg_catalog.pg_proc where oid=target;
 if before_contract is distinct from after_contract then
  raise exception 'teacher_withdrawal_hours_schedule_contract_changed' using errcode='55000';end if;
end;
$teacher_withdrawal_schedule$;

commit;
