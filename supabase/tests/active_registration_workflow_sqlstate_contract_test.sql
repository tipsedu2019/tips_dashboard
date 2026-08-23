begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;

create or replace function pg_temp.registration_workflow_function_boundary_is_exact(
  p_function pg_catalog.regprocedure
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    and pg_catalog.cardinality(procedure.proconfig) = 1
    and procedure.proconfig[1] = any (array['search_path=', 'search_path=""'])
    and not pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    and (
      select
        pg_catalog.count(*) = 2
        and pg_catalog.count(*) filter (
          where (
            case
              when acl.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl.grantee)::text
            end
          ) in ('postgres', 'authenticated')
          and pg_catalog.pg_get_userbyid(acl.grantor)::text = 'postgres'
          and acl.privilege_type = 'EXECUTE'
          and not acl.is_grantable
        ) = 2
      from pg_catalog.aclexplode(
        coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) acl
    )
  from pg_catalog.pg_proc procedure
  where procedure.oid = p_function;
$$;

select plan(19);

select ok(
  pg_catalog.to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)') is not null,
  'public registration workflow status wrapper exists with its exact signature'
);

select ok(
  pg_catalog.to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)') is not null,
  'private registration workflow status implementation exists with its exact signature'
);

select like(
  pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')),
  '%dashboard_private.set_registration_workflow_status_v1_impl%',
  'public wrapper delegates to the private implementation'
);

select is(
  (
    select not procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')
  ),
  true,
  'public wrapper remains security invoker'
);

select is(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')
  ),
  true,
  'private implementation remains security definer'
);

select is(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')
  ),
  'postgres',
  'public wrapper remains owned by postgres'
);

select is(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner)
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')
  ),
  'postgres',
  'private implementation remains owned by postgres'
);

select ok(
  (
    select
      pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (array['search_path=', 'search_path=""'])
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')
  ),
  'public wrapper has exactly one empty search_path setting'
);

select ok(
  (
    select
      pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (array['search_path=', 'search_path=""'])
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')
  ),
  'private implementation has exactly one empty search_path setting'
);

select results_eq(
  $$
    select
      case
        when acl.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(acl.grantee)::text
      end as grantee,
      pg_catalog.pg_get_userbyid(acl.grantor)::text as grantor,
      acl.privilege_type,
      acl.is_grantable
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) acl
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.set_registration_workflow_status_v1(uuid,text,integer,text)'
    )
    order by grantee, grantor, acl.privilege_type, acl.is_grantable
  $$,
  $$
    values
      ('authenticated'::text, 'postgres'::text, 'EXECUTE'::text, false),
      ('postgres'::text, 'postgres'::text, 'EXECUTE'::text, false)
  $$,
  'public wrapper has only direct non-grantable postgres and authenticated EXECUTE ACL rows'
);

select results_eq(
  $$
    select
      case
        when acl.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(acl.grantee)::text
      end as grantee,
      pg_catalog.pg_get_userbyid(acl.grantor)::text as grantor,
      acl.privilege_type,
      acl.is_grantable
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) acl
    where procedure.oid = pg_catalog.to_regprocedure(
      'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'
    )
    order by grantee, grantor, acl.privilege_type, acl.is_grantable
  $$,
  $$
    values
      ('authenticated'::text, 'postgres'::text, 'EXECUTE'::text, false),
      ('postgres'::text, 'postgres'::text, 'EXECUTE'::text, false)
  $$,
  'private implementation has only direct non-grantable postgres and authenticated EXECUTE ACL rows'
);

select results_eq(
  $$
    select boundary.function_name, boundary.role_name, pg_catalog.has_function_privilege(
      boundary.role_name::pg_catalog.name,
      pg_catalog.to_regprocedure(boundary.function_name),
      'EXECUTE'
    ) as can_execute
    from (
      values
        (1, 'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, 'public'::text),
        (2, 'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, 'anon'::text),
        (3, 'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, 'service_role'::text),
        (4, 'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, 'public'::text),
        (5, 'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, 'anon'::text),
        (6, 'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, 'service_role'::text)
    ) boundary(ordering, function_name, role_name)
    order by boundary.ordering
  $$,
  $$
    values
      ('public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, 'public'::text, false),
      ('public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, 'anon'::text, false),
      ('public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, 'service_role'::text, false),
      ('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, 'public'::text, false),
      ('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, 'anon'::text, false),
      ('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, 'service_role'::text, false)
  $$,
  'PUBLIC, anon, and service_role cannot execute either registration workflow function'
);

select unlike(
  pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.set_registration_workflow_status_v1(uuid,text,integer,text)')),
  '40001',
  'public wrapper does not manually raise SQLSTATE 40001'
);

select unlike(
  pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')),
  '40001',
  'private implementation does not manually raise SQLSTATE 40001'
);

select like(
  pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)')),
  '%registration_workflow_status_refresh_required%23514%',
  'private implementation maps stale revisions to registration_workflow_status_refresh_required with 23514'
);

savepoint public_execute_grant_mutation;
grant execute on function public.set_registration_workflow_status_v1(uuid, text, integer, text) to public;
select is(
  pg_temp.registration_workflow_function_boundary_is_exact(
    'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::pg_catalog.regprocedure
  ),
  false,
  'exact function boundary rejects public execute grant'
);
rollback to savepoint public_execute_grant_mutation;

savepoint anon_execute_grant_mutation;
grant execute on function public.set_registration_workflow_status_v1(uuid, text, integer, text) to anon;
select is(
  pg_temp.registration_workflow_function_boundary_is_exact(
    'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::pg_catalog.regprocedure
  ),
  false,
  'exact function boundary rejects anon execute grant'
);
rollback to savepoint anon_execute_grant_mutation;

savepoint wrapper_owner_mutation;
grant create on schema public to authenticated;
alter function public.set_registration_workflow_status_v1(uuid, text, integer, text)
  owner to authenticated;
select is(
  pg_temp.registration_workflow_function_boundary_is_exact(
    'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::pg_catalog.regprocedure
  ),
  false,
  'exact function boundary rejects wrapper owner drift'
);
rollback to savepoint wrapper_owner_mutation;

savepoint wrapper_search_path_mutation;
alter function public.set_registration_workflow_status_v1(uuid, text, integer, text)
  set search_path = public;
select is(
  pg_temp.registration_workflow_function_boundary_is_exact(
    'public.set_registration_workflow_status_v1(uuid,text,integer,text)'::pg_catalog.regprocedure
  ),
  false,
  'exact function boundary rejects wrapper search path drift'
);
rollback to savepoint wrapper_search_path_mutation;

select * from finish();
rollback;
