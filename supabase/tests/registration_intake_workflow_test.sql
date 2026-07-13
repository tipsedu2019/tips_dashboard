begin;
select plan(17);

select ok(exists (
  select 1
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'ops_registration_consultations'
    and attribute.attname = 'ready_at'
    and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp with time zone'
    and not attribute.attisdropped
), 'phone readiness timestamp column has the canonical type');

select ok(exists (
  select 1
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'ops_registration_consultations'
    and attribute.attname = 'ready_source'
    and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text'
    and not attribute.attisdropped
), 'phone readiness source column has the canonical type');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.ops_registration_consultations'::regclass
    and constraint_row.conname = 'ops_registration_consultations_ready_source_check'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%inquiry%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%level_test_completion%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%visit_reopened%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%director_resolved%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%track_reopened%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%migration%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%legacy%'
), 'ready source is constrained to canonical values');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.ops_registration_consultations'::regclass
    and constraint_row.conname = 'ops_registration_consultations_mode_readiness_check'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%mode%phone%ready_at%ready_source%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%mode%visit%ready_at%ready_source%'
), 'consultation mode and readiness are coupled');

select ok(exists (
  select 1
  from pg_catalog.pg_class relation
  where relation.oid = 'public.ops_registration_subject_track_summaries'::regclass
    and coalesce(relation.reloptions, array[]::text[]) @> array['security_invoker=true']
), 'track summary view remains security invoker');

select ok(exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ops_registration_subject_track_summaries'
    and column_name = 'phone_ready_at'
), 'track summary projects phone ready timestamp');

select ok(exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ops_registration_subject_track_summaries'
    and column_name = 'phone_ready_source'
), 'track summary projects phone ready source');

select ok(exists (
  select 1
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
  where index_relation.relname = 'ops_registration_consultations_phone_waiting_ready_idx'
    and pg_catalog.pg_get_indexdef(index_row.indexrelid) like '%(ready_at, track_id)%'
    and pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
      like '%mode = ''phone''%status = ''waiting''%'
), 'phone waiting queue has the partial readiness index');

select has_function(
  'dashboard_private',
  'create_registration_case_with_initial_workflow_v1_impl',
  array[
    'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text[]',
    'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'jsonb', 'text'
  ]
);

select has_function(
  'public',
  'create_registration_case_with_initial_workflow_v1',
  array[
    'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text[]',
    'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'jsonb', 'text'
  ]
);

select function_privs_are(
  'dashboard_private',
  'create_registration_case_with_initial_workflow_v1_impl',
  array[
    'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text[]',
    'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'jsonb', 'text'
  ],
  'authenticated',
  array['EXECUTE']
);

select function_privs_are(
  'public',
  'create_registration_case_with_initial_workflow_v1',
  array[
    'text', 'text', 'text', 'text', 'text', 'text', 'timestamptz', 'text[]',
    'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'jsonb', 'text'
  ],
  'authenticated',
  array['EXECUTE']
);

select is_empty($$
  select 1
  from information_schema.routine_privileges
  where routine_schema in ('dashboard_private', 'public')
    and routine_name in (
      'create_registration_case_with_initial_workflow_v1_impl',
      'create_registration_case_with_initial_workflow_v1'
    )
    and grantee in ('PUBLIC', 'anon')
    and privilege_type = 'EXECUTE'
$$);

select has_function(
  'public',
  'registration_intake_workflow_runtime_version',
  array[]::text[]
);

select is(
  public.registration_intake_workflow_runtime_version(),
  1,
  'intake workflow runtime capability is version 1'
);

select is(
  public.registration_subject_tracks_runtime_version(),
  1,
  'core subject-track runtime capability remains version 1'
);

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
    and grantee in ('PUBLIC', 'anon')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
$$);

select * from finish();
rollback;
