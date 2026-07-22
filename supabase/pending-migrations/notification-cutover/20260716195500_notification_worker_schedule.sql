begin;

set local lock_timeout = '5s';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists dashboard_private;

create table dashboard_private.notification_worker_stop_latch (
  latch_key text primary key,
  stopped boolean not null default false,
  revision bigint not null default 1,
  reason_code text,
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  constraint notification_worker_stop_latch_key_check
    check (latch_key = 'global'),
  constraint notification_worker_stop_latch_revision_check
    check (revision > 0),
  constraint notification_worker_stop_latch_reason_check
    check (
      (stopped and reason_code is not null and pg_catalog.btrim(reason_code) <> '')
      or (not stopped and reason_code is null)
    )
);

insert into dashboard_private.notification_worker_stop_latch(
  latch_key, stopped, revision, reason_code
)
values ('global', false, 1, null);

create table dashboard_private.notification_worker_health_probes (
  worker_id text primary key,
  succeeded_at timestamp with time zone not null,
  constraint notification_worker_health_probes_worker_check
    check (
      pg_catalog.btrim(worker_id) <> ''
      and pg_catalog.octet_length(worker_id) <= 96
    )
);

create table dashboard_private.notification_watchdog_heartbeats (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  phase text not null,
  faults_detected integer not null default 0,
  rollbacks_applied integer not null default 0,
  error_code text,
  created_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_watchdog_heartbeats_phase_check
    check (phase in ('started', 'succeeded', 'failed', 'skipped')),
  constraint notification_watchdog_heartbeats_count_check
    check (faults_detected >= 0 and rollbacks_applied >= 0),
  constraint notification_watchdog_heartbeats_error_check
    check (
      (phase = 'failed' and error_code is not null and pg_catalog.btrim(error_code) <> '')
      or (phase <> 'failed' and error_code is null)
    ),
  unique (run_id, phase)
);

create unique index notification_watchdog_heartbeats_run_terminal_uidx
  on dashboard_private.notification_watchdog_heartbeats(run_id)
  where phase in ('succeeded', 'failed', 'skipped');

create table dashboard_private.notification_schedule_configuration (
  config_key text primary key,
  approved_worker_host text,
  revision bigint not null default 1,
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  constraint notification_schedule_configuration_key_check
    check (config_key = 'global'),
  constraint notification_schedule_configuration_host_check
    check (
      approved_worker_host is null
      or approved_worker_host ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    ),
  constraint notification_schedule_configuration_revision_check
    check (revision > 0)
);

insert into dashboard_private.notification_schedule_configuration(
  config_key, approved_worker_host, revision
)
values ('global', null, 1);

create table dashboard_private.notification_cutover_owners (
  scope_key text primary key,
  workflow_key text not null,
  dispatch_flag_key text not null unique,
  owner_kind text not null default 'legacy',
  revision bigint not null default 1,
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  constraint notification_cutover_owners_scope_check
    check (scope_key in (
      'tasks', 'word_retests', 'approvals', 'transfer', 'withdrawal',
      'makeup_requests', 'registration', 'registration_phone',
      'registration_visit', 'registration_solapi'
    )),
  constraint notification_cutover_owners_workflow_check
    check (workflow_key in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )),
  constraint notification_cutover_owners_owner_check
    check (owner_kind in ('legacy', 'canonical')),
  constraint notification_cutover_owners_revision_check
    check (revision > 0)
);

insert into dashboard_private.notification_cutover_owners(
  scope_key, workflow_key, dispatch_flag_key, owner_kind
)
values
  ('tasks', 'tasks', 'notification_control_plane_dispatch_tasks_enabled', 'legacy'),
  ('word_retests', 'word_retests', 'notification_control_plane_dispatch_word_retests_enabled', 'legacy'),
  ('approvals', 'approvals', 'notification_control_plane_dispatch_approvals_enabled', 'legacy'),
  ('transfer', 'transfer', 'notification_control_plane_dispatch_transfer_enabled', 'legacy'),
  ('withdrawal', 'withdrawal', 'notification_control_plane_dispatch_withdrawal_enabled', 'legacy'),
  ('makeup_requests', 'makeup_requests', 'notification_control_plane_dispatch_makeup_requests_enabled', 'legacy'),
  ('registration', 'registration', 'notification_control_plane_dispatch_registration_enabled', 'legacy'),
  ('registration_phone', 'registration', 'notification_control_plane_registration_phone_adapter_enabled', 'legacy'),
  ('registration_visit', 'registration', 'notification_control_plane_registration_visit_adapter_enabled', 'legacy'),
  ('registration_solapi', 'registration', 'notification_control_plane_registration_solapi_adapter_enabled', 'legacy');

alter table dashboard_private.notification_worker_stop_latch enable row level security;
alter table dashboard_private.notification_worker_health_probes enable row level security;
alter table dashboard_private.notification_watchdog_heartbeats enable row level security;
alter table dashboard_private.notification_schedule_configuration enable row level security;
alter table dashboard_private.notification_cutover_owners enable row level security;
revoke all on table dashboard_private.notification_worker_stop_latch
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_worker_health_probes
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_watchdog_heartbeats
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_schedule_configuration
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_cutover_owners
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_runtime_flag_keys_v1()
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select array[
    'notification_control_plane_settings_ui_enabled',
    'notification_control_plane_shadow_write_enabled',
    'notification_control_plane_dispatch_tasks_enabled',
    'notification_control_plane_dispatch_word_retests_enabled',
    'notification_control_plane_dispatch_registration_enabled',
    'notification_control_plane_registration_phone_adapter_enabled',
    'notification_control_plane_registration_visit_adapter_enabled',
    'notification_control_plane_registration_solapi_adapter_enabled',
    'notification_control_plane_dispatch_transfer_enabled',
    'notification_control_plane_dispatch_withdrawal_enabled',
    'notification_control_plane_dispatch_makeup_requests_enabled',
    'notification_control_plane_dispatch_approvals_enabled'
  ]::text[];
$$;

create or replace function dashboard_private.notification_dispatch_flag_keys_v1()
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select array[
    'notification_control_plane_dispatch_tasks_enabled',
    'notification_control_plane_dispatch_word_retests_enabled',
    'notification_control_plane_dispatch_registration_enabled',
    'notification_control_plane_registration_phone_adapter_enabled',
    'notification_control_plane_registration_visit_adapter_enabled',
    'notification_control_plane_registration_solapi_adapter_enabled',
    'notification_control_plane_dispatch_transfer_enabled',
    'notification_control_plane_dispatch_withdrawal_enabled',
    'notification_control_plane_dispatch_makeup_requests_enabled',
    'notification_control_plane_dispatch_approvals_enabled'
  ]::text[];
$$;

create or replace function dashboard_private.notification_cutover_scope_order_v1()
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select array[
    'tasks',
    'word_retests',
    'approvals',
    'transfer',
    'withdrawal',
    'makeup_requests',
    'registration',
    'registration_phone',
    'registration_visit',
    'registration_solapi'
  ]::text[];
$$;

create or replace function dashboard_private.notification_current_contract_build_revision_hash_v1(
  p_since timestamp with time zone
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamp with time zone;
  v_closure_build_revision_hash text;
  v_observed_build_revision_hash text;
  v_receipt_count bigint;
  v_earliest_receipt_at timestamp with time zone;
  v_latest_receipt_at timestamp with time zone;
  v_build_revision_count bigint;
  v_maximum_gap_seconds numeric;
  v_all_receipts_compliant boolean;
begin
  if p_since is null then return null; end if;
  -- Deployment receipt writers take this same bridge row FOR SHARE.  Holding
  -- FOR UPDATE makes the final inventory check and cutover commit one serial
  -- boundary, so a new deployment receipt cannot race owner activation.
  perform 1
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1'
    and state.closed_at is not null
  for update of state;
  if not found then return null; end if;
  -- Take the freshness boundary only after any competing receipt transaction
  -- has released the bridge row. A pre-lock timestamp could make a stale
  -- receipt look current after a long lock wait.
  v_now := pg_catalog.clock_timestamp();
  if p_since > v_now then return null; end if;

  select closure.build_revision_hash
  into strict v_closure_build_revision_hash
  from dashboard_private.notification_contract_closures closure
  where closure.closure_key = 'legacy_arbitrary_notification_payload_v1'
    and closure.contract_version = 2
    and closure.applied_at <= p_since;

  with receipt_rows as (
    select
      receipt.*,
      pg_catalog.lag(receipt.observed_at) over (
        order by receipt.observed_at, receipt.id
      ) as previous_at
    from dashboard_private.notification_contract_deployment_receipts receipt
    where receipt.observed_at >= p_since
      and receipt.observed_at <= v_now
  )
  select
    pg_catalog.count(*),
    pg_catalog.min(receipt_rows.observed_at),
    pg_catalog.max(receipt_rows.observed_at),
    pg_catalog.count(distinct receipt_rows.build_revision_hash),
    case
      when pg_catalog.count(distinct receipt_rows.build_revision_hash) = 1
        then pg_catalog.min(receipt_rows.build_revision_hash)
      else null
    end,
    pg_catalog.coalesce(pg_catalog.max(
      (pg_catalog.date_part(
        'epoch', (receipt_rows.observed_at - receipt_rows.previous_at)
      ))::numeric
    ), 0),
    pg_catalog.coalesce(pg_catalog.bool_and(
      receipt_rows.contract_version = 2
      and receipt_rows.pre_bridge_server_instances = 0
      and receipt_rows.total_server_instances > 0
      and receipt_rows.bridge_aware_server_instances =
        receipt_rows.total_server_instances
    ), false)
  into
    v_receipt_count,
    v_earliest_receipt_at,
    v_latest_receipt_at,
    v_build_revision_count,
    v_observed_build_revision_hash,
    v_maximum_gap_seconds,
    v_all_receipts_compliant
  from receipt_rows;

  if v_receipt_count = 0
    or v_earliest_receipt_at > p_since + interval '5 minutes'
    or v_latest_receipt_at < v_now - interval '5 minutes'
    or v_build_revision_count <> 1
    or v_maximum_gap_seconds > 600
    or not v_all_receipts_compliant
    or v_observed_build_revision_hash is distinct from
      v_closure_build_revision_hash
  then
    return null;
  end if;
  return v_closure_build_revision_hash;
exception
  when no_data_found then return null;
end;
$$;

create or replace function dashboard_private.notification_active_cutover_scope_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.bool_or(flag_row.enabled), false)
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
     or flag_row.flag_key = any(
       dashboard_private.notification_dispatch_flag_keys_v1()
     );
$$;

create or replace function dashboard_private.notification_success_heartbeats_fresh_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from (
        select heartbeat.phase, heartbeat.created_at
        from dashboard_private.notification_worker_heartbeats heartbeat
        where heartbeat.worker_id = 'notification-worker-route-v1'
          and heartbeat.phase in ('succeeded', 'failed', 'skipped')
        order by heartbeat.created_at desc, heartbeat.id desc
        limit 1
      ) latest
      where latest.phase = 'succeeded'
        and latest.created_at >= pg_catalog.greatest(
          pg_catalog.clock_timestamp() - interval '3 minutes',
          latch.updated_at
        )
    ) and exists (
      select 1
      from (
        select heartbeat.phase, heartbeat.created_at
        from dashboard_private.notification_watchdog_heartbeats heartbeat
        where heartbeat.phase in ('succeeded', 'failed', 'skipped')
        order by heartbeat.created_at desc, heartbeat.id desc
        limit 1
      ) latest
      where latest.phase = 'succeeded'
        and latest.created_at >= pg_catalog.greatest(
          pg_catalog.clock_timestamp() - interval '3 minutes',
          latch.updated_at
        )
    )
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global';
$$;

create or replace function dashboard_private.notification_recovery_health_fresh_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select latch.stopped
    and exists (
      select 1
      from dashboard_private.notification_worker_health_probes probe
      where probe.worker_id = 'notification-worker-route-v1'
        and probe.succeeded_at >= pg_catalog.greatest(
        pg_catalog.clock_timestamp() - interval '3 minutes',
        latch.updated_at
      )
    )
    and exists (
      select 1
      from (
        select heartbeat.phase, heartbeat.created_at
        from dashboard_private.notification_watchdog_heartbeats heartbeat
        where heartbeat.phase in ('succeeded', 'failed')
        order by heartbeat.created_at desc, heartbeat.id desc
        limit 1
      ) latest
      where latest.phase = 'succeeded'
        and latest.created_at >= pg_catalog.greatest(
          pg_catalog.clock_timestamp() - interval '3 minutes',
          latch.updated_at
        )
    )
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global';
$$;

create or replace function dashboard_private.notification_recent_runtime_heartbeats_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not latch.stopped
    and dashboard_private.notification_success_heartbeats_fresh_v1()
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global';
$$;

create or replace function dashboard_private.lock_notification_flag_revisions_v1(
  p_expected_flag_revisions jsonb
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_flag dashboard_private.notification_runtime_flags%rowtype;
  v_expected_keys text[] := dashboard_private.notification_runtime_flag_keys_v1();
  v_key_count integer;
begin
  if p_expected_flag_revisions is null
    or pg_catalog.jsonb_typeof(p_expected_flag_revisions) <> 'object'
  then
    raise exception 'notification_flag_revision_registry_invalid' using errcode = '22023';
  end if;
  select pg_catalog.count(*)::integer into v_key_count
  from pg_catalog.jsonb_object_keys(p_expected_flag_revisions);
  if v_key_count <> 12
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_expected_flag_revisions) supplied(key)
      where not (supplied.key = any(v_expected_keys))
    )
    or exists (
      select 1
      from pg_catalog.unnest(v_expected_keys) expected(key)
      where not p_expected_flag_revisions ? expected.key
        or pg_catalog.jsonb_typeof(p_expected_flag_revisions -> expected.key) <> 'string'
        or p_expected_flag_revisions ->> expected.key !~ '^[1-9][0-9]*$'
    )
    or (select pg_catalog.count(*) from dashboard_private.notification_runtime_flags) <> 12
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where not flag_row.flag_key = any(v_expected_keys)
    )
    or exists (
      select 1
      from pg_catalog.unnest(v_expected_keys) expected(key)
      where not exists (
        select 1
        from dashboard_private.notification_runtime_flags flag_row
        where flag_row.flag_key = expected.key
      )
    )
  then
    raise exception 'notification_flag_revision_registry_invalid' using errcode = '22023';
  end if;

  for v_flag in
    select flag_row.*
    from dashboard_private.notification_runtime_flags flag_row
    order by flag_row.flag_key
    for update of flag_row
  loop
    if (p_expected_flag_revisions ->> v_flag.flag_key)::bigint <> v_flag.revision then
      raise exception 'notification_revision_conflict' using errcode = '40001';
    end if;
  end loop;
  if not found then
    raise exception 'notification_flag_revision_registry_invalid' using errcode = '22023';
  end if;
end;
$$;

create or replace function dashboard_private.current_notification_flag_revisions_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_object_agg(flag_row.flag_key, flag_row.revision::text),
    '{}'::jsonb
  )
  from dashboard_private.notification_runtime_flags flag_row;
$$;

