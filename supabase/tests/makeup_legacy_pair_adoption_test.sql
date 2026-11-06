-- All accounts, IDs, rooms, dates, plans and events below are synthetic.
-- Run through the complete ordered migration chain in the isolated database.
begin;
select no_plan();
create function pg_temp.sid(n int) returns uuid language sql immutable as $$
 select ('af061106-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.plan() returns jsonb language sql immutable as $f$ select $j${"subject":"영어","className":"Synthetic legacy adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done"}]}$j$::jsonb $f$;
create function pg_temp.request() returns jsonb language sql immutable as $f$ select $j${"id":"af061106-0000-4000-8000-000000000003","class_id":"af061106-0000-4000-8000-000000000004","class_name":"Synthetic legacy adoption","subject":"영어","status":"approval_pending","request_kind":"cancel_makeup","cancel_date":"2050-10-20","teacher_catalog_id":"af061106-0000-4000-8000-000000000001","makeup_start_at":"2050-10-06T09:00:00Z","makeup_end_at":"2050-10-06T11:00:00Z","makeup_classroom":"Synthetic requested room","makeup_slots":[{"startAt":"2050-10-06T18:00:00+09:00","endAt":"2050-10-06T20:00:00+09:00","classroom":"Synthetic requested room"}],"updated_at":"2050-10-01T00:00:00.123456+00:00"}$j$::jsonb $f$;
create function pg_temp.teacher() returns jsonb language sql immutable as $f$ select $j${"id":"af061106-0000-4000-8000-000000000001","name":"Synthetic requested teacher"}$j$::jsonb $f$;
create function pg_temp.room() returns jsonb language sql immutable as $f$ select $j${"id":"af061106-0000-4000-8000-000000000002","name":"Synthetic requested room"}$j$::jsonb $f$;
-- Independent expected delta: do not use the product adoption helper as oracle.
create function pg_temp.expected(p_request jsonb) returns jsonb language sql immutable as $f$
 select jsonb_set(jsonb_set(pg_temp.plan(),'{sessions,0}',
  pg_temp.plan()#>'{sessions,0}'||jsonb_build_object('makeupRequestId',p_request->>'id','makeupRequestRole','cancel')),
  '{sessions,1}',pg_temp.plan()#>'{sessions,1}'||jsonb_build_object(
   'makeupRequestId',p_request->>'id','makeupRequestRole','makeup',
   'makeupAdoption',jsonb_build_object('version',1,'requestUpdatedAt',p_request->>'updated_at','originalId','legacy-original-alpha','makeupId','legacy-makeup-alpha'),
   'startTime','18:00','endTime','20:00','teacherCatalogId',pg_temp.sid(1),'teacherName','Synthetic requested teacher',
   'classroomCatalogId',pg_temp.sid(2),'classroomName','Synthetic requested room'))
$f$;
-- BEGIN ACTUAL ADOPTION PRODUCER
create function pg_temp.producer_fixture() returns jsonb language sql immutable as $fn$ select $json${"plan":{"subject":"영어","className":"Synthetic legacy adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done"}]},"request":{"id":"af061106-0000-4000-8000-000000000003","class_id":"af061106-0000-4000-8000-000000000004","class_name":"Synthetic legacy adoption","subject":"영어","status":"approval_pending","request_kind":"cancel_makeup","cancel_date":"2050-10-20","teacher_catalog_id":"af061106-0000-4000-8000-000000000001","makeup_start_at":"2050-10-06T09:00:00Z","makeup_end_at":"2050-10-06T11:00:00Z","makeup_classroom":"Synthetic requested room","makeup_slots":[{"startAt":"2050-10-06T18:00:00+09:00","endAt":"2050-10-06T20:00:00+09:00","classroom":"Synthetic requested room"}],"updated_at":"2050-10-01T00:00:00.123456+00:00"},"teacher":{"id":"af061106-0000-4000-8000-000000000001","name":"Synthetic requested teacher"},"room":{"id":"af061106-0000-4000-8000-000000000002","name":"Synthetic requested room"},"binding":{"version":1,"mode":"reuse","requestId":"af061106-0000-4000-8000-000000000003","classId":"af061106-0000-4000-8000-000000000004","requestUpdatedAt":"2050-10-01T00:00:00.123456+00:00","cancelDate":"2050-10-20","originalId":"legacy-original-alpha","makeupId":"legacy-makeup-alpha","startAt":"2050-10-06T09:00:00.000Z","endAt":"2050-10-06T11:00:00.000Z","classroom":"Synthetic requested room","occupancy":{"id":"legacy-session:af061106-0000-4000-8000-000000000004:legacy-makeup-alpha","classId":"af061106-0000-4000-8000-000000000004","className":"Synthetic legacy adoption","date":"2050-10-06","startMinute":1170,"endMinute":1290,"classroom":"Synthetic requested room","uncertain":false,"allRooms":false}},"after":{"subject":"영어","className":"Synthetic legacy adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done","makeupRequestId":"af061106-0000-4000-8000-000000000003","makeupRequestRole":"cancel"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done","startTime":"18:00","endTime":"20:00","teacherCatalogId":"af061106-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"af061106-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","makeupRequestId":"af061106-0000-4000-8000-000000000003","makeupRequestRole":"makeup","makeupAdoption":{"version":1,"requestUpdatedAt":"2050-10-01T00:00:00.123456+00:00","originalId":"legacy-original-alpha","makeupId":"legacy-makeup-alpha"}}]},"patch":{"actor_profile_id":"af061106-0000-4000-8000-000000000801","final_note":"Synthetic pair adoption","schedule_plan_before":{"subject":"영어","className":"Synthetic legacy adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done"}]},"schedule_plan_after":{"subject":"영어","className":"Synthetic legacy adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done","makeupRequestId":"af061106-0000-4000-8000-000000000003","makeupRequestRole":"cancel"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done","startTime":"18:00","endTime":"20:00","teacherCatalogId":"af061106-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"af061106-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","makeupRequestId":"af061106-0000-4000-8000-000000000003","makeupRequestRole":"makeup","makeupAdoption":{"version":1,"requestUpdatedAt":"2050-10-01T00:00:00.123456+00:00","originalId":"legacy-original-alpha","makeupId":"legacy-makeup-alpha"}}]},"cancel_academic_event_id":"af061106-0000-4000-8000-000000000100","makeup_academic_event_id":"af061106-0000-4000-8000-000000000101","makeup_academic_event_ids":["af061106-0000-4000-8000-000000000101"],"calendar_events":[{"id":"af061106-0000-4000-8000-000000000100","title":"[휴강] Synthetic legacy adoption","date":"2050-10-20","type":"팁스","grade":"all","note":"[[TIPS_MAKEUP]] {\"kind\":\"cancel\",\"requestId\":\"af061106-0000-4000-8000-000000000003\",\"className\":\"Synthetic legacy adoption\",\"subject\":\"영어\",\"cancelDate\":\"2050-10-20\",\"reason\":\"\"}"},{"id":"af061106-0000-4000-8000-000000000101","title":"[보강] Synthetic legacy adoption · Synthetic requested room","date":"2050-10-06","type":"팁스","grade":"all","note":"[[TIPS_MAKEUP]] {\"kind\":\"makeup\",\"requestId\":\"af061106-0000-4000-8000-000000000003\",\"className\":\"Synthetic legacy adoption\",\"subject\":\"영어\",\"classroom\":\"Synthetic requested room\",\"startAt\":\"2050-10-06T18:00:00+09:00\",\"endAt\":\"2050-10-06T20:00:00+09:00\",\"slotIndex\":0,\"reason\":\"\"}"}]}}$json$::jsonb $fn$;
-- END ACTUAL ADOPTION PRODUCER
select is(pg_temp.producer_fixture()->'plan',pg_temp.plan(),'real JS producer uses the exact independent SQL before fixture');
select is(pg_temp.producer_fixture()->'after',pg_temp.expected(pg_temp.request()),'real JS planner output equals independently expected preserved SQL plan');
select is(dashboard_private.legacy_effective_binding_v1(pg_temp.plan()#>'{sessions,1}'),
 jsonb_build_object('id','legacy-makeup-alpha','date','2050-10-06','state','makeup','scheduleState','makeup','originalDate','2050-10-20'),
 'ordinary row with originalSessionId retains exact old binding projection');
select is(dashboard_private.legacy_effective_binding_v1(pg_temp.expected(pg_temp.request())#>'{sessions,1}'),
 jsonb_build_object('id','legacy-makeup-alpha','date','2050-10-06','state','makeup','scheduleState','makeup','originalDate','2050-10-20',
  'makeupRequestId',pg_temp.request()->>'id','makeupRequestRole','makeup','originalSessionId','legacy-original-alpha',
  'makeupAdoption',pg_temp.expected(pg_temp.request())#>'{sessions,1,makeupAdoption}'),
 'adopted marker adds exact provenance keys without changing ordinary binding');
select is(dashboard_private.makeup_legacy_pair_v1(pg_temp.plan(),pg_temp.request()),
 jsonb_build_object('originalId','legacy-original-alpha','makeupId','legacy-makeup-alpha','originalIndex',0,'makeupIndex',1,
  'cancelDate','2050-10-20','makeupDate','2050-10-06','startAt','2050-10-06T09:00:00.000Z','endAt','2050-10-06T11:00:00.000Z','classroom','Synthetic requested room'),
 'one reciprocal legacy pair resolves with stable IDs and requested instants');
select is(dashboard_private.makeup_legacy_adoption_plan_v1(pg_temp.plan(),pg_temp.request(),pg_temp.teacher(),pg_temp.room()),
 pg_temp.expected(pg_temp.request()),'adoption changes only ownership and requested makeup resources, preserving maps, IDs and lesson content');
select is(dashboard_private.makeup_legacy_adoption_plan_v1(pg_temp.plan(),pg_temp.request(),pg_temp.teacher(),pg_temp.room())#>>'{sessions,1,makeupAdoption,requestUpdatedAt}',
 '2050-10-01T00:00:00.123456+00:00','generation marker preserves PostgreSQL microseconds exactly');
select ok(dashboard_private.makeup_legacy_pair_v1(candidate,pg_temp.request()) is null,label)
from (values
 (jsonb_set(pg_temp.plan(),'{sessions,0,makeupDate}','"2050-10-05"'),'wrong reciprocal makeup date fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,1,originalDate}','"2050-10-19"'),'wrong reciprocal original date fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,1,originalSessionId}','"another-original"'),'wrong original identity fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,0,originalSessionId}','"earlier-original"'),'unexpected original row ancestry fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessionStates,2050-10-20,originalSessionId}','"earlier-original"'),'unexpected original map ancestry fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,1,sessionKey}','"another-key"'),'conflicting stable key fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions}',pg_temp.plan()->'sessions'||jsonb_build_array(pg_temp.plan()#>'{sessions,0}')),'duplicate original date row fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions}',pg_temp.plan()->'sessions'||jsonb_build_array(pg_temp.plan()#>'{sessions,1}')),'duplicate makeup date row fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions}',pg_temp.plan()->'sessions'||jsonb_build_array(jsonb_build_object('id','legacy-original-alpha','date','2050-10-22','state','active'))),'duplicate identity on another date fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,0,makeupRequestId}',to_jsonb(pg_temp.sid(99)::text)),'existing original owner fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,1,makeupRequestId}',to_jsonb(pg_temp.sid(99)::text)),'existing makeup owner fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions,0,state}','"active"'),'contradictory original states fail closed'),
 (jsonb_set(pg_temp.plan(),'{sessionStates,2050-10-20,state}','"active"'),'conflicting date-map state fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessionStates,2050-10-06}',jsonb_build_object('state','makeup','originalSessionId','another-original')),'conflicting map identity fails closed'),
 (jsonb_set(pg_temp.plan(),'{sessions}',pg_temp.plan()->'sessions'||jsonb_build_array(jsonb_build_object('id','another-makeup','date','2050-10-22','state','makeup','originalSessionId','legacy-original-alpha'))),'second linked makeup on another date fails closed')
) variants(candidate,label);
select ok(dashboard_private.makeup_legacy_pair_v1(pg_temp.plan(),candidate) is null,label)
from (values
 (pg_temp.request()||jsonb_build_object('request_kind','makeup_only'),'makeup-only request cannot adopt cancellation pair'),
 (pg_temp.request()||jsonb_build_object('original_lesson_session_id',pg_temp.sid(80)),'normalized original cannot use legacy adoption'),
 (jsonb_set(pg_temp.request(),'{makeup_slots}',pg_temp.request()->'makeup_slots'||pg_temp.request()->'makeup_slots'),'multiple slots fail closed'),
 (jsonb_set(pg_temp.request(),'{makeup_slots}',pg_temp.request()->'makeup_slots'||'[{}]'::jsonb),'invalid second raw slot cannot be normalized away'),
 (jsonb_set(pg_temp.request(),'{makeup_slots}','[{}]'),'invalid raw slot cannot fall back to top-level times'),
 (jsonb_set(pg_temp.request(),'{makeup_slots}','[null]'),'null raw slot cannot fall back to top-level times'),
 (jsonb_set(pg_temp.request(),'{makeup_slots,0,startAt}','"2050-10-06T18:00:01+09:00"'),'non-minute slot fails closed'),
 (jsonb_set(pg_temp.request(),'{makeup_slots,0,startAt}','"2050-10-06T18:00:00"'),'offset-free slot fails closed'),
 (jsonb_set(pg_temp.request(),'{makeup_slots,0,startAt}','"2050-10-06T18:00:00.000001+09:00"'),'sub-millisecond instant fails closed'),
 (jsonb_set(pg_temp.request()||jsonb_build_object('makeup_classroom',''),'{makeup_slots,0,classroom}','""'),'unknown room fails closed')
) variants(candidate,label);
select ok(dashboard_private.makeup_legacy_adoption_plan_v1(pg_temp.plan(),pg_temp.request(),pg_temp.teacher()||jsonb_build_object('id',pg_temp.sid(99)),pg_temp.room()) is null,'different teacher catalog cannot be adopted');
select ok(dashboard_private.makeup_legacy_adoption_plan_v1(pg_temp.plan(),pg_temp.request(),pg_temp.teacher(),pg_temp.room()||jsonb_build_object('name','Other room')) is null,'different room name cannot be adopted');
set local timezone='UTC';
create temp table utc_pair as select dashboard_private.makeup_legacy_pair_v1(pg_temp.plan(),pg_temp.request()) value;
set local timezone='Asia/Seoul';
select is(dashboard_private.makeup_legacy_pair_v1(pg_temp.plan(),pg_temp.request()),(select value from utc_pair),'UTC and Seoul sessions project the same request pair');
set local timezone='UTC';
select ok(not has_function_privilege(role_name,'dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb)','execute'),'pair helper remains owner-only for '||role_name) from unnest(array['anon','authenticated','service_role']) role_name;
select ok(not has_function_privilege(role_name,'dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb)','execute'),'plan helper remains owner-only for '||role_name) from unnest(array['anon','authenticated','service_role']) role_name;

