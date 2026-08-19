const STATUS_TO_VIEW = Object.freeze({
  inquiry: "inquiry",
  migration_review: "inquiry",
  level_test_scheduled: "level_test",
  level_test_in_progress: "level_test",
  consultation_waiting: "consulting",
  visit_consultation_scheduled: "consulting",
  waiting: "waiting",
  enrollment_decided: "enrollment",
  enrollment_processing: "enrollment",
  registered: "closed",
  not_registered: "closed",
  inquiry_closed: "closed",
})

const TERMINAL_STATUSES = new Set(["registered", "not_registered", "inquiry_closed"])
const TERMINAL_BATCH_STATUSES = new Set(["completed", "canceled"])
const TERMINAL_ATTEMPT_STATUSES = new Set(["completed", "absent", "canceled"])
const ALLOWED_ACTIONS_BY_STATUS = Object.freeze({
  inquiry: new Set(["schedule_level_test", "route_consultation", "route_waiting", "close_inquiry"]),
  migration_review: new Set(["resolve_migration_review"]),
  level_test_scheduled: new Set(["start_level_test", "record_level_test_result", "cancel_level_test", "close_inquiry"]),
  level_test_in_progress: new Set(["record_level_test_result"]),
  consultation_waiting: new Set(["complete_phone_consultation", "schedule_visit"]),
  visit_consultation_scheduled: new Set(["complete_visit_consultation", "cancel_visit"]),
  waiting: new Set(["change_waiting_kind", "record_retest_required", "schedule_level_test", "move_to_enrollment", "close_not_registered"]),
  enrollment_decided: new Set(["start_enrollment_processing", "route_waiting", "close_not_registered"]),
  enrollment_processing: new Set(["complete_enrollment", "cancel_admission_batch"]),
  registered: new Set(["start_add_class", "cancel_enrollment"]),
  not_registered: new Set(["reopen_track"]),
  inquiry_closed: new Set(["reopen_track"]),
})

export function getAllowedRegistrationTrackActions(status) {
  return Array.from(ALLOWED_ACTIONS_BY_STATUS[status] || [])
}

function isAllowedRegistrationTrackAction(status, action) {
  return getAllowedRegistrationTrackActions(status).includes(action)
}

export function getRegistrationTrackViewKey(status) {
  return STATUS_TO_VIEW[String(status || "").trim()] || "inquiry"
}

export function isRegistrationTrackTerminal(status) {
  return TERMINAL_STATUSES.has(String(status || "").trim())
}

export function getRegistrationTrackTransitionBlockers(input = {}) {
  if (!isAllowedRegistrationTrackAction(input.status, input.action)) return ["현재 단계에서 할 수 없는 작업"]
  if (input.status === "migration_review" && input.action !== "resolve_migration_review") return ["과목 분리 확인"]
  if (["complete_phone_consultation", "complete_visit_consultation"].includes(input.action) && !input.outcome) return ["상담 결과"]
  if (input.status === "waiting" && input.action === "move_to_enrollment" && input.retakeDecision !== "not_required") {
    return ["레벨테스트 재응시 여부"]
  }
  if (input.status === "waiting" && ["record_retest_required", "schedule_level_test"].includes(input.action) && input.retakeDecision !== "required") {
    return ["레벨테스트 재응시 여부"]
  }
  if (input.status === "level_test_scheduled" && input.action === "close_inquiry"
    && (input.hasActiveAttempt || !["absent", "canceled"].includes(input.lastAttemptStatus))) {
    return ["종료 가능한 미응시·취소 이력"]
  }
  if (input.status === "level_test_scheduled" && input.action === "record_level_test_result"
    && input.resultStatus === "completed") {
    return ["시험 시작"]
  }
  if (input.action === "start_enrollment_processing") {
    return [
      Number(input.enrollmentCount || 0) > 0 ? "" : "수업",
      input.everyScheduleValid ? "" : "수업 시작 일정",
      input.admissionNoticeSent ? "" : "입학신청서 발송",
      input.hasOtherOpenBatch ? "진행 중인 입학 처리" : "",
    ].filter(Boolean)
  }
  return []
}

