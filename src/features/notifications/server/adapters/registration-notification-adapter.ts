import { createHash } from "node:crypto"

import type {
  NotificationRenderContext,
  NotificationRenderInput,
  NotificationResolveInput,
  NotificationRevalidationInput,
  NotificationRevalidationResult,
  NotificationRuleSnapshot,
  NotificationTarget,
  NotificationTargetSet,
  NotificationWorkflowAdapter,
  RuleReconciliationBatch,
  RuleReconciliationInput,
  TargetReconciliationBatch,
  TargetReconciliationInput,
} from "../notification-workflow-adapter.ts"
import { renderObservationDestinationTeam } from "../../notification-google-chat-catalog.ts"
import type { NotificationConnectionKey } from "../../notification-google-chat-catalog.ts"
import type { ImmediateNotificationAdapterDependencies } from "./immediate-notification-adapter.ts"
import { immediateNotificationProductionDependencies } from "./immediate-notification-source-reader.ts"
import { buildRegistrationNotificationPresentation } from "../presentation/registration-notification-presentation.ts"
import {
  createRegistrationObservationNotificationSourceReader,
  parseRegistrationObservationChatPayloadV3,
} from "./registration-observation-notification-source.ts"
import type {
  ObservationBookingPresentationFact,
  RegistrationObservationChatPayloadV3,
  RegistrationObservationNotificationSource,
  RegistrationObservationNotificationSourceReader,
  RegistrationObservationPreparation,
  RegistrationObservationSessionSourceRevision,
  RegistrationObservationSupabaseClient,
} from "./registration-observation-notification-source.ts"
import {
  ACADEMIC_SUBJECT_VALUES,
  parseAcademicSubject,
} from "../../../../lib/academic-subject-registry.ts"
import type { AcademicSubjectValue } from "../../../../lib/academic-subject-registry.ts"

type RegistrationAppointmentKind = "level_test" | "visit_consultation"
type RegistrationAppointmentStatus = "scheduled" | "completed" | "canceled"
type RegistrationSubject = AcademicSubjectValue

export type RegistrationNotificationParticipant = Readonly<{
  trackId: string
  subject: RegistrationSubject
  directorProfileId: string | null
  directorName?: string | null
}>

export type RegistrationNotificationRule = NotificationRuleSnapshot & Readonly<{
  scheduleKey: "previous_day_at" | "same_day_at" | "offset_before"
  scheduleConfig: Readonly<Record<string, unknown>>
  enabled: boolean
}>

export type RegistrationNotificationSourceSnapshot = Readonly<{
  appointmentId: string
  taskId: string
  studentName: string
  kind: RegistrationAppointmentKind
  scheduledAt: string
  place: string
  status: RegistrationAppointmentStatus
  notificationRevision: number
  recipientRevision: string
  managementProfileIds: ReadonlyArray<string>
  directorProfileIds: ReadonlyArray<string>
  participants: ReadonlyArray<RegistrationNotificationParticipant>
  progressActor?: string | null
  currentRules: ReadonlyArray<RegistrationNotificationRule>
}>

export type RegistrationNotificationTargetItem = Readonly<{
  eventId: string
  rule: NotificationRuleSnapshot
  scheduledFor: string
}>

export type RegistrationNotificationPage<T> = Readonly<{
  items: ReadonlyArray<T>
  nextCursor: string | null
  done: boolean
}>

export type RegistrationNotificationAdapterDependencies = Readonly<{
  now: () => Date
  observationSourceReader?: RegistrationObservationNotificationSourceReader
  getSourceSnapshot(appointmentId: string): Promise<RegistrationNotificationSourceSnapshot | null>
  listScheduledSources(input: Readonly<{
    cursor: string | null
    batchSize: number
  }>): Promise<RegistrationNotificationPage<RegistrationNotificationSourceSnapshot>>
  listTargetItems(input: Readonly<{
    appointmentId: string
    cursor: string | null
    batchSize: number
  }>): Promise<RegistrationNotificationPage<RegistrationNotificationTargetItem>>
}>

export type RegistrationObservationChatJobClaim = Readonly<{
  jobId: string
  claimToken: string
  observationId: string
  appointmentId: string
  assignmentFactId: string | null
  notificationRevision: number
  eventKey: RegistrationObservationChatPayloadV3["event_kind"]
  dueAt: string
  expiresAt: string
  attemptCount: number
  sourceRevision: RegistrationObservationSessionSourceRevision
  bookingFactHash: string
  currentBookingSnapshot: Readonly<Record<string, unknown>>
  previousBookingSnapshot: Readonly<Record<string, unknown>> | null
  preparationSnapshot: RegistrationObservationPreparation | null
  submissionSnapshot: Readonly<Record<string, unknown>> | null
  mentionRole: "subject_teacher" | "track_director"
  mentionProfileIds: ReadonlyArray<string>
}>

type JsonRecord = Record<string, unknown>

const EVENT_KEY = "registration.appointment_reminder_due"
const SOURCE_TYPE = "registration_appointment"
const OBSERVATION_SOURCE_TYPE = "registration_observation"
const OBSERVATION_ASSIGNMENT_SOURCE_TYPE = "registration_observation_assignment_change"
const OBSERVATION_EVENTS = new Set<RegistrationObservationChatPayloadV3["event_kind"]>([
  "registration.observation_scheduled",
  "registration.observation_rescheduled",
  "registration.observation_canceled",
  "registration.observation_reminder_due",
  "registration.observation_feedback_due",
  "registration.observation_feedback_submitted",
  "registration.observation_director_reassigned",
])
const IMMEDIATE_CORE_EVENTS = new Set([
  "registration.case_created",
  "registration.inquiry_routed",
  "registration.director_assigned",
  "registration.phone_consultation_ready",
  "registration.level_test_scheduled",
  "registration.level_test_rescheduled",
  "registration.level_test_started",
  "registration.level_test_completed",
  "registration.level_test_absent",
  "registration.level_test_canceled",
  "registration.consultation_completed",
  "registration.waiting_transitioned",
  "registration.enrollment_decided",
  "registration.admission_started",
  "registration.admission_advanced",
  "registration.admission_canceled",
  "registration.registration_completed",
  "registration.case_closed",
  "registration.track_reopened",
])
const IMMEDIATE_VISIT_EVENTS = new Set([
  "registration.visit_scheduled",
  "registration.visit_rescheduled",
  "registration.visit_replaced",
  "registration.visit_subject_deselected",
  "registration.visit_canceled",
])
const IMMEDIATE_MESSAGE_EVENTS = new Set([
  "registration.admission_message_requested",
  "registration.admission_message_accepted",
  "registration.admission_message_failed",
  "registration.admission_message_unknown",
  "registration.admission_message_reconciled",
  "registration.admission_message_retry_released",
])
const PRESENTATION_EVENTS = new Set([
  "registration.case_created",
  "registration.consultation_completed",
  "registration.waiting_transitioned",
  "registration.admission_started",
  "registration.registration_completed",
  "registration.case_closed",
  "registration.appointment_reminder_due",
  "registration.phone_consultation_ready",
  ...IMMEDIATE_VISIT_EVENTS,
])
const SEOUL_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const POSITIVE_DECIMAL_PATTERN = /^[1-9]\d*$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const subjectOrder = (subject: RegistrationSubject) => ACADEMIC_SUBJECT_VALUES.indexOf(subject)

function adapterError(code: "payload_schema_unsupported" | "schedule_validation_failed"): never {
  throw Object.assign(new Error(code), { code })
}

function sourceUnavailable(): never {
  throw Object.assign(new Error("notification_source_unavailable"), {
    code: "notification_source_unavailable",
  })
}

function transientSupabaseReadError(value: unknown) {
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

function requiredString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) adapterError("payload_schema_unsupported")
  return value.trim()
}

function requireExactKeys(value: JsonRecord, expected: ReadonlyArray<string>) {
  const actual = Object.keys(value).sort()
  const normalizedExpected = [...expected].sort()
  if (
    actual.length !== normalizedExpected.length
    || actual.some((key, index) => key !== normalizedExpected[index])
  ) {
    adapterError("payload_schema_unsupported")
  }
}

function requireOneExactKeySet(
  value: JsonRecord,
  expectedSets: ReadonlyArray<ReadonlyArray<string>>,
) {
  const actual = Object.keys(value).sort()
  if (!expectedSets.some((expected) => {
    const normalized = [...expected].sort()
    return actual.length === normalized.length
      && actual.every((key, index) => key === normalized[index])
  })) {
    adapterError("payload_schema_unsupported")
  }
}

function requiredUuid(value: unknown) {
  const normalized = requiredString(value).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) adapterError("payload_schema_unsupported")
  return normalized
}

function nullableUuid(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  return requiredUuid(value)
}

function positiveDecimal(value: unknown) {
  if (typeof value !== "string" || !POSITIVE_DECIMAL_PATTERN.test(value)) {
    adapterError("payload_schema_unsupported")
  }
  return value
}

function timestamp(value: unknown, code: "payload_schema_unsupported" | "schedule_validation_failed") {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    adapterError(code)
  }
  return value.trim()
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) adapterError("payload_schema_unsupported")
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

function hashTargets(targets: ReadonlyArray<NotificationTarget>) {
  const serialized = targets.map(canonicalJson).sort()
  return createHash("sha256").update(`[${serialized.join(",")}]`, "utf8").digest("hex")
}

function freezeTarget(target: NotificationTarget): NotificationTarget {
  return Object.freeze({
    ...target,
    targetSnapshot: Object.freeze({ ...target.targetSnapshot }),
  })
}

function profileTargets(profileIds: ReadonlyArray<string>) {
  return [...new Set(profileIds.map(requiredUuid))].sort().map((profileId) => freezeTarget({
    targetKind: "profile",
    targetKey: `profile:${profileId}`,
    targetProfileId: profileId,
    connectionKey: null,
    targetSnapshot: { profile_id: profileId },
  }))
}

function managementConnectionTarget() {
  const connectionKey = "google_chat.management"
  return freezeTarget({
    targetKind: "connection",
    targetKey: `connection:${connectionKey}`,
    targetProfileId: null,
    connectionKey,
    targetSnapshot: { connection_key: connectionKey },
  })
}

