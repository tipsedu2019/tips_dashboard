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

async function loadTsModuleWithContext(url) {
  const source = await readFile(url, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const sandboxModule = { exports: {} }
  const context = {
    module: sandboxModule,
    exports: sandboxModule.exports,
    structuredClone,
  }
  vm.runInNewContext(compiled, context)
  return { exports: sandboxModule.exports, context }
}

async function loadFixtureModule() {
  return loadTsModule(fixtureUrl)
}

async function loadFixtureRuntimeModule() {
  return loadTsModule(fixtureRuntimeUrl)
}

async function loadServiceBoundary({
  fixtureVersion = null,
  executeFixtureAction = () => null,
  databaseIntakeState = { available: false, version: 0 },
  rpcResult = { data: {}, error: null },
} = {}) {
  const source = await readFile(serviceUrl, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const calls = { databaseProbe: 0, fixtureActions: [], rpc: [] }
  const sandboxModule = { exports: {} }
  const fixtureRuntime = {
    executeRegistrationSubjectTrackFixtureAction(type, payload) {
      calls.fixtureActions.push([type, payload])
      return executeFixtureAction(type, payload)
    },
    loadRegistrationSubjectTrackFixtureCase: () => null,
    loadRegistrationSubjectTrackFixtureOptionData: () => null,
    loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion: () => fixtureVersion,
  }
  const supabase = {
    from() {
      throw new Error("unexpected fixture-first query")
    },
    rpc(name, args) {
      calls.rpc.push([name, args])
      return Promise.resolve(rpcResult)
    },
  }

  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    structuredClone,
    require(specifier) {
      if (specifier === "@/lib/supabase") return { supabase }
      if (specifier === "./registration-track-fixture-runtime") return fixtureRuntime
      if (specifier === "./registration-intake-runtime-probe") {
        return {
          probeRegistrationIntakeWorkflowRuntime() {
            calls.databaseProbe += 1
            return Promise.resolve(databaseIntakeState)
          },
          resetRegistrationIntakeWorkflowRuntimeProbe() {},
        }
      }
      if (specifier === "./registration-runtime-probe") {
        return {
          probeRegistrationSubjectTrackRuntime: async () => ({ mode: "ready", version: 1 }),
          invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure(error) { throw error },
        }
      }
      throw new Error(`unexpected require: ${specifier}`)
    },
  })
  return { service: sandboxModule.exports, calls }
}