-- Final writer integration; actual legacy row initially inherits 19:30-21:30.
insert into auth.users(id,instance_id,aud,role,email)
select pg_temp.sid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-adoption-'||n||'@synthetic.invalid' from generate_series(801,803)n;
insert into public.profiles(id,role,name)
select pg_temp.sid(n),case n when 801 then 'admin' when 802 then 'viewer' else 'assistant' end,'Synthetic actor '||n from generate_series(801,803)n
on conflict(id) do update set role=excluded.role;
delete from public.teacher_catalogs where profile_id=pg_temp.sid(801);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values(pg_temp.sid(1),'Synthetic requested teacher',array['영어'],pg_temp.sid(801));
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.sid(2),'Synthetic requested room',array['영어']);
update public.profiles set teacher_catalog_id=pg_temp.sid(1) where id=pg_temp.sid(801);
insert into dashboard_private.makeup_subject_directors_v1 values('영어',pg_temp.sid(801),pg_temp.sid(1));
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.sid(4),'Synthetic legacy adoption','영어','Synthetic requested teacher','Synthetic requested room','수금 19:30-21:30','수강','legacy',pg_temp.plan());
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.sid(3),'approval_pending','cancel_makeup','영어','english',pg_temp.sid(801),pg_temp.sid(4),'Synthetic legacy adoption',pg_temp.sid(1),pg_temp.sid(801),pg_temp.sid(1),pg_temp.sid(801),'2050-10-20','2050-10-06T09:00:00Z','2050-10-06T11:00:00Z','Synthetic requested room',pg_temp.request()->'makeup_slots');
-- Establish historical fixture reference once, before testing the real guards.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table initial_request as select to_jsonb(r) value from public.makeup_requests r where id=pg_temp.sid(3);
create temp table before_counts as select (select count(*) from public.academic_events) calendars,(select count(*) from public.makeup_request_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries;
create function pg_temp.actor(n int,claim text default 'authenticated') returns void language sql as $f$
 select set_config('request.jwt.claim.sub',pg_temp.sid(n)::text,true),set_config('request.jwt.claim.role',claim,true),set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.sid(n),'role',claim)::text,true)