function noRecipientTarget(audienceKey: string) {
  const normalizedAudienceKey = requiredString(audienceKey)
  return freezeTarget({
    targetKind: "audience",
    targetKey: `audience:${normalizedAudienceKey}`,
    targetProfileId: null,
    connectionKey: null,
    targetSnapshot: { audience_key: normalizedAudienceKey },
  })
}

function profileOrNoRecipientTargets(profileIds: ReadonlyArray<string>, audienceKey: string) {
  const targets = profileTargets(profileIds)
  return targets.length > 0 ? targets : [noRecipientTarget(audienceKey)]
}

function directorTargetSet(source: RegistrationNotificationSourceSnapshot) {
  if (source.kind !== "visit_consultation") adapterError("payload_schema_unsupported")
  return targetSet(
    source.recipientRevision,
    profileOrNoRecipientTargets(source.directorProfileIds, "track_director"),
  )
}

function targetSet(generation: string, targets: ReadonlyArray<NotificationTarget>): NotificationTargetSet {
  const frozenTargets = Object.freeze([...targets].sort((left, right) => (
    left.targetKey.localeCompare(right.targetKey)
  )))
  return Object.freeze({
    targetGeneration: positiveDecimal(generation),
    targetSetHash: hashTargets(frozenTargets),
    targets: frozenTargets,
  })
}

function observationConnectionTarget(connectionKey: string) {
  if (!["google_chat.english", "google_chat.math", "google_chat.science", "google_chat.management"].includes(connectionKey)) {
    adapterError("payload_schema_unsupported")
  }
  return freezeTarget({
    targetKind: "connection",
    targetKey: `connection:${connectionKey}`,
    targetProfileId: null,
    connectionKey,
    targetSnapshot: { connection_key: connectionKey },
  })
}

function isObservationEvent(eventKey: string): eventKey is RegistrationObservationChatPayloadV3["event_kind"] {
  return OBSERVATION_EVENTS.has(eventKey as RegistrationObservationChatPayloadV3["event_kind"])
}

function subjectConnectionKey(subject: RegistrationObservationChatPayloadV3["subject"]) {
  if (subject === "영어") return "google_chat.english"
  if (subject === "수학") return "google_chat.math"
  if (subject === "과학") return "google_chat.science"
  adapterError("payload_schema_unsupported")
}

function observationPayload(input: NotificationResolveInput | NotificationRenderInput) {
  if (
    input.workflowKey !== "registration"
    || !isObservationEvent(input.eventKey)
    || input.payloadSchemaVersion !== 3
    || input.sourceType !== (
      input.eventKey === "registration.observation_director_reassigned"
        ? OBSERVATION_ASSIGNMENT_SOURCE_TYPE
        : OBSERVATION_SOURCE_TYPE
    )
    || !UUID_PATTERN.test(input.eventId)
    || !UUID_PATTERN.test(input.sourceId)
    || !Number.isFinite(Date.parse(input.scheduledFor))
  ) adapterError("payload_schema_unsupported")
  let payload: RegistrationObservationChatPayloadV3
  try {
    payload = parseRegistrationObservationChatPayloadV3(input.payload)
  } catch {
    adapterError("payload_schema_unsupported")
  }
  if (
    payload.event_kind !== input.eventKey
    || Date.parse(input.scheduledFor) !== Date.parse(payload.occurred_at)
    || (payload.event_kind === "registration.observation_director_reassigned"
      ? payload.assignment_fact_id !== input.sourceId || input.sourceRevision !== null
      : payload.observation_id !== input.sourceId
        || input.sourceRevision !== String(payload.appointment_notification_revision))
  ) adapterError("payload_schema_unsupported")
  return payload
}

function observationTargetSet(
  payload: RegistrationObservationChatPayloadV3,
  rule: NotificationRuleSnapshot,
) {
  const currentRule = normalizeRule({ ...rule }, false)
  const generation = String(payload.appointment_notification_revision)
  if (payload.event_kind === "registration.observation_feedback_submitted") {
    if (
      currentRule.channelKey === "google_chat"
      && currentRule.audienceKey === "management_team"
      && (currentRule.connectionKey === null
        || currentRule.connectionKey === "google_chat.management")
    ) return targetSet(generation, [managementConnectionTarget()])
    if (
      currentRule.channelKey === "in_app"
      && currentRule.audienceKey === "track_director"
      && currentRule.connectionKey === null
    ) return targetSet(generation, profileTargets(payload.mention_profile_ids))
    adapterError("payload_schema_unsupported")
  }
  if (payload.event_kind === "registration.observation_director_reassigned") {
    if (
      currentRule.channelKey !== "google_chat"
      || currentRule.audienceKey !== "management_team"
      || (currentRule.connectionKey !== null
        && currentRule.connectionKey !== "google_chat.management")
    ) adapterError("payload_schema_unsupported")
    return targetSet(generation, [managementConnectionTarget()])
  }
  const connectionKey = subjectConnectionKey(payload.subject)
  if (
    currentRule.channelKey !== "google_chat"
    || currentRule.audienceKey !== "subject_team"
    || (currentRule.connectionKey !== null
      && currentRule.connectionKey !== connectionKey)
  ) adapterError("payload_schema_unsupported")
  return targetSet(generation, [observationConnectionTarget(connectionKey)])
}

function jobBookingValue(value: Readonly<Record<string, unknown>>): ObservationBookingPresentationFact {
  const payloadBooking = {
    class_id: value.classId,
    class_name: value.className,
    session_authority: value.sessionAuthority,
    class_lesson_session_id: value.classLessonSessionId,
    legacy_session_key: value.legacySessionKey,
    schedule_state: value.scheduleState,
    starts_at: value.startsAt,
    ends_at: value.endsAt,
    teacher_name: value.teacherName,
    classroom_name: value.classroomName,
    campus: value.campus,
  }
  const probeSourceRevision = value.sessionAuthority === "legacy"
    ? { authority: "legacy", sessionKey: value.legacySessionKey, contentHash: "0".repeat(64) }
    : { authority: "normalized", sessionId: value.classLessonSessionId, revision: 0 }
  const probe = parseRegistrationObservationChatPayloadV3({
    task_id: "00000000-0000-4000-8000-000000000001",
    track_id: "00000000-0000-4000-8000-000000000002",
    observation_id: "00000000-0000-4000-8000-000000000003",
    appointment_id: "00000000-0000-4000-8000-000000000004",
    appointment_notification_revision: 1,
    student_name: "검증",
    subject: "영어",
    source_revision: probeSourceRevision,
    booking_fact_hash: "0".repeat(64),
    occurred_at: "2026-01-01T00:00:00.000Z",
    delivery_expires_at: "2026-01-02T00:00:00.000Z",
    mention_role: "subject_teacher",
    mention_profile_ids: [],
    event_kind: "registration.observation_feedback_due",
    booking: payloadBooking,
  })
  if (probe.event_kind !== "registration.observation_feedback_due") {
    throw new Error("notification_registration_observation_payload_invalid")
  }
  return probe.booking
}

function sourceBookingValue(source: RegistrationObservationNotificationSource) {
  return Object.freeze({
    classId: source.classId,
    className: source.className,
    sessionAuthority: source.sessionAuthority,
    classLessonSessionId: source.classLessonSessionId,
    legacySessionKey: source.legacySessionKey,
    scheduleState: source.scheduleState,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    teacherCatalogId: source.teacherCatalogId,
    teacherProfileId: source.teacherProfileId,
    teacherName: source.teacherName,
    classroomCatalogId: source.classroomCatalogId,
    classroomName: source.classroomName,
    campus: source.campus,
  })
}

function preparationValue(value: unknown): RegistrationObservationPreparation {
  if (!isRecord(value)) throw new Error("notification_registration_observation_payload_invalid")
  requireExactKeys(value, ["progressSummary", "textbookNames"])
  if (
    !Array.isArray(value.textbookNames)
    || value.textbookNames.length < 1
    || value.textbookNames.some((item) => typeof item !== "string" || !item.trim())
    || typeof value.progressSummary !== "string"
    || !value.progressSummary.trim()
  ) throw new Error("notification_registration_observation_payload_invalid")
  return Object.freeze({
    textbookNames: Object.freeze(value.textbookNames.map((item) => String(item).trim())),
    progressSummary: value.progressSummary.trim(),
  })
}

function canonicalUuidList(value: ReadonlyArray<string>) {
  const values = value.map(requiredUuid)
  const canonical = [...new Set(values)].sort()
  if (canonical.length !== values.length || canonical.some((item, index) => item !== values[index])) {
    throw new Error("notification_registration_observation_payload_invalid")
  }
  return Object.freeze(values)
}

