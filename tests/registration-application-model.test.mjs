import assert from "node:assert/strict"
import test from "node:test"

const application = await import("../src/features/tasks/registration-application-model.ts")
const trackModel = await import("../src/features/tasks/registration-track-model.js")

const {
  REGISTRATION_ACTION_SECTION,
  REGISTRATION_APPLICATION_SECTION_ORDER,
  getRegistrationApplicationAppointmentActionPlans,
  getRegistrationApplicationCaseEditableSections,
  getRegistrationApplicationSectionStates,
  getRegistrationApplicationTrackState,
  getRegistrationCreateSectionStates,
  isRegistrationApplicationSectionContentDisabled,
  updateRegistrationApplicationDirtyKeys,
} = application

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
    ],
    levelTests: [
      { appointmentId: "level-shared", trackId: english.id, status: "scheduled" },
      { appointmentId: "level-shared", trackId: mathematics.id, status: "scheduled" },
      { appointmentId: "level-other", trackId: english.id, status: "completed" },
    ],
    consultations: [
      { appointmentId: "visit-shared", trackId: english.id, mode: "visit", status: "scheduled" },
      { appointmentId: "visit-shared", trackId: mathematics.id, mode: "visit", status: "scheduled" },
    ],
    actionableTrackIds: [mathematics.id],
  })

  assert.equal(plans.length, 3)
  assert.deepEqual(plans.map((plan) => plan.appointmentId), ["level-shared", "level-other", "visit-shared"])
  assert.deepEqual(plans[0].participantTrackIds, [english.id, mathematics.id])
  assert.deepEqual(plans[0].participantSubjects, ["영어", "수학"])
  assert.equal(plans[0].ownerTrackId, mathematics.id)
  assert.deepEqual(plans[1].participantTrackIds, [english.id])
  assert.deepEqual(plans[2].participantSubjects, ["영어", "수학"])
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
  const second = updateRegistrationApplicationDirtyKeys(first, "level_test:영어", true)
  const third = updateRegistrationApplicationDirtyKeys(second, "inquiry:common", false)

  assert.deepEqual([...first], ["inquiry:common"])
  assert.deepEqual([...second], ["inquiry:common", "level_test:영어"])
  assert.deepEqual([...third], ["level_test:영어"])
})