export function getRegistrationTrackNextStatus(input = {}) {
  if (!isAllowedRegistrationTrackAction(input.status, input.action)) return input.status || "inquiry"
  const outcomeStatus = { enrollment: "enrollment_decided", waiting: "waiting", not_registered: "not_registered" }
  if (input.action === "complete_phone_consultation" || input.action === "complete_visit_consultation") {
    return outcomeStatus[input.outcome] || input.status || "inquiry"
  }
  if (input.action === "schedule_level_test" && (input.status !== "waiting" || input.retakeDecision === "required")) return "level_test_scheduled"
  if (input.action === "record_retest_required" || input.action === "change_waiting_kind") return "waiting"
  if (input.action === "route_consultation") return "consultation_waiting"
  if (input.action === "route_waiting") return "waiting"
  if (input.action === "close_inquiry") return "inquiry_closed"
  if (input.action === "close_not_registered") return "not_registered"
  if (input.action === "cancel_level_test") return "inquiry"
  if (input.action === "move_to_enrollment" && input.retakeDecision === "not_required") return "enrollment_decided"
  if (input.action === "start_level_test") return "level_test_in_progress"
  if (input.action === "record_level_test_result") return input.resultStatus === "completed" ? "consultation_waiting" : "level_test_scheduled"
  if (input.action === "schedule_visit") return "visit_consultation_scheduled"
  if (input.action === "cancel_visit") return "consultation_waiting"
  if (input.action === "start_enrollment_processing") return "enrollment_processing"
  if (input.action === "complete_enrollment") return "registered"
  if (input.action === "start_add_class") return "enrollment_processing"
  if (input.action === "cancel_enrollment") {
    if (input.hasRemainingEnrolledRows) return "registered"
    if (input.destination === "waiting") return "waiting"
    if (input.destination === "not_registered") return "not_registered"
    return "enrollment_decided"
  }
  if (input.action === "reopen_track") return input.destination === "consultation_waiting" ? "consultation_waiting" : "inquiry"
  if (input.action === "cancel_admission_batch") {
    if (input.hasSurvivingEnrolledRows) return "registered"
    return input.destination === "waiting" ? "waiting" : "not_registered"
  }
  if (input.action === "resolve_migration_review") return input.destination || "inquiry"
  return input.status || "inquiry"
}

export function getRegistrationLevelTestAppointmentStatus(attempts = []) {
  if (attempts.length === 0) return "scheduled"
  for (const attempt of attempts) {
    if (!TERMINAL_ATTEMPT_STATUSES.has(attempt?.status)) return "scheduled"
    if (attempt.status === "completed" && !String(attempt.materialLink || "").trim()) return "scheduled"
  }
  if (attempts.every((attempt) => attempt?.status === "canceled")) return "canceled"
  return "completed"
}

export function canEditRegistrationAppointment() {
  return true
}

export function canCancelRegistrationSharedAppointment(
  kind,
  appointment,
  tracks = [],
  activities = [],
) {
  const appointmentId = String(appointment?.id || "")
  if (!appointmentId || appointment?.status !== "scheduled") return false

  const requiredTrackStatus = kind === "level_test"
    ? "level_test_scheduled"
    : "visit_consultation_scheduled"
  const trackStatusById = new Map(tracks.map((track) => [String(track?.id || ""), track?.status]))

  return activities.some((activity) => (
    activity?.appointmentId === appointmentId
    && activity?.status === "scheduled"
    && trackStatusById.get(String(activity?.trackId || "")) === requiredTrackStatus
  ))
}

export function getEligibleSharedAppointmentTracks(
  kind,
  tracks = [],
  activities = [],
  currentAppointmentId = null,
) {
  const currentId = String(currentAppointmentId || "")
  const activeStatuses = kind === "level_test"
    ? new Set(["scheduled", "in_progress"])
    : new Set(["scheduled"])

  return tracks.filter((track) => {
    const trackActivities = activities.filter((activity) => activity?.trackId === track?.id)
    const isScheduledOnCurrent = Boolean(currentId) && trackActivities.some((activity) => (
      activity?.appointmentId === currentId && activity?.status === "scheduled"
    ))
    if (isScheduledOnCurrent) return true

    const hasActiveElsewhere = trackActivities.some((activity) => (
      activeStatuses.has(activity?.status)
      && activity?.appointmentId !== currentId
    ))
    if (hasActiveElsewhere) return false

    return Boolean(track?.id)
  })
}

export function getRegistrationAppointmentEditMode() {
  return "edit"
}

export function getRegistrationAppointmentPayloadTrackIds(
  editMode,
  selectedTrackIds = [],
  activities = [],
  currentAppointmentId = null,
) {
  if (editMode !== "replace_remaining") return Array.from(new Set(selectedTrackIds.filter(Boolean)))
  const currentId = String(currentAppointmentId || "")
  return Array.from(new Set(activities
    .filter((activity) => (
      activity?.appointmentId === currentId
      && activity?.status === "scheduled"
    ))
    .map((activity) => activity?.trackId)
    .filter(Boolean)))
}

export function getRegistrationAppointmentReportedTrackIds(
  kind,
  editMode,
  draftTrackIds = [],
  activities = [],
  currentAppointmentId = null,
) {
  if (editMode === "read_only") return null
  const reportedTrackIds = new Set(draftTrackIds.filter(Boolean))
  if (editMode === "replace_remaining" && kind === "level_test") {
    const currentId = String(currentAppointmentId || "")
    for (const activity of activities) {
      if (activity?.appointmentId !== currentId) continue
      if (["scheduled", "canceled"].includes(activity?.status)) continue
      if (activity?.trackId) reportedTrackIds.add(activity.trackId)
    }
  }
  return Array.from(reportedTrackIds).sort()
}

