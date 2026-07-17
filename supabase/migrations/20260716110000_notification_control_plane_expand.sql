begin;

set local lock_timeout = '5s';

create extension if not exists pgcrypto;
create schema if not exists dashboard_private;

create table dashboard_private.notification_events (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null default 'global',
  workflow_key text not null,
  event_key text not null,
  source_type text not null,
  source_id text not null,
  source_revision bigint,
  occurrence_key text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamp with time zone not null,
  payload_schema_version integer not null,
  payload jsonb not null,
  rule_snapshot jsonb not null,
  materialized_rule_id uuid,
  materialized_rule_revision bigint,
  created_at timestamp with time zone not null default now(),
  constraint notification_events_scope_check
    check (scope_key = 'global'),
  constraint notification_events_workflow_check
    check (workflow_key in (
      'tasks',
      'word_retests',
      'registration',
      'transfer',
      'withdrawal',
      'makeup_requests',
      'approvals'
    )),
  constraint notification_events_identity_text_check
    check (
      btrim(event_key) <> ''
      and btrim(source_type) <> ''
      and btrim(source_id) <> ''
      and btrim(occurrence_key) <> ''
    ),
  constraint notification_events_source_revision_check
    check (source_revision is null or source_revision > 0),
  constraint notification_events_payload_schema_version_check
    check (payload_schema_version > 0),
  constraint notification_events_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint notification_events_rule_snapshot_array_check
    check (jsonb_typeof(rule_snapshot) = 'array'),
  constraint notification_events_materialized_rule_pair_check
    check (
      (materialized_rule_id is null and materialized_rule_revision is null)
      or
      (materialized_rule_id is not null and materialized_rule_revision is not null)
    ),
  constraint notification_events_materialized_rule_revision_check
    check (materialized_rule_revision is null or materialized_rule_revision > 0)
);

create table dashboard_private.notification_rules (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null default 'global',
  workflow_key text not null,
  event_key text not null,
  channel_key text not null,
  audience_key text not null,
  rule_variant_key text not null,
  delivery_mode text not null,
  schedule_key text,
  schedule_config jsonb,
  enabled boolean not null default false,
  active_template_id uuid not null,
  revision bigint not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_actor_kind text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_actor_kind text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint notification_rules_scope_check
    check (scope_key = 'global'),
  constraint notification_rules_workflow_check
    check (workflow_key in (
      'tasks',
      'word_retests',
      'registration',
      'transfer',
      'withdrawal',
      'makeup_requests',
      'approvals'
    )),
  constraint notification_rules_channel_check
    check (channel_key in ('in_app', 'google_chat', 'customer_message')),
  constraint notification_rules_audience_check
    check (audience_key in (
      'requester_profile',
      'primary_assignee',
      'secondary_assignee',
      'management_team',
      'requesting_teacher',
      'assigned_assistant',
      'registration_requester',
      'track_director',
      'subject_team',
      'applicant_guardian',
      'approver_profile',
      'executive_team'
    )),
  constraint notification_rules_workflow_audience_check
    check (
      (workflow_key = 'tasks' and audience_key in (
        'requester_profile', 'primary_assignee', 'secondary_assignee', 'management_team'
      ))
      or (workflow_key = 'word_retests' and audience_key in (
        'requesting_teacher', 'assigned_assistant', 'secondary_assignee', 'management_team'
      ))
      or (workflow_key = 'registration' and audience_key in (
        'registration_requester', 'track_director', 'management_team', 'subject_team',
        'applicant_guardian'
      ))
      or (workflow_key in ('transfer', 'withdrawal') and audience_key in (
        'requester_profile', 'management_team'
      ))
      or (workflow_key = 'makeup_requests' and audience_key in (
        'requester_profile', 'approver_profile', 'management_team', 'executive_team',
        'subject_team'
      ))
      or (workflow_key = 'approvals' and audience_key in (
        'requester_profile', 'approver_profile', 'management_team'
      ))
    ),
  constraint notification_rules_channel_audience_check
    check (
      (channel_key = 'google_chat' and audience_key in (
        'management_team', 'executive_team', 'subject_team'
      ))
      or (channel_key = 'customer_message' and workflow_key = 'registration' and audience_key = 'applicant_guardian')
      or (channel_key = 'in_app' and audience_key <> 'applicant_guardian')
    ),
  constraint notification_rules_schedule_check
    check (
      (
        delivery_mode = 'immediate'
        and rule_variant_key = 'immediate'
        and schedule_key is null
        and schedule_config is null
      )
      or
      (
        delivery_mode = 'scheduled'
        and schedule_key in ('previous_day_at', 'same_day_at', 'offset_before')
        and rule_variant_key = schedule_key
        and jsonb_typeof(schedule_config) = 'object'
      )
    ),
  constraint notification_rules_revision_check
    check (revision > 0),
  constraint notification_rules_created_actor_check
    check (
      (created_actor_kind = 'user' and created_by is not null)
      or (created_actor_kind = 'system' and created_by is null)
    ),
  constraint notification_rules_updated_actor_check
    check (
      (updated_actor_kind = 'user' and updated_by is not null)
      or (updated_actor_kind = 'system' and updated_by is null)
    )
);

