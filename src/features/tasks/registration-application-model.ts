import {
  getAllowedRegistrationTrackActions,
  type RegistrationTrackAction,
} from "./registration-track-model.js"
import type { RegistrationInitialWorkflowDraft } from "./registration-intake-workflow"
import type {
  OpsRegistrationAdmissionBatch,
  OpsRegistrationAppointment,
  OpsRegistrationConsultation,
  OpsRegistrationLevelTest,
  OpsRegistrationTrackSummary,
  RegistrationSubject,
} from "./registration-track-service"

export const REGISTRATION_APPLICATION_SECTION_ORDER = [
  "inquiry",
  "level_test",
  "consultation",
  "placement",
  "admission",
  "history",
] as const

export type RegistrationApplicationSectionKey =
  (typeof REGISTRATION_APPLICATION_SECTION_ORDER)[number]

export type RegistrationApplicationDirtyKey =
  `${RegistrationApplicationSectionKey}:${string}`

export type RegistrationEnrollmentDirtyScope =
  | { kind: "rows" }
  | { kind: "decision" }
  | { kind: "cancellation"; enrollmentId: string }

export type RegistrationApplicationSectionState = {
  current: boolean
  editable: boolean
  lockReason: string
}

export type RegistrationApplicationTrackSectionState =
  RegistrationApplicationSectionState & {
    actions: readonly RegistrationTrackAction[]
  }

export const REGISTRATION_ACTION_SECTION = {
  schedule_level_test: "level_test",
  route_consultation: "consultation",
  route_waiting: "placement",
  close_inquiry: "inquiry",
  resolve_migration_review: "inquiry",
  start_level_test: "level_test",
  record_level_test_result: "level_test",
  cancel_level_test: "level_test",
  complete_phone_consultation: "consultation",
  schedule_visit: "consultation",
  complete_visit_consultation: "consultation",
  cancel_visit: "consultation",
  change_waiting_kind: "placement",
  record_retest_required: "placement",
  move_to_enrollment: "placement",
  close_not_registered: "placement",
  start_enrollment_processing: "placement",
  complete_enrollment: "admission",
  cancel_admission_batch: "admission",
  start_add_class: "placement",
  cancel_enrollment: "placement",
  reopen_track: "inquiry",
} as const satisfies Record<
  RegistrationTrackAction,
  RegistrationApplicationSectionKey
>

const CURRENT_SECTION_BY_STATUS: Record<
  OpsRegistrationTrackSummary["status"],
  RegistrationApplicationSectionKey
> = {
  inquiry: "inquiry",
  migration_review: "inquiry",
  level_test_scheduled: "level_test",
  level_test_in_progress: "level_test",
  consultation_waiting: "consultation",
  visit_consultation_scheduled: "consultation",
  waiting: "placement",
  enrollment_decided: "placement",
  enrollment_processing: "admission",
  registered: "placement",
  not_registered: "placement",
  inquiry_closed: "inquiry",
}

function getActionSection(
  status: OpsRegistrationTrackSummary["status"],
  action: RegistrationTrackAction,
): RegistrationApplicationSectionKey {
  if (action === "reopen_track" && status === "not_registered") return "placement"
  return REGISTRATION_ACTION_SECTION[action]
}

function getTrackLockReason(input: {
  section: RegistrationApplicationSectionKey
  currentSection: RegistrationApplicationSectionKey
  canManage: boolean
  canCompleteConsultation: boolean
  hasAllowedAction: boolean
}) {
  if (input.section === "history") return "자동으로 기록되는 읽기 전용 이력입니다"
  if (input.section !== input.currentSection) {
    if (!input.hasAllowedAction) return "현재 진행 단계가 아닙니다"
    return input.canManage ? "" : "이 작업을 수정할 권한이 없습니다"
  }
  if (input.canManage) return ""
  if (input.section === "consultation" && input.canCompleteConsultation) return ""
  return "이 작업을 수정할 권한이 없습니다"
}

