export type RegistrationObservationWorkflowStatus =
  | "observation_requested"
  | "observation_feedback_pending"
  | "observation_completed"

export type RegistrationObservationTrackWorkflowStatus =
  | "inquiry"
  | "level_test_requested"
  | "consultation_requested"
  | "consultation_completed"
  | "waiting_current_class"
  | "waiting_new_class"
  | "waiting_next_opening"
  | "observation_requested"
  | "observation_feedback_pending"
  | "observation_completed"
  | "enrollment_requested"
  | "payment_in_progress"
  | "registered"
  | "not_registered"
  | "inquiry_only"

export type RegistrationObservationStatus =
  | "scheduled"
  | "attended_feedback_pending"
  | "completed"
  | "no_show"
  | "canceled"

export type RegistrationObservationSessionAuthority = "normalized" | "legacy"

export type RegistrationObservationDecisionKind =
  | "enrollment"
  | "waiting_current_class"
  | "waiting_new_class"
  | "waiting_next_opening"
  | "not_registered"
  | "re_observation"

export type RegistrationObservationSourceRevision =
  | { authority: "normalized"; sessionId: string; revision: number }
  | { authority: "legacy"; sessionKey: string; contentHash: string }

export type RegistrationObservationRuntimeState = Readonly<{
  runtimeVersion: 0 | 1
  available: boolean
}>

export type RegistrationObservationSchemaReadiness = Readonly<{
  schemaReady: boolean
  missingObjects: readonly string[]
  runtimeVersion: 0 | 1
}>

export type RegistrationObservationTextbookSnapshot = Readonly<{
  textbookId: string | null
  title: string
  planLabel: string
  memo: string
}>

export type RegistrationObservationSessionSource =
  | Readonly<{
      sessionAuthority: "normalized"
      classLessonSessionId: string
      legacySessionKey: null
      sessionKey: string
      sessionSourceRevision: number
      legacySessionSourceHash: null
      sourceRevision: Readonly<{ authority: "normalized"; sessionId: string; revision: number }>
    }>
  | Readonly<{
      sessionAuthority: "legacy"
      classLessonSessionId: null
      legacySessionKey: string
      sessionKey: string
      sessionSourceRevision: null
      legacySessionSourceHash: string
      sourceRevision: Readonly<{ authority: "legacy"; sessionKey: string; contentHash: string }>
    }>

export type RegistrationObservationSessionOption = Readonly<{
  classId: string
  subject: "영어" | "수학" | "과학"
  scheduleState: "active" | "makeup"
  sessionDate: string
  startsAt: string
  endsAt: string
  teacherCatalogId: string
  teacherProfileId: string
  teacherName: string
  classroomCatalogId: string
  classroomName: string
  campus: "본관" | "별관"
  className: string
  textbooks: readonly RegistrationObservationTextbookSnapshot[]
  progress: string
  bookingFactHash: string
} & RegistrationObservationSessionSource>

export type RegistrationObservationAttempt = Readonly<{
  observationId: string
  taskId: string
  trackId: string
  appointmentId: string
  appointmentStatus: "scheduled" | "completed" | "canceled"
  classId: string
  subject: "영어" | "수학" | "과학"
  className: string
  scheduleState: "active" | "makeup"
  sessionDate: string
  startsAt: string
  endsAt: string
  teacherCatalogId: string
  teacherProfileId: string
  teacherName: string
  classroomCatalogId: string
  classroomName: string
  campus: "본관" | "별관"
  textbooks: readonly RegistrationObservationTextbookSnapshot[]
  progress: string
  bookingFactHash: string
  status: RegistrationObservationStatus
  attendance: "attended" | "no_show" | null
  suitabilityResult: "fit" | "unfit" | null
  decisionKind: RegistrationObservationDecisionKind | null
  revision: number
  feedbackRevision: number
  appointmentNotificationRevision: number
  createdAt: string
  updatedAt: string
} & RegistrationObservationSessionSource>

