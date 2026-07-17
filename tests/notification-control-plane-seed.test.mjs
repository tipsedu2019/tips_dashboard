import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const seedMigrationUrl = new URL(
  "../supabase/migrations/20260716112500_notification_workflow_settings_seed.sql",
  import.meta.url,
)
const markerMigrationUrl = new URL(
  "../supabase/migrations/20260716113000_notification_control_plane_runtime_marker.sql",
  import.meta.url,
)
const settingsMigrationUrl = new URL(
  "../supabase/migrations/20260716111000_notification_control_plane_settings_rpc.sql",
  import.meta.url,
)
const workerMigrationUrl = new URL(
  "../supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql",
  import.meta.url,
)
const runtimePgTapUrl = new URL(
  "../supabase/tests/notification_control_plane_runtime_test.sql",
  import.meta.url,
)

const WORKFLOWS = [
  ["tasks", "할 일"],
  ["word_retests", "영어 단어 재시험"],
  ["registration", "등록"],
  ["transfer", "전반"],
  ["withdrawal", "퇴원"],
  ["makeup_requests", "휴보강"],
  ["approvals", "전자결재"],
]

const TASK_EVENTS = [
  "task.created",
  "task.assignee_changed",
  "task.due_changed",
  "task.status_changed",
  "task.completed",
  "task.canceled",
  "task.reopened",
  "task.comment_added",
]

const WORD_RETEST_EVENTS = [
  "word_retest.created",
  "word_retest.assigned",
  "word_retest.schedule_changed",
  "word_retest.started",
  "word_retest.result_reported",
  "word_retest.absent_reported",
  "word_retest.revision_requested",
  "word_retest.retry_created",
  "word_retest.completed",
  "word_retest.canceled",
]

