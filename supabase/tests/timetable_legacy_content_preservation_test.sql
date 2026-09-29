begin;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values('ac240000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-content@test.invalid');
insert into public.profiles(id,role,name) values('ac240000-0000-4000-8000-000000000001','admin','legacy content') on conflict(id) do update set role='admin';
select set_config('request.jwt.claim.sub','ac240000-0000-4000-8000-000000000001',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan) values('ac240000-0000-4000-8000-000000000100','legacy content','영어','개강 준비','legacy','{"sessions":[{"id":"original","sessionKey":"original","date":"2026-10-05","scheduleState":"active","textbookEntries":[],"progressStatus":"대기"}]}');
-- Historical incomplete occupancy is seeded only in the owner fixture, then all
-- real triggers and constraints run against that baseline for tested writes.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table legacy_before as select dashboard_private.read_timetable_operating_reference_v1() ref;
select is((select count(*)::int from legacy_before,jsonb_array_elements(ref->'datedUnresolvedOccupancies') x where x->>'classId'='ac240000-0000-4000-8000-000000000100'),1,'incomplete legacy dated occupancy remains a blocker');
create function pg_temp.content_write() returns void language plpgsql as $$declare prior jsonb;begin
 select schedule_plan into prior from public.classes where id='ac240000-0000-4000-8000-000000000100';
 perform public.update_class_operational_v1('ac240000-0000-4000-8000-000000000100',jsonb_build_object('schedule_plan',jsonb_set(jsonb_set(prior,'{sessions,0,textbookEntries}','[{"textbookId":"book","progress":"done"}]'),'{sessions,0,progressStatus}','"완료"')),'ac240000-0000-4000-8000-000000000200',prior);
 set constraints all immediate;set constraints all deferred;
