begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Preserve existing rule values and receipts. Only new writes to archived settings are rejected.
create or replace function dashboard_private.notification_registration_setting_archived_v1(
  p_workflow_key text, p_event_key text, p_channel_key text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_workflow_key = 'registration' and p_channel_key = 'google_chat'
    and p_event_key in (
      'registration.observation_scheduled',
      'registration.observation_rescheduled',
      'registration.observation_canceled',
      'registration.observation_reminder_due',
      'registration.observation_feedback_due',
      'registration.observation_feedback_submitted',
      'registration.observation_director_reassigned',
      'registration.appointment_reminder_due',
      'registration.registration_completed',
      'registration.case_closed'
    );
$$;

create or replace function dashboard_private.assert_notification_settings_patch_editable_v1(
  p_patch jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (public.current_dashboard_role() in ('admin', 'staff')) is not true
    or dashboard_private.notification_profile_is_active_v1((select auth.uid())) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_patch -> 'rules') = 'object' and exists (
    select 1 from dashboard_private.notification_rules rule
    where p_patch -> 'rules' ? rule.id::text
      and dashboard_private.notification_registration_setting_archived_v1(
        rule.workflow_key, rule.event_key, rule.channel_key
      )
  ) then
    raise exception 'notification_setting_archived' using errcode = '23514';
  end if;
end;
$$;


create or replace function public.save_notification_control_plane_v1(
  p_workflow_key text,
  p_expected_revisions jsonb,
  p_patch jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_rule_id_text text;
  v_rule_id uuid;
begin
  perform dashboard_private.assert_notification_settings_patch_editable_v1(p_patch);
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  if p_patch is not null
    and pg_catalog.jsonb_typeof(p_patch) = 'object'
    and p_patch ? 'rules'
    and pg_catalog.jsonb_typeof(p_patch -> 'rules') = 'object'
  then
    for v_rule_id_text in
      select patch_key.value
      from pg_catalog.jsonb_object_keys(p_patch -> 'rules') patch_key(value)
      order by patch_key.value
    loop
      if v_rule_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'notification_rule_not_in_registry'
          using errcode = '22023';
      end if;
      v_rule_id := v_rule_id_text::uuid;
      perform 1
      from dashboard_private.notification_rules rule_row
      join dashboard_private.notification_settings_ui_registry registry_row
        on registry_row.rule_id = rule_row.id
       and registry_row.workflow_key = rule_row.workflow_key
       and registry_row.event_key = rule_row.event_key
       and registry_row.audience_key = rule_row.audience_key
       and registry_row.channel_key = rule_row.channel_key
       and registry_row.rule_variant_key = rule_row.rule_variant_key
      where rule_row.id = v_rule_id
        and rule_row.scope_key = 'global'
        and rule_row.workflow_key = p_workflow_key;
      if not found then
        raise exception 'notification_rule_not_in_registry'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  return dashboard_private.save_notification_control_plane_unchecked_v1(
    p_workflow_key,
    p_expected_revisions,
    p_patch,
    p_request_id
  );
end;
$$;

create or replace function public.save_notification_control_plane_v2(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
  p_expected_contract_versions jsonb,
  p_patch jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_response jsonb;
  v_rule_id_text text;
  v_rule_id uuid;
  v_template_id uuid;
begin
  perform dashboard_private.assert_notification_settings_patch_editable_v1(p_patch);
  v_response := dashboard_private.save_notification_control_plane_unmirrored_v2(
    p_workflow_key,
    p_expected_rule_revisions,
    p_expected_contract_versions,
    p_patch,
    p_request_id
  );

  if p_workflow_key = 'makeup_requests' then
    for v_rule_id_text in
      select patch_key.value
      from pg_catalog.jsonb_object_keys(p_patch -> 'rules') patch_key(value)
      order by patch_key.value
    loop
      v_rule_id := v_rule_id_text::uuid;
      select rule_row.active_template_id into strict v_template_id
      from dashboard_private.notification_rules rule_row
      where rule_row.id = v_rule_id
        and rule_row.workflow_key = 'makeup_requests';
      perform dashboard_private.mirror_makeup_notification_template_v1(
        v_rule_id,
        v_template_id,
        v_actor
      );
    end loop;
  end if;

  return v_response;
end;
$$;

create or replace function dashboard_private.save_notification_control_plane_unmirrored_v2(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
  p_expected_contract_versions jsonb,
  p_patch jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_request_kind constant text := 'notification_settings_save_v2';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_rules_patch jsonb;
  v_rule_id_text text;
  v_rule_id uuid;
  v_seen_rule_ids uuid[] := '{}'::uuid[];
  v_rule_patch jsonb;
  v_enabled boolean;
  v_event_key text;
  v_channel_key text;
  v_audience_key text;
  v_schedule_key text;
  v_schedule_config jsonb;
  v_revision bigint;
  v_activation_locked boolean;
  v_contract_version text;
  v_contract_json jsonb;
  v_active_template_id uuid;
  v_template_version bigint;
  v_title_template text;
  v_body_template text;
  v_payload_schema_version integer;
  v_next_enabled boolean;
  v_next_schedule_config jsonb;
  v_next_title_template text;
  v_next_body_template text;
  v_template_changed boolean;
  v_rule_changed boolean;
  v_new_template_id uuid;
  v_new_template_version bigint;
  v_new_checksum text;
  v_new_revision bigint;
  v_violations jsonb;
  v_error_codes text;
  v_changed_revisions jsonb := '{}'::jsonb;
  v_job_id uuid;
  v_response jsonb;
begin
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null or p_workflow_key not in (
    'tasks',
    'word_retests',
    'registration',
    'transfer',
    'withdrawal',
    'makeup_requests',
    'approvals'
  ) then
    raise exception 'notification_workflow_unknown' using errcode = '22023';
  end if;
  if p_request_id is null
    or p_expected_rule_revisions is null
    or p_expected_contract_versions is null
    or p_patch is null
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', v_actor,
      'workflow_key', p_workflow_key,
      'expected_rule_revisions', p_expected_rule_revisions,
      'expected_contract_versions', p_expected_contract_versions,
      'patch', p_patch
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );

  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind
      or v_ledger_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'notification-control-plane-workflow:' || p_workflow_key,
      0
    )
  );

  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_settings_ui_enabled'
    and flag_row.enabled
  for share;
  if not found then
    raise exception 'notification_settings_ui_disabled' using errcode = '55000';
  end if;

  if pg_catalog.jsonb_typeof(p_expected_rule_revisions) <> 'object'
    or pg_catalog.jsonb_typeof(p_expected_contract_versions) <> 'object'
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'rules')
    or p_patch - 'rules' <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_patch -> 'rules') <> 'object'
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;
  v_rules_patch := p_patch -> 'rules';

  if exists (
    select 1
    from pg_catalog.jsonb_each(p_expected_rule_revisions) expected_entry(key, value)
    where pg_catalog.jsonb_typeof(expected_entry.value) <> 'string'
      or expected_entry.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (v_rules_patch ? expected_entry.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_expected_contract_versions) expected_entry(key, value)
    where pg_catalog.jsonb_typeof(expected_entry.value) <> 'string'
      or expected_entry.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (v_rules_patch ? expected_entry.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    where not (p_expected_rule_revisions ? patch_key.value)
      or not (p_expected_contract_versions ? patch_key.value)
  ) then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  for v_rule_id_text in
    select patch_key.value
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    order by patch_key.value
  loop
    if v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'notification_rule_unknown' using errcode = '22023';
    end if;
    v_rule_id := v_rule_id_text::uuid;
    if v_rule_id::text <> v_rule_id_text
      or v_rule_id = any(v_seen_rule_ids)
    then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;
    v_seen_rule_ids := pg_catalog.array_append(v_seen_rule_ids, v_rule_id);
    v_rule_patch := v_rules_patch -> v_rule_id_text;
    if pg_catalog.jsonb_typeof(v_rule_patch) <> 'object'
      or v_rule_patch = '{}'::jsonb
      or v_rule_patch - array[
        'enabled',
        'title_template',
        'body_template',
        'schedule_config'
      ]::text[] <> '{}'::jsonb
      or (
        v_rule_patch ? 'enabled'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'enabled') <> 'boolean'
      )
      or (
        v_rule_patch ? 'title_template'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'title_template') <> 'string'
      )
      or (
        v_rule_patch ? 'body_template'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'body_template') <> 'string'
      )
      or (
        v_rule_patch ? 'schedule_config'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config')
          not in ('object', 'null')
      )
    then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;

    select
      rule_row.enabled,
      rule_row.event_key,
      rule_row.channel_key,
      rule_row.audience_key,
      rule_row.schedule_key,
      rule_row.schedule_config,
      rule_row.revision,
      registry_row.activation_locked,
      contract_row.contract_version,
      contract_row.contract_json
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision,
      v_activation_locked,
      v_contract_version,
      v_contract_json
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry_row
      on registry_row.rule_id = rule_row.id
     and registry_row.workflow_key = rule_row.workflow_key
     and registry_row.event_key = rule_row.event_key
     and registry_row.audience_key = rule_row.audience_key
     and registry_row.channel_key = rule_row.channel_key
     and registry_row.rule_variant_key = rule_row.rule_variant_key
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
     and contract_row.workflow_key = registry_row.workflow_key
     and contract_row.event_key = registry_row.event_key
     and contract_row.audience_key = registry_row.audience_key
     and contract_row.channel_key = registry_row.channel_key
     and contract_row.rule_variant_key = registry_row.rule_variant_key
    where rule_row.id = v_rule_id
      and rule_row.scope_key = 'global'
      and rule_row.workflow_key = p_workflow_key
    for update of rule_row, contract_row;
    if not found then
      raise exception 'notification_rule_not_in_registry'
        using errcode = '22023';
    end if;
    if v_revision::text <> p_expected_rule_revisions ->> v_rule_id_text then
      raise exception 'notification_revision_conflict' using errcode = '23514';
    end if;
    if v_contract_version
      <> p_expected_contract_versions ->> v_rule_id_text
    then
      raise exception 'notification_contract_version_conflict'
        using errcode = '23514';
    end if;
    if v_activation_locked and v_rule_patch ? 'enabled' then
      raise exception 'notification_activation_locked' using errcode = '55000';
    end if;

    if v_rule_patch ? 'schedule_config' then
      v_next_schedule_config := case
        when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null'
          then null
        else v_rule_patch -> 'schedule_config'
      end;
      if not dashboard_private.notification_schedule_config_valid_v1(
        p_workflow_key,
        v_event_key,
        v_schedule_key,
        v_next_schedule_config
      ) then
        raise exception 'notification_patch_invalid' using errcode = '22023';
      end if;
    end if;

    if not v_enabled
      and v_channel_key = 'google_chat'
      and v_rule_patch ? 'enabled'
      and (v_rule_patch ->> 'enabled')::boolean
    then
      perform 1
      from public.google_chat_webhook_settings connection_row
      where connection_row.channel = any(
        case v_audience_key
          when 'management_team' then array['admin']::text[]
          when 'executive_team' then array['executive']::text[]
          when 'subject_team' then array['english', 'math', 'science']::text[]
          else '{}'::text[]
        end
      )
      order by connection_row.channel
      for share of connection_row;
      if not dashboard_private.notification_google_chat_audience_ready_v1(
        v_audience_key
      ) then
        raise exception 'notification_google_chat_connection_required'
          using errcode = '55000';
      end if;
    end if;
  end loop;

  for v_rule_id_text in
    select patch_key.value
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    order by patch_key.value
  loop
    v_rule_id := v_rule_id_text::uuid;
    v_rule_patch := v_rules_patch -> v_rule_id_text;
    select
      rule_row.enabled,
      rule_row.event_key,
      rule_row.channel_key,
      rule_row.audience_key,
      rule_row.schedule_key,
      rule_row.schedule_config,
      rule_row.revision,
      rule_row.active_template_id,
      template_row.version,
      template_row.title_template,
      template_row.body_template,
      template_row.payload_schema_version,
      contract_row.contract_version,
      contract_row.contract_json
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision,
      v_active_template_id,
      v_template_version,
      v_title_template,
      v_body_template,
      v_payload_schema_version,
      v_contract_version,
      v_contract_json
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.rule_id = rule_row.id
     and template_row.id = rule_row.active_template_id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    where rule_row.id = v_rule_id;

    v_next_enabled := case
      when v_rule_patch ? 'enabled' then (v_rule_patch ->> 'enabled')::boolean
      else v_enabled
    end;
    v_next_title_template := case
      when v_rule_patch ? 'title_template' then v_rule_patch ->> 'title_template'
      else v_title_template
    end;
    v_next_body_template := case
      when v_rule_patch ? 'body_template' then v_rule_patch ->> 'body_template'
      else v_body_template
    end;
    v_next_schedule_config := case
      when not (v_rule_patch ? 'schedule_config') then v_schedule_config
      when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null'
        then null
      else v_rule_patch -> 'schedule_config'
    end;

    if not dashboard_private.notification_schedule_config_valid_v1(
      p_workflow_key,
      v_event_key,
      v_schedule_key,
      v_next_schedule_config
    ) or not (
      v_contract_json -> 'supportedPayloadVersions'
      @> pg_catalog.jsonb_build_array(v_payload_schema_version)
    ) then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;

    v_violations := dashboard_private.notification_template_contract_violations_v1(
      v_rule_id,
      v_next_title_template,
      v_next_body_template
    );
    select pg_catalog.string_agg(violation.item ->> 'code', ',' order by violation.ordinal)
    into v_error_codes
    from pg_catalog.jsonb_array_elements(v_violations)
      with ordinality violation(item, ordinal)
    where violation.item ->> 'severity' = 'error';
    if v_error_codes is not null then
      raise exception 'notification_template_contract_invalid:%', v_error_codes
        using errcode = '22023';
    end if;

    v_template_changed := v_next_title_template is distinct from v_title_template
      or v_next_body_template is distinct from v_body_template;
    v_rule_changed := v_template_changed
      or v_next_enabled is distinct from v_enabled
      or v_next_schedule_config is distinct from v_schedule_config;
    if not v_rule_changed then
      continue;
    end if;

    v_new_template_id := v_active_template_id;
    v_new_template_version := v_template_version;
    if v_template_changed then
      select coalesce(pg_catalog.max(template_row.version), 0) + 1
      into v_new_template_version
      from dashboard_private.notification_templates template_row
      where template_row.rule_id = v_rule_id;
      v_new_template_id := pg_catalog.gen_random_uuid();
      v_new_checksum := dashboard_private.notification_seed_template_checksum_v1(
        v_next_title_template,
        v_next_body_template,
        v_contract_json -> 'availableVariables',
        v_payload_schema_version
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
        content_contract_version
      ) values (
        v_new_template_id,
        v_rule_id,
        v_new_template_version,
        v_next_title_template,
        v_next_body_template,
        v_contract_json -> 'availableVariables',
        v_payload_schema_version,
        v_new_checksum,
        v_actor,
        'user',
        v_contract_version
      );
    end if;

    update dashboard_private.notification_rules rule_row
    set enabled = v_next_enabled,
        schedule_config = v_next_schedule_config,
        active_template_id = v_new_template_id,
        revision = rule_row.revision + 1,
        updated_by = v_actor,
        updated_actor_kind = 'user',
        updated_at = pg_catalog.clock_timestamp()
    where rule_row.id = v_rule_id
    returning rule_row.revision into v_new_revision;

    if v_template_changed then
      perform dashboard_private.notification_template_compliance_v1(
        v_rule_id,
        v_new_template_id
      );
    end if;

    insert into dashboard_private.notification_audit_logs(
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
      'notification_rule',
      v_rule_id::text,
      'settings_updated',
      v_actor,
      'user',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'enabled', v_enabled,
        'revision', v_revision::text,
        'active_template_id', v_active_template_id,
        'template_version', v_template_version::text,
        'schedule_config', v_schedule_config,
        'content_contract_version', v_contract_version
      ),
      pg_catalog.jsonb_build_object(
        'enabled', v_next_enabled,
        'revision', v_new_revision::text,
        'active_template_id', v_new_template_id,
        'template_version', v_new_template_version::text,
        'schedule_config', v_next_schedule_config,
        'content_contract_version', v_contract_version
      ),
      'operator_settings_save_v2'
    );
    v_changed_revisions := v_changed_revisions || pg_catalog.jsonb_build_object(
      v_rule_id::text,
      v_new_revision::text
    );
  end loop;

  if v_changed_revisions <> '{}'::jsonb then
    insert into dashboard_private.notification_rule_reconciliation_jobs(
      workflow_key,
      rule_revision_map
    ) values (
      p_workflow_key,
      v_changed_revisions
    )
    returning id into v_job_id;
  end if;

  v_response := dashboard_private.notification_control_plane_snapshot_v1(
    p_workflow_key,
    v_role = 'admin'
  );
  if v_job_id is not null then
    v_response := v_response || pg_catalog.jsonb_build_object(
      'reconciliation_job', pg_catalog.jsonb_build_object(
        'job_kind', 'rule_reconciliation',
        'job_id', v_job_id,
        'status', 'pending',
        'attempt_count', 0
      )
    );
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.notification_rule_mention_setting_json_v1(
  p_rule_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ruleId', rule.id,
    'workflowKey', rule.workflow_key,
    'eventKey', rule.event_key,
    'channelKey', rule.channel_key,
    'mentionEnabled', setting.mention_enabled,
    'revision', setting.revision::text,
    'updatedAt', setting.updated_at,
    'editable', not dashboard_private.notification_registration_setting_archived_v1(
      rule.workflow_key, rule.event_key, rule.channel_key
    )
  )
  from dashboard_private.notification_rule_mention_settings setting
  join dashboard_private.notification_rules rule on rule.id = setting.rule_id
  where setting.rule_id = p_rule_id
    and rule.channel_key = 'google_chat';
