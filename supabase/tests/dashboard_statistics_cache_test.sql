begin;
select no_plan();

set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table cache_test_state (
  label text primary key,
  value jsonb not null
) on commit drop;
grant all on table pg_temp.cache_test_state to service_role;

select has_table(
  'dashboard_private',
  'dashboard_statistics_cache',
  'private aggregate statistics cache exists'
);
select ok(
  (
    select relation_row.relrowsecurity and relation_row.relforcerowsecurity
    from pg_catalog.pg_class relation_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'dashboard_private'
      and relation_row.relname = 'dashboard_statistics_cache'
  ),
  'private cache forces RLS defense in depth'
);

with signatures(signature) as (
  values
    ('public.read_dashboard_statistics_cache_v1(uuid,text,text,text)'::text),
    ('public.claim_dashboard_statistics_cache_v1(uuid,text,text,text,text,boolean)'::text),
    ('public.finalize_dashboard_statistics_cache_v1(uuid,text,text,text,bigint,uuid,jsonb)'::text),
    ('public.invalidate_dashboard_statistics_cache_v1(uuid,text,text,text,bigint)'::text)
)
select ok(
  pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
      ) acl
      where function_row.oid = signature::pg_catalog.regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ),
  signature || ' is service-role-only'
)
from signatures;

with signatures(signature) as (
  values
    ('public.read_dashboard_statistics_cache_v1(uuid,text,text,text)'::text),
    ('public.claim_dashboard_statistics_cache_v1(uuid,text,text,text,text,boolean)'::text),
    ('public.finalize_dashboard_statistics_cache_v1(uuid,text,text,text,bigint,uuid,jsonb)'::text),
    ('public.invalidate_dashboard_statistics_cache_v1(uuid,text,text,text,bigint)'::text)
)
select ok(
  (
    select function_row.prosecdef
      and function_row.proconfig = array['search_path=']::text[]
    from pg_catalog.pg_proc function_row
    where function_row.oid = signature::pg_catalog.regprocedure
  ),
  signature || ' is a fixed-empty-search-path definer wrapper'
)
from signatures;

set local role authenticated;
select throws_ok(
  $$
    select public.read_dashboard_statistics_cache_v1(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'admin', repeat('a', 64), 'dashboard-statistics-v1'
    )
  $$,
  '42501',
  'permission denied for function read_dashboard_statistics_cache_v1',
  'authenticated cannot call private cache wrappers'
);
reset role;

set local role service_role;
insert into pg_temp.cache_test_state(label, value)
select 'first_claim', public.claim_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('a', 64), 'dashboard-statistics-v1', 'overview', false
);
select is(
  (select value ->> 'status' from pg_temp.cache_test_state where label = 'first_claim'),
  'acquired',
  'first aggregate request acquires the claim'
);
insert into pg_temp.cache_test_state(label, value)
select 'concurrent_claim', public.claim_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('a', 64), 'dashboard-statistics-v1', 'overview', false
);
select is(
  (select value ->> 'status' from pg_temp.cache_test_state where label = 'concurrent_claim'),
  'wait',
  'concurrent claim dedupe'
);

insert into pg_temp.cache_test_state(label, value)
select 'stored', public.finalize_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('a', 64), 'dashboard-statistics-v1',
  (select (value ->> 'generation')::bigint from pg_temp.cache_test_state where label = 'first_claim'),
  (select (value ->> 'claim_token')::uuid from pg_temp.cache_test_state where label = 'first_claim'),
  '{"summary":{"activeClassesCount":1}}'::jsonb
);
select is(
  (select value ->> 'status' from pg_temp.cache_test_state where label = 'stored'),
  'stored',
  'the claim owner stores one aggregate payload'
);
insert into pg_temp.cache_test_state(label, value)
select 'ready', public.read_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('a', 64), 'dashboard-statistics-v1'
);
select is(
  (select value ->> 'status' from pg_temp.cache_test_state where label = 'ready'),
  'ready',
  'the same actor reads the shared ready value'
);
reset role;

