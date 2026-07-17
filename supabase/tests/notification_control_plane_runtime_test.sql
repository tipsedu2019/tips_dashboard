begin;
select plan(227);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

-- Task 6 owns the settings/runtime-flag boundary and atomic connection
-- metadata mutations. Task 7 adds delivery/orchestration worker RPCs. Task 8
-- adds the closed settings registry, baseline import, and final runtime marker.

select has_function(
  'public',
  'get_notification_control_plane_v1',
  array['text'],
  'settings snapshot RPC exists'
);
select has_function(
  'public',
  'save_notification_control_plane_v1',
  array['text', 'jsonb', 'jsonb', 'uuid'],
  'settings save RPC exists'
);
select has_function(
  'public',
  'save_notification_control_plane_with_override_v1',
  array['text', 'jsonb', 'jsonb', 'uuid', 'uuid', 'jsonb'],
  'conflict override save RPC exists'
);
select has_function(
  'public',
  'get_notification_runtime_flags_v1',
  array[]::text[],
  'runtime flag read RPC exists'
);
select has_function(
  'public',
  'set_notification_runtime_flag_v1',
  array['text', 'boolean', 'bigint', 'uuid'],
  'runtime flag mutation RPC exists'
);
select has_function(
  'public',
  'backfill_google_chat_connection_encryption_v1',
  array['text', 'bigint', 'text', 'text', 'text'],
  'controlled service-role Google Chat encryption backfill RPC exists'
);
select has_function(
  'public',
  'replace_google_chat_connection_v1',
  array['uuid', 'text', 'text', 'text', 'text', 'bigint', 'uuid'],
  'service-only atomic Google Chat replace RPC requires an explicit actor'
);
select has_function(
  'public',
  'disconnect_google_chat_connection_v1',
  array['uuid', 'text', 'bigint', 'uuid'],
  'service-only atomic Google Chat disconnect RPC requires an explicit actor'
);
select has_function(
  'public',
  'begin_google_chat_connection_verification_v1',
  array['uuid', 'text', 'bigint', 'uuid'],
  'service-only provider-preflight Google Chat verification RPC requires an explicit actor'
);
select has_function(
  'public',
  'record_google_chat_connection_verification_v1',
  array['uuid', 'text', 'boolean', 'text', 'bigint', 'uuid'],
  'service-only atomic Google Chat verification-result RPC requires an explicit actor'
);
select has_function(
  'dashboard_private',
  'notification_schedule_config_valid_v1',
  array['text', 'text', 'text', 'jsonb'],
  'server schedule validator owns workflow, event, variant, and config validation'
);
select has_function(
  'dashboard_private',
  'notification_template_content_valid_v1',
  array['text', 'text', 'jsonb'],
  'server template validator owns token and unsafe-content validation'
);
select has_function(
  'dashboard_private',
  'notification_google_chat_audience_ready_v1',
  array['text'],
  'server Google Chat readiness validator owns audience-to-connection mapping'
);
select has_table(
  'dashboard_private',
  'notification_settings_ui_registry',
  'closed notification settings UI registry exists'
);
select has_table(
  'dashboard_private',
  'notification_settings_import_metadata',
  'notification settings baseline import metadata exists'
);
select has_function(
  'dashboard_private',
  'notification_seed_workflow_settings_v1',
  array[]::text[],
  'idempotent settings seed helper exists'
);
select has_function(
  'public',
  'common_notification_control_plane_runtime_version',
  array[]::text[],
  'final common notification runtime marker exists'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry
  ),
  165::bigint,
  'closed registry contains only the approved Task 8 baseline cells'
);
select results_eq(
  $$
    select distinct registry.workflow_key, registry.workflow_label, registry.workflow_sort
    from dashboard_private.notification_settings_ui_registry registry
    order by registry.workflow_sort
  $$,
  $$ values
    ('tasks'::text, '할 일'::text, 1),
    ('word_retests'::text, '영어 단어 재시험'::text, 2),
    ('registration'::text, '등록'::text, 3),
    ('transfer'::text, '전반'::text, 4),
    ('withdrawal'::text, '퇴원'::text, 5),
    ('makeup_requests'::text, '휴보강'::text, 6),
    ('approvals'::text, '전자결재'::text, 7)
  $$,
  'registry preserves the canonical seven-workflow Korean order'
);
select is_empty($$
  select registry.event_key, registry.audience_key, registry.channel_key
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key = 'registration'
    and not (
      registry.event_key in (
        'registration.case_created',
        'registration.registration_completed',
        'registration.case_closed'
      )
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
    )
$$, 'registration baseline exposes only the three proven management Chat cells');
select is_empty($$
  select registry.event_key, registry.audience_key, registry.channel_key
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key in ('transfer', 'withdrawal')
    and not (
      registry.event_key in (
        registry.workflow_key || '.submitted',
        registry.workflow_key || '.completed'
      )
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
    )
$$, 'transfer and withdrawal import only submitted/completed management Chat intent');
select is_empty($$
  select registry.workflow_key, registry.event_key
  from dashboard_private.notification_settings_ui_registry registry
  join dashboard_private.notification_rules rule_row on rule_row.id = registry.rule_id
  where registry.workflow_key in ('tasks', 'word_retests', 'approvals')
    and rule_row.enabled
$$, 'tasks, word retests, and approvals start with every approved rule disabled');
select ok(
  (
    select pg_catalog.count(*) = 42
      and pg_catalog.count(*) filter (where metadata.import_state = 'inactive') = 6
      and pg_catalog.count(*) filter (where metadata.import_state = 'active') = 36
    from dashboard_private.notification_settings_import_metadata metadata
    where metadata.source_table = 'public.makeup_notification_settings'
  ),
  'makeup baseline records every persisted source row plus inactive import metadata'
);
select is_empty($$
  select
    metadata.source_key,
    pg_catalog.jsonb_array_length(metadata.mapped_rule_ids) as actual_rule_count
  from dashboard_private.notification_settings_import_metadata metadata
  where metadata.source_table = 'public.makeup_notification_settings'
    and pg_catalog.jsonb_array_length(metadata.mapped_rule_ids) <> case
      when metadata.source_snapshot ->> 'channel' = 'dashboard_personal'
        and metadata.source_snapshot ->> 'trigger_kind' in (
          'approved',
          'completed',
          'canceled'
        ) then 2
      when metadata.source_snapshot ->> 'trigger_kind' in ('returned', 'rejected')
        and metadata.source_snapshot ->> 'channel' in (
          'dashboard_management',
          'google_chat_executive',
          'google_chat_admin'
        ) then 0
      else 1
    end
$$, 'makeup persisted sources retain the exact source-specific mapped rule cardinality');
select is_empty($$
  select
    metadata.source_key,
    rule_row.id as rule_id
  from dashboard_private.notification_settings_import_metadata metadata
  cross join lateral pg_catalog.jsonb_array_elements_text(
    metadata.mapped_rule_ids
  ) mapped_rule(rule_id_text)
  join dashboard_private.notification_rules rule_row
    on rule_row.id::text = mapped_rule.rule_id_text
  join public.makeup_notification_settings legacy_setting
    on legacy_setting.trigger_kind = metadata.source_snapshot ->> 'trigger_kind'
   and legacy_setting.channel = metadata.source_snapshot ->> 'channel'
  where metadata.source_table = 'public.makeup_notification_settings'
    and rule_row.enabled is distinct from legacy_setting.enabled
$$, 'makeup imported rule enabled values equal every persisted mapped legacy source');
select is_empty($$
  select registry.rule_id
  from dashboard_private.notification_settings_ui_registry registry
  left join dashboard_private.notification_rules rule_row
    on rule_row.id = registry.rule_id
  left join dashboard_private.notification_templates template_row
    on template_row.id = rule_row.active_template_id
  left join public.makeup_notification_settings legacy_renderer
    on legacy_renderer.trigger_kind = registry.source_trigger_kind
   and legacy_renderer.channel = 'dashboard_personal'
  where registry.workflow_key = 'makeup_requests'
    and (
      rule_row.id is null
      or template_row.id is null
      or template_row.version <> 1
      or legacy_renderer.trigger_kind is null
      or template_row.title_template is distinct from legacy_renderer.title_template
      or template_row.body_template is distinct from legacy_renderer.body_template
    )
$$, 'makeup active version-one templates preserve the same-trigger legacy dashboard-personal renderer');
select is_empty($$
  select metadata.source_key
  from dashboard_private.notification_settings_import_metadata metadata
  where metadata.source_revision is null
    or metadata.source_checksum !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(metadata.mapped_rule_ids) <> 'array'
    or (
      metadata.import_state = 'active'
      and pg_catalog.jsonb_array_length(metadata.mapped_rule_ids) = 0
    )
    or (
      metadata.import_state = 'inactive'
      and (
        metadata.inactive_reason <> 'inactive_not_used_by_legacy_sender'
        or pg_catalog.jsonb_array_length(metadata.mapped_rule_ids) <> 0
      )
    )
$$, 'makeup import stores stable source revisions, checksums, mappings, and inactive reasons');
select is_empty($$
  select metadata.source_key, mapped_rule.rule_id_text
  from dashboard_private.notification_settings_import_metadata metadata
  cross join lateral pg_catalog.jsonb_array_elements_text(
    metadata.mapped_rule_ids
  ) mapped_rule(rule_id_text)
  left join dashboard_private.notification_settings_ui_registry registry
    on registry.rule_id::text = mapped_rule.rule_id_text
  where metadata.source_table = 'public.makeup_notification_settings'
    and (
      registry.rule_id is null
      or not (
        (
          metadata.source_snapshot ->> 'channel' = 'dashboard_personal'
          and registry.channel_key = 'in_app'
          and registry.audience_key in ('requester_profile', 'approver_profile')
        )
        or (
          metadata.source_snapshot ->> 'channel' = 'dashboard_management'
          and registry.channel_key = 'in_app'
          and registry.audience_key = 'management_team'
        )
        or (
          metadata.source_snapshot ->> 'channel' = 'google_chat_executive'
          and registry.channel_key = 'google_chat'
          and registry.audience_key = 'executive_team'
        )
        or (
          metadata.source_snapshot ->> 'channel' = 'google_chat_admin'
          and registry.channel_key = 'google_chat'
          and registry.audience_key = 'management_team'
        )
        or (
          metadata.source_snapshot ->> 'channel' in (
            'google_chat_english',
            'google_chat_math'
          )
          and registry.channel_key = 'google_chat'
          and registry.audience_key = 'subject_team'
        )
      )
    )
$$, 'legacy source channels map only to their exact approved registry cells');
select is_empty($$
  select registry.rule_id
  from dashboard_private.notification_settings_ui_registry registry
  join dashboard_private.notification_rules rule_row on rule_row.id = registry.rule_id
  join dashboard_private.notification_templates template_row
    on template_row.rule_id = rule_row.id
   and template_row.version = 1
  where rule_row.created_by is not null
    or rule_row.created_actor_kind <> 'system'
    or template_row.created_by is not null
    or template_row.created_actor_kind <> 'system'
    or template_row.id <> dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-v1',
      registry.rule_id::text || '|1'
    )
$$, 'seed rules and immutable version-one templates use deterministic IDs and system actors');

create temporary table notification_seed_idempotency_results (
  result_order integer primary key,
  payload jsonb not null
) on commit drop;
insert into notification_seed_idempotency_results(result_order, payload)
values (1, dashboard_private.notification_seed_workflow_settings_v1());
insert into notification_seed_idempotency_results(result_order, payload)
values (2, dashboard_private.notification_seed_workflow_settings_v1());
select is(
  (select payload from notification_seed_idempotency_results where result_order = 2),
  (select payload from notification_seed_idempotency_results where result_order = 1),
  'notification seed rerun keeps rule/template/import counts and checksums stable'
);
select is_empty($$
  select flag_row.flag_key
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.enabled
$$, 'all twelve notification runtime flags remain false after settings seed');
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::regprocedure
    ),
    'notification_rule_not_in_registry'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::regprocedure
    ),
    'notification_settings_ui_registry'
  ) > 0,
  'save rejects a notification_rule_not_in_registry before delegating to mutation logic'
);
select ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'dashboard_private.notification_settings_ui_registry',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'dashboard_private.notification_settings_ui_registry',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'dashboard_private.notification_settings_ui_registry',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon',
    'dashboard_private.notification_settings_import_metadata',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'dashboard_private.notification_settings_import_metadata',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'dashboard_private.notification_settings_import_metadata',
    'SELECT'
  ),
  'registry and import evidence remain private behind the role-checked RPCs'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.common_notification_control_plane_runtime_version()',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.common_notification_control_plane_runtime_version()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.common_notification_control_plane_runtime_version()',
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.proname = 'common_notification_control_plane_runtime_version'
      and function_row.proowner <> (
        select role_row.oid
        from pg_catalog.pg_roles role_row
        where role_row.rolname = 'postgres'
      )
  ),
  'runtime marker is postgres-owned and executable only by authenticated/service role'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_notification_control_plane_v1(text)',
    'EXECUTE'
  ),
  'authenticated can call the role-checked settings reader'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated can call the role-checked settings saver'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_notification_control_plane_with_override_v1(text,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_notification_control_plane_with_override_v1(text,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_notification_control_plane_with_override_v1(text,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'only authenticated callers can enter the role-checked conflict override save'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_notification_runtime_flags_v1()',
    'EXECUTE'
  ),
  'authenticated can call the role-checked flag reader'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot mutate server-authoritative flags'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)',
    'EXECUTE'
  ),
  'service role can mutate server-authoritative flags'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.backfill_google_chat_connection_encryption_v1(text,bigint,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.backfill_google_chat_connection_encryption_v1(text,bigint,text,text,text)',
    'EXECUTE'
  ),
  'only service role can execute the controlled connection-encryption backfill'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.get_notification_control_plane_v1(text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_notification_control_plane_with_override_v1(text,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.get_notification_runtime_flags_v1()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.backfill_google_chat_connection_encryption_v1(text,bigint,text,text,text)',
    'EXECUTE'
  ),
  'anon inherits no notification control-plane function execution'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.replace_google_chat_connection_v1(uuid,text,text,text,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.disconnect_google_chat_connection_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_google_chat_connection_verification_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_google_chat_connection_verification_v1(uuid,text,boolean,text,bigint,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute service-mediated connection mutation functions'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.replace_google_chat_connection_v1(uuid,text,text,text,text,bigint,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.disconnect_google_chat_connection_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.begin_google_chat_connection_verification_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.record_google_chat_connection_verification_v1(uuid,text,boolean,text,bigint,uuid)',
    'EXECUTE'
  ),
  'service role alone can execute explicit-actor connection mutation functions'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.replace_google_chat_connection_v1(uuid,text,text,text,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.disconnect_google_chat_connection_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_google_chat_connection_verification_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.record_google_chat_connection_verification_v1(uuid,text,boolean,text,bigint,uuid)',
    'EXECUTE'
  ),
  'anon cannot call public connection wrappers'
);

select ok(
  (
    select count(*) >= 4
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'dashboard_private'
      and function_row.proname ~ '^(replace|disconnect|begin|record)_google_chat_connection.*_impl$'
  ),
  'public connection wrappers delegate to private implementation routines'
);
select is_empty($$
  select function_row.proname
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'dashboard_private'
    and function_row.proname in (
      'notification_schedule_config_valid_v1',
      'notification_template_content_valid_v1',
      'notification_google_chat_audience_ready_v1',
      'notification_google_chat_webhook_mask_v1',
      'set_notification_runtime_flag_v1_impl',
      'replace_google_chat_connection_v1_impl',
      'disconnect_google_chat_connection_v1_impl',
      'begin_google_chat_connection_verification_v1_impl',
      'record_google_chat_connection_verification_v1_impl',
      'notification_connection_safe_json_v1',
      'notification_control_plane_snapshot_v1',
      'notification_runtime_dependency_ready_v1'
    )
    and (
      pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
    )
$$, 'every private Task 6 helper denies PUBLIC, anon, and authenticated execution');

select is_empty($$
  select function_row.proname
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname in ('public', 'dashboard_private')
    and (
      function_row.proname in (
        'get_notification_control_plane_v1',
        'save_notification_control_plane_v1',
        'get_notification_runtime_flags_v1',
        'set_notification_runtime_flag_v1',
        'backfill_google_chat_connection_encryption_v1',
        'replace_google_chat_connection_v1',
        'disconnect_google_chat_connection_v1',
        'begin_google_chat_connection_verification_v1',
        'record_google_chat_connection_verification_v1'
      )
      or (
        namespace_row.nspname = 'dashboard_private'
        and function_row.proname in (
          'notification_schedule_config_valid_v1',
          'notification_template_content_valid_v1',
          'notification_google_chat_audience_ready_v1',
          'notification_google_chat_webhook_mask_v1',
          'set_notification_runtime_flag_v1_impl',
          'replace_google_chat_connection_v1_impl',
          'disconnect_google_chat_connection_v1_impl',
          'begin_google_chat_connection_verification_v1_impl',
          'record_google_chat_connection_verification_v1_impl',
          'notification_connection_safe_json_v1',
          'notification_control_plane_snapshot_v1',
          'notification_runtime_dependency_ready_v1'
        )
      )
    )
    and (
      not function_row.prosecdef
      or not exists (
        select 1
        from unnest(coalesce(function_row.proconfig, '{}'::text[])) config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
    )
$$, 'every privileged Task 6 RPC is security-definer with an empty search_path');

select ok(
  dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'previous_day_at',
    '{"anchor_key":"appointment_scheduled_at","local_time":"14:00","timezone":"Asia/Seoul"}'::jsonb
  )
  and dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":1,"timezone":"Asia/Seoul"}'::jsonb
  )
  and dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":10080,"timezone":"Asia/Seoul"}'::jsonb
  ),
  'only the closed registration appointment reminder schedule accepts valid KST wall-clock or bounded positive lead values'
);
select ok(
  not dashboard_private.notification_schedule_config_valid_v1(
    'tasks',
    'task.created',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":60,"timezone":"Asia/Seoul"}'::jsonb
  )
  and not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"created_at","lead_minutes":60,"timezone":"Asia/Seoul"}'::jsonb
  )
  and not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":0,"timezone":"Asia/Seoul"}'::jsonb
  )
  and not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":10081,"timezone":"Asia/Seoul"}'::jsonb
  ),
  'schedule validation rejects other workflows, other anchors, zero lead, and over-seven-day lead'
);
select ok(
  dashboard_private.notification_template_content_valid_v1(
    '상담 안내',
    '{학생} 학생의 상담 일정입니다.',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb
  ),
  'template validation accepts balanced allowlisted Korean compatibility tokens'
);
select ok(
  not dashboard_private.notification_template_content_valid_v1(
    '상담 안내',
    '{미등록} 학생의 상담 일정입니다.',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담 {학생',
    '본문',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '<b>상담</b>',
    '본문',
    '[]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담',
    '@all 확인',
    '[]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담',
    'https://outside.invalid 확인',
    '[]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담',
    '//outside.invalid 확인',
    '[]'::jsonb
  ),
  'template validation rejects unknown or unbalanced tokens, raw HTML, provider mentions, and external URLs'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'auth.uid()'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'current_dashboard_role'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification_settings_ui_registry'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'save_notification_control_plane_unchecked_v1'
  ) > 0,
  'public settings save wrapper authenticates before registry validation and delegates to the private mutation body'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.save_notification_control_plane_unchecked_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification-control-plane-workflow:'
  ) > pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.save_notification_control_plane_unchecked_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification-request:'
  )
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.save_notification_control_plane_unchecked_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification_template_content_valid_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.save_notification_control_plane_unchecked_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification_google_chat_audience_ready_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        'dashboard_private.save_notification_control_plane_unchecked_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
      )
    ),
    'for share of connection_row'
  ) > 0,
  'private settings save body locks by shared workflow contract and locks connection rows before server-authoritative validation'
);

