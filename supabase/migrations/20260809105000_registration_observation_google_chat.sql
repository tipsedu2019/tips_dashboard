begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('registration-observation-google-chat-v1', 0)
);

do $dependency_gate$
declare
  v_runtime integer;
  v_domain_count bigint;
  v_reason_registry text;
  v_reason_mapping text;
  v_expected_reason_registry text;
  v_expected_reason_mapping text;
  v_expected_reasons text[] := array[
    'provider_rate_limited',
    'provider_definite_rejection',
    'transient_pre_dispatch_failure',
    'connection_restored_manual_retry',
    'manual_retry_approved',
    'provider_timeout_after_dispatch',
    'connection_reset_after_dispatch',
    'worker_lost_after_send_start',
    'provider_ambiguous_response',
    'connection_missing',
    'render_validation_failed',
    'schedule_validation_failed',
    'payload_schema_unsupported',
    'max_attempts_exhausted',
    'retry_window_closed',
    'shadow_mode',
    'no_recipient',
    'workflow_scope_mismatch',
    'not_applicable',
    'legacy_skipped',
    'legacy_deduped',
    'rule_disabled',
    'source_status_changed',
    'source_schedule_changed',
    'source_revision_changed',
    'rule_revision_changed',
    'recipient_revoked',
    'cutover_rollback'
  ]::text[];
  v_expected_mapping_literals text[] := array[
    'pending', 'claimed', 'sending', 'sent',
    'retry_wait',
      'provider_rate_limited', 'provider_definite_rejection',
      'transient_pre_dispatch_failure', 'connection_restored_manual_retry',
      'manual_retry_approved',
    'delivery_unknown',
      'provider_timeout_after_dispatch', 'connection_reset_after_dispatch',
      'worker_lost_after_send_start', 'provider_ambiguous_response',
    'failed',
      'connection_missing', 'provider_definite_rejection',
      'render_validation_failed', 'schedule_validation_failed',
      'payload_schema_unsupported', 'max_attempts_exhausted',
      'retry_window_closed',
    'skipped',
      'shadow_mode', 'no_recipient', 'workflow_scope_mismatch',
      'not_applicable', 'legacy_skipped', 'legacy_deduped',
    'disabled', 'rule_disabled',
    'canceled',
      'source_status_changed', 'source_schedule_changed',
      'source_revision_changed', 'rule_revision_changed',
      'recipient_revoked', 'cutover_rollback'
  ]::text[];
  v_registry_literals text[];
  v_mapping_literals text[];
  v_expected_sorted text[];
  v_probe_reasons text[];
  v_status text;
  v_reason text;
  v_allowed boolean;
  v_expected_allowed boolean;
begin
  if pg_catalog.to_regprocedure(
    'public.registration_observation_runtime_version()'
  ) is null then
    raise exception 'registration_observation_google_chat_dependency_missing'
      using errcode = '55000';
  end if;

  begin
    select settings.activation_version
    into strict v_runtime
    from dashboard_private.registration_observation_runtime_settings settings
    where settings.singleton = true
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'registration_observation_google_chat_dependency_missing'
        using errcode = '55000';
  end;
  if v_runtime is distinct from 0 then
    raise exception 'registration_observation_google_chat_runtime_already_active'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass(
    'dashboard_private.registration_observation_domain_events'
  ) is null then
    raise exception 'registration_observation_google_chat_dependency_missing'
      using errcode = '55000';
  end if;
  select pg_catalog.count(*)
  into v_domain_count
  from dashboard_private.registration_observation_domain_events;
  if v_domain_count <> 0 then
    raise exception 'registration_observation_google_chat_preexisting_domain_events'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
      'dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.begin_notification_delivery_send_v1(uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.commit_notification_in_app_delivery_v1(uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_canonical_json_v1(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_sha256_hex_v1(text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.registration_observation_booking_fact_hash_v1(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(uuid,uuid,uuid,uuid[],boolean)'
    ) is null
    or pg_catalog.to_regclass('dashboard_private.notification_rules') is null
    or pg_catalog.to_regclass('dashboard_private.notification_templates') is null
    or pg_catalog.to_regclass('dashboard_private.notification_settings_ui_registry') is null
    or pg_catalog.to_regclass('dashboard_private.notification_rule_content_contracts') is null
    or pg_catalog.to_regclass('dashboard_private.notification_events') is null
    or pg_catalog.to_regclass('dashboard_private.notification_deliveries') is null
    or pg_catalog.to_regclass('dashboard_private.notification_dispatch_ownership_claims') is null
    or pg_catalog.to_regclass('dashboard_private.notification_audit_logs') is null
    or pg_catalog.to_regclass('dashboard_private.notification_assignment_change_facts') is null
    or pg_catalog.to_regclass('dashboard_private.notification_rule_mention_settings') is null
  then
    raise exception 'registration_observation_google_chat_dependency_missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_reason_registry
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'dashboard_private.notification_deliveries'::pg_catalog.regclass
    and constraint_row.conname = 'notification_deliveries_status_reason_check';

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_reason_mapping
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'dashboard_private.notification_deliveries'::pg_catalog.regclass
    and constraint_row.conname =
      'notification_deliveries_status_reason_mapping_check';

  if v_reason_registry is null or v_reason_mapping is null then
    raise exception 'registration_observation_notification_reason_constraint_drift'
      using errcode = '55000';
  end if;

  create temporary table registration_observation_expected_reason_registry_gate(
    status_reason text,
    constraint expected_reason_registry_gate check (
      status_reason is null or status_reason in (
        'provider_rate_limited',
        'provider_definite_rejection',
        'transient_pre_dispatch_failure',
        'connection_restored_manual_retry',
        'manual_retry_approved',
        'provider_timeout_after_dispatch',
        'connection_reset_after_dispatch',
        'worker_lost_after_send_start',
        'provider_ambiguous_response',
        'connection_missing',
        'render_validation_failed',
        'schedule_validation_failed',
        'payload_schema_unsupported',
        'max_attempts_exhausted',
        'retry_window_closed',
        'shadow_mode',
        'no_recipient',
        'workflow_scope_mismatch',
        'not_applicable',
        'legacy_skipped',
        'legacy_deduped',
        'rule_disabled',
        'source_status_changed',
        'source_schedule_changed',
        'source_revision_changed',
        'rule_revision_changed',
        'recipient_revoked',
        'cutover_rollback'
      )
    )
  ) on commit drop;
  create temporary table registration_observation_expected_reason_mapping_gate(
    status text,
    status_reason text,
    constraint expected_reason_mapping_gate check (
      (status in ('pending', 'claimed', 'sending', 'sent')
        and status_reason is null)
      or (status = 'retry_wait' and status_reason in (
        'provider_rate_limited',
        'provider_definite_rejection',
        'transient_pre_dispatch_failure',
        'connection_restored_manual_retry',
        'manual_retry_approved'
      ))
      or (status = 'delivery_unknown' and status_reason in (
        'provider_timeout_after_dispatch',
        'connection_reset_after_dispatch',
        'worker_lost_after_send_start',
        'provider_ambiguous_response'
      ))
      or (status = 'failed' and status_reason in (
        'connection_missing',
        'provider_definite_rejection',
        'render_validation_failed',
        'schedule_validation_failed',
        'payload_schema_unsupported',
        'max_attempts_exhausted',
        'retry_window_closed'
      ))
      or (status = 'skipped' and status_reason in (
        'shadow_mode',
        'no_recipient',
        'workflow_scope_mismatch',
        'not_applicable',
        'legacy_skipped',
        'legacy_deduped'
      ))
      or (status = 'disabled' and status_reason = 'rule_disabled')
      or (status = 'canceled' and status_reason in (
        'source_status_changed',
        'source_schedule_changed',
        'source_revision_changed',
        'rule_revision_changed',
        'recipient_revoked',
        'cutover_rollback'
      ))
    )
  ) on commit drop;
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into strict v_expected_reason_registry
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'pg_temp.registration_observation_expected_reason_registry_gate'::pg_catalog.regclass
    and constraint_row.conname = 'expected_reason_registry_gate';
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into strict v_expected_reason_mapping
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'pg_temp.registration_observation_expected_reason_mapping_gate'::pg_catalog.regclass
    and constraint_row.conname = 'expected_reason_mapping_gate';
  if pg_catalog.regexp_replace(v_reason_registry, '[[:space:]]+', '', 'g')
      is distinct from pg_catalog.regexp_replace(
        v_expected_reason_registry, '[[:space:]]+', '', 'g'
      )
    or pg_catalog.regexp_replace(v_reason_mapping, '[[:space:]]+', '', 'g')
      is distinct from pg_catalog.regexp_replace(
        v_expected_reason_mapping, '[[:space:]]+', '', 'g'
      )
  then
    raise exception 'registration_observation_notification_reason_constraint_drift'
      using errcode = '55000';
  end if;
  select pg_catalog.array_agg(match[1] order by match[1])
  into v_registry_literals
  from pg_catalog.regexp_matches(
    v_reason_registry,
    $reason_literal$'([^']+)'$reason_literal$,
    'g'
  ) match;
  select pg_catalog.array_agg(reason order by reason)
  into v_expected_sorted
  from pg_catalog.unnest(v_expected_reasons) reason;
  if v_registry_literals is distinct from v_expected_sorted then
    raise exception 'registration_observation_notification_reason_constraint_drift'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(match[1] order by match[1])
  into v_mapping_literals
  from pg_catalog.regexp_matches(
    v_reason_mapping,
    $reason_literal$'([^']+)'$reason_literal$,
    'g'
  ) match;
  select pg_catalog.array_agg(value order by value)
  into v_expected_sorted
  from pg_catalog.unnest(v_expected_mapping_literals) value;
  if v_mapping_literals is distinct from v_expected_sorted then
    raise exception 'registration_observation_notification_reason_constraint_drift'
      using errcode = '55000';
  end if;

  -- Re-attach the live definitions to isolated temporary tables and compare
  -- their complete truth tables. Literal equality alone cannot detect a
  -- changed AND/OR operator or a reason moved between terminal families.
  create temporary table registration_observation_reason_registry_gate(
    status_reason text
  ) on commit drop;
  create temporary table registration_observation_reason_mapping_gate(
    status text,
    status_reason text
  ) on commit drop;
  execute pg_catalog.format(
    'alter table pg_temp.registration_observation_reason_registry_gate add constraint reason_registry_gate %s',
    v_reason_registry
  );
  execute pg_catalog.format(
    'alter table pg_temp.registration_observation_reason_mapping_gate add constraint reason_mapping_gate %s',
    v_reason_mapping
  );
  v_probe_reasons := pg_catalog.array_prepend(
    null::text,
    v_expected_reasons || array['registration_observation_unexpected_reason']
  );
  foreach v_reason in array v_probe_reasons loop
    v_expected_allowed := v_reason is null or v_reason = any(v_expected_reasons);
    begin
      insert into pg_temp.registration_observation_reason_registry_gate(
        status_reason
      ) values (v_reason);
      v_allowed := true;
      delete from pg_temp.registration_observation_reason_registry_gate;
    exception when check_violation then
      v_allowed := false;
    end;
    if v_allowed is distinct from v_expected_allowed then
      raise exception 'registration_observation_notification_reason_constraint_drift'
        using errcode = '55000';
    end if;
  end loop;
  foreach v_status in array array[
    'pending', 'claimed', 'sending', 'sent', 'retry_wait',
    'delivery_unknown', 'failed', 'skipped', 'disabled', 'canceled',
    'registration_observation_unexpected_status'
  ]::text[] loop
    foreach v_reason in array v_probe_reasons loop
      v_expected_allowed := coalesce(case
        when v_status in ('pending', 'claimed', 'sending', 'sent')
          then v_reason is null
        when v_status = 'retry_wait' then v_reason is null or v_reason in (
          'provider_rate_limited', 'provider_definite_rejection',
          'transient_pre_dispatch_failure',
          'connection_restored_manual_retry', 'manual_retry_approved'
        )
        when v_status = 'delivery_unknown' then v_reason is null or v_reason in (
          'provider_timeout_after_dispatch', 'connection_reset_after_dispatch',
          'worker_lost_after_send_start', 'provider_ambiguous_response'
        )
        when v_status = 'failed' then v_reason is null or v_reason in (
          'connection_missing', 'provider_definite_rejection',
          'render_validation_failed', 'schedule_validation_failed',
          'payload_schema_unsupported', 'max_attempts_exhausted',
          'retry_window_closed'
        )
        when v_status = 'skipped' then v_reason is null or v_reason in (
          'shadow_mode', 'no_recipient', 'workflow_scope_mismatch',
          'not_applicable', 'legacy_skipped', 'legacy_deduped'
        )
        when v_status = 'disabled' then
          v_reason is null or v_reason = 'rule_disabled'
        when v_status = 'canceled' then v_reason is null or v_reason in (
          'source_status_changed', 'source_schedule_changed',
          'source_revision_changed', 'rule_revision_changed',
          'recipient_revoked', 'cutover_rollback'
        )
        else false
      end, false);
      begin
        insert into pg_temp.registration_observation_reason_mapping_gate(
          status, status_reason
        ) values (v_status, v_reason);
        v_allowed := true;
        delete from pg_temp.registration_observation_reason_mapping_gate;
      exception when check_violation then
        v_allowed := false;
      end;
      if v_allowed is distinct from v_expected_allowed then
        raise exception 'registration_observation_notification_reason_constraint_drift'
          using errcode = '55000';
      end if;
    end loop;
  end loop;
end
$dependency_gate$;

alter table dashboard_private.notification_deliveries
  drop constraint notification_deliveries_status_reason_check;
alter table dashboard_private.notification_deliveries
  add constraint notification_deliveries_status_reason_check
  check (status_reason is null or status_reason in (
    'provider_rate_limited',
    'provider_definite_rejection',
    'transient_pre_dispatch_failure',
    'connection_restored_manual_retry',
    'manual_retry_approved',
    'provider_timeout_after_dispatch',
    'connection_reset_after_dispatch',
    'worker_lost_after_send_start',
    'provider_ambiguous_response',
    'connection_missing',
    'render_validation_failed',
    'schedule_validation_failed',
    'payload_schema_unsupported',
    'max_attempts_exhausted',
    'retry_window_closed',
    'shadow_mode',
    'no_recipient',
    'workflow_scope_mismatch',
    'not_applicable',
    'legacy_skipped',
    'legacy_deduped',
    'rule_disabled',
    'source_status_changed',
    'source_schedule_changed',
    'source_revision_changed',
    'rule_revision_changed',
    'recipient_revoked',
    'cutover_rollback',
    'notification_window_closed'
  ));

alter table dashboard_private.notification_deliveries
  drop constraint notification_deliveries_status_reason_mapping_check;
alter table dashboard_private.notification_deliveries
  add constraint notification_deliveries_status_reason_mapping_check
  check (
    (status in ('pending', 'claimed', 'sending', 'sent') and status_reason is null)
    or (status = 'retry_wait' and status_reason in (
      'provider_rate_limited',
      'provider_definite_rejection',
      'transient_pre_dispatch_failure',
      'connection_restored_manual_retry',
      'manual_retry_approved'
    ))
    or (status = 'delivery_unknown' and status_reason in (
      'provider_timeout_after_dispatch',
      'connection_reset_after_dispatch',
      'worker_lost_after_send_start',
      'provider_ambiguous_response'
    ))
    or (status = 'failed' and status_reason in (
      'connection_missing',
      'provider_definite_rejection',
      'render_validation_failed',
      'schedule_validation_failed',
      'payload_schema_unsupported',
      'max_attempts_exhausted',
      'retry_window_closed'
    ))
    or (status = 'skipped' and status_reason in (
      'shadow_mode',
      'no_recipient',
      'workflow_scope_mismatch',
      'not_applicable',
      'legacy_skipped',
      'legacy_deduped'
    ))
    or (status = 'disabled' and status_reason = 'rule_disabled')
    or (status = 'canceled' and status_reason in (
      'source_status_changed',
      'source_schedule_changed',
      'source_revision_changed',
      'rule_revision_changed',
      'recipient_revoked',
      'cutover_rollback',
      'notification_window_closed'
    ))
  );

alter table dashboard_private.notification_deliveries
  add column observation_payload_snapshot jsonb,
  add column observation_payload_fingerprint text,
  add column observation_render_fingerprint text;

alter table dashboard_private.notification_deliveries
  add constraint notification_deliveries_observation_payload_snapshot_check
    check (
      observation_payload_snapshot is null
      or pg_catalog.jsonb_typeof(observation_payload_snapshot) = 'object'
    ),
  add constraint notification_deliveries_observation_payload_fingerprint_check
    check (
      observation_payload_fingerprint is null
      or observation_payload_fingerprint ~ '^[a-f0-9]{64}$'
    ),
  add constraint notification_deliveries_observation_render_fingerprint_check
    check (
      observation_render_fingerprint is null
      or observation_render_fingerprint ~ '^[a-f0-9]{64}$'
    ),
  add constraint notification_deliveries_observation_frozen_triplet_check
    check (
      (observation_payload_snapshot is null)
      = (observation_payload_fingerprint is null)
      and (observation_payload_snapshot is null)
      = (observation_render_fingerprint is null)
    );

create or replace function dashboard_private.registration_observation_chat_source_revision_valid_v1(
  p_source_revision jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_source_revision) <> 'object' then false
    when p_source_revision ->> 'authority' = 'normalized' then
      p_source_revision = pg_catalog.jsonb_build_object(
        'authority', 'normalized',
        'sessionId', p_source_revision ->> 'sessionId',
        'revision', (p_source_revision ->> 'revision')::bigint
      )
      and (p_source_revision ->> 'sessionId')::uuid is not null
      and pg_catalog.jsonb_typeof(p_source_revision -> 'revision') = 'number'
      and (p_source_revision ->> 'revision')::bigint >= 0
    when p_source_revision ->> 'authority' = 'legacy' then
      p_source_revision = pg_catalog.jsonb_build_object(
        'authority', 'legacy',
        'sessionKey', p_source_revision ->> 'sessionKey',
        'contentHash', p_source_revision ->> 'contentHash'
      )
      and nullif(pg_catalog.btrim(p_source_revision ->> 'sessionKey'), '') is not null
      and nullif(pg_catalog.btrim(p_source_revision ->> 'contentHash'), '') is not null
    else false
  end;
$$;

create or replace function dashboard_private.registration_observation_chat_payload_booking_valid_v1(
  p_booking jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_keys text[];
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if p_booking is null or pg_catalog.jsonb_typeof(p_booking) <> 'object' then
    return false;
  end if;
  select pg_catalog.array_agg(key order by key)
  into v_keys
  from pg_catalog.jsonb_object_keys(p_booking) key;
  if v_keys is distinct from array[
      'campus', 'class_id', 'class_lesson_session_id', 'class_name',
      'classroom_name', 'ends_at', 'legacy_session_key', 'schedule_state',
      'session_authority', 'starts_at', 'teacher_name'
    ]::text[]
  then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_booking -> 'class_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'class_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'teacher_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'classroom_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'campus') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'schedule_state') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'session_authority') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'starts_at') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_booking -> 'ends_at') is distinct from 'string'
    or pg_catalog.octet_length(p_booking ->> 'class_name') > 512
    or pg_catalog.octet_length(p_booking ->> 'teacher_name') > 512
    or pg_catalog.octet_length(p_booking ->> 'classroom_name') > 512
  then
    return false;
  end if;
  v_starts_at := (p_booking ->> 'starts_at')::timestamptz;
  v_ends_at := (p_booking ->> 'ends_at')::timestamptz;
  return (p_booking ->> 'class_id')::uuid is not null
    and nullif(pg_catalog.btrim(p_booking ->> 'class_name'), '') is not null
    and nullif(pg_catalog.btrim(p_booking ->> 'teacher_name'), '') is not null
    and nullif(pg_catalog.btrim(p_booking ->> 'classroom_name'), '') is not null
    and p_booking ->> 'campus' in ('본관', '별관')
    and p_booking ->> 'schedule_state' in ('active', 'makeup')
    and v_starts_at is not null
    and v_ends_at > v_starts_at
    and (
      (p_booking ->> 'session_authority' = 'normalized'
        and pg_catalog.jsonb_typeof(
          p_booking -> 'class_lesson_session_id'
        ) = 'string'
        and (p_booking ->> 'class_lesson_session_id')::uuid is not null
        and p_booking -> 'legacy_session_key' = 'null'::jsonb)
      or
      (p_booking ->> 'session_authority' = 'legacy'
        and p_booking -> 'class_lesson_session_id' = 'null'::jsonb
        and pg_catalog.jsonb_typeof(p_booking -> 'legacy_session_key') = 'string'
        and nullif(pg_catalog.btrim(p_booking ->> 'legacy_session_key'), '') is not null)
    );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow then
    return false;
end;
$$;

