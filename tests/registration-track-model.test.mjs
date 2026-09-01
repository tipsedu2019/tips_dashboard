import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  applyRegistrationEnrollmentClassSelection,
  canEditRegistrationAppointment,
  canCancelRegistrationSharedAppointment,
  createRegistrationEnrollmentDraft,
  deriveRegistrationParentState,
  getEligibleSharedAppointmentTracks,
  getRegistrationAppointmentEditMode,
  getRegistrationAppointmentPayloadTrackIds,
  getRegistrationAppointmentReportedTrackIds,
  getLatestRegistrationLevelTestActivityIds,
  getRegistrationAdmissionBatchCancellationGroups,
  getRegistrationAdmissionBatchChecklist,
  getRegistrationAdmissionRecoveryDelayMs,
  getRegistrationAdmissionApplicationState,
  getRegistrationEnrollmentCancellationState,
  getRegistrationSelectedAdmissionEnrollmentIds,
  getRegistrationEnrollmentBlockers,
  getRegistrationLevelTestAppointmentStatus,
  getRegistrationConsultationOutcomeSaveState,
  getRegistrationActiveConsultation,
  getRegistrationSummaryActionPermissions,
  getRegistrationActionPermissions,
  getAllowedRegistrationTrackActions,
  getRegistrationCurrentClassWaitClassId,
  getRegistrationWaitingDetailsDraft,
  getRegistrationTrackNextStatus,
  getRegistrationTrackTransitionBlockers,
  getRegistrationTrackViewKey,
  mergeSavedRegistrationEnrollmentRows,
  restoreRegistrationEnrollmentDraft,
  serializeRegistrationEnrollmentRows,
} from "../src/features/tasks/registration-track-model.js"
import * as registrationTrackModel from "../src/features/tasks/registration-track-model.js"
import {
  buildRegistrationCaseListItems,
  getRegistrationCaseTabCounts,
} from "../src/features/tasks/registration-case-list-model.ts"
import { isRegistrationWaitingMessageSourceComplete } from "../src/features/tasks/registration-application-model.ts"

test("waiting message readiness follows the manual workflow source contract", () => {
  assert.equal(isRegistrationWaitingMessageSourceComplete({
    status: "inquiry",
    workflowStatus: "waiting_next_opening",
    waitingDetailKind: "next_term_opening",
    waitingDetailClassId: null,
  }), true)

  assert.equal(isRegistrationWaitingMessageSourceComplete({
    status: "waiting",
    workflowStatus: "waiting_new_class",
    waitingDetailKind: "next_term_opening",
    waitingDetailClassId: null,
  }), false)
})

test("waiting details stay empty until an operator stores them", () => {
  assert.deepEqual(getRegistrationWaitingDetailsDraft({
    waitingKind: "current_term_opening",
    waitingDetailKind: "",
    waitingDetailClassId: null,
    waitingDetailRetakeDecision: "",
  }), {
    waitingKind: "",
    classId: "",
    retakeDecision: "",
    persisted: false,
  })
})

test("waiting detail columns restore the operator's saved values", () => {
  assert.deepEqual(getRegistrationWaitingDetailsDraft({
    waitingDetailKind: "current_class",
    waitingDetailClassId: "class-1",
    waitingDetailRetakeDecision: "required",
  }), {
    waitingKind: "current_class",
    classId: "class-1",
    retakeDecision: "required",
    persisted: true,
  })
})

test("allowed actions are returned as a fresh view of the authoritative status matrix", () => {
  const first = getAllowedRegistrationTrackActions("consultation_waiting")
  first.pop()

  assert.deepEqual(first, ["complete_phone_consultation"])
  assert.deepEqual(getAllowedRegistrationTrackActions("consultation_waiting"), [
    "complete_phone_consultation",
    "schedule_visit",
  ])
  assert.deepEqual(getAllowedRegistrationTrackActions("unknown"), [])
})

test("shared appointment cancellation requires a currently cancellable scheduled participant", async () => {
  const appointment = { id: "appointment-1", status: "scheduled" }
  const activities = [{ appointmentId: "appointment-1", trackId: "english", status: "scheduled" }]

  assert.equal(canCancelRegistrationSharedAppointment(
    "level_test",
    appointment,
    [{ id: "english", status: "level_test_scheduled" }],
    activities,
  ), true)
  assert.equal(canCancelRegistrationSharedAppointment(
    "level_test",
    appointment,
    [{ id: "english", status: "inquiry" }],
    activities,
  ), false)
  assert.equal(canCancelRegistrationSharedAppointment(
    "visit_consultation",
    appointment,
    [{ id: "english", status: "consultation_waiting" }],
    activities,
  ), false)

  const editor = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(editor, /canCancelRegistrationSharedAppointment/)
})

test("replace remaining tab scope keeps immutable participants while scheduled draft subjects change", () => {
  const activities = [
    { appointmentId: "shared", trackId: "english", status: "completed" },
    { appointmentId: "shared", trackId: "science", status: "absent" },
    { appointmentId: "shared", trackId: "math", status: "scheduled" },
    { appointmentId: "shared", trackId: "canceled", status: "canceled" },
    { appointmentId: "other", trackId: "other", status: "completed" },
  ]

  assert.deepEqual(
    getRegistrationAppointmentReportedTrackIds("level_test", "replace_remaining", ["math"], activities, "shared"),
    ["english", "math", "science"],
  )
  assert.deepEqual(
    getRegistrationAppointmentReportedTrackIds("level_test", "replace_remaining", [], activities, "shared"),
    ["english", "science"],
  )
  assert.deepEqual(
    getRegistrationAppointmentReportedTrackIds("level_test", "replace_remaining", ["new"], activities, "shared"),
    ["english", "new", "science"],
  )
  assert.deepEqual(
    getRegistrationAppointmentReportedTrackIds("level_test", "edit", ["math", "new"], activities, "shared"),
    ["math", "new"],
  )
  assert.equal(getRegistrationAppointmentReportedTrackIds("level_test", "read_only", [], activities, "shared"), null)
})

test("visit appointment tab scope reports only the live scheduled draft", () => {
  const activities = [
    { appointmentId: "shared-visit", trackId: "english", status: "completed" },
    { appointmentId: "shared-visit", trackId: "math", status: "scheduled" },
    { appointmentId: "shared-visit", trackId: "science", status: "canceled" },
  ]

  assert.deepEqual(
    getRegistrationAppointmentReportedTrackIds(
      "visit_consultation",
      "replace_remaining",
      ["math"],
      activities,
      "shared-visit",
    ),
    ["math"],
  )
})

