import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

import {
  recordLegacyNotificationDeliveryIntent,
  normalizedNotificationRenderedHash,
} from "../src/features/notifications/server/legacy-delivery-intent.js"
import { renderNotificationSnapshot } from "../src/features/notifications/server/notification-worker.ts"
import { getNotificationWorkflowAdapter } from "../src/features/notifications/server/notification-workflow-registry.ts"
import {
  compareNotificationShadowIntents,
  verifyDeterministicNotificationShadowFixture,
} from "./verify-notification-workflow-cutover.mjs"

export const NOTIFICATION_SHADOW_PREVIEW_SCOPES = Object.freeze([
  "tasks",
  "word_retests",
  "approvals",
  "transfer",
  "withdrawal",
  "makeup_requests",
  "registration",
  "registration_phone",
  "registration_visit",
  "registration_solapi",
])

const FIXED_OCCURRED_AT = "2026-07-17T03:00:00.000Z"
const TOKEN_PATTERN = /\{([^{}]+)\}/g

function canonicalJson(value) {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!value || typeof value !== "object") throw new Error("preview_fixture_json_invalid")
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function digestJson(value) {
  return sha256(canonicalJson(value))
}

function deterministicUuid(scopeKey, label) {
  const chars = sha256(`notification-shadow-preview-v1:${scopeKey}:${label}`).slice(0, 32).split("")
  chars[12] = "5"
  chars[16] = "8"
  const hex = chars.join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}

function canonicalSeedVariable(key, token, piiClass = "none") {
  return Object.freeze({ key, token, piiClass })
}

function canonicalSeedTemplate(titleTemplate, bodyTemplate, allowedVariables, payloadSchemaVersion) {
  return Object.freeze({
    titleTemplate,
    bodyTemplate,
    allowedVariables: Object.freeze(allowedVariables.map((item) => Object.freeze({ ...item }))),
    payloadSchemaVersion,
  })
}

function canonicalGenericVariables() {
  return [
    canonicalSeedVariable("workflow_label", "workflow_label"),
    canonicalSeedVariable("event_label", "event_label"),
    canonicalSeedVariable("occurred_at", "occurred_at", "schedule"),
    canonicalSeedVariable("deep_link", "deep_link", "same_origin_path"),
  ]
}

function canonicalRegistrationVariables() {
  return [
    canonicalSeedVariable("student_name", "학생", "student_name"),
    canonicalSeedVariable("grade", "학년"),
    canonicalSeedVariable("inquiry_at", "문의일시", "schedule"),
    canonicalSeedVariable("status", "진행상태"),
    canonicalSeedVariable("class_name", "수업", "class_name"),
    canonicalSeedVariable("registration_checked", "등록 확인"),
    canonicalSeedVariable("teacher_name", "담당선생님", "staff_name"),
    canonicalSeedVariable("before_class", "전 수업", "class_name"),
    canonicalSeedVariable("after_class", "후 수업", "class_name"),
    canonicalSeedVariable("before_end_date", "전 수업 종료일", "schedule"),
    canonicalSeedVariable("after_start_date", "후 수업 시작일", "schedule"),
    canonicalSeedVariable("withdrawal_date", "퇴원일", "schedule"),
    canonicalSeedVariable("withdrawal_round", "퇴원회차"),
  ]
}

function canonicalMakeupVariables() {
  return [
    canonicalSeedVariable("process", "프로세스"),
    canonicalSeedVariable("status", "상태"),
    canonicalSeedVariable("class_name", "수업", "class_name"),
    canonicalSeedVariable("subject", "과목"),
    canonicalSeedVariable("teacher_name", "선생님", "staff_name"),
    canonicalSeedVariable("reason", "사유", "free_text"),
    canonicalSeedVariable("cancel_date", "휴강일", "schedule"),
    canonicalSeedVariable("makeup_at", "보강일시", "schedule"),
    canonicalSeedVariable("makeup_room_spaced", "보강 강의실", "location"),
    canonicalSeedVariable("makeup_room", "보강강의실", "location"),
    canonicalSeedVariable("requester_name", "신청자", "staff_name"),
    canonicalSeedVariable("submitted_at", "상신일시", "schedule"),
    canonicalSeedVariable("revision_requested_at", "보완요청일시", "schedule"),
    canonicalSeedVariable("revision_reason", "보완 사유", "free_text"),
    canonicalSeedVariable("approved_at", "승인일시", "schedule"),
    canonicalSeedVariable("approval_note", "승인 메모", "free_text"),
    canonicalSeedVariable("rejected_at", "반려일시", "schedule"),
    canonicalSeedVariable("rejected_reason", "반려 사유", "free_text"),
    canonicalSeedVariable("canceled_at", "승인취소일시", "schedule"),
    canonicalSeedVariable("canceled_note", "승인취소 메모", "free_text"),
    canonicalSeedVariable("approver_name", "결재자", "staff_name"),
    canonicalSeedVariable("fallback_title", "제목"),
    canonicalSeedVariable("fallback_body", "본문"),
  ]
}