export function getLatestRegistrationLevelTestActivityIds(activities = []) {
  const latestByTrack = new Map()
  for (const activity of activities) {
    const trackId = String(activity?.trackId || "")
    if (!trackId) continue
    const current = latestByTrack.get(trackId)
    if (!current || Number(activity?.attemptNumber || 0) > Number(current?.attemptNumber || 0)) {
      latestByTrack.set(trackId, activity)
    }
  }
  return Array.from(latestByTrack.values(), (activity) => activity?.id).filter(Boolean)
}

export function getRegistrationAdmissionApplicationState(input = {}) {
  const tracks = Array.isArray(input.tracks) ? input.tracks : []
  const enrollments = Array.isArray(input.enrollments) ? input.enrollments : []
  const plannedTrackIds = new Set(enrollments
    .filter((enrollment) => (
      enrollment?.status === "planned"
      && !enrollment?.admissionBatchId
    ))
    .map((enrollment) => String(enrollment?.trackId || ""))
    .filter(Boolean))
  const targetTrackIds = []
  const targetTrackIdSet = new Set()
  for (const track of tracks) {
    const trackId = String(track?.id || "")
    if (!trackId || targetTrackIdSet.has(trackId)) continue
    if (
      track?.status !== "enrollment_decided"
      && track?.workflowStatus !== "enrollment_requested"
      && !plannedTrackIds.has(trackId)
    ) continue
    targetTrackIdSet.add(trackId)
    targetTrackIds.push(trackId)
  }
  const eligible = targetTrackIds.length > 0
  const status = String(input.admissionApplicationMessageStatus || "")
  const claimActive = Boolean(input.admissionApplicationMessageClaimActive)
  const accepted = status === "accepted"
  const delivered = accepted || Boolean(input.admissionNoticeSent)
  const syncNeeded = accepted && !Boolean(input.admissionNoticeSent)
  const blocked = claimActive && ["pending", "unknown", "failed_hold"].includes(status)

  return {
    targetTrackIds,
    eligible,
    delivered,
    syncNeeded,
    blocked,
    canSend: eligible && !delivered && !claimActive,
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function enrollmentText(value) {
  return String(value ?? "").trim()
}

function createEnrollmentClientKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `enrollment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function getRegistrationCurrentClassWaitClassId({
  trackId = "",
  waitingKind = "",
  enrollments = [],
} = {}) {
  if (enrollmentText(waitingKind) !== "current_class") return ""
  const normalizedTrackId = enrollmentText(trackId)
  return enrollmentText(enrollments.find((item) => (
    enrollmentText(item?.trackId) === normalizedTrackId
    && enrollmentText(item?.status) === "waitlisted"
    && item?.rosterActive === true
  ))?.classId)
}

export function getRegistrationWaitingDetailsDraft(track = {}) {
  const waitingKind = enrollmentText(track.waitingDetailKind)
  const classId = waitingKind === "current_class"
    ? enrollmentText(track.waitingDetailClassId)
    : ""
  const retakeDecision = enrollmentText(track.waitingDetailRetakeDecision)
  return {
    waitingKind,
    classId,
    retakeDecision,
    persisted: Boolean(waitingKind || classId || retakeDecision),
  }
}

export function createRegistrationEnrollmentDraft({
  id = null,
  clientKey,
  sortOrder = 0,
  ...initial
} = {}) {
  return {
    id: id || null,
    clientKey: enrollmentText(clientKey) || enrollmentText(id) || createEnrollmentClientKey(),
    classId: "",
    textbookId: "",
    textbookExplicitlyCleared: false,
    classStartDate: "",
    classStartSessionKey: "",
    classStartLessonSessionId: "",
    classStartSession: "",
    classStartSourceObservationId: "",
    status: "planned",
    makeeduRegistered: false,
    rosterActive: false,
    sortOrder,
    ...initial,
  }
}

export function restoreRegistrationEnrollmentDraft(enrollment = {}) {
  const id = enrollmentText(enrollment?.id)
  return createRegistrationEnrollmentDraft({
    ...enrollment,
    id: id || null,
    clientKey: enrollmentText(enrollment?.clientKey) || id || undefined,
    textbookId: enrollmentText(enrollment?.textbookId),
    textbookExplicitlyCleared: Boolean(id) && enrollment?.textbookId == null,
    classStartDate: enrollmentText(enrollment?.classStartDate),
    classStartSessionKey: enrollmentText(enrollment?.classStartSessionKey),
    classStartLessonSessionId: enrollmentText(enrollment?.classStartLessonSessionId),
    classStartSession: enrollmentText(enrollment?.classStartSession),
    classStartSourceObservationId: enrollmentText(enrollment?.classStartSourceObservationId),
  })
}

function isEligibleRegistrationEnrollmentStartObservation(observation, finalClassId) {
  if (!observation) return false
  if (enrollmentText(observation.classId) !== enrollmentText(finalClassId)) return false
  if (
    observation.status !== "completed"
    || observation.attendance !== "attended"
    || observation.suitabilityResult !== "fit"
    || observation.decisionKind !== "enrollment"
  ) return false
  if (
    !enrollmentText(observation.observationId)
    || !enrollmentText(observation.trackId)
    || !enrollmentText(observation.sessionDate)
    || !enrollmentText(observation.startsAt)
    || !enrollmentText(observation.endsAt)
    || !enrollmentText(observation.sessionKey)
  ) return false
  if (observation.sessionAuthority === "normalized") {
    return Boolean(
      enrollmentText(observation.classLessonSessionId)
      && observation.legacySessionKey === null
      && observation.sourceRevision?.authority === "normalized"
      && enrollmentText(observation.sourceRevision.sessionId) === enrollmentText(observation.classLessonSessionId)
      && Number.isFinite(Number(observation.sourceRevision.revision)),
    )
  }
  return observation.sessionAuthority === "legacy"
    && observation.classLessonSessionId === null
    && Boolean(enrollmentText(observation.legacySessionKey))
    && observation.sourceRevision?.authority === "legacy"
    && enrollmentText(observation.sourceRevision.sessionKey) === enrollmentText(observation.legacySessionKey)
    && Boolean(enrollmentText(observation.sourceRevision.contentHash))
}

export function getRegistrationEnrollmentStartOptions({
  regularSessions = [],
  matchingObservation = null,
  finalClassId = "",
} = {}) {
  const classId = enrollmentText(finalClassId)
  const trackId = enrollmentText(matchingObservation?.trackId)
  const regularOptions = (Array.isArray(regularSessions) ? regularSessions : []).map((session) => ({
    source: "regular",
    sourceObservationId: "",
    trackId,
    classId,
    classStartSessionKey: enrollmentText(session?.value),
    classStartLessonSessionId: enrollmentText(session?.lessonSessionId) || null,
    sessionDate: enrollmentText(session?.dateKey),
    label: enrollmentText(session?.sessionLabel),
  }))
  if (!isEligibleRegistrationEnrollmentStartObservation(matchingObservation, classId)) {
    return regularOptions
  }

  const common = {
    source: "observation",
    sourceObservationId: enrollmentText(matchingObservation.observationId),
    trackId: enrollmentText(matchingObservation.trackId),
    classId,
    sessionDate: enrollmentText(matchingObservation.sessionDate),
    startsAt: enrollmentText(matchingObservation.startsAt),
    endsAt: enrollmentText(matchingObservation.endsAt),
    label: "청강 회차",
  }
  const observationOption = matchingObservation.sessionAuthority === "normalized"
    ? {
        ...common,
        sessionAuthority: "normalized",
        classStartSessionKey: enrollmentText(matchingObservation.sessionKey),
        classStartLessonSessionId: enrollmentText(matchingObservation.classLessonSessionId),
        legacySessionKey: null,
        sourceRevision: matchingObservation.sourceRevision,
      }
    : {
        ...common,
        sessionAuthority: "legacy",
        classStartSessionKey: enrollmentText(matchingObservation.legacySessionKey),
        classStartLessonSessionId: null,
        legacySessionKey: enrollmentText(matchingObservation.legacySessionKey),
        sourceRevision: matchingObservation.sourceRevision,
      }
  return [observationOption, ...regularOptions]
}

export function applyRegistrationEnrollmentStartSelection(row, option) {
  if (!row || !option || enrollmentText(row.classId) !== enrollmentText(option.classId)) return row
  return {
    ...row,
    classStartDate: enrollmentText(option.sessionDate),
    classStartSessionKey: enrollmentText(option.classStartSessionKey),
    classStartLessonSessionId: enrollmentText(option.classStartLessonSessionId),
    classStartSession: enrollmentText(option.label),
    classStartSourceObservationId: option.source === "observation"
      ? enrollmentText(option.sourceObservationId)
      : "",
  }
}

export function applyRegistrationEnrollmentStartDefault(rows = [], option = null, input = {}) {
  if (option?.source !== "observation") return rows
  const eligibleClientKeys = new Set(
    (Array.isArray(input.eligibleClientKeys) ? input.eligibleClientKeys : [])
      .map(enrollmentText)
      .filter(Boolean),
  )
  const preferredClientKey = enrollmentText(input.preferredClientKey)
  const matchIndex = rows.findIndex((row) => (
    eligibleClientKeys.has(enrollmentText(row?.clientKey))
    && (!preferredClientKey || enrollmentText(row?.clientKey) === preferredClientKey)
    && (row?.status || "planned") === "planned"
    && enrollmentText(row?.classId) === enrollmentText(option.classId)
    && [
      row?.classStartDate,
      row?.classStartSessionKey,
      row?.classStartLessonSessionId,
      row?.classStartSession,
      row?.classStartSourceObservationId,
    ].every((value) => !enrollmentText(value))
  ))
  if (matchIndex < 0) return rows
  return rows.map((row, index) => (
    index === matchIndex ? applyRegistrationEnrollmentStartSelection(row, option) : row
  ))
}

export function createRegistrationEnrollmentStartLoadOwner() {
  let generation = 0
  let currentTrackId = ""
  return {
    begin(trackId) {
      currentTrackId = enrollmentText(trackId)
      generation += 1
      return Object.freeze({ trackId: currentTrackId, generation })
    },
    owns(token, trackId) {
      return Boolean(token)
        && token.generation === generation
        && token.trackId === currentTrackId
        && currentTrackId === enrollmentText(trackId)
    },
    release(token) {
      if (token?.generation === generation && token?.trackId === currentTrackId) {
        generation += 1
        currentTrackId = ""
      }
    },
  }
}

export function getRegistrationEnrollmentStartSaveErrorMessage(error, fallback = "수업 정보를 저장하지 못했습니다.") {
  const code = enrollmentText(error?.code)
  const message = error instanceof Error
    ? error.message
    : enrollmentText(error?.message)
  const source = `${code} ${message}`
  if (
    source.includes("registration_observation_class_start_source_invalid")
  ) return "청강 회차 정보가 변경되었습니다. 현재 수업 일정을 다시 선택해 주세요."
  if (source.includes("registration_invalid_source_state")) {
    return "등록 상태가 변경되었습니다. 최신 내용을 다시 불러와 주세요."
  }
  return message || enrollmentText(fallback) || "수업 정보를 저장하지 못했습니다."
}

export function applyRegistrationEnrollmentClassSelection(row, input = {}) {
  const linkedTextbookIds = Array.isArray(input.classItem?.textbookIds)
    ? input.classItem.textbookIds.map(enrollmentText).filter(Boolean)
    : []
  const availableTextbookIds = new Set(
    (Array.isArray(input.availableTextbookIds) ? input.availableTextbookIds : [])
      .map(enrollmentText)
      .filter(Boolean),
  )
  return {
    ...row,
    classId: enrollmentText(input.classItem?.id),
    textbookId: linkedTextbookIds.find((id) => availableTextbookIds.has(id)) || "",
    textbookExplicitlyCleared: false,
    classStartDate: "",
    classStartSessionKey: "",
    classStartLessonSessionId: "",
    classStartSession: "",
    classStartSourceObservationId: "",
  }
}

export function serializeRegistrationEnrollmentRows(rows = []) {
  return rows.map((row, index) => {
    const serialized = {
      classId: enrollmentText(row?.classId),
      textbookId: enrollmentText(row?.textbookId) || null,
      classStartDate: enrollmentText(row?.classStartDate) || null,
      classStartSessionKey: enrollmentText(row?.classStartSessionKey) || null,
      classStartLessonSessionId: enrollmentText(row?.classStartLessonSessionId) || null,
      classStartSession: enrollmentText(row?.classStartSession) || null,
      classStartSourceObservationId: enrollmentText(row?.classStartSourceObservationId) || null,
      sortOrder: Number.isFinite(Number(row?.sortOrder)) ? Number(row.sortOrder) : index,
    }
    const id = enrollmentText(row?.id)
    return UUID_PATTERN.test(id) ? { id, ...serialized } : serialized
  })
}

export function mergeSavedRegistrationEnrollmentRows(localRows = [], savedRows = []) {
  const remainingLocalRows = [...localRows]
  return [...savedRows]
    .sort((left, right) => Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0))
    .map((savedRow, savedIndex) => {
      const savedId = enrollmentText(savedRow?.id)
      let localIndex = savedId
        ? remainingLocalRows.findIndex((row) => enrollmentText(row?.id) === savedId)
        : -1
      if (localIndex < 0) {
        localIndex = remainingLocalRows.findIndex((row) => (
          Number(row?.sortOrder || 0) === Number(savedRow?.sortOrder || 0)
          && enrollmentText(row?.classId) === enrollmentText(savedRow?.classId)
        ))
      }
      if (localIndex < 0) {
        localIndex = remainingLocalRows.findIndex((row) => (
          enrollmentText(row?.classId) === enrollmentText(savedRow?.classId)
        ))
      }
      const localRow = localIndex >= 0 ? remainingLocalRows.splice(localIndex, 1)[0] : null
      return createRegistrationEnrollmentDraft({
        ...savedRow,
        id: savedId || null,
        clientKey: localRow?.clientKey || savedId || undefined,
        textbookId: enrollmentText(savedRow?.textbookId),
        classStartDate: enrollmentText(savedRow?.classStartDate),
        classStartSessionKey: enrollmentText(savedRow?.classStartSessionKey),
        classStartLessonSessionId: enrollmentText(savedRow?.classStartLessonSessionId),
        classStartSession: enrollmentText(savedRow?.classStartSession),
        classStartSourceObservationId: enrollmentText(savedRow?.classStartSourceObservationId),
        textbookExplicitlyCleared: localRow?.textbookExplicitlyCleared || false,
        sortOrder: Number.isFinite(Number(savedRow?.sortOrder)) ? Number(savedRow.sortOrder) : savedIndex,
      })
    })
}

export function getRegistrationEnrollmentBlockers(input = {}) {
  const subject = enrollmentText(input.subject)
  const classById = new Map((Array.isArray(input.classes) ? input.classes : [])
    .map((classItem) => [enrollmentText(classItem?.id), classItem])
    .filter(([id]) => Boolean(id)))
  const validateTextbooks = Array.isArray(input.availableTextbookIds)
  const availableTextbookIds = new Set((validateTextbooks ? input.availableTextbookIds : [])
    .map(enrollmentText)
    .filter(Boolean))
  const scheduleKeysByClassId = input.validScheduleSessionKeysByClassId || {}
  const textbookIdsByClassId = input.validTextbookIdsByClassId || {}
  const activeClassIds = new Set()
  const blockers = []

  for (const row of Array.isArray(input.rows) ? input.rows : []) {
    const rowId = enrollmentText(row?.clientKey) || enrollmentText(row?.id)
    const classId = enrollmentText(row?.classId)
    const classItem = classById.get(classId)
    const rowIsCurrent = (row?.status || "planned") === "planned" || row?.rosterActive === true

    if (!classId) {
      blockers.push({ rowId, field: "classId", message: "수업을 선택해 주세요." })
      continue
    }
    if (!classItem) {
      blockers.push({ rowId, field: "classId", message: "선택할 수 없는 수업" })
      continue
    }
    if (enrollmentText(classItem.subject) !== subject) {
      blockers.push({ rowId, field: "classId", message: "과목이 일치하지 않는 수업" })
      continue
    }
    if (rowIsCurrent && activeClassIds.has(classId)) {
      blockers.push({ rowId, field: "classId", message: "중복 수업" })
    } else if (rowIsCurrent) {
      activeClassIds.add(classId)
    }

    const textbookId = enrollmentText(row?.textbookId)
    if (validateTextbooks && textbookId && !availableTextbookIds.has(textbookId)) {
      blockers.push({ rowId, field: "textbookId", message: "선택할 수 없는 교재" })
    } else if (textbookId) {
      const validTextbookIds = textbookIdsByClassId instanceof Map
        ? textbookIdsByClassId.get(classId)
        : textbookIdsByClassId[classId]
      if (Array.isArray(validTextbookIds) && !validTextbookIds.map(enrollmentText).includes(textbookId)) {
        blockers.push({ rowId, field: "textbookId", message: "선택한 수업에 연결되지 않은 교재" })
      }
    }

    const scheduleValues = [
      enrollmentText(row?.classStartDate),
      enrollmentText(row?.classStartSessionKey),
      enrollmentText(row?.classStartSession),
    ]
    const hasAnySchedule = scheduleValues.some(Boolean)
    if (input.requireSchedule || hasAnySchedule) {
      const sessionKey = enrollmentText(row?.classStartSessionKey)
      const hasSchedule = scheduleValues.every(Boolean)
      if (!hasSchedule) {
        blockers.push({
          rowId,
          field: "classStartSessionKey",
          message: input.requireSchedule ? "수업 시작 일정을 선택해 주세요." : "수업 시작 일정 입력을 완성해 주세요.",
        })
      } else {
        const validKeys = scheduleKeysByClassId instanceof Map
          ? scheduleKeysByClassId.get(classId)
          : scheduleKeysByClassId[classId]
        if (Array.isArray(validKeys) && !validKeys.map(enrollmentText).includes(sessionKey)) {
          blockers.push({ rowId, field: "classStartSessionKey", message: "선택할 수 없는 수업 일정" })
        }
      }
    }
  }
  return blockers
}

export function getRegistrationAdmissionBatchChecklist(input = {}) {
  const batch = input.batch || {}
  const activeEnrollments = (Array.isArray(input.enrollments) ? input.enrollments : [])
    .filter((enrollment) => enrollment?.status !== "canceled")
  const status = enrollmentText(batch.status)
  return {
    admissionNotice: Boolean(input.admissionNoticeSent),
    makeedu: status === "completed" || (activeEnrollments.length > 0
      && activeEnrollments.every((enrollment) => enrollment?.makeeduRegistered === true)),
    invoice: Boolean(batch.invoiceSentAt) || ["invoiced", "paid", "completed"].includes(status),
    payment: Boolean(batch.paymentConfirmedAt) || ["paid", "completed"].includes(status),
    complete: status === "completed",
  }
}

export function getRegistrationAdmissionProgressDisplay(input = {}) {
  const batches = Array.isArray(input.batches) ? input.batches : []
  const enrollments = Array.isArray(input.enrollments) ? input.enrollments : []
  const openBatch = batches.find((batch) => !TERMINAL_BATCH_STATUSES.has(enrollmentText(batch?.status))) || null
  const hasPendingRevision = enrollments.some((enrollment) => (
    enrollmentText(enrollment?.status) === "planned"
    && !enrollmentText(enrollment?.admissionBatchId)
    && Boolean(enrollmentText(enrollment?.id))
  ))
  const displayBatch = openBatch || (!hasPendingRevision
    ? [...batches]
      .filter((batch) => enrollmentText(batch?.status) === "completed")
      .sort((left, right) => Number(right?.revisionNumber || 0) - Number(left?.revisionNumber || 0))[0] || null
    : null)
  const displayBatchId = enrollmentText(displayBatch?.id)
  const displayEnrollments = displayBatchId
    ? enrollments.filter((enrollment) => (
      enrollmentText(enrollment?.admissionBatchId) === displayBatchId
      && enrollmentText(enrollment?.status) !== "canceled"
    ))
    : []

  return { openBatch, displayBatch, displayEnrollments }
}

export function getRegistrationEnrollmentCancellationState(input = {}) {
  const enrollment = input.enrollment || {}
  if (enrollment?.status !== "enrolled" || enrollment?.rosterActive !== true) {
    return {
      requiresDestination: false,
      hasSurvivingEnrolledRows: false,
      destination: "",
    }
  }
  const enrollmentId = enrollmentText(enrollment.id)
  const trackId = enrollmentText(enrollment.trackId)
  const hasSurvivingEnrolledRows = (Array.isArray(input.enrollments) ? input.enrollments : []).some((candidate) => (
    enrollmentText(candidate?.id) !== enrollmentId
    && enrollmentText(candidate?.trackId) === trackId
    && candidate?.status === "enrolled"
    && candidate?.rosterActive === true
  ))
  return {
    requiresDestination: !hasSurvivingEnrolledRows,
    hasSurvivingEnrolledRows,
    destination: hasSurvivingEnrolledRows ? "" : null,
  }
}

export function getRegistrationAdmissionBatchCancellationGroups(input = {}) {
  const batchId = enrollmentText(input.batchId)
  const currentTrackIds = Array.from(new Set(
    (Array.isArray(input.currentBatchEnrollments) ? input.currentBatchEnrollments : [])
      .map((enrollment) => enrollmentText(enrollment?.trackId))
      .filter(Boolean),
  ))
  const addClassTrackIds = currentTrackIds.filter((trackId) => (
    (Array.isArray(input.enrollments) ? input.enrollments : []).some((enrollment) => (
      enrollmentText(enrollment?.trackId) === trackId
      && enrollment?.status === "enrolled"
      && enrollmentText(enrollment?.admissionBatchId) !== batchId
    ))
  ))
  const addClassTrackIdSet = new Set(addClassTrackIds)
  return {
    addClassTrackIds,
    firstAdmissionTrackIds: currentTrackIds.filter((trackId) => !addClassTrackIdSet.has(trackId)),
  }
}

export function getRegistrationSelectedAdmissionEnrollmentIds(input = {}) {
  const selectedIds = new Set(Array.from(input.selectedEnrollmentIds || [], enrollmentText).filter(Boolean))
  return (Array.isArray(input.enrollments) ? input.enrollments : [])
    .filter((enrollment) => (
      selectedIds.has(enrollmentText(enrollment?.id))
      && enrollment?.status === "planned"
      && !enrollment?.admissionBatchId
    ))
    .map((enrollment) => enrollmentText(enrollment?.id))
    .filter(Boolean)
}

export function getRegistrationAdmissionRecoveryDelayMs(updatedAt, now = Date.now()) {
  const updatedTime = Date.parse(enrollmentText(updatedAt))
  const currentTime = Number(now)
  if (!Number.isFinite(updatedTime) || !Number.isFinite(currentTime)) return null
  return Math.max(0, updatedTime + 15 * 60 * 1000 - currentTime)
}

export const REGISTRATION_CONSULTATION_OUTCOMES = Object.freeze([
  "undecided",
  "waiting",
  "observation",
  "enrollment",
  "not_registered",
])
const REGISTRATION_CONSULTATION_OUTCOME_SET = new Set(REGISTRATION_CONSULTATION_OUTCOMES)

export function getRegistrationActiveConsultation(input = {}) {
  const trackId = enrollmentText(input.trackId)
  if (!trackId) return null
  return (Array.isArray(input.consultations) ? input.consultations : [])
    .filter((consultation) => (
      enrollmentText(consultation?.trackId) === trackId
      && ((consultation?.mode === "phone" && consultation?.status === "waiting")
        || (consultation?.mode === "visit" && consultation?.status === "scheduled"))
    ))
    .sort((left, right) => (
      enrollmentText(right?.updatedAt || right?.createdAt)
        .localeCompare(enrollmentText(left?.updatedAt || left?.createdAt))
    ))[0] || null
}

export function getRegistrationConsultationOutcomeSaveState(input = {}) {
  const savedOutcome = REGISTRATION_CONSULTATION_OUTCOME_SET.has(String(input.savedOutcome || ""))
    ? String(input.savedOutcome)
    : ""
  const draftOutcome = REGISTRATION_CONSULTATION_OUTCOME_SET.has(String(input.draftOutcome || ""))
    ? String(input.draftOutcome)
    : ""
  const savedNote = enrollmentText(input.savedNote)
  const draftNote = enrollmentText(input.draftNote)
  const editable = Boolean(input.canEdit ?? input.canCompleteConsultation)
  const waitingKind = enrollmentText(input.waitingKind)
  const classId = enrollmentText(input.classId)
  const blockers = []
  const dirty = draftOutcome !== savedOutcome || draftNote !== savedNote
  if (dirty && draftOutcome === "waiting" && savedOutcome !== "waiting") {
    if (!waitingKind) blockers.push("대기 유형")
    else if (waitingKind === "current_class" && !classId) blockers.push("대기 반")
  } else if (dirty && draftOutcome !== "waiting" && (waitingKind || classId)) {
    blockers.push("대기 정보")
  }
  return {
    editable,
    dirty,
    ...(blockers.length > 0 ? { blockers } : {}),
    canSave: editable && dirty && Boolean(draftOutcome) && blockers.length === 0,
    label: dirty ? "상담 결과 저장" : savedOutcome ? "저장됨" : "상담 결과를 선택하세요",
  }
}

export function shouldRenderRegistrationConsultationOutcome(input = {}) {
  return input.section === "consultation"
    && Boolean(input.consultation)
    && Boolean(input.canEdit)
}

export function getRegistrationActionPermissions(input = {}) {
  const canManage = ["admin", "staff"].includes(String(input.viewerRole || ""))
  const consultation = input.activeConsultation
  const ownsConsultation = Boolean(
    ["admin", "staff", "teacher"].includes(String(input.viewerRole || ""))
    && input.viewerId
    && input.track?.directorProfileId === input.viewerId
    && consultation?.trackId === input.track?.id
    && consultation?.directorProfileId === input.viewerId
  )
  const canCompleteOwnConsultation = Boolean(
    ownsConsultation
    && ((consultation?.mode === "phone" && consultation?.status === "waiting")
      || (consultation?.mode === "visit" && consultation?.status === "scheduled")),
  )
  return {
    canManage,
    canCompleteConsultation: canCompleteOwnConsultation,
    ...(consultation?.status === "completed" ? { canEditConsultationResult: ownsConsultation } : {}),
    readOnly: !canManage,
  }
}

export function getRegistrationSummaryActionPermissions(input = {}) {
  const canManage = ["admin", "staff"].includes(String(input.viewerRole || ""))
  const canOpenOwnConsultationHint = Boolean(
    (input.viewerRole === "admin" || (input.viewerRole === "teacher" && input.track?.subject === "과학"))
    && input.viewerId
    && input.track?.directorProfileId === input.viewerId
    && ["consultation_waiting", "visit_consultation_scheduled"].includes(input.track?.status),
  )
  return {
    canManage,
    canOpenConsultationCompletion: canOpenOwnConsultationHint,
  }
}

export function deriveRegistrationParentState({ tracks = [], batches = [] } = {}) {
  const hasOpenTrack = tracks.some((track) => !isRegistrationTrackTerminal(track?.status))
  const hasOpenBatch = batches.some((batch) => !TERMINAL_BATCH_STATUSES.has(batch?.status))
  if (hasOpenBatch) return { taskStatus: "in_progress", outcome: "" }
  if (hasOpenTrack || tracks.length === 0) return { taskStatus: tracks.length > 0 && tracks.every((track) => track?.status === "inquiry") ? "requested" : "in_progress", outcome: "" }
  const registeredCount = tracks.filter((track) => track?.status === "registered").length
  if (registeredCount === tracks.length) return { taskStatus: "done", outcome: "all_registered" }
  if (registeredCount > 0) return { taskStatus: "done", outcome: "partial_registration" }
  return { taskStatus: "canceled", outcome: "none_registered" }
}