function initialWorkflowInput(overrides = {}) {
  return {
    studentName: "신규학생",
    schoolGrade: "고1",
    schoolName: "중앙고",
    parentPhone: "01012345678",
    studentPhone: "01087654321",
    campus: "본관",
    inquiryAt: "2026-07-13T08:30:00+09:00",
    subjects: ["수학", "영어"],
    requestNote: "첫 문의",
    priority: "high",
    subjectPlans: { 수학: "direct_phone", 영어: "level_test" },
    levelTestAppointment: {
      scheduledAt: "2026-07-14T10:00:00+09:00",
      place: "본관 201호",
      subjects: ["영어"],
    },
    visitAppointment: null,
    directorOverrides: {},
    requestKey: "fixture-intake-create",
    ...overrides,
  }
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

test("fixture samples expose canonical phone readiness and clear it for visit rows", async () => {
  const { createRegistrationSubjectTrackFixtureState } = await loadFixtureModule()
  const state = createRegistrationSubjectTrackFixtureState()

  for (const detail of Object.values(state.caseDetails)) {
    for (const consultation of detail.consultations) {
      assert.equal(Object.hasOwn(consultation, "readyAt"), true)
      assert.equal(Object.hasOwn(consultation, "readySource"), true)
      if (consultation.mode === "visit") {
        assert.equal(consultation.readyAt, null)
        assert.equal(consultation.readySource, null)
      }
    }
  }

  const split = state.caseDetails["fixture-task-split-consultation"]
  const splitPhone = split.consultations.find((item) => item.mode === "phone")
  const splitTrack = split.tracks.find((item) => item.id === splitPhone.trackId)
  assert.deepEqual([splitPhone.readyAt, splitPhone.readySource], ["2026-07-10T09:00:00+09:00", "inquiry"])
  assert.deepEqual([splitTrack.phoneReadyAt, splitTrack.phoneReadySource], [splitPhone.readyAt, splitPhone.readySource])

  const cross = state.caseDetails["fixture-task-cross-stage"]
  const crossPhone = cross.consultations.find((item) => item.mode === "phone")
  const crossTrack = cross.tracks.find((item) => item.id === crossPhone.trackId)
  assert.deepEqual([crossPhone.readyAt, crossPhone.readySource], ["2026-07-09T09:00:00+09:00", "inquiry"])
  assert.deepEqual([crossTrack.phoneReadyAt, crossTrack.phoneReadySource], [crossPhone.readyAt, crossPhone.readySource])
})

test("fixture phone writers project their canonical source and visit scheduling clears the summary", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()

  let routed = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "routeRegistrationInquiry",
    requestKey: "fixture-readiness-inquiry",
    payload: {
      trackId: "fixture-track-enrollment-decided-english",
      destination: "consultation_waiting",
      waitingKind: "",
    },
  })
  let detail = routed.state.caseDetails["fixture-task-enrollment-decided"]
  let phone = detail.consultations.find((item) => item.mode === "phone" && item.status === "waiting")
  assert.deepEqual([phone.readyAt, phone.readySource], [detail.task.registration.inquiryAt, "inquiry"])
  assert.deepEqual([detail.tracks[0].phoneReadyAt, detail.tracks[0].phoneReadySource], [phone.readyAt, phone.readySource])

  const completed = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "completeRegistrationLevelTestAttempt",
    requestKey: "fixture-readiness-level-test",
    payload: { attemptId: "fixture-attempt-dual-english", status: "completed", materialLink: "" },
  })
  detail = completed.state.caseDetails["fixture-task-dual-test"]
  phone = detail.consultations.find((item) => item.trackId === "fixture-track-dual-english" && item.status === "waiting")
  assert.deepEqual([phone.readyAt, phone.readySource], ["2026-07-13T09:00:00+09:00", "level_test_completion"])
  assert.deepEqual([detail.tracks[0].phoneReadyAt, detail.tracks[0].phoneReadySource], [phone.readyAt, phone.readySource])

  const scheduled = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "saveRegistrationSharedAppointment",
    requestKey: "fixture-readiness-visit",
    payload: {
      taskId: "fixture-task-cross-stage",
      appointmentId: null,
      expectedNotificationRevision: null,
      kind: "visit_consultation",
      scheduledAt: "2026-07-20T10:00:00+09:00",
      place: "상담실 2",
      trackIds: ["fixture-track-cross-english"],
      replaceRemaining: false,
    },
  })
  detail = scheduled.state.caseDetails["fixture-task-cross-stage"]
  const scheduledTrack = detail.tracks.find((item) => item.id === "fixture-track-cross-english")
  assert.deepEqual([scheduledTrack.phoneReadyAt, scheduledTrack.phoneReadySource], [null, null])

  const reopened = reduceRegistrationSubjectTrackFixture(scheduled.state, {
    type: "cancelRegistrationAppointment",
    requestKey: "fixture-readiness-visit-reopened",
    payload: {
      appointmentId: scheduled.result.appointmentId,
      expectedNotificationRevision: scheduled.result.notificationRevision,
      reason: "일정 취소",
    },
  })
  detail = reopened.state.caseDetails["fixture-task-cross-stage"]
  phone = detail.consultations.find((item) => item.trackId === "fixture-track-cross-english" && item.mode === "phone" && item.status === "waiting")
  assert.deepEqual([phone.readyAt, phone.readySource], ["2026-07-13T09:00:00+09:00", "visit_reopened"])
  assert.deepEqual([
    detail.tracks.find((item) => item.id === "fixture-track-cross-english").phoneReadyAt,
    detail.tracks.find((item) => item.id === "fixture-track-cross-english").phoneReadySource,
  ], [phone.readyAt, phone.readySource])

  let migration = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "assignRegistrationTrackDirector",
    requestKey: "fixture-readiness-migration-director",
    payload: {
      trackId: "fixture-track-review-english",
      directorProfileId: "fixture-profile-english-director",
      assignmentSource: "manual",
    },
  })
  migration = reduceRegistrationSubjectTrackFixture(migration.state, {
    type: "resolveRegistrationMigrationReview",
    requestKey: "fixture-readiness-migration",
    payload: {
      taskId: "fixture-task-migration-review",
      trackStates: [
        { trackId: "fixture-track-review-english", targetStatus: "consultation_waiting" },
        { trackId: "fixture-track-review-math", targetStatus: "not_registered" },
      ],
    },
  })
  detail = migration.state.caseDetails["fixture-task-migration-review"]
  phone = detail.consultations.find((item) => item.trackId === "fixture-track-review-english" && item.status === "waiting")
  assert.deepEqual([phone.readyAt, phone.readySource], ["2026-07-13T09:00:00+09:00", "migration"])
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