$f$;
create function pg_temp.slots() returns jsonb language sql immutable as $f$
 select jsonb_build_array(jsonb_build_object('startAt','2050-10-06T09:00:00.000Z','endAt','2050-10-06T11:00:00.000Z','classroom','Synthetic requested room','requestIds',jsonb_build_array(pg_temp.sid(3))))
$f$;
create function pg_temp.windows() returns jsonb language sql immutable as $f$
 select '[{"startAt":"2050-10-06T09:00:00.000Z","endAt":"2050-10-06T11:00:00.000Z"}]'::jsonb
$f$;
-- A session GUC stores only the synthetic expected patch, accessible under the
-- real application role without granting access to any product or temp table.
select set_config('test.legacy_adoption_patch',jsonb_set(pg_temp.producer_fixture()->'patch','{schedule_plan_after,sessions,1,makeupAdoption,requestUpdatedAt}',(select value->'updated_at' from initial_request))::text,true);
create function pg_temp.patch() returns jsonb language sql stable as $$select current_setting('test.legacy_adoption_patch')::jsonb$$;
create function pg_temp.approve(keyn int,p_patch jsonb default null) returns jsonb language sql as $f$
 select public.transition_makeup_request_v2(pg_temp.sid(3),'approve',coalesce(p_patch,pg_temp.patch()),'approval_pending',pg_temp.sid(keyn))
