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


-- Subject policy fixtures only; no real account identifiers or live data.
insert into auth.users(id,instance_id,aud,role,email)
select pg_temp.sid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','director-'||n||'@synthetic.invalid' from generate_series(902,909)n;
insert into public.profiles(id,role,name)
select pg_temp.sid(n),case when n=903 or n=907 then 'teacher' when n=905 then 'staff' when n=908 then 'viewer' when n=909 then 'assistant' else 'admin' end,'Synthetic actor '||n from generate_series(902,909)n
on conflict(id) do update set role=excluded.role;
delete from public.teacher_catalogs where profile_id in(select pg_temp.sid(n) from generate_series(902,909)n);
insert into public.teacher_catalogs(id,name,subjects,profile_id,is_visible)
select pg_temp.sid(n-890),'Synthetic catalog '||n,array[case when n=903 then '과학' when n=904 then '수학' else '영어' end],pg_temp.sid(n),true from generate_series(902,909)n;
update public.profiles set teacher_catalog_id=case when id=pg_temp.sid(901) then pg_temp.sid(1) else pg_temp.sid(right(id::text,12)::int-890) end
 where id in(select pg_temp.sid(n) from generate_series(901,909)n);
insert into dashboard_private.makeup_subject_directors_v1 values
 ('영어',pg_temp.sid(901),pg_temp.sid(1)),('영어',pg_temp.sid(902),pg_temp.sid(12)),
 ('과학',pg_temp.sid(903),pg_temp.sid(13)),('수학',pg_temp.sid(904),pg_temp.sid(14));
create function pg_temp.actor(n int,claim text default 'authenticated') returns void language sql as $f$
 select set_config('request.jwt.claim.sub',pg_temp.sid(n)::text,true),set_config('request.jwt.claim.role',claim,true),set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.sid(n),'role',claim)::text,true)
$f$;
create function pg_temp.decide(n int,keyn int,command text default 'approve',expected text default 'approval_pending') returns jsonb language sql as $f$
 select public.transition_makeup_request_v2(pg_temp.sid(3),command,
 case when command='approve' then (pg_temp.fixture()->'patch')||jsonb_build_object('actor_profile_id',pg_temp.sid(n)) else jsonb_build_object('note','Synthetic decision') end,
 expected,pg_temp.sid(keyn))
$f$;

select ok(not has_table_privilege('authenticated','dashboard_private.makeup_subject_directors_v1','select'),'end user cannot read director identity table');
select ok(not has_table_privilege('service_role','dashboard_private.makeup_subject_directors_v1','update'),'service role cannot edit director membership');
select ok(not has_function_privilege('authenticated','dashboard_private.makeup_request_director_v1(uuid,uuid)','execute'),'private arbitrary actor check not exposed');
select ok(not has_function_privilege('anon','public.get_makeup_director_capability_v1(uuid)','execute'),'anonymous capability forbidden');
select ok(has_function_privilege('authenticated','public.get_makeup_director_capability_v1(uuid)','execute'),'current authenticated actor may read own capability');
select ok(not has_function_privilege('authenticated','public.get_makeup_director_dispatch_authorization_v1(uuid,uuid)','execute'),'dispatch guard is not end-user API');
select ok(has_function_privilege('service_role','public.get_makeup_director_dispatch_authorization_v1(uuid,uuid)','execute'),'dispatch guard remains service-only');

