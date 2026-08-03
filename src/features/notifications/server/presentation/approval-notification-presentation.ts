import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDateTime,
  formatNotificationPersonOrTeam,
  sanitizeNotificationFreeText,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const APPROVAL_EVENT_KEYS = new Set([
  "approval.created",
  "approval.submitted",
  "approval.review_started",
  "approval.approver_changed",
  "approval.approved",
  "approval.returned",
  "approval.canceled",
  "approval.resubmitted",
  "approval.comment_added",
])
const EXPECTED_STATES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "approval.created": new Set(["draft"]),
  "approval.submitted": new Set(["submitted"]),
  "approval.review_started": new Set(["reviewing"]),
  "approval.approver_changed": new Set(["draft", "submitted", "reviewing", "returned"]),
  "approval.approved": new Set(["approved"]),
  "approval.returned": new Set(["returned"]),
  "approval.canceled": new Set(["canceled"]),
  "approval.resubmitted": new Set(["submitted"]),
  "approval.comment_added": new Set(["draft", "submitted", "reviewing", "approved", "returned", "canceled"]),
})
const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  draft: "초안",
  submitted: "결재 대기",
  reviewing: "검토 중",
  approved: "승인 완료",
  returned: "반려",
  canceled: "취소",
})
const ATTACHMENT_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  image: "이미지",
  pdf: "PDF",
  document: "문서",
  spreadsheet: "스프레드시트",
  presentation: "프레젠테이션",
  video: "동영상",
  audio: "음성",
  link: "링크",
  other: "기타",
})
const ATTACHMENT_LABEL_ORDER = Object.freeze([
  "이미지", "PDF", "문서", "스프레드시트", "프레젠테이션", "동영상", "음성", "링크", "기타",
])
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu
const UNSAFE_STRUCTURED_PATTERN = /(?:<[^>]*>|(?:https?:\/\/|www\.)|\/admin\/|@(all|everyone|here|channel)\b)/iu
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

function presentationError(code: string): never {
  throw new Error(code)
}

