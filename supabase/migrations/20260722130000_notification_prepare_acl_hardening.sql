begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = '';

do $migration$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.prepare_notification_immediate_delivery_v1(text,uuid,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)'
  );
  v_security_definer boolean;
begin
  if v_function_oid is null then
    raise exception 'notification_prepare_function_missing'
      using errcode = '55000';
  end if;

  select function_row.prosecdef
  into v_security_definer
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_function_oid;

  if v_security_definer is not true then
    raise exception 'notification_prepare_security_definer_required'
      using errcode = '55000';
  end if;
end;
$migration$;

alter function public.prepare_notification_immediate_delivery_v1(
  text, uuid, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamptz, jsonb
) owner to postgres;

revoke all on function public.prepare_notification_immediate_delivery_v1(
  text, uuid, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamptz, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.prepare_notification_immediate_delivery_v1(
  text, uuid, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamptz, jsonb
) to service_role;

do $migration$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.prepare_notification_immediate_delivery_v1(text,uuid,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)'
  );
  v_owner_oid oid;
  v_owner text;
  v_service_role_oid oid;
  v_security_definer boolean;
  v_acl_is_exact boolean;
begin
  if v_function_oid is null then
    raise exception 'notification_prepare_function_missing'
      using errcode = '55000';
  end if;

  select
    function_row.proowner,
    pg_catalog.pg_get_userbyid(function_row.proowner),
    function_row.prosecdef
  into v_owner_oid, v_owner, v_security_definer
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_function_oid;

  if v_owner is distinct from 'postgres'
    or v_security_definer is not true
  then
    raise exception 'notification_prepare_owner_or_security_definer_invalid'
      using errcode = '55000';
  end if;

  select role_row.oid
  into v_service_role_oid
  from pg_catalog.pg_roles role_row
  where role_row.rolname = 'service_role';

  if v_service_role_oid is null then
    raise exception 'notification_service_role_missing'
      using errcode = '55000';
  end if;

  select
    pg_catalog.count(*) = 2
    and pg_catalog.count(*) filter (
      where acl_row.grantor = v_owner_oid
        and acl_row.grantee = v_owner_oid
        and acl_row.privilege_type = 'EXECUTE'
        and acl_row.is_grantable is false
    ) = 1
    and pg_catalog.count(*) filter (
      where acl_row.grantor = v_owner_oid
        and acl_row.grantee = v_service_role_oid
        and acl_row.privilege_type = 'EXECUTE'
        and acl_row.is_grantable is false
    ) = 1
  into v_acl_is_exact
  from pg_catalog.pg_proc function_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      function_row.proacl,
      pg_catalog.acldefault('f', function_row.proowner)
    )
  ) acl_row
  where function_row.oid = v_function_oid;

  if not pg_catalog.has_function_privilege(
      'service_role', v_function_oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon', v_function_oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', v_function_oid, 'EXECUTE'
    )
    or v_acl_is_exact is not true
  then
    raise exception 'notification_prepare_execute_acl_invalid'
      using errcode = '55000';
  end if;
end;
$migration$;

commit;
