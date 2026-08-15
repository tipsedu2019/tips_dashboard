begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table dashboard_private.notification_worker_wakeup_state (
  wakeup_key text primary key check (wakeup_key = 'global'),
  requested_generation bigint not null default 0 check (requested_generation >= 0),
  active_generation bigint check (active_generation is null or active_generation > 0),
  completed_generation bigint not null default 0 check (completed_generation >= 0),
  lease_expires_at timestamp with time zone,
  last_requested_at timestamp with time zone,
  last_dispatched_at timestamp with time zone,
  last_completed_at timestamp with time zone,
  last_request_id bigint,
  last_error_code text
);

insert into dashboard_private.notification_worker_wakeup_state(wakeup_key)
values ('global');

alter table dashboard_private.notification_worker_wakeup_state enable row level security;
revoke all on table dashboard_private.notification_worker_wakeup_state
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.request_notification_worker_wakeup_v1(
  p_reason text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wakeup dashboard_private.notification_worker_wakeup_state%rowtype;
  v_url text;
  v_secret text;
  v_url_count integer;
  v_secret_count integer;
  v_generation bigint;
  v_request_id bigint;
begin
  if nullif(pg_catalog.btrim(p_reason), '') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'notification_worker_wakeup_reason_invalid');
  end if;

  select state_row.* into strict wakeup
  from dashboard_private.notification_worker_wakeup_state state_row
  where state_row.wakeup_key = 'global'
  for update of state_row;

  update dashboard_private.notification_worker_wakeup_state state_row
  set requested_generation = wakeup.requested_generation + 1,
      last_requested_at = pg_catalog.clock_timestamp(),
      last_error_code = null
  where state_row.wakeup_key = 'global'
  returning state_row.requested_generation into v_generation;

  if wakeup.active_generation is not null
    and wakeup.lease_expires_at > pg_catalog.clock_timestamp()
  then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'dispatched', false,
      'wakeupGeneration', v_generation
    );
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

  if v_url_count <> 1 or v_secret_count <> 1
    or coalesce((dashboard_private.validate_notification_worker_vault_values_v1(v_url, v_secret) ->> 'ok')::boolean, false) is not true
  then
    raise exception 'notification_worker_vault_contract_invalid' using errcode = '55000';
  end if;

  select net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json',
      'X-Notification-Contract-Version', '2'
    ),
    body := pg_catalog.jsonb_build_object(
      'batch_size', 50,
      'lease_seconds', 60,
      'wakeup_generation', v_generation
    ),
    timeout_milliseconds := 25000
  ) into v_request_id;

  update dashboard_private.notification_worker_wakeup_state state_row
  set active_generation = v_generation,
      lease_expires_at = pg_catalog.clock_timestamp() + interval '90 seconds',
      last_dispatched_at = pg_catalog.clock_timestamp(),
      last_request_id = v_request_id,
      last_error_code = null
  where state_row.wakeup_key = 'global';

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'dispatched', true,
    'wakeupGeneration', v_generation
  );
exception
  when others then
    update dashboard_private.notification_worker_wakeup_state state_row
    set active_generation = null,
        lease_expires_at = null,
        last_error_code = 'notification_worker_wakeup_failed'
    where state_row.wakeup_key = 'global';
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'notification_worker_wakeup_failed');
end;
$$;

create or replace function dashboard_private.request_notification_worker_after_fanout_insert_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted_jobs) then
    perform dashboard_private.request_notification_worker_wakeup_v1('fanout_insert');
  end if;
  return null;
end;
$$;

drop trigger if exists notification_event_fanout_jobs_wakeup_trigger
  on dashboard_private.notification_event_fanout_jobs;
create trigger notification_event_fanout_jobs_wakeup_trigger
after insert on dashboard_private.notification_event_fanout_jobs
referencing new table as inserted_jobs
for each statement
execute function dashboard_private.request_notification_worker_after_fanout_insert_v1();

create or replace function public.complete_notification_worker_generation_v1(
  p_generation bigint,
  p_succeeded boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  wakeup dashboard_private.notification_worker_wakeup_state%rowtype;
  v_has_backlog boolean;
  v_follow_up jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_generation is null or p_generation <= 0
    or p_succeeded is null
  then
    raise exception 'notification_worker_generation_invalid' using errcode = '22023';
  end if;

  select state_row.* into strict wakeup
  from dashboard_private.notification_worker_wakeup_state state_row
  where state_row.wakeup_key = 'global'
  for update of state_row;

  if wakeup.active_generation is distinct from p_generation then
    return pg_catalog.jsonb_build_object('ok', true, 'status', 'stale_generation');
  end if;

  select exists (
    select 1 from dashboard_private.notification_event_fanout_jobs job
    where job.status = 'pending' and job.next_attempt_at <= pg_catalog.clock_timestamp()
  ) into v_has_backlog;

  update dashboard_private.notification_worker_wakeup_state state_row
  set completed_generation = pg_catalog.greatest(state_row.completed_generation, p_generation),
      active_generation = null,
      lease_expires_at = null,
      last_completed_at = pg_catalog.clock_timestamp(),
      last_error_code = case when p_succeeded then null else 'notification_worker_execution_failed' end
  where state_row.wakeup_key = 'global';

  if p_succeeded and (wakeup.requested_generation > p_generation or v_has_backlog) then
    v_follow_up := dashboard_private.request_notification_worker_wakeup_v1('generation_completion');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', case when v_follow_up is null then 'completed' else 'follow_up_requested' end,
    'followUp', v_follow_up
  );
end;
$$;

do $$
declare
  v_job record;
begin
  for v_job in
    select job.jobid, job.jobname
    from cron.job job
    where job.jobname in ('tips-notification-worker-v1', 'tips-notification-cutover-watchdog-v1')
    order by job.jobid
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
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
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('inspect', 'install', 'disable', 'remove')
    or p_request_id is null
  then
    raise exception 'notification_schedule_management_invalid' using errcode = '22023';
  end if;
  if p_action = 'install' then
    raise exception 'notification_periodic_worker_retired' using errcode = '55000';
  end if;
  v_response := pg_catalog.jsonb_build_object(
    'workerCount', 0,
    'watchdogCount', 0,
    'workerActiveCount', 0,
    'watchdogActiveCount', 0,
    'mode', 'event_driven'
  );
  insert into dashboard_private.notification_worker_schedule_requests(request_id, action, response_payload)
  values (p_request_id, p_action, v_response)
  on conflict (request_id) do nothing;
  return v_response;
end;
$$;

alter function dashboard_private.request_notification_worker_wakeup_v1(text) owner to postgres;
alter function dashboard_private.request_notification_worker_after_fanout_insert_v1() owner to postgres;
alter function public.complete_notification_worker_generation_v1(bigint,boolean) owner to postgres;
alter function public.manage_notification_worker_schedule_v1(text,uuid) owner to postgres;

revoke all on function dashboard_private.request_notification_worker_wakeup_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.request_notification_worker_after_fanout_insert_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.complete_notification_worker_generation_v1(bigint,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.manage_notification_worker_schedule_v1(text,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_notification_worker_generation_v1(bigint,boolean)
  to service_role;
grant execute on function public.manage_notification_worker_schedule_v1(text,uuid)
  to service_role;

commit;
