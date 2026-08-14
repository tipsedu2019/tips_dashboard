begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create extension if not exists pg_cron with schema pg_catalog;

create table dashboard_private.lightweight_registration_alert_runtime_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp()
);

insert into dashboard_private.lightweight_registration_alert_runtime_settings(
  singleton,
  enabled
) values (true, false);

create table dashboard_private.lightweight_registration_alert_states (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null
    check (source_kind in ('level_test', 'visit_consultation', 'observation_class')),
  source_id uuid not null,
  source_revision bigint not null check (source_revision > 0),
  event_kind text not null
    check (event_kind in ('booking_confirmed', 'same_day_reminder')),
  channel text not null
    check (channel in ('customer_alimtalk', 'google_chat')),
  event_key text not null check (nullif(btrim(event_key), '') is not null),
  result text not null default 'pending'
    check (result in ('pending', 'accepted', 'unknown', 'failed_hold')),
  last_processed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (source_kind, source_id, event_kind, channel, event_key)
);

create table dashboard_private.lightweight_registration_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null
    references dashboard_private.lightweight_registration_alert_states(id) on delete restrict,
  source_revision bigint not null check (source_revision > 0),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'accepted', 'unknown', 'failed_hold')),
  claim_token uuid,
  claim_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  provider_http_status integer,
  provider_reference text,
  mention_resolution text not null default 'not_applicable'
    check (mention_resolution in ('not_applicable', 'resolved', 'mention_unresolved')),
  terminalized_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (state_id),
  check (
    (status = 'claimed' and claim_token is not null and claim_expires_at is not null)
    or (status <> 'claimed' and claim_token is null and claim_expires_at is null)
  ),
  check (
    (status in ('accepted', 'unknown', 'failed_hold') and terminalized_at is not null)
    or (status in ('pending', 'claimed') and terminalized_at is null)
  ),
  check (provider_http_status is null or provider_http_status between 100 and 599),
  check (
    provider_reference is null
    or (
      char_length(provider_reference) = 64
      and provider_reference ~ '^[a-f0-9]{64}$'
    )
  )
);

create table dashboard_private.lightweight_registration_alert_daily_runs (
  kst_date date primary key,
  cutoff_at timestamptz not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  delivery_count integer not null default 0 check (delivery_count >= 0),
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  error_code text,
  check (cutoff_at = ((kst_date + time '10:00') at time zone 'Asia/Seoul')),
  check (
    (status = 'running' and finished_at is null and error_code is null)
    or (status = 'completed' and finished_at is not null and error_code is null)
    or (status = 'failed' and finished_at is not null and nullif(btrim(error_code), '') is not null)
  )
);

create index lightweight_registration_alert_deliveries_pending_idx
  on dashboard_private.lightweight_registration_alert_deliveries(created_at, id)
  where status = 'pending';

create index lightweight_registration_alert_deliveries_retention_idx
  on dashboard_private.lightweight_registration_alert_deliveries(terminalized_at, id)
  where terminalized_at is not null;

alter table dashboard_private.lightweight_registration_alert_runtime_settings enable row level security;
alter table dashboard_private.lightweight_registration_alert_states enable row level security;
alter table dashboard_private.lightweight_registration_alert_deliveries enable row level security;
alter table dashboard_private.lightweight_registration_alert_daily_runs enable row level security;

