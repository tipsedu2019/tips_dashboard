import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { getRegistrationObservationFeedbackErrorState } from "../src/features/tasks/registration-observation-model.ts"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../", import.meta.url)
const pageUrl = new URL(
  "src/app/admin/registration/observations/[observationId]/feedback/page.tsx",
  root,
)
const panelUrl = new URL(
  "src/features/tasks/registration-observation-teacher-feedback.tsx",
  root,
)
const adminLayoutUrl = new URL("src/app/admin/layout.tsx", root)

const IDS = Object.freeze({
  observation: "10000000-0000-4000-8000-000000000003",
  task: "10000000-0000-4000-8000-000000000002",
  track: "10000000-0000-4000-8000-000000000001",
  appointment: "10000000-0000-4000-8000-000000000004",
  class: "10000000-0000-4000-8000-000000000005",
  lesson: "10000000-0000-4000-8000-000000000006",
})

const scheduledDetail = Object.freeze({
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
  sourceRevision: {
    authority: "normalized",
    sessionId: IDS.lesson,
    revision: 3,
  },
  startsAt: "2026-08-12T09:00:00.000Z",
  endsAt: "2026-08-12T10:00:00.000Z",
  classroomName: "본관 301호",
  teacherName: "강부희",
  status: "scheduled",
  attendance: null,
  suitabilityResult: null,
  feedbackReason: null,
  proxySubmitted: false,
  feedbackSubmittedByName: null,
  feedbackSubmittedAt: null,
  revision: 4,
  feedbackRevision: 0,
  appointmentNotificationRevision: 7,
  trackWorkflowRevision: 9,
  decisionKind: null,
})

const pendingDetail = Object.freeze({
  ...scheduledDetail,
  status: "attended_feedback_pending",
  attendance: "attended",
  revision: 5,
})

const completedDetail = Object.freeze({
  ...pendingDetail,
  status: "completed",
  suitabilityResult: "fit",
  feedbackReason: "수업 참여와 이해도가 좋습니다.",
  feedbackSubmittedByName: "강부희",
  feedbackSubmittedAt: "2026-08-12T10:05:00.000Z",
  revision: 6,
  feedbackRevision: 1,
})

const proxyDetail = Object.freeze({
  ...completedDetail,
  proxySubmitted: true,
  feedbackSubmittedByName: "운영 담당자",
})

const emptyDraft = Object.freeze({ suitabilityResult: "", feedbackReason: "" })
const completedDraft = Object.freeze({
  suitabilityResult: "fit",
  feedbackReason: " 수업 참여와 이해도가 좋습니다. ",
})

async function readSource(url) {
  return readFile(url, "utf8").catch(() => "")
}

