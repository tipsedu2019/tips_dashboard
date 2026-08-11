import type { NotificationRenderContext } from "../notification-workflow-adapter.ts"
import type { NotificationPresentationInput } from "./notification-presentation.ts"
import { parseRegistrationObservationChatPayloadV3 } from "../adapters/registration-observation-notification-source.ts"
import type {
  ObservationBookingPresentationFact,
  RegistrationObservationChatPayloadV3,
} from "../adapters/registration-observation-notification-source.ts"
import {
  buildOptionalNotificationLine,
  formatNotificationKstDateTime,
  formatNotificationPersonOrTeam,
  selectNotificationFreeTextFields,
} from "./notification-presentation-formatters.ts"

const CORE_EVENTS = new Set([
  "registration.case_created",
  "registration.registration_completed",
  "registration.case_closed",
])
const MANAGEMENT_PROGRESS_EVENTS = new Set([
  "registration.consultation_completed",
  "registration.waiting_transitioned",
  "registration.admission_started",
])
const VISIT_EVENTS = new Set([
  "registration.visit_scheduled",
  "registration.visit_rescheduled",
  "registration.visit_replaced",
  "registration.visit_subject_deselected",
  "registration.visit_canceled",
])
const OBSERVATION_EVENTS = new Set<RegistrationObservationChatPayloadV3["event_kind"]>([
  "registration.observation_scheduled",
  "registration.observation_rescheduled",
  "registration.observation_canceled",
  "registration.observation_reminder_due",
  "registration.observation_feedback_due",
  "registration.observation_feedback_submitted",
  "registration.observation_director_reassigned",
])
const REGISTRATION_EVENTS = new Set([
  ...CORE_EVENTS,
  ...MANAGEMENT_PROGRESS_EVENTS,
  "registration.appointment_reminder_due",
  "registration.phone_consultation_ready",
  ...VISIT_EVENTS,
])
const SUBJECT_ORDER = ["영어", "수학", "과학"] as const
const SUBJECT_SET = new Set<string>(SUBJECT_ORDER)
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu
const UNSAFE_STRUCTURED_PATTERN = /(?:<[^>]*>|(?:https?:\/\/|www\.)|\/admin\/|@(all|everyone|here|channel)\b)/iu
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

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

function structuredText(value: unknown, required = true) {
  if (value === undefined || value === null) {
    if (required) presentationError("notification_presentation_required_field_invalid")
    return null
  }
  if (typeof value !== "string") presentationError("notification_presentation_required_field_invalid")
  const withoutControls = value.replace(CONTROL_PATTERN, "")
  if (withoutControls !== value) presentationError("notification_presentation_required_field_invalid")
  const normalized = withoutControls.replace(/\s+/gu, " ").trim()
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
  return structuredText(requiredValue(payload, key)) as string
}

function studentName(payload: Readonly<Record<string, unknown>>) {
  const name = requiredStructuredText(payload, "student_name")
  return name.endsWith("학생") ? name : `${name} 학생`
}

function listValues(value: unknown, allowEmpty: boolean) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("·")
      : presentationError("notification_presentation_required_field_invalid")
  if (!allowEmpty && rawValues.length === 0) {
    presentationError("notification_presentation_empty_array_invalid")
  }
  const values = rawValues.map((item) => structuredText(item) as string)
  const unique = [...new Set(values)]
  if (!allowEmpty && unique.length === 0) {
    presentationError("notification_presentation_empty_array_invalid")
  }
  return unique
}

function subjectValues(
  payload: Readonly<Record<string, unknown>>,
  key: "subjects" | "registered_subjects" | "deselected_subjects" | "remaining_subjects",
  allowEmpty = false,
) {
  let value: unknown
  if (hasOwn(payload, key) && payload[key] !== undefined) value = requiredValue(payload, key)
  else if ((key === "subjects" || key === "registered_subjects") && hasOwn(payload, "subject")) {
    value = requiredValue(payload, "subject")
  } else {
    return requiredValue(payload, key) as never
  }
  const subjects = listValues(value, allowEmpty)
  if (subjects.some((subject) => !SUBJECT_SET.has(subject))) {
    presentationError("notification_registration_subject_unsupported")
  }
  return subjects.sort((left, right) => SUBJECT_ORDER.indexOf(left as typeof SUBJECT_ORDER[number])
    - SUBJECT_ORDER.indexOf(right as typeof SUBJECT_ORDER[number]))
}

