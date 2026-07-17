begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- Every relation created by the expand migration must exist before later RPC
-- migrations are allowed to depend on it.
select is_empty($$
  with expected(table_name) as (
    values
      ('notification_events'),
      ('notification_rules'),
      ('notification_templates'),
      ('notification_deliveries'),
      ('notification_audit_logs'),
      ('notification_event_fanout_jobs'),
      ('notification_rule_reconciliation_jobs'),
      ('notification_target_reconciliation_jobs'),
      ('notification_request_ledger'),
      ('notification_worker_heartbeats'),
      ('notification_runtime_flags'),
      ('notification_dispatch_ownership_claims'),
      ('notification_legacy_import_sources')
  )
  select table_name
  from expected
  where pg_catalog.to_regclass('dashboard_private.' || table_name) is null
$$, 'all private notification control-plane relations exist');

select has_table('public', 'dashboard_notification_read_receipts');

select is(
  (select count(*) from dashboard_private.notification_deliveries),
  0::bigint,
  'installing the expand migration creates zero deliveries'
);

-- Required columns are checked as a subset so a later forward migration may
-- add safe columns without weakening this original expand contract.
select is_empty($$
  with expected(table_name, column_name) as (
    values
      ('notification_events', 'id'),
      ('notification_events', 'scope_key'),
      ('notification_events', 'workflow_key'),
      ('notification_events', 'event_key'),
      ('notification_events', 'source_type'),
      ('notification_events', 'source_id'),
      ('notification_events', 'source_revision'),
      ('notification_events', 'occurrence_key'),
      ('notification_events', 'actor_profile_id'),
      ('notification_events', 'occurred_at'),
      ('notification_events', 'payload_schema_version'),
      ('notification_events', 'payload'),
      ('notification_events', 'rule_snapshot'),
      ('notification_events', 'materialized_rule_id'),
      ('notification_events', 'materialized_rule_revision'),
      ('notification_rules', 'active_template_id'),
      ('notification_rules', 'revision'),
      ('notification_rules', 'created_actor_kind'),
      ('notification_rules', 'updated_actor_kind'),
      ('notification_templates', 'rule_id'),
      ('notification_templates', 'version'),
      ('notification_templates', 'allowed_variables'),
      ('notification_deliveries', 'event_id'),
      ('notification_deliveries', 'rule_id'),
      ('notification_deliveries', 'template_id'),
      ('notification_deliveries', 'target_generation'),
      ('notification_deliveries', 'target_set_hash'),
      ('notification_deliveries', 'target_snapshot'),
      ('notification_deliveries', 'status'),
      ('notification_deliveries', 'status_reason'),
      ('notification_deliveries', 'dedupe_key'),
      ('notification_deliveries', 'scheduled_for'),
      ('notification_deliveries', 'claim_token'),
      ('notification_deliveries', 'lease_expires_at'),
      ('notification_rule_reconciliation_jobs', 'processed_count'),
      ('notification_rule_reconciliation_jobs', 'canceled_count'),
      ('notification_rule_reconciliation_jobs', 'regenerated_count'),
      ('notification_target_reconciliation_jobs', 'source_event_id'),
      ('notification_target_reconciliation_jobs', 'target_generation'),
      ('notification_target_reconciliation_jobs', 'previous_target_set_hash'),
      ('notification_target_reconciliation_jobs', 'current_target_set_hash'),
      ('notification_target_reconciliation_jobs', 'cursor'),
      ('notification_dispatch_ownership_claims', 'target_generation'),
      ('notification_dispatch_ownership_claims', 'owner_generation'),
      ('notification_dispatch_ownership_claims', 'dispatch_token'),
      ('notification_worker_heartbeats', 'counts'),
      ('notification_runtime_flags', 'flag_key')
  )
  select expected.table_name, expected.column_name
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'dashboard_private'
   and actual.table_name = expected.table_name
   and actual.column_name = expected.column_name
  where actual.column_name is null
$$, 'all locked canonical, queue, generation, lease, and heartbeat columns exist');

select is_empty($$
  with expected(table_name, column_name, udt_name, is_nullable) as (
    values
      ('notification_events', 'id', 'uuid', 'NO'),
      ('notification_events', 'workflow_key', 'text', 'NO'),
      ('notification_events', 'source_revision', 'int8', 'YES'),
      ('notification_events', 'payload', 'jsonb', 'NO'),
      ('notification_events', 'rule_snapshot', 'jsonb', 'NO'),
      ('notification_events', 'materialized_rule_id', 'uuid', 'YES'),
      ('notification_events', 'materialized_rule_revision', 'int8', 'YES'),
      ('notification_rules', 'id', 'uuid', 'NO'),
      ('notification_rules', 'active_template_id', 'uuid', 'NO'),
      ('notification_rules', 'revision', 'int8', 'NO'),
      ('notification_rules', 'schedule_config', 'jsonb', 'YES'),
      ('notification_templates', 'id', 'uuid', 'NO'),
      ('notification_templates', 'rule_id', 'uuid', 'NO'),
      ('notification_templates', 'version', 'int8', 'NO'),
      ('notification_templates', 'allowed_variables', 'jsonb', 'NO'),
      ('notification_deliveries', 'id', 'uuid', 'NO'),
      ('notification_deliveries', 'event_id', 'uuid', 'NO'),
      ('notification_deliveries', 'rule_id', 'uuid', 'NO'),
      ('notification_deliveries', 'rule_revision', 'int8', 'NO'),
      ('notification_deliveries', 'template_id', 'uuid', 'NO'),
      ('notification_deliveries', 'target_generation', 'int8', 'NO'),
      ('notification_deliveries', 'target_snapshot', 'jsonb', 'NO'),
      ('notification_deliveries', 'status_reason', 'text', 'YES'),
      ('notification_rule_reconciliation_jobs', 'processed_count', 'int4', 'NO'),
      ('notification_rule_reconciliation_jobs', 'canceled_count', 'int4', 'NO'),
      ('notification_rule_reconciliation_jobs', 'regenerated_count', 'int4', 'NO'),
      ('notification_request_ledger', 'request_id', 'uuid', 'NO'),
      ('notification_request_ledger', 'request_fingerprint', 'text', 'NO'),
      ('notification_worker_heartbeats', 'run_id', 'uuid', 'NO'),
      ('notification_worker_heartbeats', 'counts', 'jsonb', 'NO'),
      ('notification_dispatch_ownership_claims', 'target_generation', 'int8', 'NO'),
      ('notification_dispatch_ownership_claims', 'owner_generation', 'int8', 'NO'),
      ('notification_dispatch_ownership_claims', 'dispatch_token', 'uuid', 'YES')
  )
  select expected.table_name, expected.column_name, actual.udt_name, actual.is_nullable
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'dashboard_private'
   and actual.table_name = expected.table_name
   and actual.column_name = expected.column_name
  where actual.column_name is null
     or actual.udt_name <> expected.udt_name
     or actual.is_nullable <> expected.is_nullable
$$, 'core identities, revisions, payloads, counters, and dispatch tokens keep exact SQL types and nullability');