create or replace function dashboard_private.notification_cutover_request_replay_v1(
  p_request_id uuid,
  p_request_kind text,
  p_request_fingerprint text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ledger dashboard_private.notification_request_ledger%rowtype;
begin
  if p_request_id is null
    or nullif(pg_catalog.btrim(p_request_kind), '') is null
    or nullif(pg_catalog.btrim(p_request_fingerprint), '') is null
  then
    raise exception 'notification_cutover_request_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if not found then return pg_catalog.jsonb_build_object('replayed', false); end if;
  if v_ledger.request_kind <> p_request_kind
    or v_ledger.request_fingerprint <> p_request_fingerprint
  then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object(
    'replayed', true,
    'response', v_ledger.response_payload
  );
end;
$$;

create or replace function dashboard_private.finish_notification_cutover_request_v1(
  p_request_id uuid,
  p_request_kind text,
  p_request_fingerprint text,
  p_response jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, p_request_kind, p_request_fingerprint, p_response);
  return p_response;
end;
$$;

create or replace function dashboard_private.validate_notification_worker_vault_values_v1(
  p_url text,
  p_secret text,
  p_approved_host text
) returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when nullif(pg_catalog.btrim(p_url), '') is null
      or nullif(pg_catalog.btrim(p_secret), '') is null
      or nullif(pg_catalog.btrim(p_approved_host), '') is null
      then pg_catalog.jsonb_build_object('ok', false, 'error_code', 'worker_vault_value_missing')
    when p_approved_host !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
      then pg_catalog.jsonb_build_object('ok', false, 'error_code', 'approved_host_invalid')
    when pg_catalog.octet_length(p_secret) < 32
      or p_secret <> pg_catalog.btrim(p_secret)
      or p_secret ~ '[[:cntrl:]]'
      or pg_catalog.octet_length(p_secret) > 4096
      then pg_catalog.jsonb_build_object('ok', false, 'error_code', 'worker_secret_invalid')
    when p_url not in (
      'https://' || p_approved_host || '/api/notifications/worker',
      'https://' || p_approved_host || ':443/api/notifications/worker'
    )
      then pg_catalog.jsonb_build_object('ok', false, 'error_code', 'worker_url_policy_mismatch')
    else pg_catalog.jsonb_build_object(
      'ok', true,
      'scheme', 'https',
      'host', p_approved_host,
      'port', 443,
      'path', '/api/notifications/worker'
    )
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
  v_host text;
  v_url text;
  v_secret text;
  v_url_count integer := 0;
  v_secret_count integer := 0;
begin
  select config.approved_worker_host into v_host
  from dashboard_private.notification_schedule_configuration config
  where config.config_key = 'global';
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error_code', 'vault_unavailable');
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
    return pg_catalog.jsonb_build_object('ok', false, 'error_code', 'worker_vault_value_ambiguous');
  end if;
  return dashboard_private.validate_notification_worker_vault_values_v1(
    v_url, v_secret, v_host
  );
exception
  when others then
    return pg_catalog.jsonb_build_object('ok', false, 'error_code', 'worker_vault_read_failed');
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
  v_host text;
  v_url text;
  v_secret text;
  v_url_count integer;
  v_secret_count integer;
  v_contract jsonb;
  v_request_id bigint;
begin
  select config.approved_worker_host into v_host
  from dashboard_private.notification_schedule_configuration config
  where config.config_key = 'global';
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    raise exception 'notification_worker_vault_unavailable' using errcode = '55000';
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
  v_contract := dashboard_private.validate_notification_worker_vault_values_v1(
    v_url, v_secret, v_host
  );
  if (v_contract ->> 'ok')::boolean is not true then
    raise exception 'notification_worker_url_policy_failed' using errcode = '55000';
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

create or replace function dashboard_private.inspect_notification_schedules_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'worker_count', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-worker-v1'
    ),
    'watchdog_count', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-cutover-watchdog-v1'
    ),
    'active_count', pg_catalog.count(*) filter (where job.active),
    'worker_active_count', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-worker-v1' and job.active
    ),
    'watchdog_active_count', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-cutover-watchdog-v1' and job.active
    ),
    'worker_contract_count', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-worker-v1'
        and job.schedule = '* * * * *'
        and pg_catalog.btrim(job.command) =
          'select dashboard_private.invoke_notification_worker_v1();'
    ),
    'watchdog_contract_count', pg_catalog.count(*) filter (
      where job.jobname = 'tips-notification-cutover-watchdog-v1'
        and job.schedule = '* * * * *'
        and pg_catalog.btrim(job.command) =
          'select dashboard_private.run_notification_cutover_watchdog_v1();'
    )
  )
  from cron.job job
  where job.jobname in (
    'tips-notification-worker-v1',
    'tips-notification-cutover-watchdog-v1'
  );
$$;

create or replace function dashboard_private.manage_notification_schedules_v1(
  p_action text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
begin
  if p_action is null or p_action not in ('install', 'disable', 'remove') then
    raise exception 'notification_schedule_action_invalid' using errcode = '22023';
  end if;
  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  order by flag_row.flag_key
  for update of flag_row;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-schedule-management-v1', 0)
  );
  if p_action in ('disable', 'remove')
    and dashboard_private.notification_active_cutover_scope_v1()
  then
    raise exception 'notification_schedule_shutdown_requires_containment'
      using errcode = '55000';
  end if;
  if p_action in ('install', 'remove') then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname in (
        'tips-notification-worker-v1',
        'tips-notification-cutover-watchdog-v1'
      )
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
      $command$select dashboard_private.run_notification_cutover_watchdog_v1();$command$
    );
  elsif p_action = 'disable' then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname in (
        'tips-notification-worker-v1',
        'tips-notification-cutover-watchdog-v1'
      )
      order by job.jobid
    loop
      perform cron.alter_job(v_job.jobid, active := false);
    end loop;
  end if;
  return dashboard_private.inspect_notification_schedules_v1();
end;
$$;

create or replace function dashboard_private.notification_schedule_contract_ready_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_schedules jsonb;
  v_vault jsonb;
begin
  v_schedules := dashboard_private.inspect_notification_schedules_v1();
  if (v_schedules ->> 'worker_count')::integer <> 1
    or (v_schedules ->> 'watchdog_count')::integer <> 1
    or (v_schedules ->> 'worker_active_count')::integer <> 1
    or (v_schedules ->> 'watchdog_active_count')::integer <> 1
    or (v_schedules ->> 'worker_contract_count')::integer <> 1
    or (v_schedules ->> 'watchdog_contract_count')::integer <> 1
  then
    return false;
  end if;
  v_vault := dashboard_private.read_notification_worker_vault_contract_v1();
  return coalesce((v_vault ->> 'ok')::boolean, false);
end;
$$;

create or replace function dashboard_private.notification_dispatch_scope_for_event_v1(
  p_workflow_key text,
  p_event_key text
) returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_workflow_key = 'registration'
      and p_event_key = 'registration.phone_consultation_ready'
      then 'registration_phone'
    when p_workflow_key = 'registration'
      and p_event_key like 'registration.visit_%'
      then 'registration_visit'
    when p_workflow_key = 'registration'
      and p_event_key like 'registration.admission_message_%'
      then 'registration_solapi'
    when p_workflow_key = 'registration' then 'registration'
    when p_workflow_key in (
      'tasks', 'word_retests', 'approvals', 'transfer', 'withdrawal', 'makeup_requests'
    ) then p_workflow_key
    else null
  end;
$$;

create or replace function dashboard_private.notification_event_scope_active_v1(
  p_workflow_key text,
  p_event_key text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select flag_row.enabled
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
  ), false) or exists (
    select 1
    from dashboard_private.notification_cutover_owners owner_row
    join dashboard_private.notification_runtime_flags flag_row
      on flag_row.flag_key = owner_row.dispatch_flag_key
    where owner_row.scope_key = dashboard_private.notification_dispatch_scope_for_event_v1(
      p_workflow_key, p_event_key
    )
      and owner_row.owner_kind = 'canonical'
      and flag_row.enabled
  );
$$;

create or replace function dashboard_private.lock_notification_event_cutover_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_key text;
  v_dispatch_flag_key text;
  v_flag dashboard_private.notification_runtime_flags%rowtype;
  v_owner dashboard_private.notification_cutover_owners%rowtype;
  v_dispatch_enabled boolean;
begin
  v_scope_key := dashboard_private.notification_dispatch_scope_for_event_v1(
    new.workflow_key, new.event_key
  );
  select owner_row.dispatch_flag_key into v_dispatch_flag_key
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key;
  if v_scope_key is null or v_dispatch_flag_key is null then
    raise exception 'notification_event_cutover_scope_invalid' using errcode = '22023';
  end if;
  for v_flag in
    select flag_row.*
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key in (
      'notification_control_plane_shadow_write_enabled',
      v_dispatch_flag_key
    )
    order by flag_row.flag_key
    for share of flag_row
  loop
    if v_flag.flag_key = v_dispatch_flag_key then
      v_dispatch_enabled := v_flag.enabled;
    end if;
  end loop;
  select owner_row.* into v_owner
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key
    and owner_row.dispatch_flag_key = v_dispatch_flag_key
  for share of owner_row;
  if v_dispatch_enabled is null
    or v_owner.scope_key is null
    or (v_owner.owner_kind = 'canonical' and not v_dispatch_enabled)
    or (v_owner.owner_kind = 'legacy' and v_dispatch_enabled)
  then
    raise exception 'notification_event_cutover_state_invalid' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_notification_event_cutover_snapshot_v1
  on dashboard_private.notification_events;
create trigger lock_notification_event_cutover_snapshot_v1
before insert on dashboard_private.notification_events
for each row execute function
  dashboard_private.lock_notification_event_cutover_snapshot_v1();

-- Failed orchestration work and cutover state transitions share one database
-- lease. This closes the failed -> pending race where a shadow-era job could
-- be re-armed immediately after activation had inspected the queue.
create or replace function dashboard_private.lock_notification_orchestration_retry_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  return new;
end;
$$;

drop trigger if exists lock_notification_fanout_retry_v1
  on dashboard_private.notification_event_fanout_jobs;
create trigger lock_notification_fanout_retry_v1
before update on dashboard_private.notification_event_fanout_jobs
for each row
when (old.status = 'failed' and new.status = 'pending')
execute function dashboard_private.lock_notification_orchestration_retry_v1();

drop trigger if exists lock_notification_rule_retry_v1
  on dashboard_private.notification_rule_reconciliation_jobs;
create trigger lock_notification_rule_retry_v1
before update on dashboard_private.notification_rule_reconciliation_jobs
for each row
when (old.status = 'failed' and new.status = 'pending')
execute function dashboard_private.lock_notification_orchestration_retry_v1();

drop trigger if exists lock_notification_target_retry_v1
  on dashboard_private.notification_target_reconciliation_jobs;
create trigger lock_notification_target_retry_v1
before update on dashboard_private.notification_target_reconciliation_jobs
for each row
when (old.status = 'failed' and new.status = 'pending')
execute function dashboard_private.lock_notification_orchestration_retry_v1();

-- Add immutable context to canonical send-start audit rows without rewriting
-- the already-applied worker migration that originally inserts them.
create or replace function dashboard_private.snapshot_notification_dispatch_audit_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shadow_enabled boolean := false;
begin
  if new.entity_kind = 'notification_delivery'
    and new.action = 'dispatch_started'
    and new.reason_code = 'canonical_dispatch'
  then
    select flag_row.enabled into v_shadow_enabled
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
    for share of flag_row;
    new.after_summary := coalesce(new.after_summary, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'shadow_enabled', coalesce(v_shadow_enabled, false),
        'owner_kind', 'canonical'
      );
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_notification_dispatch_audit_v1
  on dashboard_private.notification_audit_logs;
create trigger snapshot_notification_dispatch_audit_v1
before insert on dashboard_private.notification_audit_logs
for each row execute function
  dashboard_private.snapshot_notification_dispatch_audit_v1();

create or replace function dashboard_private.route_notification_ownership_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_key text;
  v_scope_key text;
  v_owner dashboard_private.notification_cutover_owners%rowtype;
  v_dispatch_flag_key text;
  v_flag_enabled boolean;
begin
  select rule_row.event_key into v_event_key
  from dashboard_private.notification_rules rule_row
  where rule_row.id = new.rule_id
    and rule_row.workflow_key = new.workflow_key;
  if not found then
    raise exception 'notification_ownership_rule_mismatch' using errcode = '22023';
  end if;
  v_scope_key := dashboard_private.notification_dispatch_scope_for_event_v1(
    new.workflow_key, v_event_key
  );
  select owner_row.dispatch_flag_key into v_dispatch_flag_key
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key;
  if not found then
    raise exception 'notification_ownership_scope_unknown' using errcode = '22023';
  end if;
  select flag_row.enabled into v_flag_enabled
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = v_dispatch_flag_key
  for share of flag_row;
  if not found then
    raise exception 'notification_ownership_flag_missing' using errcode = '55000';
  end if;
  select owner_row.* into strict v_owner
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key
    and owner_row.dispatch_flag_key = v_dispatch_flag_key
  for share of owner_row;

  if v_owner.owner_kind = 'canonical' and v_flag_enabled then
    new.owner_kind := 'canonical';
  elsif v_owner.owner_kind = 'legacy' and not v_flag_enabled then
    new.owner_kind := 'legacy';
  else
    raise exception 'notification_ownership_capability_mismatch' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists route_notification_ownership_insert_v1
  on dashboard_private.notification_dispatch_ownership_claims;
create trigger route_notification_ownership_insert_v1
before insert on dashboard_private.notification_dispatch_ownership_claims
for each row execute function
  dashboard_private.route_notification_ownership_insert_v1();

create or replace function dashboard_private.enforce_notification_dispatch_runtime_gate_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_key text;
  v_scope_key text;
  v_dispatch_flag_key text;
  v_owner dashboard_private.notification_cutover_owners%rowtype;
  v_flag_enabled boolean;
begin
  if old.state = 'reserved' and new.state = 'dispatch_started' then
    if new.owner_kind is distinct from old.owner_kind
      or new.owner_generation is distinct from old.owner_generation
    then
      raise exception 'notification_dispatch_claim_identity_changed' using errcode = '40001';
    end if;
    select rule_row.event_key into v_event_key
    from dashboard_private.notification_rules rule_row
    where rule_row.id = old.rule_id
      and rule_row.workflow_key = old.workflow_key;
    if not found then
      raise exception 'notification_dispatch_rule_mismatch' using errcode = '22023';
    end if;
    v_scope_key := dashboard_private.notification_dispatch_scope_for_event_v1(
      old.workflow_key, v_event_key
    );
    select owner_row.dispatch_flag_key into v_dispatch_flag_key
    from dashboard_private.notification_cutover_owners owner_row
    where owner_row.scope_key = v_scope_key;
    if not found then
      raise exception 'notification_dispatch_scope_unknown' using errcode = '22023';
    end if;
    select flag_row.enabled into v_flag_enabled
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = v_dispatch_flag_key
    for share of flag_row;
    if not found then
      raise exception 'notification_dispatch_flag_missing' using errcode = '55000';
    end if;
    select owner_row.* into v_owner
    from dashboard_private.notification_cutover_owners owner_row
    where owner_row.scope_key = v_scope_key
      and owner_row.dispatch_flag_key = v_dispatch_flag_key
    for share of owner_row;
    if not found
      or old.owner_kind <> v_owner.owner_kind
      or (old.owner_kind = 'canonical' and not v_flag_enabled)
      or (old.owner_kind = 'legacy' and v_flag_enabled)
    then
      raise exception 'notification_dispatch_owner_stale' using errcode = '40001';
    end if;
    if new.owner_kind = 'canonical' and exists (
      select 1
      from dashboard_private.notification_worker_stop_latch latch
      where latch.latch_key = 'global' and latch.stopped
    ) then
      raise exception 'notification_worker_stop_latch_set' using errcode = '55000';
    end if;
    if dashboard_private.notification_active_cutover_scope_v1()
      and not dashboard_private.notification_recent_runtime_heartbeats_v1()
    then
      raise exception 'notification_runtime_heartbeat_stale' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_notification_dispatch_runtime_gate_v1
  on dashboard_private.notification_dispatch_ownership_claims;
create trigger enforce_notification_dispatch_runtime_gate_v1
before update of state on dashboard_private.notification_dispatch_ownership_claims
for each row execute function
  dashboard_private.enforce_notification_dispatch_runtime_gate_v1();