export type RegistrationObservationManagerDetail = Readonly<{
  track: Readonly<{
    trackId: string
    taskId: string
    subject: "영어" | "수학" | "과학"
    workflowStatus: RegistrationObservationTrackWorkflowStatus
    workflowRevision: number
    observationReturnWorkflowStatus:
      | "consultation_completed"
      | "waiting_current_class"
      | "waiting_new_class"
      | "waiting_next_opening"
      | null
    directorProfileId: string | null
  }>
  currentObservation: RegistrationObservationAttempt | null
  latestEnrollmentDecisionObservationId: string | null
  latestDecisionObservation: null | Readonly<{
    observationId: string
    decisionKind: RegistrationObservationDecisionKind
    observationRevision: number
    feedbackRevision: number
  }>
  attempts: readonly RegistrationObservationAttempt[]
  classes: readonly Readonly<{ id: string; name: string; subject: "영어" | "수학" | "과학" }>[]
}>

export type RegistrationObservationManagerAttemptDetail = Readonly<{
  trackId: string
  taskId: string
  observation: RegistrationObservationAttempt
}>

export type RegistrationObservationAppointmentSnapshot = Readonly<{
  appointmentId: string
  status: "scheduled" | "completed" | "canceled"
  scheduledAt: string
  place: "본관" | "별관"
  notificationRevision: number
}>

export type RegistrationObservationMutationResult = Readonly<{
  operation: "enter" | "book" | "reschedule" | "cancel" | "withdraw"
  requestKey: string
  trackId: string
  workflowStatus: RegistrationObservationTrackWorkflowStatus
  workflowRevision: number
  observation: RegistrationObservationAttempt | null
  appointment: RegistrationObservationAppointmentSnapshot | null
  changed: boolean
}>

export type RegistrationObservationSummary = Readonly<{
  observationAttemptCount: number
  observationCurrentId: string | null
  observationCurrentStatus: RegistrationObservationStatus | null
  observationCurrentAppointmentId: string | null
  observationNearestScheduledAt: string | null
  observationNearestPlace: "본관" | "별관" | null
  observationNotificationRevision: number | null
  observationRevision: number | null
  observationFeedbackRevision: number | null
}>

export type RegistrationObservationActivationResult = Readonly<{
  operation: "activate"
  requestKey: string
  previousVersion: 0
  runtimeVersion: 1
  readiness: RegistrationObservationSchemaReadiness
}>

type JsonObject = Record<string, unknown>

const SUBJECTS = ["영어", "수학", "과학"] as const
const SCHEDULE_STATES = ["active", "makeup"] as const
const CAMPUSES = ["본관", "별관"] as const
const APPOINTMENT_STATUSES = ["scheduled", "completed", "canceled"] as const
const OBSERVATION_STATUSES = [
  "scheduled",
  "attended_feedback_pending",
  "completed",
  "no_show",
  "canceled",
] as const
const ATTENDANCE_VALUES = ["attended", "no_show"] as const
const SUITABILITY_VALUES = ["fit", "unfit"] as const
const DECISION_KINDS = [
  "enrollment",
  "waiting_current_class",
  "waiting_new_class",
  "waiting_next_opening",
  "not_registered",
  "re_observation",
] as const
const TRACK_WORKFLOW_STATUSES = [
  "inquiry",
  "level_test_requested",
  "consultation_requested",
  "consultation_completed",
  "waiting_current_class",
  "waiting_new_class",
  "waiting_next_opening",
  "observation_requested",
  "observation_feedback_pending",
  "observation_completed",
  "enrollment_requested",
  "payment_in_progress",
  "registered",
  "not_registered",
  "inquiry_only",
] as const
const OBSERVATION_RETURN_STATUSES = [
  "consultation_completed",
  "waiting_current_class",
  "waiting_new_class",
  "waiting_next_opening",
] as const