select is_empty($$
  with expected(table_name, column_name, default_pattern) as (
    values
      ('notification_events', 'id', 'gen_random_uuid'),
      ('notification_events', 'scope_key', '''global'''),
      ('notification_rules', 'id', 'gen_random_uuid'),
      ('notification_rules', 'enabled', 'false'),
      ('notification_rules', 'revision', '1'),
      ('notification_templates', 'id', 'gen_random_uuid'),
      ('notification_deliveries', 'id', 'gen_random_uuid'),
      ('notification_deliveries', 'target_generation', '0'),
      ('notification_deliveries', 'attempt_count', '0'),
      ('notification_rule_reconciliation_jobs', 'processed_count', '0'),
      ('notification_rule_reconciliation_jobs', 'canceled_count', '0'),
      ('notification_rule_reconciliation_jobs', 'regenerated_count', '0')
  )
  select expected.table_name, expected.column_name, actual.column_default
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'dashboard_private'
   and actual.table_name = expected.table_name
   and actual.column_name = expected.column_name
  where actual.column_default is null
     or position(expected.default_pattern in actual.column_default) = 0
$$, 'core UUID, safety flag, revision, generation, and count defaults are fixed');

-- All private notification relations use RLS as defense in depth and have no
-- direct PUBLIC/anon/authenticated table or sequence privilege.
select is_empty($$
  with expected(table_name) as (
    values
      ('notification_events'),
      ('notification_rules'),
      ('notification_templates'),
      ('notification_deliveries'),
      ('notification_audit_logs'),
      ('notification_event_fanout_jobs'),
      ('notification_rule_reconciliation_jobs'),
      ('notification_target_reconciliation_jobs'),
      ('notification_request_ledger'),
      ('notification_worker_heartbeats'),
      ('notification_runtime_flags'),
      ('notification_dispatch_ownership_claims')
  )
  select expected.table_name
  from expected
  join pg_catalog.pg_class relation
    on relation.oid = pg_catalog.to_regclass('dashboard_private.' || expected.table_name)
  where not relation.relrowsecurity
$$, 'every private notification relation has RLS enabled');

select is_empty($$
  with private_relations as (
    select relation.oid, pg_catalog.format('%I.%I', namespace.nspname, relation.relname) as relation_name
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname like 'notification_%'
      and relation.relkind in ('r', 'p')
  ), roles(role_name) as (values ('anon'), ('authenticated'))
  select relation_name, role_name
  from private_relations
  cross join roles
  where pg_catalog.has_table_privilege(role_name, oid, 'SELECT')
     or pg_catalog.has_table_privilege(role_name, oid, 'INSERT')
     or pg_catalog.has_table_privilege(role_name, oid, 'UPDATE')
     or pg_catalog.has_table_privilege(role_name, oid, 'DELETE')
     or pg_catalog.has_table_privilege(role_name, oid, 'TRUNCATE')
     or pg_catalog.has_table_privilege(role_name, oid, 'REFERENCES')
     or pg_catalog.has_table_privilege(role_name, oid, 'TRIGGER')
$$, 'browser roles have no direct private notification table privilege');

select is_empty($$
  with private_sequences as (
    select relation.oid
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname like 'notification_%'
      and relation.relkind = 'S'
  ), roles(role_name) as (values ('anon'), ('authenticated'))
  select oid, role_name
  from private_sequences
  cross join roles
  where pg_catalog.has_sequence_privilege(role_name, oid, 'USAGE')
     or pg_catalog.has_sequence_privilege(role_name, oid, 'SELECT')
     or pg_catalog.has_sequence_privilege(role_name, oid, 'UPDATE')
$$, 'browser roles have no direct private notification sequence privilege');

select is_empty($$
  with expected(table_name) as (
    values
      ('notification_events'),
      ('notification_rules'),
      ('notification_templates'),
      ('notification_deliveries'),
      ('notification_audit_logs'),
      ('notification_event_fanout_jobs'),
      ('notification_rule_reconciliation_jobs'),
      ('notification_target_reconciliation_jobs'),
      ('notification_request_ledger'),
      ('notification_worker_heartbeats'),
      ('notification_runtime_flags'),
      ('notification_dispatch_ownership_claims')
  )
  select expected.table_name, privilege_name
  from expected
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege_name)
  where not pg_catalog.has_table_privilege(
    'service_role',
    'dashboard_private.' || expected.table_name,
    privilege_name
  )
$$, 'service_role has the direct canonical table privileges required by the worker and private repositories');

select is_empty($$
  with private_sequences as (
    select relation.oid
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname like 'notification_%'
      and relation.relkind = 'S'
  )
  select oid
  from private_sequences
  where not pg_catalog.has_sequence_privilege('service_role', oid, 'USAGE')
$$, 'service_role has USAGE on every private notification sequence if one is introduced');

select ok(
  pg_catalog.has_table_privilege(
    'service_role',
    'dashboard_private.notification_legacy_import_sources',
    'SELECT'
  ),
  'service_role can read guarded optional-source metadata'
);

select ok(
  pg_catalog.has_schema_privilege('service_role', 'dashboard_private', 'USAGE'),
  'service_role can resolve the private notification relations it is granted'
);

