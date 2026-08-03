import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDate,
  formatNotificationKstDateTime,
  formatNotificationPersonOrTeam,
  sanitizeNotificationFreeText,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const MAKEUP_EVENT_KEYS = new Set([
  "makeup.submitted",
  "makeup.refund_requested",
  "makeup.approved",
  "makeup.refund_completed",
  "makeup.approval_canceled",
  "makeup.revision_requested",
  "makeup.rejected",
])
const LEGACY_CONTEXT_KEYS = new Set([
  "process", "status", "class_name", "subject", "teacher_name", "reason", "cancel_date",
  "makeup_at", "makeup_room_spaced", "makeup_room", "requester_name", "submitted_at",
  "revision_requested_at", "revision_reason", "approved_at", "approval_note", "rejected_at",
  "rejected_reason", "canceled_at", "canceled_note", "approver_name", "fallback_title", "fallback_body",
])
const SUBJECT_BY_APPROVAL_GROUP: Readonly<Record<string, string>> = Object.freeze({
  english: "영어",
  math_middle: "수학",
  math_high: "수학",
  science: "과학",
  "과학": "과학",
})
const DESTINATION_BY_SUBJECT: Readonly<Record<string, string>> = Object.freeze({
  "영어": "english",
  "수학": "math",
  "과학": "science",
})
const EXPECTED_STATES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "makeup.submitted": new Set(["approval_pending"]),
  "makeup.refund_requested": new Set(["refund_pending"]),
  "makeup.approved": new Set(["manager_pending", "makeup_pending", "completed"]),
  "makeup.refund_completed": new Set(["completed"]),
  "makeup.approval_canceled": new Set(["canceled"]),
  "makeup.revision_requested": new Set(["revision_requested"]),
  "makeup.rejected": new Set(["rejected"]),
})
const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  approval_pending: "결재자 승인 대기",
  revision_requested: "보완 요청",
  rejected: "반려",
  manager_pending: "이전 관리팀 전달",
  makeup_pending: "보강대기",
  refund_pending: "환불대기",
  completed: "완료",
  canceled: "승인 취소",
})
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu
const UNSAFE_STRUCTURED_PATTERN = /(?:<[^>]*>|(?:https?:\/\/|www\.)|\/admin\/|@(all|everyone|here|channel)\b)/iu
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

function presentationError(code: string): never {
  throw new Error(code)
}

