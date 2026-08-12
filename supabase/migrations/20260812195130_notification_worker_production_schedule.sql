begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if pg_catalog.to_regclass('dashboard_private.notification_worker_stop_latch') is not null
    or pg_catalog.to_regclass('dashboard_private.notification_watchdog_heartbeats') is not null
    or pg_catalog.to_regclass('dashboard_private.notification_worker_schedule_requests') is not null
    or pg_catalog.to_regprocedure('public.assert_notification_worker_run_allowed_v1(text)') is not null
    or pg_catalog.to_regprocedure('public.manage_notification_worker_schedule_v1(text,uuid)') is not null
    or pg_catalog.to_regprocedure('public.notification_workflow_adapters_runtime_version()') is null
    or public.notification_workflow_adapters_runtime_version() <> 1
    or pg_catalog.to_regprocedure('public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)') is null
    or pg_catalog.to_regclass('dashboard_private.notification_worker_heartbeats') is null
    or pg_catalog.to_regclass('dashboard_private.notification_rules') is null
    or pg_catalog.to_regclass('vault.decrypted_secrets') is null
    or pg_catalog.to_regclass('cron.job') is null
    or pg_catalog.to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
  then
    raise exception 'notification_worker_production_schedule_preflight_failed'
      using errcode = '55000';
  end if;
end;
$$;

create table dashboard_private.notification_worker_stop_latch (
  latch_key text primary key,
  stopped boolean not null default false,
  revision bigint not null default 1,
  reason_code text,
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  constraint notification_worker_stop_latch_key_check check (latch_key = 'global'),
  constraint notification_worker_stop_latch_revision_check check (revision > 0),
  constraint notification_worker_stop_latch_reason_check check (
    (stopped and nullif(pg_catalog.btrim(reason_code), '') is not null)
    or (not stopped and reason_code is null)
  )
);

insert into dashboard_private.notification_worker_stop_latch(
  latch_key, stopped, revision, reason_code
) values ('global', false, 1, null);

create table dashboard_private.notification_watchdog_heartbeats (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  phase text not null,
  faults_detected integer not null default 0,
  error_code text,
  created_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_watchdog_heartbeats_phase_check
    check (phase in ('started', 'succeeded', 'failed', 'skipped')),
  constraint notification_watchdog_heartbeats_fault_check check (faults_detected >= 0),
  constraint notification_watchdog_heartbeats_error_check check (
    (phase = 'failed' and nullif(pg_catalog.btrim(error_code), '') is not null)
    or (phase <> 'failed' and error_code is null)
  ),
  unique (run_id, phase)
);

create unique index notification_watchdog_heartbeats_run_terminal_uidx
  on dashboard_private.notification_watchdog_heartbeats(run_id)
  where phase in ('succeeded', 'failed', 'skipped');

create table dashboard_private.notification_worker_schedule_requests (
  request_id uuid primary key,
  action text not null,
  response_payload jsonb not null,
  created_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_worker_schedule_requests_action_check
    check (action in ('inspect', 'install', 'disable', 'remove')),
  constraint notification_worker_schedule_requests_response_check
    check (pg_catalog.jsonb_typeof(response_payload) = 'object')
);

alter table dashboard_private.notification_worker_stop_latch enable row level security;
alter table dashboard_private.notification_watchdog_heartbeats enable row level security;
alter table dashboard_private.notification_worker_schedule_requests enable row level security;

revoke all on table dashboard_private.notification_worker_stop_latch
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_watchdog_heartbeats
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_worker_schedule_requests
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.validate_notification_worker_vault_values_v1(
  p_url text,
  p_secret text
) returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when nullif(pg_catalog.btrim(p_url), '') is null
      or nullif(pg_catalog.btrim(p_secret), '') is null
      then pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'worker_vault_value_missing')
    when pg_catalog.octet_length(p_secret) < 32
      or pg_catalog.octet_length(p_secret) > 256
      or p_secret <> pg_catalog.btrim(p_secret)
      or p_secret ~ '[[:space:][:cntrl:]]'
      then pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'worker_secret_invalid')
    when p_url not in (
      'https://tipsedu.co.kr/api/notifications/worker',
      'https://tipsdashboard.vercel.app/api/notifications/worker'
    )
      then pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'worker_url_policy_mismatch')
    else pg_catalog.jsonb_build_object('ok', true)
  end;
$$;

