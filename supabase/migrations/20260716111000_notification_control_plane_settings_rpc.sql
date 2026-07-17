begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.notification_schedule_config_valid_v1(
  p_workflow_key text,
  p_event_key text,
  p_schedule_key text,
  p_schedule_config jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_lead_minutes numeric;
begin
  if p_schedule_key is null then
    return p_schedule_config is null;
  end if;

  if p_workflow_key <> 'registration'
    or p_event_key <> 'registration.appointment_reminder_due'
    or p_schedule_config is null
    or pg_catalog.jsonb_typeof(p_schedule_config) <> 'object'
    or pg_catalog.jsonb_typeof(p_schedule_config -> 'anchor_key') <> 'string'
    or p_schedule_config ->> 'anchor_key' <> 'appointment_scheduled_at'
    or p_schedule_config ->> 'timezone' <> 'Asia/Seoul'
  then
    return false;
  end if;

  if p_schedule_key in ('previous_day_at', 'same_day_at') then
    return p_schedule_config ?& array['anchor_key', 'local_time', 'timezone']::text[]
      and p_schedule_config - array['anchor_key', 'local_time', 'timezone']::text[] = '{}'::jsonb
      and pg_catalog.jsonb_typeof(p_schedule_config -> 'local_time') = 'string'
      and p_schedule_config ->> 'local_time' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$';
  end if;

  if p_schedule_key = 'offset_before' then
    if not (
      p_schedule_config ?& array['anchor_key', 'lead_minutes', 'timezone']::text[]
      and p_schedule_config - array['anchor_key', 'lead_minutes', 'timezone']::text[] = '{}'::jsonb
      and pg_catalog.jsonb_typeof(p_schedule_config -> 'lead_minutes') = 'number'
      and p_schedule_config ->> 'lead_minutes' ~ '^(0|[1-9][0-9]*)$'
    ) then
      return false;
    end if;

    begin
      v_lead_minutes := (p_schedule_config ->> 'lead_minutes')::numeric;
    exception
      when others then
        return false;
    end;
    return v_lead_minutes between 1 and 10080;
  end if;

  return false;
end;
$$;

create or replace function dashboard_private.notification_template_content_valid_v1(
  p_title_template text,
  p_body_template text,
  p_allowed_variables jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_content text;
  v_token_match text[];
begin
  if p_title_template is null
    or nullif(pg_catalog.btrim(p_title_template), '') is null
    or p_body_template is null
    or nullif(pg_catalog.btrim(p_body_template), '') is null
    or p_allowed_variables is null
    or pg_catalog.jsonb_typeof(p_allowed_variables) <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(value)
      where pg_catalog.jsonb_typeof(variable.value) <> 'object'
         or pg_catalog.jsonb_typeof(variable.value -> 'token') <> 'string'
         or nullif(pg_catalog.btrim(variable.value ->> 'token'), '') is null
         or variable.value ->> 'token' ~ '[{}]'
    )
  then
    return false;
  end if;

  v_content := p_title_template || E'\n' || p_body_template;
  if v_content ~ '[<>]'
    or v_content ~* '(^|[^[:alnum:]_])@(all|everyone|here|channel)([^[:alnum:]_]|$)'
    or v_content ~* '(^|[^[:alnum:]])((https?|ftp):)?//[^[:space:]]'
    or pg_catalog.regexp_replace(v_content, E'\\{[^{}]+\\}', '', 'g') ~ '[{}]'
  then
    return false;
  end if;

  for v_token_match in
    select token_match.value
    from pg_catalog.regexp_matches(v_content, E'\\{([^{}]+)\\}', 'g') token_match(value)
  loop
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(value)
      where variable.value ->> 'token' = v_token_match[1]
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function dashboard_private.notification_google_chat_audience_ready_v1(
  p_audience_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channels text[];
  v_channel text;
  v_row public.google_chat_webhook_settings%rowtype;
  v_expected_mask text;
begin
  v_channels := case p_audience_key
    when 'management_team' then array['admin']::text[]
    when 'executive_team' then array['executive']::text[]
    when 'subject_team' then array['english', 'math']::text[]
    else null
  end;
  if v_channels is null then
    return false;
  end if;

  foreach v_channel in array v_channels
  loop
    select connection_row.*
    into v_row
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = v_channel;
    if not found
      or v_row.connection_state not in ('legacy_active', 'encrypted_active')
      or v_row.last_error_code is not null
    then
      return false;
    end if;
    begin
      v_expected_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
        v_row.webhook_url
      );
    exception
      when sqlstate '22023' then
        return false;
    end;
    if v_row.connection_state = 'encrypted_active' and (
      nullif(pg_catalog.btrim(v_row.webhook_url_ciphertext), '') is null
      or v_row.webhook_url_mask is distinct from v_expected_mask
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function dashboard_private.notification_google_chat_webhook_mask_v1(
  p_webhook_url text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_space_id text;
begin
  if p_webhook_url is null
    or pg_catalog.char_length(p_webhook_url) > 8192
    or p_webhook_url
      !~ '^https://chat[.]googleapis[.]com/v1/spaces/[A-Za-z0-9_-]+/messages[?]key=[^&?#[:space:]]+&token=[^&?#[:space:]]+$'
  then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_space_id := pg_catalog.substring(
    p_webhook_url,
    '^https://chat[.]googleapis[.]com/v1/spaces/([A-Za-z0-9_-]+)/messages'
  );
  return 'chat.googleapis.com/v1/spaces/'
    || case
      when pg_catalog.char_length(v_space_id) > 8 then
        pg_catalog.left(v_space_id, 4)
        || '…'
        || pg_catalog.right(v_space_id, 4)
      else '…'
    end
    || '/messages';
end;
$$;

create or replace function dashboard_private.set_notification_runtime_flag_v1_impl(
  p_flag_key text,
  p_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'notification_runtime_flag_set';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_current_enabled boolean;
  v_current_revision bigint;
  v_new_revision bigint;
  v_workflow_key text;
  v_registration_adapter_scope text;
  v_canceled_count integer := 0;
  v_claim_cancel_count integer := 0;
  v_reserved_claims jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_flag_key is null or p_flag_key not in (
    'notification_control_plane_settings_ui_enabled',
    'notification_control_plane_shadow_write_enabled',
    'notification_control_plane_dispatch_tasks_enabled',
    'notification_control_plane_dispatch_word_retests_enabled',
    'notification_control_plane_dispatch_registration_enabled',
    'notification_control_plane_registration_phone_adapter_enabled',
    'notification_control_plane_registration_visit_adapter_enabled',
    'notification_control_plane_registration_solapi_adapter_enabled',
    'notification_control_plane_dispatch_transfer_enabled',
    'notification_control_plane_dispatch_withdrawal_enabled',
    'notification_control_plane_dispatch_makeup_requests_enabled',
    'notification_control_plane_dispatch_approvals_enabled'
  ) then
    raise exception 'notification_flag_unknown' using errcode = '22023';
  end if;
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 1
    or p_request_id is null
  then
    raise exception 'notification_flag_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'flag_key', p_flag_key,
      'enabled', p_enabled,
      'expected_revision', p_expected_revision::text
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
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  select flag_row.enabled, flag_row.revision
  into v_current_enabled, v_current_revision
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = p_flag_key
  for update of flag_row;
  if not found then
    raise exception 'notification_flag_unknown' using errcode = '22023';
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'notification_revision_conflict' using errcode = '40001';
  end if;

  if p_enabled is not distinct from v_current_enabled then
    v_response := pg_catalog.jsonb_build_object(
      'flag_key', p_flag_key,
      'enabled', v_current_enabled,
      'revision', v_current_revision::text,
      'canceled_count', 0,
      'claim_cancel_requested_count', 0,
      'reserved_ownership_claims', '[]'::jsonb
    );
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
  end if;

  if p_enabled then
    if not dashboard_private.notification_runtime_dependency_ready_v1('common') then
      raise exception 'notification_runtime_not_ready' using errcode = '55000';
    end if;
    if p_flag_key <> 'notification_control_plane_settings_ui_enabled' then
      if not dashboard_private.notification_runtime_dependency_ready_v1('adapters')
        or not exists (
          select 1
          from dashboard_private.notification_worker_heartbeats heartbeat
          where heartbeat.phase = 'succeeded'
            and heartbeat.created_at >= pg_catalog.clock_timestamp() - interval '3 minutes'
        )
      then
        raise exception 'notification_runtime_not_ready' using errcode = '55000';
      end if;
    end if;
    if p_flag_key in (
      'notification_control_plane_dispatch_registration_enabled',
      'notification_control_plane_registration_phone_adapter_enabled',
      'notification_control_plane_registration_visit_adapter_enabled',
      'notification_control_plane_registration_solapi_adapter_enabled'
    ) and not dashboard_private.notification_runtime_dependency_ready_v1('registration') then
      raise exception 'notification_runtime_not_ready' using errcode = '55000';
    end if;
  end if;

  update dashboard_private.notification_runtime_flags flag_row
  set enabled = p_enabled,
      revision = flag_row.revision + 1,
      updated_by = null,
      updated_at = pg_catalog.clock_timestamp()
  where flag_row.flag_key = p_flag_key
  returning flag_row.revision into v_new_revision;

  if not p_enabled then
    v_registration_adapter_scope := case p_flag_key
      when 'notification_control_plane_dispatch_registration_enabled' then 'core'
      when 'notification_control_plane_registration_phone_adapter_enabled' then 'phone'
      when 'notification_control_plane_registration_visit_adapter_enabled' then 'visit'
      when 'notification_control_plane_registration_solapi_adapter_enabled' then 'solapi'
      else null
    end;
    v_workflow_key := case p_flag_key
      when 'notification_control_plane_dispatch_tasks_enabled' then 'tasks'
      when 'notification_control_plane_dispatch_word_retests_enabled' then 'word_retests'
      when 'notification_control_plane_dispatch_registration_enabled' then 'registration'
      when 'notification_control_plane_registration_phone_adapter_enabled' then 'registration'
      when 'notification_control_plane_registration_visit_adapter_enabled' then 'registration'
      when 'notification_control_plane_registration_solapi_adapter_enabled' then 'registration'
      when 'notification_control_plane_dispatch_transfer_enabled' then 'transfer'
      when 'notification_control_plane_dispatch_withdrawal_enabled' then 'withdrawal'
      when 'notification_control_plane_dispatch_makeup_requests_enabled' then 'makeup_requests'
      when 'notification_control_plane_dispatch_approvals_enabled' then 'approvals'
      else null
    end;
    if v_workflow_key is not null then
      update dashboard_private.notification_deliveries delivery_row
      set status = 'canceled',
          status_reason = 'cutover_rollback',
          next_attempt_at = null,
          cancel_requested_at = null,
          cancel_reason = null,
          updated_at = pg_catalog.clock_timestamp()
      from dashboard_private.notification_events event_row,
           dashboard_private.notification_rules scope_rule
      where event_row.id = delivery_row.event_id
        and scope_rule.id = delivery_row.rule_id
        and event_row.scope_key = 'global'
        and event_row.workflow_key = v_workflow_key
        and (
          v_registration_adapter_scope is null
          or (
            v_registration_adapter_scope = 'core'
            and not (
              (
                event_row.event_key = 'registration.phone_consultation_ready'
                and scope_rule.event_key = event_row.event_key
                and scope_rule.channel_key = 'in_app'
              )
              or (
                event_row.event_key in (
                  'registration.visit_scheduled',
                  'registration.visit_rescheduled',
                  'registration.visit_replaced',
                  'registration.visit_subject_deselected',
                  'registration.visit_canceled'
                )
                and scope_rule.event_key = event_row.event_key
              )
              or (
                event_row.event_key in (
                  'registration.admission_message_requested',
                  'registration.admission_message_accepted',
                  'registration.admission_message_failed',
                  'registration.admission_message_unknown',
                  'registration.admission_message_reconciled',
                  'registration.admission_message_retry_released'
                )
                and scope_rule.event_key = event_row.event_key
                and scope_rule.channel_key = 'customer_message'
              )
            )
          )
          or (
            v_registration_adapter_scope = 'phone'
            and event_row.event_key = 'registration.phone_consultation_ready'
            and scope_rule.event_key = 'registration.phone_consultation_ready'
            and scope_rule.channel_key = 'in_app'
          )
          or (
            v_registration_adapter_scope = 'visit'
            and event_row.event_key in (
              'registration.visit_scheduled',
              'registration.visit_rescheduled',
              'registration.visit_replaced',
              'registration.visit_subject_deselected',
              'registration.visit_canceled'
            )
            and scope_rule.event_key = event_row.event_key
          )
          or (
            v_registration_adapter_scope = 'solapi'
            and event_row.event_key in (
              'registration.admission_message_requested',
              'registration.admission_message_accepted',
              'registration.admission_message_failed',
              'registration.admission_message_unknown',
              'registration.admission_message_reconciled',
              'registration.admission_message_retry_released'
            )
            and scope_rule.event_key = event_row.event_key
            and scope_rule.channel_key = 'customer_message'
          )
        )
        and delivery_row.status in ('pending', 'retry_wait');
      get diagnostics v_canceled_count = row_count;

      update dashboard_private.notification_deliveries delivery_row
      set cancel_requested_at = coalesce(
            delivery_row.cancel_requested_at,
            pg_catalog.clock_timestamp()
          ),
          cancel_reason = 'cutover_rollback',
          updated_at = pg_catalog.clock_timestamp()
      from dashboard_private.notification_events event_row,
           dashboard_private.notification_rules scope_rule
      where event_row.id = delivery_row.event_id
        and scope_rule.id = delivery_row.rule_id
        and event_row.scope_key = 'global'
        and event_row.workflow_key = v_workflow_key
        and (
          v_registration_adapter_scope is null
          or (
            v_registration_adapter_scope = 'core'
            and not (
              (
                event_row.event_key = 'registration.phone_consultation_ready'
                and scope_rule.event_key = event_row.event_key
                and scope_rule.channel_key = 'in_app'
              )
              or (
                event_row.event_key in (
                  'registration.visit_scheduled',
                  'registration.visit_rescheduled',
                  'registration.visit_replaced',
                  'registration.visit_subject_deselected',
                  'registration.visit_canceled'
                )
                and scope_rule.event_key = event_row.event_key
              )
              or (
                event_row.event_key in (
                  'registration.admission_message_requested',
                  'registration.admission_message_accepted',
                  'registration.admission_message_failed',
                  'registration.admission_message_unknown',
                  'registration.admission_message_reconciled',
                  'registration.admission_message_retry_released'
                )
                and scope_rule.event_key = event_row.event_key
                and scope_rule.channel_key = 'customer_message'
              )
            )
          )
          or (
            v_registration_adapter_scope = 'phone'
            and event_row.event_key = 'registration.phone_consultation_ready'
            and scope_rule.event_key = 'registration.phone_consultation_ready'
            and scope_rule.channel_key = 'in_app'
          )
          or (
            v_registration_adapter_scope = 'visit'
            and event_row.event_key in (
              'registration.visit_scheduled',
              'registration.visit_rescheduled',
              'registration.visit_replaced',
              'registration.visit_subject_deselected',
              'registration.visit_canceled'
            )
            and scope_rule.event_key = event_row.event_key
          )
          or (
            v_registration_adapter_scope = 'solapi'
            and event_row.event_key in (
              'registration.admission_message_requested',
              'registration.admission_message_accepted',
              'registration.admission_message_failed',
              'registration.admission_message_unknown',
              'registration.admission_message_reconciled',
              'registration.admission_message_retry_released'
            )
            and scope_rule.event_key = event_row.event_key
            and scope_rule.channel_key = 'customer_message'
          )
        )
        and delivery_row.status = 'claimed';
      get diagnostics v_claim_cancel_count = row_count;

      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'claim_id', ownership.id,
            'owner_generation', ownership.owner_generation::text
          )
          order by ownership.id
        ),
        '[]'::jsonb
      )
      into v_reserved_claims
      from dashboard_private.notification_dispatch_ownership_claims ownership
      join dashboard_private.notification_rules scope_rule
        on scope_rule.id = ownership.rule_id
      where ownership.workflow_key = v_workflow_key
        and ownership.owner_kind = 'canonical'
        and ownership.state = 'reserved'
        and (
          v_registration_adapter_scope is null
          or (
            v_registration_adapter_scope = 'core'
            and not (
              (
                scope_rule.event_key = 'registration.phone_consultation_ready'
                and scope_rule.channel_key = 'in_app'
              )
              or scope_rule.event_key in (
                'registration.visit_scheduled',
                'registration.visit_rescheduled',
                'registration.visit_replaced',
                'registration.visit_subject_deselected',
                'registration.visit_canceled'
              )
              or (
                scope_rule.event_key in (
                  'registration.admission_message_requested',
                  'registration.admission_message_accepted',
                  'registration.admission_message_failed',
                  'registration.admission_message_unknown',
                  'registration.admission_message_reconciled',
                  'registration.admission_message_retry_released'
                )
                and scope_rule.channel_key = 'customer_message'
              )
            )
          )
          or (
            v_registration_adapter_scope = 'phone'
            and scope_rule.event_key = 'registration.phone_consultation_ready'
            and scope_rule.channel_key = 'in_app'
          )
          or (
            v_registration_adapter_scope = 'visit'
            and scope_rule.event_key in (
              'registration.visit_scheduled',
              'registration.visit_rescheduled',
              'registration.visit_replaced',
              'registration.visit_subject_deselected',
              'registration.visit_canceled'
            )
          )
          or (
            v_registration_adapter_scope = 'solapi'
            and scope_rule.event_key in (
              'registration.admission_message_requested',
              'registration.admission_message_accepted',
              'registration.admission_message_failed',
              'registration.admission_message_unknown',
              'registration.admission_message_reconciled',
              'registration.admission_message_retry_released'
            )
            and scope_rule.channel_key = 'customer_message'
          )
        );
    end if;
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'flag_key', p_flag_key,
    'enabled', p_enabled,
    'revision', v_new_revision::text,
    'canceled_count', v_canceled_count,
    'claim_cancel_requested_count', v_claim_cancel_count,
    'reserved_ownership_claims', v_reserved_claims
  );
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
    'notification_runtime_flag',
    p_flag_key,
    'runtime_flag_changed',
    null,
    'system',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'enabled', v_current_enabled,
      'revision', v_current_revision::text
    ),
    pg_catalog.jsonb_build_object(
      'enabled', p_enabled,
      'revision', v_new_revision::text,
      'canceled_count', v_canceled_count,
      'claim_cancel_requested_count', v_claim_cancel_count
    ),
    'service_role_flag_change'
  );
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