function hasOwn(payload: Readonly<Record<string, unknown>>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function firstValue(payload: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>) {
  for (const key of keys) {
    if (hasOwn(payload, key) && payload[key] !== undefined) return payload[key]
  }
  return presentationError("notification_presentation_required_field_missing")
}

function optionalValue(payload: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>) {
  for (const key of keys) {
    if (hasOwn(payload, key) && payload[key] !== undefined && payload[key] !== null) return payload[key]
  }
  return undefined
}

function structuredText(value: unknown) {
  if (typeof value !== "string") presentationError("notification_presentation_required_field_invalid")
  const normalized = value.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim()
  if (!normalized || UUID_PATTERN.test(normalized) || UNSAFE_STRUCTURED_PATTERN.test(normalized)) {
    presentationError("notification_presentation_required_field_invalid")
  }
  return normalized
}

function occurredAt(input: NotificationPresentationInput) {
  return optionalValue(input.payload, ["occurred_at"]) ?? input.scheduledFor
}

function eventState(input: NotificationPresentationInput) {
  const state = structuredText(firstValue(input.payload, ["workflow_status", "status"]))
  if (!EXPECTED_STATES[input.eventKey]?.has(state)) {
    presentationError("notification_makeup_event_state_mismatch")
  }
  return state
}

function selectedSubject(payload: Readonly<Record<string, unknown>>) {
  const subject = structuredText(firstValue(payload, ["subject", "subjects"]))
  const approvalGroup = structuredText(firstValue(payload, ["approval_group", "subject_team_key"]))
  if (SUBJECT_BY_APPROVAL_GROUP[approvalGroup] !== subject) {
    presentationError("notification_makeup_subject_unsupported")
  }
  return subject
}

function allowedDestination(input: NotificationPresentationInput, subject: string) {
  const eventFamily = input.eventKey === "makeup.submitted" || input.eventKey === "makeup.refund_requested"
    ? "request"
    : input.eventKey === "makeup.revision_requested" || input.eventKey === "makeup.rejected"
      ? "review"
      : "result"
  if (input.channelKey === "in_app" || input.channelKey === "web_push") {
    if (input.connectionKey !== null || input.destinationTeam !== null) return false
    if (eventFamily === "request") return input.audienceKey === "approver_profile" || input.audienceKey === "management_team"
    if (eventFamily === "review") return input.audienceKey === "requester_profile"
    return input.audienceKey === "requester_profile"
      || input.audienceKey === "approver_profile"
      || input.audienceKey === "management_team"
  }
  if (input.channelKey !== "google_chat") return false
  if (input.audienceKey === "management_team") {
    return input.connectionKey === "google_chat.management" && input.destinationTeam === "management"
  }
  if (input.audienceKey === "executive_team" && eventFamily !== "review") {
    return input.connectionKey === "google_chat.executive" && input.destinationTeam === "executive"
  }
  if (input.audienceKey === "subject_team") {
    const expectedTeam = DESTINATION_BY_SUBJECT[subject]
    return input.connectionKey === `google_chat.${expectedTeam}` && input.destinationTeam === expectedTeam
  }
  return false
}

function seoulDateKey(value: unknown) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    presentationError("notification_makeup_schedule_invalid")
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) presentationError("notification_makeup_schedule_invalid")
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

type ScheduleEntry = Readonly<{ startAt: unknown; endAt: unknown; place: string }>
type MakeupRequestKind = "cancel_makeup" | "cancel_only" | "makeup_only"

function requestKind(payload: Readonly<Record<string, unknown>>): MakeupRequestKind {
  const raw = optionalValue(payload, ["request_kind"])
  if (raw === undefined) {
    const cancelDate = optionalValue(payload, ["cancel_date", "cancellation_date"])
    const schedule = optionalValue(payload, ["makeup_schedule"])
    if (cancelDate !== undefined && Array.isArray(schedule) && schedule.length > 0) {
      return "cancel_makeup"
    }
    return presentationError("notification_makeup_request_kind_invalid")
  }
  const normalized = structuredText(raw)
  if (normalized !== "cancel_makeup" && normalized !== "cancel_only" && normalized !== "makeup_only") {
    presentationError("notification_makeup_request_kind_invalid")
  }
  return normalized
}

function formattedCancellationDate(input: NotificationPresentationInput) {
  const kind = requestKind(input.payload)
  const value = optionalValue(input.payload, ["cancel_date", "cancellation_date"])
  if (kind === "makeup_only") {
    if (value !== undefined) presentationError("notification_makeup_request_kind_invalid")
    return "해당 없음 (보강만 신청)"
  }
  if (value === undefined) presentationError("notification_presentation_required_field_missing")
  return formatNotificationKstDate(value, occurredAt(input))
}

function scheduleEntries(input: NotificationPresentationInput): ReadonlyArray<ScheduleEntry> {
  const kind = requestKind(input.payload)
  const raw = optionalValue(input.payload, ["makeup_schedule"])
  if (kind === "cancel_only") {
    if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return []
    presentationError("notification_makeup_request_kind_invalid")
  }
  if (!Array.isArray(raw) || raw.length === 0) presentationError("notification_makeup_schedule_invalid")
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      presentationError("notification_makeup_schedule_invalid")
    }
    const row = item as Readonly<Record<string, unknown>>
    const startAt = optionalValue(row, ["start_at", "startAt"])
    const endAt = optionalValue(row, ["end_at", "endAt"])
    const rawPlace = optionalValue(row, ["place", "classroom", "room"])
    if (startAt === undefined || endAt === undefined || rawPlace === undefined) {
      presentationError("notification_makeup_schedule_invalid")
    }
    const place = structuredText(rawPlace)
    const start = new Date(startAt as string)
    const end = new Date(endAt as string)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      presentationError("notification_makeup_schedule_invalid")
    }
    return Object.freeze({ startAt, endAt, place })
  })
}