test("현재반 대기 수업은 활성 waitlisted claim에서만 복원한다", () => {
  const enrollments = [
    { trackId: "track-eng", classId: "class-old", status: "canceled", rosterActive: false },
    { trackId: "track-eng", classId: "class-eng-a", status: "waitlisted", rosterActive: true },
    { trackId: "track-math", classId: "class-math-a", status: "waitlisted", rosterActive: true },
  ]

  assert.equal(getRegistrationCurrentClassWaitClassId({
    trackId: "track-eng",
    waitingKind: "current_class",
    enrollments,
  }), "class-eng-a")
  assert.equal(getRegistrationCurrentClassWaitClassId({
    trackId: "track-eng",
    waitingKind: "current_term_opening",
    enrollments,
  }), "")
  assert.equal(getRegistrationCurrentClassWaitClassId({
    trackId: "track-eng",
    waitingKind: "next_term_opening",
    enrollments,
  }), "")
})

test("new enrollment rows keep stable keys and selecting a class defaults its linked textbook", () => {
  const first = createRegistrationEnrollmentDraft({ clientKey: "draft-1" })
  const second = createRegistrationEnrollmentDraft({ clientKey: "draft-2" })
  const selected = applyRegistrationEnrollmentClassSelection(first, {
    classItem: { id: "eng-a", subject: "영어", textbookIds: ["missing", "book-a"] },
    availableTextbookIds: ["book-a"],
  })

  assert.equal(selected.clientKey, "draft-1")
  assert.equal(selected.classId, "eng-a")
  assert.equal(selected.textbookId, "book-a")
  assert.equal(selected.textbookExplicitlyCleared, false)
  assert.equal(second.classId, "")
  assert.equal(first.id, null)
  assert.deepEqual(serializeRegistrationEnrollmentRows([selected])[0], {
    classId: "eng-a",
    textbookId: "book-a",
    classStartDate: null,
    classStartSessionKey: null,
    classStartLessonSessionId: null,
    classStartSession: null,
    classStartSourceObservationId: null,
    sortOrder: 0,
  })
})

test("serialized enrollment rows retain the normalized lesson-session UUID", () => {
  assert.equal(serializeRegistrationEnrollmentRows([{
    classId: "eng-a",
    textbookId: "",
    classStartDate: "2026-08-03",
    classStartSessionKey: "default:slot-1:2026-08-03",
    classStartLessonSessionId: "10000000-0000-4000-8000-000000000011",
    classStartSession: "수업",
    sortOrder: 0,
  }])[0].classStartLessonSessionId, "10000000-0000-4000-8000-000000000011")
})

const matchingEnrollmentObservation = Object.freeze({
  observationId: "10000000-0000-4000-8000-000000000101",
  taskId: "10000000-0000-4000-8000-000000000001",
  trackId: "10000000-0000-4000-8000-000000000002",
  classId: "10000000-0000-4000-8000-000000000003",
  className: "중2 영어 A반",
  sessionDate: "2026-08-17",
  startsAt: "2026-08-17T10:00:00.000Z",
  endsAt: "2026-08-17T11:30:00.000Z",
  status: "completed",
  attendance: "attended",
  suitabilityResult: "fit",
  decisionKind: "enrollment",
  sessionAuthority: "normalized",
  sessionKey: "normalized:2026-08-17:1",
  classLessonSessionId: "10000000-0000-4000-8000-000000000004",
  legacySessionKey: null,
  sourceRevision: Object.freeze({
    authority: "normalized",
    sessionId: "10000000-0000-4000-8000-000000000004",
    revision: 7,
  }),
})

const futureEnrollmentSession = Object.freeze({
  value: "normalized:2026-08-24:2",
  lessonSessionId: "10000000-0000-4000-8000-000000000005",
  dateKey: "2026-08-24",
  sessionNumber: 2,
  sessionLabel: "2회차",
  state: "active",
})

test("matching fit observation is injected before future first lesson sessions with exact normalized identity", () => {
  const getOptions = registrationTrackModel.getRegistrationEnrollmentStartOptions
  assert.equal(typeof getOptions, "function")

  const options = getOptions({
    regularSessions: [futureEnrollmentSession],
    matchingObservation: matchingEnrollmentObservation,
    finalClassId: matchingEnrollmentObservation.classId,
  })

  assert.deepEqual(options, [{
    source: "observation",
    sourceObservationId: matchingEnrollmentObservation.observationId,
    trackId: matchingEnrollmentObservation.trackId,
    classId: matchingEnrollmentObservation.classId,
    sessionDate: "2026-08-17",
    startsAt: "2026-08-17T10:00:00.000Z",
    endsAt: "2026-08-17T11:30:00.000Z",
    label: "청강 회차",
    sessionAuthority: "normalized",
    classStartSessionKey: "normalized:2026-08-17:1",
    classStartLessonSessionId: "10000000-0000-4000-8000-000000000004",
    legacySessionKey: null,
    sourceRevision: {
      authority: "normalized",
      sessionId: "10000000-0000-4000-8000-000000000004",
      revision: 7,
    },
  }, {
    source: "regular",
    sourceObservationId: "",
    trackId: matchingEnrollmentObservation.trackId,
    classId: matchingEnrollmentObservation.classId,
    classStartSessionKey: "normalized:2026-08-24:2",
    classStartLessonSessionId: "10000000-0000-4000-8000-000000000005",
    sessionDate: "2026-08-24",
    label: "2회차",
  }])
})

test("regular first lesson options remain unchanged when there is no matching observation", () => {
  const options = registrationTrackModel.getRegistrationEnrollmentStartOptions({
    regularSessions: [futureEnrollmentSession],
    matchingObservation: null,
    finalClassId: matchingEnrollmentObservation.classId,
  })

  assert.deepEqual(options, [{
    source: "regular",
    sourceObservationId: "",
    trackId: "",
    classId: matchingEnrollmentObservation.classId,
    classStartSessionKey: futureEnrollmentSession.value,
    classStartLessonSessionId: futureEnrollmentSession.lessonSessionId,
    sessionDate: futureEnrollmentSession.dateKey,
    label: futureEnrollmentSession.sessionLabel,
  }])
  assert.equal("startsAt" in options[0], false, "regular sessions never invent observation timing")
  assert.equal("sourceRevision" in options[0], false, "regular sessions never invent a source revision")
})

