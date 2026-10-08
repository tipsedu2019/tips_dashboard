begin;
select no_plan();
-- Run in a fresh pg_prove session after migration 2 has really committed and
-- before migration 3 or the final guarded gateway is installed. This is not a
-- rolled-back full-chain preflight or a final-definition substitute.
select is((select count(*) from supabase_migrations.schema_migrations where version='20261003084048'),1::bigint,'migration 2 is recorded by the preceding committed local apply');
select is((select count(*) from supabase_migrations.schema_migrations where version>='20261003091944'),0::bigint,'later migrations have not been applied to this prefix');
select ok(to_regclass('dashboard_private.ai_agent_chat_support') is null,'final issuance gate does not hide the intermediate ACL regression');
select is((select count(*) from pg_constraint where conname in('ai_agent_claim_credential_fk','ai_agent_event_credential_fk','ai_agent_event_issuer_fk') and not convalidated),3::bigint,'all three NOT VALID foreign keys have committed before later validation');
insert into auth.users(id,instance_id,aud,role,email) values('ac030048-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ai-prefix-admin@test.invalid');
insert into public.profiles(id,role,name) values('ac030048-0000-4000-8000-000000000001','admin','AI prefix fixture') on conflict(id) do update set role=excluded.role;
select set_config('request.jwt.claim.sub','ac030048-0000-4000-8000-000000000001',true);
select is(dashboard_private.ai_agent_require_admin_v1(),'ac030048-0000-4000-8000-000000000001'::uuid,'the blocked caller is an active authenticated administrator');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) app_role cross join unnest(array['public.create_ai_agent_credential_v1(text,text[],jsonb,timestamptz)','public.list_ai_agent_credentials_v1(integer,integer)','public.revoke_ai_agent_credential_v1(uuid)']) helper where has_function_privilege(app_role,helper,'EXECUTE')),'all app roles lack direct credential-helper EXECUTE at the committed prefix');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid in('public.create_ai_agent_credential_v1(text,text[],jsonb,timestamptz)'::regprocedure,'public.list_ai_agent_credentials_v1(integer,integer)'::regprocedure,'public.revoke_ai_agent_credential_v1(uuid)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC cannot inherit direct helper EXECUTE');
set local role authenticated;
-- PERFORM suppresses the raw synthetic token even if the forbidden call ever
-- regresses and succeeds; the subsequent empty-store assertions catch it.
select throws_ok($q$do $$begin perform public.create_ai_agent_credential_v1('prefix regression',array['ai-agent:requests:read','chat:send'],'{"queues":["employee_requests"],"actions":["read"],"spaceKeys":["space_2"],"purposes":["bridge_reply"],"bridgeSourceId":"ac030048-0000-4000-8000-000000000002"}',clock_timestamp()+interval '1 hour');end$$;$q$,'42501',null,'active admin cannot issue an AI and Chat credential before the final gateway');
select throws_ok($q$select public.list_ai_agent_credentials_v1(1,10)$q$,'42501',null,'active admin cannot list through the intermediate direct helper');
select throws_ok($q$select public.revoke_ai_agent_credential_v1('ac030048-0000-4000-8000-000000000003')$q$,'42501',null,'active admin cannot revoke through the intermediate direct helper');
reset role;
select is((select count(*) from dashboard_private.ai_agent_credentials),0::bigint,'blocked committed-prefix call creates no credential');
select is((select count(*) from dashboard_private.ai_agent_credential_grants),0::bigint,'blocked committed-prefix call creates no request grant');
select is((select count(*) from dashboard_private.chat_credential_space_grants),0::bigint,'blocked committed-prefix call creates no Chat grant');
select * from finish();
rollback;
