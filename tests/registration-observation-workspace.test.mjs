import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { createElement, forwardRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const root = new URL("../", import.meta.url)
const require = createRequire(import.meta.url)

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
    `${source.slice(start + startMarker.length, end)}\nmodule.exports = {
      buildRegistrationObservationBookingInput,
      buildRegistrationObservationCancelInput,
      buildRegistrationObservationWithdrawalInput,
      canLoadRegistrationObservationWorkspace,
      canUseRegistrationObservationDetail,
      canWithdrawRegistrationObservation,
      completeRegistrationObservationRequestKey,
      executeRegistrationObservationBooking,
      executeRegistrationObservationCommit,
      getRegistrationObservationRequestKey,
      getRegistrationObservationWithdrawalCorrection,
      getRegistrationObservationEditorAttemptPlan:
        typeof getRegistrationObservationEditorAttemptPlan === "function"
          ? getRegistrationObservationEditorAttemptPlan
          : undefined,
      getRegistrationObservationDisplayStatusLabel:
        typeof getRegistrationObservationDisplayStatusLabel === "function"
          ? getRegistrationObservationDisplayStatusLabel
          : undefined,
      reconcileRegistrationObservationWithdrawalValue,
      shouldLockRegistrationObservationMutation,
      executeRegistrationObservationWithdrawal:
        typeof executeRegistrationObservationWithdrawal === "function"
          ? executeRegistrationObservationWithdrawal
          : undefined,
      getRegistrationObservationDialogClosePlan:
        typeof getRegistrationObservationDialogClosePlan === "function"
          ? getRegistrationObservationDialogClosePlan
          : undefined,
      getRegistrationObservationUiErrorMessage:
        typeof getRegistrationObservationUiErrorMessage === "function"
          ? getRegistrationObservationUiErrorMessage
          : undefined,
      getRegistrationObservationWithdrawalSubmitState:
        typeof getRegistrationObservationWithdrawalSubmitState === "function"
          ? getRegistrationObservationWithdrawalSubmitState
          : undefined,
      restoreRegistrationObservationDialogTriggerFocus:
        typeof restoreRegistrationObservationDialogTriggerFocus === "function"
          ? restoreRegistrationObservationDialogTriggerFocus
          : undefined,
    };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports })
  return sandboxModule.exports
}

async function loadMountedObservationEditor() {
  const fileName = new URL("src/features/tasks/registration-observation-editor.tsx", root)
  const source = await readFile(fileName, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileName.pathname,
  }).outputText
  const Button = forwardRef(function MountedObservationButton({ children, ...props }, ref) {
    return createElement("button", { ...props, ref }, children)
  })
  const Dialog = ({ open, children }) => open ? createElement("div", null, children) : null
  const Wrapper = ({ children, ...props }) => createElement("div", props, children)
  const DialogClose = ({ children }) => children
  const Input = (props) => createElement("input", props)
  const Label = ({ children, ...props }) => createElement("label", props, children)
  const RegistrationSelect = ({ options = [], onValueChange, ...props }) => createElement(
    "select",
    { ...props, onChange: (event) => onValueChange?.(event.target.value) },
    options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
  )
  const runtimeModule = { exports: {} }
  const localModules = new Map([
    ["@/components/ui/button", { Button }],
    ["@/components/ui/dialog", {
      Dialog,
      DialogClose,
      DialogContent: Wrapper,
      DialogDescription: Wrapper,
      DialogFooter: Wrapper,
      DialogHeader: Wrapper,
      DialogTitle: Wrapper,
    }],
    ["@/components/ui/input", { Input }],
    ["@/components/ui/label", { Label }],
    ["./registration-select", { RegistrationSelect }],
  ])
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unhandled observation editor runtime import: ${specifier}`)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: fileName.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports.RegistrationObservationEditor
}

