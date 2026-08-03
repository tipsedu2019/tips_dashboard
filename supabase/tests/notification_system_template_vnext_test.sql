begin;
select plan(28);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

create or replace function pg_temp.notification_relation_snapshot(p_relation regclass)
returns jsonb
language plpgsql
stable
as $$
declare
  v_snapshot jsonb;
begin
  execute pg_catalog.format(
    'select coalesce(jsonb_agg(row_value order by row_value::text), ''[]''::jsonb)
       from (select to_jsonb(source_row) as row_value from %s source_row) rows',
    p_relation
  ) into v_snapshot;
  return v_snapshot;
end;
$$;

create or replace function pg_temp.notification_operational_snapshot()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'events', pg_temp.notification_relation_snapshot('dashboard_private.notification_events'),
    'rules', pg_temp.notification_relation_snapshot('dashboard_private.notification_rules'),
    'templates', pg_temp.notification_relation_snapshot('dashboard_private.notification_templates'),
    'runtime_flags', pg_temp.notification_relation_snapshot('dashboard_private.notification_runtime_flags'),
    'dispatch_owners', pg_temp.notification_relation_snapshot('dashboard_private.notification_dispatch_ownership_claims'),
    'deliveries', pg_temp.notification_relation_snapshot('dashboard_private.notification_deliveries'),
    'inbox', pg_temp.notification_relation_snapshot('public.dashboard_notifications'),
    'provider_attempts', pg_temp.notification_relation_snapshot('public.makeup_notification_deliveries'),
    'rule_reconciliation', pg_temp.notification_relation_snapshot('dashboard_private.notification_rule_reconciliation_jobs'),
    'target_reconciliation', pg_temp.notification_relation_snapshot('dashboard_private.notification_target_reconciliation_jobs')
  );
$$;

-- 1-4: API and ACL boundary.
select has_function(
  'dashboard_private',
  'notification_system_template_vnext_payload_v1',
  array['text'],
  'reviewed event-template lookup exists'
);
select has_function(
  'dashboard_private',
  'install_notification_system_templates_vnext_v1',
  array[]::text[],
  'append-only vNext installer exists'
);
select has_function(
  'public',
  'audit_notification_content_templates_v1',
  array['text', 'uuid'],
  'read-only content audit RPC exists'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.audit_notification_content_templates_v1(text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.audit_notification_content_templates_v1(text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.audit_notification_content_templates_v1(text,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.install_notification_system_templates_vnext_v1()',
    'EXECUTE'
  ),
  'only service_role can enter the public audit and no API role can rerun the installer'
);

-- 5-10: one exact system baseline per registry-derived identity.
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_templates template_row
    where template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      template_row.rule_id::text || '|content-contract-'
        || template_row.content_contract_version
    )
  ),
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_rule_content_contracts
  ),
  'one vNext template exists for every registry-derived content identity'
);
select is_empty($$
  select contract_row.rule_id
  from dashboard_private.notification_rule_content_contracts contract_row
  left join dashboard_private.notification_templates template_row
    on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      contract_row.rule_id::text || '|content-contract-'
        || contract_row.contract_version
    )
   and template_row.rule_id = contract_row.rule_id
  where template_row.id is null
$$, 'every baseline uses the deterministic full rule-and-contract identity');
select is_empty($$
  select contract_row.rule_id
  from dashboard_private.notification_rule_content_contracts contract_row
  join lateral dashboard_private.notification_system_template_vnext_payload_v1(
    contract_row.event_key
  ) payload on true
  join dashboard_private.notification_templates template_row
    on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      contract_row.rule_id::text || '|content-contract-'
        || contract_row.contract_version
    )
  where payload.workflow_key <> contract_row.workflow_key
    or template_row.title_template <> payload.title_template
    or template_row.body_template <> payload.body_template
$$, 'every identity stores the reviewed exact title and body');
select is_empty($$
  select contract_row.rule_id
  from dashboard_private.notification_rule_content_contracts contract_row
  join dashboard_private.notification_templates template_row
    on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      contract_row.rule_id::text || '|content-contract-'
        || contract_row.contract_version
    )
  where template_row.allowed_variables <> contract_row.contract_json -> 'availableVariables'
    or template_row.payload_schema_version <> (
      select pg_catalog.max(payload_version.value::integer)
      from pg_catalog.jsonb_array_elements_text(
        contract_row.contract_json -> 'supportedPayloadVersions'
      ) payload_version(value)
    )
    or template_row.content_contract_version <> contract_row.contract_version
    or template_row.created_by is not null
    or template_row.created_actor_kind <> 'system'
    or template_row.checksum <> dashboard_private.notification_seed_template_checksum_v1(
      template_row.title_template,
      template_row.body_template,
      template_row.allowed_variables,
      template_row.payload_schema_version
    )
