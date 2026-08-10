begin;
select plan(11);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'registration_task_event_shared_visible',
  array['public.ops_task_events'],
  'shared history visibility is a PostgREST row-composite computed field'
);
select is(
  pg_catalog.pg_get_function_result(
    pg_catalog.to_regprocedure(
      'public.registration_task_event_shared_visible(public.ops_task_events)'
    )
  ),
  'boolean',
  'shared history visibility returns boolean'
);
select hasnt_column(
  'public',
  'ops_task_events',
  'registration_task_event_shared_visible',
  'shared visibility is computed without changing the task-event row shape'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'functionCount', pg_catalog.count(*),
      'exactContractCount', pg_catalog.count(*) filter (
        where function_row.pronargs = 1
          and function_row.proargnames is null
          and function_row.proargtypes[0] = 'public.ops_task_events'::pg_catalog.regtype
          and function_row.prorettype = 'boolean'::pg_catalog.regtype
          and not function_row.proretset
          and not function_row.prosecdef
          and function_row.provolatile = 's'
          and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
          and exists (
            select 1
            from pg_catalog.unnest(
              coalesce(function_row.proconfig, '{}'::text[])
            ) config(setting)
            where config.setting in ('search_path=', 'search_path=""')
          )
      )
    )
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.proname = 'registration_task_event_shared_visible'
  ),
  '{"exactContractCount":1,"functionCount":1}'::jsonb,
  'computed field has one unnamed composite argument, stable invoker execution, postgres ownership, and an empty search path'
);

select function_privs_are(
  'public',
  'registration_task_event_shared_visible',
  array['public.ops_task_events'],
  'authenticated',
  array['EXECUTE'],
  'authenticated can evaluate the computed field on rows already admitted by RLS'
);
select function_privs_are(
  'public',
  'registration_task_event_shared_visible',
  array['public.ops_task_events'],
  'service_role',
  array['EXECUTE'],
  'service role can evaluate the same computed field without a separate RPC'
);
select is(
  pg_catalog.jsonb_build_object(
    'anon', coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('public.registration_task_event_shared_visible(public.ops_task_events)'),
      'EXECUTE'
    ), false)
  ),
  '{"anon":false}'::jsonb,
  'anon receives no computed-field execution grant'
);
select is_empty(
  $$
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'registration_task_event_shared_visible'
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  $$,
  'PUBLIC retains no implicit computed-field execution grant'
);

create or replace function pg_temp.registration_task_event_shared_visible_case(
  p_event_type text,
  p_after_value text
)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_visible boolean;
begin
  if pg_catalog.to_regprocedure(
    'public.registration_task_event_shared_visible(public.ops_task_events)'
  ) is null then
    return null;
  end if;

  execute $query$
    select public.registration_task_event_shared_visible(
      pg_catalog.jsonb_populate_record(
        null::public.ops_task_events,
        pg_catalog.jsonb_build_object(
          'event_type', $1,
          'after_value', $2
        )
      )
    )
  $query$
  into v_visible
  using p_event_type, p_after_value;
  return v_visible;
end;
$$;

