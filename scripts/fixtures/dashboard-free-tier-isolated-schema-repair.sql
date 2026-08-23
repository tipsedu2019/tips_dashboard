begin;

-- Test-only schema repair sources (the runner pins this whole file by SHA-256):
-- 20260803140000_notification_content_contracts.sql
-- source-commit=65c012c5da97fb189b54c2d29526f5e1aa239b4b
-- source-sha256=c501226c91e88ac92b4464847f026f4950195d5f8333e66b682e3395fae06280
-- 20260803143000_notification_registration_content_payload.sql
-- source-commit=ce3745568749a1defa851572c9be43e00675bef2
-- source-sha256=61373ad01e3d47d1eeb1fadb5d98e6f9b802665148650391b8ca3bc28b3331c8
-- 20260815182919_registration_customer_solapi_activation_evidence.sql
-- source-commit=673cabd7b82d06e56f4bc017680d185319162e6d
-- source-sha256=d8ce2248466c2eb5c755c2de2aed50e08b33950e459278a2e3ce9c77dd767a06

create table dashboard_private.notification_rule_content_contracts (
  rule_id uuid not null unique
    references dashboard_private.notification_rules(id),
  workflow_key text not null,
  event_key text not null,
  audience_key text not null,
  channel_key text not null,
  rule_variant_key text not null,
  contract_version text not null,
  contract_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (
    workflow_key,
    event_key,
    audience_key,
    channel_key,
    rule_variant_key
  ),
  constraint notification_rule_content_contracts_registry_fkey
    foreign key (
      workflow_key,
      event_key,
      audience_key,
      channel_key,
      rule_variant_key
    ) references dashboard_private.notification_settings_ui_registry(
      workflow_key,
      event_key,
      audience_key,
      channel_key,
      rule_variant_key
    ) deferrable initially deferred,
  constraint notification_rule_content_contracts_version_check
    check (contract_version ~ '^[1-9][0-9]*$'),
  constraint notification_rule_content_contracts_json_check
    check (
      pg_catalog.jsonb_typeof(contract_json) = 'object'
      and contract_json ->> 'contractVersion' = contract_version
      and pg_catalog.jsonb_typeof(contract_json -> 'availableVariables') = 'array'
      and pg_catalog.jsonb_typeof(contract_json -> 'requiredTokens') = 'array'
      and pg_catalog.jsonb_typeof(contract_json -> 'optionalLineTokens') = 'array'
      and pg_catalog.jsonb_typeof(contract_json -> 'destinationPolicy') = 'object'
    )
);

create table dashboard_private.notification_template_compliance_audits (
  template_id uuid not null
    references dashboard_private.notification_templates(id),
  rule_id uuid not null
    references dashboard_private.notification_rules(id),
  contract_version text not null,
  compliance text not null,
  violations jsonb not null,
  audited_at timestamptz not null default now(),
  primary key (template_id, contract_version),
  constraint notification_template_compliance_audits_state_check
    check (compliance in ('conformant', 'legacy_custom_nonconformant')),
  constraint notification_template_compliance_audits_violations_check
    check (pg_catalog.jsonb_typeof(violations) = 'array')
);

alter table dashboard_private.notification_rule_content_contracts owner to postgres;
alter table dashboard_private.notification_template_compliance_audits owner to postgres;
alter table dashboard_private.notification_rule_content_contracts enable row level security;
alter table dashboard_private.notification_template_compliance_audits enable row level security;
revoke all on table dashboard_private.notification_rule_content_contracts
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_template_compliance_audits
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_notification_kst_datetime_v1(
  p_value timestamptz,
  p_reference timestamptz default pg_catalog.now()
)
returns text
language sql
stable
strict
security definer
set search_path = ''
as $$
  select case
    when extract(year from p_value at time zone 'Asia/Seoul')
      = extract(year from p_reference at time zone 'Asia/Seoul')
      then pg_catalog.to_char(p_value at time zone 'Asia/Seoul', 'FMMM"월 "FMDD"일"')
    else pg_catalog.to_char(p_value at time zone 'Asia/Seoul', 'YYYY"년 "FMMM"월 "FMDD"일"')
  end
  || '(' || (array['일','월','화','수','목','금','토'])[
    extract(dow from p_value at time zone 'Asia/Seoul')::integer + 1
  ] || ') '
  || pg_catalog.to_char(p_value at time zone 'Asia/Seoul', 'HH24:MI');
$$;

revoke all on function dashboard_private.registration_notification_kst_datetime_v1(
  timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;
alter function dashboard_private.registration_notification_kst_datetime_v1(
  timestamptz,
  timestamptz
) owner to postgres;

do $readiness_patch$
declare
  v_definition text;
  v_original text;
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_customer_solapi_readiness_legacy_v1(uuid,text,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$\n  v_live_message public\.ops_registration_customer_messages%rowtype;$pattern$,
    '',
    'g'
  );
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$  elsif v_activation\.mode = 'live' then\n    select message\.\*\n    into v_live_message[\s\S]*?    v_activation_eligible := found\n      and v_activation\.live_test_confirmed_at is not null;$pattern$,
    $replacement$  elsif v_activation.mode = 'live' then
    v_activation_eligible := v_template_verified
      and dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
        p_message_kind, v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
      );$replacement$,
    'g'
  );
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message' then
    raise exception 'isolated_schema_repair_readiness_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$readiness_patch$;

