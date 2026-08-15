begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function dashboard_private.registration_customer_reminder_schedule_ready_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.count(*) = 1
    and pg_catalog.bool_and(job.schedule = '0 1 * * *')
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
      '0 1 * * *',
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
  v_job record;
begin
  for v_job in
    select job.jobid, job.command
    from cron.job job
    where job.jobname = 'tips-registration-customer-reminder-v1'
    order by job.jobid
  loop
    if pg_catalog.btrim(v_job.command) <>
      'select dashboard_private.invoke_registration_customer_reminder_worker_v1();' then
      raise exception 'registration_customer_reminder_schedule_command_invalid'
        using errcode = '55000';
    end if;
    perform cron.alter_job(v_job.jobid, schedule := '0 1 * * *');
  end loop;
end;
$$;

commit;
