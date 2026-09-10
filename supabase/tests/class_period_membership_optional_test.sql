begin;

select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';
set local role postgres;

select has_function(
  'public',
  'create_class_with_group_memberships_v1',
  array['jsonb', 'uuid[]'],
  'class create RPC keeps its public signature'
);

select has_function(
  'public',
  'replace_class_group_memberships_v1',
  array['uuid', 'uuid[]'],
  'class membership replacement RPC keeps its public signature'
);

select ok(
  (
    select
      not procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and language.lanname = 'plpgsql'
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (array['search_path=', 'search_path=""']::text[])
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
    where procedure.oid = 'public.create_class_with_group_memberships_v1(jsonb,uuid[])'::pg_catalog.regprocedure
  ),
  'class create RPC remains postgres-owned PL/pgSQL SECURITY INVOKER with an empty search path'
);

select ok(
  (
    select
      not procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and language.lanname = 'plpgsql'
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (array['search_path=', 'search_path=""']::text[])
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
    where procedure.oid = 'public.replace_class_group_memberships_v1(uuid,uuid[])'::pg_catalog.regprocedure
  ),
  'class membership replacement RPC remains postgres-owned PL/pgSQL SECURITY INVOKER with an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_class_with_group_memberships_v1(jsonb,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'public.create_class_with_group_memberships_v1(jsonb,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.create_class_with_group_memberships_v1(jsonb,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.create_class_with_group_memberships_v1(jsonb,uuid[])',
    'EXECUTE'
  ),
  'class create RPC ACL remains authenticated-only'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.replace_class_group_memberships_v1(uuid,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'public.replace_class_group_memberships_v1(uuid,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.replace_class_group_memberships_v1(uuid,uuid[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.replace_class_group_memberships_v1(uuid,uuid[])',
    'EXECUTE'
  ),
  'class membership replacement RPC ACL remains authenticated-only'
);

select hasnt_trigger(
  'public',
  'classes',
  'class_active_group_membership_required_on_classes',
  'active classes no longer require a period membership trigger'
);

select hasnt_trigger(
  'public',
  'class_schedule_sync_group_members',
  'class_active_group_membership_required_on_members',
  'membership removal no longer invokes the active-class period trigger'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'classes'
  )
  and (
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'class_schedule_sync_groups'
  )
  and (
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'class_schedule_sync_group_members'
  ),
  'class and period tables retain RLS'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.create_class_with_group_memberships_v1(jsonb,uuid[])'::pg_catalog.regprocedure
    ),
    'class_group_required'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.replace_class_group_memberships_v1(uuid,uuid[])'::pg_catalog.regprocedure
    ),
    'class_group_required'
  ) = 0,
  'the retired non-empty period guard is absent from both final RPC definitions'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.replace_class_group_memberships_v1(uuid,uuid[])'::pg_catalog.regprocedure
    )),
    'for update'
  ) > 0,
  'membership replacement retains its class row lock'
);

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '8d000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'optional-period-admin@runtime.invalid',
    crypt('optional-period-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"class-period-membership-optional"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    '8d000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'optional-period-teacher@runtime.invalid',
    crypt('optional-period-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"class-period-membership-optional"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '8d000000-0000-4000-8000-000000000001',
    'admin',
    '기간 선택 없는 수업 관리자',
    'optional-period-admin@runtime.invalid',
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    '8d000000-0000-4000-8000-000000000002',
    'teacher',
    '기간 선택 없는 수업 교사',
    'optional-period-teacher@runtime.invalid',
    pg_catalog.now(),
    pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.class_schedule_sync_groups(id, name, subject, sort_order, is_default)
values
  ('8d000000-0000-4000-8000-000000000101', '보존 기간 A', '영어', 1, false),
  ('8d000000-0000-4000-8000-000000000102', '보존 기간 B', '영어', 2, false);

create or replace function pg_temp.class_period_set_actor(p_actor_id uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor_id::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor_id
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
select pg_temp.class_period_set_actor('8d000000-0000-4000-8000-000000000001');

select lives_ok(
  $$
    select public.create_class_with_group_memberships_v1(
      '{"id":"8d000000-0000-4000-8000-000000000201","name":"기간 없는 신규 수업","status":"수강"}'::jsonb,
      '{}'::uuid[]
    )
  $$,
  'admin can create an active class with an empty period membership array'
);

select is(
  (select class_row.status from public.classes class_row where class_row.id = '8d000000-0000-4000-8000-000000000201'),
  '수강',
  'the period-free class keeps the requested active lifecycle state'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from public.class_schedule_sync_group_members member
    where member.class_id = '8d000000-0000-4000-8000-000000000201'
  ),
  0::bigint,
  'empty period input creates no synthetic membership row'
);

select lives_ok(
  $$
    select public.create_class_with_group_memberships_v1(
      '{"id":"8d000000-0000-4000-8000-000000000202","name":"기존 기간 보존 수업","status":"수강"}'::jsonb,
      array['8d000000-0000-4000-8000-000000000101'::uuid]
    )
  $$,
  'existing explicit period memberships remain supported'
);

select lives_ok(
  $$
    select public.create_class_with_group_memberships_v1(
      '{"id":"8d000000-0000-4000-8000-000000000203","name":"정규화된 기간 수업","status":"수강"}'::jsonb,
      array[
        '8d000000-0000-4000-8000-000000000102'::uuid,
        '8d000000-0000-4000-8000-000000000102'::uuid,
        null,
        '8d000000-0000-4000-8000-000000000101'::uuid
      ]
    )
  $$,
  'valid memberships still de-duplicate and ignore null group IDs'
);

select results_eq(
  $$
    select member.group_id, member.sort_order
    from public.class_schedule_sync_group_members member
    where member.class_id = '8d000000-0000-4000-8000-000000000203'
    order by member.sort_order
  $$,
  $$
    values
      ('8d000000-0000-4000-8000-000000000102'::uuid, 0),
      ('8d000000-0000-4000-8000-000000000101'::uuid, 1)
  $$,
  'membership normalization and caller order are preserved'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from public.class_schedule_sync_group_members member
    where member.class_id = '8d000000-0000-4000-8000-000000000202'
  ),
  1::bigint,
  'creating a period-free class does not alter an existing membership'
);

select throws_ok(
  $$
    select public.create_class_with_group_memberships_v1(
      '{"id":"8d000000-0000-4000-8000-000000000204","name":"잘못된 기간 신규 수업","status":"수강"}'::jsonb,
      array['8d000000-0000-4000-8000-000000000199'::uuid]
    )
  $$,
  '23503',
  'class_group_not_found',
  'create rejects an unknown non-empty period ID with the existing SQLSTATE'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from public.classes class_row
    where class_row.id = '8d000000-0000-4000-8000-000000000204'
  ),
  0::bigint,
  'unknown period rejection leaves no partial class row'
);

