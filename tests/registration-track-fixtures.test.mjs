import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

const fixtureUrl = new URL("../src/features/tasks/registration-track-fixtures.ts", import.meta.url)
const fixtureRuntimeUrl = new URL("../src/features/tasks/registration-track-fixture-runtime.ts", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)
const serviceUrl = new URL("../src/features/tasks/registration-track-service.ts", import.meta.url)
const opsServiceUrl = new URL("../src/features/tasks/ops-task-service.ts", import.meta.url)
const notificationUrl = new URL("../src/features/tasks/registration-consultation-notification.js", import.meta.url)

async function loadTsModule(url) {
  const source = await readFile(url, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    structuredClone,
  })
  return sandboxModule.exports
}

async function loadFixtureModule() {
  return loadTsModule(fixtureUrl)
}

async function loadFixtureRuntimeModule() {
  return loadTsModule(fixtureRuntimeUrl)
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("fixture gate is exact and production always ignores the query", async () => {
  const {
    REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE,
    shouldEnableRegistrationSubjectTrackFixture,
  } = await loadFixtureRuntimeModule()

  assert.equal(REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE, "registration-subject-tracks")
  assert.equal(shouldEnableRegistrationSubjectTrackFixture("development", "registration-subject-tracks"), true)
  assert.equal(shouldEnableRegistrationSubjectTrackFixture("test", "registration-subject-tracks"), true)
  assert.equal(shouldEnableRegistrationSubjectTrackFixture("production", "registration-subject-tracks"), false)
  assert.equal(shouldEnableRegistrationSubjectTrackFixture(undefined, "registration-subject-tracks"), false)
  assert.equal(shouldEnableRegistrationSubjectTrackFixture("staging", "registration-subject-tracks"), false)
  assert.equal(shouldEnableRegistrationSubjectTrackFixture("development", "registration-subject-tracks-extra"), false)
  assert.equal(shouldEnableRegistrationSubjectTrackFixture("development", ""), false)
})

test("fixture reset is deterministic and contains the approved workflow samples", async () => {
  const { createRegistrationSubjectTrackFixtureState } = await loadFixtureModule()
  const first = createRegistrationSubjectTrackFixtureState()
  const second = createRegistrationSubjectTrackFixtureState()

  assert.deepEqual(plain(first), plain(second))
  assert.deepEqual(plain(first.samples.map((sample) => sample.name)), [
    "same-day dual level test",
    "split visit and phone consultation",
    "independent consultation and level-test stages",
    "partial registration with later batch",
    "multiple English classes",
    "enrollment decided add-button",
    "admission panel with non-enrollment sibling",
    "migration review",
  ])
  assert.deepEqual(plain(first.externalCallLedger), [])
  assert.deepEqual(Object.keys(first.receipts), [])

  const dual = first.caseDetails["fixture-task-dual-test"]
  assert.equal(dual.tracks.length, 2)
  assert.equal(dual.appointments.length, 1)
  assert.deepEqual(plain(dual.levelTests.map((attempt) => attempt.trackId).sort()), [
    "fixture-track-dual-english",
    "fixture-track-dual-math",
  ])
  assert.equal(new Set(dual.levelTests.map((attempt) => attempt.appointmentId)).size, 1)

  const split = first.caseDetails["fixture-task-split-consultation"]
  assert.deepEqual(plain(split.consultations.map((item) => [item.trackId, item.mode, item.status])), [
    ["fixture-track-split-english", "visit", "scheduled"],
    ["fixture-track-split-math", "phone", "waiting"],
  ])

  const crossStage = first.caseDetails["fixture-task-cross-stage"]
  assert.deepEqual(plain(crossStage.tracks.map((track) => [track.subject, track.status])), [
    ["영어", "consultation_waiting"],
    ["수학", "level_test_scheduled"],
  ])
  assert.equal(crossStage.consultations.some((consultation) => consultation.trackId === "fixture-track-cross-english" && consultation.mode === "phone" && consultation.status === "waiting"), true)
  assert.equal(crossStage.levelTests.some((attempt) => attempt.trackId === "fixture-track-cross-math" && attempt.status === "scheduled"), true)

  const partial = first.caseDetails["fixture-task-partial-registration"]
  assert.deepEqual(plain(partial.admissionBatches.map((batch) => [batch.revisionNumber, batch.status])), [
    [1, "completed"],
    [2, "draft"],
  ])

  const multiple = first.caseDetails["fixture-task-multiple-classes"]
  assert.deepEqual(plain(multiple.enrollments.map((row) => row.classId)), [
    "fixture-class-eng-a",
    "fixture-class-eng-special",
  ])
  assert.equal(multiple.tracks[0].status, "enrollment_decided")
  assert.equal(multiple.enrollments.every((row) => row.status === "planned" && row.admissionBatchId === null && row.studentId === null && row.rosterActive === false), true)
  assert.equal(first.caseDetails["fixture-task-enrollment-decided"].tracks[0].status, "enrollment_decided")
  const sibling = first.caseDetails["fixture-task-admission-sibling"]
  assert.equal(sibling.tracks.some((track) => track.status === "level_test_scheduled"), true)
  assert.equal(sibling.tracks.some((track) => track.status === "enrollment_processing"), true)
  assert.equal(sibling.admissionBatches.some((batch) => batch.status === "draft"), true)
  assert.equal(first.caseDetails["fixture-task-migration-review"].tracks.every((track) => track.migrationReviewRequired), true)
})

test("fixture roles cover assigned sibling directors, staff, and read-only assistant", async () => {
  const {
    createRegistrationSubjectTrackFixtureState,
    resolveRegistrationSubjectTrackFixtureViewer,
  } = await loadFixtureModule()
  const state = createRegistrationSubjectTrackFixtureState()

  assert.deepEqual(plain(resolveRegistrationSubjectTrackFixtureViewer(state, "english_admin")), {
    key: "english_admin",
    viewerId: "fixture-profile-english-director",
    viewerRole: "admin",
  })
  assert.deepEqual(plain(resolveRegistrationSubjectTrackFixtureViewer(state, "math_admin")), {
    key: "math_admin",
    viewerId: "fixture-profile-math-director",
    viewerRole: "admin",
  })
  assert.equal(resolveRegistrationSubjectTrackFixtureViewer(state, "staff").viewerRole, "staff")
  assert.equal(resolveRegistrationSubjectTrackFixtureViewer(state, "assistant").viewerRole, "assistant")
  assert.equal(resolveRegistrationSubjectTrackFixtureViewer(state, "unknown").key, "english_admin")
})

test("fixture reducer applies independent subject mutations once per request receipt", async () => {
  const {
    createRegistrationSubjectTrackFixtureState,
    reduceRegistrationSubjectTrackFixture,
  } = await loadFixtureModule()
  const initial = createRegistrationSubjectTrackFixtureState()
  const command = {
    type: "completeRegistrationLevelTestAttempt",
    requestKey: "fixture-request-complete-english",
    payload: {
      attemptId: "fixture-attempt-dual-english",
      status: "completed",
      materialLink: "https://drive.google.com/fixture/english-result",
    },
  }
  const first = reduceRegistrationSubjectTrackFixture(initial, command)
  const replay = reduceRegistrationSubjectTrackFixture(first.state, command)

  assert.equal(first.state.caseDetails["fixture-task-dual-test"].tracks.find((track) => track.subject === "영어").status, "consultation_waiting")
  assert.equal(first.state.caseDetails["fixture-task-dual-test"].tracks.find((track) => track.subject === "수학").status, "level_test_scheduled")
  assert.equal(first.state.caseDetails["fixture-task-dual-test"].levelTests.find((attempt) => attempt.trackId === "fixture-track-dual-english").materialLink, "https://drive.google.com/fixture/english-result")
  assert.deepEqual(plain(replay.result), plain(first.result))
  assert.deepEqual(plain(replay.state), plain(first.state))
  assert.equal(Object.keys(first.state.receipts).length, 1)
  assert.deepEqual(first.state.externalCallLedger, [])

  assert.throws(() => reduceRegistrationSubjectTrackFixture(first.state, {
    ...command,
    payload: { ...command.payload, attemptId: "fixture-attempt-dual-math" },
  }), /registration_subject_track_fixture_request_key_conflict/)
})

test("fixture runtime restores the previous mounted adapter and never enables unknown environments", async () => {
  const {
    executeRegistrationSubjectTrackFixtureAction,
    installRegistrationSubjectTrackFixtureRuntime,
  } = await loadFixtureRuntimeModule()
  const adapter = (label) => ({
    executeAction: async () => label,
    loadCase: async () => ({}),
    loadWorkspaceData: async () => ({}),
    loadOptionData: async () => ({}),
    loadClassDetails: async () => ({}),
  })
  const cleanupA = installRegistrationSubjectTrackFixtureRuntime("test", "registration-subject-tracks", adapter("A"))
  const cleanupB = installRegistrationSubjectTrackFixtureRuntime("test", "registration-subject-tracks", adapter("B"))
  assert.equal(await executeRegistrationSubjectTrackFixtureAction("noop", {}), "B")
  cleanupB()
  assert.equal(await executeRegistrationSubjectTrackFixtureAction("noop", {}), "A")
  cleanupA()
  assert.equal(executeRegistrationSubjectTrackFixtureAction("noop", {}), null)
})

test("fixture appointment edits and cancellations restore deselected subject stages", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  let state = createRegistrationSubjectTrackFixtureState()
  let outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "saveRegistrationSharedAppointment",
    requestKey: "fixture-edit-dual-to-english",
    payload: {
      taskId: "fixture-task-dual-test",
      appointmentId: "fixture-appointment-dual-test",
      expectedNotificationRevision: 1,
      kind: "level_test",
      scheduledAt: "2026-07-15T11:00:00+09:00",
      place: "본관 201호",
      trackIds: ["fixture-track-dual-english"],
    },
  })
  state = outcome.state
  const dual = state.caseDetails["fixture-task-dual-test"]
  assert.equal(dual.tracks.find((track) => track.subject === "영어").status, "level_test_scheduled")
  assert.equal(dual.tracks.find((track) => track.subject === "수학").status, "inquiry")
  assert.equal(dual.levelTests.find((attempt) => attempt.trackId === "fixture-track-dual-math").status, "canceled")

  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "cancelRegistrationAppointment",
    requestKey: "fixture-cancel-remaining-test",
    payload: {
      appointmentId: "fixture-appointment-dual-test",
      expectedNotificationRevision: 2,
      reason: "fixture cancel",
    },
  })
  assert.equal(outcome.state.caseDetails["fixture-task-dual-test"].tracks.find((track) => track.subject === "영어").status, "inquiry")

  state = createRegistrationSubjectTrackFixtureState()
  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "cancelRegistrationAppointment",
    requestKey: "fixture-cancel-visit",
    payload: {
      appointmentId: "fixture-appointment-split-visit",
      expectedNotificationRevision: 1,
      reason: "fixture cancel",
    },
  })
  const split = outcome.state.caseDetails["fixture-task-split-consultation"]
  assert.equal(split.tracks.find((track) => track.subject === "영어").status, "consultation_waiting")
  assert.equal(split.consultations.some((consultation) => consultation.trackId === "fixture-track-split-english" && consultation.mode === "phone" && consultation.status === "waiting"), true)
})