create table dashboard_private.notification_templates (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null,
  version bigint not null,
  title_template text not null,
  body_template text not null,
  allowed_variables jsonb not null,
  payload_schema_version integer not null,
  checksum text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_actor_kind text not null,
  created_at timestamp with time zone not null default now(),
  constraint notification_templates_rule_fkey
    foreign key (rule_id)
    references dashboard_private.notification_rules (id)
    deferrable initially deferred,
  constraint notification_templates_version_check
    check (version > 0),
  constraint notification_templates_content_check
    check (
      btrim(title_template) <> ''
      and btrim(body_template) <> ''
      and btrim(checksum) <> ''
    ),
  constraint notification_templates_allowed_variables_array_check
    check (jsonb_typeof(allowed_variables) = 'array'),
  constraint notification_templates_payload_schema_version_check
    check (payload_schema_version > 0),
  constraint notification_templates_created_actor_check
    check (
      (created_actor_kind = 'user' and created_by is not null)
      or (created_actor_kind = 'system' and created_by is null)
    )
);

create unique index notification_templates_rule_version_uidx
  on dashboard_private.notification_templates(rule_id, version);
create unique index notification_templates_rule_id_id_uidx
  on dashboard_private.notification_templates(rule_id, id);

alter table dashboard_private.notification_rules
  add constraint notification_rules_active_template_fkey
  foreign key (id, active_template_id)
  references dashboard_private.notification_templates (rule_id, id)
  deferrable initially deferred;

alter table dashboard_private.notification_events
  add constraint notification_events_materialized_rule_fkey
  foreign key (materialized_rule_id)
  references dashboard_private.notification_rules(id)
  deferrable initially deferred;

