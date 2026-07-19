export type RegistrationTrackStatus =
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

export type RegistrationTrackViewKey =
  | "inquiry"
  | "level_test"
  | "consulting"
  | "waiting"
  | "enrollment"
  | "closed"

export type RegistrationTrackSummary = {
  id?: string
  taskId?: string
  subject?: "영어" | "수학"
  status: RegistrationTrackStatus
  directorProfileId?: string | null
  levelTestRetakeDecision?: "" | "required" | "not_required" | null
}

export type RegistrationAdmissionBatchSummary = {
  status: "draft" | "invoiced" | "paid" | "completed" | "canceled"
}

export type RegistrationTrackAction =
  | "schedule_level_test"
  | "route_consultation"
  | "route_waiting"
  | "close_inquiry"
  | "resolve_migration_review"
  | "start_level_test"
  | "record_level_test_result"
  | "cancel_level_test"
  | "complete_phone_consultation"
  | "schedule_visit"
  | "complete_visit_consultation"
  | "cancel_visit"
  | "change_waiting_kind"
  | "record_retest_required"
  | "move_to_enrollment"
  | "close_not_registered"
  | "start_enrollment_processing"
  | "complete_enrollment"
  | "cancel_admission_batch"
  | "start_add_class"
  | "cancel_enrollment"
  | "reopen_track"

type RegistrationTrackTransitionInput = {
  status?: RegistrationTrackStatus | null
  action?: RegistrationTrackAction | null
  outcome?: "" | "enrollment" | "waiting" | "not_registered" | null
  retakeDecision?: "required" | "not_required" | null
  hasActiveAttempt?: boolean
  lastAttemptStatus?: "scheduled" | "in_progress" | "completed" | "absent" | "canceled" | null
  resultStatus?: "completed" | "absent" | "canceled" | null
  enrollmentCount?: number
  everyScheduleValid?: boolean
  admissionNoticeSent?: boolean
  hasOtherOpenBatch?: boolean
  hasRemainingEnrolledRows?: boolean
  hasSurvivingEnrolledRows?: boolean
  destination?: RegistrationTrackStatus | null
}

type RegistrationLevelTestAttemptSummary = {
  status?: "scheduled" | "in_progress" | "completed" | "absent" | "canceled" | null
  materialLink?: string | null
}

type RegistrationAppointmentActivitySummary = {
  id?: string | null
  trackId?: string | null
  appointmentId?: string | null
  attemptNumber?: number | null
  mode?: "phone" | "visit" | null
  status?: "scheduled" | "in_progress" | "waiting" | "completed" | "absent" | "canceled" | null
}

type RegistrationConsultationSummary = {
  trackId?: string | null
  directorProfileId?: string | null
  mode?: "phone" | "visit" | null
  status?: "waiting" | "scheduled" | "completed" | "canceled" | null
}

type RegistrationPermissionInput = {
  viewerRole?: "admin" | "staff" | "assistant" | "teacher" | null
  viewerId?: string | null
  track?: RegistrationTrackSummary | null
  activeConsultation?: RegistrationConsultationSummary | null
}

export function getRegistrationTrackViewKey(
  status?: RegistrationTrackStatus | null,
): RegistrationTrackViewKey

export function getRegistrationTrackTabCounts(
  tracks?: readonly RegistrationTrackSummary[],
): Record<RegistrationTrackViewKey, number>

export function getAllowedRegistrationTrackActions(
  status?: RegistrationTrackStatus | null,
): readonly RegistrationTrackAction[]

export function isRegistrationTrackTerminal(
  status?: RegistrationTrackStatus | null,
): boolean

export function getRegistrationTrackNextStatus(
  input?: RegistrationTrackTransitionInput,
): RegistrationTrackStatus

export function getRegistrationTrackTransitionBlockers(
  input?: RegistrationTrackTransitionInput,
): string[]