create or replace function dashboard_private.enforce_notification_flag_activation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.enabled is distinct from old.enabled
    and new.flag_key = any(dashboard_private.notification_dispatch_flag_keys_v1())
    and pg_catalog.current_setting(
      'app.notification_cutover_activation_authorized', true
    ) is distinct from 'true'
  then
    raise exception 'notification_dispatch_activation_rpc_required' using errcode = '42501';
  end if;
  if new.enabled and not old.enabled
    and new.flag_key = 'notification_control_plane_shadow_write_enabled'
    and (
      exists (
        select 1
        from dashboard_private.notification_runtime_flags flag_row
        where (
          flag_row.flag_key = 'notification_control_plane_settings_ui_enabled'
          or flag_row.flag_key = any(
            dashboard_private.notification_dispatch_flag_keys_v1()
          )
        ) and flag_row.enabled
      )
      or exists (
        select 1
        from dashboard_private.notification_cutover_owners owner_row
        where owner_row.owner_kind = 'canonical'
      )
    )
  then
    raise exception 'notification_shadow_phase_invalid' using errcode = '55000';
  end if;
  if new.enabled and not old.enabled
    and new.flag_key = any(dashboard_private.notification_dispatch_flag_keys_v1())
    and (
      exists (
        select 1
        from dashboard_private.notification_runtime_flags flag_row
        where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
          and flag_row.enabled
      )
      or not exists (
        select 1
        from dashboard_private.notification_cutover_owners owner_row
        where owner_row.dispatch_flag_key = new.flag_key
          and owner_row.owner_kind = 'legacy'
      )
    )
  then
    raise exception 'notification_dispatch_phase_invalid' using errcode = '55000';
  end if;
  if new.enabled and not old.enabled
    and new.flag_key = 'notification_control_plane_settings_ui_enabled'
    and (
      exists (
        select 1
        from dashboard_private.notification_runtime_flags shadow_flag
        where shadow_flag.flag_key = 'notification_control_plane_shadow_write_enabled'
          and shadow_flag.enabled
      )
      or (select pg_catalog.count(*)
          from dashboard_private.notification_cutover_owners owner_row
          where owner_row.owner_kind = 'canonical') <> 10
      or (select pg_catalog.count(*)
          from dashboard_private.notification_runtime_flags flag_row
          where flag_row.flag_key = any(
            dashboard_private.notification_dispatch_flag_keys_v1()
          ) and flag_row.enabled) <> 10
      or exists (
        select 1
        from dashboard_private.notification_cutover_owners owner_row
        join dashboard_private.notification_runtime_flags flag_row
          on flag_row.flag_key = owner_row.dispatch_flag_key
        where owner_row.owner_kind <> 'canonical' or not flag_row.enabled
      )
    )
  then
    raise exception 'notification_settings_ui_cutover_incomplete' using errcode = '55000';
  end if;
  if new.enabled and not old.enabled
    and new.flag_key = any(array[
      'notification_control_plane_settings_ui_enabled',
      'notification_control_plane_shadow_write_enabled'
    ]::text[] || dashboard_private.notification_dispatch_flag_keys_v1())
  then
    if not dashboard_private.notification_runtime_dependency_ready_v1('forward_compat')
      or not dashboard_private.notification_recent_runtime_heartbeats_v1()
      or not dashboard_private.notification_schedule_contract_ready_v1()
    then
      raise exception 'notification_runtime_heartbeat_stale' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_notification_flag_activation_v1
  on dashboard_private.notification_runtime_flags;
create trigger enforce_notification_flag_activation_v1
before update of enabled on dashboard_private.notification_runtime_flags
for each row execute function
  dashboard_private.enforce_notification_flag_activation_v1();

create or replace function dashboard_private.notification_sha256_hex_v1(
  p_value text
) returns text
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  v_schema text;
  v_hash text;
begin
  select namespace.nspname into v_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'pgcrypto';
  if v_schema is null then
    raise exception 'notification_pgcrypto_unavailable' using errcode = '55000';
  end if;
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest($1, ''sha256''), ''hex'')',
    v_schema
  ) into v_hash using p_value;
  if v_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'notification_sha256_invalid' using errcode = '55000';
  end if;
  return v_hash;
end;
$$;

create or replace function public.record_legacy_notification_intent_v1(
  p_workflow_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint,
  p_normalized_rendered_hash text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_template dashboard_private.notification_templates%rowtype;
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_occurrence_key), '') is null
    or p_rule_id is null
    or p_channel_key not in ('in_app', 'web_push', 'google_chat', 'customer_message')
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_generation is null or p_target_generation < 0
    or p_normalized_rendered_hash !~ '^[a-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception 'notification_legacy_intent_invalid' using errcode = '22023';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = p_workflow_key
    and event_row.occurrence_key = p_occurrence_key
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(event_row.rule_snapshot) snapshot(item)
      where snapshot.item ->> 'rule_id' = p_rule_id::text
    );
  select snapshot.item into strict v_rule_snapshot
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  where snapshot.item ->> 'rule_id' = p_rule_id::text;
  if v_rule_snapshot ->> 'channel_key' is distinct from p_channel_key
    or coalesce((v_rule_snapshot ->> 'enabled')::boolean, false) is not true
    or nullif(v_rule_snapshot ->> 'template_id', '') is null
  then
    raise exception 'notification_legacy_intent_rule_mismatch' using errcode = '22023';
  end if;
  select template_row.* into strict v_template
  from dashboard_private.notification_templates template_row
  where template_row.id = (v_rule_snapshot ->> 'template_id')::uuid
    and template_row.rule_id = p_rule_id;

  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    pg_catalog.concat_ws(
      E'\x1f', p_workflow_key, p_occurrence_key, p_rule_id::text,
      p_channel_key, p_target_key, p_target_generation::text,
      v_template.checksum, p_normalized_rendered_hash
    )
  );
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'legacy_normalized_intent', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;

  v_response := pg_catalog.jsonb_build_object(
    'recorded', true,
    'intentFingerprint', v_fingerprint,
    'templateChecksum', v_template.checksum
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_legacy_intent', v_fingerprint, 'legacy_intent_recorded',
    null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'workflow_key', p_workflow_key,
      'occurrence_key_hash', dashboard_private.notification_sha256_hex_v1(
        p_occurrence_key
      ),
      'rule_id', p_rule_id,
      'channel_key', p_channel_key,
      'target_key_hash', dashboard_private.notification_sha256_hex_v1(
        p_target_key
      ),
      'target_generation', p_target_generation::text,
      'template_checksum', v_template.checksum,
      'normalized_rendered_hash', p_normalized_rendered_hash,
      'intent_fingerprint', v_fingerprint
    ),
    'shadow_parity'
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'legacy_normalized_intent', v_fingerprint, v_response
  );
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
    insert into dashboard_private.notification_worker_health_probes(
      worker_id, succeeded_at
    ) values (
      p_worker_id, pg_catalog.clock_timestamp()
    )
    on conflict (worker_id) do update
    set succeeded_at = excluded.succeeded_at;
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'worker_stop_latch',
      'health_probe_recorded', true
    );
  end if;
  if dashboard_private.notification_active_cutover_scope_v1()
    and not dashboard_private.notification_recent_runtime_heartbeats_v1()
  then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'runtime_heartbeat_stale');
  end if;
  return pg_catalog.jsonb_build_object('allowed', true);
end;
$$;

-- A fixture receipt is evidence only when it points at an actual, current
-- canonical/legacy comparison created by the database.  Service callers may
-- not turn caller-supplied counters or an arbitrary digest into cutover proof.
create or replace function dashboard_private.notification_shadow_scope_config_digest_v1(
  p_scope_key text
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.notification_sha256_hex_v1(coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rule_id', rule_row.id,
        'revision', rule_row.revision::text,
        'enabled', rule_row.enabled,
        'active_template_id', rule_row.active_template_id,
        'template_checksum', template_row.checksum
      ) order by rule_row.id
    )::text
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id
     and template_row.rule_id = rule_row.id
    where dashboard_private.notification_dispatch_scope_for_event_v1(
      rule_row.workflow_key, rule_row.event_key
    ) = p_scope_key
  ), '[]'));
$$;

create or replace function dashboard_private.notification_shadow_comparison_current_v1(
  p_scope_key text,
  p_comparison_key text,
  p_shadow_since timestamp with time zone
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_shadow_since is not null
    and p_scope_key = any(dashboard_private.notification_cutover_scope_order_v1())
    and p_comparison_key ~ '^[a-f0-9]{64}$'
    and exists (
      select 1
      from dashboard_private.notification_audit_logs comparison
      join dashboard_private.notification_audit_logs canonical
        on canonical.entity_kind = 'notification_shadow_intent'
       and canonical.action = 'canonical_intent_recorded'
       and canonical.entity_id =
         comparison.after_summary ->> 'canonical_intent_fingerprint'
      join dashboard_private.notification_audit_logs legacy
        on legacy.entity_kind = 'notification_shadow_intent'
       and legacy.action = 'legacy_intent_recorded'
       and legacy.entity_id =
         comparison.after_summary ->> 'legacy_intent_fingerprint'
      join dashboard_private.notification_events event_row
        on event_row.id::text = canonical.after_summary ->> 'event_id'
       and event_row.id::text = legacy.after_summary ->> 'event_id'
      join dashboard_private.notification_rules rule_row
        on rule_row.id::text = canonical.after_summary ->> 'rule_id'
       and rule_row.id::text = legacy.after_summary ->> 'rule_id'
       and rule_row.workflow_key = event_row.workflow_key
      join dashboard_private.notification_templates template_row
        on template_row.id = rule_row.active_template_id
       and template_row.rule_id = rule_row.id
      join lateral pg_catalog.jsonb_array_elements(event_row.rule_snapshot)
        snapshot(item)
        on snapshot.item ->> 'rule_id' = rule_row.id::text
      join dashboard_private.notification_audit_logs delivery_audit
        on delivery_audit.entity_kind = 'notification_delivery'
       and delivery_audit.action = 'shadow_delivery_evaluated'
       and delivery_audit.reason_code = 'shadow_mode'
       and delivery_audit.after_summary ->> 'comparison_key' = p_comparison_key
      join dashboard_private.notification_deliveries delivery
        on delivery.id::text = delivery_audit.entity_id
       and delivery.event_id = event_row.id
       and delivery.rule_id = rule_row.id
      join dashboard_private.notification_dispatch_ownership_claims ownership
        on ownership.workflow_key = event_row.workflow_key
       and ownership.occurrence_key = event_row.occurrence_key
       and ownership.rule_id = delivery.rule_id
       and ownership.channel_key = delivery.channel_key
       and ownership.target_key = delivery.target_key
       and ownership.target_generation = delivery.target_generation
      cross join lateral (
        select pg_catalog.greatest(
          p_shadow_since,
          coalesce(pg_catalog.max(pg_catalog.greatest(
            scoped_rule.updated_at, scoped_template.created_at
          )), p_shadow_since)
        ) as evidence_since
        from dashboard_private.notification_rules scoped_rule
        join dashboard_private.notification_templates scoped_template
          on scoped_template.id = scoped_rule.active_template_id
         and scoped_template.rule_id = scoped_rule.id
        where dashboard_private.notification_dispatch_scope_for_event_v1(
          scoped_rule.workflow_key, scoped_rule.event_key
        ) = p_scope_key
      ) boundary
      where comparison.entity_kind = 'notification_shadow_comparison'
        and comparison.action = 'shadow_compare_result'
        and comparison.reason_code = 'matched'
        and comparison.after_summary ->> 'comparison_key' = p_comparison_key
        and comparison.after_summary ->> 'workflow_key' = event_row.workflow_key
        and comparison.after_summary ->> 'event_key' = event_row.event_key
        and dashboard_private.notification_dispatch_scope_for_event_v1(
          event_row.workflow_key, event_row.event_key
        ) = p_scope_key
        and canonical.after_summary ->> 'comparison_key' = p_comparison_key
        and legacy.after_summary ->> 'comparison_key' = p_comparison_key
        and canonical.after_summary ->> 'template_checksum' = template_row.checksum
        and legacy.after_summary ->> 'template_checksum' = template_row.checksum
        and canonical.after_summary ->> 'normalized_rendered_hash'
          = legacy.after_summary ->> 'normalized_rendered_hash'
        and snapshot.item ->> 'rule_revision' = rule_row.revision::text
        and snapshot.item ->> 'template_id' = rule_row.active_template_id::text
        and rule_row.enabled
        and delivery.rule_revision = rule_row.revision
        and delivery.template_id = rule_row.active_template_id
        and delivery.channel_key = canonical.after_summary ->> 'channel_key'
        and delivery.audience_key = canonical.after_summary ->> 'audience_key'
        and delivery.target_generation::text =
          canonical.after_summary ->> 'target_generation'
        and dashboard_private.notification_sha256_hex_v1(delivery.target_key)
          = canonical.after_summary ->> 'target_key_hash'
        and delivery.status = 'skipped'
        and delivery.status_reason = 'shadow_mode'
        and ownership.owner_kind = 'legacy'
        -- The canonical row itself stayed side-effect free, while the legacy
        -- owner completed the production side effect successfully.  Requiring
        -- a terminal claim avoids the activation deadlock where the same
        -- reserved proof was also treated as an undrained legacy attempt.
        and ownership.state = 'closed'
        and ownership.terminal_outcome = 'sent'
        and exists (
          select 1
          from dashboard_private.notification_audit_logs ownership_audit
          where ownership_audit.entity_kind = 'notification_dispatch_ownership'
            and ownership_audit.entity_id = ownership.id::text
            and ownership_audit.action = 'legacy_dispatch_finalized'
            and ownership_audit.reason_code = 'sent'
            and ownership_audit.after_summary ->> 'state' = 'closed'
            and ownership_audit.after_summary ->> 'outcome' = 'sent'
        )
        and comparison.created_at >= boundary.evidence_since
        and canonical.created_at >= boundary.evidence_since
        and legacy.created_at >= boundary.evidence_since
        and delivery.created_at >= boundary.evidence_since
        and not exists (
          select 1
          from public.dashboard_notifications notification
          where notification.source_delivery_id = delivery.id
        )
        and not exists (
          select 1
          from dashboard_private.notification_audit_logs dispatch_audit
          where dispatch_audit.entity_kind = 'notification_delivery'
            and dispatch_audit.entity_id = delivery.id::text
            and dispatch_audit.action = 'dispatch_started'
        )
    );
$$;

create or replace function public.record_notification_shadow_fixture_evidence_v1(
  p_scope_key text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shadow dashboard_private.notification_runtime_flags%rowtype;
  v_evidence_digest text;
  v_config_digest text;
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or not p_scope_key = any(
      dashboard_private.notification_cutover_scope_order_v1()
    )
    or p_request_id is null
  then
    raise exception 'notification_shadow_fixture_evidence_invalid'
      using errcode = '22023';
  end if;
  select flag_row.* into strict v_shadow
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
  if not v_shadow.enabled
    or exists (
      select 1 from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_dispatch_flag_keys_v1()
      ) and flag_row.enabled
    )
    or exists (
      select 1 from dashboard_private.notification_cutover_owners owner_row
      where owner_row.owner_kind <> 'legacy'
    )
  then
    raise exception 'notification_shadow_fixture_phase_invalid'
      using errcode = '55000';
  end if;
  select comparison.after_summary ->> 'comparison_key'
  into v_evidence_digest
  from dashboard_private.notification_audit_logs comparison
  where comparison.entity_kind = 'notification_shadow_comparison'
    and comparison.action = 'shadow_compare_result'
    and comparison.reason_code = 'matched'
    and dashboard_private.notification_shadow_comparison_current_v1(
      p_scope_key,
      comparison.after_summary ->> 'comparison_key',
      v_shadow.updated_at
    )
  order by comparison.created_at desc, comparison.id desc
  limit 1;
  if v_evidence_digest is null then
    raise exception 'notification_shadow_fixture_evidence_unverified'
      using errcode = '55000';
  end if;
  v_config_digest :=
    dashboard_private.notification_shadow_scope_config_digest_v1(p_scope_key);
  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    pg_catalog.concat_ws(
      E'\x1f', p_scope_key, v_evidence_digest,
      '1', v_shadow.revision::text
    )
  );
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_shadow_fixture_evidence', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_shadow_fixture', p_scope_key,
    'shadow_fixture_cycle_verified', null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'scope_key', p_scope_key,
      'evidence_digest', v_evidence_digest,
      'comparison_key', v_evidence_digest,
      'scope_config_digest', v_config_digest,
      'completed_cycles', 1,
      'external_requests', 0,
      'canonical_inbox_projections', 0,
      'duplicate_external_requests', 0,
      'shadow_revision', v_shadow.revision::text
    ),
    'deterministic_fixture_verified'
  );
  v_response := pg_catalog.jsonb_build_object(
    'recorded', true,
    'scopeKey', p_scope_key,
    'evidenceDigest', v_evidence_digest,
    'scopeConfigDigest', v_config_digest,
    'completedCycles', 1
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_shadow_fixture_evidence',
    v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  p_shadow_since timestamp with time zone
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_shadow_since is not null and not exists (
    select 1
    from pg_catalog.unnest(
      dashboard_private.notification_cutover_scope_order_v1()
    ) expected(scope_key)
    where not exists (
      select 1
      from dashboard_private.notification_audit_logs comparison
      where comparison.entity_kind = 'notification_shadow_comparison'
        and comparison.action = 'shadow_compare_result'
        and comparison.reason_code = 'matched'
        and dashboard_private.notification_shadow_comparison_current_v1(
          expected.scope_key,
          comparison.after_summary ->> 'comparison_key',
          p_shadow_since
        )
    )
  );
$$;

create or replace function dashboard_private.audit_notification_inbox_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_shadow_enabled boolean := false;
begin
  if new.source_delivery_id is null then return new; end if;
  select delivery.* into strict v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = new.source_delivery_id;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;
  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation;
  select flag_row.enabled into v_shadow_enabled
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    after_summary, reason_code
  ) values (
    'notification_delivery', v_delivery.id::text,
    'inbox_projection_recorded', null, 'system',
    pg_catalog.jsonb_build_object(
      'workflow_key', v_event.workflow_key,
      'event_key', v_event.event_key,
      'owner_kind', coalesce(v_ownership.owner_kind, 'missing'),
      'shadow_enabled', coalesce(v_shadow_enabled, false)
    ),
    case
      when coalesce(v_shadow_enabled, false)
        then 'canonical_inbox_in_shadow'
      else 'inbox_projection_recorded'
    end
  );
  return new;