$$;

create or replace function public.save_notification_rule_mention_setting_v1(
  p_rule_id uuid,
  p_mention_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_setting dashboard_private.notification_rule_mention_settings%rowtype;
  v_request dashboard_private.notification_rule_mention_setting_requests%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_fingerprint text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform dashboard_private.assert_google_chat_mentions_manager_v1(v_actor);
  if p_rule_id is null
    or p_mention_enabled is null
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_request_id is null
  then
    raise exception 'notification_mention_setting_invalid'
      using errcode = '22023';
  end if;

  perform dashboard_private.assert_notification_settings_patch_editable_v1(
    pg_catalog.jsonb_build_object('rules', pg_catalog.jsonb_build_object(p_rule_id::text, '{}'::jsonb))
  );

  select setting.* into v_setting
  from dashboard_private.notification_rule_mention_settings setting
  join dashboard_private.notification_rules rule on rule.id = setting.rule_id
  where setting.rule_id = p_rule_id
    and rule.channel_key = 'google_chat'
  for update of setting;
  if not found then
    raise exception 'notification_mention_setting_not_found'
      using errcode = 'P0002';
  end if;
  if p_expected_revision < 1 then
    raise exception 'notification_mention_setting_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'actorProfileId', v_actor,
        'ruleId', p_rule_id,
        'mentionEnabled', p_mention_enabled,
        'expectedRevision', p_expected_revision
      )
    )
  );

  select * into v_request
  from dashboard_private.notification_rule_mention_setting_requests request_row
  where request_row.request_id = p_request_id
  for update;
  if found then
    if v_request.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_request.response;
  end if;

  if v_setting.revision is distinct from p_expected_revision then
    raise exception 'notification_mention_setting_revision_conflict'
      using errcode = '23514';
  end if;

  v_before := dashboard_private.notification_rule_mention_setting_json_v1(p_rule_id);
  update dashboard_private.notification_rule_mention_settings setting
  set mention_enabled = p_mention_enabled,
      revision = setting.revision + 1,
      updated_by = v_actor,
      updated_at = v_now
  where setting.rule_id = p_rule_id;
  v_response := dashboard_private.notification_rule_mention_setting_json_v1(p_rule_id);

  insert into dashboard_private.notification_rule_mention_setting_audits(
    rule_id, actor_profile_id, request_id, before_setting, after_setting
  ) values (p_rule_id, v_actor, p_request_id, v_before, v_response);

  insert into dashboard_private.notification_rule_mention_setting_requests(
    request_id, actor_profile_id, rule_id, request_fingerprint, response
  ) values (p_request_id, v_actor, p_rule_id, v_fingerprint, v_response);

  return v_response;
