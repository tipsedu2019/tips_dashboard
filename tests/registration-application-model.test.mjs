import assert from "node:assert/strict"
import test from "node:test"

const application = await import("../src/features/tasks/registration-application-model.ts")
const trackModel = await import("../src/features/tasks/registration-track-model.js")

const {
  REGISTRATION_ACTION_SECTION,
  REGISTRATION_APPLICATION_BODY_SECTION_ORDER,
  REGISTRATION_APPLICATION_SECTION_ORDER,
  getRegistrationApplicationAppointmentActionPlans,
  getRegistrationApplicationCaseEditableSections,
  getRegistrationApplicationProgress,
  getRegistrationApplicationSectionStates,
  getRegistrationApplicationTrackState,
  getRegistrationCreateCatalogState,
  resolveRegistrationCreateCatalogStatus,
  getRegistrationCreateSectionStates,
  getRegistrationCommonConflictRows,
  getRegistrationEnrollmentDirtyKey,
  beginRegistrationConflictComparison,
  isRegistrationApplicationSectionContentDisabled,
  reconcileRegistrationEnrollmentDraft,
  reconcileRegistrationEditorDraft,
  settleRegistrationConflictComparison,
  updateRegistrationApplicationDirtyKeys,
} = application

test("visible application body excludes history while internal state retains it", () => {
  assert.deepEqual(REGISTRATION_APPLICATION_BODY_SECTION_ORDER, [
    "inquiry",
    "level_test",
    "consultation",
    "placement",
    "admission",
  ])
  assert.ok(REGISTRATION_APPLICATION_SECTION_ORDER.includes("history"))
})

function makeTrack(status, subject = "영어") {
  return {
    id: `track-${subject}-${status}`,
    taskId: "case-1",
    subject,
    status,
    legacy: false,
    directorProfileId: "director-1",
    directorName: "영어 원장",
    directorAssignmentSource: "default",
    directorAssignmentRuleKey: "fixture",
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: status === "migration_review",
    stageEnteredAt: "2026-07-12T00:00:00Z",
    phoneReadyAt: null,
    phoneReadySource: null,
  }
}

const cases = [
  ["inquiry", "inquiry"],
  ["migration_review", "inquiry"],
  ["level_test_scheduled", "level_test"],
  ["level_test_in_progress", "level_test"],
  ["consultation_waiting", "consultation"],
  ["visit_consultation_scheduled", "consultation"],
  ["waiting", "placement"],
  ["enrollment_decided", "placement"],
  ["enrollment_processing", "admission"],
  ["registered", "placement"],
  ["not_registered", "placement"],
  ["inquiry_closed", "inquiry"],
]

const progressKeys = ["inquiry", "level_test", "consultation", "placement", "admission"]

test("registration progress derives five ordered steps from the active track status", () => {
  const expectedStatesByStatus = {
    inquiry: ["current", "upcoming", "upcoming", "upcoming", "upcoming"],
    level_test_scheduled: ["reached", "current", "upcoming", "upcoming", "upcoming"],
    consultation_waiting: ["reached", "reached", "current", "upcoming", "upcoming"],
    waiting: ["reached", "reached", "reached", "current", "upcoming"],
    enrollment_processing: ["reached", "reached", "reached", "reached", "current"],
  }

  for (const [status, expectedStates] of Object.entries(expectedStatesByStatus)) {
    const progress = getRegistrationApplicationProgress(status)
    assert.deepEqual(progress.map((step) => step.key), progressKeys, status)
    assert.deepEqual(progress.map((step) => step.state), expectedStates, status)
  }
})

test("registered completes all progress while closed outcomes terminate only their outcome step", () => {
  assert.deepEqual(
    getRegistrationApplicationProgress("registered").map((step) => step.state),
    ["complete", "complete", "complete", "complete", "complete"],
  )
  assert.deepEqual(
    getRegistrationApplicationProgress("not_registered").map((step) => step.state),
    ["reached", "reached", "reached", "terminal", "upcoming"],
  )
  assert.deepEqual(
    getRegistrationApplicationProgress("inquiry_closed").map((step) => step.state),
    ["terminal", "upcoming", "upcoming", "upcoming", "upcoming"],
  )
})

test("active registration track keeps a valid request and falls back after subject removal", () => {
  const tracks = [{ id: "english" }, { id: "math" }]
  assert.equal(application.resolveRegistrationActiveTrackId(tracks, "math"), "math")
  assert.equal(application.resolveRegistrationActiveTrackId(tracks, "removed"), "english")
  assert.equal(application.resolveRegistrationActiveTrackId([], "removed"), null)
})

