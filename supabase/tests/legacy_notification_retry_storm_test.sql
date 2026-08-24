begin;

set local role postgres;
set local search_path = extensions, public;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_function(
  'public',
  'begin_legacy_notification_dispatch_v1',
  array['text', 'text', 'uuid', 'text', 'text', 'bigint', 'text', 'bigint', 'uuid'],
  'legacy dispatch begin keeps its exact signature'
);

select has_function(
  'public',
  'finalize_legacy_notification_dispatch_v1',
  array['uuid', 'bigint', 'uuid', 'text', 'text'],
  'legacy dispatch finalize keeps its exact signature'
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
      'public.begin_legacy_notification_dispatch_v1(text,text,uuid,text,text,bigint,text,bigint,uuid)'
    )
  ),
  'legacy begin keeps postgres owner, SECURITY DEFINER, volatility, and empty search path'
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
      'public.finalize_legacy_notification_dispatch_v1(uuid,bigint,uuid,text,text)'
    )
  ),
  'legacy finalize keeps postgres owner, SECURITY DEFINER, volatility, and empty search path'
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
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) acl
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.begin_legacy_notification_dispatch_v1(text,text,uuid,text,text,bigint,text,bigint,uuid)'
    )
  ),
  'legacy begin is executable only by postgres and service_role'
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
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) acl
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.finalize_legacy_notification_dispatch_v1(uuid,bigint,uuid,text,text)'
    )
  ),
  'legacy finalize is executable only by postgres and service_role'
);

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
  active_template_id, revision, created_by, created_actor_kind,
  updated_by, updated_actor_kind, created_at, updated_at
)
values (
  '89000000-0000-4000-8000-000000000101',
  'global', 'tasks', 'task.legacy_retry_storm_fixture', 'google_chat',
  'management_team', 'immediate', 'immediate', null, null, true,
  '89000000-0000-4000-8000-000000000201', 1,
  null, 'system', null, 'system', pg_catalog.now(), pg_catalog.now()
);

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind, created_at
)
values (
  '89000000-0000-4000-8000-000000000201',
  '89000000-0000-4000-8000-000000000101',
  1, '재시도 방지', '같은 알림은 다시 보내지 않습니다.', '[]'::jsonb, 1,
  'legacy-retry-storm-fixture-v1', null, 'system', pg_catalog.now()
);

