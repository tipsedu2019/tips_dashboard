import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

import {
  getRegistrationObservationFeedbackErrorState,
} from "../src/features/tasks/registration-observation-model.ts"

const root = new URL("../", import.meta.url)
const panelUrl = new URL(
  "src/features/tasks/registration-observation-feedback-panel.tsx",
  root,
)

const IDS = {
  observation: "10000000-0000-4000-8000-000000000003",
  task: "10000000-0000-4000-8000-000000000002",
  track: "10000000-0000-4000-8000-000000000001",
  appointment: "10000000-0000-4000-8000-000000000004",
  class: "10000000-0000-4000-8000-000000000005",
  lesson: "10000000-0000-4000-8000-000000000006",
}

const detail = Object.freeze({
  observationId: IDS.observation,
  taskId: IDS.task,
  trackId: IDS.track,
  appointmentId: IDS.appointment,
  studentName: "김다미",
  studentGrade: "고1",
  subject: "영어",
  classId: IDS.class,
  className: "고1 영어 A",
  sessionAuthority: "normalized",
  sessionDate: "2026-08-12",
  sessionKey: "2026-08-12:lesson-1",
  classLessonSessionId: IDS.lesson,
  legacySessionKey: null,
  sourceRevision: { authority: "normalized", sessionId: IDS.lesson, revision: 3 },
  startsAt: "2026-08-12T09:00:00.000Z",
  endsAt: "2026-08-12T10:00:00.000Z",
  classroomName: "본관 301호",
  teacherName: "강부희",
  status: "completed",
  attendance: "attended",
  suitabilityResult: "fit",
  feedbackReason: "수업 참여와 이해도가 좋습니다.",
  proxySubmitted: true,
  feedbackSubmittedByName: "운영 담당자",
  feedbackSubmittedAt: "2026-08-12T10:05:00.000Z",
  revision: 2,
  feedbackRevision: 1,
  appointmentNotificationRevision: 1,
  trackWorkflowRevision: 9,
  decisionKind: null,
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function loadPanelModel() {
  const source = await readFile(panelUrl, "utf8")
  const startMarker = "// registration-observation-feedback-panel-model:start"
  const endMarker = "// registration-observation-feedback-panel-model:end"
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1)
  assert.ok(end > start)
  const compiled = ts.transpileModule(
    `${source.slice(start + startMarker.length, end)}\nmodule.exports = {
      applyRegistrationObservationFeedbackPanelOutcome,
      buildRegistrationObservationDecisionPlan,
      buildRegistrationObservationFeedbackSavePlan,
      createRegistrationObservationFeedbackPanelState,
      canEditRegistrationObservationSuitability:
        typeof canEditRegistrationObservationSuitability === "function"
          ? canEditRegistrationObservationSuitability
          : undefined,
      canEditRegistrationObservationFeedback:
        typeof canEditRegistrationObservationFeedback === "function"
          ? canEditRegistrationObservationFeedback
          : undefined,
      executeRegistrationObservationDecision,
      executeRegistrationObservationFeedbackReload:
        typeof executeRegistrationObservationFeedbackReload === "function"
          ? executeRegistrationObservationFeedbackReload
          : undefined,
      formatRegistrationObservationFeedbackKst,
      getRegistrationObservationProxyLabel,
      getRegistrationObservationFeedbackPanelAvailability:
        typeof getRegistrationObservationFeedbackPanelAvailability === "function"
          ? getRegistrationObservationFeedbackPanelAvailability
          : undefined,
      getRegistrationObservationFeedbackRefreshPlan:
        typeof getRegistrationObservationFeedbackRefreshPlan === "function"
          ? getRegistrationObservationFeedbackRefreshPlan
          : undefined,
      getRegistrationObservationFeedbackMountPlan:
        typeof getRegistrationObservationFeedbackMountPlan === "function"
          ? getRegistrationObservationFeedbackMountPlan
          : undefined,
      canKeepRegistrationObservationFeedbackHistoryMounted:
        typeof canKeepRegistrationObservationFeedbackHistoryMounted === "function"
          ? canKeepRegistrationObservationFeedbackHistoryMounted
          : undefined,
      shouldMountRegistrationObservationFeedbackOnly:
        typeof shouldMountRegistrationObservationFeedbackOnly === "function"
          ? shouldMountRegistrationObservationFeedbackOnly
          : undefined,
      loadRegistrationObservationFeedbackForOwnedPanel:
        typeof loadRegistrationObservationFeedbackForOwnedPanel === "function"
          ? loadRegistrationObservationFeedbackForOwnedPanel
          : undefined,
      updateRegistrationObservationFeedbackPanelDraft,
    };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    Date,
  })
  return sandboxModule.exports
}

test("manager feedback respects the exact class start and end boundaries", async () => {
  const {
    buildRegistrationObservationFeedbackSavePlan,
    createRegistrationObservationFeedbackPanelState,
    getRegistrationObservationFeedbackPanelAvailability,
  } = await loadPanelModel()
  assert.equal(typeof getRegistrationObservationFeedbackPanelAvailability, "function")

  const scheduled = {
    ...detail,
    status: "scheduled",
    attendance: null,
    suitabilityResult: null,
    feedbackReason: null,
    feedbackSubmittedAt: null,
    feedbackSubmittedByName: null,
    proxySubmitted: false,
    startsAt: "2026-08-14T10:30:00.000Z",
    endsAt: "2026-08-14T12:30:00.000Z",
  }
  const beforeStart = Date.parse("2026-08-14T10:29:59.999Z")
  const atStart = Date.parse(scheduled.startsAt)
  const atEnd = Date.parse(scheduled.endsAt)

  assert.deepEqual(
    { ...getRegistrationObservationFeedbackPanelAvailability(scheduled, beforeStart) },
    { submitFeedback: false, submitNoShow: false, recordAttendance: false },
  )
  assert.deepEqual(
    { ...getRegistrationObservationFeedbackPanelAvailability(scheduled, atStart) },
    { submitFeedback: false, submitNoShow: true, recordAttendance: true },
  )
  assert.deepEqual(
    { ...getRegistrationObservationFeedbackPanelAvailability(scheduled, atEnd) },
    { submitFeedback: true, submitNoShow: true, recordAttendance: true },
  )

  const state = {
    ...createRegistrationObservationFeedbackPanelState(scheduled),
    draft: {
      attendance: "attended",
      suitabilityResult: "fit",
      feedbackReason: "수업 참여가 좋았습니다.",
      correctionReason: "",
      decisionKind: "",
    },
  }
  assert.deepEqual(
    { ...buildRegistrationObservationFeedbackSavePlan(state, "before-end", beforeStart) },
    { ok: false, message: "참석 피드백은 수업 종료 후 저장할 수 있습니다." },
  )
  assert.equal(
    buildRegistrationObservationFeedbackSavePlan(state, "at-end", atEnd).ok,
    true,
  )
})

test("feedback save failure preserves every operator input and exposes a stale reload action", async () => {
  const {
    applyRegistrationObservationFeedbackPanelOutcome,
    createRegistrationObservationFeedbackPanelState,
    updateRegistrationObservationFeedbackPanelDraft,
  } = await loadPanelModel()
  let state = createRegistrationObservationFeedbackPanelState(detail)
  state = updateRegistrationObservationFeedbackPanelDraft(state, "suitabilityResult", "unfit")
  state = updateRegistrationObservationFeedbackPanelDraft(state, "feedbackReason", "집중이 어려웠습니다.")
  state = updateRegistrationObservationFeedbackPanelDraft(state, "correctionReason", "교사 확인 후 정정")

  const failed = applyRegistrationObservationFeedbackPanelOutcome(state, {
    kind: "failed",
    errorMessage: "청강 정보가 변경되었습니다. 다시 확인해 주세요.",
    reloadRequired: true,
  })
  assert.deepEqual({ ...failed.draft }, {
    attendance: "attended",
    suitabilityResult: "unfit",
    feedbackReason: "집중이 어려웠습니다.",
    correctionReason: "교사 확인 후 정정",
    decisionKind: "",
  })
  assert.equal(failed.reloadRequired, true)
  assert.equal(failed.errorMessage, "청강 정보가 변경되었습니다. 다시 확인해 주세요.")
  const editedAfterStale = updateRegistrationObservationFeedbackPanelDraft(
    failed,
    "feedbackReason",
    "입력은 유지하되 새 revision을 다시 불러와야 합니다.",
  )
  assert.equal(editedAfterStale.reloadRequired, true)
  assert.equal(
    editedAfterStale.errorMessage,
    "청강 정보가 변경되었습니다. 다시 확인해 주세요.",
  )
})

test("stale reload failure is awaited, bounded, and leaves the recovery action retryable", async () => {
  const { executeRegistrationObservationFeedbackReload } = await loadPanelModel()
  assert.equal(typeof executeRegistrationObservationFeedbackReload, "function")
  const guard = { current: false }
  let reloadCalls = 0
  const outcome = await executeRegistrationObservationFeedbackReload({
    guard,
    onReload: async () => {
      reloadCalls += 1
      throw { message: "TypeError: Failed to fetch", details: "private endpoint" }
    },
    normalizeError: getRegistrationObservationFeedbackErrorState,
  })
  assert.deepEqual({ ...outcome }, {
    kind: "failed",
    errorMessage: "서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요.",
    reloadRequired: true,
  })
  assert.equal(reloadCalls, 1)
  assert.equal(guard.current, false)
})

test("feedback and decision plans are explicit and serialize only the dedicated domain RPC inputs", async () => {
  const {
    buildRegistrationObservationDecisionPlan,
    buildRegistrationObservationFeedbackSavePlan,
    createRegistrationObservationFeedbackPanelState,
    updateRegistrationObservationFeedbackPanelDraft,
  } = await loadPanelModel()
  let state = createRegistrationObservationFeedbackPanelState(detail)
  assert.equal(state.draft.decisionKind, "", "the director decision must never be preselected")
  assert.equal(buildRegistrationObservationDecisionPlan(state, "decision-key-1").ok, false)

  state = updateRegistrationObservationFeedbackPanelDraft(state, "correctionReason", "표현 보완")
  assert.deepEqual(JSON.parse(JSON.stringify(
    buildRegistrationObservationFeedbackSavePlan(state, "feedback-key-1"),
  )), {
    ok: true,
    kind: "correct",
    input: {
      observationId: IDS.observation,
      suitabilityResult: "fit",
      feedbackReason: "수업 참여와 이해도가 좋습니다.",
      correctionReason: "표현 보완",
      expectedObservationRevision: 2,
      expectedFeedbackRevision: 1,
      expectedDecisionKind: null,
      requestKey: "feedback-key-1",
    },
  })

  state = updateRegistrationObservationFeedbackPanelDraft(state, "decisionKind", "waiting_current_class")
  assert.deepEqual(JSON.parse(JSON.stringify(
    buildRegistrationObservationDecisionPlan(state, "decision-key-1"),
  )), {
    ok: true,
    input: {
      observationId: IDS.observation,
      decisionKind: "waiting_current_class",
      waitingClassId: IDS.class,
      expectedObservationRevision: 2,
      expectedFeedbackRevision: 1,
      expectedTrackWorkflowRevision: 9,
      requestKey: "decision-key-1",
    },
  })
})

test("post-decision correction locks suitability and serializes only the original value", async () => {
  const {
    buildRegistrationObservationFeedbackSavePlan,
    canEditRegistrationObservationFeedback,
    canEditRegistrationObservationSuitability,
    createRegistrationObservationFeedbackPanelState,
    updateRegistrationObservationFeedbackPanelDraft,
  } = await loadPanelModel()
  assert.equal(typeof canEditRegistrationObservationSuitability, "function")
  assert.equal(typeof canEditRegistrationObservationFeedback, "function")
  const decidedDetail = { ...detail, decisionKind: "not_registered" }
  let state = createRegistrationObservationFeedbackPanelState(decidedDetail)
  assert.equal(canEditRegistrationObservationSuitability(state.detail), false)
  assert.equal(canEditRegistrationObservationFeedback({
    canManageCase: false,
    isAssignedTeacher: true,
    decisionKind: null,
  }), true)
  assert.equal(canEditRegistrationObservationFeedback({
    canManageCase: false,
    isAssignedTeacher: true,
    decisionKind: "not_registered",
  }), false)
  assert.equal(canEditRegistrationObservationFeedback({
    canManageCase: true,
    isAssignedTeacher: false,
    decisionKind: "not_registered",
  }), true)

  state = updateRegistrationObservationFeedbackPanelDraft(
    state,
    "suitabilityResult",
    "unfit",
  )
  assert.equal(state.draft.suitabilityResult, "fit")
  const tampered = {
    ...state,
    draft: { ...state.draft, suitabilityResult: "unfit" },
  }
  assert.deepEqual({ ...buildRegistrationObservationFeedbackSavePlan(
    tampered,
    "post-decision-correction-1",
  ) }, {
    ok: false,
    message: "결정 후에는 적합 여부를 변경할 수 없습니다.",
  })

  state = updateRegistrationObservationFeedbackPanelDraft(
    state,
    "feedbackReason",
    "수업 참여는 좋았으나 사유 문구를 정정합니다.",
  )
  state = updateRegistrationObservationFeedbackPanelDraft(
    state,
    "correctionReason",
    "결정 후 사유 문구 정정",
  )
  const plan = buildRegistrationObservationFeedbackSavePlan(
    state,
    "post-decision-correction-1",
  )
  assert.equal(plan.ok, true)
  assert.equal(plan.input.suitabilityResult, "fit")
})

test("manager mount plan keeps the latest decided feedback correction-only for admin and staff", async () => {
  const {
    canKeepRegistrationObservationFeedbackHistoryMounted,
    getRegistrationObservationFeedbackMountPlan,
    shouldMountRegistrationObservationFeedbackOnly,
  } = await loadPanelModel()
  assert.equal(typeof getRegistrationObservationFeedbackMountPlan, "function")
  assert.equal(typeof canKeepRegistrationObservationFeedbackHistoryMounted, "function")
  assert.equal(canKeepRegistrationObservationFeedbackHistoryMounted({
    canManageCase: true,
    observationAttemptCount: 1,
  }), true, "admin/staff must retain the mounted path after terminal decisions")
  assert.equal(canKeepRegistrationObservationFeedbackHistoryMounted({
    canManageCase: false,
    observationAttemptCount: 1,
  }), false, "a director or teacher must not reopen terminal history correction")
  assert.equal(canKeepRegistrationObservationFeedbackHistoryMounted({
    canManageCase: true,
    observationAttemptCount: 0,
  }), false, "a track without observation history must keep load zero")
  assert.equal(typeof shouldMountRegistrationObservationFeedbackOnly, "function")
  assert.equal(shouldMountRegistrationObservationFeedbackOnly({
    correctionOnly: true,
    workflowActionable: false,
  }), true, "terminal history mounts only the locked correction panel")
  assert.equal(shouldMountRegistrationObservationFeedbackOnly({
    correctionOnly: true,
    workflowActionable: true,
  }), false, "waiting and re-observation keep their next observation actions mounted")
  const decidedManagerDetail = {
    currentObservation: null,
    latestDecisionObservation: {
      observationId: IDS.observation,
    },
  }

  assert.deepEqual({ ...getRegistrationObservationFeedbackMountPlan({
    managerDetail: decidedManagerDetail,
    canManageObservation: true,
    canManageCase: true,
  }) }, {
    observationId: IDS.observation,
    correctionOnly: true,
  })
  assert.equal(getRegistrationObservationFeedbackMountPlan({
    managerDetail: decidedManagerDetail,
    canManageObservation: true,
    canManageCase: false,
  }), null, "a director must not reopen post-decision correction")
  assert.deepEqual({ ...getRegistrationObservationFeedbackMountPlan({
    managerDetail: {
      currentObservation: { observationId: IDS.appointment },
      latestDecisionObservation: decidedManagerDetail.latestDecisionObservation,
    },
    canManageObservation: true,
    canManageCase: false,
  }) }, {
    observationId: IDS.appointment,
    correctionOnly: false,
  })
  assert.equal(getRegistrationObservationFeedbackMountPlan({
    managerDetail: null,
    canManageObservation: true,
    canManageCase: true,
  }), null, "a concealed or wrong-owner manager detail must load zero feedback rows")
})

test("decision duplicate clicks call one dedicated RPC and never call an enrollment mutation", async () => {
  const {
    createRegistrationObservationFeedbackPanelState,
    executeRegistrationObservationDecision,
    updateRegistrationObservationFeedbackPanelDraft,
  } = await loadPanelModel()
  let state = createRegistrationObservationFeedbackPanelState(detail)
  state = updateRegistrationObservationFeedbackPanelDraft(state, "decisionKind", "not_registered")
  const pending = deferred()
  const guard = { current: false }
  let decisionCalls = 0
  let enrollmentCalls = 0
  const actions = {
    decideRegistrationObservation(input) {
      decisionCalls += 1
      assert.equal(input.decisionKind, "not_registered")
      assert.equal(input.waitingClassId, null)
      return pending.promise
    },
    saveRegistrationEnrollmentRows() {
      enrollmentCalls += 1
      throw new Error("enrollment mutation must not run")
    },
  }
  const first = executeRegistrationObservationDecision({
    state,
    actions,
    requestKey: "decision-key-2",
    guard,
    onSaved: async () => undefined,
  })
  const duplicate = await executeRegistrationObservationDecision({
    state,
    actions,
    requestKey: "decision-key-2",
    guard,
    onSaved: async () => undefined,
  })
  assert.equal(duplicate.kind, "ignored")
  assert.equal(decisionCalls, 1)
  assert.equal(enrollmentCalls, 0)

  const refreshed = {
    ...detail,
    decisionKind: "not_registered",
    revision: 3,
    trackWorkflowRevision: 10,
  }
  pending.resolve(refreshed)
  const committed = await first
  assert.equal(committed.kind, "committed")
  assert.equal(committed.detail.revision, 3)
  assert.equal(committed.detail.trackWorkflowRevision, 10)
  assert.equal(enrollmentCalls, 0)
})

test("proxy label requires the complete server tuple and uses deterministic KST", async () => {
  const {
    formatRegistrationObservationFeedbackKst,
    getRegistrationObservationProxyLabel,
  } = await loadPanelModel()
  assert.equal(
    formatRegistrationObservationFeedbackKst("2026-08-12T10:05:00.000Z"),
    "2026. 8. 12. 19:05",
  )
  assert.equal(
    getRegistrationObservationProxyLabel(detail),
    "대리 입력 · 운영 담당자 · 2026. 8. 12. 19:05",
  )
  assert.equal(getRegistrationObservationProxyLabel({
    ...detail,
    proxySubmitted: false,
    feedbackSubmittedByName: "강부희",
  }), null)
  assert.equal(getRegistrationObservationProxyLabel({
    ...detail,
    feedbackSubmittedAt: null,
  }), null)
})

test("a stale saved observation refresh stays detached from the newly owned panel generation", async () => {
  const {
    getRegistrationObservationFeedbackRefreshPlan,
    loadRegistrationObservationFeedbackForOwnedPanel,
  } = await loadPanelModel()
  assert.equal(typeof getRegistrationObservationFeedbackRefreshPlan, "function")
  assert.deepEqual({ ...getRegistrationObservationFeedbackRefreshPlan({
    requestedOwnershipKey: "task-1:track-old:observation-old",
    currentOwnershipKey: "task-1:track-new:observation-new",
  }) }, {
    ownsPanel: false,
    mutatePanelState: false,
  })
  assert.deepEqual({ ...getRegistrationObservationFeedbackRefreshPlan({
    requestedOwnershipKey: "task-1:track-new:observation-new",
    currentOwnershipKey: "task-1:track-new:observation-new",
  }) }, {
    ownsPanel: true,
    mutatePanelState: true,
  })
  assert.equal(typeof loadRegistrationObservationFeedbackForOwnedPanel, "function")
  let loadCalls = 0
  const load = async () => {
    loadCalls += 1
    return detail
  }
  assert.equal(await loadRegistrationObservationFeedbackForOwnedPanel({
    requestedOwnershipKey: "task-1:track-old:observation-old",
    currentOwnershipKey: "task-1:track-new:observation-new",
    load,
  }), null)
  assert.equal(loadCalls, 0)
  assert.equal(await loadRegistrationObservationFeedbackForOwnedPanel({
    requestedOwnershipKey: "task-1:track-new:observation-new",
    currentOwnershipKey: "task-1:track-new:observation-new",
    load,
  }), detail)
  assert.equal(loadCalls, 1)
})

test("feedback errors reveal only bounded Korean recovery messages", () => {
  const delayed = "서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요."
  for (const error of [
    { name: "AbortError", message: "aborted" },
    { name: "TimeoutError", message: "timeout" },
    new TypeError("Failed to fetch"),
    { message: "TypeError: Failed to fetch" },
    { code: "57014", message: "statement timeout" },
  ]) {
    assert.deepEqual(getRegistrationObservationFeedbackErrorState(error), {
      message: delayed,
      reloadRequired: false,
    })
  }
  assert.deepEqual(getRegistrationObservationFeedbackErrorState({
    code: "40001",
    message: "registration_observation_stale_revision",
  }), {
    message: "청강 정보가 변경되었습니다. 다시 확인해 주세요.",
    reloadRequired: true,
  })
  const unrelated = getRegistrationObservationFeedbackErrorState({
    code: "23505",
    message: "duplicate key registration_observation_private_detail",
    hint: "dashboard_private secret",
  })
  assert.deepEqual(unrelated, {
    message: "청강 피드백을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    reloadRequired: false,
  })
  assert.doesNotMatch(unrelated.message, /registration_|dashboard_private|23505/)
})

test("manager feedback panel keeps its privacy boundary and reuses the existing request-key lifecycle", async () => {
  const source = await readFile(panelUrl, "utf8")
  assert.match(source, /getRegistrationObservationRequestKey/)
  assert.match(source, /completeRegistrationObservationRequestKey/)
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /다시 불러오기/)
  assert.doesNotMatch(
    source,
    /parentPhone|studentPhone|schoolName|inquiry|sibling|saveRegistrationEnrollmentRows|RegistrationAdmissionPanel/,
  )
})