export function buildRegistrationObservationChatPayloadV3(input: Readonly<{
  job: RegistrationObservationChatJobClaim
  source: RegistrationObservationNotificationSource
  preparation: RegistrationObservationPreparation | null
}>): RegistrationObservationChatPayloadV3 {
  const { job, source } = input
  if (
    !job
    || !source
    || job.observationId !== source.observationId
    || job.appointmentId !== source.appointmentId
    || job.notificationRevision !== source.notificationRevision
    || job.bookingFactHash !== source.bookingFactHash
    || canonicalJson(job.sourceRevision) !== canonicalJson(source.sourceRevision)
    || canonicalJson(job.currentBookingSnapshot) !== canonicalJson(sourceBookingValue(source))
    || !isObservationEvent(job.eventKey)
    || !observationLifecycleEligible(job.eventKey, source)
    || !Number.isInteger(job.attemptCount)
    || job.attemptCount < 0
  ) throw new Error("notification_registration_observation_payload_invalid")
  const readsPreparation = [
    "registration.observation_scheduled",
    "registration.observation_rescheduled",
    "registration.observation_reminder_due",
  ].includes(job.eventKey)
  if ((readsPreparation && input.preparation === null) || (!readsPreparation && input.preparation !== null)) {
    throw new Error("notification_registration_observation_payload_invalid")
  }
  const currentBooking = jobBookingValue(job.currentBookingSnapshot)
  if (
    job.eventKey === "registration.observation_reminder_due"
    && timestamp(job.expiresAt, "payload_schema_unsupported") !== currentBooking.starts_at
  ) throw new Error("notification_registration_observation_payload_invalid")
  const mentionProfileIds = canonicalUuidList(job.mentionProfileIds)
  const exactSemanticProfileIds = job.eventKey === "registration.observation_feedback_submitted"
    ? source.directorProfileId ? [source.directorProfileId] : []
    : [
        "registration.observation_scheduled",
        "registration.observation_canceled",
        "registration.observation_reminder_due",
        "registration.observation_feedback_due",
      ].includes(job.eventKey)
      ? source.teacherProfileId ? [source.teacherProfileId] : []
      : null
  if (
    (exactSemanticProfileIds !== null
      && canonicalJson(mentionProfileIds) !== canonicalJson(exactSemanticProfileIds))
    || (exactSemanticProfileIds === null
      && (mentionProfileIds.length > 2
        || (job.eventKey === "registration.observation_rescheduled"
          && source.teacherProfileId !== null
          && !mentionProfileIds.includes(source.teacherProfileId))
        || (job.eventKey === "registration.observation_director_reassigned"
          && source.directorProfileId !== null
          && !mentionProfileIds.includes(source.directorProfileId))))
  ) throw new Error("notification_registration_observation_payload_invalid")
  const base = {
    task_id: source.taskId,
    track_id: source.trackId,
    observation_id: source.observationId,
    appointment_id: source.appointmentId,
    appointment_notification_revision: source.notificationRevision,
    student_name: source.studentName,
    subject: source.subject,
    source_revision: source.sourceRevision,
    booking_fact_hash: source.bookingFactHash,
    occurred_at: timestamp(job.dueAt, "payload_schema_unsupported"),
    delivery_expires_at: timestamp(job.expiresAt, "payload_schema_unsupported"),
    mention_role: job.mentionRole,
    mention_profile_ids: mentionProfileIds,
  } as const
  let candidate: unknown
  if (job.eventKey === "registration.observation_scheduled") {
    const preparation = preparationValue(input.preparation)
    if (!job.preparationSnapshot || canonicalJson(preparation) !== canonicalJson(preparationValue(job.preparationSnapshot))) {
      throw new Error("notification_registration_observation_payload_invalid")
    }
    candidate = { ...base, event_kind: job.eventKey, booking: currentBooking, textbook_names: preparation.textbookNames, progress_summary: preparation.progressSummary }
  } else if (job.eventKey === "registration.observation_rescheduled") {
    if (!job.previousBookingSnapshot || !job.preparationSnapshot) throw new Error("notification_registration_observation_payload_invalid")
    const preparation = preparationValue(input.preparation)
    if (canonicalJson(preparation) !== canonicalJson(preparationValue(job.preparationSnapshot))) {
      throw new Error("notification_registration_observation_payload_invalid")
    }
    candidate = { ...base, event_kind: job.eventKey, previous_booking: jobBookingValue(job.previousBookingSnapshot), booking: currentBooking, textbook_names: preparation.textbookNames, progress_summary: preparation.progressSummary }
  } else if (job.eventKey === "registration.observation_canceled") {
    candidate = { ...base, event_kind: job.eventKey, canceled_booking: currentBooking }
  } else if (job.eventKey === "registration.observation_reminder_due") {
    const preparation = preparationValue(input.preparation)
    if (!job.preparationSnapshot) throw new Error("notification_registration_observation_payload_invalid")
    preparationValue(job.preparationSnapshot)
    candidate = { ...base, event_kind: job.eventKey, booking: currentBooking, textbook_names: preparation.textbookNames, progress_summary: preparation.progressSummary }
  } else if (job.eventKey === "registration.observation_feedback_due") {
    candidate = { ...base, event_kind: job.eventKey, booking: currentBooking }
  } else if (job.eventKey === "registration.observation_feedback_submitted") {
    if (!job.submissionSnapshot) throw new Error("notification_registration_observation_payload_invalid")
    requireExactKeys(job.submissionSnapshot as JsonRecord, ["submittedAt", "submittedByName"])
    candidate = { ...base, event_kind: job.eventKey, booking: currentBooking, submitted_by_name: job.submissionSnapshot.submittedByName, submitted_at: job.submissionSnapshot.submittedAt }
  } else {
    if (!job.assignmentFactId) throw new Error("notification_registration_observation_payload_invalid")
    const directorProfileIds = source.directorProfileId
      ? canonicalUuidList([source.directorProfileId])
      : Object.freeze([])
    const directorSet = new Set(directorProfileIds)
    const previousDirectorProfileIds = Object.freeze(
      mentionProfileIds.filter((profileId) => !directorSet.has(profileId)),
    )
    candidate = { ...base, event_kind: job.eventKey, assignment_fact_id: job.assignmentFactId, booking: currentBooking, previous_director_profile_ids: previousDirectorProfileIds, director_profile_ids: directorProfileIds }
  }
  return parseRegistrationObservationChatPayloadV3(candidate)
}

function normalizeRule(value: unknown, scheduled = false): RegistrationNotificationRule {
  if (!isRecord(value)) adapterError("payload_schema_unsupported")
  const channelKey = requiredString(value.channelKey)
  if (channelKey !== "in_app" && channelKey !== "google_chat") {
    adapterError("payload_schema_unsupported")
  }
  const scheduleKey = value.scheduleKey
  if (scheduled && !["previous_day_at", "same_day_at", "offset_before"].includes(String(scheduleKey))) {
    adapterError("payload_schema_unsupported")
  }
  if (typeof value.enabled !== "boolean" && scheduled) adapterError("payload_schema_unsupported")
  if (value.scheduleConfig !== undefined && !isRecord(value.scheduleConfig)) {
    adapterError("payload_schema_unsupported")
  }
  return Object.freeze({
    ruleId: requiredUuid(value.ruleId),
    ruleRevision: positiveDecimal(value.ruleRevision),
    templateId: requiredUuid(value.templateId),
    audienceKey: requiredString(value.audienceKey),
    channelKey,
    connectionKey: value.connectionKey === null || value.connectionKey === undefined
      ? null
      : requiredString(value.connectionKey),
    ruleVariantKey: requiredString(value.ruleVariantKey),
    scheduleKey: String(scheduleKey || "same_day_at") as RegistrationNotificationRule["scheduleKey"],
    scheduleConfig: Object.freeze({ ...(value.scheduleConfig as JsonRecord | undefined) }),
    enabled: scheduled ? value.enabled as boolean : true,
  })
}

function normalizeSource(value: unknown): RegistrationNotificationSourceSnapshot {
  if (!isRecord(value)) adapterError("payload_schema_unsupported")
  const kind = value.kind
  const status = value.status
  if (kind !== "level_test" && kind !== "visit_consultation") {
    adapterError("payload_schema_unsupported")
  }
  if (status !== "scheduled" && status !== "completed" && status !== "canceled") {
    adapterError("payload_schema_unsupported")
  }
  if (!Number.isInteger(value.notificationRevision) || Number(value.notificationRevision) < 1) {
    adapterError("payload_schema_unsupported")
  }
  if (
    !Array.isArray(value.managementProfileIds)
    || !Array.isArray(value.directorProfileIds)
    || !Array.isArray(value.participants)
    || !Array.isArray(value.currentRules)
  ) {
    adapterError("payload_schema_unsupported")
  }
  const participants = value.participants.map((participant) => {
    if (!isRecord(participant)) adapterError("payload_schema_unsupported")
    const subject = parseAcademicSubject(participant.subject)
    if (!subject || participant.subject !== subject) adapterError("payload_schema_unsupported")
    return Object.freeze({
      trackId: requiredUuid(participant.trackId),
      subject,
      directorProfileId: nullableUuid(participant.directorProfileId),
      ...(Object.prototype.hasOwnProperty.call(participant, "directorName")
        ? {
            directorName: participant.directorName === null
              ? null
              : requiredString(participant.directorName),
          }
        : {}),
    })
  }).sort((left, right) => (
    subjectOrder(left.subject) - subjectOrder(right.subject)
    || left.trackId.localeCompare(right.trackId)
  ))
  if (
    (status === "scheduled" && participants.length === 0)
    || new Set(participants.map((item) => item.trackId)).size !== participants.length
  ) {
    adapterError("payload_schema_unsupported")
  }
  return Object.freeze({
    appointmentId: requiredUuid(value.appointmentId),
    taskId: requiredUuid(value.taskId),
    studentName: requiredString(value.studentName),
    kind,
    scheduledAt: timestamp(value.scheduledAt, "payload_schema_unsupported"),
    place: requiredString(value.place),
    status,
    notificationRevision: Number(value.notificationRevision),
    recipientRevision: positiveDecimal(value.recipientRevision),
    managementProfileIds: Object.freeze([...new Set(value.managementProfileIds.map(requiredUuid))].sort()),
    directorProfileIds: Object.freeze([...new Set(value.directorProfileIds.map(requiredUuid))].sort()),
    participants: Object.freeze(participants),
    ...(Object.prototype.hasOwnProperty.call(value, "progressActor")
      ? {
          progressActor: value.progressActor === null
            ? null
            : requiredString(value.progressActor),
        }
      : {}),
    currentRules: Object.freeze(value.currentRules.map((item) => normalizeRule(item, true))),
  })
}

function validateResolveEnvelope(input: NotificationResolveInput | NotificationRenderInput) {
  if (
    input.workflowKey !== "registration"
    || input.eventKey !== EVENT_KEY
    || input.sourceType !== SOURCE_TYPE
    || input.payloadSchemaVersion !== 2
    || !isRecord(input.payload)
  ) {
    adapterError("payload_schema_unsupported")
  }
  requiredUuid(input.eventId)
  requiredUuid(input.sourceId)
  if (input.sourceRevision === null || !POSITIVE_DECIMAL_PATTERN.test(input.sourceRevision)) {
    adapterError("payload_schema_unsupported")
  }
}

function isImmediateEvent(eventKey: string) {
  return IMMEDIATE_CORE_EVENTS.has(eventKey)
    || IMMEDIATE_VISIT_EVENTS.has(eventKey)
    || IMMEDIATE_MESSAGE_EVENTS.has(eventKey)
}

