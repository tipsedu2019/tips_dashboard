begin;
select plan(34);

create temp table worker_schedule_rule_snapshot as
select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_object('id', rule_row.id, 'enabled', rule_row.enabled, 'revision', rule_row.revision)
  order by rule_row.id
)::text, '[]')) as digest
from dashboard_private.notification_rules rule_row
where rule_row.workflow_key = 'registration'
  and rule_row.event_key like 'registration.observation_%';

select has_table('dashboard_private', 'notification_worker_stop_latch', 'worker stop latch exists');
select has_table('dashboard_private', 'notification_watchdog_heartbeats', 'watchdog heartbeat ledger exists');
select has_table('dashboard_private', 'notification_worker_schedule_requests', 'schedule request ledger exists');
select has_function('public', 'assert_notification_worker_run_allowed_v1', array['text'], 'worker gate exists');
select has_function('public', 'configure_notification_worker_secret_v1', array['text'], 'vault rotation RPC exists');
select has_function('public', 'manage_notification_worker_schedule_v1', array['text','uuid'], 'schedule manager exists');

select ok(
  (select proc.prosecdef and pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
   from pg_catalog.pg_proc proc
   where proc.oid = 'dashboard_private.invoke_notification_worker_v1()'::regprocedure)
  and (select proc.prosecdef and pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
       from pg_catalog.pg_proc proc
       where proc.oid = 'dashboard_private.run_notification_worker_watchdog_v1()'::regprocedure),
  'private worker functions are postgres-owned security definers'
);

select ok(
  (select pg_catalog.bool_and(class_row.relrowsecurity)
   from pg_catalog.pg_class class_row
   where class_row.oid in (
     'dashboard_private.notification_worker_stop_latch'::regclass,
     'dashboard_private.notification_watchdog_heartbeats'::regclass,
     'dashboard_private.notification_worker_schedule_requests'::regclass
   ))
  and not exists (
    select 1 from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'dashboard_private'
      and policy_row.tablename in (
        'notification_worker_stop_latch',
        'notification_watchdog_heartbeats',
        'notification_worker_schedule_requests'
      )
  ),
  'new ledgers use fail-closed RLS with no policies'
);

select ok(
  not has_table_privilege('anon', 'dashboard_private.notification_worker_stop_latch', 'select')
  and not has_table_privilege('authenticated', 'dashboard_private.notification_worker_stop_latch', 'select')
  and not has_table_privilege('service_role', 'dashboard_private.notification_worker_stop_latch', 'select')
  and not has_table_privilege('anon', 'dashboard_private.notification_watchdog_heartbeats', 'select')
  and not has_table_privilege('authenticated', 'dashboard_private.notification_watchdog_heartbeats', 'select')
  and not has_table_privilege('service_role', 'dashboard_private.notification_watchdog_heartbeats', 'select'),
  'API roles have no direct ledger read'
);

select is(
  (select pg_catalog.jsonb_build_object(
    'stopped', latch.stopped,
    'revision', latch.revision,
    'reason', latch.reason_code
  ) from dashboard_private.notification_worker_stop_latch latch where latch.latch_key = 'global'),
  '{"stopped":false,"revision":1,"reason":null}'::jsonb,
  'initial stop latch is open at revision one'
);

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.assert_notification_worker_run_allowed_v1('notification-worker-route-v1'),
  '{"allowed":true}'::jsonb,
  'service worker is allowed while latch is open'
);

select throws_ok(
  $$select public.assert_notification_worker_run_allowed_v1('wrong-worker')$$,
  '42501', 'notification_access_denied',
  'wrong worker identity fails closed'
);

select throws_ok(
  $$select public.configure_notification_worker_secret_v1('too-short')$$,
  '22023', 'notification_worker_secret_invalid',
  'short Vault secret is rejected'
);