$$, 'vNext snapshots the latest allowlist, payload contract, system creator, and SHA-256 checksum');
select is_empty($$
  select rule_row.id
  from dashboard_private.notification_rules rule_row
  join dashboard_private.notification_templates template_row
    on template_row.id = rule_row.active_template_id
  where template_row.id = dashboard_private.notification_deterministic_uuid_v1(
    'notification-template-vnext-v1',
    template_row.rule_id::text || '|content-contract-'
      || template_row.content_contract_version
  )
$$, 'installing vNext changes zero active template pointers');
select ok(
  (
    select pg_catalog.bool_and(template_row.version > 1)
    from dashboard_private.notification_templates template_row
    where template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      template_row.rule_id::text || '|content-contract-'
        || template_row.content_contract_version
    )
  ),
  'vNext is appended after every historical version'
);

-- 11-12: repeat install is a complete operational no-op.
create temp table notification_vnext_before(snapshot jsonb) on commit drop;
insert into notification_vnext_before values (pg_temp.notification_operational_snapshot());

select is(
  dashboard_private.install_notification_system_templates_vnext_v1() ->> 'inserted_count',
  '0',
  're-running the installer inserts no duplicate version'
);
select dashboard_private.install_notification_system_templates_vnext_v1();
select is(
  pg_temp.notification_operational_snapshot(),
  (select snapshot from notification_vnext_before),
  'repeat install leaves rules, templates, owners, flags, deliveries, inbox, attempts, and jobs byte-for-byte unchanged'
);

-- 13: browser roles cannot enter the service-only audit.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.audit_notification_content_templates_v1(
      'task12-baseline',
      '31500000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'permission denied for function audit_notification_content_templates_v1',
  'authenticated callers cannot audit private template state'
);
reset role;

-- 14-21: service audit covers the whole derived registry and is idempotent.
create temp table notification_vnext_audit_result(result jsonb) on commit drop;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into notification_vnext_audit_result
select public.audit_notification_content_templates_v1(
  'task12-baseline',
  '31500000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_array_length(result)
    from notification_vnext_audit_result
  ),
  (
    select pg_catalog.count(*)::integer
    from dashboard_private.notification_rule_content_contracts
  ),
  'audit returns one result for every registry-derived identity without a fixed count'
);
select is_empty($$
  select result_key.key
  from notification_vnext_audit_result audit_result
  cross join lateral pg_catalog.jsonb_array_elements(audit_result.result) item(value)
  cross join lateral pg_catalog.jsonb_object_keys(item.value) result_key(key)
  where result_key.key not in (
    'workflow_label',
    'event_label',
    'channel_label',
    'audience_label',
    'rule_variant_label',
    'compliance',
    'violations'
  )
$$, 'audit results expose only safe labels, compliance, and violations');
select is_empty($$
  select item.value
  from notification_vnext_audit_result audit_result
  cross join lateral pg_catalog.jsonb_array_elements(audit_result.result) item(value)
  where item.value ->> 'compliance' not in (
    'conformant',
    'legacy_custom_nonconformant'
  )
    or pg_catalog.jsonb_typeof(item.value -> 'violations') <> 'array'
$$, 'every audit result uses the two-state compliance vocabulary');
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_template_compliance_audits audit_row
    join dashboard_private.notification_rules rule_row
      on rule_row.id = audit_row.rule_id
     and rule_row.active_template_id = audit_row.template_id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
     and contract_row.contract_version = audit_row.contract_version
  ),
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_rule_content_contracts
  ),
  'audit persists one compliance record for every active in-scope template'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit_log
    where audit_log.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-content-template-audit-v1',
      'task12-baseline|31500000-0000-4000-8000-000000000001'
    )
  ),
  1::bigint,
  'audit writes one deterministic request record'
);