test("legacy observation first lesson preserves its historical key, hash, dates, and times", () => {
  const getOptions = registrationTrackModel.getRegistrationEnrollmentStartOptions
  const legacyObservation = {
    ...matchingEnrollmentObservation,
    observationId: "10000000-0000-4000-8000-000000000111",
    sessionAuthority: "legacy",
    sessionKey: "legacy:2026-08-10:3",
    classLessonSessionId: null,
    legacySessionKey: "legacy:2026-08-10:3",
    sourceRevision: {
      authority: "legacy",
      sessionKey: "legacy:2026-08-10:3",
      contentHash: "legacy-content-hash",
    },
  }

  assert.deepEqual(getOptions({
    regularSessions: [],
    matchingObservation: legacyObservation,
    finalClassId: legacyObservation.classId,
  })[0], {
    source: "observation",
    sourceObservationId: legacyObservation.observationId,
    trackId: legacyObservation.trackId,
    classId: legacyObservation.classId,
    sessionDate: "2026-08-17",
    startsAt: "2026-08-17T10:00:00.000Z",
    endsAt: "2026-08-17T11:30:00.000Z",
    label: "청강 회차",
    sessionAuthority: "legacy",
    classStartSessionKey: "legacy:2026-08-10:3",
    classStartLessonSessionId: null,
    legacySessionKey: "legacy:2026-08-10:3",
    sourceRevision: {
      authority: "legacy",
      sessionKey: "legacy:2026-08-10:3",
      contentHash: "legacy-content-hash",
    },
  })
})

test("first lesson observation eligibility excludes every incomplete or mismatched decision fact", () => {
  const getOptions = registrationTrackModel.getRegistrationEnrollmentStartOptions
  const mutations = [
    ["status", "canceled"],
    ["attendance", "no_show"],
    ["suitabilityResult", "unfit"],
    ["decisionKind", null],
    ["decisionKind", "waiting_current_class"],
    ["classId", "10000000-0000-4000-8000-000000000099"],
  ]

  for (const [key, value] of mutations) {
    const options = getOptions({
      regularSessions: [futureEnrollmentSession],
      matchingObservation: { ...matchingEnrollmentObservation, [key]: value },
      finalClassId: matchingEnrollmentObservation.classId,
    })
    assert.equal(options.length, 1, `${key}=${value} excludes the observation`)
    assert.equal(options[0].source, "regular")
  }
})

test("observation first lesson defaults only the first explicitly owned blank matching row", () => {
  const applyDefault = registrationTrackModel.applyRegistrationEnrollmentStartDefault
  const getOptions = registrationTrackModel.getRegistrationEnrollmentStartOptions
  assert.equal(typeof applyDefault, "function")
  const observationOption = getOptions({
    regularSessions: [],
    matchingObservation: matchingEnrollmentObservation,
    finalClassId: matchingEnrollmentObservation.classId,
  })[0]
  const rows = [
    createRegistrationEnrollmentDraft({ clientKey: "other", classId: "other-class" }),
    createRegistrationEnrollmentDraft({ clientKey: "persisted-json", classId: matchingEnrollmentObservation.classId }),
    createRegistrationEnrollmentDraft({ clientKey: "owned", classId: matchingEnrollmentObservation.classId }),
    createRegistrationEnrollmentDraft({ clientKey: "owned-second", classId: matchingEnrollmentObservation.classId, sortOrder: 3 }),
  ]

  const defaulted = applyDefault(rows, observationOption, { eligibleClientKeys: ["owned", "owned-second"] })
  assert.equal(defaulted[0].classStartSessionKey, "")
  assert.equal(defaulted[1].classStartSessionKey, "", "a restored JSON row without an ID is still persisted ownership")
  assert.equal(defaulted[2].classStartSourceObservationId, matchingEnrollmentObservation.observationId)
  assert.equal(defaulted[2].classStartDate, matchingEnrollmentObservation.sessionDate)
  assert.equal(defaulted[3].classStartSessionKey, "", "only one matching row receives the default")

  const targeted = applyDefault(rows, observationOption, {
    eligibleClientKeys: ["owned", "owned-second"],
    preferredClientKey: "owned-second",
  })
  assert.equal(targeted[2].classStartSessionKey, "", "a row event never defaults its matching sibling")
  assert.equal(targeted[3].classStartSourceObservationId, matchingEnrollmentObservation.observationId)

  const manual = [{
    ...rows[2],
    classStartDate: futureEnrollmentSession.dateKey,
    classStartSessionKey: futureEnrollmentSession.value,
    classStartLessonSessionId: futureEnrollmentSession.lessonSessionId,
    classStartSession: futureEnrollmentSession.sessionLabel,
    classStartSourceObservationId: "",
  }]
  assert.strictEqual(applyDefault(manual, observationOption, { eligibleClientKeys: ["owned"] }), manual)
})

test("class changes and regular first lesson overrides clear the observation source and serialize DB null", () => {
  const getOptions = registrationTrackModel.getRegistrationEnrollmentStartOptions
  const selectStart = registrationTrackModel.applyRegistrationEnrollmentStartSelection
  const observationOption = getOptions({
    regularSessions: [futureEnrollmentSession],
    matchingObservation: matchingEnrollmentObservation,
    finalClassId: matchingEnrollmentObservation.classId,
  })[0]
  const regularOption = getOptions({
    regularSessions: [futureEnrollmentSession],
    matchingObservation: matchingEnrollmentObservation,
    finalClassId: matchingEnrollmentObservation.classId,
  })[1]
  const selectedObservation = selectStart(
    createRegistrationEnrollmentDraft({ clientKey: "owned", classId: matchingEnrollmentObservation.classId }),
    observationOption,
  )
  assert.equal(selectedObservation.classStartSourceObservationId, matchingEnrollmentObservation.observationId)

  const regularOverride = selectStart(selectedObservation, regularOption)
  assert.equal(regularOverride.classStartSourceObservationId, "")
  assert.equal(serializeRegistrationEnrollmentRows([regularOverride])[0].classStartSourceObservationId, null)

  const changedClass = applyRegistrationEnrollmentClassSelection(selectedObservation, {
    classItem: { id: "other-class", textbookIds: [] },
    availableTextbookIds: [],
  })
  assert.deepEqual({
    date: changedClass.classStartDate,
    key: changedClass.classStartSessionKey,
    lessonId: changedClass.classStartLessonSessionId,
    label: changedClass.classStartSession,
    sourceId: changedClass.classStartSourceObservationId,
  }, { date: "", key: "", lessonId: "", label: "", sourceId: "" })
})

