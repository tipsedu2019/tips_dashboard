begin;

create or replace function dashboard_private.registration_customer_reminder_schedule_ready_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.count(*) = 1
    and pg_catalog.bool_and(job.schedule = '* * * * *')
    and pg_catalog.bool_and(
      pg_catalog.btrim(job.command) =
        'select dashboard_private.invoke_registration_customer_reminder_worker_v1();'
    )
  from cron.job job
  where job.jobname = 'tips-registration-customer-reminder-v1';
$$;

alter function dashboard_private.registration_customer_reminder_schedule_ready_v1()
  owner to postgres;
revoke all on function dashboard_private.registration_customer_reminder_schedule_ready_v1()
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.set_registration_customer_reminder_cron_active_v1(
  p_active boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_job_count integer := 0;
  v_vault jsonb;
begin
  if p_active is null then
    raise exception 'registration_customer_reminder_schedule_action_invalid'
      using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer into v_job_count
  from cron.job job
  where job.jobname = 'tips-registration-customer-reminder-v1';

  if p_active then
    if v_job_count <> 1
      or not dashboard_private.registration_customer_reminder_schedule_ready_v1() then
      raise exception 'registration_customer_reminder_not_ready'
        using errcode = '55000';
    end if;
    v_vault := dashboard_private.registration_customer_reminder_worker_vault_v1();
    if coalesce((v_vault ->> 'ok')::boolean, false) is not true then
      raise exception 'registration_customer_reminder_worker_vault_invalid'
        using errcode = '55000';
    end if;
  end if;

  for v_job in
    select job.jobid
    from cron.job job
    where job.jobname = 'tips-registration-customer-reminder-v1'
    order by job.jobid
  loop
    perform cron.alter_job(v_job.jobid, active := p_active);
  end loop;
end;
$$;

alter function dashboard_private.set_registration_customer_reminder_cron_active_v1(boolean)
  owner to postgres;
revoke all on function dashboard_private.set_registration_customer_reminder_cron_active_v1(boolean)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.sync_registration_customer_reminder_cron_active_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.set_registration_customer_reminder_cron_active_v1(new.enabled);
  return new;
end;
$$;

alter function dashboard_private.sync_registration_customer_reminder_cron_active_v1()
  owner to postgres;
revoke all on function dashboard_private.sync_registration_customer_reminder_cron_active_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists sync_registration_customer_reminder_cron_active
  on dashboard_private.registration_customer_reminder_settings;
create trigger sync_registration_customer_reminder_cron_active
after insert or update of enabled
on dashboard_private.registration_customer_reminder_settings
for each row
execute function dashboard_private.sync_registration_customer_reminder_cron_active_v1();

create or replace function dashboard_private.invoke_registration_customer_reminder_worker_v1()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_contract jsonb;
  v_request_id bigint;
begin
  select settings.enabled into strict v_enabled
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton;

  if not v_enabled then
    return null;
  end if;

  v_contract := dashboard_private.registration_customer_reminder_worker_vault_v1();
  if coalesce((v_contract ->> 'ok')::boolean, false) is not true then
    raise exception 'registration_customer_reminder_worker_vault_invalid'
      using errcode = '55000';
  end if;
  select net.http_post(
    url := v_contract ->> 'url',
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || (v_contract ->> 'secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

alter function dashboard_private.invoke_registration_customer_reminder_worker_v1()
  owner to postgres;
revoke all on function dashboard_private.invoke_registration_customer_reminder_worker_v1()
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
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_claim_token uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;

  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton;
  if not v_settings.enabled then
    return null;
  end if;

  insert into dashboard_private.registration_customer_reminder_worker_heartbeats(
    singleton, succeeded_at, updated_at
  ) values (
    true, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
  on conflict (singleton) do update
  set succeeded_at = excluded.succeeded_at,
      updated_at = excluded.updated_at;

  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();

  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  join public.ops_registration_appointments appointment
    on appointment.id = job.appointment_id
  where job.status = 'pending'
    and job.available_at <= pg_catalog.clock_timestamp()
    and job.due_at <= pg_catalog.clock_timestamp()
    and appointment.status = 'scheduled'
    and appointment.scheduled_at > pg_catalog.clock_timestamp()
    and appointment.notification_revision = job.source_revision
    and not exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.appointment_id = job.appointment_id
        and message.message_kind = 'appointment_reminder'
    )
  order by job.due_at, job.appointment_id
  for update of job skip locked
  limit 1;

  if not found then return null; end if;
  v_claim_token := gen_random_uuid();
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'claimed',
      claim_token = v_claim_token,
      claim_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes',
      last_error_code = null
  where job.appointment_id = v_job.appointment_id
  returning * into v_job;

  return pg_catalog.jsonb_build_object(
    'jobId', v_job.appointment_id,
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

create or replace function public.manage_registration_customer_reminder_schedule_v1(
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_vault jsonb;
  v_enabled boolean;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('inspect', 'install', 'disable', 'remove') then
    raise exception 'registration_customer_reminder_schedule_action_invalid'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-reminder-schedule-v1', 0)
  );
  if p_action = 'inspect' then
    return dashboard_private.inspect_registration_customer_reminder_schedule_v1();
  end if;

  if p_action in ('install', 'remove') then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-registration-customer-reminder-v1'
      order by job.jobid
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;
  end if;

  if p_action = 'install' then
    v_vault := dashboard_private.registration_customer_reminder_worker_vault_v1();
    if coalesce((v_vault ->> 'ok')::boolean, false) is not true then
      raise exception 'registration_customer_reminder_worker_vault_invalid'
        using errcode = '55000';
    end if;
    perform cron.schedule(
      'tips-registration-customer-reminder-v1',
      '* * * * *',
      $command$select dashboard_private.invoke_registration_customer_reminder_worker_v1();$command$
    );
    select settings.enabled into strict v_enabled
    from dashboard_private.registration_customer_reminder_settings settings
    where settings.singleton;
    perform dashboard_private.set_registration_customer_reminder_cron_active_v1(v_enabled);
  elsif p_action = 'disable' then
    perform dashboard_private.set_registration_customer_reminder_cron_active_v1(false);
  end if;

  return dashboard_private.inspect_registration_customer_reminder_schedule_v1();
end;
$$;

alter function public.manage_registration_customer_reminder_schedule_v1(text)
  owner to postgres;
revoke all on function public.manage_registration_customer_reminder_schedule_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_registration_customer_reminder_schedule_v1(text)
  to service_role;

do $$
declare
  v_enabled boolean;
begin
  select settings.enabled into strict v_enabled
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton;
  perform dashboard_private.set_registration_customer_reminder_cron_active_v1(v_enabled);
end;
$$;

commit;