end;
$$;

-- One database call owns both revision domains and the outer idempotency receipt.
-- Calling the existing mutators here preserves their validations, audits, mirrors and locks;
-- any exception rolls back every mutation, including inner receipts and reconciliation jobs.
create or replace function public.save_notification_settings_v1(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
  p_expected_contract_versions jsonb,
  p_patch jsonb,
  p_expected_mention_revisions jsonb,
  p_mention_patch jsonb,
  p_request_id uuid,
  p_conflict_override jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_rule_id text;
  v_rule_request_id uuid;
  v_response jsonb;
begin
  if v_actor is null or (public.current_dashboard_role() in ('admin', 'staff')) is not true
    or dashboard_private.notification_profile_is_active_v1(v_actor) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_workflow_key is null
    or p_expected_mention_revisions is null
    or p_mention_patch is null
    or pg_catalog.jsonb_typeof(p_expected_mention_revisions) <> 'object'
    or pg_catalog.jsonb_typeof(p_mention_patch) <> 'object'
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_each(p_mention_patch) item(key, value)
    where item.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(item.value) <> 'boolean'
      or not (p_expected_mention_revisions ? item.key)
  ) or exists (
    select 1 from pg_catalog.jsonb_each(p_expected_mention_revisions) item(key, value)
    where pg_catalog.jsonb_typeof(item.value) <> 'string'
      or item.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (p_mention_patch ? item.key)
  ) then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;
  if p_conflict_override is not null and (
    pg_catalog.jsonb_typeof(p_conflict_override) <> 'object'
    or p_conflict_override - array['request_id', 'conflicting_fields']::text[] <> '{}'::jsonb
    or coalesce(p_conflict_override ->> 'request_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_conflict_override ->> 'request_id' = p_request_id::text
    or not (p_conflict_override ? 'conflicting_fields')
  ) then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor, 'workflow', p_workflow_key,
    'expected_rules', p_expected_rule_revisions, 'expected_contracts', p_expected_contract_versions,
    'patch', p_patch, 'expected_mentions', p_expected_mention_revisions,
    'mentions', p_mention_patch, 'override', p_conflict_override
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'notification_settings_atomic_v1'
      or v_ledger.request_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  for v_rule_id in select item.key from pg_catalog.jsonb_each(p_mention_patch) item order by item.key loop
    perform 1 from dashboard_private.notification_rules rule
      join dashboard_private.notification_rule_mention_settings setting on setting.rule_id = rule.id
      where rule.id = v_rule_id::uuid and rule.workflow_key = p_workflow_key and rule.channel_key = 'google_chat';
    if not found then
      raise exception 'notification_rule_unknown' using errcode = '22023';
    end if;
  end loop;
  perform dashboard_private.assert_notification_settings_patch_editable_v1(
    pg_catalog.jsonb_build_object('rules', p_mention_patch)
  );
  v_rule_request_id := pg_catalog.md5(p_request_id::text || ':rules')::uuid;
  if p_conflict_override is null then
    v_response := public.save_notification_control_plane_v2(
      p_workflow_key, p_expected_rule_revisions, p_expected_contract_versions, p_patch, v_rule_request_id
    );
  else
    v_response := public.save_notification_control_plane_with_override_v2(
      p_workflow_key, p_expected_rule_revisions, p_expected_contract_versions, p_patch, v_rule_request_id,
      (p_conflict_override ->> 'request_id')::uuid, p_conflict_override -> 'conflicting_fields'
    );
  end if;
  for v_rule_id in select item.key from pg_catalog.jsonb_each(p_mention_patch) item order by item.key loop
    perform public.save_notification_rule_mention_setting_v1(
      v_rule_id::uuid, (p_mention_patch ->> v_rule_id)::boolean,
      (p_expected_mention_revisions ->> v_rule_id)::bigint,
      pg_catalog.md5(p_request_id::text || ':mention:' || v_rule_id)::uuid
    );
  end loop;
  v_response := v_response || pg_catalog.jsonb_build_object(
    'mention_settings', public.list_notification_rule_mention_settings_v1(p_workflow_key)
  );
  insert into dashboard_private.notification_request_ledger(request_id, request_kind, request_fingerprint, response_payload)
    values (p_request_id, 'notification_settings_atomic_v1', v_fingerprint, v_response);
  return v_response;
end;
$$;

alter function dashboard_private.notification_registration_setting_archived_v1(text, text, text) owner to postgres;
alter function dashboard_private.assert_notification_settings_patch_editable_v1(jsonb) owner to postgres;
alter function public.save_notification_settings_v1(text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb) owner to postgres;
revoke all on function dashboard_private.notification_registration_setting_archived_v1(text, text, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_notification_settings_patch_editable_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_notification_settings_v1(text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_notification_settings_v1(text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
