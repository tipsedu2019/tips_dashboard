import type { NotificationWorkflowKey } from "../notification-control-plane-types.ts"

export type NotificationAppLink = Readonly<{
  relativeUrl: string
  absoluteUrl: string
  buttonText: "대시보드에서 보기" | "청강 상세 보기" | "피드백 입력"
}>

type StaticNotificationPath =
  | "/admin/tasks"
  | "/admin/word-retests"
  | "/admin/registration"
  | "/admin/transfer"
  | "/admin/withdrawal"
  | "/admin/makeup-requests"
  | "/admin/approvals"

type ParsedNotificationAppLink = NotificationAppLink & Readonly<{
  workflowKey: NotificationWorkflowKey
}>

const APP_ORIGIN = "https://tipsedu.co.kr"
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const UNSAFE_LINK_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069<>]/u
const ENCODED_PATH_SEPARATOR_OR_TRAVERSAL = /%(?:2e|2f|5c)/iu
const RAW_PATH_SEPARATOR_OR_TRAVERSAL = /(?:\\|(?:^|\/)\.{1,2}(?:\/|$))/u
const REGISTRATION_OBSERVATION_FEEDBACK_PATH =
  /^\/admin\/registration\/observations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/feedback$/iu

const STATIC_QUERY_KEYS: Readonly<Record<StaticNotificationPath, ReadonlySet<string>>> = Object.freeze({
  "/admin/tasks": new Set(["taskId", "focus"]),
  "/admin/word-retests": new Set(["taskId"]),
  "/admin/registration": new Set(["taskId", "trackId", "appointmentId", "observationId", "view"]),
  "/admin/transfer": new Set(["flow", "taskId"]),
  "/admin/withdrawal": new Set(["flow", "taskId"]),
  "/admin/makeup-requests": new Set(["request"]),
  "/admin/approvals": new Set(["approvalId"]),
})

const WORKFLOW_BY_STATIC_PATH: Readonly<Record<StaticNotificationPath, NotificationWorkflowKey>> = Object.freeze({
  "/admin/tasks": "tasks",
  "/admin/word-retests": "word_retests",
  "/admin/registration": "registration",
  "/admin/transfer": "transfer",
  "/admin/withdrawal": "withdrawal",
  "/admin/makeup-requests": "makeup_requests",
  "/admin/approvals": "approvals",
})

function linkError(): never {
  throw new Error("notification_app_deep_link_invalid")
}

function staticPath(value: string): StaticNotificationPath | null {
  return Object.prototype.hasOwnProperty.call(STATIC_QUERY_KEYS, value)
    ? value as StaticNotificationPath
    : null
}

function splitRawPath(value: string) {
  const delimiter = value.search(/[?#]/u)
  return delimiter === -1 ? value : value.slice(0, delimiter)
}

function assertSafeQueryValue(value: string) {
  if (!value || UNSAFE_LINK_TEXT_PATTERN.test(value)) linkError()
}

function validateStaticQuery(parsed: URL, path: StaticNotificationPath) {
  const allowed = STATIC_QUERY_KEYS[path]
  const seen = new Set<string>()
  for (const [key, queryValue] of parsed.searchParams) {
    if (!allowed.has(key) || seen.has(key)) linkError()
    assertSafeQueryValue(key)
    assertSafeQueryValue(queryValue)
    seen.add(key)
  }

  if (parsed.searchParams.has("view") && parsed.searchParams.get("view") !== "calendar") {
    linkError()
  }
  if (
    parsed.searchParams.has("flow")
    && !["applicant", "operations", "closed"].includes(parsed.searchParams.get("flow") || "")
  ) {
    linkError()
  }

  if (!parsed.searchParams.has("observationId")) return false
  const required = ["taskId", "trackId", "appointmentId", "observationId", "view"]
  if (
    path !== "/admin/registration"
    || seen.size !== required.length
    || parsed.search.includes("%")
    || required.some((key) => !seen.has(key))
    || parsed.searchParams.get("view") !== "calendar"
    || ["taskId", "trackId", "appointmentId", "observationId"].some((key) => (
      !CANONICAL_UUID_PATTERN.test(parsed.searchParams.get(key) || "")
    ))
  ) {
    linkError()
  }
  return true
}

function parseNotificationAppLink(
  value: unknown,
  workflowKey: NotificationWorkflowKey,
): ParsedNotificationAppLink {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    linkError()
  }
  const rawPath = splitRawPath(value)
  if (
    !rawPath.startsWith("/admin/")
    || value.includes("#")
    || UNSAFE_LINK_TEXT_PATTERN.test(value)
    || ENCODED_PATH_SEPARATOR_OR_TRAVERSAL.test(value)
    || RAW_PATH_SEPARATOR_OR_TRAVERSAL.test(rawPath)
  ) {
    linkError()
  }

  let parsed: URL
  try {
    parsed = new URL(value, APP_ORIGIN)
  } catch {
    linkError()
  }
  if (
    parsed.origin !== APP_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.pathname !== rawPath
  ) {
    linkError()
  }

  if (REGISTRATION_OBSERVATION_FEEDBACK_PATH.test(parsed.pathname)) {
    if (workflowKey !== "registration" || parsed.search || value.includes("?")) linkError()
    return Object.freeze({
      relativeUrl: value,
      absoluteUrl: `${APP_ORIGIN}${value}`,
      buttonText: "피드백 입력",
      workflowKey,
    })
  }

  const path = staticPath(parsed.pathname)
  if (!path || WORKFLOW_BY_STATIC_PATH[path] !== workflowKey) linkError()
  const observationDetail = validateStaticQuery(parsed, path)
  return Object.freeze({
    relativeUrl: value,
    absoluteUrl: `${APP_ORIGIN}${value}`,
    buttonText: observationDetail ? "청강 상세 보기" : "대시보드에서 보기",
    workflowKey,
  })
}

export function validateNotificationAppDeepLink(
  value: unknown,
  workflowKey: NotificationWorkflowKey,
): string {
  return parseNotificationAppLink(value, workflowKey).relativeUrl
}

export function buildNotificationAppLink(
  value: unknown,
  workflowKey: NotificationWorkflowKey,
): NotificationAppLink {
  const parsed = parseNotificationAppLink(value, workflowKey)
  return Object.freeze({
    relativeUrl: parsed.relativeUrl,
    absoluteUrl: parsed.absoluteUrl,
    buttonText: parsed.buttonText,
  })
}
