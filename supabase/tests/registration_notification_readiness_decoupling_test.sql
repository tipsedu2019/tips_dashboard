begin;

select plan(5);

select ok(
  pg_catalog.to_regprocedure(
    'public.ensure_registration_workflow_notification_v1(uuid,integer)'
  ) is not null,
  'the retired v1 signature remains available for deterministic mixed-version failures'
);

select ok((
  select pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    and not procedure.prosecdef
    and procedure.provolatile = 'v'
    and procedure.proconfig[1]
      = any(array['search_path=', 'search_path=""']::text[])
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.ensure_registration_workflow_notification_v1(uuid,integer)'::pg_catalog.regprocedure
), 'the retired v1 compatibility stub is postgres-owned security-invoker code with an empty search path');

select is(
  pg_catalog.jsonb_build_object(
    'public', pg_catalog.has_function_privilege(
      'public',
      'public.ensure_registration_workflow_notification_v1(uuid,integer)',
      'EXECUTE'
    ),
    'anon', pg_catalog.has_function_privilege(
      'anon',
      'public.ensure_registration_workflow_notification_v1(uuid,integer)',
      'EXECUTE'
    ),
    'authenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.ensure_registration_workflow_notification_v1(uuid,integer)',
      'EXECUTE'
    ),
    'serviceRole', pg_catalog.has_function_privilege(
      'service_role',
      'public.ensure_registration_workflow_notification_v1(uuid,integer)',
      'EXECUTE'
    )
  ),
  '{"anon":false,"public":false,"serviceRole":false,"authenticated":false}'::jsonb,
  'the retired v1 signature grants execute to no application role'
);

create temporary table registration_notification_v1_retirement_before(
  source_count bigint not null,
  canonical_count bigint not null
) on commit drop;

insert into registration_notification_v1_retirement_before(
  source_count,
  canonical_count
)
select
  pg_catalog.count(*) filter (
    where source.event_type = 'registration_track_event'
      and dashboard_private.try_registration_event_jsonb_object(
        source.after_value
      ) ->> 'event_type' = 'registration_management_notification_requested'
  ),
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key in (
        'registration.case_created',
        'registration.consultation_completed',
        'registration.waiting_transitioned',
        'registration.admission_started'
      )
  )
from public.ops_task_events source;

select throws_ok(
  $$select public.ensure_registration_workflow_notification_v1(
    '99700000-0000-4000-8000-000000000111',
    1
  )$$,
  '55000',
  'registration_workflow_notification_v1_retired',
  'a privileged mixed-version caller receives the exact non-retryable retirement failure'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'sources', pg_catalog.count(*) filter (
        where source.event_type = 'registration_track_event'
          and dashboard_private.try_registration_event_jsonb_object(
            source.after_value
          ) ->> 'event_type' = 'registration_management_notification_requested'
      ),
      'canonical', (
        select pg_catalog.count(*)
        from dashboard_private.notification_events canonical
        where canonical.workflow_key = 'registration'
          and canonical.event_key in (
            'registration.case_created',
            'registration.consultation_completed',
            'registration.waiting_transitioned',
            'registration.admission_started'
          )
      )
    )
    from public.ops_task_events source
  ),
  (
    select pg_catalog.jsonb_build_object(
      'sources', before_row.source_count,
      'canonical', before_row.canonical_count
    )
    from registration_notification_v1_retirement_before before_row
  ),
  'the retired v1 call creates no source or canonical notification side effect'
);

select * from finish();
rollback;
