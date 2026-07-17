import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const expandMigrationUrl = new URL(
  "../supabase/migrations/20260716110000_notification_control_plane_expand.sql",
  import.meta.url,
)
const pgTapUrl = new URL(
  "../supabase/tests/notification_control_plane_schema_test.sql",
  import.meta.url,
)

const PRIVATE_TABLES = [
  "notification_events",
  "notification_rules",
  "notification_templates",
  "notification_deliveries",
  "notification_audit_logs",
  "notification_event_fanout_jobs",
  "notification_rule_reconciliation_jobs",
  "notification_target_reconciliation_jobs",
  "notification_request_ledger",
  "notification_worker_heartbeats",
  "notification_runtime_flags",
  "notification_dispatch_ownership_claims",
]

const RUNTIME_FLAGS = [
  "notification_control_plane_settings_ui_enabled",
  "notification_control_plane_shadow_write_enabled",
  "notification_control_plane_dispatch_tasks_enabled",
  "notification_control_plane_dispatch_word_retests_enabled",
  "notification_control_plane_dispatch_registration_enabled",
  "notification_control_plane_registration_phone_adapter_enabled",
  "notification_control_plane_registration_visit_adapter_enabled",
  "notification_control_plane_registration_solapi_adapter_enabled",
  "notification_control_plane_dispatch_transfer_enabled",
  "notification_control_plane_dispatch_withdrawal_enabled",
  "notification_control_plane_dispatch_makeup_requests_enabled",
  "notification_control_plane_dispatch_approvals_enabled",
]

const LEGACY_TABLES = [
  "dashboard_notifications",
  "dashboard_push_subscriptions",
  "google_chat_webhook_settings",
  "makeup_notification_settings",
  "makeup_notification_deliveries",
  "ops_registration_messages",
]

