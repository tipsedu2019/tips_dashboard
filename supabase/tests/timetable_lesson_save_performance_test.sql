begin;
select no_plan();
-- Synthetic global workload, larger than the production aggregate at diagnosis.
-- No production class, teacher, room, student or learning-content rows are copied.
create function pg_temp.pid(n int) returns uuid language sql immutable as $$select ('ae290000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.day(n int) returns date language sql stable as $$select (now() at time zone 'Asia/Seoul')::date+7+((n-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.pid(1),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lesson-performance@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.pid(1),'admin','synthetic performance') on conflict(id) do update set role='admin';
select set_config('request.jwt.claim.sub',pg_temp.pid(1)::text,true);
insert into public.teacher_catalogs(id,name,subjects) select pg_temp.pid(100+n),'perf teacher '||n,array['영어'] from generate_series(0,83)n;
insert into public.classroom_catalogs(id,name,subjects) select pg_temp.pid(200+n),'perf room '||n,array['영어'] from generate_series(0,83)n;
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan)
select pg_temp.pid(1000+n),'perf class '||n,'영어','수강','legacy','화 19:20-21:20; 일 15:00-17:00','perf teacher '||n,'perf room '||n,
 jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object('id','session-'||w||'-'||dow,'date',pg_temp.day(dow)+w*7,'scheduleState','active','state','active','isForced',false,'originalDate','','makeupDate','','memo',repeat('synthetic history ',40)) order by w,dow) from generate_series(-32,31)w cross join (values(2),(0))days(dow)))
from generate_series(0,83)n;
-- Owner-only fixture establishes historical incomplete rows; the tested RPC uses
-- real authentication, locks, compare-and-swap, receipts and deferred triggers.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table before_save as select schedule_plan plan from public.classes where id=pg_temp.pid(1000);
create temp table no_send as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries;
create temp table proposed as select jsonb_set(plan,'{sessions}',
 (select jsonb_agg(case when s->>'date' in(pg_temp.day(2)::text,pg_temp.day(0)::text) then s||'{"scheduleState":"exception","state":"exception"}' else s end order by ord) from jsonb_array_elements(plan->'sessions') with ordinality entries(s,ord))
 ||jsonb_build_array(jsonb_build_object('id','makeup','date',pg_temp.day(5),'scheduleState','makeup','state','makeup','startTime','19:20','endTime','21:20','teacherCatalogId',pg_temp.pid(100),'classroomCatalogId',pg_temp.pid(200)))) plan from before_save;
grant select on before_save,proposed to authenticated;
create function pg_temp.save() returns void language plpgsql as $$begin
 perform public.update_class_operational_v1(pg_temp.pid(1000),jsonb_build_object('schedule_plan',(select plan from proposed)),pg_temp.pid(3000),(select plan from before_save));
 set constraints all immediate;set constraints all deferred;
end$$;
create temp table timing(started timestamptz);
insert into timing values(clock_timestamp());
set local statement_timeout='8s';
set local role authenticated;
select lives_ok('select pg_temp.save()','global-workload authenticated save AND deferred validation complete within the real 8-second budget');
reset role;
select diag('save_and_deferred_ms='||(extract(epoch from clock_timestamp()-(select started from timing))*1000)::numeric(12,2));
select is((select schedule_plan from public.classes where id=pg_temp.pid(1000)),(select plan from proposed),'complete proposed schedule reads back');
set local role authenticated;
select lives_ok('select pg_temp.save()','same request is idempotent even with the original expected plan');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'schedule save creates no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'schedule save sends no notification');
select ok(not has_function_privilege('authenticated','dashboard_private.timetable_effective_date_v1(jsonb,date)','execute'),'effective-date helper stays private');
select ok(not has_function_privilege('authenticated','dashboard_private.assert_timetable_operational_conflicts_v1()','execute'),'conflict guard stays private');
select * from finish();
rollback;