test("fixture replacement creates a new appointment and partial cancellation preserves completed history", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  let state = createRegistrationSubjectTrackFixtureState()
  let outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "completeRegistrationLevelTestAttempt",
    requestKey: "fixture-complete-english-before-replacement",
    payload: {
      attemptId: "fixture-attempt-dual-english",
      status: "completed",
      materialLink: "https://drive.google.com/fixture/english-result",
    },
  })
  state = outcome.state
  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "saveRegistrationSharedAppointment",
    requestKey: "fixture-replace-remaining-math",
    payload: {
      taskId: "fixture-task-dual-test",
      appointmentId: "fixture-appointment-dual-test",
      expectedNotificationRevision: 1,
      kind: "level_test",
      scheduledAt: "2026-07-22T10:00:00+09:00",
      place: "본관 201호",
      trackIds: ["fixture-track-dual-math"],
      replaceRemaining: true,
    },
  })
  const replaced = outcome.state.caseDetails["fixture-task-dual-test"]
  assert.equal(replaced.appointments.length, 2)
  assert.notEqual(outcome.result.appointmentId, "fixture-appointment-dual-test")
  assert.equal(outcome.result.notificationRevision, 1)
  assert.equal(replaced.appointments.find((appointment) => appointment.id === "fixture-appointment-dual-test").status, "completed")
  const mathAttempts = replaced.levelTests.filter((attempt) => attempt.trackId === "fixture-track-dual-math")
  assert.deepEqual(plain(mathAttempts.map((attempt) => [attempt.attemptNumber, attempt.status])), [[1, "canceled"], [2, "scheduled"]])
  assert.equal(mathAttempts[1].appointmentId, outcome.result.appointmentId)

  state = createRegistrationSubjectTrackFixtureState()
  state = reduceRegistrationSubjectTrackFixture(state, {
    type: "completeRegistrationLevelTestAttempt",
    requestKey: "fixture-complete-english-before-cancel",
    payload: {
      attemptId: "fixture-attempt-dual-english",
      status: "completed",
      materialLink: "https://drive.google.com/fixture/english-result",
    },
  }).state
  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "cancelRegistrationAppointment",
    requestKey: "fixture-cancel-partial-appointment",
    payload: {
      appointmentId: "fixture-appointment-dual-test",
      expectedNotificationRevision: 1,
      reason: "remaining subject canceled",
    },
  })
  assert.equal(outcome.state.caseDetails["fixture-task-dual-test"].appointments[0].status, "completed")
  assert.equal(outcome.state.caseDetails["fixture-task-dual-test"].tracks.find((track) => track.subject === "수학").status, "inquiry")

  state = createRegistrationSubjectTrackFixtureState()
  state = reduceRegistrationSubjectTrackFixture(state, {
    type: "completeRegistrationLevelTestAttempt",
    requestKey: "fixture-cancel-english-before-replacement",
    payload: { attemptId: "fixture-attempt-dual-english", status: "canceled", materialLink: "" },
  }).state
  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "saveRegistrationSharedAppointment",
    requestKey: "fixture-replace-after-canceled-child",
    payload: {
      taskId: "fixture-task-dual-test",
      appointmentId: "fixture-appointment-dual-test",
      expectedNotificationRevision: 1,
      kind: "level_test",
      scheduledAt: "2026-07-22T10:00:00+09:00",
      place: "본관 201호",
      trackIds: ["fixture-track-dual-math"],
      replaceRemaining: true,
    },
  })
  assert.equal(outcome.state.caseDetails["fixture-task-dual-test"].appointments.find((appointment) => appointment.id === "fixture-appointment-dual-test").status, "canceled")

  state = createRegistrationSubjectTrackFixtureState()
  state = reduceRegistrationSubjectTrackFixture(state, {
    type: "startRegistrationLevelTestAttempt",
    requestKey: "fixture-start-english-before-replacement",
    payload: { attemptId: "fixture-attempt-dual-english" },
  }).state
  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "saveRegistrationSharedAppointment",
    requestKey: "fixture-replace-with-in-progress-child",
    payload: {
      taskId: "fixture-task-dual-test",
      appointmentId: "fixture-appointment-dual-test",
      expectedNotificationRevision: 1,
      kind: "level_test",
      scheduledAt: "2026-07-22T10:00:00+09:00",
      place: "본관 201호",
      trackIds: ["fixture-track-dual-math"],
      replaceRemaining: true,
    },
  })
  assert.equal(outcome.state.caseDetails["fixture-task-dual-test"].appointments.find((appointment) => appointment.id === "fixture-appointment-dual-test").status, "scheduled")
})