test("every saved track status has one explicit current application section", () => {
  for (const [status, currentSection] of cases) {
    const state = getRegistrationApplicationTrackState({
      track: makeTrack(status),
      canManage: true,
      canCompleteConsultation: false,
    })
    assert.equal(state.currentSection, currentSection)
    assert.deepEqual(
      REGISTRATION_APPLICATION_SECTION_ORDER.filter((section) => state.sections[section].current),
      [currentSection],
    )
  }
})

test("a viewer keeps every section value visible but cannot mutate a track", () => {
  const state = getRegistrationApplicationTrackState({
    track: makeTrack("consultation_waiting"),
    canManage: false,
    canCompleteConsultation: false,
  })

  assert.equal(state.currentSection, "consultation")
  for (const section of REGISTRATION_APPLICATION_SECTION_ORDER) {
    assert.equal(state.sections[section].editable, false, section)
    assert.ok(state.sections[section].lockReason, section)
  }
  assert.deepEqual(
    state.sections.consultation.actions,
    trackModel.getAllowedRegistrationTrackActions("consultation_waiting"),
  )
})

test("migration review exposes only its resolution action in inquiry", () => {
  const state = getRegistrationApplicationTrackState({
    track: makeTrack("migration_review"),
    canManage: true,
    canCompleteConsultation: false,
  })

  assert.deepEqual(state.sections.inquiry.actions, ["resolve_migration_review"])
  for (const section of REGISTRATION_APPLICATION_SECTION_ORDER.filter((section) => section !== "inquiry")) {
    assert.deepEqual(state.sections[section].actions, [], section)
  }
})

test("terminal reopen, add, and cancel actions stay in their approved sections", () => {
  const notRegistered = getRegistrationApplicationTrackState({ track: makeTrack("not_registered"), canManage: true, canCompleteConsultation: false })
  const inquiryClosed = getRegistrationApplicationTrackState({ track: makeTrack("inquiry_closed"), canManage: true, canCompleteConsultation: false })
  const registered = getRegistrationApplicationTrackState({ track: makeTrack("registered"), canManage: true, canCompleteConsultation: false })
  const admission = getRegistrationApplicationTrackState({ track: makeTrack("enrollment_processing"), canManage: true, canCompleteConsultation: false })

  assert.deepEqual(notRegistered.sections.placement.actions, ["reopen_track"])
  assert.deepEqual(inquiryClosed.sections.inquiry.actions, ["reopen_track"])
  assert.deepEqual(registered.sections.placement.actions, ["start_add_class", "cancel_enrollment"])
  assert.deepEqual(admission.sections.admission.actions, ["complete_enrollment", "cancel_admission_batch"])
})

test("history remains visible and read-only for every saved status", () => {
  for (const [status] of cases) {
    const history = getRegistrationApplicationTrackState({
      track: makeTrack(status),
      canManage: true,
      canCompleteConsultation: true,
    }).sections.history
    assert.equal(history.current, false, status)
    assert.equal(history.editable, false, status)
    assert.ok(history.lockReason, status)
    assert.deepEqual(history.actions, [], status)
  }
})

test("application actions are placed from the authoritative track action set", () => {
  for (const [status] of cases) {
    const state = getRegistrationApplicationTrackState({ track: makeTrack(status), canManage: true, canCompleteConsultation: false })
    const actual = REGISTRATION_APPLICATION_SECTION_ORDER.flatMap((section) => state.sections[section].actions)
    const allowed = trackModel.getAllowedRegistrationTrackActions(status)
    assert.deepEqual([...actual].sort(), [...allowed].sort())
    assert.notEqual(actual, allowed, "the model does not return the authority array itself")
    for (const action of actual) {
      const expectedSection = action === "reopen_track" && status === "not_registered"
        ? "placement"
        : REGISTRATION_ACTION_SECTION[action]
      assert.ok(state.sections[expectedSection].actions.includes(action), `${status}:${action}`)
    }
  }
})

test("create mode exposes every future section in a locked state", () => {
  const states = getRegistrationCreateSectionStates({
    subjects: ["영어", "수학"],
    draft: {
      subjectPlans: { 영어: "level_test", 수학: "direct_phone" },
      levelTestScheduledAt: "",
      levelTestPlace: "",
      visitScheduledAt: "",
      visitPlace: "",
      directorOverrides: {},
    },
    writable: true,
  })

  assert.equal(states.inquiry.editable, true)
  for (const section of REGISTRATION_APPLICATION_SECTION_ORDER.filter((section) => section !== "inquiry")) {
    assert.equal(states[section].editable, false, section)
    assert.ok(states[section].lockReason, section)
  }
})