end;
$$;

drop trigger if exists audit_notification_inbox_projection_v1
  on public.dashboard_notifications;
create trigger audit_notification_inbox_projection_v1
after insert on public.dashboard_notifications
for each row execute function
  dashboard_private.audit_notification_inbox_projection_v1();

create or replace function dashboard_private.notification_operations_metrics_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamp with time zone := pg_catalog.clock_timestamp();
  v_worker_heartbeat timestamp with time zone;
  v_watchdog_heartbeat timestamp with time zone;
  v_window_start timestamp with time zone;
  v_shadow_enabled boolean := false;
  v_shadow_since timestamp with time zone;
  v_latch dashboard_private.notification_worker_stop_latch%rowtype;
  v_queue jsonb;
  v_closed jsonb;
  v_jobs jsonb;
  v_pending_lag bigint := 0;
  v_worker_missed integer := 3;
  v_provider_shadow bigint := 0;
  v_inbox_shadow bigint := 0;
  v_duplicate bigint := 0;
  v_unknown bigint := 0;
  v_scope_mismatch bigint := 0;
  v_zero_audience bigint := 0;
  v_ownership_denial bigint := 0;
  v_ownership_anomaly bigint := 0;
  v_shadow_match bigint := 0;
  v_shadow_mismatch bigint := 0;
  v_rollback_failed bigint := 0;
  v_worker_route_fault bigint := 0;
  v_schedule_fault bigint := 0;
begin
  select pg_catalog.max(heartbeat.created_at) into v_worker_heartbeat
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.worker_id = 'notification-worker-route-v1'
    and heartbeat.phase = 'succeeded';
  select pg_catalog.max(heartbeat.created_at) into v_watchdog_heartbeat
  from dashboard_private.notification_watchdog_heartbeats heartbeat
  where heartbeat.phase = 'succeeded';
  -- Keep a bounded overlap. The previous watchdog success is written after
  -- its metrics snapshot, so using the heartbeat itself as an exclusive
  -- watermark can permanently skip evidence committed in that narrow gap.
  v_window_start := coalesce(
    v_watchdog_heartbeat - interval '5 minutes',
    v_now - interval '5 minutes'
  );
  select latch.* into strict v_latch
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global';
  select flag_row.enabled, flag_row.updated_at
  into v_shadow_enabled, v_shadow_since
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled';

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(queue_row)
    order by queue_row.workflow_key, queue_row.channel_key, queue_row.status), '[]'::jsonb)
  into v_queue
  from (
    select
      event_row.workflow_key,
      delivery.channel_key,
      delivery.status,
      pg_catalog.count(*)::integer as count,
      pg_catalog.greatest(0, pg_catalog.floor((pg_catalog.date_part('epoch', (
        v_now - pg_catalog.min(coalesce(delivery.next_attempt_at, delivery.scheduled_for))
      )))::numeric))::integer as oldest_pending_age_seconds
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
    where delivery.status in ('pending', 'claimed', 'sending', 'retry_wait')
    group by event_row.workflow_key, delivery.channel_key, delivery.status
  ) queue_row;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(closed_row)
    order by closed_row.workflow_key, closed_row.status, closed_row.status_reason), '[]'::jsonb)
  into v_closed
  from (
    select
      event_row.workflow_key,
      delivery.status,
      delivery.status_reason,
      pg_catalog.count(*)::integer as count
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
    where delivery.status in (
      'sent', 'delivery_unknown', 'failed', 'skipped', 'disabled', 'canceled'
    )
    group by event_row.workflow_key, delivery.status, delivery.status_reason
  ) closed_row;

  select pg_catalog.jsonb_build_object(
    'fanout', (
      select pg_catalog.count(*)::integer
      from dashboard_private.notification_event_fanout_jobs job
      where job.status in ('pending', 'claimed')
    ),
    'rule_reconciliation', (
      select pg_catalog.count(*)::integer
      from dashboard_private.notification_rule_reconciliation_jobs job
      where job.status in ('pending', 'claimed')
    ),
    'target_reconciliation', (
      select pg_catalog.count(*)::integer
      from dashboard_private.notification_target_reconciliation_jobs job
      where job.status in ('pending', 'claimed')
    )
  ) into v_jobs;

  select coalesce(pg_catalog.greatest(
    0,
    pg_catalog.floor((pg_catalog.date_part('epoch', (
      v_now - pg_catalog.min(coalesce(delivery.next_attempt_at, delivery.scheduled_for))
    )))::numeric)
  ), 0)::bigint into v_pending_lag
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
  where delivery.status in ('pending', 'retry_wait')
    and coalesce(delivery.next_attempt_at, delivery.scheduled_for) <= v_now
    and dashboard_private.notification_event_scope_active_v1(
      event_row.workflow_key, event_row.event_key
    );

  if v_worker_heartbeat is not null then
    v_worker_missed := pg_catalog.greatest(
      0,
      pg_catalog.floor((
        pg_catalog.date_part('epoch', (v_now - v_worker_heartbeat))
      )::numeric / 60)::integer
    );
  end if;

  select pg_catalog.count(*) into v_provider_shadow
  from dashboard_private.notification_audit_logs audit
  join dashboard_private.notification_deliveries delivery
    on audit.entity_kind = 'notification_delivery'
   and audit.entity_id = delivery.id::text
  where audit.action = 'dispatch_started'
    and delivery.channel_key <> 'in_app'
    and coalesce((audit.after_summary ->> 'shadow_enabled')::boolean, false)
    and audit.created_at >= v_window_start;
  select pg_catalog.count(*) into v_inbox_shadow
  from dashboard_private.notification_audit_logs audit
  where audit.action = 'inbox_projection_recorded'
    and audit.reason_code = 'canonical_inbox_in_shadow'
    and audit.created_at >= v_window_start;

  select pg_catalog.count(*) into v_duplicate
  from dashboard_private.notification_audit_logs audit
  where audit.action = 'duplicate_external_attempt'
    and audit.created_at >= v_window_start;
  select pg_catalog.count(*) into v_unknown
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
  where delivery.status = 'delivery_unknown'
    and delivery.updated_at >= v_window_start
    and dashboard_private.notification_event_scope_active_v1(
      event_row.workflow_key, event_row.event_key
    );
  select pg_catalog.count(*) into v_scope_mismatch
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
  where delivery.status_reason = 'workflow_scope_mismatch'
    and delivery.updated_at >= v_window_start
    and dashboard_private.notification_event_scope_active_v1(
      event_row.workflow_key, event_row.event_key
    );
  select pg_catalog.count(distinct delivery.rule_id) into v_zero_audience
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_rules rule_row on rule_row.id = delivery.rule_id
  join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
  where rule_row.enabled
    and delivery.status = 'skipped'
    and delivery.status_reason = 'no_recipient'
    and delivery.updated_at >= v_window_start
    and dashboard_private.notification_event_scope_active_v1(
      event_row.workflow_key, event_row.event_key
    );
  select pg_catalog.count(*) into v_ownership_anomaly
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
  join dashboard_private.notification_cutover_owners scope_owner
    on scope_owner.scope_key = dashboard_private.notification_dispatch_scope_for_event_v1(
      event_row.workflow_key, event_row.event_key
    )
  join dashboard_private.notification_runtime_flags dispatch_flag
    on dispatch_flag.flag_key = scope_owner.dispatch_flag_key
  left join dashboard_private.notification_dispatch_ownership_claims ownership
    on ownership.workflow_key = event_row.workflow_key
   and ownership.occurrence_key = event_row.occurrence_key
   and ownership.rule_id = delivery.rule_id
   and ownership.channel_key = delivery.channel_key
   and ownership.target_key = delivery.target_key
   and ownership.target_generation = delivery.target_generation
  where delivery.status in ('pending', 'claimed', 'sending')
    and (
      ownership.id is null
      or (dispatch_flag.enabled and ownership.owner_kind <> 'canonical')
      or (not dispatch_flag.enabled and ownership.owner_kind <> 'legacy')
    )
    and dashboard_private.notification_event_scope_active_v1(
      event_row.workflow_key, event_row.event_key
    );
  select pg_catalog.count(*) into v_ownership_denial
  from dashboard_private.notification_audit_logs audit
  where audit.action = 'ownership_not_acquired'
    and audit.created_at >= v_window_start
    and (
      (
        audit.entity_kind = 'notification_delivery'
        and exists (
          select 1
          from dashboard_private.notification_deliveries delivery
          join dashboard_private.notification_events event_row
            on event_row.id = delivery.event_id
          where delivery.id::text = audit.entity_id
            and dashboard_private.notification_event_scope_active_v1(
              event_row.workflow_key, event_row.event_key
            )
        )
      )
      or (
        audit.entity_kind = 'notification_dispatch_ownership'
        and exists (
          select 1
          from dashboard_private.notification_dispatch_ownership_claims ownership
          join dashboard_private.notification_rules rule_row
            on rule_row.id = ownership.rule_id
           and rule_row.workflow_key = ownership.workflow_key
          where ownership.id::text = audit.entity_id
            and dashboard_private.notification_event_scope_active_v1(
              rule_row.workflow_key, rule_row.event_key
            )
        )
      )
    );
  select pg_catalog.count(*) into v_shadow_match
  from dashboard_private.notification_audit_logs audit
  where audit.action = 'shadow_compare_result'
    and audit.reason_code = 'matched'
    and audit.created_at >= v_window_start
    and dashboard_private.notification_event_scope_active_v1(
      audit.after_summary ->> 'workflow_key', audit.after_summary ->> 'event_key'
    );
  select pg_catalog.count(*) into v_shadow_mismatch
  from dashboard_private.notification_audit_logs audit
  where audit.action = 'shadow_compare_result'
    and audit.reason_code <> 'matched'
    and audit.created_at >= v_window_start
    and dashboard_private.notification_event_scope_active_v1(
      audit.after_summary ->> 'workflow_key', audit.after_summary ->> 'event_key'
    );
  select pg_catalog.count(*) into v_rollback_failed
  from dashboard_private.notification_audit_logs audit
  where audit.action = 'rollback_failed'
    and audit.created_at >= v_window_start;
  select pg_catalog.count(*) into v_worker_route_fault
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.worker_id = 'notification-worker-route-v1'
    and heartbeat.phase = 'failed'
    and heartbeat.created_at >= v_window_start;
  v_schedule_fault := case
    when dashboard_private.notification_schedule_contract_ready_v1() then 0
    else 1
  end;

  return pg_catalog.jsonb_build_object(
    'generated_at', v_now,
    'worker_heartbeat_at', v_worker_heartbeat,
    'watchdog_heartbeat_at', v_watchdog_heartbeat,
    'worker_heartbeat_age_seconds', case when v_worker_heartbeat is null then null else
      pg_catalog.greatest(0, pg_catalog.floor((pg_catalog.date_part('epoch', (
        v_now - v_worker_heartbeat
      )))::numeric))::integer end,
    'watchdog_heartbeat_age_seconds', case when v_watchdog_heartbeat is null then null else
      pg_catalog.greatest(0, pg_catalog.floor((pg_catalog.date_part('epoch', (
        v_now - v_watchdog_heartbeat
      )))::numeric))::integer end,
    'worker_stop_latch', v_latch.stopped,
    'worker_stop_latch_revision', v_latch.revision::text,
    'queue', v_queue,
    'jobs', v_jobs,
    'closed_reasons', v_closed,
    'ownership_denial_count', v_ownership_denial,
    'shadow_comparison', pg_catalog.jsonb_build_object(
      'matched', v_shadow_match,
      'mismatched', v_shadow_mismatch,
      'match_rate_basis_points', case
        when v_shadow_match + v_shadow_mismatch = 0 then 0
        else pg_catalog.floor(
          (v_shadow_match * 10000)::numeric / (v_shadow_match + v_shadow_mismatch)
        )::integer
      end
    ),
    'stop_metrics', pg_catalog.jsonb_build_object(
      'canonical_provider_requests_in_shadow', v_provider_shadow,
      'canonical_inbox_projections_in_shadow', v_inbox_shadow,
      'duplicate_external_attempts', v_duplicate,
      'new_delivery_unknown', v_unknown,
      'pending_lag_seconds', v_pending_lag,
      'scope_mismatch_count', v_scope_mismatch,
      'zero_audience_enabled_rule_count', v_zero_audience,
      'ownership_anomaly_count', v_ownership_anomaly,
      'ownership_denial_count', v_ownership_denial,
      'shadow_mismatch_count', v_shadow_mismatch,
      'rollback_failed_count', v_rollback_failed,
      'missed_worker_heartbeats', v_worker_missed,
      'schedule_contract_fault_count', v_schedule_fault,
      'worker_route_fault_count', v_worker_route_fault
    )
  );
end;
$$;

create or replace function dashboard_private.notification_stop_metrics_clean_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stop jsonb := dashboard_private.notification_operations_metrics_v1() -> 'stop_metrics';
begin
  return (v_stop ->> 'canonical_provider_requests_in_shadow')::bigint = 0
    and (v_stop ->> 'canonical_inbox_projections_in_shadow')::bigint = 0
    and (v_stop ->> 'duplicate_external_attempts')::bigint = 0
    and (v_stop ->> 'new_delivery_unknown')::bigint = 0
    and (v_stop ->> 'pending_lag_seconds')::bigint <= 300
    and (v_stop ->> 'scope_mismatch_count')::bigint = 0
    and (v_stop ->> 'zero_audience_enabled_rule_count')::bigint = 0
    and (v_stop ->> 'ownership_anomaly_count')::bigint = 0
    and (v_stop ->> 'ownership_denial_count')::bigint = 0
    and (v_stop ->> 'shadow_mismatch_count')::bigint = 0
    and (v_stop ->> 'rollback_failed_count')::bigint = 0
    and (v_stop ->> 'missed_worker_heartbeats')::integer < 3
    and (v_stop ->> 'schedule_contract_fault_count')::integer = 0
    and (v_stop ->> 'worker_route_fault_count')::bigint = 0;
end;
$$;

create or replace function dashboard_private.notification_recovery_metrics_clean_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stop jsonb := dashboard_private.notification_operations_metrics_v1() -> 'stop_metrics';
begin
  return (v_stop ->> 'canonical_provider_requests_in_shadow')::bigint = 0
    and (v_stop ->> 'canonical_inbox_projections_in_shadow')::bigint = 0
    and (v_stop ->> 'duplicate_external_attempts')::bigint = 0
    and (v_stop ->> 'new_delivery_unknown')::bigint = 0
    and (v_stop ->> 'pending_lag_seconds')::bigint <= 300
    and (v_stop ->> 'scope_mismatch_count')::bigint = 0
    and (v_stop ->> 'zero_audience_enabled_rule_count')::bigint = 0
    and (v_stop ->> 'ownership_anomaly_count')::bigint = 0
    and (v_stop ->> 'ownership_denial_count')::bigint = 0
    and (v_stop ->> 'shadow_mismatch_count')::bigint = 0
    and (v_stop ->> 'rollback_failed_count')::bigint = 0
    and (v_stop ->> 'schedule_contract_fault_count')::integer = 0;
end;
$$;

create or replace function public.get_notification_operations_metrics_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.notification_operations_metrics_v1();
end;
$$;