create or replace function dashboard_private.replace_google_chat_connection_v1_impl(
  p_actor uuid,
  p_channel text,
  p_webhook_url text,
  p_webhook_url_ciphertext text,
  p_webhook_url_mask text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_replace';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_row_found boolean := false;
  v_before_summary jsonb;
  v_response jsonb;
  v_expected_mask text;
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor
      and profile.role = 'admin'
  ) then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_request_id is null then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;
  if p_webhook_url_ciphertext is null
    or p_webhook_url_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_webhook_url_mask is null
  then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;
  v_expected_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
    p_webhook_url
  );
  if p_webhook_url_mask <> v_expected_mask then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'webhook_url', p_webhook_url,
      'webhook_url_mask', p_webhook_url_mask,
      'expected_revision', p_expected_revision::text
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
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  v_row_found := found;
  if v_row_found then
    if v_row.revision <> p_expected_revision then
      raise exception 'notification_connection_revision_conflict' using errcode = '40001';
    end if;
    v_before_summary := pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', v_row.connection_state <> 'disconnected'
    );
    update public.google_chat_webhook_settings connection_row
    set webhook_url = p_webhook_url,
        webhook_url_ciphertext = p_webhook_url_ciphertext,
        webhook_url_mask = p_webhook_url_mask,
        connection_state = 'encrypted_active',
        revision = connection_row.revision + 1,
        updated_by = p_actor,
        last_verified_at = null,
        last_error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    where connection_row.channel = p_channel
    returning connection_row.* into v_row;
  else
    if p_expected_revision <> 0 then
      raise exception 'notification_connection_revision_conflict' using errcode = '40001';
    end if;
    v_before_summary := null;
    insert into public.google_chat_webhook_settings(
      channel,
      webhook_url,
      webhook_url_ciphertext,
      webhook_url_mask,
      connection_state,
      revision,
      updated_by,
      last_verified_at,
      last_error_code
    ) values (
      p_channel,
      p_webhook_url,
      p_webhook_url_ciphertext,
      p_webhook_url_mask,
      'encrypted_active',
      1,
      p_actor,
      null,
      null
    )
    returning * into v_row;
  end if;

  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);
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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_replaced',
    p_actor,
    'user',
    p_request_id,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', true
    ),
    'operator_connection_replace'
  );
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