function subjectsDisplay(
  payload: Readonly<Record<string, unknown>>,
  key: "subjects" | "registered_subjects" | "deselected_subjects" | "remaining_subjects",
  allowEmpty = false,
) {
  return subjectValues(payload, key, allowEmpty).join(" · ")
}

function structuredListDisplay(payload: Readonly<Record<string, unknown>>, key: string) {
  return listValues(requiredValue(payload, key), false).join(" · ")
}

function occurredAt(input: NotificationPresentationInput) {
  return hasOwn(input.payload, "occurred_at") ? input.payload.occurred_at : input.scheduledFor
}

function dateTime(input: NotificationPresentationInput, key: string, fallbackKey?: string) {
  const value = hasOwn(input.payload, key) && input.payload[key] !== undefined
    ? requiredValue(input.payload, key)
    : fallbackKey
      ? requiredValue(input.payload, fallbackKey)
      : requiredValue(input.payload, key)
  if (value === null) presentationError("notification_presentation_null_field_invalid")
  return formatNotificationKstDateTime(value, occurredAt(input))
}

function place(payload: Readonly<Record<string, unknown>>, key: string, fallbackKey?: string) {
  if (hasOwn(payload, key) && payload[key] !== undefined) return requiredStructuredText(payload, key)
  if (fallbackKey) return requiredStructuredText(payload, fallbackKey)
  return requiredStructuredText(payload, key)
}

function progressActor(payload: Readonly<Record<string, unknown>>, allowPending: boolean) {
  const value = requiredValue(payload, "progress_actor")
  if (value === null && allowPending) return "담당자 지정 대기"
  return formatNotificationPersonOrTeam({ personName: value })
}

function validateDestination(input: NotificationPresentationInput) {
  const isManagementChat = input.audienceKey === "management_team"
    && input.channelKey === "google_chat"
    && input.connectionKey === "google_chat.management"
    && input.destinationTeam === "management"
  const isManagementInbox = input.audienceKey === "management_team"
    && input.channelKey === "in_app"
    && input.connectionKey === null
    && input.destinationTeam === null
  const isDirectorInbox = input.audienceKey === "track_director"
    && input.channelKey === "in_app"
    && input.connectionKey === null
    && input.destinationTeam === null

  const allowed = CORE_EVENTS.has(input.eventKey) || MANAGEMENT_PROGRESS_EVENTS.has(input.eventKey)
    ? isManagementChat
    : input.eventKey === "registration.phone_consultation_ready"
      ? isDirectorInbox
      : input.eventKey === "registration.appointment_reminder_due"
        ? isManagementChat || isManagementInbox || isDirectorInbox
        : VISIT_EVENTS.has(input.eventKey)
          ? isManagementChat || isDirectorInbox
          : false
  if (!allowed) presentationError("notification_registration_destination_unsupported")
}

function observationConnection(subject: RegistrationObservationChatPayloadV3["subject"]) {
  if (subject === "영어") return { connectionKey: "google_chat.english", destinationTeam: "english" }
  if (subject === "수학") return { connectionKey: "google_chat.math", destinationTeam: "math" }
  return { connectionKey: "google_chat.science", destinationTeam: "science" }
}

function validateObservationDestination(
  input: NotificationPresentationInput,
  payload: RegistrationObservationChatPayloadV3,
) {
  const exactContract = input.contractIdentity.workflowKey === "registration"
    && input.contractIdentity.eventKey === payload.event_kind
    && input.contractIdentity.audienceKey === input.audienceKey
    && input.contractIdentity.channelKey === input.channelKey
    && input.contractIdentity.ruleVariantKey === input.ruleVariantKey
  if (!exactContract) presentationError("notification_payload_schema_unsupported")
  if (payload.event_kind === "registration.observation_feedback_submitted") {
    const managementChat = input.audienceKey === "management_team"
      && input.channelKey === "google_chat"
      && input.connectionKey === "google_chat.management"
      && input.destinationTeam === "management"
    const directorInbox = input.audienceKey === "track_director"
      && input.channelKey === "in_app"
      && input.connectionKey === null
      && input.destinationTeam === null
    if (!managementChat && !directorInbox) {
      presentationError("notification_registration_destination_unsupported")
    }
    return
  }
  if (payload.event_kind === "registration.observation_director_reassigned") {
    if (
      input.audienceKey !== "management_team"
      || input.channelKey !== "google_chat"
      || input.connectionKey !== "google_chat.management"
      || input.destinationTeam !== "management"
    ) presentationError("notification_registration_destination_unsupported")
    return
  }
  const destination = observationConnection(payload.subject)
  if (
    input.audienceKey !== "subject_team"
    || input.channelKey !== "google_chat"
    || input.connectionKey !== destination.connectionKey
    || input.destinationTeam !== destination.destinationTeam
  ) presentationError("notification_registration_destination_unsupported")
}

