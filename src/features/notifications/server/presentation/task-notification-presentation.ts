import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDate,
  formatNotificationPersonOrTeam,
  sanitizeNotificationFreeText,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const TASK_EVENT_KEYS = new Set([
  "task.created",
  "task.assignee_changed",
  "task.due_changed",
  "task.status_changed",
  "task.completed",
  "task.canceled",
  "task.reopened",
  "task.comment_added",
])

const STATUS_LABELS = Object.freeze({
  requested: "요청",
  confirmed: "확인",
  in_progress: "진행 중",
  review_requested: "검토 요청",
  done: "완료",
  on_hold: "보류",
  canceled: "취소",
} satisfies Record<string, string>)

const CURRENT_STATUS_LABELS = Object.freeze({
  requested: "요청됐어요.",
  confirmed: "확인됐어요.",
  in_progress: "진행 중이에요.",
  review_requested: "검토를 기다리고 있어요.",
  done: "완료됐어요.",
  on_hold: "보류 중이에요.",
  canceled: "취소됐어요.",
} satisfies Record<string, string>)

const ATTACHMENT_TYPE_LABELS = Object.freeze({
  document: "문서",
  image: "이미지",
  pdf: "PDF",
  spreadsheet: "스프레드시트",
  presentation: "프레젠테이션",
  video: "동영상",
  audio: "음성",
  link: "링크",
} satisfies Record<string, string>)

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

function requiredStructuredText(payload: Readonly<Record<string, unknown>>, key: string) {
  const value = requiredValue(payload, key)
  if (typeof value !== "string") presentationError("notification_presentation_required_field_invalid")
  const normalized = value.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim()
  if (!normalized || UUID_PATTERN.test(normalized) || UNSAFE_STRUCTURED_PATTERN.test(normalized)) {
    presentationError("notification_presentation_required_field_invalid")
  }
  return normalized
}

function optionalStructuredText(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") presentationError("notification_presentation_optional_field_invalid")
  const normalized = value.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim()
  if (!normalized) return null
  if (UUID_PATTERN.test(normalized) || UNSAFE_STRUCTURED_PATTERN.test(normalized)) {
    presentationError("notification_presentation_optional_field_invalid")
  }
  return normalized
}

function nestedText(payload: Readonly<Record<string, unknown>>, parent: string, key: string) {
  const value = payload[parent]
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return optionalStructuredText((value as Readonly<Record<string, unknown>>)[key])
}

function statusLabel(value: unknown, current = false) {
  if (typeof value !== "string") presentationError("notification_presentation_required_field_invalid")
  const labels = current ? CURRENT_STATUS_LABELS : STATUS_LABELS
  const label = labels[value as keyof typeof labels]
  if (!label) presentationError("notification_task_status_unsupported")
  return label
}

function requireTaskStatus(payload: Readonly<Record<string, unknown>>, expected: "done" | "canceled") {
  const value = requiredValue(payload, "task_status")
  statusLabel(value)
  if (value !== expected) presentationError("notification_task_event_state_mismatch")
}

function displayAssignee(input: Readonly<{
  personName: unknown
  teamName?: unknown
  emptyDisplay: string
}>) {
  const personName = optionalStructuredText(input.personName)
  const teamName = optionalStructuredText(input.teamName)
  if (!personName && !teamName) return input.emptyDisplay
  return formatNotificationPersonOrTeam({ personName, teamName })
}

function assigneeSnapshot(
  payload: Readonly<Record<string, unknown>>,
  nameKey: "current_assignee_name" | "before_assignee_name" | "after_assignee_name",
) {
  const personName = requiredValue(payload, nameKey)
  const teamName = nameKey === "current_assignee_name"
    ? requiredValue(payload, "current_assignee_team")
    : nestedText(payload, nameKey.startsWith("before_") ? "before_assignee" : "after_assignee", "team")
  return displayAssignee({ personName, teamName, emptyDisplay: "미배정" })
}

function occurredAt(input: NotificationPresentationInput) {
  return hasOwn(input.payload, "occurred_at") ? input.payload.occurred_at : input.scheduledFor
}

function scheduleSnapshot(
  input: NotificationPresentationInput,
  key: "before_due_at" | "after_due_at",
) {
  const value = requiredValue(input.payload, key)
  if (value === null) return "일정 없음"
  return formatNotificationKstDate(value, occurredAt(input))
}

function currentAssigneeForProgress(payload: Readonly<Record<string, unknown>>) {
  const personName = requiredValue(payload, "current_assignee_name")
  const teamName = requiredValue(payload, "current_assignee_team")
  const normalizedPerson = optionalStructuredText(personName)
  const normalizedTeam = optionalStructuredText(teamName)
  if (!normalizedPerson && !normalizedTeam) return null
  return formatNotificationPersonOrTeam({ personName: normalizedPerson, teamName: normalizedTeam })
}

function possessive(value: string) {
  return `${value}의`
}