test("create catalog state keeps inquiry writable while locking only catalog-owned consultation controls", () => {
  assert.deepEqual(getRegistrationCreateCatalogState({ status: "ready", error: "" }), {
    status: "ready",
    inquiryEditable: true,
    catalogControlsDisabled: false,
    showLocalStatus: false,
    showLocalRetry: false,
    lockReason: "",
  })
  assert.deepEqual(getRegistrationCreateCatalogState({ status: "loading", error: "" }), {
    status: "loading",
    inquiryEditable: true,
    catalogControlsDisabled: true,
    showLocalStatus: true,
    showLocalRetry: false,
    lockReason: "상담 책임자 선택 정보를 불러오는 중입니다",
  })
  assert.deepEqual(getRegistrationCreateCatalogState({ status: "partial", error: "" }), {
    status: "partial",
    inquiryEditable: true,
    catalogControlsDisabled: true,
    showLocalStatus: true,
    showLocalRetry: true,
    lockReason: "상담 책임자 선택 정보를 일부만 불러왔습니다. 다시 불러오세요.",
  })
  assert.deepEqual(getRegistrationCreateCatalogState({ status: "error", error: "선택 정보 일시 실패" }), {
    status: "error",
    inquiryEditable: true,
    catalogControlsDisabled: true,
    showLocalStatus: true,
    showLocalRetry: true,
    lockReason: "선택 정보 일시 실패",
  })
})

test("workspace option results distinguish authoritative loading partial and failure catalog states", () => {
  assert.equal(resolveRegistrationCreateCatalogStatus({ loading: true, error: "", directorCatalogStatus: "authoritative" }), "loading")
  assert.equal(resolveRegistrationCreateCatalogStatus({ loading: false, error: "", directorCatalogStatus: "authoritative" }), "ready")
  assert.equal(resolveRegistrationCreateCatalogStatus({ loading: false, error: "", directorCatalogStatus: "partial" }), "partial")
  assert.equal(resolveRegistrationCreateCatalogStatus({ loading: false, error: "permission denied", directorCatalogStatus: "error" }), "error")
  assert.equal(resolveRegistrationCreateCatalogStatus({ loading: false, error: "", directorCatalogStatus: null }), "loading")
})

test("mixed tracks aggregate current emphasis without unlocking the sibling", () => {
  const english = getRegistrationApplicationTrackState({ track: makeTrack("consultation_waiting", "영어"), canManage: true, canCompleteConsultation: false })
  const mathematics = getRegistrationApplicationTrackState({ track: makeTrack("level_test_scheduled", "수학"), canManage: false, canCompleteConsultation: false })
  const aggregate = getRegistrationApplicationSectionStates({ tracks: [english, mathematics] })

  assert.equal(aggregate.consultation.current, true)
  assert.equal(aggregate.consultation.editable, true)
  assert.equal(aggregate.level_test.current, true)
  assert.equal(aggregate.level_test.editable, false)
  assert.equal(mathematics.sections.level_test.editable, false)
})

test("authorized destination actions unlock their owning sections without moving authority", () => {
  assert.equal(typeof getRegistrationApplicationTrackState, "function")
  const inquiry = getRegistrationApplicationTrackState({
    track: makeTrack("inquiry"),
    canManage: true,
    canCompleteConsultation: false,
  })
  const waiting = getRegistrationApplicationTrackState({
    track: makeTrack("waiting"),
    canManage: true,
    canCompleteConsultation: false,
  })

  assert.equal(inquiry.currentSection, "inquiry")
  assert.equal(inquiry.sections.level_test.editable, true)
  assert.equal(inquiry.sections.consultation.editable, true)
  assert.equal(inquiry.sections.placement.editable, true)
  assert.deepEqual(inquiry.sections.level_test.actions, ["schedule_level_test"])
  assert.deepEqual(inquiry.sections.consultation.actions, ["route_consultation"])
  assert.deepEqual(inquiry.sections.placement.actions, ["route_waiting"])
  assert.equal(waiting.sections.level_test.editable, true)
  assert.deepEqual(waiting.sections.level_test.actions, ["schedule_level_test"])
  assert.equal(inquiry.sections.history.editable, false)
  assert.deepEqual(inquiry.sections.history.actions, [])
})

