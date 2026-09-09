import type { NotificationConnectionKey } from "../../notification-control-plane-types.ts"

const COMPLETION_EVENTS = new Set([
  "registration.subject_registration_completed",
  "transfer.completed",
  "withdrawal.completed",
  "word_retest.result_reported",
])
const CONNECTIONS: Readonly<Record<string, NotificationConnectionKey>> = Object.freeze({
  영어: "google_chat.english",
  수학: "google_chat.math",
  과학: "google_chat.science",
})

export function isOperationalSubjectCompletion(eventKey: string) {
  return COMPLETION_EVENTS.has(eventKey)
}

export function operationalSubjectConnections(
  eventKey: string,
  payload: Readonly<Record<string, unknown>>,
): ReadonlyArray<NotificationConnectionKey> {
  const subjects = payload.notification_subjects
  if (!COMPLETION_EVENTS.has(eventKey) || !Array.isArray(subjects) || subjects.length === 0
    || subjects.some((subject) => typeof subject !== "string" || !Object.prototype.hasOwnProperty.call(CONNECTIONS, subject))
    || (eventKey === "word_retest.result_reported" && subjects.some((subject) => subject !== "영어"))) {
    throw new Error("notification_payload_schema_unsupported")
  }
  return Object.freeze([...new Set(subjects.map((subject) => CONNECTIONS[subject as string]))].sort())
}

export function isOperationalSubjectDestination(input: Readonly<{
  eventKey: string
  payload: Readonly<Record<string, unknown>>
  audienceKey: string
  channelKey: string
  connectionKey: string | null
  destinationTeam: string | null
}>) {
  if (input.audienceKey !== "subject_team" || input.channelKey !== "google_chat"
    || !input.connectionKey || input.destinationTeam !== input.connectionKey.replace("google_chat.", "")) return false
  return operationalSubjectConnections(input.eventKey, input.payload).some((key) => key === input.connectionKey)
}