create or replace function public.revalidate_immediate_notification_delivery_v1(
  p_workflow_key text,
  p_event_id uuid,
  p_delivery_id uuid,
  p_event_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_scheduled_for timestamp with time zone,
  p_target jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_source_exists boolean := false;
  v_profile_role text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null
    or p_event_id is null
    or p_delivery_id is null
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or nullif(pg_catalog.btrim(p_source_type), '') is null
    or nullif(pg_catalog.btrim(p_source_id), '') is null
    or (
      p_source_revision is not null
      and not (
        p_workflow_key = 'registration'
        and p_source_type = 'registration_appointment'
      )
    )
    or (
      p_workflow_key = 'registration'
      and p_source_type = 'registration_appointment'
      and (p_source_revision is null or p_source_revision < 1)
    )
    or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
    or p_target_generation is null or p_target_generation < 0
    or p_scheduled_for is null
    or p_target is null
    or pg_catalog.jsonb_typeof(p_target) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_target)) <> 5
    or not p_target ?& array[
      'target_kind', 'target_key', 'target_profile_id', 'connection_key', 'target_snapshot'
    ]
    or not exists (
      select 1
      from dashboard_private.notification_source_type_registry registry
      where registry.workflow_key = p_workflow_key
        and registry.source_type = p_source_type
    )
  then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
  end if;

  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id
    and event_row.workflow_key = p_workflow_key
    and event_row.event_key = p_event_key
    and event_row.source_type = p_source_type
    and event_row.source_id = p_source_id
    and event_row.source_revision is not distinct from p_source_revision;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
    and delivery.event_id = p_event_id
    and delivery.rule_id = p_rule_id
    and delivery.rule_revision = p_rule_revision
    and delivery.target_generation = p_target_generation
    and delivery.scheduled_for = p_scheduled_for
    and delivery.status = 'claimed';
  if not found
    or p_target ->> 'target_kind' is distinct from v_delivery.target_kind
    or p_target ->> 'target_key' is distinct from v_delivery.target_key
    or nullif(p_target ->> 'target_profile_id', '')::uuid
      is distinct from v_delivery.target_profile_id
    or p_target ->> 'connection_key' is distinct from v_delivery.connection_key
    or p_target -> 'target_snapshot' is distinct from v_delivery.target_snapshot
  then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
  end if;

  select rule_row.* into v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id
    and rule_row.workflow_key = p_workflow_key
    and rule_row.event_key = p_event_key
    and rule_row.delivery_mode = 'immediate';
  if not found or not v_rule.enabled or v_rule.revision <> p_rule_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'rule_revision_changed'
    );
  end if;

  begin
    v_source_exists := case p_source_type
      when 'ops_task_event' then exists (
        select 1
        from public.ops_task_events source
        join public.ops_tasks task on task.id = source.task_id
        where source.id = p_source_id::uuid
          and task.id::text = v_event.payload ->> 'task_id'
          and (
            (
              p_workflow_key = 'registration'
              and source.event_type = 'registration_track_event'
              and task.type = 'registration'
              and task.id::text = v_event.payload ->> 'task_id'
              and dashboard_private.registration_track_event_key_v1(
                source.after_value::jsonb ->> 'event_type',
                coalesce(source.after_value::jsonb -> 'metadata', '{}'::jsonb)
              ) = p_event_key
            )
            or (
              p_workflow_key = 'tasks'
              and task.type = 'general'
              and source.event_type = p_event_key
            )
            or (
              p_workflow_key = 'word_retests'
              and task.type = 'word_retest'
              and source.event_type = p_event_key
            )
            or (
              p_workflow_key in ('transfer', 'withdrawal')
              and task.type = p_workflow_key
              and source.event_type = p_event_key
            )
          )
      )
      when 'ops_task_comment' then exists (
        select 1
        from public.ops_task_comments source
        join public.ops_tasks task on task.id = source.task_id
        where source.id = p_source_id::uuid
          and p_workflow_key = 'tasks'
          and p_event_key = 'task.comment_added'
          and task.type = 'general'
          and task.id::text = v_event.payload ->> 'task_id'
      )
      when 'makeup_request_event' then exists (
        select 1 from public.makeup_request_events source where source.id = p_source_id::uuid
      )
      when 'approval_event' then exists (
        select 1 from public.approval_events source
        where source.id = p_source_id::uuid
          and source.approval_id::text = v_event.payload ->> 'approval_id'
          and source.event_type = case p_event_key
            when 'approval.created' then 'created'
            when 'approval.submitted' then 'status_changed'
            when 'approval.resubmitted' then 'status_changed'
            when 'approval.review_started' then 'status_changed'
            when 'approval.approved' then 'status_changed'
            when 'approval.returned' then 'status_changed'
            when 'approval.canceled' then 'status_changed'
            when 'approval.approver_changed' then 'approver_changed'
            when 'approval.deleted' then 'deleted'
            else null
          end
      )
      when 'approval_comment' then exists (
        select 1 from public.approval_comments source
        where source.id = p_source_id::uuid
          and source.approval_id::text = v_event.payload ->> 'approval_id'
      )
      when 'registration_appointment' then exists (
        select 1
        from public.ops_registration_appointments appointment
        where p_workflow_key = 'registration'
          and p_event_key like 'registration.visit_%'
          and appointment.id = p_source_id::uuid
          and appointment.kind = 'visit_consultation'
          and appointment.task_id::text = v_event.payload ->> 'task_id'
          and appointment.id::text = v_event.payload ->> 'appointment_id'
          and appointment.notification_revision = p_source_revision
          and appointment.notification_revision::text
            = v_event.payload ->> 'notification_revision'
          and appointment.recipient_revision = p_target_generation
          and appointment.recipient_revision::text
            = v_event.payload ->> 'recipient_revision'
          and (
            (p_event_key = 'registration.visit_canceled' and appointment.status = 'canceled')
            or (
              p_event_key = 'registration.visit_replaced'
              and appointment.status in ('scheduled', 'canceled')
            )
            or (
              p_event_key not in (
                'registration.visit_canceled', 'registration.visit_replaced'
              )
              and appointment.status = 'scheduled'
            )
          )
      )
      when 'ops_registration_message' then exists (
        select 1
        from public.ops_registration_messages message
        where p_workflow_key = 'registration'
          and p_event_key = 'registration.admission_message_requested'
          and message.id = p_source_id::uuid
          and message.template_key = 'admission_application'
          and message.status = 'pending'
          and message.claim_active
          and message.task_id::text = v_event.payload ->> 'task_id'
          and message.id::text = v_event.payload ->> 'message_id'
          and message.request_key = v_event.payload ->> 'message_request_key'
          and v_delivery.target_kind = 'customer_endpoint'
          and v_delivery.target_key = 'registration-message:' || message.id::text
          and v_delivery.target_snapshot ->> 'message_id' = message.id::text
          and v_delivery.target_snapshot ->> 'request_key_hash'
            = pg_catalog.md5(message.request_key)
      )
      else false
    end;
  exception
    when invalid_text_representation then
      v_source_exists := false;
  end;
  if not v_source_exists then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'source_status_changed'
    );
  end if;

  if v_delivery.target_profile_id is not null then
    select profile.role into v_profile_role
    from public.profiles profile
    where profile.id = v_delivery.target_profile_id;
    if not found
      or not dashboard_private.notification_profile_is_active_v1(
        v_delivery.target_profile_id
      )
      or (v_delivery.audience_key in ('management_team', 'executive_team')
        and v_profile_role not in ('admin', 'staff'))
      or (v_delivery.audience_key = 'subject_team'
        and v_profile_role not in ('admin', 'staff', 'teacher'))
      or (
        p_workflow_key in ('tasks', 'word_retests')
        and p_source_type in ('ops_task_event', 'ops_task_comment')
        and v_delivery.audience_key in (
          'primary_assignee', 'assigned_assistant', 'secondary_assignee'
        )
        and not exists (
          select 1
          from public.ops_tasks task
          where task.id::text = v_event.payload ->> 'task_id'
            and (
              (
                p_workflow_key = 'tasks'
                and v_delivery.audience_key = 'primary_assignee'
                and task.assignee_id = v_delivery.target_profile_id
              )
              or (
                p_workflow_key = 'word_retests'
                and v_delivery.audience_key = 'assigned_assistant'
                and task.assignee_id = v_delivery.target_profile_id
              )
              or (
                v_delivery.audience_key = 'secondary_assignee'
                and task.secondary_assignee_id = v_delivery.target_profile_id
              )
            )
        )
      )
      or (
        p_workflow_key = 'registration'
        and p_source_type = 'registration_appointment'
        and v_delivery.audience_key = 'track_director'
        and not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_source_id::uuid
            and consultation.mode = 'visit'
            and consultation.director_profile_id = v_delivery.target_profile_id
        )
      )
      or (
        p_workflow_key = 'registration'
        and p_event_key = 'registration.phone_consultation_ready'
        and v_delivery.audience_key = 'track_director'
        and not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.id = nullif(v_event.payload ->> 'consultation_id', '')::uuid
            and consultation.mode = 'phone'
            and consultation.status = 'waiting'
            and consultation.recipient_revision = p_target_generation
            and consultation.director_profile_id = v_delivery.target_profile_id
        )
      )
    then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
      );
    end if;
  end if;
  if v_delivery.connection_key is not null and not exists (
    select 1
    from public.google_chat_webhook_settings connection
    where connection.channel = case v_delivery.connection_key
      when 'google_chat.management' then 'admin'
      when 'google_chat.executive' then 'executive'
      when 'google_chat.math' then 'math'
      when 'google_chat.english' then 'english'
      else null
    end
      and connection.connection_state in ('legacy_active', 'encrypted_active')
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
    );
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
exception
  when invalid_text_representation then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
    );
end;
$$;

create or replace function dashboard_private.notification_event_matches_dispatch_flag_v1(
  p_workflow_key text,
  p_event_key text,
  p_flag_key text
) returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_flag_key
    when 'notification_control_plane_dispatch_tasks_enabled'
      then p_workflow_key = 'tasks'
    when 'notification_control_plane_dispatch_word_retests_enabled'
      then p_workflow_key = 'word_retests'
    when 'notification_control_plane_dispatch_transfer_enabled'
      then p_workflow_key = 'transfer'
    when 'notification_control_plane_dispatch_withdrawal_enabled'
      then p_workflow_key = 'withdrawal'
    when 'notification_control_plane_dispatch_makeup_requests_enabled'
      then p_workflow_key = 'makeup_requests'
    when 'notification_control_plane_dispatch_approvals_enabled'
      then p_workflow_key = 'approvals'
    when 'notification_control_plane_registration_phone_adapter_enabled'
      then p_workflow_key = 'registration'
        and p_event_key = 'registration.phone_consultation_ready'
    when 'notification_control_plane_registration_visit_adapter_enabled'
      then p_workflow_key = 'registration' and p_event_key like 'registration.visit_%'
    when 'notification_control_plane_registration_solapi_adapter_enabled'
      then p_workflow_key = 'registration'
        and p_event_key like 'registration.admission_message_%'
    when 'notification_control_plane_dispatch_registration_enabled'
      then p_workflow_key = 'registration'
        and p_event_key <> 'registration.phone_consultation_ready'
        and p_event_key not like 'registration.visit_%'
        and p_event_key not like 'registration.admission_message_%'
    else false
  end;
$$;

create or replace function dashboard_private.cancel_notification_cutover_deliveries_v1(
  p_flag_keys text[],
  p_reason text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_canceled integer := 0;
  v_cancel_requested integer := 0;
begin
  update dashboard_private.notification_deliveries delivery
  set status = 'canceled',
      status_reason = 'cutover_rollback',
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      cancel_requested_at = null,
      cancel_reason = null,
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where event_row.id = delivery.event_id
    and delivery.status in ('pending', 'retry_wait')
    and exists (
      select 1
      from pg_catalog.unnest(p_flag_keys) supplied(flag_key)
      where dashboard_private.notification_event_matches_dispatch_flag_v1(
        event_row.workflow_key, event_row.event_key, supplied.flag_key
      )
    );
  get diagnostics v_canceled = row_count;

  update dashboard_private.notification_deliveries delivery
  set cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.clock_timestamp()),
      cancel_reason = 'cutover_rollback',
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where event_row.id = delivery.event_id
    and delivery.status = 'claimed'
    and exists (
      select 1
      from pg_catalog.unnest(p_flag_keys) supplied(flag_key)
      where dashboard_private.notification_event_matches_dispatch_flag_v1(
        event_row.workflow_key, event_row.event_key, supplied.flag_key
      )
    );
  get diagnostics v_cancel_requested = row_count;

  return pg_catalog.jsonb_build_object(
    'canceledCount', v_canceled,
    'cancelRequestedCount', v_cancel_requested,
    'reason', p_reason
  );
end;
$$;

create or replace function dashboard_private.raise_notification_worker_stop_latch_v1(
  p_reason_code text
) returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revision bigint;
begin
  if p_reason_code !~ '^[a-z0-9_]{3,64}$' then
    raise exception 'notification_latch_reason_invalid' using errcode = '22023';
  end if;
  update dashboard_private.notification_worker_stop_latch latch
  set stopped = true,
      revision = latch.revision + 1,
      reason_code = p_reason_code,
      updated_at = pg_catalog.clock_timestamp()
  where latch.latch_key = 'global'
    and (not latch.stopped or latch.reason_code is distinct from p_reason_code)
  returning latch.revision into v_revision;
  if v_revision is null then
    select latch.revision into strict v_revision
    from dashboard_private.notification_worker_stop_latch latch
    where latch.latch_key = 'global';
  end if;
  return v_revision;
end;
$$;

