import { supabase } from "@/lib/supabase"
import {
  mapRegistrationTeacherCaseBundle,
  type OpsRegistrationObservationCaseDetail,
} from "./registration-track-service"
import {
  parseRegistrationCaseCustomerMessageHistory,
  type RegistrationCaseCustomerMessageHistoryInput,
} from "./registration-customer-message-case-history-contract"
import type { RegistrationCustomerMessageClient } from "./registration-customer-message-contract"

export type RegistrationTeacherEventWindow = Readonly<{ recentLimit: 30; totalCount: number; returnedCount: number; anchorCount: number; hasEarlierEvents: boolean }>

export type RegistrationTeacherCaseData = Readonly<{
  detail: OpsRegistrationObservationCaseDetail
  eventWindow: RegistrationTeacherEventWindow
  profiles: ReadonlyArray<{ id: string; name: string }>
  classes: ReadonlyArray<{ id: string; name: string }>
  textbooks: ReadonlyArray<{ id: string; title: string }>
}>

export type RegistrationTeacherObservationAttempt = Readonly<{
  observationId: string
  taskId: string
  trackId: string
  appointmentId: string
  appointmentStatus: "scheduled" | "completed" | "canceled"
  className: string
  subject: "영어" | "수학" | "과학"
  sessionDate: string
  startsAt: string
  endsAt: string
  teacherName: string
  classroomName: string
  campus: string
  textbooks: ReadonlyArray<{ title: string }>
  progress: string
  status: "scheduled" | "attended_feedback_pending" | "completed" | "no_show" | "canceled"
  attendance: "attended" | "no_show" | null
  suitabilityResult: "fit" | "unfit" | null
  decisionKind: "enrollment" | "waiting_current_class" | "waiting_new_class" | "waiting_next_opening" | "not_registered" | "re_observation" | null
  createdAt: string
  updatedAt: string
}>
export type RegistrationTeacherObservationDetail = Readonly<{
  track: { taskId: string; trackId: string; subject: RegistrationTeacherObservationAttempt["subject"] }
  currentObservation: RegistrationTeacherObservationAttempt | null
  attempts: readonly RegistrationTeacherObservationAttempt[]
  latestDecisionObservation: { observationId: string; decisionKind: NonNullable<RegistrationTeacherObservationAttempt["decisionKind"]> } | null
}>
export type RegistrationTeacherObservationAttemptDetail = Readonly<{
  taskId: string; trackId: string; observation: RegistrationTeacherObservationAttempt
}>
export type RegistrationTeacherFeedback = Readonly<Pick<RegistrationTeacherObservationAttempt,
  "observationId" | "taskId" | "trackId" | "status" | "className" | "teacherName" | "attendance" | "decisionKind" | "suitabilityResult"
> & {
  feedbackReason: string | null
  proxySubmitted: boolean
  feedbackSubmittedByName: string | null
  feedbackSubmittedAt: string | null
}>

type Row = Record<string, unknown>
type RpcResult = { data: unknown; error: unknown; status?: number }
type RpcRequest = PromiseLike<RpcResult> & {
  abortSignal: (signal: AbortSignal) => RpcRequest
  retry: (enabled: boolean) => RpcRequest
}
export type RegistrationTeacherDetailClient = {
  rpc: (name: string, args: Record<string, unknown>) => RpcRequest
}
export type RegistrationTeacherCaseInput = Readonly<{ taskId: string }>
export type RegistrationTeacherTrackInput = RegistrationTeacherCaseInput & Readonly<{ trackId: string }>
export type RegistrationTeacherObservationInput = RegistrationTeacherTrackInput & Readonly<{ observationId: string }>
type Section = "case" | "observation_detail" | "observation_attempt" | "feedback" | "customer_history"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CASE_KEYS = ["parent", "tracks", "appointments", "levelTests", "consultations", "admissionBatches", "enrollments", "events", "eventWindow", "activeAdmissionMessage", "reminderSummaries", "scheduledAppointmentTotal", "currentEnrollmentTotal", "profiles", "classes", "textbooks"]
const invalid = (): never => { throw new Error("registration_teacher_detail_invalid") }
function exact(input: unknown, keys: readonly string[]): Row {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid()
  const row = input as Row
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) return invalid()
  return row
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return invalid()
  return value.toLowerCase()
}
function requestInput<T extends object>(input: T, keys: readonly string[]): T & Row {
  const row = exact(input, keys)
  // Bind response validation to the issued request, even if its caller later
  // reuses or changes the input object while this request is in flight.
  return Object.fromEntries(keys.map((key) => [key, key.endsWith("Id") ? uuid(row[key]) : row[key]])) as T & Row
}
function labels(input: unknown, label: "name" | "title") {
  if (!Array.isArray(input)) return invalid()
  const seen = new Set<string>()
  return input.map((candidate) => {
    const row = exact(candidate, ["id", label])
    const id = uuid(row.id)
    if (seen.has(id) || typeof row[label] !== "string") return invalid()
    seen.add(id)
    return { id, value: row[label] as string }
  })
}