select is_empty($$
  select schemaname, tablename, policyname
  from pg_catalog.pg_policies
  where schemaname = 'dashboard_private'
    and tablename like 'notification_%'
    and roles::text ~ '(public|anon|authenticated)'
$$, 'private notification relations expose no browser RLS policy');

select is(
  pg_catalog.has_table_privilege(
    'authenticated',
    'dashboard_private.notification_legacy_import_sources',
    'SELECT'
  ),
  false,
  'authenticated callers cannot read the private optional-source view directly'
);

select ok(
  pg_catalog.has_schema_privilege('authenticated', 'dashboard_private', 'USAGE'),
  'existing dashboard_private schema usage remains available to registration wrappers'
);

-- Stable uniqueness contracts.
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_events_occurrence_uidx') is not null,
  'event occurrence identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_rules_identity_uidx') is not null,
  'rule identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_templates_rule_version_uidx') is not null,
  'template version identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_templates_rule_id_id_uidx') is not null,
  'template composite identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_deliveries_dedupe_key_uidx') is not null,
  'delivery dedupe identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_deliveries_target_generation_uidx') is not null,
  'delivery target-generation identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_event_fanout_jobs_event_uidx') is not null,
  'one durable fanout job exists per event'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_worker_heartbeats_run_terminal_uidx') is not null,
  'one terminal heartbeat exists at most once per worker run'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_target_reconciliation_jobs_identity_uidx') is not null,
  'target reconciliation identity index exists'
);
select ok(
  pg_catalog.to_regclass('dashboard_private.notification_dispatch_ownership_claims_identity_uidx') is not null,
  'dispatch ownership identity includes target generation'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_relation.oid)
    from pg_catalog.pg_class index_relation
    where index_relation.oid = pg_catalog.to_regclass(
      'dashboard_private.notification_target_reconciliation_jobs_identity_uidx'
    )
  ) ~* 'workflow_key.*source_type.*source_id.*source_revision.*source_event_id.*reconciliation_kind.*nulls\s+not\s+distinct',
  'target jobs use one NULLS NOT DISTINCT identity per authoritative source-event UUID'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_relation.oid)
    from pg_catalog.pg_class index_relation
    where index_relation.oid = pg_catalog.to_regclass(
      'dashboard_private.notification_dispatch_ownership_claims_identity_uidx'
    )
  ) ~* 'workflow_key.*occurrence_key.*rule_id.*channel_key.*target_key.*target_generation'
  and (
    select pg_catalog.pg_get_indexdef(index_relation.oid)
    from pg_catalog.pg_class index_relation
    where index_relation.oid = pg_catalog.to_regclass(
      'dashboard_private.notification_dispatch_ownership_claims_identity_uidx'
    )
  ) !~* 'owner_generation',
  'target generation, not owner generation, participates in delivery ownership identity'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_relation.oid)
    from pg_catalog.pg_class index_relation
    where index_relation.oid = pg_catalog.to_regclass(
      'dashboard_private.notification_dispatch_ownership_claims_identity_uidx'
    )
  ) !~* 'owner_generation|dispatch_token',
  'dispatch identity excludes handoff generation and one-attempt token'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_relation.oid)
    from pg_catalog.pg_class index_relation
    where index_relation.oid = pg_catalog.to_regclass(
      'dashboard_private.notification_worker_heartbeats_run_terminal_uidx'
    )
  ) ~* 'run_id.*where.*phase.*succeeded.*failed',
  'succeeded and failed share one per-run terminal uniqueness slot'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_relation.oid)
    from pg_catalog.pg_class index_relation
    where index_relation.oid = pg_catalog.to_regclass(
      'dashboard_private.notification_deliveries_target_generation_uidx'
    )
  ) ~* 'event_id.*rule_id.*channel_key.*target_kind.*target_key.*target_generation',
  'delivery identity includes the authoritative target generation'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'dashboard_private'
      and table_name = 'notification_deliveries'
      and column_name = 'owner_generation'
  ),
  0::bigint,
  'delivery rows never confuse handoff owner generation with target generation'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'dashboard_private'
      and table_name = 'notification_target_reconciliation_jobs'
      and column_name = 'rule_id'
  ),
  0::bigint,
  'one target reconciliation job is not duplicated per rule'
);

select is_empty($$
  select constraint_row.conname
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_attribute source_column
    on source_column.attrelid = constraint_row.conrelid
   and source_column.attnum = any(constraint_row.conkey)
  where constraint_row.contype = 'f'
    and constraint_row.conrelid = 'dashboard_private.notification_target_reconciliation_jobs'::regclass
    and source_column.attname = 'source_event_id'
    and constraint_row.confrelid = 'dashboard_private.notification_events'::regclass
$$, 'authoritative source_event_id is never a notification_events foreign key');

-- Both sides of the rule/template cycle are deferred until commit.
select is(
  (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'dashboard_private.notification_templates'::regclass
      and constraint_row.conname = 'notification_templates_rule_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.condeferrable
      and constraint_row.condeferred
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* 'foreign key \(rule_id\).*notification_rules\(id\).*deferrable initially deferred'
  ),
  1::bigint,
  'template to owning rule FK is initially deferred'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'dashboard_private.notification_rules'::regclass
      and constraint_row.conname = 'notification_rules_active_template_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.condeferrable
      and constraint_row.condeferred
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* 'foreign key \(id, active_template_id\).*notification_templates\(rule_id, id\).*deferrable initially deferred'
  ),
  1::bigint,
  'active template must belong to the same rule and is initially deferred'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'dashboard_private.notification_request_ledger'::regclass
      and constraint_row.conname = 'notification_request_ledger_pkey'
      and constraint_row.contype = 'p'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* 'primary key \(request_id\)'
  ),
  1::bigint,
  'shared request ledger has one global request-id idempotency identity'
);