create table dashboard_private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references dashboard_private.notification_events(id),
  rule_id uuid not null references dashboard_private.notification_rules(id),
  rule_revision bigint not null,
  template_id uuid not null,
  channel_key text not null,
  audience_key text not null,
  target_generation bigint not null default 0,
  target_set_hash text not null,
  target_kind text not null,
  target_key text not null,
  target_profile_id uuid references public.profiles(id) on delete set null,
  connection_key text,
  target_snapshot jsonb not null,
  parent_delivery_id uuid references dashboard_private.notification_deliveries(id),
  status text not null,
  status_reason text,
  dedupe_key text not null,
  rendered_title text not null,
  rendered_body text not null,
  href text,
  scheduled_for timestamp with time zone not null,
  attempt_count integer not null default 0,
  max_attempts integer not null,
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamp with time zone,
  next_attempt_at timestamp with time zone,
  last_attempt_started_at timestamp with time zone,
  cancel_requested_at timestamp with time zone,
  cancel_reason text,
  provider_message_id text,
  provider_response_code text,
  last_error_code text,
  last_error_summary text,
  sent_at timestamp with time zone,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint notification_deliveries_rule_template_fkey
    foreign key (rule_id, template_id)
    references dashboard_private.notification_templates(rule_id, id),
  constraint notification_deliveries_rule_revision_check
    check (rule_revision > 0),
  constraint notification_deliveries_channel_check
    check (channel_key in ('in_app', 'web_push', 'google_chat', 'customer_message')),
  constraint notification_deliveries_audience_check
    check (audience_key in (
      'requester_profile',
      'primary_assignee',
      'secondary_assignee',
      'management_team',
      'requesting_teacher',
      'assigned_assistant',
      'registration_requester',
      'track_director',
      'subject_team',
      'applicant_guardian',
      'approver_profile',
      'executive_team'
    )),
  constraint notification_deliveries_target_generation_check
    check (target_generation >= 0),
  constraint notification_deliveries_target_kind_check
    check (target_kind in (
      'profile', 'connection', 'push_subscription', 'customer_endpoint', 'audience'
    )),
  constraint notification_deliveries_target_text_check
    check (
      btrim(target_set_hash) <> ''
      and btrim(target_key) <> ''
      and btrim(dedupe_key) <> ''
    ),
  constraint notification_deliveries_target_snapshot_object_check
    check (jsonb_typeof(target_snapshot) = 'object'),
  constraint notification_deliveries_status_check
    check (status in (
      'pending',
      'claimed',
      'sending',
      'retry_wait',
      'sent',
      'delivery_unknown',
      'failed',
      'skipped',
      'disabled',
      'canceled'
    )),
  constraint notification_deliveries_status_reason_check
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
      'cutover_rollback'
    )),
  constraint notification_deliveries_status_reason_mapping_check
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
        'cutover_rollback'
      ))
    ),
  constraint notification_deliveries_attempt_count_check
    check (attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts),
  constraint notification_deliveries_retry_schedule_check
    check (
      (status = 'retry_wait' and next_attempt_at is not null)
      or (status <> 'retry_wait' and next_attempt_at is null)
    ),
  constraint notification_deliveries_state_lease_check
    check (
      (
        status in ('claimed', 'sending')
        and claimed_by is not null
        and claim_token is not null
        and lease_expires_at is not null
      )
      or (
        status not in ('claimed', 'sending')
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
    ),
  constraint notification_deliveries_href_check
    check (href is null or (href like '/admin/%' and href not like '//%'))
);

create table dashboard_private.notification_audit_logs (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null default 'global',
  entity_kind text not null,
  entity_id text not null,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_kind text not null,
  request_id uuid,
  before_summary jsonb,
  after_summary jsonb,
  reason_code text,
  created_at timestamp with time zone not null default now(),
  constraint notification_audit_logs_scope_check
    check (scope_key = 'global'),
  constraint notification_audit_logs_identity_text_check
    check (btrim(entity_kind) <> '' and btrim(entity_id) <> '' and btrim(action) <> ''),
  constraint notification_audit_logs_actor_check
    check (
      (actor_kind = 'user' and actor_profile_id is not null)
      or (actor_kind = 'system' and actor_profile_id is null)
    ),
  constraint notification_audit_logs_before_summary_check
    check (before_summary is null or jsonb_typeof(before_summary) = 'object'),
  constraint notification_audit_logs_after_summary_check
    check (after_summary is null or jsonb_typeof(after_summary) = 'object')
);