test("fixture runtime preserves the active adapter's exact numeric intake version", async () => {
  const {
    installRegistrationSubjectTrackFixtureRuntime,
    loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion,
  } = await loadFixtureRuntimeModule()
  const adapter = {
    intakeWorkflowRuntimeVersion: 1,
    executeAction: async () => ({}),
    loadCase: async () => ({}),
    loadWorkspaceData: async () => ({}),
    loadOptionData: async () => ({}),
    loadClassDetails: async () => ({}),
  }

  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), null)
  const ignored = installRegistrationSubjectTrackFixtureRuntime("production", "registration-subject-tracks", adapter)
  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), null)
  ignored()

  const cleanupA = installRegistrationSubjectTrackFixtureRuntime("test", "registration-subject-tracks", adapter)
  const cleanupB = installRegistrationSubjectTrackFixtureRuntime("test", "registration-subject-tracks", { ...adapter })
  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), 1)
  cleanupA()
  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), 1)
  cleanupB()
  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), null)

  const cleanupWrongVersion = installRegistrationSubjectTrackFixtureRuntime(
    "test",
    "registration-subject-tracks",
    { ...adapter, intakeWorkflowRuntimeVersion: 0 },
  )
  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), 0)
  cleanupWrongVersion()
  assert.equal(loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(), null)
})

