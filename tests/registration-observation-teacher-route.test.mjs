import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { createElement } from "react"

import { getRegistrationObservationFeedbackErrorState } from "../src/features/tasks/registration-observation-model.ts"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const root = new URL("../", import.meta.url)
const pageUrl = new URL(
  "src/app/admin/registration/observations/[observationId]/feedback/page.tsx",
  root,
)
const notificationDeepLinkUrl = new URL(
  "src/features/notifications/server/notification-app-deep-link.ts",
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

let teacherModulePromise

async function loadTeacherModule() {
  if (teacherModulePromise) return teacherModulePromise
  teacherModulePromise = loadTsxRuntime(panelUrl, {
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
  return teacherModulePromise
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

function findReactElements(node, predicate, matches = []) {
  if (Array.isArray(node)) {
    for (const child of node) findReactElements(child, predicate, matches)
    return matches
  }
  if (!node || typeof node !== "object" || !("props" in node)) return matches
  if (predicate(node)) matches.push(node)
  findReactElements(node.props.children, predicate, matches)
  return matches
}

function findReactElement(node, predicate, description) {
  const matches = findReactElements(node, predicate)
  assert.equal(matches.length, 1, `expected one ${description}, received ${matches.length}`)
  return matches[0]
}

function collectReactText(node, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectReactText(child, output)
  } else if (typeof node === "string" || typeof node === "number") {
    output.push(String(node))
  } else if (node && typeof node === "object" && "props" in node) {
    collectReactText(node.props.children, output)
  }
  return output
}

function hasClass(element, className) {
  return String(element.props.className || "").split(/\s+/).includes(className)
}

function createHookHarness() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  function sameDependencies(left, right) {
    return Boolean(
      left
      && right
      && left.length === right.length
      && left.every((value, index) => Object.is(value, right[index])),
    )
  }

  function useState(initialValue) {
    const index = cursor++
    if (!slots[index]) {
      slots[index] = {
        kind: "state",
        value: typeof initialValue === "function" ? initialValue() : initialValue,
      }
    }
    const slot = slots[index]
    return [
      slot.value,
      (nextValue) => {
        slot.value = typeof nextValue === "function"
          ? nextValue(slot.value)
          : nextValue
      },
    ]
  }

  function useRef(initialValue) {
    const index = cursor++
    if (!slots[index]) slots[index] = { kind: "ref", value: { current: initialValue } }
    return slots[index].value
  }

  function memoHook(factory, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      slots[index] = {
        kind: "memo",
        value: factory(),
        dependencies,
      }
    }
    return slots[index].value
  }

  function useEffect(effect, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      pendingEffects.push({ effect, index })
      slots[index] = {
        kind: "effect",
        cleanup: slot?.cleanup,
        dependencies,
      }
    }
  }

  return {
    react: {
      useCallback: (callback, dependencies) => memoHook(() => callback, dependencies),
      useEffect,
      useMemo: memoHook,
      useRef,
      useState,
    },
    render(component, props) {
      assert.equal(pendingEffects.length, 0, "flush effects before rendering again")
      cursor = 0
      return component(props)
    },
    flushEffects() {
      const effects = pendingEffects
      pendingEffects = []
      for (const { effect, index } of effects) {
        slots[index].cleanup?.()
        slots[index].cleanup = effect()
      }
    },
    cleanup() {
      for (const slot of slots) slot?.cleanup?.()
      pendingEffects = []
    },
  }
}