create or replace function pg_temp.notification_runtime_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.notification_runtime_set_service_role()
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

create or replace function pg_temp.notification_runtime_throws(
  p_sql text,
  p_message_pattern text
)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm ~ p_message_pattern;
end;
$$;

create or replace function pg_temp.notification_runtime_seed_rule_id(
  p_fixture_key text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select registry.rule_id
  from dashboard_private.notification_settings_ui_registry registry
  where (
      p_fixture_key = 'task_chat'
      and registry.workflow_key = 'tasks'
      and registry.event_key = 'task.created'
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
    )
    or (
      p_fixture_key = 'task_due'
      and registry.workflow_key = 'tasks'
      and registry.event_key = 'task.due_changed'
      and registry.audience_key = 'primary_assignee'
      and registry.channel_key = 'in_app'
    )
    or (
      p_fixture_key = 'task_completed_secondary'
      and registry.workflow_key = 'tasks'
      and registry.event_key = 'task.completed'
      and registry.audience_key = 'secondary_assignee'
      and registry.channel_key = 'in_app'
    )
    or (
      p_fixture_key = 'registration_chat'
      and registry.workflow_key = 'registration'
      and registry.event_key = 'registration.case_created'
      and registry.audience_key = 'management_team'
      and registry.channel_key = 'google_chat'
    )
  order by registry.rule_id
  limit 1;
$$;

create or replace function pg_temp.notification_runtime_expected_revision(
  p_fixture_key text,
  p_revision text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    pg_temp.notification_runtime_seed_rule_id(p_fixture_key)::text,
    p_revision
  );
$$;

create or replace function pg_temp.notification_runtime_rule_patch(
  p_fixture_key text,
  p_rule_patch jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'rules',
    pg_catalog.jsonb_build_object(
      pg_temp.notification_runtime_seed_rule_id(p_fixture_key)::text,
      p_rule_patch
    )
  );
$$;

grant execute on function pg_temp.notification_runtime_seed_rule_id(text)
  to authenticated;
grant execute on function pg_temp.notification_runtime_expected_revision(text, text)
  to authenticated;
grant execute on function pg_temp.notification_runtime_rule_patch(text, jsonb)
  to authenticated;

-- Missing either English or math legacy source, or disagreeing enabled values,
-- must stop the generic subject-team import for operator review.
savepoint notification_runtime_subject_pair_missing;
delete from public.makeup_notification_settings
where trigger_kind = 'submitted'
  and channel = 'google_chat_math';
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select dashboard_private.notification_seed_workflow_settings_v1()$sql$,
    'notification_makeup_subject_settings_review_required'
  ),
  'subject import rejects a missing English or math source row'
);
rollback to savepoint notification_runtime_subject_pair_missing;
release savepoint notification_runtime_subject_pair_missing;

savepoint notification_runtime_subject_pair_mismatch;
update public.makeup_notification_settings
set enabled = not enabled
where trigger_kind = 'submitted'
  and channel = 'google_chat_math';
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select dashboard_private.notification_seed_workflow_settings_v1()$sql$,
    'notification_makeup_subject_settings_review_required'
  ),
  'subject import rejects disagreeing English and math enabled values'
);
rollback to savepoint notification_runtime_subject_pair_mismatch;
release savepoint notification_runtime_subject_pair_mismatch;

select ok(
  pg_temp.notification_runtime_seed_rule_id('task_chat') is not null
  and pg_temp.notification_runtime_seed_rule_id('task_due') is not null
  and pg_temp.notification_runtime_seed_rule_id('task_completed_secondary') is not null
  and pg_temp.notification_runtime_seed_rule_id('registration_chat') is not null,
  'runtime fixtures reuse seeded registry IDs for save and CAS coverage'
);

create temporary table notification_control_plane_runtime_results (
  result_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on notification_control_plane_runtime_results
  to authenticated, service_role;

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'notification-admin@runtime.invalid',
    crypt('notification-runtime-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"notification-control-plane-runtime"}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'notification-staff@runtime.invalid',
    crypt('notification-runtime-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"notification-control-plane-runtime"}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'notification-viewer@runtime.invalid',
    crypt('notification-runtime-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"notification-control-plane-runtime"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'admin',
    '알림 런타임 관리자',
    'notification-admin@runtime.invalid',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'staff',
    '알림 런타임 스태프',
    'notification-staff@runtime.invalid',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'viewer',
    '알림 런타임 뷰어',
    'notification-viewer@runtime.invalid',
    now(),
    now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into dashboard_private.notification_rules(
  id,
  scope_key,
  workflow_key,
  event_key,
  channel_key,
  audience_key,
  rule_variant_key,
  delivery_mode,
  schedule_key,
  schedule_config,
  enabled,
  active_template_id,
  revision,
  created_by,
  created_actor_kind,
  updated_by,
  updated_actor_kind,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-4000-8000-000000000103',
    'global',
    'registration',
    'registration.appointment_reminder_due',
    'google_chat',
    'management_team',
    'offset_before',
    'scheduled',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":60,"timezone":"Asia/Seoul"}'::jsonb,
    false,
    '30000000-0000-4000-8000-000000000203',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000104',
    'global',
    'makeup_requests',
    'makeup_request.created',
    'google_chat',
    'executive_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000204',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000105',
    'global',
    'makeup_requests',
    'makeup_request.approved',
    'google_chat',
    'subject_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000205',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000107',
    'global',
    'registration',
    'registration.phone_consultation_ready',
    'in_app',
    'track_director',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000207',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000108',
    'global',
    'registration',
    'registration.visit_scheduled',
    'google_chat',
    'management_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000208',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000109',
    'global',
    'registration',
    'registration.admission_message_requested',
    'customer_message',
    'applicant_guardian',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000209',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  );

insert into dashboard_private.notification_templates(
  id,
  rule_id,
  version,
  title_template,
  body_template,
  allowed_variables,
  payload_schema_version,
  checksum,
  created_by,
  created_actor_kind,
  created_at
)
values
  (
    '30000000-0000-4000-8000-000000000203',
    '30000000-0000-4000-8000-000000000103',
    1,
    '상담 일정 안내',
    '{학생} 학생의 상담 일정입니다.',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb,
    1,
    'runtime-fixture-registration-reminder-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000204',
    '30000000-0000-4000-8000-000000000104',
    1,
    '휴보강 임원 알림',
    '휴보강 요청이 등록되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-makeup-executive-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000205',
    '30000000-0000-4000-8000-000000000105',
    1,
    '휴보강 과목팀 알림',
    '휴보강 요청이 승인되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-makeup-subject-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000207',
    '30000000-0000-4000-8000-000000000107',
    1,
    '전화상담 준비',
    '전화상담 준비가 완료되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-registration-phone-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000208',
    '30000000-0000-4000-8000-000000000108',
    1,
    '방문상담 예약',
    '방문상담이 예약되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-registration-visit-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000209',
    '30000000-0000-4000-8000-000000000109',
    1,
    '입학 안내',
    '입학 안내 메시지입니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-registration-solapi-v1',
    null,
    'system',
    now()
  );

insert into public.google_chat_webhook_settings(
  channel,
  webhook_url,
  webhook_url_ciphertext,
  webhook_url_mask,
  connection_state,
  revision,
  updated_by,
  last_verified_at,
  last_error_code,
  created_at,
  updated_at
)
values
  (
    'admin',
    'https://chat.googleapis.com/v1/spaces/LEGACYADMIN/messages?key=legacy-key&token=legacy-token',
    null,
    null,
    'legacy_active',
    9007199254740997,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  ),
  (
    'executive',
    'https://chat.googleapis.com/v1/spaces/EXECUTIVE/messages?key=legacy-executive&token=legacy-executive-token',
    'v1:fixture-iv:fixture-tag:fixture-ciphertext',
    'chat.googleapis.com/v1/spaces/EXEC…TIVE/messages',
    'encrypted_active',
    9007199254740997,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  ),
  (
    'math',
    'https://chat.googleapis.com/v1/spaces/MATHROOM/messages?key=math-key&token=math-token',
    'v1:math-iv:math-tag:math-ciphertext',
    'chat.googleapis.com/v1/spaces/…/messages',
    'encrypted_active',
    7,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  ),
  (
    'english',
    'https://chat.googleapis.com/v1/spaces/ENGLISHROOM/messages?key=english-key&token=english-token',
    'v1:english-iv:english-tag:english-ciphertext',
    'chat.googleapis.com/v1/spaces/ENGL…ROOM/messages',
    'encrypted_active',
    8,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  )
on conflict (channel) do update
set webhook_url = excluded.webhook_url,
    webhook_url_ciphertext = excluded.webhook_url_ciphertext,
    webhook_url_mask = excluded.webhook_url_mask,
    connection_state = excluded.connection_state,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    last_verified_at = excluded.last_verified_at,
    last_error_code = excluded.last_error_code,
    updated_at = excluded.updated_at;

select ok(
  dashboard_private.notification_google_chat_audience_ready_v1('management_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('executive_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('subject_team'),
  'management, executive, and both subject connections begin healthy'
);
select ok(
  (
    select webhook_url_mask is null
    from public.google_chat_webhook_settings
    where channel = 'admin'
  )
  and (
    select dashboard_private.notification_connection_safe_json_v1(
      connection_row,
      false
    ) ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/LEGA…DMIN/messages'
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = 'admin'
  ),
  'strict-valid legacy plaintext is masked on read even when the stored legacy mask is null'
);
update public.google_chat_webhook_settings
set webhook_url = 'invalid-legacy-webhook'
where channel = 'admin';
select ok(
  not dashboard_private.notification_google_chat_audience_ready_v1('management_team')
  and (
    select dashboard_private.notification_connection_safe_json_v1(
      connection_row,
      false
    ) ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/…/messages'
      and dashboard_private.notification_connection_safe_json_v1(
        connection_row,
        false
      ) ->> 'last_error_code' = 'configuration_error'
      and dashboard_private.notification_connection_safe_json_v1(
        connection_row,
        false
      )::text !~ 'invalid-legacy-webhook'
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = 'admin'
  ),
  'invalid legacy plaintext becomes a secret-free configuration error instead of aborting the settings snapshot'
);
update public.google_chat_webhook_settings
set webhook_url = 'https://chat.googleapis.com/v1/spaces/LEGACYADMIN/messages?key=legacy-key&token=legacy-token'
where channel = 'admin';
update public.google_chat_webhook_settings
set last_error_code = 'transport_error'
where channel = 'english';
select ok(
  not dashboard_private.notification_google_chat_audience_ready_v1('subject_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('management_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('executive_team'),
  'subject readiness requires both math and English while other audience connections remain independent'
);
update public.google_chat_webhook_settings
set last_error_code = null
where channel = 'english';

select is(
  (
    select count(*)
    from dashboard_private.notification_runtime_flags
  ),
  12::bigint,
  'the runtime flag registry contains exactly twelve approved keys'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_runtime_flags
    where enabled
  ),
  0::bigint,
  'all twelve runtime flags remain false after installation'
);
select is(
  (
    select pg_catalog.string_agg(flag_key, ',' order by flag_key)
    from dashboard_private.notification_runtime_flags
  ),
  (
    select pg_catalog.string_agg(flag_key, ',' order by flag_key)
    from (
      values
        ('notification_control_plane_dispatch_approvals_enabled'),
        ('notification_control_plane_dispatch_makeup_requests_enabled'),
        ('notification_control_plane_dispatch_registration_enabled'),
        ('notification_control_plane_dispatch_tasks_enabled'),
        ('notification_control_plane_dispatch_transfer_enabled'),
        ('notification_control_plane_dispatch_withdrawal_enabled'),
        ('notification_control_plane_dispatch_word_retests_enabled'),
        ('notification_control_plane_registration_phone_adapter_enabled'),
        ('notification_control_plane_registration_solapi_adapter_enabled'),
        ('notification_control_plane_registration_visit_adapter_enabled'),
        ('notification_control_plane_settings_ui_enabled'),
        ('notification_control_plane_shadow_write_enabled')
    ) expected(flag_key)
  ),
  'runtime flag keys are a closed twelve-key registry'
);

-- Specialized registration rollback is rule/event scoped. Disabling one
-- adapter must never cancel generic registration work or another adapter.
insert into dashboard_private.notification_events(
  id,
  scope_key,
  workflow_key,
  event_key,
  source_type,
  source_id,
  source_revision,
  occurrence_key,
  actor_profile_id,
  occurred_at,
  payload_schema_version,
  payload,
  rule_snapshot,
  materialized_rule_id,
  materialized_rule_revision
)
values
  (
    '30000000-0000-4000-8000-000000000501',
    'global', 'registration', 'registration.appointment_reminder_due',
    'registration_appointment', 'generic-fixture', 1, 'generic-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000502',
    'global', 'registration', 'registration.phone_consultation_ready',
    'registration_case', 'phone-fixture', 1, 'phone-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000503',
    'global', 'registration', 'registration.visit_scheduled',
    'registration_appointment', 'visit-fixture', 1, 'visit-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000504',
    'global', 'registration', 'registration.admission_message_requested',
    'registration_message', 'solapi-fixture', 1, 'solapi-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  );

insert into dashboard_private.notification_deliveries(
  id,
  event_id,
  rule_id,
  rule_revision,
  template_id,
  channel_key,
  audience_key,
  target_generation,
  target_set_hash,
  target_kind,
  target_key,
  target_profile_id,
  connection_key,
  target_snapshot,
  parent_delivery_id,
  status,
  status_reason,
  dedupe_key,
  rendered_title,
  rendered_body,
  href,
  scheduled_for,
  attempt_count,
  max_attempts,
  claimed_by,
  claim_token,
  lease_expires_at,
  next_attempt_at
)
values
  (
    '30000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-targets',
    'connection', 'google_chat.management', null, 'google_chat.management',
    '{}'::jsonb, null, 'claimed', null, 'runtime-generic-delivery',
    'generic', 'generic', null, now(), 0, 3,
    'runtime-worker', '30000000-0000-4000-8000-000000000801',
    now() + interval '5 minutes', null
  ),
  (
    '30000000-0000-4000-8000-000000000602',
    '30000000-0000-4000-8000-000000000502',
    '30000000-0000-4000-8000-000000000107', 1,
    '30000000-0000-4000-8000-000000000207',
    'web_push', 'track_director', 0, 'phone-targets',
    'push_subscription', 'phone-subscription', null, null,
    '{}'::jsonb, null, 'pending', null, 'runtime-phone-delivery',
    'phone', 'phone', null, now(), 0, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000603',
    '30000000-0000-4000-8000-000000000503',
    '30000000-0000-4000-8000-000000000108', 1,
    '30000000-0000-4000-8000-000000000208',
    'google_chat', 'management_team', 0, 'visit-targets',
    'connection', 'google_chat.management', null, 'google_chat.management',
    '{}'::jsonb, null, 'pending', null, 'runtime-visit-delivery',
    'visit', 'visit', null, now(), 0, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000604',
    '30000000-0000-4000-8000-000000000504',
    '30000000-0000-4000-8000-000000000109', 1,
    '30000000-0000-4000-8000-000000000209',
    'customer_message', 'applicant_guardian', 0, 'solapi-targets',
    'customer_endpoint', 'guardian-endpoint', null, null,
    '{}'::jsonb, null, 'pending', null, 'runtime-solapi-delivery',
    'solapi', 'solapi', null, now(), 0, 3,
    null, null, null, null
  );

insert into dashboard_private.notification_dispatch_ownership_claims(
  id,
  workflow_key,
  occurrence_key,
  rule_id,
  channel_key,
  target_key,
  target_generation,
  owner_kind,
  owner_generation,
  state
)
values
  ('30000000-0000-4000-8000-000000000701', 'registration', 'generic-fixture:1', '30000000-0000-4000-8000-000000000103', 'google_chat', 'google_chat.management', 0, 'canonical', 1, 'reserved'),
  ('30000000-0000-4000-8000-000000000702', 'registration', 'phone-fixture:1', '30000000-0000-4000-8000-000000000107', 'in_app', 'profile:phone', 0, 'canonical', 1, 'reserved'),
  ('30000000-0000-4000-8000-000000000703', 'registration', 'visit-fixture:1', '30000000-0000-4000-8000-000000000108', 'google_chat', 'google_chat.management', 0, 'canonical', 1, 'reserved'),
  ('30000000-0000-4000-8000-000000000704', 'registration', 'solapi-fixture:1', '30000000-0000-4000-8000-000000000109', 'customer_message', 'guardian-endpoint', 0, 'canonical', 1, 'reserved');

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key in (
  'notification_control_plane_registration_phone_adapter_enabled',
  'notification_control_plane_registration_visit_adapter_enabled',
  'notification_control_plane_registration_solapi_adapter_enabled'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'specialized-phone-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_registration_phone_adapter_enabled', false, 1,
  '30000000-0000-4000-8000-000000000711'
);
select ok(
  (
    select status = 'canceled'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000602'
  )
  and (
    select status = 'pending'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000603'
  )
  and (
    select status = 'pending'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000604'
  )
  and (
    select status = 'claimed' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload -> 'reserved_ownership_claims'
      = '[{"claim_id":"30000000-0000-4000-8000-000000000702","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'specialized-phone-disable'
  ),
  'phone rollback cancels its in-app rule derivatives only and preserves generic, visit, and SOLAPI work'
);

insert into notification_control_plane_runtime_results(result_key, payload)
select 'specialized-visit-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_registration_visit_adapter_enabled', false, 1,
  '30000000-0000-4000-8000-000000000712'
);
select ok(
  (
    select status = 'canceled'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000603'
  )
  and (
    select status = 'pending'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000604'
  )
  and (
    select status = 'claimed' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload -> 'reserved_ownership_claims'
      = '[{"claim_id":"30000000-0000-4000-8000-000000000703","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'specialized-visit-disable'
  ),
  'visit rollback cancels only the closed visit event catalog and preserves generic and SOLAPI work'
);

insert into notification_control_plane_runtime_results(result_key, payload)
select 'specialized-solapi-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_registration_solapi_adapter_enabled', false, 1,
  '30000000-0000-4000-8000-000000000713'
);
select ok(
  (
    select status = 'canceled'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000604'
  )
  and (
    select status = 'claimed' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload -> 'reserved_ownership_claims'
      = '[{"claim_id":"30000000-0000-4000-8000-000000000704","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'specialized-solapi-disable'
  ),
  'SOLAPI rollback cancels only customer-message admission commands and preserves generic registration work'
);
reset role;

-- Generic registration rollback owns core/reminder work only. Exercise a real
-- true-to-false transition across every delivery state while restoring fresh
-- specialized rows so the exclusion boundary is observable.
update dashboard_private.notification_deliveries
set status = 'pending',
    status_reason = null,
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    cancel_requested_at = null,
    cancel_reason = null
where id in (
  '30000000-0000-4000-8000-000000000602',
  '30000000-0000-4000-8000-000000000603',
  '30000000-0000-4000-8000-000000000604'
);

insert into dashboard_private.notification_deliveries(
  id,
  event_id,
  rule_id,
  rule_revision,
  template_id,
  channel_key,
  audience_key,
  target_generation,
  target_set_hash,
  target_kind,
  target_key,
  target_profile_id,
  connection_key,
  target_snapshot,
  parent_delivery_id,
  status,
  status_reason,
  dedupe_key,
  rendered_title,
  rendered_body,
  href,
  scheduled_for,
  attempt_count,
  max_attempts,
  claimed_by,
  claim_token,
  lease_expires_at,
  next_attempt_at
)
values
  (
    '30000000-0000-4000-8000-000000000605',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-pending-targets',
    'connection', 'google_chat.management.pending', null, 'google_chat.management',
    '{}'::jsonb, null, 'pending', null, 'runtime-generic-pending',
    'generic pending', 'generic pending', null, now(), 0, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000606',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-retry-targets',
    'connection', 'google_chat.management.retry', null, 'google_chat.management',
    '{}'::jsonb, null, 'retry_wait', 'transient_pre_dispatch_failure',
    'runtime-generic-retry', 'generic retry', 'generic retry', null, now(), 1, 3,
    null, null, null, now() + interval '5 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000607',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-sending-targets',
    'connection', 'google_chat.management.sending', null, 'google_chat.management',
    '{}'::jsonb, null, 'sending', null, 'runtime-generic-sending',
    'generic sending', 'generic sending', null, now(), 1, 3,
    'runtime-worker', '30000000-0000-4000-8000-000000000807',
    now() + interval '5 minutes', null
  ),
  (
    '30000000-0000-4000-8000-000000000608',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-sent-targets',
    'connection', 'google_chat.management.sent', null, 'google_chat.management',
    '{}'::jsonb, null, 'sent', null, 'runtime-generic-sent',
    'generic sent', 'generic sent', null, now(), 1, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000609',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-unknown-targets',
    'connection', 'google_chat.management.unknown', null, 'google_chat.management',
    '{}'::jsonb, null, 'delivery_unknown', 'provider_timeout_after_dispatch',
    'runtime-generic-unknown', 'generic unknown', 'generic unknown', null, now(), 1, 3,
    null, null, null, null
  );

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key = 'notification_control_plane_dispatch_registration_enabled';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'generic-registration-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_dispatch_registration_enabled', false, 1,
  '30000000-0000-4000-8000-000000000714'
);
select ok(
  (
    select status = 'canceled'
      and status_reason = 'cutover_rollback'
      and next_attempt_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000605'
  )
  and (
    select status = 'canceled'
      and status_reason = 'cutover_rollback'
      and next_attempt_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000606'
  )
  and (
    select status = 'claimed'
      and cancel_requested_at is not null
      and cancel_reason = 'cutover_rollback'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload ->> 'canceled_count' = '2'
      and payload ->> 'claim_cancel_requested_count' = '1'
      and payload -> 'reserved_ownership_claims'
        = '[{"claim_id":"30000000-0000-4000-8000-000000000701","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'generic-registration-disable'
  ),
  'generic registration rollback cancels pending/retry core work and requests cancellation for claimed core work'
);
select ok(
  (
    select status = 'sending' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000607'
  )
  and (
    select status = 'sent' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000608'
  )
  and (
    select status = 'delivery_unknown'
      and status_reason = 'provider_timeout_after_dispatch'
      and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000609'
  ),
  'generic rollback preserves sending, sent, and delivery-unknown core outcomes'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_deliveries
    where id in (
      '30000000-0000-4000-8000-000000000602',
      '30000000-0000-4000-8000-000000000603',
      '30000000-0000-4000-8000-000000000604'
    )
      and (
        status <> 'pending'
        or cancel_requested_at is not null
        or cancel_reason is not null
      )
  )
  and (
    select count(*) = 3
    from dashboard_private.notification_dispatch_ownership_claims
    where id in (
      '30000000-0000-4000-8000-000000000702',
      '30000000-0000-4000-8000-000000000703',
      '30000000-0000-4000-8000-000000000704'
    )
      and state = 'reserved'
  ),
  'generic registration rollback preserves phone, visit, and SOLAPI deliveries and ownership claims'
);
reset role;

set local role authenticated;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000003'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select public.get_notification_control_plane_v1('tasks')$sql$,
    'notification_access_denied'
  ),
  'viewer cannot read notification settings'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        '{"rules":{}}'::jsonb,
        '30000000-0000-4000-8000-000000000301'
      )
    $sql$,
    'notification_access_denied'
  ),
  'viewer cannot save notification settings'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_with_override_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000009999":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000009999":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000340',
        '30000000-0000-4000-8000-000000000341',
        '["rules.30000000-0000-4000-8000-000000009999.enabled"]'::jsonb
      )
    $sql$,
    'notification_access_denied'
  ),
  'viewer override save is rejected by authorization before registry validation'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select public.get_notification_runtime_flags_v1()$sql$,
    'notification_access_denied'
  ),
  'viewer cannot read operational flags'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000002'
);
set local role authenticated;
select lives_ok(
  $sql$select public.get_notification_control_plane_v1('tasks')$sql$,
  'staff can read notification settings'
);
select lives_ok(
  $sql$select public.get_notification_runtime_flags_v1()$sql$,
  'staff can read the safe flag capability map'
);
select ok(
  (
    public.get_notification_runtime_flags_v1()
      -> 'flags'
      -> 'notification_control_plane_settings_ui_enabled'
      ->> 'enabled'
  )::boolean = false
  and (
    public.get_notification_runtime_flags_v1()
      -> 'flags'
      -> 'notification_control_plane_settings_ui_enabled'
      ->> 'revision'
  ) = '1',
  'flag capability JSON contains booleans and decimal-string revisions only'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        '{"rules":{}}'::jsonb,
        '30000000-0000-4000-8000-000000000302'
      )
    $sql$,
    'notification_settings_ui_disabled'
  ),
  'an already-open panel cannot save while the UI flag is false'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select public.get_notification_control_plane_v1('arbitrary_workflow')$sql$,
    'notification_workflow_unknown'
  ),
  'unknown workflow reads fail closed'
);

