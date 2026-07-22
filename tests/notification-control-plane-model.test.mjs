import assert from "node:assert/strict"
import test from "node:test"

import {
  buildNotificationPatch,
  createNotificationDraft,
  isNotificationDraftDirty,
  rebaseNotificationDraft,
  validateNotificationDraft,
} from "../src/features/notifications/notification-control-plane-model.ts"
import {
  NOTIFICATION_AUDIENCE_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_CONNECTION_KEYS,
  NOTIFICATION_EDITABLE_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS_BY_WORKFLOW,
  NOTIFICATION_WORKFLOW_OPTIONS,
  parseNotificationControlPlaneSnapshot,
} from "../src/features/notifications/notification-control-plane-types.ts"

const RULE_REVISION = "9007199254740993"
const TEMPLATE_VERSION = "9007199254740995"
const CONNECTION_REVISION = "9007199254740997"

function createWireSnapshot(overrides = {}) {
  return {
    scope_key: "global",
    workflow_key: "registration",
    rules: [
      {
        id: "rule-registration-visit-management",
        workflow_key: "registration",
        event_key: "registration.visit_scheduled",
        channel_key: "google_chat",
        audience_key: "management_team",
        rule_variant_key: "immediate",
        delivery_mode: "immediate",
        schedule_key: null,
        schedule_config: null,
        enabled: false,
        active_template_id: "template-registration-visit-management",
        revision: RULE_REVISION,
        template: {
          id: "template-registration-visit-management",
          rule_id: "rule-registration-visit-management",
          version: TEMPLATE_VERSION,
          title_template: "{학생} 방문상담 예약",
          body_template: "{학생} 학생의 방문상담이 예약되었습니다.",
          allowed_variables: [
            { key: "student_name", token: "학생", pii_class: "student_name" },
          ],
          payload_schema_version: 1,
        },
      },
    ],
    connections: [
      {
        connection_key: "google_chat.management",
        connection_state: "encrypted_active",
        revision: CONNECTION_REVISION,
        webhook_url_mask: "chat.googleapis.com/…/management",
        last_verified_at: "2026-07-16T08:00:00.000Z",
        last_error_code: null,
      },
    ],
    delivery_summary: {
      pending_count: 2,
      sent_count: 11,
      failed_count: 1,
      unknown_count: 0,
      latest_delivery_at: "2026-07-16T08:30:00.000Z",
    },
    ...overrides,
  }
}

function parseSnapshot(wire = createWireSnapshot()) {
  const result = parseNotificationControlPlaneSnapshot(wire)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}

function issueCodes(result) {
  assert.equal(result.ok, false, JSON.stringify(result))
  return result.issues.map((issue) => issue.code)
}

test("keeps the exact seven workflow keys, order, and Korean labels", () => {
  assert.deepEqual(NOTIFICATION_WORKFLOW_OPTIONS, [
    { key: "tasks", label: "할 일" },
    { key: "word_retests", label: "영어 단어 재시험" },
    { key: "registration", label: "등록" },
    { key: "transfer", label: "전반" },
    { key: "withdrawal", label: "퇴원" },
    { key: "makeup_requests", label: "휴보강" },
    { key: "approvals", label: "전자결재" },
  ])
})