create or replace function dashboard_private.read_notification_worker_vault_contract_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_url_count integer;
  v_secret_count integer;
begin
  execute $query$
    select
      pg_catalog.min(decrypted_secret) filter (where name = 'notification_worker_url'),
      pg_catalog.min(decrypted_secret) filter (where name = 'notification_worker_bearer_secret'),
      pg_catalog.count(*) filter (where name = 'notification_worker_url')::integer,
      pg_catalog.count(*) filter (where name = 'notification_worker_bearer_secret')::integer
    from vault.decrypted_secrets
    where name in ('notification_worker_url', 'notification_worker_bearer_secret')
  $query$ into v_url, v_secret, v_url_count, v_secret_count;
  if v_url_count <> 1 or v_secret_count <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'worker_vault_value_ambiguous');
  end if;
  return dashboard_private.validate_notification_worker_vault_values_v1(v_url, v_secret);
exception
  when others then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'worker_vault_read_failed');
end;
$$;

create or replace function dashboard_private.invoke_notification_worker_v1()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_url_count integer;
  v_secret_count integer;
  v_contract jsonb;
  v_request_id bigint;
begin
  if exists (
    select 1
    from dashboard_private.notification_worker_stop_latch latch
    where latch.latch_key = 'global' and latch.stopped
  ) then
    raise exception 'notification_worker_stopped' using errcode = '55000';
  end if;
  execute $query$
    select
      pg_catalog.min(decrypted_secret) filter (where name = 'notification_worker_url'),
      pg_catalog.min(decrypted_secret) filter (where name = 'notification_worker_bearer_secret'),
      pg_catalog.count(*) filter (where name = 'notification_worker_url')::integer,
      pg_catalog.count(*) filter (where name = 'notification_worker_bearer_secret')::integer
    from vault.decrypted_secrets
    where name in ('notification_worker_url', 'notification_worker_bearer_secret')
  $query$ into v_url, v_secret, v_url_count, v_secret_count;
  if v_url_count <> 1 or v_secret_count <> 1 then
    raise exception 'notification_worker_vault_value_ambiguous' using errcode = '55000';
  end if;
  v_contract := dashboard_private.validate_notification_worker_vault_values_v1(v_url, v_secret);
  if coalesce((v_contract ->> 'ok')::boolean, false) is not true then
    raise exception 'notification_worker_vault_contract_invalid' using errcode = '55000';
  end if;
  select net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json',
      'X-Notification-Contract-Version', '2'
    ),
    body := pg_catalog.jsonb_build_object('batch_size', 50, 'lease_seconds', 60),
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function dashboard_private.run_notification_worker_watchdog_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_latest dashboard_private.notification_worker_heartbeats%rowtype;
begin
  insert into dashboard_private.notification_watchdog_heartbeats(
    run_id, phase, faults_detected, error_code
  ) values (v_run_id, 'started', 0, null);
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-worker-watchdog-v1', 0)
  ) then
    insert into dashboard_private.notification_watchdog_heartbeats(
      run_id, phase, faults_detected, error_code
    ) values (v_run_id, 'skipped', 0, null);
    return pg_catalog.jsonb_build_object('ok', true, 'status', 'lease_not_acquired');
  end if;
  select heartbeat.* into v_latest
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.worker_id = 'notification-worker-route-v1'
  order by heartbeat.created_at desc, heartbeat.id desc
  limit 1;
  if not found
    or v_latest.phase <> 'succeeded'
    or v_latest.created_at < pg_catalog.clock_timestamp() - interval '3 minutes'
  then
    insert into dashboard_private.notification_watchdog_heartbeats(
      run_id, phase, faults_detected, error_code
    ) values (v_run_id, 'failed', 1, 'worker_heartbeat_stale');
    return pg_catalog.jsonb_build_object('ok', false, 'status', 'worker_heartbeat_stale');
  end if;
  insert into dashboard_private.notification_watchdog_heartbeats(
    run_id, phase, faults_detected, error_code
  ) values (v_run_id, 'succeeded', 0, null);
  return pg_catalog.jsonb_build_object('ok', true, 'status', 'healthy');
exception
  when others then
    insert into dashboard_private.notification_watchdog_heartbeats(
      run_id, phase, faults_detected, error_code
    ) values (v_run_id, 'failed', 1, 'watchdog_execution_failed')
    on conflict do nothing;
    return pg_catalog.jsonb_build_object('ok', false, 'status', 'watchdog_execution_failed');