const SESSION_SOURCE_KEYS = [
  "sessionAuthority",
  "classLessonSessionId",
  "legacySessionKey",
  "sessionKey",
  "sessionSourceRevision",
  "legacySessionSourceHash",
  "sourceRevision",
] as const
const SESSION_OPTION_KEYS = [
  "classId",
  "subject",
  "scheduleState",
  "sessionDate",
  "startsAt",
  "endsAt",
  "teacherCatalogId",
  "teacherProfileId",
  "teacherName",
  "classroomCatalogId",
  "classroomName",
  "campus",
  "className",
  "textbooks",
  "progress",
  "bookingFactHash",
  ...SESSION_SOURCE_KEYS,
] as const
const ATTEMPT_KEYS = [
  "observationId",
  "taskId",
  "trackId",
  "appointmentId",
  "appointmentStatus",
  "classId",
  "subject",
  "className",
  "scheduleState",
  "sessionDate",
  "startsAt",
  "endsAt",
  "teacherCatalogId",
  "teacherProfileId",
  "teacherName",
  "classroomCatalogId",
  "classroomName",
  "campus",
  "textbooks",
  "progress",
  "bookingFactHash",
  "status",
  "attendance",
  "suitabilityResult",
  "decisionKind",
  "revision",
  "feedbackRevision",
  "appointmentNotificationRevision",
  "createdAt",
  "updatedAt",
  ...SESSION_SOURCE_KEYS,
] as const
const SUMMARY_KEYS = [
  "observationAttemptCount",
  "observationCurrentId",
  "observationCurrentStatus",
  "observationCurrentAppointmentId",
  "observationNearestScheduledAt",
  "observationNearestPlace",
  "observationNotificationRevision",
  "observationRevision",
  "observationFeedbackRevision",
] as const

export const EMPTY_REGISTRATION_OBSERVATION_SUMMARY: RegistrationObservationSummary = Object.freeze({
  observationAttemptCount: 0,
  observationCurrentId: null,
  observationCurrentStatus: null,
  observationCurrentAppointmentId: null,
  observationNearestScheduledAt: null,
  observationNearestPlace: null,
  observationNotificationRevision: null,
  observationRevision: null,
  observationFeedbackRevision: null,
})

function invalid(scope: string): never {
  throw new Error(`registration_observation_${scope}_invalid`)
}

function objectValue(input: unknown, scope: string): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid(scope)
  return input as JsonObject
}

function exactObject(input: unknown, keys: readonly string[], scope: string): JsonObject {
  const value = objectValue(input, scope)
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...keys].sort()
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) invalid(scope)
  return value
}

function enumValue<const T extends readonly string[]>(
  input: unknown,
  values: T,
  scope: string,
): T[number] {
  if (typeof input !== "string" || !values.includes(input as T[number])) invalid(scope)
  return input as T[number]
}

function nonblank(input: unknown, scope: string): string {
  if (typeof input !== "string" || input.trim().length === 0) invalid(scope)
  return input
}

function stringValue(input: unknown, scope: string): string {
  if (typeof input !== "string") invalid(scope)
  return input
}

function uuid(input: unknown, scope: string): string {
  const value = nonblank(input, scope)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    invalid(scope)
  }
  return value
}

function nullableUuid(input: unknown, scope: string): string | null {
  return input === null ? null : uuid(input, scope)
}

function revision(input: unknown, scope: string): number {
  if (!Number.isFinite(input) || !Number.isInteger(input) || Number(input) < 0) invalid(scope)
  return Number(input)
}

function nullableRevision(input: unknown, scope: string): number | null {
  return input === null ? null : revision(input, scope)
}

function dateValue(input: unknown, scope: string): string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) invalid(scope)
  const [year, month, day] = input.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) invalid(scope)
  return input
}

function timestamp(input: unknown, scope: string): string {
  if (
    typeof input !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input)
    || !Number.isFinite(Date.parse(input))
  ) invalid(scope)
  dateValue(input.slice(0, 10), scope)
  return input
}

function nullableTimestamp(input: unknown, scope: string): string | null {
  return input === null ? null : timestamp(input, scope)
}

function nullableEnum<const T extends readonly string[]>(
  input: unknown,
  values: T,
  scope: string,
): T[number] | null {
  return input === null ? null : enumValue(input, values, scope)
}