create table dashboard_private.notification_event_fanout_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references dashboard_private.notification_events(id),
  workflow_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamp with time zone default now(),
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamp with time zone,
  cursor jsonb not null default '{}'::jsonb,
  target_generation bigint not null default 0,
  target_set_hash text,
  target_snapshot jsonb,
  outcome_summary jsonb not null default '{}'::jsonb,
  last_error_code text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint notification_event_fanout_jobs_workflow_check
    check (workflow_key in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )),
  constraint notification_event_fanout_jobs_status_check
    check (status in ('pending', 'claimed', 'succeeded', 'failed')),
  constraint notification_event_fanout_jobs_attempt_check
    check (attempt_count >= 0),
  constraint notification_event_fanout_jobs_target_generation_check
    check (target_generation >= 0),
  constraint notification_event_fanout_jobs_json_check
    check (
      jsonb_typeof(cursor) = 'object'
      and (
        target_snapshot is null
        or jsonb_typeof(target_snapshot) in ('object', 'array')
      )
      and jsonb_typeof(outcome_summary) = 'object'
    ),
  constraint notification_event_fanout_jobs_state_lease_check
    check (
      (
        status = 'pending'
        and next_attempt_at is not null
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
      or (
        status = 'claimed'
        and next_attempt_at is null
        and claimed_by is not null
        and claim_token is not null
        and lease_expires_at is not null
      )
      or (
        status in ('succeeded', 'failed')
        and next_attempt_at is null
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
    )
);

create table dashboard_private.notification_rule_reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  rule_revision_map jsonb not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamp with time zone default now(),
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamp with time zone,
  cursor jsonb not null default '{}'::jsonb,
  processed_count integer not null default 0,
  canceled_count integer not null default 0,
  regenerated_count integer not null default 0,
  last_error_code text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint notification_rule_reconciliation_jobs_workflow_check
    check (workflow_key in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )),
  constraint notification_rule_reconciliation_jobs_status_check
    check (status in ('pending', 'claimed', 'succeeded', 'failed')),
  constraint notification_rule_reconciliation_jobs_counts_check
    check (
      attempt_count >= 0
      and processed_count >= 0
      and canceled_count >= 0
      and regenerated_count >= 0
    ),
  constraint notification_rule_reconciliation_jobs_json_check
    check (jsonb_typeof(rule_revision_map) = 'object' and jsonb_typeof(cursor) = 'object'),
  constraint notification_rule_reconciliation_jobs_state_lease_check
    check (
      (
        status = 'pending'
        and next_attempt_at is not null
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
      or (
        status = 'claimed'
        and next_attempt_at is null
        and claimed_by is not null
        and claim_token is not null
        and lease_expires_at is not null
      )
      or (
        status in ('succeeded', 'failed')
        and next_attempt_at is null
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
    )
);

create table dashboard_private.notification_target_reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  source_type text not null,
  source_id text not null,
  source_revision bigint,
  source_event_id uuid not null,
  reconciliation_kind text not null,
  target_generation bigint not null,
  previous_target_set_hash text,
  current_target_set_hash text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamp with time zone default now(),
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamp with time zone,
  cursor jsonb not null default '{}'::jsonb,
  canceled_count integer not null default 0,
  fanout_count integer not null default 0,
  last_error_code text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint notification_target_reconciliation_jobs_workflow_check
    check (workflow_key in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )),
  constraint notification_target_reconciliation_jobs_kind_check
    check (reconciliation_kind = 'recipient_set_changed'),
  constraint notification_target_reconciliation_jobs_status_check
    check (status in ('pending', 'claimed', 'succeeded', 'failed')),
  constraint notification_target_reconciliation_jobs_revision_check
    check (source_revision is null or source_revision > 0),
  constraint notification_target_reconciliation_jobs_generation_check
    check (target_generation > 0),
  constraint notification_target_reconciliation_jobs_counts_check
    check (attempt_count >= 0 and canceled_count >= 0 and fanout_count >= 0),
  constraint notification_target_reconciliation_jobs_cursor_check
    check (jsonb_typeof(cursor) = 'object'),
  constraint notification_target_reconciliation_jobs_state_lease_check
    check (
      (
        status = 'pending'
        and next_attempt_at is not null
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
      or (
        status = 'claimed'
        and next_attempt_at is null
        and claimed_by is not null
        and claim_token is not null
        and lease_expires_at is not null
      )
      or (
        status in ('succeeded', 'failed')
        and next_attempt_at is null
        and claimed_by is null
        and claim_token is null
        and lease_expires_at is null
      )
    )
);

create table dashboard_private.notification_request_ledger (
  request_id uuid not null,
  request_kind text not null,
  request_fingerprint text not null,
  response_payload jsonb not null,
  created_at timestamp with time zone not null default now(),
  constraint notification_request_ledger_pkey primary key (request_id),
  constraint notification_request_ledger_text_check
    check (btrim(request_kind) <> '' and btrim(request_fingerprint) <> ''),
  constraint notification_request_ledger_response_check
    check (jsonb_typeof(response_payload) = 'object')
);