end;
$$;

create or replace function dashboard_private.inspect_notification_schedules_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vault jsonb;
  v_latest_worker timestamp with time zone;
  v_latest_watchdog dashboard_private.notification_watchdog_heartbeats%rowtype;
  v_latch boolean;
  v_result jsonb;
begin
  v_vault := dashboard_private.read_notification_worker_vault_contract_v1();
  select latch.stopped into strict v_latch
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global';
  select pg_catalog.max(heartbeat.created_at) into v_latest_worker
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.worker_id = 'notification-worker-route-v1'
    and heartbeat.phase = 'succeeded';
  select heartbeat.* into v_latest_watchdog
  from dashboard_private.notification_watchdog_heartbeats heartbeat
  order by heartbeat.created_at desc, heartbeat.id desc
  limit 1;
  select pg_catalog.jsonb_build_object(
    'workerCount', pg_catalog.count(*) filter (where job.jobname = 'tips-notification-worker-v1'),
    'watchdogCount', pg_catalog.count(*) filter (where job.jobname = 'tips-notification-cutover-watchdog-v1'),
    'workerActiveCount', pg_catalog.count(*) filter (where job.jobname = 'tips-notification-worker-v1' and job.active),
    'watchdogActiveCount', pg_catalog.count(*) filter (where job.jobname = 'tips-notification-cutover-watchdog-v1' and job.active),
    'workerContractCount', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-worker-v1'
        and job.schedule = '* * * * *'
        and pg_catalog.btrim(job.command) = 'select dashboard_private.invoke_notification_worker_v1();'
    ),
    'watchdogContractCount', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-cutover-watchdog-v1'
        and job.schedule = '* * * * *'
        and pg_catalog.btrim(job.command) = 'select dashboard_private.run_notification_worker_watchdog_v1();'
    ),
    'vaultReady', coalesce((v_vault ->> 'ok')::boolean, false),
    'stopLatch', v_latch,
    'latestWorkerHeartbeatAt', case when v_latest_worker is null then null else pg_catalog.to_char(v_latest_worker at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'latestWatchdogHeartbeatAt', case when v_latest_watchdog.id is null then null else pg_catalog.to_char(v_latest_watchdog.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'latestWatchdogPhase', v_latest_watchdog.phase
  ) into v_result
  from cron.job job
  where job.jobname in ('tips-notification-worker-v1', 'tips-notification-cutover-watchdog-v1');
  return v_result;
end;
$$;

create or replace function public.assert_notification_worker_run_allowed_v1(
  p_worker_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role'
    or p_worker_id is distinct from 'notification-worker-route-v1'
  then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if exists (
    select 1
    from dashboard_private.notification_worker_stop_latch latch
    where latch.latch_key = 'global' and latch.stopped
  ) then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'worker_stop_latch');
  end if;
  return pg_catalog.jsonb_build_object('allowed', true);
end;
$$;

create or replace function public.configure_notification_worker_secret_v1(
  p_secret text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url constant text := 'https://tipsdashboard.vercel.app/api/notifications/worker';
  v_url_id uuid;
  v_secret_id uuid;
  v_url_count integer;
  v_secret_count integer;
  v_contract jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  v_contract := dashboard_private.validate_notification_worker_vault_values_v1(v_url, p_secret);
  if coalesce((v_contract ->> 'ok')::boolean, false) is not true then
    raise exception 'notification_worker_secret_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-worker-vault-v1', 0)
  );
  select secret.id into v_url_id
  from vault.secrets secret
  where secret.name = 'notification_worker_url'
  order by secret.id limit 1;
  select pg_catalog.count(*)::integer into v_url_count
  from vault.secrets secret where secret.name = 'notification_worker_url';
  select secret.id into v_secret_id
  from vault.secrets secret
  where secret.name = 'notification_worker_bearer_secret'
  order by secret.id limit 1;
  select pg_catalog.count(*)::integer into v_secret_count
  from vault.secrets secret where secret.name = 'notification_worker_bearer_secret';
  if v_url_count > 1 or v_secret_count > 1 then
    raise exception 'notification_worker_vault_value_ambiguous' using errcode = '55000';
  end if;
  if v_url_id is null then
    perform vault.create_secret(v_url, 'notification_worker_url', 'TIPS notification worker URL');
  else
    perform vault.update_secret(
      secret_id => v_url_id,
      new_secret => v_url,
      new_name => 'notification_worker_url',
      new_description => 'TIPS notification worker URL'
    );
  end if;
  if v_secret_id is null then
    perform vault.create_secret(p_secret, 'notification_worker_bearer_secret', 'TIPS notification worker bearer secret');
  else
    perform vault.update_secret(
      secret_id => v_secret_id,
      new_secret => p_secret,
      new_name => 'notification_worker_bearer_secret',
      new_description => 'TIPS notification worker bearer secret'
    );
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.manage_notification_worker_schedule_v1(
  p_action text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing dashboard_private.notification_worker_schedule_requests%rowtype;
  v_job record;
  v_vault jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('inspect', 'install', 'disable', 'remove')
    or p_request_id is null
  then
    raise exception 'notification_schedule_management_invalid' using errcode = '22023';
  end if;
  select request_row.* into v_existing
  from dashboard_private.notification_worker_schedule_requests request_row
  where request_row.request_id = p_request_id
  for update of request_row;
  if found then
    if v_existing.action <> p_action then
      raise exception 'notification_schedule_request_conflict' using errcode = '40001';
    end if;
    return v_existing.response_payload;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-worker-schedule-v1', 0)
  );
  if p_action = 'install' then
    if exists (
      select 1
      from dashboard_private.notification_rules rule_row
      where rule_row.workflow_key = 'registration'
        and rule_row.event_key like 'registration.observation_%'
        and rule_row.enabled
    ) then
      raise exception 'notification_schedule_install_requires_observation_rules_off'
        using errcode = '55000';
    end if;
    v_vault := dashboard_private.read_notification_worker_vault_contract_v1();
    if coalesce((v_vault ->> 'ok')::boolean, false) is not true then
      raise exception 'notification_worker_vault_contract_invalid' using errcode = '55000';
    end if;
  end if;
  if p_action in ('install', 'remove') then
    for v_job in
      select job.jobid from cron.job job
      where job.jobname in ('tips-notification-worker-v1', 'tips-notification-cutover-watchdog-v1')
      order by job.jobid
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;
  end if;
  if p_action = 'install' then
    perform cron.schedule(
      'tips-notification-worker-v1',
      '* * * * *',
      $command$select dashboard_private.invoke_notification_worker_v1();$command$
    );
    perform cron.schedule(
      'tips-notification-cutover-watchdog-v1',
      '* * * * *',
      $command$select dashboard_private.run_notification_worker_watchdog_v1();$command$
    );
  elsif p_action = 'disable' then
    for v_job in
      select job.jobid from cron.job job
      where job.jobname in ('tips-notification-worker-v1', 'tips-notification-cutover-watchdog-v1')
      order by job.jobid
    loop
      perform cron.alter_job(v_job.jobid, active := false);
    end loop;
  end if;
  v_response := dashboard_private.inspect_notification_schedules_v1();
  insert into dashboard_private.notification_worker_schedule_requests(
    request_id, action, response_payload
  ) values (p_request_id, p_action, v_response);
  return v_response;
