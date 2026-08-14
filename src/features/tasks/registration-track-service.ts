import { supabase } from "@/lib/supabase"
import { invalidatePublicClassesCacheAfterMutation } from "@/server/public-classes-cache-invalidation.js"
import {
  parseAcademicSubject,
  type AcademicSubjectValue,
} from "../../lib/academic-subject-registry.ts"

import {
  buildRegistrationAppointmentCalendarItems,
  type RegistrationAppointmentCalendarItem,
  type RegistrationAppointmentCalendarLoadInput,
  type RegistrationAppointmentCalendarRow,
  type RegistrationAppointmentCalendarStatus,
} from "./registration-appointment-calendar-model"
import {
  executeRegistrationSubjectTrackFixtureAction,
  loadRegistrationSubjectTrackFixtureAppointmentCalendarRows,
  loadRegistrationSubjectTrackFixtureCase,
  loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion,
  loadRegistrationSubjectTrackFixtureObservationClient,
  loadRegistrationSubjectTrackFixtureOptionData,
  loadRegistrationSubjectTrackFixtureScienceConsultationClassOptions,
} from "./registration-track-fixture-runtime"

import type {
  OpsClassOption,
  OpsProfileOption,
  OpsSchoolOption,
  OpsTask,
  OpsTaskAttachment,
  OpsTaskComment,
  OpsTeacherOption,
  OpsTextbookOption,
  RegistrationSchoolCatalogStatus,
} from "./ops-task-service"
import type { RegistrationInitialWorkflowPayload } from "./registration-intake-workflow"
import { normalizeRegistrationLevelTestPlace } from "./registration-level-test-place.ts"
import {
  probeRegistrationIntakeWorkflowRuntime as probeRegistrationIntakeWorkflowRuntimeFromDatabase,
  resetRegistrationIntakeWorkflowRuntimeProbe,
} from "./registration-intake-runtime-probe"
import type { RegistrationIntakeRuntimeState } from "./registration-intake-runtime-probe"
import {
  EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
  normalizeRegistrationObservationSummary,
  type RegistrationObservationFeedbackDetail,
  type RegistrationObservationRuntimeState,
  type RegistrationObservationSummary,
  type RegistrationObservationTrackWorkflowStatus,
} from "./registration-observation-model.ts"
import {
  loadRegistrationObservationFeedback,
  loadRegistrationObservationManagerDetail,
  type RegistrationObservationClient,
} from "./registration-observation-service.ts"
import {
  probeRegistrationObservationRuntime as probeRegistrationObservationRuntimeFromDatabase,
} from "./registration-observation-runtime-probe.ts"
import {
  invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure,
  probeRegistrationSubjectTrackRuntime as probeRegistrationSubjectTrackRuntimeFromDatabase,
} from "./registration-runtime-probe"
import type { RegistrationRuntimeState } from "./registration-runtime-probe"
import type { RegistrationNotificationProcessingReadiness } from "./registration-appointment-draft"
import {
  createRegistrationNotificationProcessingReadinessLoader,
} from "./registration-notification-processing-readiness"
import {
  getRegistrationWorkflowStatusFromLegacyTrack,
} from "./registration-workflow-status.js"

export type { RegistrationRuntimeState }
function probeRegistrationSubjectTrackRuntime(): Promise<RegistrationRuntimeState> {
  if (loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion() !== null) {
    return Promise.resolve({ mode: "ready", version: 1 })
  }
  return probeRegistrationSubjectTrackRuntimeFromDatabase()
}
export { probeRegistrationSubjectTrackRuntime }
function probeRegistrationIntakeWorkflowRuntime(): Promise<RegistrationIntakeRuntimeState> {
  const fixtureVersion = loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion()
  if (fixtureVersion !== null) {
    return Promise.resolve({ available: true, version: fixtureVersion })
  }
  return probeRegistrationIntakeWorkflowRuntimeFromDatabase()
}
export {
  probeRegistrationIntakeWorkflowRuntime,
  resetRegistrationIntakeWorkflowRuntimeProbe,
}
export type { RegistrationIntakeRuntimeState }
export function probeRegistrationObservationRuntime(): Promise<RegistrationObservationRuntimeState> {
  const fixtureClient = loadRegistrationSubjectTrackFixtureObservationClient()
  if (fixtureClient) return probeRegistrationObservationRuntimeFromDatabase(fixtureClient)
  return probeRegistrationObservationRuntimeFromDatabase(
    supabase as unknown as Parameters<typeof probeRegistrationObservationRuntimeFromDatabase>[0],
  )
}

// registration-track-service-factory:start
type Row = Record<string, unknown>
export type RegistrationSubject = AcademicSubjectValue
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

export type OpsRegistrationWorkflowStatus =
  | "inquiry"
  | "level_test_requested"
  | "consultation_requested"
  | "consultation_completed"
  | "waiting_current_class"
  | "waiting_new_class"
  | "waiting_next_opening"
  | "enrollment_requested"
  | "payment_in_progress"
  | "registered"
  | "not_registered"
  | "inquiry_only"

const OPS_REGISTRATION_WORKFLOW_STATUSES: readonly OpsRegistrationWorkflowStatus[] = [
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
]

const REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUSES:
  readonly RegistrationObservationTrackWorkflowStatus[] = [
    ...OPS_REGISTRATION_WORKFLOW_STATUSES,
    "observation_requested",
    "observation_feedback_pending",
    "observation_completed",
  ]

const OPS_REGISTRATION_WORKFLOW_STATUS_SET = new Set<string>(OPS_REGISTRATION_WORKFLOW_STATUSES)
const REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUS_SET = new Set<string>(
  REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUSES,
)

export function isOpsRegistrationWorkflowStatus(
  input: string,
): input is OpsRegistrationWorkflowStatus {
  return OPS_REGISTRATION_WORKFLOW_STATUS_SET.has(input)
}

function isRegistrationObservationTrackWorkflowStatus(
  input: string,
): input is RegistrationObservationTrackWorkflowStatus {
  return REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUS_SET.has(input)
}

function opsRegistrationWorkflowStatusFromLegacy(input: {
  status: string
  waitingKind?: string
}): OpsRegistrationWorkflowStatus {
  const status = getRegistrationWorkflowStatusFromLegacyTrack(input)
  if (!isOpsRegistrationWorkflowStatus(status)) {
    throw new Error("registration_workflow_status_response_invalid")
  }
  return status
}

type OpsRegistrationTrackSummaryFields<
  TWorkflowStatus extends RegistrationObservationTrackWorkflowStatus,
> = {
  id: string
  taskId: string
  subject: RegistrationSubject
  status: OpsRegistrationTrackStatus
  workflowStatus: TWorkflowStatus
  workflowRevision: number
  workflowStatusEnteredAt: string
  legacy: boolean
  directorProfileId: string | null
  directorName: string
  directorAssignmentSource: "" | "default" | "manual" | "migration"
  directorAssignmentRuleKey: string
  waitingKind: RegistrationWaitingKind
  waitingDetailKind: RegistrationWaitingKind
  waitingDetailClassId: string | null
  waitingDetailRetakeDecision: "" | "required" | "not_required"
  enrollmentDetailRows?: RegistrationEnrollmentRowInput[]
  levelTestRetakeDecision: "" | "required" | "not_required"
  migrationReviewRequired: boolean
  stageEnteredAt: string
  phoneReadyAt: string | null
  phoneReadySource: RegistrationPhoneReadySource | null
  levelTestScheduledAt?: string
  levelTestPlace?: string
  visitScheduledAt?: string
  visitPlace?: string
}

type RegistrationObservationSummaryAccess = RegistrationObservationSummary & {
  /** False only when the server deliberately conceals the complete scalar tuple. */
  observationSummaryVisible: boolean
}

export type OpsRegistrationTrackSummary =
  & OpsRegistrationTrackSummaryFields<OpsRegistrationWorkflowStatus>
  & Partial<RegistrationObservationSummaryAccess>

export type OpsRegistrationObservationTrackSummary =
  & OpsRegistrationTrackSummaryFields<RegistrationObservationTrackWorkflowStatus>
  & RegistrationObservationSummaryAccess

