begin;
select plan(4);

select has_schema('supabase_migrations', 'baseline restores migration ledger schema');
select has_table('public', 'profiles', 'baseline restores the scoped profiles relation');
select is(
  (select count(*) from public.class_schedule_sync_groups),
  1::bigint,
  'isolated baseline contains exactly one synthetic class period prerequisite'
);
select ok(
  exists (
    select 1
    from public.class_schedule_sync_groups
    where id = '00000000-0000-4000-8000-000000000001'::uuid
      and name = 'Isolated schema contract default period'
      and sort_order = 0
      and is_default
  ),
  'isolated baseline prerequisite uses the fixed non-production values'
);

select * from finish();
rollback;
