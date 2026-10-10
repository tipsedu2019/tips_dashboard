-- PREPARATION RECOVERY PROPOSAL ONLY; execute solely after separate approval.
-- This disables eight NEW contact capabilities. It restores no old function,
-- column, audit format, phone, generation, receipt, roster or queue state.
-- Audit privacy writer/shape/index and lifecycle/UUID guards remain installed.
-- Quiesce old and new callers/workers first. REVOKE does not cancel an already
-- running statement. Old-app raw event/master readers must not be reactivated.
-- Root must certify exact installed source/metadata before this scoped recovery.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
do $contact_runtime_deactivation_preflight$
begin
  if current_user<>'postgres' then raise exception 'contact_runtime_acl_owner_required' using errcode='55000'; end if;
end $contact_runtime_deactivation_preflight$;
do $contact_runtime_deactivate$
declare item record; target oid; owner_name text;
begin
  for item in select * from (values
    ('public.get_registration_case_contact_v1(uuid,integer)','11b343c9451f0eaf4a3b81207b6aed6f0ec50ae99e037df772d5e1c13c8aa861',true),
    ('public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text)','8ff64202ccf0a193e6518c636e95388c918bd33278a16d50a907edafec5de608',true),
    ('public.read_registration_contact_message_fence_v1(uuid,text,uuid)','5ae18f66a4ef30f8f5e9a3ecc55cc95d26431719e5227793bf87ad553419635b',true),
    ('public.read_registration_contact_message_request_replay_v1(uuid,uuid,text,jsonb,text)','0999a3a24e93c262bd7558ffc146e0005cfd2a57cceabcd3f4badd13e34df1b7',true),
    ('public.read_registration_contact_bundle_preview_v1(text,uuid,date)','0ce1fb9d6fc9a8d9bb066723d19741f65703fba4d08fd62e6b46c0afd971890b',true),
    ('public.reconcile_registration_customer_reminder_claims_v1()','a4a94899a87edb6a068a99dbd7a08dc9c38f489dacc2a993ea80fae1dd5b1e27',true),
    ('public.read_registration_contact_events_v1(uuid,integer,boolean)','982bb5bb859ae59c6c8005ecf07a0f399016ed42ea61bc550630b2ec071e502e',false),
    ('dashboard_private.registration_contact_legacy_import_valid_v1(text)','b6dea6f4d99a886efc1ad7d5afc16da4081035a4b3db8fa9b8b78c7864a72911',false)
  ) expected(signature,body_sha256,security_definer) loop
    target:=pg_catalog.to_regprocedure(item.signature);
    if target is null then continue; end if;
    select pg_catalog.pg_get_userbyid(proowner) into strict owner_name from pg_catalog.pg_proc where oid=target;
    if owner_name<>'postgres' then raise exception 'contact_runtime_deactivation_owner_drift' using errcode='55000'; end if;
    if not exists(select 1 from pg_catalog.pg_proc proc where proc.oid=target
      and pg_catalog.encode(extensions.digest(proc.prosrc,'sha256'),'hex')=item.body_sha256
      and proc.proconfig=array['search_path=""']::text[] and proc.prosecdef=item.security_definer) then
      raise exception 'contact_runtime_deactivation_source_drift' using errcode='55000';
    end if;
    if exists(select 1 from pg_catalog.pg_proc proc cross join lateral pg_catalog.aclexplode(CASE WHEN pg_catalog.array_ndims(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)))>0 THEN coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)) ELSE NULL END) acl
      where proc.oid=target and (acl.grantee not in (proc.proowner,pg_catalog.to_regrole('authenticated'),pg_catalog.to_regrole('service_role'))
        or acl.grantor<>proc.proowner or acl.is_grantable)) then
      raise exception 'contact_runtime_deactivation_acl_drift' using errcode='55000';
    end if;
    execute pg_catalog.format('revoke all on function %s from PUBLIC,anon,authenticated,service_role',target::regprocedure);
    if pg_catalog.has_function_privilege('anon',target,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
      raise exception 'contact_runtime_deactivation_inherited_grant_remains' using errcode='55000';
    end if;
    if exists(select 1 from pg_catalog.pg_proc proc cross join lateral pg_catalog.aclexplode(CASE WHEN pg_catalog.array_ndims(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)))>0 THEN coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner)) ELSE NULL END) acl
      where proc.oid=target and (acl.grantee<>proc.proowner or acl.grantor<>proc.proowner or acl.is_grantable)) then
      raise exception 'contact_runtime_deactivation_extra_acl_remains' using errcode='55000';
    end if;
  end loop;
end $contact_runtime_deactivate$;
commit;