select is_empty($$
  with expected(table_name, definition_pattern) as (
    values
      ('notification_events', 'foreign key \(actor_profile_id\).*(public\.)?profiles\(id\).*on delete set null'),
      ('notification_deliveries', 'foreign key \(event_id\).*notification_events\(id\)'),
      ('notification_deliveries', 'foreign key \(rule_id\).*notification_rules\(id\)'),
      ('notification_deliveries', 'foreign key \(rule_id, template_id\).*notification_templates\(rule_id, id\)')
  )
  select expected.table_name, expected.definition_pattern
  from expected
  where not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = pg_catalog.to_regclass(
      'dashboard_private.' || expected.table_name
    )
      and constraint_row.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* expected.definition_pattern
  )
$$, 'canonical actor, event, rule, and immutable rule-template foreign keys are fixed');

select is_empty($$
  with queue_tables(table_name) as (
    values
      ('notification_event_fanout_jobs'),
      ('notification_rule_reconciliation_jobs'),
      ('notification_target_reconciliation_jobs')
  ), workflows(workflow_key) as (
    values
      ('tasks'), ('word_retests'), ('registration'), ('transfer'), ('withdrawal'),
      ('makeup_requests'), ('approvals')
  ), definitions as (
    select
      queue_tables.table_name,
      coalesce(pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '), '') as source
    from queue_tables
    left join pg_catalog.pg_constraint constraint_row
      on constraint_row.conrelid = pg_catalog.to_regclass(
        'dashboard_private.' || queue_tables.table_name
      )
     and constraint_row.contype = 'c'
    group by queue_tables.table_name
  )
  select definitions.table_name, workflows.workflow_key
  from definitions
  cross join workflows
  where position(workflows.workflow_key in definitions.source) = 0
$$, 'all three orchestration queues reject workflow keys outside the exact seven-key registry');

select is_empty($$
  with queue_tables(table_name) as (
    values
      ('notification_event_fanout_jobs'),
      ('notification_rule_reconciliation_jobs'),
      ('notification_target_reconciliation_jobs')
  ), required_token(token) as (
    values
      ('pending'), ('claimed'), ('succeeded'), ('failed'), ('next_attempt_at'),
      ('claimed_by'), ('claim_token'), ('lease_expires_at')
  ), definitions as (
    select
      queue_tables.table_name,
      coalesce(pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(constraint_row.oid), ' '), '') as source
    from queue_tables
    left join pg_catalog.pg_constraint constraint_row
      on constraint_row.conrelid = pg_catalog.to_regclass(
        'dashboard_private.' || queue_tables.table_name
      )
     and constraint_row.contype = 'c'
    group by queue_tables.table_name
  )
  select definitions.table_name, required_token.token
  from definitions
  cross join required_token
  where position(required_token.token in definitions.source) = 0
$$, 'all three orchestration queues persist the complete status, next-attempt, and lease state contract');

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'dashboard_private.notification_events'::regclass
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* 'materialized_rule_id.*is null.*materialized_rule_revision.*is null'
  ),
  'materialized rule ID and revision are both null or both present'
);

select is_empty($$
  with required(table_name, first_column, actor_kind_column) as (
    values
      ('notification_rules', 'created_by', 'created_actor_kind'),
      ('notification_rules', 'updated_by', 'updated_actor_kind'),
      ('notification_templates', 'created_by', 'created_actor_kind'),
      ('notification_audit_logs', 'actor_profile_id', 'actor_kind')
  )
  select required.table_name, required.actor_kind_column
  from required
  where not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = pg_catalog.to_regclass('dashboard_private.' || required.table_name)
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* required.first_column
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* required.actor_kind_column
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* '''user'''
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* '''system'''
  )
$$, 'user actors require profiles and system actors require null profiles');

