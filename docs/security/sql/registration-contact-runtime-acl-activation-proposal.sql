-- PREPARATION PROPOSAL ONLY. No production authority is granted by this file.
-- Exact source-generated hashes; no provider, secrets, send activation or purge.
-- Root release runner must classify pristine/exact-after/mixed before mutation.
-- Runtime actors remain server-verified; browser receives no mutation privilege.
-- Reconcile RPC is the current no-send adapter, not an active producer.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
do $contact_runtime_acl_preflight$
declare item record; target oid; proc pg_catalog.pg_proc%rowtype; allowed oid;
begin
  if current_user<>'postgres' then raise exception 'contact_runtime_acl_owner_required' using errcode='55000'; end if;
  for item in select * from (values
    ('public.get_registration_case_contact_v1(uuid,integer)','11b343c9451f0eaf4a3b81207b6aed6f0ec50ae99e037df772d5e1c13c8aa861','authenticated','s','jsonb',true,false),
    ('public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text)','8ff64202ccf0a193e6518c636e95388c918bd33278a16d50a907edafec5de608','service_role','v','jsonb',true,false),
    ('public.read_registration_contact_message_fence_v1(uuid,text,uuid)','5ae18f66a4ef30f8f5e9a3ecc55cc95d26431719e5227793bf87ad553419635b','service_role','v','jsonb',true,false),
    ('public.read_registration_contact_message_request_replay_v1(uuid,uuid,text,jsonb,text)','0999a3a24e93c262bd7558ffc146e0005cfd2a57cceabcd3f4badd13e34df1b7','service_role','v','jsonb',true,false),
    ('public.read_registration_contact_bundle_preview_v1(text,uuid,date)','0ce1fb9d6fc9a8d9bb066723d19741f65703fba4d08fd62e6b46c0afd971890b','service_role','v','jsonb',true,false),
    ('public.reconcile_registration_customer_reminder_claims_v1()','a4a94899a87edb6a068a99dbd7a08dc9c38f489dacc2a993ea80fae1dd5b1e27','service_role','v','void',true,false),
    ('public.read_registration_contact_events_v1(uuid,integer,boolean)','982bb5bb859ae59c6c8005ecf07a0f399016ed42ea61bc550630b2ec071e502e','authenticated','s','jsonb',false,true),
    ('dashboard_private.registration_contact_legacy_import_valid_v1(text)','b6dea6f4d99a886efc1ad7d5afc16da4081035a4b3db8fa9b8b78c7864a72911','authenticated','i','boolean',false,true)
  ) expected(signature,body_sha256,role_name,volatility,return_type,security_definer,already_granted) loop
    target:=pg_catalog.to_regprocedure(item.signature);
    if target is null then raise exception 'contact_runtime_acl_target_missing' using errcode='55000'; end if;
    select * into strict proc from pg_catalog.pg_proc where oid=target;
    allowed:=pg_catalog.to_regrole(item.role_name);
    if allowed is null or proc.proowner<>pg_catalog.to_regrole('postgres')
      or pg_catalog.encode(extensions.digest(proc.prosrc,'sha256'),'hex')<>item.body_sha256
      or proc.prosecdef is distinct from item.security_definer
      or proc.proconfig is distinct from array['search_path=""']::text[]
      or proc.provolatile::text<>item.volatility or proc.prokind<>'f'
      or proc.prorettype<>pg_catalog.to_regtype(item.return_type)
      or proc.proisstrict or proc.proleakproof
      or (select lanname from pg_catalog.pg_language where oid=proc.prolang)<>'plpgsql' then
      raise exception 'contact_runtime_acl_source_or_metadata_drift' using errcode='55000';
    end if;
    -- Explicit ACLs, not only effective privileges: inherited/default grants
    -- must not add new grantees or grant options. Owner EXECUTE remains intact.
    if exists(select 1 from pg_catalog.aclexplode(CASE WHEN pg_catalog.array_ndims(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)))>0 THEN coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)) ELSE NULL END) acl
      where acl.privilege_type<>'EXECUTE' or acl.is_grantable
        or acl.grantor<>proc.proowner
        or acl.grantee<>proc.proowner and not(item.already_granted and acl.grantee=allowed))
      or not pg_catalog.has_function_privilege('postgres',target,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',target,'EXECUTE')
      or exists(select 1 from (values ('authenticated'),('service_role')) roles(name)
        where roles.name<>item.role_name and pg_catalog.has_function_privilege(roles.name,target,'EXECUTE'))
      or (not item.already_granted and pg_catalog.has_function_privilege(item.role_name,target,'EXECUTE')) then
      raise exception 'contact_runtime_acl_unexpected_initial_grants' using errcode='55000';
    end if;
  end loop;
end $contact_runtime_acl_preflight$;

grant execute on function public.get_registration_case_contact_v1(uuid,integer) to authenticated;
grant execute on function public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text) to service_role;
grant execute on function public.read_registration_contact_message_fence_v1(uuid,text,uuid) to service_role;
grant execute on function public.read_registration_contact_message_request_replay_v1(uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.read_registration_contact_bundle_preview_v1(text,uuid,date) to service_role;
grant execute on function public.reconcile_registration_customer_reminder_claims_v1() to service_role;

do $contact_runtime_acl_postflight$
declare item record; target oid;
begin
  for item in select * from (values
    ('public.get_registration_case_contact_v1(uuid,integer)','authenticated'),
    ('public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text)','service_role'),
    ('public.read_registration_contact_message_fence_v1(uuid,text,uuid)','service_role'),
    ('public.read_registration_contact_message_request_replay_v1(uuid,uuid,text,jsonb,text)','service_role'),
    ('public.read_registration_contact_bundle_preview_v1(text,uuid,date)','service_role'),
    ('public.reconcile_registration_customer_reminder_claims_v1()','service_role'),
    ('public.read_registration_contact_events_v1(uuid,integer,boolean)','authenticated'),
    ('dashboard_private.registration_contact_legacy_import_valid_v1(text)','authenticated')
  ) expected(signature,role_name) loop
    target:=pg_catalog.to_regprocedure(item.signature);
    if not pg_catalog.has_function_privilege(item.role_name,target,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',target,'EXECUTE')
      or exists(select 1 from (values ('authenticated'),('service_role')) roles(name)
        where roles.name<>item.role_name and pg_catalog.has_function_privilege(roles.name,target,'EXECUTE'))
      or exists(select 1 from pg_catalog.pg_proc proc cross join lateral pg_catalog.aclexplode(CASE WHEN pg_catalog.array_ndims(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)))>0 THEN coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)) ELSE NULL END) acl
        where proc.oid=target and (acl.grantee not in (proc.proowner,pg_catalog.to_regrole(item.role_name)) or acl.is_grantable or acl.grantor<>proc.proowner)) then
      raise exception 'contact_runtime_acl_activation_scope_drift' using errcode='55000';
    end if;
  end loop;
end $contact_runtime_acl_postflight$;
commit;