function formattedSchedule(input: NotificationPresentationInput, entries: ReadonlyArray<ScheduleEntry>) {
  if (entries.length === 0) return "해당 없음 (휴강만 신청)"
  return entries.map((entry) => {
    const start = formatNotificationKstDateTime(entry.startAt, occurredAt(input))
    const end = formatNotificationKstDateTime(entry.endAt, occurredAt(input))
    return seoulDateKey(entry.startAt) === seoulDateKey(entry.endAt)
      ? `${start}~${end.slice(end.lastIndexOf(" ") + 1)}`
      : `${start}~${end}`
  }).join(" · ")
}

function formattedPlaces(entries: ReadonlyArray<ScheduleEntry>) {
  if (entries.length === 0) return "해당 없음 (휴강만 신청)"
  return [...new Set(entries.map((entry) => entry.place))].join(", ")
}

function formattedPerson(payload: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>) {
  return formatNotificationPersonOrTeam({ personName: firstValue(payload, keys) })
}

function processedAt(input: NotificationPresentationInput) {
  const value = firstValue(input.payload, [
    "status_changed_at", "processed_at", "approved_at", "rejected_at", "canceled_at",
  ])
  return formatNotificationKstDateTime(value, occurredAt(input))
}

function attachmentLine(payload: Readonly<Record<string, unknown>>) {
  const count = optionalValue(payload, ["attachment_count"])
  const types = optionalValue(payload, ["attachment_types"])
  if (count === undefined && types === undefined) return ""
  if (!Number.isSafeInteger(count) || (count as number) < 0 || !Array.isArray(types)) {
    presentationError("notification_makeup_attachment_snapshot_invalid")
  }
  if (count === 0) return ""
  const labels = [...new Set(types.map((value) => {
    const kind = structuredText(value).toLowerCase()
    if (kind === "image" || kind.startsWith("image/")) return "이미지"
    if (kind === "pdf" || kind === "application/pdf") return "PDF"
    if (["document", "doc", "docx"].includes(kind)) return "문서"
    if (["spreadsheet", "xls", "xlsx"].includes(kind)) return "스프레드시트"
    return "기타"
  }))].sort((left, right) => ["이미지", "PDF", "문서", "스프레드시트", "기타"].indexOf(left)
    - ["이미지", "PDF", "문서", "스프레드시트", "기타"].indexOf(right))
  const typeSuffix = labels.length > 0 ? ` · ${labels.join(", ")}` : ""
  return `[첨부] 파일 ${count}개${typeSuffix}`
}

function freeTextCandidates(input: NotificationPresentationInput) {
  const eventNote = optionalValue(input.payload, ["event_note"])
  switch (input.eventKey) {
    case "makeup.submitted":
      return { priority: ["reason", "memo"], values: { reason: input.payload.reason, memo: input.payload.memo } }
    case "makeup.refund_requested":
      return { priority: ["reason"], values: { reason: eventNote ?? input.payload.reason } }
    case "makeup.approved":
      return { priority: ["memo"], values: { memo: eventNote ?? input.payload.approval_note ?? input.payload.memo } }
    case "makeup.refund_completed":
      return { priority: ["memo"], values: { memo: eventNote ?? input.payload.memo } }
    case "makeup.approval_canceled":
      return {
        priority: ["reason", "memo"],
        values: { reason: eventNote ?? input.payload.canceled_note ?? input.payload.reason, memo: input.payload.memo },
      }
    case "makeup.revision_requested":
      return { priority: ["reason"], values: { reason: eventNote ?? input.payload.revision_reason } }
    case "makeup.rejected":
      return {
        priority: ["reason", "memo"],
        values: { reason: eventNote ?? input.payload.rejected_reason, memo: input.payload.memo },
      }
    default:
      return presentationError("notification_payload_schema_unsupported")
  }
}