create or replace function dashboard_private.disconnect_google_chat_connection_v1_impl(
  p_actor uuid,
  p_channel text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_disconnect';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_before_summary jsonb;
  v_response jsonb;
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor
      and profile.role = 'admin'
  ) then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 or p_request_id is null then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'expected_revision', p_expected_revision::text
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
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  if not found then
    raise exception 'notification_connection_not_configured' using errcode = '55000';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception 'notification_connection_revision_conflict' using errcode = '40001';
  end if;

  if v_row.connection_state = 'disconnected'
    and v_row.webhook_url = ''
    and v_row.webhook_url_ciphertext is null
    and v_row.webhook_url_mask is null
  then
    v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);
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
  end if;

  v_before_summary := pg_catalog.jsonb_build_object(
    'connection_state', v_row.connection_state,
    'revision', v_row.revision::text,
    'configured', true
  );
  update public.google_chat_webhook_settings connection_row
  set webhook_url = '',
      webhook_url_ciphertext = null,
      webhook_url_mask = null,
      connection_state = 'disconnected',
      revision = connection_row.revision + 1,
      updated_by = p_actor,
      last_verified_at = null,
      last_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where connection_row.channel = p_channel
  returning connection_row.* into v_row;
  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);

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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_disconnected',
    p_actor,
    'user',
    p_request_id,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', 'disconnected',
      'revision', v_row.revision::text,
      'configured', false
    ),
    'operator_connection_disconnect'
  );
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