test("migration review reducer consumes the UI targetStatus contract per subject", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  const outcome = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "resolveRegistrationMigrationReview",
    requestKey: "fixture-migration-targets",
    payload: {
      taskId: "fixture-task-migration-review",
      trackStates: [
        { trackId: "fixture-track-review-english", targetStatus: "waiting", waitingKind: "next_term_opening" },
        { trackId: "fixture-track-review-math", targetStatus: "not_registered" },
      ],
    },
  })
  const tracks = outcome.state.caseDetails["fixture-task-migration-review"].tracks
  assert.equal(tracks.find((track) => track.subject === "영어").status, "waiting")
  assert.equal(tracks.find((track) => track.subject === "영어").waitingKind, "next_term_opening")
  assert.equal(tracks.find((track) => track.subject === "수학").status, "not_registered")

  let attributed = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "assignRegistrationTrackDirector",
    requestKey: "fixture-migration-director",
    payload: {
      trackId: "fixture-track-review-english",
      directorProfileId: "fixture-profile-english-director",
      assignmentSource: "manual",
    },
  })
  attributed = reduceRegistrationSubjectTrackFixture(attributed.state, {
    type: "resolveRegistrationMigrationReview",
    requestKey: "fixture-migration-phone-target",
    payload: {
      taskId: "fixture-task-migration-review",
      trackStates: [
        { trackId: "fixture-track-review-english", targetStatus: "consultation_waiting" },
        { trackId: "fixture-track-review-math", targetStatus: "not_registered" },
      ],
    },
  })
  assert.equal(attributed.state.caseDetails["fixture-task-migration-review"].consultations.some((consultation) => (
    consultation.trackId === "fixture-track-review-english"
    && consultation.mode === "phone"
    && consultation.status === "waiting"
    && consultation.directorProfileId === "fixture-profile-english-director"
  )), true)
})

