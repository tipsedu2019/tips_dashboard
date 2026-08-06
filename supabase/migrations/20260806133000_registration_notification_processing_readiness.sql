set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.get_registration_notification_processing_readiness_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_registration_runtime_version integer := 0;
  v_adapters_runtime_version integer := 0;
  v_worker_heartbeat jsonb := null;
  v_watchdog_heartbeat jsonb := null;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  if pg_catalog.to_regprocedure(
    'public.registration_appointment_reminders_runtime_version()'
  ) is not null then
    begin
      execute 'select public.registration_appointment_reminders_runtime_version()'
        into v_registration_runtime_version;
    exception
      when others then
        v_registration_runtime_version := 0;
    end;
  end if;

  if pg_catalog.to_regprocedure(
    'public.notification_workflow_adapters_runtime_version()'
  ) is not null then
    begin
      execute 'select public.notification_workflow_adapters_runtime_version()'
        into v_adapters_runtime_version;
    exception
      when others then
        v_adapters_runtime_version := 0;
    end;
  end if;

  if pg_catalog.to_regclass(
    'dashboard_private.notification_worker_heartbeats'
  ) is not null then
    execute $query$
      select pg_catalog.jsonb_build_object(
        'kind', 'worker',
        'phase', heartbeat.phase,
        'created_at', heartbeat.created_at
      )
      from dashboard_private.notification_worker_heartbeats heartbeat
      where heartbeat.worker_id = 'notification-worker-route-v1'
      order by heartbeat.created_at desc, heartbeat.id desc
      limit 1
    $query$ into v_worker_heartbeat;
  end if;

  if pg_catalog.to_regclass(
    'dashboard_private.notification_watchdog_heartbeats'
  ) is not null then
    execute $query$
      select pg_catalog.jsonb_build_object(
        'kind', 'watchdog',
        'phase', heartbeat.phase,
        'created_at', heartbeat.created_at
      )
      from dashboard_private.notification_watchdog_heartbeats heartbeat
      order by heartbeat.created_at desc, heartbeat.id desc
      limit 1
    $query$ into v_watchdog_heartbeat;
  end if;

  return pg_catalog.jsonb_build_object(
    'registration_runtime_version', case
      when v_registration_runtime_version = 1 then 1 else 0 end,
    'adapters_runtime_version', case
      when v_adapters_runtime_version = 1 then 1 else 0 end,
    'worker_heartbeat', v_worker_heartbeat,
    'watchdog_heartbeat', v_watchdog_heartbeat
  );
end;
$$;

revoke all on function public.get_registration_notification_processing_readiness_v1()
  from public, anon, authenticated;
grant execute on function public.get_registration_notification_processing_readiness_v1()
  to service_role;