const PARENT_KEYS = ["id", "title", "type", "student_name", "updated_at", "ops_registration_details"]
const DETAIL_KEYS = "task_id pipeline_status inquiry_at school_grade school_name parent_phone student_phone request_note admission_notice_sent common_revision admission_checklist level_test_place level_test_material_link level_test_result visit_consultation_place".split(" ")
const TRACK_KEYS = "id task_id subject pipeline_status director_profile_id director_assignment_source director_assignment_rule_key waiting_kind level_test_retake_decision migration_review_required stage_entered_at updated_at workflow_status workflow_revision workflow_status_entered_at waiting_detail_kind waiting_detail_class_id waiting_detail_retake_decision enrollment_detail_rows phone_ready_at phone_ready_source level_test_scheduled_at level_test_place visit_scheduled_at visit_place director observation_return_workflow_status observation_attempt_count observation_current_id observation_current_status observation_current_appointment_id observation_nearest_scheduled_at observation_nearest_place observation_notification_revision observation_revision observation_feedback_revision".split(" ")
const ENROLLMENT_DETAIL_KEYS = "id classId class_id textbookId textbook_id textbookIds textbook_ids classStartDate class_start_date classStartSessionKey class_start_session_key classStartLessonSessionId class_start_lesson_session_id classStartSession class_start_session classStartSourceObservationId class_start_source_observation_id sortOrder sort_order".split(" ")
const RAW_ROW_KEYS = {
  appointments: "id task_id kind scheduled_at place status notification_revision created_at updated_at",
  levelTests: "id track_id appointment_id attempt_number status started_at completed_at material_link",
  consultations: "id track_id appointment_id mode status director_profile_id ready_at ready_source completed_at outcome note created_at updated_at",
  admissionBatches: "id task_id revision_number status invoice_sent_at payment_confirmed_at created_at updated_at",
  enrollments: "id track_id student_id admission_batch_id class_id textbook_id textbook_ids class_start_date class_start_session_key class_start_lesson_session_id class_start_session class_start_source_observation_id status makeedu_registered roster_active roster_released_at roster_release_reason roster_release_source_task_id roster_release_kind sort_order created_at updated_at",
} as const
const EVENT_KEYS = "id task_id actor_id event_type field_name before_value after_value created_at display_title_only".split(" ")
const VISIBLE_EVENT_TYPES = new Set("case_created inquiry_routed director_default_resolved director_manual_override level_test_scheduled level_test_started level_test_completed consultation_waiting visit_consultation_scheduled consultation_completed waiting_started enrollment_decided admission_completed registration_completed track_closed track_reopened registration_case_created initial_inquiry_selected director_default_cleared director_assignment_required director_phone_queue_repaired level_test_retake_scheduled level_test_absent level_test_canceled level_test_track_closed visit_scheduled waiting_transitioned enrollment_decision_routed admission_batch_started admission_batch_completed enrollment_rows_saved registration_enrollment_makeedu_updated registration_enrollment_canceled registration_enrollment_roster_released admission_batch_canceled migration_review_resolved appointment_updated appointment_replaced appointment_subject_deselected appointment_canceled".split(" "))
const LITERAL_EVENT_TYPES = new Set([...VISIBLE_EVENT_TYPES].filter((type) => !["appointment_updated", "appointment_replaced", "appointment_subject_deselected", "appointment_canceled"].includes(type)))
const EVENT_PAYLOAD_KEYS = "version eventType event_type trackId track_id subject source destination reason reason_code actorId actor_profile_id actor_kind system_source occurredAt occurred_at metadata".split(" ")
const EVENT_METADATA_KEYS = "action activeTrackIds activityId appointmentId attemptId attemptNumber batchId canceledTrackIds changeKind classId completedAt consultationId consultationStatus directorProfileId enrollmentId enrollmentIds invoiceSentAt kind makeeduRegistered materialLink mode newAppointmentId notificationRevision oldAppointmentId oldNotificationRevision oldPlace oldScheduledAt outcome paymentConfirmedAt place restoredHistoricalEnrollment resultStatus retakeDecision revisionNumber rowIds scheduledAt startedAt status waitingKind rows subjectTransitions enrollmentSnapshot appointmentChanges".split(" ")
const EVENT_ENROLLMENT_KEYS = "classId textbookId textbookIds textbook_id textbook_ids classStartDate classStartSession status".split(" ")
const PRIMITIVE_ARRAY_KEYS = new Set(["textbookIds", "textbook_ids", "activeTrackIds", "canceledTrackIds", "rowIds", "enrollmentIds"])
function closed(input: unknown, keys: readonly string[]): Row {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid()
  const row = input as Row
  if (Object.keys(row).some((key) => !keys.includes(key))) return invalid()
  return row
}
function primitive(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
}
function projectedObject(input: unknown, keys: readonly string[], nested: readonly string[] = []): Row {
  const row = closed(input, keys)
  for (const [key, value] of Object.entries(row)) {
    if (nested.includes(key)) continue
    if (!primitive(value) && !(PRIMITIVE_ARRAY_KEYS.has(key) && Array.isArray(value) && value.every(primitive))) return invalid()
  }
  return row
}
function projectedRows(input: unknown, keys: readonly string[]): Row[] {
  if (!Array.isArray(input)) return invalid()
  return input.map((item) => projectedObject(item, keys))
}
function jsonObject(input: unknown): Row {
  let value = input
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return invalid() }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid()
  return value as Row
}
function plainHistoryValue(input: unknown) {
  if (input === null) return
  if (typeof input !== "string") return invalid()
  const title = input.trim()
  let hidden: boolean
  try { JSON.parse(title); hidden = true } catch {
    // Match the existing history title consumer, including truncated JSON.
    // Bracketed Korean notes and ordinary quoted prose remain human text.
    hidden = /^\{/.test(title)
      || /^\[\s*(?:[{["\d-]|true\b|false\b|null\b|$)/.test(title)
      || /^"(?:[^"\\]|\\.)*$/.test(title)
      || title === "[object Object]"
  }
  if (hidden) return invalid()
}
function validateTeacherEvent(input: unknown) {
  const row = projectedObject(input, EVENT_KEYS, ["before_value", "after_value"])
  if ((Object.prototype.hasOwnProperty.call(row, "actor_id") && row.actor_id !== null)
    || (Object.prototype.hasOwnProperty.call(row, "field_name") && row.field_name !== null)) return invalid()
  if (Object.prototype.hasOwnProperty.call(row, "display_title_only")) {
    if (row.display_title_only !== true || typeof row.event_type !== "string"
      || !LITERAL_EVENT_TYPES.has(row.event_type) || row.event_type === "registration_case_created"
      || row.before_value !== null || row.after_value !== null) return invalid()
    return
  }
  if (row.event_type === "registration_track_event") {
    if (row.before_value !== null) return invalid()
    const payload = projectedObject(jsonObject(row.after_value), EVENT_PAYLOAD_KEYS, ["metadata"])
    const version = payload.version
    if (version !== 1 && version !== "1" && version !== 2 && version !== "2") return invalid()
    const type = version === 1 || version === "1" ? payload.eventType : payload.event_type
    if (typeof type !== "string" || !VISIBLE_EVENT_TYPES.has(type)) return invalid()
    const metadata = projectedObject(payload.metadata, EVENT_METADATA_KEYS, ["rows", "subjectTransitions", "enrollmentSnapshot", "appointmentChanges"])
    if (Object.prototype.hasOwnProperty.call(metadata, "rows")) projectedRows(metadata.rows, EVENT_ENROLLMENT_KEYS)
    if (Object.prototype.hasOwnProperty.call(metadata, "subjectTransitions")) projectedRows(metadata.subjectTransitions, ["subject", "source", "destination", "reason"])
    if (Object.prototype.hasOwnProperty.call(metadata, "enrollmentSnapshot")) projectedObject(metadata.enrollmentSnapshot, [...EVENT_ENROLLMENT_KEYS, "admissionBatchId"])
    if (Object.prototype.hasOwnProperty.call(metadata, "appointmentChanges")) {
      if (!Array.isArray(metadata.appointmentChanges)) return invalid()
      for (const item of metadata.appointmentChanges) {
        const change = projectedObject(item, ["eventType", "reasonLabel", "reason", "metadata"], ["metadata"])
        projectedObject(change.metadata, ["oldScheduledAt", "scheduledAt", "oldPlace", "place"])
      }
    }
  } else if (row.event_type === "legacy_registration_imported") {
    projectedObject(jsonObject(row.before_value), ["studentId", "classId", "textbookId", "pipelineStatus"])
    const payload = projectedObject(jsonObject(row.after_value), ["version", "timestamps", "legacyBooleans"], ["timestamps", "legacyBooleans"])
    if (payload.version !== 1 && payload.version !== "1") return invalid()
    projectedObject(payload.timestamps, ["levelTestAt", "levelTestCompletedAt", "phoneConsultationAt", "visitConsultationAt", "consultationAt", "classStartDate", "classStartSession"])
    projectedObject(payload.legacyBooleans, ["admissionNoticeSent", "makeeduRegistered", "makeeduInvoiceSent", "paymentChecked"])
  } else if (row.event_type === "registration_case_created") {
    if (row.before_value !== null) return invalid()
    if (row.after_value !== null) projectedObject(jsonObject(row.after_value), ["version", "actorId", "occurredAt"])
  } else {
    if (typeof row.event_type !== "string" || !LITERAL_EVENT_TYPES.has(row.event_type) || row.before_value !== null) return invalid()
    plainHistoryValue(row.after_value)
  }
}
function validateTeacherCaseRows(row: Row) {
  const parent = projectedObject(row.parent, PARENT_KEYS, ["ops_registration_details"])
  const detail = projectedObject(parent.ops_registration_details, DETAIL_KEYS, ["admission_checklist"])
  if (Object.prototype.hasOwnProperty.call(detail, "admission_checklist")) {
    const checklist = exact(detail.admission_checklist, ["applicationSent", "makeeduRegistered", "invoiceSent", "paymentConfirmed", "registrationCompleted"])
    if (Object.values(checklist).some((value) => typeof value !== "boolean")) return invalid()
  }
  if (!Array.isArray(row.tracks)) return invalid()
  for (const item of row.tracks) {
    const track = projectedObject(item, TRACK_KEYS, ["director", "enrollment_detail_rows"])
    if (track.director !== null) projectedObject(track.director, ["id", "name"])
    if (Object.prototype.hasOwnProperty.call(track, "enrollment_detail_rows")) projectedRows(track.enrollment_detail_rows, ENROLLMENT_DETAIL_KEYS)
  }
  for (const [key, keys] of Object.entries(RAW_ROW_KEYS)) projectedRows(row[key], keys.split(" "))
  if (row.activeAdmissionMessage !== null) projectedObject(row.activeAdmissionMessage, ["id", "status", "claim_active", "template_key", "updated_at"])
  if (!Array.isArray(row.events) || row.events.length > 32) return invalid()
  row.events.forEach(validateTeacherEvent)
  const imports = row.events.filter((event: Row) => event.event_type === "legacy_registration_imported")
  if (imports.length > 1 || (imports.length > 0
    && !row.tracks.some((track: Row) => track.migration_review_required === true))) return invalid()
}
function parseEventWindow(input: unknown, events: unknown): RegistrationTeacherEventWindow {
  const row = exact(input, ["recentLimit", "totalCount", "returnedCount", "anchorCount", "hasEarlierEvents"])
  if (row.recentLimit !== 30 || !Array.isArray(events)
    || !Number.isSafeInteger(row.totalCount) || Number(row.totalCount) < 0
    || !Number.isSafeInteger(row.returnedCount) || row.returnedCount !== events.length
    || !Number.isSafeInteger(row.anchorCount) || Number(row.anchorCount) < 0 || Number(row.anchorCount) > 2
    || Number(row.returnedCount) > Number(row.totalCount)
    || row.returnedCount !== Math.min(Number(row.totalCount), 30) + Number(row.anchorCount)
    || row.hasEarlierEvents !== (Number(row.totalCount) > Number(row.returnedCount))) return invalid()
  return { recentLimit: 30, totalCount: Number(row.totalCount), returnedCount: Number(row.returnedCount), anchorCount: Number(row.anchorCount), hasEarlierEvents: row.hasEarlierEvents as boolean }
}

export function parseRegistrationTeacherCaseData(input: unknown, taskId: string): RegistrationTeacherCaseData {
  const row = exact(input, CASE_KEYS)
  validateTeacherCaseRows(row)
  const eventWindow = parseEventWindow(row.eventWindow, row.events)
  const detail = mapRegistrationTeacherCaseBundle(row)
  if (detail.task.id !== taskId) return invalid()
  return {
    detail,
    eventWindow,
    profiles: labels(row.profiles, "name").map(({ id, value }) => ({ id, name: value })),
    classes: labels(row.classes, "name").map(({ id, value }) => ({ id, name: value })),
    textbooks: labels(row.textbooks, "title").map(({ id, value }) => ({ id, title: value })),
  }
}

const ATTEMPT_KEYS = ["observationId", "taskId", "trackId", "appointmentId", "appointmentStatus", "className", "subject", "sessionDate", "startsAt", "endsAt", "teacherName", "classroomName", "campus", "textbooks", "progress", "status", "attendance", "suitabilityResult", "decisionKind", "createdAt", "updatedAt"]
const STATUS_VALUES = ["scheduled", "attended_feedback_pending", "completed", "no_show", "canceled"] as const
const DECISION_VALUES = ["enrollment", "waiting_current_class", "waiting_new_class", "waiting_next_opening", "not_registered", "re_observation"] as const
const SUBJECT_VALUES = ["영어", "수학", "과학"] as const
function string(value: unknown): string { return typeof value === "string" ? value : invalid() }
function nullableString(value: unknown): string | null { return value === null ? null : string(value) }
function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  return typeof value === "string" && values.includes(value) ? value : invalid()
}
function nullableEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return value === null ? null : enumValue(value, values)
}
function date(value: unknown): string {
  const day = string(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return invalid()
  const parsed = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : invalid()
}
function timestamp(value: unknown): string {
  const result = string(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)
    || !Number.isFinite(Date.parse(result))) return invalid()
  date(result.slice(0, 10))
  return result
}
function identifiers(row: Row, input: RegistrationTeacherTrackInput) {
  if (row.taskId !== input.taskId || row.trackId !== input.trackId) return invalid()
}
function parseAttempt(input: unknown, owner: RegistrationTeacherTrackInput): RegistrationTeacherObservationAttempt {
  const row = exact(input, ATTEMPT_KEYS)
  identifiers(row, owner)
  const startsAt = timestamp(row.startsAt), endsAt = timestamp(row.endsAt)
  if (Date.parse(startsAt) >= Date.parse(endsAt) || !Array.isArray(row.textbooks)) return invalid()
  return {
    observationId: uuid(row.observationId), taskId: uuid(row.taskId), trackId: uuid(row.trackId), appointmentId: uuid(row.appointmentId),
    appointmentStatus: enumValue(row.appointmentStatus, ["scheduled", "completed", "canceled"] as const),
    className: string(row.className), subject: enumValue(row.subject, SUBJECT_VALUES), sessionDate: date(row.sessionDate), startsAt, endsAt,
    teacherName: string(row.teacherName), classroomName: string(row.classroomName), campus: string(row.campus),
    textbooks: row.textbooks.map((item) => ({ title: string(exact(item, ["title"]).title) })), progress: string(row.progress),
    status: enumValue(row.status, STATUS_VALUES), attendance: nullableEnum(row.attendance, ["attended", "no_show"] as const),
    suitabilityResult: nullableEnum(row.suitabilityResult, ["fit", "unfit"] as const), decisionKind: nullableEnum(row.decisionKind, DECISION_VALUES),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  }
}
function parseObservationDetail(input: unknown, owner: RegistrationTeacherTrackInput): RegistrationTeacherObservationDetail {
  const row = exact(input, ["track", "currentObservation", "attempts", "latestDecisionObservation"])
  const track = exact(row.track, ["taskId", "trackId", "subject"])
  identifiers(track, owner)
  const subject = enumValue(track.subject, SUBJECT_VALUES)
  if (!Array.isArray(row.attempts) || row.attempts.length > 20) return invalid()
  const attempts = row.attempts.map((item) => parseAttempt(item, owner))
  const ids = new Set<string>()
  for (const attempt of attempts) {
    if (ids.has(attempt.observationId) || attempt.subject !== subject) return invalid()
    ids.add(attempt.observationId)
  }
  const currentObservation = row.currentObservation === null ? null : parseAttempt(row.currentObservation, owner)
  if (currentObservation) {
    if (currentObservation.subject !== subject) return invalid()
    const matching = attempts.find((attempt) => attempt.observationId === currentObservation.observationId)
    // The server fetches current separately from the newest-20 history window.
    // Preserve that window, but reject conflicting copies of a shared row.
    if (matching && JSON.stringify(matching) !== JSON.stringify(currentObservation)) return invalid()
  }
  const decision = row.latestDecisionObservation === null ? null : exact(row.latestDecisionObservation, ["observationId", "decisionKind"])
  return {
    track: { taskId: uuid(track.taskId), trackId: uuid(track.trackId), subject }, currentObservation, attempts,
    latestDecisionObservation: decision === null ? null : { observationId: uuid(decision.observationId), decisionKind: enumValue(decision.decisionKind, DECISION_VALUES) },
  }
}
function parseFeedback(input: unknown, owner: RegistrationTeacherObservationInput): RegistrationTeacherFeedback {
  const row = exact(input, ["observationId", "taskId", "trackId", "status", "className", "teacherName", "attendance", "decisionKind", "suitabilityResult", "feedbackReason", "proxySubmitted", "feedbackSubmittedByName", "feedbackSubmittedAt"])
  identifiers(row, owner)
  if (row.observationId !== owner.observationId || typeof row.proxySubmitted !== "boolean") return invalid()
  const name = nullableString(row.feedbackSubmittedByName)
  const submittedAt = row.feedbackSubmittedAt === null ? null : timestamp(row.feedbackSubmittedAt)
  if ((name === null) !== (submittedAt === null) || (name !== null && !name.trim())
    || (row.proxySubmitted && name === null)) return invalid()
  return {
    observationId: uuid(row.observationId), taskId: uuid(row.taskId), trackId: uuid(row.trackId), status: enumValue(row.status, STATUS_VALUES),
    className: string(row.className), teacherName: string(row.teacherName), attendance: nullableEnum(row.attendance, ["attended", "no_show"] as const),
    decisionKind: nullableEnum(row.decisionKind, DECISION_VALUES), suitabilityResult: nullableEnum(row.suitabilityResult, ["fit", "unfit"] as const),
    feedbackReason: nullableString(row.feedbackReason), proxySubmitted: row.proxySubmitted, feedbackSubmittedByName: name, feedbackSubmittedAt: submittedAt,
  }
}

// No data cache: each opening/refresh reaches the server's current role check.
// The workspace owns viewer/role epochs; this boundary also discards aborted
// results even when a transport has already completed or cannot cancel.
export function createRegistrationTeacherDetailService(client: RegistrationTeacherDetailClient) {
  async function read(section: Section, input: Row, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(8_000)
    const abort = signal ? AbortSignal.any([signal, deadline]) : deadline
    const taskId = uuid(input.taskId)
    const pageSize = input.pageSize ?? 10
    if (pageSize !== 10 && pageSize !== 15 && pageSize !== 20) return invalid()
    // These are the actual server limits, kept explicit at each RPC call so
    // the existing query budget verifier can prove every branch is bounded.
    const request = pageSize === 20
      ? client.rpc("get_registration_teacher_detail_v1", {
        p_task_id: taskId,
        p_section: section,
        p_track_id: input.trackId === undefined ? null : uuid(input.trackId),
        p_observation_id: input.observationId === undefined ? null : uuid(input.observationId),
        p_page: input.page ?? 1,
        p_limit: 20,
      }).abortSignal(abort).retry(false)
      : pageSize === 15
        ? client.rpc("get_registration_teacher_detail_v1", {
          p_task_id: taskId,
          p_section: section,
          p_track_id: input.trackId === undefined ? null : uuid(input.trackId),
          p_observation_id: input.observationId === undefined ? null : uuid(input.observationId),
          p_page: input.page ?? 1,
          p_limit: 15,
        }).abortSignal(abort).retry(false)
        : client.rpc("get_registration_teacher_detail_v1", {
          p_task_id: taskId,
          p_section: section,
          p_track_id: input.trackId === undefined ? null : uuid(input.trackId),
          p_observation_id: input.observationId === undefined ? null : uuid(input.observationId),
          p_page: input.page ?? 1,
          p_limit: 10,
        }).abortSignal(abort).retry(false)
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abort.reason)
      abort.addEventListener("abort", onAbort, { once: true })
      if (abort.aborted) onAbort()
    })
    try {
      const { data, error, status } = await Promise.race([Promise.resolve(request), aborted])
      abort.throwIfAborted()
      if (error) {
        // PostgREST keeps HTTP status beside its error object. Retain it so
        // expired sessions and forbidden reads invalidate the displayed case.
        if (status === 401 || status === 403) {
          const details = typeof error === "object" ? error as Row : {}
          throw Object.assign(new Error(typeof details.message === "string" ? details.message : "registration_teacher_detail_forbidden"), details, { status, cause: error })
        }
        throw error
      }
      const envelope = exact(data, ["contractVersion", "taskId", "section", "data"])
      if (envelope.contractVersion !== 1 || envelope.taskId !== taskId || envelope.section !== section) return invalid()
      return envelope.data
    } finally {
      if (onAbort) abort.removeEventListener("abort", onAbort)
    }
  }
  async function loadCase(input: RegistrationTeacherCaseInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId"])
    return parseRegistrationTeacherCaseData(await read("case", row, signal), uuid(row.taskId))
  }
  async function loadObservationDetail(input: RegistrationTeacherTrackInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId", "trackId"])
    return parseObservationDetail(await read("observation_detail", row, signal), row)
  }
  async function loadObservationAttempt(input: RegistrationTeacherObservationInput, signal?: AbortSignal): Promise<RegistrationTeacherObservationAttemptDetail> {
    const row = requestInput(input, ["taskId", "trackId", "observationId"])
    const data = exact(await read("observation_attempt", row, signal), ["taskId", "trackId", "observation"])
    identifiers(data, row)
    const observation = parseAttempt(data.observation, row)
    if (observation.observationId !== row.observationId) return invalid()
    return { taskId: uuid(data.taskId), trackId: uuid(data.trackId), observation }
  }
  async function loadFeedback(input: RegistrationTeacherObservationInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId", "trackId", "observationId"])
    return parseFeedback(await read("feedback", row, signal), row)
  }
  async function listCaseHistory(input: RegistrationCaseCustomerMessageHistoryInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId", "page", "pageSize"])
    if (!Number.isSafeInteger(row.page) || Number(row.page) < 1 || Number(row.page) > 100000
      || ![10, 15, 20].includes(Number(row.pageSize)) || typeof row.pageSize !== "number") return invalid()
    const result = parseRegistrationCaseCustomerMessageHistory(await read("customer_history", row, signal), row)
    if (result.history.some((item) => item.canCheck !== false || item.canCheckDelivery !== false)) return invalid()
    return result
  }
  function customerHistoryClient(taskIdInput: string): RegistrationCustomerMessageClient {
    const taskId = uuid(taskIdInput)
    const unavailable = async (): Promise<never> => { throw new Error("registration_teacher_detail_read_only") }
    return Object.freeze({
      preview: unavailable,
      send: unavailable,
      list: unavailable,
      check: unavailable,
      checkDelivery: unavailable,
      reconcile: unavailable,
      releasePreSend: unavailable,
      listCaseHistory: (input: RegistrationCaseCustomerMessageHistoryInput, signal?: AbortSignal) => {
        if (input.taskId !== taskId) return Promise.reject(new Error("registration_teacher_detail_invalid"))
        return listCaseHistory(input, signal)
      },
    })
  }
  return { loadCase, loadObservationDetail, loadObservationAttempt, loadFeedback, listCaseHistory, customerHistoryClient }
}

export const registrationTeacherDetailService = createRegistrationTeacherDetailService(supabase as unknown as RegistrationTeacherDetailClient)