select is(
  (select pg_catalog.count(*)
   from pg_catalog.jsonb_object_keys(
     public.manage_notification_worker_schedule_v1('inspect', 'a1000000-0000-4000-8000-000000000001'::uuid)
   )),
  11::bigint,
  'inspect response has the exact secret-free key count'
);

select is(
  public.manage_notification_worker_schedule_v1('inspect', 'a1000000-0000-4000-8000-000000000001'::uuid)
    - array['latestWorkerHeartbeatAt','latestWatchdogHeartbeatAt','latestWatchdogPhase']::text[],
  '{"workerCount":0,"watchdogCount":0,"workerActiveCount":0,"watchdogActiveCount":0,"workerContractCount":0,"watchdogContractCount":0,"vaultReady":false,"stopLatch":false}'::jsonb,
  'inspect is empty and Vault-not-ready before configuration'
);

select throws_ok(
  $$select public.manage_notification_worker_schedule_v1('install', 'a1000000-0000-4000-8000-000000000002'::uuid)$$,
  '55000', 'notification_worker_vault_contract_invalid',
  'install fails before Vault configuration'
);

select is(
  public.configure_notification_worker_secret_v1('schedule-test-secret-0123456789abcdef'),
  '{"ok":true}'::jsonb,
  'service role configures the fixed URL and synthetic secret'
);

select is(
  public.manage_notification_worker_schedule_v1('inspect', 'a1000000-0000-4000-8000-000000000003'::uuid) -> 'vaultReady',
  'true'::jsonb,
  'inspect exposes readiness without exposing Vault values'
);

select is(
  public.manage_notification_worker_schedule_v1('install', 'a1000000-0000-4000-8000-000000000004'::uuid)
    - array['latestWorkerHeartbeatAt','latestWatchdogHeartbeatAt','latestWatchdogPhase']::text[],
  '{"workerCount":1,"watchdogCount":1,"workerActiveCount":1,"watchdogActiveCount":1,"workerContractCount":1,"watchdogContractCount":1,"vaultReady":true,"stopLatch":false}'::jsonb,
  'install creates exactly one active worker and watchdog contract'
);

select is(
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', job.jobname, 'schedule', job.schedule, 'command', pg_catalog.btrim(job.command), 'active', job.active
  ) order by job.jobname)
  from cron.job job
  where job.jobname in ('tips-notification-worker-v1','tips-notification-cutover-watchdog-v1')),
  '[{"name":"tips-notification-cutover-watchdog-v1","schedule":"* * * * *","command":"select dashboard_private.run_notification_worker_watchdog_v1();","active":true},{"name":"tips-notification-worker-v1","schedule":"* * * * *","command":"select dashboard_private.invoke_notification_worker_v1();","active":true}]'::jsonb,
  'cron names schedules commands and active state are exact'
);

select is(
  public.manage_notification_worker_schedule_v1('install', 'a1000000-0000-4000-8000-000000000004'::uuid),
  (select request_row.response_payload from dashboard_private.notification_worker_schedule_requests request_row where request_row.request_id = 'a1000000-0000-4000-8000-000000000004'::uuid),
  'same request id replays the stored response'
);

select throws_ok(
  $$select public.manage_notification_worker_schedule_v1('disable', 'a1000000-0000-4000-8000-000000000004'::uuid)$$,
  '40001', 'notification_schedule_request_conflict',
  'same request id with a different action conflicts'
);

select is(
  (select snapshot.digest from worker_schedule_rule_snapshot snapshot),
  (select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id', rule_row.id, 'enabled', rule_row.enabled, 'revision', rule_row.revision)
    order by rule_row.id
  )::text, '[]'))
  from dashboard_private.notification_rules rule_row
  where rule_row.workflow_key = 'registration'
    and rule_row.event_key like 'registration.observation_%'),
  'schedule install does not change observation rules'
);

select is(
  dashboard_private.run_notification_worker_watchdog_v1(),
  '{"ok":false,"status":"worker_heartbeat_stale"}'::jsonb,
  'watchdog reports stale before the first worker success'
);