create temporary table legacy_notification_retry_storm_results(
  result_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on legacy_notification_retry_storm_results to service_role;

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into legacy_notification_retry_storm_results(result_key, payload)
select 'begun', public.begin_legacy_notification_dispatch_v1(
  'tasks',
  'legacy-retry-storm-occurrence',
  '89000000-0000-4000-8000-000000000101',
  'google_chat',
  'connection:legacy-retry-storm',
  0,
  'legacy-retry-storm-fixture',
  0,
  '89000000-0000-4000-8000-000000000301'
);

select ok(
  (
    select payload ->> 'acquired' = 'true'
      and payload ->> 'status' = 'dispatch_started'
      and payload ->> 'dispatch_token' is not null
    from legacy_notification_retry_storm_results
    where result_key = 'begun'
  ),
  'first legacy begin acquires exactly one dispatch capability'
);

insert into legacy_notification_retry_storm_results(result_key, payload)
select 'interrupted-replay', public.begin_legacy_notification_dispatch_v1(
  'tasks',
  'legacy-retry-storm-occurrence',
  '89000000-0000-4000-8000-000000000101',
  'google_chat',
  'connection:legacy-retry-storm',
  0,
  'legacy-retry-storm-fixture',
  0,
  '89000000-0000-4000-8000-000000000301'
);

select ok(
  (
    select replay.payload ->> 'acquired' = 'false'
      and replay.payload ->> 'status' = 'dispatch_already_started'
      and replay.payload ->> 'reason' = 'idempotent_dispatch_replay'
      and replay.payload ->> 'dispatch_token' = begun.payload ->> 'dispatch_token'
    from legacy_notification_retry_storm_results replay
    join legacy_notification_retry_storm_results begun
      on begun.result_key = 'begun'
    where replay.result_key = 'interrupted-replay'
  ),
  'interrupted begin replay cannot reacquire but preserves one recovery token'
);

insert into legacy_notification_retry_storm_results(result_key, payload)
select 'finalized', public.finalize_legacy_notification_dispatch_v1(
  (select (payload ->> 'claim_id')::uuid from legacy_notification_retry_storm_results where result_key = 'begun'),
  (select (payload ->> 'owner_generation')::bigint from legacy_notification_retry_storm_results where result_key = 'begun'),
  (select (payload ->> 'dispatch_token')::uuid from legacy_notification_retry_storm_results where result_key = 'begun'),
  'sent',
  'legacy-provider-reference-1'
);

select ok(
  (
    select payload ->> 'status' = 'closed'
      and payload ->> 'outcome' = 'sent'
      and payload ->> 'replayed' = 'false'
    from legacy_notification_retry_storm_results
    where result_key = 'finalized'
  ),
  'first legacy finalize persists one sent terminal result'
);

insert into legacy_notification_retry_storm_results(result_key, payload)
select 'closed-replay', public.begin_legacy_notification_dispatch_v1(
  'tasks',
  'legacy-retry-storm-occurrence',
  '89000000-0000-4000-8000-000000000101',
  'google_chat',
  'connection:legacy-retry-storm',
  0,
  'legacy-retry-storm-fixture',
  0,
  '89000000-0000-4000-8000-000000000301'
);

select ok(
  (
    select payload ->> 'acquired' = 'false'
      and payload ->> 'status' = 'sent'
      and payload ->> 'reason' = 'idempotent_dispatch_replay'
      and not payload ? 'dispatch_token'
    from legacy_notification_retry_storm_results
    where result_key = 'closed-replay'
  ),
  'closed begin replay cannot reacquire or expose a dispatch token'
);

select throws_ok(
  pg_catalog.format(
    'select public.finalize_legacy_notification_dispatch_v1(%L::uuid,%L::bigint,%L::uuid,%L,%L)',
    (select payload ->> 'claim_id' from legacy_notification_retry_storm_results where result_key = 'begun'),
    (select payload ->> 'owner_generation' from legacy_notification_retry_storm_results where result_key = 'begun'),
    (select payload ->> 'dispatch_token' from legacy_notification_retry_storm_results where result_key = 'begun'),
    'failed',
    'legacy-provider-reference-1'
  ),
  '23514',
  'notification_legacy_finalize_replay_mismatch',
  'closed sent claim rejects conflicting finalize with exact non-retryable SQLSTATE'
);

select throws_ok(
  $$
    select public.finalize_legacy_notification_dispatch_v1(
      '89000000-0000-4000-8000-000000000999',
      0,
      '89000000-0000-4000-8000-000000000998',
      'failed',
      'missing-claim'
    )
  $$,
  '23514',
  'notification_legacy_ownership_mismatch',
  'missing ownership claim rejects finalize with exact non-retryable SQLSTATE'
);

set local role postgres;

select ok(
  (
    select claim.state = 'closed'
      and claim.terminal_outcome = 'sent'
      and claim.provider_reference = 'legacy-provider-reference-1'
    from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.id = (
      select (payload ->> 'claim_id')::uuid
      from legacy_notification_retry_storm_results
      where result_key = 'begun'
    )
  ),
  'conflicting replay cannot change the persisted terminal claim'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.finalize_legacy_notification_dispatch_v1(uuid,bigint,uuid,text,text)'::regprocedure
  ) ~ 'notification_legacy_ownership_mismatch[^;]+23514'
  and pg_catalog.pg_get_functiondef(
    'public.finalize_legacy_notification_dispatch_v1(uuid,bigint,uuid,text,text)'::regprocedure
  ) ~ 'notification_legacy_finalize_replay_mismatch[^;]+23514'
  and pg_catalog.pg_get_functiondef(
    'public.finalize_legacy_notification_dispatch_v1(uuid,bigint,uuid,text,text)'::regprocedure
  ) !~ 'errcode = ''40001''',
  'final active legacy finalize definition keeps business conflicts non-retryable'
);

select * from finish();
rollback;