create or replace function dashboard_private.registration_observation_chat_payload_valid_v3(
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_event_key text;
  v_keys text[];
  v_expected_keys text[];
  v_mention_ids uuid[];
  v_previous_director_ids uuid[];
  v_director_ids uuid[];
  v_occurred_at timestamptz;
  v_expires_at timestamptz;
  v_textbook_names_valid boolean := false;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;
  v_event_key := p_payload ->> 'event_kind';
  v_expected_keys := case v_event_key
    when 'registration.observation_scheduled' then array[
      'appointment_id','appointment_notification_revision','booking',
      'booking_fact_hash','delivery_expires_at','event_kind',
      'mention_profile_ids','mention_role','observation_id','occurred_at',
      'progress_summary','source_revision','student_name','subject','task_id',
      'textbook_names','track_id'
    ]::text[]
    when 'registration.observation_rescheduled' then array[
      'appointment_id','appointment_notification_revision','booking',
      'booking_fact_hash','delivery_expires_at','event_kind',
      'mention_profile_ids','mention_role','observation_id','occurred_at',
      'previous_booking','progress_summary','source_revision','student_name',
      'subject','task_id','textbook_names','track_id'
    ]::text[]
    when 'registration.observation_canceled' then array[
      'appointment_id','appointment_notification_revision','booking_fact_hash',
      'canceled_booking','delivery_expires_at','event_kind',
      'mention_profile_ids','mention_role','observation_id','occurred_at',
      'source_revision','student_name','subject','task_id','track_id'
    ]::text[]
    when 'registration.observation_reminder_due' then array[
      'appointment_id','appointment_notification_revision','booking',
      'booking_fact_hash','delivery_expires_at','event_kind',
      'mention_profile_ids','mention_role','observation_id','occurred_at',
      'progress_summary','source_revision','student_name','subject','task_id',
      'textbook_names','track_id'
    ]::text[]
    when 'registration.observation_feedback_due' then array[
      'appointment_id','appointment_notification_revision','booking',
      'booking_fact_hash','delivery_expires_at','event_kind',
      'mention_profile_ids','mention_role','observation_id','occurred_at',
      'source_revision','student_name','subject','task_id','track_id'
    ]::text[]
    when 'registration.observation_feedback_submitted' then array[
      'appointment_id','appointment_notification_revision','booking',
      'booking_fact_hash','delivery_expires_at','event_kind',
      'mention_profile_ids','mention_role','observation_id','occurred_at',
      'source_revision','student_name','subject','submitted_at',
      'submitted_by_name','task_id','track_id'
    ]::text[]
    when 'registration.observation_director_reassigned' then array[
      'appointment_id','appointment_notification_revision','assignment_fact_id',
      'booking','booking_fact_hash','delivery_expires_at',
      'director_profile_ids','event_kind','mention_profile_ids','mention_role',
      'observation_id','occurred_at','previous_director_profile_ids',
      'source_revision','student_name','subject','task_id','track_id'
    ]::text[]
    else null
  end;
  select pg_catalog.array_agg(key order by key)
  into v_keys
  from pg_catalog.jsonb_object_keys(p_payload) key;
  if v_expected_keys is null or v_keys is distinct from v_expected_keys then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_payload -> 'event_kind') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'task_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'track_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'observation_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'appointment_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'student_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'subject') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'booking_fact_hash') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'occurred_at') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'delivery_expires_at') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload -> 'mention_role') is distinct from 'string'
    or (p_payload ->> 'task_id')::uuid is null
    or (p_payload ->> 'track_id')::uuid is null
    or (p_payload ->> 'observation_id')::uuid is null
    or (p_payload ->> 'appointment_id')::uuid is null
    or pg_catalog.jsonb_typeof(
      p_payload -> 'appointment_notification_revision'
    ) <> 'number'
    or (p_payload ->> 'appointment_notification_revision')::bigint < 1
    or nullif(pg_catalog.btrim(p_payload ->> 'student_name'), '') is null
    or pg_catalog.octet_length(p_payload ->> 'student_name') > 512
    or p_payload ->> 'subject' not in ('영어', '수학', '과학')
    or not dashboard_private.registration_observation_chat_source_revision_valid_v1(
      p_payload -> 'source_revision'
    )
    or p_payload ->> 'booking_fact_hash' !~ '^[a-f0-9]{64}$'
    or p_payload ->> 'mention_role' not in ('subject_teacher','track_director')
    or pg_catalog.jsonb_typeof(p_payload -> 'mention_profile_ids') <> 'array'
  then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'mention_profile_ids') item
    where pg_catalog.jsonb_typeof(item) <> 'string'
  ) then
    return false;
  end if;
  select coalesce(
    pg_catalog.array_agg(value::uuid order by value::uuid),
    array[]::uuid[]
  )
  into v_mention_ids
  from pg_catalog.jsonb_array_elements_text(
    p_payload -> 'mention_profile_ids'
  ) item(value);
  if v_mention_ids is distinct from
      dashboard_private.google_chat_canonical_uuid_array_v1(v_mention_ids)
    or p_payload -> 'mention_profile_ids' is distinct from pg_catalog.to_jsonb(v_mention_ids)
  then
    return false;
  end if;
  v_occurred_at := (p_payload ->> 'occurred_at')::timestamptz;
  v_expires_at := (p_payload ->> 'delivery_expires_at')::timestamptz;
  if v_occurred_at is null or v_expires_at <= v_occurred_at then
    return false;
  end if;
  if p_payload ? 'textbook_names' then
    v_textbook_names_valid :=
      pg_catalog.jsonb_typeof(p_payload -> 'textbook_names') = 'array'
      and pg_catalog.jsonb_array_length(p_payload -> 'textbook_names') between 1 and 64
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_payload -> 'textbook_names') item
        where pg_catalog.jsonb_typeof(item) <> 'string'
          or nullif(pg_catalog.btrim(item #>> '{}'), '') is null
          or pg_catalog.octet_length(item #>> '{}') > 512
      );
  end if;

  if v_event_key in (
      'registration.observation_scheduled',
      'registration.observation_reminder_due'
    ) then
    return p_payload ->> 'mention_role' = 'subject_teacher'
      and dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'booking'
      )
      and v_textbook_names_valid
      and pg_catalog.jsonb_typeof(p_payload -> 'progress_summary') = 'string'
      and nullif(pg_catalog.btrim(p_payload ->> 'progress_summary'), '') is not null
      and pg_catalog.octet_length(p_payload ->> 'progress_summary') <= 2048;
  elsif v_event_key = 'registration.observation_rescheduled' then
    return p_payload ->> 'mention_role' = 'subject_teacher'
      and dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'booking'
      )
      and dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'previous_booking'
      )
      and v_textbook_names_valid
      and pg_catalog.jsonb_typeof(p_payload -> 'progress_summary') = 'string'
      and nullif(pg_catalog.btrim(p_payload ->> 'progress_summary'), '') is not null
      and pg_catalog.octet_length(p_payload ->> 'progress_summary') <= 2048;
  elsif v_event_key = 'registration.observation_canceled' then
    return p_payload ->> 'mention_role' = 'subject_teacher'
      and dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'canceled_booking'
      );
  elsif v_event_key = 'registration.observation_feedback_due' then
    return p_payload ->> 'mention_role' = 'subject_teacher'
      and dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'booking'
      );
  elsif v_event_key = 'registration.observation_feedback_submitted' then
    return p_payload ->> 'mention_role' = 'track_director'
      and dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'booking'
      )
      and pg_catalog.jsonb_typeof(p_payload -> 'submitted_by_name') = 'string'
      and nullif(pg_catalog.btrim(p_payload ->> 'submitted_by_name'), '') is not null
      and pg_catalog.octet_length(p_payload ->> 'submitted_by_name') <= 512
      and pg_catalog.jsonb_typeof(p_payload -> 'submitted_at') = 'string'
      and (p_payload ->> 'submitted_at')::timestamptz is not null;
  elsif v_event_key = 'registration.observation_director_reassigned' then
    if p_payload ->> 'mention_role' <> 'track_director'
      or (p_payload ->> 'assignment_fact_id')::uuid is null
      or not dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        p_payload -> 'booking'
      )
      or pg_catalog.jsonb_typeof(p_payload -> 'previous_director_profile_ids') <> 'array'
      or pg_catalog.jsonb_typeof(p_payload -> 'director_profile_ids') <> 'array'
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          p_payload -> 'previous_director_profile_ids'
        ) item
        where pg_catalog.jsonb_typeof(item) <> 'string'
      )
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          p_payload -> 'director_profile_ids'
        ) item
        where pg_catalog.jsonb_typeof(item) <> 'string'
      )
    then
      return false;
    end if;
    select coalesce(pg_catalog.array_agg(value::uuid order by value::uuid), array[]::uuid[])
    into v_previous_director_ids
    from pg_catalog.jsonb_array_elements_text(
      p_payload -> 'previous_director_profile_ids'
    ) item(value);
    select coalesce(pg_catalog.array_agg(value::uuid order by value::uuid), array[]::uuid[])
    into v_director_ids
    from pg_catalog.jsonb_array_elements_text(
      p_payload -> 'director_profile_ids'
    ) item(value);
    return p_payload -> 'previous_director_profile_ids' = pg_catalog.to_jsonb(
        dashboard_private.google_chat_canonical_uuid_array_v1(v_previous_director_ids)
      )
      and p_payload -> 'director_profile_ids' = pg_catalog.to_jsonb(
        dashboard_private.google_chat_canonical_uuid_array_v1(v_director_ids)
      )
      and v_mention_ids = dashboard_private.google_chat_canonical_uuid_array_v1(
        v_previous_director_ids || v_director_ids
      );
  end if;
  return false;
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    return false;
end;
$$;

create or replace function dashboard_private.registration_observation_chat_refresh_payload_matches_v1(
  p_candidate jsonb,
  p_event_payload jsonb,
  p_current_source_revision jsonb,
  p_current_textbook_names jsonb,
  p_current_progress_summary text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_event_payload ->> 'event_kind' =
        'registration.observation_reminder_due'
    then
      p_candidate - array[
        'source_revision', 'textbook_names', 'progress_summary'
      ]::text[]
        is not distinct from
      p_event_payload - array[
        'source_revision', 'textbook_names', 'progress_summary'
      ]::text[]
      and p_candidate -> 'source_revision'
        is not distinct from p_current_source_revision
      and p_candidate -> 'textbook_names'
        is not distinct from p_current_textbook_names
      and p_candidate ->> 'progress_summary'
        is not distinct from p_current_progress_summary
    else
      p_candidate - 'source_revision'
        is not distinct from p_event_payload - 'source_revision'
      and p_candidate -> 'source_revision'
        is not distinct from p_current_source_revision
  end;
$$;

create or replace function dashboard_private.registration_observation_chat_render_safe_v1(
  p_title text,
  p_body text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.btrim(p_title), '') is not null
    and nullif(pg_catalog.btrim(p_body), '') is not null
    and pg_catalog.octet_length(p_title) <= 256
    and pg_catalog.octet_length(p_body) <= 16384
    and (p_title || pg_catalog.chr(10) || p_body) !~ '<[^>]*>'
    and (p_title || pg_catalog.chr(10) || p_body)
      !~* '(https?://|javascript:|(^|[[:space:]])//)'
    and (p_title || pg_catalog.chr(10) || p_body)
      !~* '(@all|@everyone|@channel|@here|@전체)',
    false
  );
$$;

create or replace function dashboard_private.registration_observation_chat_event_source_valid_v1(
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_payload jsonb
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_observation_id uuid;
  v_assignment_fact_id uuid;
begin
  if not dashboard_private.registration_observation_chat_payload_valid_v3(
      p_payload
    )
  then
    return false;
  end if;
  v_observation_id := (p_payload ->> 'observation_id')::uuid;
  if p_source_type = 'registration_observation' then
    return p_payload ->> 'event_kind' <>
        'registration.observation_director_reassigned'
      and p_source_id = v_observation_id::text
      and p_source_revision is not distinct from
        (p_payload ->> 'appointment_notification_revision')::bigint;
  elsif p_source_type =
      'registration_observation_assignment_change'
  then
    v_assignment_fact_id := (p_payload ->> 'assignment_fact_id')::uuid;
    return p_payload ->> 'event_kind' =
        'registration.observation_director_reassigned'
      and p_source_id = v_assignment_fact_id::text
      and p_source_revision is null
      and exists (
        select 1
        from dashboard_private.notification_assignment_change_facts fact
        where fact.fact_id = v_assignment_fact_id
          and fact.workflow_key = 'registration'
          and fact.source_type = 'registration_track_event'
          and fact.role_key = 'track_director'
          and fact.context_entity_id = (p_payload ->> 'track_id')::uuid
          and fact.previous_profile_ids = array(
            select value::uuid
            from pg_catalog.jsonb_array_elements_text(
              p_payload -> 'previous_director_profile_ids'
            ) with ordinality item(value, ordinality)
            order by ordinality
          )
          and fact.current_profile_ids = array(
            select value::uuid
            from pg_catalog.jsonb_array_elements_text(
              p_payload -> 'director_profile_ids'
            ) with ordinality item(value, ordinality)
            order by ordinality
          )
      );
  end if;
  return false;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

create or replace function dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
  p_event_key text,
  p_current_booking jsonb,
  p_previous_booking jsonb
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'eventKey', p_event_key,
        'currentBooking', p_current_booking,
        'previousBooking', p_previous_booking
      )
    )
  );
$$;

create or replace function dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
  p_event_key text,
  p_current_booking jsonb,
  p_previous_booking jsonb,
  p_preparation jsonb,
  p_submission jsonb,
  p_mention_role text,
  p_mention_profile_ids uuid[]
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_booking_keys text[] := array[
    'campus', 'classId', 'classLessonSessionId', 'className',
    'classroomCatalogId', 'classroomName', 'endsAt', 'legacySessionKey',
    'scheduleState', 'sessionAuthority', 'startsAt', 'teacherCatalogId',
    'teacherName', 'teacherProfileId'
  ]::text[];
  v_keys text[];
  v_submission_at timestamptz;
begin
  if p_event_key not in (
      'registration.observation_scheduled',
      'registration.observation_rescheduled',
      'registration.observation_canceled',
      'registration.observation_reminder_due',
      'registration.observation_feedback_due',
      'registration.observation_feedback_submitted',
      'registration.observation_director_reassigned'
    )
    or p_current_booking is null
    or pg_catalog.jsonb_typeof(p_current_booking) <> 'object'
    or p_mention_profile_ids is null
    or p_mention_profile_ids is distinct from
      dashboard_private.google_chat_canonical_uuid_array_v1(p_mention_profile_ids)
  then
    return false;
  end if;

  select pg_catalog.array_agg(key order by key)
  into v_keys
  from pg_catalog.jsonb_object_keys(p_current_booking) key;
  if v_keys is distinct from v_booking_keys then
    return false;
  end if;
  if not dashboard_private.registration_observation_chat_payload_booking_valid_v1(
      pg_catalog.jsonb_build_object(
        'class_id',p_current_booking -> 'classId',
        'class_name',p_current_booking -> 'className',
        'session_authority',p_current_booking -> 'sessionAuthority',
        'class_lesson_session_id',p_current_booking -> 'classLessonSessionId',
        'legacy_session_key',p_current_booking -> 'legacySessionKey',
        'schedule_state',p_current_booking -> 'scheduleState',
        'starts_at',p_current_booking -> 'startsAt',
        'ends_at',p_current_booking -> 'endsAt',
        'teacher_name',p_current_booking -> 'teacherName',
        'classroom_name',p_current_booking -> 'classroomName',
        'campus',p_current_booking -> 'campus'
      )
    )
    or pg_catalog.jsonb_typeof(
      p_current_booking -> 'teacherCatalogId'
    ) is distinct from 'string'
    or (p_current_booking ->> 'teacherCatalogId')::uuid is null
    or pg_catalog.jsonb_typeof(
      p_current_booking -> 'classroomCatalogId'
    ) is distinct from 'string'
    or (p_current_booking ->> 'classroomCatalogId')::uuid is null
    or not (
      pg_catalog.jsonb_typeof(p_current_booking -> 'teacherProfileId') = 'null'
      or (
        pg_catalog.jsonb_typeof(
          p_current_booking -> 'teacherProfileId'
        ) = 'string'
        and (p_current_booking ->> 'teacherProfileId')::uuid is not null
      )
    )
  then
    return false;
  end if;

  if p_previous_booking is not null then
    if pg_catalog.jsonb_typeof(p_previous_booking) <> 'object' then
      return false;
    end if;
    select pg_catalog.array_agg(key order by key)
    into v_keys
    from pg_catalog.jsonb_object_keys(p_previous_booking) key;
    if v_keys is distinct from v_booking_keys then
      return false;
    end if;
    if not dashboard_private.registration_observation_chat_payload_booking_valid_v1(
        pg_catalog.jsonb_build_object(
          'class_id',p_previous_booking -> 'classId',
          'class_name',p_previous_booking -> 'className',
          'session_authority',p_previous_booking -> 'sessionAuthority',
          'class_lesson_session_id',p_previous_booking -> 'classLessonSessionId',
          'legacy_session_key',p_previous_booking -> 'legacySessionKey',
          'schedule_state',p_previous_booking -> 'scheduleState',
          'starts_at',p_previous_booking -> 'startsAt',
          'ends_at',p_previous_booking -> 'endsAt',
          'teacher_name',p_previous_booking -> 'teacherName',
          'classroom_name',p_previous_booking -> 'classroomName',
          'campus',p_previous_booking -> 'campus'
        )
      )
      or pg_catalog.jsonb_typeof(
        p_previous_booking -> 'teacherCatalogId'
      ) is distinct from 'string'
      or (p_previous_booking ->> 'teacherCatalogId')::uuid is null
      or pg_catalog.jsonb_typeof(
        p_previous_booking -> 'classroomCatalogId'
      ) is distinct from 'string'
      or (p_previous_booking ->> 'classroomCatalogId')::uuid is null
      or not (
        pg_catalog.jsonb_typeof(p_previous_booking -> 'teacherProfileId') = 'null'
        or (
          pg_catalog.jsonb_typeof(
            p_previous_booking -> 'teacherProfileId'
          ) = 'string'
          and (p_previous_booking ->> 'teacherProfileId')::uuid is not null
        )
      )
    then
      return false;
    end if;
  end if;

  if p_preparation is not null and p_preparation is distinct from
    pg_catalog.jsonb_build_object(
      'textbookNames', p_preparation -> 'textbookNames',
      'progressSummary', p_preparation ->> 'progressSummary'
    )
  then
    return false;
  end if;
  if p_preparation is not null
    and (
      pg_catalog.jsonb_typeof(p_preparation -> 'textbookNames') <> 'array'
      or pg_catalog.jsonb_array_length(p_preparation -> 'textbookNames') not between 1 and 64
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          p_preparation -> 'textbookNames'
        ) item
        where pg_catalog.jsonb_typeof(item) <> 'string'
          or nullif(pg_catalog.btrim(item #>> '{}'), '') is null
          or pg_catalog.octet_length(item #>> '{}') > 512
      )
      or pg_catalog.jsonb_typeof(
        p_preparation -> 'progressSummary'
      ) <> 'string'
      or nullif(
        pg_catalog.btrim(p_preparation ->> 'progressSummary'),''
      ) is null
      or pg_catalog.octet_length(
        p_preparation ->> 'progressSummary'
      ) > 2048
    )
  then
    return false;
  end if;
  if p_submission is not null and p_submission is distinct from
    pg_catalog.jsonb_build_object(
      'submittedByName', p_submission ->> 'submittedByName',
      'submittedAt', p_submission ->> 'submittedAt'
    )
  then
    return false;
  end if;
  if p_submission is not null then
    if pg_catalog.jsonb_typeof(
        p_submission -> 'submittedByName'
      ) <> 'string'
      or nullif(
        pg_catalog.btrim(p_submission ->> 'submittedByName'),''
      ) is null
      or pg_catalog.octet_length(
        p_submission ->> 'submittedByName'
      ) > 512
      or pg_catalog.jsonb_typeof(p_submission -> 'submittedAt') <> 'string'
    then
      return false;
    end if;
    v_submission_at := (p_submission ->> 'submittedAt')::timestamptz;
    if v_submission_at is null then
      return false;
    end if;
  end if;

  if p_event_key = 'registration.observation_rescheduled' then
    return p_previous_booking is not null
      and p_preparation is not null
      and p_submission is null
      and p_mention_role = 'subject_teacher';
  elsif p_event_key in (
    'registration.observation_scheduled',
    'registration.observation_reminder_due'
  ) then
    return p_previous_booking is null
      and p_preparation is not null
      and p_submission is null
      and p_mention_role = 'subject_teacher';
  elsif p_event_key in (
    'registration.observation_canceled',
    'registration.observation_feedback_due'
  ) then
    return p_previous_booking is null
      and p_preparation is null
      and p_submission is null
      and p_mention_role = 'subject_teacher';
  elsif p_event_key = 'registration.observation_feedback_submitted' then
    return p_previous_booking is null
      and p_preparation is null
      and p_submission is not null
      and p_mention_role = 'track_director';
  elsif p_event_key = 'registration.observation_director_reassigned' then
    return p_previous_booking is null
      and p_preparation is null
      and p_submission is null
      and p_mention_role = 'track_director';
  end if;
  return false;
exception
  when invalid_text_representation or invalid_parameter_value
    or invalid_datetime_format or datetime_field_overflow then
    return false;
end;
$$;

create table dashboard_private.registration_observation_chat_jobs (
  job_id uuid primary key default gen_random_uuid(),
  domain_event_id uuid references dashboard_private.registration_observation_domain_events(event_id) on delete restrict,
  assignment_fact_id uuid references dashboard_private.notification_assignment_change_facts(fact_id) on delete restrict,
  observation_id uuid not null references public.ops_registration_observations(id) on delete restrict,
  appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
  notification_revision integer not null check (notification_revision > 0),
  event_key text not null check (event_key in (
    'registration.observation_scheduled',
    'registration.observation_rescheduled',
    'registration.observation_canceled',
    'registration.observation_reminder_due',
    'registration.observation_feedback_due',
    'registration.observation_feedback_submitted',
    'registration.observation_director_reassigned'
  )),
  source_revision jsonb not null,
  booking_fact_hash text not null check (booking_fact_hash ~ '^[a-f0-9]{64}$'),
  reservation_snapshot_hash text not null check (reservation_snapshot_hash ~ '^[a-f0-9]{64}$'),
  current_booking_snapshot jsonb,
  previous_booking_snapshot jsonb,
  preparation_snapshot jsonb,
  submission_snapshot jsonb,
  mention_role text not null check (mention_role in ('subject_teacher','track_director')),
  mention_profile_ids uuid[] not null default '{}'::uuid[],
  rule_snapshot jsonb not null check (pg_catalog.jsonb_typeof(rule_snapshot) = 'array'),
  due_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > due_at),
  status text not null check (status in (
    'pending','claimed','materialized','suppressed','canceled','source_dirty','failed'
  )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamptz,
  materialized_event_id uuid references dashboard_private.notification_events(id) on delete restrict,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint registration_observation_chat_jobs_source_kind_check
    check (
      (event_key = 'registration.observation_director_reassigned'
        and assignment_fact_id is not null
        and domain_event_id is null)
      or
      (event_key <> 'registration.observation_director_reassigned'
        and domain_event_id is not null
        and assignment_fact_id is null)
    ),
  check (
    source_revision = pg_catalog.jsonb_strip_nulls(source_revision)
    and dashboard_private.registration_observation_chat_source_revision_valid_v1(source_revision)
  ),
  check (current_booking_snapshot is null or pg_catalog.jsonb_typeof(current_booking_snapshot) = 'object'),
  check (previous_booking_snapshot is null or pg_catalog.jsonb_typeof(previous_booking_snapshot) = 'object'),
  check (preparation_snapshot is null or pg_catalog.jsonb_typeof(preparation_snapshot) = 'object'),
  check (submission_snapshot is null or pg_catalog.jsonb_typeof(submission_snapshot) = 'object'),
  check (dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    event_key,
    current_booking_snapshot,
    previous_booking_snapshot,
    preparation_snapshot,
    submission_snapshot,
    mention_role,
    mention_profile_ids
  )),
  check (
    reservation_snapshot_hash =
      dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
        event_key,
        current_booking_snapshot,
        previous_booking_snapshot
      )
  ),
  check (
    (status = 'pending'
      and next_attempt_at is not null
      and claim_token is null and claimed_by is null and lease_expires_at is null
      and materialized_event_id is null and last_error_code is null and completed_at is null)
    or (status = 'claimed'
      and next_attempt_at is null
      and claim_token is not null and claimed_by is not null and lease_expires_at is not null
      and materialized_event_id is null and last_error_code is null and completed_at is null)
    or (status = 'materialized'
      and next_attempt_at is null
      and claim_token is null and claimed_by is null and lease_expires_at is null
      and materialized_event_id is not null and last_error_code is null and completed_at is not null)
    or (status in ('suppressed','canceled','source_dirty','failed')
      and next_attempt_at is null
      and claim_token is null and claimed_by is null and lease_expires_at is null
      and materialized_event_id is null and last_error_code is not null and completed_at is not null)
  )
);