function immediateSourceType(eventKey: string) {
  if (IMMEDIATE_VISIT_EVENTS.has(eventKey)) return "registration_appointment"
  if (IMMEDIATE_MESSAGE_EVENTS.has(eventKey)) return "ops_registration_message"
  return "ops_task_event"
}

function immediatePayload(input: NotificationResolveInput | NotificationRenderInput) {
  if (
    input.workflowKey !== "registration"
    || !isImmediateEvent(input.eventKey)
    || input.sourceType !== immediateSourceType(input.eventKey)
    || !UUID_PATTERN.test(input.eventId)
    || !UUID_PATTERN.test(input.sourceId)
    || !isRecord(input.payload)
    || !Number.isFinite(Date.parse(input.scheduledFor))
  ) adapterError("payload_schema_unsupported")

  const expectedSchemaVersion = (
    input.eventKey === "registration.case_created"
    || input.eventKey === "registration.registration_completed"
    || input.eventKey === "registration.case_closed"
  ) ? 1 : 2
  if (input.payloadSchemaVersion !== expectedSchemaVersion) {
    adapterError("payload_schema_unsupported")
  }
  if (IMMEDIATE_VISIT_EVENTS.has(input.eventKey)) {
    const sourceRevision = positiveDecimal(input.sourceRevision)
    if (
      requiredUuid(input.payload.appointment_id) !== input.sourceId.toLowerCase()
      || positiveDecimal(input.payload.notification_revision) !== sourceRevision
    ) adapterError("payload_schema_unsupported")
  } else if (input.sourceRevision !== null) {
    adapterError("payload_schema_unsupported")
  }
  if (IMMEDIATE_MESSAGE_EVENTS.has(input.eventKey)) {
    if (requiredUuid(input.payload.message_id) !== input.sourceId.toLowerCase()) {
      adapterError("payload_schema_unsupported")
    }
    requiredString(input.payload.message_request_key)
  }
  requiredUuid(input.payload.task_id)
  return input.payload
}

function immediateTargetSet(input: NotificationResolveInput) {
  const payload = immediatePayload(input)
  const rule = input.rule
  let generation = IMMEDIATE_VISIT_EVENTS.has(input.eventKey)
    ? positiveDecimal(payload.recipient_revision)
    : "0"
  let targets: NotificationTarget[]
  if (rule.channelKey === "google_chat" && rule.audienceKey === "management_team") {
    if (rule.connectionKey && rule.connectionKey !== "google_chat.management") {
      adapterError("payload_schema_unsupported")
    }
    targets = [managementConnectionTarget()]
  } else if (rule.channelKey === "in_app" && rule.audienceKey === "track_director") {
    generation = positiveDecimal(payload.recipient_revision)
    const profileIds = Array.isArray(payload.director_profile_ids)
      ? payload.director_profile_ids
      : [payload.director_profile_id]
    targets = profileTargets(profileIds.filter((value): value is string => typeof value === "string"))
  } else if (rule.channelKey === "in_app" && rule.audienceKey === "management_team") {
    const profileIds = Array.isArray(payload.management_profile_ids)
      ? payload.management_profile_ids
      : []
    targets = profileTargets(profileIds.filter((value): value is string => typeof value === "string"))
  } else if (
    rule.channelKey === "customer_message"
    && rule.audienceKey === "applicant_guardian"
    && input.eventKey === "registration.admission_message_requested"
  ) {
    const messageId = requiredUuid(payload.message_id)
    const requestKeyHash = createHash("md5").update(requiredString(payload.message_request_key), "utf8").digest("hex")
    targets = [freezeTarget({
      targetKind: "customer_endpoint",
      targetKey: `registration-message:${messageId}`,
      targetProfileId: null,
      connectionKey: null,
      targetSnapshot: { message_id: messageId, request_key_hash: requestKeyHash },
    })]
  } else {
    adapterError("payload_schema_unsupported")
  }
  if (!/^(?:0|[1-9]\d*)$/.test(generation)) adapterError("payload_schema_unsupported")
  const frozenTargets = Object.freeze([...targets].sort((left, right) => (
    left.targetKey.localeCompare(right.targetKey)
  )))
  return Object.freeze({
    targetGeneration: generation,
    targetSetHash: hashTargets(frozenTargets),
    targets: frozenTargets,
  })
}

function presentationInput(
  input: NotificationRenderInput,
  payload: Readonly<Record<string, unknown>>,
) {
  const requestedContextKeys = input.requestedContextKeys ?? []
  if (
    !Array.isArray(requestedContextKeys)
    || requestedContextKeys.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(key))
    || new Set(requestedContextKeys).size !== requestedContextKeys.length
  ) adapterError("payload_schema_unsupported")
  if (input.rule.channelKey !== "in_app" && input.rule.channelKey !== "google_chat") {
    adapterError("payload_schema_unsupported")
  }
  let connectionKey = null
  let destinationTeam = null
  if (input.rule.channelKey === "google_chat") {
    if (
      input.target.targetKind !== "connection"
      || input.target.connectionKey !== "google_chat.management"
    ) adapterError("payload_schema_unsupported")
    connectionKey = "google_chat.management" as const
    destinationTeam = "management" as const
  } else if (input.target.connectionKey !== null) {
    adapterError("payload_schema_unsupported")
  }
  return Object.freeze({
    workflowKey: input.workflowKey,
    eventKey: input.eventKey,
    ruleVariantKey: input.rule.ruleVariantKey,
    payloadSchemaVersion: input.payloadSchemaVersion,
    payload,
    audienceKey: input.rule.audienceKey,
    channelKey: input.rule.channelKey,
    contractIdentity: Object.freeze({
      workflowKey: input.workflowKey,
      eventKey: input.eventKey,
      audienceKey: input.rule.audienceKey,
      channelKey: input.rule.channelKey,
      ruleVariantKey: input.rule.ruleVariantKey,
    }),
    requestedContextKeys: Object.freeze([...requestedContextKeys]),
    connectionKey,
    destinationTeam,
    scheduledFor: input.scheduledFor,
  })
}

function observationPresentationInput(
  input: NotificationRenderInput,
  payload: RegistrationObservationChatPayloadV3,
) {
  const requestedContextKeys = input.requestedContextKeys ?? []
  if (
    !Array.isArray(requestedContextKeys)
    || requestedContextKeys.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(key))
    || new Set(requestedContextKeys).size !== requestedContextKeys.length
  ) adapterError("payload_schema_unsupported")
  const expectedTargets = observationTargetSet(payload, input.rule)
  if (
    input.targetGeneration !== expectedTargets.targetGeneration
    || !expectedTargets.targets.some((target) => sameTarget(target, input.target))
  ) adapterError("payload_schema_unsupported")
  if (input.rule.channelKey !== "google_chat" && input.rule.channelKey !== "in_app") {
    adapterError("payload_schema_unsupported")
  }
  const channelKey = input.rule.channelKey
  const connectionKey = (channelKey === "google_chat"
    ? input.target.connectionKey
    : null) as NotificationConnectionKey | null
  const destinationTeam = connectionKey === null
    ? null
    : renderObservationDestinationTeam(connectionKey)
  return Object.freeze({
    workflowKey: "registration" as const,
    eventKey: payload.event_kind,
    ruleVariantKey: input.rule.ruleVariantKey,
    payloadSchemaVersion: 3,
    payload,
    audienceKey: input.rule.audienceKey,
    channelKey,
    contractIdentity: Object.freeze({
      workflowKey: "registration" as const,
      eventKey: payload.event_kind,
      audienceKey: input.rule.audienceKey,
      channelKey,
      ruleVariantKey: input.rule.ruleVariantKey,
    }),
    requestedContextKeys: Object.freeze([...requestedContextKeys]),
    connectionKey,
    destinationTeam,
    scheduledFor: input.scheduledFor,
  })
}

function mergePresentationContext(
  input: NotificationRenderInput,
  payload: Readonly<Record<string, unknown>>,
  legacyContext: Readonly<Record<string, string>>,
) {
  const context = { ...legacyContext }
  const presentation = buildRegistrationNotificationPresentation(presentationInput(input, payload))
  for (const [key, value] of Object.entries(presentation)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof value !== "string") {
      adapterError("payload_schema_unsupported")
    }
    context[key] = value
  }
  return Object.freeze(context)
}

function immediateRenderContext(input: NotificationRenderInput): NotificationRenderContext {
  const payload = immediatePayload(input)
  const context: Record<string, string> = {}
  for (const key of [
    "student_name", "grade", "inquiry_at", "status", "class_name",
    "registration_checked", "subject", "subjects", "scheduled_at", "place",
  ]) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) context[key] = value.trim()
    else if (typeof value === "boolean" || typeof value === "number") context[key] = String(value)
  }
  if (!PRESENTATION_EVENTS.has(input.eventKey)) return Object.freeze(context)
  return mergePresentationContext(input, payload, context)
}

function reminderProgressActor(source: RegistrationNotificationSourceSnapshot) {
  if (source.progressActor) return source.progressActor
  const bySubject = new Map<RegistrationSubject, boolean>()
  for (const participant of source.participants) {
    bySubject.set(
      participant.subject,
      (bySubject.get(participant.subject) ?? true) && participant.directorProfileId !== null,
    )
  }
  const subjects = [...bySubject.entries()]
    .filter(([, directorReady]) => directorReady)
    .map(([subject]) => subject)
    .sort((left, right) => subjectOrder(left) - subjectOrder(right))
  if (subjects.length !== bySubject.size || subjects.length === 0) return null
  if (subjects.length === 1) return `${subjects[0]}팀 담당 원장님`
  if (subjects.length === 2) return `${subjects[0]}팀과 ${subjects[1]}팀 담당 원장님`
  return `${subjects.slice(0, -1).map((subject) => `${subject}팀`).join(", ")}과 ${subjects[subjects.length - 1]}팀 담당 원장님`
}

function immediateDeepLink(input: NotificationRenderInput) {
  const payload = immediatePayload(input)
  const query = new URLSearchParams()
  query.set("taskId", requiredUuid(payload.task_id))
  if (IMMEDIATE_VISIT_EVENTS.has(input.eventKey)) {
    query.set("appointmentId", requiredUuid(payload.appointment_id))
    query.set("view", "calendar")
  } else {
    const trackId = nullableUuid(payload.track_id)
    if (trackId) query.set("trackId", trackId)
  }
  return `/admin/registration?${query.toString()}`
}