test("fixture runtime exposes a dev-only replay bridge and removes it on cleanup", async () => {
  const fixture = await loadFixtureModule()
  const { exports: runtime, context } = await loadTsModuleWithContext(fixtureRuntimeUrl)
  let state = fixture.createRegistrationSubjectTrackFixtureState()
  const adapter = fixture.createRegistrationSubjectTrackFixtureAdapter({
    getState: () => state,
    replaceState: (next) => { state = next },
  })
  const input = initialWorkflowInput({
    subjects: ["영어", "수학"],
    subjectPlans: { 영어: "direct_phone", 수학: "visit" },
    levelTestAppointment: null,
    visitAppointment: {
      scheduledAt: "2026-07-20T10:00:00+09:00",
      place: "상담실 2",
      subjects: ["수학"],
    },
    directorOverrides: {
      영어: "fixture-profile-english-director",
      수학: "fixture-profile-math-director",
    },
    requestKey: "fixture-browser-replay",
  })

  assert.equal(runtime.REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL, "__TIPS_REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG__")
  const ignored = runtime.installRegistrationSubjectTrackFixtureRuntime(
    "production",
    "registration-subject-tracks",
    adapter,
  )
  assert.equal(context[runtime.REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL], undefined)
  ignored()

  const cleanup = runtime.installRegistrationSubjectTrackFixtureRuntime(
    "test",
    "registration-subject-tracks",
    adapter,
  )
  const bridge = context[runtime.REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL]
  assert.equal(typeof bridge?.snapshot, "function")
  assert.equal(typeof bridge?.replayLastCreate, "function")
  assert.equal(plain(bridge.snapshot()).lastCreate, null)

  const originalResult = await adapter.executeAction("createRegistrationCaseWithInitialWorkflow", input)
  await adapter.executeAction("sendRegistrationVisitNotificationTarget", originalResult.notificationTargets[0])
  const before = plain(bridge.snapshot())
  assert.equal(before.lastCreate.command.requestKey, input.requestKey)
  assert.deepEqual(before.lastCreate.command.payload, plain(input))
  assert.deepEqual(before.lastCreate.result, plain(originalResult))
  assert.equal(before.counts.cases, 9)
  assert.equal(before.counts.tracks, 16)
  assert.equal(before.counts.appointments, 5)
  assert.equal(before.counts.externalCalls, 0)
  assert.equal(before.counts.notificationReceipts, 1)

  const replay = plain(await bridge.replayLastCreate())
  const after = plain(bridge.snapshot())
  assert.equal(replay.requestKey, input.requestKey)
  assert.deepEqual(replay.originalResult, replay.replayResult)
  assert.deepEqual(replay.beforeCounts, replay.afterCounts)
  assert.deepEqual(after.counts, before.counts)
  assert.deepEqual(after.lastCreate.command, before.lastCreate.command)

  cleanup()
  assert.equal(context[runtime.REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL], undefined)
})

test("public intake probe and create use the fixture before any database path", async () => {
  const fixtureResponse = {
    taskId: "fixture-task-created",
    commonRevision: 1,
    subjects: ["영어"],
    tracks: [],
    appointments: [],
    notificationTargets: [],
  }
  const { service, calls } = await loadServiceBoundary({
    fixtureVersion: 1,
    executeFixtureAction: (type) => type === "createRegistrationCaseWithInitialWorkflow"
      ? Promise.resolve(fixtureResponse)
      : null,
  })

  assert.deepEqual(plain(await service.probeRegistrationIntakeWorkflowRuntime()), {
    available: true,
    version: 1,
  })
  assert.equal(calls.databaseProbe, 0)

  const input = initialWorkflowInput({ subjects: ["영어"], subjectPlans: { 영어: "inquiry" }, levelTestAppointment: null })
  assert.strictEqual(await service.createRegistrationCaseWithInitialWorkflow(input), fixtureResponse)
  assert.deepEqual(calls.fixtureActions.map(([type]) => type), ["createRegistrationCaseWithInitialWorkflow"])
  assert.equal(calls.rpc.length, 0)

  const fallback = await loadServiceBoundary({
    databaseIntakeState: { available: true, version: 1 },
    rpcResult: { data: fixtureResponse, error: null },
  })
  assert.deepEqual(plain(await fallback.service.probeRegistrationIntakeWorkflowRuntime()), {
    available: true,
    version: 1,
  })
  assert.equal(fallback.calls.databaseProbe, 1)
  assert.deepEqual(
    plain(await fallback.service.createRegistrationCaseWithInitialWorkflow(input)),
    fixtureResponse,
  )
  assert.deepEqual(fallback.calls.fixtureActions.map(([type]) => type), ["createRegistrationCaseWithInitialWorkflow"])
  assert.equal(fallback.calls.rpc[0][0], "create_registration_case_with_initial_workflow_v1")
})