end$$;
set local role authenticated;
select lives_ok('select pg_temp.content_write()','actual authenticated content save and deferred occupancy guard succeed');
reset role;
select is(dashboard_private.read_timetable_operating_reference_v1(),(select ref from legacy_before),'textbook and progress edits preserve the complete reference and fingerprint');
select is((select schedule_plan#>>'{sessions,0,progressStatus}' from public.classes where id='ac240000-0000-4000-8000-000000000100'),'완료','progress is persisted');
select is((select schedule_plan#>'{sessions,0,textbookEntries}' from public.classes where id='ac240000-0000-4000-8000-000000000100'),'[{"textbookId":"book","progress":"done"}]'::jsonb,'textbook content is persisted without rewriting originals');
select throws_ok($q$select public.update_class_operational_v1('ac240000-0000-4000-8000-000000000100',jsonb_build_object('schedule_plan',jsonb_set(schedule_plan,'{sessions,0,date}','"2026-10-06"')),'ac240000-0000-4000-8000-000000000201',schedule_plan) from public.classes where id='ac240000-0000-4000-8000-000000000100'$q$,'23P01','timetable_resource_conflict','a real occupancy change still fails closed with exact SQLSTATE');
select is((select schedule_plan#>>'{sessions,0,date}' from public.classes where id='ac240000-0000-4000-8000-000000000100'),'2026-10-05','rejected occupancy change preserves the original date');
select lives_ok($q$insert into auth.users(id,instance_id,aud,role,email) values('ac240000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-signup@test.invalid');set constraints all immediate$q$,'signup catalog trigger preserves existing incomplete occupancy');

-- Legacy schedule edits use the same content-preserving operational RPC.
set constraints all deferred;
create function pg_temp.sid(n int) returns uuid language sql immutable as $$select ('ac290000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.day(n int) returns date language sql stable as $$select (now() at time zone 'Asia/Seoul')::date+7+((n-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.sid(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-save@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.sid(901),'admin','legacy save fixture') on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.sid(101),'legacy save teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.sid(201),'legacy save room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
(pg_temp.sid(301),'legacy save fixture','영어','수강','legacy','화 19:20-21:20; 일 15:00-17:00','legacy save teacher','legacy save room',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','history','date','2026-03-31','scheduleState','active','state','active','isForced',false,'originalDate','','makeupDate','','sessionNumber',1,'billingLabel','4월','teacherNote','retained history'),
 jsonb_build_object('id','cancel','date',pg_temp.day(2),'scheduleState','active','state','active','isForced',false,'originalDate','','makeupDate','')
)));
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate; set constraints all deferred;
create temp table original as select schedule_plan plan from public.classes where id=pg_temp.sid(301);
create temp table no_send as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
create function pg_temp.save(p jsonb,n int) returns jsonb language sql as $$select public.update_class_operational_v1(pg_temp.sid(301),jsonb_build_object('schedule_plan',p),pg_temp.sid(n),(select schedule_plan from public.classes where id=pg_temp.sid(301)))$$;
create function pg_temp.plan(cancelled boolean,makeup boolean) returns jsonb language sql as $$
 select jsonb_build_object('sessions',jsonb_build_array(
  (select plan->'sessions'->0 from original)||jsonb_build_object('sessionKey','history','billingColor','#abcdef'),
  (select plan->'sessions'->1 from original)||jsonb_build_object('scheduleState',case when cancelled then 'exception' else 'active' end,'state',case when cancelled then 'exception' else 'active' end,'sessionKey','cancel')
 )||case when makeup then jsonb_build_array(jsonb_build_object('id','makeup','sessionKey','makeup','date',pg_temp.day(5),'scheduleState','makeup','state','makeup','isForced',true,'startTime','19:20','endTime','21:20','teacherCatalogId',pg_temp.sid(101),'classroomCatalogId',pg_temp.sid(201))) else '[]'::jsonb end)
$$;
grant select on original to authenticated;
set local role authenticated;
select lives_ok($q$select pg_temp.save(pg_temp.plan(false,false),501)$q$,'unchanged historical occupancy allows new session key and billing metadata');
select lives_ok($q$select pg_temp.save(pg_temp.plan(true,false),502)$q$,'legacy exception is a cancellation without required time fields');
reset role;
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),pg_temp.day(2)) s where s->>'classId'=pg_temp.sid(301)::text),0,'legacy cancellation removes weekly occupancy on exactly its date');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),pg_temp.day(2)+7) s where s->>'classId'=pg_temp.sid(301)::text),1,'next recurring week remains occupied');
set local role authenticated;
select lives_ok($q$select pg_temp.save(pg_temp.plan(true,true),503)$q$,'explicit makeup retains time and resources and saves with cancellation');
select is((select schedule_plan#>>'{sessions,2,startTime}' from public.classes where id=pg_temp.sid(301)),'19:20','saved makeup time reads back');
select is((select schedule_plan#>>'{sessions,0,teacherNote}' from public.classes where id=pg_temp.sid(301)),'retained history','historical learning note remains unchanged');
select throws_ok($q$select pg_temp.save(jsonb_set(pg_temp.plan(true,true),'{sessions,2}',(pg_temp.plan(true,true)#>'{sessions,2}')-'startTime'),504)$q$,'23P01','timetable_resource_conflict','new ambiguous makeup remains blocked with exact SQLSTATE');
select throws_ok($q$select pg_temp.save(jsonb_set(pg_temp.plan(true,true),'{sessions,2,date}',to_jsonb(pg_temp.day(2)+7)),505)$q$,'23P01','timetable_resource_conflict','real same-class teacher and room overlap remains blocked');
select throws_ok($q$select pg_temp.save(jsonb_set(pg_temp.plan(true,true),'{sessions,0,date}','"2026-03-30"'),506)$q$,'23P01','timetable_resource_conflict','changing unknown historical occupancy is still blocked');
reset role;
set constraints all immediate; set constraints all deferred;
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'no notification delivery');
select ok(not has_function_privilege('authenticated','dashboard_private.read_timetable_operating_reference_v1()','execute'),'private reference ACL remains restricted');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),'security definer and empty search path preserved');
select * from finish();
rollback;
