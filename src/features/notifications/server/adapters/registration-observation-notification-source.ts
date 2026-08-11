export type RegistrationObservationSessionSourceRevision =
  | Readonly<{
      authority: "normalized"
      sessionId: string
      revision: number
    }>
  | Readonly<{
      authority: "legacy"
      sessionKey: string
      contentHash: string
    }>

export type RegistrationObservationNotificationSource = Readonly<{
  observationId: string
  appointmentId: string
  taskId: string
  trackId: string
  notificationRevision: number
  observationStatus: "scheduled" | "attended_feedback_pending" | "completed" | "no_show" | "canceled"
  appointmentStatus: "scheduled" | "completed" | "canceled"
  hasFeedback: boolean
  studentName: string
  subject: "영어" | "수학" | "과학"
  classId: string
  className: string
  sessionAuthority: "normalized" | "legacy"
  classLessonSessionId: string | null
  legacySessionKey: string | null
  scheduleState: "active" | "makeup"
  startsAt: string
  endsAt: string
  teacherCatalogId: string
  teacherProfileId: string | null
  teacherName: string
  classroomCatalogId: string
  classroomName: string
  campus: "본관" | "별관"
  sourceRevision: RegistrationObservationSessionSourceRevision
  bookingFactHash: string
  directorProfileId: string | null
}>

export type RegistrationObservationPreparation = Readonly<{
  textbookNames: ReadonlyArray<string>
  progressSummary: string
}>

export type RegistrationObservationPreparationInput = Readonly<{
  source: Readonly<{
    sessionAuthority: "normalized" | "legacy"
    classLessonSessionId: string | null
    legacySessionKey: string | null
  }>
  selectedSession: unknown
  exactProgressLogs: ReadonlyArray<unknown>
  rejectedProgressLogs: ReadonlyArray<unknown>
  classTextbooks: ReadonlyArray<unknown>
}>

export type ObservationBookingPresentationFact = Readonly<{
  class_id: string
  class_name: string
  session_authority: "normalized" | "legacy"
  class_lesson_session_id: string | null
  legacy_session_key: string | null
  schedule_state: "active" | "makeup"
  starts_at: string
  ends_at: string
  teacher_name: string
  classroom_name: string
  campus: "본관" | "별관"
}>

type ObservationChatPayloadBase = Readonly<{
  task_id: string
  track_id: string
  observation_id: string
  appointment_id: string
  appointment_notification_revision: number
  student_name: string
  subject: "영어" | "수학" | "과학"
  source_revision: RegistrationObservationSessionSourceRevision
  booking_fact_hash: string
  occurred_at: string
  delivery_expires_at: string
  mention_role: "subject_teacher" | "track_director"
  mention_profile_ids: ReadonlyArray<string>
}>

export type RegistrationObservationChatPayloadV3 =
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_scheduled"
      booking: ObservationBookingPresentationFact
      textbook_names: ReadonlyArray<string>
      progress_summary: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_rescheduled"
      previous_booking: ObservationBookingPresentationFact
      booking: ObservationBookingPresentationFact
      textbook_names: ReadonlyArray<string>
      progress_summary: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_canceled"
      canceled_booking: ObservationBookingPresentationFact
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_reminder_due"
      booking: ObservationBookingPresentationFact
      textbook_names: ReadonlyArray<string>
      progress_summary: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_feedback_due"
      booking: ObservationBookingPresentationFact
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_feedback_submitted"
      booking: ObservationBookingPresentationFact
      submitted_by_name: string
      submitted_at: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_director_reassigned"
      assignment_fact_id: string
      booking: ObservationBookingPresentationFact
      previous_director_profile_ids: ReadonlyArray<string>
      director_profile_ids: ReadonlyArray<string>
    }>)

type QueryResult = Readonly<{ data: unknown; error: unknown }>

type RegistrationObservationQuery = PromiseLike<QueryResult> & Readonly<{
  select(columns: string): RegistrationObservationQuery
  eq(column: string, value: unknown): RegistrationObservationQuery
  in(column: string, values: ReadonlyArray<unknown>): RegistrationObservationQuery
  or(filters: string): RegistrationObservationQuery
  order(column: string, options?: Readonly<Record<string, unknown>>): RegistrationObservationQuery
  limit(count: number): RegistrationObservationQuery
  maybeSingle(): RegistrationObservationQuery
  abortSignal(signal: AbortSignal): RegistrationObservationQuery
  retry(enabled: boolean): RegistrationObservationQuery
}>