$f$;
select pg_temp.actor(801);
set local role authenticated;
select is(jsonb_array_length(public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])->'legacyBindings'),1,'authorized list context proves one eligible legacy pair');
select is(public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])#>>'{legacyBindings,0,mode}','reuse','pending binding is reuse, not completed ownership');
select is((public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])#>>'{legacyBindings,0,occupancy,startMinute}')::int,1170,'reuse proof identifies old inherited 19:30 occupancy, not requested 18:00');
select is((public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])#>>'{legacyBindings,0,occupancy,endMinute}')::int,1290,'reuse proof identifies old inherited 21:30 end');
select throws_ok($$select public.get_makeup_reservation_context_v1(jsonb_set(pg_temp.slots(),'{0,requestIds}',jsonb_build_array(pg_temp.sid(3),pg_temp.sid(3))),array[]::uuid[])$$,'22023','makeup_legacy_binding_request_invalid','duplicate proof request IDs fail closed');
select throws_ok($$select public.get_makeup_reservation_context_v1(jsonb_set(pg_temp.slots(),'{0,requestIds}','["not-a-uuid"]'),array[]::uuid[])$$,'22023','makeup_legacy_binding_request_invalid','malformed proof request ID fails closed');
select throws_ok($$select public.get_makeup_reservation_context_v1(pg_temp.slots()||pg_temp.slots(),array[]::uuid[])$$,'22023','makeup_legacy_binding_request_invalid','proof selectors outside first envelope fail closed');
select is(jsonb_array_length(public.get_makeup_reservation_context_v1(pg_temp.slots()||'[{"startAt":"2050-10-21T09:00:00.000Z","endAt":"2050-10-21T11:00:00.000Z"}]'::jsonb,array[]::uuid[])->'legacyBindings'),1,'wide reservation page preserves read and batches eligible proof');
select is(jsonb_array_length(public.get_makeup_reservation_context_v1(pg_temp.slots()||'[{"startAt":"2050-10-01T09:00:00.000Z","endAt":"2050-10-31T11:00:00.000Z"}]'::jsonb,array[]::uuid[])->'legacyBindings'),1,'long historical reservation does not invalidate eligible single-slot proof');
select is(jsonb_array_length(public.get_makeup_reservation_context_v1(pg_temp.slots()||(select jsonb_agg(pg_temp.windows()->0) from generate_series(1,300)),array[]::uuid[])->'legacyBindings'),1,'more than256 reservation windows are chunked and duplicate proof is deduplicated');
select throws_ok($$select dashboard_private.makeup_effective_class_context_v1(jsonb_build_object('kind','legacyAdoption','requestIds',jsonb_build_array(pg_temp.sid(3)),'slots',pg_temp.windows()||'[{"startAt":"2050-10-21T09:00:00.000Z","endAt":"2050-10-21T11:00:00.000Z"}]'::jsonb))$$,'22023','makeup_legacy_binding_request_invalid','each trusted proof batch retains fourteen-day maximum span');
select is(public.get_makeup_reservation_context_v1(jsonb_set(jsonb_set(pg_temp.slots(),'{0,startAt}','"2050-10-07T09:00:00.000Z"'),'{0,endAt}','"2050-10-07T11:00:00.000Z"'),array[]::uuid[])->'legacyBindings','[]'::jsonb,'request outside supplied windows yields no proof');
select throws_ok($$select pg_temp.approve(201)$$,'42501','makeup_approval_server_required','authenticated browser cannot invoke approval writer');
reset role;
select pg_temp.actor(802);set local role authenticated;
select is(coalesce(public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])->'legacyBindings','[]'::jsonb),'[]'::jsonb,'unrelated viewer obtains no binding or hidden competitor information');
reset role;
select pg_temp.actor(803);set local role authenticated;
select is(coalesce(public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])->'legacyBindings','[]'::jsonb),'[]'::jsonb,'assistant obtains no binding');
reset role;
select pg_temp.actor(801,'service_role');set local role service_role;
select is(jsonb_array_length(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings'),1,'server context proves the same eligible request');
select throws_ok($$select pg_temp.approve(202,jsonb_set(pg_temp.patch(),'{schedule_plan_after,sessions,1,teacherNote}','"Tampered lesson"'))$$,'P0001','makeup_legacy_pair_invalid','writer rejects changes beyond exact approved pair delta');
select throws_ok($$select pg_temp.approve(203,jsonb_set(pg_temp.patch(),'{schedule_plan_after,sessions,1,makeupAdoption,requestUpdatedAt}','"2000-01-01T00:00:00+00:00"'))$$,'P0001','makeup_legacy_pair_stale','writer rejects stale request generation even with unchanged status');
reset role;

savepoint competitor;
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.sid(30),'approval_pending','cancel_makeup','영어','english',pg_temp.sid(802),pg_temp.sid(4),'Synthetic legacy adoption',pg_temp.sid(1),pg_temp.sid(801),pg_temp.sid(1),pg_temp.sid(801),'2050-10-20','2050-10-07T00:00:00Z','2050-10-07T01:00:00Z','Synthetic requested room','[{"startAt":"2050-10-07T09:00:00+09:00","endAt":"2050-10-07T10:00:00+09:00","classroom":"Synthetic requested room"}]');
select pg_temp.actor(801,'service_role');set local role service_role;
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'nonoverlapping active request for same original removes proof');
select throws_ok($$select pg_temp.approve(204)$$,'P0001','makeup_legacy_pair_invalid','locked writer rejects other active ownership even outside requested time');
reset role;
update public.makeup_requests set status='revision_requested' where id=pg_temp.sid(30);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'revision-requested competitor also prevents adoption');
update public.makeup_requests set status='refund_pending' where id=pg_temp.sid(30);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'refund-pending competitor also prevents adoption');
update public.makeup_requests set status='rejected' where id=pg_temp.sid(30);
select is(jsonb_array_length(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings'),1,'terminal rejected competitor does not claim legacy pair');
rollback to competitor;

savepoint class_stale;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{extension,concurrentEdit}','true') where id=pg_temp.sid(4);
set local role service_role;
select throws_ok($$select pg_temp.approve(205)$$,'P0001','makeup_legacy_pair_stale','writer rejects stale before plan after concurrent schedule edit');
reset role;
rollback to class_stale;

-- A genuine collision outside the reused pair must survive exact self-exclusion.
-- This class ends before the old inherited 19:30 row, but overlaps the requested
-- 18:00-20:00. The adoption would introduce a new collision and must be refused.
savepoint other_class;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.sid(41),'Synthetic other teacher',array['영어']);
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.sid(40),'Synthetic other class','영어','Synthetic other teacher','Synthetic requested room','목 18:30-19:00','수강','legacy',
 jsonb_build_object('subject','영어','className','Synthetic other class','selectedDays',jsonb_build_array(4),'sessions',jsonb_build_array(
 jsonb_build_object('id','other-class-lesson','date','2050-10-06','state','active','scheduleState','active','startTime','18:30','endTime','19:00'))));
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select ok(exists(select 1 from jsonb_array_elements(public.get_makeup_effective_occupancy_v1(pg_temp.windows())->'occupancies') o where o->>'classId'=pg_temp.sid(40)::text),'effective occupancy keeps other class beside exact reused row');
select pg_temp.actor(801,'service_role');set local role service_role;
select throws_ok($$select pg_temp.approve(206)$$,'23P01','timetable_resource_conflict','real other-class conflict blocks final writer after pair adoption');
reset role;
select is((select status from public.makeup_requests where id=pg_temp.sid(3)),'approval_pending','failed genuine-conflict approval is atomic');
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.plan(),'genuine conflict leaves preexisting pair unchanged');
rollback to other_class;