select throws_ok(
  $$
    insert into dashboard_private.notification_rules(
      id, scope_key, workflow_key, event_key, channel_key, audience_key,
      rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
      active_template_id, revision, created_by, created_actor_kind,
      updated_by, updated_actor_kind
    ) values (
      '51000000-0000-4000-8000-000000000001',
      'global', 'tasks', 'task.created', 'in_app', 'requester_profile',
      'immediate', 'immediate', null, null, false,
      '51000000-0000-4000-8000-000000000002', 1,
      null, 'user', null, 'system'
    )
  $$,
  '23514',
  null,
  'a user rule creator cannot omit the verified profile'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_templates(
      id, rule_id, version, title_template, body_template, allowed_variables,
      payload_schema_version, checksum, created_by, created_actor_kind
    ) values (
      '51000000-0000-4000-8000-000000000003',
      '51000000-0000-4000-8000-000000000004',
      1, 'title', 'body', '[]'::jsonb, 1, 'fixture-checksum', null, 'user'
    )
  $$,
  '23514',
  null,
  'a user template creator cannot omit the verified profile'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_audit_logs(
      id, scope_key, entity_kind, entity_id, action,
      actor_profile_id, actor_kind, request_id,
      before_summary, after_summary, reason_code
    ) values (
      '51000000-0000-4000-8000-000000000005',
      'global', 'rule', 'fixture-rule', 'fixture_action',
      null, 'user', null, null, null, null
    )
  $$,
  '23514',
  null,
  'a user audit actor cannot omit the verified profile'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_events(
      id, scope_key, workflow_key, event_key, source_type, source_id,
      source_revision, occurrence_key, actor_profile_id, occurred_at,
      payload_schema_version, payload, rule_snapshot,
      materialized_rule_id, materialized_rule_revision
    ) values (
      '51000000-0000-4000-8000-000000000006',
      'global', 'tasks', 'task.created', 'ops_task_event', 'fixture-source',
      null, 'fixture-occurrence', null, pg_catalog.now(),
      1, '{}'::jsonb, '[]'::jsonb,
      '51000000-0000-4000-8000-000000000007', null
    )
  $$,
  '23514',
  null,
  'materialized rule ID and revision cannot be only partially present'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_events(
      id, scope_key, workflow_key, event_key, source_type, source_id,
      source_revision, occurrence_key, actor_profile_id, occurred_at,
      payload_schema_version, payload, rule_snapshot,
      materialized_rule_id, materialized_rule_revision
    ) values (
      '51000000-0000-4000-8000-000000000008',
      'global', 'tasks', 'task.created', 'ops_task_event', 'fixture-source-reverse',
      null, 'fixture-occurrence-reverse', null, pg_catalog.now(),
      1, '{}'::jsonb, '[]'::jsonb,
      null, 1
    )
  $$,
  '23514',
  null,
  'materialized rule revision cannot exist without its rule ID'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_rules(
      id, scope_key, workflow_key, event_key, channel_key, audience_key,
      rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
      active_template_id, revision, created_by, created_actor_kind,
      updated_by, updated_actor_kind
    ) values (
      '52000000-0000-4000-8000-000000000001',
      'global', 'tasks', 'task.created', 'in_app', 'requester_profile',
      'immediate', 'immediate', null, null, true,
      '52000000-0000-4000-8000-000000000002', 1,
      null, 'system', null, 'system'
    )
  $$,
  'status fixture rule satisfies the deferred active-template contract'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_templates(
      id, rule_id, version, title_template, body_template, allowed_variables,
      payload_schema_version, checksum, created_by, created_actor_kind
    ) values (
      '52000000-0000-4000-8000-000000000002',
      '52000000-0000-4000-8000-000000000001',
      1, 'fixture title', 'fixture body', '[]'::jsonb,
      1, 'fixture-checksum', null, 'system'
    )
  $$,
  'status fixture template belongs to its rule'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_events(
      id, scope_key, workflow_key, event_key, source_type, source_id,
      source_revision, occurrence_key, actor_profile_id, occurred_at,
      payload_schema_version, payload, rule_snapshot,
      materialized_rule_id, materialized_rule_revision
    ) values (
      '52000000-0000-4000-8000-000000000003',
      'global', 'tasks', 'task.created', 'ops_task_event', 'fixture-source',
      null, 'fixture-status-occurrence', null, pg_catalog.now(),
      1, '{}'::jsonb, '[]'::jsonb, null, null
    )
  $$,
  'status fixture event is canonical'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, next_attempt_at, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000101',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-101',
      '{}'::jsonb, 'retry_wait', 'provider_rate_limited', 'fixture-dedupe-101',
      'title', 'body', pg_catalog.now(), pg_catalog.now(), 0, 3
    )
  $$,
  'retry_wait accepts only a member of its reason family'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000102',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-102',
      '{}'::jsonb, 'failed', 'connection_missing', 'fixture-dedupe-102',
      'title', 'body', pg_catalog.now(), 0, 3
    )
  $$,
  'failed accepts only a member of its reason family'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, next_attempt_at, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000103',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-103',
      '{}'::jsonb, 'retry_wait', 'connection_missing', 'fixture-dedupe-103',
      'title', 'body', pg_catalog.now(), pg_catalog.now(), 0, 3
    )
  $$,
  '23514',
  null,
  'a reason registered for failed cannot be attached to retry_wait'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000104',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-104',
      '{}'::jsonb, 'pending', 'provider_rate_limited', 'fixture-dedupe-104',
      'title', 'body', pg_catalog.now(), 0, 3
    )
  $$,
  '23514',
  null,
  'normal delivery states reject every non-null reason'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, next_attempt_at, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000105',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-105',
      '{}'::jsonb, 'retry_wait', '', 'fixture-dedupe-105',
      'title', 'body', pg_catalog.now(), pg_catalog.now(), 0, 3
    )
  $$,
  '23514',
  null,
  'an empty reason cannot bypass the closed status-reason registry'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000106',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-106',
      '{}'::jsonb, 'retry_wait', 'provider_rate_limited', 'fixture-dedupe-106',
      'title', 'body', pg_catalog.now(), 0, 3
    )
  $$,
  '23514',
  null,
  'retry_wait cannot omit next_attempt_at'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, attempt_count, max_attempts
    ) values (
      '52000000-0000-4000-8000-000000000107',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-107',
      '{}'::jsonb, 'claimed', null, 'fixture-dedupe-107',
      'title', 'body', pg_catalog.now(), 0, 3
    )
  $$,
  '23514',
  null,
  'claimed delivery cannot omit its complete lease triple'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_deliveries(
      id, event_id, rule_id, rule_revision, template_id, channel_key,
      audience_key, target_generation, target_set_hash, target_kind, target_key,
      target_snapshot, status, status_reason, dedupe_key, rendered_title,
      rendered_body, scheduled_for, attempt_count, max_attempts,
      claimed_by, claim_token, lease_expires_at
    ) values (
      '52000000-0000-4000-8000-000000000108',
      '52000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001', 1,
      '52000000-0000-4000-8000-000000000002', 'in_app',
      'requester_profile', 0, 'fixture-target-set', 'profile', 'fixture-target-108',
      '{}'::jsonb, 'pending', null, 'fixture-dedupe-108',
      'title', 'body', pg_catalog.now(), 0, 3,
      'fixture-worker', '52000000-0000-4000-8000-000000000109', pg_catalog.now()
    )
  $$,
  '23514',
  null,
  'pending delivery cannot carry a claim lease'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_event_fanout_jobs(
      id, event_id, workflow_key, status, next_attempt_at
    ) values (
      '54000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000003',
      'tasks', 'claimed', null
    )
  $$,
  '23514',
  null,
  'claimed fanout queue work cannot omit its complete lease triple'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_rule_reconciliation_jobs(
      id, workflow_key, rule_revision_map, status,
      claimed_by, claim_token, lease_expires_at
    ) values (
      '54000000-0000-4000-8000-000000000002',
      'tasks', '{}'::jsonb, 'pending',
      'fixture-worker', '54000000-0000-4000-8000-000000000003', pg_catalog.now()
    )
  $$,
  '23514',
  null,
  'pending rule reconciliation queue work cannot carry a claim lease'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_target_reconciliation_jobs(
      id, workflow_key, source_type, source_id, source_revision, source_event_id,
      reconciliation_kind, target_generation, previous_target_set_hash,
      current_target_set_hash, status
    ) values (
      '54000000-0000-4000-8000-000000000004',
      'tasks', 'ops_task_event', 'fixture-source', null,
      '54000000-0000-4000-8000-000000000005',
      'recipient_set_changed', 1, null, 'fixture-current-hash', 'succeeded'
    )
  $$,
  '23514',
  null,
  'terminal target reconciliation queue work must clear next_attempt_at and lease fields'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_dispatch_ownership_claims(
      id, workflow_key, occurrence_key, rule_id, channel_key, target_key,
      target_generation, owner_kind, owner_generation, state,
      dispatch_started_at, dispatch_token
    ) values (
      '53000000-0000-4000-8000-000000000001',
      'tasks', 'fixture-owner-reserved',
      '52000000-0000-4000-8000-000000000001', 'in_app', 'fixture-owner-target-1',
      0, 'canonical', 0, 'reserved', null, null
    )
  $$,
  'reserved ownership has no dispatch token before provider or inbox work begins'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_dispatch_ownership_claims(
      id, workflow_key, occurrence_key, rule_id, channel_key, target_key,
      target_generation, owner_kind, owner_generation, state,
      dispatch_started_at, dispatch_token
    ) values (
      '53000000-0000-4000-8000-000000000002',
      'tasks', 'fixture-owner-started',
      '52000000-0000-4000-8000-000000000001', 'in_app', 'fixture-owner-target-2',
      0, 'canonical', 0, 'dispatch_started', pg_catalog.now(),
      '53000000-0000-4000-8000-000000000003'
    )
  $$,
  'dispatch-started ownership persists the token later finalize and commit must verify'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_dispatch_ownership_claims(
      id, workflow_key, occurrence_key, rule_id, channel_key, target_key,
      target_generation, owner_kind, owner_generation, state,
      dispatch_started_at, dispatch_token
    ) values (
      '53000000-0000-4000-8000-000000000004',
      'tasks', 'fixture-owner-token-missing',
      '52000000-0000-4000-8000-000000000001', 'in_app', 'fixture-owner-target-3',
      0, 'canonical', 0, 'dispatch_started', pg_catalog.now(), null
    )
  $$,
  '23514',
  null,
  'dispatch-started ownership cannot omit its dispatch token'
);