test("fixture reducer supports multi-row enrollment and fresh admission revisions", async () => {
  const {
    createRegistrationSubjectTrackFixtureState,
    reduceRegistrationSubjectTrackFixture,
  } = await loadFixtureModule()
  let state = createRegistrationSubjectTrackFixtureState()
  let outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "saveRegistrationEnrollmentRows",
    requestKey: "fixture-request-save-two-rows",
    payload: {
      trackId: "fixture-track-enrollment-decided-english",
      rows: [
        { classId: "fixture-class-eng-a", textbookId: "fixture-textbook-eng-a", classStartDate: "2026-07-20", classStartSessionKey: "session-1", classStartSession: "1회차", sortOrder: 0 },
        { classId: "fixture-class-eng-special", textbookId: null, classStartDate: "2026-07-21", classStartSessionKey: "session-2", classStartSession: "2회차", sortOrder: 1 },
      ],
    },
  })
  state = outcome.state
  assert.equal(outcome.result.rows.length, 2)
  assert.deepEqual(plain(outcome.result.rows.map((row) => row.classId)), ["fixture-class-eng-a", "fixture-class-eng-special"])

  outcome = reduceRegistrationSubjectTrackFixture(state, {
    type: "startRegistrationAdmissionBatch",
    requestKey: "fixture-request-batch-1",
    payload: {
      taskId: "fixture-task-enrollment-decided",
      trackIds: ["fixture-track-enrollment-decided-english"],
      enrollmentIds: outcome.result.rows.map((row) => row.id),
    },
  })
  assert.equal(outcome.result.batch.revisionNumber, 1)
  assert.equal(outcome.result.batch.status, "draft")
  assert.equal(outcome.state.externalCallLedger.length, 0)
})