export type RegistrationObservationSupabaseClient = Readonly<{
  rpc(name: string, parameters: Readonly<Record<string, unknown>>): RegistrationObservationQuery
  from(table: string): RegistrationObservationQuery
}>

export type RegistrationObservationNotificationSourceDependencies = Readonly<{
  getClient(): Promise<RegistrationObservationSupabaseClient>
}>

export type RegistrationObservationNotificationSourceReader = Readonly<{
  readSource(observationId: string): Promise<RegistrationObservationNotificationSource>
  readCurrentPreparation(source: RegistrationObservationNotificationSource): Promise<RegistrationObservationPreparation>
}>

type JsonRecord = Record<string, unknown>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/
const SUBJECTS = new Set(["영어", "수학", "과학"])
const OBSERVATION_STATUSES = new Set([
  "scheduled", "attended_feedback_pending", "completed", "no_show", "canceled",
])
const APPOINTMENT_STATUSES = new Set(["scheduled", "completed", "canceled"])
const SOURCE_KEYS = [
  "appointmentId", "appointmentStatus", "bookingFactHash", "campus", "classId",
  "classLessonSessionId", "className", "classroomCatalogId", "classroomName",
  "directorProfileId", "endsAt", "hasFeedback", "legacySessionKey",
  "notificationRevision", "observationId", "observationStatus", "scheduleState",
  "sessionAuthority", "sourceRevision", "startsAt", "studentName", "subject",
  "taskId", "teacherCatalogId", "teacherName", "teacherProfileId", "trackId",
] as const
const PAYLOAD_BASE_KEYS = [
  "appointment_id", "appointment_notification_revision", "booking_fact_hash",
  "delivery_expires_at", "event_kind", "mention_profile_ids", "mention_role",
  "observation_id", "occurred_at", "source_revision", "student_name", "subject",
  "task_id", "track_id",
] as const
const BOOKING_KEYS = [
  "campus", "class_id", "class_lesson_session_id", "class_name", "classroom_name",
  "ends_at", "legacy_session_key", "schedule_state", "session_authority", "starts_at",
  "teacher_name",
] as const

function invalidSource(): never {
  throw Object.assign(new Error("notification_registration_observation_source_invalid"), {
    code: "notification_registration_observation_source_invalid",
  })
}

function unavailableSource(): never {
  throw Object.assign(new Error("notification_registration_observation_source_unavailable"), {
    code: "notification_registration_observation_source_unavailable",
  })
}

function invalidPayload(): never {
  throw Object.assign(new Error("notification_registration_observation_payload_invalid"), {
    code: "notification_registration_observation_payload_invalid",
  })
}

function transientSourceError(value: unknown) {
  if (!isRecord(value)) return true
  const code = typeof value.code === "string" ? value.code.toUpperCase() : ""
  if (!code) return true
  return code.startsWith("08")
    || code === "40001"
    || code === "40P01"
    || code === "53300"
    || code === "57014"
    || code.startsWith("57P")
    || /^PGRST00[0-3]$/.test(code)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: JsonRecord, keys: ReadonlyArray<string>, fail: () => never) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail()
  }
}

function stringValue(value: unknown, fail: () => never, maximumBytes = 2048) {
  if (typeof value !== "string") fail()
  const normalized = value.trim()
  if (!normalized || new TextEncoder().encode(normalized).length > maximumBytes) fail()
  return normalized
}

function uuidValue(value: unknown, fail: () => never) {
  const uuid = stringValue(value, fail, 64).toLowerCase()
  if (!UUID_PATTERN.test(uuid)) fail()
  return uuid
}

function nullableUuidValue(value: unknown, fail: () => never) {
  if (value === null) return null
  return uuidValue(value, fail)
}

function timestampValue(value: unknown, fail: () => never) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) fail()
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  ) fail()
  return value
}

function positiveInteger(value: unknown, fail: () => never) {
  if (!Number.isInteger(value) || (value as number) <= 0) fail()
  return value as number
}

function nonNegativeInteger(value: unknown, fail: () => never) {
  if (!Number.isInteger(value) || (value as number) < 0) fail()
  return value as number
}

