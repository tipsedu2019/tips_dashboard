begin;
select plan(9);

select has_function('public', 'save_registration_appointment_details_v1', array['uuid', 'uuid', 'text', 'timestamp with time zone', 'text', 'uuid[]', 'integer', 'text']);
select has_function('public', 'save_registration_level_test_result_v1', array['uuid', 'text', 'text', 'text']);
select has_function('public', 'save_registration_consultation_details_v1', array['uuid', 'text', 'text', 'text', 'text']);
select function_privs_are('public', 'save_registration_appointment_details_v1', array['uuid', 'uuid', 'text', 'timestamp with time zone', 'text', 'uuid[]', 'integer', 'text'], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'save_registration_level_test_result_v1', array['uuid', 'text', 'text', 'text'], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'save_registration_consultation_details_v1', array['uuid', 'text', 'text', 'text', 'text'], 'authenticated', array['EXECUTE']);
select is_empty($$
  select 1 from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('save_registration_appointment_details_v1', 'save_registration_level_test_result_v1', 'save_registration_consultation_details_v1')
    and grantee in ('PUBLIC', 'anon') and privilege_type = 'EXECUTE'
$$);
select has_table(
  'dashboard_private',
  'ops_registration_mutations',
  'dashboard_private.ops_registration_mutations should exist'
);
select has_column(
  'public',
  'ops_registration_subject_tracks',
  'workflow_status',
  'public.ops_registration_subject_tracks.workflow_status should exist'
);

select * from finish();
rollback;