function observationAttempt(observationId, overrides = {}) {
  return {
    observationId,
    taskId: "10000000-0000-4000-8000-000000000001",
    trackId: "10000000-0000-4000-8000-000000000002",
    appointmentId: "10000000-0000-4000-8000-000000000003",
    appointmentStatus: "completed",
    classId: "10000000-0000-4000-8000-000000000005",
    subject: "영어",
    className: "영어 심화반",
    scheduleState: "active",
    sessionDate: "2026-08-12",
    startsAt: "2026-08-12T16:00:00+09:00",
    endsAt: "2026-08-12T17:30:00+09:00",
    teacherCatalogId: "10000000-0000-4000-8000-000000000006",
    teacherProfileId: "10000000-0000-4000-8000-000000000007",
    teacherName: "김선생",
    classroomCatalogId: "10000000-0000-4000-8000-000000000008",
    classroomName: "본관 301호",
    campus: "본관",
    textbooks: [],
    progress: "",
    bookingFactHash: "a".repeat(64),
    status: "completed",
    attendance: "attended",
    suitabilityResult: "fit",
    decisionKind: "enrollment",
    revision: 3,
    feedbackRevision: 2,
    appointmentNotificationRevision: 4,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
    sessionAuthority: "normalized",
    classLessonSessionId: "10000000-0000-4000-8000-000000000009",
    legacySessionKey: null,
    sessionKey: "2026-08-12:16:00",
    sessionSourceRevision: 1,
    legacySessionSourceHash: null,
    sourceRevision: {
      authority: "normalized",
      sessionId: "10000000-0000-4000-8000-000000000009",
      revision: 1,
    },
    ...overrides,
  }
}

test("calendar deep-linked attempt prepends beyond the recent limit and deduplicates exact payloads", async () => {
  // Production break caught: the editor trusts the recent-50 array as
  // authority, duplicates a returned row, or selects array position zero
  // instead of the exact URL observation ID.
  const { getRegistrationObservationEditorAttemptPlan } = await loadEditorModel()
  assert.equal(typeof getRegistrationObservationEditorAttemptPlan, "function")
  const recent = Array.from({ length: 50 }, (_, index) => observationAttempt(
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ))
  const oldestCalendarAttempt = observationAttempt(
    "30000000-0000-4000-8000-000000000001",
    { appointmentId: "30000000-0000-4000-8000-000000000002" },
  )
  const plan = getRegistrationObservationEditorAttemptPlan({
    attempts: recent,
    deepLinkedAttempt: oldestCalendarAttempt,
    selectedObservationId: oldestCalendarAttempt.observationId,
  })
  assert.ok(plan)
  assert.equal(plan.attempts.length, 51)
  assert.equal(plan.attempts[0].observationId, oldestCalendarAttempt.observationId)
  assert.equal(plan.selectedAttempt.observationId, oldestCalendarAttempt.observationId)
  assert.equal(recent.some((attempt) => attempt.observationId === oldestCalendarAttempt.observationId), false)

  const duplicate = recent[25]
  const duplicatePlan = getRegistrationObservationEditorAttemptPlan({
    attempts: recent,
    deepLinkedAttempt: structuredClone(duplicate),
    selectedObservationId: duplicate.observationId,
  })
  assert.ok(duplicatePlan)
  assert.equal(duplicatePlan.attempts.length, 50)
  assert.equal(duplicatePlan.attempts[0].observationId, duplicate.observationId)
  assert.equal(
    duplicatePlan.attempts.filter((attempt) => attempt.observationId === duplicate.observationId).length,
    1,
  )

  assert.equal(getRegistrationObservationEditorAttemptPlan({
    attempts: recent,
    deepLinkedAttempt: { ...duplicate, teacherName: "다른 선생님" },
    selectedObservationId: duplicate.observationId,
  }), null)
})

