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
  set completed_generation = greatest(state_row.completed_generation, p_generation),
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

create table dashboard_private.notification_manual_retry_requests (
  request_id uuid primary key,
  event_id uuid not null references dashboard_private.notification_events(id),
  actor_profile_id uuid not null references public.profiles(id),
  confirmed_absent boolean not null,
  response_payload jsonb not null,
  created_at timestamp with time zone not null default pg_catalog.clock_timestamp()
);
alter table dashboard_private.notification_manual_retry_requests enable row level security;
revoke all on table dashboard_private.notification_manual_retry_requests
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.assert_notification_event_actor_v1(p_event_id uuid)
returns dashboard_private.notification_events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  if v_actor is null then raise exception 'notification_access_denied' using errcode = '42501'; end if;
  select event_row.* into v_event from dashboard_private.notification_events event_row where event_row.id = p_event_id;
  if not found then raise exception 'notification_event_not_found' using errcode = 'P0002'; end if;
  select profile.role into v_role from public.profiles profile where profile.id = v_actor;
  if v_role not in ('admin', 'staff')
    and v_event.actor_profile_id is distinct from v_actor
    and not exists (
      select 1 from dashboard_private.notification_deliveries delivery
      where delivery.event_id = p_event_id and delivery.target_profile_id = v_actor
    )
  then raise exception 'notification_access_denied' using errcode = '42501'; end if;
  return v_event;
end;
$$;

create or replace function public.get_google_chat_notification_event_status_v1(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_total integer;
  v_sent integer;
  v_updated_at timestamptz;
  v_reason text;
  v_fanout_status text;
  v_fanout_updated_at timestamptz;
  v_fanout_lease_expires_at timestamptz;
  v_fanout_error text;
  v_has_delayed_delivery boolean;
begin
  perform dashboard_private.assert_notification_event_actor_v1(p_event_id);
  select
    case
      when pg_catalog.count(*) filter (where delivery.status = 'delivery_unknown') > 0 then 'unknown'
      when pg_catalog.count(*) filter (where delivery.status in ('pending', 'claimed', 'sending', 'retry_wait')) > 0 then 'processing'
      when pg_catalog.count(*) filter (where delivery.status = 'failed') > 0 then 'failed'
      when pg_catalog.count(*) filter (where delivery.status = 'sent') > 0 then 'sent'
      else 'not_applicable'
    end,
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where delivery.status = 'sent')::integer,
    pg_catalog.max(delivery.updated_at),
    pg_catalog.min(coalesce(delivery.status_reason, delivery.last_error_code))
  into v_status, v_total, v_sent, v_updated_at, v_reason
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id = p_event_id and delivery.channel_key = 'google_chat';

  select job.status, job.updated_at, job.lease_expires_at, job.last_error_code
  into v_fanout_status, v_fanout_updated_at, v_fanout_lease_expires_at, v_fanout_error
  from dashboard_private.notification_event_fanout_jobs job
  where job.event_id = p_event_id;

  select exists (
    select 1
    from dashboard_private.notification_deliveries delivery
    where delivery.event_id = p_event_id
      and delivery.channel_key = 'google_chat'
      and (
        (delivery.status in ('pending', 'retry_wait')
          and coalesce(delivery.next_attempt_at, delivery.updated_at) <= pg_catalog.clock_timestamp()
          and delivery.updated_at <= pg_catalog.clock_timestamp() - interval '5 seconds')
        or (delivery.status in ('claimed', 'sending')
          and delivery.lease_expires_at <= pg_catalog.clock_timestamp())
      )
  ) into v_has_delayed_delivery;

  if v_status <> 'unknown' then
    if v_has_delayed_delivery
      or (v_fanout_status = 'pending'
        and v_fanout_updated_at <= pg_catalog.clock_timestamp() - interval '5 seconds')
      or (v_fanout_status = 'claimed'
        and v_fanout_lease_expires_at <= pg_catalog.clock_timestamp())
    then
      v_status := 'delayed';
      v_reason := coalesce(v_reason, 'notification_worker_wakeup_delayed');
    elsif v_status = 'not_applicable' and v_fanout_status in ('pending', 'claimed') then
      v_status := 'processing';
    elsif v_status = 'not_applicable' and v_fanout_status = 'failed' then
      v_status := 'failed';
      v_reason := coalesce(v_fanout_error, 'notification_fanout_failed');
    end if;
  end if;

  v_updated_at := greatest(v_updated_at, v_fanout_updated_at);
  return pg_catalog.jsonb_build_object(
    'event_id', p_event_id, 'status', v_status, 'updated_at', v_updated_at,
    'reason_code', v_reason, 'retry_allowed', v_status in ('delayed', 'failed', 'unknown'),
    'confirmation_required', v_status = 'unknown', 'sent_count', v_sent, 'total_count', v_total
  );
end;
$$;