create or replace function dashboard_private.activate_notification_dispatch_cutover_v1_impl(
  p_scope_key text,
  p_dispatch_flag_key text,
  p_expected_flag_revisions jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner dashboard_private.notification_cutover_owners%rowtype;
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
  v_first_owner boolean;
  v_shadow_enabled boolean;
  v_shadow_since timestamp with time zone;
  v_flag_enabled boolean;
  v_scope_order text[] := dashboard_private.notification_cutover_scope_order_v1();
  v_requested_position integer;
  v_canonical_count integer;
  v_is_reactivation boolean := false;
  v_scope_config_digests jsonb;
  v_baseline_config_digests jsonb;
  v_cutover_build_revision_hash text;
  v_baseline_build_revision_hash text;
  v_build_evidence_since timestamp with time zone;
begin
  if p_scope_key is null
    or p_dispatch_flag_key is null
    or p_request_id is null
    or p_expected_flag_revisions is null
  then
    raise exception 'notification_cutover_activation_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  -- Settings saves and evidence evaluation must be one serial order.  SHARE
  -- locks block concurrent rule/template inserts and updates until activation
  -- has either committed or failed, so old evidence cannot race a new config.
  lock table dashboard_private.notification_rules in share mode;
  lock table dashboard_private.notification_templates in share mode;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'scope_key', p_scope_key,
    'dispatch_flag_key', p_dispatch_flag_key,
    'expected_flag_revisions', p_expected_flag_revisions
  )::text);
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_cutover_activate', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;

  perform dashboard_private.lock_notification_flag_revisions_v1(
    p_expected_flag_revisions
  );
  select owner_row.* into v_owner
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = p_scope_key
    and owner_row.dispatch_flag_key = p_dispatch_flag_key
  for update of owner_row;
  if not found then
    raise exception 'notification_cutover_scope_flag_mismatch' using errcode = '22023';
  end if;
  select flag_row.enabled into strict v_flag_enabled
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = p_dispatch_flag_key;
  if v_flag_enabled or v_owner.owner_kind <> 'legacy' then
    raise exception 'notification_cutover_owner_already_active' using errcode = '40001';
  end if;

  v_requested_position := pg_catalog.array_position(v_scope_order, p_scope_key);
  select pg_catalog.count(*)::integer into v_canonical_count
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.owner_kind = 'canonical';
  select exists (
    select 1
    from dashboard_private.notification_audit_logs rollback_audit
    where rollback_audit.entity_kind = 'notification_cutover'
      and rollback_audit.action = 'cutover_rolled_back'
      and rollback_audit.entity_id in (p_scope_key, 'all')
      and rollback_audit.created_at > coalesce((
        select pg_catalog.max(activation_audit.created_at)
        from dashboard_private.notification_audit_logs activation_audit
        where activation_audit.entity_kind = 'notification_cutover'
          and activation_audit.action = 'cutover_activated'
          and activation_audit.entity_id = p_scope_key
      ), '-infinity'::timestamptz)
  ) into v_is_reactivation;
  if v_requested_position is null
    or exists (
      select 1
      from pg_catalog.unnest(v_scope_order) with ordinality
        expected(scope_key, ordinality)
      left join dashboard_private.notification_cutover_owners owner_row
        on owner_row.scope_key = expected.scope_key
      left join dashboard_private.notification_runtime_flags flag_row
        on flag_row.flag_key = owner_row.dispatch_flag_key
      where owner_row.scope_key is null
        or flag_row.flag_key is null
        or ((owner_row.owner_kind = 'canonical') is distinct from flag_row.enabled)
        or (
          expected.ordinality < v_requested_position
          and (owner_row.owner_kind <> 'canonical' or not flag_row.enabled)
        )
    )
    or (
      not v_is_reactivation
      and (
        v_requested_position <> v_canonical_count + 1
        or exists (
          select 1
          from pg_catalog.unnest(v_scope_order) with ordinality
            expected(scope_key, ordinality)
          join dashboard_private.notification_cutover_owners owner_row
            on owner_row.scope_key = expected.scope_key
          join dashboard_private.notification_runtime_flags flag_row
            on flag_row.flag_key = owner_row.dispatch_flag_key
          where expected.ordinality >= v_requested_position
            and (owner_row.owner_kind <> 'legacy' or flag_row.enabled)
        )
      )
    )
  then
    raise exception 'notification_cutover_order_invalid' using errcode = '55000';
  end if;

  if not dashboard_private.notification_runtime_dependency_ready_v1('common')
    or not dashboard_private.notification_runtime_dependency_ready_v1('adapters')
    or not dashboard_private.notification_runtime_dependency_ready_v1('forward_compat')
    or (v_owner.workflow_key = 'registration'
      and (
        not dashboard_private.notification_runtime_dependency_ready_v1('registration')
        or not dashboard_private.notification_runtime_dependency_ready_v1(
          'registration_handoffs'
        )
      ))
    or not dashboard_private.notification_recent_runtime_heartbeats_v1()
    or not dashboard_private.notification_schedule_contract_ready_v1()
    or not dashboard_private.notification_stop_metrics_clean_v1()
  then
    raise exception 'notification_cutover_readiness_failed' using errcode = '55000';
  end if;
  if exists (
    select 1 from dashboard_private.notification_event_fanout_jobs job
    where job.status in ('pending', 'claimed')
  ) or exists (
    select 1 from dashboard_private.notification_rule_reconciliation_jobs job
    where job.status in ('pending', 'claimed')
  ) or exists (
    select 1 from dashboard_private.notification_target_reconciliation_jobs job
    where job.status in ('pending', 'claimed')
  ) then
    raise exception 'notification_cutover_backlog_not_drained' using errcode = '55000';
  end if;
  if exists (
    select 1 from dashboard_private.notification_event_fanout_jobs job
    where job.status = 'failed'
      and job.last_error_code in (
        'reconciler_missing', 'payload_schema_unsupported',
        'transient_database_failure', 'worker_error', 'worker_lease_expired'
      )
  ) or exists (
    select 1 from dashboard_private.notification_rule_reconciliation_jobs job
    where job.status = 'failed'
      and job.last_error_code in (
        'reconciler_missing', 'payload_schema_unsupported',
        'transient_database_failure', 'worker_error', 'worker_lease_expired'
      )
  ) or exists (
    select 1 from dashboard_private.notification_target_reconciliation_jobs job
    where job.status = 'failed'
      and job.last_error_code in (
        'reconciler_missing', 'payload_schema_unsupported',
        'transient_database_failure', 'worker_error', 'worker_lease_expired'
      )
  ) then
    raise exception 'notification_cutover_retryable_job_not_resolved'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from dashboard_private.notification_dispatch_ownership_claims ownership
    join dashboard_private.notification_rules rule_row
      on rule_row.id = ownership.rule_id
    where ownership.owner_kind = 'legacy'
      and ownership.state in ('reserved', 'dispatch_started')
      and dashboard_private.notification_dispatch_scope_for_event_v1(
        rule_row.workflow_key, rule_row.event_key
      ) = p_scope_key
  ) then
    raise exception 'notification_cutover_legacy_drain_incomplete'
      using errcode = '55000';
  end if;

  select not exists (
    select 1
    from dashboard_private.notification_cutover_owners owner_row
    where owner_row.owner_kind = 'canonical'
  ) into v_first_owner;
  select flag_row.enabled, flag_row.updated_at
  into strict v_shadow_enabled, v_shadow_since
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled';
  if (v_first_owner and not v_shadow_enabled)
    or (not v_first_owner and v_shadow_enabled)
  then
    raise exception 'notification_cutover_shadow_state_invalid' using errcode = '55000';
  end if;
  if v_first_owner then v_build_evidence_since := v_shadow_since; end if;
  select pg_catalog.jsonb_object_agg(
    expected.scope_key,
    dashboard_private.notification_shadow_scope_config_digest_v1(
      expected.scope_key
    ) order by expected.ordinality
  ) into strict v_scope_config_digests
  from pg_catalog.unnest(v_scope_order) with ordinality
    expected(scope_key, ordinality);
  if not v_first_owner then
    select
      activation.after_summary -> 'scope_config_digests',
      activation.after_summary ->> 'build_revision_hash',
      nullif(
        activation.after_summary ->> 'build_evidence_since', ''
      )::timestamp with time zone
    into
      v_baseline_config_digests,
      v_baseline_build_revision_hash,
      v_build_evidence_since
    from dashboard_private.notification_audit_logs activation
    where activation.entity_kind = 'notification_cutover'
      and activation.action = 'cutover_activated'
      and activation.after_summary ->> 'first_owner' = 'true'
    order by activation.created_at desc, activation.id desc
    limit 1;
    if v_baseline_config_digests is null
      or pg_catalog.jsonb_typeof(v_baseline_config_digests) <> 'object'
      or v_baseline_config_digests ->> p_scope_key is distinct from
        v_scope_config_digests ->> p_scope_key
    then
      raise exception 'notification_cutover_scope_config_changed'
        using errcode = '55000';
    end if;
  end if;
  v_cutover_build_revision_hash :=
    dashboard_private.notification_current_contract_build_revision_hash_v1(
      v_build_evidence_since
    );
  if v_cutover_build_revision_hash is null then
    raise exception 'notification_cutover_build_readiness_failed'
      using errcode = '55000';
  end if;
  if not v_first_owner and (
    v_baseline_build_revision_hash is null
    or v_baseline_build_revision_hash is distinct from
      v_cutover_build_revision_hash
  ) then
    raise exception 'notification_cutover_build_revision_changed'
      using errcode = '55000';
  end if;
  if v_first_owner and (
    v_shadow_since > pg_catalog.clock_timestamp() - interval '7 days'
    or not dashboard_private.notification_shadow_scope_evidence_complete_v1(
      v_shadow_since
    )
    or exists (
      select 1
      from dashboard_private.notification_audit_logs intent
      where intent.entity_kind = 'notification_shadow_intent'
        and intent.action in ('canonical_intent_recorded', 'legacy_intent_recorded')
        and intent.created_at >= v_shadow_since
        and intent.created_at > pg_catalog.clock_timestamp() - interval '5 minutes'
    )
    or exists (
      select 1
      from dashboard_private.notification_audit_logs intent
      where intent.entity_kind = 'notification_shadow_intent'
        and intent.action in ('canonical_intent_recorded', 'legacy_intent_recorded')
        and intent.created_at >= v_shadow_since
        and not exists (
          select 1
          from dashboard_private.notification_audit_logs comparison
          where comparison.entity_kind = 'notification_shadow_comparison'
            and comparison.action = 'shadow_compare_result'
            and comparison.reason_code = 'matched'
            and (
              comparison.after_summary ->> 'canonical_intent_fingerprint'
                = intent.entity_id
              or comparison.after_summary ->> 'legacy_intent_fingerprint'
                = intent.entity_id
              or comparison.after_summary ->> 'source_intent_fingerprint'
                = intent.entity_id
            )
        )
    )
  ) then
    raise exception 'notification_cutover_shadow_observation_incomplete'
      using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'app.notification_cutover_activation_authorized', 'true', true
  );
  if v_first_owner then
    update dashboard_private.notification_runtime_flags flag_row
    set enabled = false,
        revision = flag_row.revision + 1,
        updated_by = null,
        updated_at = pg_catalog.clock_timestamp()
    where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
      and flag_row.enabled;
  end if;
  update dashboard_private.notification_runtime_flags flag_row
  set enabled = true,
      revision = flag_row.revision + 1,
      updated_by = null,
      updated_at = pg_catalog.clock_timestamp()
  where flag_row.flag_key = p_dispatch_flag_key
    and not flag_row.enabled;
  if not found then
    raise exception 'notification_cutover_activation_conflict' using errcode = '40001';
  end if;
  update dashboard_private.notification_cutover_owners owner_row
  set owner_kind = 'canonical',
      revision = owner_row.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where owner_row.scope_key = p_scope_key
    and owner_row.owner_kind = 'legacy';
  if not found then
    raise exception 'notification_cutover_owner_conflict' using errcode = '40001';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'scopeKey', p_scope_key,
    'dispatchFlagKey', p_dispatch_flag_key,
    'ownerKind', 'canonical',
    'firstOwner', v_first_owner,
    'shadowEnabled', false,
    'buildRevisionHash', v_cutover_build_revision_hash,
    'buildEvidenceSince', v_build_evidence_since,
    'scopeConfigDigest', v_scope_config_digests ->> p_scope_key,
    'flagRevisions', dashboard_private.current_notification_flag_revisions_v1()
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_cutover', p_scope_key, 'cutover_activated', null, 'system',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'dispatch_flag_key', p_dispatch_flag_key,
      'owner_kind', 'canonical',
      'first_owner', v_first_owner,
      'build_revision_hash', v_cutover_build_revision_hash,
      'build_evidence_since', v_build_evidence_since,
      'scope_config_digest', v_scope_config_digests ->> p_scope_key,
      'scope_config_digests', case
        when v_first_owner then v_scope_config_digests
        else null
      end
    ),
    'authorized_activation'
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_cutover_activate', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.activate_notification_dispatch_cutover_v1(
  p_scope_key text,
  p_dispatch_flag_key text,
  p_expected_flag_revisions jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.activate_notification_dispatch_cutover_v1_impl(
    p_scope_key, p_dispatch_flag_key, p_expected_flag_revisions, p_request_id
  );
end;
$$;

create or replace function dashboard_private.abort_notification_shadow_v1_impl(
  p_expected_flag_revisions jsonb,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
  v_cancellation jsonb;
  v_latch_revision bigint;
  v_job_count integer := 0;
  v_changed integer := 0;
begin
  if p_request_id is null
    or p_reason_code !~ '^[a-z0-9_]{3,64}$'
  then
    raise exception 'notification_shadow_abort_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'expected_flag_revisions', p_expected_flag_revisions,
    'reason_code', p_reason_code
  )::text);
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_shadow_abort', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;
  perform dashboard_private.lock_notification_flag_revisions_v1(
    p_expected_flag_revisions
  );
  if exists (
    select 1
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = any(dashboard_private.notification_dispatch_flag_keys_v1())
      and flag_row.enabled
  ) or not exists (
    select 1
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
      and flag_row.enabled
  ) then
    raise exception 'notification_shadow_abort_phase_invalid' using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'app.notification_cutover_activation_authorized', 'true', true
  );
  update dashboard_private.notification_runtime_flags flag_row
  set enabled = false,
      revision = flag_row.revision + 1,
      updated_by = null,
      updated_at = pg_catalog.clock_timestamp()
  where flag_row.enabled;
  update dashboard_private.notification_cutover_owners owner_row
  set owner_kind = 'legacy',
      revision = owner_row.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where owner_row.owner_kind <> 'legacy';

  v_cancellation := dashboard_private.cancel_notification_cutover_deliveries_v1(
    dashboard_private.notification_dispatch_flag_keys_v1(), p_reason_code
  );
  update dashboard_private.notification_event_fanout_jobs job
  set status = 'failed',
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      last_error_code = 'shadow_aborted',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.status in ('pending', 'claimed');
  get diagnostics v_changed = row_count;
  v_job_count := v_job_count + v_changed;
  update dashboard_private.notification_rule_reconciliation_jobs job
  set status = 'failed', next_attempt_at = null, claimed_by = null,
      claim_token = null, lease_expires_at = null,
      last_error_code = 'shadow_aborted',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.status in ('pending', 'claimed');
  get diagnostics v_changed = row_count;
  v_job_count := v_job_count + v_changed;
  update dashboard_private.notification_target_reconciliation_jobs job
  set status = 'failed', next_attempt_at = null, claimed_by = null,
      claim_token = null, lease_expires_at = null,
      last_error_code = 'shadow_aborted',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.status in ('pending', 'claimed');
  get diagnostics v_changed = row_count;
  v_job_count := v_job_count + v_changed;
  v_latch_revision := dashboard_private.raise_notification_worker_stop_latch_v1(
    p_reason_code
  );
  v_response := pg_catalog.jsonb_build_object(
    'aborted', true,
    'shadowEnabled', false,
    'allDispatchFlagsEnabled', false,
    'workerStopLatch', true,
    'workerStopLatchRevision', v_latch_revision::text,
    'cancellation', v_cancellation,
    'fanoutJobsStopped', v_job_count,
    'flagRevisions', dashboard_private.current_notification_flag_revisions_v1()
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_cutover', 'shadow', 'shadow_aborted', null, 'system',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'worker_stop_latch', true,
      'fanout_jobs_stopped', v_job_count,
      'canceled_count', (v_cancellation ->> 'canceledCount')::integer,
      'cancel_requested_count', (v_cancellation ->> 'cancelRequestedCount')::integer
    ),
    p_reason_code
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_shadow_abort', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.abort_notification_shadow_v1(
  p_expected_flag_revisions jsonb,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.abort_notification_shadow_v1_impl(
    p_expected_flag_revisions, p_request_id, p_reason_code
  );
end;
$$;