function exactStringList(value: unknown, expected: ReadonlyArray<string>) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index])
}

function validatePayloadAgainstSource(payload: unknown, source: RegistrationNotificationSourceSnapshot) {
  if (!isRecord(payload)) adapterError("payload_schema_unsupported")
  requireExactKeys(payload, [
    "actor_kind",
    "appointment",
    "subjects",
    "system_source",
    "task",
    "track_ids",
  ])
  const task = payload.task
  const appointment = payload.appointment
  if (!isRecord(task) || !isRecord(appointment)) adapterError("payload_schema_unsupported")
  requireExactKeys(task, ["id", "student_name"])
  requireExactKeys(appointment, ["kind", "place", "scheduled_at"])
  if (
    payload.actor_kind !== "system"
    || payload.system_source !== "registration_reminder_materializer"
    || task.id !== source.taskId
    || task.student_name !== source.studentName
    || appointment.kind !== source.kind
    || appointment.place !== source.place
    || appointment.scheduled_at !== source.scheduledAt
    || !exactStringList(payload.track_ids, source.participants.map((item) => item.trackId))
    || !exactStringList(payload.subjects, source.participants.map((item) => item.subject))
  ) {
    adapterError("payload_schema_unsupported")
  }
}

function targetsForRule(
  source: RegistrationNotificationSourceSnapshot,
  rawRule: NotificationRuleSnapshot,
) {
  const currentRule = normalizeRule({ ...rawRule }, false)
  let targets: NotificationTarget[]
  if (currentRule.audienceKey === "management_team" && currentRule.channelKey === "google_chat") {
    if (currentRule.connectionKey && currentRule.connectionKey !== "google_chat.management") {
      adapterError("payload_schema_unsupported")
    }
    targets = [managementConnectionTarget()]
  } else if (
    source.kind === "level_test"
    && currentRule.audienceKey === "management_team"
    && currentRule.channelKey === "in_app"
  ) {
    targets = profileOrNoRecipientTargets(source.managementProfileIds, currentRule.audienceKey)
  } else if (
    source.kind === "visit_consultation"
    && currentRule.audienceKey === "track_director"
    && currentRule.channelKey === "in_app"
  ) {
    return directorTargetSet(source)
  } else {
    adapterError("payload_schema_unsupported")
  }
  return targetSet(source.recipientRevision, targets)
}

function pageShape<T>(page: RegistrationNotificationPage<T>, batchSize: number) {
  if (
    !page
    || !Array.isArray(page.items)
    || typeof page.done !== "boolean"
    || page.items.length > batchSize
    || (page.done && page.nextCursor !== null)
    || (!page.done && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 512))
  ) {
    adapterError("payload_schema_unsupported")
  }
}

function validatePaging(cursor: string | null, batchSize: number) {
  if (
    (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > 512))
    || !Number.isInteger(batchSize)
    || batchSize < 1
    || batchSize > 500
  ) {
    adapterError("payload_schema_unsupported")
  }
}

function scheduleForRule(source: RegistrationNotificationSourceSnapshot, rule: RegistrationNotificationRule) {
  const appointmentTime = new Date(source.scheduledAt).getTime()
  const config = rule.scheduleConfig
  if (
    config.anchor_key !== "appointment_scheduled_at"
    || config.timezone !== "Asia/Seoul"
  ) {
    adapterError("schedule_validation_failed")
  }
  if (rule.scheduleKey === "offset_before") {
    if (
      Object.keys(config).sort().join(",") !== "anchor_key,lead_minutes,timezone"
      || !Number.isInteger(config.lead_minutes)
      || Number(config.lead_minutes) < 1
      || Number(config.lead_minutes) > 10_080
    ) {
      adapterError("schedule_validation_failed")
    }
    return new Date(appointmentTime - Number(config.lead_minutes) * 60_000).toISOString()
  }
  if (
    (rule.scheduleKey !== "previous_day_at" && rule.scheduleKey !== "same_day_at")
    || Object.keys(config).sort().join(",") !== "anchor_key,local_time,timezone"
    || typeof config.local_time !== "string"
    || !LOCAL_TIME_PATTERN.test(config.local_time)
  ) {
    adapterError("schedule_validation_failed")
  }
  const seoulAppointment = new Date(appointmentTime + SEOUL_OFFSET_MILLISECONDS)
  const [hour, minute] = config.local_time.split(":").map(Number)
  const dayOffset = rule.scheduleKey === "previous_day_at" ? -1 : 0
  const utcMilliseconds = Date.UTC(
    seoulAppointment.getUTCFullYear(),
    seoulAppointment.getUTCMonth(),
    seoulAppointment.getUTCDate() + dayOffset,
    hour - 9,
    minute,
  )
  return new Date(utcMilliseconds).toISOString()
}

function sourcePayload(source: RegistrationNotificationSourceSnapshot) {
  return Object.freeze({
    actor_kind: "system",
    system_source: "registration_reminder_materializer",
    task: Object.freeze({
      id: source.taskId,
      student_name: source.studentName,
    }),
    appointment: Object.freeze({
      kind: source.kind,
      scheduled_at: source.scheduledAt,
      place: source.place,
    }),
    track_ids: Object.freeze(source.participants.map((item) => item.trackId)),
    subjects: Object.freeze(source.participants.map((item) => item.subject)),
  })
}

function currentResolveRule(
  input: NotificationResolveInput | NotificationRenderInput,
  source: RegistrationNotificationSourceSnapshot,
  now: Date,
) {
  if (
    source.status !== "scheduled"
    || input.sourceRevision !== String(source.notificationRevision)
  ) {
    adapterError("payload_schema_unsupported")
  }
  validatePayloadAgainstSource(input.payload, source)
  const requestedRule = normalizeRule({ ...input.rule }, false)
  const requestedConnectionKey = (
    requestedRule.channelKey === "google_chat"
    && requestedRule.audienceKey === "management_team"
    && requestedRule.connectionKey === null
  ) ? "google_chat.management" : requestedRule.connectionKey
  const currentRule = source.currentRules.find((rule) => rule.ruleId === requestedRule.ruleId)
  if (
    !currentRule
    || !currentRule.enabled
    || currentRule.ruleRevision !== requestedRule.ruleRevision
    || currentRule.templateId !== requestedRule.templateId
    || currentRule.audienceKey !== requestedRule.audienceKey
    || currentRule.channelKey !== requestedRule.channelKey
    || currentRule.connectionKey !== requestedConnectionKey
    || currentRule.ruleVariantKey !== requestedRule.ruleVariantKey
  ) {
    adapterError("payload_schema_unsupported")
  }
  const expectedSchedule = scheduleForRule(source, currentRule)
  const scheduledFor = timestamp(input.scheduledFor, "schedule_validation_failed")
  if (
    !Number.isFinite(now.getTime())
    || new Date(expectedSchedule).getTime() !== new Date(scheduledFor).getTime()
    || now.getTime() >= new Date(source.scheduledAt).getTime()
    || new Date(scheduledFor).getTime() >= new Date(source.scheduledAt).getTime()
  ) {
    adapterError("schedule_validation_failed")
  }
  return currentRule
}

function occurrenceFor(
  source: RegistrationNotificationSourceSnapshot,
  rule: RegistrationNotificationRule,
  scheduledFor: string,
) {
  return Object.freeze({
    eventKey: EVENT_KEY,
    sourceType: SOURCE_TYPE,
    sourceId: source.appointmentId,
    sourceRevision: String(source.notificationRevision),
    occurrenceKey: `registration:registration_appointment:${source.appointmentId}:source_revision:${source.notificationRevision}:rule:${rule.ruleId}:rule_revision:${rule.ruleRevision}`,
    occurredAt: scheduledFor,
    payloadSchemaVersion: 2,
    payload: sourcePayload(source),
    materializedRuleId: rule.ruleId,
    materializedRuleRevision: rule.ruleRevision,
    scheduledFor,
  })
}

function sameTarget(left: NotificationTarget, right: NotificationTarget) {
  return canonicalJson(left) === canonicalJson(right)
}