function sourceRevisionValue(value: unknown, fail: () => never): RegistrationObservationSessionSourceRevision {
  if (!isRecord(value) || (value.authority !== "normalized" && value.authority !== "legacy")) fail()
  if (value.authority === "normalized") {
    exactKeys(value, ["authority", "revision", "sessionId"], fail)
    return Object.freeze({
      authority: "normalized",
      sessionId: uuidValue(value.sessionId, fail),
      revision: nonNegativeInteger(value.revision, fail),
    })
  }
  exactKeys(value, ["authority", "contentHash", "sessionKey"], fail)
  const contentHash = stringValue(value.contentHash, fail, 64)
  if (!HASH_PATTERN.test(contentHash)) fail()
  return Object.freeze({
    authority: "legacy",
    sessionKey: stringValue(value.sessionKey, fail, 512),
    contentHash,
  })
}

function canonicalUuidArray(value: unknown, fail: () => never) {
  if (!Array.isArray(value) || value.length > 20) fail()
  const values = value.map((item) => uuidValue(item, fail))
  const canonical = [...new Set(values)].sort()
  if (canonical.length !== values.length || canonical.some((item, index) => item !== values[index])) fail()
  return Object.freeze(values)
}

function stringArray(value: unknown, fail: () => never) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) fail()
  return Object.freeze(value.map((item) => stringValue(item, fail, 512)))
}

function bookingValue(value: unknown): ObservationBookingPresentationFact {
  if (!isRecord(value)) invalidPayload()
  exactKeys(value, BOOKING_KEYS, invalidPayload)
  if (value.session_authority !== "normalized" && value.session_authority !== "legacy") invalidPayload()
  const normalizedId = nullableUuidValue(value.class_lesson_session_id, invalidPayload)
  const legacyKey = value.legacy_session_key === null
    ? null
    : stringValue(value.legacy_session_key, invalidPayload, 512)
  if (
    (value.session_authority === "normalized" && (!normalizedId || legacyKey !== null))
    || (value.session_authority === "legacy" && (normalizedId !== null || legacyKey === null))
  ) invalidPayload()
  if (value.schedule_state !== "active" && value.schedule_state !== "makeup") invalidPayload()
  if (value.campus !== "본관" && value.campus !== "별관") invalidPayload()
  const startsAt = timestampValue(value.starts_at, invalidPayload)
  const endsAt = timestampValue(value.ends_at, invalidPayload)
  if (Date.parse(startsAt) >= Date.parse(endsAt)) invalidPayload()
  return Object.freeze({
    class_id: uuidValue(value.class_id, invalidPayload),
    class_name: stringValue(value.class_name, invalidPayload, 512),
    session_authority: value.session_authority,
    class_lesson_session_id: normalizedId,
    legacy_session_key: legacyKey,
    schedule_state: value.schedule_state,
    starts_at: startsAt,
    ends_at: endsAt,
    teacher_name: stringValue(value.teacher_name, invalidPayload, 512),
    classroom_name: stringValue(value.classroom_name, invalidPayload, 512),
    campus: value.campus,
  })
}

function sourceRevisionMatchesBooking(
  sourceRevision: RegistrationObservationSessionSourceRevision,
  booking: ObservationBookingPresentationFact,
) {
  if (
    (sourceRevision.authority === "normalized"
      && (booking.session_authority !== "normalized"
        || booking.class_lesson_session_id !== sourceRevision.sessionId
        || booking.legacy_session_key !== null))
    || (sourceRevision.authority === "legacy"
      && (booking.session_authority !== "legacy"
        || booking.class_lesson_session_id !== null
        || booking.legacy_session_key !== sourceRevision.sessionKey))
  ) invalidPayload()
  return booking
}