test("a wrong fixture intake version remains observable while subject runtime stays ready", async () => {
  const { service, calls } = await loadServiceBoundary({ fixtureVersion: 2 })

  assert.deepEqual(plain(await service.probeRegistrationSubjectTrackRuntime()), {
    mode: "ready",
    version: 1,
  })
  assert.deepEqual(plain(await service.probeRegistrationIntakeWorkflowRuntime()), {
    available: true,
    version: 2,
  })
  assert.equal(calls.databaseProbe, 0)
  await assert.rejects(
    service.createRegistrationCaseWithInitialWorkflow(initialWorkflowInput()),
    /registration_intake_runtime_mismatch/,
  )
  assert.equal(calls.rpc.length, 0)
})

test("a thrown fixture create error propagates and never falls through to Supabase", async () => {
  const fixtureError = new Error("registration_initial_subject_plan_invalid")
  const { service, calls } = await loadServiceBoundary({
    fixtureVersion: 1,
    executeFixtureAction() { throw fixtureError },
  })

  assert.throws(
    () => service.createRegistrationCaseWithInitialWorkflow(initialWorkflowInput()),
    (error) => error === fixtureError,
  )
  assert.equal(calls.rpc.length, 0)
})

test("fixture atomic create materializes mixed subject paths and exact canonical events once", async () => {
  const {
    createRegistrationSubjectTrackFixtureState,
    reduceRegistrationSubjectTrackFixture,
  } = await loadFixtureModule()
  const initial = createRegistrationSubjectTrackFixtureState()
  const input = initialWorkflowInput({ campus: "별관" })
  const outcome = reduceRegistrationSubjectTrackFixture(initial, {
    type: "createRegistrationCaseWithInitialWorkflow",
    requestKey: input.requestKey,
    payload: input,
  })
  const result = outcome.result
  const detail = outcome.state.caseDetails[result.taskId]
  const [english, math] = detail.tracks
  const levelTest = detail.levelTests[0]
  const phone = detail.consultations[0]

  assert.deepEqual(plain(result.subjects), ["영어", "수학"])
  assert.deepEqual(plain(detail.tracks.map((item) => [item.subject, item.status])), [
    ["영어", "level_test_scheduled"],
    ["수학", "consultation_waiting"],
  ])
  assert.equal(detail.appointments.length, 1)
  assert.equal(detail.appointments[0].kind, "level_test")
  assert.equal(detail.levelTests.length, 1)
  assert.equal(levelTest.trackId, english.id)
  assert.equal(levelTest.appointmentId, detail.appointments[0].id)
  assert.equal(detail.consultations.length, 1)
  assert.equal(phone.trackId, math.id)
  assert.deepEqual([phone.mode, phone.status, phone.readyAt, phone.readySource], [
    "phone", "waiting", input.inquiryAt, "inquiry",
  ])
  assert.deepEqual([math.phoneReadyAt, math.phoneReadySource], [input.inquiryAt, "inquiry"])
  assert.deepEqual([english.phoneReadyAt, english.phoneReadySource], [null, null])
  assert.equal(outcome.state.workspaceData.tasks.filter((task) => task.id === result.taskId).length, 1)
  assert.equal(outcome.state.caseDetails[result.taskId].task.id, result.taskId)
  assert.equal(detail.task.campus, input.campus)
  assert.equal(detail.task.status, "in_progress")
  assert.equal(detail.task.registration.pipelineStatus, "1. 레벨테스트 예약")
  assert.deepEqual(
    [detail.task.assigneeId, detail.task.assigneeLabel, detail.task.assigneeTeam],
    ["", "", ""],
  )
  assert.equal(detail.task.secondaryAssigneeId, english.directorProfileId)
  assert.equal(detail.task.registration.counselor, english.directorName)
  assert.equal(result.commonRevision, 1)
  assert.equal(result.appointments.length, 1)
  assert.deepEqual(plain(result.notificationTargets), [])

  const parentEvent = detail.events.find((event) => event.eventType === "registration_case_created")
  assert.deepEqual(plain(parentEvent.metadata), {
    version: 1,
    actorId: "fixture-profile-staff",
    subjects: ["영어", "수학"],
    occurredAt: "2026-07-13T09:00:00+09:00",
  })
  const levelEvent = detail.events.find((event) => event.trackId === english.id)
  assert.deepEqual(plain({
    eventType: levelEvent.eventType,
    source: levelEvent.source,
    destination: levelEvent.destination,
    metadata: levelEvent.metadata,
  }), {
    eventType: "level_test_scheduled",
    source: "inquiry",
    destination: "level_test_scheduled",
    metadata: {
      appointmentId: detail.appointments[0].id,
      notificationRevision: 1,
      kind: "level_test",
      scheduledAt: input.levelTestAppointment.scheduledAt,
      place: input.levelTestAppointment.place,
      activityId: levelTest.id,
      attemptNumber: 1,
      activeTrackIds: [english.id],
      canceledTrackIds: [],
      changeKind: "created",
    },
  })
  const phoneEvent = detail.events.find((event) => event.trackId === math.id)
  assert.deepEqual(plain({ eventType: phoneEvent.eventType, source: phoneEvent.source, destination: phoneEvent.destination, metadata: phoneEvent.metadata }), {
    eventType: "inquiry_routed",
    source: "inquiry",
    destination: "consultation_waiting",
    metadata: { consultationId: phone.id, initialAction: "direct_phone" },
  })
  assert.equal(Object.keys(outcome.state.receipts).length, 1)
  assert.deepEqual(plain(outcome.state.externalCallLedger), [])
})