test("persisted historical observation first lessons restore and serialize outside future regular filtering", () => {
  const restored = restoreRegistrationEnrollmentDraft({
    id: "persisted-observation-row",
    classId: matchingEnrollmentObservation.classId,
    classStartDate: matchingEnrollmentObservation.sessionDate,
    classStartSessionKey: matchingEnrollmentObservation.sessionKey,
    classStartLessonSessionId: matchingEnrollmentObservation.classLessonSessionId,
    classStartSession: "청강 회차",
    classStartSourceObservationId: matchingEnrollmentObservation.observationId,
  })
  const futureOnly = registrationTrackModel.getRegistrationEnrollmentStartOptions({
    regularSessions: [futureEnrollmentSession],
    matchingObservation: null,
    finalClassId: restored.classId,
  })

  assert.equal(futureOnly.some((option) => option.sessionDate === restored.classStartDate), false)
  assert.deepEqual({
    date: restored.classStartDate,
    key: restored.classStartSessionKey,
    lessonId: restored.classStartLessonSessionId,
    label: restored.classStartSession,
    sourceId: restored.classStartSourceObservationId,
  }, {
    date: matchingEnrollmentObservation.sessionDate,
    key: matchingEnrollmentObservation.sessionKey,
    lessonId: matchingEnrollmentObservation.classLessonSessionId,
    label: "청강 회차",
    sourceId: matchingEnrollmentObservation.observationId,
  })
  assert.equal(
    serializeRegistrationEnrollmentRows([restored])[0].classStartSourceObservationId,
    matchingEnrollmentObservation.observationId,
  )
})

test("persisted null textbook restores as an explicit already-owned choice", () => {
  assert.equal(restoreRegistrationEnrollmentDraft({
    id: "saved-null",
    classId: "eng-a",
    textbookId: null,
    status: "planned",
  }).textbookExplicitlyCleared, true)
  assert.equal(restoreRegistrationEnrollmentDraft({
    id: "saved-book",
    classId: "eng-a",
    textbookId: "book-a",
    status: "planned",
  }).textbookExplicitlyCleared, false)
  assert.equal(createRegistrationEnrollmentDraft({ clientKey: "new" }).textbookExplicitlyCleared, false)
})

test("enrollment serialization preserves only real persisted UUIDs", () => {
  const id = "11111111-1111-4111-8111-111111111111"
  const persisted = createRegistrationEnrollmentDraft({
    id,
    clientKey: "persisted",
    classId: "eng-a",
  })
  const local = createRegistrationEnrollmentDraft({
    id: "not-a-uuid",
    clientKey: "local",
    classId: "eng-b",
    sortOrder: 1,
  })
  assert.equal(serializeRegistrationEnrollmentRows([persisted])[0].id, id)
  assert.equal("id" in serializeRegistrationEnrollmentRows([local])[0], false)
})

test("saved enrollment rows merge authoritative IDs without changing local keys", () => {
  const local = [
    createRegistrationEnrollmentDraft({ clientKey: "local-1", classId: "eng-a", sortOrder: 0 }),
    createRegistrationEnrollmentDraft({ clientKey: "local-2", classId: "eng-b", sortOrder: 1 }),
  ]
  const saved = mergeSavedRegistrationEnrollmentRows(local, [
    { id: "db-2", classId: "eng-b", textbookId: null, sortOrder: 1, status: "planned" },
    { id: "db-1", classId: "eng-a", textbookId: "book-a", sortOrder: 0, status: "planned" },
  ])
  assert.deepEqual(saved.map((row) => [row.id, row.clientKey]), [
    ["db-1", "local-1"],
    ["db-2", "local-2"],
  ])
  assert.equal(saved[0].textbookId, "book-a")
})

test("enrollment blockers are row-specific and reject duplicate or cross-subject classes", () => {
  const rows = [
    createRegistrationEnrollmentDraft({ clientKey: "1", classId: "eng-a" }),
    createRegistrationEnrollmentDraft({ clientKey: "2", classId: "eng-a", sortOrder: 1 }),
    createRegistrationEnrollmentDraft({ clientKey: "3", classId: "math-a", sortOrder: 2 }),
    createRegistrationEnrollmentDraft({ clientKey: "4", classId: "", sortOrder: 3 }),
  ]
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows,
    classes: [
      { id: "eng-a", subject: "영어" },
      { id: "math-a", subject: "수학" },
    ],
  }), [
    { rowId: "2", field: "classId", message: "중복 수업" },
    { rowId: "3", field: "classId", message: "과목이 일치하지 않는 수업" },
    { rowId: "4", field: "classId", message: "수업을 선택해 주세요." },
  ])
})

test("released enrollment history does not block re-enrollment in the same class", () => {
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [
      createRegistrationEnrollmentDraft({
        id: "history",
        clientKey: "history",
        classId: "eng-a",
        status: "enrolled",
        rosterActive: false,
      }),
      createRegistrationEnrollmentDraft({ clientKey: "new", classId: "eng-a", sortOrder: 1 }),
    ],
    classes: [{ id: "eng-a", subject: "영어" }],
  }), [])
})

test("a roster-active enrolled class blocks a new draft for the same class", () => {
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [
      createRegistrationEnrollmentDraft({
        id: "active",
        clientKey: "active",
        classId: "eng-a",
        status: "enrolled",
        rosterActive: true,
      }),
      createRegistrationEnrollmentDraft({ clientKey: "new", classId: "eng-a", sortOrder: 1 }),
    ],
    classes: [{ id: "eng-a", subject: "영어" }],
  }), [
    { rowId: "new", field: "classId", message: "중복 수업" },
  ])
})

test("admission processing validates selected schedule and optional textbook per row", () => {
  const row = createRegistrationEnrollmentDraft({
    clientKey: "draft",
    classId: "eng-a",
    textbookId: "unknown-book",
    classStartDate: "2026-07-20",
    classStartSessionKey: "2026-07-20:9",
    classStartSession: "9회차",
  })
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [row],
    classes: [{ id: "eng-a", subject: "영어" }],
    availableTextbookIds: ["book-a"],
    validScheduleSessionKeysByClassId: { "eng-a": ["2026-07-20:1"] },
    requireSchedule: true,
  }), [
    { rowId: "draft", field: "textbookId", message: "선택할 수 없는 교재" },
    { rowId: "draft", field: "classStartSessionKey", message: "선택할 수 없는 수업 일정" },
  ])
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [{ ...row, textbookId: "", classStartSessionKey: "2026-07-20:1", classStartSession: "1회차" }],
    classes: [{ id: "eng-a", subject: "영어" }],
    availableTextbookIds: ["book-a"],
    validScheduleSessionKeysByClassId: { "eng-a": ["2026-07-20:1"] },
    requireSchedule: true,
  }), [])
})

