export type RegistrationWorkflowStatus =
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

export type RegistrationObservationWorkflowStatus =
  | "observation_requested"
  | "observation_feedback_pending"
  | "observation_completed"

export type RegistrationObservationTrackWorkflowStatus =
  | RegistrationWorkflowStatus
  | RegistrationObservationWorkflowStatus

export type RegistrationWorkflowViewKey =
  | "inquiry"
  | "level_test"
  | "consultation_requested"
  | "consultation_completed"
  | "waiting"
  | "observation"
  | "enrollment"
  | "payment"
  | "completed"

export type RegistrationWorkflowStatusOption = {
  value: RegistrationWorkflowStatus
  label: string
}

export const REGISTRATION_WORKFLOW_STATUSES: readonly RegistrationWorkflowStatus[]
export const REGISTRATION_WORKFLOW_VIEWS: readonly (readonly [RegistrationWorkflowViewKey, string])[]
export const REGISTRATION_OBSERVATION_WORKFLOW_STATUSES: readonly RegistrationObservationWorkflowStatus[]
export const REGISTRATION_OBSERVATION_TRACK_WORKFLOW_STATUSES: readonly RegistrationObservationTrackWorkflowStatus[]
export const REGISTRATION_WORKFLOW_STATUS_LABELS: Readonly<Record<RegistrationObservationTrackWorkflowStatus, string>>

export function getRegistrationWorkflowViewKey(status?: string | null): RegistrationWorkflowViewKey
export function isRegistrationObservationWorkflowStatus(
  status?: string | null,
): status is RegistrationObservationWorkflowStatus

export function getRegistrationWorkflowStatusFromLegacyTrack(track?: {
  status?: string | null
  pipelineStatus?: string | null
  waitingKind?: string | null
  waiting_kind?: string | null
}): RegistrationWorkflowStatus

export function getRegistrationWorkflowStatusOptions(input?: {
  viewerRole?: string | null
  viewerId?: string | null
  directorProfileId?: string | null
}): RegistrationWorkflowStatusOption[]

export function getRegistrationInlineWorkflowStatusOptions(input?: {
  currentStatus?: string | null
  viewerRole?: string | null
  viewerId?: string | null
  directorProfileId?: string | null
}): RegistrationWorkflowStatusOption[]