export function getRegistrationApplicationTrackState(input: {
  track: OpsRegistrationTrackSummary
  canManage: boolean
  canCompleteConsultation: boolean
}): {
  trackId: string
  subject: RegistrationSubject
  currentSection: RegistrationApplicationSectionKey
  sections: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationTrackSectionState
  >
} {
  const currentSection = CURRENT_SECTION_BY_STATUS[input.track.status]
  const actionsBySection: Record<
    RegistrationApplicationSectionKey,
    RegistrationTrackAction[]
  > = {
    inquiry: [],
    level_test: [],
    consultation: [],
    placement: [],
    admission: [],
    history: [],
  }

  for (const action of getAllowedRegistrationTrackActions(input.track.status)) {
    actionsBySection[getActionSection(input.track.status, action)].push(action)
  }

  const sections = {} as Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationTrackSectionState
  >
  for (const section of REGISTRATION_APPLICATION_SECTION_ORDER) {
    const lockReason = getTrackLockReason({
      section,
      currentSection,
      canManage: input.canManage,
      canCompleteConsultation: input.canCompleteConsultation,
      hasAllowedAction: actionsBySection[section].length > 0,
    })
    sections[section] = {
      current: section === currentSection,
      editable: lockReason === "",
      lockReason,
      actions: actionsBySection[section],
    }
  }

  return {
    trackId: input.track.id,
    subject: input.track.subject,
    currentSection,
    sections,
  }
}

export type RegistrationApplicationAppointmentActionPlan = {
  appointmentId: string
  kind: OpsRegistrationAppointment["kind"]
  status: OpsRegistrationAppointment["status"]
  ownerTrackId: string
  participantTrackIds: string[]
  participantSubjects: RegistrationSubject[]
}

export function getRegistrationApplicationAppointmentActionPlans(input: {
  tracks: readonly Pick<OpsRegistrationTrackSummary, "id" | "subject">[]
  appointments: readonly Pick<OpsRegistrationAppointment, "id" | "kind" | "status">[]
  levelTests: readonly Pick<OpsRegistrationLevelTest, "appointmentId" | "trackId" | "status">[]
  consultations: readonly Pick<OpsRegistrationConsultation, "appointmentId" | "trackId" | "mode" | "status">[]
  actionableTrackIds?: readonly string[]
}): RegistrationApplicationAppointmentActionPlan[] {
  const actionableTrackIds = new Set(input.actionableTrackIds || [])
  return input.appointments.flatMap((appointment) => {
    if (appointment.status === "canceled") return []
    const participantIds = new Set(appointment.kind === "level_test"
      ? input.levelTests
        .filter((activity) => activity.appointmentId === appointment.id && activity.status !== "canceled")
        .map((activity) => activity.trackId)
      : input.consultations
        .filter((activity) => (
          activity.appointmentId === appointment.id
          && activity.mode === "visit"
          && activity.status === "scheduled"
        ))
        .map((activity) => activity.trackId))
    const participants = input.tracks.filter((track) => participantIds.has(track.id))
    if (participants.length === 0) return []
    const owner = participants.find((track) => actionableTrackIds.has(track.id)) || participants[0]
    return [{
      appointmentId: appointment.id,
      kind: appointment.kind,
      status: appointment.status,
      ownerTrackId: owner.id,
      participantTrackIds: participants.map((track) => track.id),
      participantSubjects: participants.map((track) => track.subject),
    }]
  })
}

export function getRegistrationApplicationCaseEditableSections(input: {
  canManage: boolean
  admissionMessageEditable: boolean
  admissionBatches: readonly Pick<OpsRegistrationAdmissionBatch, "status">[]
  appointmentActionSections?: readonly RegistrationApplicationSectionKey[]
}): RegistrationApplicationSectionKey[] {
  if (!input.canManage) return []
  const hasOpenAdmissionBatchAction = input.admissionBatches.some((batch) => (
    ["draft", "invoiced", "paid"].includes(batch.status)
  ))
  const editableSections = new Set<RegistrationApplicationSectionKey>([
    "inquiry",
    ...(input.appointmentActionSections || []).filter((section) => section === "level_test" || section === "consultation"),
  ])
  if (input.admissionMessageEditable || hasOpenAdmissionBatchAction) editableSections.add("admission")
  return REGISTRATION_APPLICATION_SECTION_ORDER.filter((section) => editableSections.has(section))
}