create or replace function public.retry_google_chat_notification_event_v1(
  p_event_id uuid,
  p_request_id uuid,
  p_confirmed_absent boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing dashboard_private.notification_manual_retry_requests%rowtype;
  v_fanout dashboard_private.notification_event_fanout_jobs%rowtype;
  v_status jsonb;
  v_wakeup jsonb;
begin
  perform dashboard_private.assert_notification_event_actor_v1(p_event_id);
  if p_request_id is null or p_confirmed_absent is null then
    raise exception 'notification_retry_invalid' using errcode = '22023';
  end if;
  select request_row.* into v_existing
  from dashboard_private.notification_manual_retry_requests request_row
  where request_row.request_id = p_request_id for update;
  if found then
    if v_existing.event_id <> p_event_id or v_existing.actor_profile_id <> auth.uid()
      or v_existing.confirmed_absent <> p_confirmed_absent
    then raise exception 'notification_retry_request_id_reused' using errcode = '22023'; end if;
    return v_existing.response_payload;
  end if;
  select job.* into v_fanout
  from dashboard_private.notification_event_fanout_jobs job
  where job.event_id = p_event_id
  for update of job;
  perform 1 from dashboard_private.notification_deliveries delivery
  where delivery.event_id = p_event_id and delivery.channel_key = 'google_chat'
  order by delivery.id for update;
  if exists (
    select 1 from dashboard_private.notification_deliveries delivery
    where delivery.event_id = p_event_id and delivery.channel_key = 'google_chat'
      and delivery.status = 'delivery_unknown'
  ) and not p_confirmed_absent then
    raise exception 'notification_retry_confirmation_required' using errcode = '22023';
  end if;
  v_status := public.get_google_chat_notification_event_status_v1(p_event_id);
  if coalesce((v_status ->> 'retry_allowed')::boolean, false) is not true then
    if exists (
      select 1 from dashboard_private.notification_deliveries delivery
      where delivery.event_id = p_event_id and delivery.channel_key = 'google_chat'
        and delivery.status = 'sent'
    ) and not exists (
      select 1 from dashboard_private.notification_deliveries delivery
      where delivery.event_id = p_event_id and delivery.channel_key = 'google_chat'
        and delivery.status in ('failed', 'delivery_unknown')
    ) then
      raise exception 'notification_already_sent' using errcode = '22023';
    end if;
    raise exception 'notification_retry_not_allowed' using errcode = '22023';
  end if;
  update dashboard_private.notification_event_fanout_jobs job
  set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
      claimed_by = null, claim_token = null, lease_expires_at = null,
      completed_at = null, last_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where job.event_id = p_event_id and job.status in ('failed', 'pending');
  update dashboard_private.notification_deliveries delivery
  set status = 'retry_wait', status_reason = 'manual_retry_approved',
      next_attempt_at = pg_catalog.clock_timestamp(), claimed_by = null, claim_token = null,
      lease_expires_at = null, resolved_at = null, max_attempts = greatest(max_attempts, attempt_count + 1),
      updated_at = pg_catalog.clock_timestamp()
  where delivery.event_id = p_event_id and delivery.channel_key = 'google_chat'
    and delivery.status in ('failed', 'delivery_unknown');
  v_wakeup := dashboard_private.request_notification_worker_wakeup_v1('manual_retry');
  v_status := public.get_google_chat_notification_event_status_v1(p_event_id)
    || pg_catalog.jsonb_build_object('wakeup_generation', v_wakeup -> 'wakeupGeneration');
  insert into dashboard_private.notification_manual_retry_requests(
    request_id, event_id, actor_profile_id, confirmed_absent, response_payload
  ) values (p_request_id, p_event_id, auth.uid(), p_confirmed_absent, v_status);
  return v_status;
end;
$$;

alter function dashboard_private.request_notification_worker_wakeup_v1(text) owner to postgres;
alter function dashboard_private.request_notification_worker_after_fanout_insert_v1() owner to postgres;
alter function public.complete_notification_worker_generation_v1(bigint,boolean) owner to postgres;
alter function dashboard_private.assert_notification_event_actor_v1(uuid) owner to postgres;
alter function public.get_google_chat_notification_event_status_v1(uuid) owner to postgres;
alter function public.retry_google_chat_notification_event_v1(uuid,uuid,boolean) owner to postgres;

revoke all on function dashboard_private.request_notification_worker_wakeup_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.request_notification_worker_after_fanout_insert_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.complete_notification_worker_generation_v1(bigint,boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_notification_event_actor_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_google_chat_notification_event_status_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_google_chat_notification_event_v1(uuid,uuid,boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_notification_worker_generation_v1(bigint,boolean)
  to service_role;
grant execute on function public.get_google_chat_notification_event_status_v1(uuid)
  to authenticated;
grant execute on function public.retry_google_chat_notification_event_v1(uuid,uuid,boolean)
  to authenticated;

commit;