const APPROVAL_EVENTS = [
  "approval.created",
  "approval.submitted",
  "approval.review_started",
  "approval.approver_changed",
  "approval.approved",
  "approval.returned",
  "approval.canceled",
  "approval.resubmitted",
  "approval.comment_added",
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

async function readSeed() {
  return readFile(seedMigrationUrl, "utf8")
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionBlock(source, qualifiedName) {
  const start = source.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+${escapeRegex(qualifiedName)}\\b`, "i"))
  assert.notEqual(start, -1, `missing ${qualifiedName}`)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`)
  return source.slice(start, end + 4)
}

test("workflow settings seed is one additive transaction that precedes the final runtime marker", async () => {
  const [seed, marker, settings, worker] = await Promise.all([
    readSeed(),
    readFile(markerMigrationUrl, "utf8"),
    readFile(settingsMigrationUrl, "utf8"),
    readFile(workerMigrationUrl, "utf8"),
  ])

  assert.match(seed.trim(), /^begin;[\s\S]*commit;$/i)
  assert.equal((seed.match(/^begin;$/gim) || []).length, 1)
  assert.equal((seed.match(/^commit;$/gim) || []).length, 1)
  assert.match(seed, /set\s+local\s+lock_timeout\s*=\s*'5s'/i)
  assert.doesNotMatch(seed, /\b(?:drop\s+table|truncate|delete\s+from\s+dashboard_private\.notification_(?:rules|templates|runtime_flags))\b/i)
  assert.doesNotMatch(seed, /common_notification_control_plane_runtime_version/i)
  assert.match(settings, /save_notification_control_plane_v1/i)
  assert.match(worker, /claim_notification_fanout_jobs_v1/i)
  assert.match(marker, /20260716112500_notification_workflow_settings_seed/i)
  assert.match(marker, /20260716112000_notification_control_plane_worker_rpc/i)
})

test("server registry fixes the seven Korean workflow labels and stable order", async () => {
  const seed = await readSeed()

  for (const [index, [workflowKey, workflowLabel]] of WORKFLOWS.entries()) {
    assert.match(
      seed,
      new RegExp(`'${workflowKey}'\\s*,\\s*'${workflowLabel}'\\s*,\\s*${index + 1}\\b`),
      `${workflowKey} must keep its canonical Korean label and sort order`,
    )
  }

  assert.match(seed, /event_label\s+text\s+not\s+null/i)
  assert.match(seed, /group_label\s+text\s+not\s+null/i)
  assert.match(seed, /trigger_description\s+text\s+not\s+null/i)
  assert.match(seed, /event_sort\s+integer\s+not\s+null/i)
  assert.match(seed, /cell_sort\s+integer\s+not\s+null/i)
  assert.match(seed, /primary\s+key\s*\(\s*workflow_key\s*,\s*event_key\s*,\s*audience_key\s*,\s*channel_key\s*,\s*rule_variant_key\s*\)/i)
})

test("tasks, word retests, and approvals seed every approved cell disabled", async () => {
  const seed = await readSeed()

  for (const eventKey of [...TASK_EVENTS, ...WORD_RETEST_EVENTS, ...APPROVAL_EVENTS]) {
    assert.match(seed, new RegExp(`'${escapeRegex(eventKey)}'`), `missing ${eventKey}`)
  }

  for (const cell of [
    "requester_profile:in_app",
    "primary_assignee:in_app",
    "secondary_assignee:in_app",
    "management_team:in_app",
    "management_team:google_chat",
    "requesting_teacher:in_app",
    "assigned_assistant:in_app",
    "approver_profile:in_app",
  ]) {
    const [audience, channel] = cell.split(":")
    assert.match(seed, new RegExp(`'${audience}'\\s*,\\s*'[^']+'\\s*,\\s*'${channel}'`))
  }

  assert.match(seed, /(?:event_catalog\.)?workflow_key\s+in\s*\(\s*'tasks'\s*,\s*'word_retests'\s*,\s*'approvals'\s*\)[\s\S]*?false[\s\S]*?as\s+enabled/i)
})

test("registration, transfer, and withdrawal baseline imports only proven management Chat intent", async () => {
  const seed = await readSeed()

  for (const eventKey of [
    "registration.case_created",
    "registration.registration_completed",
    "registration.case_closed",
    "transfer.submitted",
    "transfer.completed",
    "withdrawal.submitted",
    "withdrawal.completed",
  ]) {
    assert.match(seed, new RegExp(`'${escapeRegex(eventKey)}'`))
  }

  assert.match(seed, /'registration\.case_created'[\s\S]*?'management_team'[\s\S]*?'google_chat'/i)
  assert.match(seed, /'registration\.registration_completed'[\s\S]*?'management_team'[\s\S]*?'google_chat'/i)
  assert.match(seed, /'registration\.case_closed'[\s\S]*?'management_team'[\s\S]*?'google_chat'/i)
  assert.doesNotMatch(seed, /registration\.(?:processing|admission_message|phone_consultation_ready|visit_)/i)
  assert.doesNotMatch(seed, /(?:applicant|operations)(?:_team|_guardian)?/i)
  assert.doesNotMatch(seed, /(?:transfer|withdrawal)\.(?:processing_started|details_changed|canceled|reopened)/i)
})

test("makeup import reads only persisted rows, maps exact active cells, and records inactive metadata", async () => {
  const seed = await readSeed()

  assert.match(seed, /from\s+public\.makeup_notification_settings\s+legacy_setting/i)
  assert.doesNotMatch(seed, /mergeNotificationSettings|buildDefaultNotificationSettings|getDefaultMakeupNotification/i)
  assert.match(seed, /'submitted'\s*,\s*'makeup\.submitted'/i)
  assert.match(seed, /'refund_requested'\s*,\s*'makeup\.refund_requested'/i)
  assert.match(seed, /'approved'\s*,\s*'makeup\.approved'/i)
  assert.match(seed, /'completed'\s*,\s*'makeup\.refund_completed'/i)
  assert.match(seed, /'canceled'\s*,\s*'makeup\.approval_canceled'/i)
  assert.match(seed, /'returned'\s*,\s*'makeup\.revision_requested'/i)
  assert.match(seed, /'rejected'\s*,\s*'makeup\.rejected'/i)
  assert.match(seed, /import_state\s+text\s+not\s+null[\s\S]*?'active'[\s\S]*?'inactive'/i)
  assert.match(seed, /source_key\s+text\s+primary\s+key/i)
  assert.match(seed, /source_revision\s+text\s+not\s+null/i)
  assert.match(seed, /source_checksum\s+text\s+not\s+null/i)
  assert.match(seed, /inactive_not_used_by_legacy_sender/i)
  assert.match(seed, /legacy_setting\.channel\s*=\s*'dashboard_personal'[\s\S]*?registry\.channel_key\s*=\s*'in_app'[\s\S]*?registry\.audience_key\s+in\s*\(\s*'requester_profile'\s*,\s*'approver_profile'\s*\)/i)
  assert.match(seed, /notification_makeup_subject_settings_review_required/i)
  assert.match(seed, /count\(legacy_setting\.channel\)\s*<>\s*2/i)
  assert.match(seed, /count\(distinct\s+legacy_setting\.channel\)\s*<>\s*2/i)
  assert.match(seed, /count\(distinct\s+legacy_setting\.enabled\)\s*>\s*1/i)
})

test("seed IDs, version-one templates, checksums, and system actors are deterministic and rerunnable", async () => {
  const seed = await readSeed()

  assert.match(seed, /notification_deterministic_uuid_v1/i)
  assert.match(seed, /notification-rule-v1/i)
  assert.match(seed, /notification-template-v1/i)
  assert.match(seed, /pg_catalog\.sha256/i)
  assert.match(seed, /version[\s\S]*?1::bigint/i)
  assert.match(seed, /created_actor_kind[\s\S]*?'system'/i)
  assert.match(seed, /updated_actor_kind[\s\S]*?'system'/i)
  assert.match(seed, /on\s+conflict[\s\S]*?do\s+nothing/i)
  assert.match(seed, /notification_seed_idempotency_violation/i)
})

test("snapshot and save both use the same closed registry", async () => {
  const seed = await readSeed()
  const snapshot = functionBlock(seed, "dashboard_private.notification_control_plane_snapshot_v1")
  const save = functionBlock(seed, "public.save_notification_control_plane_v1")

  assert.match(snapshot, /notification_settings_ui_registry/i)
  assert.match(snapshot, /registry_row\.event_label/i)
  assert.match(snapshot, /registry_row\.group_label/i)
  assert.match(snapshot, /registry_row\.trigger_description/i)
  assert.match(snapshot, /registry_row\.event_sort/i)
  assert.match(snapshot, /registry_row\.cell_sort/i)
  assert.match(save, /notification_settings_ui_registry/i)
  assert.match(save, /notification_rule_not_in_registry/i)
  assert.ok(
    save.indexOf("notification_access_denied") < save.indexOf("notification_settings_ui_registry"),
    "save must authenticate before testing registry membership",
  )
})

test("conflict override save is atomic, registry-checked, idempotent, and safely audited", async () => {
  const seed = await readSeed()
  const override = functionBlock(seed, "public.save_notification_control_plane_with_override_v1")

  assert.match(override, /p_workflow_key\s+text\s*,[\s\S]*?p_expected_rule_revisions\s+jsonb\s*,[\s\S]*?p_patch\s+jsonb\s*,[\s\S]*?p_save_request_id\s+uuid\s*,[\s\S]*?p_override_request_id\s+uuid\s*,[\s\S]*?p_conflicting_fields\s+jsonb/i)
  assert.match(override, /p_save_request_id\s*=\s*p_override_request_id/i)
  assert.match(override, /notification_revision_conflict_override/i)
  assert.match(override, /notification_request_ledger/i)
  assert.match(override, /pg_advisory_xact_lock/i)
  assert.match(override, /public\.save_notification_control_plane_v1\s*\(/i)
  assert.match(override, /revision_conflict_overridden/i)
  assert.match(override, /conflicting_fields/i)
  assert.match(override, /save_request_id/i)
  for (const field of ["enabled", "scheduleConfig", "titleTemplate", "bodyTemplate"]) {
    assert.match(override, new RegExp(escapeRegex(field)))
  }
  assert.ok(
    override.indexOf("notification_access_denied") < override.indexOf("notification_settings_ui_registry"),
    "override must authenticate before testing registry membership",
  )
  assert.match(seed, /grant\s+execute\s+on\s+function\s+public\.save_notification_control_plane_with_override_v1\(\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*uuid\s*,\s*uuid\s*,\s*jsonb\s*\)\s+to\s+authenticated/i)
})

test("seed keeps all rollout flags false and performs no ownership or dispatch cutover", async () => {
  const seed = await readSeed()

  for (const flag of RUNTIME_FLAGS) {
    assert.match(seed, new RegExp(`'${flag}'`))
  }
  assert.match(seed, /notification_seed_runtime_flag_enabled/i)
  assert.doesNotMatch(seed, /update\s+dashboard_private\.notification_runtime_flags\b/i)
  assert.doesNotMatch(seed, /insert\s+into\s+dashboard_private\.notification_dispatch_ownership_claims/i)
  assert.doesNotMatch(seed, /insert\s+into\s+dashboard_private\.notification_(?:events|event_fanout_jobs|deliveries)/i)
})

test("final runtime marker is capability-only and locked to authenticated and service role", async () => {
  const marker = await readFile(markerMigrationUrl, "utf8")

  assert.match(marker.trim(), /^begin;[\s\S]*commit;$/i)
  assert.match(marker, /create\s+or\s+replace\s+function\s+public\.common_notification_control_plane_runtime_version\(\)[\s\S]*?returns\s+integer[\s\S]*?select\s+1\s*;/i)
  assert.match(marker, /alter\s+function\s+public\.common_notification_control_plane_runtime_version\(\)\s+owner\s+to\s+postgres/i)
  assert.match(marker, /revoke\s+all\s+on\s+function\s+public\.common_notification_control_plane_runtime_version\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i)
  assert.match(marker, /grant\s+execute\s+on\s+function\s+public\.common_notification_control_plane_runtime_version\(\)\s+to\s+authenticated\s*,\s*service_role/i)
  assert.match(marker, /public\.save_notification_control_plane_with_override_v1\(text,jsonb,jsonb,uuid,uuid,jsonb\)/i)
})

test("pgTAP packet covers registry shape, import idempotency, rejection, flags, and marker privileges", async () => {
  const pgTap = await readFile(runtimePgTapUrl, "utf8")

  for (const contract of [
    "notification_settings_ui_registry",
    "notification_settings_import_metadata",
    "notification_rule_not_in_registry",
    "common_notification_control_plane_runtime_version",
    "legacy source channels map only to their exact approved registry cells",
    "registry and import evidence remain private behind the role-checked RPCs",
    "override request replays one response and writes one safe conflict audit",
    "override request ID rejects a changed fingerprint",
    "registry-external rule is rejected before the unchecked save implementation",
    "subject import rejects a missing English or math source row",
    "subject import rejects disagreeing English and math enabled values",
    "runtime fixtures reuse seeded registry IDs for save and CAS coverage",
    "notification seed rerun keeps rule/template/import counts and checksums stable",
    "all twelve notification runtime flags remain false after settings seed",
  ]) {
    assert.ok(pgTap.includes(contract), `missing pgTAP contract: ${contract}`)
  }
})