select results_eq(
  $$
    with cases(case_order, case_name, event_type, after_value) as (
      values
        (1, 'outer legacy observation event', 'registration_observation_booking_saved', null::text),
        (2, 'v1 inner observation event', 'registration_track_event', '{"version":1,"eventType":"registration_observation_booking_saved"}'),
        (3, 'v2 inner observation event', 'registration_track_event', '{"version":2,"event_type":"registration_observation_booking_saved"}'),
        (4, 'non-observation v2 event', 'registration_track_event', '{"version":2,"event_type":"registration_workflow_status_changed"}'),
        (5, 'observation-looking nested metadata', 'registration_track_event', '{"version":2,"event_type":"registration_workflow_status_changed","metadata":{"version":2,"event_type":"registration_observation_reference"}}'),
        (6, 'observation keys only in nested metadata', 'registration_track_event', '{"metadata":{"version":2,"event_type":"registration_observation_reference"}}'),
        (7, 'unknown version twenty', 'registration_track_event', '{"version":20,"event_type":"registration_observation_booking_saved"}'),
        (8, 'malformed payload', 'registration_track_event', '{"version":2,"event_type":'),
        (9, 'null payload', 'registration_track_event', null::text),
        (10, 'non-track outer event', 'customer_message_sent', '{"version":2,"event_type":"registration_observation_booking_saved"}'),
        (11, 'outer prefix near miss', 'registrationXobservationYbooking_saved', null::text),
        (12, 'v2 prefix near miss', 'registration_track_event', '{"version":2,"event_type":"registrationXobservationYbooking_saved"}'),
        (13, 'v1 snake-case observation key', 'registration_track_event', '{"version":1,"event_type":"registration_observation_booking_saved"}'),
        (14, 'v2 camel-case observation key', 'registration_track_event', '{"version":2,"eventType":"registration_observation_booking_saved"}'),
        (15, 'string version one', 'registration_track_event', '{"version":"1","eventType":"registration_observation_booking_saved"}'),
        (16, 'string version two', 'registration_track_event', '{"version":"2","event_type":"registration_observation_booking_saved"}'),
        (17, 'string version near miss', 'registration_track_event', '{"version":"2.0","event_type":"registration_observation_booking_saved"}'),
        (18, 'unsupported unicode payload', 'registration_track_event', '{"version":2,"event_type":"registration_workflow_status_changed","metadata":"\u0000"}'),
        (19, 'outer whitespace prefix', ' registration_observation_booking_saved', null::text),
        (20, 'inner whitespace prefix', 'registration_track_event', '{"version":2,"event_type":" registration_observation_booking_saved"}'),
        (21, 'inner non-string prefix', 'registration_track_event', '{"version":2,"event_type":["registration_observation_booking_saved"]}')
    )
    select
      case_name,
      pg_temp.registration_task_event_shared_visible_case(event_type, after_value)
    from cases
    order by case_order
  $$,
  $$
    values
      ('outer legacy observation event'::text, false),
      ('v1 inner observation event'::text, false),
      ('v2 inner observation event'::text, false),
      ('non-observation v2 event'::text, true),
      ('observation-looking nested metadata'::text, true),
      ('observation keys only in nested metadata'::text, true),
      ('unknown version twenty'::text, true),
      ('malformed payload'::text, true),
      ('null payload'::text, true),
      ('non-track outer event'::text, true),
      ('outer prefix near miss'::text, true),
      ('v2 prefix near miss'::text, true),
      ('v1 snake-case observation key'::text, true),
      ('v2 camel-case observation key'::text, true),
      ('string version one'::text, false),
      ('string version two'::text, false),
      ('string version near miss'::text, true),
      ('unsupported unicode payload'::text, true),
      ('outer whitespace prefix'::text, true),
      ('inner whitespace prefix'::text, true),
      ('inner non-string prefix'::text, true)
  $$,
  'only exact outer legacy and exact top-level v1/v2 observation kinds are hidden'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.ops_task_events'::pg_catalog.regclass
  ),
  'the original task-event table remains protected by RLS'
);
select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'policy', policy.policyname,
        'command', policy.cmd,
        'authenticatedOnly', policy.roles = array['authenticated']::name[],
        'selectUsesExistingGuard',
          coalesce(policy.qual like '%can_read_ops_task_v1(task_id)%', false),
        'writeCheckPresent', policy.with_check is not null
      )
      order by policy.policyname
    )
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'ops_task_events'
  ),
  '[{"policy":"ops_task_events_select_v2","command":"SELECT","authenticatedOnly":true,"selectUsesExistingGuard":true,"writeCheckPresent":false},{"policy":"ops_task_events_write","command":"INSERT","authenticatedOnly":true,"selectUsesExistingGuard":false,"writeCheckPresent":true}]'::jsonb,
  'computed filtering leaves the original task-event SELECT and INSERT RLS authorities intact'
);

select * from finish();
rollback;