select throws_ok(
  $$
    select public.replace_class_group_memberships_v1(
      '8d000000-0000-4000-8000-000000000202',
      array['8d000000-0000-4000-8000-000000000199'::uuid]
    )
  $$,
  '23503',
  'class_group_not_found',
  'replacement rejects an unknown non-empty period ID with the existing SQLSTATE'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from public.class_schedule_sync_group_members member
    where member.class_id = '8d000000-0000-4000-8000-000000000202'
      and member.group_id = '8d000000-0000-4000-8000-000000000101'
  ),
  1::bigint,
  'failed replacement preserves the existing membership atomically'
);

select lives_ok(
  $$
    select public.replace_class_group_memberships_v1(
      '8d000000-0000-4000-8000-000000000202',
      '{}'::uuid[]
    )
  $$,
  'admin can explicitly clear every period membership from an active class'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from public.class_schedule_sync_group_members member
    where member.class_id = '8d000000-0000-4000-8000-000000000202'
  ),
  0::bigint,
  'empty replacement leaves the active class without a period membership'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from public.class_schedule_sync_groups class_group
    where class_group.id in (
      '8d000000-0000-4000-8000-000000000101',
      '8d000000-0000-4000-8000-000000000102'
    )
  ),
  2::bigint,
  'clearing memberships never deletes the existing period catalog rows'
);

select pg_temp.class_period_set_actor('8d000000-0000-4000-8000-000000000002');

select throws_ok(
  $$
    select public.create_class_with_group_memberships_v1(
      '{"id":"8d000000-0000-4000-8000-000000000205","name":"권한 없는 신규 수업","status":"수강"}'::jsonb,
      '{}'::uuid[]
    )
  $$,
  '42501',
  'class_create_access_denied',
  'teacher cannot create a class even when period membership is optional'
);

select throws_ok(
  $$
    select public.replace_class_group_memberships_v1(
      '8d000000-0000-4000-8000-000000000203',
      '{}'::uuid[]
    )
  $$,
  '42501',
  'class_group_update_access_denied',
  'teacher cannot clear class period memberships'
);

set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

select throws_ok(
  $$
    select public.create_class_with_group_memberships_v1(
      '{"id":"8d000000-0000-4000-8000-000000000206","name":"익명 신규 수업","status":"수강"}'::jsonb,
      '{}'::uuid[]
    )
  $$,
  '42501',
  null,
  'anonymous execution remains revoked'
);

reset role;

select * from finish();

rollback;
