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
      createRegistrationObservationFeedbackPanelState,
      executeRegistrationObservationDecision,
      executeRegistrationObservationFeedbackReload,
      formatRegistrationObservationFeedbackKst,
      getRegistrationObservationProxyLabel,
      getRegistrationObservationAttendanceAvailability,
      getRegistrationObservationFeedbackRefreshPlan,
      getRegistrationObservationFeedbackMountPlan,
      canKeepRegistrationObservationFeedbackHistoryMounted,
      shouldMountRegistrationObservationFeedbackOnly,
      loadRegistrationObservationFeedbackForOwnedPanel,
      updateRegistrationObservationDecisionDraft,
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

test("attendance confirmation uses the exact class start boundary", async () => {
  const { getRegistrationObservationAttendanceAvailability } = await loadPanelModel()
  const scheduled = { ...detail, status: "scheduled" }

  assert.equal(
    getRegistrationObservationAttendanceAvailability(
      scheduled,
      Date.parse(scheduled.startsAt) - 1,
    ),
    false,
  )
  assert.equal(
    getRegistrationObservationAttendanceAvailability(
      scheduled,
      Date.parse(scheduled.startsAt),
    ),
    true,
  )
  assert.equal(
    getRegistrationObservationAttendanceAvailability(
      { ...scheduled, status: "attended_feedback_pending" },
      Date.parse(scheduled.startsAt),
    ),
    false,
  )
})

test("management decisions continue from a Chat-confirmed attendance without an app feedback submit", async () => {
  const {
    buildRegistrationObservationDecisionPlan,
    createRegistrationObservationFeedbackPanelState,
    updateRegistrationObservationDecisionDraft,
  } = await loadPanelModel()
  const pending = {
    ...detail,
    status: "attended_feedback_pending",
    feedbackRevision: 0,
    suitabilityResult: null,
    feedbackReason: null,
    feedbackSubmittedAt: null,
    feedbackSubmittedByName: null,
    proxySubmitted: false,
  }
  let state = createRegistrationObservationFeedbackPanelState(pending)
  assert.equal(state.decisionKind, "", "a director decision must never be preselected")
  assert.equal(buildRegistrationObservationDecisionPlan(state, "decision-1").ok, false)

  state = updateRegistrationObservationDecisionDraft(state, "waiting_current_class")
  assert.deepEqual(JSON.parse(JSON.stringify(
    buildRegistrationObservationDecisionPlan(state, "decision-1"),
  )), {
    ok: true,
    input: {
      observationId: IDS.observation,
      decisionKind: "waiting_current_class",
      waitingClassId: IDS.class,
      expectedObservationRevision: 2,
      expectedFeedbackRevision: 0,
      expectedTrackWorkflowRevision: 9,
      requestKey: "decision-1",
    },
  })

  for (const allowedStatus of ["attended_feedback_pending", "completed", "no_show"]) {
    const allowed = updateRegistrationObservationDecisionDraft(
      createRegistrationObservationFeedbackPanelState({ ...pending, status: allowedStatus }),
      "not_registered",
    )
    assert.equal(buildRegistrationObservationDecisionPlan(allowed, allowedStatus).ok, true)
  }
  for (const blockedStatus of ["scheduled", "canceled"]) {
    const blocked = updateRegistrationObservationDecisionDraft(
      createRegistrationObservationFeedbackPanelState({ ...pending, status: blockedStatus }),
      "not_registered",
    )
    assert.equal(buildRegistrationObservationDecisionPlan(blocked, blockedStatus).ok, false)
  }
})

test("decision duplicate clicks call one dedicated RPC and never a feedback mutation", async () => {
  const {
    createRegistrationObservationFeedbackPanelState,
    executeRegistrationObservationDecision,
    updateRegistrationObservationDecisionDraft,
  } = await loadPanelModel()
  const pendingDecision = new Promise(() => {})
  let decisionCalls = 0
  let savedCalls = 0
  const state = updateRegistrationObservationDecisionDraft(
    createRegistrationObservationFeedbackPanelState(detail),
    "not_registered",
  )
  const guard = { current: false }
  const actions = {
    decideRegistrationObservation: async () => {
      decisionCalls += 1
      return pendingDecision
    },
  }

  const first = executeRegistrationObservationDecision({
    state,
    actions,
    requestKey: "decision-duplicate-1",
    guard,
    onSaved: () => { savedCalls += 1 },
  })
  const second = await executeRegistrationObservationDecision({
    state,
    actions,
    requestKey: "decision-duplicate-2",
    guard,
    onSaved: () => { savedCalls += 1 },
  })

  assert.deepEqual({ ...second }, { kind: "ignored" })
  assert.equal(decisionCalls, 1)
  assert.equal(savedCalls, 0)
  assert.equal(guard.current, true)
  void first
})

test("manager history stays mounted but no role receives feedback edit capabilities", async () => {
  const {
    canKeepRegistrationObservationFeedbackHistoryMounted,
    getRegistrationObservationFeedbackMountPlan,
    shouldMountRegistrationObservationFeedbackOnly,
  } = await loadPanelModel()
  assert.equal(canKeepRegistrationObservationFeedbackHistoryMounted({
    canManageCase: true,
    observationAttemptCount: 1,
  }), true)
  assert.equal(canKeepRegistrationObservationFeedbackHistoryMounted({
    canManageCase: false,
    observationAttemptCount: 1,
  }), false)
  assert.equal(shouldMountRegistrationObservationFeedbackOnly({
    historyOnly: true,
    workflowActionable: false,
  }), true)
  assert.deepEqual({ ...getRegistrationObservationFeedbackMountPlan({
    managerDetail: {
      currentObservation: { observationId: IDS.observation },
      latestDecisionObservation: null,
    },
    canManageObservation: true,
    canManageCase: false,
  }) }, {
    observationId: IDS.observation,
    historyOnly: false,
  })
  assert.deepEqual({ ...getRegistrationObservationFeedbackMountPlan({
    managerDetail: {
      currentObservation: null,
      latestDecisionObservation: { observationId: IDS.observation },
    },
    canManageObservation: true,
    canManageCase: true,
  }) }, {
    observationId: IDS.observation,
    historyOnly: true,
  })
})

test("legacy feedback provenance remains readable with deterministic KST", async () => {
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
    proxySubmitted: false,
    feedbackSubmittedByName: "운영 담당자",
    feedbackSubmittedAt: "2026-08-12T10:05:00.000Z",
  }), null)
})

test("stale reload remains bounded and retryable", async () => {
  const { executeRegistrationObservationFeedbackReload } = await loadPanelModel()
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

test("panel source exposes history, attendance, and decisions without feedback form mutations", async () => {
  const source = await readFile(panelUrl, "utf8")

  assert.match(source, /기존 피드백 기록/)
  assert.match(source, /state\.detail\.feedbackReason/)
  assert.match(source, /recordRegistrationObservationAttendance/)
  assert.match(source, /decideRegistrationObservation/)
  assert.match(source, /Google Chat/)
  assert.doesNotMatch(source, /SubmitRegistrationObservationFeedbackInput/)
  assert.doesNotMatch(source, /CorrectRegistrationObservationFeedbackInput/)
  assert.doesNotMatch(source, /피드백 저장|피드백 정정/)
  assert.doesNotMatch(source, /<Textarea/)
})
