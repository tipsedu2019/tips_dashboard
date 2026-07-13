import { supabase } from "@/lib/supabase"

import {
  executeRegistrationSubjectTrackFixtureAction,
  loadRegistrationSubjectTrackFixtureCase,
  loadRegistrationSubjectTrackFixtureOptionData,
} from "./registration-track-fixture-runtime"

import type {
  OpsClassOption,
  OpsProfileOption,
  OpsTask,
  OpsTaskAttachment,
  OpsTaskComment,
  OpsTeacherOption,
  OpsTextbookOption,
} from "./ops-task-service"
import type { RegistrationInitialWorkflowPayload } from "./registration-intake-workflow"
import {
  probeRegistrationIntakeWorkflowRuntime,
  resetRegistrationIntakeWorkflowRuntimeProbe,
} from "./registration-intake-runtime-probe"
import type { RegistrationIntakeRuntimeState } from "./registration-intake-runtime-probe"
import {
  invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure,
  probeRegistrationSubjectTrackRuntime,
} from "./registration-runtime-probe"
import type { RegistrationRuntimeState } from "./registration-runtime-probe"

export { probeRegistrationSubjectTrackRuntime }
export type { RegistrationRuntimeState }
export {
  probeRegistrationIntakeWorkflowRuntime,
  resetRegistrationIntakeWorkflowRuntimeProbe,
}
export type { RegistrationIntakeRuntimeState }

// registration-track-service-factory:start
type Row = Record<string, unknown>
export type RegistrationSubject = "영어" | "수학"
export type RegistrationWaitingKind = "" | "current_class" | "current_term_opening" | "next_term_opening"

export type RegistrationPhoneReadySource =
  | "inquiry"
  | "level_test_completion"
  | "visit_reopened"
  | "director_resolved"
  | "track_reopened"
  | "migration"
  | "legacy"

export type OpsRegistrationTrackStatus =
  | "inquiry"
  | "migration_review"
  | "level_test_scheduled"
  | "level_test_in_progress"
  | "consultation_waiting"
  | "visit_consultation_scheduled"
  | "waiting"
  | "enrollment_decided"
  | "enrollment_processing"
  | "registered"
  | "not_registered"
  | "inquiry_closed"

export type OpsRegistrationTrackSummary = {
  id: string
  taskId: string
  subject: RegistrationSubject
  status: OpsRegistrationTrackStatus
  legacy: boolean
  directorProfileId: string | null
  directorName: string
  directorAssignmentSource: "" | "default" | "manual" | "migration"
  directorAssignmentRuleKey: string
  waitingKind: RegistrationWaitingKind
  levelTestRetakeDecision: "" | "required" | "not_required"
  migrationReviewRequired: boolean
  stageEnteredAt: string
  phoneReadyAt: string | null
  phoneReadySource: RegistrationPhoneReadySource | null
  visitScheduledAt?: string
  visitPlace?: string
}