create or replace function dashboard_private.begin_google_chat_connection_verification_v1_impl(
  p_actor uuid,
  p_channel text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_verification';
  v_reservation_ttl constant interval := interval '2 minutes';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_row_found boolean := false;
  v_reserved_at timestamp with time zone;
  v_expires_at timestamp with time zone;
  v_terminal_at timestamp with time zone;
  v_safe_connection jsonb;
begin
  if p_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor
      and profile.role = 'admin'
  ) then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 or p_request_id is null then
    raise exception 'notification_connection_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'expected_revision', p_expected_revision::text
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
  where ledger.request_id = p_request_id
  for update of ledger;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    if v_ledger_response ->> 'state' = 'completed'
      and pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') in ('object', 'null')
    then
      return pg_catalog.jsonb_build_object(
        'should_send', false,
        'pending', false,
        'connection', v_ledger_response -> 'connection'
      );
    end if;
    if v_ledger_response ->> 'state' in ('superseded', 'expired')
      and pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') in ('object', 'null')
    then
      return pg_catalog.jsonb_build_object(
        'should_send', false,
        'pending', false,
        'terminal_code', case v_ledger_response ->> 'state'
          when 'expired' then 'verification_expired'
          else 'verification_superseded'
        end,
        'connection', v_ledger_response -> 'connection'
      );
    end if;
    if v_ledger_response ->> 'state' <> 'reserved'
      or v_ledger_response ->> 'actor' <> p_actor::text
      or v_ledger_response ->> 'channel' <> p_channel
      or v_ledger_response ->> 'revision' <> p_expected_revision::text
      or v_ledger_response ->> 'reserved_at' is null
      or v_ledger_response ->> 'expires_at' is null
    then
      raise exception 'notification_connection_verification_invalid' using errcode = '55000';
    end if;
    begin
      v_expires_at := (v_ledger_response ->> 'expires_at')::timestamp with time zone;
    exception
      when others then
        raise exception 'notification_connection_verification_invalid' using errcode = '55000';
    end;
    if v_expires_at > pg_catalog.clock_timestamp() then
      return pg_catalog.jsonb_build_object(
        'should_send', false,
        'pending', true,
        'connection', null
      );
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
    );
    select connection_row.*
    into v_row
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = p_channel
    for update of connection_row;
    v_row_found := found;
    v_safe_connection := case
      when v_row_found
        then dashboard_private.notification_connection_safe_json_v1(v_row, true)
      else 'null'::jsonb
    end;
    v_terminal_at := pg_catalog.clock_timestamp();
    update dashboard_private.notification_request_ledger ledger
    set response_payload = pg_catalog.jsonb_build_object(
      'state', 'expired',
      'terminal_code', 'verification_expired',
      'terminal_reason', 'reservation_expired',
      'reserved_at', v_ledger_response ->> 'reserved_at',
      'expires_at', v_ledger_response ->> 'expires_at',
      'terminal_at', v_terminal_at,
      'actor', p_actor,
      'channel', p_channel,
      'revision', p_expected_revision::text,
      'connection', v_safe_connection
    )
    where ledger.request_id = p_request_id;
    return pg_catalog.jsonb_build_object(
      'should_send', false,
      'pending', false,
      'terminal_code', 'verification_expired',
      'connection', v_safe_connection
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  if not found
    or v_row.connection_state = 'disconnected'
    or (
      v_row.connection_state = 'legacy_active'
      and nullif(pg_catalog.btrim(v_row.webhook_url), '') is null
    )
    or (
      v_row.connection_state = 'encrypted_active'
      and nullif(pg_catalog.btrim(v_row.webhook_url_ciphertext), '') is null
    )
  then
    raise exception 'notification_connection_not_configured' using errcode = '55000';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception 'notification_connection_revision_conflict' using errcode = '40001';
  end if;

  v_reserved_at := pg_catalog.clock_timestamp();
  v_expires_at := v_reserved_at + v_reservation_ttl;

  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    pg_catalog.jsonb_build_object(
      'state', 'reserved',
      'reserved_at', v_reserved_at,
      'expires_at', v_expires_at,
      'actor', p_actor,
      'channel', p_channel,
      'revision', p_expected_revision::text
    )
  );
  return pg_catalog.jsonb_build_object(
    'should_send', true,
    'pending', false,
    'connection', null
  );
end;
$$;

