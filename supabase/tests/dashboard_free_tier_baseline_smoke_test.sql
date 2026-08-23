begin;
select plan(14);

select has_schema('supabase_migrations', 'baseline restores migration ledger schema');
select has_table('public', 'profiles', 'baseline restores the scoped profiles relation');
select is(
  (select count(*) from public.class_schedule_sync_groups),
  1::bigint,
  'isolated baseline contains exactly one synthetic class period prerequisite'
);
select ok(
  exists (
    select 1
    from public.class_schedule_sync_groups
    where id = '00000000-0000-4000-8000-000000000001'::uuid
      and name = 'Isolated schema contract default period'
      and sort_order = 0
      and is_default
  ),
  'isolated baseline prerequisite uses the fixed non-production values'
);
select has_table(
  'dashboard_private',
  'notification_rule_content_contracts',
  'isolated schema repair restores the notification content contract table'
);
select has_table(
  'dashboard_private',
  'notification_template_compliance_audits',
  'isolated schema repair restores the notification compliance audit table'
);
select is(
  (select pg_catalog.jsonb_build_array(
    (select count(*) from dashboard_private.notification_rule_content_contracts),
    (select count(*) from dashboard_private.notification_template_compliance_audits)
  )),
  '[0, 0]'::jsonb,
  'isolated schema repair never copies private production rows'
);
select has_function(
  'dashboard_private',
  'registration_notification_kst_datetime_v1',
  array['timestamp with time zone', 'timestamp with time zone'],
  'isolated schema repair restores the exact KST datetime helper signature'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'dashboard_private'
      and procedure.proname = 'registration_notification_kst_datetime_v1'
      and procedure.proargtypes = '1184 1184'::pg_catalog.oidvector
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proisstrict
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=""']::text[]
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
  ),
  'KST datetime helper retains owner, security, volatility, search path, and ACL'
);
select ok(
  (select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(
      namespace.nspname,
      relation.relname,
      attribute.attname,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull
    ) order by namespace.nspname, relation.relname, attribute.attnum
  )
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'dashboard_private'
    and relation.relname in (
      'notification_rule_content_contracts',
      'notification_template_compliance_audits'
    )
    and attribute.attnum > 0
    and not attribute.attisdropped) = '[
      ["dashboard_private", "notification_rule_content_contracts", "rule_id", "uuid", true],
      ["dashboard_private", "notification_rule_content_contracts", "workflow_key", "text", true],
      ["dashboard_private", "notification_rule_content_contracts", "event_key", "text", true],
      ["dashboard_private", "notification_rule_content_contracts", "audience_key", "text", true],
      ["dashboard_private", "notification_rule_content_contracts", "channel_key", "text", true],
      ["dashboard_private", "notification_rule_content_contracts", "rule_variant_key", "text", true],
      ["dashboard_private", "notification_rule_content_contracts", "contract_version", "text", true],
      ["dashboard_private", "notification_rule_content_contracts", "contract_json", "jsonb", true],
      ["dashboard_private", "notification_rule_content_contracts", "created_at", "timestamp with time zone", true],
      ["dashboard_private", "notification_template_compliance_audits", "template_id", "uuid", true],
      ["dashboard_private", "notification_template_compliance_audits", "rule_id", "uuid", true],
      ["dashboard_private", "notification_template_compliance_audits", "contract_version", "text", true],
      ["dashboard_private", "notification_template_compliance_audits", "compliance", "text", true],
      ["dashboard_private", "notification_template_compliance_audits", "violations", "jsonb", true],
      ["dashboard_private", "notification_template_compliance_audits", "audited_at", "timestamp with time zone", true]
    ]'::jsonb,
  'isolated private notification tables retain the exact source column shape'
);
select ok(
  (select count(*) = 2
    and pg_catalog.bool_and(
      relation.relrowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )) privilege
        left join pg_catalog.pg_roles role_row on role_row.oid = privilege.grantee
        where privilege.grantee = 0
          or role_row.rolname in ('anon', 'authenticated', 'service_role')
      )
    )
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'dashboard_private'
    and relation.relname in (
      'notification_rule_content_contracts',
      'notification_template_compliance_audits'
    )),
  'isolated private notification tables retain exact ownership, RLS, and ACL'
);
select ok(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        relation.relname,
        constraint_row.conname,
        constraint_row.contype,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        case
          when constraint_row.confrelid = 0 then null
          else constraint_row.confrelid::pg_catalog.regclass::text
        end
      ) order by relation.relname, constraint_row.conname
    )
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname in (
        'notification_rule_content_contracts',
        'notification_template_compliance_audits'
      )
  ) = '[
    ["notification_rule_content_contracts", "notification_rule_content_contracts_json_check", "c", false, false, null],
    ["notification_rule_content_contracts", "notification_rule_content_contracts_pkey", "p", false, false, null],
    ["notification_rule_content_contracts", "notification_rule_content_contracts_registry_fkey", "f", true, true, "dashboard_private.notification_settings_ui_registry"],
    ["notification_rule_content_contracts", "notification_rule_content_contracts_rule_id_fkey", "f", false, false, "dashboard_private.notification_rules"],
    ["notification_rule_content_contracts", "notification_rule_content_contracts_rule_id_key", "u", false, false, null],
    ["notification_rule_content_contracts", "notification_rule_content_contracts_version_check", "c", false, false, null],
    ["notification_template_compliance_audits", "notification_template_compliance_audits_pkey", "p", false, false, null],
    ["notification_template_compliance_audits", "notification_template_compliance_audits_rule_id_fkey", "f", false, false, "dashboard_private.notification_rules"],
    ["notification_template_compliance_audits", "notification_template_compliance_audits_state_check", "c", false, false, null],
    ["notification_template_compliance_audits", "notification_template_compliance_audits_template_id_fkey", "f", false, false, "dashboard_private.notification_templates"],
    ["notification_template_compliance_audits", "notification_template_compliance_audits_violations_check", "c", false, false, null]
  ]'::jsonb
  and (
    select pg_catalog.bool_and(
      case constraint_row.conname
        when 'notification_rule_content_contracts_pkey' then
          definition = 'PRIMARY KEY (workflow_key, event_key, audience_key, channel_key, rule_variant_key)'
        when 'notification_rule_content_contracts_rule_id_key' then
          definition = 'UNIQUE (rule_id)'
        when 'notification_rule_content_contracts_rule_id_fkey' then
          definition = 'FOREIGN KEY (rule_id) REFERENCES dashboard_private.notification_rules(id)'
        when 'notification_rule_content_contracts_registry_fkey' then
          definition = 'FOREIGN KEY (workflow_key, event_key, audience_key, channel_key, rule_variant_key) REFERENCES dashboard_private.notification_settings_ui_registry(workflow_key, event_key, audience_key, channel_key, rule_variant_key) DEFERRABLE INITIALLY DEFERRED'
        when 'notification_rule_content_contracts_version_check' then
          pg_catalog.strpos(definition, 'contract_version ~') > 0
          and pg_catalog.strpos(definition, '^[1-9][0-9]*$') > 0
        when 'notification_rule_content_contracts_json_check' then
          definition ~ 'contractVersion'
          and definition ~ 'availableVariables'
          and definition ~ 'requiredTokens'
          and definition ~ 'optionalLineTokens'
          and definition ~ 'destinationPolicy'
        when 'notification_template_compliance_audits_pkey' then
          definition = 'PRIMARY KEY (template_id, contract_version)'
        when 'notification_template_compliance_audits_template_id_fkey' then
          definition = 'FOREIGN KEY (template_id) REFERENCES dashboard_private.notification_templates(id)'
        when 'notification_template_compliance_audits_rule_id_fkey' then
          definition = 'FOREIGN KEY (rule_id) REFERENCES dashboard_private.notification_rules(id)'
        when 'notification_template_compliance_audits_state_check' then
          definition ~ 'conformant' and definition ~ 'legacy_custom_nonconformant'
        when 'notification_template_compliance_audits_violations_check' then
          definition ~ 'jsonb_typeof\(violations\)' and definition ~ '''array'''
        else false
      end
    )
    from (
      select
        constraint_row.*,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true) as definition
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid in (
        'dashboard_private.notification_rule_content_contracts'::pg_catalog.regclass,
        'dashboard_private.notification_template_compliance_audits'::pg_catalog.regclass
      )
    ) constraint_row
  ),
  'isolated private notification tables retain all exact keys, references, and checks'
);
select ok(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        relation.relname,
        attribute.attname,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
      ) order by relation.relname, attribute.attname
    )
    from pg_catalog.pg_attrdef default_row
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = default_row.adrelid
     and attribute.attnum = default_row.adnum
    join pg_catalog.pg_class relation on relation.oid = default_row.adrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname in (
        'notification_rule_content_contracts',
        'notification_template_compliance_audits'
      )
  ) = '[
    ["notification_rule_content_contracts", "created_at", "now()"],
    ["notification_template_compliance_audits", "audited_at", "now()"]
  ]'::jsonb,
  'isolated private notification tables retain only the exact timestamp defaults'
);
select is(
  (select count(*)
  from pg_catalog.unnest(array[
    'dashboard_private.registration_customer_solapi_readiness_legacy_v1(uuid,text,uuid,jsonb)'::pg_catalog.regprocedure,
    'public.claim_registration_customer_reminder_job_v1()'::pg_catalog.regprocedure,
    'dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure,
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ]) identity
  where pg_catalog.pg_get_functiondef(identity) !~
      'live_test_message_id|live_test_confirmed_at|v_live_message'
    and pg_catalog.pg_get_functiondef(identity) ~
      'registration_customer_solapi_live_evidence_valid_v1'),
  4::bigint,
  'isolated schema repair restores all four activation-evidence function patches'
);

select * from finish();
rollback;