create unique index registration_observation_chat_jobs_domain_identity_idx
  on dashboard_private.registration_observation_chat_jobs(
    observation_id, notification_revision, event_key
  )
  where domain_event_id is not null;
create unique index registration_observation_chat_jobs_assignment_identity_idx
  on dashboard_private.registration_observation_chat_jobs(assignment_fact_id, event_key)
  where assignment_fact_id is not null;
create index registration_observation_chat_jobs_due_claim_idx
  on dashboard_private.registration_observation_chat_jobs(status, next_attempt_at, due_at, job_id)
  where status = 'pending';
create index registration_observation_chat_jobs_lease_idx
  on dashboard_private.registration_observation_chat_jobs(lease_expires_at, job_id)
  where status = 'claimed';
create index registration_observation_chat_jobs_observation_revision_idx
  on dashboard_private.registration_observation_chat_jobs(observation_id, notification_revision desc, created_at desc);
create index registration_observation_chat_jobs_terminal_idx
  on dashboard_private.registration_observation_chat_jobs(status, completed_at desc)
  where status in ('suppressed','canceled','source_dirty','failed');

alter table dashboard_private.registration_observation_chat_jobs enable row level security;
revoke all on table dashboard_private.registration_observation_chat_jobs
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.get_registration_observation_notification_source_impl_v1(
  p_observation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_task public.ops_tasks%rowtype;
  v_class_id uuid;
  v_class_name text;
  v_class_schedule_plan jsonb;
  v_class_schedule_storage_mode text;
  v_lesson public.class_lesson_sessions%rowtype;
  v_slot public.class_schedule_slots%rowtype;
  v_teacher public.teacher_catalogs%rowtype;
  v_classroom public.classroom_catalogs%rowtype;
  v_source_revision jsonb;
  v_booking_fact jsonb;
  v_booking_hash text;
  v_legacy_hash text;
  v_legacy_sessions jsonb;
  v_selected_session jsonb := '{}'::jsonb;
  v_seen_session_keys text[] := array[]::text[];
  v_session_row record;
  v_session_row_key text;
  v_selected_count integer := 0;
  v_slot_count integer;
  v_current_session_key text;
  v_current_schedule_state text;
  v_current_session_date date;
  v_current_starts_at timestamptz;
  v_current_ends_at timestamptz;
  v_current_teacher_catalog_id uuid;
  v_current_classroom_catalog_id uuid;
begin
  if p_observation_id is null then
    raise exception 'registration_observation_notification_source_missing'
      using errcode = 'P0002';
  end if;

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id;
  if not found then
    raise exception 'registration_observation_notification_source_missing'
      using errcode = 'P0002';
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_observation.appointment_id
    and appointment.task_id = v_observation.task_id;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_observation.track_id
    and track.task_id = v_observation.task_id
    and track.subject = v_observation.subject;
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_observation.task_id;
  select class.id, class.name, class.schedule_storage_mode
  into v_class_id, v_class_name, v_class_schedule_storage_mode
  from public.classes class
  where class.id = v_observation.class_id
    and class.subject = v_observation.subject;
  select teacher.*
  into v_teacher
  from public.teacher_catalogs teacher
  where teacher.id = v_observation.teacher_catalog_id;
  select classroom.*
  into v_classroom
  from public.classroom_catalogs classroom
  where classroom.id = v_observation.classroom_catalog_id;

  if v_appointment.id is null
    or v_track.id is null
    or v_task.id is null
    or v_class_id is null
    or v_teacher.id is null
    or v_classroom.id is null
  then
    raise exception 'registration_observation_notification_source_missing'
      using errcode = 'P0002';
  end if;

  if v_observation.status not in (
      'scheduled', 'attended_feedback_pending', 'completed', 'no_show', 'canceled'
    )
    or v_appointment.status not in ('scheduled', 'completed', 'canceled')
  then
    raise exception 'registration_observation_notification_source_dirty'
      using errcode = '55000';
  end if;

  if v_observation.session_authority = 'normalized' then
    if public.continuous_class_schedule_runtime_version() <> 1
      or v_class_schedule_storage_mode is distinct from 'normalized'
      or v_observation.class_lesson_session_id is null
      or v_observation.legacy_session_key is not null
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    select lesson.*
    into v_lesson
    from public.class_lesson_sessions lesson
    where lesson.id = v_observation.class_lesson_session_id
      and lesson.class_id = v_observation.class_id;
    if not found
      or v_lesson.schedule_state not in ('active', 'makeup')
      or v_lesson.schedule_state is distinct from
        v_observation.session_schedule_state
      or v_lesson.session_date is distinct from v_observation.session_date
      or ((v_lesson.session_date + v_lesson.start_time)
        at time zone 'Asia/Seoul') is distinct from v_observation.starts_at
      or ((v_lesson.session_date + v_lesson.end_time)
        at time zone 'Asia/Seoul') is distinct from v_observation.ends_at
      or v_lesson.teacher_catalog_id is distinct from v_observation.teacher_catalog_id
      or v_lesson.classroom_catalog_id is distinct from v_observation.classroom_catalog_id
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    v_source_revision := pg_catalog.jsonb_build_object(
      'authority', 'normalized',
      'sessionId', v_lesson.id,
      'revision', v_lesson.revision
    );
    v_current_session_key := v_lesson.session_key;
    v_current_schedule_state := v_lesson.schedule_state;
    v_current_session_date := v_lesson.session_date;
    v_current_starts_at := (v_lesson.session_date + v_lesson.start_time)
      at time zone 'Asia/Seoul';
    v_current_ends_at := (v_lesson.session_date + v_lesson.end_time)
      at time zone 'Asia/Seoul';
    v_current_teacher_catalog_id := v_lesson.teacher_catalog_id;
    v_current_classroom_catalog_id := v_lesson.classroom_catalog_id;
  elsif v_observation.session_authority = 'legacy' then
    if v_class_schedule_storage_mode not in ('legacy', 'shadow')
      or nullif(pg_catalog.btrim(v_observation.legacy_session_key), '') is null
      or v_observation.class_lesson_session_id is not null
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    select class.schedule_plan
    into v_class_schedule_plan
    from public.classes class
    where class.id = v_class_id
      and class.subject = v_observation.subject;
    if not found then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    v_legacy_sessions := case
      when pg_catalog.jsonb_typeof(v_class_schedule_plan -> 'sessions') = 'array'
        then v_class_schedule_plan -> 'sessions'
      when pg_catalog.jsonb_typeof(v_class_schedule_plan -> 'session_list') = 'array'
        then v_class_schedule_plan -> 'session_list'
      else '[]'::jsonb
    end;
    for v_session_row in
      select session.value
      from pg_catalog.jsonb_array_elements(v_legacy_sessions) session(value)
    loop
      v_session_row_key := coalesce(
        nullif(pg_catalog.btrim(v_session_row.value ->> 'sessionKey'), ''),
        nullif(pg_catalog.btrim(v_session_row.value ->> 'session_key'), ''),
        nullif(pg_catalog.btrim(v_session_row.value ->> 'id'), '')
      );
      if v_session_row_key is null
        or v_session_row_key = any(v_seen_session_keys)
      then
        raise exception 'registration_observation_notification_source_dirty'
          using errcode = '55000';
      end if;
      v_seen_session_keys := pg_catalog.array_append(
        v_seen_session_keys,
        v_session_row_key
      );
      if v_session_row_key = v_observation.legacy_session_key then
        v_selected_count := v_selected_count + 1;
        v_selected_session := v_session_row.value;
      end if;
    end loop;
    if v_selected_count <> 1 then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    begin
      v_current_session_date := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'date'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'sessionDate'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'session_date'), '')
      )::date;
      v_current_schedule_state := pg_catalog.lower(coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'scheduleState'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'schedule_state'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'state'), ''),
        'active'
      ));
      if v_current_schedule_state = 'normal' then
        v_current_schedule_state := 'active';
      end if;
      select pg_catalog.count(*)
      into v_slot_count
      from public.class_schedule_slots slot
      where slot.class_id = v_class_id
        and slot.weekday = extract(dow from v_current_session_date)::smallint;
      if v_slot_count <> 1 then
        raise exception 'registration_observation_notification_source_dirty'
          using errcode = '55000';
      end if;
      select slot.*
      into strict v_slot
      from public.class_schedule_slots slot
      where slot.class_id = v_class_id
        and slot.weekday = extract(dow from v_current_session_date)::smallint;
      v_current_teacher_catalog_id := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'teacherCatalogId'), '')::uuid,
        nullif(pg_catalog.btrim(v_selected_session ->> 'teacher_catalog_id'), '')::uuid,
        v_slot.teacher_catalog_id
      );
      v_current_classroom_catalog_id := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'classroomCatalogId'), '')::uuid,
        nullif(pg_catalog.btrim(v_selected_session ->> 'classroom_catalog_id'), '')::uuid,
        v_slot.classroom_catalog_id
      );
    exception
      when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow or no_data_found or too_many_rows then
        raise exception 'registration_observation_notification_source_dirty'
          using errcode = '55000';
    end;
    if v_current_session_date is null
      or v_current_schedule_state not in ('active', 'makeup')
      or v_slot.start_time is null
      or v_slot.end_time is null
      or v_slot.start_time >= v_slot.end_time
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    v_current_session_key := v_observation.legacy_session_key;
    v_current_starts_at := (v_current_session_date + v_slot.start_time)
      at time zone 'Asia/Seoul';
    v_current_ends_at := (v_current_session_date + v_slot.end_time)
      at time zone 'Asia/Seoul';
    if v_current_schedule_state is distinct from
        v_observation.session_schedule_state
      or v_current_session_date is distinct from v_observation.session_date
      or v_current_starts_at is distinct from v_observation.starts_at
      or v_current_ends_at is distinct from v_observation.ends_at
      or v_current_teacher_catalog_id is distinct from
        v_observation.teacher_catalog_id
      or v_current_classroom_catalog_id is distinct from
        v_observation.classroom_catalog_id
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode = '55000';
    end if;
    v_legacy_hash :=
      dashboard_private.registration_observation_legacy_session_content_hash_v1(
        v_class_schedule_plan,
        v_observation.legacy_session_key
      );
    v_source_revision := pg_catalog.jsonb_build_object(
      'authority', 'legacy',
      'sessionKey', v_observation.legacy_session_key,
      'contentHash', v_legacy_hash
    );
  else
    raise exception 'registration_observation_notification_source_dirty'
      using errcode = '55000';
  end if;

  if v_teacher.name is distinct from v_observation.teacher_name_snapshot
    or v_classroom.name is distinct from v_observation.classroom_name_snapshot
    or v_classroom.campus is distinct from v_observation.campus
    or v_class_name is distinct from v_observation.class_name_snapshot
  then
    raise exception 'registration_observation_notification_source_dirty'
      using errcode = '55000';
  end if;

  v_booking_fact := pg_catalog.jsonb_build_object(
    'classId', v_observation.class_id,
    'subject', v_observation.subject,
    'sessionAuthority', v_observation.session_authority,
    'classLessonSessionId', v_observation.class_lesson_session_id,
    'legacySessionKey', v_observation.legacy_session_key,
    'sessionKey', case
      when v_observation.session_authority = 'normalized' then v_lesson.session_key
      else v_current_session_key
    end,
    'scheduleState', v_current_schedule_state,
    'sessionDate', v_current_session_date,
    'startsAt', v_current_starts_at,
    'endsAt', v_current_ends_at,
    'teacherCatalogId', v_current_teacher_catalog_id,
    'teacherProfileId', v_teacher.profile_id,
    'teacherName', v_teacher.name,
    'classroomCatalogId', v_current_classroom_catalog_id,
    'classroomName', v_classroom.name,
    'campus', v_classroom.campus
  );
  v_booking_hash :=
    dashboard_private.registration_observation_booking_fact_hash_v1(v_booking_fact);
  if v_booking_hash is distinct from v_observation.booking_fact_hash then
    raise exception 'registration_observation_notification_source_dirty'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'observationId', v_observation.id,
    'appointmentId', v_appointment.id,
    'taskId', v_task.id,
    'trackId', v_track.id,
    'notificationRevision', v_appointment.notification_revision,
    'observationStatus', v_observation.status,
    'appointmentStatus', v_appointment.status,
    'hasFeedback', v_observation.feedback_revision > 0,
    'studentName', v_task.student_name,
    'subject', v_track.subject,
    'classId', v_class_id,
    'className', v_class_name,
    'sessionAuthority', v_observation.session_authority,
    'classLessonSessionId', v_observation.class_lesson_session_id,
    'legacySessionKey', v_observation.legacy_session_key,
    'scheduleState', v_current_schedule_state,
    'startsAt', v_current_starts_at,
    'endsAt', v_current_ends_at,
    'teacherCatalogId', v_teacher.id,
    'teacherProfileId', v_teacher.profile_id,
    'teacherName', v_teacher.name,
    'classroomCatalogId', v_classroom.id,
    'classroomName', v_classroom.name,
    'campus', v_classroom.campus,
    'sourceRevision', v_source_revision,
    'bookingFactHash', v_booking_hash,
    'directorProfileId', v_track.director_profile_id
  );
end;
$$;

create or replace function public.get_registration_observation_notification_source_v1(
  p_observation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_notification_source_forbidden'
      using errcode = '42501';
  end if;
  return dashboard_private.get_registration_observation_notification_source_impl_v1(
    p_observation_id
  );
end;
$$;

create or replace function dashboard_private.registration_observation_chat_preparation_snapshot_v1(
  p_textbooks jsonb,
  p_progress text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_names jsonb;
  v_plan_progress text;
  v_fallback_progress text;
begin
  if pg_catalog.jsonb_typeof(p_textbooks) is distinct from 'array' then
    raise exception 'registration_observation_chat_preparation_invalid'
      using errcode='22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(item.title order by item.ordinality),
    '["미지정"]'::jsonb
  ) into v_names
  from (
    select source.ordinality,coalesce(
      nullif(pg_catalog.btrim(source.value ->> 'title'),''),
      case when pg_catalog.jsonb_typeof(source.value)='string'
        then nullif(pg_catalog.btrim(source.value #>> '{}'),'') end,
      '교재 ' || source.ordinality::text
    ) as title
    from pg_catalog.jsonb_array_elements(p_textbooks)
      with ordinality source(value,ordinality)
  ) item;
  select nullif(pg_catalog.string_agg(component.value,' · '
    order by item.ordinality,component.priority),'')
  into v_plan_progress
  from pg_catalog.jsonb_array_elements(p_textbooks)
    with ordinality item(value,ordinality)
  cross join lateral (
    values
      (1,nullif(pg_catalog.btrim(item.value ->> 'planLabel'),'')),
      (2,nullif(pg_catalog.btrim(item.value ->> 'memo'),''))
  ) component(priority,value)
  where component.value is not null;
  v_fallback_progress := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
    coalesce(p_progress,''),'^[[:space:]]*진도:[[:space:]]*','','i'
  )), '');
  return pg_catalog.jsonb_build_object(
    'textbookNames',v_names,
    'progressSummary',coalesce(v_plan_progress,v_fallback_progress,'미입력')
  );
end;
$$;

create or replace function dashboard_private.registration_observation_chat_current_preparation_v1(
  p_observation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_observation public.ops_registration_observations%rowtype;
  v_schedule_plan jsonb;
  v_storage_mode text;
  v_lesson public.class_lesson_sessions%rowtype;
  v_sessions jsonb;
  v_selected_session jsonb := '{}'::jsonb;
  v_selected_count integer := 0;
  v_session_key text;
  v_textbook_entries jsonb;
  v_textbooks jsonb;
  v_progress_value text;
  v_progress text;
begin
  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id;
  if not found then
    raise exception 'registration_observation_notification_source_missing'
      using errcode = 'P0002';
  end if;
  select class.schedule_plan,class.schedule_storage_mode
  into v_schedule_plan,v_storage_mode
  from public.classes class
  where class.id=v_observation.class_id
    and class.subject=v_observation.subject;
  if not found then
    raise exception 'registration_observation_notification_source_dirty'
      using errcode='55000';
  end if;
  if v_observation.session_authority='normalized' then
    if v_storage_mode is distinct from 'normalized'
      or public.continuous_class_schedule_runtime_version() <> 1
      or v_observation.class_lesson_session_id is null
      or v_observation.legacy_session_key is not null
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode='55000';
    end if;
    select lesson.* into v_lesson
    from public.class_lesson_sessions lesson
    where lesson.id=v_observation.class_lesson_session_id
      and lesson.class_id=v_observation.class_id
      and lesson.schedule_state in ('active','makeup');
    if not found or nullif(pg_catalog.btrim(v_lesson.session_key),'') is null then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode='55000';
    end if;
    v_session_key := v_lesson.session_key;
  elsif v_observation.session_authority='legacy' then
    if v_storage_mode not in ('legacy','shadow')
      or v_observation.class_lesson_session_id is not null
      or nullif(pg_catalog.btrim(v_observation.legacy_session_key),'') is null
    then
      raise exception 'registration_observation_notification_source_dirty'
        using errcode='55000';
    end if;
    v_session_key := v_observation.legacy_session_key;
  else
    raise exception 'registration_observation_notification_source_dirty'
      using errcode='55000';
  end if;
  v_sessions := case
    when pg_catalog.jsonb_typeof(v_schedule_plan -> 'sessions')='array'
      then v_schedule_plan -> 'sessions'
    when pg_catalog.jsonb_typeof(v_schedule_plan -> 'session_list')='array'
      then v_schedule_plan -> 'session_list'
    else '[]'::jsonb
  end;
  select pg_catalog.count(*),coalesce(
    (pg_catalog.array_agg(session.value))[1],'{}'::jsonb
  )
  into v_selected_count,v_selected_session
  from pg_catalog.jsonb_array_elements(v_sessions) session(value)
  where coalesce(
    nullif(pg_catalog.btrim(session.value ->> 'sessionKey'),''),
    nullif(pg_catalog.btrim(session.value ->> 'session_key'),''),
    nullif(pg_catalog.btrim(session.value ->> 'id'),'')
  )=v_session_key;
  if v_selected_count > 1
    or (v_observation.session_authority='legacy' and v_selected_count <> 1)
  then
    raise exception 'registration_observation_notification_source_dirty'
      using errcode='55000';
  end if;
  v_textbook_entries := case
    when pg_catalog.jsonb_typeof(v_selected_session -> 'textbookEntries')='array'
      then v_selected_session -> 'textbookEntries'
    else '[]'::jsonb
  end;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'textbookId',nullif(pg_catalog.btrim(entry.value ->> 'textbookId'),''),
        'title',coalesce(
          nullif(pg_catalog.btrim(book.value ->> 'title'),''),
          nullif(pg_catalog.btrim(book.value ->> 'name'),''),
          nullif(pg_catalog.btrim(entry.value ->> 'textbookTitle'),''),
          '교재 ' || entry.ordinality::text
        ),
        'planLabel',coalesce(
          nullif(pg_catalog.btrim(entry.value -> 'plan' ->> 'label'),''),
          nullif(pg_catalog.btrim(entry.value ->> 'planLabel'),''),''
        ),
        'memo',coalesce(
          nullif(pg_catalog.btrim(entry.value -> 'plan' ->> 'memo'),''),
          nullif(pg_catalog.btrim(entry.value ->> 'memo'),''),''
        )
      ) order by entry.ordinality
    ),'[]'::jsonb
  ) into v_textbooks
  from pg_catalog.jsonb_array_elements(v_textbook_entries)
    with ordinality entry(value,ordinality)
  left join lateral (
    select textbook.value
    from pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(v_schedule_plan -> 'textbooks')='array'
        then v_schedule_plan -> 'textbooks'
      else '[]'::jsonb end) textbook(value)
    where nullif(pg_catalog.btrim(textbook.value ->> 'textbookId'),'')=
      nullif(pg_catalog.btrim(entry.value ->> 'textbookId'),'')
    limit 1
  ) book on true;
  select nullif(pg_catalog.btrim(coalesce(
    nullif(progress.range_label,''),nullif(progress.content,''),
    nullif(progress.public_note,'')
  )),'')
  into v_progress_value
  from public.progress_logs progress
  where progress.class_id=v_observation.class_id
    and progress.session_id in (
      v_session_key,
      coalesce(v_observation.class_lesson_session_id::text,v_session_key)
    )
  order by progress.updated_at desc nulls last,progress.id desc
  limit 1;
  if v_progress_value is null then
    v_progress_value := case
      when v_observation.session_authority='normalized' then coalesce(
        nullif(pg_catalog.btrim(v_lesson.public_note),''),
        nullif(pg_catalog.btrim(v_lesson.memo),'')
      )
      else coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'publicNote'),''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'public_note'),''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'memo'),'')
      )
    end;
  end if;
  v_progress := case when v_progress_value is null then '진도: 미입력'
    else '진도: ' || v_progress_value end;
  return dashboard_private.registration_observation_chat_preparation_snapshot_v1(
    v_textbooks,v_progress
  );
end;
$$;