select is(
  (
    select expires_at - generated_at
    from dashboard_private.dashboard_statistics_cache
    where actor_profile_id = '00000000-0000-4000-8000-000000000001'::uuid
      and role = 'admin'
      and request_hash = repeat('a', 64)
  ),
  interval '10 minutes',
  'stored aggregates have an exact ten minute TTL'
);

update dashboard_private.dashboard_statistics_cache
set generated_at = pg_catalog.clock_timestamp() - interval '1 millisecond',
    expires_at = pg_catalog.clock_timestamp() + interval '599999 milliseconds'
where actor_profile_id = '00000000-0000-4000-8000-000000000001'::uuid
  and role = 'admin'
  and request_hash = repeat('a', 64);
set local role service_role;
select is(
  public.read_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'admin', repeat('a', 64), 'dashboard-statistics-v1'
  ) ->> 'status',
  'ready',
  '599999ms remains ready'
);
reset role;

update dashboard_private.dashboard_statistics_cache
set generated_at = pg_catalog.clock_timestamp() - interval '600001 milliseconds',
    expires_at = pg_catalog.clock_timestamp() - interval '1 millisecond'
where actor_profile_id = '00000000-0000-4000-8000-000000000001'::uuid
  and role = 'admin'
  and request_hash = repeat('a', 64);
set local role service_role;
select is(
  public.read_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'admin', repeat('a', 64), 'dashboard-statistics-v1'
  ) ->> 'status',
  'miss',
  '600001ms is a miss'
);

insert into pg_temp.cache_test_state(label, value)
select 'force_claim', public.claim_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('a', 64), 'dashboard-statistics-v1', 'overview', true
);
select is(
  (select value ->> 'status' from pg_temp.cache_test_state where label = 'force_claim'),
  'acquired',
  'force refresh acquires the exact actor request key'
);
select is(
  (select (value ->> 'generation')::bigint from pg_temp.cache_test_state where label = 'force_claim'),
  2::bigint,
  'force refresh increments generation'
);
select is(
  public.finalize_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'admin', repeat('a', 64), 'dashboard-statistics-v1',
    (select (value ->> 'generation')::bigint from pg_temp.cache_test_state where label = 'first_claim'),
    (select (value ->> 'claim_token')::uuid from pg_temp.cache_test_state where label = 'first_claim'),
    '{"summary":{}}'::jsonb
  ) ->> 'status',
  'superseded',
  'force refresh supersedes the old claim owner'
);

insert into pg_temp.cache_test_state(label, value)
select 'failed_claim', public.claim_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('b', 64), 'dashboard-statistics-v1', 'students_classes', false
);
reset role;
select ok(
  (
    select status = 'computing' and payload is null and generated_at is null
    from dashboard_private.dashboard_statistics_cache
    where actor_profile_id = '00000000-0000-4000-8000-000000000001'::uuid
      and role = 'admin'
      and request_hash = repeat('b', 64)
  ),
  'failed payload is not stored'
);
update dashboard_private.dashboard_statistics_cache
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 millisecond'
where actor_profile_id = '00000000-0000-4000-8000-000000000001'::uuid
  and role = 'admin'
  and request_hash = repeat('b', 64);
set local role service_role;
select is(
  public.claim_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'admin', repeat('b', 64), 'dashboard-statistics-v1', 'students_classes', false
  ) ->> 'status',
  'acquired',
  'an expired fifteen second lease can be taken over'
);

select is(
  public.claim_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000002'::uuid,
    'admin', repeat('a', 64), 'dashboard-statistics-v1', 'overview', false
  ) ->> 'status',
  'acquired',
  'a second actor has an isolated cache row'
);
select is(
  public.claim_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'staff', repeat('a', 64), 'dashboard-statistics-v1', 'overview', false
  ) ->> 'status',
  'acquired',
  'a second role has an isolated cache row'
);
select is(
  public.claim_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'admin', repeat('c', 64), 'dashboard-statistics-v1', 'schedule_conflicts', false
  ) ->> 'status',
  'acquired',
  'actor role tab filter isolation'
);