test("draft enrollment permits no schedule but rejects partial or stale provided schedules", () => {
  const base = createRegistrationEnrollmentDraft({ clientKey: "draft", classId: "eng-a" })
  const input = {
    subject: "영어",
    classes: [{ id: "eng-a", subject: "영어" }],
    validScheduleSessionKeysByClassId: { "eng-a": ["2026-07-20:1"] },
    requireSchedule: false,
  }
  assert.deepEqual(getRegistrationEnrollmentBlockers({ ...input, rows: [base] }), [])
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    ...input,
    rows: [{ ...base, classStartDate: "2026-07-20" }],
  }), [{ rowId: "draft", field: "classStartSessionKey", message: "수업 시작 일정 입력을 완성해 주세요." }])
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    ...input,
    rows: [{ ...base, classStartDate: "2026-07-20", classStartSessionKey: "2026-07-20:9", classStartSession: "9회차" }],
  }), [{ rowId: "draft", field: "classStartSessionKey", message: "선택할 수 없는 수업 일정" }])
})

test("a globally valid textbook is still blocked when it is not linked to the selected class", () => {
  const row = createRegistrationEnrollmentDraft({
    clientKey: "draft",
    classId: "eng-a",
    textbookId: "book-other",
  })
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [row],
    classes: [{ id: "eng-a", subject: "영어" }],
    availableTextbookIds: ["book-a", "book-other"],
    validTextbookIdsByClassId: { "eng-a": ["book-a"] },
  }), [
    { rowId: "draft", field: "textbookId", message: "선택한 수업에 연결되지 않은 교재" },
  ])
})

test("each admission revision derives its own ordered checklist", () => {
  const incompleteChecklist = getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent: true,
    enrollments: [{ makeeduRegistered: true }, { makeeduRegistered: false }],
    batch: { status: "draft", invoiceSentAt: "", paymentConfirmedAt: "" },
  })
  assert.deepEqual(incompleteChecklist, {
    admissionNotice: true,
    makeedu: false,
    invoice: false,
    payment: false,
    complete: false,
  })
  assert.equal(
    Object.entries(incompleteChecklist).find(([, complete]) => !complete)?.[0] || null,
    "makeedu",
  )

  const completeChecklist = getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent: true,
    enrollments: [{ makeeduRegistered: true }],
    batch: { status: "completed", invoiceSentAt: "2026-07-20", paymentConfirmedAt: "2026-07-21" },
  })
  assert.deepEqual(completeChecklist, {
    admissionNotice: true,
    makeedu: true,
    invoice: true,
    payment: true,
    complete: true,
  })
  assert.equal(
    Object.entries(completeChecklist).find(([, complete]) => !complete)?.[0] || null,
    null,
  )

  assert.deepEqual(getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent: true,
    enrollments: [{ status: "canceled", makeeduRegistered: true }],
    batch: { status: "completed", invoiceSentAt: "2026-07-20", paymentConfirmedAt: "2026-07-21" },
  }), completeChecklist)
})

test("completed admission progress remains visible until a new revision is pending", async () => {
  const model = await import("../src/features/tasks/registration-track-model.js")
  assert.equal(typeof model.getRegistrationAdmissionProgressDisplay, "function")

  const completedBatch = {
    id: "completed-2",
    revisionNumber: 2,
    status: "completed",
    invoiceSentAt: "2026-07-20",
    paymentConfirmedAt: "2026-07-21",
  }
  const completedEnrollment = {
    id: "enrollment-2",
    admissionBatchId: completedBatch.id,
    status: "enrolled",
    makeeduRegistered: true,
  }
  assert.deepEqual(model.getRegistrationAdmissionProgressDisplay({
    batches: [
      { id: "completed-1", revisionNumber: 1, status: "completed" },
      completedBatch,
      { id: "canceled-3", revisionNumber: 3, status: "canceled" },
    ],
    enrollments: [completedEnrollment],
  }), {
    openBatch: null,
    displayBatch: completedBatch,
    displayEnrollments: [completedEnrollment],
  })

  assert.deepEqual(model.getRegistrationAdmissionProgressDisplay({
    batches: [completedBatch],
    enrollments: [
      completedEnrollment,
      { id: "new-draft", admissionBatchId: null, status: "planned", makeeduRegistered: false },
    ],
  }), {
    openBatch: null,
    displayBatch: null,
    displayEnrollments: [],
  })
})

test("planned enrollment cancellation never asks for a track destination", () => {
  const planned = { id: "planned", trackId: "eng", status: "planned", rosterActive: false }
  assert.deepEqual(getRegistrationEnrollmentCancellationState({
    enrollment: planned,
    enrollments: [planned],
  }), {
    requiresDestination: false,
    hasSurvivingEnrolledRows: false,
    destination: "",
  })
})

test("planned siblings do not keep the last roster-active enrollment registered", () => {
  const active = { id: "active", trackId: "eng", status: "enrolled", rosterActive: true }
  const planned = { id: "planned", trackId: "eng", status: "planned", rosterActive: false }
  assert.deepEqual(getRegistrationEnrollmentCancellationState({
    enrollment: active,
    enrollments: [active, planned],
  }), {
    requiresDestination: true,
    hasSurvivingEnrolledRows: false,
    destination: null,
  })
})

test("another roster-active enrolled row avoids destination routing", () => {
  const active = { id: "active", trackId: "eng", status: "enrolled", rosterActive: true }
  const surviving = { id: "surviving", trackId: "eng", status: "enrolled", rosterActive: true }
  assert.deepEqual(getRegistrationEnrollmentCancellationState({
    enrollment: active,
    enrollments: [active, surviving],
  }), {
    requiresDestination: false,
    hasSurvivingEnrolledRows: true,
    destination: "",
  })
})

test("released enrolled history makes a new batch an add-class revision", () => {
  assert.deepEqual(getRegistrationAdmissionBatchCancellationGroups({
    batchId: "batch-new",
    currentBatchEnrollments: [
      { id: "new-eng", trackId: "eng", admissionBatchId: "batch-new", status: "planned" },
      { id: "new-math", trackId: "math", admissionBatchId: "batch-new", status: "planned" },
    ],
    enrollments: [
      { id: "old-eng", trackId: "eng", admissionBatchId: "batch-old", status: "enrolled", rosterActive: false },
      { id: "new-eng", trackId: "eng", admissionBatchId: "batch-new", status: "planned" },
      { id: "new-math", trackId: "math", admissionBatchId: "batch-new", status: "planned" },
    ],
  }), {
    addClassTrackIds: ["eng"],
    firstAdmissionTrackIds: ["math"],
  })
})