select pg_temp.actor(902);set local role authenticated;
select is(public.get_my_makeup_director_subjects_v1(),'["영어"]'::jsonb,'same-subject second director has exactly own subject');
select ok(public.get_makeup_director_capability_v1(pg_temp.sid(3)),'other assigned director can decide same subject');
select throws_ok($q$select pg_temp.decide(902,601)$q$,'42501','makeup_approval_server_required','direct authenticated approval cannot bypass HTTP server');
reset role;
select pg_temp.actor(904);set local role authenticated;
select is(public.get_makeup_director_capability_v1(pg_temp.sid(3)),false,'math director cannot decide English');reset role;
select pg_temp.actor(n) from generate_series(905,909)n;
-- Check every ordinary role, independent of displayed approver identity.
select pg_temp.actor(906);set local role authenticated;
select is(public.get_my_makeup_director_subjects_v1(),'[]'::jsonb,'ordinary admin has no director scope');reset role;
select pg_temp.actor(907);set local role authenticated;
select is(public.get_makeup_director_capability_v1(pg_temp.sid(3)),false,'ordinary teacher cannot decide');reset role;
select pg_temp.actor(901,'service_role');set local role service_role;
select throws_ok(format('select pg_temp.decide(%s,%s)',n,600+n),'42501','makeup_request_transition_forbidden','non-director role or other subject denied: '||n) from generate_series(904,908)n;
select throws_ok('select pg_temp.decide(909,1509)','42501','makeup_request_assistant_forbidden','assistant remains denied by earlier guard');
reset role;


select pg_temp.actor(906);set local role authenticated;
select throws_ok($q$update public.makeup_requests set status='completed',approved_by=pg_temp.sid(906),approved_at=now() where id=pg_temp.sid(3)$q$,'42501','permission denied for table makeup_requests','ordinary admin cannot fabricate decision via raw table');
select throws_ok($q$insert into public.makeup_request_events(request_id,actor_id,event_type) values(pg_temp.sid(3),pg_temp.sid(906),'approved')$q$,'42501','permission denied for table makeup_request_events','ordinary admin cannot fabricate approval source event');
select throws_ok($q$delete from public.makeup_requests where id=pg_temp.sid(3)$q$,'42501','permission denied for table makeup_requests','raw deletion cannot bypass RPC');
reset role;
select ok(not has_any_column_privilege('authenticated','public.makeup_requests','update'),'no column-specific update grant remains');

savepoint revocation;
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.sid(902);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,602)$q$,'42501','makeup_request_transition_forbidden','banned director denied');reset role;rollback to revocation;
update public.teacher_catalogs set is_visible=false where id=pg_temp.sid(12);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,602)$q$,'42501','makeup_request_transition_forbidden','hidden catalog denied');reset role;rollback to revocation;
update public.profiles set teacher_catalog_id=null where id=pg_temp.sid(902);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,602)$q$,'42501','makeup_request_transition_forbidden','broken reciprocal link denied');reset role;rollback to revocation;
update public.classes set subject='수학' where id=pg_temp.sid(4);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,602)$q$,'P0001','makeup_request_source_changed','authorized director sees changed source contract');reset role;rollback to revocation;
update public.makeup_requests set class_id=null where id=pg_temp.sid(3);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,602)$q$,'P0001','makeup_request_source_changed','authorized director sees missing source contract');
select throws_ok(format('select pg_temp.decide(%s,602)',n),'42501','makeup_request_transition_forbidden','missing source does not reveal authority to non-director or other subject: '||n) from generate_series(904,907)n;
reset role;
delete from dashboard_private.makeup_subject_directors_v1 where profile_id=pg_temp.sid(902);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,602)$q$,'42501','makeup_request_transition_forbidden','revoked director cannot distinguish missing source');reset role;rollback to revocation;

