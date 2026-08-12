begin;

select plan(3);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry registry
    join dashboard_private.notification_rules rule_row
      on rule_row.id = registry.rule_id
    where registry.workflow_key = 'registration'
      and registry.event_key like 'registration.observation_%'
      and rule_row.active_template_id is not null
  ),
  8::bigint,
  'registration owns eight active observation notification templates'
);

select is(
  (
    select pg_catalog.count(*)
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
      and registry.event_key like 'registration.observation_%'
  ),
  8::bigint,
  'every active observation template has an exact compliance audit'
);

select is(
  (
    select pg_catalog.count(*)
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
      )
  ),
  0::bigint,
  'registration snapshot exposes no missing observation compliance state'
);

select * from finish();
rollback;
