import { createHash, createHmac } from "node:crypto"

import type {
  RegistrationCustomerMessageSingleSourceKind,
} from "../registration-customer-message-contract.ts"
import {
  OBSERVATION_LOCATION_TRANSPORT_VALUES,
  renderRegistrationCustomerMessage,
  type RegistrationCustomerMessageAdmissionPlan,
  type RegistrationCustomerMessageButton,
  type RegistrationCustomerMessageCanonicalFacts,
  type RegistrationCustomerMessageCatalog,
  type RegistrationCustomerMessageRendered,
  type RegistrationCustomerMessageSubject,
  type RegistrationCustomerMessageWaitingKind,
} from "./registration-customer-message-catalog.ts"

type JsonRecord = Record<string, unknown>

export type RegistrationCustomerMessageSourceRequest = Readonly<{
  actorProfileId: string
  messageKind: RegistrationCustomerMessageSingleSourceKind
  sourceId: string
}>

export type RegistrationObservationCustomerMessageFacts = Readonly<{
  studentName: string
  subject: RegistrationCustomerMessageSubject
  className: string
  scheduledAt: string
  place: string
  campus: "본관" | "별관"
  teacherName: string
}>

export type RegistrationObservationCustomerMessagePublicFacts = Readonly<{
  subjectLabel: string
  className: string
  scheduleLabel: string
  placeLabel: string
  teacherLabel: string
}>

export type RegistrationCustomerMessagePublicSource = Readonly<{
  messageKind: RegistrationCustomerMessageSingleSourceKind
  sourceId: string
  taskId: string
  sourceRevision: number
  studentName: string
  recipientLast4: string
  facts:
    | RegistrationCustomerMessageRendered["facts"]
    | RegistrationObservationCustomerMessagePublicFacts
  body: string
  buttons: ReadonlyArray<Readonly<{ name: string; type: "WL"; host: string }>>
}>

export type RegistrationCustomerMessagePreviewContract = Readonly<{
  parentPhoneDigits: string
  sourceFingerprint: string
  recipientHash: string
  templateKey: RegistrationCustomerMessageSingleSourceKind
  templateRevision: number
  templateChecksum: string
  renderedVariablesChecksum: string
  renderedBodyChecksum: string
  renderedButtonsChecksum: string
}>

export type RegistrationCustomerMessageReadinessContract = Readonly<{
  credentialsConfigured: boolean
  pfId: string | null
  templateId: string | null
  catalogChecksum: string
  recipientHash: string
  sourceFingerprint: string
  sourceFactsChecksum: string
}>

export type RegistrationCustomerMessagePrivateSource = Readonly<{
  source: Readonly<JsonRecord>
  parentPhoneDigits: string
  recipientHash: string
  sourceFingerprint: string
  sourceFactsChecksum: string
  rendered: RegistrationCustomerMessageRendered
  transportVariables?: Readonly<{ 학원위치URL: string }>
  previewContract: RegistrationCustomerMessagePreviewContract
  readinessContract: RegistrationCustomerMessageReadinessContract
}>

export type RegistrationCustomerMessageSourceResolver = Readonly<{
  resolve(input: RegistrationCustomerMessageSourceRequest): Promise<RegistrationCustomerMessagePublicSource>
}>

type SourceResolverDependencies = Readonly<{
  catalog: RegistrationCustomerMessageCatalog
  recipientHashPepper: string
  now?: () => Date
  resolveSource(input: RegistrationCustomerMessageSourceRequest): Promise<unknown>
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const PHONE_PATTERN = /^01(?:0|1|[6-9])[0-9]{7,8}$/u
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/iu
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const HASH_PATTERN = /^[0-9a-f]{64}$/iu
const LOWERCASE_HASH_PATTERN = /^[0-9a-f]{64}$/u
const SUBJECT_ORDER: ReadonlyArray<RegistrationCustomerMessageSubject> = ["영어", "수학", "과학"]
const WAITING_WORKFLOW_KIND: Readonly<Record<string, RegistrationCustomerMessageWaitingKind>> = {
  waiting_current_class: "current_class",
  waiting_new_class: "current_term_opening",
  waiting_next_opening: "next_term_opening",
}
const PRIVATE_SOURCES = new WeakMap<object, RegistrationCustomerMessagePrivateSource>()

const OBSERVATION_SOURCE_KEYS = Object.freeze([
  "messageKind",
  "sourceId",
  "taskId",
  "trackId",
  "observationId",
  "appointmentId",
  "sourceRevision",
  "sessionSourceRevision",
  "bookingFactHash",
  "studentName",
  "parentPhoneDigits",
  "subject",
  "className",
  "scheduledAt",
  "place",
  "campus",
  "teacherName",
])
const NORMALIZED_SESSION_SOURCE_REVISION_KEYS = Object.freeze([
  "authority",
  "sessionId",
  "revision",
])
const LEGACY_SESSION_SOURCE_REVISION_KEYS = Object.freeze([
  "authority",
  "sessionKey",
  "contentHash",
])

class CanonicalNumber {
  readonly value: string

  constructor(value: string) {
    this.value = value
  }
}

function sourceError(code: string): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: JsonRecord, keys: ReadonlyArray<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function canonicalJson(value: unknown): string {
  if (value instanceof CanonicalNumber) return value.value
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) sourceError("registration_customer_message_checksum_value_invalid")
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function requiredText(value: unknown, code: string) {
  if (typeof value !== "string") sourceError(code)
  const normalized = value.trim()
  return normalized || sourceError(code)
}

function requiredUuid(value: unknown, code = "registration_customer_message_source_mismatch") {
  const normalized = requiredText(value, code).toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : sourceError(code)
}

function nullableUuid(value: unknown, code: string) {
  if (value === null) return null
  return requiredUuid(value, code)
}

function sourceRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : sourceError("registration_customer_message_source_revision_invalid")
}

