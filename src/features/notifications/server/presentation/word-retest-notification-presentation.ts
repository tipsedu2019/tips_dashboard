import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDateTime,
  formatNotificationPersonOrTeam,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const WORD_RETEST_EVENT_KEYS = new Set([
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
])

const RESULT_LABELS = Object.freeze({
  passed: "통과",
  failed: "불통과",
  absent: "미응시",
} satisfies Record<string, string>)

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu
const UNSAFE_STRUCTURED_PATTERN = /(?:<[^>]*>|(?:https?:\/\/|www\.)|\/admin\/|@(all|everyone|here|channel)\b)/iu
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

type ResultPrefix = "" | "previous_"

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

function optionalStructuredText(value: unknown) {
  return normalizedStructuredText(value, false)
}

function nestedText(payload: Readonly<Record<string, unknown>>, parent: string, key: string) {
  const value = payload[parent]
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return optionalStructuredText((value as Readonly<Record<string, unknown>>)[key])
}

function numberSnapshot(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  options?: Readonly<{ nullable?: false; positive?: boolean }>,
): number
function numberSnapshot(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  options: Readonly<{ nullable: true; positive?: boolean }>,
): number | null
function numberSnapshot(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  options: Readonly<{ nullable?: boolean; positive?: boolean }> = {},
): number | null {
  const value = requiredValue(payload, key)
  if (value === null && options.nullable) return null
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(number) || number < 0 || (options.positive && number <= 0)) {
    presentationError("notification_word_retest_numeric_snapshot_invalid")
  }
  return number
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    useGrouping: false,
    maximumFractionDigits: 2,
  }).format(value)
}

function resultSnapshot(payload: Readonly<Record<string, unknown>>, prefix: ResultPrefix) {
  const summaryKey = `${prefix}result_summary`
  const summary = requiredValue(payload, summaryKey)
  if (typeof summary !== "string" || !RESULT_LABELS[summary as keyof typeof RESULT_LABELS]) {
    presentationError("notification_word_retest_result_unsupported")
  }
  const result = RESULT_LABELS[summary as keyof typeof RESULT_LABELS]
  if (summary === "absent") return Object.freeze({ result, score: null, threshold: null })

  const total = numberSnapshot(payload, `${prefix}total_question_count`, { positive: true })
  const threshold = numberSnapshot(payload, `${prefix}cutoff_question_count`)
  if (threshold > total) presentationError("notification_word_retest_numeric_snapshot_invalid")
  const scores = ["first_score", "second_score", "third_score"]
    .map((key) => numberSnapshot(payload, `${prefix}${key}`, { nullable: true }))
    .filter((value): value is number => value !== null)
  if (scores.length === 0 || scores.some((score) => score > total)) {
    presentationError("notification_word_retest_numeric_snapshot_invalid")
  }
  const passed = scores.some((score) => score >= threshold)
  if ((summary === "passed") !== passed) {
    presentationError("notification_word_retest_result_snapshot_inconsistent")
  }
  return Object.freeze({ result, score: Math.max(...scores), threshold })
}

function resultDetail(payload: Readonly<Record<string, unknown>>, prefix: ResultPrefix) {
  const snapshot = resultSnapshot(payload, prefix)
  if (snapshot.result === "미응시") return snapshot.result
  return `${formatNumber(snapshot.score as number)}점 / 통과 기준 ${formatNumber(snapshot.threshold as number)}점 · ${snapshot.result}`
}

function occurredAt(input: NotificationPresentationInput) {
  return hasOwn(input.payload, "occurred_at") ? input.payload.occurred_at : input.scheduledFor
}

function dateTimeSnapshot(
  input: NotificationPresentationInput,
  key: "test_at" | "before_test_at" | "after_test_at",
  nullDisplay: string | null,
) {
  const value = requiredValue(input.payload, key)
  if (value === null) {
    if (nullDisplay !== null) return nullDisplay
    presentationError("notification_presentation_null_field_invalid")
  }
  return formatNotificationKstDateTime(value, occurredAt(input))
}

function studentName(payload: Readonly<Record<string, unknown>>) {
  const value = requiredStructuredText(payload, "student_name")
  return value.endsWith("학생") ? value : `${value} 학생`
}

function testScope(payload: Readonly<Record<string, unknown>>) {
  const unit = requiredStructuredText(payload, "unit")
  const total = numberSnapshot(payload, "total_question_count", { positive: true })
  return `${unit} · ${formatNumber(total)}문항`
}

function displayAssistant(input: Readonly<{
  personName: unknown
  teamName?: unknown
  emptyDisplay: string
}>) {
  const personName = optionalStructuredText(input.personName)
  const teamName = optionalStructuredText(input.teamName)
  if (!personName && !teamName) return input.emptyDisplay
  return formatNotificationPersonOrTeam({ personName, teamName })
}

function assistantSnapshot(
  payload: Readonly<Record<string, unknown>>,
  nameKey: "assigned_assistant_name" | "before_assistant_name" | "after_assistant_name",
) {
  const personName = requiredValue(payload, nameKey)
  const teamName = nameKey === "assigned_assistant_name"
    ? requiredValue(payload, "assigned_assistant_team")
    : nestedText(payload, nameKey.startsWith("before_") ? "before_assignee" : "after_assignee", "team")
  return displayAssistant({ personName, teamName, emptyDisplay: "미배정" })
}

