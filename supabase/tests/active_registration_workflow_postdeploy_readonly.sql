begin transaction read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

with expected_functions(function_name, is_private) as (
  values
    ('public.set_registration_workflow_status_v1(uuid,text,integer,text)'::text, false),
    ('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::text, true)
),
functions as (
  select
    expected_functions.function_name,
    expected_functions.is_private,
    procedure.oid,
    procedure.prosecdef,
    procedure.proowner,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.pg_get_functiondef(procedure.oid) as definition
  from expected_functions
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(expected_functions.function_name)
)
select (
  (select count(*) from functions where oid is not null) = 2
  and not exists (
    select 1
    from functions
    where oid is null
      or pg_catalog.pg_get_userbyid(proowner) <> 'postgres'
      or pg_catalog.cardinality(proconfig) <> 1
      or proconfig[1] not in ('search_path=', 'search_path=""')
      or (is_private and not prosecdef)
      or (not is_private and prosecdef)
      or definition like '%40001%'
      or (not is_private and definition not like '%dashboard_private.set_registration_workflow_status_v1_impl%')
      or (is_private and (
        definition not like '%registration_workflow_status_refresh_required%'
        or definition not like '%23514%'
      ))
  )
  and not exists (
    select 1
    from functions
    where not (
      select
        count(*) = 2
        and count(*) filter (
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
        coalesce(proacl, pg_catalog.acldefault('f', proowner))
      ) acl
    )
  )
  and not exists (
    select 1
    from functions
    cross join (
      values ('public'::name), ('anon'::name), ('service_role'::name)
    ) denied_role(role_name)
    where pg_catalog.has_function_privilege(denied_role.role_name, oid, 'EXECUTE')
  )
) as contract_ok;
rollback;
