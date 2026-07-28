begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select has_column('public', 'dashboard_audit_logs', 'class_id');
select has_column('public', 'dashboard_audit_logs', 'request_key');
select has_column('public', 'dashboard_audit_logs', 'request_operation');
select has_column('public', 'dashboard_audit_logs', 'change_reason');

select ok(
  not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'dashboard_audit_logs'
      and policyname = 'dashboard_audit_logs_authenticated_insert'
  ),
  'dashboard_audit_logs_authenticated_insert policy is removed'
);
select ok(
  not has_table_privilege('authenticated', 'public.dashboard_audit_logs', 'INSERT'),
  'authenticated cannot directly insert audit rows'
);

select has_table('dashboard_private', 'continuous_class_schedule_runtime');
select has_table('dashboard_private', 'class_schedule_cutovers');
select is(
  public.continuous_class_schedule_runtime_version(),
  0,
  'runtime remains inactive until the separate activation migration'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'dashboard_private.continuous_class_schedule_runtime',
    'SELECT'
  ),
  'authenticated cannot read the private runtime row'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'dashboard_private.class_schedule_cutovers',
    'SELECT'
  ),
  'authenticated cannot read cutover receipts'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'continuous_class_schedule_slots_direct_write_guard'
      and not tgisinternal
  ),
  'slot direct-write guard trigger exists'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'continuous_class_lesson_sessions_direct_write_guard'
      and not tgisinternal
  ),
  'session direct-write guard trigger exists'
);
select has_function(
  'public',
  'continuous_class_schedule_direct_write_guard',
  array[]::text[]
);
select throws_ok(
  $$insert into public.class_schedule_slots (
      class_id, weekday, start_time, end_time, sort_order
    ) values (
      '10000000-0000-4000-8000-000000000001', 2, '14:00', '15:30', 0
    )$$,
  '42501',
  'continuous class schedule direct write is not allowed',
  'direct writes to normalized class schedule tables are rejected'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.continuous_class_schedule_runtime_version()',
    'EXECUTE'
  ),
  'authenticated can read the runtime marker through its function'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'dashboard_private.class_schedule_mutation_receipts',
    'SELECT'
  ),
  'existing mutation receipts remain private'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_index
    where indexrelid = 'public.dashboard_audit_logs_class_id_created_at_idx'::regclass
  ),
  'class-scoped audit history index exists'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'continuous_class_schedule_runtime_version_check'
  ),
  'runtime version is constrained'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'continuous_class_schedule_runtime_singleton_check'
  ),
  'runtime table keeps one singleton row'
);

select has_function('public', 'get_class_schedule_defaults_v1', array['uuid']::text[]);
select has_function('public', 'get_class_schedule_v1', array['uuid', 'date', 'date']::text[]);
select has_function('public', 'initialize_new_class_schedule_v1', array['uuid', 'bigint', 'text', 'jsonb', 'uuid']::text[]);
select has_function('public', 'save_class_schedule_defaults_v1', array['uuid', 'bigint', 'jsonb', 'uuid', 'text']::text[]);
select has_function('public', 'preview_class_lesson_session_generation_v1', array['uuid', 'bigint', 'date', 'date']::text[]);
select has_function('public', 'generate_class_lesson_sessions_v1', array['uuid', 'bigint', 'date', 'date', 'uuid', 'text']::text[]);
select has_function('public', 'save_class_lesson_session_v1', array['uuid', 'bigint', 'text', 'date', 'time', 'time', 'uuid', 'uuid', 'text', 'text', 'text', 'uuid', 'text']::text[]);
select has_function('public', 'save_class_lesson_content_v1', array['uuid', 'text', 'jsonb', 'uuid']::text[]);
select has_function('public', 'backfill_class_schedule_shadow_v1', array['uuid', 'text', 'jsonb', 'jsonb', 'uuid']::text[]);
select has_function('public', 'verify_class_schedule_shadow_v1', array['uuid', 'text']::text[]);
select has_function('public', 'activate_class_schedule_storage_v1', array['uuid', 'bigint', 'text', 'uuid']::text[]);
select has_function('public', 'deactivate_class_schedule_storage_v1', array['uuid', 'uuid', 'text']::text[]);

select * from finish();
rollback;