export type OpsRegistrationEnrollment = {
  id: string
  trackId: string
  studentId: string | null
  admissionBatchId: string | null
  classId: string
  textbookId: string | null
  classStartDate: string | null
  classStartSessionKey: string | null
  classStartSession: string | null
  status: "planned" | "waitlisted" | "enrolled" | "canceled"
  makeeduRegistered: boolean
  rosterActive: boolean
  rosterReleasedAt: string | null
  rosterReleaseReason: string | null
  rosterReleaseSourceTaskId: string | null
  rosterReleaseKind: "withdrawal" | "transfer" | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationAppointment = {
  id: string
  taskId: string
  kind: "level_test" | "visit_consultation"
  scheduledAt: string
  place: string
  status: "scheduled" | "completed" | "canceled"
  notificationRevision: number
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationLevelTest = {
  id: string
  trackId: string
  appointmentId: string
  attemptNumber: number
  status: "scheduled" | "in_progress" | "completed" | "absent" | "canceled"
  startedAt: string | null
  completedAt: string | null
  materialLink: string | null
}

export type OpsRegistrationConsultation = {
  id: string
  trackId: string
  appointmentId: string | null
  mode: "phone" | "visit"
  status: "waiting" | "scheduled" | "completed" | "canceled"
  directorProfileId: string
  readyAt: string | null
  readySource: RegistrationPhoneReadySource | null
  completedAt: string | null
  outcome: "enrollment" | "waiting" | "not_registered" | null
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationAdmissionBatch = {
  id: string
  taskId: string
  revisionNumber: number
  status: "draft" | "invoiced" | "paid" | "completed" | "canceled"
  invoiceSentAt: string | null
  paymentConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationTrackEvent = {
  id: string
  taskId: string
  trackId: string | null
  eventType: string
  subject: RegistrationSubject | null
  source: string | null
  destination: string | null
  reason: string | null
  metadata: Record<string, unknown>
  actorId: string | null
  occurredAt: string
  legacyText: string | null
}

export type OpsRegistrationMigrationLegacySnapshot = {
  snapshotMissing: boolean
  pipelineStatus: string
  studentId: string
  classId: string
  textbookId: string
  currentStudentId: string
  currentClassId: string
  currentTextbookId: string
  levelTestAt: string
  levelTestCompletedAt: string
  phoneConsultationAt: string
  visitConsultationAt: string
  consultationAt: string
  classStartDate: string
  classStartSession: string
  levelTestPlace: string
  levelTestMaterialLink: string
  levelTestResult: string
  visitConsultationPlace: string
  admissionNoticeSent: boolean
  makeeduRegistered: boolean
  makeeduInvoiceSent: boolean
  paymentChecked: boolean
  groups: {
    levelTest: boolean
    consultation: boolean
    placement: boolean
  }
}

export type OpsRegistrationCaseDetail = {
  task: OpsTask
  commonRevision: number
  admissionApplicationMessageId: string | null
  admissionApplicationMessageStatus: "" | "pending" | "accepted" | "unknown" | "failed_hold"
  admissionApplicationMessageClaimActive: boolean
  admissionApplicationMessageUpdatedAt: string | null
  admissionApplicationAccepted: boolean
  comments: OpsTaskComment[]
  attachments: OpsTaskAttachment[]
  tracks: OpsRegistrationTrackSummary[]
  appointments: OpsRegistrationAppointment[]
  levelTests: OpsRegistrationLevelTest[]
  consultations: OpsRegistrationConsultation[]
  admissionBatches: OpsRegistrationAdmissionBatch[]
  enrollments: OpsRegistrationEnrollment[]
  events: OpsRegistrationTrackEvent[]
  migrationLegacy: OpsRegistrationMigrationLegacySnapshot | null
}

export type RegistrationTrackSummaryLoadResult = {
  mode: "legacy" | "maintenance" | "ready"
  tracks: OpsRegistrationTrackSummary[]
}

export type OpsRegistrationWorkspaceOptionData = {
  profiles: OpsProfileOption[]
  students: []
  classes: OpsClassOption[]
  textbooks: OpsTextbookOption[]
  teachers: OpsTeacherOption[]
  schemaReady: boolean
  error: string | null
  directorCatalogStatus: "authoritative" | "partial" | "error"
}

export type RegistrationCaseCreateResponse = {
  taskId: string
  commonRevision: number
  subjects: RegistrationSubject[]
  tracks: OpsRegistrationTrackSummary[]
}

export type RegistrationCaseCreateWithInitialWorkflowResponse = RegistrationCaseCreateResponse & {
  appointments: OpsRegistrationAppointment[]
  notificationTargets: Array<{ appointmentId: string; notificationRevision: number }>
}

export type RegistrationSubjectSyncResponse = {
  taskId: string
  subjects: RegistrationSubject[]
  tracks: OpsRegistrationTrackSummary[]
}

export type RegistrationCommonUpdateResponse = {
  taskId: string
  commonRevision: number
}

export type RegistrationTrackTransitionResponse = {
  taskId: string
  trackId: string
  subject?: RegistrationSubject
  status: OpsRegistrationTrackStatus
  waitingKind?: RegistrationWaitingKind
  levelTestRetakeDecision?: "" | "required" | "not_required"
  stageEnteredAt?: string
  consultationId?: string | null
  enrollmentId?: string | null
  canceledEnrollmentIds?: string[]
}

export type RegistrationDirectorAssignmentResponse = RegistrationTrackTransitionResponse & {
  directorProfileId: string | null
  directorAssignmentSource: "" | "default" | "manual" | "migration"
  directorAssignmentRuleKey: string
  commonRevision?: number
}

export type RegistrationAppointmentMutationResponse = {
  appointmentId: string
  notificationRevision: number
  notificationTargets: Array<{ appointmentId: string; notificationRevision: number }>
  requiresDirectorAssignmentTrackIds: string[]
}

export type RegistrationLevelTestMutationResponse = {
  taskId: string
  trackId: string
  attemptId: string
  appointmentId: string
  attemptNumber: number
  status: OpsRegistrationLevelTest["status"]
  trackStatus: OpsRegistrationTrackStatus
  appointmentStatus: OpsRegistrationAppointment["status"]
  startedAt?: string | null
  completedAt?: string | null
  materialLink?: string | null
  consultationId?: string | null
}

export type RegistrationConsultationCompletionResponse = {
  consultation: OpsRegistrationConsultation
  track: OpsRegistrationTrackSummary
}

export type RegistrationEnrollmentRowsSaveResponse = {
  trackId: string
  rows: OpsRegistrationEnrollment[]
}

export type RegistrationAdmissionMessageClaimResponse =
  | {
      taskId: string
      messageId: string
      messageRequestKey: string
      claimStatus: "pending"
      claimActive: true
      shouldSend: true
      retryRequiresNewMessageKey: false
      studentName: string
      parentPhone: string
      commonRevision: number
    }
  | {
      taskId: string
      messageId: string
      messageRequestKey: string
      claimStatus: "pending" | "accepted" | "unknown" | "failed"
      claimActive: boolean
      shouldSend: false
      retryRequiresNewMessageKey: boolean
    }

export type RegistrationAdmissionProviderEvidence = {
  providerMessageId?: string
  providerGroupId?: string
  lookupRequestKey?: string
  observedState: "accepted" | "failed" | "not_found" | "closed"
  observedStatusCode?: string
  observedStatusMessage?: string
}

export type RegistrationAdmissionMessageReconciliationResponse = {
  taskId: string
  messageId: string
  messageRequestKey: string
  previousStatus: "unknown" | "failed"
  previousClaimActive: true
  nextStatus: "accepted" | "failed"
  claimActive: true
  requiresAdmissionMark: boolean
  requiresRetryRelease: boolean
}

export type RegistrationAdmissionMessageReleaseResponse = {
  taskId: string
  messageId: string
  messageRequestKey: string
  status: "failed"
  claimActive: false
  retryRequiresNewMessageKey: true
}

export type RegistrationAdmissionMarkResponse = {
  taskId: string
  messageId: string
  messageRequestKey: string
  admissionNoticeSent: true
  applied: boolean
}

export type RegistrationAdmissionBatchMutationResponse = {
  applied?: boolean
  batch: OpsRegistrationAdmissionBatch
  trackIds?: string[]
  enrollments?: OpsRegistrationEnrollment[]
}

export type RegistrationAdmissionBatchCompletionResponse = {
  batch: OpsRegistrationAdmissionBatch
  enrollments: OpsRegistrationEnrollment[]
}

export type RegistrationEnrollmentMutationResponse = {
  applied?: boolean
  enrollment: OpsRegistrationEnrollment
  track?: OpsRegistrationTrackSummary
}

export type RegistrationMigrationReviewResponse = {
  taskId: string
  tracks: OpsRegistrationTrackSummary[]
}

export type StudentClassRosterModeResponse = {
  studentId: string
  classId: string
  previousMode: "enrolled" | "waitlist" | "removed"
  nextMode: "enrolled" | "waitlist" | "removed"
  changed: boolean
  studentClassIds: string[]
  studentWaitlistClassIds: string[]
  classStudentIds: string[]
  classWaitlistIds: string[]
}

export type RegistrationEnrollmentRowInput = {
  id?: string
  classId: string
  textbookId?: string | null
  classStartDate?: string | null
  classStartSessionKey?: string | null
  classStartSession?: string | null
  sortOrder: number
}

export type CreateRegistrationCaseInput = {
  studentName: string; schoolGrade: string; schoolName: string; parentPhone: string
  studentPhone: string; campus: string; inquiryAt: string; subjects: RegistrationSubject[]
  requestNote: string; priority: string; requestKey: string
}
export type RegistrationCaseCreateWithInitialWorkflowInput =
  CreateRegistrationCaseInput & RegistrationInitialWorkflowPayload
export type SyncRegistrationCaseSubjectsInput = { taskId: string; subjects: RegistrationSubject[]; requestKey: string }
export type UpdateRegistrationCaseCommonInput = {
  taskId: string; studentName: string; schoolGrade: string; schoolName: string
  parentPhone: string; studentPhone: string; campus: string; inquiryAt: string
  requestNote: string; priority: string; expectedCommonRevision: number; requestKey: string
}
export type RouteRegistrationInquiryInput = {
  trackId: string; destination: "consultation_waiting" | "waiting" | "inquiry_closed"
  waitingKind: RegistrationWaitingKind; classId: string; requestKey: string
}
export type AssignRegistrationTrackDirectorInput = {
  trackId: string; directorProfileId: string | null; assignmentSource: "default" | "manual" | "clear_default"
  ruleKey: string | null; expectedCommonRevision: number; requestKey: string
}
export type SaveRegistrationSharedAppointmentInput = {
  appointmentId: string | null; taskId: string; kind: OpsRegistrationAppointment["kind"]
  scheduledAt: string; place: string; trackIds: string[]; replaceRemaining: boolean
  expectedNotificationRevision: number | null; requestKey: string
}
export type CancelRegistrationAppointmentInput = {
  appointmentId: string; expectedNotificationRevision: number; reason: string; requestKey: string
}
export type StartRegistrationLevelTestAttemptInput = { attemptId: string; requestKey: string }
export type CompleteRegistrationLevelTestAttemptInput = {
  attemptId: string; status: "completed" | "absent" | "canceled"; materialLink: string; requestKey: string
}
export type CloseRegistrationLevelTestTrackInput = { trackId: string; reason: string; requestKey: string }
export type CompleteRegistrationConsultationInput = {
  consultationId: string; outcome: "enrollment" | "waiting" | "not_registered"
  waitingKind: RegistrationWaitingKind; classId: string; requestKey: string
}
export type TransitionRegistrationWaitingInput = {
  trackId: string
  action: "change_waiting_kind" | "record_retest_required" | "move_to_enrollment" | "close_not_registered"
  waitingKind: RegistrationWaitingKind; classId: string
  retakeDecision: "" | "required" | "not_required"; reason: string; requestKey: string
}
export type RouteRegistrationEnrollmentDecisionInput = {
  trackId: string; destination: "waiting" | "not_registered"; waitingKind: RegistrationWaitingKind
  classId: string; reason: string; requestKey: string
}
export type SaveRegistrationEnrollmentRowsInput = {
  trackId: string; rows: RegistrationEnrollmentRowInput[]; requestKey: string
}
export type ClaimRegistrationAdmissionMessageInput = { taskId: string; messageRequestKey: string }
export type ReconcileRegistrationAdmissionMessageInput = {
  messageId: string; resolution: "accepted" | "failed"
  providerEvidence: RegistrationAdmissionProviderEvidence; reason: string; requestKey: string
}
export type ReleaseRegistrationAdmissionMessageRetryInput = {
  messageId: string; providerEvidence: RegistrationAdmissionProviderEvidence; reason: string; requestKey: string
}
export type MarkRegistrationAdmissionNoticeSentInput = {
  taskId: string; messageRequestKey: string; requestKey: string
}
export type StartRegistrationAdmissionBatchInput = {
  taskId: string; trackIds: string[]; enrollmentIds: string[]; requestKey: string
}
export type SetRegistrationEnrollmentMakeeduInput = {
  enrollmentId: string; registered: boolean; requestKey: string
}
export type AdvanceRegistrationAdmissionBatchInput = {
  batchId: string; action: "invoice_sent" | "payment_confirmed"; requestKey: string
}
export type CancelRegistrationAdmissionBatchInput = {
  batchId: string; resolutions: Array<Record<string, unknown>>; reason: string; requestKey: string
}
export type CompleteRegistrationAdmissionBatchInput = { batchId: string; requestKey: string }
export type CancelRegistrationEnrollmentInput = {
  enrollmentId: string; destination: "" | "enrollment_decided" | "waiting" | "not_registered"
  waitingKind: RegistrationWaitingKind; classId: string; reason: string; requestKey: string
}
export type ResolveRegistrationMigrationReviewInput = {
  taskId: string
  assignments: Array<Record<string, unknown>>
  trackStates: Array<Record<string, unknown>>
  requestKey: string
}
export type ReopenRegistrationTrackInput = {
  trackId: string; destination: "inquiry" | "consultation_waiting"; reason: string; requestKey: string
}
export type SetStudentClassRosterModeInput = {
  studentId: string; classId: string; nextMode: "enrolled" | "waitlist" | "removed"
  expectedMode: "enrolled" | "waitlist" | "removed"; memo: string
}

export type RegistrationPerformanceSink = {
  mark: (name: string) => void
  measure: (name: string, startMark: string, endMark: string) => void
}

export type RegistrationMeasure = {
  name: string
  cacheHit: boolean
  queryCount: number
  ok: boolean
}

type QueryResult = { data: unknown; error: unknown }
type QueryBuilder = PromiseLike<QueryResult> & {
  select: (columns: string, options?: Record<string, unknown>) => QueryBuilder
  eq: (column: string, value: unknown) => QueryBuilder
  in: (column: string, values: unknown[]) => QueryBuilder
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder
  limit: (count: number) => QueryBuilder
  single: () => QueryBuilder
}

export type RegistrationTrackClient = {
  from: (table: string) => QueryBuilder
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<QueryResult>
}

export type RegistrationTrackServiceOptions = {
  probeRuntime: () => Promise<RegistrationRuntimeState>
  invalidateRuntimeAfterReadyFailure?: (error: unknown) => never
  performance?: RegistrationPerformanceSink
  recordMeasure?: (measure: RegistrationMeasure) => void
  now?: () => number
  randomUUID?: () => string
  onMutationSuccess?: () => void
}

const TRACK_SUMMARY_COLUMNS = [
  "id",
  "task_id",
  "subject",
  "pipeline_status",
  "director_profile_id",
  "director_assignment_source",
  "director_assignment_rule_key",
  "waiting_kind",
  "level_test_retake_decision",
  "migration_review_required",
  "stage_entered_at",
  "phone_ready_at",
  "phone_ready_source",
  "updated_at",
  "visit_scheduled_at",
  "visit_place",
].join(",")

const TASK_SCOPED_CASE_READS = [
  ["ops_registration_subject_tracks", "*,director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)"],
  ["ops_registration_appointments", "*"],
  ["ops_registration_admission_batches", "*"],
] as const

const TRACK_SCOPED_CASE_READS = [
  ["ops_registration_level_tests", "*"],
  ["ops_registration_consultations", "*"],
  ["ops_registration_enrollments", "*"],
] as const

const PARENT_DETAIL_COLUMNS = "*,ops_registration_details(*),ops_task_comments(*),ops_task_attachments(*)"
const EVENT_COLUMNS = "id,task_id,actor_id,event_type,field_name,before_value,after_value,created_at"
const MESSAGE_COLUMNS = "id,status,claim_active,template_key,request_key,updated_at"

function value(row: Row | null | undefined, snake: string, camel = "") {
  if (!row) return undefined
  if (Object.prototype.hasOwnProperty.call(row, snake)) return row[snake]
  if (camel && Object.prototype.hasOwnProperty.call(row, camel)) return row[camel]
  return undefined
}

function text(input: unknown) {
  return input === null || input === undefined ? "" : String(input).trim()
}

function nullableText(input: unknown) {
  const normalized = text(input)
  return normalized || null
}

function bool(input: unknown) {
  return input === true
}

function numberValue(input: unknown) {
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : 0
}

function rows(input: unknown): Row[] {
  if (!Array.isArray(input)) return []
  return input.filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
}

function firstRow(input: unknown): Row | null {
  if (Array.isArray(input)) return (input[0] as Row | undefined) || null
  return input && typeof input === "object" ? input as Row : null
}

function stringList(input: unknown) {
  return Array.isArray(input) ? input.map(text).filter(Boolean) : []
}

function subject(input: unknown): RegistrationSubject {
  return text(input) === "수학" ? "수학" : "영어"
}

function trackStatus(input: unknown): OpsRegistrationTrackStatus {
  return (text(input) || "inquiry") as OpsRegistrationTrackStatus
}

function waitingKind(input: unknown): RegistrationWaitingKind {
  const normalized = text(input)
  return (["current_class", "current_term_opening", "next_term_opening"].includes(normalized)
    ? normalized
    : "") as RegistrationWaitingKind
}

function directorSource(input: unknown): OpsRegistrationTrackSummary["directorAssignmentSource"] {
  const normalized = text(input)
  return (["default", "manual", "migration"].includes(normalized) ? normalized : "") as OpsRegistrationTrackSummary["directorAssignmentSource"]
}

function retakeDecision(input: unknown): OpsRegistrationTrackSummary["levelTestRetakeDecision"] {
  const normalized = text(input)
  return (["required", "not_required"].includes(normalized) ? normalized : "") as OpsRegistrationTrackSummary["levelTestRetakeDecision"]
}

function phoneReadySource(input: unknown): RegistrationPhoneReadySource | null {
  const normalized = text(input)
  return ([
    "inquiry",
    "level_test_completion",
    "visit_reopened",
    "director_resolved",
    "track_reopened",
    "migration",
    "legacy",
  ].includes(normalized) ? normalized : null) as RegistrationPhoneReadySource | null
}

function embeddedDirector(row: Row) {
  const raw = value(row, "director")
  return firstRow(raw)
}

function mapTrack(row: Row, directorNames = new Map<string, string>(), legacy = false): OpsRegistrationTrackSummary {
  const directorProfileId = nullableText(value(row, "director_profile_id", "directorProfileId"))
  const director = embeddedDirector(row)
  const visitScheduledAt = text(value(row, "visit_scheduled_at", "visitScheduledAt"))
  const visitPlace = text(value(row, "visit_place", "visitPlace"))
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    subject: subject(value(row, "subject")),
    status: trackStatus(value(row, "pipeline_status", "status")),
    legacy,
    directorProfileId,
    directorName: directorProfileId
      ? text(value(director, "name")) || directorNames.get(directorProfileId) || ""
      : "",
    directorAssignmentSource: directorSource(value(row, "director_assignment_source", "directorAssignmentSource")),
    directorAssignmentRuleKey: text(value(row, "director_assignment_rule_key", "directorAssignmentRuleKey")),
    waitingKind: waitingKind(value(row, "waiting_kind", "waitingKind")),
    levelTestRetakeDecision: retakeDecision(value(row, "level_test_retake_decision", "levelTestRetakeDecision")),
    migrationReviewRequired: bool(value(row, "migration_review_required", "migrationReviewRequired")),
    stageEnteredAt: text(value(row, "stage_entered_at", "stageEnteredAt")),
    phoneReadyAt: nullableText(value(row, "phone_ready_at", "phoneReadyAt")),
    phoneReadySource: phoneReadySource(value(row, "phone_ready_source", "phoneReadySource")),
    ...(visitScheduledAt ? { visitScheduledAt, visitPlace } : {}),
  }
}

function mapEnrollment(row: Row): OpsRegistrationEnrollment {
  const releaseKind = nullableText(value(row, "roster_release_kind", "rosterReleaseKind"))
  return {
    id: text(value(row, "id")),
    trackId: text(value(row, "track_id", "trackId")),
    studentId: nullableText(value(row, "student_id", "studentId")),
    admissionBatchId: nullableText(value(row, "admission_batch_id", "admissionBatchId")),
    classId: text(value(row, "class_id", "classId")),
    textbookId: nullableText(value(row, "textbook_id", "textbookId")),
    classStartDate: nullableText(value(row, "class_start_date", "classStartDate")),
    classStartSessionKey: nullableText(value(row, "class_start_session_key", "classStartSessionKey")),
    classStartSession: nullableText(value(row, "class_start_session", "classStartSession")),
    status: (text(value(row, "status")) || "planned") as OpsRegistrationEnrollment["status"],
    makeeduRegistered: bool(value(row, "makeedu_registered", "makeeduRegistered")),
    rosterActive: bool(value(row, "roster_active", "rosterActive")),
    rosterReleasedAt: nullableText(value(row, "roster_released_at", "rosterReleasedAt")),
    rosterReleaseReason: nullableText(value(row, "roster_release_reason", "rosterReleaseReason")),
    rosterReleaseSourceTaskId: nullableText(value(row, "roster_release_source_task_id", "rosterReleaseSourceTaskId")),
    rosterReleaseKind: releaseKind === "withdrawal" || releaseKind === "transfer" ? releaseKind : null,
    sortOrder: numberValue(value(row, "sort_order", "sortOrder")),
    createdAt: text(value(row, "created_at", "createdAt")),
    updatedAt: text(value(row, "updated_at", "updatedAt")),
  }
}

function mapAppointment(row: Row): OpsRegistrationAppointment {
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    kind: (text(value(row, "kind")) || "level_test") as OpsRegistrationAppointment["kind"],
    scheduledAt: text(value(row, "scheduled_at", "scheduledAt")),
    place: text(value(row, "place")),
    status: (text(value(row, "status")) || "scheduled") as OpsRegistrationAppointment["status"],
    notificationRevision: numberValue(value(row, "notification_revision", "notificationRevision")),
    createdAt: text(value(row, "created_at", "createdAt")),
    updatedAt: text(value(row, "updated_at", "updatedAt")),
  }
}

function mapLevelTest(row: Row): OpsRegistrationLevelTest {
  return {
    id: text(value(row, "id")),
    trackId: text(value(row, "track_id", "trackId")),
    appointmentId: text(value(row, "appointment_id", "appointmentId")),
    attemptNumber: numberValue(value(row, "attempt_number", "attemptNumber")),
    status: (text(value(row, "status")) || "scheduled") as OpsRegistrationLevelTest["status"],
    startedAt: nullableText(value(row, "started_at", "startedAt")),
    completedAt: nullableText(value(row, "completed_at", "completedAt")),
    materialLink: nullableText(value(row, "material_link", "materialLink")),
  }
}

function mapConsultation(row: Row): OpsRegistrationConsultation {
  const outcome = nullableText(value(row, "outcome"))
  return {
    id: text(value(row, "id")),
    trackId: text(value(row, "track_id", "trackId")),
    appointmentId: nullableText(value(row, "appointment_id", "appointmentId")),
    mode: (text(value(row, "mode")) || "phone") as OpsRegistrationConsultation["mode"],
    status: (text(value(row, "status")) || "waiting") as OpsRegistrationConsultation["status"],
    directorProfileId: text(value(row, "director_profile_id", "directorProfileId")),
    readyAt: nullableText(value(row, "ready_at", "readyAt")),
    readySource: phoneReadySource(value(row, "ready_source", "readySource")),
    completedAt: nullableText(value(row, "completed_at", "completedAt")),
    outcome: (["enrollment", "waiting", "not_registered"].includes(outcome || "") ? outcome : null) as OpsRegistrationConsultation["outcome"],
    createdAt: text(value(row, "created_at", "createdAt")),
    updatedAt: text(value(row, "updated_at", "updatedAt")),
  }
}

function mapBatch(row: Row): OpsRegistrationAdmissionBatch {
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    revisionNumber: numberValue(value(row, "revision_number", "revisionNumber")),
    status: (text(value(row, "status")) || "draft") as OpsRegistrationAdmissionBatch["status"],
    invoiceSentAt: nullableText(value(row, "invoice_sent_at", "invoiceSentAt")),
    paymentConfirmedAt: nullableText(value(row, "payment_confirmed_at", "paymentConfirmedAt")),
    createdAt: text(value(row, "created_at", "createdAt")),
    updatedAt: text(value(row, "updated_at", "updatedAt")),
  }
}

function parseJsonRecord(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input !== "string") return null
  try {
    const parsed = JSON.parse(input) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function mapTrackEvent(row: Row): OpsRegistrationTrackEvent {
  const payload = parseJsonRecord(value(row, "after_value", "afterValue"))
  const canonical = payload && numberValue(payload.version) === 1 ? payload : null
  const rawSubject = canonical ? nullableText(canonical.subject) : null
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    trackId: canonical ? nullableText(canonical.trackId) : null,
    eventType: canonical ? text(canonical.eventType) || text(value(row, "event_type", "eventType")) : text(value(row, "event_type", "eventType")),
    subject: rawSubject === "영어" || rawSubject === "수학" ? rawSubject : null,
    source: canonical ? nullableText(canonical.source) : null,
    destination: canonical ? nullableText(canonical.destination) : null,
    reason: canonical ? nullableText(canonical.reason) : null,
    metadata: canonical
      ? parseJsonRecord(canonical.metadata) || {}
      : {
          fieldName: text(value(row, "field_name", "fieldName")),
          beforeValue: nullableText(value(row, "before_value", "beforeValue")),
          afterValue: nullableText(value(row, "after_value", "afterValue")),
        },
    actorId: canonical ? nullableText(canonical.actorId) : nullableText(value(row, "actor_id", "actorId")),
    occurredAt: canonical ? text(canonical.occurredAt) || text(value(row, "created_at", "createdAt")) : text(value(row, "created_at", "createdAt")),
    legacyText: canonical ? null : nullableText(value(row, "after_value", "afterValue")),
  }
}

function buildRegistrationMigrationLegacySnapshot(
  parentRow: Row,
  detailRow: Row,
  eventRows: Row[],
): OpsRegistrationMigrationLegacySnapshot {
  const importRow = eventRows.find((row) => {
    if (text(value(row, "event_type", "eventType")) !== "legacy_registration_imported") return false
    const after = parseJsonRecord(value(row, "after_value", "afterValue"))
    return after && numberValue(after.version) === 1
  }) || null
  const before = parseJsonRecord(value(importRow, "before_value", "beforeValue")) || {}
  const after = parseJsonRecord(value(importRow, "after_value", "afterValue")) || {}
  const timestamps = parseJsonRecord(after.timestamps) || {}
  const legacyBooleans = parseJsonRecord(after.legacyBooleans) || {}
  const studentId = text(before.studentId)
  const classId = text(before.classId)
  const textbookId = text(before.textbookId)
  const levelTestAt = text(timestamps.levelTestAt)
  const levelTestCompletedAt = text(timestamps.levelTestCompletedAt)
  const phoneConsultationAt = text(timestamps.phoneConsultationAt)
  const visitConsultationAt = text(timestamps.visitConsultationAt)
  const consultationAt = text(timestamps.consultationAt)
  const classStartDate = text(timestamps.classStartDate)
  const classStartSession = text(timestamps.classStartSession)
  const levelTestPlace = text(value(detailRow, "level_test_place", "levelTestPlace"))
  const levelTestMaterialLink = text(value(detailRow, "level_test_material_link", "levelTestMaterialLink"))
  const levelTestResult = text(value(detailRow, "level_test_result", "levelTestResult"))
  const visitConsultationPlace = text(value(detailRow, "visit_consultation_place", "visitConsultationPlace"))
  const admissionNoticeSent = bool(legacyBooleans.admissionNoticeSent)
  const makeeduRegistered = bool(legacyBooleans.makeeduRegistered)
  const makeeduInvoiceSent = bool(legacyBooleans.makeeduInvoiceSent)
  const paymentChecked = bool(legacyBooleans.paymentChecked)

  return {
    snapshotMissing: !importRow,
    pipelineStatus: text(before.pipelineStatus),
    studentId,
    classId,
    textbookId,
    currentStudentId: text(value(parentRow, "student_id", "studentId")),
    currentClassId: text(value(parentRow, "class_id", "classId")),
    currentTextbookId: text(value(parentRow, "textbook_id", "textbookId")),
    levelTestAt,
    levelTestCompletedAt,
    phoneConsultationAt,
    visitConsultationAt,
    consultationAt,
    classStartDate,
    classStartSession,
    levelTestPlace,
    levelTestMaterialLink,
    levelTestResult,
    visitConsultationPlace,
    admissionNoticeSent,
    makeeduRegistered,
    makeeduInvoiceSent,
    paymentChecked,
    groups: {
      levelTest: Boolean(levelTestAt || levelTestCompletedAt || levelTestPlace || levelTestMaterialLink || levelTestResult),
      consultation: Boolean(visitConsultationAt || consultationAt || visitConsultationPlace || phoneConsultationAt),
      placement: Boolean(
        studentId || classId || textbookId || classStartDate || classStartSession
        || admissionNoticeSent || makeeduRegistered || makeeduInvoiceSent || paymentChecked
      ),
    },
  }
}

function mapComment(row: Row): OpsTaskComment {
  const authorId = text(value(row, "author_id", "authorId"))
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    authorId,
    authorLabel: text(value(row, "author_label", "authorLabel")) || authorId,
    body: text(value(row, "body")),
    createdAt: text(value(row, "created_at", "createdAt")),
  }
}

