begin;

do $migration$
declare
  v_dependency text;
begin
  foreach v_dependency in array array[
    'public.profiles',
    'dashboard_private.notification_rules',
    'dashboard_private.notification_deliveries',
    'public.ops_registration_observations',
    'public.ops_registration_appointments',
    'public.ops_task_events',
    'dashboard_private.registration_observation_runtime_settings'
  ]
  loop
    if pg_catalog.to_regclass(v_dependency) is null then
      raise exception 'dashboard_google_chat_profile_mentions_dependency_missing:%',
        v_dependency
        using errcode = '55000';
    end if;
  end loop;

  foreach v_dependency in array array[
    'dashboard_private.notification_profile_is_active_v1(uuid)',
    'public.registration_observation_schema_readiness_v1()',
    'public.registration_observation_runtime_version()',
    'public.common_notification_control_plane_runtime_version()',
    'dashboard_private.notification_runtime_dependency_ready_v1(text)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_dependency) is null then
      raise exception 'dashboard_google_chat_profile_mentions_dependency_missing:%',
        v_dependency
        using errcode = '55000';
    end if;
  end loop;
end;
$migration$;

commit;