reset role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_unknown_enabled',
        false,
        1,
        '30000000-0000-4000-8000-000000000311'
      )
    $sql$,
    'notification_flag_unknown'
  ),
  'arbitrary runtime flag keys fail closed'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_shadow_write_enabled',
        false,
        99,
        '30000000-0000-4000-8000-000000000312'
      )
    $sql$,
    'notification_revision_conflict'
  ),
  'runtime flag mutation uses optimistic revision checks'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'flag-disable-first',
  public.set_notification_runtime_flag_v1(
    'notification_control_plane_shadow_write_enabled',
    false,
    1,
    '30000000-0000-4000-8000-000000000313'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'flag-disable-replay',
  public.set_notification_runtime_flag_v1(
    'notification_control_plane_shadow_write_enabled',
    false,
    1,
    '30000000-0000-4000-8000-000000000313'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'flag-disable-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'flag-disable-first'
  ),
  'same runtime-flag request replays the committed response'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_shadow_write_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000313'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'same flag request ID with a different fingerprint is rejected'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.common_notification_control_plane_runtime_version()'
    ) is not null then true
    else pg_temp.notification_runtime_throws(
      $sql$
        select public.set_notification_runtime_flag_v1(
          'notification_control_plane_settings_ui_enabled',
          true,
          1,
          '30000000-0000-4000-8000-000000000314'
        )
      $sql$,
      'notification_runtime_not_ready'
    )
  end,
  'UI enablement fails closed while the common runtime marker is absent'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.notification_workflow_adapters_runtime_version()'
    ) is not null
    and exists (
      select 1
      from dashboard_private.notification_worker_heartbeats heartbeat
      where heartbeat.phase = 'succeeded'
        and heartbeat.created_at >= now() - interval '3 minutes'
    ) then true
    else pg_temp.notification_runtime_throws(
      $sql$
        select public.set_notification_runtime_flag_v1(
          'notification_control_plane_dispatch_tasks_enabled',
          true,
          1,
          '30000000-0000-4000-8000-000000000315'
        )
      $sql$,
      'notification_runtime_not_ready'
    )
  end,
  'dispatch enablement fails closed without adapter runtime and a fresh successful heartbeat'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.registration_appointment_reminders_runtime_version()'
    ) is not null then true
    else pg_temp.notification_runtime_throws(
      $sql$
        select public.set_notification_runtime_flag_v1(
          'notification_control_plane_registration_visit_adapter_enabled',
          true,
          2,
          '30000000-0000-4000-8000-000000000316'
        )
      $sql$,
      'notification_runtime_not_ready'
    )
  end,
  'registration adapter enablement fails closed without its appointment runtime marker'
);

-- Readiness must reject marker stubs that exist but advertise the wrong
-- contract version. This is an actual mutation attempt, not a CASE bypass.
reset role;
create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$ select 0 $$;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_settings_ui_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000318'
      )
    $sql$,
    'notification_runtime_not_ready'
  ),
  'an existing common runtime marker with the wrong version is rejected'
);

reset role;
create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  raise exception 'fixture marker failure';
end;
$$;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_settings_ui_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000320'
      )
    $sql$,
    'notification_runtime_not_ready'
  ),
  'a runtime marker that raises is treated as unavailable'
);

-- Correct marker versions are still insufficient when the only successful
-- worker heartbeat is older than the three-minute readiness window.
reset role;
create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$ select 1 $$;
create or replace function public.notification_workflow_adapters_runtime_version()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$ select 1 $$;
update dashboard_private.notification_worker_heartbeats
set created_at = pg_catalog.clock_timestamp() - interval '10 minutes'
where phase = 'succeeded';
insert into dashboard_private.notification_worker_heartbeats(
  id,
  worker_id,
  run_id,
  phase,
  counts,
  error_code,
  created_at
) values (
  '30000000-0000-4000-8000-000000000811',
  'runtime-stale-worker',
  '30000000-0000-4000-8000-000000000812',
  'succeeded',
  '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null,
  pg_catalog.clock_timestamp() - interval '10 minutes'
);
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_dispatch_tasks_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000319'
      )
    $sql$,
    'notification_runtime_not_ready'
  ),
  'dispatch readiness rejects correct markers paired with only a stale successful heartbeat'
);
reset role;
select ok(
  not exists (
    select 1
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000318',
      '30000000-0000-4000-8000-000000000319',
      '30000000-0000-4000-8000-000000000320'
    )
  )
  and (
    select not enabled and revision = 1
    from dashboard_private.notification_runtime_flags
    where flag_key = 'notification_control_plane_settings_ui_enabled'
  )
  and (
    select not enabled and revision = 1
    from dashboard_private.notification_runtime_flags
    where flag_key = 'notification_control_plane_dispatch_tasks_enabled'
  ),
  'failed version and heartbeat readiness checks commit no flag or request-ledger mutation'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_settings_ui_enabled',
        false,
        1,
        '30000000-0000-4000-8000-000000000317'
      )
    $sql$,
    'permission denied|notification_access_denied'
  ),
  'even an authenticated admin cannot mutate service-role flags'
);

-- The operator save contract deliberately cannot turn its own gate on. A
-- postgres fixture enables it to exercise the authenticated save transaction.
reset role;
update dashboard_private.notification_runtime_flags
set enabled = true,
    updated_by = null,
    updated_at = now()
where flag_key = 'notification_control_plane_settings_ui_enabled';

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  (
    public.get_notification_control_plane_v1('tasks') ->> 'scope_key'
  ) = 'global'
  and (
    public.get_notification_control_plane_v1('tasks') ->> 'workflow_key'
  ) = 'tasks'
  and jsonb_typeof(
    public.get_notification_control_plane_v1('tasks') -> 'rules'
  ) = 'array'
  and jsonb_typeof(
    public.get_notification_control_plane_v1('tasks') -> 'connections'
  ) = 'array'
  and jsonb_typeof(
    public.get_notification_control_plane_v1('tasks') -> 'delivery_summary'
  ) = 'object',
  'admin receives the closed safe settings snapshot shape'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_notification_control_plane_v1('tasks') -> 'rules'
    ) rule(value)
    where rule.value ->> 'id'
        = pg_temp.notification_runtime_seed_rule_id('task_chat')::text
      and rule.value ->> 'revision' = '1'
      and rule.value -> 'template' ->> 'version' = '1'
  ),
  'settings snapshot serializes bigint revisions as decimal strings'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_notification_control_plane_v1('tasks') -> 'connections'
    ) connection(value)
    where connection.value ->> 'connection_key' = 'google_chat.management'
      and connection.value ->> 'webhook_url_mask'
        = 'chat.googleapis.com/v1/spaces/LEGA…DMIN/messages'
  )
  and exists (
    select 1
    from jsonb_array_elements(
      public.get_notification_control_plane_v1('tasks') -> 'connections'
    ) connection(value)
    where connection.value ->> 'connection_key' = 'google_chat.executive'
      and connection.value ->> 'webhook_url_mask'
        = 'chat.googleapis.com/v1/spaces/EXEC…TIVE/messages'
  ),
  'long Google Chat space IDs expose only the fixed first-four/last-four mask'
);
select ok(
  public.get_notification_control_plane_v1('tasks')::text
    !~ 'legacy-key|legacy-token|fixture-ciphertext|webhook_url_ciphertext',
  'settings snapshot exposes no plaintext or ciphertext secret'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"enabled":true,"channel_key":"web_push"}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000321'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'save rejects fields outside the closed editable rule patch'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000009999":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000009999":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000322'
      )
    $sql$,
    'notification_rule_not_in_registry'
  ),
  'save rejects arbitrary rule identities'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_catalog.jsonb_build_object(
          pg_temp.notification_runtime_seed_rule_id(
            'task_completed_secondary'
          )::text,
          '1',
          pg_catalog.upper(
            pg_temp.notification_runtime_seed_rule_id(
              'task_completed_secondary'
            )::text
          ),
          '1'
        ),
        pg_catalog.jsonb_build_object(
          'rules',
          pg_catalog.jsonb_build_object(
            pg_temp.notification_runtime_seed_rule_id(
              'task_completed_secondary'
            )::text,
            '{"enabled":true}'::jsonb,
            pg_catalog.upper(
              pg_temp.notification_runtime_seed_rule_id(
                'task_completed_secondary'
              )::text
            ),
            '{"enabled":true}'::jsonb
          )
        ),
        '30000000-0000-4000-8000-000000000329'
      )
    $sql$,
    'notification_rule_not_in_registry'
  ),
  'lowercase and uppercase aliases of one UUID are rejected as one invalid atomic request'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"body_template":"{미등록} 알림"}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000330'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'settings save rejects a token outside the immutable template allowlist'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'registration',
        pg_temp.notification_runtime_expected_revision('registration_chat', '1'),
        pg_temp.notification_runtime_rule_patch(
          'registration_chat',
          '{"schedule_config":{"anchor_key":"appointment_scheduled_at","lead_minutes":0,"timezone":"Asia/Seoul"}}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000331'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'settings save rejects a non-positive appointment reminder lead'
);

reset role;
update public.google_chat_webhook_settings
set last_error_code = 'transport_error'
where channel = 'admin';
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"enabled":true}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000332'
      )
    $sql$,
    'notification_google_chat_connection_required'
  ),
  'disabled management Chat cannot be enabled while its locked connection is unhealthy'
);
reset role;
update public.google_chat_webhook_settings
set last_error_code = null
where channel = 'admin';
select ok(
  not exists (
    select 1
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000329',
      '30000000-0000-4000-8000-000000000330',
      '30000000-0000-4000-8000-000000000331',
      '30000000-0000-4000-8000-000000000332'
    )
  )
  and (
    select revision = 1 and not enabled
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id(
      'task_completed_secondary'
    )
  )
  and (
    select revision = 1 and not enabled
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('registration_chat')
  ),
  'canonical UUID, template, schedule, and connection validation failures roll back every receipt and rule mutation'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-noop',
  public.save_notification_control_plane_v1(
    'tasks',
    '{}'::jsonb,
    '{"rules":{}}'::jsonb,
    '30000000-0000-4000-8000-000000000323'
  );