async function loadTsxRuntime(url, overrides = {}) {
  const source = await readSource(url)
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText
  const runtimeModule = { exports: {} }
  const runtimeRequire = (specifier) => (
    Object.prototype.hasOwnProperty.call(overrides, specifier)
      ? overrides[specifier]
      : require(specifier)
  )
  const factory = vm.runInThisContext(
    `(function(require, module, exports) {${output}\n})`,
    { filename: url.pathname },
  )
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

async function loadTeacherModel() {
  const source = await readSource(panelUrl)
  const startMarker = "// registration-observation-teacher-feedback-model:start"
  const endMarker = "// registration-observation-teacher-feedback-model:end"
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, "teacher feedback model start marker must exist")
  assert.ok(end > start, "teacher feedback model end marker must follow start")
  const compiled = ts.transpileModule(
    `${source.slice(start + startMarker.length, end)}\nmodule.exports = {
      buildRegistrationObservationTeacherFeedbackPlan,
      executeRegistrationObservationTeacherFeedbackLoad,
      executeRegistrationObservationTeacherFeedbackMutation,
      getRegistrationObservationTeacherFeedbackAvailability,
      getRegistrationObservationTeacherFeedbackNextBoundary,
      getRegistrationObservationTeacherProxyLabel,
    };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    Date,
    JSON,
    Map,
    Promise,
  })
  return sandboxModule.exports
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function withoutProps(input, names) {
  const output = { ...input }
  for (const name of names) delete output[name]
  return output
}

function Button({ children, ...props }) {
  return createElement(
    "button",
    withoutProps(props, ["variant", "size", "asChild"]),
    children,
  )
}

function Label({ children, ...props }) {
  return createElement("label", props, children)
}

function Textarea({ value, ...props }) {
  return createElement("textarea", {
    ...withoutProps(props, ["onChange"]),
    defaultValue: value,
  })
}

function RegistrationSelect({ value, options = [], ...props }) {
  return createElement(
    "select",
    {
      ...withoutProps(props, ["onValueChange", "placeholder"]),
      defaultValue: value,
    },
    options.map((option) => createElement(
      "option",
      { key: option.value, value: option.value },
      option.label,
    )),
  )
}

async function loadTeacherView() {
  return loadTsxRuntime(panelUrl, {
    "@/components/ui/button": { Button },
    "@/components/ui/label": { Label },
    "@/components/ui/textarea": { Textarea },
    "@/features/tasks/registration-select": { RegistrationSelect },
    "@/lib/supabase": { supabase: {} },
    "@/providers/auth-provider": {
      useAuth: () => ({
        canManageAll: false,
        session: { user: { id: "10000000-0000-4000-8000-000000000020" } },
      }),
    },
    "./registration-observation-model": {
      getRegistrationObservationFeedbackErrorState,
    },
    "./registration-observation-service": {
      loadRegistrationObservationFeedback: async () => scheduledDetail,
      recordRegistrationObservationAttendance: async () => pendingDetail,
      submitRegistrationObservationFeedback: async () => completedDetail,
    },
  })
}

function viewProps(overrides = {}) {
  return {
    detail: scheduledDetail,
    draft: completedDraft,
    loading: false,
    saving: false,
    errorMessage: "",
    fieldError: null,
    reloadRequired: false,
    receipt: "",
    nowMs: Date.parse(scheduledDetail.endsAt),
    canRecordAttendance: false,
    suitabilityRef: { current: null },
    feedbackReasonRef: { current: null },
    errorRef: { current: null },
    onDraftChange: () => {},
    onSubmit: () => {},
    onNoShow: () => {},
    onRecordAttendance: () => {},
    onReload: () => {},
    ...overrides,
  }
}

test("teacher feedback route validates the UUID segment and stays under the admin auth guard", async () => {
  const notFoundError = new Error("NEXT_NOT_FOUND")
  function TeacherRouteStub() {
    return null
  }
  const pageRuntime = await loadTsxRuntime(pageUrl, {
    "next/navigation": { notFound: () => { throw notFoundError } },
    "@/features/tasks/registration-observation-teacher-feedback": {
      RegistrationObservationTeacherFeedback: TeacherRouteStub,
    },
  })
  assert.equal(pageRuntime.isRegistrationObservationFeedbackId(IDS.observation), true)
  assert.equal(pageRuntime.isRegistrationObservationFeedbackId(IDS.observation.toUpperCase()), true)
  for (const malformed of ["", "not-a-uuid", `${IDS.observation}/extra`, "10000000-0000-4000-8000-00000000003"]) {
    assert.equal(pageRuntime.isRegistrationObservationFeedbackId(malformed), false)
    await assert.rejects(
      pageRuntime.default({ params: Promise.resolve({ observationId: malformed }) }),
      (error) => error === notFoundError,
    )
  }
  const element = await pageRuntime.default({
    params: Promise.resolve({ observationId: IDS.observation }),
  })
  assert.equal(element.type, TeacherRouteStub)
  assert.deepEqual(element.props, { observationId: IDS.observation })

  const adminLayoutSource = await readSource(adminLayoutUrl)
  assert.match(adminLayoutSource, /<AuthGuard>[\s\S]*\{children\}[\s\S]*<\/AuthGuard>/)
})

test("teacher feedback route uses only the dedicated feedback client and never reaches registration, decision, enrollment, or providers", async () => {
  const pageSource = await readSource(pageUrl)
  const panelSource = await readSource(panelUrl)
  assert.match(pageSource, /RegistrationObservationTeacherFeedback/)
  assert.match(panelSource, /loadRegistrationObservationFeedback/)
  assert.match(panelSource, /recordRegistrationObservationAttendance/)
  assert.match(panelSource, /submitRegistrationObservationFeedback/)
  assert.doesNotMatch(
    `${pageSource}\n${panelSource}`,
    /loadRegistrationCaseDetail|loadRegistrationObservationManager|ops_tasks|parentPhone|studentPhone|schoolName|inquiry|sibling|decideRegistrationObservation|correctRegistrationObservationFeedback|saveRegistrationEnrollmentRows|RegistrationAdmissionPanel|SOLAPI|google_chat|notification-worker|access_token|\/api\//i,
  )
})

test("assigned load succeeds while unrelated and missing observations expose the same bounded not-found result", async () => {
  const { executeRegistrationObservationTeacherFeedbackLoad } = await loadTeacherModel()
  const assigned = await executeRegistrationObservationTeacherFeedbackLoad({
    requestedOwnershipKey: `teacher-a:${IDS.observation}`,
    currentOwnershipKey: () => `teacher-a:${IDS.observation}`,
    load: async () => scheduledDetail,
    normalizeError: getRegistrationObservationFeedbackErrorState,
  })
  assert.equal(assigned.kind, "loaded")
  assert.deepEqual({ ...assigned.detail }, scheduledDetail)

  const outcomes = []
  for (const error of [
    { code: "P0002", message: "registration_observation_not_found" },
    { code: "P0002", message: "registration_observation_not_found", details: "missing row" },
  ]) {
    outcomes.push(await executeRegistrationObservationTeacherFeedbackLoad({
      requestedOwnershipKey: `teacher-b:${IDS.observation}`,
      currentOwnershipKey: () => `teacher-b:${IDS.observation}`,
      load: async () => { throw error },
      normalizeError: getRegistrationObservationFeedbackErrorState,
    }))
  }
  assert.deepEqual(outcomes.map((outcome) => ({ ...outcome })), [
    {
      kind: "failed",
      errorMessage: "청강 피드백을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      reloadRequired: false,
    },
    {
      kind: "failed",
      errorMessage: "청강 피드백을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      reloadRequired: false,
    },
  ])
  assert.doesNotMatch(outcomes[0].errorMessage, /registration_|P0002|missing row/)
})

test("load completion is owned by the exact actor and observation route", async () => {
  const { executeRegistrationObservationTeacherFeedbackLoad } = await loadTeacherModel()
  const response = deferred()
  let currentOwner = `teacher-a:${IDS.observation}`
  const loading = executeRegistrationObservationTeacherFeedbackLoad({
    requestedOwnershipKey: currentOwner,
    currentOwnershipKey: () => currentOwner,
    load: () => response.promise,
    normalizeError: getRegistrationObservationFeedbackErrorState,
  })
  currentOwner = `teacher-b:${IDS.observation}`
  response.resolve(scheduledDetail)
  assert.deepEqual({ ...await loading }, { kind: "stale" })
})

test("proxy label requires the complete server-projected proxy tuple", async () => {
  const { getRegistrationObservationTeacherProxyLabel } = await loadTeacherModel()
  assert.equal(
    getRegistrationObservationTeacherProxyLabel(proxyDetail),
    "대리 입력 · 운영 담당자 · 2026. 8. 12. 19:05",
  )
  for (const detail of [
    { ...proxyDetail, proxySubmitted: false },
    { ...proxyDetail, feedbackSubmittedByName: null },
    { ...proxyDetail, feedbackSubmittedAt: null },
  ]) {
    assert.equal(getRegistrationObservationTeacherProxyLabel(detail), null)
  }
})

test("scheduled and attended-feedback-pending actions use separate canonical start and end boundaries", async () => {
  const {
    getRegistrationObservationTeacherFeedbackAvailability,
    getRegistrationObservationTeacherFeedbackNextBoundary,
  } = await loadTeacherModel()
  const beforeStart = Date.parse(scheduledDetail.startsAt) - 1
  const atStart = Date.parse(scheduledDetail.startsAt)
  const beforeEnd = Date.parse(scheduledDetail.endsAt) - 1
  const atEnd = Date.parse(scheduledDetail.endsAt)

  assert.deepEqual(
    { ...getRegistrationObservationTeacherFeedbackAvailability(scheduledDetail, beforeStart) },
    { submitFeedback: false, submitNoShow: false, recordAttendance: false },
  )
  assert.deepEqual(
    { ...getRegistrationObservationTeacherFeedbackAvailability(scheduledDetail, atStart) },
    { submitFeedback: false, submitNoShow: true, recordAttendance: true },
  )
  assert.deepEqual(
    { ...getRegistrationObservationTeacherFeedbackAvailability(scheduledDetail, atEnd) },
    { submitFeedback: true, submitNoShow: true, recordAttendance: true },
  )
  assert.deepEqual(
    { ...getRegistrationObservationTeacherFeedbackAvailability(pendingDetail, beforeEnd) },
    { submitFeedback: false, submitNoShow: false, recordAttendance: false },
  )
  assert.deepEqual(
    { ...getRegistrationObservationTeacherFeedbackAvailability(pendingDetail, atEnd) },
    { submitFeedback: true, submitNoShow: false, recordAttendance: false },
  )
  assert.equal(
    getRegistrationObservationTeacherFeedbackNextBoundary(scheduledDetail, beforeStart),
    Date.parse(scheduledDetail.startsAt),
  )
  assert.equal(
    getRegistrationObservationTeacherFeedbackNextBoundary(scheduledDetail, atStart),
    Date.parse(scheduledDetail.endsAt),
  )
  assert.equal(
    getRegistrationObservationTeacherFeedbackNextBoundary(pendingDetail, beforeEnd),
    Date.parse(pendingDetail.endsAt),
  )
  assert.equal(
    getRegistrationObservationTeacherFeedbackNextBoundary(pendingDetail, atEnd),
    null,
  )
  assert.doesNotMatch(await readSource(panelUrl), /setInterval\(/)
})

test("teacher plans map each action to the exact revision tuple without a director decision", async () => {
  const { buildRegistrationObservationTeacherFeedbackPlan } = await loadTeacherModel()
  const nowMs = Date.parse(scheduledDetail.endsAt)
  const feedback = buildRegistrationObservationTeacherFeedbackPlan({
    detail: scheduledDetail,
    draft: completedDraft,
    action: "submit_feedback",
    nowMs,
    allowAttendanceOnly: false,
  })
  assert.deepEqual({ ...feedback, input: { ...feedback.input } }, {
    ok: true,
    kind: "submit_feedback",
    input: {
      observationId: IDS.observation,
      attendance: "attended",
      suitabilityResult: "fit",
      feedbackReason: "수업 참여와 이해도가 좋습니다.",
      expectedObservationRevision: 4,
      expectedFeedbackRevision: 0,
      expectedAppointmentNotificationRevision: 7,
    },
  })
  const pendingFeedback = buildRegistrationObservationTeacherFeedbackPlan({
    detail: pendingDetail,
    draft: { suitabilityResult: "unfit", feedbackReason: " 현재 반보다 기초 보강이 필요합니다. " },
    action: "submit_feedback",
    nowMs,
    allowAttendanceOnly: false,
  })
  assert.deepEqual({ ...pendingFeedback, input: { ...pendingFeedback.input } }, {
    ok: true,
    kind: "submit_feedback",
    input: {
      observationId: IDS.observation,
      attendance: "attended",
      suitabilityResult: "unfit",
      feedbackReason: "현재 반보다 기초 보강이 필요합니다.",
      expectedObservationRevision: 5,
      expectedFeedbackRevision: 0,
      expectedAppointmentNotificationRevision: 7,
    },
  })
  const noShow = buildRegistrationObservationTeacherFeedbackPlan({
    detail: scheduledDetail,
    draft: emptyDraft,
    action: "no_show",
    nowMs,
    allowAttendanceOnly: false,
  })
  assert.deepEqual({ ...noShow, input: { ...noShow.input } }, {
    ok: true,
    kind: "submit_feedback",
    input: {
      observationId: IDS.observation,
      attendance: "no_show",
      suitabilityResult: null,
      feedbackReason: null,
      expectedObservationRevision: 4,
      expectedFeedbackRevision: 0,
      expectedAppointmentNotificationRevision: 7,
    },
  })
  const attendance = buildRegistrationObservationTeacherFeedbackPlan({
    detail: scheduledDetail,
    draft: emptyDraft,
    action: "record_attendance",
    nowMs: Date.parse(scheduledDetail.startsAt),
    allowAttendanceOnly: true,
  })
  assert.deepEqual({ ...attendance, input: { ...attendance.input } }, {
    ok: true,
    kind: "record_attendance",
    input: {
      observationId: IDS.observation,
      expectedObservationRevision: 4,
      expectedAppointmentNotificationRevision: 7,
    },
  })
  assert.equal(buildRegistrationObservationTeacherFeedbackPlan({
    detail: scheduledDetail,
    draft: emptyDraft,
    action: "record_attendance",
    nowMs,
    allowAttendanceOnly: false,
  }).ok, false)
})

test("validation focuses suitability before reason and trims the required reason", async () => {
  const { executeRegistrationObservationTeacherFeedbackMutation } = await loadTeacherModel()
  const focused = []
  const common = {
    detail: scheduledDetail,
    action: "submit_feedback",
    nowMs: Date.parse(scheduledDetail.endsAt),
    allowAttendanceOnly: false,
    guard: { current: false },
    requestKeys: new Map(),
    createRequestKey: () => "request-unused",
    currentOwnershipMatches: () => true,
    recordAttendance: async () => pendingDetail,
    submitFeedback: async () => completedDetail,
    normalizeError: getRegistrationObservationFeedbackErrorState,
    onSaving: () => {},
    onSaved: () => {},
    focusField: (field) => focused.push(field),
  }
  const missingSuitability = await executeRegistrationObservationTeacherFeedbackMutation({
    ...common,
    draft: emptyDraft,
  })
  assert.deepEqual({ ...missingSuitability }, {
    kind: "invalid",
    errorMessage: "적합 여부를 선택하세요.",
    field: "suitabilityResult",
  })
  const missingReason = await executeRegistrationObservationTeacherFeedbackMutation({
    ...common,
    draft: { suitabilityResult: "unfit", feedbackReason: "   " },
  })
  assert.deepEqual({ ...missingReason }, {
    kind: "invalid",
    errorMessage: "피드백 사유를 입력하세요.",
    field: "feedbackReason",
  })
  assert.deepEqual(focused, ["suitabilityResult", "feedbackReason"])
})

test("mutation execution blocks duplicate submits, keeps a failed request key stable, and ignores stale ownership completion", async () => {
  const { executeRegistrationObservationTeacherFeedbackMutation } = await loadTeacherModel()
  const response = deferred()
  const guard = { current: false }
  const requestKeys = new Map()
  const seenKeys = []
  let generated = 0
  let ownerMatches = true
  let savedCalls = 0
  const common = {
    detail: scheduledDetail,
    draft: completedDraft,
    action: "submit_feedback",
    nowMs: Date.parse(scheduledDetail.endsAt),
    allowAttendanceOnly: false,
    guard,
    requestKeys,
    createRequestKey: () => `feedback-request-${++generated}`,
    currentOwnershipMatches: () => ownerMatches,
    recordAttendance: async () => pendingDetail,
    normalizeError: getRegistrationObservationFeedbackErrorState,
    onSaving: () => {},
    onSaved: () => { savedCalls += 1 },
    focusField: () => {},
  }
  const first = executeRegistrationObservationTeacherFeedbackMutation({
    ...common,
    submitFeedback: async (input) => {
      seenKeys.push(input.requestKey)
      return response.promise
    },
  })
  assert.deepEqual(
    { ...await executeRegistrationObservationTeacherFeedbackMutation({
      ...common,
      submitFeedback: async () => completedDetail,
    }) },
    { kind: "ignored" },
  )
  ownerMatches = false
  response.resolve(completedDetail)
  assert.deepEqual({ ...await first }, { kind: "stale" })
  assert.equal(savedCalls, 0)
  assert.deepEqual(seenKeys, ["feedback-request-1"])

  ownerMatches = true
  const rawServerError = {
    code: "55000",
    message: "registration_observation_time_boundary_rejected",
    details: "dashboard_private secret",
  }
  const failed = await executeRegistrationObservationTeacherFeedbackMutation({
    ...common,
    submitFeedback: async (input) => {
      seenKeys.push(input.requestKey)
      throw rawServerError
    },
  })
  assert.deepEqual({ ...failed }, {
    kind: "failed",
    errorMessage: "청강 피드백을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    reloadRequired: false,
  })
  const committed = await executeRegistrationObservationTeacherFeedbackMutation({
    ...common,
    submitFeedback: async (input) => {
      seenKeys.push(input.requestKey)
      return completedDetail
    },
  })
  assert.equal(committed.kind, "committed")
  assert.equal(committed.detail, completedDetail)
  assert.deepEqual(seenKeys, [
    "feedback-request-1",
    "feedback-request-1",
    "feedback-request-1",
  ])
  assert.equal(savedCalls, 1)
  assert.equal(requestKeys.size, 0)
  assert.doesNotMatch(failed.errorMessage, /registration_|dashboard_private|55000/)
})

test("browser boundary guidance cannot turn a server-rejected mutation into a committed result", async () => {
  const { executeRegistrationObservationTeacherFeedbackMutation } = await loadTeacherModel()
  const result = await executeRegistrationObservationTeacherFeedbackMutation({
    detail: scheduledDetail,
    draft: completedDraft,
    action: "submit_feedback",
    nowMs: Date.parse(scheduledDetail.endsAt) + 60_000,
    allowAttendanceOnly: false,
    guard: { current: false },
    requestKeys: new Map(),
    createRequestKey: () => "server-boundary-request",
    currentOwnershipMatches: () => true,
    recordAttendance: async () => pendingDetail,
    submitFeedback: async () => {
      throw { code: "55000", message: "registration_observation_time_boundary_rejected" }
    },
    normalizeError: getRegistrationObservationFeedbackErrorState,
    onSaving: () => {},
    onSaved: () => { throw new Error("must not save") },
    focusField: () => {},
  })
  assert.equal(result.kind, "failed")
})

test("rendered teacher view is a keyboard form with loading and independently disabled actions", async () => {
  const { RegistrationObservationTeacherFeedbackView } = await loadTeacherView()
  const loadingHtml = renderToStaticMarkup(createElement(
    RegistrationObservationTeacherFeedbackView,
    viewProps({ detail: null, loading: true }),
  ))
  assert.match(loadingHtml, /role="status"/)
  assert.match(loadingHtml, /청강 피드백을 불러오는 중/)
  assert.doesNotMatch(loadingHtml, /data-action=/)

  const beforeStartHtml = renderToStaticMarkup(createElement(
    RegistrationObservationTeacherFeedbackView,
    viewProps({
      nowMs: Date.parse(scheduledDetail.startsAt) - 1,
      canRecordAttendance: true,
    }),
  ))
  assert.match(beforeStartHtml, /<form[^>]*>/)
  assert.match(beforeStartHtml, /data-action="submit_feedback"[^>]*type="submit"[^>]*disabled=""/)
  assert.match(beforeStartHtml, /data-action="no_show"[^>]*disabled=""/)
  assert.match(beforeStartHtml, /data-action="record_attendance"[^>]*disabled=""/)

  const afterStartHtml = renderToStaticMarkup(createElement(
    RegistrationObservationTeacherFeedbackView,
    viewProps({
      nowMs: Date.parse(scheduledDetail.startsAt),
      canRecordAttendance: true,
    }),
  ))
  assert.match(afterStartHtml, /data-action="submit_feedback"[^>]*type="submit"[^>]*disabled=""/)
  assert.doesNotMatch(afterStartHtml, /data-action="no_show"[^>]*disabled=/)
  assert.doesNotMatch(afterStartHtml, /data-action="record_attendance"[^>]*disabled=/)

  const savingHtml = renderToStaticMarkup(createElement(
    RegistrationObservationTeacherFeedbackView,
    viewProps({ saving: true, canRecordAttendance: true }),
  ))
  assert.match(savingHtml, /id="teacher-feedback-suitability"[^>]*disabled=""/)
  assert.match(savingHtml, /id="teacher-feedback-reason"[^>]*disabled=""/)
  for (const action of ["submit_feedback", "no_show", "record_attendance"]) {
    assert.match(savingHtml, new RegExp(`data-action="${action}"[^>]*disabled=""`))
  }
})

test("rendered 390px and 200% layout contract avoids fixed-width overflow and hides internal identifiers", async () => {
  const { RegistrationObservationTeacherFeedbackView } = await loadTeacherView()
  const html = renderToStaticMarkup(createElement(
    RegistrationObservationTeacherFeedbackView,
    viewProps({ detail: proxyDetail, nowMs: Date.parse(proxyDetail.endsAt) }),
  ))
  assert.match(html, /data-testid="registration-observation-teacher-feedback"[^>]*class="[^"]*w-full[^"]*min-w-0[^"]*overflow-x-hidden/)
  assert.match(html, /class="[^"]*grid-cols-1[^"]*sm:grid-cols-2/)
  assert.match(html, /class="[^"]*break-words/)
  assert.match(html, /대리 입력 · 운영 담당자 · 2026\. 8\. 12\. 19:05/)
  assert.doesNotMatch(html, new RegExp([IDS.task, IDS.track, IDS.appointment, IDS.class, IDS.lesson].join("|")))
  assert.doesNotMatch(html, /min-w-\[|w-\[(?:[4-9]\d\d|\d{4,})px\]|overflow-x-auto/)
})
