begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_column('public', 'classes', 'schedule_revision');
select has_column('public', 'classes', 'schedule_storage_mode');
select has_column('public', 'classes', 'closed_at');
select has_column('public', 'classes', 'closed_by');

select has_table('public', 'class_schedule_slots');
select has_table('public', 'class_lesson_sessions');
select has_table('dashboard_private', 'class_schedule_mutation_receipts');

select is(
  public.continuous_class_schedule_runtime_version(),
  0,
  'foundation runtime remains inactive'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.continuous_class_schedule_runtime_version()',
    'EXECUTE'
  ),
  'authenticated can read the runtime marker'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.class_schedule_slots'::regclass),
  'class schedule slots enable row level security'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.class_lesson_sessions'::regclass),
  'class lesson sessions enable row level security'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'dashboard_private.class_schedule_mutation_receipts',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'dashboard_private.class_schedule_mutation_receipts',
    'INSERT'
  ),
  'authenticated cannot read or write mutation receipts'
);

select ok(
  has_table_privilege('authenticated', 'public.class_schedule_slots', 'SELECT')
  and not has_table_privilege('anon', 'public.class_schedule_slots', 'SELECT'),
  'only authenticated can select schedule slots'
);
select ok(
  has_table_privilege('authenticated', 'public.class_lesson_sessions', 'SELECT')
  and not has_table_privilege('anon', 'public.class_lesson_sessions', 'SELECT'),
  'only authenticated can select lesson sessions'
);
select ok(
  not has_table_privilege('authenticated', 'public.class_schedule_slots', 'INSERT')
  and not has_table_privilege('authenticated', 'public.class_schedule_slots', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.class_schedule_slots', 'DELETE'),
  'authenticated cannot mutate schedule slots'
);
select ok(
  not has_table_privilege('authenticated', 'public.class_lesson_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.class_lesson_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.class_lesson_sessions', 'DELETE'),
  'authenticated cannot mutate lesson sessions'
);

select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'class_schedule_slots'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'schedule slots have no write policy'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'class_lesson_sessions'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'lesson sessions have no write policy'
);

select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'classes_schedule_storage_mode_check'),
  'class storage mode is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'classes_schedule_revision_nonnegative'),
  'class schedule revision is nonnegative'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_schedule_slots_weekday_check'),
  'slot weekday is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_schedule_slots_time_order_check'),
  'slot time order is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_lesson_sessions_state_check'),
  'lesson state is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_lesson_sessions_origin_check'),
  'lesson origin is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_lesson_sessions_time_pair_check'),
  'lesson time pair is constrained'
);

select ok(
  to_regclass('public.class_lesson_sessions_class_key') is not null,
  'class and session key are unique'
);
select ok(
  to_regclass('public.class_lesson_sessions_default_source_key') is not null,
  'default-source duplicate index exists'
);
select ok(
  to_regclass('public.class_lesson_sessions_class_date_idx') is not null,
  'class date index exists'
);
select ok(
  to_regclass('public.class_lesson_sessions_class_state_date_idx') is not null,
  'class state date index exists'
);

select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'dashboard_audit_class_schedule_slots'
            and not tgisinternal),
  'slot audit trigger exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'dashboard_audit_class_lesson_sessions'
            and not tgisinternal),
  'lesson audit trigger exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'set_updated_at_class_schedule_slots'
            and not tgisinternal),
  'slot updated-at trigger exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'set_updated_at_class_lesson_sessions'
            and not tgisinternal),
  'lesson updated-at trigger exists'
);

select * from finish();
rollback;