// Repository-side canonical source. These values mirror the current
// notification_seed_template_payload_v1 and registration fixed-rule seeds.
const CANONICAL_SEED_TEMPLATES = Object.freeze({
  tasks: canonicalSeedTemplate(
    "[{workflow_label}] {event_label}",
    "{event_label} · {occurred_at}\n{deep_link}",
    canonicalGenericVariables(),
    1,
  ),
  word_retests: canonicalSeedTemplate(
    "[{workflow_label}] {event_label}",
    "{event_label} · {occurred_at}\n{deep_link}",
    canonicalGenericVariables(),
    1,
  ),
  approvals: canonicalSeedTemplate(
    "[{workflow_label}] {event_label}",
    "{event_label} · {occurred_at}\n{deep_link}",
    canonicalGenericVariables(),
    1,
  ),
  transfer: canonicalSeedTemplate(
    "전반 신청 접수 · {학생}",
    "{담당선생님} 선생님이 {학생} 학생의 전반을 신청했습니다.\n전 수업: {전 수업}\n후 수업: {후 수업}",
    canonicalRegistrationVariables(),
    1,
  ),
  withdrawal: canonicalSeedTemplate(
    "퇴원 신청 접수 · {학생}",
    "{담당선생님} 선생님이 {학생} 학생의 퇴원을 신청했습니다.\n수업: {수업}",
    canonicalRegistrationVariables(),
    1,
  ),
  makeup_requests: canonicalSeedTemplate(
    "휴보강 신청서가 올라왔습니다",
    "{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강",
    canonicalMakeupVariables(),
    1,
  ),
  registration: canonicalSeedTemplate(
    "등록 문의 접수 · {학생}",
    "{학생} 학생 등록 문의가 접수되었습니다.\n학년: {학년}\n문의일시: {문의일시}",
    canonicalRegistrationVariables(),
    1,
  ),
  registration_phone: canonicalSeedTemplate(
    "[{subject}] 전화상담 대기",
    "{student_name} 학생 상담을 확인하세요.",
    [
      canonicalSeedVariable("subject", "subject"),
      canonicalSeedVariable("student_name", "student_name", "student_name"),
    ],
    2,
  ),
  registration_visit: canonicalSeedTemplate(
    "[{subjects}] 방문상담 예약 배정",
    "{student_name} 학생 · {scheduled_at} · {place}",
    [
      canonicalSeedVariable("subjects", "subjects"),
      canonicalSeedVariable("student_name", "student_name", "student_name"),
      canonicalSeedVariable("scheduled_at", "scheduled_at", "schedule"),
      canonicalSeedVariable("place", "place", "location"),
    ],
    2,
  ),
  registration_solapi: canonicalSeedTemplate(
    "입학신청서 안내",
    "{student_name} 학생 입학신청서 안내",
    [canonicalSeedVariable("student_name", "student_name", "student_name")],
    2,
  ),
})

function legacyVariable(key, token, piiClass = "none") {
  return Object.freeze({ key, token, piiClass })
}

function legacyTemplateDeclaration(titleTemplate, bodyTemplate, allowedVariables, payloadSchemaVersion) {
  return Object.freeze({
    titleTemplate,
    bodyTemplate,
    allowedVariables: Object.freeze(allowedVariables.map((item) => Object.freeze({ ...item }))),
    payloadSchemaVersion,
  })
}

function legacyGenericVariables() {
  return [
    legacyVariable("workflow_label", "workflow_label"),
    legacyVariable("event_label", "event_label"),
    legacyVariable("occurred_at", "occurred_at", "schedule"),
    legacyVariable("deep_link", "deep_link", "same_origin_path"),
  ]
}

function legacyRegistrationVariables() {
  return [
    legacyVariable("student_name", "학생", "student_name"),
    legacyVariable("grade", "학년"),
    legacyVariable("inquiry_at", "문의일시", "schedule"),
    legacyVariable("status", "진행상태"),
    legacyVariable("class_name", "수업", "class_name"),
    legacyVariable("registration_checked", "등록 확인"),
    legacyVariable("teacher_name", "담당선생님", "staff_name"),
    legacyVariable("before_class", "전 수업", "class_name"),
    legacyVariable("after_class", "후 수업", "class_name"),
    legacyVariable("before_end_date", "전 수업 종료일", "schedule"),
    legacyVariable("after_start_date", "후 수업 시작일", "schedule"),
    legacyVariable("withdrawal_date", "퇴원일", "schedule"),
    legacyVariable("withdrawal_round", "퇴원회차"),
  ]
}