create table dashboard_private.notification_worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  run_id uuid not null,
  phase text not null,
  counts jsonb not null,
  error_code text,
  created_at timestamp with time zone not null default now(),
  constraint notification_worker_heartbeats_phase_check
    check (phase in ('started', 'succeeded', 'failed')),
  constraint notification_worker_heartbeats_worker_check
    check (btrim(worker_id) <> ''),
  constraint notification_worker_heartbeats_counts_check
    check (
      jsonb_typeof(counts) = 'object'
      and counts ?& array[
        'fanout',
        'rule_reconciliation',
        'target_reconciliation',
        'deliveries',
        'reaped'
      ]
      and counts - array[
        'fanout',
        'rule_reconciliation',
        'target_reconciliation',
        'deliveries',
        'reaped'
      ] = '{}'::jsonb
      and jsonb_typeof(counts -> 'fanout') = 'number'
      and jsonb_typeof(counts -> 'rule_reconciliation') = 'number'
      and jsonb_typeof(counts -> 'target_reconciliation') = 'number'
      and jsonb_typeof(counts -> 'deliveries') = 'number'
      and jsonb_typeof(counts -> 'reaped') = 'number'
      and counts ->> 'fanout' ~ '^(0|[1-9][0-9]*)$'
      and counts ->> 'rule_reconciliation' ~ '^(0|[1-9][0-9]*)$'
      and counts ->> 'target_reconciliation' ~ '^(0|[1-9][0-9]*)$'
      and counts ->> 'deliveries' ~ '^(0|[1-9][0-9]*)$'
      and counts ->> 'reaped' ~ '^(0|[1-9][0-9]*)$'
    ),
  constraint notification_worker_heartbeats_error_check
    check (
      (phase = 'failed' and error_code is not null)
      or (phase <> 'failed' and error_code is null)
    ),
  constraint notification_worker_heartbeats_run_phase_unique
    unique (run_id, phase)
);

create table dashboard_private.notification_runtime_flags (
  flag_key text primary key,
  enabled boolean not null default false,
  revision bigint not null default 1,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamp with time zone not null default now(),
  constraint notification_runtime_flags_key_check
    check (flag_key in (
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
    )),
  constraint notification_runtime_flags_revision_check
    check (revision > 0)
);

create table dashboard_private.notification_dispatch_ownership_claims (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  occurrence_key text not null,
  rule_id uuid not null references dashboard_private.notification_rules(id),
  channel_key text not null,
  target_key text not null,
  target_generation bigint not null default 0,
  owner_kind text not null,
  owner_generation bigint not null default 0,
  state text not null default 'reserved',
  dispatch_started_at timestamp with time zone,
  dispatch_token uuid,
  provider_reference text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint notification_dispatch_ownership_claims_workflow_check
    check (workflow_key in (
      'tasks',
      'word_retests',
      'registration',
      'transfer',
      'withdrawal',
      'makeup_requests',
      'approvals'
    )),
  constraint notification_dispatch_ownership_claims_channel_check
    check (channel_key in ('in_app', 'web_push', 'google_chat', 'customer_message')),
  constraint notification_dispatch_ownership_claims_generation_check
    check (target_generation >= 0 and owner_generation >= 0),
  constraint notification_dispatch_ownership_claims_owner_check
    check (owner_kind in ('legacy', 'canonical')),
  constraint notification_dispatch_ownership_claims_state_check
    check (state in ('reserved', 'dispatch_started', 'closed')),
  constraint notification_dispatch_ownership_claims_identity_text_check
    check (btrim(occurrence_key) <> '' and btrim(target_key) <> ''),
  constraint notification_dispatch_ownership_claims_started_check
    check (
      (state = 'reserved' and dispatch_started_at is null and dispatch_token is null)
      or (
        state = 'dispatch_started'
        and dispatch_started_at is not null
        and dispatch_token is not null
      )
      or (
        state = 'closed'
        and (
          (dispatch_started_at is null and dispatch_token is null)
          or (dispatch_started_at is not null and dispatch_token is not null)
        )
      )
    )
);

create unique index notification_events_occurrence_uidx
  on dashboard_private.notification_events(
    scope_key,
    workflow_key,
    source_type,
    source_id,
    event_key,
    occurrence_key
  );