export function parseRegistrationObservationNotificationSource(
  value: unknown,
): RegistrationObservationNotificationSource {
  if (!isRecord(value)) invalidSource()
  exactKeys(value, SOURCE_KEYS, invalidSource)
  if (!OBSERVATION_STATUSES.has(String(value.observationStatus))) invalidSource()
  if (!APPOINTMENT_STATUSES.has(String(value.appointmentStatus))) invalidSource()
  if (typeof value.hasFeedback !== "boolean") invalidSource()
  if (!SUBJECTS.has(String(value.subject))) invalidSource()
  if (value.sessionAuthority !== "normalized" && value.sessionAuthority !== "legacy") invalidSource()
  if (value.scheduleState !== "active" && value.scheduleState !== "makeup") invalidSource()
  if (value.campus !== "본관" && value.campus !== "별관") invalidSource()
  const sourceRevision = sourceRevisionValue(value.sourceRevision, invalidSource)
  const normalizedId = nullableUuidValue(value.classLessonSessionId, invalidSource)
  const legacyKey = value.legacySessionKey === null
    ? null
    : stringValue(value.legacySessionKey, invalidSource, 512)
  if (
    (value.sessionAuthority === "normalized" && (!normalizedId || legacyKey !== null || sourceRevision.authority !== "normalized"))
    || (value.sessionAuthority === "legacy" && (normalizedId !== null || legacyKey === null || sourceRevision.authority !== "legacy"))
  ) invalidSource()
  if (sourceRevision.authority === "normalized" && sourceRevision.sessionId !== normalizedId) invalidSource()
  if (sourceRevision.authority === "legacy" && sourceRevision.sessionKey !== legacyKey) invalidSource()
  const startsAt = timestampValue(value.startsAt, invalidSource)
  const endsAt = timestampValue(value.endsAt, invalidSource)
  if (Date.parse(startsAt) >= Date.parse(endsAt)) invalidSource()
  const bookingFactHash = stringValue(value.bookingFactHash, invalidSource, 64)
  if (!HASH_PATTERN.test(bookingFactHash)) invalidSource()
  return Object.freeze({
    observationId: uuidValue(value.observationId, invalidSource),
    appointmentId: uuidValue(value.appointmentId, invalidSource),
    taskId: uuidValue(value.taskId, invalidSource),
    trackId: uuidValue(value.trackId, invalidSource),
    notificationRevision: positiveInteger(value.notificationRevision, invalidSource),
    observationStatus: value.observationStatus as RegistrationObservationNotificationSource["observationStatus"],
    appointmentStatus: value.appointmentStatus as RegistrationObservationNotificationSource["appointmentStatus"],
    hasFeedback: value.hasFeedback,
    studentName: stringValue(value.studentName, invalidSource, 512),
    subject: value.subject as RegistrationObservationNotificationSource["subject"],
    classId: uuidValue(value.classId, invalidSource),
    className: stringValue(value.className, invalidSource, 512),
    sessionAuthority: value.sessionAuthority,
    classLessonSessionId: normalizedId,
    legacySessionKey: legacyKey,
    scheduleState: value.scheduleState,
    startsAt,
    endsAt,
    teacherCatalogId: uuidValue(value.teacherCatalogId, invalidSource),
    teacherProfileId: nullableUuidValue(value.teacherProfileId, invalidSource),
    teacherName: stringValue(value.teacherName, invalidSource, 512),
    classroomCatalogId: uuidValue(value.classroomCatalogId, invalidSource),
    classroomName: stringValue(value.classroomName, invalidSource, 512),
    campus: value.campus,
    sourceRevision,
    bookingFactHash,
    directorProfileId: nullableUuidValue(value.directorProfileId, invalidSource),
  })
}