end;
$$;

alter function dashboard_private.validate_notification_worker_vault_values_v1(text,text) owner to postgres;
alter function dashboard_private.read_notification_worker_vault_contract_v1() owner to postgres;
alter function dashboard_private.invoke_notification_worker_v1() owner to postgres;
alter function dashboard_private.run_notification_worker_watchdog_v1() owner to postgres;
alter function dashboard_private.inspect_notification_schedules_v1() owner to postgres;
alter function public.assert_notification_worker_run_allowed_v1(text) owner to postgres;
alter function public.configure_notification_worker_secret_v1(text) owner to postgres;
alter function public.manage_notification_worker_schedule_v1(text,uuid) owner to postgres;

revoke all on function dashboard_private.validate_notification_worker_vault_values_v1(text,text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.read_notification_worker_vault_contract_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.invoke_notification_worker_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.run_notification_worker_watchdog_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.inspect_notification_schedules_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.assert_notification_worker_run_allowed_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.configure_notification_worker_secret_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.manage_notification_worker_schedule_v1(text,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.assert_notification_worker_run_allowed_v1(text)
  to service_role;
grant execute on function public.configure_notification_worker_secret_v1(text)
  to service_role;
grant execute on function public.manage_notification_worker_schedule_v1(text,uuid)
  to service_role;

commit;