test("stale admission selections never enable a new unselected add-class row", () => {
  assert.deepEqual(getRegistrationSelectedAdmissionEnrollmentIds({
    selectedEnrollmentIds: new Set(["old-row"]),
    enrollments: [
      { id: "new-row", status: "planned", admissionBatchId: null },
      { id: "old-row", status: "enrolled", admissionBatchId: "completed-batch" },
    ],
  }), [])
  assert.deepEqual(getRegistrationSelectedAdmissionEnrollmentIds({
    selectedEnrollmentIds: new Set(["old-row", "new-row"]),
    enrollments: [{ id: "new-row", status: "planned", admissionBatchId: null }],
  }), ["new-row"])
})

test("admission recovery delay reaches zero after exactly fifteen fake minutes", () => {
  const updatedAt = "2026-07-13T00:00:00.000Z"
  const start = Date.parse(updatedAt)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs(updatedAt, start), 15 * 60 * 1000)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs(updatedAt, start + 15 * 60 * 1000 - 1), 1)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs(updatedAt, start + 15 * 60 * 1000), 0)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs("", start), null)
})

test("admission application state follows eligible child tracks and active message truth", () => {
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [
      { id: "english", status: "enrollment_decided" },
      { id: "math", status: "level_test_scheduled" },
    ],
    enrollments: [],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
  }), {
    targetTrackIds: ["english"],
    eligible: true,
    delivered: false,
    syncNeeded: false,
    blocked: false,
    canSend: true,
  })

  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [{ id: "english", status: "registered" }],
    enrollments: [{ trackId: "english", status: "planned", admissionBatchId: null }],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "accepted",
    admissionApplicationMessageClaimActive: true,
  }), {
    targetTrackIds: ["english"],
    eligible: true,
    delivered: true,
    syncNeeded: true,
    blocked: false,
    canSend: false,
  })

  for (const status of ["pending", "unknown", "failed_hold"]) {
    const blocked = getRegistrationAdmissionApplicationState({
      tracks: [{ id: "english", status: "enrollment_decided" }],
      enrollments: [],
      admissionNoticeSent: false,
      admissionApplicationMessageStatus: status,
      admissionApplicationMessageClaimActive: true,
    })
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.canSend, false)
  }
})

test("admission application remains sendable after enrollment processing starts", () => {
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [{ id: "english", status: "enrollment_processing", workflowStatus: "payment_in_progress" }],
    enrollments: [{ trackId: "english", status: "planned", admissionBatchId: "batch-1" }],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
  }), {
    targetTrackIds: ["english"],
    eligible: true,
    delivered: false,
    syncNeeded: false,
    blocked: false,
    canSend: true,
  })
})

test("manual enrollment status and persisted planned rows make admission actionable without legacy pipeline routing", () => {
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [
      { id: "english", status: "inquiry", workflowStatus: "enrollment_requested" },
      { id: "math", status: "inquiry", workflowStatus: "consultation_completed" },
    ],
    enrollments: [
      { id: "row-english", trackId: "english", status: "planned", admissionBatchId: null },
      { id: "row-math", trackId: "math", status: "planned", admissionBatchId: null },
    ],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
  }), {
    targetTrackIds: ["english", "math"],
    eligible: true,
    delivered: false,
    syncNeeded: false,
    blocked: false,
    canSend: true,
  })
})

test("admission application targets decided and unbatched add-class tracks exactly once", () => {
  const tracks = [
    { id: "english", status: "enrollment_decided" },
    { id: "math", status: "registered" },
    { id: "science", status: "level_test_scheduled" },
  ]
  const base = {
    tracks,
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
  }

  assert.deepEqual(getRegistrationAdmissionApplicationState({
    ...base,
    enrollments: [],
  }).targetTrackIds, ["english"])
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    ...base,
    tracks: tracks.slice(1),
    enrollments: [{ trackId: "math", status: "planned", admissionBatchId: null }],
  }).targetTrackIds, ["math"])
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    ...base,
    enrollments: [
      { trackId: "math", status: "planned", admissionBatchId: null },
      { trackId: "math", status: "planned", admissionBatchId: null },
      { trackId: "missing", status: "planned", admissionBatchId: null },
      { status: "planned", admissionBatchId: null },
    ],
  }).targetTrackIds, ["english", "math"])
})

test("admission application excludes released history and batched or canceled add-class rows", () => {
  const tracks = [{ id: "english", status: "registered" }]
  for (const enrollment of [
    { trackId: "english", status: "enrolled", rosterActive: false, admissionBatchId: null },
    { trackId: "english", status: "canceled", admissionBatchId: null },
    { trackId: "english", status: "planned", admissionBatchId: "batch-1" },
    { trackId: "math", status: "planned", admissionBatchId: null },
  ]) {
    assert.equal(getRegistrationAdmissionApplicationState({
      tracks,
      enrollments: [enrollment],
      admissionNoticeSent: false,
      admissionApplicationMessageStatus: "",
      admissionApplicationMessageClaimActive: false,
    }).eligible, false)
  }
})

test("shared level-test scheduling ignores workflow status while keeping results independent", () => {
  assert.deepEqual(getEligibleSharedAppointmentTracks("level_test", [
    { id: "eng", subject: "영어", status: "inquiry" },
    { id: "math", subject: "수학", status: "inquiry" },
    { id: "waiting", subject: "수학", status: "waiting", levelTestRetakeDecision: "required" },
    { id: "closed", subject: "영어", status: "registered" },
  ]).map((track) => track.id), ["eng", "math", "waiting", "closed"])
})

test("appointment eligibility excludes an active activity elsewhere but keeps the current scheduled selection", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "waiting", levelTestRetakeDecision: "required" },
    { id: "math", subject: "수학", status: "level_test_scheduled" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "other", status: "scheduled" },
    { trackId: "math", appointmentId: "current", status: "scheduled" },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("level_test", tracks, activities, "current").map((track) => track.id),
    ["math"],
  )
})

test("a shared test can schedule any subject without an active test elsewhere", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "consultation_waiting" },
    { id: "math", subject: "수학", status: "level_test_scheduled" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "old", status: "completed", attemptNumber: 1 },
    { trackId: "math", appointmentId: "old", status: "absent", attemptNumber: 1 },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("level_test", tracks, activities, null).map((track) => track.id),
    ["eng", "math"],
  )
})