test("destination action editability never unlocks a non-authorized sibling", () => {
  const authorized = getRegistrationApplicationTrackState({
    track: makeTrack("inquiry", "영어"),
    canManage: true,
    canCompleteConsultation: false,
  })
  const sibling = getRegistrationApplicationTrackState({
    track: makeTrack("inquiry", "수학"),
    canManage: false,
    canCompleteConsultation: false,
  })
  const aggregate = getRegistrationApplicationSectionStates({ tracks: [authorized, sibling] })

  assert.equal(aggregate.level_test.editable, true)
  assert.equal(authorized.sections.level_test.editable, true)
  assert.equal(sibling.sections.level_test.editable, false)
  assert.ok(sibling.sections.level_test.lockReason)
})

test("shared appointment actions group participants once per appointment id", () => {
  assert.equal(typeof getRegistrationApplicationAppointmentActionPlans, "function")
  const tracks = [makeTrack("level_test_scheduled", "영어"), makeTrack("level_test_scheduled", "수학")]
  const [english, mathematics] = tracks
  const plans = getRegistrationApplicationAppointmentActionPlans({
    tracks,
    appointments: [
      { id: "level-shared", kind: "level_test", status: "scheduled" },
      { id: "level-other", kind: "level_test", status: "completed" },
      { id: "visit-shared", kind: "visit_consultation", status: "scheduled" },
      { id: "visit-filtered", kind: "visit_consultation", status: "scheduled" },
    ],
    levelTests: [
      { appointmentId: "level-shared", trackId: english.id, status: "scheduled" },
      { appointmentId: "level-shared", trackId: mathematics.id, status: "scheduled" },
      { appointmentId: "level-other", trackId: english.id, status: "completed" },
      { appointmentId: "level-other", trackId: mathematics.id, status: "canceled" },
    ],
    consultations: [
      { appointmentId: "visit-shared", trackId: english.id, mode: "visit", status: "scheduled" },
      { appointmentId: "visit-shared", trackId: mathematics.id, mode: "visit", status: "scheduled" },
      { appointmentId: "visit-filtered", trackId: english.id, mode: "visit", status: "scheduled" },
      { appointmentId: "visit-filtered", trackId: mathematics.id, mode: "visit", status: "completed" },
      { appointmentId: "visit-filtered", trackId: mathematics.id, mode: "visit", status: "canceled" },
    ],
    actionableTrackIds: [mathematics.id],
  })

  assert.equal(plans.length, 4)
  assert.deepEqual(plans.map((plan) => plan.appointmentId), ["level-shared", "level-other", "visit-shared", "visit-filtered"])
  assert.deepEqual(plans[0].participantTrackIds, [english.id, mathematics.id])
  assert.deepEqual(plans[0].participantSubjects, ["영어", "수학"])
  assert.equal(plans[0].ownerTrackId, mathematics.id)
  assert.deepEqual(plans[1].participantTrackIds, [english.id])
  assert.deepEqual(plans[2].participantSubjects, ["영어", "수학"])
  assert.deepEqual(plans[3].participantTrackIds, [english.id])
})

test("existing appointment editor seed stays empty when status filtering produces no plan", () => {
  const tracks = [makeTrack("level_test_scheduled", "영어"), makeTrack("level_test_scheduled", "수학")]
  const plans = getRegistrationApplicationAppointmentActionPlans({
    tracks,
    appointments: [
      { id: "level-canceled", kind: "level_test", status: "canceled" },
      { id: "visit-no-scheduled", kind: "visit_consultation", status: "completed" },
    ],
    levelTests: [
      { appointmentId: "level-canceled", trackId: tracks[0].id, status: "canceled" },
    ],
    consultations: [
      { appointmentId: "visit-no-scheduled", trackId: tracks[1].id, mode: "visit", status: "completed" },
      { appointmentId: "visit-no-scheduled", trackId: tracks[0].id, mode: "visit", status: "canceled" },
    ],
  })

  assert.deepEqual(plans, [])
  assert.deepEqual(application.resolveRegistrationAppointmentEditorSeedTrackIds(plans, "level-canceled", tracks[0].id), [])
  assert.deepEqual(application.resolveRegistrationAppointmentEditorSeedTrackIds(plans, "visit-no-scheduled", tracks[1].id), [])
  assert.deepEqual(application.resolveRegistrationAppointmentEditorSeedTrackIds(plans, null, tracks[0].id), [tracks[0].id])
})

