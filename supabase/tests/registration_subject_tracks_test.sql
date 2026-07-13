begin;
select plan(12);

select has_table('public', 'ops_registration_subject_tracks');
select has_table('public', 'ops_registration_appointments');
select has_table('public', 'ops_registration_level_tests');
select has_table('public', 'ops_registration_consultations');
select has_table('public', 'ops_registration_admission_batches');
select has_table('public', 'ops_registration_enrollments');
select has_table('dashboard_private', 'ops_registration_mutations');
select has_function(
  'public',
  'complete_registration_consultation',
  array['uuid', 'text', 'text', 'uuid', 'text']
);
select has_function(
  'public',
  'complete_registration_admission_batch',
  array['uuid', 'text']
);
select function_privs_are(
  'public',
  'complete_registration_consultation',
  array['uuid', 'text', 'text', 'uuid', 'text'],
  'authenticated',
  array['EXECUTE']
);
select is_empty($$
  select 1
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'complete_registration_consultation'
    and grantee in ('PUBLIC', 'anon')
    and privilege_type = 'EXECUTE'
$$);
select is_empty($$
  select 1
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'ops_registration_subject_tracks',
      'ops_registration_appointments',
      'ops_registration_level_tests',
      'ops_registration_consultations',
      'ops_registration_admission_batches',
      'ops_registration_enrollments'
    )
    and grantee = 'authenticated'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
$$);

select * from finish();
rollback;