export type OpsRegistrationEnrollment = {
  id: string
  trackId: string
  studentId: string | null
  admissionBatchId: string | null
  classId: string
  textbookId: string | null
  classStartDate: string | null
  classStartSessionKey: string | null
  classStartLessonSessionId: string | null
  classStartSession: string | null
  classStartSourceObservationId?: string | null
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
  note: string | null
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
  actorKind: "user" | "system" | "migration" | null
  systemSource: string | null
  reasonCode: string | null
  payloadVersion: 1 | 2 | null
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

type OpsRegistrationCaseDetailFields<
  TTrack extends OpsRegistrationTrackSummary | OpsRegistrationObservationTrackSummary,
> = {
  task: OpsTask
  commonRevision: number
  admissionApplicationMessageId: string | null
  admissionApplicationMessageStatus: "" | "pending" | "accepted" | "unknown" | "failed_hold"
  admissionApplicationMessageClaimActive: boolean
  admissionApplicationMessageUpdatedAt: string | null
  admissionApplicationAccepted: boolean
  comments: OpsTaskComment[]
  attachments: OpsTaskAttachment[]
  tracks: TTrack[]
  appointments: OpsRegistrationAppointment[]
  levelTests: OpsRegistrationLevelTest[]
  consultations: OpsRegistrationConsultation[]
  admissionBatches: OpsRegistrationAdmissionBatch[]
  enrollments: OpsRegistrationEnrollment[]
  events: OpsRegistrationTrackEvent[]
  migrationLegacy: OpsRegistrationMigrationLegacySnapshot | null
}

export type OpsRegistrationCaseDetail =
  OpsRegistrationCaseDetailFields<OpsRegistrationTrackSummary>

export type OpsRegistrationObservationCaseDetail =
  OpsRegistrationCaseDetailFields<OpsRegistrationObservationTrackSummary>

export type RegistrationTrackSummaryLoadResult = {
  mode: "legacy" | "maintenance" | "ready"
  tracks: Array<OpsRegistrationTrackSummaryFields<OpsRegistrationWorkflowStatus>>
}

export type RegistrationObservationTrackSummaryLoadResult = {
  mode: "legacy" | "maintenance" | "ready"
  tracks: Array<
    & OpsRegistrationTrackSummaryFields<RegistrationObservationTrackWorkflowStatus>
    & RegistrationObservationSummaryAccess
  >
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
  schools: OpsSchoolOption[]
  schoolCatalogStatus: RegistrationSchoolCatalogStatus
  schoolCatalogError: string | null
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

export type RegistrationCaseInquirySaveInput = {
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
  subjects: RegistrationSubject[]
  expectedCommonRevision: number
  expectedSubjects: RegistrationSubject[]
  requestKey: string
}

export type RegistrationCaseInquirySaveResponse = RegistrationCommonUpdateResponse & {
  subjects: RegistrationSubject[]
  tracks: OpsRegistrationTrackSummary[]
  notificationJobs?: RegistrationNotificationJobReference[]
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

export type RegistrationWaitingDetailsSaveResponse = {
  trackId: string
  waitingKind: RegistrationWaitingKind
  classId: string
  retakeDecision: "required" | "not_required"
}

export type RegistrationWorkflowStatusMutationResponse = {
  trackId: string
  workflowStatus: OpsRegistrationWorkflowStatus
  workflowRevision: number
  workflowStatusEnteredAt: string
}

export type RegistrationDirectorAssignmentResponse = RegistrationTrackTransitionResponse & {
  directorProfileId: string | null
  directorAssignmentSource: "" | "default" | "manual" | "migration"
  directorAssignmentRuleKey: string
  commonRevision?: number
}

export type RegistrationNotificationJobKind =
  | "fanout"
  | "rule_reconciliation"
  | "target_reconciliation"

export type RegistrationNotificationJobReference = {
  jobKind: RegistrationNotificationJobKind
  jobId: string
}

export type RegistrationNotificationJobStatus = RegistrationNotificationJobReference & {
  workflowKey: "registration"
  status: "pending" | "claimed" | "succeeded" | "failed"
  attemptCount: number
  nextAttemptAt: string | null
  lastErrorCode: string | null
  createdAt: string
  completedAt: string | null
}

export type RegistrationAppointmentReminderPreview = {
  ruleId: string
  ruleRevision: string
  variantKey: string
  scheduledFor: string
  audienceKey: string
  channelKey: string
}

export type RegistrationAppointmentMutationResponse = {
  appointmentId: string
  notificationRevision: number
  notificationTargets: Array<{ appointmentId: string; notificationRevision: number }>
  requiresDirectorAssignmentTrackIds: string[]
  notificationJobs: RegistrationNotificationJobReference[]
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

export type RegistrationLevelTestResultSaveResponse = {
  attemptId: string
  trackId: string
  status: "completed" | "absent" | "canceled"
  materialLink: string | null
}

export type RegistrationConsultationCompletionResponse = {
  consultation: OpsRegistrationConsultation
  track: OpsRegistrationTrackSummary
}

export type RegistrationConsultationDetailsSaveResponse = {
  consultationId: string
  trackId: string
  status: "waiting" | "scheduled" | "completed" | "canceled"
  outcome: "" | "enrollment" | "waiting" | "not_registered"
  note: string | null
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
  publicClassesCacheRefresh?: Awaited<ReturnType<typeof invalidatePublicClassesCacheAfterMutation>>
}

export type RegistrationEnrollmentMutationResponse = {
  applied?: boolean
  enrollment: OpsRegistrationEnrollment
  track?: OpsRegistrationTrackSummary
  publicClassesCacheRefresh?: Awaited<ReturnType<typeof invalidatePublicClassesCacheAfterMutation>>
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

export type RegistrationEnrollmentRowInput = Readonly<{
  id?: string
  classId: string
  textbookId?: string | null
  classStartDate?: string | null
  classStartSessionKey?: string | null
  classStartLessonSessionId?: string | null
  classStartSession?: string | null
  classStartSourceObservationId?: string | null
  sortOrder: number
}>

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
  abortSignal?: (signal: AbortSignal) => QueryBuilder
  retry?: (enabled: boolean) => QueryBuilder
  select: (columns: string, options?: Record<string, unknown>) => QueryBuilder
  eq: (column: string, value: unknown) => QueryBuilder
  neq: (column: string, value: unknown) => QueryBuilder
  gte: (column: string, value: unknown) => QueryBuilder
  lt: (column: string, value: unknown) => QueryBuilder
  in: (column: string, values: unknown[]) => QueryBuilder
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder
  limit: (count: number) => QueryBuilder
  single: () => QueryBuilder
}

export type RegistrationTrackClient = {
  from: (table: string) => QueryBuilder
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<QueryResult> & {
    retry?: (enabled: boolean) => PromiseLike<QueryResult>
  }
}

export type RegistrationTrackServiceOptions = {
  probeRuntime: () => Promise<RegistrationRuntimeState>
  probeIntakeRuntime: () => Promise<RegistrationIntakeRuntimeState>
  probeObservationRuntime?: () => Promise<RegistrationObservationRuntimeState>
  invalidateRuntimeAfterReadyFailure?: (error: unknown) => never
  performance?: RegistrationPerformanceSink
  recordMeasure?: (measure: RegistrationMeasure) => void
  now?: () => number
  randomUUID?: () => string
  onMutationSuccess?: () => void
  requestTimeoutMs?: number
  invalidatePublicClassesCacheAfterMutation?: (
    client: RegistrationTrackClient,
    reason: "class",
  ) => Promise<Awaited<ReturnType<typeof invalidatePublicClassesCacheAfterMutation>>>
}

const PRE_OBSERVATION_TRACK_SUMMARY_COLUMNS = [
  "id",
  "task_id",
  "subject",
  "pipeline_status",
  "workflow_status",
  "workflow_revision",
  "workflow_status_entered_at",
  "director_profile_id",
  "director_assignment_source",
  "director_assignment_rule_key",
  "waiting_kind",
  "waiting_detail_kind",
  "waiting_detail_class_id",
  "waiting_detail_retake_decision",
  "level_test_retake_decision",
  "migration_review_required",
  "stage_entered_at",
  "phone_ready_at",
  "phone_ready_source",
  "updated_at",
  "level_test_scheduled_at",
  "level_test_place",
  "visit_scheduled_at",
  "visit_place",
  "enrollment_detail_rows",
  "director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)",
].join(",")

const TRACK_SUMMARY_COLUMNS = [
  PRE_OBSERVATION_TRACK_SUMMARY_COLUMNS,
  "observation_attempt_count",
  "observation_current_id",
  "observation_current_status",
  "observation_current_appointment_id",
  "observation_nearest_scheduled_at",
  "observation_nearest_place",
  "observation_notification_revision",
  "observation_revision",
  "observation_feedback_revision",
].join(",")

const PRE_INTAKE_TRACK_SUMMARY_COLUMNS = [
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
  "updated_at",
  "visit_scheduled_at",
  "visit_place",
  "director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)",
].join(",")

const TASK_SCOPED_CASE_READS = [
  ["ops_registration_subject_tracks", [
    "*",
    "director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)",
    "level_tests:ops_registration_level_tests(*)",
    "consultations:ops_registration_consultations(*)",
    "enrollments:ops_registration_enrollments(*)",
  ].join(",")],
  ["ops_registration_appointments", "*"],
  ["ops_registration_admission_batches", "*"],
] as const

const PARENT_DETAIL_COLUMNS = "*,ops_registration_details(*),ops_task_comments(*),ops_task_attachments(*)"
const EVENT_COLUMNS = "id,task_id,actor_id,event_type,field_name,before_value,after_value,created_at"
const MESSAGE_COLUMNS = "id,status,claim_active,template_key,request_key,updated_at"
const REGISTRATION_APPOINTMENT_CALENDAR_COLUMNS = [
  "appointment_id",
  "task_id",
  "student_name",
  "kind",
  "scheduled_at",
  "place",
  "status",
  "notification_revision",
  "track_ids",
  "subjects",
  "observation_id",
  "observation_track_id",
  "observation_class_id",
  "observation_class_name",
  "observation_ends_at",
  "observation_teacher_name",
  "observation_classroom_name",
].join(",")
const REGISTRATION_APPOINTMENT_CALENDAR_STATUSES = [
  "scheduled",
  "completed",
  "canceled",
] as const

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

function normalizeRegistrationAppointmentCalendarInput(
  input: RegistrationAppointmentCalendarLoadInput,
) {
  const rangeStart = text(input?.rangeStart)
  const rangeEnd = text(input?.rangeEnd)
  const observationRuntimeVersion = input?.observationRuntimeVersion
  if (observationRuntimeVersion !== 0 && observationRuntimeVersion !== 1) {
    throw new Error("registration_calendar_observation_runtime_invalid")
  }
  const startTime = Date.parse(rangeStart)
  const endTime = Date.parse(rangeEnd)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error("registration_calendar_range_invalid")
  }

  const requestedStatuses = input.statuses === undefined ? ["scheduled"] : input.statuses
  if (!Array.isArray(requestedStatuses)) throw new Error("registration_calendar_status_invalid")
  const requested = new Set<unknown>(requestedStatuses)
  if ([...requested].some((status) => !REGISTRATION_APPOINTMENT_CALENDAR_STATUSES.includes(
    status as RegistrationAppointmentCalendarStatus,
  ))) {
    throw new Error("registration_calendar_status_invalid")
  }
  const statuses = REGISTRATION_APPOINTMENT_CALENDAR_STATUSES.filter((status) => requested.has(status))
  return { rangeStart, rangeEnd, statuses, observationRuntimeVersion }
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

const REGISTRATION_NOTIFICATION_JOB_KINDS = new Set<RegistrationNotificationJobKind>([
  "fanout",
  "rule_reconciliation",
  "target_reconciliation",
])

const REGISTRATION_NOTIFICATION_JOB_STATUSES = new Set<RegistrationNotificationJobStatus["status"]>([
  "pending",
  "claimed",
  "succeeded",
  "failed",
])

function registrationNotificationJobKind(input: unknown): RegistrationNotificationJobKind {
  const kind = text(input) as RegistrationNotificationJobKind
  if (!REGISTRATION_NOTIFICATION_JOB_KINDS.has(kind)) {
    throw new Error("registration_notification_job_kind_invalid")
  }
  return kind
}

function mapRegistrationNotificationJobReference(row: Row): RegistrationNotificationJobReference {
  const jobId = text(value(row, "job_id", "jobId"))
  if (!jobId) throw new Error("registration_notification_job_id_invalid")
  return {
    jobKind: registrationNotificationJobKind(value(row, "job_kind", "jobKind")),
    jobId,
  }
}

function registrationNotificationJobRows(row: Row) {
  return rows(value(row, "notification_jobs", "notificationJobs"))
}

function mapRegistrationAppointmentMutationResponse(
  input: unknown,
): RegistrationAppointmentMutationResponse {
  const row = firstRow(input)
  if (!row) throw new Error("registration_appointment_response_invalid")
  return {
    appointmentId: text(value(row, "appointment_id", "appointmentId")),
    notificationRevision: numberValue(value(row, "notification_revision", "notificationRevision")),
    notificationTargets: rows(value(row, "notification_targets", "notificationTargets")).map((target) => ({
      appointmentId: text(value(target, "appointment_id", "appointmentId")),
      notificationRevision: numberValue(value(target, "notification_revision", "notificationRevision")),
    })),
    requiresDirectorAssignmentTrackIds: stringList(value(
      row,
      "requires_director_assignment_track_ids",
      "requiresDirectorAssignmentTrackIds",
    )),
    notificationJobs: registrationNotificationJobRows(row).map(mapRegistrationNotificationJobReference),
  }
}

function mapRegistrationAppointmentReminderPreview(row: Row): RegistrationAppointmentReminderPreview {
  return {
    ruleId: text(value(row, "rule_id", "ruleId")),
    ruleRevision: text(value(row, "rule_revision", "ruleRevision")),
    variantKey: text(value(row, "variant_key", "variantKey")),
    scheduledFor: text(value(row, "scheduled_for", "scheduledFor")),
    audienceKey: text(value(row, "audience_key", "audienceKey")),
    channelKey: text(value(row, "channel_key", "channelKey")),
  }
}

function mapRegistrationNotificationJobStatus(input: unknown): RegistrationNotificationJobStatus {
  const row = firstRow(input)
  if (!row) throw new Error("registration_notification_job_status_invalid")
  const attemptCount = numberValue(value(row, "attempt_count", "attemptCount"))
  if (!Number.isInteger(attemptCount) || attemptCount < 0) {
    throw new Error("registration_notification_job_attempt_count_invalid")
  }
  const workflowKey = text(value(row, "workflow_key", "workflowKey"))
  if (workflowKey !== "registration") {
    throw new Error("registration_notification_job_workflow_mismatch")
  }
  const jobStatus = text(value(row, "status")) as RegistrationNotificationJobStatus["status"]
  if (!REGISTRATION_NOTIFICATION_JOB_STATUSES.has(jobStatus)) {
    throw new Error("registration_notification_job_status_invalid")
  }
  return {
    ...mapRegistrationNotificationJobReference(row),
    workflowKey,
    status: jobStatus,
    attemptCount,
    nextAttemptAt: nullableText(value(row, "next_attempt_at", "nextAttemptAt")),
    lastErrorCode: nullableText(value(row, "last_error_code", "lastErrorCode")),
    createdAt: text(value(row, "created_at", "createdAt")),
    completedAt: nullableText(value(row, "completed_at", "completedAt")),
  }
}

function subject(input: unknown): RegistrationSubject {
  const parsed = parseAcademicSubject(input)
  if (!parsed) throw new Error("registration_subject_unsupported")
  return parsed
}

function orderedRegistrationSubjects(values: readonly RegistrationSubject[]): RegistrationSubject[] {
  const order: readonly RegistrationSubject[] = ["영어", "수학", "과학"]
  return values
    .map((value) => subject(value))
    .filter((value, index, subjects) => subjects.indexOf(value) === index)
    .sort((left, right) => order.indexOf(left) - order.indexOf(right))
}

function trackStatus(input: unknown): OpsRegistrationTrackStatus {
  return (text(input) || "inquiry") as OpsRegistrationTrackStatus
}

function workflowStatus(row: Row): OpsRegistrationWorkflowStatus {
  const direct = text(value(row, "workflow_status", "workflowStatus"))
  if (isOpsRegistrationWorkflowStatus(direct)) return direct
  if (isRegistrationObservationTrackWorkflowStatus(direct)) {
    throw new Error("registration_observation_ui_not_ready")
  }
  return opsRegistrationWorkflowStatusFromLegacy({
    status: text(value(row, "pipeline_status", "status")),
    waitingKind: text(value(row, "waiting_kind", "waitingKind")),
  })
}

function registrationObservationTrackWorkflowStatus(
  row: Row,
): RegistrationObservationTrackWorkflowStatus {
  const direct = text(value(row, "workflow_status", "workflowStatus"))
  if (isRegistrationObservationTrackWorkflowStatus(direct)) return direct
  return workflowStatus(row)
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

function mapRegistrationObservationSummary(
  row: Row,
  required = false,
): RegistrationObservationSummaryAccess {
  const rawValues = [
    value(row, "observation_attempt_count", "observationAttemptCount"),
    value(row, "observation_current_id", "observationCurrentId"),
    value(row, "observation_current_status", "observationCurrentStatus"),
    value(row, "observation_current_appointment_id", "observationCurrentAppointmentId"),
    value(row, "observation_nearest_scheduled_at", "observationNearestScheduledAt"),
    value(row, "observation_nearest_place", "observationNearestPlace"),
    value(row, "observation_notification_revision", "observationNotificationRevision"),
    value(row, "observation_revision", "observationRevision"),
    value(row, "observation_feedback_revision", "observationFeedbackRevision"),
  ]
  if (!required && rawValues.every((item) => item === undefined)) {
    return {
      ...EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
      observationSummaryVisible: false,
    }
  }
  if (rawValues.every((item) => item === null)) {
    return {
      ...EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
      observationSummaryVisible: false,
    }
  }
  return {
    ...normalizeRegistrationObservationSummary({
      observationAttemptCount: rawValues[0],
      observationCurrentId: rawValues[1],
      observationCurrentStatus: rawValues[2],
      observationCurrentAppointmentId: rawValues[3],
      observationNearestScheduledAt: rawValues[4],
      observationNearestPlace: rawValues[5],
      observationNotificationRevision: rawValues[6],
      observationRevision: rawValues[7],
      observationFeedbackRevision: rawValues[8],
    }),
    observationSummaryVisible: true,
  }
}

function rowNeedsRegistrationObservationSummary(row: Row): boolean {
  return value(row, "observation_attempt_count", "observationAttemptCount") === undefined
    || value(row, "observation_current_id", "observationCurrentId") === undefined
    || value(row, "observation_current_status", "observationCurrentStatus") === undefined
    || value(row, "observation_current_appointment_id", "observationCurrentAppointmentId") === undefined
    || value(row, "observation_nearest_scheduled_at", "observationNearestScheduledAt") === undefined
    || value(row, "observation_nearest_place", "observationNearestPlace") === undefined
    || value(row, "observation_notification_revision", "observationNotificationRevision") === undefined
    || value(row, "observation_revision", "observationRevision") === undefined
    || value(row, "observation_feedback_revision", "observationFeedbackRevision") === undefined
}

function mapRegistrationEnrollmentRowInput(row: Row): RegistrationEnrollmentRowInput {
  const id = nullableText(value(row, "id"))
  return {
    ...(id ? { id } : {}),
    classId: text(value(row, "classId", "class_id")),
    textbookId: nullableText(value(row, "textbookId", "textbook_id")),
    classStartDate: nullableText(value(row, "classStartDate", "class_start_date")),
    classStartSessionKey: nullableText(value(row, "classStartSessionKey", "class_start_session_key")),
    classStartLessonSessionId: nullableText(value(row, "classStartLessonSessionId", "class_start_lesson_session_id")),
    classStartSession: nullableText(value(row, "classStartSession", "class_start_session")),
    classStartSourceObservationId: nullableText(value(
      row,
      "classStartSourceObservationId",
      "class_start_source_observation_id",
    )),
    sortOrder: numberValue(value(row, "sortOrder", "sort_order")),
  }
}

function mapTrackFields<
  TWorkflowStatus extends RegistrationObservationTrackWorkflowStatus,
>(
  row: Row,
  resolvedWorkflowStatus: TWorkflowStatus,
  directorNames = new Map<string, string>(),
  legacy = false,
): OpsRegistrationTrackSummaryFields<TWorkflowStatus> {
  const directorProfileId = nullableText(value(row, "director_profile_id", "directorProfileId"))
  const director = embeddedDirector(row)
  const levelTestScheduledAt = text(value(row, "level_test_scheduled_at", "levelTestScheduledAt"))
  const levelTestPlace = text(value(row, "level_test_place", "levelTestPlace"))
  const visitScheduledAt = text(value(row, "visit_scheduled_at", "visitScheduledAt"))
  const visitPlace = text(value(row, "visit_place", "visitPlace"))
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    subject: subject(value(row, "subject")),
    status: trackStatus(value(row, "pipeline_status", "status")),
    workflowStatus: resolvedWorkflowStatus,
    workflowRevision: numberValue(value(row, "workflow_revision", "workflowRevision")) || 1,
    workflowStatusEnteredAt: text(value(row, "workflow_status_entered_at", "workflowStatusEnteredAt")),
    legacy,
    directorProfileId,
    directorName: directorProfileId
      ? text(value(director, "name")) || directorNames.get(directorProfileId) || ""
      : "",
    directorAssignmentSource: directorSource(value(row, "director_assignment_source", "directorAssignmentSource")),
    directorAssignmentRuleKey: text(value(row, "director_assignment_rule_key", "directorAssignmentRuleKey")),
    waitingKind: waitingKind(value(row, "waiting_kind", "waitingKind")),
    waitingDetailKind: waitingKind(value(row, "waiting_detail_kind", "waitingDetailKind")),
    waitingDetailClassId: nullableText(value(row, "waiting_detail_class_id", "waitingDetailClassId")),
    waitingDetailRetakeDecision: retakeDecision(value(row, "waiting_detail_retake_decision", "waitingDetailRetakeDecision")),
    ...(value(row, "enrollment_detail_rows", "enrollmentDetailRows") === undefined ? {} : {
      enrollmentDetailRows: rows(value(row, "enrollment_detail_rows", "enrollmentDetailRows"))
        .map(mapRegistrationEnrollmentRowInput),
    }),
    levelTestRetakeDecision: retakeDecision(value(row, "level_test_retake_decision", "levelTestRetakeDecision")),
    migrationReviewRequired: bool(value(row, "migration_review_required", "migrationReviewRequired")),
    stageEnteredAt: text(value(row, "stage_entered_at", "stageEnteredAt")),
    phoneReadyAt: nullableText(value(row, "phone_ready_at", "phoneReadyAt")),
    phoneReadySource: phoneReadySource(value(row, "phone_ready_source", "phoneReadySource")),
    ...(levelTestScheduledAt ? { levelTestScheduledAt, levelTestPlace } : {}),
    ...(visitScheduledAt ? { visitScheduledAt, visitPlace } : {}),
  }
}

function mapTrack(
  row: Row,
  directorNames = new Map<string, string>(),
  legacy = false,
  observationSummaryRequired = false,
): OpsRegistrationTrackSummary {
  const trackFields = mapTrackFields(row, workflowStatus(row), directorNames, legacy)
  const mappedObservationSummary = !observationSummaryRequired
    && rowNeedsRegistrationObservationSummary(row)
    ? {
        ...EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
        observationSummaryVisible: false,
      }
    : mapRegistrationObservationSummary(row, observationSummaryRequired)
  const observationSummary: RegistrationObservationSummary = {
    observationAttemptCount: mappedObservationSummary.observationAttemptCount,
    observationCurrentId: mappedObservationSummary.observationCurrentId,
    observationCurrentStatus: mappedObservationSummary.observationCurrentStatus,
    observationCurrentAppointmentId: mappedObservationSummary.observationCurrentAppointmentId,
    observationNearestScheduledAt: mappedObservationSummary.observationNearestScheduledAt,
    observationNearestPlace: mappedObservationSummary.observationNearestPlace,
    observationNotificationRevision: mappedObservationSummary.observationNotificationRevision,
    observationRevision: mappedObservationSummary.observationRevision,
    observationFeedbackRevision: mappedObservationSummary.observationFeedbackRevision,
  }
  return {
    ...trackFields,
    ...observationSummary,
  }
}

function mapRegistrationObservationTrackSummary(
  row: Row,
  observationSummaryRequired: boolean,
): OpsRegistrationObservationTrackSummary {
  return {
    ...mapTrackFields(row, registrationObservationTrackWorkflowStatus(row)),
    ...mapRegistrationObservationSummary(row, observationSummaryRequired),
  }
}

function mapGenericTrackSummary(
  row: Row,
): RegistrationTrackSummaryLoadResult["tracks"][number] {
  return mapTrackFields(row, workflowStatus(row))
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
    classStartLessonSessionId: nullableText(value(row, "class_start_lesson_session_id", "classStartLessonSessionId")),
    classStartSession: nullableText(value(row, "class_start_session", "classStartSession")),
    classStartSourceObservationId: nullableText(value(
      row,
      "class_start_source_observation_id",
      "classStartSourceObservationId",
    )),
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
    note: nullableText(value(row, "note")),
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

function registrationTrackEventPayloadVersion(payload: Record<string, unknown> | null) {
  if (payload?.version === 1 || payload?.version === "1") return 1
  if (payload?.version === 2 || payload?.version === "2") return 2
  return null
}

function exactRegistrationTrackEventType(input: unknown) {
  return typeof input === "string" ? input : ""
}

function mapTrackEvent(row: Row): OpsRegistrationTrackEvent {
  const outerEventType = exactRegistrationTrackEventType(
    value(row, "event_type", "eventType"),
  )
  const payload = outerEventType === "registration_track_event"
    ? parseJsonRecord(value(row, "after_value", "afterValue"))
    : null
  const payloadVersion = registrationTrackEventPayloadVersion(payload)
  const versionOne = payloadVersion === 1 ? payload : null
  const versionTwo = payloadVersion === 2 ? payload : null
  const canonical = versionTwo || versionOne
  const rawSubject = canonical ? nullableText(canonical.subject) : null
  const rawActorKind = versionTwo ? text(versionTwo.actor_kind) : ""
  const actorKind = rawActorKind === "user"
    || rawActorKind === "system"
    || rawActorKind === "migration"
    ? rawActorKind
    : null
  const reasonCode = versionTwo
    ? nullableText(versionTwo.reason_code)
    : versionOne
      ? nullableText(versionOne.reason)
      : null
  return {
    id: text(value(row, "id")),
    taskId: text(value(row, "task_id", "taskId")),
    trackId: versionTwo
      ? nullableText(versionTwo.track_id)
      : versionOne
        ? nullableText(versionOne.trackId)
        : null,
    eventType: versionTwo
      ? exactRegistrationTrackEventType(versionTwo.event_type) || outerEventType
      : versionOne
        ? exactRegistrationTrackEventType(versionOne.eventType) || outerEventType
        : outerEventType,
    subject: parseAcademicSubject(rawSubject),
    source: canonical ? nullableText(canonical.source) : null,
    destination: canonical ? nullableText(canonical.destination) : null,
    reason: reasonCode,
    metadata: canonical
      ? parseJsonRecord(canonical.metadata) || {}
      : {
          fieldName: text(value(row, "field_name", "fieldName")),
          beforeValue: nullableText(value(row, "before_value", "beforeValue")),
          afterValue: nullableText(value(row, "after_value", "afterValue")),
        },
    actorId: versionTwo
      ? nullableText(versionTwo.actor_profile_id)
      : versionOne
        ? nullableText(versionOne.actorId)
        : nullableText(value(row, "actor_id", "actorId")),
    actorKind,
    systemSource: versionTwo ? nullableText(versionTwo.system_source) : null,
    reasonCode,
    payloadVersion,
    occurredAt: versionTwo
      ? text(versionTwo.occurred_at) || text(value(row, "created_at", "createdAt"))
      : versionOne
        ? text(versionOne.occurredAt) || text(value(row, "created_at", "createdAt"))
        : text(value(row, "created_at", "createdAt")),
    legacyText: canonical ? null : nullableText(value(row, "after_value", "afterValue")),
  }
}

const REGISTRATION_OBSERVATION_EVENT_PREFIX = "registration_observation_"

function isBookingOnlyRegistrationAppointmentRow(row: Row) {
  return text(value(row, "kind")) === "observation_class"
}

function isBookingOnlyRegistrationEventRow(row: Row) {
  const outerEventType = exactRegistrationTrackEventType(
    value(row, "event_type", "eventType"),
  )
  if (outerEventType.startsWith(REGISTRATION_OBSERVATION_EVENT_PREFIX)) return true
  if (outerEventType !== "registration_track_event") return false

  const payload = parseJsonRecord(value(row, "after_value", "afterValue"))
  const payloadVersion = registrationTrackEventPayloadVersion(payload)
  const innerEventType = payloadVersion === 2
    ? exactRegistrationTrackEventType(payload?.event_type)
    : payloadVersion === 1
      ? exactRegistrationTrackEventType(payload?.eventType)
      : ""
  return innerEventType.startsWith(REGISTRATION_OBSERVATION_EVENT_PREFIX)
}

function withoutBookingOnlyRegistrationObservationDetail<
  TTrack extends OpsRegistrationTrackSummary | OpsRegistrationObservationTrackSummary,
>(
  detail: OpsRegistrationCaseDetailFields<TTrack>,
): OpsRegistrationCaseDetailFields<TTrack> {
  return {
    ...detail,
    appointments: detail.appointments.filter(
      (appointment) => String(appointment.kind) !== "observation_class",
    ),
    events: detail.events.filter(
      (event) => !event.eventType.startsWith(REGISTRATION_OBSERVATION_EVENT_PREFIX),
    ),
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

function registrationEnrollmentRowPayload(row: RegistrationEnrollmentRowInput) {
  return {
    id: normalizeUuid(row.id),
    classId: row.classId,
    textbookId: normalizeUuid(row.textbookId),
    classStartDate: nullableText(row.classStartDate),
    classStartSessionKey: nullableText(row.classStartSessionKey),
    classStartLessonSessionId: normalizeUuid(row.classStartLessonSessionId),
    classStartSession: nullableText(row.classStartSession),
    classStartSourceObservationId: normalizeUuid(row.classStartSourceObservationId),
    sortOrder: row.sortOrder,
  }
}

function requireRequestKey(input: unknown) {
  const requestKey = text(input)
  if (!requestKey) throw new Error("A non-empty request key is required.")
  return requestKey
}

function normalizeRegistrationInitialLevelTestAppointment(
  input: RegistrationCaseCreateWithInitialWorkflowInput,
): RegistrationCaseCreateWithInitialWorkflowInput {
  if (!input.levelTestAppointment) return input
  const place = normalizeRegistrationLevelTestPlace(input.levelTestAppointment.place)
  if (!place) throw new Error("registration_level_test_place_invalid")
  if (place === input.levelTestAppointment.place) return input
  return {
    ...input,
    levelTestAppointment: {
      ...input.levelTestAppointment,
      place,
    },
  }
}

function normalizeRegistrationSharedAppointmentInput(
  input: SaveRegistrationSharedAppointmentInput,
): SaveRegistrationSharedAppointmentInput {
  if (input.kind !== "level_test") return input
  const place = normalizeRegistrationLevelTestPlace(input.place)
  if (!place) throw new Error("registration_level_test_place_invalid")
  if (place === input.place) return input
  return { ...input, place }
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

function missingTrackSummaryOptionalColumnError(error: unknown) {
  if (!missingColumnError(error)) return false
  const message = error && typeof error === "object" && "message" in error
    ? text(error.message).toLowerCase()
    : ""
  return [
    "phone_ready_at",
    "phone_ready_source",
    "waiting_detail_kind",
    "waiting_detail_class_id",
    "waiting_detail_retake_decision",
    "level_test_scheduled_at",
    "level_test_place",
  ].some((column) => message.includes(column))
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return text(error.message)
  return text(error) || "선택 정보를 불러오지 못했습니다."
}

function isClearlyInactiveStatus(input: unknown) {
  const normalized = text(input).toLowerCase()
  return ["inactive", "archived", "disabled", "미사용", "비활성", "폐강", "종료", "종강"].includes(normalized)
}

const SCIENCE_CONSULTATION_CLASS_OPTION_CACHE_TTL_MS = 60_000
const REGISTRATION_CASE_DETAIL_REQUEST_TIMEOUT_MS = 15_000

function registrationRequestTimeout(message: string) {
  const error = new Error(message) as Error & { code?: string }
  error.name = "RegistrationRequestTimeoutError"
  error.code = "REGISTRATION_REQUEST_TIMEOUT"
  return error
}

function withRegistrationRequestTimeout<T>(
  request: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      onTimeout?.()
      reject(registrationRequestTimeout(message))
    }, timeoutMs)
  })

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle)
  })
}

export function createRegistrationTrackService(
  client: RegistrationTrackClient,
  options: RegistrationTrackServiceOptions,
) {
  if (!options || typeof options.probeRuntime !== "function") {
    throw new Error("probeRuntime is required.")
  }
  if (typeof options.probeIntakeRuntime !== "function") {
    throw new Error("probeIntakeRuntime is required.")
  }
  const invalidatePublicClassesAfterMutation = options.invalidatePublicClassesCacheAfterMutation
    || invalidatePublicClassesCacheAfterMutation
  type TrackSummaryMode = "generic" | "observation"
  type TrackSummarySelectionResult =
    | RegistrationTrackSummaryLoadResult
    | RegistrationObservationTrackSummaryLoadResult
  const summaryCache = new Map<string, TrackSummarySelectionResult>()
  const summaryInFlight = new Map<string, Promise<TrackSummarySelectionResult>>()
  const summaryEpochs = new Map<string, number>()
  const detailCache = new Map<
    string,
    OpsRegistrationCaseDetail | OpsRegistrationObservationCaseDetail
  >()
  const detailInFlight = new Map<
    string,
    Promise<OpsRegistrationCaseDetail | OpsRegistrationObservationCaseDetail>
  >()
  const detailEpochs = new Map<string, number>()
  const optionCache = new Map<string, OpsRegistrationWorkspaceOptionData>()
  const optionInFlight = new Map<string, Promise<OpsRegistrationWorkspaceOptionData>>()
  const optionEpochs = new Map<string, number>()
  const scienceConsultationClassOptionCache = new Map<string, {
    data: OpsClassOption[]
    expiresAt: number
  }>()
  const scienceConsultationClassOptionInFlight = new Map<string, Promise<OpsClassOption[]>>()
  const scienceConsultationClassOptionEpochs = new Map<string, number>()
  let cacheGeneration = 0
  let measureSequence = 0
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && Number(options.requestTimeoutMs) > 0
    ? Number(options.requestTimeoutMs)
    : REGISTRATION_CASE_DETAIL_REQUEST_TIMEOUT_MS

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
    scienceConsultationClassOptionCache.clear()
    scienceConsultationClassOptionInFlight.clear()
    scienceConsultationClassOptionEpochs.clear()
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

  async function queryRows(
    builder: QueryBuilder,
    metrics: { queryCount: number },
    signal?: AbortSignal,
  ) {
    metrics.queryCount += 1
    const request = signal && typeof builder.abortSignal === "function"
      ? builder.abortSignal(signal)
      : builder
    const { data, error } = await request
    if (error) throw error
    return rows(data)
  }

  async function queryOne(
    builder: QueryBuilder,
    metrics: { queryCount: number },
    signal?: AbortSignal,
  ) {
    metrics.queryCount += 1
    const request = signal && typeof builder.abortSignal === "function"
      ? builder.abortSignal(signal)
      : builder
    const { data, error } = await request
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

  function loadRegistrationAppointmentCalendarRows(
    input: RegistrationAppointmentCalendarLoadInput,
  ): Promise<RegistrationAppointmentCalendarRow[]> {
    const {
      rangeStart,
      rangeEnd,
      statuses,
      observationRuntimeVersion,
    } = normalizeRegistrationAppointmentCalendarInput(input)
    if (statuses.length === 0) return Promise.resolve([])

    return measure("registration:appointment-calendar", false, async (metrics) => {
      await requireReadyRuntime()
      try {
        let query = client.from("ops_registration_appointment_calendar")
          .select(REGISTRATION_APPOINTMENT_CALENDAR_COLUMNS)
        if (observationRuntimeVersion === 0) {
          query = query.neq("kind", "observation_class")
        }
        const calendarRows = await queryRows(
          query
            .gte("scheduled_at", rangeStart)
            .lt("scheduled_at", rangeEnd)
            .in("status", statuses)
            .order("scheduled_at", { ascending: true })
            .order("appointment_id", { ascending: true }),
          metrics,
        )
        return calendarRows as RegistrationAppointmentCalendarRow[]
      } catch (error) {
        if (missingSchemaError(error)) return invalidateReadyRuntime(error)
        throw error
      }
    })
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
      workflowStatus: opsRegistrationWorkflowStatusFromLegacy({ status: input.status }),
      workflowRevision: 1,
      workflowStatusEnteredAt: input.stageEnteredAt || "",
      legacy: true,
      directorProfileId: null,
      directorName: input.directorName || "",
      directorAssignmentSource: "" as const,
      directorAssignmentRuleKey: "",
      waitingKind: "" as const,
      waitingDetailKind: "" as const,
      waitingDetailClassId: null,
      waitingDetailRetakeDecision: "" as const,
      levelTestRetakeDecision: "" as const,
      migrationReviewRequired: false,
      stageEnteredAt: input.stageEnteredAt || "",
      phoneReadyAt: null,
      phoneReadySource: null,
      ...EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
    } satisfies OpsRegistrationTrackSummary)))
  }

  function loadTrackSummarySelection(
    taskIds: string[] | null,
    viewerId: string,
    mode: "generic",
    loadOptions?: { force?: boolean },
  ): Promise<RegistrationTrackSummaryLoadResult>
  function loadTrackSummarySelection(
    taskIds: string[] | null,
    viewerId: string,
    mode: "observation",
    loadOptions?: { force?: boolean },
  ): Promise<RegistrationObservationTrackSummaryLoadResult>
  function loadTrackSummarySelection(
    taskIds: string[] | null,
    viewerId: string,
    mode: TrackSummaryMode,
    loadOptions: { force?: boolean } = {},
  ): Promise<TrackSummarySelectionResult> {
    const normalizedTaskIds = taskIds === null
      ? null
      : [...new Set(taskIds.map(text).filter(Boolean))].sort()
    return loadTrackSummarySelectionResolved(
      normalizedTaskIds,
      requireViewerId(viewerId),
      mode,
      loadOptions,
    )
  }

  async function loadTrackSummarySelectionResolved(
    normalizedTaskIds: string[] | null,
    viewerId: string,
    mode: TrackSummaryMode,
    loadOptions: { force?: boolean },
  ): Promise<TrackSummarySelectionResult> {
    const observationRuntime = mode === "observation"
      ? await (
          options.probeObservationRuntime
            ? options.probeObservationRuntime()
            : Promise.resolve<RegistrationObservationRuntimeState>({
                available: false,
                runtimeVersion: 0,
              })
        )
      : null
    const observationAvailable = observationRuntime !== null
      && observationRuntime.available
      && observationRuntime.runtimeVersion === 1
    const runtimeIdentity = observationRuntime === null
      ? "generic"
      : `runtime-${observationRuntime.runtimeVersion}:available-${observationRuntime.available ? 1 : 0}`
    const cacheKey = `${mode}:${runtimeIdentity}:${viewerId}:${normalizedTaskIds === null ? "workspace" : normalizedTaskIds.join(",")}`
    if (loadOptions.force) {
      advanceEpoch(summaryEpochs, cacheKey)
      summaryCache.delete(cacheKey)
      summaryInFlight.delete(cacheKey)
    }
    const cached = summaryCache.get(cacheKey)
    const measureName = normalizedTaskIds === null
      ? `registration:track-summary:workspace:${mode}`
      : `registration:track-summary:${mode}`
    if (cached) return measure(measureName, true, async () => cached)
    const pending = summaryInFlight.get(cacheKey)
    if (pending) return pending
    const generation = cacheGeneration
    const requestEpoch = summaryEpochs.get(cacheKey) || 0

    const request = measure<TrackSummarySelectionResult>(measureName, false, async (metrics) => {
      const registrationRuntimeRequest = probeRuntime()
      const loadTrackRows = async () => {
        try {
          const summaryQuery = client.from("ops_registration_subject_track_summaries")
            .select(observationAvailable
              ? TRACK_SUMMARY_COLUMNS
              : PRE_OBSERVATION_TRACK_SUMMARY_COLUMNS)
          return await queryRows(
            normalizedTaskIds === null
              ? summaryQuery
              : summaryQuery.in("task_id", normalizedTaskIds),
            metrics,
          )
        } catch (error) {
          if (observationAvailable || !missingTrackSummaryOptionalColumnError(error)) throw error
          const fallbackQuery = client.from("ops_registration_subject_track_summaries")
            .select(PRE_INTAKE_TRACK_SUMMARY_COLUMNS)
          return queryRows(
            normalizedTaskIds === null
              ? fallbackQuery
              : fallbackQuery.in("task_id", normalizedTaskIds),
            metrics,
          )
        }
      }
      const eagerWorkspaceRows = normalizedTaskIds === null
        ? loadTrackRows().then(
            (trackRows) => ({ ok: true as const, trackRows }),
            (error) => ({ ok: false as const, error }),
          )
        : null
      const runtime = await registrationRuntimeRequest
      if (runtime.mode !== "ready" || runtime.version !== 1) {
        return { mode: runtime.mode, tracks: [] }
      }
      if (normalizedTaskIds?.length === 0) return { mode: "ready", tracks: [] }

      try {
        let trackRows: Row[]
        if (eagerWorkspaceRows) {
          const result = await eagerWorkspaceRows
          if (!result.ok) throw result.error
          trackRows = result.trackRows
        } else {
          trackRows = await loadTrackRows()
        }
        if (mode === "observation") {
          return {
            mode: "ready",
            tracks: trackRows.map((row) => mapRegistrationObservationTrackSummary(
              row,
              observationAvailable,
            )),
          }
        }
        return {
          mode: "ready",
          tracks: trackRows.map(mapGenericTrackSummary),
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

  function loadTrackSummaries(
    taskIds: string[],
    viewerId: string,
    loadOptions: { force?: boolean } = {},
  ) {
    return loadTrackSummarySelection(taskIds, viewerId, "observation", loadOptions)
  }

  function loadLegacyCompatibleTrackSummaries(
    taskIds: string[],
    viewerId: string,
    loadOptions: { force?: boolean } = {},
  ): Promise<RegistrationTrackSummaryLoadResult> {
    return loadTrackSummarySelection(taskIds, viewerId, "generic", loadOptions)
  }

  function loadWorkspaceTrackSummaries(
    viewerId: string,
    loadOptions: { force?: boolean } = {},
  ) {
    return loadTrackSummarySelection(null, viewerId, "observation", loadOptions)
  }

  function loadLegacyCompatibleWorkspaceTrackSummaries(
    viewerId: string,
    loadOptions: { force?: boolean } = {},
  ): Promise<RegistrationTrackSummaryLoadResult> {
    return loadTrackSummarySelection(null, viewerId, "generic", loadOptions)
  }

  function loadCaseDetail(
    taskId: string,
    viewerId: string,
    loadOptions: { force?: boolean; observationAware: true },
  ): Promise<OpsRegistrationObservationCaseDetail>
  function loadCaseDetail(
    taskId: string,
    viewerId: string,
    loadOptions?: { force?: boolean; observationAware?: false },
  ): Promise<OpsRegistrationCaseDetail>
  function loadCaseDetail(
    taskId: string,
    viewerId: string,
    loadOptions: { force?: boolean; observationAware?: boolean } = {},
  ): Promise<OpsRegistrationCaseDetail | OpsRegistrationObservationCaseDetail> {
    const safeTaskId = text(taskId)
    const safeViewerId = requireViewerId(viewerId)
    const observationAware = loadOptions.observationAware === true
    const cacheKey = `${observationAware ? "observation" : "generic"}:${safeViewerId}:${safeTaskId}`
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

    const request = measure("registration:case-detail", false, (metrics) => {
      const controller = typeof AbortController === "function" ? new AbortController() : null
      const signal = controller?.signal
      const detailRequest = (async () => {
      const phaseOneRequest = Promise.all([
        queryOne(
          client.from("ops_tasks").select(PARENT_DETAIL_COLUMNS).eq("id", safeTaskId).single(),
          metrics,
          signal,
        ),
        ...TASK_SCOPED_CASE_READS.map(([table, columns]) => {
          const taskQuery = client.from(table).select(columns).eq("task_id", safeTaskId)
          return queryRows(
            table === "ops_registration_appointments"
              ? taskQuery.neq("kind", "observation_class")
              : taskQuery,
            metrics,
            signal,
          )
        }),
        queryRows(
          client.from("ops_task_events")
            .select(EVENT_COLUMNS)
            .eq("task_id", safeTaskId)
            .eq("registration_task_event_shared_visible", true),
          metrics,
          signal,
        ),
        queryRows(
          client.from("ops_registration_messages")
            .select(MESSAGE_COLUMNS)
            .eq("task_id", safeTaskId)
            .eq("template_key", "admission_application")
            .eq("claim_active", true)
            .limit(1),
          metrics,
          signal,
        ),
      ])
        .then(
          (phaseOne) => ({ ok: true as const, phaseOne }),
          (error) => ({ ok: false as const, error }),
        )
      await requireReadyRuntime()
      try {
        const phaseOneResult = await phaseOneRequest
        if (!phaseOneResult.ok) throw phaseOneResult.error
        const phaseOne = phaseOneResult.phaseOne
        const [parentRow, trackRows, appointmentRows, batchRows, eventRows, messageRows] = phaseOne as [
          Row, Row[], Row[], Row[], Row[], Row[],
        ]
        const sharedAppointmentRows = appointmentRows.filter(
          (row) => !isBookingOnlyRegistrationAppointmentRow(row),
        )
        const sharedEventRows = eventRows.filter(
          (row) => !isBookingOnlyRegistrationEventRow(row),
        )
        const levelTestRows = trackRows.flatMap((row) => rows(value(row, "level_tests")))
        const consultationRows = trackRows.flatMap((row) => rows(value(row, "consultations")))
        const enrollmentRows = trackRows.flatMap((row) => rows(value(row, "enrollments")))
        const detailRow = firstRow(value(parentRow, "ops_registration_details")) || {}
        const comments = rows(value(parentRow, "ops_task_comments")).map(mapComment)
        const attachments = rows(value(parentRow, "ops_task_attachments")).map(mapAttachment)
        const activeMessage = messageRows[0] || null
        const activeStatus = text(value(activeMessage, "status"))
        const messageStatus = activeStatus === "failed"
          ? "failed_hold"
          : (["pending", "accepted", "unknown"].includes(activeStatus) ? activeStatus : "")

        function buildDetail<
          TTrack extends OpsRegistrationTrackSummary | OpsRegistrationObservationTrackSummary,
        >(tracks: TTrack[]): OpsRegistrationCaseDetailFields<TTrack> {
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
            appointments: sharedAppointmentRows.map(mapAppointment),
            levelTests: levelTestRows.map(mapLevelTest),
            consultations: consultationRows.map(mapConsultation),
            admissionBatches: batchRows.map(mapBatch),
            enrollments: enrollmentRows.map(mapEnrollment),
            events: sharedEventRows.map(mapTrackEvent),
            migrationLegacy: tracks.some((track) => track.migrationReviewRequired)
              ? buildRegistrationMigrationLegacySnapshot(parentRow, detailRow, sharedEventRows)
              : null,
          }
        }

        if (!observationAware) return buildDetail(trackRows.map((row) => mapTrack(row)))

        const rowsMissingObservationSummary = trackRows.some(rowNeedsRegistrationObservationSummary)
        const summaryResult = rowsMissingObservationSummary
          ? await loadTrackSummarySelection(
              [safeTaskId],
              safeViewerId,
              "observation",
              { force: loadOptions.force },
            )
          : null
        const summaryByTrackId = new Map(
          (summaryResult?.tracks || []).map((track) => [track.id, track]),
        )
        const tracks = trackRows.map((row) => {
          const summary = summaryByTrackId.get(text(value(row, "id")))
          if (summary) return summary
          if (rowNeedsRegistrationObservationSummary(row)) {
            throw new Error("registration_observation_summary_invalid")
          }
          return mapRegistrationObservationTrackSummary(row, true)
        })
        return buildDetail(tracks)
      } catch (error) {
        if (missingSchemaError(error)) return invalidateReadyRuntime(error)
        throw error
      }
      })()
      return withRegistrationRequestTimeout(
        detailRequest,
        requestTimeoutMs,
        "registration_query_timeout",
        () => controller?.abort(),
      ).catch((error) => {
        controller?.abort()
        throw error
      })
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
      const [profiles, classes, textbooks, teachers, schools] = await Promise.all([
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
        readWithFallback("academic_schools", ["id,name,category,sort_order"], metrics),
      ])
      const requiredErrors = [profiles.error, classes.error, textbooks.error, teachers.error].filter(Boolean)
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
      const schoolOptions = schools.rows.map((row) => ({
        id: text(value(row, "id")),
        name: text(value(row, "name")),
        category: text(value(row, "category")),
        sortOrder: numberValue(value(row, "sort_order", "sortOrder")),
      } satisfies OpsSchoolOption))

      return {
        profiles: profileOptions,
        students: [],
        classes: classOptions,
        textbooks: textbookOptions,
        teachers: teacherOptions,
        schemaReady: requiredErrors.length === 0,
        error: requiredErrors.length > 0 ? errorText(requiredErrors[0]) : null,
        directorCatalogStatus,
        schools: schoolOptions,
        schoolCatalogStatus: schools.error ? "error" : "authoritative",
        schoolCatalogError: schools.error ? errorText(schools.error) : null,
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

  function loadAssignedScienceConsultationClassOptions(
    loadOptions: { viewerId: string; consultationId: string; force?: boolean },
  ): Promise<OpsClassOption[]> {
    const viewerId = requireViewerId(loadOptions.viewerId)
    const consultationId = text(loadOptions.consultationId)
    if (!consultationId) throw new Error("A non-empty consultation ID is required.")
    const cacheKey = `${viewerId}\u0000${consultationId}`
    if (loadOptions.force) {
      advanceEpoch(scienceConsultationClassOptionEpochs, cacheKey)
      scienceConsultationClassOptionCache.delete(cacheKey)
      scienceConsultationClassOptionInFlight.delete(cacheKey)
    }
    const cached = scienceConsultationClassOptionCache.get(cacheKey)
    if (cached && cached.expiresAt > (options.now?.() ?? Date.now())) {
      return measure("registration:science-consultation-class-options", true, async () => cached.data)
    }
    scienceConsultationClassOptionCache.delete(cacheKey)
    const pending = scienceConsultationClassOptionInFlight.get(cacheKey)
    if (pending) return pending
    const generation = cacheGeneration
    const requestEpoch = scienceConsultationClassOptionEpochs.get(cacheKey) || 0

    const request = measure("registration:science-consultation-class-options", false, async (metrics) => {
      metrics.queryCount += 1
      const { data, error } = await client
        .from("classes")
        .select("id,name,subject,grade,teacher,room,status")
        .eq("subject", "과학")
      if (error) throw error
      return rows(data)
        .filter((row) => (
          Boolean(text(value(row, "id")))
          && text(value(row, "subject")) === "과학"
          && !isClearlyInactiveStatus(value(row, "status"))
        ))
        .map((row) => ({
          id: text(value(row, "id")),
          label: text(value(row, "name")) || text(value(row, "id")),
          meta: [text(value(row, "grade")), text(value(row, "teacher"))].filter(Boolean).join(" · "),
          subject: "과학",
          grade: text(value(row, "grade")),
          teacher: text(value(row, "teacher")),
          room: text(value(row, "room")),
          schedule: "",
          studentIds: [],
          waitlistIds: [],
          textbookIds: [],
        } satisfies OpsClassOption))
    })
      .then((result) => {
        if (
          generation === cacheGeneration
          && requestEpoch === (scienceConsultationClassOptionEpochs.get(cacheKey) || 0)
        ) {
          scienceConsultationClassOptionCache.set(cacheKey, {
            data: result,
            expiresAt: (options.now?.() ?? Date.now()) + SCIENCE_CONSULTATION_CLASS_OPTION_CACHE_TTL_MS,
          })
        }
        return result
      })
      .finally(() => {
        if (scienceConsultationClassOptionInFlight.get(cacheKey) === request) {
          scienceConsultationClassOptionInFlight.delete(cacheKey)
        }
      })
    scienceConsultationClassOptionInFlight.set(cacheKey, request)
    return request
  }

  async function callRpc<T>(
    name: string,
    args: Record<string, unknown>,
    callOptions: { runtimeChecked?: boolean } = {},
  ): Promise<T> {
    if (!callOptions.runtimeChecked) await requireReadyRuntime()
    const request = client.rpc(name, args)
    const { data, error } = await (
      typeof request.retry === "function" ? request.retry(false) : request
    )
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

  async function callReadRpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await requireReadyRuntime()
    const { data, error } = await client.rpc(name, args)
    if (error) throw error
    return data
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
    const normalizedInput = normalizeRegistrationInitialLevelTestAppointment(input)
    await requireReadyRuntime()
    const intakeRuntime = await options.probeIntakeRuntime()
    if (intakeRuntime.available !== true || intakeRuntime.version !== 1) {
      throw new Error("registration_intake_runtime_mismatch")
    }
    const result = await callRpc<RegistrationCaseCreateWithInitialWorkflowResponse>(
      "create_registration_case_with_initial_workflow_v1",
      {
        p_student_name: normalizedInput.studentName,
        p_school_grade: normalizedInput.schoolGrade,
        p_school_name: normalizedInput.schoolName,
        p_parent_phone: normalizedInput.parentPhone,
        p_student_phone: normalizedInput.studentPhone,
        p_campus: normalizedInput.campus,
        p_inquiry_at: normalizedInput.inquiryAt,
        p_subjects: normalizedInput.subjects,
        p_request_note: normalizedInput.requestNote,
        p_priority: normalizedInput.priority,
        p_subject_plans: normalizedInput.subjectPlans,
        p_level_test_appointment: normalizedInput.levelTestAppointment,
        p_visit_appointment: normalizedInput.visitAppointment,
        p_director_overrides: normalizedInput.directorOverrides,
        p_request_key: requireRequestKey(normalizedInput.requestKey),
      },
      { runtimeChecked: true },
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

  async function saveRegistrationCaseInquiry(
    input: RegistrationCaseInquirySaveInput,
  ): Promise<RegistrationCaseInquirySaveResponse> {
    const expectedSubjects = orderedRegistrationSubjects(input.expectedSubjects)
    const subjects = orderedRegistrationSubjects(input.subjects)
    const result = await callRpc<RegistrationCaseInquirySaveResponse>("save_registration_case_inquiry_v1", {
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
      p_expected_subjects: expectedSubjects,
      p_subjects: subjects,
      p_request_key: requireRequestKey(input.requestKey),
    })
    const tracks = rows(value(result as unknown as Row, "tracks"))
      .map((row) => mapTrack(row))
      .sort((left, right) => (
        (["영어", "수학", "과학"] as RegistrationSubject[]).indexOf(left.subject)
          - (["영어", "수학", "과학"] as RegistrationSubject[]).indexOf(right.subject)
        || left.id.localeCompare(right.id)
      ))
    return {
      ...result,
      subjects,
      tracks,
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
    const normalizedInput = normalizeRegistrationSharedAppointmentInput(input)
    const result = await callRpc<unknown>("save_registration_appointment_details_v1", {
      p_appointment_id: normalizeUuid(normalizedInput.appointmentId),
      p_task_id: normalizedInput.taskId,
      p_kind: normalizedInput.kind,
      p_scheduled_at: normalizedInput.scheduledAt,
      p_place: normalizedInput.place,
      p_track_ids: normalizedInput.trackIds,
      p_expected_notification_revision: normalizedInput.expectedNotificationRevision,
      p_request_key: requireRequestKey(normalizedInput.requestKey),
    })
    return mapRegistrationAppointmentMutationResponse(result)
  }

  async function cancelRegistrationAppointment(input: {
    appointmentId: string
    expectedNotificationRevision: number
    reason: string
    requestKey: string
  }): Promise<RegistrationAppointmentMutationResponse> {
    const result = await callRpc<unknown>("cancel_registration_appointment", {
      p_appointment_id: input.appointmentId,
      p_expected_notification_revision: input.expectedNotificationRevision,
      p_reason: input.reason,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return mapRegistrationAppointmentMutationResponse(result)
  }

  async function previewRegistrationAppointmentReminders(input: {
    kind: OpsRegistrationAppointment["kind"]
    scheduledAt: string
    trackIds: string[]
  }): Promise<RegistrationAppointmentReminderPreview[]> {
    const result = await callReadRpc("preview_registration_appointment_reminders_v1", {
      p_kind: input.kind,
      p_scheduled_at: input.scheduledAt,
      p_track_ids: input.trackIds,
    })
    return rows(result).map(mapRegistrationAppointmentReminderPreview)
  }

  async function getRegistrationNotificationJobStatus(
    input: RegistrationNotificationJobReference,
  ): Promise<RegistrationNotificationJobStatus> {
    const jobKind = registrationNotificationJobKind(input.jobKind)
    const jobId = text(input.jobId)
    if (!jobId) throw new Error("registration_notification_job_id_invalid")
    const result = await callReadRpc("get_notification_orchestration_job_status_v1", {
      p_job_kind: jobKind,
      p_job_id: jobId,
    })
    const status = mapRegistrationNotificationJobStatus(result)
    if (status.jobKind !== jobKind || status.jobId !== jobId) {
      throw new Error("registration_notification_job_identity_mismatch")
    }
    return status
  }

  async function retryRegistrationNotificationJob(input: {
    jobKind: RegistrationNotificationJobKind
    jobId: string
    expectedAttemptCount: number
    requestId: string
  }): Promise<RegistrationNotificationJobStatus> {
    const jobKind = registrationNotificationJobKind(input.jobKind)
    const jobId = text(input.jobId)
    if (!jobId) throw new Error("registration_notification_job_id_invalid")
    if (!Number.isInteger(input.expectedAttemptCount) || input.expectedAttemptCount < 0) {
      throw new Error("registration_notification_job_attempt_count_invalid")
    }
    const result = await callRpc<unknown>("retry_notification_orchestration_job_v1", {
      p_job_kind: jobKind,
      p_job_id: jobId,
      p_expected_attempt_count: input.expectedAttemptCount,
      p_request_id: requireRequestKey(input.requestId),
    })
    const status = mapRegistrationNotificationJobStatus(result)
    if (status.jobKind !== jobKind || status.jobId !== jobId) {
      throw new Error("registration_notification_job_identity_mismatch")
    }
    return status
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

  async function saveRegistrationLevelTestResult(input: {
    attemptId: string
    status: "completed" | "absent" | "canceled"
    materialLink: string
    requestKey: string
  }): Promise<RegistrationLevelTestResultSaveResponse> {
    const result = await callRpc<Row>("save_registration_level_test_result_v1", {
      p_attempt_id: input.attemptId,
      p_status: input.status,
      p_material_link: input.status === "completed" ? input.materialLink.trim() : null,
      p_request_key: requireRequestKey(input.requestKey),
    })
    const status = text(value(result, "status"))
    if (!( ["completed", "absent", "canceled"] as const).includes(status as "completed" | "absent" | "canceled")) {
      throw new Error("registration_level_test_result_response_invalid")
    }
    return {
      attemptId: text(value(result, "attempt_id", "attemptId")),
      trackId: text(value(result, "track_id", "trackId")),
      status: status as RegistrationLevelTestResultSaveResponse["status"],
      materialLink: nullableText(value(result, "material_link", "materialLink")),
    }
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

  async function saveRegistrationConsultationDetails(input: {
    consultationId: string
    status: "waiting" | "scheduled" | "completed" | "canceled"
    outcome: "" | "enrollment" | "waiting" | "not_registered"
    note: string
    requestKey: string
  }): Promise<RegistrationConsultationDetailsSaveResponse> {
    const result = await callRpc<Row>("save_registration_consultation_details_v1", {
      p_consultation_id: input.consultationId,
      p_status: input.status,
      p_outcome: input.status === "completed" ? input.outcome : null,
      p_note: nullableText(input.note),
      p_request_key: requireRequestKey(input.requestKey),
    })
    const status = text(value(result, "status"))
    const outcome = text(value(result, "outcome"))
    if (!( ["waiting", "scheduled", "completed", "canceled"] as const).includes(status as RegistrationConsultationDetailsSaveResponse["status"])
      || !( ["", "enrollment", "waiting", "not_registered"] as const).includes(outcome as RegistrationConsultationDetailsSaveResponse["outcome"])) {
      throw new Error("registration_consultation_details_response_invalid")
    }
    return {
      consultationId: text(value(result, "consultation_id", "consultationId")),
      trackId: text(value(result, "track_id", "trackId")),
      status: status as RegistrationConsultationDetailsSaveResponse["status"],
      outcome: outcome as RegistrationConsultationDetailsSaveResponse["outcome"],
      note: nullableText(value(result, "note")),
    }
  }

  async function saveRegistrationPhoneConsultation(input: {
    trackId: string
    requestKey: string
  }): Promise<OpsRegistrationConsultation> {
    const result = await callRpc<Row>("save_registration_phone_consultation_v1", {
      p_track_id: input.trackId,
      p_request_key: requireRequestKey(input.requestKey),
    })
    const consultation = mapConsultation(result)
    if (!consultation.id
      || consultation.trackId !== input.trackId
      || consultation.mode !== "phone"
      || consultation.status !== "waiting") {
      throw new Error("registration_phone_consultation_response_invalid")
    }
    return consultation
  }

  async function setRegistrationWorkflowStatus(input: {
    trackId: string
    workflowStatus: OpsRegistrationWorkflowStatus
    expectedWorkflowRevision: number
    requestKey: string
  }): Promise<RegistrationWorkflowStatusMutationResponse> {
    const result = await callRpc<Row>("set_registration_workflow_status_v1", {
      p_track_id: input.trackId,
      p_workflow_status: input.workflowStatus,
      p_expected_workflow_revision: input.expectedWorkflowRevision,
      p_request_key: requireRequestKey(input.requestKey),
    })
    const status = text(value(result, "workflow_status", "workflowStatus"))
    if (!isOpsRegistrationWorkflowStatus(status)) {
      throw new Error("registration_workflow_status_response_invalid")
    }
    return {
      trackId: text(value(result, "track_id", "trackId")),
      workflowStatus: status,
      workflowRevision: numberValue(value(result, "workflow_revision", "workflowRevision")),
      workflowStatusEnteredAt: text(value(result, "workflow_status_entered_at", "workflowStatusEnteredAt")),
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

  async function saveRegistrationWaitingDetails(input: {
    trackId: string
    waitingKind: RegistrationWaitingKind
    classId: string
    retakeDecision: "required" | "not_required"
    requestKey: string
  }): Promise<RegistrationWaitingDetailsSaveResponse> {
    const result = await callRpc<Row>("save_registration_waiting_details_v1", {
      p_track_id: input.trackId,
      p_waiting_kind: input.waitingKind,
      p_class_id: normalizeUuid(input.classId),
      p_retake_decision: input.retakeDecision,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      trackId: text(value(result, "track_id", "trackId")),
      waitingKind: waitingKind(value(result, "waiting_kind", "waitingKind")),
      classId: nullableText(value(result, "class_id", "classId")) || "",
      retakeDecision: retakeDecision(value(result, "retake_decision", "retakeDecision")) || "not_required",
    }
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

  async function loadRegistrationEnrollmentStartObservation(input: {
    trackId: string
  }): Promise<RegistrationObservationFeedbackDetail | null> {
    const trackId = text(input.trackId)
    if (!trackId) throw new Error("registration_track_id_invalid")
    const observationClient = client as unknown as RegistrationObservationClient
    const managerDetail = await loadRegistrationObservationManagerDetail(observationClient, {
      trackId,
      attemptLimit: 1,
    })
    if (managerDetail.track.trackId !== trackId) return null
    const observationId = nullableText(managerDetail.latestEnrollmentDecisionObservationId)
    if (!observationId) return null
    const detail = await loadRegistrationObservationFeedback(
      observationClient,
      observationId,
      { timeoutMs: requestTimeoutMs, force: true },
    )
    if (detail.observationId !== observationId || detail.trackId !== trackId) return null
    return detail
  }

  async function saveRegistrationEnrollmentRows(input: {
    trackId: string
    rows: RegistrationEnrollmentRowInput[]
    requestKey: string
  }): Promise<RegistrationEnrollmentRowsSaveResponse> {
    const payloadRows = input.rows.map(registrationEnrollmentRowPayload)
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

  async function saveRegistrationEnrollmentDetails(input: {
    trackId: string
    rows: RegistrationEnrollmentRowInput[]
    requestKey: string
  }): Promise<{ trackId: string; rows: RegistrationEnrollmentRowInput[] }> {
    const payloadRows = input.rows.map(registrationEnrollmentRowPayload)
    const result = await callRpc<Row>("save_registration_enrollment_details_v1", {
      p_track_id: input.trackId,
      p_rows: payloadRows,
      p_request_key: requireRequestKey(input.requestKey),
    })
    return {
      trackId: text(value(result, "track_id", "trackId")),
      rows: rows(value(result, "rows")).map(mapRegistrationEnrollmentRowInput),
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

  async function listRegistrationLegacySourceIds(taskId: string): Promise<string[]> {
    const normalizedTaskId = text(taskId)
    if (!normalizedTaskId) throw new Error("registration_task_id_invalid")
    const result = await callReadRpc("list_registration_legacy_source_ids_v1", {
      p_task_id: normalizedTaskId,
    })
    const row = firstRow(result)
    if (!row) throw new Error("registration_legacy_source_response_invalid")
    return stringList(value(row, "source_event_ids", "sourceEventIds"))
  }

  async function ensureRegistrationCaseCreatedNotificationSourceIds(taskId: string): Promise<string[]> {
    const normalizedTaskId = text(taskId)
    if (!normalizedTaskId) throw new Error("registration_task_id_invalid")
    const result = await callRpc<Row>("ensure_registration_case_created_notification_v1", {
      p_task_id: normalizedTaskId,
    })
    return Array.from(new Set(stringList(value(result, "source_event_ids", "sourceEventIds"))))
  }

  async function ensureRegistrationWorkflowNotificationSourceIds(input: {
    trackId: string
    workflowRevision: number
  }): Promise<string[]> {
    const normalizedTrackId = text(input.trackId)
    if (!normalizedTrackId || !Number.isInteger(input.workflowRevision) || input.workflowRevision < 1) {
      throw new Error("registration_workflow_notification_source_invalid")
    }
    const result = await callRpc<Row>("ensure_registration_workflow_notification_v1", {
      p_track_id: normalizedTrackId,
      p_workflow_revision: input.workflowRevision,
    })
    return Array.from(new Set(stringList(value(result, "source_event_ids", "sourceEventIds"))))
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
    const publicClassesCacheRefresh = await invalidatePublicClassesAfterMutation(client, "class")
    return {
      batch: mapBatch(value(result as unknown as Row, "batch") as Row),
      enrollments: rows(value(result as unknown as Row, "enrollments")).map(mapEnrollment),
      publicClassesCacheRefresh,
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
    const publicClassesCacheRefresh = await invalidatePublicClassesAfterMutation(client, "class")
    return {
      ...result,
      enrollment: mapEnrollment(value(result as unknown as Row, "enrollment") as Row),
      track: value(result as unknown as Row, "track")
        ? mapTrack(value(result as unknown as Row, "track") as Row)
        : undefined,
      publicClassesCacheRefresh,
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
    loadRegistrationAppointmentCalendarRows,
    loadTrackSummaries,
    loadLegacyCompatibleTrackSummaries,
    loadWorkspaceTrackSummaries,
    loadLegacyCompatibleWorkspaceTrackSummaries,
    loadCaseDetail,
    loadWorkspaceOptionData,
    loadAssignedScienceConsultationClassOptions,
    createRegistrationCase,
    createRegistrationCaseWithInitialWorkflow,
    syncRegistrationCaseSubjects,
    saveRegistrationCaseInquiry,
    updateRegistrationCaseCommon,
    routeRegistrationInquiry,
    assignRegistrationTrackDirector,
    saveRegistrationSharedAppointment,
    cancelRegistrationAppointment,
    previewRegistrationAppointmentReminders,
    getRegistrationNotificationJobStatus,
    retryRegistrationNotificationJob,
    startRegistrationLevelTestAttempt,
    completeRegistrationLevelTestAttempt,
    saveRegistrationLevelTestResult,
    closeRegistrationLevelTestTrack,
    completeRegistrationConsultation,
    saveRegistrationConsultationDetails,
    saveRegistrationPhoneConsultation,
    setRegistrationWorkflowStatus,
    transitionRegistrationWaiting,
    saveRegistrationWaitingDetails,
    routeRegistrationEnrollmentDecision,
    loadRegistrationEnrollmentStartObservation,
    saveRegistrationEnrollmentRows,
    saveRegistrationEnrollmentDetails,
    listRegistrationLegacySourceIds,
    ensureRegistrationCaseCreatedNotificationSourceIds,
    ensureRegistrationWorkflowNotificationSourceIds,
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

function mapRegistrationProcessingHeartbeat<Kind extends "worker" | "watchdog">(
  input: unknown,
  kind: Kind,
): { kind: Kind; phase: unknown; createdAt: unknown } | null {
  if (!input || typeof input !== "object") return null
  const row = input as Record<string, unknown>
  if (row.kind !== kind) return null
  return { kind, phase: row.phase, createdAt: row.createdAt }
}

const loadRegistrationNotificationProcessingReadiness =
  createRegistrationNotificationProcessingReadinessLoader<RegistrationNotificationProcessingReadiness>(
    async (token) => {
      const response = await fetch("/api/notifications/operations?view=registration-processing-readiness", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error("registration_notification_processing_readiness_unavailable")
      const payload = await response.json() as Record<string, unknown>
      return {
        registrationRuntimeMarker: "registration_appointment_reminders_runtime_version",
        registrationRuntimeVersion: payload.registrationRuntimeVersion,
        adaptersRuntimeMarker: "notification_workflow_adapters_runtime_version",
        adaptersRuntimeVersion: payload.adaptersRuntimeVersion,
        workerHeartbeat: mapRegistrationProcessingHeartbeat(payload.workerHeartbeat, "worker"),
        watchdogHeartbeat: mapRegistrationProcessingHeartbeat(payload.watchdogHeartbeat, "watchdog"),
      }
    },
  )

export function getRegistrationNotificationProcessingReadiness(
  accessToken: string,
): Promise<RegistrationNotificationProcessingReadiness> {
  return loadRegistrationNotificationProcessingReadiness(accessToken)
}

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
    probeIntakeRuntime: probeRegistrationIntakeWorkflowRuntime,
    probeObservationRuntime: probeRegistrationObservationRuntime,
    invalidateRuntimeAfterReadyFailure: invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure,
    invalidatePublicClassesCacheAfterMutation,
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
  options: { force?: boolean; observationAware: true },
): Promise<RegistrationObservationTrackSummaryLoadResult>
export function loadRegistrationTrackSummaries(
  taskIds: string[],
  viewerId: string,
  options?: { force?: boolean; observationAware?: false },
): Promise<RegistrationTrackSummaryLoadResult>
export function loadRegistrationTrackSummaries(
  taskIds: string[],
  viewerId: string,
  options: { force?: boolean; observationAware?: boolean } = {},
): Promise<RegistrationObservationTrackSummaryLoadResult | RegistrationTrackSummaryLoadResult> {
  const loadOptions = { force: options.force }
  return options.observationAware
    ? defaultRegistrationTrackService.loadTrackSummaries(taskIds, viewerId, loadOptions)
    : defaultRegistrationTrackService.loadLegacyCompatibleTrackSummaries(
        taskIds,
        viewerId,
        loadOptions,
      )
}

export function loadRegistrationWorkspaceTrackSummaries(
  viewerId: string,
  options: { force?: boolean; observationAware: true },
): Promise<RegistrationObservationTrackSummaryLoadResult>
export function loadRegistrationWorkspaceTrackSummaries(
  viewerId: string,
  options?: { force?: boolean; observationAware?: false },
): Promise<RegistrationTrackSummaryLoadResult>
export function loadRegistrationWorkspaceTrackSummaries(
  viewerId: string,
  options: { force?: boolean; observationAware?: boolean } = {},
): Promise<RegistrationObservationTrackSummaryLoadResult | RegistrationTrackSummaryLoadResult> {
  const loadOptions = { force: options.force }
  return options.observationAware
    ? defaultRegistrationTrackService.loadWorkspaceTrackSummaries(viewerId, loadOptions)
    : defaultRegistrationTrackService.loadLegacyCompatibleWorkspaceTrackSummaries(
        viewerId,
        loadOptions,
      )
}

function toObservationAwareTrackSummary(
  track: OpsRegistrationTrackSummary,
): OpsRegistrationObservationTrackSummary {
  return {
    ...track,
    observationAttemptCount: track.observationAttemptCount ?? 0,
    observationCurrentId: track.observationCurrentId ?? null,
    observationCurrentStatus: track.observationCurrentStatus ?? null,
    observationCurrentAppointmentId: track.observationCurrentAppointmentId ?? null,
    observationNearestScheduledAt: track.observationNearestScheduledAt ?? null,
    observationNearestPlace: track.observationNearestPlace ?? null,
    observationNotificationRevision: track.observationNotificationRevision ?? null,
    observationRevision: track.observationRevision ?? null,
    observationFeedbackRevision: track.observationFeedbackRevision ?? null,
    observationSummaryVisible: track.observationSummaryVisible === true,
  }
}

export function toObservationAwareCaseDetail(
  detail: OpsRegistrationCaseDetail,
): OpsRegistrationObservationCaseDetail {
  const sharedDetail = withoutBookingOnlyRegistrationObservationDetail(detail)
  return {
    ...sharedDetail,
    tracks: sharedDetail.tracks.map(toObservationAwareTrackSummary),
  }
}

export function loadRegistrationCaseDetail(
  taskId: string,
  viewerId: string,
  options: { force?: boolean; observationAware: true },
): Promise<OpsRegistrationObservationCaseDetail>
export function loadRegistrationCaseDetail(
  taskId: string,
  viewerId: string,
  options?: { force?: boolean; observationAware?: false },
): Promise<OpsRegistrationCaseDetail>
export function loadRegistrationCaseDetail(
  taskId: string,
  viewerId: string,
  options: { force?: boolean; observationAware?: boolean } = {},
): Promise<OpsRegistrationCaseDetail | OpsRegistrationObservationCaseDetail> {
  const fixture = loadRegistrationSubjectTrackFixtureCase(taskId)
  if (fixture) {
    return fixture.then((detail) => (
      options.observationAware
        ? toObservationAwareCaseDetail(detail)
        : withoutBookingOnlyRegistrationObservationDetail(detail)
    ))
  }
  const loadOptions = { force: options.force }
  return options.observationAware
    ? defaultRegistrationTrackService.loadCaseDetail(taskId, viewerId, {
        ...loadOptions,
        observationAware: true,
      })
    : defaultRegistrationTrackService.loadCaseDetail(taskId, viewerId, loadOptions)
}

export async function loadRegistrationAppointmentCalendar(
  input: RegistrationAppointmentCalendarLoadInput,
): Promise<RegistrationAppointmentCalendarItem[]> {
  const fixtureRows = loadRegistrationSubjectTrackFixtureAppointmentCalendarRows(input)
  const calendarRows = fixtureRows
    ? await fixtureRows
    : await defaultRegistrationTrackService.loadRegistrationAppointmentCalendarRows(input)
  const buildOptions = {
    observationRuntimeVersion: input.observationRuntimeVersion,
    ...(input.statuses === undefined ? {} : { statuses: input.statuses }),
  }
  return buildRegistrationAppointmentCalendarItems(calendarRows, buildOptions)
}

export function loadOpsRegistrationWorkspaceOptionData(
  options: { viewerId: string; force?: boolean },
): Promise<OpsRegistrationWorkspaceOptionData> {
  const fixture = loadRegistrationSubjectTrackFixtureOptionData()
  if (fixture) return fixture
  return defaultRegistrationTrackService.loadWorkspaceOptionData(options)
}

export function loadAssignedScienceConsultationClassOptions(
  options: { viewerId: string; consultationId: string; force?: boolean },
): Promise<OpsClassOption[]> {
  const fixture = loadRegistrationSubjectTrackFixtureScienceConsultationClassOptions()
  if (fixture) return fixture
  return defaultRegistrationTrackService.loadAssignedScienceConsultationClassOptions(options)
}

export function createRegistrationCase(
  input: Parameters<typeof defaultRegistrationTrackService.createRegistrationCase>[0],
): Promise<RegistrationCaseCreateResponse> {
  return defaultRegistrationTrackService.createRegistrationCase(input)
}

export function createRegistrationCaseWithInitialWorkflow(
  input: RegistrationCaseCreateWithInitialWorkflowInput,
): Promise<RegistrationCaseCreateWithInitialWorkflowResponse> {
  const normalizedInput = normalizeRegistrationInitialLevelTestAppointment(input)
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationCaseCreateWithInitialWorkflowResponse>(
    "createRegistrationCaseWithInitialWorkflow",
    normalizedInput as unknown as Record<string, unknown>,
  )
  if (fixture !== null) return fixture
  return defaultRegistrationTrackService.createRegistrationCaseWithInitialWorkflow(normalizedInput)
}

export function syncRegistrationCaseSubjects(
  input: Parameters<typeof defaultRegistrationTrackService.syncRegistrationCaseSubjects>[0],
): Promise<RegistrationSubjectSyncResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationSubjectSyncResponse>("syncRegistrationCaseSubjects", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.syncRegistrationCaseSubjects(input)
}

export function saveRegistrationCaseInquiry(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationCaseInquiry>[0],
) {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationCaseInquirySaveResponse>(
    "saveRegistrationCaseInquiry",
    input,
  )
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationCaseInquiry(input)
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
  const normalizedInput = normalizeRegistrationSharedAppointmentInput(input)
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAppointmentMutationResponse>("saveRegistrationSharedAppointment", normalizedInput)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationSharedAppointment(normalizedInput)
}

export function cancelRegistrationAppointment(
  input: Parameters<typeof defaultRegistrationTrackService.cancelRegistrationAppointment>[0],
): Promise<RegistrationAppointmentMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationAppointmentMutationResponse>("cancelRegistrationAppointment", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.cancelRegistrationAppointment(input)
}

export function previewRegistrationAppointmentReminders(
  input: Parameters<typeof defaultRegistrationTrackService.previewRegistrationAppointmentReminders>[0],
): Promise<RegistrationAppointmentReminderPreview[]> {
  if (loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion() !== null) return Promise.resolve([])
  return defaultRegistrationTrackService.previewRegistrationAppointmentReminders(input)
}

export function getRegistrationNotificationJobStatus(
  input: Parameters<typeof defaultRegistrationTrackService.getRegistrationNotificationJobStatus>[0],
): Promise<RegistrationNotificationJobStatus> {
  if (loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion() !== null) {
    return Promise.reject(new Error("registration_notification_processing_fixture_unavailable"))
  }
  return defaultRegistrationTrackService.getRegistrationNotificationJobStatus(input)
}

export function retryRegistrationNotificationJob(
  input: Parameters<typeof defaultRegistrationTrackService.retryRegistrationNotificationJob>[0],
): Promise<RegistrationNotificationJobStatus> {
  if (loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion() !== null) {
    return Promise.reject(new Error("registration_notification_processing_fixture_unavailable"))
  }
  return defaultRegistrationTrackService.retryRegistrationNotificationJob(input)
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

export function saveRegistrationLevelTestResult(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationLevelTestResult>[0],
): Promise<RegistrationLevelTestResultSaveResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationLevelTestResultSaveResponse>("saveRegistrationLevelTestResult", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationLevelTestResult(input)
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

export function saveRegistrationConsultationDetails(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationConsultationDetails>[0],
): Promise<RegistrationConsultationDetailsSaveResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationConsultationDetailsSaveResponse>("saveRegistrationConsultationDetails", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationConsultationDetails(input)
}

export function saveRegistrationPhoneConsultation(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationPhoneConsultation>[0],
): Promise<OpsRegistrationConsultation> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<OpsRegistrationConsultation>("saveRegistrationPhoneConsultation", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationPhoneConsultation(input)
}

export function setRegistrationWorkflowStatus(
  input: Parameters<typeof defaultRegistrationTrackService.setRegistrationWorkflowStatus>[0],
): Promise<RegistrationWorkflowStatusMutationResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationWorkflowStatusMutationResponse>("setRegistrationWorkflowStatus", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.setRegistrationWorkflowStatus(input)
}

export function transitionRegistrationWaiting(
  input: Parameters<typeof defaultRegistrationTrackService.transitionRegistrationWaiting>[0],
): Promise<RegistrationTrackTransitionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("transitionRegistrationWaiting", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.transitionRegistrationWaiting(input)
}

export function saveRegistrationWaitingDetails(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationWaitingDetails>[0],
): Promise<RegistrationWaitingDetailsSaveResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationWaitingDetailsSaveResponse>("saveRegistrationWaitingDetails", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationWaitingDetails(input)
}

export function routeRegistrationEnrollmentDecision(
  input: Parameters<typeof defaultRegistrationTrackService.routeRegistrationEnrollmentDecision>[0],
): Promise<RegistrationTrackTransitionResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("routeRegistrationEnrollmentDecision", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.routeRegistrationEnrollmentDecision(input)
}

export function loadRegistrationEnrollmentStartObservation(
  input: Parameters<typeof defaultRegistrationTrackService.loadRegistrationEnrollmentStartObservation>[0],
): Promise<RegistrationObservationFeedbackDetail | null> {
  return defaultRegistrationTrackService.loadRegistrationEnrollmentStartObservation(input)
}

export function saveRegistrationEnrollmentRows(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationEnrollmentRows>[0],
): Promise<RegistrationEnrollmentRowsSaveResponse> {
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationEnrollmentRowsSaveResponse>("saveRegistrationEnrollmentRows", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.saveRegistrationEnrollmentRows(input)
}

export function saveRegistrationEnrollmentDetails(
  input: Parameters<typeof defaultRegistrationTrackService.saveRegistrationEnrollmentDetails>[0],
) {
  return defaultRegistrationTrackService.saveRegistrationEnrollmentDetails(input)
}

export function claimRegistrationAdmissionMessage(
  input: Parameters<typeof defaultRegistrationTrackService.claimRegistrationAdmissionMessage>[0],
): Promise<RegistrationAdmissionMessageClaimResponse> {
  return defaultRegistrationTrackService.claimRegistrationAdmissionMessage(input)
}

export function loadRegistrationLegacyNotificationSourceIds(taskId: string): Promise<string[]> {
  return defaultRegistrationTrackService.listRegistrationLegacySourceIds(taskId)
}

export function ensureRegistrationCaseCreatedNotificationSourceIds(taskId: string): Promise<string[]> {
  return defaultRegistrationTrackService.ensureRegistrationCaseCreatedNotificationSourceIds(taskId)
}

export function ensureRegistrationWorkflowNotificationSourceIds(
  input: Parameters<typeof defaultRegistrationTrackService.ensureRegistrationWorkflowNotificationSourceIds>[0],
): Promise<string[]> {
  return defaultRegistrationTrackService.ensureRegistrationWorkflowNotificationSourceIds(input)
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
  const fixture = executeRegistrationSubjectTrackFixtureAction<RegistrationTrackTransitionResponse>("reopenRegistrationTrack", input)
  if (fixture) return fixture
  return defaultRegistrationTrackService.reopenRegistrationTrack(input)
}

export function setStudentClassRosterMode(
  input: Parameters<typeof defaultRegistrationTrackService.setStudentClassRosterMode>[0],
): Promise<StudentClassRosterModeResponse> {
  return defaultRegistrationTrackService.setStudentClassRosterMode(input)
}