create unique index notification_rules_identity_uidx
  on dashboard_private.notification_rules(
    scope_key,
    workflow_key,
    event_key,
    channel_key,
    audience_key,
    rule_variant_key
  );
create unique index notification_deliveries_dedupe_key_uidx
  on dashboard_private.notification_deliveries(dedupe_key);
create unique index notification_deliveries_target_generation_uidx
  on dashboard_private.notification_deliveries(
    event_id,
    rule_id,
    channel_key,
    target_kind,
    target_key,
    target_generation
  );
create unique index notification_event_fanout_jobs_event_uidx
  on dashboard_private.notification_event_fanout_jobs(event_id);
create unique index notification_worker_heartbeats_run_terminal_uidx
  on dashboard_private.notification_worker_heartbeats(run_id)
  where phase in ('succeeded', 'failed');
create unique index notification_target_reconciliation_jobs_identity_uidx
  on dashboard_private.notification_target_reconciliation_jobs(
    workflow_key,
    source_type,
    source_id,
    source_revision,
    source_event_id,
    reconciliation_kind
  ) nulls not distinct;
create unique index notification_dispatch_ownership_claims_identity_uidx
  on dashboard_private.notification_dispatch_ownership_claims(
    workflow_key,
    occurrence_key,
    rule_id,
    channel_key,
    target_key,
    target_generation
  );

create index notification_deliveries_claimable_idx
  on dashboard_private.notification_deliveries(next_attempt_at, scheduled_for, created_at)
  where status in ('pending', 'retry_wait');
create index notification_event_fanout_jobs_claimable_idx
  on dashboard_private.notification_event_fanout_jobs(next_attempt_at, created_at)
  where status = 'pending';
create index notification_rule_reconciliation_jobs_claimable_idx
  on dashboard_private.notification_rule_reconciliation_jobs(next_attempt_at, created_at)
  where status = 'pending';
create index notification_target_reconciliation_jobs_claimable_idx
  on dashboard_private.notification_target_reconciliation_jobs(next_attempt_at, created_at)
  where status = 'pending';
create index notification_audit_logs_entity_created_idx
  on dashboard_private.notification_audit_logs(entity_kind, entity_id, created_at desc);

insert into dashboard_private.notification_runtime_flags(flag_key, enabled, revision)
values
  ('notification_control_plane_settings_ui_enabled', false, 1),
  ('notification_control_plane_shadow_write_enabled', false, 1),
  ('notification_control_plane_dispatch_tasks_enabled', false, 1),
  ('notification_control_plane_dispatch_word_retests_enabled', false, 1),
  ('notification_control_plane_dispatch_registration_enabled', false, 1),
  ('notification_control_plane_registration_phone_adapter_enabled', false, 1),
  ('notification_control_plane_registration_visit_adapter_enabled', false, 1),
  ('notification_control_plane_registration_solapi_adapter_enabled', false, 1),
  ('notification_control_plane_dispatch_transfer_enabled', false, 1),
  ('notification_control_plane_dispatch_withdrawal_enabled', false, 1),
  ('notification_control_plane_dispatch_makeup_requests_enabled', false, 1),
  ('notification_control_plane_dispatch_approvals_enabled', false, 1);

alter table public.dashboard_notifications
  add column if not exists source_delivery_id uuid,
  add column if not exists revoked_at timestamp with time zone,
  add column if not exists revoked_reason text;

create unique index dashboard_notifications_source_delivery_id_uidx
  on public.dashboard_notifications(source_delivery_id)
  where source_delivery_id is not null;

alter table public.google_chat_webhook_settings
  add column if not exists webhook_url_ciphertext text,
  add column if not exists webhook_url_mask text,
  add column if not exists connection_state text not null default 'legacy_active',
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists last_verified_at timestamp with time zone,
  add column if not exists last_error_code text;

alter table public.google_chat_webhook_settings
  add constraint google_chat_webhook_settings_connection_state_check
  check (connection_state in ('legacy_active', 'encrypted_active', 'disconnected')),
  add constraint google_chat_webhook_settings_revision_check
  check (revision > 0);