create or replace function dashboard_private.record_google_chat_connection_verification_v1_impl(
  p_actor uuid,
  p_channel text,
  p_succeeded boolean,
  p_result_code text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_kind constant text := 'google_chat_connection_verification';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_row public.google_chat_webhook_settings%rowtype;
  v_row_found boolean := false;
  v_before_summary jsonb;
  v_response jsonb;
  v_safe_connection jsonb;
  v_expires_at timestamp with time zone;
  v_terminal_at timestamp with time zone;
  v_terminal_state text;
  v_terminal_reason text;
  v_terminal_code text;
  v_audit_actor uuid;
  v_audit_actor_kind text;
  v_actor_is_admin boolean := false;
begin
  if p_actor is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  select profile.id, profile.role = 'admin'
  into v_audit_actor, v_actor_is_admin
  from public.profiles profile
  where profile.id = p_actor;
  v_actor_is_admin := coalesce(v_actor_is_admin, false);
  v_audit_actor_kind := case when v_audit_actor is null then 'system' else 'user' end;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_succeeded is null
    or p_result_code is null
    or p_result_code
      !~ '^(accepted|configuration_error|provider_rejected|transport_error|http_[1-5][0-9]{2})$'
    or (p_succeeded and p_result_code <> 'accepted')
    or (not p_succeeded and p_result_code = 'accepted')
    or p_expected_revision is null
    or p_expected_revision < 1
    or p_request_id is null
  then
    raise exception 'notification_connection_result_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', p_actor,
      'channel', p_channel,
      'expected_revision', p_expected_revision::text
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
  where ledger.request_id = p_request_id
  for update of ledger;
  v_ledger_found := found;
  if not v_ledger_found then
    if not v_actor_is_admin then
      raise exception 'notification_access_denied' using errcode = '42501';
    end if;
    raise exception 'notification_connection_verification_not_reserved' using errcode = '55000';
  end if;
  if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
    if not v_actor_is_admin then
      raise exception 'notification_access_denied' using errcode = '42501';
    end if;
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_ledger_response ->> 'state' = 'completed' then
    if (v_ledger_response ->> 'succeeded')::boolean is distinct from p_succeeded
      or v_ledger_response ->> 'result_code' <> p_result_code
      or pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') <> 'object'
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response -> 'connection';
  end if;
  if v_ledger_response ->> 'state' in ('superseded', 'expired') then
    if v_ledger_response ? 'attempted_succeeded' then
      if (v_ledger_response ->> 'attempted_succeeded')::boolean is distinct from p_succeeded
        or v_ledger_response ->> 'attempted_result_code' <> p_result_code
      then
        raise exception 'idempotency_key_reused' using errcode = '22023';
      end if;
    else
      v_ledger_response := v_ledger_response || pg_catalog.jsonb_build_object(
        'attempted_succeeded', p_succeeded,
        'attempted_result_code', p_result_code
      );
      update dashboard_private.notification_request_ledger ledger
      set response_payload = v_ledger_response
      where ledger.request_id = p_request_id;
    end if;
    if pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') is null
      or pg_catalog.jsonb_typeof(v_ledger_response -> 'connection') not in ('object', 'null')
    then
      raise exception 'notification_connection_verification_invalid' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'terminal_code', case v_ledger_response ->> 'state'
        when 'expired' then 'verification_expired'
        else 'verification_superseded'
      end,
      'connection', v_ledger_response -> 'connection'
    );
  end if;
  if v_ledger_response ->> 'state' <> 'reserved'
    or v_ledger_response ->> 'actor' <> p_actor::text
    or v_ledger_response ->> 'channel' <> p_channel
    or v_ledger_response ->> 'revision' <> p_expected_revision::text
    or v_ledger_response ->> 'reserved_at' is null
    or v_ledger_response ->> 'expires_at' is null
  then
    raise exception 'notification_connection_verification_invalid' using errcode = '55000';
  end if;
  begin
    v_expires_at := (v_ledger_response ->> 'expires_at')::timestamp with time zone;
  exception
    when others then
      raise exception 'notification_connection_verification_invalid' using errcode = '55000';
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('google-chat-connection:' || p_channel, 0)
  );
  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  v_row_found := found;
  v_safe_connection := case
    when v_row_found
      then dashboard_private.notification_connection_safe_json_v1(v_row, true)
    else 'null'::jsonb
  end;
  if v_expires_at <= pg_catalog.clock_timestamp()
    or not v_row_found
    or v_row.revision <> p_expected_revision
    or v_row.connection_state = 'disconnected'
  then
    v_terminal_at := pg_catalog.clock_timestamp();
    v_terminal_state := case
      when v_expires_at <= v_terminal_at then 'expired'
      else 'superseded'
    end;
    v_terminal_code := case v_terminal_state
      when 'expired' then 'verification_expired'
      else 'verification_superseded'
    end;
    v_terminal_reason := case
      when v_expires_at <= v_terminal_at then 'reservation_expired'
      when not v_row_found then 'connection_missing'
      when v_row.revision <> p_expected_revision then 'connection_revision_changed'
      else 'connection_disconnected'
    end;
    update dashboard_private.notification_request_ledger ledger
    set response_payload = pg_catalog.jsonb_build_object(
      'state', v_terminal_state,
      'terminal_code', v_terminal_code,
      'terminal_reason', v_terminal_reason,
      'reserved_at', v_ledger_response ->> 'reserved_at',
      'expires_at', v_ledger_response ->> 'expires_at',
      'terminal_at', v_terminal_at,
      'actor', p_actor,
      'channel', p_channel,
      'revision', p_expected_revision::text,
      'current_revision', case when v_row_found then v_row.revision::text else null end,
      'attempted_succeeded', p_succeeded,
      'attempted_result_code', p_result_code,
      'connection', v_safe_connection
    )
    where ledger.request_id = p_request_id;
    return pg_catalog.jsonb_build_object(
      'terminal_code', v_terminal_code,
      'connection', v_safe_connection
    );
  end if;

  v_before_summary := pg_catalog.jsonb_build_object(
    'connection_state', v_row.connection_state,
    'revision', v_row.revision::text,
    'configured', true
  );
  update public.google_chat_webhook_settings connection_row
  set revision = connection_row.revision + 1,
      updated_by = v_audit_actor,
      last_verified_at = pg_catalog.clock_timestamp(),
      last_error_code = case when p_succeeded then null else p_result_code end,
      updated_at = pg_catalog.clock_timestamp()
  where connection_row.channel = p_channel
  returning connection_row.* into v_row;
  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, true);

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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_verification_recorded',
    v_audit_actor,
    v_audit_actor_kind,
    p_request_id,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', true,
      'verification_result', p_result_code
    ),
    'operator_connection_verification'
  );
  update dashboard_private.notification_request_ledger ledger
  set response_payload = pg_catalog.jsonb_build_object(
    'state', 'completed',
    'reserved_at', v_ledger_response ->> 'reserved_at',
    'expires_at', v_ledger_response ->> 'expires_at',
    'completed_at', pg_catalog.clock_timestamp(),
    'actor', p_actor,
    'channel', p_channel,
    'revision', p_expected_revision::text,
    'succeeded', p_succeeded,
    'result_code', p_result_code,
    'connection', v_response
  )
  where ledger.request_id = p_request_id;
  return v_response;
