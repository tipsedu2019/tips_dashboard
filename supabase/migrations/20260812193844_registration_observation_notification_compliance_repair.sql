begin;

set local lock_timeout = '5s';

do $$
declare
  v_active_template_count bigint;
  v_audit_count bigint;
  v_invalid_snapshot_count bigint;
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.notification_template_compliance_v1(uuid,uuid)'
  ) is null then
    raise exception 'registration_observation_notification_compliance_dependency_missing'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)
  into v_active_template_count
  from dashboard_private.notification_settings_ui_registry registry
  join dashboard_private.notification_rules rule_row
    on rule_row.id = registry.rule_id
  where registry.workflow_key = 'registration'
    and registry.event_key like 'registration.observation_%'
    and rule_row.active_template_id is not null;

  if v_active_template_count <> 8 then
    raise exception 'registration_observation_notification_template_drift'
      using errcode = '55000';
  end if;

  perform dashboard_private.notification_template_compliance_v1(
    rule_row.id,
    rule_row.active_template_id
  )
  from dashboard_private.notification_settings_ui_registry registry
  join dashboard_private.notification_rules rule_row
    on rule_row.id = registry.rule_id
  where registry.workflow_key = 'registration'
    and registry.event_key like 'registration.observation_%'
  order by rule_row.id;

  select pg_catalog.count(*)
  into v_audit_count
  from dashboard_private.notification_settings_ui_registry registry
  join dashboard_private.notification_rules rule_row
    on rule_row.id = registry.rule_id
  join dashboard_private.notification_rule_content_contracts contract_row
    on contract_row.rule_id = rule_row.id
  join dashboard_private.notification_template_compliance_audits audit_row
    on audit_row.template_id = rule_row.active_template_id
   and audit_row.rule_id = rule_row.id
   and audit_row.contract_version = contract_row.contract_version
  where registry.workflow_key = 'registration'
    and registry.event_key like 'registration.observation_%';

  if v_audit_count <> 8 then
    raise exception 'registration_observation_notification_compliance_repair_failed'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)
  into v_invalid_snapshot_count
  from pg_catalog.jsonb_array_elements(
    dashboard_private.notification_control_plane_snapshot_v1(
      'registration',
      true
    ) -> 'rules'
  ) rule_payload
  where rule_payload ->> 'event_key' like 'registration.observation_%'
    and (
      rule_payload #>> '{template_compliance,compliance}' is null
      or rule_payload #>> '{template_compliance,compliance}' not in (
        'conformant',
        'legacy_custom_nonconformant'
      )
    );

  if v_invalid_snapshot_count <> 0 then
    raise exception 'registration_observation_notification_snapshot_unsafe'
      using errcode = '55000';
  end if;
end;
$$;

commit;