test("an open admission batch enables the case section for registered add-class work", () => {
  assert.equal(typeof getRegistrationApplicationCaseEditableSections, "function")
  const registered = getRegistrationApplicationTrackState({
    track: makeTrack("registered"),
    canManage: true,
    canCompleteConsultation: false,
  })
  const caseEditableSections = getRegistrationApplicationCaseEditableSections({
    canManage: true,
    admissionMessageEditable: false,
    admissionBatches: [{ status: "draft" }],
  })
  const aggregate = getRegistrationApplicationSectionStates({
    tracks: [registered],
    caseEditableSections,
  })

  assert.equal(registered.currentSection, "placement")
  assert.equal(registered.sections.admission.editable, false)
  assert.ok(caseEditableSections.includes("admission"))
  assert.equal(aggregate.admission.editable, true)
  assert.deepEqual(
    getRegistrationApplicationCaseEditableSections({
      canManage: true,
      admissionMessageEditable: false,
      admissionBatches: [{ status: "completed" }, { status: "canceled" }],
    }),
    ["inquiry"],
  )
})

test("an authorized shared appointment plan keeps its owning section operable", () => {
  const sections = getRegistrationApplicationCaseEditableSections({
    canManage: true,
    admissionMessageEditable: false,
    admissionBatches: [],
    appointmentActionSections: ["level_test", "consultation"],
  })

  assert.deepEqual(sections, ["inquiry", "level_test", "consultation"])
})

test("detail history keeps filters interactive while mutation and create-history controls stay locked", () => {
  assert.equal(typeof isRegistrationApplicationSectionContentDisabled, "function")
  assert.equal(isRegistrationApplicationSectionContentDisabled({ mode: "detail", section: "history", editable: false }), false)
  assert.equal(isRegistrationApplicationSectionContentDisabled({ mode: "create", section: "history", editable: false }), true)
  assert.equal(isRegistrationApplicationSectionContentDisabled({ mode: "detail", section: "admission", editable: false }), true)
})

test("dirty state adds and removes one key without clearing another subject or section", () => {
  const first = updateRegistrationApplicationDirtyKeys(new Set(), "inquiry:common", true)
  const second = updateRegistrationApplicationDirtyKeys(first, "level_test:track-track123", true)
  const third = updateRegistrationApplicationDirtyKeys(second, "inquiry:common", false)

  assert.deepEqual([...first], ["inquiry:common"])
  assert.deepEqual([...second], ["inquiry:common", "level_test:track-track123"])
  assert.deepEqual([...third], ["level_test:track-track123"])
})

test("dirty membership no-ops retain the same set identity", () => {
  const dirty = new Set(["inquiry:common"])

  assert.equal(updateRegistrationApplicationDirtyKeys(dirty, "inquiry:common", true), dirty)
  assert.equal(updateRegistrationApplicationDirtyKeys(dirty, "consultation:track-track123", false), dirty)
})

test("an inquiry draft survives a consultation reload until its own canonical revision changes", () => {
  const editedInquiry = { requestNote: "저장하지 않은 문의 메모" }
  let dirtyKeys = updateRegistrationApplicationDirtyKeys(new Set(), "inquiry:common", true)
  dirtyKeys = updateRegistrationApplicationDirtyKeys(dirtyKeys, "consultation:track-track123", true)

  const afterConsultationReload = reconcileRegistrationEditorDraft({
    currentDraft: editedInquiry,
    previousCanonicalKey: "case-1:common-3",
    nextCanonicalKey: "case-1:common-3",
    nextCanonicalDraft: { requestNote: "서버 문의 메모" },
  })
  dirtyKeys = updateRegistrationApplicationDirtyKeys(dirtyKeys, "consultation:track-track123", false)

  assert.equal(afterConsultationReload.draft, editedInquiry)
  assert.deepEqual([...dirtyKeys], ["inquiry:common"])

  const afterInquirySave = reconcileRegistrationEditorDraft({
    currentDraft: afterConsultationReload.draft,
    previousCanonicalKey: afterConsultationReload.canonicalKey,
    nextCanonicalKey: "case-1:common-4",
    nextCanonicalDraft: { requestNote: "저장된 문의 메모" },
  })
  dirtyKeys = updateRegistrationApplicationDirtyKeys(dirtyKeys, "inquiry:common", false)

  assert.deepEqual(afterInquirySave.draft, { requestNote: "저장된 문의 메모" })
  assert.equal(dirtyKeys.size, 0)
})

