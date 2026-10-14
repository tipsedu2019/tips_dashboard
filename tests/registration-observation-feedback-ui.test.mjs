import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const panelPath = "src/features/tasks/registration-observation-feedback-panel.tsx"
const panelUrl = new URL(`../${panelPath}`, import.meta.url)

const detail = Object.freeze({
  observationId: "10000000-0000-4000-8000-000000000003",
  taskId: "10000000-0000-4000-8000-000000000002",
  trackId: "10000000-0000-4000-8000-000000000001",
  appointmentId: "10000000-0000-4000-8000-000000000004",
  studentName: "합성 학생",
  studentGrade: "고1",
  subject: "영어",
  classId: "10000000-0000-4000-8000-000000000005",
  className: "합성 영어반",
  sessionAuthority: "normalized",
  sessionDate: "2026-08-12",
  sessionKey: "2026-08-12:lesson-1",
  classLessonSessionId: "10000000-0000-4000-8000-000000000006",
  legacySessionKey: null,
  sourceRevision: { authority: "normalized", sessionId: "10000000-0000-4000-8000-000000000006", revision: 3 },
  startsAt: "2026-08-12T09:00:00.000Z",
  endsAt: "2026-08-12T10:00:00.000Z",
  classroomName: "합성 강의실",
  teacherName: "합성 교사",
  status: "completed",
  attendance: "attended",
  suitabilityResult: "fit",
  feedbackReason: "합성 참여 기록\n합성 이해도 기록",
  proxySubmitted: true,
  feedbackSubmittedByName: "합성 운영자",
  feedbackSubmittedAt: "2026-08-12T10:05:00.000Z",
  revision: 2,
  feedbackRevision: 1,
  appointmentNotificationRevision: 1,
  trackWorkflowRevision: 9,
  decisionKind: "enrollment",
})

function loadPanel() {
  return loadNotificationComponent(panelPath)
}

test("actual history panel preserves legacy attendance, decisions, reason, and provenance without writes", (t) => {
  const transport = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected observation transport") })
  const { RegistrationObservationFeedbackPanel } = loadPanel()
  const markup = renderToStaticMarkup(createElement(RegistrationObservationFeedbackPanel, { detail }))

  assert.match(markup, /기존 청강 이력/)
  assert.match(markup, /합성 영어반/)
  assert.match(markup, /합성 교사/)
  assert.match(markup, /출석 이력<\/dt><dd>참석<\/dd>/)
  assert.match(markup, /원장 결정<\/dt><dd>등록<\/dd>/)
  assert.match(markup, /기존 피드백 기록/)
  assert.match(markup, /적합 여부<\/dt><dd>적합<\/dd>/)
  assert.ok(markup.includes(detail.feedbackReason), "the historical reason retains its line breaks")
  assert.match(markup, /대리 입력 · 합성 운영자 · 2026\. 8\. 12\. 19:05/)
  assert.doesNotMatch(markup, /<(?:button|select|input|textarea|form)\b|role="combobox"/)
  assert.doesNotMatch(markup, /Google Chat|결정 저장|피드백 저장|피드백 정정|수업 시작 후 참석/)
  assert.equal(transport.mock.callCount(), 0)
})

test("every historical observation status renders facts without reviving confirmation or decision controls", (t) => {
  const transport = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected observation transport") })
  const { RegistrationObservationFeedbackPanel } = loadPanel()
  for (const status of ["scheduled", "attended_feedback_pending", "completed", "no_show", "canceled"]) {
    const historical = {
      ...detail,
      status,
      attendance: status === "scheduled" || status === "canceled" ? null : status === "no_show" ? "no_show" : "attended",
      decisionKind: null,
      suitabilityResult: null,
      feedbackReason: null,
      feedbackSubmittedAt: null,
      feedbackSubmittedByName: null,
      proxySubmitted: false,
    }
    const markup = renderToStaticMarkup(createElement(RegistrationObservationFeedbackPanel, { detail: historical }))
    assert.match(markup, /기존 청강 이력/, status)
    assert.match(markup, /원장 결정<\/dt><dd>미결정<\/dd>/, status)
    assert.match(markup, new RegExp(`출석 이력<\\/dt><dd>${historical.attendance === "attended" ? "참석" : historical.attendance === "no_show" ? "불참" : "미확인"}<\\/dd>`), status)
    assert.doesNotMatch(markup, /<(?:button|select|input|textarea|form)\b|role="combobox"/, status)
    assert.doesNotMatch(markup, /기존 피드백 기록|Google Chat|결정 저장|피드백 저장|피드백 정정/, status)
  }
  assert.equal(transport.mock.callCount(), 0)
})