end;
$$;

create or replace function dashboard_private.notification_connection_safe_json_v1(
  p_row public.google_chat_webhook_settings,
  p_editable boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection_key text;
  v_safe_mask text;
  v_safe_error_code text;
begin
  v_connection_key := case p_row.channel
    when 'admin' then 'google_chat.management'
    when 'executive' then 'google_chat.executive'
    when 'math' then 'google_chat.math'
    when 'english' then 'google_chat.english'
    else null
  end;

  if v_connection_key is null then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;

  v_safe_error_code := case
    when p_row.last_error_code
      ~ '^(accepted|configuration_error|provider_rejected|transport_error|http_[1-5][0-9]{2})$'
    then p_row.last_error_code
    else null
  end;
  if p_row.connection_state = 'legacy_active' then
    begin
      v_safe_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
        p_row.webhook_url
      );
    exception
      when sqlstate '22023' then
        v_safe_mask := 'chat.googleapis.com/v1/spaces/…/messages';
        v_safe_error_code := 'configuration_error';
    end;
  elsif p_row.connection_state = 'encrypted_active' then
    if p_row.webhook_url_mask = 'chat.googleapis.com/v1/spaces/…/messages'
      or p_row.webhook_url_mask
        ~ '^chat[.]googleapis[.]com/v1/spaces/[A-Za-z0-9_.-]{4}…[A-Za-z0-9_.-]{4}/messages$'
    then
      v_safe_mask := p_row.webhook_url_mask;
    else
      v_safe_mask := 'chat.googleapis.com/v1/spaces/…/messages';
      v_safe_error_code := 'configuration_error';
    end if;
  else
    v_safe_mask := null;
  end if;

  return pg_catalog.jsonb_build_object(
    'connection_key', v_connection_key,
    'connection_state', p_row.connection_state,
    'revision', p_row.revision::text,
    'configured', p_row.connection_state <> 'disconnected',
    'webhook_url_mask', v_safe_mask,
    'last_verified_at', p_row.last_verified_at,
    'last_error_code', v_safe_error_code,
    'editable', coalesce(p_editable, false)
  );
end;
$$;

create or replace function dashboard_private.notification_control_plane_snapshot_v1(
  p_workflow_key text,
  p_editable boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'scope_key', 'global',
    'workflow_key', p_workflow_key,
    'rules', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', rule_row.id,
            'workflow_key', rule_row.workflow_key,
            'event_key', rule_row.event_key,
            'event_label', null,
            'group_label', null,
            'trigger_description', null,
            'sort_order', null,
            'audience_key', rule_row.audience_key,
            'audience_label', null,
            'channel_key', rule_row.channel_key,
            'channel_label', null,
            'connection_key', case
              when rule_row.channel_key <> 'google_chat' then null
              when rule_row.audience_key = 'management_team' then 'google_chat.management'
              when rule_row.audience_key = 'executive_team' then 'google_chat.executive'
              else null
            end,
            'rule_variant_key', rule_row.rule_variant_key,
            'delivery_mode', rule_row.delivery_mode,
            'schedule_key', rule_row.schedule_key,
            'schedule_config', rule_row.schedule_config,
            'enabled', rule_row.enabled,
            'active_template_id', rule_row.active_template_id,
            'revision', rule_row.revision::text,
            'updated_at', rule_row.updated_at,
            'template', pg_catalog.jsonb_build_object(
              'id', template_row.id,
              'rule_id', template_row.rule_id,
              'version', template_row.version::text,
              'title_template', template_row.title_template,
              'body_template', template_row.body_template,
              'allowed_variables', template_row.allowed_variables,
              'payload_schema_version', template_row.payload_schema_version,
              'checksum', template_row.checksum
            )
          )
          order by
            rule_row.event_key,
            rule_row.channel_key,
            rule_row.audience_key,
            rule_row.rule_variant_key,
            rule_row.id
        )
        from dashboard_private.notification_rules rule_row
        join dashboard_private.notification_templates template_row
          on template_row.rule_id = rule_row.id
         and template_row.id = rule_row.active_template_id
        where rule_row.scope_key = 'global'
          and rule_row.workflow_key = p_workflow_key
      ),
      '[]'::jsonb
    ),
    'connections', coalesce(
      (
        select pg_catalog.jsonb_agg(
          dashboard_private.notification_connection_safe_json_v1(
            connection_row,
            p_editable
          )
          order by case connection_row.channel
            when 'admin' then 1
            when 'executive' then 2
            when 'math' then 3
            when 'english' then 4
            else 99
          end
        )
        from public.google_chat_webhook_settings connection_row
        where connection_row.channel in ('admin', 'executive', 'math', 'english')
      ),
      '[]'::jsonb
    ),
    'delivery_summary', (
      select pg_catalog.jsonb_build_object(
        'pending_count', pg_catalog.count(*) filter (
          where delivery_row.status in ('pending', 'claimed', 'sending', 'retry_wait')
        ),
        'sent_count', pg_catalog.count(*) filter (where delivery_row.status = 'sent'),
        'failed_count', pg_catalog.count(*) filter (where delivery_row.status = 'failed'),
        'unknown_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'delivery_unknown'
        ),
        'latest_delivery_at', pg_catalog.max(delivery_row.updated_at)
      )
      from dashboard_private.notification_deliveries delivery_row
      join dashboard_private.notification_events event_row
        on event_row.id = delivery_row.event_id
      where event_row.scope_key = 'global'
        and event_row.workflow_key = p_workflow_key
    ),
    'loaded_at', pg_catalog.statement_timestamp()
  );
$$;