create or replace function dashboard_private.registration_observation_chat_source_eligible_v1(
  p_event_key text,
  p_source jsonb,
  p_decision_is_null boolean
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_event_key
    when 'registration.observation_scheduled' then
      p_source ->> 'observationStatus' = 'scheduled'
      and p_source ->> 'appointmentStatus' = 'scheduled'
    when 'registration.observation_rescheduled' then
      p_source ->> 'observationStatus' = 'scheduled'
      and p_source ->> 'appointmentStatus' = 'scheduled'
    when 'registration.observation_reminder_due' then
      p_source ->> 'observationStatus' = 'scheduled'
      and p_source ->> 'appointmentStatus' = 'scheduled'
    when 'registration.observation_canceled' then
      p_source ->> 'observationStatus' = 'canceled'
      and p_source ->> 'appointmentStatus' = 'canceled'
    when 'registration.observation_feedback_due' then
      p_source ->> 'observationStatus' in (
        'scheduled', 'attended_feedback_pending'
      )
      and p_source ->> 'appointmentStatus' in ('scheduled', 'completed')
      and coalesce((p_source ->> 'hasFeedback')::boolean, false) = false
    when 'registration.observation_feedback_submitted' then
      p_source ->> 'observationStatus' = 'completed'
      and p_source ->> 'appointmentStatus' = 'completed'
      and coalesce((p_source ->> 'hasFeedback')::boolean, false) = true
    when 'registration.observation_director_reassigned' then
      p_source ->> 'observationStatus' in (
        'scheduled', 'attended_feedback_pending', 'completed'
      )
      and p_source ->> 'appointmentStatus' in ('scheduled', 'completed')
      and p_decision_is_null = true
    else false
  end;
$$;

create or replace function dashboard_private.registration_observation_chat_rule_snapshot_v1(
  p_event_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rule_id', rule.id,
        'rule_revision', rule.revision::text,
        'template_id', rule.active_template_id,
        'channel_key', rule.channel_key,
        'audience_key', rule.audience_key,
        'rule_variant_key', rule.rule_variant_key,
        'enabled', rule.enabled
      ) order by rule.id
    ),
    '[]'::jsonb
  )
  from (
    select rule.*
    from dashboard_private.notification_rules rule
    where rule.scope_key = 'global'
      and rule.workflow_key = 'registration'
      and rule.event_key = p_event_key
    order by rule.id
    for share
  ) rule;
$$;

create or replace function dashboard_private.registration_observation_chat_delivery_contract_valid_v1(
  p_event_key text,
  p_rule_snapshot jsonb,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_rule_scope_key text,
  p_rule_workflow_key text,
  p_rule_event_key text,
  p_rule_channel_key text,
  p_rule_audience_key text,
  p_rule_variant_key text,
  p_rule_template_id uuid,
  p_rule_enabled boolean,
  p_delivery_channel_key text,
  p_delivery_audience_key text,
  p_delivery_template_id uuid
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_rule_snapshot) is distinct from 'array'
      then false
    else coalesce(
      p_event_key is not null
      and p_rule_id is not null
      and p_rule_revision > 0
      and p_rule_scope_key = 'global'
      and p_rule_workflow_key = 'registration'
      and p_rule_event_key = p_event_key
      and p_rule_channel_key = p_delivery_channel_key
      and p_rule_audience_key = p_delivery_audience_key
      and p_rule_template_id = p_delivery_template_id
      and p_rule_enabled
      and (
        (
          p_delivery_channel_key = 'google_chat'
          and (
            (
              p_event_key in (
                'registration.observation_scheduled',
                'registration.observation_rescheduled',
                'registration.observation_canceled',
                'registration.observation_reminder_due',
                'registration.observation_feedback_due'
              )
              and p_delivery_audience_key = 'subject_team'
            )
            or (
              p_event_key in (
                'registration.observation_feedback_submitted',
                'registration.observation_director_reassigned'
              )
              and p_delivery_audience_key = 'management_team'
            )
          )
        )
        or (
          p_delivery_channel_key = 'in_app'
          and p_event_key = 'registration.observation_feedback_submitted'
          and p_delivery_audience_key = 'track_director'
        )
      )
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_rule_snapshot) snapshot(item)
        where snapshot.item is not distinct from pg_catalog.jsonb_build_object(
          'rule_id', p_rule_id,
          'rule_revision', p_rule_revision::text,
          'template_id', p_rule_template_id,
          'channel_key', p_rule_channel_key,
          'audience_key', p_rule_audience_key,
          'rule_variant_key', p_rule_variant_key,
          'enabled', p_rule_enabled
        )
      ),
      false
    )
  end;
$$;

create or replace function dashboard_private.registration_observation_chat_booking_snapshot_v1(
  p_observation_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'classId', source ->> 'classId',
    'className', source ->> 'className',
    'sessionAuthority', source ->> 'sessionAuthority',
    'classLessonSessionId', source ->> 'classLessonSessionId',
    'legacySessionKey', source ->> 'legacySessionKey',
    'scheduleState', source ->> 'scheduleState',
    'startsAt', source ->> 'startsAt',
    'endsAt', source ->> 'endsAt',
    'teacherCatalogId', source ->> 'teacherCatalogId',
    'teacherProfileId', source ->> 'teacherProfileId',
    'teacherName', source ->> 'teacherName',
    'classroomCatalogId', source ->> 'classroomCatalogId',
    'classroomName', source ->> 'classroomName',
    'campus', source ->> 'campus'
  )
  from (
    select dashboard_private.get_registration_observation_notification_source_impl_v1(
      p_observation_id
    ) as source
  ) source_row;
$$;

create or replace function dashboard_private.insert_registration_observation_chat_job_v1(
  p_domain_event_id uuid,
  p_assignment_fact_id uuid,
  p_observation_id uuid,
  p_appointment_id uuid,
  p_notification_revision integer,
  p_event_key text,
  p_source_revision jsonb,
  p_booking_fact_hash text,
  p_current_booking jsonb,
  p_previous_booking jsonb,
  p_preparation jsonb,
  p_submission jsonb,
  p_mention_role text,
  p_mention_profile_ids uuid[],
  p_due_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_rules jsonb;
  v_enabled boolean;
  v_job_id uuid;
begin
  v_rules := dashboard_private.registration_observation_chat_rule_snapshot_v1(
    p_event_key
  );
  if pg_catalog.jsonb_array_length(v_rules) = 0 then
    raise exception 'registration_observation_chat_rule_missing'
      using errcode = '55000';
  end if;
  select coalesce(pg_catalog.bool_or((item ->> 'enabled')::boolean), false)
  into v_enabled
  from pg_catalog.jsonb_array_elements(v_rules) item;

  insert into dashboard_private.registration_observation_chat_jobs(
    domain_event_id,
    assignment_fact_id,
    observation_id,
    appointment_id,
    notification_revision,
    event_key,
    source_revision,
    booking_fact_hash,
    reservation_snapshot_hash,
    current_booking_snapshot,
    previous_booking_snapshot,
    preparation_snapshot,
    submission_snapshot,
    mention_role,
    mention_profile_ids,
    rule_snapshot,
    due_at,
    expires_at,
    status,
    next_attempt_at,
    last_error_code,
    completed_at
  ) values (
    p_domain_event_id,
    p_assignment_fact_id,
    p_observation_id,
    p_appointment_id,
    p_notification_revision,
    p_event_key,
    p_source_revision,
    p_booking_fact_hash,
    dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
      p_event_key,
      p_current_booking,
      p_previous_booking
    ),
    p_current_booking,
    p_previous_booking,
    p_preparation,
    p_submission,
    p_mention_role,
    dashboard_private.google_chat_canonical_uuid_array_v1(p_mention_profile_ids),
    v_rules,
    p_due_at,
    p_expires_at,
    case when v_enabled then 'pending' else 'suppressed' end,
    case when v_enabled then p_due_at else null end,
    case when v_enabled then null else 'rule_disabled_at_source' end,
    case when v_enabled then null else pg_catalog.clock_timestamp() end
  )
  on conflict do nothing
  returning job_id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function dashboard_private.materialize_registration_observation_chat_from_domain_event_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source jsonb;
  v_current_booking jsonb;
  v_previous_booking jsonb;
  v_preparation jsonb;
  v_submission jsonb;
  v_mention_ids uuid[];
  v_teacher_fact dashboard_private.notification_assignment_change_facts%rowtype;
  v_event_key text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if tg_op <> 'INSERT'
    or tg_table_schema <> 'dashboard_private'
    or tg_table_name <> 'registration_observation_domain_events'
  then
    raise exception 'registration_observation_chat_trigger_invalid'
      using errcode = '55000';
  end if;

  v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
    new.observation_id
  );
  if (v_source ->> 'appointmentId')::uuid is distinct from new.appointment_id
    or (v_source ->> 'notificationRevision')::integer is distinct from
      new.notification_revision
    or v_source -> 'sourceRevision' is distinct from new.source_revision
    or v_source ->> 'bookingFactHash' is distinct from new.booking_fact_hash
  then
    raise exception 'registration_observation_chat_domain_source_mismatch'
      using errcode = '40001';
  end if;

  perform job.job_id
  from dashboard_private.registration_observation_chat_jobs job
  where job.observation_id = new.observation_id
  order by job.notification_revision, job.event_key, job.job_id
  for update;

  v_current_booking :=
    dashboard_private.registration_observation_chat_booking_snapshot_v1(
      new.observation_id
    );
  v_starts_at := (v_source ->> 'startsAt')::timestamptz;
  v_ends_at := (v_source ->> 'endsAt')::timestamptz;
  select dashboard_private.registration_observation_chat_preparation_snapshot_v1(
    observation.textbook_snapshot,observation.progress_snapshot
  ) into v_preparation
  from public.ops_registration_observations observation
  where observation.id=new.observation_id;
  v_mention_ids := case
    when nullif(v_source ->> 'teacherProfileId', '') is null then array[]::uuid[]
    else array[(v_source ->> 'teacherProfileId')::uuid]
  end;

  if new.event_kind = 'observation_scheduled' then
    perform dashboard_private.insert_registration_observation_chat_job_v1(
      new.event_id, null, new.observation_id, new.appointment_id,
      new.notification_revision, 'registration.observation_scheduled',
      new.source_revision, new.booking_fact_hash, v_current_booking, null,
      v_preparation, null, 'subject_teacher', v_mention_ids,
      new.occurred_at, new.occurred_at + interval '24 hours'
    );
    if v_starts_at - new.occurred_at >= interval '3 hours' then
      perform dashboard_private.insert_registration_observation_chat_job_v1(
        new.event_id, null, new.observation_id, new.appointment_id,
        new.notification_revision, 'registration.observation_reminder_due',
        new.source_revision, new.booking_fact_hash, v_current_booking, null,
        v_preparation, null, 'subject_teacher', v_mention_ids,
        v_starts_at - interval '3 hours', v_starts_at
      );
    end if;
    perform dashboard_private.insert_registration_observation_chat_job_v1(
      new.event_id, null, new.observation_id, new.appointment_id,
      new.notification_revision, 'registration.observation_feedback_due',
      new.source_revision, new.booking_fact_hash, v_current_booking, null,
      null, null, 'subject_teacher', v_mention_ids,
      v_ends_at + interval '30 minutes', v_ends_at + interval '24 hours'
    );
  elsif new.event_kind = 'observation_rescheduled' then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled',
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        last_error_code = 'superseded_by_reschedule',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.observation_id = new.observation_id
      and job.notification_revision < new.notification_revision
      and job.event_key in (
        'registration.observation_reminder_due',
        'registration.observation_feedback_due'
      )
      and job.status in ('pending', 'claimed');
    select job.current_booking_snapshot
    into v_previous_booking
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id = new.observation_id
      and job.notification_revision < new.notification_revision
    order by job.notification_revision desc, job.created_at desc, job.job_id desc
    limit 1;
    if v_previous_booking is null then
      raise exception 'registration_observation_chat_previous_snapshot_missing'
        using errcode = '55000';
    end if;
    select fact.*
    into v_teacher_fact
    from dashboard_private.notification_assignment_change_facts fact
    where fact.workflow_key = 'registration'
      and fact.source_type = 'registration_observation'
      and fact.source_id = new.observation_id::text
      and fact.source_revision = new.notification_revision
      and fact.role_key = 'subject_teacher'
    for share;
    if found then
      if v_teacher_fact.context_entity_id is distinct from
          (v_source ->> 'trackId')::uuid
        or v_teacher_fact.previous_profile_ids is distinct from
          dashboard_private.google_chat_canonical_uuid_array_v1(
            array[
              nullif(v_previous_booking ->> 'teacherProfileId', '')::uuid
            ]::uuid[]
          )
        or v_teacher_fact.current_profile_ids is distinct from
          dashboard_private.google_chat_canonical_uuid_array_v1(
            array[
              nullif(v_current_booking ->> 'teacherProfileId', '')::uuid
            ]::uuid[]
          )
      then
        raise exception 'registration_observation_chat_teacher_change_mismatch'
          using errcode = '40001';
      end if;
      v_mention_ids := dashboard_private.google_chat_canonical_uuid_array_v1(
        v_teacher_fact.previous_profile_ids || v_teacher_fact.current_profile_ids
      );
    else
      v_mention_ids := dashboard_private.google_chat_canonical_uuid_array_v1(
        array[
          nullif(v_current_booking ->> 'teacherProfileId', '')::uuid
        ]::uuid[]
      );
    end if;
    perform dashboard_private.insert_registration_observation_chat_job_v1(
      new.event_id, null, new.observation_id, new.appointment_id,
      new.notification_revision, 'registration.observation_rescheduled',
      new.source_revision, new.booking_fact_hash, v_current_booking,
      v_previous_booking, v_preparation, null, 'subject_teacher', v_mention_ids,
      new.occurred_at, new.occurred_at + interval '24 hours'
    );
    if v_starts_at - new.occurred_at >= interval '3 hours' then
      perform dashboard_private.insert_registration_observation_chat_job_v1(
        new.event_id, null, new.observation_id, new.appointment_id,
        new.notification_revision, 'registration.observation_reminder_due',
        new.source_revision, new.booking_fact_hash, v_current_booking, null,
        v_preparation, null, 'subject_teacher',
        array[nullif(v_current_booking ->> 'teacherProfileId', '')::uuid],
        v_starts_at - interval '3 hours', v_starts_at
      );
    end if;
    perform dashboard_private.insert_registration_observation_chat_job_v1(
      new.event_id, null, new.observation_id, new.appointment_id,
      new.notification_revision, 'registration.observation_feedback_due',
      new.source_revision, new.booking_fact_hash, v_current_booking, null,
      null, null, 'subject_teacher',
      array[nullif(v_current_booking ->> 'teacherProfileId', '')::uuid],
      v_ends_at + interval '30 minutes', v_ends_at + interval '24 hours'
    );
  elsif new.event_kind = 'observation_canceled' then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled', next_attempt_at = null, claimed_by = null,
        claim_token = null, lease_expires_at = null,
        last_error_code = 'observation_canceled',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.observation_id = new.observation_id
      and job.status in ('pending', 'claimed');
    perform dashboard_private.insert_registration_observation_chat_job_v1(
      new.event_id, null, new.observation_id, new.appointment_id,
      new.notification_revision, 'registration.observation_canceled',
      new.source_revision, new.booking_fact_hash, v_current_booking, null,
      null, null, 'subject_teacher', v_mention_ids,
      new.occurred_at, new.occurred_at + interval '24 hours'
    );
  elsif new.event_kind = 'observation_attendance_recorded' then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled', next_attempt_at = null, claimed_by = null,
        claim_token = null, lease_expires_at = null,
        last_error_code = 'attendance_recorded',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.observation_id = new.observation_id
      and job.notification_revision = new.notification_revision
      and job.event_key = 'registration.observation_reminder_due'
      and job.status in ('pending', 'claimed');
  elsif new.event_kind = 'observation_no_show' then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled', next_attempt_at = null, claimed_by = null,
        claim_token = null, lease_expires_at = null,
        last_error_code = 'observation_no_show',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.observation_id = new.observation_id
      and job.notification_revision = new.notification_revision
      and job.event_key in (
        'registration.observation_reminder_due',
        'registration.observation_feedback_due'
      )
      and job.status in ('pending', 'claimed');
  elsif new.event_kind = 'observation_feedback_submitted' then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled', next_attempt_at = null, claimed_by = null,
        claim_token = null, lease_expires_at = null,
        last_error_code = 'feedback_submitted',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.observation_id = new.observation_id
      and job.notification_revision = new.notification_revision
      and job.event_key in (
        'registration.observation_reminder_due',
        'registration.observation_feedback_due'
      )
      and job.status in ('pending', 'claimed');
    select pg_catalog.jsonb_build_object(
      'submittedByName', profile.name,
      'submittedAt', observation.feedback_submitted_at
    )
    into v_submission
    from public.ops_registration_observations observation
    join public.profiles profile on profile.id = observation.feedback_submitted_by
    where observation.id = new.observation_id;
    if v_submission is null then
      raise exception 'registration_observation_chat_submission_missing'
        using errcode = '55000';
    end if;
    v_mention_ids := case
      when nullif(v_source ->> 'directorProfileId', '') is null then array[]::uuid[]
      else array[(v_source ->> 'directorProfileId')::uuid]
    end;
    perform dashboard_private.insert_registration_observation_chat_job_v1(
      new.event_id, null, new.observation_id, new.appointment_id,
      new.notification_revision, 'registration.observation_feedback_submitted',
      new.source_revision, new.booking_fact_hash, v_current_booking, null,
      null, v_submission, 'track_director', v_mention_ids,
      new.occurred_at, new.occurred_at + interval '24 hours'
    );
  end if;
  return new;
end;
$$;

create or replace function dashboard_private.materialize_registration_observation_chat_from_assignment_fact_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_source_event public.ops_task_events%rowtype;
  v_event_payload jsonb;
  v_event_metadata jsonb;
  v_previous_director uuid;
  v_current_director uuid;
  v_source jsonb;
  v_current_booking jsonb;
begin
  if tg_op <> 'INSERT'
    or tg_table_schema <> 'dashboard_private'
    or tg_table_name <> 'notification_assignment_change_facts'
  then
    raise exception 'registration_observation_chat_trigger_invalid'
      using errcode = '55000';
  end if;
  if new.workflow_key <> 'registration'
    or new.source_type <> 'registration_track_event'
    or new.role_key <> 'track_director'
  then
    return new;
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = new.context_entity_id
    and new.current_profile_ids =
      dashboard_private.google_chat_canonical_uuid_array_v1(
        array[track.director_profile_id]
      )
  for share;
  if not found then
    return new;
  end if;

  begin
    select event_row.*
    into v_source_event
    from public.ops_task_events event_row
    where event_row.id = new.source_id::uuid
      and event_row.task_id = v_track.task_id
      and event_row.event_type = 'registration_track_event'
    for share;
    if not found then
      return new;
    end if;
    v_event_payload := v_source_event.after_value::jsonb;
    v_event_metadata := v_event_payload -> 'metadata';
    if pg_catalog.jsonb_typeof(v_event_payload) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_event_payload -> 'version')
        is distinct from 'number'
      or (v_event_payload ->> 'version')::numeric <> 2::numeric
      or v_event_payload ->> 'event_type' is null
      or v_event_payload ->> 'event_type' not in (
        'director_default_resolved',
        'director_manual_override',
        'director_default_cleared'
      )
      or (v_event_payload ->> 'track_id')::uuid <> v_track.id
      or pg_catalog.jsonb_typeof(v_event_metadata) is distinct from 'object'
    then
      return new;
    end if;
    v_previous_director :=
      nullif(v_event_metadata ->> 'previousDirectorProfileId', '')::uuid;
    v_current_director :=
      nullif(v_event_metadata ->> 'directorProfileId', '')::uuid;
    if new.previous_profile_ids is distinct from
        dashboard_private.google_chat_canonical_uuid_array_v1(
          array[v_previous_director]
        )
      or new.current_profile_ids is distinct from
        dashboard_private.google_chat_canonical_uuid_array_v1(
          array[v_current_director]
        )
    then
      return new;
    end if;
  exception
    when data_exception then
      return new;
  end;

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  join public.ops_registration_appointments appointment
    on appointment.id = observation.appointment_id
  where observation.track_id = new.context_entity_id
    and observation.decision_kind is null
    and observation.status in ('scheduled', 'attended_feedback_pending', 'completed')
    and appointment.status in ('scheduled', 'completed')
  order by observation.created_at desc, observation.id desc
  limit 1
  for share of observation;
  if not found then
    return new;
  end if;
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_observation.appointment_id
    and appointment.task_id = v_observation.task_id
    and appointment.status in ('scheduled', 'completed')
  for share;
  if not found then
    return new;
  end if;
  v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
    v_observation.id
  );
  v_current_booking :=
    dashboard_private.registration_observation_chat_booking_snapshot_v1(
      v_observation.id
    );
  perform dashboard_private.insert_registration_observation_chat_job_v1(
    null, new.fact_id, v_observation.id, v_observation.appointment_id,
    (v_source ->> 'notificationRevision')::integer,
    'registration.observation_director_reassigned',
    v_source -> 'sourceRevision', v_source ->> 'bookingFactHash',
    v_current_booking, null, null, null, 'track_director',
    dashboard_private.google_chat_canonical_uuid_array_v1(
      new.previous_profile_ids || new.current_profile_ids
    ),
    new.occurred_at, new.occurred_at + interval '24 hours'
  );
  return new;
end;
$$;

create trigger registration_observation_google_chat_materializer
after insert on dashboard_private.registration_observation_domain_events
for each row execute function dashboard_private.materialize_registration_observation_chat_from_domain_event_v1();

create trigger registration_observation_google_chat_assignment_materializer
after insert on dashboard_private.notification_assignment_change_facts
for each row execute function dashboard_private.materialize_registration_observation_chat_from_assignment_fact_v1();

