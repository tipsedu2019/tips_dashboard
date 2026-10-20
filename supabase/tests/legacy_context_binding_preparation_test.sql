begin;
select no_plan();
-- Frozen pre-optimization helper provides full-output parity for ordering and binding semantics.
create function pg_temp.original_context(c public.classes,p_catalogs jsonb default null)
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
 with requests as materialized(
  select m.*,to_jsonb(m) request_json from public.makeup_requests m
  where m.class_id=c.id and jsonb_typeof(m.schedule_plan_after->'sessions')='array'
 ), linked as materialized(
  select m.*,v lesson,s slot,ord-1 slot_index,
   public.makeup_numbered_source_instant_v1(s->>'startAt') a,
   public.makeup_numbered_source_instant_v1(s->>'endAt') b
  from requests m cross join lateral jsonb_array_elements(m.schedule_plan_after->'sessions') v
  cross join lateral jsonb_array_elements(public.makeup_numbered_slots_v1(m.request_json)) with ordinality e(s,ord)
  where coalesce(v->>'scheduleState',v->>'state')='makeup'
   and nullif(v->>'id','') is not null
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array' then c.schedule_plan->'sessions' else '[]' end) current_row
    where dashboard_private.legacy_effective_binding_v1(current_row)=dashboard_private.legacy_effective_binding_v1(v))
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_before->'sessions')='array' then m.schedule_plan_before->'sessions' else '[]' end) previous_row
    where dashboard_private.legacy_effective_binding_v1(previous_row)=dashboard_private.legacy_effective_binding_v1(v))
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
-- The runner inserts the frozen original helper above this fragment.
create function pg_temp.cid(n int) returns uuid language sql immutable as $$select ('ac141935-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.cid(1),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','binding-fixture@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.cid(1),'admin','Synthetic binding operator') on conflict(id) do update set role='admin';
delete from public.teacher_catalogs where profile_id=pg_temp.cid(1);
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.cid(2),'Synthetic binding teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.cid(3),'Synthetic binding room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,teacher,room,schedule,schedule_plan)
values(pg_temp.cid(4),'Synthetic binding class','영어','개강 준비','legacy','Synthetic binding teacher','Synthetic binding room','월 06:00-07:00','{"sessions":[]}');
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,approver_teacher_catalog_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.cid(5),'completed','cancel_makeup','영어','english',pg_temp.cid(1),pg_temp.cid(4),'Synthetic binding class',pg_temp.cid(2),pg_temp.cid(2),'2050-10-07','2050-10-06T10:00:00+09','2050-10-06T11:00:00+09','Synthetic binding room','[{"startAt":"2050-10-06T10:00:00+09:00","endAt":"2050-10-06T11:00:00+09:00","classroom":"Synthetic binding room"}]');

create function pg_temp.context_case(label text,current_sessions jsonb,before_sessions jsonb,after_sessions jsonb,expected_sources integer,slots jsonb default null)
returns setof text language plpgsql as $$
declare c public.classes; original jsonb; candidate jsonb;
begin
 update public.classes set schedule_plan=jsonb_build_object('sessions',current_sessions)
 where id=pg_temp.cid(4) and schedule_plan is distinct from jsonb_build_object('sessions',current_sessions) returning * into c;
 if not found then select * into c from public.classes where id=pg_temp.cid(4);end if;
 update public.makeup_requests set schedule_plan_before=jsonb_build_object('sessions',before_sessions),schedule_plan_after=jsonb_build_object('sessions',after_sessions),
 makeup_slots=coalesce(slots,'[{"startAt":"2050-10-06T10:00:00+09:00","endAt":"2050-10-06T11:00:00+09:00","classroom":"Synthetic binding room"}]'::jsonb)
 where id=pg_temp.cid(5);
 original:=pg_temp.original_context(c);candidate:=dashboard_private.legacy_effective_context_v1(c);
 -- Every fixture uses the known Synthetic binding room. Add only its explicit
 -- policy metadata to the expected output; keep the frozen binding oracle intact.
 original:=jsonb_set(original,'{basicSlots}',(
  select coalesce(jsonb_agg(slot||jsonb_build_object('classroomUnresolved',false) order by ord),'[]'::jsonb)
  from jsonb_array_elements(original->'basicSlots') with ordinality e(slot,ord)));
 original:=jsonb_set(original,'{approvedByIdentity}',(
  select coalesce(jsonb_object_agg(key,jsonb_set(value,'{approvedOverride}',
   (value->'approvedOverride')||jsonb_build_object('classroomUnresolved',false))),'{}'::jsonb)
  from jsonb_each(original->'approvedByIdentity')));
 return next is(candidate::text,original::text,label||': exact context text equals original with known-room metadata');
 return next is((select count(*)::integer from jsonb_object_keys(candidate->'approvedByIdentity')),expected_sources,label||': exact source count');