test("fixture atomic create recomputes the inquiry-only parent projection", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  const input = initialWorkflowInput({
    subjectPlans: { 수학: "inquiry", 영어: "inquiry" },
    levelTestAppointment: null,
  })
  const { state, result } = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "createRegistrationCaseWithInitialWorkflow",
    requestKey: input.requestKey,
    payload: input,
  })
  const detail = state.caseDetails[result.taskId]
  const english = detail.tracks[0]

  assert.equal(detail.task.status, "requested")
  assert.equal(detail.task.registration.pipelineStatus, "0. 등록 문의")
  assert.equal(detail.task.secondaryAssigneeId, english.directorProfileId)
  assert.equal(detail.task.secondaryAssigneeLabel, english.directorName)
  assert.equal(detail.task.registration.counselor, english.directorName)
})

test("fixture atomic create shares one level-test appointment across two attempts", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  const input = initialWorkflowInput({
    subjectPlans: { 영어: "level_test", 수학: "level_test" },
    levelTestAppointment: {
      scheduledAt: "2026-07-14T10:00:00+09:00",
      place: "본관 201호",
      subjects: ["수학", "영어"],
    },
  })
  const { state, result } = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "createRegistrationCaseWithInitialWorkflow",
    requestKey: input.requestKey,
    payload: input,
  })
  const detail = state.caseDetails[result.taskId]

  assert.equal(detail.appointments.length, 1)
  assert.equal(detail.levelTests.length, 2)
  assert.equal(new Set(detail.levelTests.map((attempt) => attempt.appointmentId)).size, 1)
  assert.deepEqual(plain(detail.levelTests.map((attempt) => attempt.trackId).sort()), plain(detail.tracks.map((track) => track.id).sort()))
  assert.deepEqual(plain(result.notificationTargets), [])
  assert.deepEqual(plain(state.externalCallLedger), [])
})