reset role;
select is(
  (
    select revision
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_chat')
  ),
  1::bigint,
  'no-op save does not increment a rule revision'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_templates
    where rule_id in (
      pg_temp.notification_runtime_seed_rule_id('task_chat'),
      pg_temp.notification_runtime_seed_rule_id('task_due')
    )
  ),
  2::bigint,
  'no-op save does not create an immutable template version'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_rule_reconciliation_jobs
    where workflow_key = 'tasks'
      and created_at >= transaction_timestamp()
  ),
  0::bigint,
  'no-op save does not enqueue reconciliation'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_audit_logs
    where request_id = '30000000-0000-4000-8000-000000000323'
  ),
  0::bigint,
  'no-op save does not append mutation audit rows'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-change-first',
  public.save_notification_control_plane_v1(
    'tasks',
    pg_temp.notification_runtime_expected_revision('task_chat', '1'),
    pg_temp.notification_runtime_rule_patch(
      'task_chat',
      '{"title_template":"변경된 제목","body_template":"변경된 본문"}'::jsonb
    ),
    '30000000-0000-4000-8000-000000000324'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-change-replay',
  public.save_notification_control_plane_v1(
    'tasks',
    pg_temp.notification_runtime_expected_revision('task_chat', '1'),
    pg_temp.notification_runtime_rule_patch(
      'task_chat',
      '{"title_template":"변경된 제목","body_template":"변경된 본문"}'::jsonb
    ),
    '30000000-0000-4000-8000-000000000324'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'settings-change-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'settings-change-first'
  ),
  'same settings request replays its exact committed result'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"title_template":"다른 제목"}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000324'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'same settings request ID with a changed patch is rejected'
);

reset role;
select is(
  (
    select revision
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_chat')
  ),
  2::bigint,
  'changed save increments its rule revision exactly once across replay'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_templates
    where rule_id = pg_temp.notification_runtime_seed_rule_id('task_chat')
  ),
  2::bigint,
  'changed template content creates exactly one immutable version'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_templates template
    where template.rule_id = pg_temp.notification_runtime_seed_rule_id(
      'task_chat'
    )
      and template.version = 2
      and template.title_template = '변경된 제목'
      and template.body_template = '변경된 본문'
      and template.created_by = '30000000-0000-4000-8000-000000000001'
      and template.created_actor_kind = 'user'
  ),
  'new immutable template records the authenticated actor'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_rule_reconciliation_jobs
    where workflow_key = 'tasks'
      and rule_revision_map ->> pg_temp.notification_runtime_seed_rule_id(
        'task_chat'
      )::text = '2'
  ),
  1::bigint,
  'changed save enqueues one captured rule-reconciliation job'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id = '30000000-0000-4000-8000-000000000324'
      and audit.actor_profile_id = '30000000-0000-4000-8000-000000000001'
      and audit.actor_kind = 'user'
  ),
  'changed save appends an actor-bound audit row'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id = '30000000-0000-4000-8000-000000000324'
      and concat_ws(' ', audit.before_summary::text, audit.after_summary::text)
        ~* 'rendered_body|target_snapshot|webhook|ciphertext|legacy-key|legacy-token'
  ),
  'settings audit summaries contain no rendered payload, target, or connection secret'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger ledger
    where ledger.request_id = '30000000-0000-4000-8000-000000000324'
  ),
  1::bigint,
  'changed settings request has exactly one durable ledger row'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '1'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"enabled":true}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000325'
      )
    $sql$,
    'notification_revision_conflict'
  ),
  'stale expected revision is rejected'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_catalog.jsonb_build_object(
          pg_temp.notification_runtime_seed_rule_id('task_chat')::text,
          '2',
          pg_temp.notification_runtime_seed_rule_id('task_due')::text,
          '99'
        ),
        pg_catalog.jsonb_build_object(
          'rules',
          pg_catalog.jsonb_build_object(
            pg_temp.notification_runtime_seed_rule_id('task_chat')::text,
            '{"enabled":true}'::jsonb,
            pg_temp.notification_runtime_seed_rule_id('task_due')::text,
            '{"enabled":true}'::jsonb
          )
        ),
        '30000000-0000-4000-8000-000000000326'
      )
    $sql$,
    'notification_revision_conflict'
  ),
  'one stale revision rejects the whole multi-rule save'
);

reset role;
select ok(
  not (
    select enabled
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_chat')
  )
  and not (
    select enabled
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_due')
  )
  and (
    select revision
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_chat')
  ) = 2
  and (
    select revision
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_due')
  ) = 1,
  'revision conflict rolls back every rule/template/audit/job mutation atomically'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000325',
      '30000000-0000-4000-8000-000000000326'
    )
  ),
  0::bigint,
  'failed revision conflicts leave no committed request receipt'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000002'
);
set local role authenticated;
select lives_ok(
  $sql$
    select public.save_notification_control_plane_v1(
      'tasks',
      pg_temp.notification_runtime_expected_revision('task_due', '1'),
      pg_temp.notification_runtime_rule_patch(
        'task_due',
        '{"enabled":true}'::jsonb
      ),
      '30000000-0000-4000-8000-000000000327'
    )
  $sql$,
  'staff can commit a valid explicit settings patch'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_with_override_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '2'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"enabled":true}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000335',
        '30000000-0000-4000-8000-000000000335',
        pg_catalog.jsonb_build_array(
          'rules.'
            || pg_temp.notification_runtime_seed_rule_id('task_chat')::text
            || '.enabled'
        )
      )
    $sql$,
    'notification_conflict_override_invalid'
  ),
  'override requires distinct save and override request IDs'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_with_override_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000009999":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000009999":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000336',
        '30000000-0000-4000-8000-000000000337',
        '["rules.30000000-0000-4000-8000-000000009999.enabled"]'::jsonb
      )
    $sql$,
    'notification_rule_not_in_registry'
  ),
  'registry-external rule is rejected before the unchecked save implementation'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_with_override_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '2'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"channel_key":"google_chat"}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000338',
        '30000000-0000-4000-8000-000000000339',
        pg_catalog.jsonb_build_array(
          'rules.'
            || pg_temp.notification_runtime_seed_rule_id('task_chat')::text
            || '.channelKey'
        )
      )
    $sql$,
    'notification_conflict_override_invalid'
  ),
  'override rejects conflicting fields outside the safe editable field registry'
);

insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-override-first',
  public.save_notification_control_plane_with_override_v1(
    'tasks',
    pg_temp.notification_runtime_expected_revision('task_chat', '2'),
    pg_temp.notification_runtime_rule_patch(
      'task_chat',
      '{"enabled":true}'::jsonb
    ),
    '30000000-0000-4000-8000-000000000333',
    '30000000-0000-4000-8000-000000000334',
    pg_catalog.jsonb_build_array(
      'rules.'
        || pg_temp.notification_runtime_seed_rule_id('task_chat')::text
        || '.enabled'
    )
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-override-replay',
  public.save_notification_control_plane_with_override_v1(
    'tasks',
    pg_temp.notification_runtime_expected_revision('task_chat', '2'),
    pg_temp.notification_runtime_rule_patch(
      'task_chat',
      '{"enabled":true}'::jsonb
    ),
    '30000000-0000-4000-8000-000000000333',
    '30000000-0000-4000-8000-000000000334',
    pg_catalog.jsonb_build_array(
      'rules.'
        || pg_temp.notification_runtime_seed_rule_id('task_chat')::text
        || '.enabled'
    )
  );
select ok(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'settings-override-replay'
  ) = (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'settings-override-first'
  )
  and (
    select count(*) = 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id = '30000000-0000-4000-8000-000000000334'
      and audit.action = 'revision_conflict_overridden'
      and audit.actor_profile_id = '30000000-0000-4000-8000-000000000001'
      and audit.before_summary is null
      and audit.after_summary = pg_catalog.jsonb_build_object(
        'conflicting_fields',
        pg_catalog.jsonb_build_array(
          'rules.'
            || pg_temp.notification_runtime_seed_rule_id('task_chat')::text
            || '.enabled'
        ),
        'save_request_id',
        '30000000-0000-4000-8000-000000000333'::uuid
      )
  )
  and (
    select count(*) = 2
    from dashboard_private.notification_request_ledger ledger
    where (
      ledger.request_id = '30000000-0000-4000-8000-000000000333'
      and ledger.request_kind = 'notification_settings_save'
    ) or (
      ledger.request_id = '30000000-0000-4000-8000-000000000334'
      and ledger.request_kind = 'notification_revision_conflict_override'
    )
  ),
  'override request replays one response and writes one safe conflict audit'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_with_override_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '2'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"enabled":false}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000333',
        '30000000-0000-4000-8000-000000000334',
        pg_catalog.jsonb_build_array(
          'rules.'
            || pg_temp.notification_runtime_seed_rule_id('task_chat')::text
            || '.enabled'
        )
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'override request ID rejects a changed fingerprint'
);

reset role;
select ok(
  (
    select enabled and revision = 3
    from dashboard_private.notification_rules
    where id = pg_temp.notification_runtime_seed_rule_id('task_chat')
  )
  and not exists (
    select 1
    from dashboard_private.notification_request_ledger ledger
    where ledger.request_id in (
      '30000000-0000-4000-8000-000000000335',
      '30000000-0000-4000-8000-000000000336',
      '30000000-0000-4000-8000-000000000337',
      '30000000-0000-4000-8000-000000000338',
      '30000000-0000-4000-8000-000000000339'
    )
  ),
  'invalid override attempts leave no rule or request-ledger mutation'
);

reset role;
update dashboard_private.notification_runtime_flags
set enabled = false,
    updated_by = null,
    updated_at = now()
where flag_key = 'notification_control_plane_settings_ui_enabled';
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        pg_temp.notification_runtime_expected_revision('task_chat', '2'),
        pg_temp.notification_runtime_rule_patch(
          'task_chat',
          '{"enabled":true}'::jsonb
        ),
        '30000000-0000-4000-8000-000000000328'
      )
    $sql$,
    'notification_settings_ui_disabled'
  ),
  'save transaction rechecks a disabled UI flag instead of trusting an open panel'
);

-- The controlled backfill is a service-role-only compare-and-swap. It keeps
-- legacy plaintext readable, but never trusts a caller-provided fingerprint or
-- mask without recomputing both from the locked row.
reset role;
insert into public.google_chat_webhook_settings(
  channel,
  webhook_url,
  webhook_url_ciphertext,
  webhook_url_mask,
  connection_state,
  revision,
  updated_by,
  last_verified_at,
  last_error_code,
  created_at,
  updated_at
) values (
  'math',
  'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token',
  null,
  null,
  'legacy_active',
  41,
  '30000000-0000-4000-8000-000000000001',
  null,
  null,
  now(),
  now()
)
on conflict (channel) do update
set webhook_url = excluded.webhook_url,
    webhook_url_ciphertext = excluded.webhook_url_ciphertext,
    webhook_url_mask = excluded.webhook_url_mask,
    connection_state = excluded.connection_state,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    last_verified_at = excluded.last_verified_at,
    last_error_code = excluded.last_error_code,
    updated_at = excluded.updated_at;

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.backfill_google_chat_connection_encryption_v1(
        'math',
        41,
        '0000000000000000000000000000000000000000000000000000000000000000',
        'v1:backfill-iv:backfill-tag:backfill-ciphertext',
        'chat.googleapis.com/v1/spaces/MATH…L123/messages'
      )
    $sql$,
    'notification_connection_backfill_fingerprint_mismatch'
  ),
  'backfill rejects a stale or forged plaintext fingerprint'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.backfill_google_chat_connection_encryption_v1(
        'executive',
        9007199254740997,
        pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              'https://chat.googleapis.com/v1/spaces/EXECUTIVE/messages?key=legacy-executive&token=legacy-executive-token',
              'UTF8'
            )
          ),
          'hex'
        ),
        'v1:other-iv:other-tag:other-ciphertext',
        'chat.googleapis.com/v1/spaces/EXEC…TIVE/messages'
      )
    $sql$,
    'notification_connection_backfill_not_candidate'
  ),
  'backfill refuses a row that already contains ciphertext'
);

reset role;
select ok(
  (
    select connection_state = 'legacy_active'
      and revision = 41
      and webhook_url_ciphertext is null
      and webhook_url_mask is null
    from public.google_chat_webhook_settings
    where channel = 'math'
  )
  and (
    select connection_state = 'encrypted_active'
      and revision = 9007199254740997
      and webhook_url_ciphertext = 'v1:fixture-iv:fixture-tag:fixture-ciphertext'
    from public.google_chat_webhook_settings
    where channel = 'executive'
  ),
  'failed backfill preconditions leave both candidate and encrypted rows unchanged'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-backfill-first',
  public.backfill_google_chat_connection_encryption_v1(
    'math',
    41,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token',
          'UTF8'
        )
      ),
      'hex'
    ),
    'v1:backfill-iv:backfill-tag:backfill-ciphertext',
    'chat.googleapis.com/v1/spaces/MATH…L123/messages'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-backfill-replay',
  public.backfill_google_chat_connection_encryption_v1(
    'math',
    41,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token',
          'UTF8'
        )
      ),
      'hex'
    ),
    'v1:backfill-iv:backfill-tag:backfill-ciphertext',
    'chat.googleapis.com/v1/spaces/MATH…L123/messages'
  );

reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-backfill-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-backfill-first'
  ),
  'successful backfill replay returns the same safe response without another write'
);
select ok(
  (
    select connection_state = 'encrypted_active'
      and revision = 42
      and webhook_url = 'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token'
      and webhook_url_ciphertext = 'v1:backfill-iv:backfill-tag:backfill-ciphertext'
      and webhook_url_mask = 'chat.googleapis.com/v1/spaces/MATH…L123/messages'
      and updated_by = '30000000-0000-4000-8000-000000000001'
    from public.google_chat_webhook_settings
    where channel = 'math'
  ),
  'backfill changes only encrypted metadata/state/revision and preserves the legacy reader'
);
select ok(
  (
    select payload ->> 'connection_key' = 'google_chat.math'
      and payload ->> 'connection_state' = 'encrypted_active'
      and payload ->> 'revision' = '42'
      and payload ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/MATH…L123/messages'
      and payload::text
        !~* 'math-legacy-key|math-legacy-token|backfill-ciphertext|webhook_url_ciphertext|https://chat[.]googleapis[.]com'
    from notification_control_plane_runtime_results
    where result_key = 'connection-backfill-first'
  ),
  'backfill response exposes only safe masked metadata'
);
select ok(
  (
    select count(*) = 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'google_chat_connection'
      and audit.entity_id = 'google_chat.math'
      and audit.action = 'connection_encryption_backfilled'
  )
  and not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'google_chat_connection'
      and audit.entity_id = 'google_chat.math'
      and concat_ws(' ', audit.before_summary::text, audit.after_summary::text)
        ~* 'math-legacy-key|math-legacy-token|backfill-ciphertext|webhook_url|ciphertext'
  ),
  'backfill replay creates one state-only audit row with no secret material'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000001',
        'math',
        true,
        'configuration_error',
        42,
        '30000000-0000-4000-8000-000000000411'
      )
    $sql$,
    'notification_connection_result_invalid'
  ),
  'configuration_error is accepted only as a failed verification result'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-begin',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-record',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    false,
    'configuration_error',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-record-replay',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    false,
    'configuration_error',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-begin-completed-replay',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-record'
  ),
  'configuration-error verification completion is exactly idempotent'
);
select ok(
  (
    select (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload -> 'connection' = 'null'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-begin'
  )
  and (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload #>> '{connection,connection_state}' = 'encrypted_active'
      and payload #>> '{connection,revision}' = '43'
      and payload #>> '{connection,last_error_code}' = 'configuration_error'
      and payload::text
        !~* 'math-legacy-key|math-legacy-token|backfill-ciphertext|webhook_url_ciphertext|https://chat[.]googleapis[.]com'
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-begin-completed-replay'
  ),
  'configuration error completes the reservation and later begin replay never resends or leaks secrets'
);

reset role;
select ok(
  (
    select connection_state = 'encrypted_active'
      and revision = 43
      and last_verified_at is not null
      and last_error_code = 'configuration_error'
    from public.google_chat_webhook_settings
    where channel = 'math'
  )
  and (
    select response_payload ->> 'state' = 'completed'
      and response_payload ->> 'succeeded' = 'false'
      and response_payload ->> 'result_code' = 'configuration_error'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000410'
  ),
  'configuration error persists only normalized failure metadata in one completed ledger row'
);

-- Atomic connection mutations. Staff may inspect masked metadata through the
-- settings snapshot but every replace/verify/disconnect mutation is admin-only.
reset role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000002',
        'admin',
        'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token',
        'v1:new-iv:new-tag:new-ciphertext',
        'chat.googleapis.com/v1/spaces/…/messages',
        9007199254740997,
        '30000000-0000-4000-8000-000000000401'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot replace a Google Chat connection'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.disconnect_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000002',
        'admin',
        9007199254740997,
        '30000000-0000-4000-8000-000000000402'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot disconnect a Google Chat connection'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.begin_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000002',
        'executive',
        9007199254740997,
        '30000000-0000-4000-8000-000000000403'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot reserve a Google Chat provider verification'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000002',
        'executive',
        true,
        'accepted',
        9007199254740997,
        '30000000-0000-4000-8000-000000000409'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot record a connection verification result'
);

reset role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000001',
        'executive',
        true,
        'accepted',
        9007199254740997,
        '30000000-0000-4000-8000-000000000409'
      )
    $sql$,
    'notification_connection_verification_not_reserved'
  ),
  'verification result cannot be finalized without an atomic reservation'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-begin-first',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-begin-pending-replay',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
