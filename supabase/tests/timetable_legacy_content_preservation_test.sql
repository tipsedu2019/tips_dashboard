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
select * from finish();
rollback;