function normalizeTextbook(input: unknown): RegistrationObservationTextbookSnapshot {
  const row = exactObject(input, ["textbookId", "title", "planLabel", "memo"], "textbook_snapshot")
  return {
    textbookId: nullableUuid(row.textbookId, "textbook_snapshot"),
    title: nonblank(row.title, "textbook_snapshot"),
    planLabel: stringValue(row.planLabel, "textbook_snapshot"),
    memo: stringValue(row.memo, "textbook_snapshot"),
  }
}

function normalizeTextbooks(input: unknown): readonly RegistrationObservationTextbookSnapshot[] {
  if (!Array.isArray(input)) invalid("textbook_snapshot")
  return input.map(normalizeTextbook)
}

function normalizeSessionSource(
  row: JsonObject,
  scope: string,
): RegistrationObservationSessionSource {
  const authority = enumValue(row.sessionAuthority, ["normalized", "legacy"] as const, scope)
  const sessionKey = nonblank(row.sessionKey, scope)
  const sourceRevision = objectValue(row.sourceRevision, scope)

  if (authority === "normalized") {
    const classLessonSessionId = uuid(row.classLessonSessionId, scope)
    const sessionSourceRevision = revision(row.sessionSourceRevision, scope)
    const normalizedRevision = exactObject(
      sourceRevision,
      ["authority", "sessionId", "revision"],
      scope,
    )
    if (
      row.legacySessionKey !== null
      || row.legacySessionSourceHash !== null
      || normalizedRevision.authority !== "normalized"
      || uuid(normalizedRevision.sessionId, scope) !== classLessonSessionId
      || revision(normalizedRevision.revision, scope) !== sessionSourceRevision
    ) invalid(scope)
    return {
      sessionAuthority: authority,
      classLessonSessionId,
      legacySessionKey: null,
      sessionKey,
      sessionSourceRevision,
      legacySessionSourceHash: null,
      sourceRevision: {
        authority: "normalized",
        sessionId: classLessonSessionId,
        revision: sessionSourceRevision,
      },
    }
  }

  const legacySessionKey = nonblank(row.legacySessionKey, scope)
  const legacySessionSourceHash = nonblank(row.legacySessionSourceHash, scope)
  const legacyRevision = exactObject(
    sourceRevision,
    ["authority", "sessionKey", "contentHash"],
    scope,
  )
  if (
    row.classLessonSessionId !== null
    || row.sessionSourceRevision !== null
    || sessionKey !== legacySessionKey
    || legacyRevision.authority !== "legacy"
    || nonblank(legacyRevision.sessionKey, scope) !== legacySessionKey
    || nonblank(legacyRevision.contentHash, scope) !== legacySessionSourceHash
  ) invalid(scope)
  return {
    sessionAuthority: authority,
    classLessonSessionId: null,
    legacySessionKey,
    sessionKey,
    sessionSourceRevision: null,
    legacySessionSourceHash,
    sourceRevision: {
      authority: "legacy",
      sessionKey: legacySessionKey,
      contentHash: legacySessionSourceHash,
    },
  }
}

function normalizeSessionFields(
  row: JsonObject,
  scope: string,
): RegistrationObservationSessionOption {
  const startsAt = timestamp(row.startsAt, scope)
  const endsAt = timestamp(row.endsAt, scope)
  if (Date.parse(startsAt) >= Date.parse(endsAt)) invalid(scope)
  return {
    classId: uuid(row.classId, scope),
    subject: enumValue(row.subject, SUBJECTS, scope),
    scheduleState: enumValue(row.scheduleState, SCHEDULE_STATES, scope),
    sessionDate: dateValue(row.sessionDate, scope),
    startsAt,
    endsAt,
    teacherCatalogId: uuid(row.teacherCatalogId, scope),
    teacherProfileId: uuid(row.teacherProfileId, scope),
    teacherName: nonblank(row.teacherName, scope),
    classroomCatalogId: uuid(row.classroomCatalogId, scope),
    classroomName: nonblank(row.classroomName, scope),
    campus: enumValue(row.campus, CAMPUSES, scope),
    className: nonblank(row.className, scope),
    textbooks: normalizeTextbooks(row.textbooks),
    progress: nonblank(row.progress, scope),
    bookingFactHash: nonblank(row.bookingFactHash, scope),
    ...normalizeSessionSource(row, scope),
  }
}