function createTimerHarness() {
  let nextId = 0
  const timers = new Map()
  return {
    window: {
      setTimeout(callback) {
        const id = ++nextId
        timers.set(id, callback)
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
      },
    },
    runNext() {
      const next = timers.entries().next().value
      assert.ok(next, "expected a queued timer")
      const [id, callback] = next
      timers.delete(id)
      callback()
    },
    clear() {
      timers.clear()
    },
  }
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve))
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
  assert.deepEqual(Object.keys(pageRuntime).sort(), ["default"])

  for (const malformed of ["", "not-a-uuid", `${IDS.observation}/extra`, "10000000-0000-4000-8000-00000000003"]) {
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

test("teacher feedback route is the sole dynamic registration notification link", async () => {
  const { validateNotificationAppDeepLink } = await import(notificationDeepLinkUrl.href)
  const href = `/admin/registration/observations/${IDS.observation}/feedback`

  assert.equal(validateNotificationAppDeepLink(href, "registration"), href)
  for (const malformed of [
    `/admin/registration/observations/${IDS.observation}/feedback?taskId=${IDS.task}`,
    `${href}#result`,
    `/admin/registration/observations/${IDS.observation}/feedback/extra`,
    "/admin/registration/observations/not-a-uuid/feedback",
  ]) {
    assert.throws(() => validateNotificationAppDeepLink(malformed, "registration"))
  }
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
  const { executeRegistrationObservationTeacherFeedbackLoad } = await loadTeacherModule()
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
  const {
    executeRegistrationObservationTeacherFeedbackLoad,
    getRegistrationObservationTeacherFeedbackOwnershipKey,
    transitionRegistrationObservationTeacherFeedbackLoadState,
  } = await loadTeacherModule()
  const ownerKeys = [
    getRegistrationObservationTeacherFeedbackOwnershipKey(
      "teacher-a",
      "2026-08-12T11:00:00.000Z",
      IDS.observation,
    ),
    getRegistrationObservationTeacherFeedbackOwnershipKey(
      "teacher-b",
      "2026-08-12T11:00:00.000Z",
      IDS.observation,
    ),
    getRegistrationObservationTeacherFeedbackOwnershipKey(
      "teacher-a",
      "2026-08-12T12:00:00.000Z",
      IDS.observation,
    ),
    getRegistrationObservationTeacherFeedbackOwnershipKey(
      "teacher-a",
      "2026-08-12T11:00:00.000Z",
      "20000000-0000-4000-8000-000000000003",
    ),
  ]
  assert.equal(new Set(ownerKeys).size, 4)

  const response = deferred()
  let currentOwner = ownerKeys[0]
  const loading = executeRegistrationObservationTeacherFeedbackLoad({
    requestedOwnershipKey: currentOwner,
    currentOwnershipKey: () => currentOwner,
    load: () => response.promise,
    normalizeError: getRegistrationObservationFeedbackErrorState,
  })
  currentOwner = ownerKeys[1]
  response.resolve(scheduledDetail)
  assert.deepEqual({ ...await loading }, { kind: "stale" })

  const oldDraft = Object.freeze({
    suitabilityResult: "unfit",
    feedbackReason: "다른 세션에서 작성한 내용",
  })
  const transitioned = transitionRegistrationObservationTeacherFeedbackLoadState(
    {
      ownershipKey: ownerKeys[0],
      detail: scheduledDetail,
      draft: oldDraft,
      loading: false,
      saving: false,
      errorMessage: "",
      fieldError: null,
      reloadRequired: false,
      receipt: "",
    },
    {
      kind: "loaded",
      ownershipKey: ownerKeys[3],
      detail: scheduledDetail,
      preserveDraft: true,
    },
  )
  assert.notEqual(transitioned.draft, oldDraft)
  assert.deepEqual({ ...transitioned.draft }, emptyDraft)
})

test("proxy label requires the complete server-projected proxy tuple", async () => {
  const { getRegistrationObservationTeacherProxyLabel } = await loadTeacherModule()
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
  } = await loadTeacherModule()
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
})