create or replace function dashboard_private.notification_runtime_dependency_ready_v1(
  p_dependency text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_function_name text;
  v_signature text;
  v_version integer;
begin
  v_function_name := case p_dependency
    when 'common' then 'common_notification_' || 'control_plane_runtime_version'
    when 'adapters' then 'notification_workflow_adapters_runtime_version'
    when 'registration' then 'registration_appointment_reminders_runtime_version'
    else null
  end;
  if v_function_name is null then return false; end if;

  v_signature := pg_catalog.format('%I.%I()', 'public', v_function_name);
  if pg_catalog.to_regprocedure(v_signature) is null then return false; end if;

  begin
    execute 'select ' || v_signature into v_version;
  exception
    when others then
      return false;
  end;
  return v_version = 1;
end;
$$;

create or replace function public.get_notification_runtime_flags_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_flags jsonb;
begin
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  select coalesce(
    pg_catalog.jsonb_object_agg(
      flag_row.flag_key,
      pg_catalog.jsonb_build_object(
        'enabled', flag_row.enabled,
        'revision', flag_row.revision::text
      )
    ),
    '{}'::jsonb
  )
  into v_flags
  from dashboard_private.notification_runtime_flags flag_row;

  return pg_catalog.jsonb_build_object('flags', v_flags);
end;
$$;

create or replace function public.get_notification_control_plane_v1(
  p_workflow_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
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

  return dashboard_private.notification_control_plane_snapshot_v1(
    p_workflow_key,
    v_role = 'admin'
  );
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
  v_request_kind constant text := 'notification_settings_save';
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
  v_active_template_id uuid;
  v_template_version bigint;
  v_title_template text;
  v_body_template text;
  v_allowed_variables jsonb;
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
    or p_expected_revisions is null
    or p_patch is null
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', v_actor,
      'workflow_key', p_workflow_key,
      'expected_revisions', p_expected_revisions,
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
    if v_ledger_kind <> v_request_kind or v_ledger_fingerprint <> v_fingerprint then
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

  if pg_catalog.jsonb_typeof(p_expected_revisions) <> 'object'
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
    from pg_catalog.jsonb_each(p_expected_revisions) expected_entry(key, value)
    where pg_catalog.jsonb_typeof(expected_entry.value) <> 'string'
      or expected_entry.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (v_rules_patch ? expected_entry.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    where not (p_expected_revisions ? patch_key.value)
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
        and (
          pg_catalog.jsonb_typeof(v_rule_patch -> 'title_template') <> 'string'
          or nullif(pg_catalog.btrim(v_rule_patch ->> 'title_template'), '') is null
        )
      )
      or (
        v_rule_patch ? 'body_template'
        and (
          pg_catalog.jsonb_typeof(v_rule_patch -> 'body_template') <> 'string'
          or nullif(pg_catalog.btrim(v_rule_patch ->> 'body_template'), '') is null
        )
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
      rule_row.revision
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision
    from dashboard_private.notification_rules rule_row
    where rule_row.id = v_rule_id
      and rule_row.scope_key = 'global'
      and rule_row.workflow_key = p_workflow_key
    for update of rule_row;
    if not found then
      raise exception 'notification_rule_unknown' using errcode = '22023';
    end if;
    if v_revision::text <> p_expected_revisions ->> v_rule_id_text then
      raise exception 'notification_revision_conflict' using errcode = '40001';
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
          when 'subject_team' then array['english', 'math']::text[]
          else '{}'::text[]
        end
      )
      order by connection_row.channel
      for share of connection_row;
      if not dashboard_private.notification_google_chat_audience_ready_v1(
        v_audience_key
      ) then
        raise exception 'notification_google_chat_connection_required' using errcode = '55000';
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
      template_row.allowed_variables,
      template_row.payload_schema_version
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
      v_allowed_variables,
      v_payload_schema_version
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.rule_id = rule_row.id
     and template_row.id = rule_row.active_template_id
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
      when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null' then null
      else v_rule_patch -> 'schedule_config'
    end;
    if not dashboard_private.notification_schedule_config_valid_v1(
      p_workflow_key,
      v_event_key,
      v_schedule_key,
      v_next_schedule_config
    ) or not dashboard_private.notification_template_content_valid_v1(
      v_next_title_template,
      v_next_body_template,
      v_allowed_variables
    ) then
      raise exception 'notification_patch_invalid' using errcode = '22023';
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
      v_new_checksum := pg_catalog.md5(
        pg_catalog.jsonb_build_object(
          'title_template', v_next_title_template,
          'body_template', v_next_body_template,
          'allowed_variables', v_allowed_variables,
          'payload_schema_version', v_payload_schema_version
        )::text
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
        created_actor_kind
      ) values (
        v_new_template_id,
        v_rule_id,
        v_new_template_version,
        v_next_title_template,
        v_next_body_template,
        v_allowed_variables,
        v_payload_schema_version,
        v_new_checksum,
        v_actor,
        'user'
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
        'schedule_config', v_schedule_config
      ),
      pg_catalog.jsonb_build_object(
        'enabled', v_next_enabled,
        'revision', v_new_revision::text,
        'active_template_id', v_new_template_id,
        'template_version', v_new_template_version::text,
        'schedule_config', v_next_schedule_config
      ),
      'operator_settings_save'
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

create or replace function public.set_notification_runtime_flag_v1(
  p_flag_key text,
  p_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.set_notification_runtime_flag_v1_impl(
    p_flag_key,
    p_enabled,
    p_expected_revision,
    p_request_id
  );
end;
$$;

create or replace function public.backfill_google_chat_connection_encryption_v1(
  p_channel text,
  p_expected_revision bigint,
  p_expected_webhook_fingerprint text,
  p_webhook_url_ciphertext text,
  p_webhook_url_mask text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.google_chat_webhook_settings%rowtype;
  v_actual_fingerprint text;
  v_expected_mask text;
  v_before_summary jsonb;
  v_response jsonb;
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('admin', 'executive', 'math', 'english') then
    raise exception 'notification_connection_unknown' using errcode = '22023';
  end if;
  if p_expected_revision is null
    or p_expected_revision < 1
    or p_expected_revision = 9223372036854775807
    or p_expected_webhook_fingerprint is null
    or p_expected_webhook_fingerprint !~ '^[0-9a-f]{64}$'
    or p_webhook_url_ciphertext is null
    or p_webhook_url_ciphertext !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
    or p_webhook_url_mask is null
  then
    raise exception 'notification_connection_backfill_invalid' using errcode = '22023';
  end if;

  select connection_row.*
  into v_row
  from public.google_chat_webhook_settings connection_row
  where connection_row.channel = p_channel
  for update of connection_row;
  if not found then
    raise exception 'notification_connection_not_configured' using errcode = '55000';
  end if;

  v_actual_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_row.webhook_url, 'UTF8')),
    'hex'
  );
  if v_actual_fingerprint <> p_expected_webhook_fingerprint then
    raise exception 'notification_connection_backfill_fingerprint_mismatch'
      using errcode = '40001';
  end if;

  begin
    v_expected_mask := dashboard_private.notification_google_chat_webhook_mask_v1(
      v_row.webhook_url
    );
  exception
    when sqlstate '22023' then
      raise exception 'notification_connection_backfill_not_candidate'
        using errcode = '55000';
  end;
  if p_webhook_url_mask <> v_expected_mask then
    raise exception 'notification_connection_backfill_invalid' using errcode = '22023';
  end if;

  if v_row.connection_state = 'encrypted_active'
    and v_row.revision = p_expected_revision + 1
    and v_row.webhook_url_ciphertext = p_webhook_url_ciphertext
    and v_row.webhook_url_mask = p_webhook_url_mask
    and exists (
      select 1
      from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'google_chat_connection'
        and audit.entity_id = case p_channel
          when 'admin' then 'google_chat.management'
          when 'executive' then 'google_chat.executive'
          when 'math' then 'google_chat.math'
          when 'english' then 'google_chat.english'
        end
        and audit.action = 'connection_encryption_backfilled'
        and audit.actor_kind = 'system'
        and audit.before_summary ->> 'revision' = p_expected_revision::text
        and audit.after_summary ->> 'revision' = v_row.revision::text
    )
  then
    return dashboard_private.notification_connection_safe_json_v1(v_row, false);
  end if;

  if v_row.revision <> p_expected_revision then
    raise exception 'notification_connection_revision_conflict' using errcode = '40001';
  end if;
  if v_row.connection_state <> 'legacy_active'
    or v_row.webhook_url_ciphertext is not null
  then
    raise exception 'notification_connection_backfill_not_candidate'
      using errcode = '55000';
  end if;

  v_before_summary := pg_catalog.jsonb_build_object(
    'connection_state', v_row.connection_state,
    'revision', v_row.revision::text,
    'configured', true
  );
  update public.google_chat_webhook_settings connection_row
  set webhook_url_ciphertext = p_webhook_url_ciphertext,
      webhook_url_mask = p_webhook_url_mask,
      connection_state = 'encrypted_active',
      revision = connection_row.revision + 1
  where connection_row.channel = p_channel
  returning connection_row.* into v_row;
  v_response := dashboard_private.notification_connection_safe_json_v1(v_row, false);

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
    'google_chat_connection',
    v_response ->> 'connection_key',
    'connection_encryption_backfilled',
    null,
    'system',
    null,
    v_before_summary,
    pg_catalog.jsonb_build_object(
      'connection_state', v_row.connection_state,
      'revision', v_row.revision::text,
      'configured', true
    ),
    'controlled_connection_encryption_backfill'
  );
  return v_response;