function subjectParticle(value: string) {
  const last = value.codePointAt(value.length - 1)
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return `${value}이(가)`
  return `${value}${(last - 0xac00) % 28 === 0 ? "가" : "이"}`
}

function progressLine(input: NotificationPresentationInput) {
  const actor = currentAssigneeForProgress(input.payload)
  if (input.eventKey === "task.assignee_changed" && !actor) {
    return "[진행] 담당자 배정을 기다리고 있어요."
  }
  if (input.eventKey === "task.due_changed") {
    return `[진행] ${possessive(actor ?? "담당자")} 변경 일정 확인을 기다리고 있어요.`
  }
  if (input.eventKey === "task.status_changed") {
    const afterStatus = requiredValue(input.payload, "after_status")
    if (afterStatus === "in_progress") {
      return `[진행] ${subjectParticle(actor ?? "담당자")} 업무를 진행하고 있어요.`
    }
    if (afterStatus === "on_hold") return "[진행] 업무가 보류 중이에요."
  }
  return `[진행] ${possessive(actor ?? "담당자")} 확인을 기다리고 있어요.`
}

function optionalEntityLine(
  payload: Readonly<Record<string, unknown>>,
  key: "student_name" | "class_name",
  label: "학생" | "수업",
) {
  const value = optionalStructuredText(payload[key])
  if (!value) return ""
  const display = label === "학생" && !value.endsWith("학생") ? `${value} 학생` : value
  return buildOptionalNotificationLine(label, display)
}

function attachmentLine(payload: Readonly<Record<string, unknown>>) {
  const count = requiredValue(payload, "attachment_count")
  const types = requiredValue(payload, "attachment_types")
  if (count === null && types === null) return ""
  if (!Number.isSafeInteger(count) || (count as number) < 0 || !Array.isArray(types)) {
    presentationError("notification_task_attachment_snapshot_invalid")
  }
  if ((count as number) === 0) return ""
  const labels = [...new Set(types.map((type) => {
    if (typeof type !== "string") presentationError("notification_task_attachment_snapshot_invalid")
    const key = type.trim().toLowerCase()
    return ATTACHMENT_TYPE_LABELS[key as keyof typeof ATTACHMENT_TYPE_LABELS] ?? "기타"
  }))].sort((left, right) => left.localeCompare(right, "ko"))
  const summary = labels.length > 0 ? `${count}개 · ${labels.join(", ")}` : `${count}개`
  return buildOptionalNotificationLine("첨부", summary)
}

function freeTextLines(input: NotificationPresentationInput) {
  const priority = input.eventKey === "task.canceled"
    ? ["reason", "memo"]
    : input.eventKey === "task.created" || input.eventKey === "task.completed"
      ? ["memo"]
      : []
  return selectNotificationFreeTextFields(input.payload, priority)
}

export function buildTaskNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (
    input.workflowKey !== "tasks"
    || input.payloadSchemaVersion !== 1
    || !TASK_EVENT_KEYS.has(input.eventKey)
    || input.contractIdentity.workflowKey !== "tasks"
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

  add("task_title", () => requiredStructuredText(input.payload, "task_title"))
  add("current_status", () => statusLabel(requiredValue(input.payload, "task_status"), true))
  add("current_assignee", () => assigneeSnapshot(input.payload, "current_assignee_name"))
  add("before_assignee", () => assigneeSnapshot(input.payload, "before_assignee_name"))
  add("after_assignee", () => assigneeSnapshot(input.payload, "after_assignee_name"))
  add("before_schedule", () => scheduleSnapshot(input, "before_due_at"))
  add("after_schedule", () => scheduleSnapshot(input, "after_due_at"))
  add("before_status", () => statusLabel(requiredValue(input.payload, "before_status")))
  add("after_status", () => statusLabel(requiredValue(input.payload, "after_status")))
  add("completion_status", () => {
    requireTaskStatus(input.payload, "done")
    return "처리가 완료됐어요."
  })
  add("cancellation_status", () => {
    requireTaskStatus(input.payload, "canceled")
    return "처리가 취소됐어요."
  })
  add("comment_author", () => formatNotificationPersonOrTeam({
    personName: requiredValue(input.payload, "comment_author_name"),
    fallback: "댓글 작성자",
  }))
  add("comment_preview", () => {
    const value = sanitizeNotificationFreeText(requiredValue(input.payload, "comment_body"))
    if (!value) presentationError("notification_presentation_required_field_invalid")
    return value
  })
  add("student_name", () => optionalStructuredText(input.payload.student_name) ?? "")
  add("class_name", () => optionalStructuredText(input.payload.class_name) ?? "")
  add("student_line", () => optionalEntityLine(input.payload, "student_name", "학생"))
  add("class_line", () => optionalEntityLine(input.payload, "class_name", "수업"))
  add("attachment_line", () => attachmentLine(input.payload))
  add("progress_line", () => progressLine(input))

  const selectedFreeText = freeTextLines(input)
  add("reason_line", () => buildOptionalNotificationLine("사유", selectedFreeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", selectedFreeText.memo))

  return Object.freeze(context)
}