-- A real teacher director exercises science approval through final functions.
savepoint science;
insert into public.academic_subject_settings(subject,grade_levels) values('과학',array['고1','고2','고3']) on conflict(subject) do nothing;
insert into public.academic_subject_areas(subject,area_key,label,sort_order,is_active) values('과학','integrated_science','가상 통합 과학',100,true) on conflict(subject,area_key) do update set is_active=true;
update public.classes set subject='과학',grade='고1',schedule_plan=replace(schedule_plan::text,'영어','과학')::jsonb,subject_area_key=(select area_key from public.academic_subject_areas where subject='과학' and is_active order by area_key limit 1) where id=pg_temp.sid(4);
update public.makeup_requests set subject='과학',approval_group='unknown',reason='SCIENCE_REVIEW_CANARY' where id=pg_temp.sid(3);
select pg_temp.actor(903);set local role authenticated;
select is(public.get_my_makeup_director_subjects_v1(),'["과학"]'::jsonb,'teacher director has science only');
select is(public.get_makeup_detail_v1(pg_temp.sid(3))->>'reason','SCIENCE_REVIEW_CANARY','teacher director receives necessary review reason');
select is(public.get_makeup_detail_v1(pg_temp.sid(3))->>'canDecideSubject','true','teacher director detail carries server capability');
select is(public.get_makeup_detail_v1(pg_temp.sid(3))->'schedulePlanBefore','{}'::jsonb,'director does not get raw schedule snapshot');
reset role;select pg_temp.actor(907);set local role authenticated;
select is(public.get_makeup_detail_v1(pg_temp.sid(3))->>'reason','','ordinary teacher reason remains redacted');reset role;
select pg_temp.actor(903,'service_role');set local role service_role;
select lives_ok($q$select public.transition_makeup_request_v2(pg_temp.sid(3),'approve',replace(((pg_temp.fixture()->'patch')||jsonb_build_object('actor_profile_id',pg_temp.sid(903)))::text,'영어','과학')::jsonb,'approval_pending',pg_temp.sid(603))$q$,'science teacher director successfully approves through final server boundary');
reset role;
select is((select approved_by from public.makeup_requests where id=pg_temp.sid(3)),pg_temp.sid(903),'actual teacher director recorded as decider');
select pg_temp.actor(903);set local role authenticated;
select lives_ok($q$select pg_temp.decide(903,604,'approval_canceled','completed')$q$,'science teacher director may cancel actual approval');reset role;
rollback to science;

select pg_temp.actor(902,'service_role');set local role service_role;
select lives_ok($q$select pg_temp.decide(902,610)$q$,'same-subject unassigned director approves actual schedule effects');reset role;
select is((select approved_by from public.makeup_requests where id=pg_temp.sid(3)),pg_temp.sid(902),'approved_by records actual second director');
create temp table approved_counts as select (select count(*) from public.academic_events) calendars,(select count(*) from public.makeup_request_events) events;
select pg_temp.actor(902,'service_role');set local role service_role;
select lives_ok($q$select pg_temp.decide(902,610)$q$,'same request key replays');
select throws_ok($q$select pg_temp.decide(901,610)$q$,'22023','idempotency_key_reused','another director cannot reuse receipt key');
select throws_ok($q$select pg_temp.decide(901,611)$q$,'P0001','makeup_request_stale_status','second director cannot approve completed state');reset role;
select is((select count(*) from public.academic_events),(select calendars from approved_counts),'replay and second approval add no schedule event');
select is((select count(*) from public.makeup_request_events),(select events from approved_counts),'replay and second approval add no source event');
savepoint receipt_revoke;
delete from dashboard_private.makeup_subject_directors_v1 where profile_id=pg_temp.sid(902);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,610)$q$,'42501','makeup_request_transition_forbidden','revoked director cannot retrieve old approval receipt');reset role;rollback to receipt_revoke;
update public.makeup_requests set class_id=null where id=pg_temp.sid(3);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,610)$q$,'P0001','makeup_request_source_changed','old receipt cannot bypass missing source');reset role;rollback to receipt_revoke;
update public.classes set subject='수학' where id=pg_temp.sid(4);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,610)$q$,'P0001','makeup_request_source_changed','old receipt cannot bypass changed source');reset role;rollback to receipt_revoke;
update public.makeup_requests set class_id=null where id=pg_temp.sid(3);
delete from dashboard_private.makeup_subject_directors_v1 where profile_id=pg_temp.sid(902);
select pg_temp.actor(902,'service_role');set local role service_role;
select throws_ok($q$select pg_temp.decide(902,610)$q$,'42501','makeup_request_transition_forbidden','revoked old receipt stays forbidden before missing-source disclosure');reset role;rollback to receipt_revoke;
select pg_temp.actor(902,'service_role');set local role service_role;
select ok(public.get_makeup_director_dispatch_authorization_v1(pg_temp.sid(902),(select id from public.makeup_request_events where request_id=pg_temp.sid(3) and event_type='approved' order by created_at desc limit 1)),'own director approval source passes narrow dispatch guard');
select is(public.get_makeup_director_dispatch_authorization_v1(pg_temp.sid(901),(select id from public.makeup_request_events where request_id=pg_temp.sid(3) and event_type='approved' order by created_at desc limit 1)),false,'other director cannot dispatch another actor source');
reset role;