-- Delivery status/reason checks contain the closed registry rather than an
-- unconstrained provider string.
select is_empty($$
  with expected(value) as (
    values
      ('pending'), ('claimed'), ('sending'), ('retry_wait'), ('sent'),
      ('delivery_unknown'), ('failed'), ('skipped'), ('disabled'), ('canceled'),
      ('provider_rate_limited'), ('provider_definite_rejection'),
      ('transient_pre_dispatch_failure'), ('connection_restored_manual_retry'),
      ('manual_retry_approved'), ('provider_timeout_after_dispatch'),
      ('connection_reset_after_dispatch'), ('worker_lost_after_send_start'),
      ('provider_ambiguous_response'), ('connection_missing'),
      ('render_validation_failed'), ('schedule_validation_failed'),
      ('payload_schema_unsupported'), ('max_attempts_exhausted'),
      ('retry_window_closed'), ('shadow_mode'), ('no_recipient'),
      ('workflow_scope_mismatch'), ('not_applicable'), ('legacy_skipped'),
      ('legacy_deduped'), ('rule_disabled'), ('source_status_changed'),
      ('source_schedule_changed'), ('source_revision_changed'),
      ('rule_revision_changed'), ('recipient_revoked'), ('cutover_rollback')
  ), definitions as (
    select pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(oid), ' ') as source
    from pg_catalog.pg_constraint
    where conrelid = 'dashboard_private.notification_deliveries'::regclass
      and contype = 'c'
  )
  select expected.value
  from expected
  cross join definitions
  where position(expected.value in coalesce(definitions.source, '')) = 0
$$, 'delivery checks contain the complete closed status/reason registry');

-- Heartbeats expose a fixed numeric count map and no PII-bearing columns.
select is_empty($$
  select column_name
  from information_schema.columns
  where table_schema = 'dashboard_private'
    and table_name = 'notification_worker_heartbeats'
    and column_name ~ '(payload|body|target|connection|secret|phone|webhook)'
$$, 'worker heartbeat schema contains no PII or provider payload column');

select lives_ok(
  $$
    insert into dashboard_private.notification_worker_heartbeats(
      id, worker_id, run_id, phase, counts, error_code
    ) values (
      '50000000-0000-4000-8000-000000000001',
      'schema-test-worker',
      '50000000-0000-4000-8000-000000000002',
      'started',
      '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
      null
    )
  $$,
  'closed numeric heartbeat count map is accepted'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_worker_heartbeats(
      id, worker_id, run_id, phase, counts, error_code
    ) values (
      '50000000-0000-4000-8000-000000000003',
      'schema-test-worker',
      '50000000-0000-4000-8000-000000000004',
      'failed',
      '{"body":1}'::jsonb,
      'fixture_failure'
    )
  $$,
  '23514',
  null,
  'heartbeat counts reject body, payload, target, and all unknown keys'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_worker_heartbeats(
      id, worker_id, run_id, phase, counts, error_code
    ) values (
      '50000000-0000-4000-8000-000000000005',
      'schema-test-worker',
      '50000000-0000-4000-8000-000000000006',
      'started',
      '{"fanout":-1,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
      null
    )
  $$,
  '23514',
  null,
  'heartbeat metrics reject negative and non-counter values'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_worker_heartbeats(
      id, worker_id, run_id, phase, counts, error_code
    ) values (
      '50000000-0000-4000-8000-000000000007',
      'schema-test-worker',
      '50000000-0000-4000-8000-000000000008',
      'running',
      '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
      null
    )
  $$,
  '23514',
  null,
  'heartbeat phase is closed to started, succeeded, or failed'
);

select lives_ok(
  $$
    insert into dashboard_private.notification_worker_heartbeats(
      id, worker_id, run_id, phase, counts, error_code
    ) values (
      '50000000-0000-4000-8000-000000000009',
      'schema-test-worker',
      '50000000-0000-4000-8000-000000000002',
      'succeeded',
      '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
      null
    )
  $$,
  'one terminal heartbeat is accepted after started'
);

select throws_ok(
  $$
    insert into dashboard_private.notification_worker_heartbeats(
      id, worker_id, run_id, phase, counts, error_code
    ) values (
      '50000000-0000-4000-8000-000000000010',
      'schema-test-worker',
      '50000000-0000-4000-8000-000000000002',
      'failed',
      '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
      'fixture_failure'
    )
  $$,
  '23505',
  null,
  'the same run cannot record both succeeded and failed terminal heartbeats'
);