create temp table notification_vnext_audit_count_before as
select pg_catalog.count(*) as count
from dashboard_private.notification_template_compliance_audits;
create temp table notification_vnext_audit_repeat(result jsonb) on commit drop;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into notification_vnext_audit_repeat
select public.audit_notification_content_templates_v1(
  'task12-baseline',
  '31500000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (select result from notification_vnext_audit_repeat),
  (select result from notification_vnext_audit_result),
  'same request and release state returns the same ordered audit result'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_template_compliance_audits
  ),
  (select count from notification_vnext_audit_count_before),
  'repeat audit creates no duplicate template compliance row'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit_log
    where audit_log.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-content-template-audit-v1',
      'task12-baseline|31500000-0000-4000-8000-000000000001'
    )
  ),
  1::bigint,
  'repeat audit creates no duplicate request record'
);
select is_empty($$
  select audit_log.id
  from dashboard_private.notification_audit_logs audit_log
  where audit_log.action = 'audit_notification_content_templates_v1'
    and (
      audit_log.actor_kind <> 'system'
      or audit_log.actor_profile_id is not null
      or audit_log.before_summary is not null
    )
$$, 'audit records only safe system summary metadata');

-- User-owned active templates for custom-protection checks.
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '31500000-0000-4000-8000-000000000010',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'notification-vnext-admin@runtime.invalid',
  crypt('notification-vnext-runtime-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"notification-system-template-vnext"}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '31500000-0000-4000-8000-000000000010',
  'admin',
  '알림 권장본 관리자',
  'notification-vnext-admin@runtime.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

with selected_rule as (
  select registry.rule_id
  from dashboard_private.notification_settings_ui_registry registry
  where registry.event_key = 'task.due_changed'
    and registry.audience_key = 'management_team'
    and registry.channel_key = 'google_chat'
    and registry.rule_variant_key = 'immediate'
), baseline as (
  select template_row.*
  from selected_rule
  join dashboard_private.notification_rule_content_contracts contract_row
    on contract_row.rule_id = selected_rule.rule_id
  join dashboard_private.notification_templates template_row
    on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      selected_rule.rule_id::text || '|content-contract-'
        || contract_row.contract_version
    )
)
insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind,
  content_contract_version
)
select
  '31500000-0000-4000-8000-000000000011',
  baseline.rule_id,
  (select pg_catalog.max(version) + 1 from dashboard_private.notification_templates where rule_id = baseline.rule_id),
  pg_catalog.replace(baseline.title_template, '[할 일]', '[업무]'),
  baseline.body_template,
  baseline.allowed_variables,
  baseline.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    pg_catalog.replace(baseline.title_template, '[할 일]', '[업무]'),
    baseline.body_template,
    baseline.allowed_variables,
    baseline.payload_schema_version
  ),
  '31500000-0000-4000-8000-000000000010',
  'user',
  baseline.content_contract_version
from baseline;

with selected_rule as (
  select registry.rule_id
  from dashboard_private.notification_settings_ui_registry registry
  where registry.event_key = 'task.created'
    and registry.audience_key = 'management_team'
    and registry.channel_key = 'google_chat'
    and registry.rule_variant_key = 'immediate'
), baseline as (
  select template_row.*
  from selected_rule
  join dashboard_private.notification_rule_content_contracts contract_row
    on contract_row.rule_id = selected_rule.rule_id
  join dashboard_private.notification_templates template_row
    on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-vnext-v1',
      selected_rule.rule_id::text || '|content-contract-'
        || contract_row.contract_version
    )
)
insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind,
  content_contract_version
)
select
  '31500000-0000-4000-8000-000000000012',
  baseline.rule_id,
  (select pg_catalog.max(version) + 1 from dashboard_private.notification_templates where rule_id = baseline.rule_id),
  '⚠️ [할 일] 설정 상태가 기록됐어요',
  '[업무] {task_title}',
  baseline.allowed_variables,
  baseline.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    '⚠️ [할 일] 설정 상태가 기록됐어요',
    '[업무] {task_title}',
    baseline.allowed_variables,
    baseline.payload_schema_version
  ),
  '31500000-0000-4000-8000-000000000010',
  'user',
  baseline.content_contract_version
from baseline;

update dashboard_private.notification_rules rule_row
set active_template_id = case registry.event_key
      when 'task.due_changed'
        then '31500000-0000-4000-8000-000000000011'::uuid
      else '31500000-0000-4000-8000-000000000012'::uuid
    end,
    revision = rule_row.revision + 1,
    updated_by = '31500000-0000-4000-8000-000000000010',
    updated_actor_kind = 'user',
    updated_at = now()