-- Management may retain factual notes, but only the subject director closes it.
insert into dashboard_private.teacher_request_changes_v1(id,domain,request_id,requester_id,kind,note)
 values(pg_temp.sid(700),'makeup',pg_temp.sid(3),pg_temp.sid(901),'cancel_request','Synthetic cancel request');
create temp table change_revision as select md5(to_jsonb(c)::text) rev from dashboard_private.teacher_request_changes_v1 c where id=pg_temp.sid(700);
grant select on change_revision to authenticated;
select pg_temp.actor(905);set local role authenticated;
select is(public.get_teacher_request_changes_v1('makeup')->'rows'->0->>'canResolve','false','manager cannot resolve makeup request');
select is(public.get_teacher_request_changes_v1('makeup')->'rows'->0->>'canRecordProgress','true','manager can record progress');
select lives_ok($q$select public.resolve_teacher_request_change_v1(pg_temp.sid(700),'noted','Synthetic progress',(select rev from change_revision),pg_temp.sid(701))$q$,'manager progress note accepted');
select throws_ok($q$select public.resolve_teacher_request_change_v1(pg_temp.sid(700),'confirmed','Synthetic decision',(select rev from change_revision),pg_temp.sid(702))$q$,'42501','teacher_request_forbidden','manager cannot confirm');
select throws_ok($q$select public.resolve_teacher_request_change_v1(pg_temp.sid(700),'rejected','Synthetic rejection',(select rev from change_revision),pg_temp.sid(703))$q$,'42501','teacher_request_forbidden','manager cannot reject');
reset role;
select is((select status from dashboard_private.teacher_request_changes_v1 where id=pg_temp.sid(700)),'pending','progress does not close pending request');
select is((select md5(to_jsonb(c)::text) from dashboard_private.teacher_request_changes_v1 c where id=pg_temp.sid(700)),(select rev from change_revision),'progress does not change decision revision');
select pg_temp.actor(902);set local role authenticated;
select is(public.get_teacher_request_changes_v1('makeup')->'rows'->0->>'canResolve','true','same-subject second director may close change request');
select is(jsonb_array_length(public.get_teacher_request_changes_v1('makeup')->'rows'->0->'progressNotes'),1,'progress note retained separately');
select lives_ok($q$select public.resolve_teacher_request_change_v1(pg_temp.sid(700),'confirmed','Synthetic director decision',(select rev from change_revision),pg_temp.sid(704))$q$,'subject director can record own decision');
select lives_ok($q$select public.resolve_teacher_request_change_v1(pg_temp.sid(700),'confirmed','Synthetic director decision',(select rev from change_revision),pg_temp.sid(704))$q$,'same decision key replays');reset role;
select is((select status from public.makeup_requests where id=pg_temp.sid(3)),'completed','inbox decision does not itself reverse schedule');
select is((select count(*) from public.academic_events),(select calendars from approved_counts),'inbox decision creates no extra schedule event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from before_counts),'no actual notifications dispatched');
select pg_temp.actor(901);set local role authenticated;
select lives_ok($q$select pg_temp.decide(901,612,'approval_canceled','completed')$q$,'another director of same subject may cancel approval');reset role;
select is((select schedule_plan from public.classes where id=pg_temp.sid(4)),pg_temp.fixture()->'plan','cancel restores exact prior plan');
select is((select count(*) from public.academic_events),(select calendars from before_counts),'cancel removes only its own effects');
select * from finish();
rollback;
