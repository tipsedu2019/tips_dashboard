begin;
select no_plan();
-- Generated from the actual JS producers by tests/fixtures/makeup-approval-db-fixture.mjs.
create function pg_temp.fixture() returns jsonb language sql immutable as $fn$ select $json${"request":{"id":"aa041004-0000-4000-8000-000000000003","class_id":"aa041004-0000-4000-8000-000000000004","class_name":"Synthetic approval","subject":"영어","request_kind":"cancel_makeup","cancel_date":"2050-10-07","teacher_catalog_id":"aa041004-0000-4000-8000-000000000001","makeup_start_at":"2050-10-06T06:00:00Z","makeup_end_at":"2050-10-06T08:00:00Z","makeup_classroom":"Synthetic requested room","makeup_slots":[{"startAt":"2050-10-06T10:00:00+09:00","endAt":"2050-10-06T11:00:00+09:00","classroom":"Synthetic requested room"},{"startAt":"2050-10-06T12:00:00+09:00","endAt":"2050-10-06T13:00:00+09:00","classroom":"Synthetic requested room"},{"startAt":"2050-10-08T12:00:00+09:00","endAt":"2050-10-08T13:00:00+09:00","classroom":"Synthetic requested room"}]},"plan":{"subject":"영어","className":"Synthetic approval","selectedDays":[5],"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{},"extension":{"keep":true},"sessions":[{"id":"history","date":"2020-01-01","scheduleState":"active","teacherNote":"Historical content unchanged"},{"id":"original","sessionKey":"original","date":"2050-10-07","scheduleState":"active","state":"active","isForced":false,"originalDate":"","makeupDate":"","billingId":"oct","billingLabel":"10월","sessionNumber":1,"startTime":"18:00","endTime":"20:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000009","classroomCatalogId":"aa041004-0000-4000-8000-000000000008","teacherNote":"Original exception retained","textbookEntries":[{"textbookId":"book","actual":{"start":8,"end":10}}],"progressStatus":"done"}]},"baseline":{"version":2,"subject":"영어","className":"Synthetic approval","selectedDays":[5],"globalSessionCount":4,"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2050-10-01","endDate":"2050-10-31","totalSessions":0,"color":"#5c8f7d"}],"sessionStates":{"2050-10-07":{"state":"exception","memo":"휴강","makeupMemo":"보강 2050-10-06 10:00-11:00 · Synthetic requested room · 보강 2050-10-06 12:00-13:00 · Synthetic requested room · 보강 2050-10-08 12:00-13:00 · Synthetic requested room","makeupDate":"2050-10-06"},"2050-10-08":{"state":"makeup","memo":"보강: Synthetic approval · Synthetic requested room","makeupMemo":"","makeupDate":""}},"sessionSchedules":{"2050-10-07":{"startTime":"18:00","endTime":"20:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000009","classroomCatalogId":"aa041004-0000-4000-8000-000000000008"}},"textbooks":[],"sessions":[{"id":"original","sessionKey":"original","billingId":"oct","billingLabel":"10월","billingColor":"#5c8f7d","sessionNumber":1,"date":"2050-10-06","scheduleState":"makeup","state":"makeup","memo":"보강 2050-10-06 10:00-11:00 · Synthetic requested room · 보강 2050-10-06 12:00-13:00 · Synthetic requested room · 보강 2050-10-08 12:00-13:00 · Synthetic requested room","makeupDate":"","originalDate":"2050-10-07","isForced":false,"progressStatus":"pending","publicNote":"","teacherNote":"Original exception retained","textbookEntries":[]},{"startTime":"18:00","endTime":"20:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000009","classroomCatalogId":"aa041004-0000-4000-8000-000000000008","id":"session:2050-10-07:oct:2050-10-06:exception","sessionKey":"session:2050-10-07:oct:2050-10-06:exception","billingId":"oct","billingLabel":"10월","billingColor":"#5c8f7d","sessionNumber":null,"date":"2050-10-07","scheduleState":"exception","state":"exception","memo":"휴강","makeupDate":"2050-10-06","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"","teacherNote":"","textbookEntries":[]},{"id":"session:002:2050-10-08:oct:makeup","sessionKey":"session:002:2050-10-08:oct:makeup","billingId":"oct","billingLabel":"10월","billingColor":"#5c8f7d","sessionNumber":2,"date":"2050-10-08","scheduleState":"makeup","state":"makeup","memo":"보강: Synthetic approval · Synthetic requested room","makeupDate":"","originalDate":"","isForced":true,"progressStatus":"pending","publicNote":"","teacherNote":"","textbookEntries":[]},{"id":"session:003:2050-10-14:oct:active","sessionKey":"session:003:2050-10-14:oct:active","billingId":"oct","billingLabel":"10월","billingColor":"#5c8f7d","sessionNumber":3,"date":"2050-10-14","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"","teacherNote":"","textbookEntries":[]},{"id":"session:004:2050-10-21:oct:active","sessionKey":"session:004:2050-10-21:oct:active","billingId":"oct","billingLabel":"10월","billingColor":"#5c8f7d","sessionNumber":4,"date":"2050-10-21","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"","teacherNote":"","textbookEntries":[]},{"id":"session:005:2050-10-28:oct:active","sessionKey":"session:005:2050-10-28:oct:active","billingId":"oct","billingLabel":"10월","billingColor":"#5c8f7d","sessionNumber":5,"date":"2050-10-28","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"","teacherNote":"","textbookEntries":[]}]},"after":{"subject":"영어","className":"Synthetic approval","selectedDays":[5],"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-07":{"state":"exception","memo":"휴강","makeupDate":""}},"extension":{"keep":true},"sessions":[{"id":"history","date":"2020-01-01","scheduleState":"active","teacherNote":"Historical content unchanged"},{"id":"original","sessionKey":"original","date":"2050-10-07","scheduleState":"exception","state":"exception","isForced":false,"originalDate":"","makeupDate":"","billingId":"oct","billingLabel":"10월","sessionNumber":1,"startTime":"18:00","endTime":"20:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000009","classroomCatalogId":"aa041004-0000-4000-8000-000000000008","teacherNote":"Original exception retained","textbookEntries":[{"textbookId":"book","actual":{"start":8,"end":10}}],"progressStatus":"done","makeupRequestId":"aa041004-0000-4000-8000-000000000003","makeupRequestRole":"cancel","memo":"휴강"},{"billingId":"oct","billingLabel":"10월","id":"makeup-request:aa041004-0000-4000-8000-000000000003:0","sessionKey":"makeup-request:aa041004-0000-4000-8000-000000000003:0","makeupRequestId":"aa041004-0000-4000-8000-000000000003","date":"2050-10-06","startTime":"10:00","endTime":"11:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"aa041004-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","scheduleState":"makeup","state":"makeup","originalDate":"2050-10-07","makeupDate":"","isForced":false,"sessionNumber":null,"memo":"보강","publicNote":"","teacherNote":"","progressStatus":"pending","textbookEntries":[]},{"billingId":"oct","billingLabel":"10월","id":"makeup-request:aa041004-0000-4000-8000-000000000003:1","sessionKey":"makeup-request:aa041004-0000-4000-8000-000000000003:1","makeupRequestId":"aa041004-0000-4000-8000-000000000003","date":"2050-10-06","startTime":"12:00","endTime":"13:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"aa041004-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","scheduleState":"makeup","state":"makeup","originalDate":"2050-10-07","makeupDate":"","isForced":false,"sessionNumber":null,"memo":"보강","publicNote":"","teacherNote":"","progressStatus":"pending","textbookEntries":[]},{"billingId":"oct","billingLabel":"10월","id":"makeup-request:aa041004-0000-4000-8000-000000000003:2","sessionKey":"makeup-request:aa041004-0000-4000-8000-000000000003:2","makeupRequestId":"aa041004-0000-4000-8000-000000000003","date":"2050-10-08","startTime":"12:00","endTime":"13:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"aa041004-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","scheduleState":"makeup","state":"makeup","originalDate":"2050-10-07","makeupDate":"","isForced":false,"sessionNumber":null,"memo":"보강","publicNote":"","teacherNote":"","progressStatus":"pending","textbookEntries":[]}]},"patch":{"actor_profile_id":"aa041004-0000-4000-8000-000000000901","final_note":"Synthetic approval regression","schedule_plan_before":{"subject":"영어","className":"Synthetic approval","selectedDays":[5],"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{},"extension":{"keep":true},"sessions":[{"id":"history","date":"2020-01-01","scheduleState":"active","teacherNote":"Historical content unchanged"},{"id":"original","sessionKey":"original","date":"2050-10-07","scheduleState":"active","state":"active","isForced":false,"originalDate":"","makeupDate":"","billingId":"oct","billingLabel":"10월","sessionNumber":1,"startTime":"18:00","endTime":"20:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000009","classroomCatalogId":"aa041004-0000-4000-8000-000000000008","teacherNote":"Original exception retained","textbookEntries":[{"textbookId":"book","actual":{"start":8,"end":10}}],"progressStatus":"done"}]},"schedule_plan_after":{"subject":"영어","className":"Synthetic approval","selectedDays":[5],"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-07":{"state":"exception","memo":"휴강","makeupDate":""}},"extension":{"keep":true},"sessions":[{"id":"history","date":"2020-01-01","scheduleState":"active","teacherNote":"Historical content unchanged"},{"id":"original","sessionKey":"original","date":"2050-10-07","scheduleState":"exception","state":"exception","isForced":false,"originalDate":"","makeupDate":"","billingId":"oct","billingLabel":"10월","sessionNumber":1,"startTime":"18:00","endTime":"20:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000009","classroomCatalogId":"aa041004-0000-4000-8000-000000000008","teacherNote":"Original exception retained","textbookEntries":[{"textbookId":"book","actual":{"start":8,"end":10}}],"progressStatus":"done","makeupRequestId":"aa041004-0000-4000-8000-000000000003","makeupRequestRole":"cancel","memo":"휴강"},{"billingId":"oct","billingLabel":"10월","id":"makeup-request:aa041004-0000-4000-8000-000000000003:0","sessionKey":"makeup-request:aa041004-0000-4000-8000-000000000003:0","makeupRequestId":"aa041004-0000-4000-8000-000000000003","date":"2050-10-06","startTime":"10:00","endTime":"11:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"aa041004-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","scheduleState":"makeup","state":"makeup","originalDate":"2050-10-07","makeupDate":"","isForced":false,"sessionNumber":null,"memo":"보강","publicNote":"","teacherNote":"","progressStatus":"pending","textbookEntries":[]},{"billingId":"oct","billingLabel":"10월","id":"makeup-request:aa041004-0000-4000-8000-000000000003:1","sessionKey":"makeup-request:aa041004-0000-4000-8000-000000000003:1","makeupRequestId":"aa041004-0000-4000-8000-000000000003","date":"2050-10-06","startTime":"12:00","endTime":"13:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"aa041004-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","scheduleState":"makeup","state":"makeup","originalDate":"2050-10-07","makeupDate":"","isForced":false,"sessionNumber":null,"memo":"보강","publicNote":"","teacherNote":"","progressStatus":"pending","textbookEntries":[]},{"billingId":"oct","billingLabel":"10월","id":"makeup-request:aa041004-0000-4000-8000-000000000003:2","sessionKey":"makeup-request:aa041004-0000-4000-8000-000000000003:2","makeupRequestId":"aa041004-0000-4000-8000-000000000003","date":"2050-10-08","startTime":"12:00","endTime":"13:00","teacherCatalogId":"aa041004-0000-4000-8000-000000000001","teacherName":"Synthetic requested teacher","classroomCatalogId":"aa041004-0000-4000-8000-000000000002","classroomName":"Synthetic requested room","scheduleState":"makeup","state":"makeup","originalDate":"2050-10-07","makeupDate":"","isForced":false,"sessionNumber":null,"memo":"보강","publicNote":"","teacherNote":"","progressStatus":"pending","textbookEntries":[]}]},"cancel_academic_event_id":"aa041004-0000-4000-8000-000000000100","makeup_academic_event_id":"aa041004-0000-4000-8000-000000000101","makeup_academic_event_ids":["aa041004-0000-4000-8000-000000000101","aa041004-0000-4000-8000-000000000102","aa041004-0000-4000-8000-000000000103"],"calendar_events":[{"id":"aa041004-0000-4000-8000-000000000100","title":"[휴강] Synthetic approval","date":"2050-10-07","type":"팁스","grade":"all","note":"[[TIPS_MAKEUP]] {\"kind\":\"cancel\",\"requestId\":\"aa041004-0000-4000-8000-000000000003\",\"className\":\"Synthetic approval\",\"subject\":\"영어\",\"cancelDate\":\"2050-10-07\",\"reason\":\"\"}"},{"id":"aa041004-0000-4000-8000-000000000101","title":"[보강] Synthetic approval · Synthetic requested room","date":"2050-10-06","type":"팁스","grade":"all","note":"[[TIPS_MAKEUP]] {\"kind\":\"makeup\",\"requestId\":\"aa041004-0000-4000-8000-000000000003\",\"className\":\"Synthetic approval\",\"subject\":\"영어\",\"classroom\":\"Synthetic requested room\",\"startAt\":\"2050-10-06T10:00:00+09:00\",\"endAt\":\"2050-10-06T11:00:00+09:00\",\"slotIndex\":0,\"reason\":\"\"}"},{"id":"aa041004-0000-4000-8000-000000000102","title":"[보강] Synthetic approval · Synthetic requested room","date":"2050-10-06","type":"팁스","grade":"all","note":"[[TIPS_MAKEUP]] {\"kind\":\"makeup\",\"requestId\":\"aa041004-0000-4000-8000-000000000003\",\"className\":\"Synthetic approval\",\"subject\":\"영어\",\"classroom\":\"Synthetic requested room\",\"startAt\":\"2050-10-06T12:00:00+09:00\",\"endAt\":\"2050-10-06T13:00:00+09:00\",\"slotIndex\":1,\"reason\":\"\"}"},{"id":"aa041004-0000-4000-8000-000000000103","title":"[보강] Synthetic approval · Synthetic requested room","date":"2050-10-08","type":"팁스","grade":"all","note":"[[TIPS_MAKEUP]] {\"kind\":\"makeup\",\"requestId\":\"aa041004-0000-4000-8000-000000000003\",\"className\":\"Synthetic approval\",\"subject\":\"영어\",\"classroom\":\"Synthetic requested room\",\"startAt\":\"2050-10-08T12:00:00+09:00\",\"endAt\":\"2050-10-08T13:00:00+09:00\",\"slotIndex\":2,\"reason\":\"\"}"}]}}$json$::jsonb $fn$;
-- End generated fixture
create function pg_temp.sid(n int) returns uuid language sql immutable as $$select ('aa041004-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.sid(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','approval-occupancy@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.sid(901),'admin','Synthetic approval admin') on conflict(id) do update set role='admin';
delete from public.teacher_catalogs where profile_id=pg_temp.sid(901);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values(pg_temp.sid(1),'Synthetic requested teacher',array['영어'],pg_temp.sid(901)),(pg_temp.sid(9),'Synthetic historical teacher',array['영어'],null);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.sid(2),'Synthetic requested room',array['영어']),(pg_temp.sid(8),'Synthetic historical room',array['영어']);
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.sid(4),'Synthetic approval','영어','Synthetic requested teacher','Synthetic requested room','금 18:00-20:00','수강','legacy',pg_temp.fixture()->'plan');
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.sid(3),'approval_pending','cancel_makeup','영어','english',pg_temp.sid(901),pg_temp.sid(4),'Synthetic approval',pg_temp.sid(1),pg_temp.sid(901),pg_temp.sid(1),pg_temp.sid(901),'2050-10-07','2050-10-06T06:00:00Z','2050-10-06T08:00:00Z','Synthetic requested room',pg_temp.fixture()#>'{request,makeup_slots}');
-- Establish the preexisting incomplete history only during fixture setup.
-- Tested operations below run the final public RPC and real conflict guards.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate; set constraints all deferred;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.approve(after_plan jsonb,key_number int) returns jsonb language sql as $$
 select public.transition_makeup_request_v2(pg_temp.sid(3),'approve',jsonb_set(pg_temp.fixture()->'patch','{schedule_plan_after}',after_plan),'approval_pending',pg_temp.sid(key_number))
$$;
create function pg_temp.approve_fixed(key_number int) returns jsonb language sql as $$select pg_temp.approve(pg_temp.fixture()->'after',key_number)$$;
create temp table before_counts as select (select count(*) from public.academic_events) calendars,(select count(*) from public.makeup_request_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries;

set local role service_role;
select throws_ok($$select pg_temp.approve(pg_temp.fixture()->'baseline',501)$$,'23P01','timetable_resource_conflict','baseline JS producer fails the actual final approval consumer');
reset role;
select is((select status from public.makeup_requests where id=pg_temp.sid(3)),'approval_pending','failed approval rolls back request state');
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.fixture()->'plan','failed approval rolls back the complete plan');
select is((select count(*) from public.academic_events),(select calendars from before_counts),'failed approval rolls back calendar effects');
select is((select count(*) from public.makeup_request_events),(select events from before_counts),'failed approval rolls back request events');

set local role service_role;
select throws_ok($$select pg_temp.approve(jsonb_set(pg_temp.fixture()->'after','{sessions,2}',(pg_temp.fixture()#>'{after,sessions,2}')-'teacherCatalogId'-'teacherName'),502)$$,'23P01','timetable_resource_conflict','missing teacher metadata stays blocked by real DB guard');
select throws_ok($$select pg_temp.approve(jsonb_set(pg_temp.fixture()->'after','{sessions,2}',(pg_temp.fixture()#>'{after,sessions,2}')-'classroomCatalogId'-'classroomName'),503)$$,'23P01','timetable_resource_conflict','missing classroom metadata stays blocked');
select throws_ok($$select pg_temp.approve(jsonb_set(pg_temp.fixture()->'after','{sessions,2,id}','"original"'),504)$$,'23P01','timetable_resource_conflict','ambiguous session identity stays blocked');
reset role;

-- A valid distinct class overlapping only the room is independently rejected.
savepoint room_conflict;
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.sid(20),'Synthetic room conflict','영어','Synthetic historical teacher','Synthetic requested room','목 10:00-11:00','수강','legacy','{}');
set constraints all immediate;set constraints all deferred;
set local role service_role;
select throws_ok('select pg_temp.approve_fixed(505)','23P01','timetable_resource_conflict','real room overlap stays blocked');
reset role;
rollback to room_conflict;
savepoint teacher_conflict;
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.sid(21),'Synthetic teacher conflict','영어','Synthetic requested teacher','Synthetic historical room','목 10:00-11:00','수강','legacy','{}');
set constraints all immediate;set constraints all deferred;
set local role service_role;
select throws_ok('select pg_temp.approve_fixed(506)','23P01','timetable_resource_conflict','real teacher overlap stays blocked');
reset role;
rollback to teacher_conflict;

set local role service_role;
select lives_ok('select pg_temp.approve_fixed(510)','fixed JS producer passes final approval consumer with three makeups');
reset role;
set constraints all immediate;set constraints all deferred;
select is((select status from public.makeup_requests where id=pg_temp.sid(3)),'completed','cancel/makeup approval advances request state');
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.fixture()->'after','exact producer output is persisted');
select is((select schedule_plan#>'{sessions,0}' from public.classes where id=pg_temp.sid(4)),pg_temp.fixture()#>'{plan,sessions,0}','existing incomplete historical session is byte-for-byte preserved');
select is((select schedule_plan#>'{sessions,1,textbookEntries}' from public.classes where id=pg_temp.sid(4)),pg_temp.fixture()#>'{plan,sessions,1,textbookEntries}','canceled original lesson content is preserved');
select is((select schedule_plan#>>'{sessions,1,teacherCatalogId}' from public.classes where id=pg_temp.sid(4)),pg_temp.sid(9)::text,'historical exception teacher is not replaced by current defaults');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2050-10-06') x where x->>'classId'=pg_temp.sid(4)::text),2,'real occupancy reader retains both same-day makeups');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2050-10-08') x where x->>'classId'=pg_temp.sid(4)::text),1,'real occupancy reader retains the other-date makeup');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2050-10-07') x where x->>'classId'=pg_temp.sid(4)::text),0,'real cancellation suppresses original date only');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2050-10-14') x where x->>'classId'=pg_temp.sid(4)::text),1,'next recurring week is preserved');
create temp table after_counts as select (select count(*) from public.academic_events) calendars,(select count(*) from public.makeup_request_events) events;
set local role service_role;
select lives_ok('select pg_temp.approve_fixed(510)','same mutation key replays successfully');
reset role;
select is((select count(*) from public.academic_events),(select calendars from after_counts),'replay creates no duplicate calendar events');
select is((select count(*) from public.makeup_request_events),(select events from after_counts),'replay creates no duplicate request events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from before_counts),'approval does not dispatch notification deliveries');
select ok(not has_function_privilege('anon','public.transition_makeup_request_v2(uuid,text,jsonb,text,uuid)','execute'),'anonymous approval remains forbidden');
select ok(not has_function_privilege('authenticated','dashboard_private.read_timetable_operating_reference_v1()','execute'),'private reference remains private');
set local role service_role;
select lives_ok($$select public.transition_makeup_request_v2(pg_temp.sid(3),'approval_canceled',jsonb_build_object('note','Synthetic approval cancellation'),'completed',pg_temp.sid(511))$$,'approval cancellation restores the original legacy plan');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.fixture()->'plan','approval cancellation restores exact original identities, resources and contents');
select is((select count(*) from public.academic_events),(select calendars from before_counts),'approval cancellation removes only its synthetic calendar effects');

-- Exact reviewed Oct 15 repair logic, exercised on synthetic data only.
-- Only the six literal content hashes are rebound to synthetic fixture hashes.
-- No production data, migration, guard, RPC, ACL or runner definition is changed.
set constraints all immediate; set constraints all deferred;
create function pg_temp.repair_template() returns text language sql immutable as $tpl$
select $reviewed$do $repair$
declare
 c public.classes;
 r public.makeup_requests;
 s jsonb;
 next_plan jsonb;
 event_payload jsonb;
 event_meta jsonb;
 idx bigint;
 n bigint;
 added constant jsonb := '{"startTime":"15:00","endTime":"17:00","teacherCatalogId":"539275aa-060c-4a2d-9c31-11f9b831bc65","teacherName":"한지현","classroomCatalogId":"eb612df2-2f4c-40f1-ae0e-fb18c7303e52","classroomName":"별관 6강"}'::jsonb;
 sid constant text := 'session:004:2026-10-15:period-1782719919639-7:2026-10-14:makeup';
begin
 select * into strict c from public.classes
 where id='1b2a31dd-c137-4983-9963-75d224a68845' for update;
 select * into strict r from public.makeup_requests
 where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7' for update;
 if c.schedule_storage_mode is distinct from 'legacy'
 or c.schedule_revision is distinct from 0
 or c.status is distinct from '수강' or c.closed_at is not null
 or md5(c.schedule_plan::text) is distinct from '3a16c919c667598e1b95ed170c2b846d'
 or r.class_id is distinct from c.id or r.status is distinct from 'completed'
 or r.updated_at is distinct from '2026-09-22 09:00:47.359084+00'::timestamptz
 or r.schedule_plan_after is distinct from c.schedule_plan
 or md5(r.schedule_plan_before::text) is distinct from '4d410d7dd44ab52c9fe0f3bbe4e4a7a1'
 or md5(jsonb_build_array(r.id,r.class_id,r.status,r.cancel_date,r.makeup_start_at,r.makeup_end_at,r.makeup_classroom,r.teacher_catalog_id,r.makeup_slots,r.approved_at,r.makeup_academic_event_id,r.makeup_academic_event_ids,r.schedule_plan_after)::text)
    is distinct from '05c610f69eaf50abbba0d0d0a0e7a6b4' then
   raise exception using errcode='P0001',message='reviewed_repair_source_changed';
 end if;
 if (select count(*) from public.makeup_requests where class_id=c.id)<>1 then
   raise exception using errcode='P0001',message='reviewed_repair_other_request_present';
 end if;
 select count(*) into n from jsonb_array_elements(c.schedule_plan->'sessions') x
 where x->>'id'=sid or x->>'date'='2026-10-15';
 if n<>1 then raise exception using errcode='P0001',message='reviewed_repair_session_ambiguous';end if;
 select x,ord-1 into strict s,idx
 from jsonb_array_elements(c.schedule_plan->'sessions') with ordinality e(x,ord)
 where x->>'id'=sid;
 if idx<>59 or md5(s::text) is distinct from '77e3b941c822b4df60eecaad923d292c'
 or s->>'sessionKey' is distinct from sid or s->>'date' is distinct from '2026-10-15'
 or s->>'originalDate' is distinct from '2026-10-14'
 or s->>'scheduleState' is distinct from 'makeup' or s->>'state' is distinct from 'makeup'
 or s ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'] then
   raise exception using errcode='P0001',message='reviewed_repair_row_changed';
 end if;
 select payload into strict event_payload from public.makeup_request_events
 where id='1ace6f8a-c215-4be0-9bd5-9352545cb604' and request_id=r.id
 and event_type='approved' and created_at='2026-09-22 09:00:47.359084+00'::timestamptz for share;
 if event_payload->>'makeup_request_id' is distinct from r.id::text
 or event_payload->>'cancel_date' is distinct from '2026-10-14'
 or event_payload->>'teacher_name' is distinct from '한지현'
 or event_payload->>'makeup_room' is distinct from '별관 6강'
 or event_payload->'makeup_schedule' is distinct from
 '[{"place":"별관 6강","end_at":"2026-10-15T17:00:00+09:00","start_at":"2026-10-15T15:00:00+09:00"}]'::jsonb then
   raise exception using errcode='P0001',message='reviewed_repair_approval_evidence_changed';
 end if;
 select substring(note from position('[[TIPS_MAKEUP]]' in note)+length('[[TIPS_MAKEUP]]'))::jsonb
 into strict event_meta from public.academic_events
 where id='9481dde4-9783-4589-afa6-28dbcc3c85f6'
 and date='2026-10-15' and position('[[TIPS_MAKEUP]]' in note)>0 for share;
 if event_meta->>'requestId' is distinct from r.id::text
 or event_meta->>'kind' is distinct from 'makeup' or event_meta->>'slotIndex' is distinct from '0'
 or event_meta->>'startAt' is distinct from '2026-10-15T15:00:00+09:00'
 or event_meta->>'endAt' is distinct from '2026-10-15T17:00:00+09:00'
 or event_meta->>'classroom' is distinct from '별관 6강' then
   raise exception using errcode='P0001',message='reviewed_repair_calendar_evidence_changed';
 end if;
 perform 1 from public.teacher_catalogs where id='539275aa-060c-4a2d-9c31-11f9b831bc65' and name='한지현' for share;
 if not found then raise exception using errcode='P0001',message='reviewed_repair_teacher_changed';end if;
 perform 1 from public.classroom_catalogs where id='eb612df2-2f4c-40f1-ae0e-fb18c7303e52' and name='별관 6강' for share;
 if not found or (select count(*) from public.classroom_catalogs where name='별관 6강')<>1 then
   raise exception using errcode='P0001',message='reviewed_repair_room_changed';end if;
 next_plan:=jsonb_set(c.schedule_plan,array['sessions',idx::text],s||added,false);
 if md5(next_plan::text) is distinct from 'b8e1e0b44abae3fe16173217d6bc40c9'
 or md5((s||added)::text) is distinct from '77557876ec293be525c87d5e1678e2d1'
 or jsonb_set(next_plan,array['sessions',idx::text],(next_plan#>array['sessions',idx::text])-array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'],false) is distinct from c.schedule_plan then
   raise exception using errcode='P0001',message='reviewed_repair_delta_unexpected';end if;
 -- Keep the pre-repair full plan in the unchanged normal audit before-snapshot.
 perform set_config('app.class_schedule_class_id',c.id::text,true);
 perform set_config('app.class_schedule_request_operation','repair_legacy_makeup_occupancy_20261004',true);
 perform set_config('app.class_schedule_change_reason','Restore six missing occupancy fields from approved event 1ace6f8a-c215-4be0-9bd5-9352545cb604; synchronize operational cancellation snapshot',true);
 update public.classes set schedule_plan=next_plan where id=c.id and schedule_plan=c.schedule_plan;
 get diagnostics n=row_count;
 if n<>1 then raise exception using errcode='P0001',message='reviewed_repair_class_race';end if;
 update public.makeup_requests set schedule_plan_after=next_plan
 where id=r.id and status='completed' and schedule_plan_after=c.schedule_plan and updated_at=r.updated_at;
 get diagnostics n=row_count;
 if n<>1 then raise exception using errcode='P0001',message='reviewed_repair_request_race';end if;
 if not exists(select 1 from public.classes x join public.makeup_requests m on m.class_id=x.id
 where x.id=c.id and m.id=r.id and x.schedule_plan=m.schedule_plan_after
 and m.schedule_plan_before=r.schedule_plan_before and m.status=r.status) then
   raise exception using errcode='P0001',message='reviewed_repair_cancel_contract_changed';end if;
 raise notice 'Reviewed two-row repair prepared; class %, session %, before %, after %',c.id,sid,'3a16c919c667598e1b95ed170c2b846d','b8e1e0b44abae3fe16173217d6bc40c9';
end $repair$;$reviewed$;
$tpl$;
create function pg_temp.repair_added() returns jsonb language sql immutable as $$
select '{"startTime":"15:00","endTime":"17:00","teacherCatalogId":"539275aa-060c-4a2d-9c31-11f9b831bc65","teacherName":"한지현","classroomCatalogId":"eb612df2-2f4c-40f1-ae0e-fb18c7303e52","classroomName":"별관 6강"}'::jsonb
$$;
insert into public.teacher_catalogs(id,name,subjects) values('539275aa-060c-4a2d-9c31-11f9b831bc65','한지현',array['수학']);
insert into public.classroom_catalogs(id,name,subjects) values('eb612df2-2f4c-40f1-ae0e-fb18c7303e52','별관 6강',array['수학']);
create temp table repair_plans as
with fillers as (
 select jsonb_agg(jsonb_build_object('id','synthetic-retained-'||n,'date',(date '2025-01-01'+n)::text,'state','skipped','scheduleState','skipped','teacherNote','synthetic retained content') order by n) rows
 from generate_series(0,57) n
), target as (
 select '{"id":"session:004:2026-10-15:period-1782719919639-7:2026-10-14:makeup","sessionKey":"session:004:2026-10-15:period-1782719919639-7:2026-10-14:makeup","date":"2026-10-15","state":"makeup","scheduleState":"makeup","originalDate":"2026-10-14","isForced":false,"teacherNote":"synthetic retained lesson content","textbookEntries":[{"textbookId":"synthetic","actual":{"start":3,"end":7}}]}'::jsonb row
), original as (
 select jsonb_build_object('id','synthetic-original','sessionKey','synthetic-original','date','2026-10-14','state','active','scheduleState','active','isForced',false)||pg_temp.repair_added() row
)
select jsonb_build_object('subject','수학','className','Synthetic source-bound repair','selectedDays',jsonb_build_array(3),'sessions',f.rows||jsonb_build_array(o.row)) before_plan,
 jsonb_build_object('subject','수학','className','Synthetic source-bound repair','selectedDays',jsonb_build_array(3),'sessions',f.rows||jsonb_build_array(o.row||'{"state":"exception","scheduleState":"exception"}'::jsonb,t.row)) old_plan
from fillers f cross join target t cross join original o;
alter table repair_plans add column new_plan jsonb;
update repair_plans set new_plan=jsonb_set(old_plan,'{sessions,59}',(old_plan#>'{sessions,59}')||pg_temp.repair_added());
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
select '1b2a31dd-c137-4983-9963-75d224a68845','Synthetic source-bound repair','수학','한지현','별관 6강','수 15:00-17:00','수강','legacy',old_plan from repair_plans;
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,teacher_catalog_id,approver_profile_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots,schedule_plan_before,schedule_plan_after,approved_at,updated_at,makeup_academic_event_id,makeup_academic_event_ids)
select 'e2b20c00-c1a0-4d5e-924b-2f662aced7b7','completed','cancel_makeup','수학','math_high',pg_temp.sid(901),'1b2a31dd-c137-4983-9963-75d224a68845','Synthetic source-bound repair','539275aa-060c-4a2d-9c31-11f9b831bc65',pg_temp.sid(901),'2026-10-14','2026-10-15T15:00:00+09:00','2026-10-15T17:00:00+09:00','별관 6강',
 '[{"startAt":"2026-10-15T15:00:00+09:00","endAt":"2026-10-15T17:00:00+09:00","classroom":"별관 6강"}]',before_plan,old_plan,'2026-09-22 09:00:48.164079+00','2026-09-22 09:00:47.359084+00','9481dde4-9783-4589-afa6-28dbcc3c85f6','["9481dde4-9783-4589-afa6-28dbcc3c85f6"]' from repair_plans;
insert into public.makeup_request_events(id,request_id,event_type,created_at,payload)
values('1ace6f8a-c215-4be0-9bd5-9352545cb604','e2b20c00-c1a0-4d5e-924b-2f662aced7b7','approved','2026-09-22 09:00:47.359084+00',
'{"makeup_request_id":"e2b20c00-c1a0-4d5e-924b-2f662aced7b7","cancel_date":"2026-10-14","teacher_name":"한지현","makeup_room":"별관 6강","makeup_schedule":[{"place":"별관 6강","start_at":"2026-10-15T15:00:00+09:00","end_at":"2026-10-15T17:00:00+09:00"}]}');
insert into public.academic_events(id,title,date,type,grade,note)
values('9481dde4-9783-4589-afa6-28dbcc3c85f6','Synthetic repair makeup','2026-10-15','팁스','all','[[TIPS_MAKEUP]] {"requestId":"e2b20c00-c1a0-4d5e-924b-2f662aced7b7","kind":"makeup","slotIndex":0,"startAt":"2026-10-15T15:00:00+09:00","endAt":"2026-10-15T17:00:00+09:00","classroom":"별관 6강"}');
-- Two preexisting, fully unknown past lessons on one date remain outside the Oct 15 scope.
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
select pg_temp.sid(n),'Synthetic unresolved history '||n,'영어','Synthetic historical teacher','Synthetic historical room','금 15:30-17:00','수강','legacy',
 jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','past-'||n,'date','2026-10-02','state','active','scheduleState','active','isForced',false))) from generate_series(71,72) n;
-- Fixture setup only: recognize these preexisting invalid rows as the baseline.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table repair_hash_map as
select * from (values
 ('3a16c919c667598e1b95ed170c2b846d',md5((select old_plan::text from repair_plans))),
 ('4d410d7dd44ab52c9fe0f3bbe4e4a7a1',md5((select before_plan::text from repair_plans))),
 ('77e3b941c822b4df60eecaad923d292c',md5((select (old_plan#>'{sessions,59}')::text from repair_plans))),
 ('b8e1e0b44abae3fe16173217d6bc40c9',md5((select new_plan::text from repair_plans))),
 ('77557876ec293be525c87d5e1678e2d1',md5((select (new_plan#>'{sessions,59}')::text from repair_plans))),
 ('05c610f69eaf50abbba0d0d0a0e7a6b4',(select md5(jsonb_build_array(r.id,r.class_id,r.status,r.cancel_date,r.makeup_start_at,r.makeup_end_at,r.makeup_classroom,r.teacher_catalog_id,r.makeup_slots,r.approved_at,r.makeup_academic_event_id,r.makeup_academic_event_ids,r.schedule_plan_after)::text) from public.makeup_requests r where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'))
) hashes(reviewed,synthetic);
create function pg_temp.run_reviewed_repair() returns void language plpgsql as $fn$
declare stmt text:=pg_temp.repair_template(); h record;
begin
 perform dashboard_private.lock_timetable_operating_resources_v1();
 for h in select * from repair_hash_map loop stmt:=replace(stmt,quote_literal(h.reviewed),quote_literal(h.synthetic));end loop;
 execute stmt;
 set constraints all immediate;set constraints all deferred;
end $fn$;
create function pg_temp.repair_cancel(key_number int) returns void language plpgsql as $fn$
begin
 perform public.transition_makeup_request_v2('e2b20c00-c1a0-4d5e-924b-2f662aced7b7','approval_canceled','{"note":"Synthetic repair cancellation"}','completed',pg_temp.sid(key_number));
 set constraints all immediate;set constraints all deferred;
end $fn$;
create function pg_temp.set_repair_pair(p jsonb) returns void language plpgsql as $fn$
begin
 perform dashboard_private.lock_timetable_operating_resources_v1();
 update public.classes set schedule_plan=p where id='1b2a31dd-c137-4983-9963-75d224a68845';
 update public.makeup_requests set schedule_plan_after=p where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7';
 set constraints all immediate;set constraints all deferred;
end $fn$;
create temp table repair_counts as select
 (select count(*) from public.academic_events) calendars,
 (select count(*) from public.makeup_request_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select jsonb_agg(jsonb_build_array(id,schedule_plan) order by id) from public.classes where id in(pg_temp.sid(71),pg_temp.sid(72))) history;
select is((select count(*)::int from repair_hash_map),6,'only six reviewed content hashes rebound for synthetic data');

-- Class-only repair is a concrete cancellation regression; rollback this fixture branch.
savepoint class_only;
update public.classes set schedule_plan=(select new_plan from repair_plans) where id='1b2a31dd-c137-4983-9963-75d224a68845';
set constraints all immediate;set constraints all deferred;
set local role service_role;
select throws_ok('select pg_temp.repair_cancel(601)','P0001','makeup_schedule_plan_stale','class-only repair breaks the actual final cancellation RPC');
reset role;
rollback to class_only;

savepoint stale_source;
update public.makeup_requests set makeup_classroom='Synthetic changed source' where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7';
select throws_ok('select pg_temp.run_reviewed_repair()','P0001','reviewed_repair_source_changed','stale reviewed source aborts before repair');
rollback to stale_source;

-- Exercise transaction rollback after the complete forward repair and deferred guard.
savepoint before_reviewed_repair;
select lives_ok('select pg_temp.run_reviewed_repair()','exact reviewed repair passes real deferred guard');
select is((select schedule_plan from public.classes where id='1b2a31dd-c137-4983-9963-75d224a68845'),(select new_plan from repair_plans),'forward class plan is exactly the six-field delta');
select ok((select c.schedule_plan=r.schedule_plan_after from public.classes c join public.makeup_requests r on r.class_id=c.id where r.id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),'forward repair synchronizes operational cancellation snapshot');
rollback to before_reviewed_repair;
select is((select schedule_plan from public.classes where id='1b2a31dd-c137-4983-9963-75d224a68845'),(select old_plan from repair_plans),'transaction rollback restores exact old class plan');
select is((select schedule_plan_after from public.makeup_requests where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),(select old_plan from repair_plans),'transaction rollback restores exact old request snapshot');

select lives_ok('select pg_temp.run_reviewed_repair()','forward repair succeeds independently of other-date unresolved history');
select is((select schedule_plan_before from public.makeup_requests where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),(select before_plan from repair_plans),'approval before-snapshot unchanged');
select is((select status from public.makeup_requests where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),'completed','repair does not transition request status');
select is((select approved_at from public.makeup_requests where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),'2026-09-22 09:00:48.164079+00'::timestamptz,'approval timestamp unchanged');
select is((select count(*) from public.academic_events),(select calendars from repair_counts),'repair leaves calendar records unchanged');
select is((select count(*) from public.makeup_request_events),(select events from repair_counts),'repair leaves immutable request events unchanged');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from repair_counts),'repair creates no notification deliveries');
select is((select jsonb_agg(jsonb_build_array(id,schedule_plan) order by id) from public.classes where id in(pg_temp.sid(71),pg_temp.sid(72))),(select history from repair_counts),'other-date historical rows remain exactly unchanged');
select throws_ok('select pg_temp.run_reviewed_repair()','P0001','reviewed_repair_source_changed','already repaired source fails closed on a second invocation');
select throws_ok('select pg_temp.set_repair_pair((select old_plan from repair_plans))','23P01','timetable_resource_conflict','inverse to missing metadata is correctly blocked by actual guard');
select is((select schedule_plan from public.classes where id='1b2a31dd-c137-4983-9963-75d224a68845'),(select new_plan from repair_plans),'rejected inverse atomically retains valid class plan');
select is((select schedule_plan_after from public.makeup_requests where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),(select new_plan from repair_plans),'rejected inverse atomically retains valid request snapshot');

-- Compensation is a new complete known occupancy, not a return to invalid history.
savepoint compensating_correction;
select lives_ok($$select pg_temp.set_repair_pair(jsonb_set(jsonb_set((select new_plan from repair_plans),'{sessions,59,startTime}','"17:00"'),'{sessions,59,endTime}','"18:00"'))$$,'reviewed forward compensation with complete nonconflicting occupancy remains possible');
set local role service_role;
select lives_ok('select pg_temp.repair_cancel(602)','actual cancellation also works after synchronized compensation');
reset role;
rollback to compensating_correction;

set local role service_role;
select lives_ok('select pg_temp.repair_cancel(603)','actual final cancellation RPC succeeds with repaired paired snapshot');
reset role;
select is((select schedule_plan from public.classes where id='1b2a31dd-c137-4983-9963-75d224a68845'),(select before_plan from repair_plans),'cancellation restores original before-plan exactly');
select is((select status from public.makeup_requests where id='e2b20c00-c1a0-4d5e-924b-2f662aced7b7'),'canceled','normal cancellation status transition is preserved');
select ok(not exists(select 1 from public.academic_events where id='9481dde4-9783-4589-afa6-28dbcc3c85f6'),'normal cancellation removes its own calendar event');
select is((select count(*) from public.academic_events),(select calendars-1 from repair_counts),'normal cancellation leaves other calendar records intact');

create function pg_temp.partial_history_repair() returns void language plpgsql as $fn$
begin
 update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0}',(schedule_plan#>'{sessions,0}')||jsonb_build_object('startTime','15:30','endTime','17:00','teacherCatalogId',pg_temp.sid(9),'classroomCatalogId',pg_temp.sid(8))) where id=pg_temp.sid(71);
 set constraints all immediate;set constraints all deferred;
end $fn$;
select throws_ok('select pg_temp.partial_history_repair()','23P01','timetable_resource_conflict','known historical candidate cannot be isolated while same-date fully unknown row remains');
select is((select jsonb_agg(jsonb_build_array(id,schedule_plan) order by id) from public.classes where id in(pg_temp.sid(71),pg_temp.sid(72))),(select history from repair_counts),'blocked partial historical repair is atomic');

select * from finish();
rollback;