select ok(
  (
    select (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and not (payload ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and payload::text !~* 'https://chat\.googleapis\.com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-begin-first'
  ),
  'first verification reservation permits one provider send without returning connection secrets'
);
select ok(
  (
    select not (payload ->> 'should_send')::boolean
      and (payload ->> 'pending')::boolean
      and not (payload ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and payload::text !~* 'https://chat\.googleapis\.com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-begin-pending-replay'
  ),
  'concurrent verification replay stays pending and cannot trigger a second provider send'
);
select ok(
  (
    select response_payload ->> 'state' = 'reserved'
      and response_payload ->> 'actor' = '30000000-0000-4000-8000-000000000001'
      and response_payload ->> 'channel' = 'executive'
      and response_payload ->> 'revision' = '9007199254740997'
      and (response_payload ->> 'reserved_at')::timestamp with time zone
        < (response_payload ->> 'expires_at')::timestamp with time zone
      and (response_payload ->> 'expires_at')::timestamp with time zone
        - (response_payload ->> 'reserved_at')::timestamp with time zone
        = interval '2 minutes'
      and response_payload::text
        !~* 'https://chat[.]googleapis[.]com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext|webhook_url'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000408'
  ),
  'verification reservation ledger records bounded actor, channel, revision, and two-minute expiry metadata without secrets'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-replace-first',
  public.replace_google_chat_connection_v1(
    '30000000-0000-4000-8000-000000000001',
    'admin',
    'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token',
    'v1:new-iv:new-tag:new-ciphertext',
    'chat.googleapis.com/v1/spaces/…/messages',
    9007199254740997,
    '30000000-0000-4000-8000-000000000404'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-replace-replay',
  public.replace_google_chat_connection_v1(
    '30000000-0000-4000-8000-000000000001',
    'admin',
    'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token',
    'v1:retry-iv:retry-tag:retry-ciphertext',
    'chat.googleapis.com/v1/spaces/…/messages',
    9007199254740997,
    '30000000-0000-4000-8000-000000000404'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-replace-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-replace-first'
  ),
  'connection replace replays the exact committed response despite a fresh randomized envelope'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000001',
        'admin',
        'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=changed-token',
        'v1:different-iv:different-tag:different-ciphertext',
        'chat.googleapis.com/v1/spaces/…/messages',
        9007199254740997,
        '30000000-0000-4000-8000-000000000404'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'connection request ID cannot be reused for a different logical webhook URL'
);

reset role;
select ok(
  (
    select connection_state = 'encrypted_active'
      and webhook_url = 'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token'
      and webhook_url_ciphertext = 'v1:new-iv:new-tag:new-ciphertext'
      and webhook_url_mask = 'chat.googleapis.com/v1/spaces/…/messages'
      and revision = 9007199254740998
      and updated_by = '30000000-0000-4000-8000-000000000001'
    from public.google_chat_webhook_settings
    where channel = 'admin'
  ),
  'replace atomically dual-writes current legacy plaintext and encrypted metadata'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_audit_logs
    where request_id = '30000000-0000-4000-8000-000000000404'
  ),
  1::bigint,
  'connection replace commits exactly one audit row across replay'
);
select ok(
  (
    select payload ->> 'revision' = '9007199254740998'
      and payload ->> 'connection_state' = 'encrypted_active'
      and payload ->> 'connection_key' = 'google_chat.management'
      and payload ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/…/messages'
      and payload::text !~ 'new-key|new-token|new-ciphertext|webhook_url_ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-replace-first'
  ),
  'connection replace returns masked metadata and decimal-string revision only'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000001',
        'admin',
        'https://chat.googleapis.com/v1/spaces/STALE/messages?key=stale&token=stale',
        'v1:stale-iv:stale-tag:stale-ciphertext',
        'chat.googleapis.com/v1/spaces/…/messages',
        9007199254740997,
        '30000000-0000-4000-8000-000000000405'
      )
    $sql$,
    'notification_connection_revision_conflict'
  ),
  'connection replace rejects a stale expected revision'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000001',
        'unknown',
        'https://chat.googleapis.com/v1/spaces/UNKNOWN/messages?key=x&token=y',
        'v1:x:y:z',
        'chat.googleapis.com/v1/spaces/…/messages',
        1,
        '30000000-0000-4000-8000-000000000406'
      )
    $sql$,
    'notification_connection_unknown'
  ),
  'connection mutation rejects arbitrary legacy channel keys'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-disconnect',
  public.disconnect_google_chat_connection_v1(
    '30000000-0000-4000-8000-000000000001',
    'admin',
    9007199254740998,
    '30000000-0000-4000-8000-000000000407'
  );

reset role;
select ok(
  (
    select connection_state = 'disconnected'
      and webhook_url = ''
      and webhook_url_ciphertext is null
      and webhook_url_mask is null
      and revision = 9007199254740999
    from public.google_chat_webhook_settings
    where channel = 'admin'
  ),
  'disconnect atomically clears ciphertext and blanks NOT NULL legacy plaintext'
);
select ok(
  (
    select payload ->> 'connection_state' = 'disconnected'
      and (payload ->> 'configured')::boolean = false
      and payload ->> 'revision' = '9007199254740999'
      and payload::text !~ 'new-key|new-token|new-ciphertext|webhook_url_ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-disconnect'
  ),
  'disconnect response cannot reactivate or disclose residual plaintext'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-first',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    true,
    'accepted',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-replay',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    true,
    'accepted',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-first'
  ),
  'verification result write is request-ledger idempotent'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-begin-completed-replay',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
select ok(
  (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload #>> '{connection,connection_state}' = 'encrypted_active'
      and payload #>> '{connection,revision}' = '9007199254740998'
      and not (payload ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and not ((payload -> 'connection') ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and payload::text !~* 'https://chat\.googleapis\.com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-begin-completed-replay'
  ),
  'completed verification replay returns only a safe connection DTO and never resends'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.begin_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000001',
        'executive',
        9007199254740998,
        '30000000-0000-4000-8000-000000000408'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'verification request ID cannot be replayed with a changed expected revision'
);

reset role;
select ok(
  (
    select last_verified_at is not null
      and last_error_code is null
      and revision = 9007199254740998
    from public.google_chat_webhook_settings
    where channel = 'executive'
  ),
  'successful verification stores only normalized time/result metadata'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id in (
      '30000000-0000-4000-8000-000000000404',
      '30000000-0000-4000-8000-000000000407',
      '30000000-0000-4000-8000-000000000408'
    )
      and concat_ws(' ', audit.before_summary::text, audit.after_summary::text)
        ~* 'new-key|new-token|new-ciphertext|legacy-key|legacy-token|fixture-ciphertext|webhook_url|ciphertext'
  ),
  'connection audit summaries contain state/revision only and no secret material'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000404',
      '30000000-0000-4000-8000-000000000407',
      '30000000-0000-4000-8000-000000000408'
    )
  ),
  3::bigint,
  'replace, disconnect, and verification each commit one durable request receipt'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000405',
      '30000000-0000-4000-8000-000000000406',
      '30000000-0000-4000-8000-000000000409'
    )
  ),
  0::bigint,
  'failed connection mutations commit neither ledger nor audit side effects'
);

-- A crashed provider call cannot strand a reservation forever. The next begin
-- replay expires it, and late record replays return one stable terminal envelope
-- without touching the current connection.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-begin', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000420'
);
reset role;
update dashboard_private.notification_request_ledger
set response_payload = pg_catalog.jsonb_set(
  response_payload,
  '{expires_at}',
  pg_catalog.to_jsonb(pg_catalog.clock_timestamp() - interval '1 second')
)
where request_id = '30000000-0000-4000-8000-000000000420';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-begin-terminal', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000420'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-begin-replay', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000420'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-record-terminal', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000420'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-record-replay', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000420'
);
reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-begin-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-begin-terminal'
  ),
  'expired begin replay returns the same terminal envelope and never sends again'
);
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-record-terminal'
  ),
  'late verification record replay returns the same expired terminal envelope'
);
select ok(
  (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload ->> 'terminal_code' = 'verification_expired'
      and payload #>> '{connection,revision}' = '8'
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-begin-terminal'
  )
  and (
    select payload ->> 'terminal_code' = 'verification_expired'
      and payload #>> '{connection,revision}' = '8'
      and payload::text !~* 'english-key|english-token|english-ciphertext|webhook_url'
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-record-terminal'
  )
  and (
    select revision = 8 and last_verified_at is null and last_error_code is null
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select response_payload ->> 'state' = 'expired'
      and response_payload ->> 'terminal_code' = 'verification_expired'
      and response_payload ->> 'attempted_result_code' = 'accepted'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000420'
  ),
  'crash expiry closes the ledger terminally while leaving the current connection unchanged and secret-free'
);

-- If the connection changes after the provider call, record owns only the
-- reservation ledger. It must not overwrite the newer connection row.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-begin', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000421'
);
reset role;
update public.google_chat_webhook_settings
set revision = 9,
    updated_at = pg_catalog.clock_timestamp()
where channel = 'english';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-record', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000421'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-record-replay', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000421'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-begin-replay', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000421'
);
reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-record'
  ),
  'superseded verification record replay returns the exact terminal envelope'
);
select ok(
  (
    select payload ->> 'terminal_code' = 'verification_superseded'
      and payload #>> '{connection,revision}' = '9'
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-record'
  )
  and (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload ->> 'terminal_code' = 'verification_superseded'
      and payload #>> '{connection,revision}' = '9'
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-begin-replay'
  )
  and (
    select revision = 9 and last_verified_at is null and last_error_code is null
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select response_payload ->> 'state' = 'superseded'
      and response_payload ->> 'terminal_reason' = 'connection_revision_changed'
      and response_payload ->> 'current_revision' = '9'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000421'
  ),
  'superseded verification closes only its reservation and preserves the newer connection row'
);

-- A begin reservation is the capability to finish the provider call. Actor
-- demotion after begin cannot strand a reserved ledger entry.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-demotion-begin', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  9,
  '30000000-0000-4000-8000-000000000422'
);
reset role;
update public.profiles
set role = 'staff'
where id = '30000000-0000-4000-8000-000000000001';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-demotion-record', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  9,
  '30000000-0000-4000-8000-000000000422'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-demotion-record-replay', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  9,
  '30000000-0000-4000-8000-000000000422'
);
reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-demotion-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-demotion-record'
  ),
  'matching reservation actor can replay completion after administrator demotion'
);
select ok(
  (
    select revision = 10
      and last_verified_at is not null
      and last_error_code is null
      and updated_by = '30000000-0000-4000-8000-000000000001'
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select response_payload ->> 'state' = 'completed'
      and response_payload ->> 'actor' = '30000000-0000-4000-8000-000000000001'
      and response_payload ->> 'result_code' = 'accepted'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000422'
  )
  and (
    select payload ->> 'revision' = '10'
      and payload ->> 'last_error_code' is null
      and payload::text !~* 'english-key|english-token|english-ciphertext|webhook_url'
    from notification_control_plane_runtime_results
    where result_key = 'connection-demotion-record'
  ),
  'demotion race completes the reservation normally instead of leaving permanent pending state'
);
update public.profiles
set role = 'admin'
where id = '30000000-0000-4000-8000-000000000001';