do $seed_collision_gate$
begin
  if exists (
      select 1
      from dashboard_private.notification_settings_ui_registry registry
      where registry.rule_id between
          '81000000-0000-4000-8000-000000000001'::uuid and
          '81000000-0000-4000-8000-000000000008'::uuid
        or (
          registry.workflow_key = 'registration'
          and registry.rule_variant_key = 'immediate'
          and (registry.event_key,registry.audience_key,registry.channel_key) in (
            ('registration.observation_scheduled','subject_team','google_chat'),
            ('registration.observation_rescheduled','subject_team','google_chat'),
            ('registration.observation_canceled','subject_team','google_chat'),
            ('registration.observation_reminder_due','subject_team','google_chat'),
            ('registration.observation_feedback_due','subject_team','google_chat'),
            ('registration.observation_feedback_submitted','management_team','google_chat'),
            ('registration.observation_feedback_submitted','track_director','in_app'),
            ('registration.observation_director_reassigned','management_team','google_chat')
          )
        )
    )
    or exists (
      select 1
      from dashboard_private.notification_rules rule
      where rule.id between
          '81000000-0000-4000-8000-000000000001'::uuid and
          '81000000-0000-4000-8000-000000000008'::uuid
        or (
          rule.scope_key = 'global'
          and rule.workflow_key = 'registration'
          and rule.rule_variant_key = 'immediate'
          and (rule.event_key,rule.audience_key,rule.channel_key) in (
            ('registration.observation_scheduled','subject_team','google_chat'),
            ('registration.observation_rescheduled','subject_team','google_chat'),
            ('registration.observation_canceled','subject_team','google_chat'),
            ('registration.observation_reminder_due','subject_team','google_chat'),
            ('registration.observation_feedback_due','subject_team','google_chat'),
            ('registration.observation_feedback_submitted','management_team','google_chat'),
            ('registration.observation_feedback_submitted','track_director','in_app'),
            ('registration.observation_director_reassigned','management_team','google_chat')
          )
        )
    )
    or exists (
      select 1
      from dashboard_private.notification_templates template
      where template.id between
          '82000000-0000-4000-8000-000000000001'::uuid and
          '82000000-0000-4000-8000-000000000008'::uuid
        or (
          template.rule_id between
            '81000000-0000-4000-8000-000000000001'::uuid and
            '81000000-0000-4000-8000-000000000008'::uuid
          and template.version = 1
        )
    )
    or exists (
      select 1
      from dashboard_private.notification_rule_content_contracts contract
      where contract.rule_id between
          '81000000-0000-4000-8000-000000000001'::uuid and
          '81000000-0000-4000-8000-000000000008'::uuid
        or (
          contract.workflow_key = 'registration'
          and contract.rule_variant_key = 'immediate'
          and (contract.event_key,contract.audience_key,contract.channel_key) in (
            ('registration.observation_scheduled','subject_team','google_chat'),
            ('registration.observation_rescheduled','subject_team','google_chat'),
            ('registration.observation_canceled','subject_team','google_chat'),
            ('registration.observation_reminder_due','subject_team','google_chat'),
            ('registration.observation_feedback_due','subject_team','google_chat'),
            ('registration.observation_feedback_submitted','management_team','google_chat'),
            ('registration.observation_feedback_submitted','track_director','in_app'),
            ('registration.observation_director_reassigned','management_team','google_chat')
          )
        )
    )
    or exists (
      select 1
      from dashboard_private.notification_rule_mention_settings setting
      where setting.rule_id between
        '81000000-0000-4000-8000-000000000001'::uuid and
        '81000000-0000-4000-8000-000000000008'::uuid
    )
  then
    raise exception 'registration_observation_google_chat_seed_collision'
      using errcode = '55000';
  end if;
end
$seed_collision_gate$;

set constraints all deferred;

with seed(
  rule_id, template_id, event_key, audience_key, channel_key,
  event_label, trigger_description, event_sort, cell_sort
) as (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, '82000000-0000-4000-8000-000000000001'::uuid, 'registration.observation_scheduled'::text, 'subject_team'::text, 'google_chat'::text, '청강 예약'::text, '청강 일정이 처음 예약되었을 때'::text, 201, 1),
    ('81000000-0000-4000-8000-000000000002'::uuid, '82000000-0000-4000-8000-000000000002'::uuid, 'registration.observation_rescheduled'::text, 'subject_team'::text, 'google_chat'::text, '청강 일정 변경'::text, '청강 일정이 변경되었을 때'::text, 202, 1),
    ('81000000-0000-4000-8000-000000000003'::uuid, '82000000-0000-4000-8000-000000000003'::uuid, 'registration.observation_canceled'::text, 'subject_team'::text, 'google_chat'::text, '청강 취소'::text, '청강 예약이 취소되었을 때'::text, 203, 1),
    ('81000000-0000-4000-8000-000000000004'::uuid, '82000000-0000-4000-8000-000000000004'::uuid, 'registration.observation_reminder_due'::text, 'subject_team'::text, 'google_chat'::text, '오늘 청강 준비'::text, '청강 3시간 전 준비가 필요할 때'::text, 204, 1),
    ('81000000-0000-4000-8000-000000000005'::uuid, '82000000-0000-4000-8000-000000000005'::uuid, 'registration.observation_feedback_due'::text, 'subject_team'::text, 'google_chat'::text, '청강 피드백 요청'::text, '청강 종료 30분 뒤 피드백이 필요할 때'::text, 205, 1),
    ('81000000-0000-4000-8000-000000000006'::uuid, '82000000-0000-4000-8000-000000000006'::uuid, 'registration.observation_feedback_submitted'::text, 'management_team'::text, 'google_chat'::text, '청강 피드백 등록'::text, '청강 피드백이 등록되었을 때'::text, 206, 1),
    ('81000000-0000-4000-8000-000000000007'::uuid, '82000000-0000-4000-8000-000000000007'::uuid, 'registration.observation_feedback_submitted'::text, 'track_director'::text, 'in_app'::text, '청강 피드백 등록'::text, '청강 피드백이 등록되었을 때'::text, 206, 2),
    ('81000000-0000-4000-8000-000000000008'::uuid, '82000000-0000-4000-8000-000000000008'::uuid, 'registration.observation_director_reassigned'::text, 'management_team'::text, 'google_chat'::text, '청강 담당 원장 변경'::text, '청강 담당 원장이 변경되었을 때'::text, 207, 1)
)
insert into dashboard_private.notification_settings_ui_registry(
  rule_id, workflow_key, workflow_label, workflow_sort,
  event_key, event_label, group_label, trigger_description, event_sort,
  audience_key, audience_label, channel_key, channel_label, cell_sort,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  initial_enabled, source_trigger_kind, configuration_kind, activation_locked
)
select
  seed.rule_id, 'registration', '등록', 3,
  seed.event_key, seed.event_label, '청강', seed.trigger_description, seed.event_sort,
  seed.audience_key,
  case seed.audience_key
    when 'subject_team' then '과목팀'
    when 'track_director' then '담당 원장'
    else '관리팀'
  end,
  seed.channel_key,
  case seed.channel_key when 'in_app' then '대시보드' else 'Google Chat' end,
  seed.cell_sort, 'immediate', 'immediate', null, null, false,
  case when seed.event_key = 'registration.observation_director_reassigned'
    then 'notification_assignment_change_fact'
    else 'registration_observation_domain_event'
  end,
  'editable_rule', false
from seed;

with seed(rule_id, template_id, event_key, audience_key, channel_key) as (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, '82000000-0000-4000-8000-000000000001'::uuid, 'registration.observation_scheduled'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000002'::uuid, '82000000-0000-4000-8000-000000000002'::uuid, 'registration.observation_rescheduled'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000003'::uuid, '82000000-0000-4000-8000-000000000003'::uuid, 'registration.observation_canceled'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000004'::uuid, '82000000-0000-4000-8000-000000000004'::uuid, 'registration.observation_reminder_due'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000005'::uuid, '82000000-0000-4000-8000-000000000005'::uuid, 'registration.observation_feedback_due'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000006'::uuid, '82000000-0000-4000-8000-000000000006'::uuid, 'registration.observation_feedback_submitted'::text, 'management_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000007'::uuid, '82000000-0000-4000-8000-000000000007'::uuid, 'registration.observation_feedback_submitted'::text, 'track_director'::text, 'in_app'::text),
    ('81000000-0000-4000-8000-000000000008'::uuid, '82000000-0000-4000-8000-000000000008'::uuid, 'registration.observation_director_reassigned'::text, 'management_team'::text, 'google_chat'::text)
)
insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
select
  seed.rule_id, 'global', 'registration', seed.event_key,
  seed.channel_key, seed.audience_key, 'immediate', 'immediate', null, null,
  false, seed.template_id, 1, null, 'system', null, 'system'
from seed;

with seed(
  rule_id, template_id, event_key, title_template, body_template, allowed_variables
) as (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, '82000000-0000-4000-8000-000000000001'::uuid, 'registration.observation_scheduled'::text,
      '[청강 예약] {학생}'::text,
      E'학생: {학생}\n과목/수업: [{과목}] {수업}\n일시: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}\n교재: {교재}\n진도: {진도}\n교재 복사 등 청강 준비가 필요합니다.'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"},{"key":"textbooks","token":"교재","pii_class":"none"},{"key":"progress","token":"진도","pii_class":"none"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000002'::uuid, '82000000-0000-4000-8000-000000000002'::uuid, 'registration.observation_rescheduled'::text,
      '[청강 일정 변경] {학생}'::text,
      E'학생: {학생}\n과목/수업: [{과목}] {수업}\n이전 일정: {기존일정}\n변경 일정: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}\n교재: {교재}\n진도: {진도}\n변경된 일정에 맞춰 청강 준비가 필요합니다.'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"before_schedule","token":"기존일정","pii_class":"schedule"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"},{"key":"textbooks","token":"교재","pii_class":"none"},{"key":"progress","token":"진도","pii_class":"none"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000003'::uuid, '82000000-0000-4000-8000-000000000003'::uuid, 'registration.observation_canceled'::text,
      '[청강 취소] {학생}'::text,
      E'학생: {학생}\n과목/수업: [{과목}] {수업}\n취소 일정: {일정}\n청강 예약이 취소되었습니다.'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000004'::uuid, '82000000-0000-4000-8000-000000000004'::uuid, 'registration.observation_reminder_due'::text,
      '[오늘 청강 준비] {학생}'::text,
      E'오늘 청강이 예정되어 있습니다.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n일시: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}\n교재: {교재}\n진도: {진도}\n교재 복사 등 준비 내용을 확인해 주세요.'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"},{"key":"textbooks","token":"교재","pii_class":"none"},{"key":"progress","token":"진도","pii_class":"none"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000005'::uuid, '82000000-0000-4000-8000-000000000005'::uuid, 'registration.observation_feedback_due'::text,
      '[청강 피드백 요청] {학생}'::text,
      E'청강은 어땠나요? 적합 여부와 사유를 입력해 주세요.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n수업 일시: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000006'::uuid, '82000000-0000-4000-8000-000000000006'::uuid, 'registration.observation_feedback_submitted'::text,
      '[청강 피드백 등록] {학생}'::text,
      E'청강 피드백이 등록되었습니다.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n제출자: {제출자}\n제출시각: {제출시각}'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"submitted_by_name","token":"제출자","pii_class":"staff_name"},{"key":"submitted_at","token":"제출시각","pii_class":"schedule"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000007'::uuid, '82000000-0000-4000-8000-000000000007'::uuid, 'registration.observation_feedback_submitted'::text,
      '[청강 피드백 등록] {학생}'::text,
      E'청강 피드백이 등록되었습니다.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n제출자: {제출자}\n제출시각: {제출시각}'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"submitted_by_name","token":"제출자","pii_class":"staff_name"},{"key":"submitted_at","token":"제출시각","pii_class":"schedule"}]'::jsonb),
    ('81000000-0000-4000-8000-000000000008'::uuid, '82000000-0000-4000-8000-000000000008'::uuid, 'registration.observation_director_reassigned'::text,
      '[청강 담당 원장 변경] {학생}'::text,
      E'학생: {학생}\n과목/수업: [{과목}] {수업}\n담당 원장이 변경되었습니다.'::text,
      '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"}]'::jsonb)
)
insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind,
  content_contract_version
)
select
  seed.template_id, seed.rule_id, 1, seed.title_template, seed.body_template,
  seed.allowed_variables, 3,
  dashboard_private.notification_seed_template_checksum_v1(
    seed.title_template, seed.body_template, seed.allowed_variables, 3
  ),
  null, 'system', '1'
from seed;

with seed(rule_id, event_key, audience_key, channel_key) as (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, 'registration.observation_scheduled'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000002'::uuid, 'registration.observation_rescheduled'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000003'::uuid, 'registration.observation_canceled'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000004'::uuid, 'registration.observation_reminder_due'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000005'::uuid, 'registration.observation_feedback_due'::text, 'subject_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000006'::uuid, 'registration.observation_feedback_submitted'::text, 'management_team'::text, 'google_chat'::text),
    ('81000000-0000-4000-8000-000000000007'::uuid, 'registration.observation_feedback_submitted'::text, 'track_director'::text, 'in_app'::text),
    ('81000000-0000-4000-8000-000000000008'::uuid, 'registration.observation_director_reassigned'::text, 'management_team'::text, 'google_chat'::text)
), contract_rows as (
  select
    seed.*,
    template.allowed_variables,
    case seed.event_key
      when 'registration.observation_scheduled' then '["학생","과목","수업","일정","담당선생님","강의실","교재","진도"]'::jsonb
      when 'registration.observation_rescheduled' then '["학생","과목","수업","기존일정","일정","담당선생님","강의실","교재","진도"]'::jsonb
      when 'registration.observation_canceled' then '["학생","과목","수업","일정"]'::jsonb
      when 'registration.observation_reminder_due' then '["학생","과목","수업","일정","담당선생님","강의실","교재","진도"]'::jsonb
      when 'registration.observation_feedback_due' then '["학생","과목","수업","일정","담당선생님","강의실"]'::jsonb
      when 'registration.observation_feedback_submitted' then '["학생","과목","수업","제출자","제출시각"]'::jsonb
      else '["학생","과목","수업"]'::jsonb
    end as required_tokens,
    case seed.event_key
      when 'registration.observation_rescheduled' then '["target","event","before_after","schedule","location"]'::jsonb
      when 'registration.observation_canceled' then '["target","event","current_state","schedule"]'::jsonb
      when 'registration.observation_feedback_submitted' then '["target","event","progress_actor","schedule"]'::jsonb
      when 'registration.observation_director_reassigned' then '["target","event","current_state"]'::jsonb
      else '["target","event","schedule","location"]'::jsonb
    end as must_have_facts
  from seed
  join dashboard_private.notification_templates template
    on template.rule_id = seed.rule_id and template.version = 1
), normalized as (
  select
    contract_rows.*,
    coalesce(
      (select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'key', item ->> 'key',
          'token', item ->> 'token',
          'piiClass', item ->> 'pii_class'
        ) order by ordinality
       ) from pg_catalog.jsonb_array_elements(contract_rows.allowed_variables)
         with ordinality variable(item, ordinality)),
      '[]'::jsonb
    ) as available_variables,
    coalesce(
      (select pg_catalog.jsonb_object_agg(
        item ->> 'key',
        pg_catalog.jsonb_build_object(
          'required', true,
          'nullBehavior', 'reject',
          'nullDisplay', null,
          'emptyArrayBehavior', 'reject'
        )
      ) from pg_catalog.jsonb_array_elements(contract_rows.allowed_variables) item),
      '{}'::jsonb
    ) as field_presence
  from contract_rows
)
insert into dashboard_private.notification_rule_content_contracts(
  rule_id, workflow_key, event_key, audience_key, channel_key,
  rule_variant_key, contract_version, contract_json
)
select
  normalized.rule_id, 'registration', normalized.event_key,
  normalized.audience_key, normalized.channel_key, 'immediate', '1',
  pg_catalog.jsonb_build_object(
    'contractVersion', '1',
    'availableVariables', normalized.available_variables,
    'requiredTokens', normalized.required_tokens,
    'optionalLineTokens', '[]'::jsonb,
    'mustHaveFacts', normalized.must_have_facts,
    'supportedPayloadVersions', '[3]'::jsonb,
    'destinationPolicy', pg_catalog.jsonb_build_object(
      'allowedConnectionKeys', case
        when normalized.channel_key = 'in_app' then '[]'::jsonb
        when normalized.audience_key = 'subject_team'
          then '["google_chat.english","google_chat.math","google_chat.science"]'::jsonb
        else '["google_chat.management"]'::jsonb
      end,
      'subjectScoped', normalized.audience_key = 'subject_team'
    ),
    'freeTextVisibility', '{}'::jsonb,
    'freeTextPriority', '[]'::jsonb,
    'fieldPresence', normalized.field_presence
  )
from normalized;

insert into dashboard_private.notification_rule_mention_settings(
  rule_id, mention_enabled, revision, updated_by
)
values
  ('81000000-0000-4000-8000-000000000001', true, 1, null),
  ('81000000-0000-4000-8000-000000000002', true, 1, null),
  ('81000000-0000-4000-8000-000000000003', false, 1, null),
  ('81000000-0000-4000-8000-000000000004', true, 1, null),
  ('81000000-0000-4000-8000-000000000005', true, 1, null),
  ('81000000-0000-4000-8000-000000000006', true, 1, null),
  ('81000000-0000-4000-8000-000000000008', true, 1, null);

do $seed_assertions$
begin
  if (select pg_catalog.count(*)
      from dashboard_private.notification_settings_ui_registry registry
      where registry.rule_id between
        '81000000-0000-4000-8000-000000000001'::uuid and
        '81000000-0000-4000-8000-000000000008'::uuid) <> 8
    or (select pg_catalog.count(*)
        from dashboard_private.notification_rules rule
        where rule.id between
          '81000000-0000-4000-8000-000000000001'::uuid and
          '81000000-0000-4000-8000-000000000008'::uuid) <> 8
    or (select pg_catalog.count(*)
        from dashboard_private.notification_rules rule
        where rule.id between
          '81000000-0000-4000-8000-000000000001'::uuid and
          '81000000-0000-4000-8000-000000000008'::uuid
          and rule.enabled) <> 0
    or (select pg_catalog.count(*)
        from dashboard_private.notification_rule_mention_settings setting
        where setting.rule_id between
          '81000000-0000-4000-8000-000000000001'::uuid and
          '81000000-0000-4000-8000-000000000008'::uuid) <> 7
  then
    raise exception 'registration_observation_google_chat_seed_invalid'
      using errcode = '55000';
  end if;
end
$seed_assertions$;

set constraints all immediate;

create or replace function public.claim_registration_observation_chat_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
)
returns setof jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_source jsonb;
  v_current_rules jsonb;
  v_claim_token uuid;
  v_now timestamptz;
  v_decision_is_null boolean;
  v_source_error text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or pg_catalog.octet_length(p_worker_id) > 128
    or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_batch_size is null
    or p_batch_size not between 1 and 100
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 300
  then
    raise exception 'registration_observation_chat_claim_invalid'
      using errcode = '22023';
  end if;
  v_now := pg_catalog.clock_timestamp();

  for v_job in
    select job.*
    from dashboard_private.registration_observation_chat_jobs job
    where job.status = 'pending'
      and job.next_attempt_at <= v_now
      and job.due_at <= v_now
    order by job.next_attempt_at, job.due_at, job.job_id
    for update skip locked
    limit p_batch_size
  loop
    begin
      v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
        v_job.observation_id
      );
    exception
      when sqlstate '55000' or sqlstate 'P0002' then
        get stacked diagnostics v_source_error = message_text;
        update dashboard_private.registration_observation_chat_jobs job
        set status = case
              when v_source_error =
                'registration_observation_notification_source_dirty'
                then 'source_dirty'
              else 'canceled'
            end,
            next_attempt_at = null,
            last_error_code = case
              when v_source_error =
                'registration_observation_notification_source_dirty'
                then 'source_schedule_changed'
              else 'source_status_changed'
            end,
            completed_at = v_now,
            updated_at = v_now
        where job.job_id = v_job.job_id;
        continue;
    end;
    select observation.decision_kind is null
    into v_decision_is_null
    from public.ops_registration_observations observation
    where observation.id = v_job.observation_id;
    v_current_rules := dashboard_private.registration_observation_chat_rule_snapshot_v1(
      v_job.event_key
    );

    if v_job.expires_at <= v_now then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'canceled', next_attempt_at = null,
          last_error_code = 'notification_window_closed',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      continue;
    elsif not dashboard_private.registration_observation_chat_source_eligible_v1(
        v_job.event_key,
        v_source,
        v_decision_is_null
      ) then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'canceled', next_attempt_at = null,
          last_error_code = 'source_status_changed',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      continue;
    elsif (v_source ->> 'notificationRevision')::integer
        is distinct from v_job.notification_revision then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'canceled', next_attempt_at = null,
          last_error_code = 'source_revision_changed',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      continue;
    elsif v_source ->> 'bookingFactHash' is distinct from v_job.booking_fact_hash then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'source_dirty', next_attempt_at = null,
          last_error_code = 'source_schedule_changed',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      continue;
    elsif v_current_rules is distinct from v_job.rule_snapshot then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'suppressed', next_attempt_at = null,
          last_error_code = 'rule_revision_changed',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      continue;
    elsif not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_current_rules) item
      where (item ->> 'enabled')::boolean
    ) then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'suppressed', next_attempt_at = null,
          last_error_code = 'rule_disabled_at_claim',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      continue;
    end if;

    v_claim_token := pg_catalog.gen_random_uuid();
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'claimed',
        attempt_count = job.attempt_count + 1,
        next_attempt_at = null,
        claimed_by = p_worker_id,
        claim_token = v_claim_token,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = v_now
    where job.job_id = v_job.job_id
    returning job.* into v_job;

    return next pg_catalog.jsonb_build_object(
      'job_id', v_job.job_id,
      'claim_token', v_job.claim_token,
      'observation_id', v_job.observation_id,
      'appointment_id', v_job.appointment_id,
      'assignment_fact_id', v_job.assignment_fact_id,
      'notification_revision', v_job.notification_revision,
      'event_key', v_job.event_key,
      'due_at', v_job.due_at,
      'expires_at', v_job.expires_at,
      'attempt_count', v_job.attempt_count,
      'source_revision', v_job.source_revision,
      'booking_fact_hash', v_job.booking_fact_hash,
      'reservation_snapshot_hash', v_job.reservation_snapshot_hash,
      'current_booking_snapshot', v_job.current_booking_snapshot,
      'previous_booking_snapshot', v_job.previous_booking_snapshot,
      'preparation_snapshot', v_job.preparation_snapshot,
      'submission_snapshot', v_job.submission_snapshot,
      'mention_role', v_job.mention_role,
      'mention_profile_ids', v_job.mention_profile_ids,
      'rule_snapshot', v_job.rule_snapshot
    );
  end loop;
  return;
end;
$$;