savepoint same_class_other_lesson;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',schedule_plan->'sessions'||jsonb_build_array(
 jsonb_build_object('id','separate-same-class-lesson','date','2050-10-06','state','active','scheduleState','active','startTime','18:30','endTime','19:00')))
where id=pg_temp.sid(4);
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'same-class separate target-date row creates ambiguity, never broad self-exclusion');
select ok(exists(select 1 from jsonb_array_elements(public.get_makeup_effective_occupancy_v1(pg_temp.windows())->'occupancies') o where o->>'id' like '%separate-same-class-lesson%'),'same-class separate lesson remains in occupancy result');
rollback to same_class_other_lesson;

select pg_temp.actor(801,'service_role');set local role service_role;
reset role;
set local timezone='Asia/Seoul';
select lives_ok($$select dashboard_private.makeup_assert_legacy_adoption_v1((select r from public.makeup_requests r where id=pg_temp.sid(3)),pg_temp.patch())$$,'Seoul locked guard accepts exact UTC request generation without truncation');
select is(public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])#>>'{legacyBindings,0,requestUpdatedAt}',(select value->>'updated_at' from initial_request),'Seoul context preserves the UTC microsecond proof generation');
set local timezone='UTC';
set local role service_role;
select lives_ok($$select pg_temp.approve(210)$$,'final UTC server writer adopts verified pair without duplicate creation');
reset role;
select is((select status from public.makeup_requests where id=pg_temp.sid(3)),'completed','successful adoption completes synthetic request');
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.expected((select value from initial_request)),'writer stores precisely the independently expected preserved plan');
select is((select schedule_plan_before from public.makeup_requests where id=pg_temp.sid(3)),pg_temp.plan(),'cancellation snapshot is truthful preexisting pair');
select is(jsonb_array_length((select schedule_plan->'sessions' from public.classes where id=pg_temp.sid(4))),2,'adoption never appends a second makeup row');
select is((select count(*) from public.academic_events),(select calendars+2 from before_counts),'adoption adds exactly its two calendar effects');
select is((select count(*) from public.makeup_request_events where request_id=pg_temp.sid(3) and event_type='approved'),1::bigint,'one approved audit event records adoption');
select pg_temp.actor(801);set local role authenticated;
select is(public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])#>>'{legacyBindings,0,mode}','bound','completed request has independently validated bound proof');
select is((public.get_makeup_reservation_context_v1(pg_temp.slots(),array[]::uuid[])#>>'{legacyBindings,0,occupancy,startMinute}')::int,1080,'bound proof identifies current requested 18:00 row');
reset role;
create temp table approved_counts as select (select count(*) from public.academic_events) calendars,(select count(*) from public.makeup_request_events) events;
select pg_temp.actor(801,'service_role');set local role service_role;
select lives_ok($$select pg_temp.approve(210)$$,'same receipt replays after adoption without requiring unowned pair again');
select throws_ok($$select pg_temp.approve(211)$$,'P0001','makeup_request_stale_status','new mutation cannot reapprove completed pair');
reset role;
select is((select count(*) from public.academic_events),(select calendars from approved_counts),'receipt replay does not duplicate calendar effects');
select is((select count(*) from public.makeup_request_events),(select events from approved_counts),'receipt replay does not duplicate audit events');

savepoint completed_peer;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',schedule_plan->'sessions'||jsonb_build_array(
 jsonb_build_object('id','makeup-request:'||pg_temp.sid(91)::text||':0','sessionKey','makeup-request:'||pg_temp.sid(91)::text||':0',
 'date','2050-10-06','scheduleState','makeup','makeupRequestId',pg_temp.sid(91),'makeupRequestRole','makeup','originalDate','2050-10-22',
 'startTime','21:00','endTime','22:00','teacherCatalogId',pg_temp.sid(1),'classroomCatalogId',pg_temp.sid(2)))) where id=pg_temp.sid(4);
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())#>>'{legacyBindings,0,mode}','bound','later canonical peer on same date preserves exact adopted self-binding');
select ok(exists(select 1 from jsonb_array_elements(public.get_makeup_effective_occupancy_v1('[{"startAt":"2050-10-06T12:00:00.000Z","endAt":"2050-10-06T13:00:00.000Z"}]')->'occupancies') o where o->>'id' like '%:000000000091%' or o->>'id' like '%000000000091:0'),'later canonical peer occupancy remains visible');
update public.classes set schedule_plan=jsonb_set(jsonb_set(schedule_plan,'{sessions,2,startTime}','"18:30"'),'{sessions,2,endTime}','"19:00"') where id=pg_temp.sid(4);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())#>>'{legacyBindings,0,mode}','bound','overlapping peer does not broaden or erase exact self-binding');
select is(jsonb_array_length(public.get_makeup_effective_occupancy_v1(pg_temp.windows())->'occupancies'),2,'overlapping peer is retained beside exact own occupancy for real collision');
rollback to completed_peer;

