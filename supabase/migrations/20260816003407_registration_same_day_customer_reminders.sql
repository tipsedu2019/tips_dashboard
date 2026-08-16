begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.ops_registration_appointments
  add column if not exists schedule_confirmed_at timestamptz;

update public.ops_registration_appointments
set schedule_confirmed_at = updated_at
where schedule_confirmed_at is null;

alter table public.ops_registration_appointments
  alter column schedule_confirmed_at set not null,
  alter column schedule_confirmed_at set default pg_catalog.clock_timestamp();

create or replace function dashboard_private.registration_appointment_reminder_due_v1(
  p_kind text,
  p_status text,
  p_scheduled_at timestamptz,
  p_created_at timestamptz,
  p_schedule_confirmed_at timestamptz,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  v_day_start := pg_catalog.date_trunc('day', p_now at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_day_end := v_day_start + interval '1 day';

  return p_kind in ('level_test', 'visit_consultation')
    and p_status = 'scheduled'
    and p_scheduled_at >= v_day_start
    and p_scheduled_at < v_day_end
    and p_created_at < v_day_start
    and p_schedule_confirmed_at < v_day_start;
end;
$$;

alter function dashboard_private.registration_appointment_reminder_due_v1(
  text, text, timestamptz, timestamptz, timestamptz, timestamptz
) owner to postgres;
revoke all on function dashboard_private.registration_appointment_reminder_due_v1(
  text, text, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create or replace function dashboard_private.set_registration_appointment_schedule_confirmed_at_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scheduled_at is distinct from old.scheduled_at
    or new.place is distinct from old.place then
    new.schedule_confirmed_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end;
$$;

alter function dashboard_private.set_registration_appointment_schedule_confirmed_at_v1()
  owner to postgres;
revoke all on function dashboard_private.set_registration_appointment_schedule_confirmed_at_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists set_registration_appointment_schedule_confirmed_at on public.ops_registration_appointments;
create trigger set_registration_appointment_schedule_confirmed_at
before update on public.ops_registration_appointments
for each row execute function dashboard_private.set_registration_appointment_schedule_confirmed_at_v1();

create or replace function dashboard_private.sync_registration_customer_reminder_jobs_v1()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_send_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;

  v_day_start := pg_catalog.date_trunc('day', v_now at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_day_end := v_day_start + interval '1 day';
  v_send_at := v_day_start + interval '10 hours';

  update public.ops_registration_customer_messages message
  set status = 'unknown', error_code = 'scheduled_marker_recovery',
      resolution_source = 'scheduled_marker_recovery', resolved_at = v_now, updated_at = v_now
  from dashboard_private.registration_customer_reminder_jobs job
  where job.message_kind = 'appointment_reminder' and job.status = 'dispatching' and job.message_id = message.id
    and message.delivery_origin = 'scheduled' and message.status = 'pending' and message.provider_attempt_count = 1
    and message.provider_attempt_started_at <= v_now - interval '15 minutes';

  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when message.status = 'unknown' then 'delivery_unknown' else 'completed' end,
      claim_token = null, claim_expires_at = null,
      last_error_code = case when message.status = 'unknown' then 'provider_dispatch_uncertain' when message.status = 'failed_hold' then 'provider_rejected' else null end
  from public.ops_registration_customer_messages message
  where job.message_kind = 'appointment_reminder' and job.message_id = message.id and job.status = 'dispatching'
    and message.status in ('accepted', 'unknown', 'failed_hold');

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending', claim_token = null, claim_expires_at = null,
      available_at = v_now, last_error_code = 'claim_lease_expired'
  where job.message_kind = 'appointment_reminder' and job.status = 'claimed'
    and job.claim_expires_at <= v_now;

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled', claim_token = null, claim_expires_at = null,
      last_error_code = 'appointment_revision_replaced'
  from public.ops_registration_appointments appointment
  where job.message_kind = 'appointment_reminder'
    and job.appointment_id = appointment.id
    and job.status in ('pending', 'claimed')
    and job.source_revision <> appointment.notification_revision;

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled', claim_token = null, claim_expires_at = null,
      last_error_code = 'appointment_not_eligible'
  where job.message_kind = 'appointment_reminder' and job.status in ('pending', 'claimed')
    and not exists (
      select 1
      from public.ops_registration_appointments appointment
      where appointment.id = job.appointment_id
        and appointment.task_id = job.task_id
        and appointment.scheduled_at > v_now
        and dashboard_private.registration_appointment_reminder_due_v1(
          appointment.kind,
          appointment.status,
          appointment.scheduled_at,
          appointment.created_at,
          appointment.schedule_confirmed_at,
          v_now
        )
    );

  insert into dashboard_private.registration_customer_reminder_jobs(
    job_id, appointment_id, task_id, message_kind, source_revision, scheduled_for,
    due_at, available_at, request_key, status, last_error_code
  )
  select gen_random_uuid(), appointment.id, appointment.task_id, 'appointment_reminder',
    appointment.notification_revision, appointment.scheduled_at,
    v_send_at, v_now, gen_random_uuid(), 'pending', null
  from public.ops_registration_appointments appointment
  where appointment.scheduled_at > v_now
    and appointment.scheduled_at >= v_day_start
    and appointment.scheduled_at < v_day_end
    and appointment.schedule_confirmed_at < v_day_start
    and appointment.created_at < v_day_start
    and appointment.kind in ('level_test', 'visit_consultation')
    and appointment.status = 'scheduled'
    and not exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.appointment_id = appointment.id
        and message.message_kind = 'appointment_reminder'
    )
  on conflict (appointment_id, source_revision, message_kind)
    where message_kind = 'appointment_reminder'
  do update set task_id = excluded.task_id, scheduled_for = excluded.scheduled_for,
    due_at = excluded.due_at, available_at = least(
      dashboard_private.registration_customer_reminder_jobs.available_at, excluded.available_at
    ), last_error_code = null
  where dashboard_private.registration_customer_reminder_jobs.status = 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function dashboard_private.sync_registration_customer_reminder_jobs_v1()
  owner to postgres;
revoke all on function dashboard_private.sync_registration_customer_reminder_jobs_v1()
  from public, anon, authenticated, service_role;

create or replace function public.claim_registration_customer_reminder_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if not (select enabled from dashboard_private.registration_customer_reminder_settings where singleton) then
    return null;
  end if;

  insert into dashboard_private.registration_customer_reminder_worker_heartbeats(singleton, succeeded_at, updated_at)
  values (true, v_now, v_now)
  on conflict (singleton) do update set succeeded_at = excluded.succeeded_at, updated_at = excluded.updated_at;

  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();

  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  join public.ops_registration_appointments appointment on appointment.id = job.appointment_id
  where job.message_kind = 'appointment_reminder'
    and job.status = 'pending'
    and job.available_at <= v_now
    and job.due_at <= v_now
    and appointment.notification_revision = job.source_revision
    and appointment.scheduled_at > v_now
    and dashboard_private.registration_appointment_reminder_due_v1(
      appointment.kind,
      appointment.status,
      appointment.scheduled_at,
      appointment.created_at,
      appointment.schedule_confirmed_at,
      v_now
    )
  order by job.due_at, job.job_id
  for update of job skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'claimed', claim_token = gen_random_uuid(),
      claim_expires_at = v_now + interval '2 minutes', last_error_code = null
  where job.job_id = v_job.job_id
  returning * into v_job;

  return pg_catalog.jsonb_build_object(
    'jobId', v_job.job_id,
    'appointmentId', v_job.appointment_id,
    'claimToken', v_job.claim_token,
    'sourceRevision', v_job.source_revision,
    'scheduledFor', v_job.scheduled_for,
    'requestKey', v_job.request_key
  );
end;
$$;

alter function public.claim_registration_customer_reminder_job_v1()
  owner to postgres;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1()
  to service_role;

create or replace function public.get_registration_customer_reminder_summaries_v1(
  p_task_id uuid
)
returns table(
  appointment_id uuid,
  state text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not dashboard_private.can_read_ops_task_v1(p_task_id) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  return query
  select
    appointment.id as appointment_id,
    case
      when message.status = 'accepted' then 'sent'
      when message.status = 'unknown' then 'unknown'
      when message.status = 'failed_hold' then 'failed_hold'
      when message.status = 'pending' or job.status in ('claimed', 'dispatching') then 'processing'
      when appointment.status <> 'scheduled' then 'canceled'
      when appointment.created_at >= (
        pg_catalog.date_trunc('day', appointment.scheduled_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
      ) then 'not_applicable_same_day_created'
      when appointment.schedule_confirmed_at >= (
        pg_catalog.date_trunc('day', appointment.scheduled_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
      ) then 'not_applicable_same_day_changed'
      else 'scheduled'
    end as state,
    case
      when message.status in ('accepted', 'unknown', 'failed_hold') then null
      else coalesce(
        job.due_at,
        (pg_catalog.date_trunc('day', appointment.scheduled_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
          + interval '10 hours'
      )
    end as scheduled_for,
    case when message.status = 'accepted' then message.resolved_at else null end as sent_at,
    greatest(
      appointment.updated_at,
      coalesce(job.updated_at, '-infinity'::timestamptz),
      coalesce(message.updated_at, '-infinity'::timestamptz)
    ) as updated_at
  from public.ops_registration_appointments appointment
  left join lateral (
    select reminder_job.*
    from dashboard_private.registration_customer_reminder_jobs reminder_job
    where reminder_job.appointment_id = appointment.id
      and reminder_job.message_kind = 'appointment_reminder'
      and reminder_job.source_revision = appointment.notification_revision
    order by reminder_job.updated_at desc, reminder_job.job_id desc
    limit 1
  ) job on true
  left join lateral (
    select customer_message.*
    from public.ops_registration_customer_messages customer_message
    where customer_message.appointment_id = appointment.id
      and customer_message.message_kind = 'appointment_reminder'
    order by customer_message.updated_at desc, customer_message.id desc
    limit 1
  ) message on true
  where appointment.task_id = p_task_id
    and appointment.kind in ('level_test', 'visit_consultation')
  order by appointment.scheduled_at, appointment.id;
end;
$$;

alter function public.get_registration_customer_reminder_summaries_v1(uuid)
  owner to postgres;
revoke all on function public.get_registration_customer_reminder_summaries_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_reminder_summaries_v1(uuid)
  to authenticated;

create or replace function public.claim_registration_customer_reminder_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if not (select enabled from dashboard_private.registration_customer_reminder_settings where singleton) then
    return null;
  end if;

  insert into dashboard_private.registration_customer_reminder_worker_heartbeats(singleton, succeeded_at, updated_at)
  values (true, v_now, v_now)
  on conflict (singleton) do update set succeeded_at = excluded.succeeded_at, updated_at = excluded.updated_at;

  perform dashboard_private.materialize_registration_observation_solapi_events_v1(100);
  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();

  update public.ops_registration_customer_messages message
  set status = 'unknown', error_code = 'scheduled_marker_recovery',
      resolution_source = 'scheduled_marker_recovery', resolved_at = v_now, updated_at = v_now
  from dashboard_private.registration_customer_reminder_jobs job
  where job.message_kind = 'observation_reminder' and job.status = 'dispatching' and job.message_id = message.id
    and message.delivery_origin = 'scheduled' and message.status = 'pending' and message.provider_attempt_count = 1
    and message.provider_attempt_started_at <= v_now - interval '15 minutes';
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when message.status = 'unknown' then 'delivery_unknown' else 'completed' end,
      claim_token = null, claim_expires_at = null,
      last_error_code = case when message.status = 'unknown' then 'provider_dispatch_uncertain'
        when message.status = 'failed_hold' then 'provider_rejected' else null end
  from public.ops_registration_customer_messages message
  where job.message_kind = 'observation_reminder' and job.message_id = message.id and job.status = 'dispatching'
    and message.status in ('accepted', 'unknown', 'failed_hold');
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending', claim_token = null, claim_expires_at = null,
      available_at = v_now, last_error_code = 'claim_lease_expired'
  where job.message_kind = 'observation_reminder' and job.status = 'claimed' and job.message_id is null
    and job.claim_expires_at <= v_now;

  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  join public.ops_registration_appointments appointment on appointment.id = job.appointment_id
  where job.status = 'pending' and job.available_at <= v_now and job.due_at <= v_now
    and appointment.scheduled_at > v_now
    and case job.message_kind
      when 'appointment_reminder' then
        appointment.notification_revision = job.source_revision
        and dashboard_private.registration_appointment_reminder_due_v1(
          appointment.kind, appointment.status, appointment.scheduled_at, appointment.created_at,
          appointment.schedule_confirmed_at, v_now
        )
      when 'observation_reminder' then
        appointment.status = 'scheduled' and public.registration_observation_runtime_version() = 1
      else false
    end
  order by job.due_at, job.job_id
  for update of job skip locked
  limit 1;

  if not found then return null; end if;

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'claimed', claim_token = gen_random_uuid(), claim_expires_at = v_now + interval '2 minutes', last_error_code = null
  where job.job_id = v_job.job_id
  returning * into v_job;

  if v_job.message_kind = 'appointment_reminder' then
    return pg_catalog.jsonb_build_object(
      'jobId', v_job.job_id, 'appointmentId', v_job.appointment_id,
      'claimToken', v_job.claim_token, 'sourceRevision', v_job.source_revision,
      'scheduledFor', v_job.scheduled_for, 'requestKey', v_job.request_key
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'jobId', v_job.job_id, 'messageKind', v_job.message_kind,
    'appointmentId', v_job.appointment_id, 'observationId', v_job.observation_id,
    'claimToken', v_job.claim_token, 'sourceRevision', v_job.source_revision,
    'scheduledFor', v_job.scheduled_for, 'requestKey', v_job.request_key
  );
end;
$$;

alter function public.claim_registration_customer_reminder_job_v1()
  owner to postgres;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1()
  to service_role;

create table dashboard_private.registration_customer_reminder_continuation_leases (
  singleton boolean primary key default true check (singleton),
  lease_expires_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table dashboard_private.registration_customer_reminder_continuation_leases enable row level security;
revoke all on table dashboard_private.registration_customer_reminder_continuation_leases
  from public, anon, authenticated, service_role;

create or replace function public.has_registration_customer_reminder_backlog_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  return exists (
    select 1
    from dashboard_private.registration_customer_reminder_jobs job
    join public.ops_registration_appointments appointment on appointment.id = job.appointment_id
    where job.status = 'pending'
      and job.available_at <= v_now
      and job.due_at <= v_now
      and appointment.scheduled_at > v_now
      and case job.message_kind
        when 'appointment_reminder' then
          appointment.notification_revision = job.source_revision
          and dashboard_private.registration_appointment_reminder_due_v1(
            appointment.kind, appointment.status, appointment.scheduled_at, appointment.created_at,
            appointment.schedule_confirmed_at, v_now
          )
        when 'observation_reminder' then
          appointment.status = 'scheduled' and public.registration_observation_runtime_version() = 1
        else false
      end
  );
end;
$$;

alter function public.has_registration_customer_reminder_backlog_v1()
  owner to postgres;
revoke all on function public.has_registration_customer_reminder_backlog_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.has_registration_customer_reminder_backlog_v1()
  to service_role;

create or replace function public.continue_registration_customer_reminder_worker_v1()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_id bigint;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-reminder-continuation-v1', 0)
  );
  if not public.has_registration_customer_reminder_backlog_v1() then
    return null;
  end if;

  insert into dashboard_private.registration_customer_reminder_continuation_leases(
    singleton, lease_expires_at, updated_at
  ) values (
    true, v_now + interval '5 seconds', v_now
  ) on conflict (singleton) do update
    set lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at
    where dashboard_private.registration_customer_reminder_continuation_leases.lease_expires_at <= v_now
  returning lease_expires_at into v_now;
  if not found then return null; end if;

  select dashboard_private.invoke_registration_customer_reminder_worker_v1() into v_request_id;
  return v_request_id;
end;
$$;

alter function public.continue_registration_customer_reminder_worker_v1()
  owner to postgres;
revoke all on function public.continue_registration_customer_reminder_worker_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.continue_registration_customer_reminder_worker_v1()
  to service_role;

commit;