export function isRegistrationApplicationSectionContentDisabled(input: {
  mode: "create" | "detail"
  section: RegistrationApplicationSectionKey
  editable: boolean
}) {
  if (input.mode === "detail" && input.section === "history") return false
  return !input.editable
}

export function getRegistrationCreateSectionStates(input: {
  subjects: RegistrationSubject[]
  draft: RegistrationInitialWorkflowDraft
  writable: boolean
}): Record<RegistrationApplicationSectionKey, RegistrationApplicationSectionState> {
  const hasSubjects = input.subjects.length > 0
  const hasInitialPlan = Object.keys(input.draft.subjectPlans).length > 0
  const futureLockReason = hasSubjects && hasInitialPlan
    ? "저장 후 해당 단계에서 진행할 수 있습니다"
    : "과목과 다음 업무를 정한 뒤 저장할 수 있습니다"

  return {
    inquiry: {
      current: true,
      editable: input.writable,
      lockReason: input.writable ? "" : "등록 정보를 수정할 권한이 없습니다",
    },
    level_test: { current: false, editable: false, lockReason: futureLockReason },
    consultation: { current: false, editable: false, lockReason: futureLockReason },
    placement: { current: false, editable: false, lockReason: futureLockReason },
    admission: { current: false, editable: false, lockReason: futureLockReason },
    history: {
      current: false,
      editable: false,
      lockReason: "저장 시 자동 기록됩니다",
    },
  }
}

export function getRegistrationApplicationSectionStates(input: {
  tracks: readonly ReturnType<typeof getRegistrationApplicationTrackState>[]
  caseEditableSections?: readonly RegistrationApplicationSectionKey[]
}): Record<RegistrationApplicationSectionKey, RegistrationApplicationSectionState> {
  const caseEditableSections = new Set(input.caseEditableSections || [])
  const states = {} as Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationSectionState
  >

  for (const section of REGISTRATION_APPLICATION_SECTION_ORDER) {
    const trackStates = input.tracks.map((track) => track.sections[section])
    const editable = section !== "history" && (
      caseEditableSections.has(section) || trackStates.some((state) => state.editable)
    )
    states[section] = {
      current: trackStates.some((state) => state.current),
      editable,
      lockReason: editable
        ? ""
        : trackStates.find((state) => state.lockReason)?.lockReason
          || "진행 중인 과목이 없습니다",
    }
  }

  return states
}

export function updateRegistrationApplicationDirtyKeys(
  current: ReadonlySet<RegistrationApplicationDirtyKey>,
  key: RegistrationApplicationDirtyKey,
  dirty: boolean,
): Set<RegistrationApplicationDirtyKey> {
  if (current.has(key) === dirty && current instanceof Set) return current
  const next = new Set(current)
  if (dirty) next.add(key)
  else next.delete(key)
  return next
}

export function reconcileRegistrationEditorDraft<T>(input: {
  currentDraft: T
  previousCanonicalKey: string
  nextCanonicalKey: string
  nextCanonicalDraft: T
}): { draft: T; canonicalKey: string } {
  return {
    draft: input.previousCanonicalKey === input.nextCanonicalKey
      ? input.currentDraft
      : input.nextCanonicalDraft,
    canonicalKey: input.nextCanonicalKey,
  }
}

export function getRegistrationCommonConflictRows<T extends Record<string, string>>(input: {
  attempted: T
  latest: T
  labels: Partial<Record<keyof T, string>>
}): Array<{ field: keyof T & string; label: string; attempted: string; latest: string }> {
  return (Object.keys(input.labels) as Array<keyof T & string>)
    .filter((field) => input.attempted[field] !== input.latest[field])
    .map((field) => ({
      field,
      label: input.labels[field] || field,
      attempted: input.attempted[field],
      latest: input.latest[field],
    }))
}

export function getRegistrationEnrollmentDirtyKey(
  trackId: string,
  scope: RegistrationEnrollmentDirtyScope,
): RegistrationApplicationDirtyKey {
  if (scope.kind === "rows") return `placement:enrollments-${trackId}`
  if (scope.kind === "decision") return `placement:decision-${trackId}`
  return `placement:cancellation-${trackId}-${scope.enrollmentId}`
}