test("teacher plans map each action to the exact revision tuple without a director decision", async () => {
  const { buildRegistrationObservationTeacherFeedbackPlan } = await loadTeacherModule()
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
  const { executeRegistrationObservationTeacherFeedbackMutation } = await loadTeacherModule()
  const focused = []
  const common = {
    detail: scheduledDetail,
    action: "submit_feedback",
    nowMs: Date.parse(scheduledDetail.endsAt),
    allowAttendanceOnly: false,
    reloadRequired: false,
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
  const { executeRegistrationObservationTeacherFeedbackMutation } = await loadTeacherModule()
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
    reloadRequired: false,
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

test("reload-required state fails closed for every mutation and disables every stale control", async () => {
  const {
    executeRegistrationObservationTeacherFeedbackMutation,
    RegistrationObservationTeacherFeedbackView,
  } = await loadTeacherModule()
  const calls = []
  const requestKeys = new Map()
  for (const action of ["submit_feedback", "no_show", "record_attendance"]) {
    const result = await executeRegistrationObservationTeacherFeedbackMutation({
      detail: scheduledDetail,
      draft: completedDraft,
      action,
      nowMs: Date.parse(scheduledDetail.endsAt),
      allowAttendanceOnly: true,
      reloadRequired: true,
      guard: { current: false },
      requestKeys,
      createRequestKey: () => {
        calls.push("request-key")
        return "must-not-be-created"
      },
      currentOwnershipMatches: () => true,
      recordAttendance: async () => {
        calls.push("attendance")
        return pendingDetail
      },
      submitFeedback: async () => {
        calls.push("feedback")
        return completedDetail
      },
      normalizeError: getRegistrationObservationFeedbackErrorState,
      onSaving: () => calls.push("saving"),
      onSaved: () => calls.push("saved"),
      focusField: () => calls.push("focus"),
    })
    assert.deepEqual({ ...result }, { kind: "reload_required" })
  }
  assert.deepEqual(calls, [])
  assert.equal(requestKeys.size, 0)

  const view = RegistrationObservationTeacherFeedbackView(viewProps({
    reloadRequired: true,
    canRecordAttendance: true,
  }))
  for (const id of ["teacher-feedback-suitability", "teacher-feedback-reason"]) {
    assert.equal(
      findReactElement(view, (element) => element.props.id === id, id).props.disabled,
      true,
    )
  }
  for (const action of ["submit_feedback", "no_show", "record_attendance"]) {
    assert.equal(
      findReactElement(
        view,
        (element) => element.props["data-action"] === action,
        `${action} action`,
      ).props.disabled,
      true,
    )
  }

  const onReload = () => {}
  const loadingReloadView = RegistrationObservationTeacherFeedbackView(viewProps({
    reloadRequired: true,
    loading: true,
    canRecordAttendance: true,
    onReload,
  }))
  const reloadControl = findReactElement(
    loadingReloadView,
    (element) => element.props.onClick === onReload,
    "reload action",
  )
  assert.equal(reloadControl.props.disabled, true)
  assert.equal(reloadControl.props.children, "불러오는 중")
})

test("reload recovery keeps the teacher draft while replacing only canonical server detail", async () => {
  const { transitionRegistrationObservationTeacherFeedbackLoadState } = (
    await loadTeacherModule()
  )
  const ownershipKey = `teacher-a:session-a:${IDS.observation}`
  const draft = Object.freeze({
    suitabilityResult: "unfit",
    feedbackReason: "작성 중인 교사 메모",
  })
  const staleState = Object.freeze({
    ownershipKey,
    detail: scheduledDetail,
    draft,
    loading: false,
    saving: false,
    errorMessage: "최신 내용을 다시 불러와 주세요.",
    fieldError: null,
    reloadRequired: true,
    receipt: "",
  })

  const reloading = transitionRegistrationObservationTeacherFeedbackLoadState(
    staleState,
    { kind: "reload_started", ownershipKey },
  )
  assert.equal(reloading.detail, scheduledDetail)
  assert.equal(reloading.draft, draft)
  assert.equal(reloading.loading, true)
  assert.equal(reloading.reloadRequired, true)

  const refreshedDetail = Object.freeze({ ...scheduledDetail, revision: 5 })
  const refreshed = transitionRegistrationObservationTeacherFeedbackLoadState(
    reloading,
    {
      kind: "loaded",
      ownershipKey,
      detail: refreshedDetail,
      preserveDraft: true,
    },
  )
  assert.equal(refreshed.detail, refreshedDetail)
  assert.equal(refreshed.draft, draft)
  assert.equal(refreshed.loading, false)
  assert.equal(refreshed.reloadRequired, false)

  const failedReload = transitionRegistrationObservationTeacherFeedbackLoadState(
    reloading,
    {
      kind: "failed",
      ownershipKey,
      errorMessage: "청강 피드백을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      reloadRequired: false,
      preserveDraft: true,
    },
  )
  assert.equal(failedReload.detail, scheduledDetail)
  assert.equal(failedReload.draft, draft)
  assert.equal(failedReload.loading, false)
  assert.equal(failedReload.reloadRequired, true)
})

test("browser boundary guidance cannot turn a server-rejected mutation into a committed result", async () => {
  const { executeRegistrationObservationTeacherFeedbackMutation } = await loadTeacherModule()
  const result = await executeRegistrationObservationTeacherFeedbackMutation({
    detail: scheduledDetail,
    draft: completedDraft,
    action: "submit_feedback",
    nowMs: Date.parse(scheduledDetail.endsAt) + 60_000,
    allowAttendanceOnly: false,
    reloadRequired: false,
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

test("mounted teacher flow focuses first error, deduplicates keyboard submit, and recovers a stale draft", async () => {
  const hookHarness = createHookHarness()
  const timerHarness = createTimerHarness()
  const originalWindow = globalThis.window
  const interactionDetail = Object.freeze({
    ...scheduledDetail,
    startsAt: "2020-08-12T09:00:00.000Z",
    endsAt: "2020-08-12T10:00:00.000Z",
  })
  const refreshedInteractionDetail = Object.freeze({
    ...interactionDetail,
    revision: 5,
  })
  const staleResponse = deferred()
  const loadCalls = []
  const submitCalls = []
  const attendanceCalls = []
  let loadCount = 0

  globalThis.window = timerHarness.window
  try {
    const teacherModule = await loadTsxRuntime(panelUrl, {
      react: hookHarness.react,
      "@/components/ui/button": { Button },
      "@/components/ui/label": { Label },
      "@/components/ui/textarea": { Textarea },
      "@/features/tasks/registration-select": { RegistrationSelect },
      "@/lib/supabase": { supabase: {} },
      "@/providers/auth-provider": {
        useAuth: () => ({
          canManageAll: true,
          session: {
            expires_at: 1_786_532_400,
            user: { id: "10000000-0000-4000-8000-000000000020" },
          },
        }),
      },
      "./registration-observation-model": {
        getRegistrationObservationFeedbackErrorState,
      },
      "./registration-observation-service": {
        loadRegistrationObservationFeedback: async (_client, observationId, options) => {
          loadCalls.push({ observationId, options })
          loadCount += 1
          return loadCount === 1 ? interactionDetail : refreshedInteractionDetail
        },
        recordRegistrationObservationAttendance: async (_client, input) => {
          attendanceCalls.push(input)
          return pendingDetail
        },
        submitRegistrationObservationFeedback: async (_client, input) => {
          submitCalls.push(input)
          return staleResponse.promise
        },
      },
    })
    const renderController = () => {
      const controller = hookHarness.render(
        teacherModule.RegistrationObservationTeacherFeedback,
        { observationId: IDS.observation },
      )
      hookHarness.flushEffects()
      return controller
    }

    let controller = renderController()
    assert.equal(controller.props.loading, true)
    timerHarness.runNext()
    await flushAsyncWork()

    controller = renderController()
    assert.equal(controller.props.detail, interactionDetail)
    let focused = ""
    controller.props.suitabilityRef.current = {
      focus: () => { focused = "suitabilityResult" },
    }
    let view = controller.type(controller.props)
    let form = findReactElement(view, (element) => element.type === "form", "feedback form")
    let prevented = 0
    form.props.onSubmit({ preventDefault: () => { prevented += 1 } })
    await flushAsyncWork()
    assert.equal(focused, "suitabilityResult")
    assert.equal(submitCalls.length, 0)

    controller = renderController()
    view = controller.type(controller.props)
    findReactElement(
      view,
      (element) => element.props.id === "teacher-feedback-suitability",
      "suitability select",
    ).props.onValueChange("unfit")
    controller = renderController()
    view = controller.type(controller.props)
    findReactElement(
      view,
      (element) => element.props.id === "teacher-feedback-reason",
      "feedback reason",
    ).props.onChange({ target: { value: "작성 중인 교사 메모" } })

    controller = renderController()
    view = controller.type(controller.props)
    form = findReactElement(view, (element) => element.type === "form", "feedback form")
    form.props.onSubmit({ preventDefault: () => { prevented += 1 } })
    form.props.onSubmit({ preventDefault: () => { prevented += 1 } })
    assert.equal(submitCalls.length, 1)
    assert.equal(submitCalls[0].suitabilityResult, "unfit")
    assert.equal(submitCalls[0].feedbackReason, "작성 중인 교사 메모")

    staleResponse.reject({
      code: "40001",
      message: "registration_observation_stale_revision",
    })
    await flushAsyncWork()
    controller = renderController()
    assert.equal(controller.props.reloadRequired, true)
    assert.deepEqual({ ...controller.props.draft }, {
      suitabilityResult: "unfit",
      feedbackReason: "작성 중인 교사 메모",
    })
    view = controller.type(controller.props)
    form = findReactElement(view, (element) => element.type === "form", "feedback form")
    form.props.onSubmit({ preventDefault: () => { prevented += 1 } })
    findReactElement(
      view,
      (element) => element.props["data-action"] === "no_show",
      "no-show action",
    ).props.onClick()
    findReactElement(
      view,
      (element) => element.props["data-action"] === "record_attendance",
      "attendance action",
    ).props.onClick()
    await flushAsyncWork()
    assert.equal(submitCalls.length, 1)
    assert.equal(attendanceCalls.length, 0)

    findReactElement(
      view,
      (element) => element.props.children === "다시 불러오기",
      "reload action",
    ).props.onClick()
    await flushAsyncWork()
    controller = renderController()
    assert.equal(controller.props.detail, refreshedInteractionDetail)
    assert.equal(controller.props.reloadRequired, false)
    assert.deepEqual({ ...controller.props.draft }, {
      suitabilityResult: "unfit",
      feedbackReason: "작성 중인 교사 메모",
    })
    assert.equal(loadCalls.length, 2)
    assert.deepEqual(loadCalls[1], {
      observationId: IDS.observation,
      options: { force: true },
    })
    assert.equal(prevented, 4)
  } finally {
    hookHarness.cleanup()
    timerHarness.clear()
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})

test("rendered teacher view is a keyboard form with loading and independently disabled actions", async () => {
  const { RegistrationObservationTeacherFeedbackView } = await loadTeacherModule()
  const loadingView = RegistrationObservationTeacherFeedbackView(
    viewProps({ detail: null, loading: true }),
  )
  const loadingStatus = findReactElement(
    loadingView,
    (element) => element.props.role === "status",
    "loading status",
  )
  assert.equal(collectReactText(loadingStatus).join(""), "청강 피드백을 불러오는 중입니다.")
  assert.equal(
    findReactElements(loadingView, (element) => element.props["data-action"]).length,
    0,
  )

  const beforeStartView = RegistrationObservationTeacherFeedbackView(viewProps({
    nowMs: Date.parse(scheduledDetail.startsAt) - 1,
    canRecordAttendance: true,
  }))
  findReactElement(beforeStartView, (element) => element.type === "form", "feedback form")
  for (const action of ["submit_feedback", "no_show", "record_attendance"]) {
    const control = findReactElement(
      beforeStartView,
      (element) => element.props["data-action"] === action,
      `${action} action`,
    )
    assert.equal(control.props.disabled, true)
    if (action === "submit_feedback") assert.equal(control.props.type, "submit")
  }

  const afterStartView = RegistrationObservationTeacherFeedbackView(viewProps({
    nowMs: Date.parse(scheduledDetail.startsAt),
    canRecordAttendance: true,
  }))
  assert.equal(findReactElement(
    afterStartView,
    (element) => element.props["data-action"] === "submit_feedback",
    "submit action",
  ).props.disabled, true)
  for (const action of ["no_show", "record_attendance"]) {
    assert.equal(findReactElement(
      afterStartView,
      (element) => element.props["data-action"] === action,
      `${action} action`,
    ).props.disabled, false)
  }

  const savingView = RegistrationObservationTeacherFeedbackView(
    viewProps({ saving: true, canRecordAttendance: true }),
  )
  for (const id of ["teacher-feedback-suitability", "teacher-feedback-reason"]) {
    assert.equal(findReactElement(
      savingView,
      (element) => element.props.id === id,
      id,
    ).props.disabled, true)
  }
  for (const action of ["submit_feedback", "no_show", "record_attendance"]) {
    assert.equal(findReactElement(
      savingView,
      (element) => element.props["data-action"] === action,
      `${action} action`,
    ).props.disabled, true)
  }
})

test("rendered 390px and 200% layout contract avoids fixed-width overflow and hides internal identifiers", async () => {
  const { RegistrationObservationTeacherFeedbackView } = await loadTeacherModule()
  const view = RegistrationObservationTeacherFeedbackView(
    viewProps({ detail: proxyDetail, nowMs: Date.parse(proxyDetail.endsAt) }),
  )
  assert.equal(view.props["data-testid"], "registration-observation-teacher-feedback")
  for (const className of ["w-full", "min-w-0", "overflow-x-hidden"]) {
    assert.equal(hasClass(view, className), true)
  }
  const definitionList = findReactElement(
    view,
    (element) => element.type === "dl",
    "observation summary",
  )
  assert.equal(hasClass(definitionList, "grid-cols-1"), true)
  assert.equal(hasClass(definitionList, "sm:grid-cols-2"), true)
  assert.ok(findReactElements(view, (element) => hasClass(element, "break-words")).length > 0)

  const renderedText = collectReactText(view).join(" ")
  assert.match(renderedText, /대리 입력 · 운영 담당자 · 2026\. 8\. 12\. 19:05/)
  assert.doesNotMatch(
    renderedText,
    new RegExp([IDS.task, IDS.track, IDS.appointment, IDS.class, IDS.lesson].join("|")),
  )
  const allClasses = findReactElements(view, () => true)
    .map((element) => element.props.className || "")
    .join(" ")
  assert.doesNotMatch(
    allClasses,
    /min-w-\[|w-\[(?:[4-9]\d\d|\d{4,})px\]|overflow-x-auto/,
  )
})