export function normalizeRegistrationObservationSessionOption(
  input: unknown,
): RegistrationObservationSessionOption {
  const row = exactObject(input, SESSION_OPTION_KEYS, "session_option")
  return normalizeSessionFields(row, "session_option")
}

export function normalizeRegistrationObservationSessionOptions(
  input: unknown,
): readonly RegistrationObservationSessionOption[] {
  if (!Array.isArray(input)) invalid("session_options")
  return input.map(normalizeRegistrationObservationSessionOption)
}

export function normalizeRegistrationObservationAttempt(
  input: unknown,
): RegistrationObservationAttempt {
  const row = exactObject(input, ATTEMPT_KEYS, "attempt")
  return {
    observationId: uuid(row.observationId, "attempt"),
    taskId: uuid(row.taskId, "attempt"),
    trackId: uuid(row.trackId, "attempt"),
    appointmentId: uuid(row.appointmentId, "attempt"),
    appointmentStatus: enumValue(row.appointmentStatus, APPOINTMENT_STATUSES, "attempt"),
    ...normalizeSessionFields(row, "attempt"),
    status: enumValue(row.status, OBSERVATION_STATUSES, "attempt"),
    attendance: nullableEnum(row.attendance, ATTENDANCE_VALUES, "attempt"),
    suitabilityResult: nullableEnum(row.suitabilityResult, SUITABILITY_VALUES, "attempt"),
    decisionKind: nullableEnum(row.decisionKind, DECISION_KINDS, "attempt"),
    revision: revision(row.revision, "attempt"),
    feedbackRevision: revision(row.feedbackRevision, "attempt"),
    appointmentNotificationRevision: revision(row.appointmentNotificationRevision, "attempt"),
    createdAt: timestamp(row.createdAt, "attempt"),
    updatedAt: timestamp(row.updatedAt, "attempt"),
  }
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function normalizeRegistrationObservationManagerDetail(
  input: unknown,
): RegistrationObservationManagerDetail {
  const row = exactObject(
    input,
    [
      "track",
      "currentObservation",
      "latestEnrollmentDecisionObservationId",
      "latestDecisionObservation",
      "attempts",
      "classes",
    ],
    "manager_detail",
  )
  const trackRow = exactObject(row.track, [
    "trackId",
    "taskId",
    "subject",
    "workflowStatus",
    "workflowRevision",
    "observationReturnWorkflowStatus",
    "directorProfileId",
  ], "manager_detail")
  const track = {
    trackId: uuid(trackRow.trackId, "manager_detail"),
    taskId: uuid(trackRow.taskId, "manager_detail"),
    subject: enumValue(trackRow.subject, SUBJECTS, "manager_detail"),
    workflowStatus: enumValue(trackRow.workflowStatus, TRACK_WORKFLOW_STATUSES, "manager_detail"),
    workflowRevision: revision(trackRow.workflowRevision, "manager_detail"),
    observationReturnWorkflowStatus: nullableEnum(
      trackRow.observationReturnWorkflowStatus,
      OBSERVATION_RETURN_STATUSES,
      "manager_detail",
    ),
    directorProfileId: nullableUuid(trackRow.directorProfileId, "manager_detail"),
  } as const
  if (!Array.isArray(row.attempts)) invalid("manager_detail")
  const attempts = row.attempts.map(normalizeRegistrationObservationAttempt)
  const seenAttemptIds = new Set<string>()
  for (const attempt of attempts) {
    if (
      attempt.trackId !== track.trackId
      || attempt.taskId !== track.taskId
      || seenAttemptIds.has(attempt.observationId)
    ) invalid("manager_detail")
    seenAttemptIds.add(attempt.observationId)
  }
  const currentObservation = row.currentObservation === null
    ? null
    : normalizeRegistrationObservationAttempt(row.currentObservation)
  if (currentObservation) {
    const matchingAttempt = attempts.find(
      (attempt) => attempt.observationId === currentObservation.observationId,
    )
    if (!matchingAttempt || !sameJson(matchingAttempt, currentObservation)) invalid("manager_detail")
  }
  const latestEnrollmentDecisionObservationId = nullableUuid(
    row.latestEnrollmentDecisionObservationId,
    "manager_detail",
  )
  const latestDecisionObservation = row.latestDecisionObservation === null
    ? null
    : (() => {
        const decision = exactObject(row.latestDecisionObservation, [
          "observationId",
          "decisionKind",
          "observationRevision",
          "feedbackRevision",
        ], "manager_detail")
        return {
          observationId: uuid(decision.observationId, "manager_detail"),
          decisionKind: enumValue(decision.decisionKind, DECISION_KINDS, "manager_detail"),
          observationRevision: revision(decision.observationRevision, "manager_detail"),
          feedbackRevision: revision(decision.feedbackRevision, "manager_detail"),
        } as const
      })()
  if (!Array.isArray(row.classes)) invalid("manager_detail")
  const classes = row.classes.map((item) => {
    const classRow = exactObject(item, ["id", "name", "subject"], "manager_detail")
    const classSubject = enumValue(classRow.subject, SUBJECTS, "manager_detail")
    if (classSubject !== track.subject) invalid("manager_detail")
    return {
      id: uuid(classRow.id, "manager_detail"),
      name: nonblank(classRow.name, "manager_detail"),
      subject: classSubject,
    }
  })
  return {
    track,
    currentObservation,
    latestEnrollmentDecisionObservationId,
    latestDecisionObservation,
    attempts,
    classes,
  }
}

export function normalizeRegistrationObservationManagerAttemptDetail(
  input: unknown,
): RegistrationObservationManagerAttemptDetail {
  const row = exactObject(input, ["trackId", "taskId", "observation"], "manager_attempt")
  const trackId = uuid(row.trackId, "manager_attempt")
  const taskId = uuid(row.taskId, "manager_attempt")
  const observation = normalizeRegistrationObservationAttempt(row.observation)
  if (observation.trackId !== trackId || observation.taskId !== taskId) invalid("manager_attempt")
  return { trackId, taskId, observation }
}

export function normalizeRegistrationObservationSchemaReadiness(
  input: unknown,
): RegistrationObservationSchemaReadiness {
  const row = exactObject(
    input,
    ["schemaReady", "missingObjects", "runtimeVersion"],
    "schema_readiness",
  )
  if (typeof row.schemaReady !== "boolean" || !Array.isArray(row.missingObjects)) {
    invalid("schema_readiness")
  }
  const missingObjects = row.missingObjects.map((item) => nonblank(item, "schema_readiness"))
  if (new Set(missingObjects).size !== missingObjects.length) invalid("schema_readiness")
  const normalizedRuntimeVersion = runtimeVersion(row.runtimeVersion, "schema_readiness")
  return {
    schemaReady: row.schemaReady,
    missingObjects,
    runtimeVersion: normalizedRuntimeVersion,
  }
}

function runtimeVersion(input: unknown, scope: string): 0 | 1 {
  if (input !== 0 && input !== 1) invalid(scope)
  return input
}

export function normalizeRegistrationObservationRuntimeState(
  input: unknown,
): RegistrationObservationRuntimeState {
  const value = runtimeVersion(input, "runtime_payload")
  return { runtimeVersion: value, available: value === 1 }
}

export function normalizeRegistrationObservationAppointmentSnapshot(
  input: unknown,
): RegistrationObservationAppointmentSnapshot {
  const row = exactObject(
    input,
    ["appointmentId", "status", "scheduledAt", "place", "notificationRevision"],
    "appointment_snapshot",
  )
  return {
    appointmentId: uuid(row.appointmentId, "appointment_snapshot"),
    status: enumValue(row.status, APPOINTMENT_STATUSES, "appointment_snapshot"),
    scheduledAt: timestamp(row.scheduledAt, "appointment_snapshot"),
    place: enumValue(row.place, CAMPUSES, "appointment_snapshot"),
    notificationRevision: revision(row.notificationRevision, "appointment_snapshot"),
  }
}

export function normalizeRegistrationObservationMutationResult(
  input: unknown,
): RegistrationObservationMutationResult {
  const row = exactObject(input, [
    "operation",
    "requestKey",
    "trackId",
    "workflowStatus",
    "workflowRevision",
    "observation",
    "appointment",
    "changed",
  ], "mutation_result")
  const operation = enumValue(
    row.operation,
    ["enter", "book", "reschedule", "cancel", "withdraw"] as const,
    "mutation_result",
  )
  const trackId = uuid(row.trackId, "mutation_result")
  const observation = row.observation === null
    ? null
    : normalizeRegistrationObservationAttempt(row.observation)
  const appointment = row.appointment === null
    ? null
    : normalizeRegistrationObservationAppointmentSnapshot(row.appointment)
  if ((observation === null) !== (appointment === null)) invalid("mutation_result")
  if (observation && appointment) {
    if (
      observation.trackId !== trackId
      || observation.appointmentId !== appointment.appointmentId
      || observation.appointmentStatus !== appointment.status
      || observation.startsAt !== appointment.scheduledAt
      || observation.campus !== appointment.place
      || observation.appointmentNotificationRevision !== appointment.notificationRevision
    ) invalid("mutation_result")
  }
  if (operation === "enter" && (observation !== null || appointment !== null)) invalid("mutation_result")
  if (["book", "reschedule", "cancel"].includes(operation) && !observation) invalid("mutation_result")
  if (typeof row.changed !== "boolean") invalid("mutation_result")
  return {
    operation,
    requestKey: nonblank(row.requestKey, "mutation_result"),
    trackId,
    workflowStatus: enumValue(row.workflowStatus, TRACK_WORKFLOW_STATUSES, "mutation_result"),
    workflowRevision: revision(row.workflowRevision, "mutation_result"),
    observation,
    appointment,
    changed: row.changed,
  }
}

export function normalizeRegistrationObservationSummary(
  input: unknown,
): RegistrationObservationSummary {
  const row = exactObject(input, SUMMARY_KEYS, "summary")
  return {
    observationAttemptCount: revision(row.observationAttemptCount, "summary"),
    observationCurrentId: nullableUuid(row.observationCurrentId, "summary"),
    observationCurrentStatus: nullableEnum(row.observationCurrentStatus, OBSERVATION_STATUSES, "summary"),
    observationCurrentAppointmentId: nullableUuid(row.observationCurrentAppointmentId, "summary"),
    observationNearestScheduledAt: nullableTimestamp(row.observationNearestScheduledAt, "summary"),
    observationNearestPlace: nullableEnum(row.observationNearestPlace, CAMPUSES, "summary"),
    observationNotificationRevision: nullableRevision(row.observationNotificationRevision, "summary"),
    observationRevision: nullableRevision(row.observationRevision, "summary"),
    observationFeedbackRevision: nullableRevision(row.observationFeedbackRevision, "summary"),
  }
}

export function normalizeRegistrationObservationActivationResult(
  input: unknown,
): RegistrationObservationActivationResult {
  const row = exactObject(
    input,
    ["operation", "requestKey", "previousVersion", "runtimeVersion", "readiness"],
    "activation_result",
  )
  if (row.operation !== "activate" || row.previousVersion !== 0 || row.runtimeVersion !== 1) {
    invalid("activation_result")
  }
  return {
    operation: "activate",
    requestKey: nonblank(row.requestKey, "activation_result"),
    previousVersion: 0,
    runtimeVersion: 1,
    readiness: normalizeRegistrationObservationSchemaReadiness(row.readiness),
  }
}