revoke all on table dashboard_private.lightweight_registration_alert_runtime_settings
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.lightweight_registration_alert_states
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.lightweight_registration_alert_deliveries
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.lightweight_registration_alert_daily_runs
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.enqueue_lightweight_registration_alerts_v1(
  p_source_kind text,
  p_source_id uuid,
  p_source_revision bigint,
  p_event_kind text,
  p_event_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels text[] := case
    when p_source_kind = 'level_test' then array['customer_alimtalk']
    when p_source_kind in ('visit_consultation', 'observation_class')
      then array['customer_alimtalk', 'google_chat']
    else null
  end;
  v_channel text;
  v_state_id uuid;
  v_inserted integer := 0;
begin
  if p_source_id is null
    or p_source_revision is null
    or p_source_revision < 1
    or p_event_kind not in ('booking_confirmed', 'same_day_reminder')
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or v_channels is null
    or (p_event_kind = 'booking_confirmed' and p_event_key <> 'booking')
    or (
      p_event_kind = 'same_day_reminder'
      and p_event_key !~ '^\d{4}-\d{2}-\d{2}$'
    )
  then
    raise exception 'lightweight_registration_alert_invalid'
      using errcode = '22023';
  end if;

  if not coalesce((
    select settings.enabled
    from dashboard_private.lightweight_registration_alert_runtime_settings settings
    where settings.singleton
  ), false) then
    return 0;
  end if;

  foreach v_channel in array v_channels loop
    v_state_id := null;
    insert into dashboard_private.lightweight_registration_alert_states(
      source_kind,
      source_id,
      source_revision,
      event_kind,
      channel,
      event_key
    ) values (
      p_source_kind,
      p_source_id,
      p_source_revision,
      p_event_kind,
      v_channel,
      p_event_key
    )
    on conflict (source_kind, source_id, event_kind, channel, event_key)
      do nothing
    returning id into v_state_id;

    if v_state_id is not null then
      insert into dashboard_private.lightweight_registration_alert_deliveries(
        state_id,
        source_revision
      ) values (
        v_state_id,
        p_source_revision
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function dashboard_private.enqueue_lightweight_registration_alerts_v1(
  text, uuid, bigint, text, text
) from public, anon, authenticated, service_role;

create or replace function public.enqueue_lightweight_registration_booking_alerts_v1(
  p_source_kind text,
  p_source_id uuid,
  p_source_revision bigint
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select dashboard_private.enqueue_lightweight_registration_alerts_v1(
    p_source_kind,
    p_source_id,
    p_source_revision,
    'booking_confirmed',
    'booking'
  );
$$;

revoke all on function public.enqueue_lightweight_registration_booking_alerts_v1(
  text, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.enqueue_lightweight_registration_booking_alerts_v1(
  text, uuid, bigint
) to service_role;

create or replace function dashboard_private.capture_lightweight_registration_booking_alerts_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'scheduled'
    and new.kind in ('level_test', 'visit_consultation', 'observation_class')
  then
    perform dashboard_private.enqueue_lightweight_registration_alerts_v1(
      new.kind,
      new.id,
      new.notification_revision,
      'booking_confirmed',
      'booking'
    );
  end if;
  return new;
end;
$$;

revoke all on function dashboard_private.capture_lightweight_registration_booking_alerts_v1()
  from public, anon, authenticated, service_role;

create trigger capture_lightweight_registration_booking_alerts
after insert on public.ops_registration_appointments
for each row
execute function dashboard_private.capture_lightweight_registration_booking_alerts_v1();

create or replace function dashboard_private.lightweight_registration_alert_now_v1()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select statement_timestamp()
$$;

revoke all on function dashboard_private.lightweight_registration_alert_now_v1()
  from public, anon, authenticated, service_role;

create or replace function public.enqueue_due_lightweight_registration_reminders_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := dashboard_private.lightweight_registration_alert_now_v1();
  v_kst_date date := (v_now at time zone 'Asia/Seoul')::date;
  v_cutoff timestamptz := ((v_now at time zone 'Asia/Seoul')::date + time '10:00')
    at time zone 'Asia/Seoul';
  v_appointment record;
  v_candidate_count integer := 0;
  v_delivery_count integer := 0;
begin
  if v_now < v_cutoff then
    raise exception 'lightweight_registration_reminder_before_cutoff'
      using errcode = '55000';
  end if;

  insert into dashboard_private.lightweight_registration_alert_daily_runs(
    kst_date,
    cutoff_at,
    status
  ) values (
    v_kst_date,
    v_cutoff,
    'running'
  )
  on conflict (kst_date) do update
  set cutoff_at = excluded.cutoff_at,
      status = 'running',
      candidate_count = 0,
      delivery_count = 0,
      started_at = excluded.started_at,
      finished_at = null,
      error_code = null
  where dashboard_private.lightweight_registration_alert_daily_runs.status = 'failed';

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'already_processed',
      'kstDate', v_kst_date,
      'candidateCount', 0,
      'deliveryCount', 0
    );
  end if;

  for v_appointment in
    select appointment.id,
           appointment.kind,
           appointment.notification_revision
    from public.ops_registration_appointments appointment
    where appointment.status = 'scheduled'
      and appointment.kind in ('level_test', 'visit_consultation', 'observation_class')
      and (appointment.scheduled_at at time zone 'Asia/Seoul')::date = v_kst_date
      and appointment.created_at <= v_cutoff
    order by appointment.scheduled_at, appointment.id
  loop
    v_candidate_count := v_candidate_count + 1;
    v_delivery_count := v_delivery_count
      + dashboard_private.enqueue_lightweight_registration_alerts_v1(
          v_appointment.kind,
          v_appointment.id,
          v_appointment.notification_revision,
          'same_day_reminder',
          v_kst_date::text
        );
  end loop;

  update dashboard_private.lightweight_registration_alert_daily_runs run
  set status = 'completed',
      candidate_count = v_candidate_count,
      delivery_count = v_delivery_count,
      finished_at = v_now
  where run.kst_date = v_kst_date;

  perform public.prune_lightweight_registration_alert_history_v1(100);

  return pg_catalog.jsonb_build_object(
    'status', 'completed',
    'kstDate', v_kst_date,
    'candidateCount', v_candidate_count,
    'deliveryCount', v_delivery_count
  );
exception
  when others then
    update dashboard_private.lightweight_registration_alert_daily_runs run
    set status = 'failed',
        finished_at = statement_timestamp(),
        error_code = 'daily_run_failed'
    where run.kst_date = v_kst_date
      and run.status = 'running';
    raise;
end;
$$;

revoke all on function public.enqueue_due_lightweight_registration_reminders_v1()
  from public, anon, authenticated;
grant execute on function public.enqueue_due_lightweight_registration_reminders_v1()
  to service_role;

create or replace function public.prune_lightweight_registration_alert_history_v1(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_delivery_count integer := 0;
  v_run_count integer := 0;
  v_batch_count integer := 0;
begin
  if p_limit is null or not (p_limit between 1 and 500) then
    raise exception 'lightweight_registration_alert_prune_limit_invalid'
      using errcode = '22023';
  end if;

  update dashboard_private.lightweight_registration_alert_states state
  set result = 'failed_hold',
      last_processed_at = v_now,
      updated_at = v_now
  where exists (
    select 1
    from dashboard_private.lightweight_registration_alert_deliveries delivery
    where delivery.state_id = state.id
      and delivery.status in ('pending', 'claimed')
      and delivery.created_at <= v_now - interval '7 days'
  );

  update dashboard_private.lightweight_registration_alert_deliveries delivery
  set status = 'failed_hold',
      claim_token = null,
      claim_expires_at = null,
      terminalized_at = delivery.created_at,
      updated_at = v_now
  where delivery.status in ('pending', 'claimed')
    and delivery.created_at <= v_now - interval '7 days';

  loop
    with deleted as (
      delete from dashboard_private.lightweight_registration_alert_deliveries delivery
      where delivery.id in (
        select candidate.id
        from dashboard_private.lightweight_registration_alert_deliveries candidate
        where candidate.terminalized_at <= v_now - interval '7 days'
        order by candidate.terminalized_at, candidate.id
        limit p_limit
        for update skip locked
      )
      returning 1
    )
    select pg_catalog.count(*)::integer into v_batch_count from deleted;
    v_delivery_count := v_delivery_count + v_batch_count;
    exit when v_batch_count < p_limit;
  end loop;

  update dashboard_private.lightweight_registration_alert_daily_runs run
  set status = 'failed',
      finished_at = run.started_at,
      error_code = 'stale_run'
  where run.status = 'running'
    and run.started_at <= v_now - interval '7 days';

  loop
    with deleted as (
      delete from dashboard_private.lightweight_registration_alert_daily_runs run
      where run.kst_date in (
        select candidate.kst_date
        from dashboard_private.lightweight_registration_alert_daily_runs candidate
        where candidate.finished_at <= v_now - interval '7 days'
        order by candidate.finished_at, candidate.kst_date
        limit p_limit
        for update skip locked
      )
      returning 1
    )
    select pg_catalog.count(*)::integer into v_batch_count from deleted;
    v_run_count := v_run_count + v_batch_count;
    exit when v_batch_count < p_limit;
  end loop;

  return pg_catalog.jsonb_build_object(
    'deliveryReceiptsDeleted', v_delivery_count,
    'runDetailsDeleted', v_run_count
  );
end;
$$;

revoke all on function public.prune_lightweight_registration_alert_history_v1(integer)
  from public, anon, authenticated;
grant execute on function public.prune_lightweight_registration_alert_history_v1(integer)
  to service_role;

create or replace function public.manage_lightweight_registration_alert_schedule_v1(
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
  v_old_active integer;
begin
  if p_action not in ('install_inactive', 'activate', 'disable', 'remove') then
    raise exception 'lightweight_registration_alert_schedule_action_invalid'
      using errcode = '22023';
  end if;
  if pg_catalog.to_regclass('cron.job') is null
    or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
    or pg_catalog.to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null
  then
    raise exception 'lightweight_registration_alert_schedule_unavailable'
      using errcode = '55000';
  end if;

  execute $sql$
    select pg_catalog.count(*)::integer
    from cron.job
    where jobname in (
      'tips-notification-worker-v1',
      'tips-notification-cutover-watchdog-v1',
      'tips-registration-customer-reminder-v1'
    )
      and active
  $sql$ into v_old_active;
  if v_old_active <> 0 then
    raise exception 'lightweight_registration_alert_legacy_schedule_active'
      using errcode = '55000';
  end if;

  execute $sql$
    select jobid
    from cron.job
    where jobname = 'tips-lightweight-registration-reminder-v1'
  $sql$ into v_job_id;

  if p_action = 'install_inactive' then
    if v_job_id is null then
      v_job_id := cron.schedule(
        'tips-lightweight-registration-reminder-v1',
        '0 1 * * *',
        'select public.enqueue_due_lightweight_registration_reminders_v1();'
      );
    end if;
    perform cron.alter_job(v_job_id, active := false);
  elsif p_action = 'activate' then
    if v_job_id is null then
      raise exception 'lightweight_registration_alert_schedule_missing'
        using errcode = '55000';
    end if;
    if not coalesce((
      select settings.enabled
      from dashboard_private.lightweight_registration_alert_runtime_settings settings
      where settings.singleton
    ), false) then
      raise exception 'lightweight_registration_alert_runtime_inactive'
        using errcode = '55000';
    end if;
    perform cron.alter_job(v_job_id, active := true);
  elsif p_action = 'disable' then
    if v_job_id is not null then
      perform cron.alter_job(v_job_id, active := false);
    end if;
  elsif v_job_id is not null then
    perform cron.unschedule(v_job_id);
    v_job_id := null;
  end if;

  return pg_catalog.jsonb_build_object(
    'action', p_action,
    'jobId', v_job_id,
    'schedule', '0 1 * * *',
    'active', p_action = 'activate'
  );
end;
$$;

revoke all on function public.manage_lightweight_registration_alert_schedule_v1(text)
  from public, anon, authenticated;
grant execute on function public.manage_lightweight_registration_alert_schedule_v1(text)
  to service_role;

alter function dashboard_private.enqueue_lightweight_registration_alerts_v1(
  text, uuid, bigint, text, text
) owner to postgres;
alter function dashboard_private.capture_lightweight_registration_booking_alerts_v1()
  owner to postgres;
alter function public.enqueue_lightweight_registration_booking_alerts_v1(
  text, uuid, bigint
) owner to postgres;
alter function public.enqueue_due_lightweight_registration_reminders_v1()
  owner to postgres;
alter function public.prune_lightweight_registration_alert_history_v1(integer)
  owner to postgres;
alter function public.manage_lightweight_registration_alert_schedule_v1(text)
  owner to postgres;

commit;
