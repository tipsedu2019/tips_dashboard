export const REGISTRATION_WORKFLOW_STATUSES = Object.freeze([
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
])

export const REGISTRATION_WORKFLOW_VIEWS = Object.freeze([
  ["inquiry", "문의"],
  ["level_test", "레벨테스트 신청"],
  ["consultation_requested", "상담 신청"],
  ["consultation_completed", "상담 완료"],
  ["waiting", "대기 신청"],
  ["enrollment", "등록 신청"],
  ["payment", "입학 진행"],
  ["completed", "완료"],
])

export const REGISTRATION_WORKFLOW_STATUS_LABELS = Object.freeze({
  inquiry: "등록 문의",
  level_test_requested: "레벨테스트 신청",
  consultation_requested: "상담 신청",
  consultation_completed: "상담 완료",
  waiting_current_class: "현재반 대기 신청",
  waiting_new_class: "신규반 대기 신청",
  waiting_next_opening: "다음 개강 알림 요청",
  enrollment_requested: "등록 신청",
  payment_in_progress: "입학 진행 중",
  registered: "등록 완료",
  not_registered: "미등록",
  inquiry_only: "문의만",
})

const VIEW_BY_STATUS = Object.freeze({
  inquiry: "inquiry",
  level_test_requested: "level_test",
  consultation_requested: "consultation_requested",
  consultation_completed: "consultation_completed",
  waiting_current_class: "waiting",
  waiting_new_class: "waiting",
  waiting_next_opening: "waiting",
  enrollment_requested: "enrollment",
  payment_in_progress: "payment",
  registered: "completed",
  not_registered: "completed",
  inquiry_only: "completed",
})

const LEGACY_PIPELINE_TO_WORKFLOW = Object.freeze({
  inquiry: "inquiry",
  migration_review: "inquiry",
  level_test_scheduled: "level_test_requested",
  level_test_in_progress: "level_test_requested",
  consultation_waiting: "consultation_requested",
  visit_consultation_scheduled: "consultation_requested",
  enrollment_decided: "enrollment_requested",
  enrollment_processing: "payment_in_progress",
  registered: "registered",
  not_registered: "not_registered",
  inquiry_closed: "inquiry_only",
})

const OPERATIONS_WORKFLOW_STATUSES = Object.freeze([
  "inquiry",
  "level_test_requested",
  "consultation_requested",
  "payment_in_progress",
  "registered",
  "inquiry_only",
])

const DIRECTOR_WORKFLOW_STATUSES = Object.freeze([
  "consultation_completed",
  "waiting_current_class",
  "waiting_new_class",
  "waiting_next_opening",
  "enrollment_requested",
  "not_registered",
])

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim()
}

function workflowStatusOption(value) {
  return { value, label: REGISTRATION_WORKFLOW_STATUS_LABELS[value] }
}

export function getRegistrationWorkflowViewKey(status) {
  return VIEW_BY_STATUS[text(status)] || "inquiry"
}

export function getRegistrationWorkflowStatusFromLegacyTrack(track = {}) {
  const status = text(track.status || track.pipelineStatus)
  if (status === "waiting") {
    const waitingKind = text(track.waitingKind || track.waiting_kind)
    if (waitingKind === "current_class") return "waiting_current_class"
    if (waitingKind === "next_term_opening") return "waiting_next_opening"
    return "waiting_new_class"
  }
  return LEGACY_PIPELINE_TO_WORKFLOW[status] || "inquiry"
}

export function getRegistrationWorkflowStatusOptions(input = {}) {
  if (text(input.viewerRole) === "admin") {
    return REGISTRATION_WORKFLOW_STATUSES.map(workflowStatusOption)
  }

  if (text(input.viewerRole) === "staff") {
    return OPERATIONS_WORKFLOW_STATUSES.map(workflowStatusOption)
  }

  if (
    text(input.viewerId)
    && text(input.viewerId) === text(input.directorProfileId)
  ) {
    return DIRECTOR_WORKFLOW_STATUSES.map(workflowStatusOption)
  }

  return []
}

export function getRegistrationInlineWorkflowStatusOptions(input = {}) {
  const currentStatus = text(input.currentStatus)
  const allowed = getRegistrationWorkflowStatusOptions(input)
  const current = REGISTRATION_WORKFLOW_STATUSES.includes(currentStatus)
    ? [workflowStatusOption(currentStatus)]
    : []
  return [
    ...current,
    ...allowed.filter((option) => option.value !== currentStatus),
  ]
}
