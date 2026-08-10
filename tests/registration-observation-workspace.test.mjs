import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

const root = new URL("../", import.meta.url)

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8")
}

async function loadEditorModel() {
  const source = await readSource("src/features/tasks/registration-observation-editor.tsx")
  const startMarker = "// registration-observation-editor-model:start"
  const endMarker = "// registration-observation-editor-model:end"
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1)
  assert.ok(end > start)
  const compiled = ts.transpileModule(
    `${source.slice(start + startMarker.length, end)}\nmodule.exports = { buildRegistrationObservationBookingInput, buildRegistrationObservationCancelInput, buildRegistrationObservationWithdrawalInput, canLoadRegistrationObservationWorkspace, canUseRegistrationObservationDetail, canWithdrawRegistrationObservation, completeRegistrationObservationRequestKey, executeRegistrationObservationBooking, executeRegistrationObservationCommit, getRegistrationObservationRequestKey, getRegistrationObservationWithdrawalCorrection, reconcileRegistrationObservationWithdrawalValue, shouldLockRegistrationObservationMutation };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports })
  return sandboxModule.exports
}

test("application shell places observation between waiting and registration", async () => {
  const source = await readSource("src/features/tasks/registration-application-shell.tsx")
  const match = source.match(/const SECTION_ORDER = \[([\s\S]*?)\] as const/)

  assert.ok(match, "shell must publish one exact section order")
  assert.deepEqual(
    [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]),
    ["inquiry", "levelTest", "consultation", "waiting", "observation", "registration", "admission"],
  )
  assert.match(
    source,
    /APPLICATION_UI_SECTION_ORDER\.filter\(\(section\) => section !== "observation" \|\| props\.observation !== undefined\)/,
    "runtime0 and concealed detail must keep the legacy consultation-to-registration shell",
  )
})

test("observation booking plans use dedicated RPCs and exact revision ownership", async () => {
  const {
    buildRegistrationObservationBookingInput,
    buildRegistrationObservationCancelInput,
    buildRegistrationObservationWithdrawalInput,
    canUseRegistrationObservationDetail,
    canWithdrawRegistrationObservation,
    completeRegistrationObservationRequestKey,
    executeRegistrationObservationBooking,
    executeRegistrationObservationCommit,
    getRegistrationObservationRequestKey,
    getRegistrationObservationWithdrawalCorrection,
    reconcileRegistrationObservationWithdrawalValue,
    shouldLockRegistrationObservationMutation,
  } = await loadEditorModel()

  const create = buildRegistrationObservationBookingInput({
    trackId: "track-1",
    workflowRevision: 7,
    observationId: null,
    observationRevision: null,
    appointmentNotificationRevision: null,
    classId: "class-1",
    sessionAuthority: "normalized",
    classLessonSessionId: "session-1",
    legacySessionKey: null,
    requestKey: "create-1",
  })
  assert.deepEqual({ ...create }, {
    trackId: "track-1",
    observationId: null,
    expectedWorkflowRevision: 7,
    expectedAppointmentNotificationRevision: null,
    expectedObservationRevision: null,
    classId: "class-1",
    sessionAuthority: "normalized",
    classLessonSessionId: "session-1",
    legacySessionKey: null,
    requestKey: "create-1",
  })
  assert.throws(() => buildRegistrationObservationBookingInput({
    trackId: "track-1",
    workflowRevision: 7,
    observationId: null,
    observationRevision: null,
    appointmentNotificationRevision: null,
    classId: "class-1",
    sessionAuthority: "normalized",
    classLessonSessionId: null,
    legacySessionKey: null,
    requestKey: "invalid-session-1",
  }), /registration_observation_session_identity_required/)

  const reschedule = buildRegistrationObservationBookingInput({
    trackId: "track-1",
    workflowRevision: 7,
    observationId: "observation-1",
    observationRevision: 4,
    appointmentNotificationRevision: 3,
    classId: "class-1",
    sessionAuthority: "legacy",
    classLessonSessionId: null,
    legacySessionKey: "legacy-session-2",
    requestKey: "move-1",
  })
  assert.equal(reschedule.expectedWorkflowRevision, null)
  assert.equal(reschedule.expectedAppointmentNotificationRevision, 3)
  assert.equal(reschedule.expectedObservationRevision, 4)

  assert.throws(() => buildRegistrationObservationBookingInput({
    trackId: "track-1",
    workflowRevision: 7,
    observationId: "observation-1",
    observationRevision: null,
    appointmentNotificationRevision: 3,
    classId: "class-1",
    sessionAuthority: "normalized",
    classLessonSessionId: "session-1",
    legacySessionKey: null,
    requestKey: "stale-move-1",
  }), /registration_observation_booking_revision_required/)

  assert.deepEqual({ ...buildRegistrationObservationCancelInput({
    observationId: "observation-1",
    observationRevision: 4,
    appointmentNotificationRevision: 3,
    requestKey: "cancel-1",
  }) }, {
    observationId: "observation-1",
    expectedAppointmentNotificationRevision: 3,
    expectedObservationRevision: 4,
    requestKey: "cancel-1",
  })

  assert.deepEqual({ ...buildRegistrationObservationWithdrawalInput({
    trackId: "track-1",
    workflowRevision: 8,
    exitKind: "return_to_previous",
    targetWorkflowStatus: "consultation_completed",
    reason: "일정 조정",
    requestKey: "withdraw-1",
    correction: null,
  }) }, {
    trackId: "track-1",
    expectedWorkflowRevision: 8,
    exitKind: "return_to_previous",
    targetWorkflowStatus: "consultation_completed",
    decisionObservationId: null,
    expectedDecisionObservationRevision: null,
    expectedDecisionFeedbackRevision: null,
    reason: "일정 조정",
    requestKey: "withdraw-1",
  })

  assert.deepEqual({ ...buildRegistrationObservationWithdrawalInput({
    trackId: "track-1",
    workflowRevision: 9,
    exitKind: "director_decision",
    targetWorkflowStatus: "waiting_new_class",
    reason: "재청강",
    requestKey: "correct-1",
    correction: {
      decisionKind: "re_observation",
      observationId: "observation-2",
      observationRevision: 6,
      feedbackRevision: 2,
    },
  }) }, {
    trackId: "track-1",
    expectedWorkflowRevision: 9,
    exitKind: "director_decision",
    targetWorkflowStatus: "waiting_new_class",
    decisionObservationId: "observation-2",
    expectedDecisionObservationRevision: 6,
    expectedDecisionFeedbackRevision: 2,
    reason: "재청강",
    requestKey: "correct-1",
  })

  const rpcNames = []
  await executeRegistrationObservationBooking({
    saveRegistrationObservationBooking: async () => {
      rpcNames.push("save_registration_observation_booking_v1")
      return { operation: "book" }
    },
  }, create)
  assert.deepEqual(rpcNames, ["save_registration_observation_booking_v1"])
  assert.equal(rpcNames.includes("set_registration_workflow_status_v1"), false)

  const requestKeys = new Map()
  let nextKey = 0
  const createKey = () => `request-${++nextKey}`
  assert.equal(getRegistrationObservationRequestKey(requestKeys, "book", "same-payload", createKey), "request-1")
  assert.equal(getRegistrationObservationRequestKey(requestKeys, "book", "same-payload", createKey), "request-1")
  assert.equal(getRegistrationObservationRequestKey(requestKeys, "book", "changed-payload", createKey), "request-2")
  completeRegistrationObservationRequestKey({
    cache: requestKeys,
    scope: "book",
    fingerprint: "same-payload",
    requestKey: "request-1",
    refreshError: new Error("refresh_failed"),
  })
  assert.equal(
    getRegistrationObservationRequestKey(requestKeys, "book", "same-payload", createKey),
    "request-1",
    "a refresh failure must retain the request key for a safe replay",
  )
  completeRegistrationObservationRequestKey({
    cache: requestKeys,
    scope: "book",
    fingerprint: "same-payload",
    requestKey: "request-1",
    refreshError: null,
  })
  assert.equal(
    getRegistrationObservationRequestKey(requestKeys, "book", "same-payload", createKey),
    "request-3",
    "a successful refresh must start a new key generation for booking-cancel-rebooking cycles",
  )
  assert.equal(shouldLockRegistrationObservationMutation({ changed: false }), false)
  assert.equal(shouldLockRegistrationObservationMutation({ changed: true }), true)

  let mutationCalls = 0
  const committed = await executeRegistrationObservationCommit(
    async () => {
      mutationCalls += 1
      return { operation: "book" }
    },
    async () => {
      throw new Error("refresh_failed")
    },
  )
  assert.equal(mutationCalls, 1)
  assert.deepEqual({ ...committed.result }, { operation: "book" })
  assert.match(committed.refreshError.message, /refresh_failed/)

  const reObservation = {
    observationId: "observation-1",
    decisionKind: "re_observation",
    revision: 6,
    feedbackRevision: 2,
  }
  const enrollment = {
    observationId: "observation-2",
    decisionKind: "enrollment",
    revision: 3,
    feedbackRevision: 1,
  }
  assert.deepEqual({ ...getRegistrationObservationWithdrawalCorrection({
    attempts: [
      { observationId: "observation-3", decisionKind: null, revision: 1, feedbackRevision: 0 },
      reObservation,
      enrollment,
    ],
  }) }, {
    decisionKind: "re_observation",
    observationId: "observation-1",
    observationRevision: 6,
    feedbackRevision: 2,
  })
  assert.equal(getRegistrationObservationWithdrawalCorrection({
    attempts: [enrollment, reObservation],
  }), null)

  assert.equal(reconcileRegistrationObservationWithdrawalValue({
    currentValue: "director:enrollment_requested",
    touched: false,
    returnWorkflowStatus: "consultation_completed",
  }), "return:consultation_completed")
  assert.equal(reconcileRegistrationObservationWithdrawalValue({
    currentValue: "director:waiting_new_class",
    touched: true,
    returnWorkflowStatus: "consultation_completed",
  }), "director:waiting_new_class")
  assert.equal(canUseRegistrationObservationDetail({
    activeTrackId: "track-2",
    detailTrackId: "track-1",
  }), false)
  assert.equal(canUseRegistrationObservationDetail({
    activeTrackId: "track-2",
    detailTrackId: "track-2",
  }), true)
  assert.equal(canWithdrawRegistrationObservation({
    workflowStatus: "observation_requested",
    currentObservation: null,
  }), true)
  assert.equal(canWithdrawRegistrationObservation({
    workflowStatus: "observation_requested",
    currentObservation: { appointmentStatus: "scheduled", status: "scheduled" },
  }), false, "scheduled attempts must be canceled before withdrawal")
})

test("runtime or concealed summary gates observation detail, session, and editor work to zero", async () => {
  const { canLoadRegistrationObservationWorkspace } = await loadEditorModel()
  let loads = 0
  for (const input of [
    { runtimeAvailable: false, observationSummaryVisible: true },
    { runtimeAvailable: true, observationSummaryVisible: false },
  ]) {
    if (canLoadRegistrationObservationWorkspace(input)) loads += 1
  }
  assert.equal(loads, 0)
  assert.equal(canLoadRegistrationObservationWorkspace({
    runtimeAvailable: true,
    observationSummaryVisible: true,
  }), true)
})

test("booking-only editor excludes teacher decision and provider actions", async () => {
  const [source, caseListSource] = await Promise.all([
    readSource("src/features/tasks/registration-observation-editor.tsx"),
    readSource("src/features/tasks/registration-case-list.tsx"),
  ])

  assert.match(source, /saveRegistrationObservationBooking/)
  assert.match(source, /cancelRegistrationObservation/)
  assert.match(source, /withdrawRegistrationObservation/)
  assert.doesNotMatch(source, /setRegistrationWorkflowStatus|set_registration_workflow_status_v1/)
  assert.doesNotMatch(source, /target as /)
  for (const forbidden of [
    "recordRegistrationObservationAttendance",
    "record_registration_observation_attendance_v1",
    "submitRegistrationObservationFeedback",
    "submit_registration_observation_feedback_v1",
    "correctRegistrationObservationFeedback",
    "correct_registration_observation_feedback_v1",
    "decideRegistrationObservation",
    "decide_registration_observation_v1",
  ]) assert.equal(source.includes(forbidden), false, forbidden)
  assert.doesNotMatch(source, /google.chat|webhook|solapi|send.*customer/i)
  assert.match(source, /예약 저장됨/)
  assert.match(source, /고객 안내: 미발송/)
  assert.match(source, /최신 예약 버전을 확인할 수 없습니다\./)
  assert.doesNotMatch(source, /canBook && !canceled/)
  assert.doesNotMatch(source, /setCanceled\(true\)/)
  assert.doesNotMatch(source, /function requestKey\(/)
  assert.match(source, /committedCanonicalKey/)
  assert.match(source, /저장됐지만 최신 청강 정보를 불러오지 못했습니다\./)
  assert.match(source, /setWithdrawValueTouched\(true\)/)
  assert.match(
    source,
    /const withdrawAvailable = canWithdrawRegistrationObservation\(\{\s*workflowStatus,\s*currentObservation: current,\s*\}\)/,
  )
  assert.equal(
    (caseListSource.match(/const entryAvailable = !disabled && canOpenRegistrationCaseListItem\(item\)/g) || []).length,
    2,
    "mobile and desktop entries must both remove interaction when disabled or concealed",
  )
  assert.match(caseListSource, /tabIndex=\{entryAvailable \? 0 : undefined\}/)
  assert.match(caseListSource, /onClick=\{entryAvailable \? \(\) => openRegistrationCase\(item\) : undefined\}/)
})

test("track editor mounts observation once before registration and only behind runtime availability", async () => {
  const source = await readSource("src/features/tasks/registration-track-editor.tsx")
  const shell = source.slice(source.indexOf("<RegistrationApplicationShell"))

  assert.equal((shell.match(/\bobservation=/g) || []).length, 1)
  assert.ok(shell.indexOf("observation=") < shell.indexOf("registration={registrationSection}"))
  assert.match(shell, /observation=\{canLoadRegistrationObservationWorkspace\(\{[\s\S]*?\}\) \? \(/)
  assert.match(shell, /<RegistrationObservationEditor\s+key=\{activeTrack\.id\}/)
  assert.match(source, /const canManageActiveObservation = activeTrack[\s\S]*?canManageRegistrationObservationTrack/)
  assert.match(source, /section === "observation" \? canManageActiveObservation/)
  assert.match(source, /const activeObservationDetail = canUseRegistrationObservationDetail/)
  const refresh = source.slice(
    source.indexOf("const handleObservationSaved"),
    source.indexOf("useEffect(() => {\n    onDirtyChangeRef.current", source.indexOf("const handleObservationSaved")),
  )
  assert.equal((refresh.match(/getRegistrationObservationRefreshPlan\(/g) || []).length, 2)
  assert.match(refresh, /if \(!refreshPlan\.loadManagerDetail\) \{\s*await onReload\(\)/)
  assert.match(refresh, /onReload\(refreshPlan\.preferredTrackId\)/)
  assert.match(refresh, /if \(completionPlan\.loadManagerDetail\) setObservationDetail\(nextDetail\)/)
  assert.match(source, /resolveRegistrationApplicationFocusPanelId\(\{[\s\S]*?observationFocusAvailable:[\s\S]*?isRegistrationObservationWorkflowStatus/)
  assert.match(shell, /activeTrack && activeObservationDetail[\s\S]*?detail=\{activeObservationDetail\}/)
})