test("class detail adapter returns only exact requested IDs and unsupported actions fail closed", async () => {
  const {
    createRegistrationSubjectTrackFixtureState,
    getRegistrationSubjectTrackFixtureClassDetails,
    reduceRegistrationSubjectTrackFixture,
  } = await loadFixtureModule()
  const state = createRegistrationSubjectTrackFixtureState()
  const details = getRegistrationSubjectTrackFixtureClassDetails(state, [
    "fixture-class-eng-special",
    "fixture-class-eng-special",
    "missing-class",
    "fixture-class-math-a",
  ])

  assert.deepEqual(Object.keys(details), ["fixture-class-eng-special", "fixture-class-math-a"])
  assert.equal(details["fixture-class-eng-special"].textbookIds[0], "fixture-textbook-eng-special")
  assert.throws(
    () => reduceRegistrationSubjectTrackFixture(state, {
      type: "sendGoogleChatWebhook",
      requestKey: "fixture-request-unsupported",
      payload: {},
    }),
    /registration_subject_track_fixture_unsupported_action/,
  )
  assert.deepEqual(plain(state.externalCallLedger), [])
  assert.deepEqual(Object.keys(state.receipts), [])
})

test("every fixture UI mutation is declared and produces an idempotency receipt", async () => {
  const { REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS } = await loadFixtureModule()
  assert.deepEqual(plain(REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS), [
    "syncRegistrationCaseSubjects",
    "updateRegistrationCaseCommon",
    "routeRegistrationInquiry",
    "assignRegistrationTrackDirector",
    "saveRegistrationSharedAppointment",
    "cancelRegistrationAppointment",
    "startRegistrationLevelTestAttempt",
    "completeRegistrationLevelTestAttempt",
    "closeRegistrationLevelTestTrack",
    "completeRegistrationConsultation",
    "transitionRegistrationWaiting",
    "routeRegistrationEnrollmentDecision",
    "saveRegistrationEnrollmentRows",
    "cancelRegistrationEnrollment",
    "startRegistrationAdmissionBatch",
    "setRegistrationEnrollmentMakeedu",
    "advanceRegistrationAdmissionBatch",
    "cancelRegistrationAdmissionBatch",
    "completeRegistrationAdmissionBatch",
    "resolveRegistrationMigrationReview",
    "sendRegistrationVisitNotificationTarget",
    "sendRegistrationAdmissionMessage",
    "checkRegistrationAdmissionMessage",
    "reconcileRegistrationAdmissionMessage",
    "releaseRegistrationAdmissionMessageRetry",
  ])
})