test("locks the complete event, audience, and channel vocabularies", () => {
  assert.deepEqual(NOTIFICATION_EVENT_KEYS_BY_WORKFLOW, {
    tasks: [
      "task.created",
      "task.assignee_changed",
      "task.due_changed",
      "task.status_changed",
      "task.completed",
      "task.canceled",
      "task.reopened",
      "task.comment_added",
    ],
    word_retests: [
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
    ],
    registration: [
      "registration.case_created",
      "registration.inquiry_routed",
      "registration.director_assigned",
      "registration.phone_consultation_ready",
      "registration.level_test_scheduled",
      "registration.level_test_rescheduled",
      "registration.level_test_started",
      "registration.level_test_completed",
      "registration.level_test_absent",
      "registration.level_test_canceled",
      "registration.visit_scheduled",
      "registration.visit_rescheduled",
      "registration.visit_replaced",
      "registration.visit_subject_deselected",
      "registration.visit_canceled",
      "registration.consultation_completed",
      "registration.waiting_transitioned",
      "registration.enrollment_decided",
      "registration.admission_started",
      "registration.admission_advanced",
      "registration.admission_canceled",
      "registration.registration_completed",
      "registration.case_closed",
      "registration.track_reopened",
      "registration.admission_message_requested",
      "registration.admission_message_accepted",
      "registration.admission_message_failed",
      "registration.admission_message_unknown",
      "registration.admission_message_reconciled",
      "registration.admission_message_retry_released",
      "registration.appointment_reminder_due",
    ],
    transfer: [
      "transfer.submitted",
      "transfer.processing_started",
      "transfer.details_changed",
      "transfer.completed",
      "transfer.canceled",
      "transfer.reopened",
    ],
    withdrawal: [
      "withdrawal.submitted",
      "withdrawal.processing_started",
      "withdrawal.details_changed",
      "withdrawal.completed",
      "withdrawal.canceled",
      "withdrawal.reopened",
    ],
    makeup_requests: [
      "makeup.submitted",
      "makeup.approved",
      "makeup.revision_requested",
      "makeup.rejected",
      "makeup.refund_requested",
      "makeup.refund_completed",
      "makeup.approval_canceled",
      "makeup.deleted",
    ],
    approvals: [
      "approval.created",
      "approval.submitted",
      "approval.review_started",
      "approval.approver_changed",
      "approval.approved",
      "approval.returned",
      "approval.canceled",
      "approval.resubmitted",
      "approval.comment_added",
      "approval.deleted",
    ],
  })

  assert.deepEqual(NOTIFICATION_AUDIENCE_KEYS, [
    "requester_profile",
    "primary_assignee",
    "secondary_assignee",
    "management_team",
    "requesting_teacher",
    "assigned_assistant",
    "registration_requester",
    "track_director",
    "subject_team",
    "applicant_guardian",
    "approver_profile",
    "executive_team",
  ])
  assert.deepEqual(NOTIFICATION_CHANNEL_KEYS, [
    "in_app",
    "web_push",
    "google_chat",
    "customer_message",
  ])
  assert.deepEqual(NOTIFICATION_EDITABLE_CHANNEL_KEYS, [
    "in_app",
    "google_chat",
    "customer_message",
  ])
})

test("locks the five Google Chat connection slots with science last", () => {
  assert.deepEqual(NOTIFICATION_CONNECTION_KEYS, [
    "google_chat.management",
    "google_chat.executive",
    "google_chat.math",
    "google_chat.english",
    "google_chat.science",
  ])
})

test("maps the snake_case wire snapshot to one camelCase browser DTO", () => {
  const snapshot = parseSnapshot()

  assert.equal(snapshot.scopeKey, "global")
  assert.equal(snapshot.workflowKey, "registration")
  assert.equal(snapshot.rules[0].eventKey, "registration.visit_scheduled")
  assert.equal(snapshot.rules[0].channelKey, "google_chat")
  assert.equal(snapshot.rules[0].audienceKey, "management_team")
  assert.equal(snapshot.rules[0].ruleVariantKey, "immediate")
  assert.equal(snapshot.rules[0].deliveryMode, "immediate")
  assert.equal(snapshot.rules[0].activeTemplateId, "template-registration-visit-management")
  assert.equal(snapshot.rules[0].template.titleTemplate, "{학생} 방문상담 예약")
  assert.deepEqual(snapshot.rules[0].template.allowedVariables, [
    { key: "student_name", token: "학생", piiClass: "student_name" },
  ])
  assert.equal(snapshot.connections[0].connectionKey, "google_chat.management")
  assert.equal(snapshot.connections[0].connectionState, "encrypted_active")
  assert.equal(snapshot.connections[0].webhookUrlMask, "chat.googleapis.com/…/management")
  assert.equal(snapshot.deliverySummary.pendingCount, 2)
  assert.equal(snapshot.deliverySummary.latestDeliveryAt, "2026-07-16T08:30:00.000Z")
  assert.equal("workflow_key" in snapshot, false)
  assert.equal("title_template" in snapshot.rules[0].template, false)
})