function currentAssistantForProgress(payload: Readonly<Record<string, unknown>>) {
  const personName = requiredValue(payload, "assigned_assistant_name")
  const teamName = requiredValue(payload, "assigned_assistant_team")
  const normalizedPerson = optionalStructuredText(personName)
  const normalizedTeam = optionalStructuredText(teamName)
  if (!normalizedPerson && !normalizedTeam) return null
  return formatNotificationPersonOrTeam({ personName: normalizedPerson, teamName: normalizedTeam })
}

function subjectParticle(value: string) {
  const last = value.codePointAt(value.length - 1)
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return `${value}이(가)`
  return `${value}${(last - 0xac00) % 28 === 0 ? "가" : "이"}`
}

function progressLine(input: NotificationPresentationInput) {
  const assistant = currentAssistantForProgress(input.payload)
  if (input.eventKey === "word_retest.assigned" && !assistant) {
    return "[진행] 담당 조교 배정을 기다리고 있어요."
  }
  if (input.eventKey === "word_retest.schedule_changed") {
    return `[진행] ${(assistant ?? "담당 조교")}의 변경 일정 확인을 기다리고 있어요.`
  }
  if (input.eventKey === "word_retest.started") {
    return `[진행] ${subjectParticle(assistant ?? "담당 조교")} 재시험 처리를 진행하고 있어요.`
  }
  if (input.eventKey === "word_retest.revision_requested") {
    return `[진행] ${(assistant ?? "담당 조교")}의 결과 보완을 기다리고 있어요.`
  }
  return `[진행] ${(assistant ?? "담당 조교")}의 확인을 기다리고 있어요.`
}

function freeTextLines(input: NotificationPresentationInput) {
  const priority = input.eventKey === "word_retest.absent_reported"
    ? ["reason", "memo"]
    : input.eventKey === "word_retest.result_reported" || input.eventKey === "word_retest.completed"
      ? ["memo"]
      : input.eventKey === "word_retest.revision_requested" || input.eventKey === "word_retest.canceled"
        ? ["reason"]
        : []
  return selectNotificationFreeTextFields(input.payload, priority)
}

export function buildWordRetestNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (
    input.workflowKey !== "word_retests"
    || input.payloadSchemaVersion !== 1
    || !WORD_RETEST_EVENT_KEYS.has(input.eventKey)
    || input.contractIdentity.workflowKey !== "word_retests"
    || input.contractIdentity.eventKey !== input.eventKey
    || input.contractIdentity.audienceKey !== input.audienceKey
    || input.contractIdentity.ruleVariantKey !== input.ruleVariantKey
  ) {
    presentationError("notification_payload_schema_unsupported")
  }

  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }

  add("student_name", () => studentName(input.payload))
  add("class_name", () => requiredStructuredText(input.payload, "class_name"))
  add("test_scope", () => testScope(input.payload))
  add("test_date", () => dateTimeSnapshot(input, "test_at", null))
  add("before_assignee", () => assistantSnapshot(input.payload, "before_assistant_name"))
  add("after_assignee", () => assistantSnapshot(input.payload, "after_assistant_name"))
  add("before_test_date", () => dateTimeSnapshot(input, "before_test_at", "일정 없음"))
  add("after_test_date", () => dateTimeSnapshot(input, "after_test_at", "일정 없음"))
  add("start_status", () => {
    if (requiredValue(input.payload, "task_status") !== "in_progress"
      || requiredValue(input.payload, "retest_status") !== "in_progress") {
      presentationError("notification_word_retest_event_state_mismatch")
    }
    return "재시험 처리가 시작됐어요."
  })
  add("score", () => {
    const snapshot = resultSnapshot(input.payload, "")
    if (snapshot.score === null) presentationError("notification_word_retest_numeric_snapshot_invalid")
    return `${formatNumber(snapshot.score)}점`
  })
  add("pass_threshold", () => {
    const snapshot = resultSnapshot(input.payload, "")
    if (snapshot.threshold === null) presentationError("notification_word_retest_numeric_snapshot_invalid")
    return `${formatNumber(snapshot.threshold)}점`
  })
  add("result", () => resultSnapshot(input.payload, "").result)
  add("current_result", () => resultDetail(input.payload, ""))
  add("request_actor", () => formatNotificationPersonOrTeam({
    personName: requiredValue(input.payload, "actor_name"),
    fallback: "담당 선생님",
  }))
  add("previous_result", () => resultDetail(input.payload, "previous_"))
  add("followup_schedule", () => dateTimeSnapshot(input, "test_at", "일정 조율 중"))
  add("final_result", () => resultDetail(input.payload, ""))
  add("cancellation_status", () => {
    if (requiredValue(input.payload, "task_status") !== "canceled") {
      presentationError("notification_word_retest_event_state_mismatch")
    }
    return "재시험이 취소됐어요."
  })
  add("progress_line", () => progressLine(input))

  const selectedFreeText = freeTextLines(input)
  add("reason_line", () => buildOptionalNotificationLine("사유", selectedFreeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", selectedFreeText.memo))

  return Object.freeze(context)
}