test("workspace mounts the real list/editor on the exact dev-only fixture and never offers external registration controls", async () => {
  const source = await readFile(workspaceUrl, "utf8")

  assert.match(source, /shouldEnableRegistrationSubjectTrackFixture\(process\.env\.NODE_ENV, registrationFixtureValue\)/)
  assert.match(source, /import\("\.\/registration-track-fixtures"\)/)
  assert.match(source, /fixtureModule\.createRegistrationSubjectTrackFixtureState\(\)/)
  assert.match(source, /installRegistrationSubjectTrackFixtureRuntime/)
  assert.match(source, /const initialWorkspaceData = registrationFixtureRequested\s*\? null/)
  assert.match(source, /registrationFixtureModule\.createRegistrationSubjectTrackFixtureAdapter/)
  assert.match(source, /registrationFixtureEnabled[\s\S]*?<RegistrationTrackList/)
  assert.match(source, /registrationFixtureEnabled[\s\S]*?<RegistrationTrackEditor/)
  assert.match(source, /!registrationFixtureEnabled && \(isRegistrationWorkspace \|\| isWithdrawalWorkspace \|\| isTransferWorkspace\)/)
  assert.match(source, /showToolbarCreate = !registrationFixtureEnabled/)
  assert.match(source, /resolveRegistrationSubjectTrackFixtureViewer/)
  assert.doesNotMatch(source, /NODE_ENV === "production"[\s\S]*registration-subject-tracks/)
})

test("all registration service, exact class detail, notification, and admission paths consult the in-memory adapter first", async () => {
  const [service, opsService, notification, workspace] = await Promise.all([
    readFile(serviceUrl, "utf8"),
    readFile(opsServiceUrl, "utf8"),
    readFile(notificationUrl, "utf8"),
    readFile(workspaceUrl, "utf8"),
  ])

  assert.match(service, /registration-track-fixture-runtime/)
  assert.match(service, /executeRegistrationSubjectTrackFixtureAction/)
  assert.match(service, /loadRegistrationSubjectTrackFixtureCase/)
  assert.match(opsService, /loadRegistrationSubjectTrackFixtureClassDetails/)
  assert.match(notification, /registration-track-fixture-runtime/)
  assert.match(notification, /executeRegistrationSubjectTrackFixtureAction/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("sendRegistrationAdmissionMessage"/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("checkRegistrationAdmissionMessage"/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("reconcileRegistrationAdmissionMessage"/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("releaseRegistrationAdmissionMessageRetry"/)
})