function hasOwn(payload: Readonly<Record<string, unknown>>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function requiredValue(payload: Readonly<Record<string, unknown>>, key: string) {
  if (!hasOwn(payload, key) || payload[key] === undefined) {
    presentationError("notification_presentation_required_field_missing")
  }
  return payload[key]
}

function normalizedStructuredText(value: unknown, required: boolean) {
  if (value === undefined || value === null) {
    if (required) presentationError("notification_presentation_required_field_invalid")
    return null
  }
  if (typeof value !== "string") presentationError("notification_presentation_required_field_invalid")
  const normalized = value.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim()
  if (!normalized) {
    if (required) presentationError("notification_presentation_required_field_invalid")
    return null
  }
  if (UUID_PATTERN.test(normalized) || UNSAFE_STRUCTURED_PATTERN.test(normalized)) {
    presentationError("notification_presentation_required_field_invalid")
  }
  return normalized
}

function requiredStructuredText(payload: Readonly<Record<string, unknown>>, key: string) {
  return normalizedStructuredText(requiredValue(payload, key), true) as string
}

function personSnapshot(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
) {
  const value = requiredValue(payload, key)
  return formatNotificationPersonOrTeam({ personName: value, fallback })
}

function approverSnapshot(
  payload: Readonly<Record<string, unknown>>,
  key: "before_approver_name" | "after_approver_name",
) {
  const value = requiredValue(payload, key)
  if (value === null) return "결재자 지정 대기"
  return formatNotificationPersonOrTeam({ personName: value })
}

function currentApprover(payload: Readonly<Record<string, unknown>>) {
  const value = requiredValue(payload, "current_approver_name")
  return formatNotificationPersonOrTeam({ personName: value, fallback: "담당 결재자" })
}

function eventState(input: NotificationPresentationInput) {
  const state = requiredStructuredText(input.payload, "status")
  if (!EXPECTED_STATES[input.eventKey]?.has(state)) {
    presentationError("notification_approval_event_state_mismatch")
  }
  return state
}

function destinationAllowed(input: NotificationPresentationInput) {
  if (input.channelKey === "google_chat") {
    return input.audienceKey === "management_team"
      && input.connectionKey === "google_chat.management"
      && input.destinationTeam === "management"
  }
  if (input.channelKey !== "in_app" && input.channelKey !== "web_push") return false
  return input.connectionKey === null
    && input.destinationTeam === null
    && new Set(["requester_profile", "approver_profile", "management_team"]).has(input.audienceKey)
}

function occurredAt(input: NotificationPresentationInput) {
  return hasOwn(input.payload, "occurred_at") ? input.payload.occurred_at : input.scheduledFor
}

function subjectParticle(value: string) {
  const last = value.codePointAt(value.length - 1)
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return `${value}이(가)`
  return `${value}${(last - 0xac00) % 28 === 0 ? "가" : "이"}`
}

function progressLine(input: NotificationPresentationInput, state: string) {
  const approver = currentApprover(input.payload)
  if (input.eventKey === "approval.approver_changed") {
    const after = approverSnapshot(input.payload, "after_approver_name")
    return after === "결재자 지정 대기"
      ? "[진행] 결재자 지정을 기다리고 있어요."
      : `[진행] ${after}의 결재를 기다리고 있어요.`
  }
  if (state === "draft") return "[진행] 문서가 초안 상태예요."
  if (state === "submitted") return `[진행] ${approver}의 결재를 기다리고 있어요.`
  if (state === "reviewing") return `[진행] ${subjectParticle(approver)} 검토하고 있어요.`
  if (state === "approved") return "[진행] 결재가 승인 완료 상태예요."
  if (state === "returned") return "[진행] 문서가 반려 상태예요."
  return "[진행] 결재가 취소 상태예요."
}

function attachmentLine(payload: Readonly<Record<string, unknown>>) {
  const count = requiredValue(payload, "attachment_count")
  const types = requiredValue(payload, "attachment_types")
  if (!Number.isSafeInteger(count) || (count as number) < 0 || !Array.isArray(types)) {
    presentationError("notification_approval_attachment_snapshot_invalid")
  }
  if (count === 0) return ""
  const labels = [...new Set(types.map((value) => {
    if (typeof value !== "string") presentationError("notification_approval_attachment_snapshot_invalid")
    const type = value.trim().toLowerCase()
    return ATTACHMENT_TYPE_LABELS[type] ?? "기타"
  }))].sort((left, right) => ATTACHMENT_LABEL_ORDER.indexOf(left) - ATTACHMENT_LABEL_ORDER.indexOf(right))
  if (labels.length > (count as number)) presentationError("notification_approval_attachment_snapshot_invalid")
  const typeSuffix = labels.length > 0 ? ` · ${labels.join(", ")}` : ""
  return `[첨부] 파일 ${count}개${typeSuffix}`
}

function selectedFreeText(input: NotificationPresentationInput): Readonly<Record<string, string>> {
  if (["approval.created", "approval.review_started", "approval.approved"].includes(input.eventKey)) {
    return selectNotificationFreeTextFields(input.payload, ["memo"])
  }
  if (input.eventKey === "approval.returned" || input.eventKey === "approval.canceled") {
    return selectNotificationFreeTextFields(input.payload, ["reason", "memo"])
  }
  return Object.freeze({})
}

export function buildApprovalNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (
    input.workflowKey !== "approvals"
    || input.payloadSchemaVersion !== 1
    || !APPROVAL_EVENT_KEYS.has(input.eventKey)
    || input.contractIdentity.workflowKey !== "approvals"
    || input.contractIdentity.eventKey !== input.eventKey
    || input.contractIdentity.audienceKey !== input.audienceKey
    || input.contractIdentity.channelKey !== (input.channelKey === "web_push" ? "in_app" : input.channelKey)
    || input.contractIdentity.ruleVariantKey !== input.ruleVariantKey
  ) {
    presentationError("notification_payload_schema_unsupported")
  }

  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  if (!destinationAllowed(input)) presentationError("notification_approval_destination_unsupported")
  const state = eventState(input)
  const freeText = selectedFreeText(input)
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }

  add("document_title", () => requiredStructuredText(input.payload, "title"))
  add("author_name", () => requiredStructuredText(input.payload, "author_name"))
  add("target_period", () => requiredStructuredText(input.payload, "target_period"))
  add("current_status", () => STATUS_LABELS[state] ?? presentationError("notification_approval_status_unsupported"))
  add("progress_actor", () => currentApprover(input.payload))
  add("reviewer_name", () => personSnapshot(input.payload, "actor_name", "결재 담당자"))
  add("before_approver", () => approverSnapshot(input.payload, "before_approver_name"))
  add("after_approver", () => approverSnapshot(input.payload, "after_approver_name"))
  add("approval_actor", () => personSnapshot(input.payload, "actor_name", "결재 담당자"))
  add("return_actor", () => personSnapshot(input.payload, "actor_name", "결재 담당자"))
  add("cancel_actor", () => personSnapshot(input.payload, "actor_name", "결재 처리자"))
  add("resubmitter_name", () => personSnapshot(input.payload, "actor_name", "재상신자"))
  add("processed_at", () => formatNotificationKstDateTime(
    requiredValue(input.payload, "status_changed_at"),
    occurredAt(input),
  ))
  add("comment_author", () => personSnapshot(input.payload, "comment_author_name", "댓글 작성자"))
  add("comment_preview", () => {
    const preview = sanitizeNotificationFreeText(requiredValue(input.payload, "comment_body"))
    if (!preview) presentationError("notification_presentation_required_field_invalid")
    return preview
  })
  add("attachment_line", () => attachmentLine(input.payload))
  add("progress_line", () => progressLine(input, state))
  add("reason_line", () => buildOptionalNotificationLine("사유", freeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", freeText.memo))

  return Object.freeze(context)
}