end$$;

create temp table binding_scenarios(label text,current_sessions jsonb,before_sessions jsonb,after_sessions jsonb,expected_sources int,slots jsonb);
insert into binding_scenarios values
('empty arrays','[]','[]','[]',0,null),
('missing current','[]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',0,null),
('current membership','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',1,null),
('before membership excludes source','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',0,null),
('same id different before binding remains new','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[{"id":"a","date":"2050-10-05","scheduleState":"makeup"}]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',1,null),
('numeric binding equality','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","sourceSlotId":1.0}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","sourceSlotId":1}]',1,null),
('numeric before equality excludes','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","sourceSlotId":1}]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","sourceSlotId":1.0}]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","sourceSlotId":1}]',0,null),
('missing and JSON null differ','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","sourceSlotId":null}]',0,null),
('scalar null and unrelated current rows','[42,null,{},"x",{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[42,null,{},"x"]','[42,null,{},"x",{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',1,null),
('duplicate current rows preserve membership','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"},{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',1,null),
('duplicate after source preserved','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"},{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',1,null),
('same source id differing bindings and override order','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-01"},{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-02"}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-01"},{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-02"}]',1,'[{"startAt":"2050-10-06T10:00:00+09:00","endAt":"2050-10-06T11:00:00+09:00","classroom":"Synthetic binding room"},{"startAt":"2050-10-06T12:00:00+09:00","endAt":"2050-10-06T13:00:00+09:00","classroom":"Synthetic binding room"}]'),
('nonarray current and before','{}','42','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',0,null),
('nonarray after ignores request','[]','[]','{}',0,null),
('active after is not a makeup source','[{"id":"a","date":"2050-10-06","scheduleState":"active"}]','[]','[{"id":"a","date":"2050-10-06","scheduleState":"active"}]',0,null),
('malformed unrelated candidate date is not interpreted','[{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]','[]','[{"id":"bad","date":"not-a-date","scheduleState":"makeup"},{"id":"a","date":"2050-10-06","scheduleState":"makeup"}]',1,null);
select t from binding_scenarios c cross join lateral pg_temp.context_case(c.label,c.current_sessions,c.before_sessions,c.after_sessions,c.expected_sources,c.slots)t;

-- Two requests deliberately share a source ID with different retained bindings.
-- The second request's before snapshot must not exclude the first request's source.
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,approver_teacher_catalog_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots,schedule_plan_before,schedule_plan_after)
select pg_temp.cid(6),status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,approver_teacher_catalog_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,
 '[{"startAt":"2050-10-06T14:00:00+09:00","endAt":"2050-10-06T15:00:00+09:00","classroom":"Synthetic binding room"}]',
 '{"sessions":[{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-01"}]}',
 '{"sessions":[{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-02"}]}'
from public.makeup_requests where id=pg_temp.cid(5);
select * from pg_temp.context_case('per-request membership and duplicate source order',
 '[{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-01"},{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-02"}]',
 '[]','[{"id":"a","date":"2050-10-06","scheduleState":"makeup","originalDate":"2050-10-01"}]',1);
select is((select dashboard_private.legacy_effective_context_v1(c)#>>'{approvedByIdentity,a,approvedOverrideVerified}' from public.classes c where id=pg_temp.cid(4)),'false','ambiguous duplicate source remains unverified');

-- Preserve the complete reader, including raw fingerprints and unknown rows,
-- when ambiguous source IDs have different bindings and override times.
create temp table binding_candidate_definition as select pg_get_functiondef('dashboard_private.legacy_effective_context_v1(public.classes,jsonb)'::regprocedure) ddl;
create temp table binding_candidate_reference as select dashboard_private.read_timetable_operating_reference_v1()::text value;
do $$begin execute regexp_replace(pg_get_functiondef('pg_temp.original_context(public.classes,jsonb)'::regprocedure),'FUNCTION pg_temp(_[0-9]+)?[.]original_context','FUNCTION dashboard_private.legacy_effective_context_v1');end$$;
select is((select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='dashboard_private.legacy_effective_context_v1(public.classes,jsonb)'::regprocedure),
 '8e4d903255b3f3c8dc7d729bcc58b5bd6ab711847e2e0b92f0870a37b1b0f7f6','full-reader control executes the exact original helper body');
select is(dashboard_private.read_timetable_operating_reference_v1()::text,(select value from binding_candidate_reference),'full reader text is unchanged for ambiguous duplicate sources');
do $$begin execute (select ddl from binding_candidate_definition);end$$;

select ok(not has_function_privilege('authenticated','dashboard_private.legacy_effective_context_v1(public.classes,jsonb)','execute'),'context remains private to clients');
select ok(not has_function_privilege('service_role','dashboard_private.legacy_effective_context_v1(public.classes,jsonb)','execute'),'context remains private to service role');
select * from finish();
rollback;