create or replace function public.finish_registration_observation_chat_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_disposition text,
  p_error_code text,
  p_next_attempt_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_now timestamptz;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if p_job_id is null or p_claim_token is null
    or p_disposition is null
    or p_disposition not in ('retry','failed','canceled','source_dirty','suppressed')
    or nullif(pg_catalog.btrim(p_error_code), '') is null
    or pg_catalog.octet_length(p_error_code) > 96
    or (p_disposition = 'failed' and p_error_code not in (
      'payload_schema_unsupported',
      'render_validation_failed',
      'max_attempts_exhausted',
      'worker_lost_after_claim'
    ))
    or (p_disposition = 'canceled' and p_error_code not in (
      'source_status_changed',
      'source_revision_changed',
      'notification_window_closed'
    ))
    or (p_disposition = 'source_dirty'
      and p_error_code <> 'source_schedule_changed')
    or (p_disposition = 'suppressed' and p_error_code not in (
      'rule_disabled_at_source',
      'rule_revision_changed'
    ))
  then
    raise exception 'registration_observation_chat_finish_invalid'
      using errcode = '22023';
  end if;
  v_now := pg_catalog.clock_timestamp();
  select job.*
  into v_job
  from dashboard_private.registration_observation_chat_jobs job
  where job.job_id = p_job_id
  for update;
  if not found
    or v_job.status <> 'claimed'
    or v_job.claim_token is distinct from p_claim_token
  then
    raise exception 'registration_observation_chat_claim_mismatch'
      using errcode = '40001';
  end if;

  if p_disposition = 'retry' then
    if p_error_code not in (
        'provider_rate_limited',
        'transient_pre_dispatch_failure',
        'connection_restored_manual_retry'
      )
      or p_next_attempt_at is null
      or p_next_attempt_at <= v_now
      or p_next_attempt_at >= v_job.expires_at
      or v_job.attempt_count >= 5
    then
      raise exception 'registration_observation_chat_retry_invalid'
        using errcode = '22023';
    end if;
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'pending', next_attempt_at = p_next_attempt_at,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = null, completed_at = null, updated_at = v_now
    where job.job_id = p_job_id
    returning job.* into v_job;
  else
    if p_next_attempt_at is not null then
      raise exception 'registration_observation_chat_finish_invalid'
        using errcode = '22023';
    end if;
    update dashboard_private.registration_observation_chat_jobs job
    set status = p_disposition, next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = p_error_code, completed_at = v_now, updated_at = v_now
    where job.job_id = p_job_id
    returning job.* into v_job;
  end if;

  return pg_catalog.jsonb_build_object(
    'job_id', v_job.job_id,
    'status', v_job.status,
    'attempt_count', v_job.attempt_count,
    'next_attempt_at', v_job.next_attempt_at,
    'last_error_code', v_job.last_error_code
  );
end;
$$;

create or replace function public.reap_registration_observation_chat_job_leases_v1(
  p_worker_id text,
  p_batch_size integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_now timestamptz;
  v_reaped integer := 0;
  v_failed integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or pg_catalog.octet_length(p_worker_id) > 128
    or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_batch_size is null
    or p_batch_size not between 1 and 100
  then
    raise exception 'registration_observation_chat_reap_invalid'
      using errcode = '22023';
  end if;
  v_now := pg_catalog.clock_timestamp();
  for v_job in
    select job.*
    from dashboard_private.registration_observation_chat_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at <= v_now
    order by job.lease_expires_at, job.job_id
    for update skip locked
    limit p_batch_size
  loop
    if v_job.attempt_count < 5 and v_now + interval '30 seconds' < v_job.expires_at then
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'pending', next_attempt_at = v_now + interval '30 seconds',
          claimed_by = null, claim_token = null, lease_expires_at = null,
          last_error_code = null, completed_at = null, updated_at = v_now
      where job.job_id = v_job.job_id;
      v_reaped := v_reaped + 1;
    else
      update dashboard_private.registration_observation_chat_jobs job
      set status = 'failed', next_attempt_at = null,
          claimed_by = null, claim_token = null, lease_expires_at = null,
          last_error_code = 'worker_lost_after_claim',
          completed_at = v_now, updated_at = v_now
      where job.job_id = v_job.job_id;
      v_failed := v_failed + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'reaped_count', v_reaped,
    'failed_count', v_failed
  );
end;
$$;

create or replace function public.materialize_registration_observation_chat_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_payload_schema_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_source jsonb;
  v_current_rules jsonb;
  v_receipt jsonb;
  v_event dashboard_private.notification_events%rowtype;
  v_fanout_job_id uuid;
  v_now timestamptz;
  v_source_type text;
  v_source_id text;
  v_source_revision bigint;
  v_occurrence_key text;
  v_expected_booking jsonb;
  v_expected_previous_booking jsonb;
  v_event_occurred_at timestamptz;
  v_assignment dashboard_private.notification_assignment_change_facts%rowtype;
  v_decision_is_null boolean;
  v_source_error text;
  v_current_textbook_names jsonb;
  v_current_progress_summary text;
  v_current_preparation jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if p_job_id is null or p_claim_token is null
    or p_payload_schema_version is distinct from 3
    or p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.octet_length(p_payload::text) > 65536
    or not dashboard_private.registration_observation_chat_payload_valid_v3(
      p_payload
    )
  then
    raise exception 'registration_observation_chat_payload_invalid'
      using errcode = '22023';
  end if;
  v_now := pg_catalog.clock_timestamp();
  select job.*
  into v_job
  from dashboard_private.registration_observation_chat_jobs job
  where job.job_id = p_job_id
  for update;
  if not found then
    raise exception 'registration_observation_chat_claim_mismatch'
      using errcode = '40001';
  end if;
  -- A worker can lose the first successful RPC response after the event and
  -- fanout rows commit. The terminal job no longer owns a live claim token, so
  -- replay is fenced by service-role access plus the exact immutable payload,
  -- source identity and stored rule snapshot instead of reopening the job.
  if v_job.status = 'materialized' then
    select event_row.*
    into v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_job.materialized_event_id;
    if not found
      or v_event.scope_key <> 'global'
      or v_event.workflow_key <> 'registration'
      or v_event.event_key is distinct from v_job.event_key
      or v_event.payload_schema_version <> 3
      or v_event.payload is distinct from p_payload
      or v_event.rule_snapshot is distinct from v_job.rule_snapshot
      or (
        v_job.assignment_fact_id is null
        and (
          v_event.source_type <> 'registration_observation'
          or v_event.source_id <> v_job.observation_id::text
          or v_event.source_revision is distinct from
            v_job.notification_revision::bigint
        )
      )
      or (
        v_job.assignment_fact_id is not null
        and (
          v_event.source_type <>
            'registration_observation_assignment_change'
          or v_event.source_id <> v_job.assignment_fact_id::text
          or v_event.source_revision is not null
        )
      )
    then
      raise exception 'registration_observation_chat_payload_mismatch'
        using errcode = '22023';
    end if;
    select fanout.id
    into v_fanout_job_id
    from dashboard_private.notification_event_fanout_jobs fanout
    where fanout.event_id = v_event.id;
    if not found then
      raise exception 'registration_observation_chat_materialize_stale'
        using errcode = '40001';
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'materialized',
      'event_id', v_event.id,
      'fanout_job_id', v_fanout_job_id
    );
  end if;
  if v_job.status <> 'claimed'
    or v_job.claim_token is distinct from p_claim_token
    or v_job.lease_expires_at <= v_now
    or p_payload ->> 'event_kind' is distinct from v_job.event_key
  then
    raise exception 'registration_observation_chat_claim_mismatch'
      using errcode = '40001';
  end if;
  begin
    v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
      v_job.observation_id
    );
    if v_job.event_key = 'registration.observation_reminder_due' then
      v_current_preparation :=
        dashboard_private.registration_observation_chat_current_preparation_v1(
          v_job.observation_id
        );
    end if;
  exception
    when sqlstate '55000' or sqlstate 'P0002' then
      get stacked diagnostics v_source_error = message_text;
      update dashboard_private.registration_observation_chat_jobs job
      set status = case
            when v_source_error =
              'registration_observation_notification_source_dirty'
              then 'source_dirty'
            else 'canceled'
          end,
          next_attempt_at = null,
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          last_error_code = case
            when v_source_error =
              'registration_observation_notification_source_dirty'
              then 'source_schedule_changed'
            else 'source_status_changed'
          end,
          completed_at = v_now,
          updated_at = v_now
      where job.job_id = v_job.job_id;
      return pg_catalog.jsonb_build_object(
        'outcome', case
          when v_source_error =
            'registration_observation_notification_source_dirty'
            then 'source_dirty'
          else 'canceled'
        end,
        'error_code', case
          when v_source_error =
            'registration_observation_notification_source_dirty'
            then 'source_schedule_changed'
          else 'source_status_changed'
        end
      );
  end;
  select observation.decision_kind is null
  into v_decision_is_null
  from public.ops_registration_observations observation
  where observation.id = v_job.observation_id;
  if v_job.event_key = 'registration.observation_reminder_due' then
    v_current_textbook_names := v_current_preparation -> 'textbookNames';
    v_current_progress_summary := v_current_preparation ->> 'progressSummary';
  else
    select
      coalesce(observation.textbook_snapshot, '[]'::jsonb),
      observation.progress_snapshot
    into v_current_textbook_names, v_current_progress_summary
    from public.ops_registration_observations observation
    where observation.id = v_job.observation_id;
  end if;
  if not dashboard_private.registration_observation_chat_source_eligible_v1(
      v_job.event_key,
      v_source,
      v_decision_is_null
    )
  then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled', next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'source_status_changed',
        completed_at = v_now, updated_at = v_now
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'outcome', 'canceled',
      'error_code', 'source_status_changed'
    );
  end if;
  v_expected_booking := pg_catalog.jsonb_build_object(
    'class_id', v_job.current_booking_snapshot ->> 'classId',
    'class_name', v_job.current_booking_snapshot ->> 'className',
    'session_authority', v_job.current_booking_snapshot ->> 'sessionAuthority',
    'class_lesson_session_id', v_job.current_booking_snapshot ->> 'classLessonSessionId',
    'legacy_session_key', v_job.current_booking_snapshot ->> 'legacySessionKey',
    'schedule_state', v_job.current_booking_snapshot ->> 'scheduleState',
    'starts_at', v_job.current_booking_snapshot ->> 'startsAt',
    'ends_at', v_job.current_booking_snapshot ->> 'endsAt',
    'teacher_name', v_job.current_booking_snapshot ->> 'teacherName',
    'classroom_name', v_job.current_booking_snapshot ->> 'classroomName',
    'campus', v_job.current_booking_snapshot ->> 'campus'
  );
  if v_job.previous_booking_snapshot is not null then
    v_expected_previous_booking := pg_catalog.jsonb_build_object(
      'class_id', v_job.previous_booking_snapshot ->> 'classId',
      'class_name', v_job.previous_booking_snapshot ->> 'className',
      'session_authority', v_job.previous_booking_snapshot ->> 'sessionAuthority',
      'class_lesson_session_id', v_job.previous_booking_snapshot ->> 'classLessonSessionId',
      'legacy_session_key', v_job.previous_booking_snapshot ->> 'legacySessionKey',
      'schedule_state', v_job.previous_booking_snapshot ->> 'scheduleState',
      'starts_at', v_job.previous_booking_snapshot ->> 'startsAt',
      'ends_at', v_job.previous_booking_snapshot ->> 'endsAt',
      'teacher_name', v_job.previous_booking_snapshot ->> 'teacherName',
      'classroom_name', v_job.previous_booking_snapshot ->> 'classroomName',
      'campus', v_job.previous_booking_snapshot ->> 'campus'
    );
  end if;
  if v_job.domain_event_id is not null then
    select event_row.occurred_at
    into v_event_occurred_at
    from dashboard_private.registration_observation_domain_events event_row
    where event_row.event_id = v_job.domain_event_id;
  else
    select fact.*
    into v_assignment
    from dashboard_private.notification_assignment_change_facts fact
    where fact.fact_id = v_job.assignment_fact_id;
    v_event_occurred_at := v_assignment.occurred_at;
  end if;
  if (p_payload ->> 'task_id')::uuid is distinct from
      (v_source ->> 'taskId')::uuid
    or (p_payload ->> 'track_id')::uuid is distinct from
      (v_source ->> 'trackId')::uuid
    or (p_payload ->> 'observation_id')::uuid is distinct from v_job.observation_id
    or (p_payload ->> 'appointment_id')::uuid is distinct from v_job.appointment_id
    or (p_payload ->> 'appointment_notification_revision')::integer
      is distinct from v_job.notification_revision
    or p_payload ->> 'student_name' is distinct from v_source ->> 'studentName'
    or p_payload ->> 'subject' is distinct from v_source ->> 'subject'
    or p_payload -> 'source_revision' is distinct from
      v_source -> 'sourceRevision'
    or p_payload ->> 'booking_fact_hash' is distinct from v_job.booking_fact_hash
    or (p_payload ->> 'occurred_at')::timestamptz
      is distinct from v_event_occurred_at
    or (p_payload ->> 'delivery_expires_at')::timestamptz
      is distinct from v_job.expires_at
    or p_payload ->> 'mention_role' is distinct from v_job.mention_role
    or p_payload -> 'mention_profile_ids' is distinct from
      pg_catalog.to_jsonb(v_job.mention_profile_ids)
  then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  if v_job.event_key = 'registration.observation_canceled' then
    if p_payload -> 'canceled_booking' is distinct from v_expected_booking then
      raise exception 'registration_observation_chat_payload_mismatch'
        using errcode = '22023';
    end if;
  elsif p_payload -> 'booking' is distinct from v_expected_booking then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  if v_job.event_key = 'registration.observation_rescheduled'
    and p_payload -> 'previous_booking' is distinct from v_expected_previous_booking
  then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  if v_job.event_key in (
      'registration.observation_scheduled',
      'registration.observation_rescheduled'
    ) and (
      p_payload -> 'textbook_names' is distinct from
        v_job.preparation_snapshot -> 'textbookNames'
      or p_payload ->> 'progress_summary' is distinct from
        v_job.preparation_snapshot ->> 'progressSummary'
    )
  then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  if v_job.event_key = 'registration.observation_reminder_due'
    and (
      p_payload -> 'textbook_names' is distinct from
        v_current_textbook_names
      or p_payload ->> 'progress_summary' is distinct from
        v_current_progress_summary
    )
  then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  if v_job.event_key = 'registration.observation_feedback_submitted'
    and (
      p_payload ->> 'submitted_by_name' is distinct from
        v_job.submission_snapshot ->> 'submittedByName'
      or (p_payload ->> 'submitted_at')::timestamptz is distinct from
        (v_job.submission_snapshot ->> 'submittedAt')::timestamptz
    )
  then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  if v_job.event_key = 'registration.observation_director_reassigned'
    and (
      (p_payload ->> 'assignment_fact_id')::uuid is distinct from
        v_job.assignment_fact_id
      or p_payload -> 'previous_director_profile_ids' is distinct from
        pg_catalog.to_jsonb(v_assignment.previous_profile_ids)
      or p_payload -> 'director_profile_ids' is distinct from
        pg_catalog.to_jsonb(v_assignment.current_profile_ids)
    )
  then
    raise exception 'registration_observation_chat_payload_mismatch'
      using errcode = '22023';
  end if;
  v_current_rules := dashboard_private.registration_observation_chat_rule_snapshot_v1(
    v_job.event_key
  );
  if (v_source ->> 'notificationRevision')::integer
      is distinct from v_job.notification_revision
  then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'canceled', next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'source_revision_changed',
        completed_at = v_now, updated_at = v_now
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'outcome', 'canceled',
      'error_code', 'source_revision_changed'
    );
  elsif v_source ->> 'bookingFactHash' is distinct from v_job.booking_fact_hash then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'source_dirty', next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'source_schedule_changed',
        completed_at = v_now, updated_at = v_now
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'outcome', 'source_dirty',
      'error_code', 'source_schedule_changed'
    );
  elsif v_current_rules is distinct from v_job.rule_snapshot then
    update dashboard_private.registration_observation_chat_jobs job
    set status = 'suppressed', next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'rule_revision_changed',
        completed_at = v_now, updated_at = v_now
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'outcome', 'suppressed',
      'error_code', 'rule_revision_changed'
    );
  end if;

  perform rule.id
  from dashboard_private.notification_rules rule
  join pg_catalog.jsonb_array_elements(v_job.rule_snapshot) snapshot
    on (snapshot ->> 'rule_id')::uuid = rule.id
  order by rule.id
  for share of rule;

  if v_job.assignment_fact_id is null then
    v_source_type := 'registration_observation';
    v_source_id := v_job.observation_id::text;
    v_source_revision := v_job.notification_revision::bigint;
    v_occurrence_key := 'registration:observation:' || v_job.observation_id::text
      || ':notification_revision:' || v_job.notification_revision::text
      || ':event:' || pg_catalog.replace(
        v_job.event_key, 'registration.observation_', ''
      );
  else
    v_source_type := 'registration_observation_assignment_change';
    v_source_id := v_job.assignment_fact_id::text;
    v_source_revision := null;
    v_occurrence_key := 'registration:observation:' || v_job.observation_id::text
      || ':director_assignment:' || v_job.assignment_fact_id::text;
  end if;

  v_receipt := dashboard_private.record_notification_event_v1(
    'global',
    'registration',
    v_job.event_key,
    v_source_type,
    v_source_id,
    v_source_revision,
    v_occurrence_key,
    null,
    v_job.due_at,
    3,
    p_payload,
    null,
    null
  );
  select event_row.*
  into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = (v_receipt ->> 'event_id')::uuid;
  if v_event.rule_snapshot is distinct from v_job.rule_snapshot then
    raise exception 'registration_observation_chat_rule_snapshot_mismatch'
      using errcode = '40001';
  end if;
  update dashboard_private.registration_observation_chat_jobs job
  set status = 'materialized', materialized_event_id = v_event.id,
      next_attempt_at = null, claimed_by = null, claim_token = null,
      lease_expires_at = null, last_error_code = null,
      completed_at = v_now, updated_at = v_now
  where job.job_id = v_job.job_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'materialized',
    'event_id', v_event.id,
    'fanout_job_id', v_receipt -> 'fanout_job_id'
  );
end;
$$;

create or replace function public.read_registration_observation_notification_delivery_frozen_state_v1(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_registered_attempts bigint;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if p_delivery_id is null or p_claim_token is null then
    raise exception 'registration_observation_delivery_frozen_state_invalid'
      using errcode = '22023';
  end if;

  select delivery.*
  into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if not found
    or v_delivery.status <> 'claimed'
    or v_delivery.claim_token is distinct from p_claim_token
    or v_delivery.lease_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception 'registration_observation_delivery_claim_mismatch'
      using errcode = '40001';
  end if;
  select event_row.*
  into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
  for share;
  if not found
    or v_event.workflow_key <> 'registration'
    or v_event.payload_schema_version <> 3
    or not dashboard_private.registration_observation_chat_event_source_valid_v1(
      v_event.source_type,
      v_event.source_id,
      v_event.source_revision,
      v_event.payload
    )
  then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode = '55000';
  end if;
  select ownership.*
  into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for update;
  if not found
    or v_ownership.owner_kind <> 'canonical'
    or v_ownership.state <> 'reserved'
  then
    raise exception 'registration_observation_delivery_ownership_invalid'
      using errcode = '40001';
  end if;

  select pg_catalog.count(*)
  into v_registered_attempts
  from dashboard_private.notification_audit_logs audit
  where audit.entity_kind = 'notification_external_attempt'
    and audit.action = 'external_attempt_registered'
    and audit.entity_id like v_ownership.id::text || ':%';

  if v_delivery.observation_payload_snapshot is null then
    if v_delivery.attempt_count <> 0
      or v_delivery.last_attempt_started_at is not null
      or v_registered_attempts <> 0
    then
      raise exception 'registration_observation_delivery_frozen_state_invalid'
        using errcode = '55000';
    end if;
    v_snapshot := v_event.payload;
  else
    if v_delivery.observation_payload_fingerprint is null
      or v_delivery.observation_render_fingerprint is null
      or dashboard_private.notification_sha256_hex_v1(
        dashboard_private.notification_canonical_json_v1(
          v_delivery.observation_payload_snapshot
        )
      ) is distinct from v_delivery.observation_payload_fingerprint
      or dashboard_private.notification_sha256_hex_v1(
        dashboard_private.notification_canonical_json_v1(
          pg_catalog.jsonb_build_object(
            'title', v_delivery.rendered_title,
            'body', v_delivery.rendered_body,
            'href', v_delivery.href
          )
        )
      ) is distinct from v_delivery.observation_render_fingerprint
    then
      raise exception 'registration_observation_delivery_frozen_state_invalid'
        using errcode = '55000';
    end if;
    if (v_delivery.attempt_count = 0
        and (v_delivery.last_attempt_started_at is not null
          or v_registered_attempts <> 0))
      or (v_delivery.attempt_count > 0
        and (v_delivery.last_attempt_started_at is null
          or v_registered_attempts = 0))
    then
      raise exception 'registration_observation_delivery_frozen_state_invalid'
        using errcode = '55000';
    end if;
    v_snapshot := v_delivery.observation_payload_snapshot;
  end if;

  begin
    v_expires_at := (v_snapshot ->> 'delivery_expires_at')::timestamptz;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'registration_observation_delivery_expiry_invalid'
        using errcode = '22023';
  end;
  if v_expires_at is null then
    raise exception 'registration_observation_delivery_expiry_invalid'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'expiresAt', v_expires_at,
    'snapshot', v_snapshot,
    'payloadFingerprint', v_delivery.observation_payload_fingerprint,
    'renderFingerprint', v_delivery.observation_render_fingerprint,
    'title', v_delivery.rendered_title,
    'body', v_delivery.rendered_body,
    'href', v_delivery.href,
    'lastAttemptStartedAt', v_delivery.last_attempt_started_at,
    'attemptCount', v_delivery.attempt_count
  );
end;
$$;