export function getRegistrationLevelTestAppointmentStatus(
  attempts?: readonly RegistrationLevelTestAttemptSummary[],
): "scheduled" | "completed" | "canceled"

export function canEditRegistrationAppointment(
  activities?: readonly RegistrationAppointmentActivitySummary[],
): boolean

export function getEligibleSharedAppointmentTracks<T extends RegistrationTrackSummary>(
  kind: "level_test" | "visit_consultation",
  tracks?: readonly T[],
  activities?: readonly RegistrationAppointmentActivitySummary[],
  currentAppointmentId?: string | null,
): T[]

export function getRegistrationAppointmentEditMode(
  activities?: readonly RegistrationAppointmentActivitySummary[],
): "edit" | "replace_remaining"

export function getRegistrationAppointmentPayloadTrackIds(
  editMode: "edit" | "replace_remaining",
  selectedTrackIds?: readonly string[],
  activities?: readonly RegistrationAppointmentActivitySummary[],
  currentAppointmentId?: string | null,
): string[]

export function getLatestRegistrationLevelTestActivityIds(
  activities?: readonly RegistrationAppointmentActivitySummary[],
): string[]

export type RegistrationAdmissionApplicationState = {
  eligible: boolean
  delivered: boolean
  syncNeeded: boolean
  blocked: boolean
  canSend: boolean
}

export function getRegistrationAdmissionApplicationState(input?: {
  tracks?: readonly RegistrationTrackSummary[]
  enrollments?: readonly {
    trackId?: string | null
    status?: "planned" | "waitlisted" | "enrolled" | "canceled" | null
    admissionBatchId?: string | null
    rosterActive?: boolean | null
  }[]
  admissionNoticeSent?: boolean
  admissionApplicationMessageStatus?: "" | "pending" | "accepted" | "unknown" | "failed_hold" | null
  admissionApplicationMessageClaimActive?: boolean
}): RegistrationAdmissionApplicationState

export type RegistrationEnrollmentDraft = {
  id: string | null
  clientKey: string
  classId: string
  textbookId: string
  textbookExplicitlyCleared: boolean
  classStartDate: string
  classStartSessionKey: string
  classStartSession: string
  status: "planned" | "waitlisted" | "enrolled" | "canceled"
  makeeduRegistered: boolean
  rosterActive: boolean
  sortOrder: number
  admissionBatchId?: string | null
  rosterReleasedAt?: string | null
  rosterReleaseReason?: string | null
  rosterReleaseSourceTaskId?: string | null
  rosterReleaseKind?: "withdrawal" | "transfer" | null
}

export function getRegistrationCurrentClassWaitClassId(input?: {
  trackId?: string | null
  waitingKind?: string | null
  enrollments?: readonly {
    trackId?: string | null
    classId?: string | null
    status?: "planned" | "waitlisted" | "enrolled" | "canceled" | null
    rosterActive?: boolean | null
  }[]
}): string

export type RegistrationEnrollmentSerializedRow = {
  id?: string
  classId: string
  textbookId: string | null
  classStartDate: string | null
  classStartSessionKey: string | null
  classStartSession: string | null
  sortOrder: number
}

export type RegistrationEnrollmentBlocker = {
  rowId: string
  field: "classId" | "textbookId" | "classStartSessionKey"
  message: string
}

export function createRegistrationEnrollmentDraft(input?: Partial<RegistrationEnrollmentDraft>): RegistrationEnrollmentDraft

export function restoreRegistrationEnrollmentDraft(input?: Omit<Partial<RegistrationEnrollmentDraft>, "textbookId" | "classStartDate" | "classStartSessionKey" | "classStartSession"> & {
  textbookId?: string | null
  classStartDate?: string | null
  classStartSessionKey?: string | null
  classStartSession?: string | null
}): RegistrationEnrollmentDraft