end;
$$;

drop function if exists public.replace_google_chat_connection_v1(
  text,
  text,
  text,
  text,
  bigint,
  uuid
);
drop function if exists public.disconnect_google_chat_connection_v1(text, bigint, uuid);
drop function if exists public.begin_google_chat_connection_verification_v1(text, bigint, uuid);
drop function if exists public.record_google_chat_connection_verification_v1(
  text,
  boolean,
  text,
  bigint,
  uuid
);

create or replace function public.replace_google_chat_connection_v1(
  p_actor uuid,
  p_channel text,
  p_webhook_url text,
  p_webhook_url_ciphertext text,
  p_webhook_url_mask text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.replace_google_chat_connection_v1_impl(
    p_actor,
    p_channel,
    p_webhook_url,
    p_webhook_url_ciphertext,
    p_webhook_url_mask,
    p_expected_revision,
    p_request_id
  );
end;
$$;

create or replace function public.disconnect_google_chat_connection_v1(
  p_actor uuid,
  p_channel text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.disconnect_google_chat_connection_v1_impl(
    p_actor,
    p_channel,
    p_expected_revision,
    p_request_id
  );
end;
$$;

create or replace function public.begin_google_chat_connection_verification_v1(
  p_actor uuid,
  p_channel text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.begin_google_chat_connection_verification_v1_impl(
    p_actor,
    p_channel,
    p_expected_revision,
    p_request_id
  );
end;
$$;

create or replace function public.record_google_chat_connection_verification_v1(
  p_actor uuid,
  p_channel text,
  p_succeeded boolean,
  p_result_code text,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (auth.role() = 'service_role') is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  return dashboard_private.record_google_chat_connection_verification_v1_impl(
    p_actor,
    p_channel,
    p_succeeded,
    p_result_code,
    p_expected_revision,
    p_request_id
  );
end;
$$;

revoke all on function dashboard_private.notification_schedule_config_valid_v1(
  text,
  text,
  text,
  jsonb
)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_template_content_valid_v1(
  text,
  text,
  jsonb
)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_google_chat_audience_ready_v1(text)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_google_chat_webhook_mask_v1(text)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_connection_safe_json_v1(
  public.google_chat_webhook_settings,
  boolean
) from public, anon, authenticated;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated;
revoke all on function dashboard_private.notification_runtime_dependency_ready_v1(text)
  from public, anon, authenticated;
revoke all on function dashboard_private.set_notification_runtime_flag_v1_impl(
  text,
  boolean,
  bigint,
  uuid
) from public, anon, authenticated;
revoke all on function dashboard_private.replace_google_chat_connection_v1_impl(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  uuid
) from public, anon, authenticated;
revoke all on function dashboard_private.disconnect_google_chat_connection_v1_impl(
  uuid,
  text,
  bigint,
  uuid
) from public, anon, authenticated;
revoke all on function dashboard_private.begin_google_chat_connection_verification_v1_impl(
  uuid,
  text,
  bigint,
  uuid
) from public, anon, authenticated;
revoke all on function dashboard_private.record_google_chat_connection_verification_v1_impl(
  uuid,
  text,
  boolean,
  text,
  bigint,
  uuid
) from public, anon, authenticated;

revoke all on function public.get_notification_control_plane_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_notification_control_plane_v1(text, jsonb, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_notification_runtime_flags_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.set_notification_runtime_flag_v1(text, boolean, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.backfill_google_chat_connection_encryption_v1(
  text,
  bigint,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function public.replace_google_chat_connection_v1(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.disconnect_google_chat_connection_v1(uuid, text, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_google_chat_connection_verification_v1(uuid, text, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_google_chat_connection_verification_v1(
  uuid,
  text,
  boolean,
  text,
  bigint,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.get_notification_control_plane_v1(text)
  to authenticated;
grant execute on function public.save_notification_control_plane_v1(text, jsonb, jsonb, uuid)
  to authenticated;
grant execute on function public.get_notification_runtime_flags_v1()
  to authenticated;
grant execute on function public.set_notification_runtime_flag_v1(text, boolean, bigint, uuid)
  to service_role;
grant execute on function public.backfill_google_chat_connection_encryption_v1(
  text,
  bigint,
  text,
  text,
  text
) to service_role;
grant execute on function public.replace_google_chat_connection_v1(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  uuid
) to service_role;
grant execute on function public.disconnect_google_chat_connection_v1(uuid, text, bigint, uuid)
  to service_role;
grant execute on function public.begin_google_chat_connection_verification_v1(uuid, text, bigint, uuid)
  to service_role;
grant execute on function public.record_google_chat_connection_verification_v1(
  uuid,
  text,
  boolean,
  text,
  bigint,
  uuid
) to service_role;

commit;
