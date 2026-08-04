begin;

set local lock_timeout = '5s';

do $$
declare
  v_promoted_rule_ids uuid[] := array[]::uuid[];
  v_promoted_count integer := 0;
  v_rule_id uuid;
  v_template_id uuid;
begin
  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry_row
    join dashboard_private.notification_rules rule_row
      on rule_row.id = registry_row.rule_id
    join dashboard_private.notification_templates active_template
      on active_template.id = rule_row.active_template_id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    left join dashboard_private.notification_templates vnext_template
      on vnext_template.id = dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-vnext-v1',
        rule_row.id::text || '|content-contract-' || contract_row.contract_version
      )
     and vnext_template.rule_id = rule_row.id
     and vnext_template.created_by is null
     and vnext_template.created_actor_kind = 'system'
     and vnext_template.content_contract_version = contract_row.contract_version
     and vnext_template.allowed_variables = contract_row.contract_json -> 'availableVariables'
     and vnext_template.payload_schema_version = (
       select max(payload_version.value::integer)
       from pg_catalog.jsonb_array_elements_text(
         contract_row.contract_json -> 'supportedPayloadVersions'
       ) payload_version(value)
     )
    where registry_row.channel_key <> 'customer_message'
      and active_template.created_by is null
      and active_template.created_actor_kind = 'system'
      and vnext_template.id is null
  ) then
    raise exception 'notification_system_template_vnext_baseline_missing'
      using errcode = '55000';
  end if;

  with eligible as (
    select
      rule_row.id as rule_id,
      rule_row.active_template_id as previous_template_id,
      vnext_template.id as next_template_id
    from dashboard_private.notification_settings_ui_registry registry_row
    join dashboard_private.notification_rules rule_row
      on rule_row.id = registry_row.rule_id
    join dashboard_private.notification_templates active_template
      on active_template.id = rule_row.active_template_id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    join dashboard_private.notification_templates vnext_template
      on vnext_template.id = dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-vnext-v1',
        rule_row.id::text || '|content-contract-' || contract_row.contract_version
      )
     and vnext_template.rule_id = rule_row.id
     and vnext_template.created_by is null
     and vnext_template.created_actor_kind = 'system'
     and vnext_template.content_contract_version = contract_row.contract_version
     and vnext_template.allowed_variables = contract_row.contract_json -> 'availableVariables'
     and vnext_template.payload_schema_version = (
       select max(payload_version.value::integer)
       from pg_catalog.jsonb_array_elements_text(
         contract_row.contract_json -> 'supportedPayloadVersions'
       ) payload_version(value)
     )
    where registry_row.channel_key <> 'customer_message'
      and active_template.created_by is null
      and active_template.created_actor_kind = 'system'
      and rule_row.active_template_id is distinct from vnext_template.id
    for update of rule_row
  ), promoted as (
    update dashboard_private.notification_rules rule_row
    set active_template_id = eligible.next_template_id,
        revision = rule_row.revision + 1,
        updated_by = null,
        updated_actor_kind = 'system',
        updated_at = pg_catalog.clock_timestamp()
    from eligible
    where rule_row.id = eligible.rule_id
      and rule_row.active_template_id = eligible.previous_template_id
    returning rule_row.id
  )
  select
    coalesce(array_agg(promoted.id), array[]::uuid[]),
    count(*)::integer
  into v_promoted_rule_ids, v_promoted_count
  from promoted;

  foreach v_rule_id in array v_promoted_rule_ids
  loop
    select rule_row.active_template_id
    into v_template_id
    from dashboard_private.notification_rules rule_row
    where rule_row.id = v_rule_id;

    perform dashboard_private.notification_template_compliance_v1(
      v_rule_id,
      v_template_id
    );
  end loop;

  if v_promoted_count > 0 then
    insert into dashboard_private.notification_audit_logs(
      id,
      scope_key,
      entity_kind,
      entity_id,
      action,
      actor_profile_id,
      actor_kind,
      request_id,
      before_summary,
      after_summary,
      reason_code
    ) values (
      dashboard_private.notification_deterministic_uuid_v1(
        'notification-system-template-vnext-promotion-v1',
        'system-active-templates'
      ),
      'global',
      'notification_system_templates',
      'vnext_promotion',
      'system_templates_promoted',
      null,
      'system',
      dashboard_private.notification_deterministic_uuid_v1(
        'notification-system-template-vnext-promotion-request-v1',
        'system-active-templates'
      ),
      pg_catalog.jsonb_build_object(
        'active_template_source', 'system_legacy'
      ),
      pg_catalog.jsonb_build_object(
        'promoted_rule_count', v_promoted_count,
        'user_custom_templates_preserved', true
      ),
      'notification_content_contract_vnext'
    )
    on conflict (id) do nothing;
  end if;
end;
$$;

commit;