test("parses a disconnected science slot without requiring or exposing a secret", () => {
  const wire = createWireSnapshot()
  wire.connections.push({
    connection_key: "google_chat.science",
    connection_state: "disconnected",
    revision: CONNECTION_REVISION,
    webhook_url_mask: null,
    last_verified_at: null,
    last_error_code: null,
    editable: true,
  })

  const snapshot = parseSnapshot(wire)
  assert.deepEqual(snapshot.connections[1], {
    connectionKey: "google_chat.science",
    connectionState: "disconnected",
    revision: CONNECTION_REVISION,
    configured: false,
    webhookUrlMask: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    editable: true,
  })
  assert.equal("webhookUrl" in snapshot.connections[1], false)
  assert.equal("webhookUrlCiphertext" in snapshot.connections[1], false)
})

test("preserves bigint rule, template, and connection revisions as decimal strings", () => {
  const snapshot = parseSnapshot()

  assert.equal(snapshot.rules[0].revision, RULE_REVISION)
  assert.equal(snapshot.rules[0].template.version, TEMPLATE_VERSION)
  assert.equal(snapshot.connections[0].revision, CONNECTION_REVISION)
  assert.equal(typeof snapshot.rules[0].revision, "string")
  assert.equal(typeof snapshot.rules[0].template.version, "string")
  assert.equal(typeof snapshot.connections[0].revision, "string")
  assert.equal(BigInt(snapshot.rules[0].revision) > BigInt(Number.MAX_SAFE_INTEGER), true)
})

test("fails closed for unknown and impossible rule cells", () => {
  const unknownChannel = createWireSnapshot()
  unknownChannel.rules[0].channel_key = "sms"
  assert.equal(issueCodes(parseNotificationControlPlaneSnapshot(unknownChannel)).includes("unknown_channel"), true)

  const impossibleAudience = createWireSnapshot()
  impossibleAudience.rules[0].audience_key = "requester_profile"
  assert.equal(issueCodes(parseNotificationControlPlaneSnapshot(impossibleAudience)).includes("impossible_rule_cell"), true)

  const unknownWorkflow = createWireSnapshot({ workflow_key: "student_payments" })
  unknownWorkflow.rules[0].workflow_key = "student_payments"
  assert.equal(issueCodes(parseNotificationControlPlaneSnapshot(unknownWorkflow)).includes("unknown_workflow"), true)
})

test("rejects web_push as an independent settings rule", () => {
  const wire = createWireSnapshot()
  wire.rules[0].channel_key = "web_push"

  assert.equal(
    issueCodes(parseNotificationControlPlaneSnapshot(wire)).includes("independent_web_push_rule"),
    true,
  )
})

test("fails closed when a rule carries a connection for the wrong channel or audience", () => {
  const inAppWithChatConnection = createWireSnapshot()
  inAppWithChatConnection.rules[0].channel_key = "in_app"
  inAppWithChatConnection.rules[0].connection_key = "google_chat.management"
  assert.equal(
    issueCodes(parseNotificationControlPlaneSnapshot(inAppWithChatConnection)).includes(
      "impossible_rule_cell",
    ),
    true,
  )

  const managementWithExecutiveConnection = createWireSnapshot()
  managementWithExecutiveConnection.rules[0].connection_key = "google_chat.executive"
  assert.equal(
    issueCodes(parseNotificationControlPlaneSnapshot(managementWithExecutiveConnection)).includes(
      "impossible_rule_cell",
    ),
    true,
  )
})

test("fails closed for duplicate rule and connection identities", () => {
  const duplicateRule = createWireSnapshot()
  duplicateRule.rules.push(structuredClone(duplicateRule.rules[0]))
  assert.equal(
    issueCodes(parseNotificationControlPlaneSnapshot(duplicateRule)).includes(
      "duplicate_identity",
    ),
    true,
  )

  const duplicateConnection = createWireSnapshot()
  duplicateConnection.connections.push(structuredClone(duplicateConnection.connections[0]))
  assert.equal(
    issueCodes(parseNotificationControlPlaneSnapshot(duplicateConnection)).includes(
      "duplicate_identity",
    ),
    true,
  )
})

