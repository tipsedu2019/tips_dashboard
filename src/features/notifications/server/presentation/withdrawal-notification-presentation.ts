import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDate,
  formatNotificationPersonOrTeam,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const WITHDRAWAL_EVENT_KEYS = new Set([
  "withdrawal.submitted",
  "withdrawal.completed",
])
const LEGACY_CONTEXT_KEYS = new Set([
  "student_name",
  "teacher_name",
  "class_name",
  "withdrawal_date",
  "withdrawal_round",
])
const SUBJECT_ORDER = ["영어", "수학", "과학"] as const
const SUBJECT_SET = new Set<string>(SUBJECT_ORDER)
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

function structuredText(value: unknown) {
  if (typeof value !== "string") presentationError("notification_presentation_required_field_invalid")
  const normalized = value.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim()
  if (!normalized || UUID_PATTERN.test(normalized) || UNSAFE_STRUCTURED_PATTERN.test(normalized)) {
    presentationError("notification_presentation_required_field_invalid")
  }
  return normalized
}

function studentName(payload: Readonly<Record<string, unknown>>) {
  const name = structuredText(firstValue(payload, ["student_name"]))
  return name.endsWith("학생") ? name : `${name} 학생`
}

function selectedSubject(payload: Readonly<Record<string, unknown>>) {
  const raw = firstValue(payload, ["selected_subject", "subjects", "subject"])
  const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw
  const subject = structuredText(value)
  if (!SUBJECT_SET.has(subject)) presentationError("notification_withdrawal_subject_unsupported")
  return subject
}

function occurredAt(input: NotificationPresentationInput) {
  return hasOwn(input.payload, "occurred_at") && input.payload.occurred_at !== undefined
    ? input.payload.occurred_at
    : input.scheduledFor
}

function dateValue(input: NotificationPresentationInput) {
  const keys = input.eventKey === "withdrawal.completed"
    ? ["applied_withdrawal_date", "withdrawal_date"]
    : ["requested_withdrawal_date", "withdrawal_date"]
  const value = firstValue(input.payload, keys)
  if (value === null) presentationError("notification_presentation_null_field_invalid")
  return formatNotificationKstDate(value, occurredAt(input))
}

function roundValue(input: NotificationPresentationInput) {
  const keys = input.eventKey === "withdrawal.completed"
    ? ["applied_withdrawal_round", "withdrawal_round"]
    : ["requested_withdrawal_round", "withdrawal_round"]
  return structuredText(firstValue(input.payload, keys))
}

function personName(payload: Readonly<Record<string, unknown>>, key: string) {
  return formatNotificationPersonOrTeam({ personName: structuredText(firstValue(payload, [key])) })
}

function requireEventState(input: NotificationPresentationInput) {
  const state = firstValue(input.payload, ["task_status", "status"])
  const expected = input.eventKey === "withdrawal.completed" ? "done" : "requested"
  if (state !== expected) presentationError("notification_withdrawal_event_state_mismatch")
}

function isManagementChat(input: NotificationPresentationInput) {
  return input.audienceKey === "management_team"
    && input.channelKey === "google_chat"
    && input.connectionKey === "google_chat.management"
    && input.destinationTeam === "management"
}

function isLegacyInbox(input: NotificationPresentationInput) {
  return (input.audienceKey === "requester_profile" || input.audienceKey === "management_team")
    && input.channelKey === "in_app"
    && input.connectionKey === null
    && input.destinationTeam === null
}

function validateDestination(input: NotificationPresentationInput, legacy: boolean) {
  if (!isManagementChat(input) && !(legacy && isLegacyInbox(input))) {
    presentationError("notification_withdrawal_destination_unsupported")
  }
}

function legacyTeacherToken(payload: Readonly<Record<string, unknown>>) {
  return structuredText(firstValue(payload, ["requester_name", "teacher_name"]))
}

function buildLegacyContext(
  input: NotificationPresentationInput,
  requested: ReadonlySet<string>,
) {
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }
  add("student_name", () => structuredText(firstValue(input.payload, ["student_name"])))
  add("teacher_name", () => legacyTeacherToken(input.payload))
  add("class_name", () => structuredText(firstValue(input.payload, ["class_name", "selected_class"])))
  add("withdrawal_date", () => structuredText(firstValue(input.payload, ["withdrawal_date"])))
  add("withdrawal_round", () => structuredText(firstValue(input.payload, ["withdrawal_round"])))
  return Object.freeze(context)
}

function otherActiveSubjects(input: NotificationPresentationInput, selected: string) {
  const raw = firstValue(input.payload, ["other_active_subjects"])
  if (!Array.isArray(raw)) presentationError("notification_withdrawal_other_subjects_invalid")
  const values = raw.map((value) => structuredText(value))
  if (values.some((value) => !SUBJECT_SET.has(value) || value === selected)) {
    presentationError("notification_withdrawal_other_subjects_invalid")
  }
  return [...new Set(values)].sort((left, right) => SUBJECT_ORDER.indexOf(left as typeof SUBJECT_ORDER[number])
    - SUBJECT_ORDER.indexOf(right as typeof SUBJECT_ORDER[number]))
}

function freeTextLines(input: NotificationPresentationInput): Readonly<Record<string, string>> {
  if (input.eventKey !== "withdrawal.submitted") return Object.freeze({})
  return selectNotificationFreeTextFields(input.payload, ["reason", "memo"])
}

export function buildWithdrawalNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (
    input.workflowKey !== "withdrawal"
    || input.payloadSchemaVersion !== 1
    || !WITHDRAWAL_EVENT_KEYS.has(input.eventKey)
    || input.contractIdentity.workflowKey !== "withdrawal"
    || input.contractIdentity.eventKey !== input.eventKey
    || input.contractIdentity.audienceKey !== input.audienceKey
    || input.contractIdentity.channelKey !== input.channelKey
    || input.contractIdentity.ruleVariantKey !== input.ruleVariantKey
  ) {
    presentationError("notification_payload_schema_unsupported")
  }

  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  const legacy = !hasOwn(input.payload, "task_status")
    && [...requested].every((key) => LEGACY_CONTEXT_KEYS.has(key))
  validateDestination(input, legacy)
  requireEventState(input)
  if (legacy) return buildLegacyContext(input, requested)

  const subject = selectedSubject(input.payload)
  const remainingSubjects = input.eventKey === "withdrawal.completed"
    ? otherActiveSubjects(input, subject)
    : []
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }

  add("student_name", () => studentName(input.payload))
  add("subjects", () => subject)
  add("class_name", () => structuredText(firstValue(input.payload, ["selected_class", "class_name"])))
  add("withdrawal_date", () => dateValue(input))
  add("withdrawal_round", () => roundValue(input))
  add("requester_name", () => personName(input.payload, "requester_name"))
  add("progress_line", () => input.eventKey === "withdrawal.submitted"
    ? "[진행] 관리팀의 수강 제외 일정 확인을 기다리고 있어요."
    : remainingSubjects.length > 0
      ? "[상태] 다른 과목 수강은 그대로 유지돼요."
      : "")

  const selectedFreeText = freeTextLines(input)
  add("reason_line", () => buildOptionalNotificationLine("사유", selectedFreeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", selectedFreeText.memo))

  return Object.freeze(context)
}