const LEGACY_FUNCTIONS = [
  ["claim_registration_admission_message\\s*\\(\\s*uuid\\s*,\\s*text\\s*\\)", "authenticated"],
  ["finalize_registration_admission_message\\s*\\(\\s*uuid\\s*,\\s*text\\s*,\\s*jsonb\\s*\\)", "service_role"],
  ["reconcile_registration_admission_message\\s*\\(\\s*uuid\\s*,\\s*text\\s*,\\s*jsonb\\s*,\\s*text\\s*,\\s*text\\s*\\)", "authenticated"],
  ["release_registration_admission_message_retry\\s*\\(\\s*uuid\\s*,\\s*jsonb\\s*,\\s*text\\s*,\\s*text\\s*\\)", "authenticated"],
]

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeSql(source) {
  return source.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

function createTableBlock(source, qualifiedName) {
  const startPattern = new RegExp(
    `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+${escapeRegex(qualifiedName)}\\s*\\(`,
    "i",
  )
  const match = startPattern.exec(source)
  assert.ok(match, `missing create table ${qualifiedName}`)
  const end = source.indexOf("\n);", match.index)
  assert.notEqual(end, -1, `unterminated create table ${qualifiedName}`)
  return source.slice(match.index, end + 3)
}

function assertColumnsInOrder(block, columns, tableName) {
  let cursor = -1
  for (const column of columns) {
    const matcher = new RegExp(`(?:^|\\n)\\s*${escapeRegex(column)}\\s+`, "im")
    const match = matcher.exec(block.slice(cursor + 1))
    assert.ok(match, `${tableName} is missing ordered column ${column}`)
    cursor += match.index + match[0].length
  }
}

function columnDefinition(block, column, tableName) {
  const matcher = new RegExp(`^\\s*${escapeRegex(column)}\\s+([^\\n]+)`, "im")
  const match = matcher.exec(block)
  assert.ok(match, `${tableName} is missing column definition ${column}`)
  return match[1].replace(/,\s*$/, "").trim()
}

function assertColumnShapes(block, tableName, { types, notNull = [], nullable = [], defaults = {} }) {
  for (const [type, columns] of Object.entries(types)) {
    for (const column of columns) {
      assert.match(
        columnDefinition(block, column, tableName),
        new RegExp(`^${type}(?:\\s|$)`, "i"),
        `${tableName}.${column} must use ${type}`,
      )
    }
  }

  for (const column of notNull) {
    assert.match(
      columnDefinition(block, column, tableName),
      /\bnot\s+null\b/i,
      `${tableName}.${column} must be NOT NULL`,
    )
  }
  for (const column of nullable) {
    assert.doesNotMatch(
      columnDefinition(block, column, tableName),
      /\b(?:not\s+null|primary\s+key)\b/i,
      `${tableName}.${column} must remain nullable`,
    )
  }
  for (const [column, pattern] of Object.entries(defaults)) {
    assert.match(
      columnDefinition(block, column, tableName),
      pattern,
      `${tableName}.${column} has the wrong default`,
    )
  }
}

async function readExpandMigration() {
  return readFile(expandMigrationUrl, "utf8")
}

test("notification expand migration is one forward-only transaction", async () => {
  const source = await readExpandMigration()
  const trimmed = source.trim()

  assert.match(trimmed, /^begin;\s*/i)
  assert.match(trimmed, /commit;$/i)
  assert.equal((trimmed.match(/^begin;$/gim) || []).length, 1)
  assert.equal((trimmed.match(/^commit;$/gim) || []).length, 1)
  assert.match(source, /set\s+local\s+lock_timeout\s*=\s*'5s'\s*;/i)
  assert.doesNotMatch(source, /\bdrop\s+table\b/i)
  assert.doesNotMatch(source, /\btruncate\b/i)
  assert.doesNotMatch(source, /\balter\s+table\s+(?:public\.)?(?:dashboard_notifications|dashboard_push_subscriptions|google_chat_webhook_settings|makeup_notification_settings|makeup_notification_deliveries|ops_registration_messages)\b[\s\S]*?\bdrop\s+(?:column|constraint)\b/i)
  assert.doesNotMatch(source, /common_notification_control_plane_runtime_version/i)
})

test("expand migration creates every canonical and durable private relation with the locked columns", async () => {
  const source = await readExpandMigration()

  for (const table of PRIVATE_TABLES) {
    assert.match(
      source,
      new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+dashboard_private\\.${table}\\b`, "i"),
      `missing dashboard_private.${table}`,
    )
  }
  assert.match(
    source,
    /create\s+(?:or\s+replace\s+)?view\s+dashboard_private\.notification_legacy_import_sources\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
  )
  assert.match(source, /source_table[\s\S]*source_present[\s\S]*detected_at/i)

  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_events"), [
    "id", "scope_key", "workflow_key", "event_key", "source_type", "source_id",
    "source_revision", "occurrence_key", "actor_profile_id", "occurred_at",
    "payload_schema_version", "payload", "rule_snapshot", "materialized_rule_id",
    "materialized_rule_revision", "created_at",
  ], "notification_events")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_rules"), [
    "id", "scope_key", "workflow_key", "event_key", "channel_key", "audience_key",
    "rule_variant_key", "delivery_mode", "schedule_key", "schedule_config", "enabled",
    "active_template_id", "revision", "created_by", "created_actor_kind", "updated_by",
    "updated_actor_kind", "created_at", "updated_at",
  ], "notification_rules")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_templates"), [
    "id", "rule_id", "version", "title_template", "body_template", "allowed_variables",
    "payload_schema_version", "checksum", "created_by", "created_actor_kind", "created_at",
  ], "notification_templates")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_deliveries"), [
    "id", "event_id", "rule_id", "rule_revision", "template_id", "channel_key",
    "audience_key", "target_generation", "target_set_hash", "target_kind", "target_key",
    "target_profile_id", "connection_key", "target_snapshot", "parent_delivery_id", "status",
    "status_reason", "dedupe_key", "rendered_title", "rendered_body", "href", "scheduled_for",
    "attempt_count", "max_attempts", "claimed_by", "claim_token", "lease_expires_at",
    "next_attempt_at", "last_attempt_started_at", "cancel_requested_at", "cancel_reason",
    "provider_message_id", "provider_response_code", "last_error_code", "last_error_summary",
    "sent_at", "resolved_at", "created_at", "updated_at",
  ], "notification_deliveries")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_audit_logs"), [
    "id", "scope_key", "entity_kind", "entity_id", "action", "actor_profile_id",
    "actor_kind", "request_id", "before_summary", "after_summary", "reason_code", "created_at",
  ], "notification_audit_logs")

  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_event_fanout_jobs"), [
    "id", "event_id", "workflow_key", "status", "attempt_count", "next_attempt_at",
    "claimed_by", "claim_token", "lease_expires_at", "cursor", "target_generation",
    "target_set_hash", "target_snapshot", "outcome_summary", "last_error_code", "created_at",
    "completed_at", "updated_at",
  ], "notification_event_fanout_jobs")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_rule_reconciliation_jobs"), [
    "id", "workflow_key", "rule_revision_map", "status", "attempt_count", "next_attempt_at",
    "claimed_by", "claim_token", "lease_expires_at", "cursor", "processed_count",
    "canceled_count", "regenerated_count", "last_error_code", "created_at", "completed_at",
    "updated_at",
  ], "notification_rule_reconciliation_jobs")
  const targetJobs = createTableBlock(source, "dashboard_private.notification_target_reconciliation_jobs")
  assertColumnsInOrder(targetJobs, [
    "id", "workflow_key", "source_type", "source_id", "source_revision", "source_event_id",
    "reconciliation_kind", "target_generation", "previous_target_set_hash",
    "current_target_set_hash", "status", "attempt_count", "next_attempt_at", "claimed_by",
    "claim_token", "lease_expires_at", "cursor", "canceled_count", "fanout_count",
    "last_error_code", "created_at", "completed_at", "updated_at",
  ], "notification_target_reconciliation_jobs")
  assert.doesNotMatch(targetJobs, /(?:^|\n)\s*rule_id\s+/im)
  assert.doesNotMatch(targetJobs, /foreign\s+key\s*\(\s*source_event_id\s*\)[\s\S]*?notification_events/i)

  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_request_ledger"), [
    "request_id", "request_kind", "request_fingerprint", "response_payload", "created_at",
  ], "notification_request_ledger")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_worker_heartbeats"), [
    "id", "worker_id", "run_id", "phase", "counts", "error_code", "created_at",
  ], "notification_worker_heartbeats")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_runtime_flags"), [
    "flag_key", "enabled", "revision", "updated_by", "updated_at",
  ], "notification_runtime_flags")
  assertColumnsInOrder(createTableBlock(source, "dashboard_private.notification_dispatch_ownership_claims"), [
    "id", "workflow_key", "occurrence_key", "rule_id", "channel_key", "target_key",
    "target_generation", "owner_kind", "owner_generation", "state", "dispatch_started_at",
    "dispatch_token", "provider_reference", "created_at", "updated_at",
  ], "notification_dispatch_ownership_claims")
})

test("core canonical columns lock their SQL types, nullability, defaults, keys, and ownership", async () => {
  const source = await readExpandMigration()
  const normalized = normalizeSql(source)
  const events = createTableBlock(source, "dashboard_private.notification_events")
  const rules = createTableBlock(source, "dashboard_private.notification_rules")
  const templates = createTableBlock(source, "dashboard_private.notification_templates")
  const deliveries = createTableBlock(source, "dashboard_private.notification_deliveries")

  assertColumnShapes(events, "notification_events", {
    types: {
      uuid: ["id", "actor_profile_id", "materialized_rule_id"],
      text: ["scope_key", "workflow_key", "event_key", "source_type", "source_id", "occurrence_key"],
      bigint: ["source_revision", "materialized_rule_revision"],
      integer: ["payload_schema_version"],
      jsonb: ["payload", "rule_snapshot"],
      "timestamp\\s+with\\s+time\\s+zone": ["occurred_at", "created_at"],
    },
    notNull: [
      "scope_key", "workflow_key", "event_key", "source_type", "source_id", "occurrence_key",
      "occurred_at", "payload_schema_version", "payload", "rule_snapshot", "created_at",
    ],
    nullable: ["source_revision", "actor_profile_id", "materialized_rule_id", "materialized_rule_revision"],
    defaults: {
      id: /\bprimary\s+key\s+default\s+gen_random_uuid\(\)/i,
      scope_key: /\bdefault\s+'global'/i,
      created_at: /\bdefault\s+now\(\)/i,
    },
  })

  assertColumnShapes(rules, "notification_rules", {
    types: {
      uuid: ["id", "active_template_id", "created_by", "updated_by"],
      text: [
        "scope_key", "workflow_key", "event_key", "channel_key", "audience_key",
        "rule_variant_key", "delivery_mode", "schedule_key", "created_actor_kind",
        "updated_actor_kind",
      ],
      jsonb: ["schedule_config"],
      boolean: ["enabled"],
      bigint: ["revision"],
      "timestamp\\s+with\\s+time\\s+zone": ["created_at", "updated_at"],
    },
    notNull: [
      "scope_key", "workflow_key", "event_key", "channel_key", "audience_key",
      "rule_variant_key", "delivery_mode", "enabled", "active_template_id", "revision",
      "created_actor_kind", "updated_actor_kind", "created_at", "updated_at",
    ],
    nullable: ["schedule_key", "schedule_config", "created_by", "updated_by"],
    defaults: {
      id: /\bprimary\s+key\s+default\s+gen_random_uuid\(\)/i,
      enabled: /\bdefault\s+false/i,
      revision: /\bdefault\s+1/i,
      created_at: /\bdefault\s+now\(\)/i,
      updated_at: /\bdefault\s+now\(\)/i,
    },
  })

  assertColumnShapes(templates, "notification_templates", {
    types: {
      uuid: ["id", "rule_id", "created_by"],
      bigint: ["version"],
      text: ["title_template", "body_template", "checksum", "created_actor_kind"],
      jsonb: ["allowed_variables"],
      integer: ["payload_schema_version"],
      "timestamp\\s+with\\s+time\\s+zone": ["created_at"],
    },
    notNull: [
      "rule_id", "version", "title_template", "body_template", "allowed_variables",
      "payload_schema_version", "checksum", "created_actor_kind", "created_at",
    ],
    nullable: ["created_by"],
    defaults: {
      id: /\bprimary\s+key\s+default\s+gen_random_uuid\(\)/i,
      created_at: /\bdefault\s+now\(\)/i,
    },
  })

  assertColumnShapes(deliveries, "notification_deliveries", {
    types: {
      uuid: [
        "id", "event_id", "rule_id", "template_id", "target_profile_id",
        "parent_delivery_id", "claim_token",
      ],
      bigint: ["rule_revision", "target_generation"],
      text: [
        "channel_key", "audience_key", "target_set_hash", "target_kind", "target_key",
        "connection_key", "status", "status_reason", "dedupe_key", "rendered_title",
        "rendered_body", "href", "claimed_by", "cancel_reason", "provider_message_id",
        "provider_response_code", "last_error_code", "last_error_summary",
      ],
      jsonb: ["target_snapshot"],
      integer: ["attempt_count", "max_attempts"],
      "timestamp\\s+with\\s+time\\s+zone": [
        "scheduled_for", "lease_expires_at", "next_attempt_at", "last_attempt_started_at",
        "cancel_requested_at", "sent_at", "resolved_at", "created_at", "updated_at",
      ],
    },
    notNull: [
      "event_id", "rule_id", "rule_revision", "template_id", "channel_key", "audience_key",
      "target_generation", "target_set_hash", "target_kind", "target_key", "target_snapshot",
      "status", "dedupe_key", "rendered_title", "rendered_body", "scheduled_for",
      "attempt_count", "max_attempts", "created_at", "updated_at",
    ],
    nullable: [
      "target_profile_id", "connection_key", "parent_delivery_id", "status_reason", "href",
      "claimed_by", "claim_token", "lease_expires_at", "next_attempt_at",
      "last_attempt_started_at", "cancel_requested_at", "cancel_reason", "provider_message_id",
      "provider_response_code", "last_error_code", "last_error_summary", "sent_at", "resolved_at",
    ],
    defaults: {
      id: /\bprimary\s+key\s+default\s+gen_random_uuid\(\)/i,
      target_generation: /\bdefault\s+0/i,
      attempt_count: /\bdefault\s+0/i,
      created_at: /\bdefault\s+now\(\)/i,
      updated_at: /\bdefault\s+now\(\)/i,
    },
  })

  assert.match(normalized, /notification_events[^;]*actor_profile_id uuid references public\.profiles\s*\(\s*id\s*\) on delete set null/)
  assert.match(normalized, /notification_templates_rule_fkey foreign key \(rule_id\) references dashboard_private\.notification_rules \(id\)/)
  assert.match(normalized, /notification_deliveries_rule_template_fkey foreign key \(rule_id, template_id\) references dashboard_private\.notification_templates\s*\(\s*rule_id\s*,\s*id\s*\)/)
  assert.match(normalized, /constraint notification_request_ledger_pkey primary key \(request_id\)/)
})

test("expand migration fixes immutable identities, actor constraints, deferred templates, and status registries", async () => {
  const source = await readExpandMigration()
  const normalized = normalizeSql(source)
  const events = createTableBlock(source, "dashboard_private.notification_events")
  const rules = createTableBlock(source, "dashboard_private.notification_rules")
  const templates = createTableBlock(source, "dashboard_private.notification_templates")
  const deliveries = createTableBlock(source, "dashboard_private.notification_deliveries")
  const audit = createTableBlock(source, "dashboard_private.notification_audit_logs")

  for (const indexName of [
    "notification_events_occurrence_uidx",
    "notification_rules_identity_uidx",
    "notification_templates_rule_version_uidx",
    "notification_templates_rule_id_id_uidx",
    "notification_deliveries_dedupe_key_uidx",
    "notification_deliveries_target_generation_uidx",
    "notification_event_fanout_jobs_event_uidx",
    "notification_worker_heartbeats_run_terminal_uidx",
    "notification_target_reconciliation_jobs_identity_uidx",
    "notification_dispatch_ownership_claims_identity_uidx",
    "dashboard_notifications_source_delivery_id_uidx",
  ]) {
    assert.match(source, new RegExp(`create\\s+unique\\s+index(?:\\s+if\\s+not\\s+exists)?\\s+${indexName}\\b`, "i"))
  }
  for (const indexName of [
    "notification_deliveries_claimable_idx",
    "notification_event_fanout_jobs_claimable_idx",
    "notification_rule_reconciliation_jobs_claimable_idx",
    "notification_target_reconciliation_jobs_claimable_idx",
    "notification_audit_logs_entity_created_idx",
    "dashboard_notification_read_receipts_profile_idx",
  ]) {
    assert.match(source, new RegExp(`create\\s+index(?:\\s+if\\s+not\\s+exists)?\\s+${indexName}\\b`, "i"))
  }

  assert.match(normalized, /notification_events_occurrence_uidx[^;]*scope_key[^;]*workflow_key[^;]*source_type[^;]*source_id[^;]*event_key[^;]*occurrence_key/)
  assert.match(normalized, /notification_rules_identity_uidx[^;]*scope_key[^;]*workflow_key[^;]*event_key[^;]*channel_key[^;]*audience_key[^;]*rule_variant_key/)
  assert.match(normalized, /notification_deliveries_target_generation_uidx[^;]*event_id[^;]*rule_id[^;]*channel_key[^;]*target_kind[^;]*target_key[^;]*target_generation/)
  assert.match(normalized, /notification_target_reconciliation_jobs_identity_uidx[^;]*workflow_key[^;]*source_type[^;]*source_id[^;]*source_revision[^;]*source_event_id[^;]*reconciliation_kind[^;]*nulls not distinct/)
  assert.match(normalized, /notification_dispatch_ownership_claims_identity_uidx[^;]*workflow_key[^;]*occurrence_key[^;]*rule_id[^;]*channel_key[^;]*target_key[^;]*target_generation/)
  assert.doesNotMatch(normalized.match(/notification_dispatch_ownership_claims_identity_uidx[^;]*/)?.[0] ?? "", /owner_generation|dispatch_token/)
  assert.match(normalized, /notification_worker_heartbeats_run_terminal_uidx[^;]*run_id[^;]*where phase in \('succeeded', 'failed'\)/)

  assert.match(events, /materialized_rule_id[\s\S]*materialized_rule_revision/i)
  assert.match(events, /check\s*\([\s\S]*materialized_rule_id\s+is\s+null[\s\S]*materialized_rule_revision\s+is\s+null/i)
  assert.match(rules, /created_actor_kind\s*=\s*'user'[^;]*created_by\s+is\s+not\s+null[^;]*created_actor_kind\s*=\s*'system'[^;]*created_by\s+is\s+null/i)
  assert.match(rules, /updated_actor_kind\s*=\s*'user'[^;]*updated_by\s+is\s+not\s+null[^;]*updated_actor_kind\s*=\s*'system'[^;]*updated_by\s+is\s+null/i)
  assert.match(templates, /created_actor_kind\s*=\s*'user'[^;]*created_by\s+is\s+not\s+null[^;]*created_actor_kind\s*=\s*'system'[^;]*created_by\s+is\s+null/i)
  assert.match(audit, /actor_kind\s*=\s*'user'[^;]*actor_profile_id\s+is\s+not\s+null[^;]*actor_kind\s*=\s*'system'[^;]*actor_profile_id\s+is\s+null/i)

  assert.match(normalized, /constraint notification_templates_rule_fkey foreign key \(rule_id\) references dashboard_private\.notification_rules \(id\)[^;]*deferrable initially deferred/)
  assert.match(normalized, /constraint notification_rules_active_template_fkey foreign key \(id, active_template_id\) references dashboard_private\.notification_templates \(rule_id, id\)[^;]*deferrable initially deferred/)
  assert.match(deliveries, /target_generation\s+bigint\s+not\s+null\s+default\s+0/i)
  assert.doesNotMatch(deliveries, /(?:^|\n)\s*owner_generation\s+/im)
  for (const status of [
    "pending", "claimed", "sending", "retry_wait", "sent", "delivery_unknown",
    "failed", "skipped", "disabled", "canceled",
  ]) {
    assert.match(deliveries, new RegExp(`'${status}'`))
  }
  for (const reason of [
    "provider_rate_limited", "provider_definite_rejection", "transient_pre_dispatch_failure",
    "connection_restored_manual_retry", "manual_retry_approved", "provider_timeout_after_dispatch",
    "connection_reset_after_dispatch", "worker_lost_after_send_start", "provider_ambiguous_response",
    "connection_missing", "render_validation_failed", "schedule_validation_failed",
    "payload_schema_unsupported", "max_attempts_exhausted", "retry_window_closed", "shadow_mode",
    "no_recipient", "workflow_scope_mismatch", "not_applicable", "legacy_skipped",
    "legacy_deduped", "rule_disabled", "source_status_changed", "source_schedule_changed",
    "source_revision_changed", "rule_revision_changed", "recipient_revoked", "cutover_rollback",
  ]) {
    assert.match(deliveries, new RegExp(`'${reason}'`))
  }
  for (const [status, reasons] of [
    ["retry_wait", [
      "provider_rate_limited", "provider_definite_rejection", "transient_pre_dispatch_failure",
      "connection_restored_manual_retry", "manual_retry_approved",
    ]],
    ["delivery_unknown", [
      "provider_timeout_after_dispatch", "connection_reset_after_dispatch",
      "worker_lost_after_send_start", "provider_ambiguous_response",
    ]],
    ["failed", [
      "connection_missing", "provider_definite_rejection", "render_validation_failed",
      "schedule_validation_failed", "payload_schema_unsupported", "max_attempts_exhausted",
      "retry_window_closed",
    ]],
    ["skipped", [
      "shadow_mode", "no_recipient", "workflow_scope_mismatch", "not_applicable",
      "legacy_skipped", "legacy_deduped",
    ]],
    ["canceled", [
      "source_status_changed", "source_schedule_changed", "source_revision_changed",
      "rule_revision_changed", "recipient_revoked", "cutover_rollback",
    ]],
  ]) {
    const mapping = new RegExp(
      `status\\s*=\\s*'${status}'[\\s\\S]*?status_reason\\s+in\\s*\\([\\s\\S]*?${reasons
        .map((reason) => `'${reason}'`)
        .join("[\\s\\S]*?")}[^;]*?\\)`,
      "i",
    )
    assert.match(deliveries, mapping, `${status} must own its exact reason family`)
  }
  assert.match(deliveries, /status\s*=\s*'disabled'[\s\S]*status_reason\s*=\s*'rule_disabled'/i)
  assert.match(deliveries, /status\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*,\s*'sending'\s*,\s*'sent'\s*\)[\s\S]*status_reason\s+is\s+null/i)
  assert.match(deliveries, /status\s*=\s*'retry_wait'[\s\S]*next_attempt_at\s+is\s+not\s+null[\s\S]*status\s*<>\s*'retry_wait'[\s\S]*next_attempt_at\s+is\s+null/i)
  assert.match(deliveries, /status\s+in\s*\(\s*'claimed'\s*,\s*'sending'\s*\)[\s\S]*claimed_by\s+is\s+not\s+null[\s\S]*claim_token\s+is\s+not\s+null[\s\S]*lease_expires_at\s+is\s+not\s+null/i)
  assert.match(deliveries, /status\s+not\s+in\s*\(\s*'claimed'\s*,\s*'sending'\s*\)[\s\S]*claimed_by\s+is\s+null[\s\S]*claim_token\s+is\s+null[\s\S]*lease_expires_at\s+is\s+null/i)

  for (const table of [
    "notification_event_fanout_jobs",
    "notification_rule_reconciliation_jobs",
    "notification_target_reconciliation_jobs",
  ]) {
    const queue = createTableBlock(source, `dashboard_private.${table}`)
    for (const workflow of [
      "tasks", "word_retests", "registration", "transfer", "withdrawal",
      "makeup_requests", "approvals",
    ]) {
      assert.match(queue, new RegExp(`'${workflow}'`), `${table} must close its workflow registry`)
    }
    assert.match(queue, /status\s*=\s*'pending'[\s\S]*next_attempt_at\s+is\s+not\s+null[\s\S]*claimed_by\s+is\s+null[\s\S]*claim_token\s+is\s+null[\s\S]*lease_expires_at\s+is\s+null/i)
    assert.match(queue, /status\s*=\s*'claimed'[\s\S]*next_attempt_at\s+is\s+null[\s\S]*claimed_by\s+is\s+not\s+null[\s\S]*claim_token\s+is\s+not\s+null[\s\S]*lease_expires_at\s+is\s+not\s+null/i)
    assert.match(queue, /status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*\)[\s\S]*next_attempt_at\s+is\s+null[\s\S]*claimed_by\s+is\s+null[\s\S]*claim_token\s+is\s+null[\s\S]*lease_expires_at\s+is\s+null/i)
  }

  const heartbeat = createTableBlock(source, "dashboard_private.notification_worker_heartbeats")
  assert.doesNotMatch(heartbeat, /(?:^|\n)\s*(?:payload|body|target|connection|secret|phone|webhook)\w*\s+/im)
  for (const countKey of ["fanout", "rule_reconciliation", "target_reconciliation", "deliveries", "reaped"]) {
    assert.match(heartbeat, new RegExp(`'${countKey}'`))
    assert.match(heartbeat, new RegExp(`jsonb_typeof\\(counts\\s*->\\s*'${countKey}'\\)\\s*=\\s*'number'`, "i"))
    assert.match(heartbeat, new RegExp(`counts\\s*->>\\s*'${countKey}'\\s*~`, "i"))
  }
  assert.match(heartbeat, /phase\s+in\s*\(\s*'started'\s*,\s*'succeeded'\s*,\s*'failed'\s*\)/i)
  assert.match(heartbeat, /counts\s*\?&\s*array[\s\S]*counts\s*-\s*array/i)

  const ownership = createTableBlock(source, "dashboard_private.notification_dispatch_ownership_claims")
  assert.match(ownership, /(?:^|\n)\s*dispatch_token\s+uuid\s*,/im)
  assert.match(ownership, /state\s*=\s*'dispatch_started'[\s\S]*dispatch_token\s+is\s+not\s+null/i)
})

test("all private notification relations are RLS-protected and browser roles receive no direct access", async () => {
  const source = await readExpandMigration()

  for (const table of PRIVATE_TABLES) {
    assert.match(
      source,
      new RegExp(`alter\\s+table\\s+dashboard_private\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `${table} must enable RLS`,
    )
    assert.match(
      source,
      new RegExp(`revoke\\s+all(?:\\s+privileges)?\\s+on(?:\\s+table)?\\s+dashboard_private\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, "i"),
      `${table} must revoke browser roles`,
    )
    assert.match(
      source,
      new RegExp(`grant\\s+all\\s+on(?:\\s+table)?\\s+dashboard_private\\.${table}\\s+to\\s+service_role`, "i"),
      `${table} must grant its worker access to service_role`,
    )
  }

  assert.match(
    source,
    /revoke\s+all(?:\s+privileges)?\s+on(?:\s+table)?\s+dashboard_private\.notification_legacy_import_sources\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  )
  assert.match(source, /grant\s+select\s+on(?:\s+table)?\s+dashboard_private\.notification_legacy_import_sources\s+to\s+service_role/i)
  assert.match(source, /grant\s+usage\s+on\s+schema\s+dashboard_private\s+to\s+service_role/i)

  assert.doesNotMatch(source, /revoke\s+all(?:\s+privileges)?\s+on\s+schema\s+dashboard_private\s+from[^;]*authenticated/i)
  assert.doesNotMatch(source, /grant[^;]*on(?:\s+table)?\s+dashboard_private\.notification_\w+[^;]*to\s+(?:anon|authenticated)\b/i)
  assert.doesNotMatch(source, /create\s+(?:or\s+replace\s+)?view\s+public\.[\s\S]*?dashboard_private\.notification_/i)
})

test("receipt boundary and compatibility expansion preserve every legacy writer and historical row", async () => {
  const source = await readExpandMigration()
  const receipts = createTableBlock(source, "public.dashboard_notification_read_receipts")
  const normalized = normalizeSql(source)

  assertColumnsInOrder(receipts, ["notification_id", "profile_id", "read_at"], "dashboard_notification_read_receipts")
  assert.match(receipts, /primary\s+key\s*\(\s*notification_id\s*,\s*profile_id\s*\)/i)
  assert.match(receipts, /notification_id[\s\S]*references\s+public\.dashboard_notifications\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i)
  assert.match(receipts, /profile_id[\s\S]*references\s+public\.profiles\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i)
  assert.match(source, /alter\s+table\s+public\.dashboard_notification_read_receipts\s+enable\s+row\s+level\s+security/i)
  assert.match(source, /create\s+policy\s+dashboard_notification_read_receipts_select_own[\s\S]*?for\s+select[\s\S]*?to\s+authenticated[\s\S]*?(?:profile_id[\s\S]*?(?:select\s+)?auth\.uid\(\)|(?:select\s+)?auth\.uid\(\)[\s\S]*?profile_id)/i)
  assert.match(source, /grant\s+select\s+on(?:\s+table)?\s+public\.dashboard_notification_read_receipts\s+to\s+authenticated/i)
  assert.doesNotMatch(source, /grant\s+(?:insert|update|delete|all)[^;]*dashboard_notification_read_receipts[^;]*authenticated/i)

  assert.match(normalized, /alter table public\.dashboard_notifications[^;]*add column if not exists source_delivery_id uuid[^;]*add column if not exists revoked_at timestamp with time zone[^;]*add column if not exists revoked_reason text/)
  assert.match(normalized, /alter table public\.google_chat_webhook_settings[^;]*add column if not exists webhook_url_ciphertext text[^;]*add column if not exists webhook_url_mask text[^;]*add column if not exists connection_state text not null default 'legacy_active'[^;]*add column if not exists revision bigint not null default 1[^;]*add column if not exists updated_by uuid references public\.profiles\s*\(\s*id\s*\) on delete set null[^;]*add column if not exists last_verified_at timestamp with time zone[^;]*add column if not exists last_error_code text/)
  assert.match(source, /connection_state[\s\S]*'legacy_active'[\s\S]*'encrypted_active'[\s\S]*'disconnected'/i)
  assert.doesNotMatch(source, /alter\s+table\s+public\.google_chat_webhook_settings[\s\S]*?alter\s+column\s+webhook_url\s+drop\s+not\s+null/i)

  for (const table of LEGACY_TABLES) {
    assert.doesNotMatch(source, new RegExp(`\\b(?:delete\\s+from|truncate(?:\\s+table)?|update)\\s+public\\.${table}\\b`, "i"))
    assert.doesNotMatch(source, new RegExp(`revoke[^;]*on(?:\\s+table)?\\s+public\\.${table}[^;]*from\\s+(?:public|anon|authenticated|service_role)`, "i"))
  }
  for (const [signature, role] of LEGACY_FUNCTIONS) {
    assert.doesNotMatch(
      source,
      new RegExp(`revoke[^;]*on\\s+function\\s+public\\.${signature}[^;]*from\\s+${role}`, "i"),
    )
  }
  assert.doesNotMatch(source, /insert\s+into\s+dashboard_private\.notification_(?:events|rules|templates|deliveries)[\s\S]*?select[\s\S]*?from\s+public\.(?:dashboard_notifications|makeup_notification_deliveries|ops_registration_messages)/i)
})

test("runtime flags and optional live-only sources install fail-closed without importing legacy rows", async () => {
  const source = await readExpandMigration()
  const normalized = normalizeSql(source)

  assert.equal(RUNTIME_FLAGS.length, 12)
  for (const flag of RUNTIME_FLAGS) {
    assert.equal((source.match(new RegExp(`'${flag}'`, "g")) || []).length >= 1, true, `missing ${flag}`)
  }
  assert.match(normalized, /insert into dashboard_private\.notification_runtime_flags[^;]*enabled[^;]*false/)
  assert.doesNotMatch(normalized, /insert into dashboard_private\.notification_runtime_flags[^;]*\btrue\b/)

  for (const table of ["ops_task_notification_deliveries", "ops_task_automation_runs"]) {
    assert.match(source, new RegExp(`(?:pg_catalog\\.)?to_regclass\\(\\s*'public\\.${table}'\\s*\\)`, "i"))
    assert.match(source, new RegExp(`'public\\.${table}'[\\s\\S]*?(?:pg_catalog\\.)?to_regclass`, "i"))
    assert.doesNotMatch(source, new RegExp(`(?:from|join)\\s+public\\.${table}\\b`, "i"))
  }
  assert.match(source, /create\s+(?:or\s+replace\s+)?view\s+dashboard_private\.notification_legacy_import_sources/i)
  assert.doesNotMatch(source, /notification_legacy_import_sources[^;]*?(?:payload|row_data|snapshot)/i)
})

test("pgTAP schema packet covers both optional-source states and every security gate", async () => {
  const source = await readFile(pgTapUrl, "utf8")
  const trimmed = source.trim()

  assert.match(trimmed, /^begin;\s*/i)
  assert.match(source, /select\s+no_plan\(\)/i)
  assert.match(trimmed, /rollback;$/i)
  assert.match(source, /notification_target_reconciliation_jobs_identity_uidx/i)
  assert.match(source, /nulls\s+not\s+distinct/i)
  assert.match(source, /source_event_id[\s\S]*notification_events/i)
  assert.match(source, /dashboard_notification_read_receipts_select_own/i)
  assert.match(source, /has_table_privilege\(\s*'authenticated'/i)
  assert.match(source, /has_table_privilege\(\s*'service_role'/i)
  assert.match(source, /notification_worker_heartbeats_run_terminal_uidx/i)
  assert.match(source, /dispatch_token/i)
  assert.match(source, /coalesce\(definitions\.source\s*,\s*''\)/i)
  assert.match(source, /receipt exposes exactly one own-profile SELECT policy/i)
  assert.match(source, /ops_task_notification_deliveries/i)
  assert.match(source, /ops_task_automation_runs/i)
  assert.match(source, /to_regclass/i)
  assert.match(source, /create\s+table\s+public\.ops_task_notification_deliveries/i)
  assert.match(source, /drop\s+table\s+public\.ops_task_notification_deliveries/i)
  assert.match(source, /create\s+table\s+public\.ops_task_automation_runs/i)
  assert.match(source, /drop\s+table\s+public\.ops_task_automation_runs/i)
  assert.match(source, /count\(\*\)[\s\S]*notification_runtime_flags/i)
  assert.match(source, /count\(\*\)[\s\S]*notification_deliveries/i)
})
