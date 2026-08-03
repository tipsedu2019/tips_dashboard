import type { NotificationFieldPresenceRule } from "../../notification-control-plane-types.ts"

const SEOUL_TIME_ZONE = "Asia/Seoul"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_FREE_TEXT_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu
const HTML_TAG_PATTERN = /<[^>]*>/gu
const URL_PATTERN = /(?:(?:https?:)?\/\/|www\.)[^\s]+/giu
const CONTACT_PATTERN = /(?:\+?82[-.\s]?(?:10|2|[3-6][1-5])|0(?:10|2|[3-6][1-5]))[-.\s]?\d{3,4}[-.\s]?\d{4}/gu
const EMAIL_CONTACT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu
const BROADCAST_MENTION_PATTERN = /@(all|everyone|here|channel)\b/giu
const INTERNAL_PATH_PATTERN = /\/admin\/[A-Za-z0-9_/?=&%#.-]*/gu
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const
const DEFAULT_FREE_TEXT_GRAPHEME_LIMIT = 240

type SegmenterLike = Readonly<{
  segment(value: string): Iterable<Readonly<{ segment: string }>>
}>

type SegmenterConstructor = new (
  locale?: string | string[],
  options?: Readonly<{ granularity: "grapheme" }>,
) => SegmenterLike

function presentationError(code: string): never {
  throw new Error(code)
}

function parsedDate(value: unknown): Date {
  if (typeof value !== "string" && !(value instanceof Date)) {
    presentationError("notification_presentation_datetime_invalid")
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) presentationError("notification_presentation_datetime_invalid")
  return date
}

function seoulParts(value: unknown) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(parsedDate(value))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  const year = Number(byType.get("year"))
  const month = Number(byType.get("month"))
  const day = Number(byType.get("day"))
  const hour = byType.get("hour")
  const minute = byType.get("minute")
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || typeof hour !== "string" || typeof minute !== "string"
    || !Number.isFinite(utcDate.getTime())
  ) {
    presentationError("notification_presentation_datetime_invalid")
  }
  return { year, month, day, hour, minute, weekday: WEEKDAY_LABELS[utcDate.getUTCDay()] }
}

function formatKst(value: unknown, occurredAt: unknown, includeTime: boolean) {
  const target = seoulParts(value)
  const occurrence = seoulParts(occurredAt)
  const year = target.year === occurrence.year ? "" : `${target.year}년 `
  const time = includeTime ? ` ${target.hour}:${target.minute}` : ""
  return `${year}${target.month}월 ${target.day}일(${target.weekday})${time}`
}

export function formatNotificationKstDate(value: unknown, occurredAt: unknown) {
  return formatKst(value, occurredAt, false)
}

export function formatNotificationKstDateTime(value: unknown, occurredAt: unknown) {
  return formatKst(value, occurredAt, true)
}

function normalizedDisplayCandidate(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim()
  const hasUnsafePattern = [HTML_TAG_PATTERN, URL_PATTERN, CONTACT_PATTERN, EMAIL_CONTACT_PATTERN].some((pattern) => {
    pattern.lastIndex = 0
    const matched = pattern.test(normalized)
    pattern.lastIndex = 0
    return matched
  })
  if (!normalized || UUID_PATTERN.test(normalized) || hasUnsafePattern) return null
  return normalized
}

export function formatNotificationPersonOrTeam(input: Readonly<{
  personName?: unknown
  teamName?: unknown
  fallback?: unknown
}>) {
  const personName = normalizedDisplayCandidate(input.personName)
  if (personName) return personName.endsWith("님") ? personName : `${personName}님`
  const teamName = normalizedDisplayCandidate(input.teamName)
  if (teamName) return teamName
  const fallback = normalizedDisplayCandidate(input.fallback)
  if (fallback) return fallback
  return presentationError("notification_presentation_person_or_team_missing")
}