test("builds an explicit minimal patch from operator-changed fields only", () => {
  const base = createNotificationDraft(parseSnapshot())
  const local = structuredClone(base)
  local.rules["rule-registration-visit-management"].enabled = true

  assert.deepEqual(buildNotificationPatch(base, local), {
    rules: {
      "rule-registration-visit-management": { enabled: true },
    },
  })
  assert.deepEqual(buildNotificationPatch(base, structuredClone(base)), { rules: {} })
})

test("rejects extra schedule fields and emits only the closed schedule patch", () => {
  const wire = createWireSnapshot()
  wire.rules[0].delivery_mode = "scheduled"
  wire.rules[0].rule_variant_key = "same_day_at"
  wire.rules[0].schedule_key = "same_day_at"
  wire.rules[0].schedule_config = {
    anchor_key: "appointment_start",
    local_time: "09:00",
    timezone: "Asia/Seoul",
  }
  const snapshot = parseSnapshot(wire)
  const base = createNotificationDraft(snapshot)
  const local = structuredClone(base)
  local.rules["rule-registration-visit-management"].scheduleConfig = {
    anchorKey: "appointment_start",
    localTime: "10:00",
    timezone: "Asia/Seoul",
    cron: "* * * * *",
    webhookUrl: "https://example.invalid",
  }

  const validation = validateNotificationDraft(snapshot, local)
  assert.equal(issueCodes(validation).includes("invalid_schedule"), true)
  assert.deepEqual(buildNotificationPatch(base, local), {
    rules: {
      "rule-registration-visit-management": {
        scheduleConfig: {
          anchorKey: "appointment_start",
          localTime: "10:00",
          timezone: "Asia/Seoul",
        },
      },
    },
  })
})

test("rejects template tokens outside the server-provided allowlist", () => {
  const snapshot = parseSnapshot()
  const draft = createNotificationDraft(snapshot)
  draft.rules["rule-registration-visit-management"].bodyTemplate = "{학생} {미등록}"

  const result = validateNotificationDraft(snapshot, draft)
  assert.equal(issueCodes(result).includes("template_token_not_allowed"), true)
})

test("blocks a newly enabled Google Chat rule when its required connection is unavailable", () => {
  const snapshot = parseSnapshot({ ...createWireSnapshot(), connections: [] })
  const draft = createNotificationDraft(snapshot)
  draft.rules["rule-registration-visit-management"].enabled = true

  const result = validateNotificationDraft(snapshot, draft)
  assert.equal(issueCodes(result).includes("google_chat_connection_required"), true)
})

test("blocks a newly enabled Google Chat rule when connection verification has failed", () => {
  const wire = createWireSnapshot()
  wire.connections[0].last_error_code = "provider_rejected"
  const snapshot = parseSnapshot(wire)
  const draft = createNotificationDraft(snapshot)
  draft.rules["rule-registration-visit-management"].enabled = true

  const result = validateNotificationDraft(snapshot, draft)
  assert.equal(issueCodes(result).includes("google_chat_connection_required"), true)
})

test("requires all three subject connections before enabling a dynamic subject-team Chat rule", () => {
  const wire = createWireSnapshot({ workflow_key: "makeup_requests" })
  wire.rules[0].workflow_key = "makeup_requests"
  wire.rules[0].event_key = "makeup.submitted"
  wire.rules[0].audience_key = "subject_team"
  wire.connections[0].connection_key = "google_chat.math"
  const snapshotWithMathOnly = parseSnapshot(wire)
  const blockedDraft = createNotificationDraft(snapshotWithMathOnly)
  blockedDraft.rules["rule-registration-visit-management"].enabled = true

  const blocked = validateNotificationDraft(snapshotWithMathOnly, blockedDraft)
  assert.equal(issueCodes(blocked).includes("google_chat_connection_required"), true)

  const englishConnection = structuredClone(wire.connections[0])
  englishConnection.connection_key = "google_chat.english"
  wire.connections.push(englishConnection)
  const blockedWithoutScience = parseSnapshot(wire)
  const blockedWithoutScienceDraft = createNotificationDraft(blockedWithoutScience)
  blockedWithoutScienceDraft.rules["rule-registration-visit-management"].enabled = true
  assert.equal(
    issueCodes(validateNotificationDraft(blockedWithoutScience, blockedWithoutScienceDraft)).includes(
      "google_chat_connection_required",
    ),
    true,
  )

  const scienceConnection = structuredClone(wire.connections[0])
  scienceConnection.connection_key = "google_chat.science"
  wire.connections.push(scienceConnection)
  const readySnapshot = parseSnapshot(wire)
  const readyDraft = createNotificationDraft(readySnapshot)
  readyDraft.rules["rule-registration-visit-management"].enabled = true
  assert.equal(validateNotificationDraft(readySnapshot, readyDraft).ok, true)
})