test("mounted historical observation uses its exact attempt status and exposes no workflow actions", async () => {
  const RegistrationObservationEditor = await loadMountedObservationEditor()
  const currentAttempt = observationAttempt(
    "31000000-0000-4000-8000-000000000001",
    { status: "scheduled", appointmentStatus: "scheduled", decisionKind: null },
  )
  const expectedLabels = new Map([
    ["scheduled", "청강 예정"],
    ["attended_feedback_pending", "교사 피드백 대기"],
    ["completed", "청강 완료"],
    ["no_show", "불참"],
    ["canceled", "취소"],
  ])

  for (const [status, expectedLabel] of expectedLabels) {
    const deepLinkedAttempt = observationAttempt(
      `32000000-0000-4000-8000-${String([...expectedLabels.keys()].indexOf(status) + 1).padStart(12, "0")}`,
      {
        status,
        appointmentStatus: status === "scheduled" ? "scheduled" : status === "canceled" ? "canceled" : "completed",
        attendance: status === "no_show" ? "no_show" : status === "scheduled" ? null : "attended",
        decisionKind: status === "completed" ? "enrollment" : null,
      },
    )
    const markup = renderToStaticMarkup(createElement(RegistrationObservationEditor, {
      trackId: deepLinkedAttempt.trackId,
      workflowRevision: 12,
      observationRevision: deepLinkedAttempt.revision,
      appointmentNotificationRevision: deepLinkedAttempt.appointmentNotificationRevision,
      detail: {
        track: {
          trackId: deepLinkedAttempt.trackId,
          taskId: deepLinkedAttempt.taskId,
          subject: "영어",
          workflowStatus: "observation_requested",
          workflowRevision: 12,
          observationReturnWorkflowStatus: "consultation_completed",
          directorProfileId: deepLinkedAttempt.teacherProfileId,
        },
        currentObservation: currentAttempt,
        latestEnrollmentDecisionObservationId: null,
        latestDecisionObservation: null,
        attempts: [currentAttempt, deepLinkedAttempt],
        classes: [],
      },
      deepLinkedAttempt,
      actions: {
        enterRegistrationObservation: async () => ({ changed: false }),
        loadRegistrationObservationSessions: async () => [],
        saveRegistrationObservationBooking: async () => ({ changed: false }),
        cancelRegistrationObservation: async () => ({ changed: false }),
        withdrawRegistrationObservation: async () => ({ changed: false }),
      },
      onSaved: async () => undefined,
    }))
    assert.match(markup, new RegExp(`role="status"[^>]*>${expectedLabel}<`), status)
    assert.doesNotMatch(markup, />청강 진행<|>저장<|>예약 취소<|>청강 철회</, status)
  }
})

