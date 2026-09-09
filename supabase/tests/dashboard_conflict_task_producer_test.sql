begin;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

select has_table('dashboard_private', 'dashboard_conflict_task_links',
  'historical conflict task links remain available for existing task records');
select ok(exists(
  select 1 from pg_catalog.pg_trigger
  where tgrelid = 'public.ops_tasks'::regclass
    and tgname = 'guard_dashboard_conflict_task_delete' and not tgisinternal
), 'historical linked tasks retain their deletion guard');

select ok(not pg_catalog.has_function_privilege(api_role, signature, 'EXECUTE'),
  api_role || ' cannot call retired ' || signature)
from unnest(array['anon', 'authenticated', 'service_role']) api_role
cross join unnest(array[
  'public.create_dashboard_conflict_task_v1(jsonb,uuid)',
  'dashboard_private.create_dashboard_conflict_task_v1_impl(jsonb,uuid)',
  'public.list_dashboard_conflict_task_links_v1(jsonb)'
]) signature;

select ok(pg_catalog.has_function_privilege('authenticated',
  'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)', 'EXECUTE'),
  'authenticated users keep the monitoring source RPC');

insert into public.classes(id, name, subject, teacher, schedule, room, status, student_ids)
values
  ('85000000-0000-4000-8000-000000000301', '모니터링 검증 A', '영어', '모니터링 선생님',
    '월 09:00-11:00', '본관 1강', '수업 진행 중', '[]'::jsonb),
  ('85000000-0000-4000-8000-000000000302', '모니터링 검증 B', '영어', '모니터링 선생님',
    '월 09:30-10:30', '본관 1강', '수업 진행 중', '[]'::jsonb);

create temporary table monitoring_conflicts as
select public.get_dashboard_statistics_sources_v1('schedule_conflicts') as payload;
select is((select count(*) from monitoring_conflicts
  cross join lateral jsonb_array_elements(payload -> 'teacherConflicts') conflict
  where conflict -> 'classIds' @> '["85000000-0000-4000-8000-000000000301","85000000-0000-4000-8000-000000000302"]'::jsonb),
  1::bigint, 'monitoring still detects the teacher overlap');
select is((select count(*) from monitoring_conflicts
  cross join lateral jsonb_array_elements(payload -> 'classroomConflicts') conflict
  where conflict -> 'classIds' @> '["85000000-0000-4000-8000-000000000301","85000000-0000-4000-8000-000000000302"]'::jsonb),
  1::bigint, 'monitoring still detects the classroom overlap');

create temporary table retired_conflict_counts as
select jsonb_build_object(
  'tasks', (select count(*) from public.ops_tasks),
  'links', (select count(*) from dashboard_private.dashboard_conflict_task_links),
  'taskEvents', (select count(*) from public.ops_task_events),
  'notificationEvents', (select count(*) from dashboard_private.notification_events),
  'fanoutJobs', (select count(*) from dashboard_private.notification_event_fanout_jobs),
  'deliveries', (select count(*) from dashboard_private.notification_deliveries)
) as payload;

select throws_ok(
  $$select public.create_dashboard_conflict_task_v1('{}', '85000000-0000-4000-8000-000000000401')$$,
  '0A000', 'dashboard_conflict_task_retired',
  'even a privileged stale caller cannot create a task through the final public body');
select throws_ok(
  $$select dashboard_private.create_dashboard_conflict_task_v1_impl('{}', '85000000-0000-4000-8000-000000000402')$$,
  '0A000', 'dashboard_conflict_task_retired',
  'the final private implementation also fails before any task or notification write');

set local role authenticated;
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1('{}', '85000000-0000-4000-8000-000000000403')$$,
  '42501', null, 'old browser sessions cannot call the retired creation RPC');
select throws_ok(
  $$select public.list_dashboard_conflict_task_links_v1('[]')$$,
  '42501', null, 'old browser sessions cannot call the retired task-link lookup');
reset role;

select is(jsonb_build_object(
  'tasks', (select count(*) from public.ops_tasks),
  'links', (select count(*) from dashboard_private.dashboard_conflict_task_links),
  'taskEvents', (select count(*) from public.ops_task_events),
  'notificationEvents', (select count(*) from dashboard_private.notification_events),
  'fanoutJobs', (select count(*) from dashboard_private.notification_event_fanout_jobs),
  'deliveries', (select count(*) from dashboard_private.notification_deliveries)
), (select payload from retired_conflict_counts),
  'retired calls preserve every historical task/link and produce no events, jobs or deliveries');

select * from finish();
rollback;