export function readNotificationFieldPresence(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  rule: NotificationFieldPresenceRule,
): unknown {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    if (rule.required) presentationError("notification_presentation_required_field_missing")
    return undefined
  }
  const value = payload[key]
  if (value === null) {
    if (rule.nullBehavior === "display" && rule.nullDisplay) return rule.nullDisplay
    if (rule.nullBehavior === "omit") return undefined
    return presentationError("notification_presentation_null_field_invalid")
  }
  if (Array.isArray(value) && value.length === 0) {
    if (rule.emptyArrayBehavior === "allow") return value
    if (rule.emptyArrayBehavior === "omit") return undefined
    return presentationError("notification_presentation_empty_array_invalid")
  }
  return value
}

function notificationGraphemes(value: string) {
  const Segmenter = (Intl as unknown as Readonly<{ Segmenter?: SegmenterConstructor }>).Segmenter
  if (!Segmenter) return Array.from(value)
  return [...new Segmenter("ko", { granularity: "grapheme" }).segment(value)]
    .map(({ segment }) => segment)
}

export function truncateNotificationGraphemes(value: string, limit = DEFAULT_FREE_TEXT_GRAPHEME_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    presentationError("notification_presentation_grapheme_limit_invalid")
  }
  const graphemes = notificationGraphemes(value)
  if (graphemes.length <= limit) return value
  return `${graphemes.slice(0, limit).join("")}… (전체 ${graphemes.length}자)`
}

export function sanitizeNotificationFreeText(value: unknown) {
  if (typeof value !== "string") return ""
  const sanitized = value
    .replace(/\r\n?|\n/gu, " ")
    .replace(HTML_TAG_PATTERN, " ")
    .replace(CONTROL_PATTERN, "")
    .replace(URL_PATTERN, "[링크 포함]")
    .replace(CONTACT_PATTERN, "[연락처 숨김]")
    .replace(EMAIL_CONTACT_PATTERN, "[연락처 숨김]")
    .replace(BROADCAST_MENTION_PATTERN, "[전체 호출 숨김]")
    .replace(UUID_FREE_TEXT_PATTERN, "[식별정보 숨김]")
    .replace(INTERNAL_PATH_PATTERN, "[내부 경로 숨김]")
    .replace(/\*/gu, "＊")
    .replace(/_/gu, "＿")
    .replace(/~/gu, "〜")
    .replace(/`/gu, "｀")
    .replace(/\s+/gu, " ")
    .trim()
  return truncateNotificationGraphemes(sanitized)
}

export function selectNotificationFreeTextFields(
  payload: Readonly<Record<string, unknown>>,
  priority: ReadonlyArray<string>,
) {
  const selected: Record<string, string> = {}
  let selectedCount = 0
  for (const key of priority) {
    if (selectedCount >= 2) break
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || Object.prototype.hasOwnProperty.call(selected, key)) {
      presentationError("notification_presentation_free_text_priority_invalid")
    }
    const value = sanitizeNotificationFreeText(payload[key])
    if (value) {
      selected[key] = value
      selectedCount += 1
    }
  }
  return Object.freeze(selected)
}

export function buildOptionalNotificationLine(label: string, value: unknown) {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return ""
  if (typeof value !== "string" && typeof value !== "number") {
    presentationError("notification_presentation_optional_line_value_invalid")
  }
  const normalized = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : String(value).trim()
  if (!normalized) return ""
  const normalizedLabel = label.replace(/[\[\]\r\n]/gu, "").trim()
  if (!normalizedLabel) presentationError("notification_presentation_optional_line_label_invalid")
  return `[${normalizedLabel}] ${normalized}`
}

export function normalizeRenderedNotificationBody(value: string) {
  const lines = value.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.replace(/[ \t]+$/gu, ""))
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  const normalized: string[] = []
  for (const line of lines) {
    if (line.trim() === "" && normalized[normalized.length - 1]?.trim() === "") continue
    normalized.push(line)
  }
  return normalized.join("\n")
}