test("a successful observation mutation clears stale appointment warnings", async () => {
  const source = await readSource("src/features/tasks/registration-track-editor.tsx")
  assert.match(source, /const handleObservationSaved = useCallback\(async \(\) => \{\s*onWarning\(""\)/)
})

test("mounted saved observation exposes one booking AlimTalk action with the canonical observation ID", async () => {
  const RegistrationObservationEditor = await loadMountedObservationEditor()
  const scheduled = observationAttempt(
    "34000000-0000-4000-8000-000000000001",
    { status: "scheduled", appointmentStatus: "scheduled", decisionKind: null },
  )
  const targets = []
  const markup = renderToStaticMarkup(createElement(RegistrationObservationEditor, {
    trackId: scheduled.trackId,
    workflowRevision: 12,
    observationRevision: scheduled.revision,
    appointmentNotificationRevision: scheduled.appointmentNotificationRevision,
    detail: {
      track: {
        trackId: scheduled.trackId,
        taskId: scheduled.taskId,
        subject: "영어",
        workflowStatus: "observation_requested",
        workflowRevision: 12,
        observationReturnWorkflowStatus: "consultation_completed",
        directorProfileId: scheduled.teacherProfileId,
      },
      currentObservation: scheduled,
      latestEnrollmentDecisionObservationId: null,
      latestDecisionObservation: null,
      attempts: [scheduled],
      classes: [],
    },
    actions: {
      enterRegistrationObservation: async () => ({ changed: false }),
      loadRegistrationObservationSessions: async () => [],
      saveRegistrationObservationBooking: async () => ({ changed: false }),
      cancelRegistrationObservation: async () => ({ changed: false }),
      withdrawRegistrationObservation: async () => ({ changed: false }),
    },
    onSaved: async () => undefined,
    onOpenCustomerMessage: (target) => targets.push(target),
  }))

  assert.match(markup, />청강 예약 안내 알림톡</)
  assert.doesNotMatch(markup, /disabled=""[^>]*>청강 예약 안내 알림톡</)
  assert.deepEqual(targets, [], "rendering alone must not dispatch the customer-message action")
})

test("historical attempt status outranks a receipt retained by the same track editor", async () => {
  const { getRegistrationObservationDisplayStatusLabel } = await loadEditorModel()
  assert.equal(typeof getRegistrationObservationDisplayStatusLabel, "function")
  const deepLinkedAttempt = observationAttempt(
    "33000000-0000-4000-8000-000000000001",
    { status: "completed", appointmentStatus: "completed" },
  )
  assert.equal(getRegistrationObservationDisplayStatusLabel({
    receipt: "예약 필요",
    workflowStatus: "observation_requested",
    current: deepLinkedAttempt,
    deepLinkedAttempt,
  }), "청강 완료")
  assert.equal(getRegistrationObservationDisplayStatusLabel({
    receipt: "예약 필요",
    workflowStatus: "observation_requested",
    current: null,
    deepLinkedAttempt: null,
  }), "예약 필요")
})

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
    observationId: "10000000-0000-4000-8000-000000000001",
    decisionKind: "re_observation",
    observationRevision: 6,
    feedbackRevision: 2,
  }
  assert.deepEqual({ ...getRegistrationObservationWithdrawalCorrection({
    latestDecisionObservation: reObservation,
    attempts: Array.from({ length: 21 }, (_, index) => ({
      observationId: `canceled-${index + 1}`,
      decisionKind: null,
      revision: 1,
      feedbackRevision: 0,
    })),
  }) }, {
    decisionKind: "re_observation",
    observationId: "10000000-0000-4000-8000-000000000001",
    observationRevision: 6,
    feedbackRevision: 2,
  })
  assert.equal(getRegistrationObservationWithdrawalCorrection({
    latestDecisionObservation: {
      ...reObservation,
      decisionKind: "enrollment",
    },
    attempts: [{
      observationId: "old-re-observation-inside-attempts",
      decisionKind: "re_observation",
      revision: 99,
      feedbackRevision: 99,
    }],
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

test("latest re-observation correction rejects a blank reason before any withdrawal RPC", async () => {
  const {
    executeRegistrationObservationWithdrawal,
    getRegistrationObservationWithdrawalSubmitState,
  } = await loadEditorModel()
  assert.equal(
    typeof getRegistrationObservationWithdrawalSubmitState,
    "function",
    "the editor model must own correction-reason validation",
  )
  assert.equal(
    typeof executeRegistrationObservationWithdrawal,
    "function",
    "the editor model must block invalid withdrawal operations before the service boundary",
  )

  const submitState = getRegistrationObservationWithdrawalSubmitState({
    correction: {
      decisionKind: "re_observation",
      observationId: "observation-2",
      observationRevision: 6,
      feedbackRevision: 2,
    },
    reason: "   \t ",
    saving: false,
    mutationCommitted: false,
  })
  assert.deepEqual({ ...submitState }, {
    normalizedReason: "",
    fieldError: "재청강 결정 정정 사유를 입력하세요.",
    submitDisabled: true,
  })

  let rpcCalls = 0
  const result = await executeRegistrationObservationWithdrawal(
    submitState,
    async () => {
      rpcCalls += 1
      return { changed: true }
    },
  )
  assert.equal(result, null)
  assert.equal(rpcCalls, 0)
})

test("ordinary withdrawal permits a blank reason", async () => {
  const {
    executeRegistrationObservationWithdrawal,
    getRegistrationObservationWithdrawalSubmitState,
  } = await loadEditorModel()
  assert.equal(typeof getRegistrationObservationWithdrawalSubmitState, "function")
  assert.equal(typeof executeRegistrationObservationWithdrawal, "function")

  const ordinary = getRegistrationObservationWithdrawalSubmitState({
    correction: null,
    reason: "   ",
    saving: false,
    mutationCommitted: false,
  })
  assert.deepEqual({ ...ordinary }, {
    normalizedReason: "",
    fieldError: "",
    submitDisabled: false,
  })

  let rpcCalls = 0
  const ordinaryResult = await executeRegistrationObservationWithdrawal(
    ordinary,
    async (normalizedReason) => {
      rpcCalls += 1
      assert.equal(normalizedReason, "")
      return { changed: true }
    },
  )
  assert.deepEqual({ ...ordinaryResult }, { changed: true })
  assert.equal(rpcCalls, 1)

})

test("re-observation correction sends only a trimmed reason", async () => {
  const { getRegistrationObservationWithdrawalSubmitState } = await loadEditorModel()
  assert.equal(typeof getRegistrationObservationWithdrawalSubmitState, "function")

  const correction = getRegistrationObservationWithdrawalSubmitState({
    correction: {
      decisionKind: "re_observation",
      observationId: "observation-2",
      observationRevision: 6,
      feedbackRevision: 2,
    },
    reason: "  일정 변경으로 다시 청강  ",
    saving: false,
    mutationCommitted: false,
  })
  assert.deepEqual({ ...correction }, {
    normalizedReason: "일정 변경으로 다시 청강",
    fieldError: "",
    submitDisabled: false,
  })
})

test("saving blocks every dialog close path", async () => {
  const {
    getRegistrationObservationDialogClosePlan,
  } = await loadEditorModel()
  assert.equal(
    typeof getRegistrationObservationDialogClosePlan,
    "function",
    "both dialogs need one close policy for controlled state, X, Escape, and DialogClose",
  )
  for (const source of ["on_open_change", "close_button", "escape", "dialog_close"]) {
    const plan = getRegistrationObservationDialogClosePlan({ saving: true, source })
    assert.equal(plan.shouldClose, false, source)
    assert.equal(plan.shouldRestoreTriggerFocus, false, source)
  }
  assert.equal(
    getRegistrationObservationDialogClosePlan({ saving: true, source: "escape" }).shouldPreventDefault,
    true,
  )
  const completed = getRegistrationObservationDialogClosePlan({
    saving: false,
    source: "dialog_close",
  })
  assert.equal(completed.shouldClose, true)
  assert.equal(completed.shouldRestoreTriggerFocus, true)
})

test("a connected enabled dialog trigger wins over the stable fallback target", async () => {
  const { restoreRegistrationObservationDialogTriggerFocus } = await loadEditorModel()
  assert.equal(
    typeof restoreRegistrationObservationDialogTriggerFocus,
    "function",
    "controlled dialogs need an explicit trigger-focus return",
  )

  const scheduled = []
  const focusCalls = []
  const handled = restoreRegistrationObservationDialogTriggerFocus(
    {
      isConnected: true,
      disabled: false,
      focus: (options) => focusCalls.push({ target: "trigger", options }),
    },
    (callback) => scheduled.push(callback),
    {
      isConnected: true,
      disabled: false,
      focus: (options) => focusCalls.push({ target: "fallback", options }),
    },
  )
  assert.equal(handled, true)
  assert.deepEqual(focusCalls, [], "focus restoration must wait until the dialog has closed")
  assert.equal(scheduled.length, 1)
  scheduled[0]()
  assert.equal(focusCalls[0].target, "trigger")
  assert.deepEqual({ ...focusCalls[0].options }, { preventScroll: true })
})

test("a detached or disabled dialog trigger falls back to the connected subject tab", async () => {
  const { restoreRegistrationObservationDialogTriggerFocus } = await loadEditorModel()
  assert.equal(typeof restoreRegistrationObservationDialogTriggerFocus, "function")

  for (const trigger of [
    { isConnected: false, disabled: false },
    { isConnected: true, disabled: true },
  ]) {
    const scheduled = []
    const focusCalls = []
    const handled = restoreRegistrationObservationDialogTriggerFocus(
      { ...trigger, focus: () => focusCalls.push("trigger") },
      (callback) => scheduled.push(callback),
      {
        isConnected: true,
        disabled: false,
        focus: () => focusCalls.push("fallback"),
      },
    )
    assert.equal(handled, true)
    assert.equal(scheduled.length, 1)
    scheduled[0]()
    assert.deepEqual(focusCalls, ["fallback"])
  }
})

test("focus restoration rechecks a trigger that detaches before the scheduled frame", async () => {
  const { restoreRegistrationObservationDialogTriggerFocus } = await loadEditorModel()
  const scheduled = []
  const focusCalls = []
  const trigger = {
    isConnected: true,
    disabled: false,
    focus: () => focusCalls.push("trigger"),
  }
  const fallback = {
    isConnected: true,
    disabled: false,
    focus: () => focusCalls.push("fallback"),
  }

  const handled = restoreRegistrationObservationDialogTriggerFocus(
    trigger,
    (callback) => scheduled.push(callback),
    fallback,
  )
  assert.equal(handled, true, "a live candidate should suppress Radix default focus")
  trigger.isConnected = false
  scheduled[0]()
  assert.deepEqual(focusCalls, ["fallback"])
})

test("no valid dialog focus target leaves Radix default focus restoration untouched", async () => {
  const { restoreRegistrationObservationDialogTriggerFocus } = await loadEditorModel()
  assert.equal(typeof restoreRegistrationObservationDialogTriggerFocus, "function")

  for (const [trigger, fallback] of [
    [null, null],
    [
      { isConnected: false, disabled: false, focus: () => assert.fail("detached trigger focused") },
      { isConnected: true, disabled: true, focus: () => assert.fail("disabled fallback focused") },
    ],
  ]) {
    const scheduled = []
    const handled = restoreRegistrationObservationDialogTriggerFocus(
      trigger,
      (callback) => scheduled.push(callback),
      fallback,
    )
    assert.equal(handled, false)
    assert.deepEqual(scheduled, [])
  }
})

test("withdrawal dialog wires correction validation to the field, disabled submit, and RPC guard", async () => {
  const source = await readSource("src/features/tasks/registration-observation-editor.tsx")

  assert.match(
    source,
    /const withdrawSubmitState = getRegistrationObservationWithdrawalSubmitState\(/,
  )
  assert.match(source, /executeRegistrationObservationWithdrawal\(\s*withdrawSubmitState,/)
  assert.match(source, /aria-invalid=\{Boolean\(withdrawSubmitState\.fieldError\)\}/)
  assert.match(source, /aria-describedby=\{withdrawSubmitState\.fieldError/)
  assert.match(
    source,
    /withdrawSubmitState\.fieldError \? <p[^>]*role="alert"[^>]*>\{withdrawSubmitState\.fieldError\}<\/p>/,
  )
  assert.match(source, /disabled=\{withdrawSubmitState\.submitDisabled\}/)
})

test("save and withdrawal dialogs wire guarded close and explicit focus return on every exit", async () => {
  const source = await readSource("src/features/tasks/registration-observation-editor.tsx")

  assert.match(source, /const saveDialogTriggerRef = useRef<HTMLButtonElement>\(null\)/)
  assert.match(source, /const withdrawDialogTriggerRef = useRef<HTMLButtonElement>\(null\)/)
  assert.match(source, /ref=\{saveDialogTriggerRef\}/)
  assert.match(source, /ref=\{withdrawDialogTriggerRef\}/)
  assert.match(source, /getRegistrationObservationDialogClosePlan\(\{\s*saving,/)
  assert.equal(
    (source.match(/onOpenChange=\{handle(?:SaveConfirm|Withdraw)OpenChange\}/g) || []).length,
    2,
    "both controlled Dialog roots must reject close requests while saving",
  )
  assert.equal((source.match(/onEscapeKeyDown=/g) || []).length, 2)
  assert.equal((source.match(/onCloseAutoFocus=/g) || []).length, 2)
  const hidesDefaultCloseWhileSaving = (
    source.match(/showCloseButton=\{!saving\}/g) || []
  ).length === 2
  const handlesDefaultCloseExplicitly = (
    source.match(/onCloseButtonClick=\{handle(?:SaveConfirm|Withdraw)CloseButton\}/g) || []
  ).length === 2
  assert.equal(
    hidesDefaultCloseWhileSaving || handlesDefaultCloseExplicitly,
    true,
    "both default X controls must be unavailable or explicitly guarded during saving",
  )
  assert.equal(
    (source.match(/restoreRegistrationObservationDialogTriggerFocus\(/g) || []).length >= 3,
    true,
    "the helper definition and both dialog close paths must restore their own trigger",
  )
  assert.equal(
    (source.match(/<DialogClose asChild>[\s\S]{0,180}<Button[^>]*disabled=\{saving \|\| mutationCommitted\}/g) || []).length,
    2,
    "footer close controls must not close during a mutation",
  )
})

test("nested observation confirmations render above the registration detail modal", async () => {
  const source = await readSource("src/features/tasks/registration-observation-editor.tsx")
  const dialogContents = [...source.matchAll(/<DialogContent([\s\S]*?)>/g)].map((match) => match[1])

  assert.equal(dialogContents.length, 2, "예약 저장과 청강 철회 확인창을 모두 검사한다")
  for (const content of dialogContents) {
    assert.match(content, /className="z-\[90\]"/)
    assert.match(content, /overlayClassName="z-\[90\]"/)
  }
})

test("dialog close focus falls back to the active subject tab before suppressing Radix default", async () => {
  const source = await readSource("src/features/tasks/registration-observation-editor.tsx")
  const fallbackLookup = /document\.getElementById\(`registration-subject-tab-\$\{trackId\}`\)/g
  assert.equal(
    (source.match(fallbackLookup) || []).length,
    2,
    "save and withdrawal dialogs must both resolve the persistent active-subject tab",
  )

  for (const [handlerName, startMarker, endMarker] of [
    [
      "handleSaveDialogCloseAutoFocus",
      "function handleSaveDialogCloseAutoFocus",
      "function handleWithdrawDialogCloseAutoFocus",
    ],
    [
      "handleWithdrawDialogCloseAutoFocus",
      "function handleWithdrawDialogCloseAutoFocus",
      "\n  useEffect(() => {",
    ],
  ]) {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start + 1)
    assert.ok(start >= 0 && end > start, `${handlerName} must remain explicit`)
    const handler = source.slice(start, end)
    assert.match(
      handler,
      /const focusRestored = restoreRegistrationObservationDialogTriggerFocus\(/,
    )
    assert.match(handler, /if \(focusRestored\) event\.preventDefault\(\)/)
    assert.ok(
      handler.indexOf("restoreRegistrationObservationDialogTriggerFocus(")
        < handler.indexOf("event.preventDefault()"),
      `${handlerName} must leave Radix default focus available when no target is valid`,
    )
  }
})

test("observation UI errors normalize domain, timeout, network, and prerequisite failures", async () => {
  const { getRegistrationObservationUiErrorMessage } = await loadEditorModel()
  assert.equal(
    typeof getRegistrationObservationUiErrorMessage,
    "function",
    "one UI boundary must normalize every observation error",
  )

  const latestChanged = "최신 청강 정보가 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요."
  const cases = [
    {
      error: { code: "40001", message: "registration_observation_stale_revision" },
      want: latestChanged,
    },
    {
      error: { code: "P0002", message: "registration_observation_not_found" },
      want: "청강 정보를 찾을 수 없습니다. 화면을 새로고침해 주세요.",
    },
    {
      error: { code: "40001", message: "registration_observation_request_key_conflict" },
      want: latestChanged,
    },
    {
      error: { name: "RegistrationRequestTimeoutError", code: "REGISTRATION_REQUEST_TIMEOUT", message: "request_timeout" },
      want: "요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
    },
    {
      error: { name: "AbortError", message: "The operation was aborted" },
      want: "요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
    },
    {
      error: { code: "57014", message: "canceling statement due to statement timeout" },
      want: "요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
    },
    {
      error: new TypeError("Failed to fetch"),
      want: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    },
    {
      error: { message: "registration_observation_session_invalid" },
      want: "청강 예약에 필요한 정보를 확인할 수 없습니다. 반과 회차를 다시 선택해 주세요.",
    },
    {
      error: { message: "registration_observation_session_time_ambiguous" },
      want: "같은 시간의 청강 회차가 둘 이상입니다. 다른 회차를 선택해 주세요.",
    },
  ]
  for (const { error, want } of cases) {
    const actual = getRegistrationObservationUiErrorMessage(error, "청강 정보를 처리하지 못했습니다.")
    assert.equal(actual, want)
    assert.doesNotMatch(
      actual,
      /registration_observation_|PGRST|SQLSTATE|dashboard_private|duplicate key|violates|57014|40001|P0002|Failed to fetch/i,
    )
  }

  for (const error of [
    {
      code: "23505",
      message: "duplicate key value violates unique constraint registration_observation_private_key",
      details: "Key (track_id) already exists",
      hint: "inspect dashboard_private.registration_observation_mutation_requests",
    },
    { code: "PGRST116", message: "JSON object requested, multiple rows returned" },
    new Error("registration_observation_unexpected_internal_marker"),
  ]) {
    assert.equal(
      getRegistrationObservationUiErrorMessage(error, "청강 정보를 처리하지 못했습니다."),
      "청강 정보를 처리하지 못했습니다.",
    )
  }
})

test("session and mutation errors use only the centralized observation UI normalizer", async () => {
  const source = await readSource("src/features/tasks/registration-observation-editor.tsx")

  assert.doesNotMatch(source, /function errorMessage\(/)
  assert.match(
    source,
    /getRegistrationObservationUiErrorMessage\(error, "청강 회차를 불러오지 못했습니다\."\)/,
  )
  assert.match(
    source,
    /getRegistrationObservationUiErrorMessage\(error, "청강 정보를 저장하지 못했습니다\."\)/,
  )
})

test("track detail loading imports and uses the centralized observation UI normalizer", async () => {
  const trackEditorSource = await readSource("src/features/tasks/registration-track-editor.tsx")
  const observationEditorImport = trackEditorSource.match(
    /import \{([\s\S]*?)\} from "\.\/registration-observation-editor"/,
  )
  assert.ok(observationEditorImport, "track editor must import the observation editor boundary")
  assert.match(observationEditorImport[1], /\bgetRegistrationObservationUiErrorMessage\b/)
  assert.match(
    trackEditorSource,
    /setObservationDetailError\(getRegistrationObservationUiErrorMessage\(error, "청강 정보를 불러오지 못했습니다\."\)\)/,
  )
})

test("booking editor delegates feedback decisions to one dedicated slot and excludes provider actions", async () => {
  const [source, caseListSource] = await Promise.all([
    readSource("src/features/tasks/registration-observation-editor.tsx"),
    readSource("src/features/tasks/registration-case-list.tsx"),
  ])

  assert.match(source, /saveRegistrationObservationBooking/)
  assert.match(source, /cancelRegistrationObservation/)
  assert.match(source, /withdrawRegistrationObservation/)
  assert.doesNotMatch(source, /setRegistrationWorkflowStatus|set_registration_workflow_status_v1/)
  assert.doesNotMatch(source, /target as /)
  assert.match(source, /feedbackPanel/)
  assert.equal((source.match(/\{feedbackPanel\}/g) || []).length, 1)
  assert.doesNotMatch(source, /record_registration_observation_attendance_v1/)
  assert.doesNotMatch(source, /submit_registration_observation_feedback_v1/)
  assert.doesNotMatch(source, /correct_registration_observation_feedback_v1/)
  assert.doesNotMatch(source, /decide_registration_observation_v1/)
  assert.doesNotMatch(source, /google.chat|webhook|solapi|send.*customer/i)
  assert.match(source, /예약 저장됨/)
  assert.doesNotMatch(source, /고객 안내: 미발송/)
  assert.match(source, /청강 예약 저장/)
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
  assert.match(source, /const observationWorkspaceAvailable = Boolean\(activeTrack && canLoadRegistrationObservationWorkspace\(\{/)
  assert.match(shell, /observation=\{observationWorkspaceAvailable \? \(/)
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

test("track editor loads one bounded feedback DTO only for an owned visible panel", async () => {
  const source = await readSource("src/features/tasks/registration-track-editor.tsx")
  const loadEffectStart = source.indexOf("loadRegistrationObservationFeedback(")
  assert.ok(loadEffectStart >= 0, "the manager workspace must use the dedicated feedback read")
  const loadEffect = source.slice(Math.max(0, loadEffectStart - 1_200), loadEffectStart + 2_400)
  assert.match(loadEffect, /canManageActiveObservation/)
  assert.match(source, /getRegistrationObservationFeedbackMountPlan\(\{/)
  assert.match(source, /managerDetail: activeObservationDetail/)
  assert.match(source, /canManageCase/)
  assert.match(loadEffect, /activeFeedbackObservationId/)
  assert.match(loadEffect, /observationFeedbackLoadOwnershipRef/)
  assert.match(loadEffect, /activeObservationFeedbackKeyRef/)
  assert.match(loadEffect, /activeObservationViewerIdRef/)
  assert.match(loadEffect, /activeObservationRuntimeVersionRef/)
  assert.match(source, /force: true/)
  assert.match(source, /<RegistrationObservationFeedbackPanel/)
  assert.match(source, /feedbackPanel=\{/)
  assert.match(source, /canKeepRegistrationObservationFeedbackHistoryMounted\(\{/)
  assert.match(source, /observationAttemptCount: activeTrack\.observationAttemptCount/)
  assert.match(
    source,
    /activeFeedbackHistoryOnly\s*\? activeObservationFeedbackPanel\s*:\s*\(/,
    "terminal decisions must mount the correction panel without reopening the booking editor",
  )
  assert.doesNotMatch(loadEffect, /parentPhone|studentPhone|schoolName|inquiry|registrationTracks/)
})