test("historical decision variants remain readable", () => {
  const { RegistrationObservationFeedbackPanel } = loadPanel()
  const decisions = {
    enrollment: "등록",
    waiting_current_class: "현재반 대기",
    waiting_new_class: "신규반 대기",
    waiting_next_opening: "다음 개강 대기",
    not_registered: "미등록",
    re_observation: "재청강",
  }
  for (const [decisionKind, label] of Object.entries(decisions)) {
    const markup = renderToStaticMarkup(createElement(RegistrationObservationFeedbackPanel, {
      detail: { ...detail, decisionKind },
    }))
    assert.match(markup, new RegExp(`원장 결정<\\/dt><dd>${label}<\\/dd>`), decisionKind)
  }
})

test("history mount ownership remains bounded to authorized case detail", () => {
  const {
    getRegistrationObservationFeedbackMountPlan,
    shouldMountRegistrationObservationFeedbackOnly,
  } = loadPanel()
  assert.equal(shouldMountRegistrationObservationFeedbackOnly({ historyOnly: true, workflowActionable: false }), true)
  assert.equal(shouldMountRegistrationObservationFeedbackOnly({ historyOnly: true, workflowActionable: true }), false)
  const managerDetail = {
    currentObservation: { observationId: detail.observationId },
    latestDecisionObservation: { observationId: "historical-observation" },
  }
  assert.deepEqual(getRegistrationObservationFeedbackMountPlan({ managerDetail, canManageObservation: true, canManageCase: false }), {
    observationId: detail.observationId, historyOnly: false,
  })
  assert.deepEqual(getRegistrationObservationFeedbackMountPlan({
    managerDetail: { ...managerDetail, currentObservation: null }, canManageObservation: true, canManageCase: true,
  }), { observationId: "historical-observation", historyOnly: true })
  assert.equal(getRegistrationObservationFeedbackMountPlan({ managerDetail, canManageObservation: false, canManageCase: true }), null)
  assert.equal(getRegistrationObservationFeedbackMountPlan({
    managerDetail: { ...managerDetail, currentObservation: null }, canManageObservation: true, canManageCase: false,
  }), null)
  assert.equal(getRegistrationObservationFeedbackMountPlan({ managerDetail: null, canManageObservation: true, canManageCase: true }), null)
})

test("legacy feedback provenance uses deterministic KST and omits incomplete proxy attribution", () => {
  const { formatRegistrationObservationFeedbackKst, getRegistrationObservationProxyLabel } = loadPanel()
  assert.equal(formatRegistrationObservationFeedbackKst("2026-08-12T10:05:00.000Z"), "2026. 8. 12. 19:05")
  assert.equal(formatRegistrationObservationFeedbackKst("invalid"), "")
  assert.equal(getRegistrationObservationProxyLabel(detail), "대리 입력 · 합성 운영자 · 2026. 8. 12. 19:05")
  for (const overrides of [
    { proxySubmitted: false }, { feedbackSubmittedByName: " " }, { feedbackSubmittedAt: null }, { feedbackSubmittedAt: "invalid" },
  ]) assert.equal(getRegistrationObservationProxyLabel({ ...detail, ...overrides }), null)
})

test("history implementation contains no retired attendance or decision write machinery", async () => {
  const source = await readFile(panelUrl, "utf8")
  assert.doesNotMatch(source, /recordRegistrationObservationAttendance|decideRegistrationObservation|submitRegistrationObservationFeedback|correctRegistrationObservationFeedback/)
  assert.doesNotMatch(source, /canRecordAttendance|canDecide|canEditFeedback|executeRegistrationObservationDecision|getRegistrationObservationAttendanceAvailability/)
  assert.doesNotMatch(source, /useReducer|useOwnedDirtyState|Google Chat|<Textarea|<RegistrationSelect/)
})