create or replace function dashboard_private.rollback_notification_dispatch_cutover_v1_impl(
  p_scope_key text,
  p_flag_keys text[],
  p_expected_flag_revisions jsonb,
  p_reenable_shadow boolean,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
  v_cancellation jsonb;
  v_supplied text[];
  v_enabled text[];
  v_scope_count integer;
  v_canonical_owner_count integer;
  v_latch_revision bigint;
  v_global_fault boolean;
  v_job_count integer := 0;
  v_changed integer := 0;
begin
  select pg_catalog.array_agg(flag_key order by flag_key) into v_supplied
  from (
    select distinct supplied.flag_key
    from pg_catalog.unnest(p_flag_keys) supplied(flag_key)
  ) normalized;
  if p_scope_key is null
    or p_flag_keys is null
    or pg_catalog.cardinality(p_flag_keys) < 1
    or pg_catalog.cardinality(v_supplied) <> pg_catalog.cardinality(p_flag_keys)
    or exists (
      select 1 from pg_catalog.unnest(v_supplied) supplied(flag_key)
      where supplied.flag_key is null
        or not supplied.flag_key = any(
          dashboard_private.notification_dispatch_flag_keys_v1()
        )
    )
    or p_reenable_shadow is null
    or p_request_id is null
    or p_reason_code !~ '^[a-z0-9_]{3,64}$'
  then
    raise exception 'notification_cutover_rollback_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  select pg_catalog.count(distinct owner_row.scope_key)::integer into v_scope_count
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.dispatch_flag_key = any(v_supplied)
    and (
      p_scope_key = 'all'
      or owner_row.scope_key = p_scope_key
    );
  if (p_scope_key = 'all' and v_scope_count <> pg_catalog.cardinality(v_supplied))
    or (p_scope_key <> 'all'
      and (pg_catalog.cardinality(v_supplied) <> 1 or v_scope_count <> 1))
  then
    raise exception 'notification_cutover_rollback_scope_mismatch' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'scope_key', p_scope_key,
    'flag_keys', v_supplied,
    'expected_flag_revisions', p_expected_flag_revisions,
    'reenable_shadow', p_reenable_shadow,
    'reason_code', p_reason_code
  )::text);
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_cutover_rollback', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;
  perform dashboard_private.lock_notification_flag_revisions_v1(
    p_expected_flag_revisions
  );
  select pg_catalog.array_agg(flag_row.flag_key order by flag_row.flag_key)
  into v_enabled
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = any(
    dashboard_private.notification_dispatch_flag_keys_v1()
  ) and flag_row.enabled;
  v_enabled := coalesce(v_enabled, array[]::text[]);
  if exists (
    select 1 from pg_catalog.unnest(v_supplied) supplied(flag_key)
    where not supplied.flag_key = any(v_enabled)
  ) then
    raise exception 'notification_cutover_rollback_owner_not_enabled' using errcode = '40001';
  end if;
  if p_scope_key = 'all' and v_supplied is distinct from v_enabled then
    raise exception 'notification_cutover_all_owner_set_incomplete' using errcode = '22023';
  end if;
  perform 1
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.dispatch_flag_key = any(v_supplied)
  order by owner_row.scope_key
  for update of owner_row;
  select pg_catalog.count(*)::integer into v_canonical_owner_count
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.dispatch_flag_key = any(v_supplied)
    and owner_row.owner_kind = 'canonical';
  if v_canonical_owner_count <> pg_catalog.cardinality(v_supplied) then
    raise exception 'notification_cutover_owner_conflict' using errcode = '40001';
  end if;

  v_global_fault := p_reason_code in (
    'global_execution_fault', 'worker_heartbeat_missed',
    'duplicate_external_attempt', 'schedule_contract_fault',
    'vault_fault', 'worker_route_fault'
  );
  if p_reenable_shadow and (
    p_scope_key <> 'all'
    or v_supplied is distinct from v_enabled
    or v_global_fault
    or exists (
      select 1 from dashboard_private.notification_worker_stop_latch latch
      where latch.latch_key = 'global' and latch.stopped
    )
    or not dashboard_private.notification_success_heartbeats_fresh_v1()
    or not dashboard_private.notification_schedule_contract_ready_v1()
    or not dashboard_private.notification_stop_metrics_clean_v1()
  ) then
    raise exception 'notification_cutover_shadow_reenable_forbidden' using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'app.notification_cutover_activation_authorized', 'true', true
  );
  update dashboard_private.notification_runtime_flags flag_row
  set enabled = false,
      revision = flag_row.revision + 1,
      updated_by = null,
      updated_at = pg_catalog.clock_timestamp()
  where flag_row.flag_key = 'notification_control_plane_settings_ui_enabled'
    and flag_row.enabled;
  update dashboard_private.notification_runtime_flags flag_row
  set enabled = false,
      revision = flag_row.revision + 1,
      updated_by = null,
      updated_at = pg_catalog.clock_timestamp()
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
    and flag_row.enabled;
  update dashboard_private.notification_runtime_flags flag_row
  set enabled = false,
      revision = flag_row.revision + 1,
      updated_by = null,
      updated_at = pg_catalog.clock_timestamp()
  where flag_row.flag_key = any(v_supplied)
    and flag_row.enabled;
  if not found then
    raise exception 'notification_cutover_rollback_conflict' using errcode = '40001';
  end if;
  update dashboard_private.notification_cutover_owners owner_row
  set owner_kind = 'legacy',
      revision = owner_row.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where owner_row.dispatch_flag_key = any(v_supplied)
    and owner_row.owner_kind = 'canonical';
  if not found then
    raise exception 'notification_cutover_owner_conflict' using errcode = '40001';
  end if;
  v_cancellation := dashboard_private.cancel_notification_cutover_deliveries_v1(
    v_supplied, p_reason_code
  );
  update dashboard_private.notification_event_fanout_jobs job
  set status = 'failed', next_attempt_at = null, claimed_by = null,
      claim_token = null, lease_expires_at = null,
      last_error_code = 'cutover_rollback',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where job.event_id = event_row.id
    and job.status in ('pending', 'claimed')
    and (
      p_scope_key = 'all'
      or dashboard_private.notification_dispatch_scope_for_event_v1(
        event_row.workflow_key, event_row.event_key
      ) = p_scope_key
    );
  get diagnostics v_changed = row_count;
  v_job_count := v_job_count + v_changed;
  update dashboard_private.notification_target_reconciliation_jobs job
  set status = 'failed', next_attempt_at = null, claimed_by = null,
      claim_token = null, lease_expires_at = null,
      last_error_code = 'cutover_rollback',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where job.source_event_id = event_row.id
    and job.status in ('pending', 'claimed')
    and (
      p_scope_key = 'all'
      or dashboard_private.notification_dispatch_scope_for_event_v1(
        event_row.workflow_key, event_row.event_key
      ) = p_scope_key
    );
  get diagnostics v_changed = row_count;
  v_job_count := v_job_count + v_changed;
  update dashboard_private.notification_rule_reconciliation_jobs job
  set status = 'failed', next_attempt_at = null, claimed_by = null,
      claim_token = null, lease_expires_at = null,
      last_error_code = 'cutover_rollback',
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.status in ('pending', 'claimed')
    and (
      p_scope_key = 'all'
      or exists (
        select 1
        from dashboard_private.notification_cutover_owners owner_row
        where owner_row.scope_key = p_scope_key
          and owner_row.workflow_key = job.workflow_key
      )
    );
  get diagnostics v_changed = row_count;
  v_job_count := v_job_count + v_changed;

  if v_global_fault then
    v_latch_revision := dashboard_private.raise_notification_worker_stop_latch_v1(
      p_reason_code
    );
  else
    select latch.revision into strict v_latch_revision
    from dashboard_private.notification_worker_stop_latch latch
    where latch.latch_key = 'global';
  end if;
  if p_reenable_shadow then
    update dashboard_private.notification_runtime_flags flag_row
    set enabled = true,
        revision = flag_row.revision + 1,
        updated_by = null,
        updated_at = pg_catalog.clock_timestamp()
    where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
      and not flag_row.enabled;
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'rolledBack', true,
    'mode', case when p_scope_key = 'all' then 'all_owner' else 'partial' end,
    'scopeKey', p_scope_key,
    'flagKeys', pg_catalog.to_jsonb(v_supplied),
    'shadowEnabled', p_reenable_shadow,
    'workerStopLatch', v_global_fault,
    'workerStopLatchRevision', v_latch_revision::text,
    'orchestrationJobsStopped', v_job_count,
    'cancellation', v_cancellation,
    'flagRevisions', dashboard_private.current_notification_flag_revisions_v1()
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_cutover', p_scope_key, 'cutover_rolled_back',
    null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'flag_keys', pg_catalog.to_jsonb(v_supplied),
      'shadow_enabled', p_reenable_shadow,
      'global_fault', v_global_fault,
      'canceled_count', (v_cancellation ->> 'canceledCount')::integer,
      'cancel_requested_count', (v_cancellation ->> 'cancelRequestedCount')::integer,
      'orchestration_jobs_stopped', v_job_count
    ),
    p_reason_code
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_cutover_rollback', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.rollback_notification_dispatch_cutover_v1(
  p_scope_key text,
  p_flag_keys text[],
  p_expected_flag_revisions jsonb,
  p_reenable_shadow boolean,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.rollback_notification_dispatch_cutover_v1_impl(
    p_scope_key, p_flag_keys, p_expected_flag_revisions, p_reenable_shadow,
    p_request_id, p_reason_code
  );
end;
$$;

create or replace function dashboard_private.clear_notification_worker_stop_latch_v1_impl(
  p_expected_latch_revision bigint,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_replay jsonb;
  v_latch dashboard_private.notification_worker_stop_latch%rowtype;
  v_response jsonb;
begin
  if p_expected_latch_revision is null or p_expected_latch_revision < 1
    or p_request_id is null
    or p_reason_code !~ '^[a-z0-9_]{3,64}$'
  then
    raise exception 'notification_latch_clear_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'expected_latch_revision', p_expected_latch_revision::text,
    'reason_code', p_reason_code
  )::text);
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_latch_clear', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;

  select latch.* into strict v_latch
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global'
  for update of latch;
  if v_latch.revision <> p_expected_latch_revision then
    raise exception 'notification_revision_conflict' using errcode = '40001';
  end if;
  if not v_latch.stopped
    or not dashboard_private.notification_recovery_health_fresh_v1()
    or not dashboard_private.notification_schedule_contract_ready_v1()
    or not dashboard_private.notification_recovery_metrics_clean_v1()
  then
    raise exception 'notification_latch_clear_readiness_failed' using errcode = '55000';
  end if;
  update dashboard_private.notification_worker_stop_latch latch
  set stopped = false,
      revision = latch.revision + 1,
      reason_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where latch.latch_key = 'global'
  returning latch.* into v_latch;
  v_response := pg_catalog.jsonb_build_object(
    'cleared', true,
    'workerStopLatch', false,
    'workerStopLatchRevision', v_latch.revision::text
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_worker_stop_latch', 'global', 'worker_stop_latch_cleared',
    null, 'system', p_request_id,
    pg_catalog.jsonb_build_object('revision', v_latch.revision::text),
    p_reason_code
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_latch_clear', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.clear_notification_worker_stop_latch_v1(
  p_expected_latch_revision bigint,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.clear_notification_worker_stop_latch_v1_impl(
    p_expected_latch_revision, p_request_id, p_reason_code
  );
end;
$$;

create or replace function public.configure_notification_worker_schedule_v1(
  p_approved_host text,
  p_expected_revision bigint,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config dashboard_private.notification_schedule_configuration%rowtype;
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_approved_host is null
    or p_approved_host !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    or p_expected_revision is null or p_expected_revision < 1
    or p_request_id is null
  then
    raise exception 'notification_schedule_configuration_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'approved_host', p_approved_host,
    'expected_revision', p_expected_revision::text
  )::text);
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_schedule_configure', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;
  select config.* into strict v_config
  from dashboard_private.notification_schedule_configuration config
  where config.config_key = 'global'
  for update of config;
  if v_config.revision <> p_expected_revision then
    raise exception 'notification_revision_conflict' using errcode = '40001';
  end if;
  update dashboard_private.notification_schedule_configuration config
  set approved_worker_host = p_approved_host,
      revision = config.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where config.config_key = 'global'
  returning config.* into v_config;
  v_response := pg_catalog.jsonb_build_object(
    'configured', true,
    'approvedHost', v_config.approved_worker_host,
    'revision', v_config.revision::text
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_schedule_configuration', 'global', 'worker_host_configured',
    null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'approved_host', v_config.approved_worker_host,
      'revision', v_config.revision::text
    ),
    'authorized_schedule_configuration'
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_schedule_configure', v_fingerprint, v_response
  );
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
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('inspect', 'install', 'disable', 'remove')
    or p_request_id is null
  then
    raise exception 'notification_schedule_management_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'action', p_action
  )::text);
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_schedule_manage', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;

  v_response := case
    when p_action = 'inspect'
      then dashboard_private.inspect_notification_schedules_v1()
    else dashboard_private.manage_notification_schedules_v1(p_action)
  end;
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    after_summary, reason_code
  ) values (
    'notification_schedule', 'global', 'notification_schedule_' || p_action,
    null, 'system', p_request_id,
    v_response,
    'authorized_schedule_management'
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_schedule_manage', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.notification_local_fault_scope_v1()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with latest_watchdog as (
    select coalesce(
      pg_catalog.max(heartbeat.created_at) - interval '5 minutes',
      pg_catalog.clock_timestamp() - interval '5 minutes'
    ) as window_start
    from dashboard_private.notification_watchdog_heartbeats heartbeat
    where heartbeat.phase = 'succeeded'
  ), delivery_candidates as (
    select
      dashboard_private.notification_dispatch_scope_for_event_v1(
        event_row.workflow_key, event_row.event_key
      ) as scope_key,
      case
        when delivery.status = 'delivery_unknown' then 1
        when delivery.status_reason = 'workflow_scope_mismatch' then 2
        when delivery.status = 'skipped' and delivery.status_reason = 'no_recipient' then 3
        when delivery.status in ('pending', 'retry_wait')
          and coalesce(delivery.next_attempt_at, delivery.scheduled_for)
            < pg_catalog.clock_timestamp() - interval '5 minutes' then 4
        when delivery.status in ('pending', 'claimed', 'sending')
          and (ownership.id is null or ownership.owner_kind <> 'canonical') then 5
        else 6
      end as priority,
      delivery.updated_at
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
    left join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.workflow_key = event_row.workflow_key
     and ownership.occurrence_key = event_row.occurrence_key
     and ownership.rule_id = delivery.rule_id
     and ownership.channel_key = delivery.channel_key
     and ownership.target_key = delivery.target_key
     and ownership.target_generation = delivery.target_generation
    cross join latest_watchdog
    where dashboard_private.notification_event_scope_active_v1(
      event_row.workflow_key, event_row.event_key
    ) and (
      (
      delivery.updated_at >= latest_watchdog.window_start
      and (
        delivery.status = 'delivery_unknown'
        or delivery.status_reason = 'workflow_scope_mismatch'
        or (delivery.status = 'skipped' and delivery.status_reason = 'no_recipient')
        or (
          delivery.status in ('pending', 'claimed', 'sending')
          and (ownership.id is null or ownership.owner_kind <> 'canonical')
        )
      )
      ) or (
      delivery.status in ('pending', 'retry_wait')
      and coalesce(delivery.next_attempt_at, delivery.scheduled_for)
        < pg_catalog.clock_timestamp() - interval '5 minutes'
      )
    )
  ), shadow_candidates as (
    select
      dashboard_private.notification_dispatch_scope_for_event_v1(
        audit.after_summary ->> 'workflow_key',
        audit.after_summary ->> 'event_key'
      ) as scope_key,
      6 as priority,
      audit.created_at as updated_at
    from dashboard_private.notification_audit_logs audit
    cross join latest_watchdog
    where audit.action = 'shadow_compare_result'
      and audit.reason_code <> 'matched'
      and audit.created_at >= latest_watchdog.window_start
      and dashboard_private.notification_event_scope_active_v1(
        audit.after_summary ->> 'workflow_key',
        audit.after_summary ->> 'event_key'
      )
  ), ownership_candidates as (
    select
      dashboard_private.notification_dispatch_scope_for_event_v1(
        event_row.workflow_key, event_row.event_key
      ) as scope_key,
      5 as priority,
      audit.created_at as updated_at
    from dashboard_private.notification_audit_logs audit
    join dashboard_private.notification_deliveries delivery
      on audit.entity_kind = 'notification_delivery'
     and delivery.id::text = audit.entity_id
    join dashboard_private.notification_events event_row
      on event_row.id = delivery.event_id
    cross join latest_watchdog
    where audit.action = 'ownership_not_acquired'
      and audit.created_at >= latest_watchdog.window_start
      and dashboard_private.notification_event_scope_active_v1(
        event_row.workflow_key, event_row.event_key
      )
    union all
    select
      dashboard_private.notification_dispatch_scope_for_event_v1(
        rule_row.workflow_key, rule_row.event_key
      ) as scope_key,
      5 as priority,
      audit.created_at as updated_at
    from dashboard_private.notification_audit_logs audit
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on audit.entity_kind = 'notification_dispatch_ownership'
     and ownership.id::text = audit.entity_id
    join dashboard_private.notification_rules rule_row
      on rule_row.id = ownership.rule_id
     and rule_row.workflow_key = ownership.workflow_key
    cross join latest_watchdog
    where audit.action = 'ownership_not_acquired'
      and audit.created_at >= latest_watchdog.window_start
      and dashboard_private.notification_event_scope_active_v1(
        rule_row.workflow_key, rule_row.event_key
      )
  ), candidates as (
    select * from delivery_candidates
    union all
    select * from shadow_candidates
    union all
    select * from ownership_candidates
  )
  select candidate.scope_key
  from candidates candidate
  where candidate.scope_key is not null
  order by candidate.priority, candidate.updated_at, candidate.scope_key
  limit 1;
$$;

create or replace function dashboard_private.run_notification_cutover_watchdog_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_metrics jsonb;
  v_stop jsonb;
  v_expected jsonb;
  v_shadow boolean := false;
  v_enabled_flags text[] := array[]::text[];
  v_fault_count integer := 0;
  v_rollback_count integer := 0;
  v_scope text;
  v_flag text;
  v_reason text;
  v_request_id uuid;
  v_attempt integer;
  v_result jsonb;