test("fixture atomic create shares one visit appointment and one notification target", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  const input = initialWorkflowInput({
    subjectPlans: { 영어: "visit", 수학: "visit" },
    levelTestAppointment: null,
    visitAppointment: {
      scheduledAt: "2026-07-15T15:00:00+09:00",
      place: "상담실 1",
      subjects: ["영어", "수학"],
    },
  })
  const { state, result } = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "createRegistrationCaseWithInitialWorkflow",
    requestKey: input.requestKey,
    payload: input,
  })
  const detail = state.caseDetails[result.taskId]

  assert.equal(detail.appointments.length, 1)
  assert.equal(detail.appointments[0].kind, "visit_consultation")
  assert.equal(detail.consultations.length, 2)
  assert.equal(new Set(detail.consultations.map((item) => item.appointmentId)).size, 1)
  assert.equal(detail.consultations.every((item) => item.mode === "visit" && item.readyAt === null && item.readySource === null), true)
  assert.deepEqual(plain(result.notificationTargets), [{ appointmentId: detail.appointments[0].id, notificationRevision: 1 }])
  assert.equal(detail.events.filter((event) => event.eventType === "visit_scheduled").length, 2)
  assert.deepEqual(plain(state.externalCallLedger), [])
})

test("fixture receipt records English direct phone plus Mathematics visit exactly", async () => {
  const { createRegistrationSubjectTrackFixtureState, reduceRegistrationSubjectTrackFixture } = await loadFixtureModule()
  const input = initialWorkflowInput({
    subjects: ["영어", "수학"],
    subjectPlans: { 영어: "direct_phone", 수학: "visit" },
    levelTestAppointment: null,
    visitAppointment: {
      scheduledAt: "2026-07-20T10:00:00+09:00",
      place: "상담실 2",
      subjects: ["수학"],
    },
    directorOverrides: {
      영어: "fixture-profile-english-director",
      수학: "fixture-profile-math-director",
    },
    requestKey: "fixture-direct-phone-visit",
  })
  const outcome = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), {
    type: "createRegistrationCaseWithInitialWorkflow",
    requestKey: input.requestKey,
    payload: input,
  })
  const detail = outcome.state.caseDetails[outcome.result.taskId]
  const english = detail.tracks.find((track) => track.subject === "영어")
  const math = detail.tracks.find((track) => track.subject === "수학")

  assert.deepEqual(plain([english.directorProfileId, math.directorProfileId]), [
    "fixture-profile-english-director",
    "fixture-profile-math-director",
  ])
  assert.equal(detail.appointments.length, 1)
  assert.equal(detail.appointments[0].kind, "visit_consultation")
  assert.deepEqual(plain(detail.consultations.map((item) => [item.trackId, item.mode, item.appointmentId])), [
    [english.id, "phone", null],
    [math.id, "visit", detail.appointments[0].id],
  ])
  assert.equal(detail.levelTests.length, 0)
  assert.equal(detail.consultations.some((item) => "materialLink" in item), false)
  assert.deepEqual(plain(outcome.receipt.result), plain(outcome.result))
  assert.equal(outcome.receipt.requestKey, input.requestKey)
})