test("visit appointment eligibility ignores workflow status but excludes an active appointment elsewhere", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "consultation_waiting" },
    { id: "math", subject: "수학", status: "consultation_waiting" },
    { id: "done", subject: "영어", status: "registered" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "other", status: "scheduled" },
    { trackId: "math", appointmentId: "phone", mode: "phone", status: "waiting" },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("visit_consultation", tracks, activities, null).map((track) => track.id),
    ["math", "done"],
  )
})

test("appointment details remain editable after any activity outcome", () => {
  assert.equal(getRegistrationAppointmentEditMode([{ status: "scheduled" }, { status: "scheduled" }]), "edit")
  assert.equal(getRegistrationAppointmentEditMode([{ status: "completed" }, { status: "scheduled" }]), "edit")
  assert.equal(getRegistrationAppointmentEditMode([{ status: "completed" }, { status: "absent" }]), "edit")
})

test("a mounted appointment transition submits only still-scheduled children on the current appointment", () => {
  assert.deepEqual(getRegistrationAppointmentPayloadTrackIds(
    "replace_remaining",
    ["eng", "math"],
    [
      { id: "eng-1", trackId: "eng", appointmentId: "current", status: "in_progress" },
      { id: "math-1", trackId: "math", appointmentId: "current", status: "scheduled" },
      { id: "other-1", trackId: "other", appointmentId: "other", status: "scheduled" },
    ],
    "current",
  ), ["math"])
})

test("historical absent or canceled attempts cannot expose actions after a newer attempt exists", () => {
  assert.deepEqual(getLatestRegistrationLevelTestActivityIds([
    { id: "math-old", trackId: "math", attemptNumber: 1, status: "absent" },
    { id: "math-new", trackId: "math", attemptNumber: 2, status: "completed" },
    { id: "eng-new", trackId: "eng", attemptNumber: 1, status: "canceled" },
  ]), ["math-new", "eng-new"])
})

test("track statuses map one-to-one to the six registration tabs", () => {
  assert.equal(getRegistrationTrackViewKey("inquiry"), "inquiry")
  assert.equal(getRegistrationTrackViewKey("migration_review"), "inquiry")
  assert.equal(getRegistrationTrackViewKey("level_test_scheduled"), "level_test")
  assert.equal(getRegistrationTrackViewKey("consultation_waiting"), "consulting")
  assert.equal(getRegistrationTrackViewKey("waiting"), "waiting")
  assert.equal(getRegistrationTrackViewKey("enrollment_processing"), "enrollment")
  assert.equal(getRegistrationTrackViewKey("registered"), "closed")
})

test("tab counts count one application case even when multiple subjects match a view", () => {
  const items = buildRegistrationCaseListItems([{
    id: "case-1",
    title: "등록: 학생",
    studentName: "학생",
    registrationTracks: [
      { id: "english", taskId: "case-1", subject: "영어", status: "consultation_waiting", directorName: "", directorProfileId: null, stageEnteredAt: "", phoneReadyAt: null, migrationReviewRequired: false },
      { id: "math", taskId: "case-1", subject: "수학", status: "visit_consultation_scheduled", directorName: "", directorProfileId: null, stageEnteredAt: "", phoneReadyAt: null, migrationReviewRequired: false },
    ],
  }])
  assert.deepEqual(getRegistrationCaseTabCounts(items), { inquiry: 0, level_test: 0, consultation_requested: 1, consultation_completed: 0, observation: 0, waiting: 0, enrollment: 0, payment: 0, completed: 0 })
})

test("phone consultation completion requires an outcome and advances atomically", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "consultation_waiting",
    action: "complete_phone_consultation",
    outcome: "",
  }), ["상담 결과"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "consultation_waiting",
    action: "complete_phone_consultation",
    outcome: "enrollment",
  }), "enrollment_decided")
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "visit_consultation_scheduled",
    action: "complete_visit_consultation",
    outcome: "",
  }), ["상담 결과"])
})

test("level-test completion advances only a completed subject", () => {
  assert.equal(getRegistrationTrackNextStatus({
    status: "level_test_in_progress",
    action: "record_level_test_result",
    resultStatus: "completed",
  }), "consultation_waiting")
  assert.equal(getRegistrationTrackNextStatus({
    status: "level_test_in_progress",
    action: "record_level_test_result",
    resultStatus: "absent",
  }), "level_test_scheduled")
})

test("waiting to enrollment requires an explicit retake decision", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "waiting",
    action: "move_to_enrollment",
    retakeDecision: null,
  }), ["레벨테스트 재응시 여부"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "waiting",
    action: "schedule_level_test",
    retakeDecision: "required",
  }), "level_test_scheduled")
})

test("level-test appointment completes only after every attempt is terminal", () => {
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "completed", materialLink: "https://drive.test/english" },
    { status: "scheduled", materialLink: "" },
  ]), "scheduled")
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "completed", materialLink: "https://drive.test/english" },
    { status: "absent", materialLink: "" },
  ]), "completed")
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "canceled", materialLink: "" },
    { status: "canceled", materialLink: "" },
  ]), "canceled")
  assert.equal(canEditRegistrationAppointment([{ status: "completed" }, { status: "scheduled" }]), true)
})

test("parent stays open for tracks or admission batches still in progress", () => {
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "registered" }, { status: "waiting" }],
    batches: [{ status: "completed" }],
  }), { taskStatus: "in_progress", outcome: "" })
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "registered" }, { status: "not_registered" }],
    batches: [{ status: "completed" }],
  }), { taskStatus: "done", outcome: "partial_registration" })
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "inquiry" }],
    batches: [{ status: "draft" }],
  }), { taskStatus: "in_progress", outcome: "" })
})

test("illegal cross-stage actions are blocked instead of silently jumping stages", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "inquiry",
    action: "complete_enrollment",
  }), ["현재 단계에서 할 수 없는 작업"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "inquiry",
    action: "complete_enrollment",
  }), "inquiry")
})