savepoint missing_event;
delete from public.makeup_request_events where request_id=pg_temp.sid(3) and event_type='approved';
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'missing approved event cannot establish bound proof');
rollback to missing_event;
savepoint wrong_event_time;
update public.makeup_request_events set payload=jsonb_set(payload,'{approved_at}','"2000-01-01T00:00:00.000000+00:00"') where request_id=pg_temp.sid(3) and event_type='approved';
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'mismatched approved event instant cannot establish bound proof');
rollback to wrong_event_time;
savepoint wrong_event_identity;
update public.makeup_request_events set payload=jsonb_set(payload,'{makeup_request_id}',to_jsonb(pg_temp.sid(99)::text)) where request_id=pg_temp.sid(3) and event_type='approved';
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'mismatched approved event request cannot establish bound proof');
rollback to wrong_event_identity;
savepoint missing_calendar;
delete from public.academic_events where id=pg_temp.sid(101);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'missing linked calendar cannot establish bound proof');
rollback to missing_calendar;
savepoint changed_original_ancestry;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,originalSessionId}','"unexpected-earlier-original"') where id=pg_temp.sid(4);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'unexpected original ancestry cannot bypass conditional binding projection');
rollback to changed_original_ancestry;
savepoint malformed_original_marker;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,makeupAdoption}','null') where id=pg_temp.sid(4);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'malformed marker on original row cannot bypass conditional binding projection');
rollback to malformed_original_marker;