insert into dashboard_private.notification_worker_heartbeats(
  worker_id, run_id, phase, counts, error_code, created_at
) values
  ('notification-worker-route-v1','a2000000-0000-4000-8000-000000000001','started',
   '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}',null,pg_catalog.clock_timestamp()),
  ('notification-worker-route-v1','a2000000-0000-4000-8000-000000000001','succeeded',
   '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}',null,pg_catalog.clock_timestamp());

select is(
  dashboard_private.run_notification_worker_watchdog_v1(),
  '{"ok":true,"status":"healthy"}'::jsonb,
  'watchdog is healthy after a current exact-shape worker success'
);

update dashboard_private.notification_worker_stop_latch
set stopped = true, revision = 2, reason_code = 'test_latch'
where latch_key = 'global';

select is(
  public.assert_notification_worker_run_allowed_v1('notification-worker-route-v1'),
  '{"allowed":false,"reason":"worker_stop_latch"}'::jsonb,
  'stop latch blocks the worker route'
);

update dashboard_private.notification_worker_stop_latch
set stopped = false, revision = 3, reason_code = null
where latch_key = 'global';

select is(
  public.manage_notification_worker_schedule_v1('disable', 'a1000000-0000-4000-8000-000000000005'::uuid)
    -> 'workerActiveCount',
  '0'::jsonb,
  'disable makes the worker inactive'
);

select is(
  public.manage_notification_worker_schedule_v1('disable', 'a1000000-0000-4000-8000-000000000005'::uuid)
    -> 'watchdogActiveCount',
  '0'::jsonb,
  'disable makes the watchdog inactive'
);

select is(
  public.manage_notification_worker_schedule_v1('remove', 'a1000000-0000-4000-8000-000000000006'::uuid)
    -> 'workerCount',
  '0'::jsonb,
  'remove deletes the worker schedule'
);

select is(
  public.manage_notification_worker_schedule_v1('remove', 'a1000000-0000-4000-8000-000000000006'::uuid)
    -> 'watchdogCount',
  '0'::jsonb,
  'remove deletes the watchdog schedule'
);

select ok(
  not has_function_privilege('anon', 'public.assert_notification_worker_run_allowed_v1(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.assert_notification_worker_run_allowed_v1(text)', 'execute')
  and has_function_privilege('service_role', 'public.assert_notification_worker_run_allowed_v1(text)', 'execute')
  and not has_function_privilege('anon', 'public.manage_notification_worker_schedule_v1(text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.manage_notification_worker_schedule_v1(text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.manage_notification_worker_schedule_v1(text,uuid)', 'execute'),
  'public worker operations are service-role-only'
);

select ok(
  not has_function_privilege('anon', 'dashboard_private.invoke_notification_worker_v1()', 'execute')
  and not has_function_privilege('authenticated', 'dashboard_private.invoke_notification_worker_v1()', 'execute')
  and not has_function_privilege('service_role', 'dashboard_private.invoke_notification_worker_v1()', 'execute')
  and not has_function_privilege('anon', 'dashboard_private.run_notification_worker_watchdog_v1()', 'execute')
  and not has_function_privilege('authenticated', 'dashboard_private.run_notification_worker_watchdog_v1()', 'execute')
  and not has_function_privilege('service_role', 'dashboard_private.run_notification_worker_watchdog_v1()', 'execute'),
  'private worker execution helpers have no API execute grant'
);

select throws_ok(
  $$select public.manage_notification_worker_schedule_v1('unknown', 'a1000000-0000-4000-8000-000000000007'::uuid)$$,
  '22023', 'notification_schedule_management_invalid',
  'unknown schedule action is rejected'
);

select is(
  (select pg_catalog.count(*) from dashboard_private.notification_worker_schedule_requests),
  5::bigint,
  'only successful unique management requests are recorded'
);

select * from finish();
rollback;