function mapAttachment(row: Row): OpsTaskAttachment {
  const uploadedBy = text(value(row, "uploaded_by", "uploadedBy"))
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    fileName: text(value(row, "file_name", "fileName")),
    fileKind: text(value(row, "file_kind", "fileKind")),
    driveFileId: text(value(row, "drive_file_id", "driveFileId")),
    driveLink: text(value(row, "drive_link", "driveLink")),
    uploadedBy,
    uploadedByLabel: text(value(row, "uploaded_by_label", "uploadedByLabel")) || uploadedBy,
    uploadedAt: text(value(row, "uploaded_at", "uploadedAt")),
  }
}

function mapTask(row: Row, detail: Row, comments: OpsTaskComment[], attachments: OpsTaskAttachment[]): OpsTask {
  return {
    id: text(value(row, "id")),
    title: text(value(row, "title")),
    type: "registration",
    status: (text(value(row, "status")) || "requested") as OpsTask["status"],
    priority: (text(value(row, "priority")) || "normal") as OpsTask["priority"],
    requestedBy: text(value(row, "requested_by", "requestedBy")),
    requestedByLabel: text(value(row, "requested_by_label", "requestedByLabel")),
    requestedTeam: text(value(row, "requested_team", "requestedTeam")),
    assigneeId: text(value(row, "assignee_id", "assigneeId")),
    assigneeLabel: text(value(row, "assignee_label", "assigneeLabel")),
    assigneeTeam: text(value(row, "assignee_team", "assigneeTeam")),
    secondaryAssigneeId: text(value(row, "secondary_assignee_id", "secondaryAssigneeId")),
    secondaryAssigneeLabel: text(value(row, "secondary_assignee_label", "secondaryAssigneeLabel")),
    studentId: text(value(row, "student_id", "studentId")),
    studentName: text(value(row, "student_name", "studentName")),
    classId: text(value(row, "class_id", "classId")),
    className: text(value(row, "class_name", "className")),
    textbookId: text(value(row, "textbook_id", "textbookId")),
    textbookTitle: text(value(row, "textbook_title", "textbookTitle")),
    campus: text(value(row, "campus")),
    subject: text(value(row, "subject")),
    startAt: text(value(row, "start_at", "startAt")),
    dueAt: text(value(row, "due_at", "dueAt")),
    completedAt: text(value(row, "completed_at", "completedAt")),
    memo: text(value(row, "memo")),
    createdAt: text(value(row, "created_at", "createdAt")),
    updatedAt: text(value(row, "updated_at", "updatedAt")),
    registration: {
      pipelineStatus: text(value(detail, "pipeline_status", "pipelineStatus")),
      inquiryAt: text(value(detail, "inquiry_at", "inquiryAt")),
      schoolGrade: text(value(detail, "school_grade", "schoolGrade")),
      schoolName: text(value(detail, "school_name", "schoolName")),
      parentPhone: text(value(detail, "parent_phone", "parentPhone")),
      studentPhone: text(value(detail, "student_phone", "studentPhone")),
      requestNote: text(value(detail, "request_note", "requestNote")),
      admissionNoticeSent: bool(value(detail, "admission_notice_sent", "admissionNoticeSent")),
    },
    comments,
    attachments,
    events: [],
  }
}