test("UI action permissions mirror the database mutation matrix", () => {
  const track = { id: "eng", subject: "영어", directorProfileId: "director-1", status: "consultation_waiting" }
  const activeConsultation = { trackId: "eng", directorProfileId: "director-1", mode: "phone", status: "waiting" }
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "director-1", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: true,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "director-2", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: false,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "staff", viewerId: "staff-1", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: false,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "assistant", viewerId: "assistant-1", track, activeConsultation }), {
    canManage: false,
    canCompleteConsultation: false,
    readOnly: true,
  })
  assert.equal(getRegistrationActionPermissions({ viewerRole: "teacher", viewerId: "director-1", track, activeConsultation }).canCompleteConsultation, false)
  const scienceTrack = { ...track, id: "science", subject: "과학" }
  const scienceConsultation = { ...activeConsultation, trackId: "science" }
  assert.deepEqual(getRegistrationActionPermissions({
    viewerRole: "teacher",
    viewerId: "director-1",
    track: scienceTrack,
    activeConsultation: scienceConsultation,
  }), {
    canManage: false,
    canCompleteConsultation: false,
    readOnly: true,
  })
  assert.equal(getRegistrationActionPermissions({
    viewerRole: "teacher",
    viewerId: "director-2",
    track: scienceTrack,
    activeConsultation: scienceConsultation,
  }).canCompleteConsultation, false)
  assert.equal(getRegistrationActionPermissions({
    viewerRole: "teacher",
    viewerId: "director-1",
    track: scienceTrack,
    activeConsultation: { ...scienceConsultation, status: "completed" },
  }).canCompleteConsultation, false)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "admin", viewerId: "director-1", track }).canOpenConsultationCompletion, true)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "admin", viewerId: "director-2", track }).canOpenConsultationCompletion, false)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "staff", viewerId: "director-1", track }).canOpenConsultationCompletion, true)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "teacher", viewerId: "director-1", track }).canOpenConsultationCompletion, false)
})

test("registration case editing is limited to admin and staff roles", () => {
  assert.equal(typeof registrationTrackModel.canManageRegistrationCase, "function")
  assert.equal(registrationTrackModel.canManageRegistrationCase("admin"), true)
  assert.equal(registrationTrackModel.canManageRegistrationCase("staff"), true)
  assert.equal(registrationTrackModel.canManageRegistrationCase("teacher"), false)
  assert.equal(registrationTrackModel.canManageRegistrationCase("assistant"), false)
  assert.equal(registrationTrackModel.canManageRegistrationCase(null), false)
})

test("active consultation selection follows persisted activity instead of the legacy pipeline status", () => {
  const consultations = [
    { id: "completed", trackId: "eng", mode: "phone", status: "completed", updatedAt: "2026-08-03T01:00:00Z" },
    { id: "visit", trackId: "eng", mode: "visit", status: "scheduled", updatedAt: "2026-08-03T02:00:00Z" },
    { id: "phone", trackId: "eng", mode: "phone", status: "waiting", updatedAt: "2026-08-03T03:00:00Z" },
    { id: "other", trackId: "math", mode: "phone", status: "waiting", updatedAt: "2026-08-03T04:00:00Z" },
  ]

  assert.equal(getRegistrationActiveConsultation({
    trackId: "eng",
    consultations,
  })?.id, "phone")
  assert.equal(getRegistrationActiveConsultation({
    trackId: "missing",
    consultations,
  }), null)
})

test("consultation outcome save state distinguishes persisted, changed, and unauthorized views", () => {
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "waiting",
    draftOutcome: "waiting",
    savedNote: "기존 상담 내용",
    draftNote: "기존 상담 내용",
    canCompleteConsultation: true,
  }), {
    editable: true,
    dirty: false,
    canSave: false,
    label: "저장됨",
  })
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "waiting",
    draftOutcome: "enrollment",
    savedNote: "기존 상담 내용",
    draftNote: "기존 상담 내용",
    canCompleteConsultation: true,
  }), {
    editable: true,
    dirty: true,
    canSave: true,
    label: "상담 결과 저장",
  })
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "",
    draftOutcome: "enrollment",
    savedNote: "",
    draftNote: "",
    canCompleteConsultation: true,
  }), {
    editable: true,
    dirty: true,
    canSave: true,
    label: "상담 결과 저장",
  })
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "waiting",
    draftOutcome: "enrollment",
    savedNote: "기존 상담 내용",
    draftNote: "기존 상담 내용",
    canCompleteConsultation: false,
  }), {
    editable: false,
    dirty: true,
    canSave: false,
    label: "상담 결과 저장",
  })
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "waiting",
    draftOutcome: "waiting",
    savedNote: "기존 상담 내용",
    draftNote: "  수정한 상담 내용  ",
    canCompleteConsultation: true,
  }), {
    editable: true,
    dirty: true,
    canSave: true,
    label: "상담 결과 저장",
  })
  assert.deepEqual(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "",
    draftOutcome: "",
    savedNote: "",
    draftNote: "결과 없는 내용",
    canCompleteConsultation: true,
  }), {
    editable: true,
    dirty: true,
    canSave: false,
    label: "상담 결과 저장",
  })
})

test("a second admission batch cannot start while another batch is open", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "enrollment_decided",
    action: "start_enrollment_processing",
    enrollmentCount: 1,
    everyScheduleValid: true,
    admissionNoticeSent: true,
    hasOtherOpenBatch: true,
  }), ["진행 중인 입학 처리"])
})

test("admission processing does not depend on admission-form message delivery", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "enrollment_decided",
    action: "start_enrollment_processing",
    enrollmentCount: 1,
    everyScheduleValid: true,
    admissionNoticeSent: false,
    hasOtherOpenBatch: false,
  }), [])
})

test("identity editing ignores message history but retains active mutation locks", () => {
  const getRegistrationIdentityEditLock = registrationTrackModel.getRegistrationIdentityEditLock
  assert.equal(typeof getRegistrationIdentityEditLock, "function")

  const deliveredOnly = {
    enrollments: [],
    admissionBatches: [],
    admissionApplicationAccepted: true,
    admissionApplicationMessageClaimActive: false,
    task: { registration: { admissionNoticeSent: true } },
  }
  assert.equal(getRegistrationIdentityEditLock(deliveredOnly), false)
  assert.equal(getRegistrationIdentityEditLock({
    ...deliveredOnly,
    admissionApplicationMessageClaimActive: true,
  }), true)
  assert.equal(getRegistrationIdentityEditLock({
    ...deliveredOnly,
    admissionBatches: [{ id: "batch-1" }],
  }), true)
  assert.equal(getRegistrationIdentityEditLock({
    ...deliveredOnly,
    enrollments: [{ status: "enrolled" }],
  }), true)
})

test("canceling an add-class batch restores a track that still has enrolled classes", () => {
  assert.equal(getRegistrationTrackNextStatus({
    status: "enrollment_processing",
    action: "cancel_admission_batch",
    hasSurvivingEnrolledRows: true,
  }), "registered")
  assert.equal(getRegistrationTrackNextStatus({
    status: "enrollment_processing",
    action: "cancel_admission_batch",
    hasSurvivingEnrolledRows: false,
    destination: "waiting",
  }), "waiting")
})