function formatSeoulTimestamp(value: string) {
  const seoul = new Date(new Date(value).getTime() + SEOUL_OFFSET_MILLISECONDS)
  const year = seoul.getUTCFullYear()
  const month = String(seoul.getUTCMonth() + 1).padStart(2, "0")
  const day = String(seoul.getUTCDate()).padStart(2, "0")
  const hour = String(seoul.getUTCHours()).padStart(2, "0")
  const minute = String(seoul.getUTCMinutes()).padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute} KST`
}

function validateTargetReconciliationInput(input: TargetReconciliationInput) {
  validatePaging(input.cursor, input.batchSize)
  if (
    input.workflowKey !== "registration"
    || input.sourceType !== SOURCE_TYPE
    || input.reconciliationKind !== "recipient_set_changed"
    || input.sourceRevision === null
    || !POSITIVE_DECIMAL_PATTERN.test(input.sourceRevision)
    || !POSITIVE_DECIMAL_PATTERN.test(input.targetGeneration)
    || !HASH_PATTERN.test(input.previousTargetSetHash)
    || !HASH_PATTERN.test(input.currentTargetSetHash)
  ) {
    adapterError("payload_schema_unsupported")
  }
  requiredUuid(input.jobId)
  requiredUuid(input.claimToken)
  requiredUuid(input.sourceEventId)
  requiredUuid(input.sourceId)
}

function requiredRuleRevisionMap(value: Readonly<Record<string, string>>) {
  if (!isRecord(value) || Object.keys(value).length === 0) adapterError("payload_schema_unsupported")
  return new Map(Object.entries(value).map(([ruleId, revision]) => [
    requiredUuid(ruleId),
    positiveDecimal(revision),
  ]))
}

function observationLifecycleEligible(
  eventKey: RegistrationObservationChatPayloadV3["event_kind"],
  source: RegistrationObservationNotificationSource,
) {
  if ([
    "registration.observation_scheduled",
    "registration.observation_rescheduled",
    "registration.observation_reminder_due",
  ].includes(eventKey)) {
    return source.observationStatus === "scheduled" && source.appointmentStatus === "scheduled"
  }
  if (eventKey === "registration.observation_canceled") {
    return source.observationStatus === "canceled" && source.appointmentStatus === "canceled"
  }
  if (eventKey === "registration.observation_feedback_due") {
    return ["scheduled", "attended_feedback_pending"].includes(source.observationStatus)
      && ["scheduled", "completed"].includes(source.appointmentStatus)
      && !source.hasFeedback
  }
  if (eventKey === "registration.observation_feedback_submitted") {
    return source.observationStatus === "completed"
      && source.appointmentStatus === "completed"
      && source.hasFeedback
  }
  return !["canceled", "no_show"].includes(source.observationStatus)
    && ["scheduled", "completed"].includes(source.appointmentStatus)
}

function observationTargetEligible(
  payload: RegistrationObservationChatPayloadV3,
  source: RegistrationObservationNotificationSource,
  target: NotificationTarget,
) {
  if (payload.event_kind === "registration.observation_feedback_submitted") {
    if (target.targetKind === "connection") {
      return sameTarget(target, managementConnectionTarget())
    }
    if (!source.directorProfileId) return false
    const expected = profileTargets([source.directorProfileId])[0]
    return Boolean(expected && sameTarget(target, expected))
  }
  if (payload.event_kind === "registration.observation_director_reassigned") {
    return sameTarget(target, managementConnectionTarget())
  }
  return sameTarget(target, observationConnectionTarget(subjectConnectionKey(source.subject)))
}

async function revalidateObservationBeforeSend(
  input: NotificationRevalidationInput,
  dependencies: RegistrationNotificationAdapterDependencies,
): Promise<NotificationRevalidationResult> {
  if (
    !isObservationEvent(input.eventKey)
    || !UUID_PATTERN.test(input.eventId)
    || !UUID_PATTERN.test(input.deliveryId)
    || !UUID_PATTERN.test(input.sourceId)
    || !POSITIVE_DECIMAL_PATTERN.test(input.ruleRevision)
    || !POSITIVE_DECIMAL_PATTERN.test(input.targetGeneration)
    || !Number.isFinite(Date.parse(input.scheduledFor))
    || !Number.isInteger(input.attemptCount)
    || (input.attemptCount as number) < 0
    || !isRecord(input.eventSnapshot)
  ) return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  try {
    requireExactKeys(input.eventSnapshot, ["payload", "payloadSchemaVersion"])
  } catch {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  if (input.eventSnapshot.payloadSchemaVersion !== 3) {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  let payload: RegistrationObservationChatPayloadV3
  try {
    payload = parseRegistrationObservationChatPayloadV3(input.eventSnapshot.payload)
  } catch {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  const assignmentChange = payload.event_kind === "registration.observation_director_reassigned"
  const sourceIdentityInvalid = assignmentChange
    ? payload.event_kind !== "registration.observation_director_reassigned"
      || payload.assignment_fact_id !== input.sourceId
      || input.sourceRevision !== null
    : payload.observation_id !== input.sourceId || input.sourceRevision === null
  if (
    payload.event_kind !== input.eventKey
    || Date.parse(input.scheduledFor) !== Date.parse(payload.occurred_at)
    || input.sourceType !== (assignmentChange ? OBSERVATION_ASSIGNMENT_SOURCE_TYPE : OBSERVATION_SOURCE_TYPE)
    || sourceIdentityInvalid
  ) return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  if ((input.attemptCount as number) > 0) return { ok: true }
  const sourceReader = dependencies.observationSourceReader
  if (!sourceReader) return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  let source: RegistrationObservationNotificationSource
  try {
    source = await sourceReader.readSource(payload.observation_id)
  } catch {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  if (
    source.observationId !== payload.observation_id
    || source.appointmentId !== payload.appointment_id
    || source.taskId !== payload.task_id
    || source.trackId !== payload.track_id
    || source.subject !== payload.subject
  ) return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  if (
    payload.appointment_notification_revision !== source.notificationRevision
    || (!assignmentChange && input.sourceRevision !== String(source.notificationRevision))
  ) return { ok: false, status: "canceled", reason: "source_revision_changed" }
  if (!observationLifecycleEligible(payload.event_kind, source)) {
    return { ok: false, status: "canceled", reason: "source_status_changed" }
  }
  if (payload.booking_fact_hash !== source.bookingFactHash) {
    return { ok: false, status: "canceled", reason: "source_schedule_changed" }
  }
  if (input.targetGeneration !== String(source.notificationRevision)) {
    return { ok: false, status: "canceled", reason: "recipient_revoked" }
  }
  if (!observationTargetEligible(payload, source, input.target)) {
    return { ok: false, status: "canceled", reason: "recipient_revoked" }
  }
  const booking = payload.event_kind === "registration.observation_canceled"
    ? payload.canceled_booking
    : payload.booking
  if (
    payload.event_kind === "registration.observation_reminder_due"
    && dependencies.now().getTime() >= Date.parse(booking.starts_at)
  ) return { ok: false, status: "failed", reason: "retry_window_closed" }
  let refreshed: RegistrationObservationChatPayloadV3
  try {
    let candidate: Readonly<Record<string, unknown>> = {
      ...payload,
      source_revision: source.sourceRevision,
    }
    if (payload.event_kind === "registration.observation_reminder_due") {
      const preparation = await sourceReader.readCurrentPreparation(source)
      candidate = {
        ...candidate,
        textbook_names: preparation.textbookNames,
        progress_summary: preparation.progressSummary,
      }
    }
    if (payload.event_kind === "registration.observation_feedback_submitted") {
      candidate = {
        ...candidate,
        mention_profile_ids: source.directorProfileId ? [source.directorProfileId] : [],
      }
    }
    refreshed = parseRegistrationObservationChatPayloadV3(candidate)
  } catch {
    return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
  }
  return Object.freeze({
    ok: true,
    refreshedPayload: refreshed,
    payloadSchemaVersion: 3,
    payloadFingerprint: createHash("sha256").update(canonicalJson(refreshed), "utf8").digest("hex"),
  })
}

export function createRegistrationNotificationAdapter(
  dependencies: RegistrationNotificationAdapterDependencies,
  immediateDependencies: ImmediateNotificationAdapterDependencies = immediateNotificationProductionDependencies,
): NotificationWorkflowAdapter {
  if (
    !dependencies
    || typeof dependencies.now !== "function"
    || typeof dependencies.getSourceSnapshot !== "function"
    || typeof dependencies.listScheduledSources !== "function"
    || typeof dependencies.listTargetItems !== "function"
    || (dependencies.observationSourceReader !== undefined
      && (typeof dependencies.observationSourceReader.readSource !== "function"
        || typeof dependencies.observationSourceReader.readCurrentPreparation !== "function"))
  ) {
    adapterError("payload_schema_unsupported")
  }

  const adapter: NotificationWorkflowAdapter = {
    workflowKey: "registration",

    async resolveTargets(input) {
      if (isObservationEvent(input.eventKey)) {
        return observationTargetSet(observationPayload(input), input.rule)
      }
      if (isImmediateEvent(input.eventKey)) return immediateTargetSet(input)
      validateResolveEnvelope(input)
      const rawSource = await dependencies.getSourceSnapshot(input.sourceId)
      if (!rawSource) adapterError("payload_schema_unsupported")
      const source = normalizeSource(rawSource)
      if (source.appointmentId !== input.sourceId) adapterError("payload_schema_unsupported")
      const currentRule = currentResolveRule(input, source, dependencies.now())
      return targetsForRule(source, currentRule)
    },

    async buildRenderContext(input): Promise<NotificationRenderContext> {
      if (isObservationEvent(input.eventKey)) {
        const payload = observationPayload(input)
        return buildRegistrationNotificationPresentation(observationPresentationInput(input, payload))
      }
      if (isImmediateEvent(input.eventKey)) return immediateRenderContext(input)
      validateResolveEnvelope(input)
      const rawSource = await dependencies.getSourceSnapshot(input.sourceId)
      if (!rawSource) adapterError("payload_schema_unsupported")
      const source = normalizeSource(rawSource)
      currentResolveRule(input, source, dependencies.now())
      const subjects = [...new Set(source.participants.map((participant) => participant.subject))]
        .sort((left, right) => subjectOrder(left) - subjectOrder(right))
      const legacyContext = Object.freeze({
        student_name: source.studentName,
        appointment_kind: source.kind === "level_test" ? "레벨테스트" : "방문상담",
        scheduled_at: formatSeoulTimestamp(source.scheduledAt),
        place: source.place,
        subjects: subjects.join(" · "),
      })
      return mergePresentationContext(input, Object.freeze({
        ...input.payload,
        task_id: source.taskId,
        student_name: source.studentName,
        appointment_kind: source.kind,
        scheduled_at: source.scheduledAt,
        place: source.place,
        subjects: Object.freeze(subjects),
        progress_actor: reminderProgressActor(source),
        occurred_at: input.scheduledFor,
      }), legacyContext)
    },

    async buildDeepLink(input) {
      if (isObservationEvent(input.eventKey)) {
        const payload = observationPayload(input)
        observationPresentationInput(input, payload)
        if (payload.event_kind === "registration.observation_feedback_due") {
          return `/admin/registration/observations/${payload.observation_id}/feedback`
        }
        const query = new URLSearchParams()
        query.set("taskId", payload.task_id)
        query.set("trackId", payload.track_id)
        query.set("appointmentId", payload.appointment_id)
        query.set("observationId", payload.observation_id)
        query.set("view", "calendar")
        return `/admin/registration?${query.toString()}`
      }
      if (isImmediateEvent(input.eventKey)) return immediateDeepLink(input)
      validateResolveEnvelope(input)
      const rawSource = await dependencies.getSourceSnapshot(input.sourceId)
      if (!rawSource) adapterError("payload_schema_unsupported")
      const source = normalizeSource(rawSource)
      currentResolveRule(input, source, dependencies.now())
      const query = new URLSearchParams()
      query.set("taskId", source.taskId)
      query.set("appointmentId", source.appointmentId)
      query.set("view", "calendar")
      return `/admin/registration?${query.toString()}`
    },

    async revalidateBeforeSend(input): Promise<NotificationRevalidationResult> {
      if (isObservationEvent(input.eventKey)) {
        return revalidateObservationBeforeSend(input, dependencies)
      }
      if (isImmediateEvent(input.eventKey)) {
        if (
          input.sourceType !== immediateSourceType(input.eventKey)
          || !UUID_PATTERN.test(input.sourceId)
          || !UUID_PATTERN.test(input.eventId)
          || !UUID_PATTERN.test(input.deliveryId)
          || !POSITIVE_DECIMAL_PATTERN.test(input.ruleRevision)
          || !/^\d+$/.test(input.targetGeneration)
          || !Number.isFinite(Date.parse(input.scheduledFor))
        ) return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
        if (IMMEDIATE_VISIT_EVENTS.has(input.eventKey)) {
          if (input.sourceRevision === null || !POSITIVE_DECIMAL_PATTERN.test(input.sourceRevision)) {
            return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
          }
        } else if (input.sourceRevision !== null) {
          return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
        }
        return immediateDependencies.revalidateAuthoritativeSource({
          workflowKey: "registration",
          ...input,
        })
      }
      if (
        input.eventKey !== EVENT_KEY
        || input.sourceType !== SOURCE_TYPE
        || !UUID_PATTERN.test(input.sourceId)
        || !UUID_PATTERN.test(input.eventId)
        || !UUID_PATTERN.test(input.deliveryId)
      ) {
        return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
      }
      let source: RegistrationNotificationSourceSnapshot | null
      try {
        const rawSource = await dependencies.getSourceSnapshot(input.sourceId)
        source = rawSource ? normalizeSource(rawSource) : null
      } catch {
        return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
      }
      if (!source || source.status !== "scheduled") {
        return { ok: false, status: "canceled", reason: "source_status_changed" }
      }
      if (input.sourceRevision !== String(source.notificationRevision)) {
        return { ok: false, status: "canceled", reason: "source_revision_changed" }
      }
      const currentRule = source.currentRules.find((rule) => rule.ruleId === input.ruleId)
      if (!currentRule || !currentRule.enabled || currentRule.ruleRevision !== input.ruleRevision) {
        return { ok: false, status: "canceled", reason: "rule_revision_changed" }
      }
      let expectedSchedule: string
      try {
        expectedSchedule = scheduleForRule(source, currentRule)
      } catch {
        return { ok: false, status: "failed", reason: "schedule_validation_failed" }
      }
      if (!Number.isFinite(Date.parse(input.scheduledFor))) {
        return { ok: false, status: "failed", reason: "schedule_validation_failed" }
      }
      if (new Date(input.scheduledFor).getTime() !== new Date(expectedSchedule).getTime()) {
        return { ok: false, status: "canceled", reason: "source_schedule_changed" }
      }
      if (new Date(expectedSchedule).getTime() >= new Date(source.scheduledAt).getTime()) {
        return { ok: false, status: "failed", reason: "schedule_validation_failed" }
      }
      const now = dependencies.now()
      if (!Number.isFinite(now.getTime()) || now.getTime() >= new Date(source.scheduledAt).getTime()) {
        return { ok: false, status: "failed", reason: "retry_window_closed" }
      }
      let currentTargets: NotificationTargetSet
      try {
        currentTargets = targetsForRule(source, currentRule)
      } catch {
        return { ok: false, status: "failed", reason: "payload_schema_unsupported" }
      }
      const generationControlsThisRule = !(
        source.kind === "visit_consultation"
        && currentRule.audienceKey === "management_team"
        && currentRule.channelKey === "google_chat"
      )
      if (
        (generationControlsThisRule && input.targetGeneration !== currentTargets.targetGeneration)
        || !currentTargets.targets.some((target) => sameTarget(target, input.target))
      ) {
        return { ok: false, status: "canceled", reason: "recipient_revoked" }
      }
      return { ok: true }
    },

    async reconcileScheduledRules(input: RuleReconciliationInput): Promise<RuleReconciliationBatch> {
      validatePaging(input.cursor, input.batchSize)
      if (input.workflowKey !== "registration") adapterError("payload_schema_unsupported")
      requiredUuid(input.jobId)
      requiredUuid(input.claimToken)
      const revisions = requiredRuleRevisionMap(input.ruleRevisionMap)
      const page = await dependencies.listScheduledSources({
        cursor: input.cursor,
        batchSize: input.batchSize,
      })
      pageShape(page, input.batchSize)
      const sources = page.items.map(normalizeSource).sort((left, right) => (
        left.scheduledAt.localeCompare(right.scheduledAt)
        || left.appointmentId.localeCompare(right.appointmentId)
      ))
      if (sources.some((source) => source.status !== "scheduled")) {
        adapterError("payload_schema_unsupported")
      }
      const now = dependencies.now()
      if (!Number.isFinite(now.getTime())) adapterError("schedule_validation_failed")
      const occurrences = sources.flatMap((source) => source.currentRules
        .filter((currentRule) => (
          currentRule.enabled
          && revisions.get(currentRule.ruleId) === currentRule.ruleRevision
        ))
        .map((currentRule) => {
          const scheduledFor = scheduleForRule(source, currentRule)
          return { currentRule, scheduledFor }
        })
        .filter(({ currentRule, scheduledFor }) => {
          try {
            targetsForRule(source, currentRule)
          } catch {
            return false
          }
          const scheduled = new Date(scheduledFor).getTime()
          return now.getTime() < scheduled && scheduled < new Date(source.scheduledAt).getTime()
        })
        .map(({ currentRule, scheduledFor }) => occurrenceFor(
          source,
          currentRule,
          scheduledFor,
        ))
        .sort((left, right) => (
          left.scheduledFor.localeCompare(right.scheduledFor)
          || left.materializedRuleId.localeCompare(right.materializedRuleId)
        )))
      return Object.freeze({
        sources: Object.freeze(sources.map((source) => Object.freeze({
          sourceType: SOURCE_TYPE,
          sourceId: source.appointmentId,
          sourceRevision: String(source.notificationRevision),
        }))),
        occurrences: Object.freeze(occurrences),
        nextCursor: page.nextCursor,
        done: page.done,
      })
    },

    async reconcileTargets(input: TargetReconciliationInput): Promise<TargetReconciliationBatch> {
      validateTargetReconciliationInput(input)
      const rawSource = await dependencies.getSourceSnapshot(input.sourceId)
      if (!rawSource) {
        return Object.freeze({
          sourceRevision: input.sourceRevision,
          targetGeneration: input.targetGeneration,
          targetSetHash: input.currentTargetSetHash,
          items: Object.freeze([]),
          nextCursor: null,
          done: true,
        })
      }
      const source = normalizeSource(rawSource)
      const liveTargetSet = directorTargetSet(source)
      const liveSourceRevision = String(source.notificationRevision)
      if (source.status !== "scheduled" || input.sourceRevision !== liveSourceRevision) {
        return Object.freeze({
          sourceRevision: liveSourceRevision,
          targetGeneration: liveTargetSet.targetGeneration,
          targetSetHash: liveTargetSet.targetSetHash,
          items: Object.freeze([]),
          nextCursor: null,
          done: true,
        })
      }
      const page = await dependencies.listTargetItems({
        appointmentId: source.appointmentId,
        cursor: input.cursor,
        batchSize: input.batchSize,
      })
      pageShape(page, input.batchSize)
      const appointmentTime = new Date(source.scheduledAt).getTime()
      const items = page.items.map((rawItem) => {
        if (!rawItem || !isRecord(rawItem)) adapterError("payload_schema_unsupported")
        const eventId = requiredUuid(rawItem.eventId)
        const itemRule = normalizeRule({ ...rawItem.rule }, false)
        const itemConnectionKey = (
          itemRule.channelKey === "google_chat"
          && itemRule.audienceKey === "management_team"
          && itemRule.connectionKey === null
        ) ? "google_chat.management" : itemRule.connectionKey
        const scheduledFor = timestamp(rawItem.scheduledFor, "schedule_validation_failed")
        if (
          itemRule.audienceKey !== "track_director"
          || itemRule.channelKey !== "in_app"
          || source.kind !== "visit_consultation"
        ) {
          adapterError("payload_schema_unsupported")
        }
        const currentRule = source.currentRules.find((rule) => rule.ruleId === itemRule.ruleId)
        if (
          !currentRule
          || !currentRule.enabled
          || currentRule.ruleRevision !== itemRule.ruleRevision
          || currentRule.templateId !== itemRule.templateId
          || currentRule.audienceKey !== itemRule.audienceKey
          || currentRule.channelKey !== itemRule.channelKey
          || currentRule.connectionKey !== itemConnectionKey
          || currentRule.ruleVariantKey !== itemRule.ruleVariantKey
          || new Date(scheduleForRule(source, currentRule)).getTime() !== new Date(scheduledFor).getTime()
        ) {
          adapterError("payload_schema_unsupported")
        }
        return Object.freeze({
          eventId,
          rule: Object.freeze({
            ruleId: itemRule.ruleId,
            ruleRevision: itemRule.ruleRevision,
            templateId: itemRule.templateId,
            audienceKey: itemRule.audienceKey,
            channelKey: itemRule.channelKey,
            connectionKey: itemRule.connectionKey,
            ruleVariantKey: itemRule.ruleVariantKey,
          }),
          scheduledFor,
          targetSet: targetsForRule(source, itemRule),
        })
      }).filter((item) => (
        new Date(item.scheduledFor).getTime() < appointmentTime
      )).sort((left, right) => (
        left.scheduledFor.localeCompare(right.scheduledFor)
        || left.eventId.localeCompare(right.eventId)
        || left.rule.ruleId.localeCompare(right.rule.ruleId)
      ))
      return Object.freeze({
        sourceRevision: liveSourceRevision,
        targetGeneration: liveTargetSet.targetGeneration,
        targetSetHash: liveTargetSet.targetSetHash,
        items: Object.freeze(items),
        nextCursor: page.nextCursor,
        done: page.done,
      })
    },
  }

  return Object.freeze(adapter)
}

function wireRule(value: unknown, scheduled: boolean) {
  if (!isRecord(value)) adapterError("payload_schema_unsupported")
  const legacyKeys = [
    "audience_key",
    "channel_key",
    "connection_key",
    "enabled",
    "rule_id",
    "rule_revision",
    "rule_variant_key",
    "schedule_config",
    "schedule_key",
    "template_id",
  ]
  const contentKeys = [
    ...legacyKeys,
    "content_contract_version",
    "template_allowed_variables",
    "template_checksum",
  ]
  requireOneExactKeySet(value, [legacyKeys, contentKeys])
  if (Object.prototype.hasOwnProperty.call(value, "template_checksum")) {
    if (
      typeof value.template_checksum !== "string"
      || !HASH_PATTERN.test(value.template_checksum)
      || !Array.isArray(value.template_allowed_variables)
    ) {
      adapterError("payload_schema_unsupported")
    }
    positiveDecimal(value.content_contract_version)
  }
  return normalizeRule({
    ruleId: value.rule_id,
    ruleRevision: value.rule_revision,
    templateId: value.template_id,
    audienceKey: value.audience_key,
    channelKey: value.channel_key,
    connectionKey: value.connection_key,
    ruleVariantKey: value.rule_variant_key ?? value.variant_key,
    scheduleKey: value.schedule_key ?? value.rule_variant_key ?? value.variant_key,
    scheduleConfig: value.schedule_config,
    enabled: value.enabled,
  }, scheduled)
}

function wireSource(value: unknown): RegistrationNotificationSourceSnapshot {
  if (!isRecord(value)) adapterError("payload_schema_unsupported")
  const legacyKeys = [
    "appointment_id",
    "current_rules",
    "director_profile_ids",
    "kind",
    "management_profile_ids",
    "notification_revision",
    "participants",
    "place",
    "recipient_revision",
    "scheduled_at",
    "status",
    "student_name",
    "subjects",
    "task_id",
    "track_ids",
  ]
  requireOneExactKeySet(value, [legacyKeys, [...legacyKeys, "progress_actor"]])
  const trackIds = value.track_ids
  const subjects = value.subjects
  const directorIds = value.director_profile_ids
  const participantRows = value.participants
  if (
    !Array.isArray(trackIds)
    || !Array.isArray(subjects)
    || !Array.isArray(directorIds)
    || !Array.isArray(participantRows)
  ) {
    adapterError("payload_schema_unsupported")
  }
  if (trackIds.length !== subjects.length || trackIds.length !== participantRows.length) {
    adapterError("payload_schema_unsupported")
  }
  if (!Array.isArray(value.management_profile_ids) || !Array.isArray(value.current_rules)) {
    adapterError("payload_schema_unsupported")
  }
  const wireTrackIds = trackIds.map(requiredUuid)
  const wireSubjects = subjects.map((subject) => {
    const parsed = parseAcademicSubject(subject)
    if (!parsed || parsed !== subject) adapterError("payload_schema_unsupported")
    return parsed
  })
  const wirePairs = new Set(wireTrackIds.map((trackId, index) => `${trackId}\u0000${wireSubjects[index]}`))
  if (wirePairs.size !== wireTrackIds.length) adapterError("payload_schema_unsupported")

  const source = normalizeSource({
    appointmentId: value.appointment_id,
    taskId: value.task_id,
    studentName: value.student_name,
    kind: value.kind,
    scheduledAt: value.scheduled_at,
    place: value.place,
    status: value.status,
    notificationRevision: value.notification_revision,
    recipientRevision: value.recipient_revision,
    managementProfileIds: value.management_profile_ids,
    directorProfileIds: directorIds,
    participants: participantRows.map((participant) => {
      if (!isRecord(participant)) adapterError("payload_schema_unsupported")
      requireOneExactKeySet(participant, [[
        "director_profile_id",
        "subject",
        "track_id",
      ], [
        "director_name",
        "director_profile_id",
        "subject",
        "track_id",
      ]])
      return {
        trackId: participant.track_id,
        subject: participant.subject,
        directorProfileId: participant.director_profile_id,
        ...(Object.prototype.hasOwnProperty.call(participant, "director_name")
          ? { directorName: participant.director_name }
          : {}),
      }
    }),
    ...(Object.prototype.hasOwnProperty.call(value, "progress_actor")
      ? { progressActor: value.progress_actor }
      : {}),
    currentRules: value.current_rules.map((item) => wireRule(item, true)),
  })
  const participantPairs = new Set(
    source.participants.map((participant) => `${participant.trackId}\u0000${participant.subject}`),
  )
  if (
    participantPairs.size !== wirePairs.size
    || [...wirePairs].some((pair) => !participantPairs.has(pair))
  ) {
    adapterError("payload_schema_unsupported")
  }
  return source
}

function cursorFromWire(value: unknown) {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) adapterError("payload_schema_unsupported")
  const encoded = canonicalJson(value)
  if (encoded.length > 512) adapterError("payload_schema_unsupported")
  return encoded
}

function cursorForRpc(value: string | null) {
  if (value === null) return null
  try {
    const decoded: unknown = JSON.parse(value)
    if (!isRecord(decoded)) adapterError("payload_schema_unsupported")
    return decoded
  } catch {
    adapterError("payload_schema_unsupported")
  }
}

function wirePage(value: unknown, includesRules: boolean) {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.done !== "boolean") {
    adapterError("payload_schema_unsupported")
  }
  requireExactKeys(value, includesRules
    ? ["done", "items", "next_cursor", "rules"]
    : ["done", "items", "next_cursor"])
  return {
    items: value.items,
    rules: value.rules,
    nextCursor: cursorFromWire(value.next_cursor),
    done: value.done,
  }
}

export type RegistrationNotificationReadRpc = (
  name: string,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<unknown>

export function createRegistrationNotificationRpcDependencies(input: Readonly<{
  rpc: RegistrationNotificationReadRpc
  now?: () => Date
}>): RegistrationNotificationAdapterDependencies {
  if (!input || typeof input.rpc !== "function" || (input.now !== undefined && typeof input.now !== "function")) {
    adapterError("payload_schema_unsupported")
  }
  return Object.freeze({
    now: input.now ?? (() => new Date()),
    async getSourceSnapshot(appointmentId) {
      const data = await input.rpc("get_registration_notification_source_snapshot_v1", {
        p_appointment_id: requiredUuid(appointmentId),
      })
      if (data === null) return null
      return wireSource(data)
    },
    async listScheduledSources(request) {
      validatePaging(request.cursor, request.batchSize)
      const data = wirePage(await input.rpc("list_registration_notification_sources_v1", {
        p_cursor: cursorForRpc(request.cursor),
        p_batch_size: request.batchSize,
      }), true)
      if (!Array.isArray(data.rules)) adapterError("payload_schema_unsupported")
      data.rules.forEach((item) => wireRule(item, true))
      return Object.freeze({
        items: Object.freeze(data.items.map((item) => {
          if (!isRecord(item)) adapterError("payload_schema_unsupported")
          return wireSource({ ...item, current_rules: data.rules })
        })),
        nextCursor: data.nextCursor,
        done: data.done,
      })
    },
    async listTargetItems(request) {
      validatePaging(request.cursor, request.batchSize)
      const data = wirePage(await input.rpc("list_registration_notification_target_items_v1", {
        p_appointment_id: requiredUuid(request.appointmentId),
        p_cursor: cursorForRpc(request.cursor),
        p_batch_size: request.batchSize,
      }), false)
      const items = data.items.map((item) => {
        if (!isRecord(item)) adapterError("payload_schema_unsupported")
        requireExactKeys(item, [
          "audience_key",
          "channel_key",
          "connection_key",
          "event_id",
          "rule_id",
          "rule_revision",
          "rule_variant_key",
          "scheduled_for",
          "template_id",
        ])
        return Object.freeze({
          eventId: requiredUuid(item.event_id),
          rule: normalizeRule({
            ruleId: item.rule_id,
            ruleRevision: item.rule_revision,
            templateId: item.template_id,
            audienceKey: item.audience_key,
            channelKey: item.channel_key,
            connectionKey: item.connection_key,
            ruleVariantKey: item.rule_variant_key,
          }, false),
          scheduledFor: timestamp(item.scheduled_for, "schedule_validation_failed"),
        })
      })
      return Object.freeze({
        items: Object.freeze(items),
        nextCursor: data.nextCursor,
        done: data.done,
      })
    },
  })
}

type SupabaseRpcClient = Readonly<{
  rpc(name: string, parameters: JsonRecord): PromiseLike<Readonly<{
    data: unknown
    error: unknown
  }>>
}>

function isAutomatedTestRuntime() {
  return process.env.NODE_ENV === "test"
    || typeof process.env.NODE_TEST_CONTEXT === "string"
    || process.argv.includes("--test")
    || process.execArgv.includes("--test")
}

function environmentValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ""
}

function createProductionDependencies(): RegistrationNotificationAdapterDependencies {
  let clientPromise: Promise<SupabaseRpcClient> | null = null
  const client = async () => {
    if (isAutomatedTestRuntime()) adapterError("payload_schema_unsupported")
    const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL")
    const key = environmentValue("SUPABASE_SERVICE_ROLE_KEY")
    if (!url || !key) adapterError("payload_schema_unsupported")
    clientPromise ||= import("@supabase/supabase-js").then(({ createClient }) => createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as SupabaseRpcClient)
    return clientPromise
  }
  const rpc: RegistrationNotificationReadRpc = async (name, parameters) => {
    const response = await (await client()).rpc(name, parameters)
    if (response.error) {
      if (
        name === "get_registration_notification_source_snapshot_v1"
        && isRecord(response.error)
        && response.error.code === "P0002"
      ) return null
      if (transientSupabaseReadError(response.error)) sourceUnavailable()
      adapterError("payload_schema_unsupported")
    }
    return response.data
  }
  const legacyDependencies = createRegistrationNotificationRpcDependencies({ rpc })
  const observationSourceReader = createRegistrationObservationNotificationSourceReader({
    async getClient() {
      return await client() as unknown as RegistrationObservationSupabaseClient
    },
  })
  return Object.freeze({ ...legacyDependencies, observationSourceReader })
}

export const registrationNotificationAdapter: NotificationWorkflowAdapter =
  createRegistrationNotificationAdapter(createProductionDependencies())