function legacyContext(input: NotificationPresentationInput, requested: ReadonlySet<string>) {
  const context: Record<string, string> = {}
  for (const key of requested) {
    if (!LEGACY_CONTEXT_KEYS.has(key)) continue
    const value = optionalValue(input.payload, [key])
    if (value === undefined) continue
    const rendered = ["reason", "revision_reason", "approval_note", "rejected_reason", "canceled_note"]
      .includes(key)
      ? sanitizeNotificationFreeText(value)
      : structuredText(value)
    if (rendered) context[key] = rendered
  }
  return Object.freeze(context)
}

export function buildMakeupNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (
    input.workflowKey !== "makeup_requests"
    || input.payloadSchemaVersion !== 1
    || !MAKEUP_EVENT_KEYS.has(input.eventKey)
    || input.contractIdentity.workflowKey !== "makeup_requests"
    || input.contractIdentity.eventKey !== input.eventKey
    || input.contractIdentity.audienceKey !== input.audienceKey
    || input.contractIdentity.channelKey !== (input.channelKey === "web_push" ? "in_app" : input.channelKey)
    || input.contractIdentity.ruleVariantKey !== input.ruleVariantKey
  ) {
    presentationError("notification_payload_schema_unsupported")
  }

  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  const legacy = [...requested].every((key) => LEGACY_CONTEXT_KEYS.has(key))
  if (legacy) return legacyContext(input, requested)

  const subject = selectedSubject(input.payload)
  if (!allowedDestination(input, subject)) {
    presentationError("notification_makeup_destination_unsupported")
  }
  const state = eventState(input)
  const schedules = [...requested].some((key) => ["makeup_schedule", "target_schedule", "place"].includes(key))
    ? scheduleEntries(input)
    : null
  const freeText = freeTextCandidates(input)
  const selectedFreeText = selectNotificationFreeTextFields(freeText.values, freeText.priority)
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }

  add("class_name", () => structuredText(firstValue(input.payload, ["class_name"])))
  add("subjects", () => subject)
  add("teacher_name", () => structuredText(firstValue(input.payload, ["teacher_name"])))
  add("cancellation_date", () => formattedCancellationDate(input))
  add("makeup_schedule", () => formattedSchedule(input, schedules ?? presentationError("notification_makeup_schedule_invalid")))
  add("target_schedule", () => formattedSchedule(input, schedules ?? presentationError("notification_makeup_schedule_invalid")))
  add("place", () => formattedPlaces(schedules ?? presentationError("notification_makeup_schedule_invalid")))
  add("current_status", () => STATUS_LABELS[state] ?? structuredText(firstValue(input.payload, ["status"])))
  add("progress_actor", () => formattedPerson(input.payload, ["approver_name"]))
  add("approval_actor", () => formattedPerson(input.payload, ["actor_name", "approver_name"]))
  add("processing_actor", () => formattedPerson(input.payload, ["actor_name"]))
  add("return_actor", () => formattedPerson(input.payload, ["actor_name", "approver_name"]))
  add("processed_at", () => processedAt(input))
  add("reason_line", () => buildOptionalNotificationLine("사유", selectedFreeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", selectedFreeText.memo))
  add("progress_line", () => input.eventKey === "makeup.refund_requested"
    ? "[진행] 관리팀의 환불 확인을 기다리고 있어요."
    : "")
  add("attachment_line", () => attachmentLine(input.payload))

  return Object.freeze(context)
}
