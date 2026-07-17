begin;

set local lock_timeout = '5s';

-- Readiness ordering is deliberate:
-- 20260716111000_notification_control_plane_settings_rpc.sql
-- 20260716112000_notification_control_plane_worker_rpc.sql
-- 20260716112500_notification_workflow_settings_seed.sql
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.get_notification_control_plane_v1(text)'
  ) is null
    or pg_catalog.to_regprocedure(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.save_notification_control_plane_with_override_v1(text,jsonb,jsonb,uuid,uuid,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.claim_notification_fanout_jobs_v1(text,integer,integer)'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.notification_settings_ui_registry'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.notification_settings_import_metadata'
    ) is null
    or (
      select pg_catalog.count(distinct registry.workflow_key) <> 7
      from dashboard_private.notification_settings_ui_registry registry
      where registry.workflow_key = any(array[
        'tasks',
        'word_retests',
        'registration',
        'transfer',
        'withdrawal',
        'makeup_requests',
        'approvals'
      ]::text[])
    )
  then
    raise exception 'notification_control_plane_runtime_not_ready'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language sql
stable
set search_path = ''
as $$
  select 1;
$$;

alter function public.common_notification_control_plane_runtime_version()
  owner to postgres;

revoke all on function public.common_notification_control_plane_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.common_notification_control_plane_runtime_version()
  to authenticated, service_role;

commit;