function normalizeUuid(input: unknown) {
  return nullableText(input)
}

function requireRequestKey(input: unknown) {
  const requestKey = text(input)
  if (!requestKey) throw new Error("A non-empty request key is required.")
  return requestKey
}

function requireMessageRequestKey(input: unknown) {
  const requestKey = text(input)
  if (!requestKey) throw new Error("A non-empty message request key is required.")
  return requestKey
}

function requireViewerId(input: unknown) {
  const viewerId = text(input)
  if (!viewerId) throw new Error("A non-empty viewer ID is required.")
  return viewerId
}

export function createRegistrationMutationRequestKey(kind: string, entityId = "") {
  return `${text(kind)}:${text(entityId) || "new"}:${crypto.randomUUID()}`
}

function missingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? text(error.code).toUpperCase() : ""
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(code)) return true
  const message = "message" in error ? text(error.message).toLowerCase() : ""
  return (
    (message.includes("ops_registration_") || message.includes("registration_subject_tracks_runtime_version"))
    && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
  )
}

function missingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? text(error.code).toUpperCase() : ""
  if (code === "42703" || code === "PGRST204") return true
  const message = "message" in error ? text(error.message).toLowerCase() : ""
  return message.includes("column") && (message.includes("does not exist") || message.includes("schema cache"))
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return text(error.message)
  return text(error) || "선택 정보를 불러오지 못했습니다."
}

function isClearlyInactiveStatus(input: unknown) {
  const normalized = text(input).toLowerCase()
  return ["inactive", "archived", "disabled", "미사용", "비활성", "폐강", "종료"].includes(normalized)
}