export function parseRegistrationObservationChatPayloadV3(
  value: unknown,
): RegistrationObservationChatPayloadV3 {
  if (!isRecord(value) || typeof value.event_kind !== "string") invalidPayload()
  const eventKeys: Record<string, ReadonlyArray<string>> = {
    "registration.observation_scheduled": ["booking", "progress_summary", "textbook_names"],
    "registration.observation_rescheduled": ["booking", "previous_booking", "progress_summary", "textbook_names"],
    "registration.observation_canceled": ["canceled_booking"],
    "registration.observation_reminder_due": ["booking", "progress_summary", "textbook_names"],
    "registration.observation_feedback_due": ["booking"],
    "registration.observation_feedback_submitted": ["booking", "submitted_at", "submitted_by_name"],
    "registration.observation_director_reassigned": [
      "assignment_fact_id", "booking", "director_profile_ids", "previous_director_profile_ids",
    ],
  }
  const eventSpecific = eventKeys[value.event_kind]
  if (!eventSpecific) invalidPayload()
  exactKeys(value, [...PAYLOAD_BASE_KEYS, ...eventSpecific], invalidPayload)
  const sourceRevision = sourceRevisionValue(value.source_revision, invalidPayload)
  const bookingHash = stringValue(value.booking_fact_hash, invalidPayload, 64)
  if (!HASH_PATTERN.test(bookingHash)) invalidPayload()
  if (!SUBJECTS.has(String(value.subject))) invalidPayload()
  if (value.mention_role !== "subject_teacher" && value.mention_role !== "track_director") invalidPayload()
  const mentionProfileIds = canonicalUuidArray(value.mention_profile_ids, invalidPayload)
  const base = {
    task_id: uuidValue(value.task_id, invalidPayload),
    track_id: uuidValue(value.track_id, invalidPayload),
    observation_id: uuidValue(value.observation_id, invalidPayload),
    appointment_id: uuidValue(value.appointment_id, invalidPayload),
    appointment_notification_revision: positiveInteger(value.appointment_notification_revision, invalidPayload),
    student_name: stringValue(value.student_name, invalidPayload, 512),
    subject: value.subject as RegistrationObservationChatPayloadV3["subject"],
    source_revision: sourceRevision,
    booking_fact_hash: bookingHash,
    occurred_at: timestampValue(value.occurred_at, invalidPayload),
    delivery_expires_at: timestampValue(value.delivery_expires_at, invalidPayload),
    mention_role: value.mention_role,
    mention_profile_ids: mentionProfileIds,
  } as const
  if (Date.parse(base.delivery_expires_at) <= Date.parse(base.occurred_at)) invalidPayload()
  const subjectEvent = ![
    "registration.observation_feedback_submitted",
    "registration.observation_director_reassigned",
  ].includes(value.event_kind)
  if ((subjectEvent && base.mention_role !== "subject_teacher") || (!subjectEvent && base.mention_role !== "track_director")) {
    invalidPayload()
  }
  if (value.event_kind === "registration.observation_scheduled") {
    const parsedBooking = sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.booking))
    return Object.freeze({
      ...base,
      event_kind: value.event_kind,
      booking: parsedBooking,
      textbook_names: stringArray(value.textbook_names, invalidPayload),
      progress_summary: stringValue(value.progress_summary, invalidPayload),
    })
  }
  if (value.event_kind === "registration.observation_rescheduled") {
    const parsedBooking = sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.booking))
    return Object.freeze({
      ...base,
      event_kind: value.event_kind,
      previous_booking: bookingValue(value.previous_booking),
      booking: parsedBooking,
      textbook_names: stringArray(value.textbook_names, invalidPayload),
      progress_summary: stringValue(value.progress_summary, invalidPayload),
    })
  }
  if (value.event_kind === "registration.observation_canceled") {
    return Object.freeze({
      ...base,
      event_kind: value.event_kind,
      canceled_booking: sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.canceled_booking)),
    })
  }
  if (value.event_kind === "registration.observation_reminder_due") {
    const parsedBooking = sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.booking))
    return Object.freeze({
      ...base,
      event_kind: value.event_kind,
      booking: parsedBooking,
      textbook_names: stringArray(value.textbook_names, invalidPayload),
      progress_summary: stringValue(value.progress_summary, invalidPayload),
    })
  }
  if (value.event_kind === "registration.observation_feedback_due") {
    return Object.freeze({
      ...base,
      event_kind: value.event_kind,
      booking: sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.booking)),
    })
  }
  if (value.event_kind === "registration.observation_feedback_submitted") {
    const parsedBooking = sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.booking))
    return Object.freeze({
      ...base,
      event_kind: value.event_kind,
      booking: parsedBooking,
      submitted_by_name: stringValue(value.submitted_by_name, invalidPayload, 512),
      submitted_at: timestampValue(value.submitted_at, invalidPayload),
    })
  }
  const previousDirectorProfileIds = canonicalUuidArray(value.previous_director_profile_ids, invalidPayload)
  const directorProfileIds = canonicalUuidArray(value.director_profile_ids, invalidPayload)
  const combined = [...new Set([...previousDirectorProfileIds, ...directorProfileIds])].sort()
  if (combined.length !== mentionProfileIds.length || combined.some((item, index) => item !== mentionProfileIds[index])) {
    invalidPayload()
  }
  return Object.freeze({
    ...base,
    event_kind: "registration.observation_director_reassigned",
    assignment_fact_id: uuidValue(value.assignment_fact_id, invalidPayload),
    booking: sourceRevisionMatchesBooking(sourceRevision, bookingValue(value.booking)),
    previous_director_profile_ids: previousDirectorProfileIds,
    director_profile_ids: directorProfileIds,
  })
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : invalidSource()
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function planComponents(entry: JsonRecord) {
  const plan = isRecord(entry.plan)
    ? optionalText(entry.plan.label)
    : optionalText(entry.plan) ?? optionalText(entry.planLabel)
  const memo = (isRecord(entry.plan) ? optionalText(entry.plan.memo) : null) ?? optionalText(entry.memo)
  return [plan, memo].filter((item): item is string => item !== null)
}