do $claim_patch$
declare
  v_definition text;
  v_original text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_registration_customer_reminder_job_v1()'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$\n  v_live_message public\.ops_registration_customer_messages%rowtype;$pattern$,
    '',
    'g'
  );
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$      select message\.\* into v_live_message[\s\S]*?      if not found or v_activation\.live_test_confirmed_at is null then\n        continue;\n      end if;$pattern$,
    $replacement$      if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
        v_job.message_kind, v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
      ) then
        continue;
      end if;$replacement$,
    'g'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    $needle$      if v_activation.mode = 'live' and (
        v_job.activation_mode_snapshot is distinct from 'live'$needle$,
    $replacement$      if v_activation.mode = 'live' and (
        not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
          v_job.message_kind, v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
        )
        or v_job.activation_mode_snapshot is distinct from 'live'$replacement$
  );
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message'
    or v_definition !~ 'registration_customer_solapi_live_evidence_valid_v1' then
    raise exception 'isolated_schema_repair_claim_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$claim_patch$;

do $legacy_begin_patch$
declare
  v_definition text;
  v_original text;
  v_start integer;
  v_end integer;
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    $needle$
  v_live_message public.ops_registration_customer_messages%rowtype;$needle$,
    ''
  );
  v_start := pg_catalog.strpos(
    v_definition,
    $needle$  select message.* into v_live_message$needle$
  );
  if v_start = 0 then
    raise exception 'isolated_schema_repair_legacy_begin_patch_failed'
      using errcode = '55000';
  end if;
  v_end := pg_catalog.strpos(
    pg_catalog.substr(v_definition, v_start),
    $needle$  end if;$needle$
  );
  if v_end = 0 then
    raise exception 'isolated_schema_repair_legacy_begin_patch_failed'
      using errcode = '55000';
  end if;
  v_end := v_start + v_end + pg_catalog.length($needle$  end if;$needle$) - 2;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1)
    || $replacement$  if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    'appointment_reminder', v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
  ) then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;$replacement$
    || pg_catalog.substr(v_definition, v_end + 1);
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message' then
    raise exception 'isolated_schema_repair_legacy_begin_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$legacy_begin_patch$;

do $begin_patch$
declare
  v_definition text;
  v_original text;
  v_start integer;
  v_end integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    $needle$
  v_live_message public.ops_registration_customer_messages%rowtype;$needle$,
    ''
  );
  v_start := pg_catalog.strpos(
    v_definition,
    $needle$    select message.* into v_live_message$needle$
  );
  if v_start = 0 then
    raise exception 'isolated_schema_repair_begin_patch_failed'
      using errcode = '55000';
  end if;
  v_end := pg_catalog.strpos(
    pg_catalog.substr(v_definition, v_start),
    $needle$    end if;$needle$
  );
  if v_end = 0 then
    raise exception 'isolated_schema_repair_begin_patch_failed'
      using errcode = '55000';
  end if;
  v_end := v_start + v_end + pg_catalog.length($needle$    end if;$needle$) - 2;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1)
    || $replacement$    if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
      'observation_reminder', v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
    ) then
      raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
    end if;$replacement$
    || pg_catalog.substr(v_definition, v_end + 1);
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message' then
    raise exception 'isolated_schema_repair_begin_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$begin_patch$;

do $isolated_schema_repair_postcondition$
declare
  v_identity pg_catalog.regprocedure;
  v_definition text;
begin
  if pg_catalog.to_regclass('dashboard_private.notification_rule_content_contracts') is null
    or pg_catalog.to_regclass('dashboard_private.notification_template_compliance_audits') is null
    or (select count(*) from dashboard_private.notification_rule_content_contracts) <> 0
    or (select count(*) from dashboard_private.notification_template_compliance_audits) <> 0
    or pg_catalog.to_regprocedure(
      'dashboard_private.registration_notification_kst_datetime_v1(timestamp with time zone,timestamp with time zone)'
    ) is null then
    raise exception 'isolated_schema_repair_object_postcondition_failed'
      using errcode = '55000';
  end if;
  foreach v_identity in array array[
    'dashboard_private.registration_customer_solapi_readiness_legacy_v1(uuid,text,uuid,jsonb)'::pg_catalog.regprocedure,
    'public.claim_registration_customer_reminder_job_v1()'::pg_catalog.regprocedure,
    'dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure,
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ] loop
    v_definition := pg_catalog.pg_get_functiondef(v_identity);
    if v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message'
      or v_definition !~ 'registration_customer_solapi_live_evidence_valid_v1' then
      raise exception 'isolated_schema_repair_function_postcondition_failed'
        using errcode = '55000';
    end if;
  end loop;
end;
$isolated_schema_repair_postcondition$;

commit;