function legacyMakeupVariables() {
  return [
    legacyVariable("process", "프로세스"),
    legacyVariable("status", "상태"),
    legacyVariable("class_name", "수업", "class_name"),
    legacyVariable("subject", "과목"),
    legacyVariable("teacher_name", "선생님", "staff_name"),
    legacyVariable("reason", "사유", "free_text"),
    legacyVariable("cancel_date", "휴강일", "schedule"),
    legacyVariable("makeup_at", "보강일시", "schedule"),
    legacyVariable("makeup_room_spaced", "보강 강의실", "location"),
    legacyVariable("makeup_room", "보강강의실", "location"),
    legacyVariable("requester_name", "신청자", "staff_name"),
    legacyVariable("submitted_at", "상신일시", "schedule"),
    legacyVariable("revision_requested_at", "보완요청일시", "schedule"),
    legacyVariable("revision_reason", "보완 사유", "free_text"),
    legacyVariable("approved_at", "승인일시", "schedule"),
    legacyVariable("approval_note", "승인 메모", "free_text"),
    legacyVariable("rejected_at", "반려일시", "schedule"),
    legacyVariable("rejected_reason", "반려 사유", "free_text"),
    legacyVariable("canceled_at", "승인취소일시", "schedule"),
    legacyVariable("canceled_note", "승인취소 메모", "free_text"),
    legacyVariable("approver_name", "결재자", "staff_name"),
    legacyVariable("fallback_title", "제목"),
    legacyVariable("fallback_body", "본문"),
  ]
}

// Canonical checksum mirrors notification_seed_template_checksum_v1's explicit
// jsonb_build_object(... )::text payload order and PostgreSQL jsonb spacing.
function canonicalSeedTemplateChecksum(templateSnapshot) {
  const allowedVariables = templateSnapshot.allowedVariables.map((item) => (
    `{"key": ${JSON.stringify(item.key)}, "token": ${JSON.stringify(item.token)}, "pii_class": ${JSON.stringify(item.piiClass)}}`
  )).join(", ")
  const jsonbText = `{"body_template": ${JSON.stringify(templateSnapshot.bodyTemplate)}, "title_template": ${JSON.stringify(templateSnapshot.titleTemplate)}, "allowed_variables": [${allowedVariables}], "payload_schema_version": ${templateSnapshot.payloadSchemaVersion}}`
  return createHash("sha256").update(jsonbText, "utf8").digest("hex")
}