create or replace function public.refresh_registration_observation_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_expected_event_id uuid,
  p_expected_rule_id uuid,
  p_expected_rule_revision bigint,
  p_rendered_title text,
  p_rendered_body text,
  p_href text,
  p_payload jsonb,
  p_payload_fingerprint text,
  p_render_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_source jsonb;
  v_payload_hash text;
  v_render_hash text;
  v_observation_id uuid;
  v_decision_is_null boolean;
  v_current_textbook_names jsonb;
  v_current_progress_summary text;
  v_current_preparation jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if p_delivery_id is null or p_claim_token is null
    or p_expected_event_id is null or p_expected_rule_id is null
    or p_expected_rule_revision is null
    or nullif(pg_catalog.btrim(p_rendered_title), '') is null
    or nullif(pg_catalog.btrim(p_rendered_body), '') is null
    or pg_catalog.octet_length(p_rendered_title) > 256
    or pg_catalog.octet_length(p_rendered_body) > 16384
    or not dashboard_private.registration_observation_chat_render_safe_v1(
      p_rendered_title,
      p_rendered_body
    )
    or (p_href is not null and (
      p_href not like '/admin/%' or p_href like '//%' or pg_catalog.octet_length(p_href) > 2048
    ))
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or not dashboard_private.registration_observation_chat_payload_valid_v3(
      p_payload
    )
    or p_payload_fingerprint !~ '^[a-f0-9]{64}$'
    or p_render_fingerprint !~ '^[a-f0-9]{64}$'
  then
    raise exception 'registration_observation_delivery_refresh_invalid'
      using errcode = '22023';
  end if;
  v_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(p_payload)
  );
  v_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'title', p_rendered_title,
        'body', p_rendered_body,
        'href', p_href
      )
    )
  );
  if v_payload_hash is distinct from p_payload_fingerprint
    or v_render_hash is distinct from p_render_fingerprint
  then
    raise exception 'registration_observation_delivery_refresh_fingerprint_invalid'
      using errcode = '22023';
  end if;

  select delivery.*
  into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if not found
    or v_delivery.status <> 'claimed'
    or v_delivery.claim_token is distinct from p_claim_token
    or v_delivery.lease_expires_at <= pg_catalog.clock_timestamp()
    or v_delivery.event_id is distinct from p_expected_event_id
    or v_delivery.rule_id is distinct from p_expected_rule_id
    or v_delivery.rule_revision is distinct from p_expected_rule_revision
    or v_delivery.attempt_count <> 0
    or v_delivery.last_attempt_started_at is not null
    or v_delivery.observation_payload_snapshot is not null
  then
    raise exception 'registration_observation_delivery_refresh_stale'
      using errcode = '40001';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
  for share;
  if v_event.workflow_key <> 'registration'
    or v_event.payload_schema_version <> 3
    or not dashboard_private.registration_observation_chat_event_source_valid_v1(
      v_event.source_type,
      v_event.source_id,
      v_event.source_revision,
      v_event.payload
    )
  then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode = '55000';
  end if;
  select rule.* into v_rule
  from dashboard_private.notification_rules rule
  where rule.id = v_delivery.rule_id
  for share;
  if not found
    or v_event.payload ->> 'event_kind' is distinct from v_event.event_key
    or not dashboard_private.registration_observation_chat_delivery_contract_valid_v1(
      v_event.event_key,
      v_event.rule_snapshot,
      v_rule.id,
      v_rule.revision,
      v_rule.scope_key,
      v_rule.workflow_key,
      v_rule.event_key,
      v_rule.channel_key,
      v_rule.audience_key,
      v_rule.rule_variant_key,
      v_rule.active_template_id,
      v_rule.enabled,
      v_delivery.channel_key,
      v_delivery.audience_key,
      v_delivery.template_id
    )
  then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode = '55000';
  end if;
  v_observation_id := (v_event.payload ->> 'observation_id')::uuid;
  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for update;
  if not found or v_ownership.owner_kind <> 'canonical'
    or v_ownership.state <> 'reserved'
    or exists (
      select 1
      from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'notification_external_attempt'
        and audit.action = 'external_attempt_registered'
        and audit.entity_id like v_ownership.id::text || ':%'
    )
  then
    raise exception 'registration_observation_delivery_refresh_after_attempt'
      using errcode = '40001';
  end if;
  v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
    v_observation_id
  );
  if v_event.event_key = 'registration.observation_reminder_due' then
    v_current_preparation :=
      dashboard_private.registration_observation_chat_current_preparation_v1(
        v_observation_id
      );
  end if;
  select observation.decision_kind is null
  into
    v_decision_is_null
  from public.ops_registration_observations observation
  where observation.id = v_observation_id;
  if v_event.event_key = 'registration.observation_reminder_due' then
    v_current_textbook_names := v_current_preparation -> 'textbookNames';
    v_current_progress_summary := v_current_preparation ->> 'progressSummary';
  else
    select
      coalesce(observation.textbook_snapshot, '[]'::jsonb),
      observation.progress_snapshot
    into v_current_textbook_names,v_current_progress_summary
    from public.ops_registration_observations observation
    where observation.id=v_observation_id;
  end if;
  if not dashboard_private.registration_observation_chat_source_eligible_v1(
      p_payload ->> 'event_kind',
      v_source,
      v_decision_is_null
    )
    or (v_source ->> 'notificationRevision')::bigint
      is distinct from
        (p_payload ->> 'appointment_notification_revision')::bigint
    or (
      v_event.source_type = 'registration_observation'
      and (v_source ->> 'notificationRevision')::bigint
        is distinct from v_event.source_revision
    )
    or v_source ->> 'bookingFactHash'
      is distinct from p_payload ->> 'booking_fact_hash'
    or not dashboard_private.registration_observation_chat_refresh_payload_matches_v1(
      p_payload,
      v_event.payload,
      v_source -> 'sourceRevision',
      v_current_textbook_names,
      v_current_progress_summary
    )
    or not exists (
      select 1 from dashboard_private.notification_rules rule
      where rule.id = v_delivery.rule_id
        and rule.revision = v_delivery.rule_revision
        and rule.enabled
    )
  then
    raise exception 'registration_observation_delivery_refresh_stale'
      using errcode = '40001';
  end if;

  update dashboard_private.notification_deliveries delivery
  set observation_payload_snapshot = p_payload,
      observation_payload_fingerprint = p_payload_fingerprint,
      observation_render_fingerprint = p_render_fingerprint,
      rendered_title = p_rendered_title,
      rendered_body = p_rendered_body,
      href = p_href,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id;
  return pg_catalog.jsonb_build_object(
    'outcome', 'refreshed',
    'delivery_id', v_delivery.id,
    'payload_fingerprint', p_payload_fingerprint,
    'render_fingerprint', p_render_fingerprint
  );
end;
$$;

create or replace function public.prepare_registration_observation_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_expected_event_id uuid,
  p_expected_rule_id uuid,
  p_expected_rule_revision bigint,
  p_expected_payload_fingerprint text,
  p_expected_render_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_source jsonb;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_payload_hash text;
  v_render_hash text;
  v_mentions jsonb;
  v_profile_ids uuid[];
  v_begin jsonb;
  v_commit jsonb;
  v_director uuid;
  v_observation_id uuid;
  v_decision_is_null boolean;
  v_candidate_channel text;
  v_candidate_audience text;
  v_candidate_connection_key text;
  v_candidate_target_kind text;
  v_candidate_target_key text;
  v_candidate_target_profile_id uuid;
  v_candidate_target_snapshot jsonb;
  v_candidate_event_id uuid;
  v_candidate_rule_id uuid;
  v_candidate_rule_revision bigint;
  v_current_textbook_names jsonb;
  v_current_progress_summary text;
  v_current_preparation jsonb;
  v_source_error text;
  v_locked_subject text;
  v_ownership_found boolean := false;
  v_registered_attempts bigint;
  v_begin_keys text[];
  v_commit_keys text[];
  v_terminal_status text;
  v_terminal_reason text;
  v_discovered_track_id uuid;
  v_locked_observation public.ops_registration_observations%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if p_delivery_id is null or p_claim_token is null
    or p_expected_event_id is null or p_expected_rule_id is null
    or p_expected_rule_revision is null
    or p_expected_payload_fingerprint !~ '^[a-f0-9]{64}$'
    or p_expected_render_fingerprint !~ '^[a-f0-9]{64}$'
  then
    raise exception 'registration_observation_delivery_prepare_invalid'
      using errcode = '22023';
  end if;

  select delivery.*
  into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id;
  if not found then
    raise exception 'registration_observation_delivery_claim_mismatch'
      using errcode = '40001';
  end if;
  v_candidate_channel := v_delivery.channel_key;
  v_candidate_audience := v_delivery.audience_key;
  v_candidate_connection_key := v_delivery.connection_key;
  v_candidate_target_kind := v_delivery.target_kind;
  v_candidate_target_key := v_delivery.target_key;
  v_candidate_target_profile_id := v_delivery.target_profile_id;
  v_candidate_target_snapshot := v_delivery.target_snapshot;
  v_candidate_event_id := v_delivery.event_id;
  v_candidate_rule_id := v_delivery.rule_id;
  v_candidate_rule_revision := v_delivery.rule_revision;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id;
  if not found
    or v_event.workflow_key <> 'registration'
    or v_event.payload_schema_version <> 3
    or not dashboard_private.registration_observation_chat_event_source_valid_v1(
      v_event.source_type,
      v_event.source_id,
      v_event.source_revision,
      v_event.payload
    )
  then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode = '55000';
  end if;
  v_observation_id := (v_event.payload ->> 'observation_id')::uuid;

  -- This first read discovers lock IDs only. It intentionally does not call
  -- the strict source reader, because a booking mutation that committed first
  -- must still reach the ordered locks and close the claimed delivery.
  select pg_catalog.jsonb_build_object(
    'trackId',observation.track_id,
    'observationId',observation.id,
    'appointmentId',observation.appointment_id,
    'classId',observation.class_id,
    'sessionAuthority',observation.session_authority,
    'classLessonSessionId',observation.class_lesson_session_id,
    'teacherCatalogId',observation.teacher_catalog_id,
    'classroomCatalogId',observation.classroom_catalog_id
  ) into v_source
  from public.ops_registration_observations observation
  where observation.id=v_observation_id;
  if not found then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode='55000';
  end if;
  v_discovered_track_id := (v_source ->> 'trackId')::uuid;
  select track.director_profile_id,track.subject
  into v_director,v_locked_subject
  from public.ops_registration_subject_tracks track
  where track.id = v_discovered_track_id
  for share;
  if not found then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode='55000';
  end if;
  select observation.*
  into v_locked_observation
  from public.ops_registration_observations observation
  where observation.id = v_observation_id
  for share;
  if not found
    or v_locked_observation.track_id is distinct from v_discovered_track_id
    or v_locked_observation.id is distinct from v_observation_id
  then
    raise exception 'registration_observation_delivery_source_stale'
      using errcode='40001';
  end if;
  v_source := pg_catalog.jsonb_build_object(
    'trackId',v_locked_observation.track_id,
    'observationId',v_locked_observation.id,
    'appointmentId',v_locked_observation.appointment_id,
    'classId',v_locked_observation.class_id,
    'sessionAuthority',v_locked_observation.session_authority,
    'classLessonSessionId',v_locked_observation.class_lesson_session_id,
    'teacherCatalogId',v_locked_observation.teacher_catalog_id,
    'classroomCatalogId',v_locked_observation.classroom_catalog_id
  );
  perform appointment.id
  from public.ops_registration_appointments appointment
  where appointment.id = (v_source ->> 'appointmentId')::uuid
  for share;
  perform class.id
  from public.classes class
  where class.id = (v_source ->> 'classId')::uuid
  for share;
  if v_source ->> 'sessionAuthority' = 'normalized' then
    perform lesson.id
    from public.class_lesson_sessions lesson
    where lesson.id = (v_source ->> 'classLessonSessionId')::uuid
    for share;
  end if;
  perform teacher.id
  from public.teacher_catalogs teacher
  where teacher.id = (v_source ->> 'teacherCatalogId')::uuid
  for share;
  perform classroom.id
  from public.classroom_catalogs classroom
  where classroom.id = (v_source ->> 'classroomCatalogId')::uuid
  for share;

  -- The first source read discovers lock IDs only. Rebuild the authoritative
  -- source after the complete source lock prefix has been acquired.
  begin
    v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
      v_observation_id
    );
  exception
    when sqlstate '55000' or sqlstate 'P0002' then
      get stacked diagnostics v_source_error=message_text;
  end;

  if v_candidate_channel = 'in_app'
    and v_director is not null
  then
    perform teacher.id
    from public.teacher_catalogs teacher
    where teacher.profile_id = v_director
    order by teacher.id
    for share;
    if v_locked_subject = '과학' then
      perform setting.subject
      from public.academic_subject_settings setting
      where setting.subject = '과학'
      for share;
    end if;
    perform profile.id
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = v_director
    for share of profile, account;
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if v_delivery.channel_key is distinct from v_candidate_channel
    or v_delivery.audience_key is distinct from v_candidate_audience
    or v_delivery.connection_key is distinct from v_candidate_connection_key
    or v_delivery.target_kind is distinct from v_candidate_target_kind
    or v_delivery.target_key is distinct from v_candidate_target_key
    or v_delivery.target_profile_id is distinct from
      v_candidate_target_profile_id
    or v_delivery.target_snapshot is distinct from v_candidate_target_snapshot
    or v_delivery.event_id is distinct from v_candidate_event_id
    or v_delivery.rule_id is distinct from v_candidate_rule_id
    or v_delivery.rule_revision is distinct from v_candidate_rule_revision
  then
    raise exception 'registration_observation_notification_target_lock_mismatch'
      using errcode = '40001';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
  for share;
  if v_source_error is null
    and v_delivery.channel_key = 'google_chat'
    and (
      v_delivery.target_kind is distinct from 'connection'
      or v_delivery.target_profile_id is not null
      or v_delivery.target_key is distinct from
        'connection:' || v_delivery.connection_key
      or v_delivery.target_snapshot is distinct from
        pg_catalog.jsonb_build_object('connection_key', v_delivery.connection_key)
      or (
        v_event.event_key in (
          'registration.observation_scheduled',
          'registration.observation_rescheduled',
          'registration.observation_canceled',
          'registration.observation_reminder_due',
          'registration.observation_feedback_due'
        ) and (
          v_delivery.audience_key is distinct from 'subject_team'
          or v_delivery.connection_key is distinct from case v_source ->> 'subject'
            when '영어' then 'google_chat.english'
            when '수학' then 'google_chat.math'
            when '과학' then 'google_chat.science'
            else null
          end
        )
      )
      or (
        v_event.event_key in (
          'registration.observation_feedback_submitted',
          'registration.observation_director_reassigned'
        ) and (
          v_delivery.audience_key is distinct from 'management_team'
          or v_delivery.connection_key is distinct from 'google_chat.management'
          or v_delivery.target_key is distinct from
            'connection:google_chat.management'
          or v_delivery.target_snapshot is distinct from
            '{"connection_key":"google_chat.management"}'::jsonb
        )
      )
    )
  then
    raise exception 'registration_observation_notification_target_lock_mismatch'
      using errcode = '40001';
  end if;
  select rule.* into v_rule
  from dashboard_private.notification_rules rule
  where rule.id = v_delivery.rule_id
  for share;
  if not found
    or v_event.payload ->> 'event_kind' is distinct from v_event.event_key
    or not dashboard_private.registration_observation_chat_delivery_contract_valid_v1(
      v_event.event_key,
      v_event.rule_snapshot,
      v_rule.id,
      v_rule.revision,
      v_rule.scope_key,
      v_rule.workflow_key,
      v_rule.event_key,
      v_rule.channel_key,
      v_rule.audience_key,
      v_rule.rule_variant_key,
      v_rule.active_template_id,
      v_rule.enabled,
      v_delivery.channel_key,
      v_delivery.audience_key,
      v_delivery.template_id
    )
  then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode = '55000';
  end if;
  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for update;
  v_ownership_found := found;

  if v_delivery.channel_key is distinct from v_candidate_channel
    or v_delivery.connection_key is distinct from v_candidate_connection_key
    or v_delivery.event_id is distinct from v_candidate_event_id
    or v_delivery.rule_id is distinct from v_candidate_rule_id
    or v_delivery.rule_revision is distinct from v_candidate_rule_revision
  then
    raise exception 'registration_observation_notification_target_lock_mismatch'
      using errcode = '40001';
  end if;

  if not v_ownership_found then
    raise exception 'registration_observation_delivery_prepare_stale'
      using errcode = '40001';
  end if;

  if v_delivery.status <> 'claimed'
    or v_delivery.claim_token is distinct from p_claim_token
    or v_delivery.lease_expires_at <= pg_catalog.clock_timestamp()
    or v_delivery.event_id is distinct from p_expected_event_id
    or v_delivery.rule_id is distinct from p_expected_rule_id
    or v_delivery.rule_revision is distinct from p_expected_rule_revision
    or v_rule.revision is distinct from p_expected_rule_revision
    or not v_rule.enabled
    or v_ownership.owner_kind <> 'canonical'
    or v_ownership.state <> 'reserved'
  then
    raise exception 'registration_observation_delivery_prepare_stale'
      using errcode = '40001';
  end if;

  if v_source_error is null
    and v_delivery.attempt_count = 0
    and v_event.event_key = 'registration.observation_reminder_due'
  then
    begin
      v_current_preparation :=
        dashboard_private.registration_observation_chat_current_preparation_v1(
          v_observation_id
        );
    exception
      when sqlstate '55000' or sqlstate 'P0002' then
        get stacked diagnostics v_source_error=message_text;
    end;
  end if;

  if v_source_error is not null then
    update dashboard_private.notification_deliveries delivery
    set status='canceled',
        status_reason=case
          when v_source_error='registration_observation_notification_source_dirty'
            then 'source_schedule_changed'
          else 'source_status_changed'
        end,
        claimed_by=null,claim_token=null,lease_expires_at=null,
        next_attempt_at=null,resolved_at=pg_catalog.clock_timestamp(),
        updated_at=pg_catalog.clock_timestamp()
    where delivery.id=v_delivery.id;
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state='closed',updated_at=pg_catalog.clock_timestamp()
    where ownership.id=v_ownership.id and ownership.state='reserved';
    return pg_catalog.jsonb_build_object(
      'prepared',false,
      'delivery_id',v_delivery.id,
      'status','canceled',
      'status_reason',case
        when v_source_error='registration_observation_notification_source_dirty'
          then 'source_schedule_changed'
        else 'source_status_changed'
      end
    );
  end if;

  select pg_catalog.count(*)
  into v_registered_attempts
  from dashboard_private.notification_audit_logs audit
  where audit.entity_kind = 'notification_external_attempt'
    and audit.action = 'external_attempt_registered'
    and audit.entity_id like v_ownership.id::text || ':%';

  if (v_delivery.attempt_count = 0
      and (v_delivery.last_attempt_started_at is not null
        or v_registered_attempts <> 0))
    or (v_delivery.attempt_count > 0
      and (v_delivery.last_attempt_started_at is null
        or v_registered_attempts = 0))
  then
    raise exception 'registration_observation_delivery_frozen_state_invalid'
      using errcode = '55000';
  end if;
  select observation.decision_kind is null
  into
    v_decision_is_null
  from public.ops_registration_observations observation
  where observation.id = v_observation_id;
  if v_delivery.attempt_count = 0 then
    if v_event.event_key = 'registration.observation_reminder_due' then
      v_current_textbook_names := v_current_preparation -> 'textbookNames';
      v_current_progress_summary := v_current_preparation ->> 'progressSummary';
    else
      select
        coalesce(observation.textbook_snapshot, '[]'::jsonb),
        observation.progress_snapshot
      into v_current_textbook_names,v_current_progress_summary
      from public.ops_registration_observations observation
      where observation.id=v_observation_id;
    end if;
  end if;
  if not dashboard_private.registration_observation_chat_source_eligible_v1(
      v_event.payload ->> 'event_kind',
      v_source,
      v_decision_is_null
    )
    or (v_source ->> 'notificationRevision')::bigint
      is distinct from
        (v_event.payload ->> 'appointment_notification_revision')::bigint
    or (
      v_event.source_type = 'registration_observation'
      and (v_source ->> 'notificationRevision')::bigint
        is distinct from v_event.source_revision
    )
    or v_source ->> 'bookingFactHash'
      is distinct from v_event.payload ->> 'booking_fact_hash'
    or v_source ->> 'observationId' is distinct from
      v_event.payload ->> 'observation_id'
    or v_source ->> 'appointmentId' is distinct from
      v_event.payload ->> 'appointment_id'
    or v_source ->> 'taskId' is distinct from v_event.payload ->> 'task_id'
    or v_source ->> 'trackId' is distinct from v_event.payload ->> 'track_id'
  then
    raise exception 'registration_observation_delivery_source_stale'
      using errcode = '40001';
  end if;
  v_snapshot := v_delivery.observation_payload_snapshot;
  if v_snapshot is null then
    raise exception 'registration_observation_delivery_refresh_required'
      using errcode = '40001';
  end if;
  if not dashboard_private.registration_observation_chat_payload_valid_v3(
      v_snapshot
    )
    or (
      v_delivery.attempt_count = 0
      and not dashboard_private.registration_observation_chat_refresh_payload_matches_v1(
        v_snapshot,
        v_event.payload,
        v_source -> 'sourceRevision',
        v_current_textbook_names,
        v_current_progress_summary
      )
    )
    or v_snapshot ->> 'observation_id' is distinct from
      v_event.payload ->> 'observation_id'
    or v_snapshot ->> 'appointment_id' is distinct from
      v_event.payload ->> 'appointment_id'
    or v_snapshot ->> 'task_id' is distinct from v_event.payload ->> 'task_id'
    or v_snapshot ->> 'track_id' is distinct from v_event.payload ->> 'track_id'
    or v_snapshot ->> 'event_kind' is distinct from
      v_event.payload ->> 'event_kind'
    or v_snapshot ->> 'booking_fact_hash' is distinct from
      v_event.payload ->> 'booking_fact_hash'
    or v_snapshot ->> 'mention_role' is distinct from
      v_event.payload ->> 'mention_role'
    or v_snapshot -> 'mention_profile_ids' is distinct from
      v_event.payload -> 'mention_profile_ids'
  then
    raise exception 'registration_observation_delivery_source_invalid'
      using errcode = '55000';
  end if;
  v_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_snapshot)
  );
  v_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'title', v_delivery.rendered_title,
        'body', v_delivery.rendered_body,
        'href', v_delivery.href
      )
    )
  );
  if v_payload_hash is distinct from v_delivery.observation_payload_fingerprint
    or v_payload_hash is distinct from p_expected_payload_fingerprint
    or v_render_hash is distinct from v_delivery.observation_render_fingerprint
    or v_render_hash is distinct from p_expected_render_fingerprint
  then
    raise exception 'registration_observation_delivery_fingerprint_stale'
      using errcode = '40001';
  end if;
  if not dashboard_private.registration_observation_chat_render_safe_v1(
      v_delivery.rendered_title,
      v_delivery.rendered_body
    )
  then
    raise exception 'registration_observation_delivery_render_unsafe'
      using errcode = '22023';
  end if;
  begin
    v_expires_at := (v_snapshot ->> 'delivery_expires_at')::timestamptz;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'registration_observation_delivery_expiry_invalid'
        using errcode = '22023';
  end;
  if v_expires_at is null then
    raise exception 'registration_observation_delivery_expiry_invalid'
      using errcode = '22023';
  end if;
  if v_expires_at <= pg_catalog.clock_timestamp() then
    update dashboard_private.notification_deliveries delivery
    set status = 'canceled', status_reason = 'notification_window_closed',
        claimed_by = null, claim_token = null, lease_expires_at = null,
        next_attempt_at = null, resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery.id;
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state = 'closed', updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_ownership.id and ownership.state = 'reserved';
    return pg_catalog.jsonb_build_object(
      'prepared', false,
      'delivery_id', v_delivery.id,
      'status', 'canceled',
      'status_reason', 'notification_window_closed'
    );
  end if;

  if v_delivery.channel_key = 'google_chat' then
    -- registration_observation_final_prepare_google_chat_target_begin
    if v_delivery.target_kind is distinct from 'connection'
      or v_delivery.target_profile_id is not null
      or v_delivery.target_key is distinct from
        'connection:' || v_delivery.connection_key
      or v_delivery.target_snapshot is distinct from
        pg_catalog.jsonb_build_object('connection_key', v_delivery.connection_key)
      or (
        v_event.event_key in (
          'registration.observation_scheduled',
          'registration.observation_rescheduled',
          'registration.observation_canceled',
          'registration.observation_reminder_due',
          'registration.observation_feedback_due'
        ) and (
          v_delivery.audience_key is distinct from 'subject_team'
          or v_delivery.connection_key is distinct from case v_source ->> 'subject'
            when '영어' then 'google_chat.english'
            when '수학' then 'google_chat.math'
            when '과학' then 'google_chat.science'
            else null
          end
        )
      )
      or (
        v_event.event_key in (
          'registration.observation_feedback_submitted',
          'registration.observation_director_reassigned'
        ) and (
          v_delivery.audience_key is distinct from 'management_team'
          or v_delivery.connection_key is distinct from 'google_chat.management'
          or v_delivery.target_key is distinct from
            'connection:google_chat.management'
          or v_delivery.target_snapshot is distinct from
            '{"connection_key":"google_chat.management"}'::jsonb
        )
      )
    then
      raise exception 'registration_observation_notification_target_lock_mismatch'
        using errcode = '40001';
    end if;
    if v_delivery.attempt_count > 0 then
      select coalesce(
        pg_catalog.array_agg(value::uuid order by ordinality),array[]::uuid[]
      ) into v_profile_ids
      from pg_catalog.jsonb_array_elements_text(
        v_snapshot -> 'mention_profile_ids'
      ) with ordinality item(value,ordinality);
    elsif v_event.event_key='registration.observation_feedback_submitted' then
      v_profile_ids := case
        when nullif(v_source ->> 'directorProfileId','') is null
          then array[]::uuid[]
        else array[(v_source ->> 'directorProfileId')::uuid]
      end;
    elsif v_event.event_key in (
      'registration.observation_scheduled',
      'registration.observation_canceled',
      'registration.observation_reminder_due',
      'registration.observation_feedback_due'
    ) then
      v_profile_ids := case
        when nullif(v_source ->> 'teacherProfileId','') is null
          then array[]::uuid[]
        else array[(v_source ->> 'teacherProfileId')::uuid]
      end;
    else
      select coalesce(
        pg_catalog.array_agg(value::uuid order by ordinality),array[]::uuid[]
      ) into v_profile_ids
      from pg_catalog.jsonb_array_elements_text(
        v_snapshot -> 'mention_profile_ids'
      ) with ordinality item(value,ordinality);
    end if;
    v_mentions := dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(
      v_delivery.id,
      p_claim_token,
      v_rule.id,
      v_profile_ids,
      v_delivery.attempt_count > 0
    );
    v_begin := public.begin_notification_delivery_send_v1(
      v_delivery.id,
      p_claim_token
    );
    if pg_catalog.jsonb_typeof(v_begin) is distinct from 'object' then
      raise exception 'registration_observation_delivery_begin_receipt_invalid'
        using errcode = '55000';
    end if;
    select pg_catalog.array_agg(key order by key)
    into v_begin_keys
    from pg_catalog.jsonb_object_keys(v_begin) key;
    if v_begin ->> 'status' = 'sending'
      and v_begin ->> 'channel_key' = 'google_chat'
    then
      if v_begin_keys is distinct from (case when v_delivery.href is null then
          array[
            'channel_key','claim_token','connection_key','delivery_id',
            'dispatch_token','rendered_body','rendered_title','status','webhook_url'
          ]::text[]
        else
          array[
            'channel_key','claim_token','connection_key','delivery_id',
            'dispatch_token','href','rendered_body','rendered_title','status',
            'webhook_url'
          ]::text[]
        end)
        or v_begin ->> 'delivery_id' is distinct from v_delivery.id::text
        or v_begin ->> 'claim_token' is distinct from p_claim_token::text
        or v_begin ->> 'connection_key' is distinct from
          v_delivery.connection_key
        or v_begin ->> 'rendered_title' is distinct from
          v_delivery.rendered_title
        or v_begin ->> 'rendered_body' is distinct from
          v_delivery.rendered_body
        or v_begin ->> 'href' is distinct from v_delivery.href
        or v_begin ->> 'dispatch_token' !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or v_begin ->> 'webhook_url' !~
          '^https://chat\.googleapis\.com/v1/spaces/[A-Za-z0-9_-]{8,}/messages\?key=[^&[:space:]]+&token=[^&[:space:]]+$'
        or not exists (
          select 1
          from dashboard_private.notification_deliveries delivery
          join dashboard_private.notification_dispatch_ownership_claims ownership
            on ownership.id = v_ownership.id
          where delivery.id = v_delivery.id
            and delivery.status = 'sending'
            and delivery.claim_token = p_claim_token
            and ownership.state = 'dispatch_started'
            and ownership.dispatch_token::text = v_begin ->> 'dispatch_token'
        )
      then
        raise exception 'registration_observation_delivery_begin_receipt_invalid'
          using errcode = '55000';
      end if;
      return v_begin || pg_catalog.jsonb_build_object(
        'prepared', true,
        'mention_user_names', v_mentions -> 'user_names'
      );
    end if;
    select delivery.status, delivery.status_reason
    into v_terminal_status, v_terminal_reason
    from dashboard_private.notification_deliveries delivery
    where delivery.id = v_delivery.id;
    if v_begin_keys is distinct from
        array['delivery_id','status','status_reason']::text[]
      or v_begin ->> 'delivery_id' is distinct from v_delivery.id::text
      or v_begin ->> 'status' not in ('failed','canceled','skipped')
      or v_begin ->> 'status' is distinct from v_terminal_status
      or v_begin ->> 'status_reason' is distinct from v_terminal_reason
      or nullif(v_begin ->> 'status_reason','') is null
    then
      raise exception 'registration_observation_delivery_begin_receipt_invalid'
        using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'prepared', false,
      'delivery_id', v_delivery.id,
      'status', v_terminal_status,
      'status_reason', v_terminal_reason
    );
    -- registration_observation_final_prepare_google_chat_target_end
  elsif v_delivery.channel_key = 'in_app' then
    -- registration_observation_final_prepare_in_app_target_begin
    if v_director is null
      or v_delivery.target_kind <> 'profile'
      or v_delivery.connection_key is not null
      or v_delivery.target_profile_id is distinct from v_director
      or v_delivery.target_key <> 'profile:' || v_director::text
      or v_delivery.target_snapshot is distinct from
        pg_catalog.jsonb_build_object('profile_id', v_director)
      or not exists (
        select 1
        from public.profiles profile
        join auth.users account on account.id = profile.id
        where profile.id = v_director
          and dashboard_private.is_active_subject_director(
            v_director,
            v_source ->> 'subject'
          )
          and dashboard_private.notification_profile_is_active_v1(v_director)
      )
    then
      update dashboard_private.notification_deliveries delivery
      set status = 'canceled', status_reason = 'recipient_revoked',
          claimed_by = null, claim_token = null, lease_expires_at = null,
          next_attempt_at = null, resolved_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where delivery.id = v_delivery.id;
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed', updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id and ownership.state = 'reserved';
      return pg_catalog.jsonb_build_object(
        'prepared', false,
        'delivery_id', v_delivery.id,
        'status', 'canceled',
        'status_reason', 'recipient_revoked'
      );
    end if;
    if v_delivery.attempt_count <> 0
      or v_delivery.last_attempt_started_at is not null
      or exists (
        select 1
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind = 'notification_external_attempt'
          and audit.action = 'external_attempt_registered'
          and audit.entity_id like v_ownership.id::text || ':%'
      )
    then
      raise exception 'registration_observation_in_app_retry_invalid'
        using errcode = '40001';
    end if;
    v_commit := public.commit_notification_in_app_delivery_v1(
      v_delivery.id,
      p_claim_token
    );
    if pg_catalog.jsonb_typeof(v_commit) is distinct from 'object' then
      raise exception 'registration_observation_in_app_receipt_invalid'
        using errcode = '55000';
    end if;
    select pg_catalog.array_agg(key order by key)
    into v_commit_keys
    from pg_catalog.jsonb_object_keys(v_commit) key;
    select delivery.status, delivery.status_reason
    into v_terminal_status, v_terminal_reason
    from dashboard_private.notification_deliveries delivery
    where delivery.id = v_delivery.id;
    if v_commit_keys is distinct from array[
        'delivery_id','notification_id','push_children_created','status'
      ]::text[]
      or v_commit ->> 'delivery_id' is distinct from v_delivery.id::text
      or v_commit ->> 'status' not in ('sent','canceled','skipped')
      or v_commit ->> 'status' is distinct from v_terminal_status
      or pg_catalog.jsonb_typeof(v_commit -> 'push_children_created')
        is distinct from 'number'
      or v_commit ->> 'push_children_created' !~ '^[0-9]+$'
      or (
        v_commit ->> 'status' = 'sent'
        and (
          v_commit ->> 'notification_id' !~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          or not exists (
            select 1
            from public.dashboard_notifications notification
            where notification.id::text = v_commit ->> 'notification_id'
              and notification.source_delivery_id = v_delivery.id
          )
        )
      )
      or (
        v_commit ->> 'status' <> 'sent'
        and v_commit -> 'notification_id' <> 'null'::jsonb
      )
    then
      raise exception 'registration_observation_in_app_receipt_invalid'
        using errcode = '55000';
    end if;
    if v_commit ->> 'status' = 'sent' then
      return v_commit || pg_catalog.jsonb_build_object(
        'prepared', true,
        'channel_key', 'in_app'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'prepared', false,
      'delivery_id', v_delivery.id,
      'status', v_terminal_status,
      'status_reason', v_terminal_reason
    );
    -- registration_observation_final_prepare_in_app_target_end
  end if;
  raise exception 'registration_observation_delivery_channel_invalid'
    using errcode = '22023';