insert into pg_temp.cache_test_state(label, value)
select 'invalidated', public.invalidate_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'admin', repeat('b', 64), 'dashboard-statistics-v1', 2
);
select is(
  (select value ->> 'status' from pg_temp.cache_test_state where label = 'invalidated'),
  'invalidated',
  'exact-key invalidation advances the owner generation'
);
select is(
  public.finalize_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000001'::uuid,
    'admin', repeat('b', 64), 'dashboard-statistics-v1',
    2,
    (select (value ->> 'claim_token')::uuid from pg_temp.cache_test_state where label = 'failed_claim'),
    '{"summary":{}}'::jsonb
  ) ->> 'status',
  'superseded',
  'invalidation supersedes slow finalize'
);
reset role;

insert into dashboard_private.dashboard_statistics_cache (
  actor_profile_id, role, contract_version, request_hash, tab, generation,
  status, generated_at, expires_at, payload
)
select
  '00000000-0000-4000-8000-000000000003'::uuid,
  'admin',
  'dashboard-statistics-v1',
  repeat(pg_catalog.md5(series.value::text), 2),
  'overview',
  1,
  'ready',
  pg_catalog.clock_timestamp() - interval '26 hours',
  pg_catalog.clock_timestamp() - interval '25 hours',
  '{"summary":{}}'::jsonb
from pg_catalog.generate_series(1, 25) as series(value);

insert into dashboard_private.dashboard_statistics_cache (
  actor_profile_id, role, contract_version, request_hash, tab, generation,
  status, generated_at, expires_at, payload
)
select
  '00000000-0000-4000-8000-000000000004'::uuid,
  'admin',
  'dashboard-statistics-v1',
  repeat(pg_catalog.md5(series.value::text), 2),
  'overview',
  1,
  'ready',
  pg_catalog.clock_timestamp() - interval '26 hours',
  pg_catalog.clock_timestamp() - interval '25 hours',
  '{"summary":{}}'::jsonb
from pg_catalog.generate_series(1, 3) as series(value);

set local role service_role;
select is(
  public.claim_dashboard_statistics_cache_v1(
    '00000000-0000-4000-8000-000000000003'::uuid,
    'admin', repeat('f', 64), 'dashboard-statistics-v1', 'overview', false
  ) ->> 'status',
  'acquired',
  'cleanup claim still acquires its requested key'
);
reset role;
select is(
  (
    select pg_catalog.count(*)::integer
    from dashboard_private.dashboard_statistics_cache
    where actor_profile_id = '00000000-0000-4000-8000-000000000003'::uuid
      and expires_at < pg_catalog.clock_timestamp() - interval '24 hours'
  ),
  5,
  'cleanup removes exactly 20 own expired rows'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from dashboard_private.dashboard_statistics_cache
    where actor_profile_id = '00000000-0000-4000-8000-000000000004'::uuid
  ),
  3,
  'cleanup never removes another actor row'
);

set local role service_role;
insert into pg_temp.cache_test_state(label, value)
select 'payload_claim', public.claim_dashboard_statistics_cache_v1(
  '00000000-0000-4000-8000-000000000005'::uuid,
  'admin', repeat('e', 64), 'dashboard-statistics-v1', 'overview', false
);
select throws_ok(
  format(
    $$select public.finalize_dashboard_statistics_cache_v1(
      '00000000-0000-4000-8000-000000000005'::uuid,
      'admin', repeat('e', 64), 'dashboard-statistics-v1', %s, %L::uuid,
      '{"students":[{"id":"raw"}]}'::jsonb
    )$$,
    (select (value ->> 'generation')::bigint from pg_temp.cache_test_state where label = 'payload_claim'),
    (select value ->> 'claim_token' from pg_temp.cache_test_state where label = 'payload_claim')
  ),
  '22023',
  'dashboard_statistics_cache_payload_invalid',
  'raw source rows cannot be finalized into the aggregate cache'
);
reset role;
select ok(
  (
    select payload is null and status = 'computing'
    from dashboard_private.dashboard_statistics_cache
    where actor_profile_id = '00000000-0000-4000-8000-000000000005'::uuid
      and request_hash = repeat('e', 64)
  ),
  'rejected raw source payload is never stored'
);

select * from finish();
rollback;