export function resolveRegistrationObservationPreparation(
  input: RegistrationObservationPreparationInput,
): RegistrationObservationPreparation {
  if (!input || !isRecord(input.source) || !isRecord(input.selectedSession)) invalidSource()
  if (!Array.isArray(input.exactProgressLogs) || !Array.isArray(input.rejectedProgressLogs) || !Array.isArray(input.classTextbooks)) {
    invalidSource()
  }
  const selected = input.selectedSession
  const entries = Array.isArray(selected.textbookEntries)
    ? selected.textbookEntries.map(recordValue)
    : []
  const catalogs = new Map(input.classTextbooks.map(recordValue).map((book) => [
    optionalText(book.id),
    optionalText(book.title) ?? optionalText(book.name),
  ]))
  const textbookNames = entries.map((entry, index) => (
    catalogs.get(optionalText(entry.textbookId))
    ?? optionalText(entry.title)
    ?? optionalText(entry.textbookTitle)
    ?? `교재 ${index + 1}`
  ))
  const stableNames = textbookNames.length > 0 ? textbookNames : ["미지정"]
  const planned = entries.flatMap(planComponents)
  const exactProgress = input.exactProgressLogs.map(recordValue).flatMap((log) => [
    optionalText(log.rangeLabel ?? log.range_label ?? log.content),
    optionalText(log.publicNote ?? log.public_note),
  ]).filter((item): item is string => item !== null)
  const selectedFallback = [
    optionalText(selected.memo),
    optionalText(selected.publicNote ?? selected.public_note),
  ].filter((item): item is string => item !== null)
  const progressSummary = (planned.length > 0
    ? planned
    : exactProgress.length > 0
      ? exactProgress
      : selectedFallback.length > 0
        ? selectedFallback
        : ["미입력"]).join(" · ")
  return Object.freeze({
    textbookNames: Object.freeze(stableNames),
    progressSummary,
  })
}

function exactSelectedSession(schedulePlan: JsonRecord, sessionKey: string, allowMissing: boolean) {
  const sessions = Array.isArray(schedulePlan.sessions)
    ? schedulePlan.sessions
    : Array.isArray(schedulePlan.session_list)
      ? schedulePlan.session_list
      : []
  const matches = sessions.filter(isRecord).filter((session) => (
    [session.sessionKey, session.session_key, session.id].some((value) => optionalText(value) === sessionKey)
  ))
  if (matches.length > 1 || (!allowMissing && matches.length !== 1)) invalidSource()
  return matches[0] ?? Object.freeze({ sessionKey, textbookEntries: [] })
}

async function executeQuery(query: RegistrationObservationQuery) {
  const result = await query.abortSignal(AbortSignal.timeout(5_000)).retry(false)
  if (!result) unavailableSource()
  if (result.error) {
    if (transientSourceError(result.error)) unavailableSource()
    invalidSource()
  }
  return result.data
}

