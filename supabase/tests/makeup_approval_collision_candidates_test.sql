begin;
select no_plan();
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$ select ('ae000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.slots() returns jsonb language sql immutable as $$
 select '[{"startAt":"2026-10-02T09:00:00+09:00","endAt":"2026-10-02T10:00:00+09:00","classroom":"A"}]'::jsonb
$$;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(pg_temp.cid(800),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','collision-perf@test.invalid','{}','{}',now(),now());
insert into public.profiles(id,role,name) values(pg_temp.cid(800),'admin','fixture') on conflict(id) do update set role='admin';
insert into public.classes(id,name,subject,room,schedule) values
 (pg_temp.cid(701),'Friday','영어','A','금 09:00-10:00'),
 (pg_temp.cid(702),'Monday','영어','A','월 09:00-10:00'),
 (pg_temp.cid(703),'Override','영어','B','월금 09:00-10:00 (A)');
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,approver_profile_id,class_name,request_kind,reason,makeup_start_at,makeup_end_at,makeup_classroom)
select pg_temp.cid(n),'approval_pending','영어','english',pg_temp.cid(800),pg_temp.cid(800),'fixture','makeup_only','fixture',
 '2026-10-02T09:00:00+09:00','2026-10-02T10:00:00+09:00','A' from generate_series(1,6)n;
update public.makeup_requests set makeup_start_at='2026-10-01T09:00:00+09:00',makeup_end_at='2026-10-01T10:00:00+09:00' where id=pg_temp.cid(2);
update public.makeup_requests set makeup_start_at='2026-10-02T10:00:00+09:00',makeup_end_at='2026-10-02T11:00:00+09:00' where id=pg_temp.cid(3);
update public.makeup_requests set status='canceled' where id=pg_temp.cid(4);
update public.makeup_requests set makeup_slots='[{"startAt":"2026-10-02T09:00:00","endAt":"2026-10-02T10:00:00"}]' where id=pg_temp.cid(5);
update public.makeup_requests set makeup_slots='[{"startAt":"2026-10-02T08:59:59.9999999+09:00","endAt":"2026-10-02T09:00:00.0009999+09:00"}]' where id=pg_temp.cid(6);
insert into public.academic_events(id,title,date,type,note) values
 (pg_temp.cid(601),'overlap','2026-10-02','보강','[[TIPS_MAKEUP]] {"kind":"makeup","classroom":"A","startAt":"2026-10-02T00:00:00Z","endAt":"2026-10-02T01:00:00Z"}'),
 (pg_temp.cid(602),'old','2026-10-01','보강','[[TIPS_MAKEUP]] {"kind":"makeup","classroom":"A","startAt":"2026-10-01T00:00:00Z","endAt":"2026-10-01T01:00:00Z"}'),
 (pg_temp.cid(603),'legacy','2026-10-02','보강','[[TIPS_MAKEUP]] {"kind":"makeup","classroom":"A","startAt":"2026-10-02T09:00:00","endAt":"2026-10-02T10:00:00"}'),
 (pg_temp.cid(604),'malformed','2026-10-02','보강','[[TIPS_MAKEUP]] invalid'),
 (pg_temp.cid(605),'JS whitespace','2026-10-02','보강','[[TIPS_MAKEUP]] '||chr(160)||chr(65279)||'{"kind":"makeup","classroom":"A","startAt":"2026-10-02T00:00:00Z","endAt":"2026-10-02T01:00:00Z"}'||chr(160));
create temp table before_counts as select (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,(select count(*) from dashboard_private.notification_deliveries) deliveries;
select ok(not has_function_privilege('anon','public.get_makeup_approval_collision_context_v1(jsonb)','execute'),'anon cannot read server context');
select ok(not has_function_privilege('authenticated','public.get_makeup_approval_collision_context_v1(jsonb)','execute'),'authenticated cannot bypass row scope');
select ok((select not prosecdef and provolatile='s' from pg_proc where oid='public.get_makeup_approval_collision_context_v1(jsonb)'::regprocedure),'stable invoker does not change caller privileges');
set local role anon;
select throws_ok($$select public.get_makeup_approval_collision_context_v1('[]')$$,'42501',null,'anon exact SQLSTATE');
reset role;
set local role authenticated;
select throws_ok($$select public.get_makeup_approval_collision_context_v1('[]')$$,'42501',null,'authenticated exact SQLSTATE');
reset role;
set local role service_role;
select lives_ok($$select public.get_makeup_approval_collision_context_v1(pg_temp.slots())$$,'service role executes entire pure-helper chain');
select throws_ok($$select public.get_makeup_approval_collision_context_v1('{}')$$,'22023','makeup_reservation_request_invalid','invalid shape exact SQLSTATE');
select throws_ok($$select public.get_makeup_approval_collision_context_v1('[{}]')$$,'22023','makeup_reservation_request_invalid','invalid slot exact SQLSTATE');
select is(public.get_makeup_approval_collision_context_v1('[]'),' {"classes":[],"requests":[],"academicEvents":[]}'::jsonb,'no slots read no candidates');
select is((select jsonb_agg(r->>'id' order by r->>'id') from jsonb_array_elements(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'requests')r),
 jsonb_build_array(pg_temp.cid(1),pg_temp.cid(5),pg_temp.cid(6)),'pending plus legacy and high precision survive, historical adjacent inactive excluded');
select is((select jsonb_agg(r->>'id' order by r->>'id') from jsonb_array_elements(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'classes')r),
 jsonb_build_array(pg_temp.cid(701),pg_temp.cid(703)),'weekly candidates preserve room overrides and multi-day schedules');
select is((select jsonb_agg(r->>'id' order by r->>'id') from jsonb_array_elements(public.get_makeup_approval_collision_context_v1(pg_temp.slots())->'academicEvents')r),
 jsonb_build_array(pg_temp.cid(601),pg_temp.cid(603),pg_temp.cid(605)),'dated events narrowed; legacy raw note and JS whitespace retained');
select is(jsonb_array_length(public.get_makeup_approval_collision_context_v1('[{"startAt":"2026-10-02T09:00:00","endAt":"2026-10-02T10:00:00"}]')->'classes'),3,'ambiguous target retains candidates instead of assuming timezone');
reset role;
create temp table initial_payload as select public.get_makeup_approval_collision_context_v1(pg_temp.slots()) value;
-- Growth contains valid but unrelated historical reservations/events and weekly
-- classes. Their payload contribution must stay zero at both 1k and 10k.
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,approver_profile_id,class_name,request_kind,reason,makeup_start_at,makeup_end_at,makeup_classroom)
select pg_temp.cid(n),'completed','영어','english',pg_temp.cid(800),pg_temp.cid(800),'old','makeup_only','fixture','2025-01-01T00:00:00Z','2025-01-01T01:00:00Z','A' from generate_series(1000,1999)n;
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots()),(select value from initial_payload),'1000 unrelated reservations do not change payload');
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,approver_profile_id,class_name,request_kind,reason,makeup_start_at,makeup_end_at,makeup_classroom)
select pg_temp.cid(n),'completed','영어','english',pg_temp.cid(800),pg_temp.cid(800),'old','makeup_only','fixture','2025-01-01T00:00:00Z','2025-01-01T01:00:00Z','A' from generate_series(2000,10999)n;
insert into public.classes(id,name,subject,room,schedule) select pg_temp.cid(n),'other day','영어','A','월 09:00-10:00' from generate_series(20000,20999)n;
insert into public.academic_events(id,title,date,type,note) select pg_temp.cid(n),'old','2025-01-01','보강',
 '[[TIPS_MAKEUP]] {"kind":"makeup","classroom":"A","startAt":"2025-01-01T00:00:00Z","endAt":"2025-01-01T01:00:00Z"}' from generate_series(30000,30999)n;
select is(public.get_makeup_approval_collision_context_v1(pg_temp.slots()),(select value from initial_payload),'10000 historical reservations and 2000 unrelated classes/events do not change payload');
select is((select count(*) from dashboard_private.notification_events),(select events from before_counts),'no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),(select jobs from before_counts),'no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from before_counts),'no provider deliveries');
select * from finish();
rollback;