create table public.dashboard_notification_read_receipts (
  notification_id uuid not null
    references public.dashboard_notifications(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  read_at timestamp with time zone not null default now(),
  primary key (notification_id, profile_id)
);

create index dashboard_notification_read_receipts_profile_idx
  on public.dashboard_notification_read_receipts(profile_id, read_at desc, notification_id);

alter table public.dashboard_notification_read_receipts enable row level security;
revoke all on table public.dashboard_notification_read_receipts from public, anon, authenticated;

create policy dashboard_notification_read_receipts_select_own
  on public.dashboard_notification_read_receipts
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

grant select on table public.dashboard_notification_read_receipts to authenticated;

create view dashboard_private.notification_legacy_import_sources
with (security_invoker = true)
as
select
  source_table,
  source_present,
  detected_at
from (
  values
    (
      'public.ops_task_notification_deliveries'::text,
      pg_catalog.to_regclass('public.ops_task_notification_deliveries') is not null,
      statement_timestamp()
    ),
    (
      'public.ops_task_automation_runs'::text,
      pg_catalog.to_regclass('public.ops_task_automation_runs') is not null,
      statement_timestamp()
    )
) as optional_sources(source_table, source_present, detected_at);

revoke all on table dashboard_private.notification_legacy_import_sources
  from public, anon, authenticated;

alter table dashboard_private.notification_events enable row level security;
alter table dashboard_private.notification_rules enable row level security;
alter table dashboard_private.notification_templates enable row level security;
alter table dashboard_private.notification_deliveries enable row level security;
alter table dashboard_private.notification_audit_logs enable row level security;
alter table dashboard_private.notification_event_fanout_jobs enable row level security;
alter table dashboard_private.notification_rule_reconciliation_jobs enable row level security;
alter table dashboard_private.notification_target_reconciliation_jobs enable row level security;
alter table dashboard_private.notification_request_ledger enable row level security;
alter table dashboard_private.notification_worker_heartbeats enable row level security;
alter table dashboard_private.notification_runtime_flags enable row level security;
alter table dashboard_private.notification_dispatch_ownership_claims enable row level security;

revoke all on table dashboard_private.notification_events from public, anon, authenticated;
revoke all on table dashboard_private.notification_rules from public, anon, authenticated;
revoke all on table dashboard_private.notification_templates from public, anon, authenticated;
revoke all on table dashboard_private.notification_deliveries from public, anon, authenticated;
revoke all on table dashboard_private.notification_audit_logs from public, anon, authenticated;
revoke all on table dashboard_private.notification_event_fanout_jobs from public, anon, authenticated;
revoke all on table dashboard_private.notification_rule_reconciliation_jobs from public, anon, authenticated;
revoke all on table dashboard_private.notification_target_reconciliation_jobs from public, anon, authenticated;
revoke all on table dashboard_private.notification_request_ledger from public, anon, authenticated;
revoke all on table dashboard_private.notification_worker_heartbeats from public, anon, authenticated;
revoke all on table dashboard_private.notification_runtime_flags from public, anon, authenticated;
revoke all on table dashboard_private.notification_dispatch_ownership_claims from public, anon, authenticated;

grant all on table dashboard_private.notification_events to service_role;
grant all on table dashboard_private.notification_rules to service_role;
grant all on table dashboard_private.notification_templates to service_role;
grant all on table dashboard_private.notification_deliveries to service_role;
grant all on table dashboard_private.notification_audit_logs to service_role;
grant all on table dashboard_private.notification_event_fanout_jobs to service_role;
grant all on table dashboard_private.notification_rule_reconciliation_jobs to service_role;
grant all on table dashboard_private.notification_target_reconciliation_jobs to service_role;
grant all on table dashboard_private.notification_request_ledger to service_role;
grant all on table dashboard_private.notification_worker_heartbeats to service_role;
grant all on table dashboard_private.notification_runtime_flags to service_role;
grant all on table dashboard_private.notification_dispatch_ownership_claims to service_role;
grant select on table dashboard_private.notification_legacy_import_sources to service_role;
grant usage on schema dashboard_private to service_role;

commit;