export function createRegistrationTrackService(
  client: RegistrationTrackClient,
  options: RegistrationTrackServiceOptions,
) {
  if (!options || typeof options.probeRuntime !== "function") {
    throw new Error("probeRuntime is required.")
  }

  const summaryCache = new Map<string, RegistrationTrackSummaryLoadResult>()
  const summaryInFlight = new Map<string, Promise<RegistrationTrackSummaryLoadResult>>()
  const summaryEpochs = new Map<string, number>()
  const detailCache = new Map<string, OpsRegistrationCaseDetail>()
  const detailInFlight = new Map<string, Promise<OpsRegistrationCaseDetail>>()
  const detailEpochs = new Map<string, number>()
  const optionCache = new Map<string, OpsRegistrationWorkspaceOptionData>()
  const optionInFlight = new Map<string, Promise<OpsRegistrationWorkspaceOptionData>>()
  const optionEpochs = new Map<string, number>()
  let cacheGeneration = 0
  let measureSequence = 0

  function clearCaches() {
    cacheGeneration += 1
    summaryCache.clear()
    summaryInFlight.clear()
    summaryEpochs.clear()
    detailCache.clear()
    detailInFlight.clear()
    detailEpochs.clear()
    optionCache.clear()
    optionInFlight.clear()
    optionEpochs.clear()
  }

  function advanceEpoch(epochs: Map<string, number>, cacheKey: string) {
    const nextEpoch = (epochs.get(cacheKey) || 0) + 1
    epochs.set(cacheKey, nextEpoch)
    return nextEpoch
  }

  function measure<T>(
    name: string,
    cacheHit: boolean,
    work: (metrics: { queryCount: number }) => Promise<T>,
  ): Promise<T> {
    const metrics = { queryCount: 0 }
    measureSequence += 1
    const startMark = `${name}:start:${measureSequence}`
    const endMark = `${name}:end:${measureSequence}`
    options.performance?.mark(startMark)
    let ok = false
    return work(metrics)
      .then((result) => {
        ok = true
        return result
      })
      .finally(() => {
        options.performance?.mark(endMark)
        options.performance?.measure(name, startMark, endMark)
        options.recordMeasure?.({ name, cacheHit, queryCount: metrics.queryCount, ok })
      })
  }

  async function queryRows(builder: QueryBuilder, metrics: { queryCount: number }) {
    metrics.queryCount += 1
    const { data, error } = await builder
    if (error) throw error
    return rows(data)
  }

  async function queryOne(builder: QueryBuilder, metrics: { queryCount: number }) {
    metrics.queryCount += 1
    const { data, error } = await builder
    if (error) throw error
    const row = firstRow(data)
    if (!row) throw new Error("등록 업무를 찾을 수 없습니다.")
    return row
  }

  function invalidateReadyRuntime(error: unknown): never {
    clearCaches()
    if (options.invalidateRuntimeAfterReadyFailure) {
      return options.invalidateRuntimeAfterReadyFailure(error)
    }
    const integrity = new Error("Registration runtime readiness does not match the deployed schema.") as Error & { code?: string; cause?: unknown }
    integrity.name = "RegistrationRuntimeIntegrityError"
    integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR"
    integrity.cause = error
    throw integrity
  }

  async function probeRuntime() {
    return options.probeRuntime()
  }

  async function requireReadyRuntime() {
    const runtime = await probeRuntime()
    if (runtime.mode === "maintenance") throw new Error("데이터 전환 중")
    if (runtime.mode !== "ready" || runtime.version !== 1) {
      throw new Error("레거시 등록 흐름에서는 새 등록 작업을 실행할 수 없습니다.")
    }
    return runtime
  }

  function createLegacyTrackSummaries(inputs: Array<{
    taskId: string
    subjects: RegistrationSubject[]
    status: OpsRegistrationTrackStatus
    directorName?: string
    stageEnteredAt?: string
  }>) {
    return inputs.flatMap((input) => input.subjects.map((entry) => ({
      id: `legacy:${input.taskId}:${entry}`,
      taskId: input.taskId,
      subject: entry,
      status: input.status,
      legacy: true,
      directorProfileId: null,
      directorName: input.directorName || "",
      directorAssignmentSource: "" as const,
      directorAssignmentRuleKey: "",
      waitingKind: "" as const,
      levelTestRetakeDecision: "" as const,
      migrationReviewRequired: false,
      stageEnteredAt: input.stageEnteredAt || "",
      phoneReadyAt: null,
      phoneReadySource: null,
    } satisfies OpsRegistrationTrackSummary)))
  }

  function loadTrackSummaries(
    taskIds: string[],
    viewerId: string,
    loadOptions: { force?: boolean } = {},
  ): Promise<RegistrationTrackSummaryLoadResult> {
    const normalizedTaskIds = [...new Set(taskIds.map(text).filter(Boolean))].sort()
    const cacheKey = `${requireViewerId(viewerId)}:${normalizedTaskIds.join(",")}`
    if (loadOptions.force) {
      advanceEpoch(summaryEpochs, cacheKey)
      summaryCache.delete(cacheKey)
      summaryInFlight.delete(cacheKey)
    }
    const cached = summaryCache.get(cacheKey)
    if (cached) return measure("registration:track-summary", true, async () => cached)
    const pending = summaryInFlight.get(cacheKey)
    if (pending) return pending
    const generation = cacheGeneration
    const requestEpoch = summaryEpochs.get(cacheKey) || 0

    const request = measure<RegistrationTrackSummaryLoadResult>("registration:track-summary", false, async (metrics) => {
      const runtime = await probeRuntime()
      if (runtime.mode !== "ready" || runtime.version !== 1) {
        return { mode: runtime.mode, tracks: [] } as RegistrationTrackSummaryLoadResult
      }
      if (normalizedTaskIds.length === 0) return { mode: "ready", tracks: [] }

      try {
        const trackRows = await queryRows(
          client.from("ops_registration_subject_track_summaries")
            .select(TRACK_SUMMARY_COLUMNS)
            .in("task_id", normalizedTaskIds),
          metrics,
        )
        const directorIds = [...new Set(trackRows
          .map((row) => nullableText(value(row, "director_profile_id")))
          .filter((id): id is string => Boolean(id)))]
        const directorNames = new Map<string, string>()
        if (directorIds.length > 0) {
          const profileRows = await queryRows(
            client.from("profiles").select("id,name").in("id", directorIds),
            metrics,
          )
          for (const row of profileRows) directorNames.set(text(value(row, "id")), text(value(row, "name")))
        }
        return {
          mode: "ready",
          tracks: trackRows.map((row) => mapTrack(row, directorNames, false)),
        }
      } catch (error) {
        if (missingSchemaError(error)) return invalidateReadyRuntime(error)
        throw error
      }
      })
      .then((result) => {
        if (
          generation === cacheGeneration
          && requestEpoch === (summaryEpochs.get(cacheKey) || 0)
        ) summaryCache.set(cacheKey, result)
        return result
      })
      .finally(() => {
        if (summaryInFlight.get(cacheKey) === request) summaryInFlight.delete(cacheKey)
      })
    summaryInFlight.set(cacheKey, request)
    return request
  }

  function loadCaseDetail(
    taskId: string,
    viewerId: string,
    loadOptions: { force?: boolean } = {},
  ): Promise<OpsRegistrationCaseDetail> {
    const safeTaskId = text(taskId)
    const cacheKey = `${requireViewerId(viewerId)}:${safeTaskId}`
    if (loadOptions.force) {
      advanceEpoch(detailEpochs, cacheKey)
      detailCache.delete(cacheKey)
      detailInFlight.delete(cacheKey)
    }
    const cached = detailCache.get(cacheKey)
    if (cached) return measure("registration:case-detail", true, async () => cached)
    const pending = detailInFlight.get(cacheKey)
    if (pending) return pending
    const generation = cacheGeneration
    const requestEpoch = detailEpochs.get(cacheKey) || 0

    const request = measure("registration:case-detail", false, async (metrics) => {
      await requireReadyRuntime()
      try {
        const phaseOne = await Promise.all([
          queryOne(
            client.from("ops_tasks").select(PARENT_DETAIL_COLUMNS).eq("id", safeTaskId).single(),
            metrics,
          ),
          ...TASK_SCOPED_CASE_READS.map(([table, columns]) => queryRows(
            client.from(table).select(columns).eq("task_id", safeTaskId),
            metrics,
          )),
          queryRows(
            client.from("ops_task_events").select(EVENT_COLUMNS).eq("task_id", safeTaskId),
            metrics,
          ),
          queryRows(
            client.from("ops_registration_messages")
              .select(MESSAGE_COLUMNS)
              .eq("task_id", safeTaskId)
              .eq("template_key", "admission_application")
              .eq("claim_active", true)
              .limit(1),
            metrics,
          ),
        ])
        const [parentRow, trackRows, appointmentRows, batchRows, eventRows, messageRows] = phaseOne as [
          Row, Row[], Row[], Row[], Row[], Row[],
        ]
        const trackIds = trackRows.map((row) => text(value(row, "id"))).filter(Boolean)
        const [levelTestRows, consultationRows, enrollmentRows] = await Promise.all(
          TRACK_SCOPED_CASE_READS.map(([table, columns]) => queryRows(
            client.from(table).select(columns).in("track_id", trackIds),
            metrics,
          )),
        )
        const detailRow = firstRow(value(parentRow, "ops_registration_details")) || {}
        const comments = rows(value(parentRow, "ops_task_comments")).map(mapComment)
        const attachments = rows(value(parentRow, "ops_task_attachments")).map(mapAttachment)
        const tracks = trackRows.map((row) => mapTrack(row))
        const activeMessage = messageRows[0] || null
        const activeStatus = text(value(activeMessage, "status"))
        const messageStatus = activeStatus === "failed"
          ? "failed_hold"
          : (["pending", "accepted", "unknown"].includes(activeStatus) ? activeStatus : "")

        return {
          task: mapTask(parentRow, detailRow, comments, attachments),
          commonRevision: numberValue(value(detailRow, "common_revision", "commonRevision")),
          admissionApplicationMessageId: nullableText(value(activeMessage, "id")),
          admissionApplicationMessageStatus: messageStatus as OpsRegistrationCaseDetail["admissionApplicationMessageStatus"],
          admissionApplicationMessageClaimActive: bool(value(activeMessage, "claim_active", "claimActive")),
          admissionApplicationMessageUpdatedAt: nullableText(value(activeMessage, "updated_at", "updatedAt")),
          admissionApplicationAccepted: activeStatus === "accepted",
          comments,
          attachments,
          tracks,
          appointments: appointmentRows.map(mapAppointment),
          levelTests: levelTestRows.map(mapLevelTest),
          consultations: consultationRows.map(mapConsultation),
          admissionBatches: batchRows.map(mapBatch),
          enrollments: enrollmentRows.map(mapEnrollment),
          events: eventRows.map(mapTrackEvent),
          migrationLegacy: tracks.some((track) => track.migrationReviewRequired)
            ? buildRegistrationMigrationLegacySnapshot(parentRow, detailRow, eventRows)
            : null,
        }
      } catch (error) {
        if (missingSchemaError(error)) return invalidateReadyRuntime(error)
        throw error
      }
      })
      .then((result) => {
        if (
          generation === cacheGeneration
          && requestEpoch === (detailEpochs.get(cacheKey) || 0)
        ) detailCache.set(cacheKey, result)
        return result
      })
      .finally(() => {
        if (detailInFlight.get(cacheKey) === request) detailInFlight.delete(cacheKey)
      })
    detailInFlight.set(cacheKey, request)
    return request
  }

  async function readWithFallback(
    table: string,
    candidates: string[],
    metrics: { queryCount: number },
  ): Promise<{ rows: Row[]; fallback: boolean; error: unknown }> {
    for (let index = 0; index < candidates.length; index += 1) {
      try {
        return {
          rows: await queryRows(client.from(table).select(candidates[index]), metrics),
          fallback: index > 0,
          error: null,
        }
      } catch (error) {
        if (index < candidates.length - 1 && missingColumnError(error)) continue
        return { rows: [], fallback: index > 0, error }
      }
    }
    return { rows: [], fallback: true, error: null }
  }

  function loadWorkspaceOptionData(
    loadOptions: { viewerId: string; force?: boolean },
  ): Promise<OpsRegistrationWorkspaceOptionData> {
    const cacheKey = requireViewerId(loadOptions.viewerId)
    if (loadOptions.force) {
      advanceEpoch(optionEpochs, cacheKey)
      optionCache.delete(cacheKey)
      optionInFlight.delete(cacheKey)
    }
    const cached = optionCache.get(cacheKey)
    if (cached) return measure("registration:option-summary", true, async () => cached)
    const pending = optionInFlight.get(cacheKey)
    if (pending) return pending
    const generation = cacheGeneration
    const requestEpoch = optionEpochs.get(cacheKey) || 0

    const request = measure("registration:option-summary", false, async (metrics) => {
      const [profiles, classes, textbooks, teachers] = await Promise.all([
        readWithFallback("profiles", ["id,name,email,role,login_id", "id,name"], metrics),
        readWithFallback("classes", [
          "id,name,subject,grade,teacher,room,textbook_ids,status",
          "id,name,subject,grade,teacher,room,textbook_ids",
          "id,name,subject,grade,teacher,room",
        ], metrics),
        readWithFallback("textbooks", [
          "id,title,name,publisher,subject,status",
          "id,title,name,publisher,subject",
        ], metrics),
        readWithFallback("teacher_catalogs", [
          "id,name,subjects,is_visible,sort_order,profile_id,account_email",
          "id,name,subjects,is_visible,sort_order",
        ], metrics),
      ])
      const errors = [profiles.error, classes.error, textbooks.error, teachers.error].filter(Boolean)
      const profileIds = new Set(profiles.rows.map((row) => text(value(row, "id"))).filter(Boolean))
      const profileIdentityComplete = profiles.rows.every((row) => (
        Boolean(text(value(row, "id")))
        && Boolean(text(value(row, "name")))
        && Boolean(text(value(row, "role")))
        && Boolean(text(value(row, "email")) || text(value(row, "login_id", "loginId")))
      ))
      const teacherIdentityComplete = teachers.rows
        .filter((row) => value(row, "is_visible", "isVisible") !== false)
        .every((row) => {
          const profileId = text(value(row, "profile_id", "profileId"))
          return Boolean(
            text(value(row, "id"))
            && text(value(row, "name"))
            && profileId
            && text(value(row, "account_email", "accountEmail"))
            && profileIds.has(profileId)
          )
        })
      const directorCatalogStatus = profiles.error || teachers.error
        ? "error"
        : profiles.fallback || teachers.fallback || !profileIdentityComplete || !teacherIdentityComplete
          ? "partial"
          : "authoritative"
      const profileOptions = profiles.rows.map((row) => ({
        id: text(value(row, "id")),
        label: text(value(row, "name")) || text(value(row, "id")),
        email: text(value(row, "email")),
        loginId: text(value(row, "login_id", "loginId")),
        role: text(value(row, "role")),
      } satisfies OpsProfileOption))
      const classOptions = classes.rows
        .filter((row) => !isClearlyInactiveStatus(value(row, "status")))
        .map((row) => ({
          id: text(value(row, "id")),
          label: text(value(row, "name")) || text(value(row, "id")),
          meta: [text(value(row, "grade")), text(value(row, "teacher"))].filter(Boolean).join(" · "),
          subject: text(value(row, "subject")),
          grade: text(value(row, "grade")),
          teacher: text(value(row, "teacher")),
          room: text(value(row, "room")),
          schedule: "",
          studentIds: [],
          waitlistIds: [],
          textbookIds: stringList(value(row, "textbook_ids", "textbookIds")),
        } satisfies OpsClassOption))
      const textbookOptions = textbooks.rows
        .filter((row) => !isClearlyInactiveStatus(value(row, "status")))
        .map((row) => ({
          id: text(value(row, "id")),
          label: text(value(row, "title")) || text(value(row, "name")) || text(value(row, "id")),
          meta: [text(value(row, "publisher")), text(value(row, "subject"))].filter(Boolean).join(" · "),
          publisher: text(value(row, "publisher")),
          subject: text(value(row, "subject")),
        } satisfies OpsTextbookOption))
      const teacherOptions = teachers.rows
        .filter((row) => value(row, "is_visible", "isVisible") !== false)
        .map((row) => ({
          id: text(value(row, "id")),
          label: text(value(row, "name")) || text(value(row, "id")),
          meta: stringList(value(row, "subjects")).join(", "),
          subjects: stringList(value(row, "subjects")),
          profileId: text(value(row, "profile_id", "profileId")),
          accountEmail: text(value(row, "account_email", "accountEmail")),
          sortOrder: numberValue(value(row, "sort_order", "sortOrder")),
        } satisfies OpsTeacherOption))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, "ko"))

      return {
        profiles: profileOptions,
        students: [],
        classes: classOptions,
        textbooks: textbookOptions,
        teachers: teacherOptions,
        schemaReady: errors.length === 0,
        error: errors.length > 0 ? errorText(errors[0]) : null,
        directorCatalogStatus,
      } satisfies OpsRegistrationWorkspaceOptionData
      })
      .then((result) => {
        if (
          generation === cacheGeneration
          && requestEpoch === (optionEpochs.get(cacheKey) || 0)
        ) optionCache.set(cacheKey, result)
        return result
      })
      .finally(() => {
        if (optionInFlight.get(cacheKey) === request) optionInFlight.delete(cacheKey)
      })
    optionInFlight.set(cacheKey, request)
    return request
  }

  async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await requireReadyRuntime()
    const { data, error } = await client.rpc(name, args)
    if (error) throw error
    clearCaches()
    try {
      options.onMutationSuccess?.()
    } catch {
      // The database mutation already committed; cache-notification degradation
      // must not turn the response into a retryable business failure.
    }
    return data as T
  }

  async function createRegistrationCase(input: {
    studentName: string
    schoolGrade: string
    schoolName: string
    parentPhone: string
    studentPhone: string
    campus: string
    inquiryAt: string
    subjects: RegistrationSubject[]
    requestNote: string
    priority: string
    requestKey: string
  }): Promise<RegistrationCaseCreateResponse> {
    const result = await callRpc<RegistrationCaseCreateResponse>("create_registration_case", {
      p_student_name: input.studentName,
      p_school_grade: input.schoolGrade,
      p_school_name: input.schoolName,
      p_parent_phone: input.parentPhone,
      p_student_phone: input.studentPhone,
      p_campus: input.campus,
      p_inquiry_at: input.inquiryAt,
      p_subjects: input.subjects,
      p_request_note: input.requestNote,
      p_priority: input.priority,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      tracks: rows(value(result as unknown as Row, "tracks")).map((row) => mapTrack(row)),
    }
  }

  async function createRegistrationCaseWithInitialWorkflow(
    input: RegistrationCaseCreateWithInitialWorkflowInput,
  ): Promise<RegistrationCaseCreateWithInitialWorkflowResponse> {
    const result = await callRpc<RegistrationCaseCreateWithInitialWorkflowResponse>(
      "create_registration_case_with_initial_workflow_v1",
      {
        p_student_name: input.studentName,
        p_school_grade: input.schoolGrade,
        p_school_name: input.schoolName,
        p_parent_phone: input.parentPhone,
        p_student_phone: input.studentPhone,
        p_campus: input.campus,
        p_inquiry_at: input.inquiryAt,
        p_subjects: input.subjects,
        p_request_note: input.requestNote,
        p_priority: input.priority,
        p_subject_plans: input.subjectPlans,
        p_level_test_appointment: input.levelTestAppointment,
        p_visit_appointment: input.visitAppointment,
        p_director_overrides: input.directorOverrides,
        p_request_key: requireRequestKey(input.requestKey),
      },
    )
    return {
      ...result,
      tracks: rows(value(result as unknown as Row, "tracks")).map((row) => mapTrack(row)),
      appointments: rows(value(result as unknown as Row, "appointments")).map(mapAppointment),
    }
  }

  async function syncRegistrationCaseSubjects(input: {
    taskId: string
    subjects: RegistrationSubject[]
    requestKey: string
  }): Promise<RegistrationSubjectSyncResponse> {
    const result = await callRpc<RegistrationSubjectSyncResponse>("sync_registration_case_subjects", {
      p_task_id: input.taskId,
      p_subjects: input.subjects,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      tracks: rows(value(result as unknown as Row, "tracks")).map((row) => mapTrack(row)),
    }
  }

  async function updateRegistrationCaseCommon(input: {
    taskId: string
    studentName: string
    schoolGrade: string
    schoolName: string
    parentPhone: string
    studentPhone: string
    campus: string
    inquiryAt: string
    requestNote: string
    priority: string
    expectedCommonRevision: number
    requestKey: string
  }): Promise<RegistrationCommonUpdateResponse> {
    return callRpc<RegistrationCommonUpdateResponse>("update_registration_case_common", {
      p_task_id: input.taskId,
      p_student_name: input.studentName,
      p_school_grade: input.schoolGrade,
      p_school_name: nullableText(input.schoolName),
      p_parent_phone: input.parentPhone,
      p_student_phone: nullableText(input.studentPhone),
      p_campus: input.campus,
      p_inquiry_at: input.inquiryAt,
      p_request_note: nullableText(input.requestNote),
      p_priority: input.priority,
      p_expected_common_revision: input.expectedCommonRevision,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function routeRegistrationInquiry(input: {
    trackId: string
    destination: "consultation_waiting" | "waiting" | "inquiry_closed"
    waitingKind: RegistrationWaitingKind
    classId: string
    requestKey: string
  }): Promise<RegistrationTrackTransitionResponse> {
    return callRpc<RegistrationTrackTransitionResponse>("route_registration_inquiry", {
      p_track_id: input.trackId,
      p_destination: input.destination,
      p_waiting_kind: input.waitingKind || null,
      p_class_id: normalizeUuid(input.classId),
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function assignRegistrationTrackDirector(input: {
    trackId: string
    directorProfileId: string | null
    assignmentSource: "default" | "manual" | "clear_default"
    ruleKey: string | null
    expectedCommonRevision: number
    requestKey: string
  }): Promise<RegistrationDirectorAssignmentResponse> {
    return callRpc<RegistrationDirectorAssignmentResponse>("assign_registration_track_director", {
      p_track_id: input.trackId,
      p_director_profile_id: normalizeUuid(input.directorProfileId),
      p_assignment_source: input.assignmentSource,
      p_rule_key: input.ruleKey || null,
      p_expected_common_revision: input.expectedCommonRevision,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function saveRegistrationSharedAppointment(input: {
    appointmentId: string | null
    taskId: string
    kind: OpsRegistrationAppointment["kind"]
    scheduledAt: string
    place: string
    trackIds: string[]
    replaceRemaining: boolean
    expectedNotificationRevision: number | null
    requestKey: string
  }): Promise<RegistrationAppointmentMutationResponse> {
    return callRpc<RegistrationAppointmentMutationResponse>("save_registration_shared_appointment", {
      p_appointment_id: normalizeUuid(input.appointmentId),
      p_task_id: input.taskId,
      p_kind: input.kind,
      p_scheduled_at: input.scheduledAt,
      p_place: input.place,
      p_track_ids: input.trackIds,
      p_replace_remaining: input.replaceRemaining,
      p_expected_notification_revision: input.expectedNotificationRevision,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function cancelRegistrationAppointment(input: {
    appointmentId: string
    expectedNotificationRevision: number
    reason: string
    requestKey: string
  }): Promise<RegistrationAppointmentMutationResponse> {
    return callRpc<RegistrationAppointmentMutationResponse>("cancel_registration_appointment", {
      p_appointment_id: input.appointmentId,
      p_expected_notification_revision: input.expectedNotificationRevision,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function startRegistrationLevelTestAttempt(input: {
    attemptId: string
    requestKey: string
  }): Promise<RegistrationLevelTestMutationResponse> {
    return callRpc<RegistrationLevelTestMutationResponse>("start_registration_level_test_attempt", {
      p_attempt_id: input.attemptId,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function completeRegistrationLevelTestAttempt(input: {
    attemptId: string
    status: "completed" | "absent" | "canceled"
    materialLink: string
    requestKey: string
  }): Promise<RegistrationLevelTestMutationResponse> {
    return callRpc<RegistrationLevelTestMutationResponse>("complete_registration_level_test_attempt", {
      p_attempt_id: input.attemptId,
      p_status: input.status,
      p_material_link: input.materialLink || null,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function closeRegistrationLevelTestTrack(input: {
    trackId: string
    reason: string
    requestKey: string
  }): Promise<RegistrationTrackTransitionResponse> {
    return callRpc<RegistrationTrackTransitionResponse>("close_registration_level_test_track", {
      p_track_id: input.trackId,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function completeRegistrationConsultation(input: {
    consultationId: string
    outcome: "enrollment" | "waiting" | "not_registered"
    waitingKind: RegistrationWaitingKind
    classId: string
    requestKey: string
  }): Promise<RegistrationConsultationCompletionResponse> {
    const result = await callRpc<RegistrationConsultationCompletionResponse>("complete_registration_consultation", {
      p_consultation_id: input.consultationId,
      p_outcome: input.outcome,
      p_waiting_kind: input.waitingKind || null,
      p_class_id: normalizeUuid(input.classId),
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      consultation: mapConsultation(value(result as unknown as Row, "consultation") as Row),
      track: mapTrack(value(result as unknown as Row, "track") as Row),
    }
  }

  async function transitionRegistrationWaiting(input: {
    trackId: string
    action: "change_waiting_kind" | "record_retest_required" | "move_to_enrollment" | "close_not_registered"
    waitingKind: RegistrationWaitingKind
    classId: string
    retakeDecision: "" | "required" | "not_required"
    reason: string
    requestKey: string
  }): Promise<RegistrationTrackTransitionResponse> {
    return callRpc<RegistrationTrackTransitionResponse>("transition_registration_waiting", {
      p_track_id: input.trackId,
      p_action: input.action,
      p_waiting_kind: input.waitingKind || null,
      p_class_id: normalizeUuid(input.classId),
      p_retake_decision: input.retakeDecision || null,
      p_reason: input.reason || null,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function routeRegistrationEnrollmentDecision(input: {
    trackId: string
    destination: "waiting" | "not_registered"
    waitingKind: RegistrationWaitingKind
    classId: string
    reason: string
    requestKey: string
  }): Promise<RegistrationTrackTransitionResponse> {
    return callRpc<RegistrationTrackTransitionResponse>("route_registration_enrollment_decision", {
      p_track_id: input.trackId,
      p_destination: input.destination,
      p_waiting_kind: input.waitingKind || null,
      p_class_id: normalizeUuid(input.classId),
      p_reason: input.reason || null,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function saveRegistrationEnrollmentRows(input: {
    trackId: string
    rows: RegistrationEnrollmentRowInput[]
    requestKey: string
  }): Promise<RegistrationEnrollmentRowsSaveResponse> {
    const payloadRows = input.rows.map((row) => ({
      id: normalizeUuid(row.id),
      classId: row.classId,
      textbookId: normalizeUuid(row.textbookId),
      classStartDate: nullableText(row.classStartDate),
      classStartSessionKey: nullableText(row.classStartSessionKey),
      classStartSession: nullableText(row.classStartSession),
      sortOrder: row.sortOrder,
    }))
    const result = await callRpc<RegistrationEnrollmentRowsSaveResponse>("save_registration_enrollment_rows", {
      p_track_id: input.trackId,
      p_rows: payloadRows,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      trackId: text(value(result as unknown as Row, "track_id", "trackId")),
      rows: rows(value(result as unknown as Row, "rows")).map(mapEnrollment),
    }
  }

  async function claimRegistrationAdmissionMessage(input: {
    taskId: string
    messageRequestKey: string
  }): Promise<RegistrationAdmissionMessageClaimResponse> {
    return callRpc<RegistrationAdmissionMessageClaimResponse>("claim_registration_admission_message", {
      p_task_id: input.taskId,
      p_message_request_key: requireMessageRequestKey(input.messageRequestKey),
    })
  }

  async function reconcileRegistrationAdmissionMessage(input: {
    messageId: string
    resolution: "accepted" | "failed"
    providerEvidence: RegistrationAdmissionProviderEvidence
    reason: string
    requestKey: string
  }): Promise<RegistrationAdmissionMessageReconciliationResponse> {
    return callRpc<RegistrationAdmissionMessageReconciliationResponse>("reconcile_registration_admission_message", {
      p_message_id: input.messageId,
      p_resolution: input.resolution,
      p_provider_evidence: input.providerEvidence,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function releaseRegistrationAdmissionMessageRetry(input: {
    messageId: string
    providerEvidence: RegistrationAdmissionProviderEvidence
    reason: string
    requestKey: string
  }): Promise<RegistrationAdmissionMessageReleaseResponse> {
    return callRpc<RegistrationAdmissionMessageReleaseResponse>("release_registration_admission_message_retry", {
      p_message_id: input.messageId,
      p_provider_evidence: input.providerEvidence,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function markRegistrationAdmissionNoticeSent(input: {
    taskId: string
    messageRequestKey: string
    requestKey: string
  }): Promise<RegistrationAdmissionMarkResponse> {
    return callRpc<RegistrationAdmissionMarkResponse>("mark_registration_admission_notice_sent", {
      p_task_id: input.taskId,
      p_message_request_key: requireMessageRequestKey(input.messageRequestKey),
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function startRegistrationAdmissionBatch(input: {
    taskId: string
    trackIds: string[]
    enrollmentIds: string[]
    requestKey: string
  }): Promise<RegistrationAdmissionBatchMutationResponse> {
    const result = await callRpc<RegistrationAdmissionBatchMutationResponse>("start_registration_admission_batch", {
      p_task_id: input.taskId,
      p_track_ids: input.trackIds,
      p_enrollment_ids: input.enrollmentIds,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      batch: mapBatch(value(result as unknown as Row, "batch") as Row),
      enrollments: rows(value(result as unknown as Row, "enrollments")).map(mapEnrollment),
    }
  }

  async function setRegistrationEnrollmentMakeedu(input: {
    enrollmentId: string
    registered: boolean
    requestKey: string
  }): Promise<RegistrationEnrollmentMutationResponse> {
    const result = await callRpc<RegistrationEnrollmentMutationResponse>("set_registration_enrollment_makeedu", {
      p_enrollment_id: input.enrollmentId,
      p_registered: input.registered,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      enrollment: mapEnrollment(value(result as unknown as Row, "enrollment") as Row),
    }
  }

  async function advanceRegistrationAdmissionBatch(input: {
    batchId: string
    action: "invoice_sent" | "payment_confirmed"
    requestKey: string
  }): Promise<RegistrationAdmissionBatchMutationResponse> {
    const result = await callRpc<RegistrationAdmissionBatchMutationResponse>("advance_registration_admission_batch", {
      p_batch_id: input.batchId,
      p_action: input.action,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return { ...result, batch: mapBatch(value(result as unknown as Row, "batch") as Row) }
  }

  async function cancelRegistrationAdmissionBatch(input: {
    batchId: string
    resolutions: Array<Record<string, unknown>>
    reason: string
    requestKey: string
  }): Promise<RegistrationAdmissionBatchMutationResponse> {
    const result = await callRpc<RegistrationAdmissionBatchMutationResponse>("cancel_registration_admission_batch", {
      p_batch_id: input.batchId,
      p_resolutions: input.resolutions,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      batch: mapBatch(value(result as unknown as Row, "batch") as Row),
      enrollments: rows(value(result as unknown as Row, "enrollments")).map(mapEnrollment),
    }
  }

  async function completeRegistrationAdmissionBatch(input: {
    batchId: string
    requestKey: string
  }): Promise<RegistrationAdmissionBatchCompletionResponse> {
    const result = await callRpc<RegistrationAdmissionBatchCompletionResponse>("complete_registration_admission_batch", {
      p_batch_id: input.batchId,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      batch: mapBatch(value(result as unknown as Row, "batch") as Row),
      enrollments: rows(value(result as unknown as Row, "enrollments")).map(mapEnrollment),
    }
  }

  async function cancelRegistrationEnrollment(input: {
    enrollmentId: string
    destination: "" | "enrollment_decided" | "waiting" | "not_registered"
    waitingKind: RegistrationWaitingKind
    classId: string
    reason: string
    requestKey: string
  }): Promise<RegistrationEnrollmentMutationResponse> {
    const result = await callRpc<RegistrationEnrollmentMutationResponse>("cancel_registration_enrollment", {
      p_enrollment_id: input.enrollmentId,
      p_destination: input.destination || null,
      p_waiting_kind: input.waitingKind || null,
      p_class_id: normalizeUuid(input.classId),
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      enrollment: mapEnrollment(value(result as unknown as Row, "enrollment") as Row),
      track: value(result as unknown as Row, "track")
        ? mapTrack(value(result as unknown as Row, "track") as Row)
        : undefined,
    }
  }

  async function resolveRegistrationMigrationReview(input: {
    taskId: string
    assignments: Array<Record<string, unknown>>
    trackStates: Array<Record<string, unknown>>
    requestKey: string
  }): Promise<RegistrationMigrationReviewResponse> {
    const result = await callRpc<RegistrationMigrationReviewResponse>("resolve_registration_migration_review", {
      p_task_id: input.taskId,
      p_assignments: {
        assignments: input.assignments,
        trackStates: input.trackStates,
      },
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      ...result,
      tracks: rows(value(result as unknown as Row, "tracks")).map((row) => mapTrack(row)),
    }
  }

  async function reopenRegistrationTrack(input: {
    trackId: string
    destination: "inquiry" | "consultation_waiting"
    reason: string
    requestKey: string
  }): Promise<RegistrationTrackTransitionResponse> {
    return callRpc<RegistrationTrackTransitionResponse>("reopen_registration_track", {
      p_track_id: input.trackId,
      p_destination: input.destination,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
  }

  async function setStudentClassRosterMode(input: {
    studentId: string
    classId: string
    nextMode: "enrolled" | "waitlist" | "removed"
    expectedMode: "enrolled" | "waitlist" | "removed"
    memo: string
  }): Promise<StudentClassRosterModeResponse> {
    return callRpc<StudentClassRosterModeResponse>("set_student_class_roster_mode", {
      p_student_id: input.studentId,
      p_class_id: input.classId,
      p_next_mode: input.nextMode,
      p_expected_mode: input.expectedMode,
      p_memo: input.memo,
    })
  }

  return {
    probeRuntime,
    clearCaches,
    createLegacyTrackSummaries,
    loadTrackSummaries,
    loadCaseDetail,
    loadWorkspaceOptionData,
    createRegistrationCase,
    createRegistrationCaseWithInitialWorkflow,
    syncRegistrationCaseSubjects,
    updateRegistrationCaseCommon,
    routeRegistrationInquiry,
    assignRegistrationTrackDirector,
    saveRegistrationSharedAppointment,
    cancelRegistrationAppointment,
    startRegistrationLevelTestAttempt,
    completeRegistrationLevelTestAttempt,
    closeRegistrationLevelTestTrack,
    completeRegistrationConsultation,
    transitionRegistrationWaiting,
    routeRegistrationEnrollmentDecision,
    saveRegistrationEnrollmentRows,
    claimRegistrationAdmissionMessage,
    reconcileRegistrationAdmissionMessage,
    releaseRegistrationAdmissionMessageRetry,
    markRegistrationAdmissionNoticeSent,
    startRegistrationAdmissionBatch,
    setRegistrationEnrollmentMakeedu,
    advanceRegistrationAdmissionBatch,
    cancelRegistrationAdmissionBatch,
    completeRegistrationAdmissionBatch,
    cancelRegistrationEnrollment,
    resolveRegistrationMigrationReview,
    reopenRegistrationTrack,
    setStudentClassRosterMode,
  }
}
// registration-track-service-factory:end

let registrationTrackMutationCacheInvalidator: (() => void) | null = null

export function setRegistrationTrackMutationCacheInvalidator(
  invalidator: (() => void) | null,
) {
  registrationTrackMutationCacheInvalidator = invalidator
}

const defaultRegistrationTrackService = createRegistrationTrackService(
  supabase as unknown as RegistrationTrackClient,
  {
    probeRuntime: probeRegistrationSubjectTrackRuntime,
    invalidateRuntimeAfterReadyFailure: invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure,
    onMutationSuccess: () => registrationTrackMutationCacheInvalidator?.(),
    performance: typeof performance === "undefined"
      ? undefined
      : {
          mark: (name) => performance.mark(name),
          measure: (name, startMark, endMark) => performance.measure(name, startMark, endMark),
        },
  },
)

export function clearRegistrationTrackServiceCaches() {
  defaultRegistrationTrackService.clearCaches()
}

export function loadRegistrationTrackSummaries(
  taskIds: string[],
  viewerId: string,
  options: { force?: boolean } = {},
): Promise<RegistrationTrackSummaryLoadResult> {
  return defaultRegistrationTrackService.loadTrackSummaries(taskIds, viewerId, options)
}

export function loadRegistrationCaseDetail(
  taskId: string,
  viewerId: string,
  options: { force?: boolean } = {},
): Promise<OpsRegistrationCaseDetail> {
  const fixture = loadRegistrationSubjectTrackFixtureCase(taskId)
  if (fixture) return fixture
  return defaultRegistrationTrackService.loadCaseDetail(taskId, viewerId, options)
}

export function loadOpsRegistrationWorkspaceOptionData(
  options: { viewerId: string; force?: boolean },
): Promise<OpsRegistrationWorkspaceOptionData> {
  const fixture = loadRegistrationSubjectTrackFixtureOptionData()
  if (fixture) return fixture
  return defaultRegistrationTrackService.loadWorkspaceOptionData(options)
}

export function createRegistrationCase(
  input: Parameters<typeof defaultRegistrationTrackService.createRegistrationCase>[0],
): Promise<RegistrationCaseCreateResponse> {
  return defaultRegistrationTrackService.createRegistrationCase(input)
}

export function createRegistrationCaseWithInitialWorkflow(
  input: RegistrationCaseCreateWithInitialWorkflowInput,
): Promise<RegistrationCaseCreateWithInitialWorkflowResponse> {
  return defaultRegistrationTrackService.createRegistrationCaseWithInitialWorkflow(input)
}

export function syncRegistrationCaseSubjects(
  input: Parameters<typeof defaultRegistrationTrackService.syncRegistrationCaseSubjects>[0],
): Promise<RegistrationSubjectSyncResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationSubjectSyncResponse>("syncRegistrationCaseSubjects", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.syncRegistrationCaseSubjects(input)
}

export function updateRegistrationCaseCommon(
  input: Parameters<typeof defaultRegistrationTrackService.updateRegistrationCaseCommon>[0],
): Promise<RegistrationCommonUpdateResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationCommonUpdateResponse>("updateRegistrationCaseCommon", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.updateRegistrationCaseCommon(input)
}

export function routeRegistrationInquiry(
  input: Parameters<typeof defaultRegistrationTrackService.routeRegistrationInquiry>[0],
): Promise<RegistrationTrackTransitionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("routeRegistrationInquiry", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.routeRegistrationInquiry(input)
}

export function assignRegistrationTrackDirector(
  input: Parameters<typeof defaultRegistrationTrackService.assignRegistrationTrackDirector>[0],
): Promise<RegistrationDirectorAssignmentResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationDirectorAssignmentResponse>("assignRegistrationTrackDirector", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.assignRegistrationTrackDirector(input)
}

export function saveRegistrationSharedAppointment(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationSharedAppointment>[0],
): Promise<RegistrationAppointmentMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAppointmentMutationResponse>("saveRegistrationSharedAppointment", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationSharedAppointment(input)
}

export function cancelRegistrationAppointment(
  input: Parameters<typeof defaultRegistrationTrackService.cancelRegistrationAppointment>[0],
): Promise<RegistrationAppointmentMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAppointmentMutationResponse>("cancelRegistrationAppointment", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.cancelRegistrationAppointment(input)
}

export function startRegistrationLevelTestAttempt(
  input: Parameters<typeof defaultRegistrationTrackService.startRegistrationLevelTestAttempt>[0],
): Promise<RegistrationLevelTestMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationLevelTestMutationResponse>("startRegistrationLevelTestAttempt", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.startRegistrationLevelTestAttempt(input)
}

export function completeRegistrationLevelTestAttempt(
  input: Parameters<typeof defaultRegistrationTrackService.completeRegistrationLevelTestAttempt>[0],
): Promise<RegistrationLevelTestMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationLevelTestMutationResponse>("completeRegistrationLevelTestAttempt", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.completeRegistrationLevelTestAttempt(input)
}

export function closeRegistrationLevelTestTrack(
  input: Parameters<typeof defaultRegistrationTrackService.closeRegistrationLevelTestTrack>[0],
): Promise<RegistrationTrackTransitionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("closeRegistrationLevelTestTrack", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.closeRegistrationLevelTestTrack(input)
}

export function completeRegistrationConsultation(
  input: Parameters<typeof defaultRegistrationTrackService.completeRegistrationConsultation>[0],
): Promise<RegistrationConsultationCompletionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationConsultationCompletionResponse>("completeRegistrationConsultation", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.completeRegistrationConsultation(input)
}

export function transitionRegistrationWaiting(
  input: Parameters<typeof defaultRegistrationTrackService.transitionRegistrationWaiting>[0],
): Promise<RegistrationTrackTransitionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("transitionRegistrationWaiting", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.transitionRegistrationWaiting(input)
}

export function routeRegistrationEnrollmentDecision(
  input: Parameters<typeof defaultRegistrationTrackService.routeRegistrationEnrollmentDecision>[0],
): Promise<RegistrationTrackTransitionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("routeRegistrationEnrollmentDecision", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.routeRegistrationEnrollmentDecision(input)
}

export function saveRegistrationEnrollmentRows(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationEnrollmentRows>[0],
): Promise<RegistrationEnrollmentRowsSaveResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationEnrollmentRowsSaveResponse>("saveRegistrationEnrollmentRows", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationEnrollmentRows(input)
}

export function claimRegistrationAdmissionMessage(
  input: Parameters<typeof defaultRegistrationTrackService.claimRegistrationAdmissionMessage>[0],
): Promise<RegistrationAdmissionMessageClaimResponse> {
  return defaultRegistrationTrackService.claimRegistrationAdmissionMessage(input)
}

export function reconcileRegistrationAdmissionMessage(
  input: Parameters<typeof defaultRegistrationTrackService.reconcileRegistrationAdmissionMessage>[0],
): Promise<RegistrationAdmissionMessageReconciliationResponse> {
  return defaultRegistrationTrackService.reconcileRegistrationAdmissionMessage(input)
}

export function releaseRegistrationAdmissionMessageRetry(
  input: Parameters<typeof defaultRegistrationTrackService.releaseRegistrationAdmissionMessageRetry>[0],
): Promise<RegistrationAdmissionMessageReleaseResponse> {
  return defaultRegistrationTrackService.releaseRegistrationAdmissionMessageRetry(input)
}

export function markRegistrationAdmissionNoticeSent(
  input: Parameters<typeof defaultRegistrationTrackService.markRegistrationAdmissionNoticeSent>[0],
): Promise<RegistrationAdmissionMarkResponse> {
  return defaultRegistrationTrackService.markRegistrationAdmissionNoticeSent(input)
}

export function startRegistrationAdmissionBatch(
  input: Parameters<typeof defaultRegistrationTrackService.startRegistrationAdmissionBatch>[0],
): Promise<RegistrationAdmissionBatchMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAdmissionBatchMutationResponse>("startRegistrationAdmissionBatch", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.startRegistrationAdmissionBatch(input)
}

export function setRegistrationEnrollmentMakeedu(
  input: Parameters<typeof defaultRegistrationTrackService.setRegistrationEnrollmentMakeedu>[0],
): Promise<RegistrationEnrollmentMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationEnrollmentMutationResponse>("setRegistrationEnrollmentMakeedu", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.setRegistrationEnrollmentMakeedu(input)
}

export function advanceRegistrationAdmissionBatch(
  input: Parameters<typeof defaultRegistrationTrackService.advanceRegistrationAdmissionBatch>[0],
): Promise<RegistrationAdmissionBatchMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAdmissionBatchMutationResponse>("advanceRegistrationAdmissionBatch", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.advanceRegistrationAdmissionBatch(input)
}

export function cancelRegistrationAdmissionBatch(
  input: Parameters<typeof defaultRegistrationTrackService.cancelRegistrationAdmissionBatch>[0],
): Promise<RegistrationAdmissionBatchMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAdmissionBatchMutationResponse>("cancelRegistrationAdmissionBatch", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.cancelRegistrationAdmissionBatch(input)
}

export function completeRegistrationAdmissionBatch(
  input: Parameters<typeof defaultRegistrationTrackService.completeRegistrationAdmissionBatch>[0],
): Promise<RegistrationAdmissionBatchCompletionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAdmissionBatchCompletionResponse>("completeRegistrationAdmissionBatch", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.completeRegistrationAdmissionBatch(input)
}

export function cancelRegistrationEnrollment(
  input: Parameters<typeof defaultRegistrationTrackService.cancelRegistrationEnrollment>[0],
): Promise<RegistrationEnrollmentMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationEnrollmentMutationResponse>("cancelRegistrationEnrollment", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.cancelRegistrationEnrollment(input)
}

export function resolveRegistrationMigrationReview(
  input: Parameters<typeof defaultRegistrationTrackService.resolveRegistrationMigrationReview>[0],
): Promise<RegistrationMigrationReviewResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationMigrationReviewResponse>("resolveRegistrationMigrationReview", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.resolveRegistrationMigrationReview(input)
}

export function reopenRegistrationTrack(
  input: Parameters<typeof defaultRegistrationTrackService.reopenRegistrationTrack>[0],
): Promise<RegistrationTrackTransitionResponse> {
  return defaultRegistrationTrackService.reopenRegistrationTrack(input)
}

export function setStudentClassRosterMode(
  input: Parameters<typeof defaultRegistrationTrackService.setStudentClassRosterMode>[0],
): Promise<StudentClassRosterModeResponse> {
  return defaultRegistrationTrackService.setStudentClassRosterMode(input)
}
