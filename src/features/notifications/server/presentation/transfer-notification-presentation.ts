import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDate,
  formatNotificationPersonOrTeam,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const TRANSFER_EVENT_KEYS = new Set([
  "transfer.submitted",
  "transfer.completed",
])
const LEGACY_CONTEXT_KEYS = new Set([
  "student_name",
  "teacher_name",
  "before_class",
  "after_class",
  "before_end_date",
  "after_start_date",
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

function legacyTeacherToken(payload: Readonly<Record<string, unknown>>) {
  // The retired seed template named its applicant token `teacher_name`.
  // Keep that historical token accurate without conflating the new snapshots.
  return structuredText(firstValue(payload, ["requester_name", "teacher_name"]))
}

function studentName(payload: Readonly<Record<string, unknown>>) {
  const name = structuredText(firstValue(payload, ["student_name"]))
  return name.endsWith("학생") ? name : `${name} 학생`
}

function personName(payload: Readonly<Record<string, unknown>>, key: string) {
  return formatNotificationPersonOrTeam({ personName: structuredText(firstValue(payload, [key])) })
}

function occurredAt(input: NotificationPresentationInput) {
  return hasOwn(input.payload, "occurred_at") && input.payload.occurred_at !== undefined
    ? input.payload.occurred_at
    : input.scheduledFor
}

function dateValue(
  input: NotificationPresentationInput,
  keys: ReadonlyArray<string>,
) {
  const value = firstValue(input.payload, keys)
  if (value === null) presentationError("notification_presentation_null_field_invalid")
  return formatNotificationKstDate(value, occurredAt(input))
}

function requireEventState(input: NotificationPresentationInput) {
  const state = firstValue(input.payload, ["task_status", "status"])
  const expected = input.eventKey === "transfer.completed" ? "done" : "requested"
  if (state !== expected) presentationError("notification_transfer_event_state_mismatch")
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
    presentationError("notification_transfer_destination_unsupported")
  }
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
  add("before_class", () => structuredText(firstValue(input.payload, ["before_class", "from_class_name"])))
  add("after_class", () => structuredText(firstValue(input.payload, ["after_class", "to_class_name"])))
  add("before_end_date", () => structuredText(firstValue(input.payload, ["before_end_date", "before_class_end_date"])))
  add("after_start_date", () => structuredText(firstValue(input.payload, ["after_start_date", "after_class_start_date"])))
  return Object.freeze(context)
}

function freeTextLines(input: NotificationPresentationInput): Readonly<Record<string, string>> {
  if (input.eventKey !== "transfer.submitted") return Object.freeze({})
  return selectNotificationFreeTextFields(input.payload, ["reason", "memo"])
}

export function buildTransferNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (
    input.workflowKey !== "transfer"
    || input.payloadSchemaVersion !== 1
    || !TRANSFER_EVENT_KEYS.has(input.eventKey)
    || input.contractIdentity.workflowKey !== "transfer"
    || input.contractIdentity.eventKey !== input.eventKey
    || input.contractIdentity.audienceKey !== input.audienceKey
    || input.contractIdentity.channelKey !== input.channelKey
    || input.contractIdentity.ruleVariantKey !== input.ruleVariantKey
  ) {
    presentationError("notification_payload_schema_unsupported")
  }

  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  const legacy = [...requested].every((key) => LEGACY_CONTEXT_KEYS.has(key))
  validateDestination(input, legacy)
  requireEventState(input)
  if (legacy) return buildLegacyContext(input, requested)

  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }

  add("student_name", () => studentName(input.payload))
  add("before_class", () => structuredText(firstValue(input.payload, ["before_class", "from_class_name"])))
  add("after_class", () => structuredText(firstValue(input.payload, ["after_class", "to_class_name"])))
  add("effective_date", () => dateValue(input, ["requested_effective_date", "after_start_date"]))
  add("requester_name", () => personName(input.payload, "requester_name"))
  add("teacher_name", () => personName(input.payload, "teacher_name"))
  add("before_class_end_date", () => dateValue(input, ["before_class_end_date", "before_end_date"]))
  add("after_class_start_date", () => dateValue(input, ["after_class_start_date", "after_start_date"]))
  add("before_end_date", () => dateValue(input, ["before_class_end_date", "before_end_date"]))
  add("after_start_date", () => dateValue(input, ["after_class_start_date", "after_start_date"]))
  add("completion_status", () => {
    if (input.eventKey !== "transfer.completed") {
      presentationError("notification_transfer_event_context_unsupported")
    }
    return "새 반으로 수강 정보가 반영됐어요."
  })
  add("progress_line", () => input.eventKey === "transfer.submitted"
    ? "[진행] 관리팀의 반 이동 일정 확인을 기다리고 있어요."
    : `[진행] ${personName(input.payload, "actor_name")}이 반 이동 처리를 완료했어요.`)

  const selectedFreeText = freeTextLines(input)
  add("reason_line", () => buildOptionalNotificationLine("사유", selectedFreeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", selectedFreeText.memo))

  return Object.freeze(context)
}
