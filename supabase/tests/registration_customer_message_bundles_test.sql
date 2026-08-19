begin;

select plan(10);

select has_table('dashboard_private', 'registration_customer_message_bundle_runtime', 'bundle runtime is private');
select has_table('dashboard_private', 'registration_customer_message_bundle_runs', 'daily bundle runs are private');
select has_table('dashboard_private', 'registration_customer_message_bundles', 'bundle manifests are private');
select has_table('dashboard_private', 'registration_customer_message_bundle_items', 'bundle item snapshots are private');

select results_eq(
  $$ select active_version from dashboard_private.registration_customer_message_bundle_runtime where singleton $$,
  $$ values (0::integer) $$,
  'install keeps bundle runtime inactive'
);

select results_eq(
  $$ select message_kind || ':' || mode from dashboard_private.registration_customer_solapi_activation where message_kind like '%_bundle' order by message_kind $$,
  $$ values
    ('level_test_booking_bundle:off'::text),
    ('level_test_reminder_bundle:off'::text),
    ('observation_booking_bundle:off'::text),
    ('observation_reminder_bundle:off'::text),
    ('visit_consultation_booking_bundle:off'::text),
    ('visit_consultation_reminder_bundle:off'::text) $$,
  'all bundle kinds install off'
);

select policy_cmd_is('dashboard_private', 'registration_customer_message_bundles', null, null, 'private bundle manifests expose no RLS policy');

select throws_ok(
  $$ select public.resolve_registration_customer_message_bundle_source_v1('level_test_booking_bundle', gen_random_uuid(), null) $$,
  '42501',
  'registration_customer_message_bundle_service_role_required',
  'bundle source RPC requires service role'
);

select has_function('dashboard_private', 'materialize_registration_customer_message_bundle_v1', array['uuid', 'text', 'text', 'date', 'timestamp with time zone'], 'materializer is installed');
select has_function('public', 'get_registration_customer_message_bundle_runtime_v1', array[]::text[], 'runtime reader is installed');

select * from finish();
rollback;