-- Task 7 durable worker/state-machine fixtures use a separate 7600 UUID range.
-- They exercise behavior that source-contract tests cannot prove without a DB.
select has_function(
  'public',
  'apply_notification_fanout_batch_v1',
  array['uuid', 'uuid', 'text', 'uuid', 'bigint', 'bigint', 'text', 'jsonb', 'text', 'boolean'],
  'fanout applies one immutable rule page through an internal service-only RPC'
);
select has_function(
  'public',
  'get_notification_render_snapshot_v1',
  array['uuid', 'uuid', 'bigint'],
  'target reconciliation reads one credential-free immutable render snapshot'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.apply_notification_fanout_batch_v1(uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text,boolean)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.apply_notification_fanout_batch_v1(uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text,boolean)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.get_notification_render_snapshot_v1(uuid,uuid,bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_notification_render_snapshot_v1(uuid,uuid,bigint)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.apply_notification_fanout_batch_v1(uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text,boolean)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.get_notification_render_snapshot_v1(uuid,uuid,bigint)',
    'EXECUTE'
  ),
  'public worker wrappers alone expose service-role execution; private implementations stay closed'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.apply_notification_fanout_batch_v1(uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text,boolean)'::pg_catalog.regprocedure
    )),
    'set search_path to '''''
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.apply_notification_fanout_batch_v1(uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text,boolean)'::pg_catalog.regprocedure
    ),
    'auth.role()'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.apply_notification_fanout_batch_v1(uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text,boolean)'::pg_catalog.regprocedure
    ),
    'dashboard_private.apply_notification_fanout_batch_v1'
  ) > 0,
  'public fanout wrapper fixes search_path, rechecks service role, and calls only the private implementation'
);
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.get_notification_render_snapshot_v1(
        '76000000-0000-4000-8000-000000000001',
        '76000000-0000-4000-8000-000000000002',
        1
      )
    $sql$,
    'permission denied|notification_service_role_required'
  ),
  'an authenticated caller cannot cross the internal worker wrapper boundary'
);
reset role;

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
  active_template_id, revision, created_by, created_actor_kind,
  updated_by, updated_actor_kind, created_at, updated_at
)
values
  (
    '76000000-0000-4000-8000-000000000101',
    'global', 'tasks', 'task.worker_delivery_fixture', 'google_chat',
    'management_team', 'immediate', 'immediate', null, null, true,
    '76000000-0000-4000-8000-000000000201', 1,
    null, 'system', null, 'system', now(), now()
  ),
  (
    '76000000-0000-4000-8000-000000000102',
    'global', 'tasks', 'task.worker_inbox_fixture', 'in_app',
    'primary_assignee', 'immediate', 'immediate', null, null, true,
    '76000000-0000-4000-8000-000000000202', 1,
    null, 'system', null, 'system', now(), now()
  );

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind, created_at
)
values
  (
    '76000000-0000-4000-8000-000000000201',
    '76000000-0000-4000-8000-000000000101',
    1, '작업 알림', '확인할 작업이 있습니다.', '[]'::jsonb, 1,
    'worker-google-chat-v1', null, 'system', now()
  ),
  (
    '76000000-0000-4000-8000-000000000202',
    '76000000-0000-4000-8000-000000000102',
    1, '받은 알림', '개인별 읽음 상태를 확인합니다.', '[]'::jsonb, 1,
    'worker-in-app-v1', null, 'system', now()
  );

update dashboard_private.notification_runtime_flags
set enabled = true,
    revision = revision + 1,
    updated_at = pg_catalog.clock_timestamp()
where flag_key = 'notification_control_plane_dispatch_tasks_enabled';
update public.google_chat_webhook_settings
set webhook_url = 'https://chat.googleapis.com/v1/spaces/WORKERFIXTURE/messages?key=fixture-key&token=fixture-token',
    connection_state = 'legacy_active',
    webhook_url_ciphertext = null,
    webhook_url_mask = null,
    revision = revision + 1,
    updated_at = pg_catalog.clock_timestamp()
where channel = 'admin';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-event-first', dashboard_private.record_notification_event_v1(
  'global',
  'tasks',
  'task.worker_delivery_fixture',
  'worker_fixture',
  'event-replay',
  1,
  'event-replay-occurrence',
  null,
  '2026-07-17 09:00:00+09'::timestamptz,
  1,
  '{"fixture":"event-replay"}'::jsonb,
  null,
  null
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-event-replay', dashboard_private.record_notification_event_v1(
  'global',
  'tasks',
  'task.worker_delivery_fixture',
  'worker_fixture',
  'event-replay',
  1,
  'event-replay-occurrence',
  null,
  '2026-07-17 09:00:00+09'::timestamptz,
  1,
  '{"fixture":"event-replay"}'::jsonb,
  null,
  null
);
reset role;
select is(
  (
    select payload from notification_control_plane_runtime_results
    where result_key = 'worker-event-replay'
  ),
  (
    select payload from notification_control_plane_runtime_results
    where result_key = 'worker-event-first'
  ),
  'occurrence replay returns the exact same event and fanout job pair'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.jsonb_object_keys((
      select payload from notification_control_plane_runtime_results
      where result_key = 'worker-event-first'
    ))
  ),
  2,
  'producer response contains exactly event_id and fanout_job_id'
);
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select dashboard_private.record_notification_event_v1(
        'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
        'event-replay', 1, 'event-replay-occurrence', null,
        '2026-07-17 09:00:00+09'::timestamptz, 1,
        '{"fixture":"different-payload"}'::jsonb, null, null
      )
    $sql$,
    'notification_event_replay_mismatch'
  ),
  'same occurrence with a changed producer payload is rejected'
);
reset role;

insert into dashboard_private.notification_events(
  id, scope_key, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at,
  payload_schema_version, payload, rule_snapshot
) values (
  '76000000-0000-4000-8000-000000000305',
  'global', 'tasks', 'task.worker_zero_rule_fixture', 'worker_fixture',
  'zero-rule', 1, 'zero-rule-occurrence', null, now(), 1,
  '{}'::jsonb, '[]'::jsonb
);
insert into dashboard_private.notification_event_fanout_jobs(
  id, event_id, workflow_key, status, next_attempt_at, created_at, updated_at
) values (
  '76000000-0000-4000-8000-000000000306',
  '76000000-0000-4000-8000-000000000305',
  'tasks', 'pending', '2000-01-01 00:00:00+00', now(), now()
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-fanout-claim', claim
from public.claim_notification_fanout_jobs_v1('worker-sql-fixture', 100, 60) claim
where claim ->> 'event_id' = (
  select payload ->> 'event_id'
  from notification_control_plane_runtime_results
  where result_key = 'worker-event-first'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-render-snapshot', public.get_notification_render_snapshot_v1(
  ((
    select payload ->> 'event_id'
    from notification_control_plane_runtime_results
    where result_key = 'worker-event-first'
  ))::uuid,
  '76000000-0000-4000-8000-000000000101',
  1
);
reset role;
select ok(
  (
    select payload ->> 'rule_id' = '76000000-0000-4000-8000-000000000101'
      and payload ->> 'rule_revision' = '1'
      and payload ->> 'cursor' is null
      and payload ->> 'next_cursor' is null
      and (payload ->> 'last_rule')::boolean
      and not (payload ? 'event')
    from notification_control_plane_runtime_results
    where result_key = 'worker-fanout-claim'
  )
  and (
    select payload::text !~* 'webhook|endpoint|p256dh|fixture-key|fixture-token|target_snapshot'
    from notification_control_plane_runtime_results
    where result_key = 'worker-render-snapshot'
  ),
  'fanout claim is flat and render snapshot contains no delivery credential or target'
);
select ok(
  (
    select status = 'succeeded'
      and claim_token is null
      and completed_at is not null
      and outcome_summary = '{"delivery_count":0,"done":true}'::jsonb
    from dashboard_private.notification_event_fanout_jobs
    where id = '76000000-0000-4000-8000-000000000306'
  ),
  'a zero-rule event closes atomically as a successful no-op during claim'
);
select is(
  dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', 'connection',
      'target_key', 'connection:google_chat.management',
      'target_profile_id', null,
      'connection_key', 'google_chat.management',
      'target_snapshot', pg_catalog.jsonb_build_object('active', true, 'team', 'management')
    ))
  ),
  '08b309b3dab749a8318c444e0421c6a45ea23f20371179c3c9817cac54a9c5c6',
  'database target canonicalization matches the TypeScript worker SHA-256 contract'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.apply_notification_fanout_batch_v1(%L::uuid,%L::uuid,null,%L::uuid,1,1,%L,%L::jsonb,null,true)',
      (
        select payload ->> 'job_id' from notification_control_plane_runtime_results
        where result_key = 'worker-fanout-claim'
      ),
      '76000000-0000-4000-8000-000000000999',
      '76000000-0000-4000-8000-000000000101',
      '08b309b3dab749a8318c444e0421c6a45ea23f20371179c3c9817cac54a9c5c6',
      '{"deliveries":[]}'
    ),
    'notification_fanout_claim_mismatch'
  ),
  'fanout apply rejects a mismatched claim token'
);
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.apply_notification_fanout_batch_v1(%L::uuid,%L::uuid,null,%L::uuid,1,1,%L,%L::jsonb,null,true)',
      (
        select payload ->> 'job_id' from notification_control_plane_runtime_results
        where result_key = 'worker-fanout-claim'
      ),
      (
        select payload ->> 'claim_token' from notification_control_plane_runtime_results
        where result_key = 'worker-fanout-claim'
      ),
      '76000000-0000-4000-8000-000000000101',
      pg_catalog.repeat('b', 64),
      '{"deliveries":[{"template_id":"76000000-0000-4000-8000-000000000201","target_kind":"connection","target_key":"connection:google_chat.management","target_profile_id":null,"connection_key":"google_chat.management","target_snapshot":{"active":true,"team":"management"},"rendered_title":"작업 알림","rendered_body":"확인할 작업이 있습니다.","href":"/admin/tasks","scheduled_for":"2026-07-17T00:00:00Z"}]}'
    ),
    'notification_target_set_hash_mismatch'
  ),
  'fanout apply recomputes and rejects a target hash that does not match normalized deliveries'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-fanout-applied', public.apply_notification_fanout_batch_v1(
  (
    select (payload ->> 'job_id')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-fanout-claim'
  ),
  (
    select (payload ->> 'claim_token')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-fanout-claim'
  ),
  null,
  '76000000-0000-4000-8000-000000000101',
  1,
  1,
  '08b309b3dab749a8318c444e0421c6a45ea23f20371179c3c9817cac54a9c5c6',
  pg_catalog.jsonb_build_object(
    'deliveries',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'template_id', '76000000-0000-4000-8000-000000000201',
      'target_kind', 'connection',
      'target_key', 'connection:google_chat.management',
      'target_profile_id', null,
      'connection_key', 'google_chat.management',
      'target_snapshot', pg_catalog.jsonb_build_object('active', true, 'team', 'management'),
      'rendered_title', '작업 알림',
      'rendered_body', '확인할 작업이 있습니다.',
      'href', '/admin/tasks',
      'scheduled_for', '2026-07-17T00:00:00Z'
    ))
  ),
  null,
  true
);
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.apply_notification_fanout_batch_v1(%L::uuid,%L::uuid,null,%L::uuid,1,1,%L,%L::jsonb,null,true)',
      (
        select payload ->> 'job_id' from notification_control_plane_runtime_results
        where result_key = 'worker-fanout-claim'
      ),
      (
        select payload ->> 'claim_token' from notification_control_plane_runtime_results
        where result_key = 'worker-fanout-claim'
      ),
      '76000000-0000-4000-8000-000000000101',
      '08b309b3dab749a8318c444e0421c6a45ea23f20371179c3c9817cac54a9c5c6',
      '{"deliveries":[]}'
    ),
    'notification_fanout_cursor_conflict'
  ),
  'fanout cursor compare-and-swap rejects a partial-page replay'
);
reset role;
select ok(
  (
    select payload = pg_catalog.jsonb_build_object(
      'outcome', 'applied', 'delivery_count', 1, 'cursor', null, 'done', true
    )
    from notification_control_plane_runtime_results
    where result_key = 'worker-fanout-applied'
  )
  and (
    select cursor ->> 'value' is null
      and (cursor ->> 'done')::boolean
      and outcome_summary = '{"delivery_count":1,"done":true}'::jsonb
    from dashboard_private.notification_event_fanout_jobs
    where id = (
      select (payload ->> 'job_id')::uuid
      from notification_control_plane_runtime_results
      where result_key = 'worker-fanout-claim'
    )
  ),
  'fanout apply persists only safe counts and advances the one-rule cursor atomically'
);

insert into dashboard_private.notification_events(
  id, scope_key, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at,
  payload_schema_version, payload, rule_snapshot
) values (
  '76000000-0000-4000-8000-000000000307',
  'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
  'historical-rule-snapshot', 1, 'historical-rule-snapshot-occurrence', null,
  '2026-07-17 09:05:00+09'::timestamptz, 1, '{}'::jsonb,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'rule_id', '76000000-0000-4000-8000-000000000101',
    'rule_revision', '1',
    'template_id', '76000000-0000-4000-8000-000000000201',
    'channel_key', 'google_chat',
    'audience_key', 'management_team',
    'rule_variant_key', 'immediate',
    'enabled', true
  ))
);
insert into dashboard_private.notification_event_fanout_jobs(
  id, event_id, workflow_key, status, next_attempt_at, created_at, updated_at
) values (
  '76000000-0000-4000-8000-000000000308',
  '76000000-0000-4000-8000-000000000307',
  'tasks', 'pending', '2000-01-01 00:00:00+00', now(), now()
);
update dashboard_private.notification_rules
set revision = 2,
    updated_at = pg_catalog.clock_timestamp()
where id = '76000000-0000-4000-8000-000000000101';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-historical-fanout-claim', claim
from public.claim_notification_fanout_jobs_v1('worker-historical-fixture', 100, 60) claim
where claim ->> 'event_id' = '76000000-0000-4000-8000-000000000307';
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-historical-fanout-applied', public.apply_notification_fanout_batch_v1(
  '76000000-0000-4000-8000-000000000308',
  (
    select (payload ->> 'claim_token')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-historical-fanout-claim'
  ),
  null,
  '76000000-0000-4000-8000-000000000101',
  1,
  1,
  '08b309b3dab749a8318c444e0421c6a45ea23f20371179c3c9817cac54a9c5c6',
  pg_catalog.jsonb_build_object(
    'deliveries',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'template_id', '76000000-0000-4000-8000-000000000201',
      'target_kind', 'connection',
      'target_key', 'connection:google_chat.management',
      'target_profile_id', null,
      'connection_key', 'google_chat.management',
      'target_snapshot', pg_catalog.jsonb_build_object('active', true, 'team', 'management'),
      'rendered_title', '과거 규칙 스냅샷 알림',
      'rendered_body', '이벤트 뒤 설정이 바뀌어도 당시 스냅샷으로 처리합니다.',
      'href', '/admin/tasks',
      'scheduled_for', '2026-07-17T00:05:00Z'
    ))
  ),
  null,
  true
);
reset role;
update dashboard_private.notification_rules
set revision = 1,
    updated_at = pg_catalog.clock_timestamp()
where id = '76000000-0000-4000-8000-000000000101';
select ok(
  (
    select payload ->> 'outcome' = 'applied'
      and payload ->> 'delivery_count' = '1'
    from notification_control_plane_runtime_results
    where result_key = 'worker-historical-fanout-applied'
  )
  and exists (
    select 1
    from dashboard_private.notification_deliveries delivery
    where delivery.event_id = '76000000-0000-4000-8000-000000000307'
      and delivery.rule_revision = 1
      and delivery.template_id = '76000000-0000-4000-8000-000000000201'
      and delivery.rendered_title = '과거 규칙 스냅샷 알림'
  ),
  '이벤트 뒤 현재 규칙 revision이 바뀌어도 고정 rule/template 스냅샷으로 전달을 만든다'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-target-job-a1', pg_catalog.jsonb_build_object(
  'job_id', dashboard_private.enqueue_notification_target_reconciliation_job_v1(
    'tasks', 'worker_fixture', 'recipient-cycle', 1,
    '76000000-0000-4000-8000-000000000311',
    'recipient_set_changed', 1, null, pg_catalog.repeat('a', 64)
  )
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-target-job-b', pg_catalog.jsonb_build_object(
  'job_id', dashboard_private.enqueue_notification_target_reconciliation_job_v1(
    'tasks', 'worker_fixture', 'recipient-cycle', 2,
    '76000000-0000-4000-8000-000000000312',
    'recipient_set_changed', 2, pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64)
  )
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-target-job-a2', pg_catalog.jsonb_build_object(
  'job_id', dashboard_private.enqueue_notification_target_reconciliation_job_v1(
    'tasks', 'worker_fixture', 'recipient-cycle', 3,
    '76000000-0000-4000-8000-000000000313',
    'recipient_set_changed', 3, pg_catalog.repeat('b', 64), pg_catalog.repeat('a', 64)
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'generation', job.target_generation::text,
      'hash', job.current_target_set_hash
    ) order by job.target_generation)
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.source_type = 'worker_fixture'
      and job.source_id = 'recipient-cycle'
  ),
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('generation', '1', 'hash', pg_catalog.repeat('a', 64)),
    pg_catalog.jsonb_build_object('generation', '2', 'hash', pg_catalog.repeat('b', 64)),
    pg_catalog.jsonb_build_object('generation', '3', 'hash', pg_catalog.repeat('a', 64))
  ),
  'A to B to A keeps a monotonic target generation while returning to the same A hash'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-delivery-claim', claim
from public.claim_notification_deliveries_v1('worker-sql-fixture', 100, 60) claim
where claim ->> 'delivery_id' = (
  select delivery.id::text
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id = (
    select (payload ->> 'event_id')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-event-first'
  )
    and delivery.rule_id = '76000000-0000-4000-8000-000000000101'
);
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.begin_notification_delivery_send_v1(%L::uuid,%L::uuid)',
      (
        select payload ->> 'delivery_id' from notification_control_plane_runtime_results
        where result_key = 'worker-delivery-claim'
      ),
      '76000000-0000-4000-8000-000000000998'
    ),
    'notification_delivery_claim_mismatch'
  ),
  'delivery begin rejects a mismatched claim token'
);
reset role;
update dashboard_private.notification_deliveries
set cancel_requested_at = pg_catalog.clock_timestamp(),
    cancel_reason = 'recipient_revoked'
where id = (
  select (payload ->> 'delivery_id')::uuid
  from notification_control_plane_runtime_results
  where result_key = 'worker-delivery-claim'
);
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-cancel-before-send', public.begin_notification_delivery_send_v1(
  (
    select (payload ->> 'delivery_id')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-delivery-claim'
  ),
  (
    select (payload ->> 'claim_token')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-delivery-claim'
  )
);
reset role;
select ok(
  (
    select payload ->> 'status' = 'canceled'
      and payload ->> 'status_reason' = 'recipient_revoked'
    from notification_control_plane_runtime_results
    where result_key = 'worker-cancel-before-send'
  )
  and (
    select status = 'canceled'
      and status_reason = 'recipient_revoked'
      and attempt_count = 0
      and last_attempt_started_at is null
    from dashboard_private.notification_deliveries
    where id = (
      select (payload ->> 'delivery_id')::uuid
      from notification_control_plane_runtime_results
      where result_key = 'worker-delivery-claim'
    )
  ),
  'cancel-before-send closes without provider dispatch or attempt increment'
);

insert into dashboard_private.notification_events(
  id, scope_key, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at,
  payload_schema_version, payload, rule_snapshot
)
values
  (
    '76000000-0000-4000-8000-000000000401',
    'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
    'lease-claimed', 1, 'lease-claimed-occurrence', null, now(), 1,
    '{}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'rule_id', '76000000-0000-4000-8000-000000000101',
      'rule_revision', '1',
      'template_id', '76000000-0000-4000-8000-000000000201',
      'channel_key', 'google_chat',
      'audience_key', 'management_team',
      'rule_variant_key', 'immediate',
      'enabled', true
    ))
  ),
  (
    '76000000-0000-4000-8000-000000000402',
    'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
    'lease-sending', 1, 'lease-sending-occurrence', null, now(), 1,
    '{}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'rule_id', '76000000-0000-4000-8000-000000000101',
      'rule_revision', '1',
      'template_id', '76000000-0000-4000-8000-000000000201',
      'channel_key', 'google_chat',
      'audience_key', 'management_team',
      'rule_variant_key', 'immediate',
      'enabled', true
    ))
  );

insert into dashboard_private.notification_deliveries(
  id, event_id, rule_id, rule_revision, template_id, channel_key, audience_key,
  target_generation, target_set_hash, target_kind, target_key,
  target_profile_id, connection_key, target_snapshot, status, status_reason,
  dedupe_key, rendered_title, rendered_body, href, scheduled_for,
  attempt_count, max_attempts, claimed_by, claim_token, lease_expires_at,
  next_attempt_at, last_attempt_started_at
)
values
  (
    '76000000-0000-4000-8000-000000000501',
    '76000000-0000-4000-8000-000000000401',
    '76000000-0000-4000-8000-000000000101', 1,
    '76000000-0000-4000-8000-000000000201',
    'google_chat', 'management_team', 1, pg_catalog.repeat('c', 64),
    'connection', 'connection:lease-claimed', null, 'google_chat.management',
    '{"active":true}'::jsonb, 'claimed', null, 'worker-lease-claimed',
    '임대 회수', 'claimed lease', '/admin/tasks', now() - interval '1 hour',
    0, 5, 'lost-worker', '76000000-0000-4000-8000-000000000601',
    now() - interval '1 minute', null, null
  ),
  (
    '76000000-0000-4000-8000-000000000502',
    '76000000-0000-4000-8000-000000000402',
    '76000000-0000-4000-8000-000000000101', 1,
    '76000000-0000-4000-8000-000000000201',
    'google_chat', 'management_team', 1, pg_catalog.repeat('d', 64),
    'connection', 'connection:lease-sending', null, 'google_chat.management',
    '{"active":true}'::jsonb, 'sending', null, 'worker-lease-sending',
    '임대 회수', 'sending lease', '/admin/tasks', now() - interval '1 hour',
    1, 5, 'lost-worker', '76000000-0000-4000-8000-000000000602',
    now() - interval '1 minute', null, now() - interval '2 minutes'
  );

insert into dashboard_private.notification_dispatch_ownership_claims(
  id, workflow_key, occurrence_key, rule_id, channel_key, target_key,
  target_generation, owner_kind, owner_generation, state,
  dispatch_started_at, dispatch_token
)
values
  (
    '76000000-0000-4000-8000-000000000701',
    'tasks', 'lease-claimed-occurrence',
    '76000000-0000-4000-8000-000000000101', 'google_chat',
    'connection:lease-claimed', 1, 'canonical', 0, 'reserved', null, null
  ),
  (
    '76000000-0000-4000-8000-000000000702',
    'tasks', 'lease-sending-occurrence',
    '76000000-0000-4000-8000-000000000101', 'google_chat',
    'connection:lease-sending', 1, 'canonical', 0, 'dispatch_started',
    now() - interval '2 minutes', '76000000-0000-4000-8000-000000000702'
  );

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.reap_notification_leases_v1(
        'worker-reaper-null-batch-fixture',
        null
      )
    $sql$,
    'notification_lease_reap_invalid'
  ),
  'lease reaping rejects an explicit null batch size instead of becoming unbounded'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-lease-reap', public.reap_notification_leases_v1('worker-reaper-fixture', 100);
reset role;
select ok(
  (
    select status = 'pending'
      and next_attempt_at is null
      and attempt_count = 0
      and claim_token is null
    from dashboard_private.notification_deliveries
    where id = '76000000-0000-4000-8000-000000000501'
  )
  and (
    select status = 'delivery_unknown'
      and status_reason = 'worker_lost_after_send_start'
      and next_attempt_at is null
      and attempt_count = 1
      and claim_token is null
    from dashboard_private.notification_deliveries
    where id = '76000000-0000-4000-8000-000000000502'
  )
  and (
    select state = 'closed'
    from dashboard_private.notification_dispatch_ownership_claims
    where id = '76000000-0000-4000-8000-000000000702'
  ),
  'lease reaping returns claimed work to pending but terminalizes sending as unknown'
);

update dashboard_private.notification_deliveries
set status = 'retry_wait',
    status_reason = 'transient_pre_dispatch_failure',
    next_attempt_at = now() - interval '1 second',
    updated_at = pg_catalog.clock_timestamp()
where id = '76000000-0000-4000-8000-000000000501';
create temporary table notification_worker_claim_rows(payload jsonb not null) on commit drop;
grant select, insert on notification_worker_claim_rows to service_role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_worker_claim_rows(payload)
select claim from public.claim_notification_deliveries_v1('worker-retry-fixture', 100, 60) claim;
reset role;
select ok(
  exists (
    select 1 from notification_worker_claim_rows
    where payload ->> 'delivery_id' = '76000000-0000-4000-8000-000000000501'
  )
  and not exists (
    select 1 from notification_worker_claim_rows
    where payload ->> 'delivery_id' = '76000000-0000-4000-8000-000000000502'
  )
  and (
    select status = 'delivery_unknown' and next_attempt_at is null
    from dashboard_private.notification_deliveries
    where id = '76000000-0000-4000-8000-000000000502'
  ),
  'retry_wait is claimable when due while delivery_unknown is never auto-retried'
);

insert into public.dashboard_notifications(
  id, recipient_team, type, title, body, href, metadata, read_at, created_at
)
values
  (
    '76000000-0000-4000-8000-000000000801',
    '관리팀', 'notification_control_plane', '공용 알림', '개인별 읽음 확인',
    '/admin/tasks', '{}'::jsonb, null, now()
  ),
  (
    '76000000-0000-4000-8000-000000000802',
    '관리팀', 'notification_control_plane', '과거 알림', '호환 read_at 확인',
    '/admin/tasks', '{}'::jsonb, now() - interval '1 day', now() - interval '2 days'
  );
insert into public.dashboard_notifications(
  id, recipient_profile_id, type, title, body, href, metadata,
  read_at, revoked_at, revoked_reason, created_at
) values (
  '76000000-0000-4000-8000-000000000803',
  '30000000-0000-4000-8000-000000000001',
  'notification_control_plane', '회수된 알림', '읽음 처리 경쟁을 확인합니다.',
  '/admin/tasks', '{}'::jsonb, null, pg_catalog.clock_timestamp(),
  'recipient_revoked', now()
);
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-count-before-internal-claim', public.get_dashboard_notification_unread_count_v1();
reset role;
insert into public.dashboard_notifications(
  id, recipient_team, type, title, body, href, metadata, read_at, created_at
) values (
  '76000000-0000-4000-8000-000000000804',
  '관리팀', 'registration_consultation_admin_chat',
  '내부 Google Chat claim', '받은 알림에 노출되면 안 됩니다.',
  '/admin/registration', '{"status":"sending"}'::jsonb, null,
  pg_catalog.clock_timestamp() + interval '1 hour'
);
select ok(
  (
    select
      pg_catalog.strpos(definition, 'from public.profiles profile') > 0
      and pg_catalog.strpos(definition, 'for share of profile') >
        pg_catalog.strpos(definition, 'from public.profiles profile')
      and pg_catalog.strpos(definition, 'from public.dashboard_notifications notification') >
        pg_catalog.strpos(definition, 'for share of profile')
      and pg_catalog.strpos(definition, 'for share of notification') >
        pg_catalog.strpos(definition, 'from public.dashboard_notifications notification')
      and pg_catalog.strpos(definition, 'pg_advisory_xact_lock') >
        pg_catalog.strpos(definition, 'for share of notification')
      and pg_catalog.strpos(definition, 'visible_dashboard_notification_rows_v1') >
        pg_catalog.strpos(definition, 'pg_advisory_xact_lock')
      and pg_catalog.strpos(definition, 'insert into public.dashboard_notification_read_receipts') >
        pg_catalog.strpos(definition, 'visible_dashboard_notification_rows_v1')
      and definition like '%notification_not_found%'
      and definition not like '%notification_not_visible%'
      and definition not like '%update public.dashboard_notifications%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.mark_dashboard_notification_read_v1(uuid)'::pg_catalog.regprocedure
      )) as definition
    ) function_source
  ),
  'read mutation locks profile then notification and rechecks the same personal/shared visibility before receipt insert'
);
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.get_dashboard_notification_inbox_v1(null, null, null)
    $sql$,
    'notification_inbox_cursor_invalid'
  ),
  'inbox rejects an explicit null limit instead of returning an unbounded page'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.mark_dashboard_notification_read_v1(
        '76000000-0000-4000-8000-000000000803'
      )
    $sql$,
    'notification_not_found'
  ),
  'revoked notification collapses to notification_not_found'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.mark_dashboard_notification_read_v1(
        '76000000-0000-4000-8000-000000000804'
      )
    $sql$,
    'notification_not_found'
  )
  and not exists (
    select 1
    from public.dashboard_notification_read_receipts receipt
    where receipt.notification_id = '76000000-0000-4000-8000-000000000804'
  ),
  'internal registration Chat claim cannot be marked and creates no receipt'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-inbox-with-internal-claim', public.get_dashboard_notification_inbox_v1(100, null, null);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-count-with-internal-claim', public.get_dashboard_notification_unread_count_v1();
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-read-admin', public.mark_dashboard_notification_read_v1(
  '76000000-0000-4000-8000-000000000801'
);
reset role;
select ok(
  not exists (
    select 1
    from pg_catalog.jsonb_array_elements((
      select payload -> 'items'
      from notification_control_plane_runtime_results
      where result_key = 'worker-inbox-with-internal-claim'
    )) item(value)
    where item.value ->> 'id' = '76000000-0000-4000-8000-000000000804'
  )
  and (
    select after.payload = before.payload
    from notification_control_plane_runtime_results after
    join notification_control_plane_runtime_results before
      on before.result_key = 'worker-count-before-internal-claim'
    where after.result_key = 'worker-count-with-internal-claim'
  )
  and not exists (
    select 1
    from dashboard_private.visible_dashboard_notification_rows_v1(
      '30000000-0000-4000-8000-000000000001'
    ) visible
    where visible.id = '76000000-0000-4000-8000-000000000804'
  ),
  'internal registration Chat claim is absent from list and count'
);
select ok(
  not exists (
    select 1
    from public.dashboard_notification_read_receipts receipt
    where receipt.notification_id = '76000000-0000-4000-8000-000000000803'
  )
  and exists (
    select 1
    from dashboard_private.visible_dashboard_notification_rows_v1(
      '30000000-0000-4000-8000-000000000002'
    ) visible
    where visible.id = '76000000-0000-4000-8000-000000000801'
      and visible.read_at is null
  )
  and exists (
    select 1
    from dashboard_private.visible_dashboard_notification_rows_v1(
      '30000000-0000-4000-8000-000000000001'
    ) visible
    where visible.id = '76000000-0000-4000-8000-000000000801'
      and visible.receipt_read_at is not null
  ),
  'one management reader does not mark the shared row read for another profile'
);
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-read-staff', public.mark_dashboard_notification_read_v1(
  '76000000-0000-4000-8000-000000000801'
);
reset role;
select ok(
  (
    select count(*) = 2
    from public.dashboard_notification_read_receipts receipt
    where receipt.notification_id = '76000000-0000-4000-8000-000000000801'
  )
  and (
    select notification.read_at is null
    from public.dashboard_notifications notification
    where notification.id = '76000000-0000-4000-8000-000000000801'
  )
  and not exists (
    select 1
    from public.dashboard_notification_read_receipts receipt
    where receipt.notification_id = '76000000-0000-4000-8000-000000000802'
  )
  and exists (
    select 1
    from dashboard_private.visible_dashboard_notification_rows_v1(
      '30000000-0000-4000-8000-000000000002'
    ) visible
    where visible.id = '76000000-0000-4000-8000-000000000802'
      and visible.read_at is not null
  ),
  'two profiles keep independent receipts and shared read_at stays null'
);

insert into public.dashboard_notifications(
  id, recipient_profile_id, type, title, body, href, metadata, read_at, created_at
) values
  (
    '76000000-0000-4000-8000-000000000901',
    '30000000-0000-4000-8000-000000000001',
    'notification_control_plane', '커서 1', '동일 시각 첫 번째',
    '/admin/tasks', '{}'::jsonb, null, '2099-01-01 00:00:00+00'
  ),
  (
    '76000000-0000-4000-8000-000000000902',
    '30000000-0000-4000-8000-000000000001',
    'notification_control_plane', '커서 2', '동일 시각 두 번째',
    '/admin/tasks', '{}'::jsonb, null, '2099-01-01 00:00:00+00'
  ),
  (
    '76000000-0000-4000-8000-000000000903',
    '30000000-0000-4000-8000-000000000001',
    'notification_control_plane', '커서 3', '동일 시각 세 번째',
    '/admin/tasks', '{}'::jsonb, null, '2099-01-01 00:00:00+00'
  );
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-cursor-page-one', public.get_dashboard_notification_inbox_v1(2, null, null);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'worker-cursor-page-two',
  public.get_dashboard_notification_inbox_v1(
    1,
    (
      select (payload -> 'next_cursor' ->> 'created_at')::timestamptz
      from notification_control_plane_runtime_results
      where result_key = 'worker-cursor-page-one'
    ),
    (
      select (payload -> 'next_cursor' ->> 'id')::uuid
      from notification_control_plane_runtime_results
      where result_key = 'worker-cursor-page-one'
    )
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-cursor-count', public.get_dashboard_notification_unread_count_v1();
reset role;
select ok(
  (
    select pg_catalog.jsonb_array_length(payload -> 'items') = 2
      and payload -> 'items' -> 0 ->> 'id' = '76000000-0000-4000-8000-000000000903'
      and payload -> 'items' -> 1 ->> 'id' = '76000000-0000-4000-8000-000000000902'
      and payload -> 'next_cursor' ->> 'id' = '76000000-0000-4000-8000-000000000902'
    from notification_control_plane_runtime_results
    where result_key = 'worker-cursor-page-one'
  )
  and (
    select payload -> 'items' -> 0 ->> 'id' = '76000000-0000-4000-8000-000000000901'
    from notification_control_plane_runtime_results
    where result_key = 'worker-cursor-page-two'
  ),
  'inbox cursor remains stable across equal created_at rows'
);
select ok(
  (
    select pg_catalog.jsonb_typeof(payload -> 'unread_count') = 'string'
      and payload ->> 'unread_count' ~ '^[0-9]+$'
    from notification_control_plane_runtime_results
    where result_key = 'worker-cursor-page-one'
  )
  and (
    select pg_catalog.jsonb_typeof(payload -> 'unread_count') = 'string'
      and payload ->> 'unread_count' ~ '^[0-9]+$'
    from notification_control_plane_runtime_results
    where result_key = 'worker-cursor-count'
  )
  and (
    select pg_catalog.jsonb_typeof(payload -> 'unread_count') = 'string'
      and payload ->> 'unread_count' ~ '^[0-9]+$'
    from notification_control_plane_runtime_results
    where result_key = 'worker-read-admin'
  ),
  'inbox list, count, and mark return decimal-string unread counts'
);

insert into dashboard_private.notification_events(
  id, scope_key, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at,
  payload_schema_version, payload, rule_snapshot
)
values
  (
    '76000000-0000-4000-8000-000000000403',
    'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
    'ownership-canonical-first', 1, 'ownership-canonical-first', null,
    now(), 1, '{}'::jsonb, '[]'::jsonb
  ),
  (
    '76000000-0000-4000-8000-000000000404',
    'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
    'ownership-legacy-first', 1, 'ownership-legacy-first', null,
    now(), 1, '{}'::jsonb, '[]'::jsonb
  );
insert into dashboard_private.notification_deliveries(
  id, event_id, rule_id, rule_revision, template_id, channel_key, audience_key,
  target_generation, target_set_hash, target_kind, target_key,
  target_profile_id, connection_key, target_snapshot, status, status_reason,
  dedupe_key, rendered_title, rendered_body, href, scheduled_for,
  attempt_count, max_attempts, next_attempt_at
)
values
  (
    '76000000-0000-4000-8000-000000000503',
    '76000000-0000-4000-8000-000000000403',
    '76000000-0000-4000-8000-000000000101', 1,
    '76000000-0000-4000-8000-000000000201',
    'google_chat', 'management_team', 1, pg_catalog.repeat('e', 64),
    'connection', 'connection:canonical-first', null, 'google_chat.management',
    '{"active":true}'::jsonb, 'pending', null, 'worker-canonical-first',
    '소유권', 'canonical first', '/admin/tasks', now(), 0, 5, now()
  ),
  (
    '76000000-0000-4000-8000-000000000504',
    '76000000-0000-4000-8000-000000000404',
    '76000000-0000-4000-8000-000000000101', 1,
    '76000000-0000-4000-8000-000000000201',
    'google_chat', 'management_team', 1, pg_catalog.repeat('f', 64),
    'connection', 'connection:legacy-first', null, 'google_chat.management',
    '{"active":true}'::jsonb, 'pending', null, 'worker-legacy-first',
    '소유권', 'legacy first', '/admin/tasks', now(), 0, 5, now()
  );

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-canonical-reserve', pg_catalog.jsonb_build_object(
  'claim_id', dashboard_private.reserve_canonical_dispatch_ownership_v1(
    '76000000-0000-4000-8000-000000000503'
  )
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-legacy-after-canonical', public.begin_legacy_notification_dispatch_v1(
  'tasks', 'ownership-canonical-first',
  '76000000-0000-4000-8000-000000000101', 'google_chat',
  'connection:canonical-first', 1, 'legacy-worker-fixture', 0,
  '76000000-0000-4000-8000-000000000901'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-legacy-first', public.begin_legacy_notification_dispatch_v1(
  'tasks', 'ownership-legacy-first',
  '76000000-0000-4000-8000-000000000101', 'google_chat',
  'connection:legacy-first', 1, 'legacy-worker-fixture', 0,
  '76000000-0000-4000-8000-000000000902'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-canonical-after-legacy', pg_catalog.jsonb_build_object(
  'claim_id', dashboard_private.reserve_canonical_dispatch_ownership_v1(
    '76000000-0000-4000-8000-000000000504'
  )
);
reset role;
select ok(
  (
    select not (payload ->> 'acquired')::boolean
      and payload ->> 'status' = 'legacy_deduped'
      and payload ->> 'reason' = 'ownership_not_acquired'
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-after-canonical'
  )
  and (
    select (payload ->> 'acquired')::boolean
      and payload ->> 'status' = 'dispatch_started'
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  )
  and (
    select payload ->> 'claim_id' is null
    from notification_control_plane_runtime_results
    where result_key = 'worker-canonical-after-legacy'
  )
  and (
    select status = 'skipped' and status_reason = 'legacy_deduped'
    from dashboard_private.notification_deliveries
    where id = '76000000-0000-4000-8000-000000000504'
  )
  and (
    select count(*) = 2
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.occurrence_key in (
      'ownership-canonical-first', 'ownership-legacy-first'
    )
  ),
  'canonical and legacy races converge on exactly one rule-scoped dispatch owner'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-legacy-finalized', public.finalize_legacy_notification_dispatch_v1(
  (
    select (payload ->> 'claim_id')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  ),
  (
    select (payload ->> 'owner_generation')::bigint
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  ),
  (
    select (payload ->> 'dispatch_token')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  ),
  'sent',
  'legacy-provider-reference-1'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-legacy-finalized-replay', public.finalize_legacy_notification_dispatch_v1(
  (
    select (payload ->> 'claim_id')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  ),
  (
    select (payload ->> 'owner_generation')::bigint
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  ),
  (
    select (payload ->> 'dispatch_token')::uuid
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-first'
  ),
  'sent',
  'legacy-provider-reference-1'
);
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.finalize_legacy_notification_dispatch_v1(%L::uuid,%L::bigint,%L::uuid,%L,%L)',
      (
        select payload ->> 'claim_id'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      (
        select payload ->> 'owner_generation'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      (
        select payload ->> 'dispatch_token'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      'failed',
      'legacy-provider-reference-1'
    ),
    'notification_legacy_finalize_replay_mismatch'
  ),
  'a closed legacy sent outcome cannot be replayed as failed'
);
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.finalize_legacy_notification_dispatch_v1(%L::uuid,%L::bigint,%L::uuid,%L,%L)',
      (
        select payload ->> 'claim_id'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      (
        select payload ->> 'owner_generation'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      (
        select payload ->> 'dispatch_token'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      'sent',
      'changed-provider-reference'
    ),
    'notification_legacy_finalize_replay_mismatch'
  ),
  'a closed legacy outcome cannot replay with a changed provider reference'
);
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.finalize_legacy_notification_dispatch_v1(%L::uuid,%L::bigint,%L::uuid,null,%L)',
      (
        select payload ->> 'claim_id'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      (
        select payload ->> 'owner_generation'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      (
        select payload ->> 'dispatch_token'
        from notification_control_plane_runtime_results
        where result_key = 'worker-legacy-first'
      ),
      'legacy-provider-reference-1'
    ),
    'notification_legacy_finalize_invalid'
  ),
  'legacy finalize rejects a null outcome at the closed input boundary'
);
reset role;
select ok(
  (
    select payload ->> 'outcome' = 'sent'
      and not (payload ->> 'replayed')::boolean
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-finalized'
  )
  and (
    select payload ->> 'outcome' = 'sent'
      and (payload ->> 'replayed')::boolean
    from notification_control_plane_runtime_results
    where result_key = 'worker-legacy-finalized-replay'
  )
  and (
    select terminal_outcome = 'sent'
      and provider_reference = 'legacy-provider-reference-1'
    from dashboard_private.notification_dispatch_ownership_claims
    where id = (
      select (payload ->> 'claim_id')::uuid
      from notification_control_plane_runtime_results
      where result_key = 'worker-legacy-first'
    )
  ),
  'legacy finalize replays only its first persisted terminal outcome and provider reference'
);

select has_function(
  'public',
  'record_push_connection_test_audit_v1',
  array['uuid', 'text', 'text'],
  'Push self-test writes only a normalized service-side audit result'
);
select has_function(
  'public',
  'rebind_dashboard_push_subscription_v1',
  array['text', 'text', 'text', 'text'],
  'an authenticated explicit capability RPC can rebind a browser Push subscription'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_push_connection_test_audit_v1(uuid,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_push_connection_test_audit_v1(uuid,text,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.rebind_dashboard_push_subscription_v1(text,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.rebind_dashboard_push_subscription_v1(text,text,text,text)',
    'EXECUTE'
  ),
  'Push test audit is service-only while explicit rebind is authenticated-only'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select public.record_push_connection_test_audit_v1(
  '30000000-0000-4000-8000-000000000001',
  'sent',
  'push_self_test_sent'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_push_connection_test_audit_v1(
        '30000000-0000-4000-8000-000000000001',
        'sent',
        'push_self_test_failed'
      )
    $sql$,
    'push_connection_test_audit_invalid'
  ),
  'Push self-test audit rejects an invalid outcome/code pair'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_push_connection_test_audit_v1(
        '30000000-0000-4000-8000-000000000001',
        null,
        'push_self_test_sent'
      )
    $sql$,
    'push_connection_test_audit_invalid'
  ),
  'Push self-test audit rejects a null outcome instead of bypassing the closed pair'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_push_connection_test_audit_v1(
        '30000000-0000-4000-8000-000000000001',
        'sent',
        null
      )
    $sql$,
    'push_connection_test_audit_invalid'
  ),
  'Push self-test audit rejects a null code instead of bypassing the closed pair'
);
reset role;
select ok(
  (
    select action = 'push_connection_tested'
      and actor_profile_id = '30000000-0000-4000-8000-000000000001'
      and actor_kind = 'user'
      and before_summary is null
      and after_summary = '{"outcome":"sent","code":"push_self_test_sent"}'::jsonb
      and reason_code = 'push_self_test_sent'
      and coalesce(after_summary::text, '') !~* 'endpoint|p256dh|auth|title|body|href'
    from dashboard_private.notification_audit_logs
    where action = 'push_connection_tested'
      and actor_profile_id = '30000000-0000-4000-8000-000000000001'
    order by created_at desc
    limit 1
  ),
  'Push self-test audit stores only actor plus normalized outcome and code'
);

insert into public.dashboard_push_subscriptions(
  id, profile_id, endpoint, p256dh, auth, user_agent, last_seen_at
) values (
  '76100000-0000-4000-8000-000000000801',
  '30000000-0000-4000-8000-000000000002',
  'https://fcm.googleapis.com/fcm/send/rebind-fixture-123',
  'fixtureP256Capability',
  'fixtureAuthCapability',
  'Old Fixture Browser',
  now() - interval '1 day'
);
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.rebind_dashboard_push_subscription_v1(
        'https://fcm.googleapis.com/fcm/send/rebind-fixture-123',
        'wrongP256Capability',
        'fixtureAuthCapability',
        'Fixture Browser/1.0'
      )
    $sql$,
    'push_subscription_rebind_capability_mismatch'
  ),
  'endpoint knowledge without the exact subscription capability cannot rebind an owner'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-push-rebound', public.rebind_dashboard_push_subscription_v1(
  'https://fcm.googleapis.com/fcm/send/rebind-fixture-123',
  'fixtureP256Capability',
  'fixtureAuthCapability',
  'Fixture Browser/1.0'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-push-rebound-replay', public.rebind_dashboard_push_subscription_v1(
  'https://fcm.googleapis.com/fcm/send/rebind-fixture-123',
  'fixtureP256Capability',
  'fixtureAuthCapability',
  'Fixture Browser/1.0'
);
reset role;
select ok(
  (
    select payload = '{"ok":true,"status":"rebound"}'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'worker-push-rebound'
  )
  and (
    select payload = '{"ok":true,"status":"current"}'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'worker-push-rebound-replay'
  )
  and (
    select profile_id = '30000000-0000-4000-8000-000000000001'
      and p256dh = 'fixtureP256Capability'
      and auth = 'fixtureAuthCapability'
      and user_agent = 'Fixture Browser/1.0'
    from public.dashboard_push_subscriptions
    where id = '76100000-0000-4000-8000-000000000801'
  )
  and (
    select count(*) = 1
      and pg_catalog.bool_and(
        coalesce(before_summary::text, '') !~* '30000000-0000-4000-8000-000000000002|fcm|p256|auth|endpoint'
        and coalesce(after_summary::text, '') !~* '30000000-0000-4000-8000-000000000002|fcm|p256|auth|endpoint'
      )
    from dashboard_private.notification_audit_logs
    where action = 'push_subscription_rebound'
      and entity_id = '76100000-0000-4000-8000-000000000801'
  ),
  'exact capability rebind returns normalized status and never records the prior owner, endpoint, or keys'
);

-- Manual retry approval reopens the closed canonical ownership generation in
-- the same transaction. Unknown outcomes still require explicit duplicate-risk
-- acceptance and are never claimed before that approval.
insert into dashboard_private.notification_events(
  id, scope_key, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at,
  payload_schema_version, payload, rule_snapshot
) values
  (
    '76100000-0000-4000-8000-000000000301',
    'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
    'manual-retry-failed', 1, 'manual-retry-failed-occurrence', null,
    now(), 1, '{}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'rule_id', '76000000-0000-4000-8000-000000000101',
      'rule_revision', '1',
      'template_id', '76000000-0000-4000-8000-000000000201',
      'channel_key', 'google_chat',
      'audience_key', 'management_team',
      'rule_variant_key', 'immediate',
      'enabled', true
    ))
  ),
  (
    '76100000-0000-4000-8000-000000000302',
    'global', 'tasks', 'task.worker_delivery_fixture', 'worker_fixture',
    'manual-retry-unknown', 1, 'manual-retry-unknown-occurrence', null,
    now(), 1, '{}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'rule_id', '76000000-0000-4000-8000-000000000101',
      'rule_revision', '1',
      'template_id', '76000000-0000-4000-8000-000000000201',
      'channel_key', 'google_chat',
      'audience_key', 'management_team',
      'rule_variant_key', 'immediate',
      'enabled', true
    ))
  );
insert into dashboard_private.notification_deliveries(
  id, event_id, rule_id, rule_revision, template_id, channel_key, audience_key,
  target_generation, target_set_hash, target_kind, target_key,
  target_profile_id, connection_key, target_snapshot, status, status_reason,
  dedupe_key, rendered_title, rendered_body, href, scheduled_for,
  attempt_count, max_attempts, next_attempt_at, last_attempt_started_at,
  provider_response_code, last_error_code, last_error_summary, resolved_at
) values
  (
    '76100000-0000-4000-8000-000000000401',
    '76100000-0000-4000-8000-000000000301',
    '76000000-0000-4000-8000-000000000101', 1,
    '76000000-0000-4000-8000-000000000201',
    'google_chat', 'management_team', 1, pg_catalog.repeat('1', 64),
    'connection', 'connection:manual-retry-failed', null,
    'google_chat.management', '{"active":true}'::jsonb,
    'failed', 'provider_definite_rejection', 'worker-manual-retry-failed',
    '수동 재시도', '실패 건 재시도', '/admin/tasks', now() - interval '1 hour',
    1, 5, null, now() - interval '5 minutes',
    '400', 'provider_rejected', 'definite rejection', now() - interval '4 minutes'
  ),
  (
    '76100000-0000-4000-8000-000000000402',
    '76100000-0000-4000-8000-000000000302',
    '76000000-0000-4000-8000-000000000101', 1,
    '76000000-0000-4000-8000-000000000201',
    'google_chat', 'management_team', 1, pg_catalog.repeat('2', 64),
    'connection', 'connection:manual-retry-unknown', null,
    'google_chat.management', '{"active":true}'::jsonb,
    'delivery_unknown', 'provider_ambiguous_response', 'worker-manual-retry-unknown',
    '수동 재시도', '불명 건 재시도', '/admin/tasks', now() - interval '1 hour',
    1, 5, null, now() - interval '5 minutes',
    'timeout', 'provider_timeout', 'ambiguous response', now() - interval '4 minutes'
  );
insert into dashboard_private.notification_dispatch_ownership_claims(
  id, workflow_key, occurrence_key, rule_id, channel_key, target_key,
  target_generation, owner_kind, owner_generation, state,
  dispatch_started_at, dispatch_token, provider_reference
) values
  (
    '76100000-0000-4000-8000-000000000501',
    'tasks', 'manual-retry-failed-occurrence',
    '76000000-0000-4000-8000-000000000101', 'google_chat',
    'connection:manual-retry-failed', 1, 'canonical', 0, 'closed',
    now() - interval '5 minutes',
    '76100000-0000-4000-8000-000000000601', 'old-failed-reference'
  ),
  (
    '76100000-0000-4000-8000-000000000502',
    'tasks', 'manual-retry-unknown-occurrence',
    '76000000-0000-4000-8000-000000000101', 'google_chat',
    'connection:manual-retry-unknown', 1, 'canonical', 0, 'closed',
    now() - interval '5 minutes',
    '76100000-0000-4000-8000-000000000602', 'old-unknown-reference'
  );
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-manual-retry-failed', public.reconcile_notification_delivery_v1(
  '76100000-0000-4000-8000-000000000401',
  'approve_retry',
  'operator_approved_retry',
  '76100000-0000-4000-8000-000000000701',
  false
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.reconcile_notification_delivery_v1(
        '76100000-0000-4000-8000-000000000402',
        'approve_retry',
        'missing_duplicate_confirmation',
        '76100000-0000-4000-8000-000000000702',
        false
      )
    $sql$,
    'notification_duplicate_risk_confirmation_required'
  ),
  'unknown delivery cannot be approved without duplicate-risk acceptance'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.reconcile_notification_delivery_v1(
        '76100000-0000-4000-8000-000000000402',
        'approve_retry',
        'null_duplicate_confirmation',
        '76100000-0000-4000-8000-000000000703',
        null
      )
    $sql$,
    'notification_delivery_reconciliation_invalid'
  ),
  'an explicit null duplicate-risk decision is rejected at the input boundary'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.reconcile_notification_delivery_v1(
        '76100000-0000-4000-8000-000000000402',
        null,
        'null_resolution',
        '76100000-0000-4000-8000-000000000705',
        true
      )
    $sql$,
    'notification_delivery_reconciliation_invalid'
  ),
  'an explicit null reconciliation resolution cannot become an implicit retry'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-manual-retry-unknown', public.reconcile_notification_delivery_v1(
  '76100000-0000-4000-8000-000000000402',
  'approve_retry',
  'operator_accepted_duplicate_risk',
  '76100000-0000-4000-8000-000000000704',
  true
);
reset role;
select ok(
  (
    select state = 'reserved'
      and owner_kind = 'canonical'
      and owner_generation = 1
      and dispatch_started_at is null
      and dispatch_token is null
      and provider_reference is null
    from dashboard_private.notification_dispatch_ownership_claims
    where id = '76100000-0000-4000-8000-000000000501'
  )
  and (
    select state = 'reserved'
      and owner_kind = 'canonical'
      and owner_generation = 1
      and dispatch_started_at is null
      and dispatch_token is null
      and provider_reference is null
    from dashboard_private.notification_dispatch_ownership_claims
    where id = '76100000-0000-4000-8000-000000000502'
  )
  and (
    select count(*) = 0
    from dashboard_private.notification_request_ledger
    where request_id in (
      '76100000-0000-4000-8000-000000000702',
      '76100000-0000-4000-8000-000000000703',
      '76100000-0000-4000-8000-000000000705'
    )
  ),
  'approved retries atomically reopen a fresh clean ownership generation and rejected approvals leave no ledger'
);
create temporary table notification_worker_manual_retry_claim_rows(payload jsonb not null) on commit drop;
grant select, insert on notification_worker_manual_retry_claim_rows to service_role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_worker_manual_retry_claim_rows(payload)
select claim
from public.claim_notification_deliveries_v1('worker-manual-retry-fixture', 100, 60) claim;
reset role;
select ok(
  exists (
    select 1 from notification_worker_manual_retry_claim_rows
    where payload ->> 'delivery_id' = '76100000-0000-4000-8000-000000000401'
  )
  and exists (
    select 1 from notification_worker_manual_retry_claim_rows
    where payload ->> 'delivery_id' = '76100000-0000-4000-8000-000000000402'
  )
  and not exists (
    select 1 from notification_worker_manual_retry_claim_rows
    where payload ->> 'delivery_id' = '76000000-0000-4000-8000-000000000502'
  ),
  'failed and explicitly approved unknown retries are claimable while an unapproved unknown remains terminal'
);

-- Personal rows remain personal even for managers, including contaminated
-- legacy rows that also carry the shared management-team marker.
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-admin-private-count-before', public.get_dashboard_notification_unread_count_v1();
reset role;
insert into public.dashboard_notifications(
  id, recipient_profile_id, recipient_team, type, title, body, href,
  metadata, read_at, created_at
) values
  (
    '76100000-0000-4000-8000-000000000201',
    '30000000-0000-4000-8000-000000000002',
    null,
    'notification_control_plane', 'B 개인 알림', 'B만 볼 수 있습니다.',
    '/admin/tasks', '{}'::jsonb, null, now()
  ),
  (
    '76100000-0000-4000-8000-000000000202',
    '30000000-0000-4000-8000-000000000002',
    '관리팀',
    'notification_control_plane', 'B 혼합 알림', '개인 수신자가 우선입니다.',
    '/admin/tasks', '{}'::jsonb, null, now()
  );
select pg_temp.notification_runtime_set_actor('30000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-admin-private-inbox', public.get_dashboard_notification_inbox_v1(100, null, null);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-admin-private-count', public.get_dashboard_notification_unread_count_v1();
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.mark_dashboard_notification_read_v1(
        '76100000-0000-4000-8000-000000000202'
      )
    $sql$,
    'notification_not_found'
  ),
  'non-owner notification collapses to notification_not_found'
);
reset role;
select ok(
  not exists (
    select 1
    from pg_catalog.jsonb_array_elements((
      select payload -> 'items'
      from notification_control_plane_runtime_results
      where result_key = 'worker-admin-private-inbox'
    )) item(value)
    where item.value ->> 'id' in (
      '76100000-0000-4000-8000-000000000201',
      '76100000-0000-4000-8000-000000000202'
    )
  )
  and not exists (
    select 1
    from dashboard_private.visible_dashboard_notification_rows_v1(
      '30000000-0000-4000-8000-000000000001'
    ) visible
    where visible.id in (
      '76100000-0000-4000-8000-000000000201',
      '76100000-0000-4000-8000-000000000202'
    )
  )
  and (
    select after.payload = before.payload
    from notification_control_plane_runtime_results after
    join notification_control_plane_runtime_results before
      on before.result_key = 'worker-admin-private-count-before'
    where after.result_key = 'worker-admin-private-count'
  )
  and (
    select count(*) = 2
    from dashboard_private.visible_dashboard_notification_rows_v1(
      '30000000-0000-4000-8000-000000000002'
    ) visible
    where visible.id in (
      '76100000-0000-4000-8000-000000000201',
      '76100000-0000-4000-8000-000000000202'
    )
  ),
  'personal and historical management-team visibility stays exact'
);

-- A scheduled rule occurrence keeps its domain schedule distinct from the
-- occurrence timestamp all the way through the fan-out claim envelope.
insert into dashboard_private.notification_rule_reconciliation_jobs(
  id, workflow_key, rule_revision_map, status, next_attempt_at, created_at, updated_at
) values (
  '76100000-0000-4000-8000-000000000001',
  'tasks',
  pg_catalog.jsonb_build_object('76000000-0000-4000-8000-000000000101', '1'),
  'pending',
  '2000-01-01 00:00:00+00',
  now(),
  now()
);
create temporary table notification_worker_rule_claim_rows(payload jsonb not null) on commit drop;
grant select, insert on notification_worker_rule_claim_rows to service_role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_worker_rule_claim_rows(payload)
select claim
from public.claim_notification_rule_reconciliation_jobs_v1(
  'worker-rule-schedule-fixture', 100, 60
) claim;
select ok(
  pg_temp.notification_runtime_throws(
    pg_catalog.format(
      'select public.apply_notification_rule_reconciliation_batch_v1(%L::uuid,%L::uuid,null,%L::jsonb,%L,true)',
      '76100000-0000-4000-8000-000000000001',
      (
        select payload ->> 'claim_token'
        from notification_worker_rule_claim_rows
        where payload ->> 'job_id' = '76100000-0000-4000-8000-000000000001'
      ),
      '{"sources":[],"occurrences":[]}',
      'unexpected-cursor'
    ),
    'notification_rule_reconciliation_batch_invalid'
  ),
  'a terminal rule-reconciliation page rejects a non-null next cursor'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.apply_notification_target_reconciliation_batch_v1(
        '76100000-0000-4000-8000-000000000099',
        '76100000-0000-4000-8000-000000000098',
        null,
        '{"target_generation":"1","target_set_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deliveries":[]}'::jsonb,
        'unexpected-cursor',
        true
      )
    $sql$,
    'notification_target_reconciliation_batch_invalid'
  ),
  'a terminal target-reconciliation page rejects a non-null next cursor'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'worker-scheduled-rule-applied', public.apply_notification_rule_reconciliation_batch_v1(
  '76100000-0000-4000-8000-000000000001',
  (
    select (payload ->> 'claim_token')::uuid
    from notification_worker_rule_claim_rows
    where payload ->> 'job_id' = '76100000-0000-4000-8000-000000000001'
  ),
  null,
  pg_catalog.jsonb_build_object(
    'sources', '[]'::jsonb,
    'occurrences', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'event_key', 'task.worker_delivery_fixture',
      'source_type', 'worker_fixture',
      'source_id', 'scheduled-reconciliation',
      'source_revision', '1',
      'occurrence_key', 'scheduled-reconciliation-occurrence',
      'occurred_at', '2026-07-17T00:00:00Z',
      'payload_schema_version', '1',
      'payload', pg_catalog.jsonb_build_object('fixture', 'scheduled-reconciliation'),
      'materialized_rule_id', '76000000-0000-4000-8000-000000000101',
      'materialized_rule_revision', '1',
      'scheduled_for', '2026-07-20T03:30:00Z'
    ))
  ),
  null,
  true
);
create temporary table notification_worker_scheduled_claim_rows(payload jsonb not null) on commit drop;
grant select, insert on notification_worker_scheduled_claim_rows to service_role;
insert into notification_worker_scheduled_claim_rows(payload)
select claim
from public.claim_notification_fanout_jobs_v1(
  'worker-scheduled-fanout-fixture', 100, 60
) claim;
reset role;
select ok(
  exists (
    select 1
    from dashboard_private.notification_event_fanout_jobs job
    join dashboard_private.notification_events event_row on event_row.id = job.event_id
    where event_row.occurrence_key = 'scheduled-reconciliation-occurrence'
      and event_row.occurred_at = '2026-07-17T00:00:00Z'::timestamptz
      and job.scheduled_for = '2026-07-20T03:30:00Z'::timestamptz
      and job.scheduled_for_source = 'rule_reconciliation'
  )
  and exists (
    select 1
    from notification_worker_scheduled_claim_rows
    where payload ->> 'occurrence_key' = 'scheduled-reconciliation-occurrence'
      and (payload ->> 'occurred_at')::timestamptz =
        '2026-07-17T00:00:00Z'::timestamptz
      and (payload ->> 'scheduled_for')::timestamptz =
        '2026-07-20T03:30:00Z'::timestamptz
  )
  and exists (
    select 1
    from dashboard_private.notification_event_fanout_jobs job
    join dashboard_private.notification_events event_row on event_row.id = job.event_id
    where event_row.occurrence_key = 'event-replay-occurrence'
      and job.scheduled_for = event_row.occurred_at
      and job.scheduled_for_source = 'event'
  ),
  'immediate and scheduled fan-out jobs preserve their distinct canonical schedule snapshots'
);

-- Heartbeats are a two-row state machine: one start and one immutable terminal.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select public.record_notification_worker_heartbeat_v1(
  'worker-heartbeat-fixture',
  '76100000-0000-4000-8000-000000000101',
  'started',
  '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select public.record_notification_worker_heartbeat_v1(
  'worker-heartbeat-fixture',
  '76100000-0000-4000-8000-000000000101',
  'succeeded',
  '{"fanout":1,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_notification_worker_heartbeat_v1(
        'worker-heartbeat-fixture',
        '76100000-0000-4000-8000-000000000101',
        'failed',
        '{"fanout":1,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
        'late_failure'
      )
    $sql$,
    'notification_worker_heartbeat_conflict'
  ),
  'a succeeded worker run rejects a later failed terminal'
);
select public.record_notification_worker_heartbeat_v1(
  'worker-heartbeat-fixture',
  '76100000-0000-4000-8000-000000000102',
  'started',
  '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select public.record_notification_worker_heartbeat_v1(
  'worker-heartbeat-fixture',
  '76100000-0000-4000-8000-000000000102',
  'failed',
  '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  'fixture_failure'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_notification_worker_heartbeat_v1(
        'worker-heartbeat-fixture',
        '76100000-0000-4000-8000-000000000102',
        'succeeded',
        '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
        null
      )
    $sql$,
    'notification_worker_heartbeat_conflict'
  ),
  'a failed worker run rejects a later succeeded terminal'
);
reset role;
select ok(
  (
    select count(*) = 2
      and count(*) filter (where phase in ('succeeded', 'failed')) = 1
    from dashboard_private.notification_worker_heartbeats
    where run_id = '76100000-0000-4000-8000-000000000101'
  )
  and (
    select count(*) = 2
      and count(*) filter (where phase in ('succeeded', 'failed')) = 1
    from dashboard_private.notification_worker_heartbeats
    where run_id = '76100000-0000-4000-8000-000000000102'
  ),
  'each worker run stores exactly one start and one terminal heartbeat'
);

select * from finish();
rollback;