begin
  insert into dashboard_private.notification_watchdog_heartbeats(
    run_id, phase, faults_detected, rollbacks_applied, error_code
  ) values (v_run_id, 'started', 0, 0, null);

  begin
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('notification-cutover-watchdog-v1', 0)
    ) then
      insert into dashboard_private.notification_watchdog_heartbeats(
        run_id, phase, faults_detected, rollbacks_applied, error_code
      ) values (v_run_id, 'skipped', 0, 0, null);
      return pg_catalog.jsonb_build_object('ok', true, 'status', 'lease_not_acquired');
    end if;

    select flag_row.enabled into strict v_shadow
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled';
    select coalesce(pg_catalog.array_agg(flag_row.flag_key order by flag_row.flag_key), array[]::text[])
    into v_enabled_flags
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = any(dashboard_private.notification_dispatch_flag_keys_v1())
      and flag_row.enabled;
    if not v_shadow and pg_catalog.cardinality(v_enabled_flags) = 0 then
      insert into dashboard_private.notification_watchdog_heartbeats(
        run_id, phase, faults_detected, rollbacks_applied, error_code
      ) values (v_run_id, 'succeeded', 0, 0, null);
      return pg_catalog.jsonb_build_object('ok', true, 'status', 'inactive');
    end if;

    v_metrics := dashboard_private.notification_operations_metrics_v1();
    v_stop := v_metrics -> 'stop_metrics';
    v_fault_count :=
      case when (v_stop ->> 'canonical_provider_requests_in_shadow')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'canonical_inbox_projections_in_shadow')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'duplicate_external_attempts')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'new_delivery_unknown')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'missed_worker_heartbeats')::integer >= 3 then 1 else 0 end
      + case when (v_stop ->> 'pending_lag_seconds')::bigint > 300 then 1 else 0 end
      + case when (v_stop ->> 'scope_mismatch_count')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'zero_audience_enabled_rule_count')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'ownership_anomaly_count')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'ownership_denial_count')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'shadow_mismatch_count')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'rollback_failed_count')::bigint > 0 then 1 else 0 end
      + case when (v_stop ->> 'schedule_contract_fault_count')::integer > 0 then 1 else 0 end
      + case when (v_stop ->> 'worker_route_fault_count')::bigint > 0 then 1 else 0 end;
    if v_fault_count = 0 then
      insert into dashboard_private.notification_watchdog_heartbeats(
        run_id, phase, faults_detected, rollbacks_applied, error_code
      ) values (v_run_id, 'succeeded', 0, 0, null);
      return pg_catalog.jsonb_build_object('ok', true, 'status', 'healthy');
    end if;

    if v_shadow and pg_catalog.cardinality(v_enabled_flags) = 0 then
      v_reason := case
        when (v_stop ->> 'canonical_provider_requests_in_shadow')::bigint > 0
          or (v_stop ->> 'canonical_inbox_projections_in_shadow')::bigint > 0
          then 'shadow_side_effect_detected'
        when (v_stop ->> 'schedule_contract_fault_count')::integer > 0 then 'schedule_contract_fault'
        when (v_stop ->> 'worker_route_fault_count')::bigint > 0 then 'worker_route_fault'
        else 'shadow_global_fault'
      end;
      for v_attempt in 1..2 loop
        v_expected := dashboard_private.current_notification_flag_revisions_v1();
        v_request_id := gen_random_uuid();
        begin
          v_result := dashboard_private.abort_notification_shadow_v1_impl(
            v_expected, v_request_id, v_reason
          );
          exit;
        exception
          when serialization_failure then
            if v_attempt = 2 then raise; end if;
        end;
      end loop;
      v_rollback_count := 1;
    elsif (v_stop ->> 'duplicate_external_attempts')::bigint > 0
      or (v_stop ->> 'missed_worker_heartbeats')::integer >= 3
      or (v_stop ->> 'rollback_failed_count')::bigint > 0
      or (v_stop ->> 'schedule_contract_fault_count')::integer > 0
      or (v_stop ->> 'worker_route_fault_count')::bigint > 0
    then
      v_reason := case
        when (v_stop ->> 'duplicate_external_attempts')::bigint > 0 then 'duplicate_external_attempt'
        when (v_stop ->> 'missed_worker_heartbeats')::integer >= 3 then 'worker_heartbeat_missed'
        when (v_stop ->> 'rollback_failed_count')::bigint > 0 then 'global_execution_fault'
        when (v_stop ->> 'schedule_contract_fault_count')::integer > 0 then 'schedule_contract_fault'
        else 'worker_route_fault'
      end;
      for v_attempt in 1..2 loop
        v_expected := dashboard_private.current_notification_flag_revisions_v1();
        v_request_id := gen_random_uuid();
        begin
          v_result := dashboard_private.rollback_notification_dispatch_cutover_v1_impl(
            'all', v_enabled_flags, v_expected, false, v_request_id, v_reason
          );
          exit;
        exception
          when serialization_failure then
            if v_attempt = 2 then raise; end if;
        end;
      end loop;
      v_rollback_count := 1;
    else
      v_scope := dashboard_private.notification_local_fault_scope_v1();
      if v_scope is null then
        raise exception 'notification_watchdog_fault_scope_unknown' using errcode = '55000';
      end if;
      select owner_row.dispatch_flag_key into v_flag
      from dashboard_private.notification_cutover_owners owner_row
      where owner_row.scope_key = v_scope
        and owner_row.owner_kind = 'canonical';
      if not found then
        raise exception 'notification_watchdog_fault_scope_inactive' using errcode = '55000';
      end if;
      v_reason := case
        when (v_stop ->> 'new_delivery_unknown')::bigint > 0 then 'delivery_unknown_detected'
        when (v_stop ->> 'pending_lag_seconds')::bigint > 300 then 'queue_lag'
        when (v_stop ->> 'scope_mismatch_count')::bigint > 0 then 'workflow_scope_mismatch'
        when (v_stop ->> 'zero_audience_enabled_rule_count')::bigint > 0 then 'enabled_rule_without_audience'
        when (v_stop ->> 'ownership_anomaly_count')::bigint > 0 then 'ownership_anomaly'
        when (v_stop ->> 'ownership_denial_count')::bigint > 0 then 'ownership_denial_anomaly'
        else 'shadow_intent_mismatch'
      end;
      for v_attempt in 1..2 loop
        v_expected := dashboard_private.current_notification_flag_revisions_v1();
        v_request_id := gen_random_uuid();
        begin
          v_result := dashboard_private.rollback_notification_dispatch_cutover_v1_impl(
            v_scope,
            array[v_flag],
            v_expected, false, v_request_id, v_reason
          );
          exit;
        exception
          when serialization_failure then
            if v_attempt = 2 then raise; end if;
        end;
      end loop;
      v_rollback_count := 1;
    end if;

    insert into dashboard_private.notification_watchdog_heartbeats(
      run_id, phase, faults_detected, rollbacks_applied, error_code
    ) values (v_run_id, 'succeeded', v_fault_count, v_rollback_count, null);
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'status', 'rollback_applied',
      'faultsDetected', v_fault_count,
      'rollbacksApplied', v_rollback_count
    );
  exception
    when others then
      insert into dashboard_private.notification_audit_logs(
        entity_kind, entity_id, action, actor_profile_id, actor_kind,
        after_summary, reason_code
      ) values (
        'notification_cutover_watchdog', v_run_id::text, 'rollback_failed',
        null, 'system',
        pg_catalog.jsonb_build_object(
          'faults_detected', v_fault_count,
          'rollbacks_applied', 0
        ),
        'watchdog_atomic_rollback_failed'
      );
      insert into dashboard_private.notification_watchdog_heartbeats(
        run_id, phase, faults_detected, rollbacks_applied, error_code
      ) values (
        v_run_id, 'failed', v_fault_count, 0, 'watchdog_atomic_rollback_failed'
      );
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'status', 'rollback_failed',
        'faultsDetected', v_fault_count
      );
  end;
end;
$$;

alter function public.activate_notification_dispatch_cutover_v1(text, text, jsonb, uuid)
  owner to postgres;
alter function public.abort_notification_shadow_v1(jsonb, uuid, text)
  owner to postgres;
alter function public.clear_notification_worker_stop_latch_v1(bigint, uuid, text)
  owner to postgres;
alter function public.rollback_notification_dispatch_cutover_v1(
  text, text[], jsonb, boolean, uuid, text
) owner to postgres;
alter function public.revalidate_immediate_notification_delivery_v1(
  text, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamp with time zone, jsonb
) owner to postgres;
alter function public.get_notification_operations_metrics_v1() owner to postgres;
alter function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, uuid
) owner to postgres;
alter function public.record_notification_shadow_fixture_evidence_v1(
  text, uuid
) owner to postgres;
alter function dashboard_private.notification_sha256_hex_v1(text)
  owner to postgres;
alter function dashboard_private.notification_cutover_scope_order_v1()
  owner to postgres;
alter function dashboard_private.notification_current_contract_build_revision_hash_v1(
  timestamp with time zone
)
  owner to postgres;
alter function public.assert_notification_worker_run_allowed_v1(text) owner to postgres;
alter function public.configure_notification_worker_schedule_v1(text, bigint, uuid)
  owner to postgres;
alter function public.manage_notification_worker_schedule_v1(text, uuid)
  owner to postgres;
alter function dashboard_private.invoke_notification_worker_v1() owner to postgres;
alter function dashboard_private.run_notification_cutover_watchdog_v1() owner to postgres;
alter function dashboard_private.manage_notification_schedules_v1(text) owner to postgres;
alter function dashboard_private.inspect_notification_schedules_v1() owner to postgres;
alter function dashboard_private.lock_notification_event_cutover_snapshot_v1()
  owner to postgres;
alter function dashboard_private.lock_notification_orchestration_retry_v1()
  owner to postgres;
alter function dashboard_private.snapshot_notification_dispatch_audit_v1()
  owner to postgres;
alter function dashboard_private.audit_notification_inbox_projection_v1()
  owner to postgres;
alter function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  timestamp with time zone
) owner to postgres;
alter function dashboard_private.notification_shadow_scope_config_digest_v1(text)
  owner to postgres;
alter function dashboard_private.notification_shadow_comparison_current_v1(
  text, text, timestamp with time zone
) owner to postgres;

revoke all on function dashboard_private.notification_runtime_flag_keys_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_dispatch_flag_keys_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_cutover_scope_order_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_current_contract_build_revision_hash_v1(
  timestamp with time zone
)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_active_cutover_scope_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_success_heartbeats_fresh_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_recovery_health_fresh_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_recent_runtime_heartbeats_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.lock_notification_flag_revisions_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.current_notification_flag_revisions_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_cutover_request_replay_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.finish_notification_cutover_request_v1(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.validate_notification_worker_vault_values_v1(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.read_notification_worker_vault_contract_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.invoke_notification_worker_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.inspect_notification_schedules_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.manage_notification_schedules_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_schedule_contract_ready_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_dispatch_scope_for_event_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_event_scope_active_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.lock_notification_event_cutover_snapshot_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.lock_notification_orchestration_retry_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.snapshot_notification_dispatch_audit_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.audit_notification_inbox_projection_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_scope_config_digest_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_comparison_current_v1(
  text, text, timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.route_notification_ownership_insert_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.enforce_notification_dispatch_runtime_gate_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.enforce_notification_flag_activation_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_operations_metrics_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_stop_metrics_clean_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_recovery_metrics_clean_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_sha256_hex_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_event_matches_dispatch_flag_v1(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_notification_cutover_deliveries_v1(text[], text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.raise_notification_worker_stop_latch_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.activate_notification_dispatch_cutover_v1_impl(text, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.abort_notification_shadow_v1_impl(jsonb, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.rollback_notification_dispatch_cutover_v1_impl(text, text[], jsonb, boolean, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.clear_notification_worker_stop_latch_v1_impl(bigint, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_local_fault_scope_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.run_notification_cutover_watchdog_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.activate_notification_dispatch_cutover_v1(
  text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.abort_notification_shadow_v1(jsonb, uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_notification_worker_stop_latch_v1(bigint, uuid, text)
  from public, anon, authenticated;
revoke all on function public.rollback_notification_dispatch_cutover_v1(
  text, text[], jsonb, boolean, uuid, text
) from public, anon, authenticated;
revoke all on function public.revalidate_immediate_notification_delivery_v1(
  text, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamp with time zone, jsonb
) from public, anon, authenticated;
revoke all on function public.get_notification_operations_metrics_v1()
  from public, anon, authenticated;
revoke all on function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, uuid
) from public, anon, authenticated;
revoke all on function public.record_notification_shadow_fixture_evidence_v1(
  text, uuid
) from public, anon, authenticated;
revoke all on function public.assert_notification_worker_run_allowed_v1(text)
  from public, anon, authenticated;
revoke all on function public.configure_notification_worker_schedule_v1(text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.manage_notification_worker_schedule_v1(text, uuid)
  from public, anon, authenticated;
revoke all on function dashboard_private.invoke_notification_worker_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.run_notification_cutover_watchdog_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.manage_notification_schedules_v1(text)
  from public, anon, authenticated;
revoke all on function dashboard_private.inspect_notification_schedules_v1()
  from public, anon, authenticated;

grant execute on function public.activate_notification_dispatch_cutover_v1(
  text, text, jsonb, uuid
) to service_role;
grant execute on function public.abort_notification_shadow_v1(jsonb, uuid, text)
  to service_role;
grant execute on function public.clear_notification_worker_stop_latch_v1(bigint, uuid, text)
  to service_role;
grant execute on function public.rollback_notification_dispatch_cutover_v1(
  text, text[], jsonb, boolean, uuid, text
) to service_role;
grant execute on function public.revalidate_immediate_notification_delivery_v1(
  text, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamp with time zone, jsonb
) to service_role;
grant execute on function public.get_notification_operations_metrics_v1()
  to service_role;
grant execute on function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, uuid
) to service_role;
grant execute on function public.record_notification_shadow_fixture_evidence_v1(
  text, uuid
) to service_role;
grant execute on function public.assert_notification_worker_run_allowed_v1(text)
  to service_role;
grant execute on function public.configure_notification_worker_schedule_v1(text, bigint, uuid)
  to service_role;
grant execute on function public.manage_notification_worker_schedule_v1(text, uuid)
  to service_role;

-- Audit evidence is append-only through fixed SECURITY DEFINER functions.
-- The broad expand-phase grant is narrowed before any shadow evidence can be
-- accepted; service code may read but cannot forge, rewrite, or delete proof.
revoke insert, update, delete, truncate
  on table dashboard_private.notification_audit_logs from service_role;
grant select on table dashboard_private.notification_audit_logs to service_role;

do $$
begin
  if (select pg_catalog.count(*) from dashboard_private.notification_runtime_flags) <> 12
    or exists (
      select 1 from dashboard_private.notification_runtime_flags flag_row
      where flag_row.enabled
    )
    or exists (
      select 1 from dashboard_private.notification_runtime_flags flag_row
      where not flag_row.flag_key = any(
        dashboard_private.notification_runtime_flag_keys_v1()
      )
    )
    or exists (
      select 1
      from pg_catalog.unnest(
        dashboard_private.notification_runtime_flag_keys_v1()
      ) expected(flag_key)
      where not exists (
        select 1
        from dashboard_private.notification_runtime_flags flag_row
        where flag_row.flag_key = expected.flag_key
      )
    )
    or (select pg_catalog.count(*) from dashboard_private.notification_cutover_owners) <> 10
    or exists (
      select 1 from dashboard_private.notification_cutover_owners owner_row
      where owner_row.owner_kind <> 'legacy'
    )
    or pg_catalog.to_regprocedure(
      'public.notification_workflow_legacy_closure_version()'
    ) is null
  then
    raise exception 'notification_adapter_runtime_marker_not_ready' using errcode = '55000';
  end if;
end;
$$;

-- 이 capability marker는 adapter 패키지에서 마지막으로 생성하는 객체다.
-- 스케줄 설치는 별도 승인 작업으로 남긴다.
create or replace function public.notification_workflow_adapters_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 1; $$;

alter function public.notification_workflow_adapters_runtime_version() owner to postgres;
revoke all on function public.notification_workflow_adapters_runtime_version()
  from public, anon;
grant execute on function public.notification_workflow_adapters_runtime_version()
  to authenticated, service_role;

commit;