-- The runtime registry is exact, server-authoritative, and entirely off.
select set_eq(
  $$select flag_key from dashboard_private.notification_runtime_flags$$,
  $$
    values
      ('notification_control_plane_settings_ui_enabled'),
      ('notification_control_plane_shadow_write_enabled'),
      ('notification_control_plane_dispatch_tasks_enabled'),
      ('notification_control_plane_dispatch_word_retests_enabled'),
      ('notification_control_plane_dispatch_registration_enabled'),
      ('notification_control_plane_registration_phone_adapter_enabled'),
      ('notification_control_plane_registration_visit_adapter_enabled'),
      ('notification_control_plane_registration_solapi_adapter_enabled'),
      ('notification_control_plane_dispatch_transfer_enabled'),
      ('notification_control_plane_dispatch_withdrawal_enabled'),
      ('notification_control_plane_dispatch_makeup_requests_enabled'),
      ('notification_control_plane_dispatch_approvals_enabled')
  $$,
  'runtime flag registry contains exactly the twelve approved keys'
);

select is(
  (select count(*) from dashboard_private.notification_runtime_flags),
  12::bigint,
  'runtime flag registry has exactly twelve rows'
);
select is(
  (select count(*) from dashboard_private.notification_runtime_flags where enabled),
  0::bigint,
  'all runtime flags install false'
);
select ok(
  (select pg_catalog.bool_and(revision > 0) from dashboard_private.notification_runtime_flags),
  'all runtime flags start with positive optimistic revisions'
);
-- Per-profile read receipts retain historical row read_at as compatibility
-- data but expose only caller-owned receipt reads.
select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.dashboard_notification_read_receipts'::regclass
  ),
  'read receipts enable RLS'
);
select ok(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.dashboard_notification_read_receipts',
    'SELECT'
  ),
  'authenticated callers may select receipt rows through own-profile RLS'
);
select is(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.dashboard_notification_read_receipts',
    'INSERT'
  ),
  false,
  'authenticated callers cannot insert receipts directly'
);
select is(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.dashboard_notification_read_receipts',
    'UPDATE'
  ),
  false,
  'authenticated callers cannot update receipts directly'
);
select is(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.dashboard_notification_read_receipts',
    'DELETE'
  ),
  false,
  'authenticated callers cannot delete receipts directly'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = 'public.dashboard_notification_read_receipts'::regclass
      and contype = 'p'
      and pg_catalog.pg_get_constraintdef(oid) ~* 'primary key \(notification_id, profile_id\)'
  ),
  1::bigint,
  'receipt primary key is notification/profile'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'dashboard_notification_read_receipts'
      and policyname = 'dashboard_notification_read_receipts_select_own'
      and cmd = 'SELECT'
      and roles::text ~ 'authenticated'
      and qual ~* 'profile_id.*auth\.uid|auth\.uid.*profile_id'
  ),
  1::bigint,
  'receipt select policy is caller-profile-only'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'dashboard_notification_read_receipts'
  ),
  1::bigint,
  'receipt exposes exactly one own-profile SELECT policy and no additive permissive policy'
);
select ok(
  pg_catalog.to_regclass('public.dashboard_notification_read_receipts_profile_idx') is not null,
  'receipt profile lookup has a supporting index'
);

select is_empty($$
  with expected(column_name) as (
    values ('source_delivery_id'), ('revoked_at'), ('revoked_reason'), ('read_at')
  )
  select expected.column_name
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'dashboard_notifications'
   and actual.column_name = expected.column_name
  where actual.column_name is null
$$, 'inbox compatibility and historical read columns remain present');
select ok(
  pg_catalog.to_regclass('public.dashboard_notifications_source_delivery_id_uidx') is not null,
  'one inbox projection exists per canonical source delivery'
);

select is_empty($$
  with expected(column_name) as (
    values
      ('webhook_url'),
      ('webhook_url_ciphertext'),
      ('webhook_url_mask'),
      ('connection_state'),
      ('revision'),
      ('updated_by'),
      ('last_verified_at'),
      ('last_error_code')
  )
  select expected.column_name
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'google_chat_webhook_settings'
   and actual.column_name = expected.column_name
  where actual.column_name is null
$$, 'Google Chat compatibility row expands without renaming its legacy key or secret column');
select is_empty($$
  with expected(column_name, udt_name, is_nullable) as (
    values
      ('webhook_url_ciphertext', 'text', 'YES'),
      ('webhook_url_mask', 'text', 'YES'),
      ('connection_state', 'text', 'NO'),
      ('revision', 'int8', 'NO'),
      ('updated_by', 'uuid', 'YES'),
      ('last_verified_at', 'timestamptz', 'YES'),
      ('last_error_code', 'text', 'YES')
  )
  select expected.column_name, actual.udt_name, actual.is_nullable
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'google_chat_webhook_settings'
   and actual.column_name = expected.column_name
  where actual.column_name is null
     or actual.udt_name <> expected.udt_name
     or actual.is_nullable <> expected.is_nullable
$$, 'Google Chat compatibility columns keep exact encryption-state types and nullability');
select ok(
  (
    select column_default ~* 'legacy_active'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_chat_webhook_settings'
      and column_name = 'connection_state'
  ),
  'existing Google Chat rows retain the legacy-active compatibility reader'
);
select ok(
  (
    select column_default ~ '1'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_chat_webhook_settings'
      and column_name = 'revision'
  ),
  'Google Chat connection revisions start positive'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.google_chat_webhook_settings'::regclass
      and constraint_row.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~* 'foreign key \(updated_by\).*profiles\(id\).*on delete set null'
  ),
  'Google Chat connection updater remains a nullable verified profile foreign key'
);
select is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_chat_webhook_settings'
      and column_name = 'webhook_url'
  ),
  'NO',
  'expand migration preserves legacy webhook_url NOT NULL'
);