function observationBooking(payload: RegistrationObservationChatPayloadV3) {
  return payload.event_kind === "registration.observation_canceled"
    ? payload.canceled_booking
    : payload.booking
}

function scheduleRange(booking: ObservationBookingPresentationFact, fallback: string) {
  const start = formatNotificationKstDateTime(booking.starts_at, fallback)
  const end = formatNotificationKstDateTime(booking.ends_at, fallback)
  const startDate = start.replace(/ \d{2}:\d{2}$/u, "")
  const endDate = end.replace(/ \d{2}:\d{2}$/u, "")
  const startTime = start.slice(-5)
  const endTime = end.slice(-5)
  if (startDate !== endDate) presentationError("notification_presentation_required_field_invalid")
  return `${startDate} ${startTime}~${endTime}`
}

function buildRegistrationObservationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (input.payloadSchemaVersion !== 3 || !OBSERVATION_EVENTS.has(
    input.eventKey as RegistrationObservationChatPayloadV3["event_kind"],
  )) presentationError("notification_payload_schema_unsupported")
  let payload: RegistrationObservationChatPayloadV3
  try {
    payload = parseRegistrationObservationChatPayloadV3(input.payload)
  } catch {
    presentationError("notification_payload_schema_unsupported")
  }
  if (payload.event_kind !== input.eventKey) presentationError("notification_payload_schema_unsupported")
  validateObservationDestination(input, payload)
  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  const booking = observationBooking(payload)
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }
  add("student_name", () => studentName(payload))
  add("subjects", () => payload.subject)
  add("class_name", () => structuredText(booking.class_name) as string)
  add("scheduled_at", () => scheduleRange(booking, input.scheduledFor))
  add("before_schedule", () => {
    if (payload.event_kind !== "registration.observation_rescheduled") {
      presentationError("notification_registration_event_state_mismatch")
    }
    return scheduleRange(payload.previous_booking, input.scheduledFor)
  })
  add("teacher_name", () => structuredText(booking.teacher_name) as string)
  add("classroom", () => `${structuredText(booking.campus)} ${structuredText(booking.classroom_name)}`)
  add("textbooks", () => {
    if (!("textbook_names" in payload)) presentationError("notification_registration_event_state_mismatch")
    return listValues(payload.textbook_names, false).join(" · ")
  })
  add("progress", () => {
    if (!("progress_summary" in payload)) presentationError("notification_registration_event_state_mismatch")
    return structuredText(payload.progress_summary) as string
  })
  add("submitted_by_name", () => {
    if (payload.event_kind !== "registration.observation_feedback_submitted") {
      presentationError("notification_registration_event_state_mismatch")
    }
    return structuredText(payload.submitted_by_name) as string
  })
  add("submitted_at", () => {
    if (payload.event_kind !== "registration.observation_feedback_submitted") {
      presentationError("notification_registration_event_state_mismatch")
    }
    return formatNotificationKstDateTime(payload.submitted_at, input.scheduledFor)
  })
  return Object.freeze(context)
}

function progressLine(input: NotificationPresentationInput) {
  if (input.eventKey === "registration.case_created") {
    return "[진행] 관리팀의 등록 내용 확인을 기다리고 있어요."
  }
  if (input.eventKey === "registration.consultation_completed") {
    return "[진행] 상담 결과에 따른 다음 단계를 확인하고 있어요."
  }
  if (input.eventKey === "registration.waiting_transitioned") {
    return "[진행] 관리팀이 대기 명단을 확인하고 있어요."
  }
  if (input.eventKey === "registration.admission_started") {
    return "[진행] 관리팀이 등록 절차를 진행하고 있어요."
  }
  const actor = structuredText(input.payload.progress_actor, false)
  if (!actor) return ""
  const display = formatNotificationPersonOrTeam({ personName: actor })
  if (input.eventKey === "registration.registration_completed") {
    return `[진행] ${display}의 등록 완료 확인을 기다리고 있어요.`
  }
  if (input.eventKey === "registration.case_closed") return ""
  return `[진행] ${display}의 일정 확인을 기다리고 있어요.`
}

function freeTextLines(input: NotificationPresentationInput) {
  const priority = input.eventKey === "registration.case_closed"
    ? ["reason", "memo"]
    : input.eventKey === "registration.visit_canceled"
      ? ["reason"]
      : input.eventKey === "registration.phone_consultation_ready"
        ? ["memo"]
        : []
  return selectNotificationFreeTextFields(input.payload, priority)
}