end;
$$;

alter table dashboard_private.notification_worker_heartbeats
  drop constraint notification_worker_heartbeats_counts_check;

update dashboard_private.notification_worker_heartbeats heartbeat
set counts = pg_catalog.jsonb_build_object('observation_due', 0) || heartbeat.counts;

alter table dashboard_private.notification_worker_heartbeats
  add constraint notification_worker_heartbeats_counts_check
  check (
    pg_catalog.jsonb_typeof(counts) = 'object'
    and counts ?& array[
      'observation_due', 'fanout', 'rule_reconciliation',
      'target_reconciliation', 'deliveries', 'reaped'
    ]::text[]
    and counts - array[
      'observation_due', 'fanout', 'rule_reconciliation',
      'target_reconciliation', 'deliveries', 'reaped'
    ]::text[] = '{}'::jsonb
    and pg_catalog.jsonb_typeof(counts -> 'observation_due') = 'number'
    and pg_catalog.jsonb_typeof(counts -> 'fanout') = 'number'
    and pg_catalog.jsonb_typeof(counts -> 'rule_reconciliation') = 'number'
    and pg_catalog.jsonb_typeof(counts -> 'target_reconciliation') = 'number'
    and pg_catalog.jsonb_typeof(counts -> 'deliveries') = 'number'
    and pg_catalog.jsonb_typeof(counts -> 'reaped') = 'number'
    and counts ->> 'observation_due' ~ '^(0|[1-9][0-9]*)$'
    and counts ->> 'fanout' ~ '^(0|[1-9][0-9]*)$'
    and counts ->> 'rule_reconciliation' ~ '^(0|[1-9][0-9]*)$'
    and counts ->> 'target_reconciliation' ~ '^(0|[1-9][0-9]*)$'
    and counts ->> 'deliveries' ~ '^(0|[1-9][0-9]*)$'
    and counts ->> 'reaped' ~ '^(0|[1-9][0-9]*)$'
  );

create or replace function public.record_notification_worker_heartbeat_v1(
  p_worker_id text,
  p_run_id uuid,
  p_phase text,
  p_counts jsonb,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing dashboard_private.notification_worker_heartbeats%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or p_run_id is null
    or p_phase is null
    or p_phase not in ('started', 'succeeded', 'failed')
    or p_counts is null
    or pg_catalog.jsonb_typeof(p_counts) <> 'object'
    or not (p_counts ?& array[
      'observation_due', 'fanout', 'rule_reconciliation',
      'target_reconciliation', 'deliveries', 'reaped'
    ]::text[])
    or p_counts - array[
      'observation_due', 'fanout', 'rule_reconciliation',
      'target_reconciliation', 'deliveries', 'reaped'
    ]::text[] <> '{}'::jsonb
    or exists (
      select 1
      from pg_catalog.jsonb_each(p_counts) count_entry
      where pg_catalog.jsonb_typeof(count_entry.value) <> 'number'
        or count_entry.value::text !~ '^(0|[1-9][0-9]*)$'
    )
    or (p_phase = 'failed' and (
      nullif(pg_catalog.btrim(p_error_code), '') is null
      or pg_catalog.octet_length(p_error_code) > 96
    ))
    or (p_phase <> 'failed' and p_error_code is not null)
  then
    raise exception 'notification_worker_heartbeat_invalid'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-worker-run:' || p_run_id::text, 0)
  );
  select heartbeat.* into v_existing
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.run_id = p_run_id
    and (
      heartbeat.phase = p_phase
      or (
        p_phase in ('succeeded','failed')
        and heartbeat.phase in ('succeeded','failed')
      )
    )
  for update;
  if found then
    if v_existing.phase <> p_phase
      or v_existing.worker_id <> p_worker_id
      or v_existing.counts <> p_counts
      or v_existing.error_code is distinct from p_error_code
    then
      raise exception 'notification_worker_heartbeat_conflict'
        using errcode = '40001';
    end if;
    return;
  end if;
  if p_phase in ('succeeded', 'failed') and not exists (
    select 1
    from dashboard_private.notification_worker_heartbeats heartbeat
    where heartbeat.run_id = p_run_id
      and heartbeat.worker_id = p_worker_id
      and heartbeat.phase = 'started'
  ) then
    raise exception 'notification_worker_heartbeat_start_missing'
      using errcode = '55000';
  end if;
  insert into dashboard_private.notification_worker_heartbeats(
    worker_id, run_id, phase, counts, error_code
  ) values (p_worker_id, p_run_id, p_phase, p_counts, p_error_code);
end;
$$;

create or replace function public.get_registration_observation_google_chat_readiness_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest dashboard_private.notification_worker_heartbeats%rowtype;
  v_result jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  select heartbeat.* into v_latest
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.worker_id = 'notification-worker-route-v1'
  order by heartbeat.created_at desc, heartbeat.id desc
  limit 1;
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'triggerInstalled', exists (
      select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname = 'registration_observation_google_chat_materializer'
        and trigger_row.tgrelid =
          'dashboard_private.registration_observation_domain_events'::pg_catalog.regclass
        and not trigger_row.tgisinternal
    ),
    'ruleCount', (select pg_catalog.count(*)
      from dashboard_private.notification_rules rule
      where rule.id between
        '81000000-0000-4000-8000-000000000001'::uuid and
        '81000000-0000-4000-8000-000000000008'::uuid),
    'enabledRuleCount', (select pg_catalog.count(*)
      from dashboard_private.notification_rules rule
      where rule.id between
        '81000000-0000-4000-8000-000000000001'::uuid and
        '81000000-0000-4000-8000-000000000008'::uuid
        and rule.enabled),
    'pendingCount', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs job where job.status = 'pending'),
    'claimedCount', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs job where job.status = 'claimed'),
    'materializedCount', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs job where job.status = 'materialized'),
    'suppressedCount', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs job where job.status = 'suppressed'),
    'sourceDirtyCount', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs job where job.status = 'source_dirty'),
    'failedCount', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs job where job.status = 'failed'),
    'oldestPendingAt', (select pg_catalog.min(job.due_at) from dashboard_private.registration_observation_chat_jobs job where job.status = 'pending'),
    'latestObservationHeartbeatAt', v_latest.created_at,
    'recentObservationHeartbeat', coalesce(
      v_latest.phase = 'succeeded'
      and v_latest.counts ?& array[
        'observation_due', 'fanout', 'rule_reconciliation',
        'target_reconciliation', 'deliveries', 'reaped'
      ]::text[]
      and v_latest.counts - array[
        'observation_due', 'fanout', 'rule_reconciliation',
        'target_reconciliation', 'deliveries', 'reaped'
      ]::text[] = '{}'::jsonb
      and v_latest.created_at >= pg_catalog.clock_timestamp() - interval '5 minutes',
      false
    )
  ) into v_result;
  return v_result;
end;
$$;

alter table dashboard_private.registration_observation_chat_jobs owner to postgres;

alter function dashboard_private.registration_observation_chat_source_revision_valid_v1(jsonb) owner to postgres;
alter function dashboard_private.registration_observation_chat_payload_booking_valid_v1(jsonb) owner to postgres;
alter function dashboard_private.registration_observation_chat_payload_valid_v3(jsonb) owner to postgres;
alter function dashboard_private.registration_observation_chat_refresh_payload_matches_v1(jsonb,jsonb,jsonb,jsonb,text) owner to postgres;
alter function dashboard_private.registration_observation_chat_render_safe_v1(text,text) owner to postgres;
alter function dashboard_private.registration_observation_chat_event_source_valid_v1(text,text,bigint,jsonb) owner to postgres;
alter function dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(text,jsonb,jsonb) owner to postgres;
alter function dashboard_private.registration_observation_chat_job_snapshots_valid_v1(text,jsonb,jsonb,jsonb,jsonb,text,uuid[]) owner to postgres;
alter function dashboard_private.get_registration_observation_notification_source_impl_v1(uuid) owner to postgres;
alter function dashboard_private.registration_observation_chat_preparation_snapshot_v1(jsonb,text) owner to postgres;
alter function dashboard_private.registration_observation_chat_current_preparation_v1(uuid) owner to postgres;
alter function dashboard_private.registration_observation_chat_source_eligible_v1(text,jsonb,boolean) owner to postgres;
alter function dashboard_private.registration_observation_chat_rule_snapshot_v1(text) owner to postgres;
alter function dashboard_private.registration_observation_chat_delivery_contract_valid_v1(text,jsonb,uuid,bigint,text,text,text,text,text,text,uuid,boolean,text,text,uuid) owner to postgres;
alter function dashboard_private.registration_observation_chat_booking_snapshot_v1(uuid) owner to postgres;
alter function dashboard_private.insert_registration_observation_chat_job_v1(uuid,uuid,uuid,uuid,integer,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,uuid[],timestamptz,timestamptz) owner to postgres;
alter function dashboard_private.materialize_registration_observation_chat_from_domain_event_v1() owner to postgres;
alter function dashboard_private.materialize_registration_observation_chat_from_assignment_fact_v1() owner to postgres;

alter function public.get_registration_observation_notification_source_v1(uuid) owner to postgres;
alter function public.claim_registration_observation_chat_jobs_v1(text,integer,integer) owner to postgres;
alter function public.finish_registration_observation_chat_job_v1(uuid,uuid,text,text,timestamptz) owner to postgres;
alter function public.reap_registration_observation_chat_job_leases_v1(text,integer) owner to postgres;
alter function public.materialize_registration_observation_chat_job_v1(uuid,uuid,integer,jsonb) owner to postgres;
alter function public.read_registration_observation_notification_delivery_frozen_state_v1(uuid,uuid) owner to postgres;
alter function public.refresh_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,text,text) owner to postgres;
alter function public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text) owner to postgres;
alter function public.get_registration_observation_google_chat_readiness_v1() owner to postgres;
alter function public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text) owner to postgres;

revoke all on function dashboard_private.registration_observation_chat_source_revision_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_payload_booking_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_payload_valid_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_refresh_payload_matches_v1(jsonb,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_render_safe_v1(text,text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_event_source_valid_v1(text,text,bigint,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_job_snapshots_valid_v1(text,jsonb,jsonb,jsonb,jsonb,text,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_preparation_snapshot_v1(jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_current_preparation_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_source_eligible_v1(text,jsonb,boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_rule_snapshot_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_delivery_contract_valid_v1(text,jsonb,uuid,bigint,text,text,text,text,text,text,uuid,boolean,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_chat_booking_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.insert_registration_observation_chat_job_v1(uuid,uuid,uuid,uuid,integer,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,uuid[],timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.materialize_registration_observation_chat_from_domain_event_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.materialize_registration_observation_chat_from_assignment_fact_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.get_registration_observation_notification_source_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_registration_observation_chat_jobs_v1(text,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_registration_observation_chat_job_v1(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.reap_registration_observation_chat_job_leases_v1(text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.materialize_registration_observation_chat_job_v1(uuid,uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.read_registration_observation_notification_delivery_frozen_state_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_observation_google_chat_readiness_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_registration_observation_notification_source_v1(uuid)
  to service_role;
grant execute on function public.claim_registration_observation_chat_jobs_v1(text,integer,integer)
  to service_role;
grant execute on function public.finish_registration_observation_chat_job_v1(uuid,uuid,text,text,timestamptz)
  to service_role;
grant execute on function public.reap_registration_observation_chat_job_leases_v1(text,integer)
  to service_role;
grant execute on function public.materialize_registration_observation_chat_job_v1(uuid,uuid,integer,jsonb)
  to service_role;
grant execute on function public.read_registration_observation_notification_delivery_frozen_state_v1(uuid,uuid)
  to service_role;
grant execute on function public.refresh_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,text,text)
  to service_role;
grant execute on function public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)
  to service_role;
grant execute on function public.get_registration_observation_google_chat_readiness_v1()
  to service_role;
grant execute on function public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)
  to service_role;

revoke all on table dashboard_private.notification_deliveries
  from service_role;
revoke all on table dashboard_private.notification_dispatch_ownership_claims
  from service_role;
grant select on table dashboard_private.notification_deliveries
  to service_role;
grant select on table dashboard_private.notification_dispatch_ownership_claims
  to service_role;
revoke all on table dashboard_private.notification_deliveries
  from public, anon, authenticated;
revoke all on table dashboard_private.notification_dispatch_ownership_claims
  from public, anon, authenticated;

commit;