test("fixture atomic create replays unchanged, conflicts on changed fingerprints, and rolls back failures", async () => {
  const {
    createRegistrationSubjectTrackFixtureAdapter,
    createRegistrationSubjectTrackFixtureState,
    reduceRegistrationSubjectTrackFixture,
  } = await loadFixtureModule()
  const input = initialWorkflowInput()
  const command = { type: "createRegistrationCaseWithInitialWorkflow", requestKey: input.requestKey, payload: input }
  const first = reduceRegistrationSubjectTrackFixture(createRegistrationSubjectTrackFixtureState(), command)
  const replay = reduceRegistrationSubjectTrackFixture(first.state, command)

  assert.strictEqual(replay.state, first.state)
  assert.deepEqual(plain(replay.result), plain(first.result))
  assert.equal(Object.keys(replay.state.receipts).length, 1)
  first.result.tracks[0].status = "not_registered"
  assert.notEqual(reduceRegistrationSubjectTrackFixture(first.state, command).result.tracks[0].status, "not_registered")
  assert.throws(
    () => reduceRegistrationSubjectTrackFixture(first.state, {
      ...command,
      payload: { ...input, requestNote: "changed" },
    }),
    /registration_subject_track_fixture_request_key_conflict/,
  )

  const invalidInitial = createRegistrationSubjectTrackFixtureState()
  const invalidSnapshot = plain(invalidInitial)
  const invalidInput = initialWorkflowInput({
    levelTestAppointment: {
      scheduledAt: "2026-07-14T10:00:00+09:00",
      place: "본관 201호",
      subjects: ["수학"],
    },
  })
  assert.throws(
    () => reduceRegistrationSubjectTrackFixture(invalidInitial, {
      type: "createRegistrationCaseWithInitialWorkflow",
      requestKey: invalidInput.requestKey,
      payload: invalidInput,
    }),
    /registration_initial_appointment_membership_invalid/,
  )
  assert.deepEqual(plain(invalidInitial), invalidSnapshot)

  const invalidOverride = createRegistrationSubjectTrackFixtureState()
  const invalidOverrideSnapshot = plain(invalidOverride)
  const invalidOverrideInput = initialWorkflowInput({
    directorOverrides: { 영어: "fixture-profile-missing-director" },
  })
  assert.throws(
    () => reduceRegistrationSubjectTrackFixture(invalidOverride, {
      type: "createRegistrationCaseWithInitialWorkflow",
      requestKey: invalidOverrideInput.requestKey,
      payload: invalidOverrideInput,
    }),
    /registration_director_override_invalid/,
  )
  assert.deepEqual(plain(invalidOverride), invalidOverrideSnapshot)

  const noDirector = createRegistrationSubjectTrackFixtureState()
  noDirector.optionData.teachers = noDirector.optionData.teachers.filter((teacher) => !teacher.subjects.includes("수학"))
  const noDirectorSnapshot = plain(noDirector)
  assert.throws(
    () => reduceRegistrationSubjectTrackFixture(noDirector, command),
    /registration_director_required/,
  )
  assert.deepEqual(plain(noDirector), noDirectorSnapshot)

  let runtimeState = createRegistrationSubjectTrackFixtureState()
  const runtimeSnapshot = plain(runtimeState)
  const adapter = createRegistrationSubjectTrackFixtureAdapter({
    getState: () => runtimeState,
    replaceState: (next) => { runtimeState = next },
  })
  assert.throws(
    () => adapter.executeAction("createRegistrationCaseWithInitialWorkflow", invalidInput),
    /registration_initial_appointment_membership_invalid/,
  )
  assert.deepEqual(plain(runtimeState), runtimeSnapshot)
  assert.deepEqual(plain(runtimeState.externalCallLedger), [])
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
    "createRegistrationCaseWithInitialWorkflow",
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

test("workspace mounts the real list/editor and exposes create only to fixture management roles", async () => {
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
  assert.match(source, /showToolbarCreate = \(!registrationFixtureEnabled \|\| canManageRegistrationWorkflow\)/)
  assert.match(source, /canManageRegistrationWorkflow = registrationFixtureEnabled[\s\S]*?\["admin", "staff"\]\.includes/)
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
  assert.match(service, /loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion/)
  assert.match(service, /executeRegistrationSubjectTrackFixtureAction<RegistrationCaseCreateWithInitialWorkflowResponse>\(\s*"createRegistrationCaseWithInitialWorkflow"/)
  assert.match(service, /loadRegistrationSubjectTrackFixtureCase/)
  assert.match(opsService, /loadRegistrationSubjectTrackFixtureClassDetails/)
  assert.match(notification, /registration-track-fixture-runtime/)
  assert.match(notification, /executeRegistrationSubjectTrackFixtureAction/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("sendRegistrationAdmissionMessage"/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("checkRegistrationAdmissionMessage"/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("reconcileRegistrationAdmissionMessage"/)
  assert.match(workspace, /executeRegistrationSubjectTrackFixtureAction\("releaseRegistrationAdmissionMessageRetry"/)
})