test("common revision conflicts retain attempted values beside canonical latest values", () => {
  const rows = getRegistrationCommonConflictRows({
    attempted: { studentName: "김학생", schoolGrade: "중2", requestNote: "내가 입력한 요청" },
    latest: { studentName: "김학생", schoolGrade: "중3", requestNote: "다른 담당자의 최신 요청" },
    labels: { studentName: "학생명", schoolGrade: "학년", requestNote: "요청 사항" },
  })

  assert.deepEqual(rows, [
    { field: "schoolGrade", label: "학년", attempted: "중2", latest: "중3" },
    { field: "requestNote", label: "요청 사항", attempted: "내가 입력한 요청", latest: "다른 담당자의 최신 요청" },
  ])
})

test("enrollment row, decision, and cancellation drafts keep independent stable owners", () => {
  const rowsKey = getRegistrationEnrollmentDirtyKey("track123", { kind: "rows" })
  const decisionKey = getRegistrationEnrollmentDirtyKey("track123", { kind: "decision" })
  const cancellationKey = getRegistrationEnrollmentDirtyKey("track123", { kind: "cancellation", enrollmentId: "enrollment456" })
  let dirty = updateRegistrationApplicationDirtyKeys(new Set(), rowsKey, true)
  dirty = updateRegistrationApplicationDirtyKeys(dirty, decisionKey, true)
  dirty = updateRegistrationApplicationDirtyKeys(dirty, cancellationKey, true)
  dirty = updateRegistrationApplicationDirtyKeys(dirty, decisionKey, false)

  assert.equal(rowsKey, "placement:enrollments-track123")
  assert.equal(decisionKey, "placement:decision-track123")
  assert.equal(cancellationKey, "placement:cancellation-track123-enrollment456")
  assert.deepEqual([...dirty], [rowsKey, cancellationKey])
})

test("clean enrollment rows adopt a newer canonical revision while dirty rows survive it", () => {
  const cleanRows = [{ clientKey: "enrollment-1", status: "planned", classId: "class-old" }]
  const latestRows = []
  const cleanResult = reconcileRegistrationEnrollmentDraft({
    currentDraft: cleanRows,
    currentBaseline: JSON.stringify(cleanRows),
    previousCanonicalKey: "enrollments-v1",
    nextCanonicalKey: "enrollments-v2",
    nextCanonicalDraft: latestRows,
  })

  assert.deepEqual(cleanResult, {
    draft: latestRows,
    baseline: JSON.stringify(latestRows),
    canonicalKey: "enrollments-v2",
  })

  const dirtyRows = [{ clientKey: "enrollment-1", status: "planned", classId: "class-local" }]
  const dirtyResult = reconcileRegistrationEnrollmentDraft({
    currentDraft: dirtyRows,
    currentBaseline: JSON.stringify(cleanRows),
    previousCanonicalKey: "enrollments-v1",
    nextCanonicalKey: "enrollments-v2",
    nextCanonicalDraft: latestRows,
  })

  assert.equal(dirtyResult.draft, dirtyRows)
  assert.equal(dirtyResult.baseline, JSON.stringify(cleanRows))
  assert.equal(dirtyResult.canonicalKey, "enrollments-v1")

  const afterLocalRevert = reconcileRegistrationEnrollmentDraft({
    currentDraft: cleanRows,
    currentBaseline: JSON.stringify(cleanRows),
    previousCanonicalKey: dirtyResult.canonicalKey,
    nextCanonicalKey: "enrollments-v2",
    nextCanonicalDraft: latestRows,
  })
  assert.deepEqual(afterLocalRevert.draft, latestRows)
  assert.equal(afterLocalRevert.canonicalKey, "enrollments-v2")
})

test("a conflict attempt remains available until a refresh actually succeeds", () => {
  const attempted = { profileId: "director-local", label: "내 선택" }
  const begun = beginRegistrationConflictComparison(attempted)

  assert.deepEqual(begun, {
    attempted,
    latestReady: false,
    refreshError: "",
  })

  const failed = settleRegistrationConflictComparison(begun, {
    succeeded: false,
    error: "최신 정보를 불러오지 못했습니다.",
  })
  assert.equal(failed.attempted, attempted)
  assert.equal(failed.latestReady, false)
  assert.equal(failed.refreshError, "최신 정보를 불러오지 못했습니다.")

  const retried = settleRegistrationConflictComparison(failed, { succeeded: true })
  assert.equal(retried.attempted, attempted)
  assert.equal(retried.latestReady, true)
  assert.equal(retried.refreshError, "")
})