savepoint changed_binding;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,1,makeupAdoption,originalId}','"different-original"') where id=pg_temp.sid(4);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'changed current marker cannot reuse saved binding');
rollback to changed_binding;

savepoint forged_bound;
update public.makeup_requests set schedule_plan_before='{}'::jsonb where id=pg_temp.sid(3);
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'legacyBindings','[]'::jsonb,'ownership marker alone does not grant completed self-exclusion');
rollback to forged_bound;

savepoint stale_cancel;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{extension,concurrentEdit}','true') where id=pg_temp.sid(4);
select pg_temp.actor(801);set local role authenticated;
select throws_ok($$select public.transition_makeup_request_v2(pg_temp.sid(3),'approval_canceled','{"note":"Synthetic cancel"}','completed',pg_temp.sid(220))$$,'P0001','makeup_schedule_plan_stale','cancel refuses to overwrite later class edits');
reset role;
rollback to stale_cancel;
select pg_temp.actor(801);set local role authenticated;
select lives_ok($$select public.transition_makeup_request_v2(pg_temp.sid(3),'approval_canceled','{"note":"Synthetic cancel"}','completed',pg_temp.sid(221))$$,'authorized cancellation restores actual prior pair');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.plan(),'cancel restores original generic IDs, inherited times, content and date maps');
select is((select count(*) from public.academic_events),(select calendars from before_counts),'cancel removes only adoption calendar effects');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from before_counts),'isolated approval/replay/cancel never sends provider notifications');
select * from finish();
rollback;
