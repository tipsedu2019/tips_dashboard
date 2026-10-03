begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Roll back capability/schema code only. Never reverse saved lesson state or erase
-- durable correction attestations, class audit records, or operation receipts.
create or replace function dashboard_private.assert_timetable_operational_conflicts_v1()
returns void language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday jsonb; newday jsonb;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- A catalog or content write may change metadata while leaving every occupancy
 -- unchanged. This is the same no-new-occupancy outcome as the checks below.
 if oldref->'shadowSlots'=newref->'shadowSlots'
 and oldref->'datedSessions'=newref->'datedSessions'
 and oldref->'unresolvedOccupancies'=newref->'unresolvedOccupancies'
 and oldref->'datedUnresolvedOccupancies'=newref->'datedUnresolvedOccupancies' then return;end if;
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select b-'label' from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
           except select ob-'label' from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob) then
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date) and dashboard_private.timetable_blocker_intersects_v2(x,b)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- A dated-only change cannot alter effective occupancy on any other date.
 -- Compare BOTH sides with multiplicity: removals can expose weekly defaults.
 -- Weekly/as-of changes still require every actual date, including history and
 -- closed/preparing classes. Each selected date uses the COMPLETE reference.
 for d in
 with old_sessions as materialized (select value from jsonb_array_elements(oldref->'datedSessions')),
      new_sessions as materialized (select value from jsonb_array_elements(newref->'datedSessions')),
      changed as (
        (select value from old_sessions except all select value from new_sessions)
        union all
        (select value from new_sessions except all select value from old_sessions)
      )
 select distinct (value->>'date')::date from (
   select value from changed
   where oldref->'shadowSlots'=newref->'shadowSlots' and oldref->'asOfDate'=newref->'asOfDate'
   union all
   select value from old_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
   union all
   select value from new_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
 ) affected loop
 select coalesce(jsonb_agg(v),'[]') into oldday from dashboard_private.timetable_effective_date_v1(oldref,d) v;
 select coalesce(jsonb_agg(v),'[]') into newday from dashboard_private.timetable_effective_date_v1(newref,d) v;
 -- Multiplicity, not mere existence: newly exposed defaults and duplicate keys
 -- must still be checked. Compute each day's counts once against all its rows.
 for x in
 with old_counts as (
   select dashboard_private.timetable_occupancy_key_v1(v) key,count(*) n
   from jsonb_array_elements(oldday) v group by 1
 ), new_counts as (
   select dashboard_private.timetable_occupancy_key_v1(v) key,count(*) n,
          (jsonb_agg(v order by ord))->0 representative,min(ord) first_ordinal
   from jsonb_array_elements(newday) with ordinality entries(v,ord) group by 1
 )
 select representative from new_counts n left join old_counts o using(key)
 where n.n>coalesce(o.n,0) order by first_ordinal loop
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d) and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b)) or exists(select 1 from jsonb_array_elements(newday) b where dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
end $f$;

create or replace function dashboard_private.agent_edit_require_scopes_v2(p_scopes text[],p_command jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare patch jsonb:=coalesce(p_command->'patch','{}');
begin
 if not 'class-details:read'=any(p_scopes)
 or (patch - array['schedule','teacher','room','schedule_plan'] <> '{}'::jsonb and not 'class-info:write'=any(p_scopes))
 or ((p_command?'slots' or patch ?| array['schedule','teacher','room']) and not 'weekly-plan:write'=any(p_scopes))
 or ((p_command?'sessions' or patch?'schedule_plan') and not 'lesson-plan:write'=any(p_scopes)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
end$$;

create or replace function dashboard_private.agent_apply_edit_v2(p_class_id uuid,p_command jsonb,p_key uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.classes; patch jsonb:=coalesce(p_command->'patch','{}'); s jsonb; d date; actor uuid; teacher text; room text; sid uuid; source_id uuid; parent_id uuid; existing public.class_lesson_sessions; subject text; r jsonb;
begin
 actor:=dashboard_private.assert_continuous_class_schedule_actor_v1(false);
 perform dashboard_private.lock_timetable_operating_resources_v1();
 select * into c from public.classes where id=p_class_id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if c.status<>'수강' or c.closed_at is not null then raise exception using errcode='42501',message='agent_class_not_active';end if;
 if jsonb_typeof(patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(patch) k where k not in('name','class_type','subject','subject_area_key','grade','capacity','fee','schedule','teacher','room','schedule_plan'))
 or nullif(btrim(p_command->>'reason'),'') is null or length(p_command->>'reason')>300 then raise exception using errcode='22023',message='agent_invalid';end if;
 for d in select value::date from jsonb_array_elements_text(coalesce(p_command->'changedDates','[]')) loop
 if d<(clock_timestamp() at time zone 'Asia/Seoul')::date or d<(p_command#>>'{window,from}')::date or d>(p_command#>>'{window,to}')::date then raise exception using errcode='22023',message='agent_past_change';end if;
 end loop;
 if p_command?'sessions' or patch?'schedule_plan' or p_command?'slots' or patch?'schedule' then
 -- Pending requests can change later. Completed records own their linked dates.
 if exists(select 1 from public.makeup_requests m where m.class_id=c.id and (
 m.status in('approval_pending','revision_requested','manager_pending') or (m.status='completed' and (
 m.cancel_date between (p_command#>>'{window,from}')::date and (p_command#>>'{window,to}')::date
 or (m.makeup_start_at at time zone 'Asia/Seoul')::date between (p_command#>>'{window,from}')::date and (p_command#>>'{window,to}')::date
 or exists(select 1 from jsonb_array_elements(m.makeup_slots) x where (coalesce(x->>'startAt',x->>'start_at')::timestamptz at time zone 'Asia/Seoul')::date between (p_command#>>'{window,from}')::date and (p_command#>>'{window,to}')::date))
 ))) then raise exception using errcode='P0001',message='agent_approval_workflow_required';end if;
 end if;
 subject:=coalesce(patch->>'subject',c.subject);
 if c.schedule_storage_mode='normalized' and (p_command?'slots' or p_command?'sessions') then
 c:=dashboard_private.require_continuous_class_schedule_mutation_v1(c.id,true,true,false,null);
 c.subject:=subject;
 perform dashboard_private.with_continuous_class_schedule_audit_context_v1(c.id,p_key,'agent_apply_edit_v2',p_command->>'reason');
 if p_command?'slots' then
 -- The API may edit existing slots, never silently delete or create a template.
 if (select count(*) from public.class_schedule_slots where class_id=c.id) <> jsonb_array_length(p_command->'slots')
 or exists(select 1 from jsonb_array_elements(p_command->'slots') x where not exists(select 1 from public.class_schedule_slots t where t.class_id=c.id and t.id=(x->>'id')::uuid)) then raise exception using errcode='22023',message='agent_invalid';end if;
 perform dashboard_private.save_continuous_schedule_defaults_rows_v1(c,p_command->'slots');
 end if;
 for s in select value from jsonb_array_elements(coalesce(p_command->'sessions','[]')) loop
 sid:=(s->>'id')::uuid;source_id:=(s->>'sourceSlotId')::uuid;parent_id:=(s->>'makeupOf')::uuid;d:=(s->>'date')::date;
 if d<(clock_timestamp() at time zone 'Asia/Seoul')::date or not coalesce(p_command->'changedDates','[]') ? d::text
 or s->>'state' not in('active','skipped','tbd','makeup') or (s->>'startTime')::time >= (s->>'endTime')::time
 or s->>'startTime' is null or s->>'endTime' is null or s->>'teacherCatalogId' is null or s->>'classroomCatalogId' is null then raise exception using errcode='22023',message='agent_invalid';end if;
 teacher:=dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher',(s->>'teacherCatalogId')::uuid,subject);
 room:=dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom',(s->>'classroomCatalogId')::uuid,subject);
 if source_id is not null and not exists(select 1 from public.class_schedule_slots x where x.id=source_id and x.class_id=c.id) then raise exception using errcode='22023',message='agent_invalid';end if;
 if parent_id is not null and not exists(select 1 from public.class_lesson_sessions x where x.id=parent_id and x.class_id=c.id and (x.schedule_state='skipped' or s->>'state'='skipped')) then raise exception using errcode='22023',message='agent_invalid';end if;
 select * into existing from public.class_lesson_sessions where id=sid for update;
 if found then
 if existing.class_id<>c.id or existing.session_date<(clock_timestamp() at time zone 'Asia/Seoul')::date or existing.makeup_of_session_id is distinct from parent_id or existing.source_schedule_slot_id is distinct from source_id then raise exception using errcode='22023',message='agent_invalid';end if;
 update public.class_lesson_sessions set session_date=d,schedule_state=s->>'state',start_time=(s->>'startTime')::time,end_time=(s->>'endTime')::time,teacher_catalog_id=(s->>'teacherCatalogId')::uuid,teacher_name_snapshot=teacher,classroom_catalog_id=(s->>'classroomCatalogId')::uuid,classroom_name_snapshot=room,revision=revision+1,updated_by=actor where id=sid;
 else
 insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin,makeup_of_session_id,created_by,updated_by)
 values(sid,c.id,'agent:'||sid::text,source_id,d,s->>'state',(s->>'startTime')::time,(s->>'endTime')::time,(s->>'teacherCatalogId')::uuid,teacher,(s->>'classroomCatalogId')::uuid,room,'manual',parent_id,actor,actor);
 end if;
 end loop;
 if p_command?'sessions' then perform dashboard_private.project_continuous_class_schedule_plan_v1(c.id);end if;
 elsif p_command?'slots' or p_command?'sessions' then raise exception using errcode='22023',message='agent_invalid';
 end if;

 -- Legacy parsing validates occupancy identity, not active catalog eligibility.
 -- Re-resolve edited resources at execution as normalized writers already do.
 if c.schedule_storage_mode<>'normalized' then
 if patch?'schedule_plan' then
 for s in select value from jsonb_array_elements(patch#>'{schedule_plan,sessions}') x where coalesce(p_command->'changedDates','[]') ? (x->>'date') and coalesce(x->>'scheduleState',x->>'state','active') in('active','makeup') loop
 if s->>'teacherCatalogId' is not null then perform dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher',(s->>'teacherCatalogId')::uuid,subject);end if;
 if s->>'classroomCatalogId' is not null then perform dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom',(s->>'classroomCatalogId')::uuid,subject);end if;
 end loop;
 end if;
 end if;
 if patch<>'{}'::jsonb then perform public.update_class_operational_v1(c.id,patch,p_key,case when patch?'schedule_plan' then coalesce(c.schedule_plan,'{}') else null end);end if;
 if c.schedule_storage_mode<>'normalized' and patch?'schedule' then
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 for s in select value from jsonb_array_elements(r->'shadowSlots') x where x->>'classId'=c.id::text loop
 perform dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher',(s->>'teacherId')::uuid,subject);
 perform dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom',(s->>'classroomId')::uuid,subject);
 end loop;end if;
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
end$$;

create or replace function public.agent_api_v2(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.agent_credentials; preview dashboard_private.agent_edit_previews; op dashboard_private.agent_edit_operations;
 cid uuid; key uuid; token uuid; context jsonb; after_state jsonb; result jsonb; command jsonb; page int; err text; statecode text;
 claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true); jwtrole text:=current_setting('request.jwt.claim.role',true);
begin
 select * into cred from dashboard_private.agent_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='agent_unauthorized';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=cred.created_by and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='agent_forbidden';end if;
 if cred.rate_window is null or cred.rate_window<date_trunc('minute',clock_timestamp()) then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then return jsonb_build_object('error',jsonb_build_object('code','agent_rate_limited'));end if;
 update dashboard_private.agent_credentials set last_used_at=clock_timestamp(),rate_window=date_trunc('minute',clock_timestamp()),rate_count=cred.rate_count+1 where id=cred.id;
 if not 'class-details:read'=any(cred.scopes) or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cred.created_by,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',cred.created_by::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 if p_action='health' then
 result:=jsonb_build_object('apiVersion','2','credentialId',cred.id,'executor',cred.label,'scopes',cred.scopes,'classIds',cred.class_ids,'classAccess',jsonb_build_object('mode',case when cred.all_classes then 'all' when cardinality(cred.class_ids)=0 then 'legacy_all_read' else 'selected' end,'includesFutureClasses',cred.all_classes),'expiresAt',cred.expires_at,'timezone','Asia/Seoul');
 elsif p_action in('context','preview') then
 cid:=(p_input->>'classId')::uuid;
 if not (cred.all_classes or cid=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if p_action='preview' then perform dashboard_private.lock_timetable_operating_resources_v1();perform 1 from public.classes where id=cid for update;end if;
 context:=dashboard_private.agent_edit_context_v2(cid);
 if p_action='context' then result:=context;
 else
 command:=p_input->'command';
 perform dashboard_private.agent_edit_require_scopes_v2(cred.scopes,command);
 if p_input->>'expectedVersion' is distinct from context->>'version' then raise exception using errcode='P0001',message='agent_stale';end if;
 begin
 perform dashboard_private.agent_apply_edit_v2(cid,command,gen_random_uuid());
 after_state:=dashboard_private.agent_edit_context_v2(cid);
 raise exception using errcode='ZA001',message='agent_preview_rollback';
 exception when sqlstate 'ZA001' then null;
 end;
 insert into dashboard_private.agent_edit_previews(credential_id,class_id,base_version,command,before_state,after_state) values(cred.id,cid,context->>'version',command,context,after_state) returning * into preview;
 result:=jsonb_build_object('previewToken',preview.id,'expiresAt',preview.expires_at,'beforeContext',context,'afterContext',after_state,'window',command->'window','notifications',jsonb_build_object('state','not_requested'));
 end if;
 elsif p_action='commit' then
 key:=(p_input->>'requestKey')::uuid;token:=(p_input->>'previewToken')::uuid;
 if key is null or token is null or length(coalesce(p_input->>'sourceReference',''))>500 then raise exception using errcode='22023',message='agent_invalid';end if;
 select * into op from dashboard_private.agent_edit_operations where credential_id=cred.id and request_key=key;
 if found then
 if op.preview_id<>token or op.source_reference is distinct from nullif(p_input->>'sourceReference','') then raise exception using errcode='22023',message='agent_idempotency_key_reused';end if;
 result:=op.result||jsonb_build_object('replayed',true);
 else
 select * into preview from dashboard_private.agent_edit_previews where id=token and credential_id=cred.id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if not (cred.all_classes or preview.class_id=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 perform dashboard_private.agent_edit_require_scopes_v2(cred.scopes,preview.command);
 if exists(select 1 from dashboard_private.agent_edit_operations where preview_id=token) then raise exception using errcode='22023',message='agent_preview_consumed';end if;
 begin
 if preview.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='agent_preview_expired';end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();perform 1 from public.classes where id=preview.class_id for update;
 context:=dashboard_private.agent_edit_context_v2(preview.class_id);
 if context->>'version' is distinct from preview.base_version then raise exception using errcode='P0001',message='agent_stale';end if;
 perform dashboard_private.agent_apply_edit_v2(preview.class_id,preview.command,gen_random_uuid());
 after_state:=dashboard_private.agent_edit_context_v2(preview.class_id);
 result:=jsonb_build_object('operationId',key,'state','applied','classContext',after_state,'window',preview.command->'window','appliedAt',clock_timestamp(),'executor',cred.label,'actorProfileId',cred.created_by,'sourceReference',nullif(p_input->>'sourceReference',''),'requesterVerified',false);
 exception when others then
 get stacked diagnostics err=message_text,statecode=returned_sqlstate;
 result:=jsonb_build_object('operationId',key,'state','failed','error',jsonb_build_object('code',case when statecode='23P01' then 'timetable_resource_conflict' when err='class_schedule_catalog_invalid' then 'agent_invalid_catalog' when err in('agent_stale','agent_preview_expired','agent_not_found','agent_approval_workflow_required','agent_class_not_active','agent_past_change','class_schedule_stale','continuous_class_schedule_runtime_not_ready') then err else 'agent_write_failed' end,'sqlstate',statecode));
 end;
 result:=result||jsonb_build_object('notifications',jsonb_build_object('state','not_requested'),'externalSync',jsonb_build_object('state','not_requested'),'reply',jsonb_build_object('state','not_requested'));
 insert into dashboard_private.agent_edit_operations(credential_id,request_key,preview_id,class_id,source_reference,state,result) values(cred.id,key,token,preview.class_id,nullif(p_input->>'sourceReference',''),result->>'state',result);
 end if;
 elsif p_action='operation' then
 select * into op from dashboard_private.agent_edit_operations where credential_id=cred.id and request_key=(p_input->>'requestKey')::uuid;
 result:=case when found then op.result else jsonb_build_object('operationId',p_input->>'requestKey','state','unknown','retryWithNewKey',false) end;
 elsif p_action='operations' then
 page:=coalesce((p_input->>'page')::int,1);
 if page<1 or page>10000 then raise exception using errcode='22023',message='agent_invalid';end if;
 select jsonb_build_object('page',page,'pageSize',20,'total',(select count(*) from dashboard_private.agent_edit_operations where credential_id=cred.id),'items',coalesce(jsonb_agg(jsonb_build_object('operationId',request_key,'classId',class_id,'state',state,'createdAt',created_at,'sourceReference',source_reference) order by created_at desc,request_key),'[]')) into result from (select * from dashboard_private.agent_edit_operations where credential_id=cred.id order by created_at desc,request_key limit 20 offset (page-1)*20) x;
 else raise exception using errcode='22023',message='agent_invalid';
 end if;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);perform set_config('request.jwt.claim.role',coalesce(jwtrole,''),true);
 return jsonb_build_object('data',result);
end$$;

drop function public.preview_past_lesson_state_correction_v1(uuid,jsonb,text,date,text,text,text,text,boolean);
drop function public.save_past_lesson_state_correction_v1(uuid,jsonb,text,date,text,text,text,uuid,text,boolean);
drop function dashboard_private.apply_past_lesson_state_correction_v1(uuid,jsonb,uuid);
drop function dashboard_private.past_lesson_state_correction_allows_blocker_v1(jsonb,jsonb,jsonb);
drop function dashboard_private.prepare_past_lesson_state_correction_v1(uuid,jsonb);
drop table dashboard_private.past_lesson_state_correction_contexts;
-- Retain private past_lesson_state_correction_attestations as immutable history.
revoke all on dashboard_private.past_lesson_state_correction_attestations from public,anon,authenticated,service_role;
revoke all on function public.agent_api_v2(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_api_v2(text,text,jsonb) to service_role;
revoke all on function dashboard_private.agent_edit_require_scopes_v2(text[],jsonb),dashboard_private.agent_apply_edit_v2(uuid,jsonb,uuid),dashboard_private.assert_timetable_operational_conflicts_v1() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