export function applyRegistrationEnrollmentClassSelection(
  row: RegistrationEnrollmentDraft,
  input?: {
    classItem?: { id?: string | null; textbookIds?: readonly string[] } | null
    availableTextbookIds?: readonly string[]
  },
): RegistrationEnrollmentDraft

export function serializeRegistrationEnrollmentRows(
  rows?: readonly RegistrationEnrollmentDraft[],
): RegistrationEnrollmentSerializedRow[]

export function mergeSavedRegistrationEnrollmentRows(
  localRows?: readonly RegistrationEnrollmentDraft[],
  savedRows?: readonly (Omit<Partial<RegistrationEnrollmentDraft>, "textbookId" | "classStartDate" | "classStartSessionKey" | "classStartSession"> & {
    textbookId?: string | null
    classStartDate?: string | null
    classStartSessionKey?: string | null
    classStartSession?: string | null
  })[],
): RegistrationEnrollmentDraft[]

export function getRegistrationEnrollmentBlockers(input?: {
  subject?: string | null
  rows?: readonly RegistrationEnrollmentDraft[]
  classes?: readonly { id?: string | null; subject?: string | null }[]
  availableTextbookIds?: readonly string[]
  validTextbookIdsByClassId?: ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>
  validScheduleSessionKeysByClassId?: ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>
  requireSchedule?: boolean
}): RegistrationEnrollmentBlocker[]

export function getRegistrationAdmissionBatchChecklist(input?: {
  admissionNoticeSent?: boolean
  enrollments?: readonly { status?: string | null; makeeduRegistered?: boolean }[]
  batch?: {
    status?: "draft" | "invoiced" | "paid" | "completed" | "canceled" | null
    invoiceSentAt?: string | null
    paymentConfirmedAt?: string | null
  } | null
}): {
  admissionNotice: boolean
  makeedu: boolean
  invoice: boolean
  payment: boolean
  complete: boolean
}

type RegistrationEnrollmentCancellationSummary = {
  id?: string | null
  trackId?: string | null
  admissionBatchId?: string | null
  status?: "planned" | "waitlisted" | "enrolled" | "canceled" | null
  rosterActive?: boolean | null
}

export function getRegistrationEnrollmentCancellationState(input?: {
  enrollment?: RegistrationEnrollmentCancellationSummary | null
  enrollments?: readonly RegistrationEnrollmentCancellationSummary[]
}): {
  requiresDestination: boolean
  hasSurvivingEnrolledRows: boolean
  destination: "" | null
}

export function getRegistrationAdmissionBatchCancellationGroups(input?: {
  batchId?: string | null
  currentBatchEnrollments?: readonly RegistrationEnrollmentCancellationSummary[]
  enrollments?: readonly RegistrationEnrollmentCancellationSummary[]
}): {
  addClassTrackIds: string[]
  firstAdmissionTrackIds: string[]
}

export function getRegistrationSelectedAdmissionEnrollmentIds(input?: {
  selectedEnrollmentIds?: readonly string[] | ReadonlySet<string>
  enrollments?: readonly RegistrationEnrollmentCancellationSummary[]
}): string[]

export function getRegistrationAdmissionRecoveryDelayMs(
  updatedAt?: string | null,
  now?: number,
): number | null

export function getRegistrationSummaryActionPermissions(
  input?: Omit<RegistrationPermissionInput, "activeConsultation">,
): {
  canManage: boolean
  canOpenConsultationCompletion: boolean
}

export function getRegistrationActionPermissions(
  input?: RegistrationPermissionInput,
): {
  canManage: boolean
  canCompleteConsultation: boolean
  readOnly: boolean
}

export function deriveRegistrationParentState(input?: {
  tracks?: readonly RegistrationTrackSummary[]
  batches?: readonly RegistrationAdmissionBatchSummary[]
}): {
  taskStatus: "requested" | "in_progress" | "done" | "canceled"
  outcome: "" | "all_registered" | "partial_registration" | "none_registered"
}