function nonnegativeInteger(value: unknown, code: string) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : sourceError(code)
}

function requiredHash(value: unknown, code: string) {
  const normalized = requiredText(value, code).toLowerCase()
  return HASH_PATTERN.test(normalized) ? normalized : sourceError(code)
}

function requiredClock(value: unknown, code: string) {
  const normalized = requiredText(value, code)
  if (!CLOCK_PATTERN.test(normalized)) sourceError(code)
  const [hour, minute] = normalized.split(":").map(Number)
  return { value: normalized, minutes: hour * 60 + minute }
}

function requiredDate(value: unknown, code: string) {
  const normalized = requiredText(value, code)
  const match = normalized.match(DATE_PATTERN)
  if (!match) sourceError(code)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(`${normalized}T00:00:00.000Z`)
  if (
    year < 1
    || !Number.isFinite(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) sourceError(code)
  return normalized
}

function subjects(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    sourceError("registration_customer_message_subject_invalid")
  }
  const normalized = value.map((subject) => {
    if (!SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) {
      sourceError("registration_customer_message_subject_invalid")
    }
    return subject as RegistrationCustomerMessageSubject
  })
  return [...new Set(normalized)].sort(
    (left, right) => SUBJECT_ORDER.indexOf(left) - SUBJECT_ORDER.indexOf(right),
  )
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

function parsedTimestamp(
  value: unknown,
  code = "registration_customer_message_schedule_invalid",
) {
  const text = requiredText(value, code)
  const match = text.match(RFC3339_PATTERN)
  if (!match) sourceError(code)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const offset = match[8]
  const offsetHour = offset.toUpperCase() === "Z" ? 0 : Number(offset.slice(1, 3))
  const offsetMinute = offset.toUpperCase() === "Z" ? 0 : Number(offset.slice(4, 6))
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) sourceError(code)
  const fraction = match[7] ?? ""
  if (fraction.length > 6) sourceError(code)
  const wholeSecond = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset}`
  const wholeSecondMillis = Date.parse(wholeSecond)
  if (!Number.isFinite(wholeSecondMillis) || wholeSecondMillis % 1_000 !== 0) {
    sourceError(code)
  }
  const microseconds = Number((fraction + "000000").slice(0, 6))
  const epochMicroseconds = wholeSecondMillis * 1_000 + microseconds
  if (!Number.isSafeInteger(epochMicroseconds)) {
    sourceError(code)
  }
  const absolute = Math.abs(epochMicroseconds)
  const epoch = `${epochMicroseconds < 0 ? "-" : ""}${Math.trunc(absolute / 1_000_000)}.${String(absolute % 1_000_000).padStart(6, "0")}`
  return {
    date: new Date(text),
    epoch,
    epochMicroseconds,
  }
}

function nullableTimestampEpoch(value: unknown, code: string) {
  return value === null ? null : parsedTimestamp(value, code).epoch
}

function compareCodePointText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameSubjects(
  left: ReadonlyArray<RegistrationCustomerMessageSubject>,
  right: ReadonlyArray<RegistrationCustomerMessageSubject>,
) {
  return left.length === right.length && left.every((subject, index) => subject === right[index])
}

const APPOINTMENT_PARTICIPANT_KEYS = Object.freeze([
  "trackId",
  "subject",
  "workflowStatus",
  "workflowRevision",
  "activityId",
  "activityStatus",
])

const APPOINTMENT_ELIGIBLE_WORKFLOW_STATUSES = new Set([
  "inquiry",
  "level_test_requested",
  "consultation_requested",
  "consultation_completed",
  "waiting_current_class",
  "waiting_new_class",
  "waiting_next_opening",
  "enrollment_requested",
  "payment_in_progress",
  "registered",
  "not_registered",
  "inquiry_only",
  "observation_requested",
  "observation_feedback_pending",
  "observation_completed",
])

function appointmentParticipants(
  appointmentKind: "level_test" | "visit_consultation",
  rawValue: unknown,
  normalizedSubjects: ReadonlyArray<RegistrationCustomerMessageSubject>,
) {
  const code = "registration_customer_message_appointment_participants_invalid"
  if (!Array.isArray(rawValue) || rawValue.length === 0) sourceError(code)
  const participants = rawValue.map((value) => {
    if (!isRecord(value) || !hasExactKeys(value, APPOINTMENT_PARTICIPANT_KEYS)) sourceError(code)
    const subject = value.subject
    if (!SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) sourceError(code)
    const activityStatus = requiredText(value.activityStatus, code)
    const workflowStatus = requiredText(value.workflowStatus, code)
    if (
      !APPOINTMENT_ELIGIBLE_WORKFLOW_STATUSES.has(workflowStatus)
      || (appointmentKind === "level_test"
        ? activityStatus !== "scheduled" && activityStatus !== "in_progress"
        : activityStatus !== "scheduled")
    ) sourceError(code)
    return Object.freeze({
      trackId: requiredUuid(value.trackId, code),
      subject: subject as RegistrationCustomerMessageSubject,
      workflowStatus,
      workflowRevision: nonnegativeInteger(value.workflowRevision, code),
      activityId: requiredUuid(value.activityId, code),
      activityStatus,
    })
  }).sort((left, right) => (
    SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
    || compareCodePointText(left.trackId, right.trackId)
    || compareCodePointText(left.activityId, right.activityId)
  ))
  if (
    new Set(participants.map(({ trackId }) => trackId)).size !== participants.length
    || new Set(participants.map(({ subject }) => subject)).size !== participants.length
  ) sourceError(code)
  const participantSubjects = subjects(participants.map(({ subject }) => subject))
  if (!sameSubjects(participantSubjects, normalizedSubjects)) {
    sourceError("registration_customer_message_subject_invalid")
  }
  return Object.freeze(participants)
}

function appointmentFacts(
  kind: RegistrationCustomerMessageSingleSourceKind,
  raw: JsonRecord,
  inputSourceId: string,
  now: Date,
  normalizedSubjects: ReadonlyArray<RegistrationCustomerMessageSubject>,
) {
  if (requiredUuid(raw.appointmentId) !== inputSourceId || raw.trackId !== null) {
    sourceError("registration_customer_message_source_mismatch")
  }
  const appointmentKind = raw.appointmentKind
  if (appointmentKind !== "level_test" && appointmentKind !== "visit_consultation") {
    sourceError("registration_customer_message_appointment_kind_invalid")
  }
  if (
    (kind === "level_test_booking" && appointmentKind !== "level_test")
    || (kind === "visit_consultation_booking" && appointmentKind !== "visit_consultation")
  ) sourceError("registration_customer_message_appointment_kind_mismatch")
  const participants = appointmentParticipants(appointmentKind, raw.participants, normalizedSubjects)
  const scheduledAt = parsedTimestamp(raw.scheduledAt)
  if (scheduledAt.epochMicroseconds <= now.getTime() * 1_000) {
    sourceError("registration_customer_message_schedule_not_future")
  }
  return {
    facts: {
      scheduledAt: scheduledAt.date,
      appointmentKind,
      place: requiredText(raw.place, "registration_customer_message_place_invalid"),
    },
    source: {
      appointmentId: inputSourceId,
      trackId: null,
      appointmentKind,
      scheduledAtEpoch: scheduledAt.epoch,
      place: requiredText(raw.place, "registration_customer_message_place_invalid"),
      participants,
    },
  } as const
}

function waitingFacts(raw: JsonRecord, inputSourceId: string) {
  if (requiredUuid(raw.trackId) !== inputSourceId || raw.appointmentId !== null) {
    sourceError("registration_customer_message_source_mismatch")
  }
  const workflowStatus = requiredText(
    raw.workflowStatus,
    "registration_customer_message_waiting_workflow_invalid",
  )
  const expectedKind = WAITING_WORKFLOW_KIND[workflowStatus]
  if (!expectedKind || raw.waitingKind !== expectedKind) {
    sourceError("registration_customer_message_waiting_kind_mismatch")
  }
  const waitingClassId = nullableUuid(
    raw.waitingClassId,
    "registration_customer_message_waiting_class_invalid",
  )
  let waitingClassName: string | undefined
  if (expectedKind === "current_class") {
    if (!waitingClassId) sourceError("registration_customer_message_waiting_class_invalid")
    waitingClassName = requiredText(
      raw.waitingClassName,
      "registration_customer_message_waiting_class_invalid",
    )
  } else if (waitingClassId !== null || raw.waitingClassName !== null) {
    sourceError("registration_customer_message_waiting_class_invalid")
  }
  return {
    facts: { waitingKind: expectedKind, ...(waitingClassName ? { waitingClassName } : {}) },
    source: {
      trackId: inputSourceId,
      appointmentId: null,
      workflowStatus,
      waitingKind: expectedKind,
      waitingClassId,
      waitingClassName: waitingClassName ?? null,
    },
  } as const
}

const ADMISSION_TRACK_KEYS = Object.freeze([
  "trackId",
  "subject",
  "workflowStatus",
  "workflowRevision",
  "pipelineStatus",
])
const ADMISSION_PLAN_KEYS = Object.freeze([
  "enrollmentId",
  "trackId",
  "subject",
  "sortOrder",
  "workflowStatus",
  "workflowRevision",
  "enrollmentUpdatedAt",
  "classId",
  "classSubject",
  "className",
  "classUpdatedAt",
  "textbookId",
  "textbookName",
  "textbookUpdatedAt",
  "runtimeVersion",
  "storageMode",
  "authority",
  "scheduleRevision",
  "scheduleHash",
  "slots",
  "firstLesson",
])
const ADMISSION_SLOT_KEYS = Object.freeze([
  "slotId",
  "weekday",
  "startTime",
  "endTime",
  "teacherName",
  "classroomName",
  "sortOrder",
  "updatedAt",
])
const ADMISSION_FIRST_LESSON_KEYS = Object.freeze([
  "sessionId",
  "sessionKey",
  "sessionDate",
  "scheduleState",
  "startTime",
  "endTime",
  "revision",
  "updatedAt",
])

function admissionSlot(value: unknown, authority: "normalized" | "legacy") {
  const code = "registration_customer_message_admission_schedule_incomplete"
  if (!isRecord(value) || !hasExactKeys(value, ADMISSION_SLOT_KEYS)) sourceError(code)
  const weekday = nonnegativeInteger(value.weekday, code)
  if (weekday > 6) sourceError(code)
  const start = requiredClock(value.startTime, code)
  const end = requiredClock(value.endTime, code)
  if (end.minutes <= start.minutes) sourceError(code)
  const slotId = nullableUuid(value.slotId, code)
  const updatedAt = nullableTimestampEpoch(value.updatedAt, code)
  if (
    (authority === "normalized" && (!slotId || !updatedAt))
    || (authority === "legacy" && (slotId !== null || updatedAt !== null))
  ) sourceError("registration_customer_message_admission_plan_invalid")
  return Object.freeze({
    slotId,
    weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    startTime: start.value,
    endTime: end.value,
    teacherName: requiredText(value.teacherName, code),
    classroomName: requiredText(value.classroomName, code),
    sortOrder: nonnegativeInteger(value.sortOrder, code),
    updatedAt,
  })
}

function admissionFirstLesson(value: unknown, authority: "normalized" | "legacy") {
  const code = "registration_customer_message_admission_schedule_incomplete"
  if (!isRecord(value) || !hasExactKeys(value, ADMISSION_FIRST_LESSON_KEYS)) sourceError(code)
  const start = requiredClock(value.startTime, code)
  const end = requiredClock(value.endTime, code)
  if (end.minutes <= start.minutes) sourceError(code)
  const scheduleState = requiredText(value.scheduleState, code)
  if (scheduleState !== "active" && scheduleState !== "makeup") sourceError(code)
  const sessionId = nullableUuid(value.sessionId, code)
  const revision = value.revision === null ? null : nonnegativeInteger(value.revision, code)
  const updatedAt = nullableTimestampEpoch(value.updatedAt, code)
  if (
    (authority === "normalized" && (!sessionId || revision === null || !updatedAt))
    || (authority === "legacy" && (sessionId !== null || revision !== null || updatedAt !== null))
  ) sourceError("registration_customer_message_admission_plan_invalid")
  return Object.freeze({
    sessionId,
    sessionKey: requiredText(value.sessionKey, code),
    sessionDate: requiredDate(value.sessionDate, code),
    scheduleState,
    startTime: start.value,
    endTime: end.value,
    revision,
    updatedAt,
  })
}

function admissionFacts(
  raw: JsonRecord,
  inputSourceId: string,
  normalizedSubjects: ReadonlyArray<RegistrationCustomerMessageSubject>,
) {
  if (requiredUuid(raw.taskId) !== inputSourceId || raw.trackId !== null || raw.appointmentId !== null) {
    sourceError("registration_customer_message_source_mismatch")
  }
  if (!Array.isArray(raw.tracks) || raw.tracks.length === 0) {
    sourceError("registration_customer_message_admission_tracks_invalid")
  }
  const tracks = raw.tracks.map((value) => {
    const code = "registration_customer_message_admission_tracks_invalid"
    if (!isRecord(value) || !hasExactKeys(value, ADMISSION_TRACK_KEYS)) sourceError(code)
    const subject = value.subject
    if (!SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) {
      sourceError(code)
    }
    if (value.workflowStatus !== "enrollment_requested") sourceError(code)
    return Object.freeze({
      trackId: requiredUuid(value.trackId, code),
      subject: subject as RegistrationCustomerMessageSubject,
      workflowStatus: "enrollment_requested" as const,
      workflowRevision: nonnegativeInteger(value.workflowRevision, code),
      pipelineStatus: requiredText(value.pipelineStatus, code),
    })
  }).sort((left, right) => (
    SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
    || compareCodePointText(left.trackId, right.trackId)
  ))
  if (
    new Set(tracks.map(({ trackId }) => trackId)).size !== tracks.length
    || new Set(tracks.map(({ subject }) => subject)).size !== tracks.length
  ) sourceError("registration_customer_message_admission_tracks_invalid")
  if (!Array.isArray(raw.enrollmentPlans) || raw.enrollmentPlans.length === 0) {
    sourceError("registration_customer_message_admission_schedule_incomplete")
  }
  const tracksById = new Map(tracks.map((track) => [track.trackId, track]))
  const plans = raw.enrollmentPlans.map((value) => {
    const code = "registration_customer_message_admission_plan_invalid"
    if (!isRecord(value) || !hasExactKeys(value, ADMISSION_PLAN_KEYS)) sourceError(code)
    const trackId = requiredUuid(value.trackId, code)
    const track = tracksById.get(trackId)
    const subject = value.subject
    if (!track || !SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) sourceError(code)
    if (
      value.workflowStatus !== "enrollment_requested"
      || subject !== track.subject
      || value.classSubject !== subject
    ) sourceError(code)
    const workflowRevision = nonnegativeInteger(value.workflowRevision, code)
    if (workflowRevision !== track.workflowRevision) sourceError(code)
    const runtimeVersion = nonnegativeInteger(value.runtimeVersion, code)
    const storageMode = value.storageMode
    if (storageMode !== "normalized" && storageMode !== "legacy" && storageMode !== "shadow") {
      sourceError(code)
    }
    const authority = value.authority
    if (authority !== "normalized" && authority !== "legacy") sourceError(code)
    if (
      (authority === "normalized" && !(runtimeVersion === 1 && storageMode === "normalized"))
      || (authority === "legacy" && runtimeVersion === 1 && storageMode === "normalized")
    ) sourceError(code)
    const textbookId = nullableUuid(value.textbookId, code)
    const textbookName = value.textbookName === null
      ? null
      : requiredText(value.textbookName, code)
    const textbookUpdatedAt = nullableTimestampEpoch(value.textbookUpdatedAt, code)
    if (
      (textbookId === null && (textbookName !== null || textbookUpdatedAt !== null))
      || (textbookId !== null && (!textbookName || !textbookUpdatedAt))
    ) sourceError(code)
    if (!Array.isArray(value.slots) || value.slots.length === 0) {
      sourceError("registration_customer_message_admission_schedule_incomplete")
    }
    const slots = value.slots.map((slot) => admissionSlot(slot, authority)).sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.weekday - right.weekday
      || compareCodePointText(left.startTime, right.startTime)
      || compareCodePointText(left.slotId ?? "", right.slotId ?? "")
    ))
    const firstLesson = admissionFirstLesson(value.firstLesson, authority)
    return Object.freeze({
      enrollmentId: requiredUuid(value.enrollmentId, code),
      trackId,
      subject: subject as RegistrationCustomerMessageSubject,
      sortOrder: nonnegativeInteger(value.sortOrder, code),
      workflowStatus: "enrollment_requested" as const,
      workflowRevision,
      enrollmentUpdatedAt: parsedTimestamp(value.enrollmentUpdatedAt, code).epoch,
      classId: requiredUuid(value.classId, code),
      classSubject: subject as RegistrationCustomerMessageSubject,
      className: requiredText(value.className, code),
      classUpdatedAt: parsedTimestamp(value.classUpdatedAt, code).epoch,
      textbookId,
      textbookName,
      textbookUpdatedAt,
      runtimeVersion,
      storageMode,
      authority,
      scheduleRevision: nonnegativeInteger(value.scheduleRevision, code),
      scheduleHash: requiredHash(value.scheduleHash, code),
      slots: Object.freeze(slots),
      firstLesson,
    })
  }).sort((left, right) => (
    SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
    || left.sortOrder - right.sortOrder
    || compareCodePointText(left.className, right.className)
    || compareCodePointText(left.enrollmentId, right.enrollmentId)
  ))
  if (new Set(plans.map(({ enrollmentId }) => enrollmentId)).size !== plans.length) {
    sourceError("registration_customer_message_admission_plan_invalid")
  }
  const planSubjects = subjects(plans.map(({ subject }) => subject))
  const planTrackIds = new Set(plans.map(({ trackId }) => trackId))
  if (
    !sameSubjects(planSubjects, normalizedSubjects)
    || planTrackIds.size !== tracks.length
    || tracks.some(({ trackId }) => !planTrackIds.has(trackId))
  ) sourceError("registration_customer_message_subject_invalid")
  const enrollmentPlans = Object.freeze(plans.map((plan) => Object.freeze({
    enrollmentId: plan.enrollmentId,
    subject: plan.subject,
    sortOrder: plan.sortOrder,
    className: plan.className,
    textbookName: plan.textbookName,
    slots: Object.freeze(plan.slots.map((slot) => Object.freeze({
      weekday: slot.weekday,
      startTime: slot.startTime,
      endTime: slot.endTime,
      teacherName: slot.teacherName,
      classroomName: slot.classroomName,
    }))),
    firstLesson: Object.freeze({
      sessionDate: plan.firstLesson.sessionDate,
      startTime: plan.firstLesson.startTime,
      endTime: plan.firstLesson.endTime,
    }),
  }) satisfies RegistrationCustomerMessageAdmissionPlan))
  return {
    facts: { enrollmentPlans },
    source: {
      trackId: null,
      appointmentId: null,
      tracks: Object.freeze(tracks),
      enrollmentPlans: Object.freeze(plans),
    },
  } as const
}

function observationSessionSourceRevision(value: unknown) {
  const code = "registration_customer_message_source_invalid"
  if (!isRecord(value)) sourceError(code)
  if (
    value.authority === "normalized"
    && hasExactKeys(value, NORMALIZED_SESSION_SOURCE_REVISION_KEYS)
  ) {
    return Object.freeze({
      authority: "normalized" as const,
      sessionId: requiredUuid(value.sessionId, code),
      revision: nonnegativeInteger(value.revision, code),
    })
  }
  if (
    value.authority === "legacy"
    && hasExactKeys(value, LEGACY_SESSION_SOURCE_REVISION_KEYS)
  ) {
    return Object.freeze({
      authority: "legacy" as const,
      sessionKey: requiredText(value.sessionKey, code),
      contentHash: requiredText(value.contentHash, code),
    })
  }
  return sourceError(code)
}

function normalizedObservationSource(
  kind: "observation_booking" | "observation_reminder",
  inputSourceId: string,
  raw: JsonRecord,
) {
  const code = "registration_customer_message_source_invalid"
  if (!hasExactKeys(raw, OBSERVATION_SOURCE_KEYS) || raw.messageKind !== kind) {
    sourceError(code)
  }
  const sourceId = requiredUuid(raw.sourceId, code)
  const observationId = requiredUuid(raw.observationId, code)
  if (sourceId !== inputSourceId || sourceId !== observationId) sourceError(code)
  const taskId = requiredUuid(raw.taskId, code)
  const trackId = requiredUuid(raw.trackId, code)
  const appointmentId = requiredUuid(raw.appointmentId, code)
  const revision = nonnegativeInteger(raw.sourceRevision, code)
  if (revision < 1) sourceError(code)
  const sessionSourceRevision = observationSessionSourceRevision(raw.sessionSourceRevision)
  const bookingFactHash = requiredText(raw.bookingFactHash, code)
  if (!LOWERCASE_HASH_PATTERN.test(bookingFactHash)) sourceError(code)
  const studentName = requiredText(raw.studentName, code)
  const parentPhoneDigits = requiredText(raw.parentPhoneDigits, code)
  if (!PHONE_PATTERN.test(parentPhoneDigits)) sourceError(code)
  if (!SUBJECT_ORDER.includes(raw.subject as RegistrationCustomerMessageSubject)) {
    sourceError(code)
  }
  const subject = raw.subject as RegistrationCustomerMessageSubject
  const className = requiredText(raw.className, code)
  const scheduledAt = requiredText(raw.scheduledAt, code)
  const scheduledAtEpoch = parsedTimestamp(scheduledAt, code).epoch
  const place = requiredText(raw.place, code)
  if (raw.campus !== "본관" && raw.campus !== "별관") sourceError(code)
  const campus = raw.campus
  const teacherName = requiredText(raw.teacherName, code)
  const observationFacts = Object.freeze({
    studentName,
    subject,
    className,
    scheduledAt,
    place,
    campus,
    teacherName,
  }) satisfies RegistrationObservationCustomerMessageFacts
  return {
    taskId,
    studentName,
    parentPhoneDigits,
    subjects: Object.freeze([subject]),
    sourceRevision: revision,
    observationFacts,
    canonicalFacts: {
      studentName,
      subjects: Object.freeze([subject]),
      className,
      scheduledAt,
      place,
      campus,
      teacherName,
    } satisfies RegistrationCustomerMessageCanonicalFacts,
    canonicalSource: {
      messageKind: kind,
      sourceId,
      taskId,
      trackId,
      observationId,
      appointmentId,
      sourceRevision: revision,
      sessionSourceRevision,
      bookingFactHash,
      studentName,
      subject,
      className,
      scheduledAtEpoch,
      place,
      campus,
      teacherName,
    },
  }
}

function normalizedSource(
  kind: RegistrationCustomerMessageSingleSourceKind,
  sourceId: string,
  raw: JsonRecord,
  now: Date,
) {
  if (kind === "observation_booking" || kind === "observation_reminder") {
    return normalizedObservationSource(kind, sourceId, raw)
  }
  if (raw.messageKind !== kind || requiredUuid(raw.sourceId) !== sourceId) {
    sourceError("registration_customer_message_source_mismatch")
  }
  const taskId = requiredUuid(raw.taskId)
  const studentName = requiredText(
    raw.studentName,
    "registration_customer_message_student_name_invalid",
  )
  const parentPhoneDigits = requiredText(
    raw.parentPhoneDigits,
    "registration_customer_message_phone_invalid",
  )
  if (!PHONE_PATTERN.test(parentPhoneDigits)) {
    sourceError("registration_customer_message_phone_invalid")
  }
  const normalizedSubjects = subjects(raw.subjects)
  const revision = sourceRevision(raw.sourceRevision)
  const variant = kind === "waiting_notice"
    ? waitingFacts(raw, sourceId)
    : kind === "admission_application"
      ? admissionFacts(raw, sourceId, normalizedSubjects)
      : appointmentFacts(kind, raw, sourceId, now, normalizedSubjects)
  return {
    taskId,
    studentName,
    parentPhoneDigits,
    subjects: normalizedSubjects,
    sourceRevision: revision,
    canonicalFacts: {
      studentName,
      subjects: normalizedSubjects,
      ...variant.facts,
    } satisfies RegistrationCustomerMessageCanonicalFacts,
    canonicalSource: {
      messageKind: kind,
      sourceId,
      taskId,
      sourceRevision: revision,
      studentName,
      subjects: normalizedSubjects,
      ...variant.source,
    },
  }
}

function recipientHash(parentPhoneDigits: string, pepper: string) {
  const normalizedPepper = pepper.trim()
  if (!normalizedPepper) sourceError("registration_customer_message_recipient_hash_pepper_missing")
  return createHmac("sha256", normalizedPepper)
    .update(`registration-customer-message-recipient-v1\u001f${parentPhoneDigits}`, "utf8")
    .digest("hex")
}

function sourceFactsChecksum(raw: JsonRecord) {
  const checksumSource = cloneJson(raw)
  delete checksumSource.parentPhoneDigits
  if (Object.prototype.hasOwnProperty.call(raw, "scheduledAt")) {
    checksumSource.scheduledAt = new CanonicalNumber(parsedTimestamp(raw.scheduledAt).epoch)
  }
  return sha256(canonicalJson({
    domain: "registration-customer-message-source-facts-v1",
    source: checksumSource,
  }))
}

function publicButtons(buttons: ReadonlyArray<RegistrationCustomerMessageButton>) {
  return Object.freeze(buttons.map((button) => Object.freeze({
    name: button.name,
    type: button.type,
    host: new URL(button.linkMobile).host,
  })))
}

function observationTransportVariables(
  facts: RegistrationObservationCustomerMessageFacts,
) {
  return Object.freeze({
    학원위치URL: OBSERVATION_LOCATION_TRANSPORT_VALUES[facts.campus],
  })
}

function observationBodyVariables(rendered: RegistrationCustomerMessageRendered) {
  const value = (name: string) => requiredText(
    rendered.variables[`#{${name}}`],
    "registration_customer_message_source_invalid",
  )
  return Object.freeze({
    학생명: value("학생명"),
    과목: value("과목"),
    수업명: value("수업명"),
    예약일시: value("예약일시"),
    장소: value("장소"),
    담당선생님: value("담당선생님"),
  })
}