-- Existing browser/service grants stay open until the fixed-purpose bridge and
-- closure migration land.
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_notifications', 'SELECT'), 'legacy inbox select remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_notifications', 'INSERT'), 'legacy inbox insert remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_notifications', 'UPDATE'), 'legacy inbox update remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_push_subscriptions', 'SELECT'), 'push subscription select remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_push_subscriptions', 'INSERT'), 'push subscription insert remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_push_subscriptions', 'UPDATE'), 'push subscription update remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.dashboard_push_subscriptions', 'DELETE'), 'push subscription delete remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.makeup_notification_settings', 'SELECT'), 'makeup settings select remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.makeup_notification_settings', 'INSERT'), 'makeup settings insert remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.makeup_notification_settings', 'UPDATE'), 'makeup settings update remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.makeup_notification_deliveries', 'SELECT'), 'makeup delivery select remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.makeup_notification_deliveries', 'INSERT'), 'makeup delivery insert remains');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.ops_registration_messages', 'SELECT'), 'registration message status read remains');
select ok(pg_catalog.has_table_privilege('service_role', 'public.google_chat_webhook_settings', 'SELECT'), 'Google Chat compatibility select remains');
select ok(pg_catalog.has_table_privilege('service_role', 'public.google_chat_webhook_settings', 'INSERT'), 'Google Chat compatibility insert remains');
select ok(pg_catalog.has_table_privilege('service_role', 'public.google_chat_webhook_settings', 'UPDATE'), 'Google Chat compatibility update remains');
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_registration_admission_message(uuid,text)',
    'EXECUTE'
  ),
  'registration admission-message claim remains authenticated'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_registration_admission_message(uuid,text,jsonb)',
    'EXECUTE'
  ),
  'registration admission-message finalize remains service-role-only callable'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reconcile_registration_admission_message(uuid,text,jsonb,text,text)',
    'EXECUTE'
  ),
  'registration admission-message reconcile remains authenticated'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.release_registration_admission_message_retry(uuid,jsonb,text,text)',
    'EXECUTE'
  ),
  'registration admission-message retry release remains authenticated'
);

-- Optional live-only relations are represented only by guarded metadata. This
-- assertion passes in both absent local schemas and linked schemas where either
-- relation exists; no legacy row is copied into the canonical tables.
select is(
  (select count(*) from dashboard_private.notification_legacy_import_sources),
  2::bigint,
  'exactly the two approved optional legacy source names are registered'
);
select is(
  (
    select source_present
    from dashboard_private.notification_legacy_import_sources
    where source_table = 'public.ops_task_notification_deliveries'
  ),
  pg_catalog.to_regclass('public.ops_task_notification_deliveries') is not null,
  'ops_task_notification_deliveries absent/present state is guarded by to_regclass'
);
select is(
  (
    select source_present
    from dashboard_private.notification_legacy_import_sources
    where source_table = 'public.ops_task_automation_runs'
  ),
  pg_catalog.to_regclass('public.ops_task_automation_runs') is not null,
  'ops_task_automation_runs absent/present state is guarded by to_regclass'
);
select is_empty($$
  select column_name
  from information_schema.columns
  where table_schema = 'dashboard_private'
    and table_name = 'notification_legacy_import_sources'
    and column_name ~ '(payload|row_data|snapshot|body|target)'
$$, 'optional legacy registration stores metadata only and performs no destructive backfill');

-- In the normal isolated test schema the optional relation is absent. Create a
-- transaction-scoped public fixture only when absent, prove the read-only view
-- detects it, then remove the fixture and prove the original absent state is
-- restored. A linked schema that already owns the relation is never mutated.
create temporary table notification_optional_source_fixture_state (
  source_table text primary key,
  created_for_test boolean not null
) on commit drop;

do $fixture$
begin
  if pg_catalog.to_regclass('public.ops_task_notification_deliveries') is null then
    execute 'create table public.ops_task_notification_deliveries (id uuid primary key)';
    insert into notification_optional_source_fixture_state(source_table, created_for_test)
    values ('public.ops_task_notification_deliveries', true);
  else
    insert into notification_optional_source_fixture_state(source_table, created_for_test)
    values ('public.ops_task_notification_deliveries', false);
  end if;
end
$fixture$;

select is(
  (
    select source_present
    from dashboard_private.notification_legacy_import_sources
    where source_table = 'public.ops_task_notification_deliveries'
  ),
  true,
  'optional-source view detects a present relation without reading its rows'
);

do $fixture$
begin
  if (
    select created_for_test
    from notification_optional_source_fixture_state
    where source_table = 'public.ops_task_notification_deliveries'
  ) then
    execute 'drop table public.ops_task_notification_deliveries';
  end if;
end
$fixture$;

select is(
  (
    select source_present
    from dashboard_private.notification_legacy_import_sources
    where source_table = 'public.ops_task_notification_deliveries'
  ),
  pg_catalog.to_regclass('public.ops_task_notification_deliveries') is not null,
  'optional-source view returns to the original absent or present state'
);

do $fixture$
begin
  if pg_catalog.to_regclass('public.ops_task_automation_runs') is null then
    execute 'create table public.ops_task_automation_runs (id uuid primary key)';
    insert into notification_optional_source_fixture_state(source_table, created_for_test)
    values ('public.ops_task_automation_runs', true);
  else
    insert into notification_optional_source_fixture_state(source_table, created_for_test)
    values ('public.ops_task_automation_runs', false);
  end if;
end
$fixture$;

select is(
  (
    select source_present
    from dashboard_private.notification_legacy_import_sources
    where source_table = 'public.ops_task_automation_runs'
  ),
  true,
  'automation-run optional-source view detects a present relation without reading its rows'
);

do $fixture$
begin
  if (
    select created_for_test
    from notification_optional_source_fixture_state
    where source_table = 'public.ops_task_automation_runs'
  ) then
    execute 'drop table public.ops_task_automation_runs';
  end if;
end
$fixture$;

select is(
  (
    select source_present
    from dashboard_private.notification_legacy_import_sources
    where source_table = 'public.ops_task_automation_runs'
  ),
  pg_catalog.to_regclass('public.ops_task_automation_runs') is not null,
  'automation-run optional-source view returns to the original absent or present state'
);

select * from finish();
rollback;