export function buildRegistrationNotificationPresentation(
  input: NotificationPresentationInput,
): NotificationRenderContext {
  if (OBSERVATION_EVENTS.has(input.eventKey as RegistrationObservationChatPayloadV3["event_kind"])) {
    return buildRegistrationObservationPresentation(input)
  }
  const expectedSchemaVersion = CORE_EVENTS.has(input.eventKey) ? 1 : 2
  if (
    input.workflowKey !== "registration"
    || !REGISTRATION_EVENTS.has(input.eventKey)
    || input.payloadSchemaVersion !== expectedSchemaVersion
    || input.contractIdentity.workflowKey !== "registration"
    || input.contractIdentity.eventKey !== input.eventKey
    || input.contractIdentity.audienceKey !== input.audienceKey
    || input.contractIdentity.ruleVariantKey !== input.ruleVariantKey
  ) {
    presentationError("notification_payload_schema_unsupported")
  }

  const requested = new Set(input.requestedContextKeys)
  if (requested.size === 0) return Object.freeze({})
  validateDestination(input)
  const context: Record<string, string> = {}
  const add = (key: string, build: () => string) => {
    if (requested.has(key)) context[key] = build()
  }

  add("student_name", () => studentName(input.payload))
  add("grade", () => requiredStructuredText(input.payload, "grade"))
  add("subjects", () => subjectsDisplay(input.payload, "subjects"))
  add("inquiry_at", () => dateTime(input, "inquiry_at"))
  add("registered_subjects", () => subjectsDisplay(input.payload, "registered_subjects"))
  add("registered_classes", () => structuredListDisplay(input.payload, "registered_classes"))
  add("current_status", () => {
    if (input.eventKey === "registration.consultation_completed") return "상담이 완료됐어요."
    if (input.eventKey === "registration.waiting_transitioned") return "대기 신청이 접수됐어요."
    if (input.eventKey === "registration.admission_started") return "등록 절차가 시작됐어요."
    presentationError("notification_registration_event_state_mismatch")
  })
  add("completion_status", () => {
    const status = requiredStructuredText(input.payload, "status")
    if (!["registered", "done", "completed"].includes(status)) {
      presentationError("notification_registration_event_state_mismatch")
    }
    return "등록 처리가 완료됐어요."
  })
  add("close_status", () => {
    const status = requiredStructuredText(input.payload, "status")
    if (!["inquiry_closed", "not_registered", "canceled", "closed"].includes(status)) {
      presentationError("notification_registration_event_state_mismatch")
    }
    return "등록 문의가 종료됐어요."
  })
  add("appointment_kind", () => {
    const kind = requiredStructuredText(input.payload, "appointment_kind")
    if (kind === "level_test") return "레벨테스트"
    if (kind === "visit_consultation") return "방문상담"
    presentationError("notification_registration_appointment_kind_unsupported")
  })
  add("scheduled_at", () => dateTime(input, "scheduled_at"))
  add("place", () => place(input.payload, "place"))
  add("progress_actor", () => progressActor(input.payload, true))
  add("after_schedule", () => dateTime(input, "after_scheduled_at", "scheduled_at"))
  add("after_place", () => place(input.payload, "after_place", "place"))
  add("before_schedule", () => dateTime(input, "before_scheduled_at"))
  add("before_appointment", () => `${dateTime(input, "before_scheduled_at")} · ${place(input.payload, "before_place")}`)
  add("after_appointment", () => `${dateTime(input, "after_scheduled_at", "scheduled_at")} · ${place(input.payload, "after_place", "place")}`)
  add("deselected_subjects", () => subjectsDisplay(input.payload, "deselected_subjects"))
  add("other_active_subjects", () => {
    const remaining = subjectsDisplay(input.payload, "remaining_subjects", true)
    return remaining || "남은 과목 없음"
  })
  add("retained_schedule", () => dateTime(input, "scheduled_at"))
  add("retained_place", () => place(input.payload, "place"))
  add("canceled_schedule", () => dateTime(input, "scheduled_at"))
  add("canceled_place", () => place(input.payload, "place"))
  add("progress_line", () => progressLine(input))

  const selectedFreeText = freeTextLines(input)
  add("reason_line", () => buildOptionalNotificationLine("사유", selectedFreeText.reason))
  add("memo_line", () => buildOptionalNotificationLine("메모", selectedFreeText.memo))

  return Object.freeze(context)
}
