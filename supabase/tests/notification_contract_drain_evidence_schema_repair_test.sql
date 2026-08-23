begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  pg_catalog.to_regprocedure(
    'public.get_notification_contract_drain_evidence_v1(timestamp with time zone,timestamp with time zone)'
  ) is not null,
  'notification contract drain evidence RPC keeps its exact signature'
);

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.set_registration_customer_solapi_activation_pre_observation_v1(uuid,text,text,jsonb)'
  ) is null,
  'unreachable pre-observation activation helper is removed'
);

select ok(
  (
    select
      pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (array['search_path=', 'search_path=""'])
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.get_notification_contract_drain_evidence_v1(timestamp with time zone,timestamp with time zone)'
    )
  ),
  'drain evidence RPC keeps its owner, security, volatility, and empty search path'
);

select ok(
  (
    select
      pg_catalog.count(*) = 2
      and pg_catalog.count(*) filter (
        where pg_catalog.pg_get_userbyid(acl.grantee)::text in ('postgres', 'service_role')
          and pg_catalog.pg_get_userbyid(acl.grantor)::text = 'postgres'
          and acl.privilege_type = 'EXECUTE'
          and not acl.is_grantable
      ) = 2
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) acl
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.get_notification_contract_drain_evidence_v1(timestamp with time zone,timestamp with time zone)'
    )
  ),
  'drain evidence RPC is executable only by postgres and service_role'
);

select is(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(
        'public.get_notification_contract_drain_evidence_v1(timestamp with time zone,timestamp with time zone)'
      )
    ),
    'pg_catalog.coalesce('
  ),
  0,
  'drain evidence RPC has no invalid schema-qualified COALESCE call'
);

select is(
  (
    select (
      pg_catalog.char_length(definition)
      - pg_catalog.char_length(pg_catalog.replace(definition, 'coalesce(', ''))
    ) / pg_catalog.char_length('coalesce(')
    from (
      select pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.get_notification_contract_drain_evidence_v1(timestamp with time zone,timestamp with time zone)'
        )
      ) as definition
    ) source
  ),
  5,
  'drain evidence RPC retains all five unqualified COALESCE expressions'
);

insert into dashboard_private.notification_contract_bridge_state(
  state_key,
  installed_at,
  closed_at
) values (
  'legacy_contract_bridge_v1',
  pg_catalog.clock_timestamp() - interval '48 hours',
  null
)
on conflict (state_key) do update
set installed_at = excluded.installed_at,
    closed_at = excluded.closed_at;

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select lives_ok(
  $$
    select public.get_notification_contract_drain_evidence_v1(
      pg_catalog.clock_timestamp() - interval '25 hours',
      pg_catalog.clock_timestamp()
    )
  $$,
  'drain evidence RPC compiles and runs through the repaired aggregate'
);

set local role postgres;
select * from finish();
rollback;
