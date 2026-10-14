begin;
set local lock_timeout='5s';
set local statement_timeout='8s';

-- Prepare current and request-before binding membership once within each fresh
-- context. Keep candidate multiplicity, numbered-slot expansion, time parsing,
-- approval/calendar verification and duplicate-source handling unchanged.
create or replace function dashboard_private.legacy_effective_context_v1(c public.classes,p_catalogs jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text;
begin
 if catalogs is null then
  select jsonb_build_object('teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.teacher_catalogs),
   'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.classroom_catalogs)) into catalogs;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(s->>'sourceSlotId',s->>'id'),'weekday',s->'weekday',
  'startTime',case when s->>'startMinute' is not null then lpad(((s->>'startMinute')::int/60)::text,2,'0')||':'||lpad(((s->>'startMinute')::int%60)::text,2,'0') end,
  'endTime',case when s->>'endMinute' is not null then lpad(((s->>'endMinute')::int/60)::text,2,'0')||':'||lpad(((s->>'endMinute')::int%60)::text,2,'0') end,
  'teacherCatalogId',s->'teacherId','classroomCatalogId',s->'classroomId')),'[]') into slots
 from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) s;
 -- Only after-snapshot makeup identities still present in this class can bind.
 -- Multiple matching requests/slots are retained as an unverified source.
 for candidate in
 with current_bindings as materialized(
  -- Binding is a non-null, non-throwing JSONB projection. Preserve JSONB
  -- equality, including numeric equality, missing keys and explicit JSON null.
  -- This CTE is local to this fresh context; no earlier read is reused.
  select coalesce(array_agg(dashboard_private.legacy_effective_binding_v1(current_row)),'{}'::jsonb[]) bindings
  from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array' then c.schedule_plan->'sessions' else '[]' end) current_row
 ), requests as materialized(
  select m.*,to_jsonb(m) request_json,
   -- Avoid preparing old history when no after-row can bind to this class.
   case when exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_after->'sessions')='array' then m.schedule_plan_after->'sessions' else '[]' end) after_row
    where coalesce(after_row->>'scheduleState',after_row->>'state')='makeup'
     and nullif(after_row->>'id','') is not null
     and dashboard_private.legacy_effective_binding_v1(after_row)=any((select bindings from current_bindings)::jsonb[])
   ) then array(select dashboard_private.legacy_effective_binding_v1(previous_row)
    from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_before->'sessions')='array' then m.schedule_plan_before->'sessions' else '[]' end) previous_row)
   else '{}'::jsonb[] end prior_bindings
  from public.makeup_requests m
  where m.class_id=c.id and jsonb_typeof(m.schedule_plan_after->'sessions')='array'
 ), linked as materialized(
  select m.*,v lesson,s slot,ord-1 slot_index,
   public.makeup_numbered_source_instant_v1(s->>'startAt') a,
   public.makeup_numbered_source_instant_v1(s->>'endAt') b
  from requests m cross join lateral jsonb_array_elements(m.schedule_plan_after->'sessions') v
  cross join lateral jsonb_array_elements(public.makeup_numbered_slots_v1(m.request_json)) with ordinality e(s,ord)
  where coalesce(v->>'scheduleState',v->>'state')='makeup'
   and nullif(v->>'id','') is not null
   and dashboard_private.legacy_effective_binding_v1(v)=any((select bindings from current_bindings)::jsonb[])
   and not (dashboard_private.legacy_effective_binding_v1(v)=any(m.prior_bindings))
 ), dated as materialized(
  select * from linked where lesson->>'date'=to_char(a at time zone 'Asia/Seoul','YYYY-MM-DD')
   and (lesson->>'makeupRequestId' is distinct from id::text or lesson->>'id'='makeup-request:'||id::text||':'||slot_index::text)
 )
 select d.*,tc.id verified_teacher_id,
  (select min(id::text) from public.classroom_catalogs where name=d.slot->>'classroom' having count(*)=1) room_id,
  (select e.payload from public.makeup_request_events e where e.request_id=d.id and e.event_type='approved' order by e.created_at desc,e.id desc limit 1) approval_payload,
  exists(select 1 from public.academic_events a cross join lateral (select dashboard_private.makeup_approval_event_meta_v1(a.note) meta) parsed
   where (a.id=d.makeup_academic_event_id or d.makeup_academic_event_ids ? a.id::text)
    and a.date::text=d.lesson->>'date' and meta->>'requestId'=d.id::text and meta->>'kind'='makeup'
    and meta->>'slotIndex'=d.slot_index::text and meta->>'classroom'=d.slot->>'classroom'
    and public.makeup_numbered_source_instant_v1(meta->>'startAt')=d.a
    and public.makeup_numbered_source_instant_v1(meta->>'endAt')=d.b) calendar_matches
 from dated d left join public.teacher_catalogs tc on tc.id=d.teacher_catalog_id
 loop
  source_id:=candidate.lesson->>'id';
  source:=jsonb_build_object('binding',dashboard_private.legacy_effective_binding_v1(candidate.lesson),
   'approvedOverride',jsonb_build_object('startTime',to_char(candidate.a at time zone 'Asia/Seoul','HH24:MI'),
    'endTime',case when (candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time then '24:00' else to_char(candidate.b at time zone 'Asia/Seoul','HH24:MI') end,'teacherCatalogId',candidate.teacher_catalog_id,'classroomCatalogId',candidate.room_id),
   'approvedOverrideVerified',coalesce(candidate.status in('completed','makeup_pending') and candidate.approved_at is not null
    and candidate.a<candidate.b and ((candidate.a at time zone 'Asia/Seoul')::date=(candidate.b at time zone 'Asia/Seoul')::date or ((candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time))
    and extract(second from candidate.a)=0 and extract(second from candidate.b)=0 and candidate.calendar_matches
    and candidate.approval_payload->>'makeup_request_id'=candidate.id::text
    and candidate.verified_teacher_id=candidate.teacher_catalog_id
    and nullif(btrim(candidate.approval_payload->>'teacher_name'),'') is not null
    and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(candidate.approval_payload->'makeup_schedule')='array' then candidate.approval_payload->'makeup_schedule' else '[]' end) p
     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b),false));
  if sources ? source_id then source:=jsonb_set(source,'{approvedOverrideVerified}','false');end if;
  sources:=sources||jsonb_build_object(source_id,source);
 end loop;
 return jsonb_build_object('version',1,'classId',c.id,'basicSlots',slots,'catalogs',catalogs,'approvedByIdentity',sources,'weekly',defaults);
end $f$;

-- CREATE OR REPLACE preserves the existing owner and EXECUTE ACL.
commit;