function observationPublicFacts(
  facts: RegistrationObservationCustomerMessageFacts,
  rendered: RegistrationCustomerMessageRendered,
): RegistrationObservationCustomerMessagePublicFacts {
  return Object.freeze({
    subjectLabel: rendered.facts.subjectLabel,
    className: facts.className,
    scheduleLabel: requiredText(
      rendered.facts.scheduleLabel,
      "registration_customer_message_source_invalid",
    ),
    placeLabel: requiredText(
      rendered.facts.placeLabel,
      "registration_customer_message_source_invalid",
    ),
    teacherLabel: facts.teacherName,
  })
}

export function createRegistrationCustomerMessageSourceResolver(
  dependencies: SourceResolverDependencies,
): RegistrationCustomerMessageSourceResolver {
  const now = dependencies.now ?? (() => new Date())

  return Object.freeze({
    async resolve(input) {
      const rawValue = await dependencies.resolveSource(input)
      if (!isRecord(rawValue)) sourceError("registration_customer_message_source_invalid")
      const raw = cloneJson(rawValue)
      const currentTime = now()
      if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
        sourceError("registration_customer_message_clock_invalid")
      }
      const normalized = normalizedSource(input.messageKind, input.sourceId, raw, currentTime)
      const template = dependencies.catalog.templates[input.messageKind]
      if (!template) sourceError("registration_customer_message_template_missing")
      const rendered = renderRegistrationCustomerMessage({
        kind: input.messageKind,
        facts: normalized.canonicalFacts,
      })
      const hash = recipientHash(
        normalized.parentPhoneDigits,
        dependencies.recipientHashPepper,
      )
      let observationFacts: RegistrationObservationCustomerMessageFacts | null = null
      let transportVariables: Readonly<{ 학원위치URL: string }> | null = null
      let fingerprint: string
      if ("observationFacts" in normalized) {
        observationFacts = normalized.observationFacts
        transportVariables = observationTransportVariables(normalized.observationFacts)
        fingerprint = sha256(canonicalJson({
          domain: "registration-customer-message-source-fingerprint-v1",
          rawCanonicalJson: canonicalJson(raw),
          bodyVariables: observationBodyVariables(rendered),
          transportVariables,
          finalBody: rendered.body,
          finalButtons: rendered.buttons,
          appointmentNotificationRevision: normalized.sourceRevision,
          bookingFactHash: normalized.canonicalSource.bookingFactHash,
          recipientHash: hash,
          template: {
            key: input.messageKind,
            revision: template.revision,
            checksum: template.checksums.template,
          },
        }))
      } else {
        fingerprint = sha256(canonicalJson({
          domain: "registration-customer-message-source-fingerprint-v1",
          recipientHash: hash,
          source: normalized.canonicalSource,
          template: {
            key: input.messageKind,
            revision: template.revision,
            checksum: template.checksums.template,
          },
        }))
      }
      const factsChecksum = sourceFactsChecksum(raw)
      const publicSource = Object.freeze({
        messageKind: input.messageKind,
        sourceId: input.sourceId,
        taskId: normalized.taskId,
        sourceRevision: normalized.sourceRevision,
        studentName: normalized.studentName,
        recipientLast4: normalized.parentPhoneDigits.slice(-4),
        facts: observationFacts
          ? observationPublicFacts(observationFacts, rendered)
          : rendered.facts,
        body: rendered.body,
        buttons: publicButtons(rendered.buttons),
      })
      const previewContract = Object.freeze({
        parentPhoneDigits: normalized.parentPhoneDigits,
        sourceFingerprint: fingerprint,
        recipientHash: hash,
        templateKey: input.messageKind,
        templateRevision: template.revision,
        templateChecksum: template.checksums.template,
        renderedVariablesChecksum: rendered.checksums.variables,
        renderedBodyChecksum: rendered.checksums.body,
        renderedButtonsChecksum: rendered.checksums.buttons,
      })
      PRIVATE_SOURCES.set(publicSource, Object.freeze({
        source: Object.freeze(normalized.canonicalSource),
        parentPhoneDigits: normalized.parentPhoneDigits,
        recipientHash: hash,
        sourceFingerprint: fingerprint,
        sourceFactsChecksum: factsChecksum,
        rendered,
        ...(transportVariables ? { transportVariables } : {}),
        previewContract,
        readinessContract: Object.freeze({
          credentialsConfigured: dependencies.catalog.credentialsConfigured,
          pfId: dependencies.catalog.pfId,
          templateId: template.templateId,
          catalogChecksum: template.checksums.template,
          recipientHash: hash,
          sourceFingerprint: fingerprint,
          sourceFactsChecksum: factsChecksum,
        }),
      }))
      return publicSource
    },
  })
}

export function readRegistrationCustomerMessagePrivateSource(
  source: RegistrationCustomerMessagePublicSource,
) {
  const privateSource = PRIVATE_SOURCES.get(source)
  if (!privateSource) sourceError("registration_customer_message_private_source_unavailable")
  return privateSource
}