test("rebases independent local fields onto the latest remote draft", () => {
  const base = createNotificationDraft(parseSnapshot())
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.rules["rule-registration-visit-management"].enabled = true
  remote.rules["rule-registration-visit-management"].bodyTemplate = "원격에서 바뀐 본문"

  const result = rebaseNotificationDraft(base, local, remote)

  assert.equal(result.ok, true)
  assert.deepEqual(result.conflictingFields, [])
  assert.equal(result.overwriteConfirmationRequired, false)
  assert.equal(result.draft.rules["rule-registration-visit-management"].enabled, true)
  assert.equal(
    result.draft.rules["rule-registration-visit-management"].bodyTemplate,
    "원격에서 바뀐 본문",
  )
})

test("preserves the local value and reports a same-field revision conflict", () => {
  const base = createNotificationDraft(parseSnapshot())
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.rules["rule-registration-visit-management"].titleTemplate = "내 제목"
  remote.rules["rule-registration-visit-management"].titleTemplate = "다른 운영자의 제목"

  const result = rebaseNotificationDraft(base, local, remote)

  assert.equal(result.ok, false)
  assert.equal(result.reason, "revision_conflict")
  assert.deepEqual(result.conflictingFields, [
    "rules.rule-registration-visit-management.titleTemplate",
  ])
  assert.equal(result.overwriteConfirmationRequired, true)
  assert.equal(result.overwriteConfirmed, false)
  assert.equal(result.draft.rules["rule-registration-visit-management"].titleTemplate, "내 제목")
})

test("requires explicit overwrite confirmation before accepting a conflicting rebase", () => {
  const base = createNotificationDraft(parseSnapshot())
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.rules["rule-registration-visit-management"].bodyTemplate = "내 본문"
  remote.rules["rule-registration-visit-management"].bodyTemplate = "원격 본문"

  const blocked = rebaseNotificationDraft(base, local, remote)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.overwriteConfirmationRequired, true)

  const confirmed = rebaseNotificationDraft(base, local, remote, { overwriteConfirmed: true })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.overwriteConfirmationRequired, false)
  assert.equal(confirmed.overwriteConfirmed, true)
  assert.deepEqual(confirmed.conflictingFields, [
    "rules.rule-registration-visit-management.bodyTemplate",
  ])
  assert.equal(confirmed.draft.rules["rule-registration-visit-management"].bodyTemplate, "내 본문")
  assert.deepEqual(buildNotificationPatch(remote, confirmed.draft), {
    rules: {
      "rule-registration-visit-management": { bodyTemplate: "내 본문" },
    },
  })
})

test("exposes the dirty signal used by route, workflow, and dialog navigation guards", () => {
  const base = createNotificationDraft(parseSnapshot())
  const local = structuredClone(base)

  assert.equal(isNotificationDraftDirty(base, local), false)
  local.rules["rule-registration-visit-management"].titleTemplate = "수정 중인 제목"
  assert.equal(isNotificationDraftDirty(base, local), true)
  assert.equal(isNotificationDraftDirty(base, structuredClone(base)), false)

  const replacedRule = structuredClone(base)
  delete replacedRule.rules["rule-registration-visit-management"]
  replacedRule.rules["unknown-rule"] = structuredClone(
    base.rules["rule-registration-visit-management"],
  )
  assert.equal(isNotificationDraftDirty(base, replacedRule), true)
})