from dashboard_private.notification_settings_ui_registry registry
where registry.rule_id = rule_row.id
  and registry.event_key in ('task.due_changed', 'task.created')
  and registry.audience_key = 'management_team'
  and registry.channel_key = 'google_chat'
  and registry.rule_variant_key = 'immediate';

create temp table notification_vnext_custom_before(snapshot jsonb) on commit drop;
insert into notification_vnext_custom_before values (pg_temp.notification_operational_snapshot());
create temp table notification_vnext_custom_templates_before(snapshot jsonb) on commit drop;
insert into notification_vnext_custom_templates_before
select pg_catalog.jsonb_agg(to_jsonb(template_row) order by template_row.id)
from dashboard_private.notification_templates template_row
where template_row.id in (
  '31500000-0000-4000-8000-000000000011',
  '31500000-0000-4000-8000-000000000012'
);
select dashboard_private.install_notification_system_templates_vnext_v1();

-- 22-23: installer never overwrites either custom pointer.
select is(
  (
    select rule_row.active_template_id
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry
      on registry.rule_id = rule_row.id
    where registry.event_key = 'task.due_changed'
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
  ),
  '31500000-0000-4000-8000-000000000011'::uuid,
  'conformant custom active pointer remains untouched'
);
select is(
  (
    select rule_row.active_template_id
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry
      on registry.rule_id = rule_row.id
    where registry.event_key = 'task.created'
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
  ),
  '31500000-0000-4000-8000-000000000012'::uuid,
  'legacy nonconformant custom active pointer remains untouched'
);

create temp table notification_vnext_custom_audit(result jsonb) on commit drop;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into notification_vnext_custom_audit
select public.audit_notification_content_templates_v1(
  'task12-custom',
  '31500000-0000-4000-8000-000000000002'
);
reset role;

-- 24-25: custom content is classified by contract, not overwritten by baseline.
select is(
  (
    select item.value ->> 'compliance'
    from notification_vnext_custom_audit audit_result
    cross join lateral pg_catalog.jsonb_array_elements(audit_result.result) item(value)
    join dashboard_private.notification_settings_ui_registry registry
      on item.value ->> 'workflow_label' = registry.workflow_label
     and item.value ->> 'event_label' = registry.event_label
     and item.value ->> 'channel_label' = registry.channel_label
     and item.value ->> 'audience_label' = registry.audience_label
    where registry.event_key = 'task.due_changed'
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
    limit 1
  ),
  'conformant',
  'latest-contract custom wording is reported conformant'
);
select is(
  (
    select item.value ->> 'compliance'
    from notification_vnext_custom_audit audit_result
    cross join lateral pg_catalog.jsonb_array_elements(audit_result.result) item(value)
    join dashboard_private.notification_settings_ui_registry registry
      on item.value ->> 'workflow_label' = registry.workflow_label
     and item.value ->> 'event_label' = registry.event_label
     and item.value ->> 'channel_label' = registry.channel_label
     and item.value ->> 'audience_label' = registry.audience_label
    where registry.event_key = 'task.created'
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
    limit 1
  ),
  'legacy_custom_nonconformant',
  'custom wording missing required facts is reported nonconformant'
);

-- 26-28: audit/install preserve content and operational state; no release API exists.
select is(
  (
    select snapshot
    from notification_vnext_custom_templates_before
  ),
  (
    select pg_catalog.jsonb_agg(to_jsonb(template_row) order by template_row.id)
    from dashboard_private.notification_templates template_row
    where template_row.id in (
      '31500000-0000-4000-8000-000000000011',
      '31500000-0000-4000-8000-000000000012'
    )
  ),
  'custom template rows remain byte-for-byte unchanged'
);
select is(
  pg_temp.notification_operational_snapshot(),
  (select snapshot from notification_vnext_custom_before),
  'custom audit and repeat install leave rule revision, pointers, owners, flags, deliveries, inbox, attempts, and jobs unchanged'
);
select is_empty($$
  select procedure_row.proname
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.proname ~ '^(activate|rollback|release)_notification_content'
$$, 'Task 12 exposes no activation, rollback, or release function');

select * from finish();
rollback;