export function createRegistrationObservationNotificationSourceReader(
  dependencies: RegistrationObservationNotificationSourceDependencies,
): RegistrationObservationNotificationSourceReader {
  if (!dependencies || typeof dependencies.getClient !== "function") invalidSource()
  return Object.freeze({
    async readSource(observationId) {
      const id = uuidValue(observationId, invalidSource)
      const client = await dependencies.getClient()
      const data = await executeQuery(client.rpc(
        "get_registration_observation_notification_source_v1",
        { p_observation_id: id },
      ))
      return parseRegistrationObservationNotificationSource(data)
    },
    async readCurrentPreparation(rawSource) {
      const source = parseRegistrationObservationNotificationSource(rawSource)
      const client = await dependencies.getClient()
      let lesson: JsonRecord | null = null
      let sessionKey = source.legacySessionKey
      if (source.sessionAuthority === "normalized") {
        const lessonData = await executeQuery(client.from("class_lesson_sessions")
          .select("id,class_id,session_key,revision,memo,public_note")
          .eq("id", source.classLessonSessionId)
          .eq("class_id", source.classId)
          .maybeSingle())
        lesson = recordValue(lessonData)
        if (uuidValue(lesson.id, invalidSource) !== source.classLessonSessionId
          || uuidValue(lesson.class_id, invalidSource) !== source.classId) invalidSource()
        const lessonRevision = Number(lesson.revision)
        if (
          source.sourceRevision.authority !== "normalized"
          || !Number.isInteger(lessonRevision)
          || lessonRevision !== source.sourceRevision.revision
        ) invalidSource()
        sessionKey = stringValue(lesson.session_key, invalidSource, 512)
      }
      if (!sessionKey) invalidSource()
      const classData = recordValue(await executeQuery(client.from("classes")
        .select("id,schedule_storage_mode,schedule_plan")
        .eq("id", source.classId)
        .maybeSingle()))
      if (uuidValue(classData.id, invalidSource) !== source.classId || !isRecord(classData.schedule_plan)) invalidSource()
      const storageMode = optionalText(classData.schedule_storage_mode)
      if (
        (source.sessionAuthority === "normalized" && storageMode !== "normalized")
        || (source.sessionAuthority === "legacy" && !["legacy", "shadow"].includes(storageMode ?? ""))
      ) invalidSource()
      const selectedSession = exactSelectedSession(
        classData.schedule_plan,
        sessionKey,
        source.sessionAuthority === "normalized",
      )
      const sessionOrder = Number(selectedSession.sessionOrder ?? selectedSession.session_order)
      const sessionIds = [...new Set([sessionKey, source.classLessonSessionId].filter(
        (value): value is string => value !== null,
      ))]
      const bySessionId = executeQuery(client.from("progress_logs")
        .select("id,class_id,session_id,session_order,range_label,content,public_note,updated_at")
        .eq("class_id", source.classId)
        .in("session_id", sessionIds)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(64))
      const bySessionOrder = Number.isInteger(sessionOrder)
        ? executeQuery(client.from("progress_logs")
          .select("id,class_id,session_id,session_order,range_label,content,public_note,updated_at")
          .eq("class_id", source.classId)
          .eq("session_order", sessionOrder)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(64))
        : Promise.resolve([])
      const [bySessionIdData, bySessionOrderData] = await Promise.all([bySessionId, bySessionOrder])
      if (!Array.isArray(bySessionIdData) || !Array.isArray(bySessionOrderData)) invalidSource()
      const progressById = new Map<string, JsonRecord>()
      for (const row of [...bySessionIdData, ...bySessionOrderData].filter(isRecord)) {
        const key = optionalText(row.id) ?? JSON.stringify(row)
        if (!progressById.has(key)) progressById.set(key, row)
      }
      const progressData = [...progressById.values()]
      const exactProgressLogs = progressData.filter((log) => (
        log.class_id === source.classId
        && (
          log.session_id === sessionKey
          || log.session_id === source.classLessonSessionId
          || (Number.isInteger(sessionOrder) && log.session_order === sessionOrder)
        )
      )).sort((left, right) => (
        (optionalText(right.updated_at) ?? "").localeCompare(optionalText(left.updated_at) ?? "")
        || (optionalText(right.id) ?? "").localeCompare(optionalText(left.id) ?? "")
      )).slice(0, 1)
      const rejectedProgressLogs = progressData.filter((log) => !exactProgressLogs.includes(log))
      const entries = Array.isArray(selectedSession.textbookEntries)
        ? selectedSession.textbookEntries.filter(isRecord)
        : []
      const textbookIds = [...new Set(entries.map((entry) => optionalText(entry.textbookId)).filter(
        (value): value is string => value !== null,
      ))]
      const allowedIds = new Set(textbookIds)
      const classTextbooks = (Array.isArray(classData.schedule_plan.textbooks)
        ? classData.schedule_plan.textbooks
        : []).filter(isRecord).filter((book) => allowedIds.has(String(book.textbookId ?? book.id))).map((book) => ({
          id: book.textbookId ?? book.id,
          title: book.title ?? book.name,
        }))
      const mergedSelected = lesson
        ? { ...selectedSession, memo: selectedSession.memo ?? lesson.memo, publicNote: selectedSession.publicNote ?? lesson.public_note }
        : selectedSession
      return resolveRegistrationObservationPreparation({
        source,
        selectedSession: mergedSelected,
        exactProgressLogs,
        rejectedProgressLogs,
        classTextbooks,
      })
    },
  })
}