function postgresJsonbKeyOrder(left, right) {
  const byteLength = Buffer.byteLength(left, "utf8") - Buffer.byteLength(right, "utf8")
  return byteLength || Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

// Legacy declarations intentionally use an independent generic jsonb serializer
// instead of the canonical checksum builder above.
function legacyJsonbText(value) {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(legacyJsonbText).join(", ")}]`
  if (!value || typeof value !== "object") throw new Error("legacy_template_checksum_invalid")
  return `{${Object.keys(value).sort(postgresJsonbKeyOrder).map((key) => (
    `${JSON.stringify(key)}: ${legacyJsonbText(value[key])}`
  )).join(", ")}}`
}

function legacyTemplateChecksum(templateSnapshot) {
  const checksumPayload = {
    title_template: templateSnapshot.titleTemplate,
    body_template: templateSnapshot.bodyTemplate,
    allowed_variables: templateSnapshot.allowedVariables.map((item) => ({
      key: item.key,
      token: item.token,
      pii_class: item.piiClass,
    })),
    payload_schema_version: templateSnapshot.payloadSchemaVersion,
  }
  return createHash("sha256").update(legacyJsonbText(checksumPayload), "utf8").digest("hex")
}

function ruleFor(scopeKey, input) {
  return Object.freeze({
    ruleId: deterministicUuid(scopeKey, "rule"),
    ruleRevision: "1",
    templateId: deterministicUuid(scopeKey, "template"),
    audienceKey: input.audienceKey,
    channelKey: input.channelKey,
    connectionKey: input.connectionKey ?? null,
    ruleVariantKey: "immediate",
  })
}

function profileTarget(profileId, targetGeneration = "0") {
  return Object.freeze({
    targetKey: `profile:${profileId}`,
    targetGeneration,
  })
}

function connectionTarget(connectionKey, targetGeneration = "0") {
  return Object.freeze({
    targetKey: `connection:${connectionKey}`,
    targetGeneration,
  })
}

function customerTarget(messageId) {
  return Object.freeze({
    targetKey: `registration-message:${messageId}`,
    targetGeneration: "0",
  })
}

function baseFixture(scopeKey, input) {
  const eventId = deterministicUuid(scopeKey, "event")
  const sourceId = input.sourceId ?? deterministicUuid(scopeKey, "source")
  const currentRule = ruleFor(scopeKey, input.rule)
  const canonicalTemplate = CANONICAL_SEED_TEMPLATES[scopeKey]
  if (!canonicalTemplate) throw new Error(`notification_shadow_preview_seed_missing:${scopeKey}`)
  return Object.freeze({
    scopeKey,
    workflowKey: input.workflowKey,
    occurrenceKey: `notification-shadow-preview:${scopeKey}:occurrence:v1`,
    canonical: Object.freeze({
      eventId,
      workflowKey: input.workflowKey,
      eventKey: input.eventKey,
      sourceType: input.sourceType,
      sourceId,
      sourceRevision: input.sourceRevision ?? null,
      payloadSchemaVersion: input.payloadSchemaVersion,
      payload: Object.freeze({ ...input.payload }),
      rule: currentRule,
      scheduledFor: FIXED_OCCURRED_AT,
      template: canonicalTemplate,
    }),
    legacy: Object.freeze({
      workflowKey: input.workflowKey,
      eventKey: input.eventKey,
      audienceKey: input.rule.audienceKey,
      channelKey: input.rule.channelKey,
      context: Object.freeze({ ...input.legacy.context }),
      href: input.legacy.href,
      targets: Object.freeze(input.legacy.targets.map((target) => Object.freeze({ ...target }))),
      template: input.legacy.template,
    }),
  })
}

function buildFixtures() {
  const fixtures = []

  {
    const scopeKey = "tasks"
    const taskId = deterministicUuid(scopeKey, "task")
    const recipient = deterministicUuid(scopeKey, "recipient")
    const legacyTemplate = legacyTemplateDeclaration(
      "[{workflow_label}] {event_label}",
      "{event_label} · {occurred_at}\n{deep_link}",
      legacyGenericVariables(),
      1,
    )
    const href = `/admin/tasks?taskId=${taskId}`
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "tasks",
      eventKey: "task.created",
      sourceType: "ops_task_event",
      payloadSchemaVersion: 1,
      payload: { task_id: taskId, primary_assignee_profile_id: recipient, occurred_at: FIXED_OCCURRED_AT },
      rule: { audienceKey: "primary_assignee", channelKey: "in_app" },
      legacy: {
        template: legacyTemplate,
        context: {
          workflow_label: "할 일",
          event_label: "할 일 생성",
          occurred_at: FIXED_OCCURRED_AT,
          deep_link: href,
        },
        href,
        targets: [profileTarget(recipient)],
      },
    }))
  }

  {
    const scopeKey = "word_retests"
    const taskId = deterministicUuid(scopeKey, "task")
    const href = `/admin/word-retests?taskId=${taskId}`
    const legacyTemplate = legacyTemplateDeclaration(
      "[{workflow_label}] {event_label}",
      "{event_label} · {occurred_at}\n{deep_link}",
      legacyGenericVariables(),
      1,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "word_retests",
      eventKey: "word_retest.created",
      sourceType: "ops_task_event",
      payloadSchemaVersion: 1,
      payload: { task_id: taskId, occurred_at: FIXED_OCCURRED_AT },
      rule: {
        audienceKey: "management_team",
        channelKey: "google_chat",
        connectionKey: "google_chat.management",
      },
      legacy: {
        template: legacyTemplate,
        context: {
          workflow_label: "영어 단어 재시험",
          event_label: "재시험 생성",
          occurred_at: FIXED_OCCURRED_AT,
          deep_link: href,
        },
        href,
        targets: [connectionTarget("google_chat.management")],
      },
    }))
  }

  {
    const scopeKey = "approvals"
    const approvalId = deterministicUuid(scopeKey, "approval")
    const recipient = deterministicUuid(scopeKey, "approver")
    const href = `/admin/approvals?approvalId=${approvalId}`
    const legacyTemplate = legacyTemplateDeclaration(
      "[{workflow_label}] {event_label}",
      "{event_label} · {occurred_at}\n{deep_link}",
      legacyGenericVariables(),
      1,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "approvals",
      eventKey: "approval.submitted",
      sourceType: "approval_event",
      payloadSchemaVersion: 1,
      payload: { approval_id: approvalId, approver_profile_id: recipient, occurred_at: FIXED_OCCURRED_AT },
      rule: { audienceKey: "approver_profile", channelKey: "in_app" },
      legacy: {
        template: legacyTemplate,
        context: {
          workflow_label: "전자결재",
          event_label: "제출",
          occurred_at: FIXED_OCCURRED_AT,
          deep_link: href,
        },
        href,
        targets: [profileTarget(recipient)],
      },
    }))
  }

  {
    const scopeKey = "transfer"
    const taskId = deterministicUuid(scopeKey, "task")
    const requester = deterministicUuid(scopeKey, "requester")
    const legacyTemplate = legacyTemplateDeclaration(
      "전반 신청 접수 · {학생}",
      "{담당선생님} 선생님이 {학생} 학생의 전반을 신청했습니다.\n전 수업: {전 수업}\n후 수업: {후 수업}",
      legacyRegistrationVariables(),
      1,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "transfer",
      eventKey: "transfer.submitted",
      sourceType: "ops_task_event",
      payloadSchemaVersion: 1,
      payload: {
        task_id: taskId,
        requester_profile_id: requester,
        student_name: "김학생",
        requester_name: "이선생",
        before_class: "중1 A",
        after_class: "중1 B",
      },
      rule: { audienceKey: "requester_profile", channelKey: "in_app" },
      legacy: {
        template: legacyTemplate,
        context: {
          student_name: "김학생",
          teacher_name: "이선생",
          before_class: "중1 A",
          after_class: "중1 B",
        },
        href: `/admin/transfer?taskId=${taskId}`,
        targets: [profileTarget(requester)],
      },
    }))
  }

  {
    const scopeKey = "withdrawal"
    const taskId = deterministicUuid(scopeKey, "task")
    const legacyTemplate = legacyTemplateDeclaration(
      "퇴원 신청 접수 · {학생}",
      "{담당선생님} 선생님이 {학생} 학생의 퇴원을 신청했습니다.\n수업: {수업}",
      legacyRegistrationVariables(),
      1,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "withdrawal",
      eventKey: "withdrawal.submitted",
      sourceType: "ops_task_event",
      payloadSchemaVersion: 1,
      payload: {
        task_id: taskId,
        student_name: "박학생",
        requester_name: "최선생",
        class_name: "중2 B",
      },
      rule: {
        audienceKey: "management_team",
        channelKey: "google_chat",
        connectionKey: "google_chat.management",
      },
      legacy: {
        template: legacyTemplate,
        context: { student_name: "박학생", teacher_name: "최선생", class_name: "중2 B" },
        href: `/admin/withdrawal?taskId=${taskId}`,
        targets: [connectionTarget("google_chat.management")],
      },
    }))
  }

  {
    const scopeKey = "makeup_requests"
    const requestId = deterministicUuid(scopeKey, "request")
    const legacyTemplate = legacyTemplateDeclaration(
      "휴보강 신청서가 올라왔습니다",
      "{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강",
      legacyMakeupVariables(),
      1,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "makeup_requests",
      eventKey: "makeup.submitted",
      sourceType: "makeup_request_event",
      payloadSchemaVersion: 1,
      payload: {
        makeup_request_id: requestId,
        approval_group: "english",
        class_name: "중1 A",
        cancel_date: "2026-07-18",
        makeup_at: "2026-07-19 14:00",
        makeup_room: "301호",
      },
      rule: {
        audienceKey: "subject_team",
        channelKey: "google_chat",
        connectionKey: "google_chat.english",
      },
      legacy: {
        template: legacyTemplate,
        context: {
          class_name: "중1 A",
          cancel_date: "2026-07-18",
          makeup_at: "2026-07-19 14:00",
          makeup_room: "301호",
        },
        href: `/admin/makeup-requests?request=${requestId}`,
        targets: [connectionTarget("google_chat.english")],
      },
    }))
  }

  {
    const scopeKey = "registration"
    const taskId = deterministicUuid(scopeKey, "task")
    const legacyTemplate = legacyTemplateDeclaration(
      "등록 문의 접수 · {학생}",
      "{학생} 학생 등록 문의가 접수되었습니다.\n학년: {학년}\n문의일시: {문의일시}",
      legacyRegistrationVariables(),
      1,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "registration",
      eventKey: "registration.case_created",
      sourceType: "ops_task_event",
      payloadSchemaVersion: 1,
      payload: {
        task_id: taskId,
        student_name: "윤학생",
        grade: "중2",
        inquiry_at: FIXED_OCCURRED_AT,
        status: "1. 문의",
      },
      rule: {
        audienceKey: "management_team",
        channelKey: "google_chat",
        connectionKey: "google_chat.management",
      },
      legacy: {
        template: legacyTemplate,
        context: { student_name: "윤학생", grade: "중2", inquiry_at: FIXED_OCCURRED_AT },
        href: `/admin/registration?taskId=${taskId}`,
        targets: [connectionTarget("google_chat.management")],
      },
    }))
  }

  {
    const scopeKey = "registration_phone"
    const taskId = deterministicUuid(scopeKey, "task")
    const trackId = deterministicUuid(scopeKey, "track")
    const director = deterministicUuid(scopeKey, "director")
    const legacyTemplate = legacyTemplateDeclaration(
      "[{subject}] 전화상담 대기",
      "{student_name} 학생 상담을 확인하세요.",
      [
        legacyVariable("subject", "subject"),
        legacyVariable("student_name", "student_name", "student_name"),
      ],
      2,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "registration",
      eventKey: "registration.phone_consultation_ready",
      sourceType: "ops_task_event",
      payloadSchemaVersion: 2,
      payload: {
        task_id: taskId,
        track_id: trackId,
        student_name: "한학생",
        subject: "영어",
        recipient_revision: "3",
        director_profile_ids: [director],
      },
      rule: { audienceKey: "track_director", channelKey: "in_app" },
      legacy: {
        template: legacyTemplate,
        context: { student_name: "한학생", subject: "영어" },
        href: `/admin/registration?taskId=${taskId}&trackId=${trackId}`,
        targets: [profileTarget(director, "3")],
      },
    }))
  }

  {
    const scopeKey = "registration_visit"
    const taskId = deterministicUuid(scopeKey, "task")
    const appointmentId = deterministicUuid(scopeKey, "appointment")
    const director = deterministicUuid(scopeKey, "director")
    const legacyTemplate = legacyTemplateDeclaration(
      "[{subjects}] 방문상담 예약 배정",
      "{student_name} 학생 · {scheduled_at} · {place}",
      [
        legacyVariable("subjects", "subjects"),
        legacyVariable("student_name", "student_name", "student_name"),
        legacyVariable("scheduled_at", "scheduled_at", "schedule"),
        legacyVariable("place", "place", "location"),
      ],
      2,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "registration",
      eventKey: "registration.visit_scheduled",
      sourceType: "registration_appointment",
      sourceId: appointmentId,
      sourceRevision: "3",
      payloadSchemaVersion: 2,
      payload: {
        task_id: taskId,
        appointment_id: appointmentId,
        notification_revision: "3",
        recipient_revision: "4",
        director_profile_ids: [director],
        student_name: "송학생",
        subjects: "영어",
        scheduled_at: "2026-07-22T06:00:00.000Z",
        place: "2층 상담실",
      },
      rule: { audienceKey: "track_director", channelKey: "in_app" },
      legacy: {
        template: legacyTemplate,
        context: {
          student_name: "송학생",
          subjects: "영어",
          scheduled_at: "2026-07-22T06:00:00.000Z",
          place: "2층 상담실",
        },
        href: `/admin/registration?taskId=${taskId}&appointmentId=${appointmentId}&view=calendar`,
        targets: [profileTarget(director, "4")],
      },
    }))
  }

  {
    const scopeKey = "registration_solapi"
    const taskId = deterministicUuid(scopeKey, "task")
    const messageId = deterministicUuid(scopeKey, "message")
    const legacyTemplate = legacyTemplateDeclaration(
      "입학신청서 안내",
      "{student_name} 학생 입학신청서 안내",
      [legacyVariable("student_name", "student_name", "student_name")],
      2,
    )
    fixtures.push(baseFixture(scopeKey, {
      workflowKey: "registration",
      eventKey: "registration.admission_message_requested",
      sourceType: "ops_registration_message",
      sourceId: messageId,
      payloadSchemaVersion: 2,
      payload: {
        task_id: taskId,
        message_id: messageId,
        message_request_key: "preview-registration-message-v1",
        student_name: "임학생",
      },
      rule: { audienceKey: "applicant_guardian", channelKey: "customer_message" },
      legacy: {
        template: legacyTemplate,
        context: { student_name: "임학생" },
        href: `/admin/registration?taskId=${taskId}`,
        targets: [customerTarget(messageId)],
      },
    }))
  }

  return Object.freeze(fixtures)
}

const FIXTURES = buildFixtures()

function renderLegacyTemplate(templateSnapshot, context, href) {
  const tokenToKey = new Map(templateSnapshot.allowedVariables.map((item) => [item.token, item.key]))
  const render = (value) => value.replace(TOKEN_PATTERN, (_match, token) => {
    const key = tokenToKey.get(token)
    if (!key || typeof context[key] !== "string") throw new Error("legacy_preview_render_invalid")
    return context[key]
  })
  return Object.freeze({
    title: render(templateSnapshot.titleTemplate),
    body: render(templateSnapshot.bodyTemplate),
    href,
  })
}

function createSideEffectBoundary() {
  const counters = {
    externalRequests: 0,
    providerAttempts: 0,
    canonicalInboxProjections: 0,
    duplicateExternalRequests: 0,
    databaseOperations: 0,
  }
  const externalFingerprints = new Set()
  return Object.freeze({
    async forbiddenFetch(input) {
      const fingerprint = String(input)
      counters.externalRequests += 1
      if (externalFingerprints.has(fingerprint)) counters.duplicateExternalRequests += 1
      externalFingerprints.add(fingerprint)
      throw new Error("notification_shadow_preview_external_request_forbidden")
    },
    snapshot() {
      return Object.freeze({ ...counters })
    },
  })
}

async function buildLegacyIntents(fixture, dependencies) {
  const intents = []
  const templateSnapshot = dependencies.legacyTemplateTransform(
    fixture.legacy.template,
    fixture.scopeKey,
  )
  const rendered = renderLegacyTemplate(
    templateSnapshot,
    fixture.legacy.context,
    fixture.legacy.href,
  )
  const legacyTemplateChecksumValue = legacyTemplateChecksum(templateSnapshot)

  for (const [index, target] of fixture.legacy.targets.entries()) {
    const deliveryId = deterministicUuid(fixture.scopeKey, `legacy-delivery-${index}`)
    const result = await recordLegacyNotificationDeliveryIntent({
      deliveryId,
      requestId: deterministicUuid(fixture.scopeKey, `legacy-request-${index}`),
      legacyTemplateChecksum: legacyTemplateChecksumValue,
      title: rendered.title,
      body: rendered.body,
      href: rendered.href,
      async record(recorded) {
        intents.push(Object.freeze({
          workflowKey: fixture.legacy.workflowKey,
          eventKey: fixture.legacy.eventKey,
          occurrenceKey: fixture.occurrenceKey,
          audienceKey: fixture.legacy.audienceKey,
          channelKey: fixture.legacy.channelKey,
          targetKey: target.targetKey,
          targetGeneration: target.targetGeneration,
          templateChecksum: recorded.legacyTemplateChecksum,
          normalizedRenderedContentHash: recorded.normalizedRenderedHash,
        }))
        return { recorded: true }
      },
    })
    if (!result.recorded) throw new Error(`notification_shadow_preview_legacy_record_failed:${fixture.scopeKey}`)
  }
  return Object.freeze(intents)
}

async function buildCanonicalIntents(fixture, dependencies) {
  const adapter = dependencies.getAdapter(fixture.workflowKey)
  if (!adapter) throw new Error(`notification_shadow_preview_adapter_missing:${fixture.scopeKey}`)
  const templateSnapshot = dependencies.canonicalTemplateTransform(
    fixture.canonical.template,
    fixture.scopeKey,
  )
  const canonicalInput = Object.freeze({
    ...fixture.canonical,
    template: templateSnapshot,
  })
  const targetSet = await adapter.resolveTargets(canonicalInput)
  const canonicalTemplateChecksumValue = canonicalSeedTemplateChecksum(templateSnapshot)
  const intents = []

  for (const target of targetSet.targets) {
    const renderInput = Object.freeze({
      ...canonicalInput,
      targetGeneration: targetSet.targetGeneration,
      target,
    })
    const renderContext = await adapter.buildRenderContext(renderInput)
    const href = await adapter.buildDeepLink(renderInput)
    const rendered = dependencies.renderSnapshot({
      workflowKey: fixture.workflowKey,
      payloadSchemaVersion: fixture.canonical.payloadSchemaVersion,
      template: templateSnapshot,
      renderContext,
      href,
    })
    intents.push(Object.freeze({
      workflowKey: fixture.canonical.workflowKey,
      eventKey: fixture.canonical.eventKey,
      occurrenceKey: fixture.occurrenceKey,
      audienceKey: fixture.canonical.rule.audienceKey,
      channelKey: fixture.canonical.rule.channelKey,
      targetKey: target.targetKey,
      targetGeneration: targetSet.targetGeneration,
      templateChecksum: canonicalTemplateChecksumValue,
      normalizedRenderedContentHash: normalizedNotificationRenderedHash({
        title: rendered.renderedTitle,
        body: rendered.renderedBody,
        href: rendered.href,
      }),
    }))
  }
  return Object.freeze(intents)
}

function materializeCanonicalShadowRows(scopeKey, intents) {
  return Object.freeze(intents.map((intent, index) => Object.freeze({
    deliveryId: deterministicUuid(scopeKey, `canonical-delivery-${index}`),
    targetKey: intent.targetKey,
    status: "skipped",
    skipReason: "shadow_mode",
    replayable: false,
  })))
}

async function runFixtureCycle(fixture, dependencies) {
  const boundary = createSideEffectBoundary()
  const originalFetch = globalThis.fetch
  globalThis.fetch = boundary.forbiddenFetch
  try {
    const legacyIntents = await buildLegacyIntents(fixture, dependencies)
    const canonicalIntents = await buildCanonicalIntents(fixture, dependencies)
    const comparison = dependencies.compareIntents(legacyIntents, canonicalIntents)
    if (!comparison.matched) {
      throw new Error(`notification_shadow_preview_mismatch:${fixture.scopeKey}`)
    }
    const sideEffects = boundary.snapshot()
    return Object.freeze({
      owner: fixture.scopeKey,
      scopeKey: fixture.scopeKey,
      workflowKey: fixture.workflowKey,
      complete: true,
      adapterSource: "notification-workflow-registry",
      rendererSource: "notification-worker.renderNotificationSnapshot",
      legacyTransport: "injected_recorder",
      recordedLegacyIntents: legacyIntents.length,
      canonicalRows: materializeCanonicalShadowRows(fixture.scopeKey, canonicalIntents),
      comparison: Object.freeze({
        matched: comparison.matched,
        mismatches: Object.freeze([...comparison.mismatches]),
      }),
      enabledRuleWithoutAudienceCount: 0,
      zeroAudienceInvestigated: false,
      ...sideEffects,
      intentDigest: digestJson({ legacyIntents, canonicalIntents }),
    })
  } finally {
    globalThis.fetch = originalFetch
  }
}

function total(cycles, field) {
  return cycles.reduce((sum, cycle) => sum + cycle[field], 0)
}

export function verifyNotificationShadowPreviewManifest(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false
  const manifest = evidence.manifest
  if (
    !manifest
    || manifest.algorithm !== "sha256"
    || manifest.canonicalization !== "sorted-json-v1"
    || typeof manifest.digest !== "string"
  ) return false
  const payload = { ...evidence }
  delete payload.manifest
  return digestJson(payload) === manifest.digest
}

export async function runNotificationShadowPreviewFixtures(input = {}) {
  const dependencies = Object.freeze({
    getAdapter: input.getAdapter ?? getNotificationWorkflowAdapter,
    renderSnapshot: input.renderSnapshot ?? renderNotificationSnapshot,
    compareIntents: input.compareIntents ?? compareNotificationShadowIntents,
    canonicalTemplateTransform: input.canonicalTemplateTransform ?? ((templateSnapshot) => templateSnapshot),
    legacyTemplateTransform: input.legacyTemplateTransform ?? ((templateSnapshot) => templateSnapshot),
  })
  const cycles = []
  for (const fixture of FIXTURES) cycles.push(await runFixtureCycle(fixture, dependencies))

  const fixtureVerification = verifyDeterministicNotificationShadowFixture({ cycles })
  if (!fixtureVerification.passed) {
    throw new Error(`notification_shadow_preview_safety_failed:${fixtureVerification.blockers.join(",")}`)
  }
  const payload = Object.freeze({
    schemaVersion: 1,
    runner: "notification-shadow-preview-v1",
    passed: true,
    scopeOrder: NOTIFICATION_SHADOW_PREVIEW_SCOPES,
    totals: Object.freeze({
      completedScopes: cycles.length,
      recordedLegacyIntents: total(cycles, "recordedLegacyIntents"),
      canonicalRows: cycles.reduce((sum, cycle) => sum + cycle.canonicalRows.length, 0),
      externalRequests: total(cycles, "externalRequests"),
      providerAttempts: total(cycles, "providerAttempts"),
      canonicalInboxProjections: total(cycles, "canonicalInboxProjections"),
      duplicateExternalRequests: total(cycles, "duplicateExternalRequests"),
      databaseOperations: total(cycles, "databaseOperations"),
    }),
    cycles: Object.freeze(cycles),
  })
  return Object.freeze({
    ...payload,
    manifest: Object.freeze({
      algorithm: "sha256",
      canonicalization: "sorted-json-v1",
      digest: digestJson(payload),
    }),
  })
}

async function main() {
  const evidence = await runNotificationShadowPreviewFixtures()
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "preview fixture 실행에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
