begin;

select plan(13);

select ok(
  pg_catalog.to_regclass('public.profiles') is not null,
  'profile identity owner exists'
);

select ok(
  pg_catalog.to_regclass('dashboard_private.notification_rules') is not null,
  'notification rules dependency exists'
);

select ok(
  pg_catalog.to_regclass('dashboard_private.notification_deliveries') is not null,
  'notification deliveries dependency exists'
);

select ok(
  pg_catalog.to_regclass('public.ops_registration_observations') is not null,
  'observation source dependency exists'
);

select ok(
  pg_catalog.to_regclass('public.ops_registration_appointments') is not null,
  'appointment source dependency exists'
);

select ok(
  pg_catalog.to_regclass('public.ops_task_events') is not null,
  'canonical registration event dependency exists'
);

select ok(
  pg_catalog.to_regclass(
    'dashboard_private.registration_observation_runtime_settings'
  ) is not null,
  'observation runtime settings dependency exists'
);

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.notification_profile_is_active_v1(uuid)'
  ) is not null,
  'active profile helper dependency exists'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.registration_observation_schema_readiness_v1()'
  ) is not null
    and pg_catalog.to_regprocedure(
      'public.registration_observation_runtime_version()'
    ) is not null,
  'observation readiness signatures exist'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.common_notification_control_plane_runtime_version()'
  ) is not null
    and pg_catalog.to_regprocedure(
      'dashboard_private.notification_runtime_dependency_ready_v1(text)'
    ) is not null,
  'notification runtime readiness signatures exist'
);

select is(
  (
    select setting.activation_version
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ),
  0,
  'foundation focus leaves observation runtime disabled'
);

select is(
  pg_catalog.to_regprocedure(
    'dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(uuid,uuid,uuid,uuid[],boolean)'
  ),
  null::regprocedure,
  'future private mention snapshot seam is not installed by the dependency gate'
);

select is(
  (
    select pg_catalog.count(*)
    from information_schema.routine_privileges privilege
    where privilege.specific_schema = 'dashboard_private'
      and privilege.routine_name =
        'prepare_google_chat_delivery_mention_snapshot_v1'
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee in (
        'PUBLIC',
        'anon',
        'authenticated',
        'service_role'
      )
  ),
  0::bigint,
  'API roles have no execute privilege on the future private mention seam'
);

select * from finish();

rollback;
