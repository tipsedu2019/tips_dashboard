import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  reconcileRegistrationEnrollmentDraft,
  resolveRegistrationWorkspaceWorkflowStatus,
} from "../src/features/tasks/registration-application-model.ts";
import { createRegistrationObservationAsyncOwnership } from "../src/features/tasks/registration-workspace-route.ts";
import * as registrationTrackModel from "../src/features/tasks/registration-track-model.js";
import { getSelectableRegistrationScheduleSessions } from "../src/features/tasks/registration-workflow.js";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const listUrl = new URL(
  "../src/features/tasks/registration-case-list.tsx",
  import.meta.url,
);

async function readListSource() {
  return readFile(listUrl, "utf8");
}

async function readWorkspaceSource() {
  return readFile(
    new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url),
    "utf8",
  );
}

async function readRegistrationApplicationSource() {
  const [actions, application, subjectTabs, inquiry] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-subject-tabs.tsx", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8"),
  ])
  return `${actions}\n${application}\n${subjectTabs}\n${inquiry}`
}

async function readRegistrationAppointmentEditorSource() {
  return readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
}

async function readAdmissionProgressSource() {
  return readFile(new URL("../src/features/tasks/registration-admission-progress.tsx", import.meta.url), "utf8")
}

async function loadAdmissionProgressRuntime() {
  const fileName = new URL("../src/features/tasks/registration-admission-progress.tsx", import.meta.url)
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
  const runtimeModule = { exports: {} }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: fileName.pathname,
  })
  factory(require, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function createControlledPromise() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function createRegistrationEditorHookHarness() {
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
        slot.value = typeof nextValue === "function" ? nextValue(slot.value) : nextValue
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
      slots[index] = { kind: "memo", value: factory(), dependencies }
    }
    return slots[index].value
  }

  function useEffect(effect, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      pendingEffects.push({ effect, index })
      slots[index] = { kind: "effect", cleanup: slot?.cleanup, dependencies }
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
      assert.equal(pendingEffects.length, 0, "flush editor effects before rendering again")
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

function findMountedRegistrationElements(node, predicate, matches = []) {
  if (Array.isArray(node)) {
    for (const child of node) findMountedRegistrationElements(child, predicate, matches)
    return matches
  }
  if (!node || typeof node !== "object" || !("props" in node)) return matches
  if (predicate(node)) matches.push(node)
  findMountedRegistrationElements(node.props.children, predicate, matches)
  return matches
}

function findMountedRegistrationElement(node, predicate, description) {
  const matches = findMountedRegistrationElements(node, predicate)
  assert.equal(matches.length, 1, `expected one ${description}, received ${matches.length}`)
  return matches[0]
}

function collectMountedRegistrationText(node, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectMountedRegistrationText(child, output)
  } else if (typeof node === "string" || typeof node === "number") {
    output.push(String(node))
  } else if (node && typeof node === "object" && "props" in node) {
    collectMountedRegistrationText(node.props.children, output)
  }
  return output
}

async function flushMountedRegistrationWork() {
  await new Promise((resolve) => setImmediate(resolve))
}

function registrationEditorPassthrough(tag = "div") {
  return function RegistrationEditorPassthrough({ children, className }) {
    return createElement(tag, { className }, children)
  }
}

async function loadMountedRegistrationEnrollmentEditor({
  hookHarness,
  loadObservation,
  loadClassDetails,
  saveEnrollmentDetails = async () => undefined,
}) {
  const fileName = new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url)
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

  const Wrapper = registrationEditorPassthrough()
  const Label = registrationEditorPassthrough("label")
  const Badge = registrationEditorPassthrough("span")
  const Icon = () => createElement("span", { "aria-hidden": "true" })
  const Button = registrationEditorPassthrough("button")
  const Textarea = registrationEditorPassthrough("textarea")
  const RegistrationSelect = registrationEditorPassthrough("select")
  const RegistrationSaveButton = registrationEditorPassthrough("button")
  const Calendar = Wrapper
  const runtimeModule = { exports: {} }
  let requestKeySequence = 0
  const registrationService = {
    advanceRegistrationAdmissionBatch: async () => undefined,
    cancelRegistrationAdmissionBatch: async () => undefined,
    cancelRegistrationEnrollment: async () => undefined,
    completeRegistrationAdmissionBatch: async () => undefined,
    createRegistrationMutationRequestKey(kind, entityId) {
      requestKeySequence += 1
      return `${kind}:${entityId}:mounted-${requestKeySequence}`
    },
    loadRegistrationEnrollmentStartObservation: loadObservation,
    saveRegistrationEnrollmentDetails: saveEnrollmentDetails,
    setRegistrationAdmissionChecklistItem: async () => undefined,
    setRegistrationEnrollmentMakeedu: async () => undefined,
    startRegistrationAdmissionBatch: async () => undefined,
  }
  const localModules = new Map([
    ["lucide-react", { CalendarDays: Icon, ChevronDown: Icon, Plus: Icon, RefreshCw: Icon, Trash2: Icon }],
    ["@/components/ui/alert", { Alert: Wrapper, AlertDescription: Wrapper, AlertTitle: Wrapper }],
    ["@/components/ui/badge", { Badge }],
    ["@/components/ui/button", { Button }],
    ["@/components/ui/calendar", { Calendar }],
    ["@/components/ui/collapsible", { Collapsible: Wrapper, CollapsibleContent: Wrapper, CollapsibleTrigger: Wrapper }],
    ["@/components/ui/label", { Label }],
    ["@/components/ui/popover", { Popover: Wrapper, PopoverContent: Wrapper, PopoverTrigger: Wrapper }],
    ["@/components/ui/textarea", { Textarea }],
    ["./registration-admission-progress", { RegistrationAdmissionChecklist: Wrapper }],
    ["./registration-select", { RegistrationSelect }],
    ["./registration-save-button", { RegistrationSaveButton }],
    ["./ops-task-service", { loadOpsRegistrationClassDetails: loadClassDetails }],
    ["./registration-track-model.js", registrationTrackModel],
    ["./registration-workflow", { getSelectableRegistrationScheduleSessions }],
    ["./registration-application-model", { reconcileRegistrationEnrollmentDraft }],
    ["./registration-track-service", registrationService],
  ])
  const runtimeRequire = (specifier) => {
    if (specifier === "react") return hookHarness.react
    if (specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unhandled registration editor runtime import: ${specifier}`)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: fileName.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports.RegistrationEnrollmentEditor
}

async function loadMountedRegistrationApplication({
  hookHarness,
  loadManagerDetail,
  loadFeedback,
  withdrawObservation = async () => ({ changed: false }),
  enterObservation = async () => ({ changed: false }),
  setWorkflowStatus = async () => undefined,
  isOpsStatus = () => true,
  workflowStatusOptions = () => [],
  canStartObservation = () => false,
}) {
  const fileName = new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url)
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
  const Passthrough = registrationEditorPassthrough()
  const Button = registrationEditorPassthrough("button")
  const Badge = registrationEditorPassthrough("span")
  const RegistrationApplicationShell = function MountedRegistrationApplicationShell(props) {
    return createElement("section", { "data-mounted-registration-shell": "" }, props.children)
  }
  const RegistrationObservationEditor = function MountedRegistrationObservationEditor(props) {
    return createElement("div", {
      "data-mounted-observation-editor": props.deepLinkedAttempt?.observationId || "",
      "data-has-customer-message-callback": String(typeof props.onOpenCustomerMessage === "function"),
    })
  }
  const RegistrationObservationFeedbackPanel = function MountedRegistrationObservationFeedbackPanel() {
    return createElement("div", { "data-mounted-observation-feedback": "" })
  }
  const RegistrationAlimtalkPreviewDialog = function MountedRegistrationAlimtalkPreviewDialog(props) {
    return createElement("div", {
      "data-mounted-customer-message-dialog": String(props.open),
    })
  }
  const sectionStates = Object.fromEntries([
    "inquiry",
    "level_test",
    "consultation",
    "waiting",
    "observation",
    "registration",
    "admission",
    "history",
  ].map((key) => [key, { current: true, editable: false, upcoming: false, lockReason: "" }]))
  const observationActions = {
    cancelRegistrationObservation: async () => ({ changed: false }),
    correctRegistrationObservationFeedback: async () => ({ changed: false }),
    decideRegistrationObservation: async () => ({ changed: false }),
    enterRegistrationObservation: (_client, input) => enterObservation(input),
    loadRegistrationObservationFeedback: loadFeedback,
    loadRegistrationObservationManagerDetail: loadManagerDetail,
    loadRegistrationObservationSessions: async () => [],
    recordRegistrationObservationAttendance: async () => ({ changed: false }),
    saveRegistrationObservationBooking: async () => ({ changed: false }),
    submitRegistrationObservationFeedback: async () => ({ changed: false }),
    withdrawRegistrationObservation: withdrawObservation,
  }
  const localModules = new Map([
    ["@/components/ui/badge", { Badge }],
    ["@/components/ui/button", { Button }],
    ["@/features/notifications/notification-delivery-control", { GoogleChatDeliveryControl: Passthrough }],
    ["@/lib/supabase", { supabase: {} }],
    ["./registration-application-admission-section", { RegistrationApplicationAdmissionSection: Passthrough }],
    ["./registration-alimtalk-preview-dialog", { RegistrationAlimtalkPreviewDialog }],
    ["./registration-application-consultation-section", { RegistrationApplicationConsultationSection: Passthrough }],
    ["./registration-application-inquiry-section", {
      RegistrationApplicationInquirySection: Passthrough,
      RegistrationInquiryEditor: Passthrough,
    }],
    ["./registration-application-level-test-section", { RegistrationApplicationLevelTestSection: Passthrough }],
    ["./registration-application-model", {
      canManageRegistrationObservationTrack: ({ viewerId, viewerRole, directorProfileId }) => (
        viewerRole === "admin" || viewerRole === "staff" || Boolean(viewerId && viewerId === directorProfileId)
      ),
      getRegistrationApplicationAppointmentActionPlans: () => [],
      getRegistrationApplicationCaseEditableSections: () => [],
      getRegistrationEnrollmentDirtyKey: (trackId, scope) => `enrollment:${trackId}:${scope}`,
      getRegistrationApplicationSectionStates: () => sectionStates,
      getRegistrationApplicationTrackState: ({ track }) => ({ trackId: track.id }),
      getRegistrationConsultationModeDraft: () => ({ mode: "phone", dirty: false, phoneDisabled: false }),
      getRegistrationObservationRefreshPlan: ({ savedTaskId, savedTrackId, activeTaskId, activeTrackId }) => ({
        loadManagerDetail: savedTaskId === activeTaskId && savedTrackId === activeTrackId,
        preferredTrackId: savedTaskId === activeTaskId && savedTrackId === activeTrackId ? savedTrackId : undefined,
      }),
      resolveRegistrationApplicationFocusPanelId: ({ focusTrackId, activeTrackId, observationFocusAvailable, genericFocusPanelId }) => (
        focusTrackId && focusTrackId === activeTrackId
          ? observationFocusAvailable ? "registration-application-observation" : genericFocusPanelId
          : null
      ),
      resolveRegistrationActiveTrackId: (tracks, focusTrackId) => (
        tracks.some((track) => track.id === focusTrackId) ? focusTrackId : tracks[0]?.id || null
      ),
      resolveRegistrationWorkspaceWorkflowStatus,
      settleRegistrationConflictComparison: () => null,
      updateRegistrationApplicationDirtyKeys: (current) => current,
    }],
    ["./registration-application-placement-section", { RegistrationApplicationPlacementSection: Passthrough }],
    ["./registration-application-history-action", { RegistrationApplicationHistoryAction: Passthrough }],
    ["./registration-application-shell", { RegistrationApplicationShell }],
    ["./registration-application-subject-tabs", { RegistrationApplicationSubjectTabs: Passthrough }],
    ["./registration-observation-editor", {
      RegistrationObservationEditor,
      buildRegistrationObservationWithdrawalInput: (input) => ({
        trackId: input.trackId,
        expectedWorkflowRevision: input.workflowRevision,
        exitKind: input.exitKind,
        targetWorkflowStatus: input.targetWorkflowStatus,
        decisionObservationId: null,
        expectedDecisionObservationRevision: null,
        expectedDecisionFeedbackRevision: null,
        reason: input.reason,
        requestKey: input.requestKey,
      }),
      canLoadRegistrationObservationWorkspace: ({ runtimeAvailable, observationSummaryVisible }) => (
        runtimeAvailable && observationSummaryVisible
      ),
      canUseRegistrationObservationDetail: ({ activeTrackId, detailTrackId }) => Boolean(
        activeTrackId && activeTrackId === detailTrackId
      ),
      getRegistrationObservationUiErrorMessage: (_error, fallback) => fallback,
    }],
    ["./registration-observation-feedback-panel", {
      RegistrationObservationFeedbackPanel,
      canEditRegistrationObservationFeedback: ({ canManageCase, isAssignedTeacher, decisionKind }) => (
        canManageCase || (decisionKind === null && isAssignedTeacher)
      ),
      canKeepRegistrationObservationFeedbackHistoryMounted: ({ canManageCase, observationAttemptCount }) => (
        canManageCase && observationAttemptCount > 0
      ),
      getRegistrationObservationFeedbackMountPlan: ({ managerDetail, canManageObservation, canManageCase }) => {
        if (!canManageObservation || !managerDetail) return null
        if (managerDetail.currentObservation) {
          return { observationId: managerDetail.currentObservation.observationId, correctionOnly: false }
        }
        if (canManageCase && managerDetail.latestDecisionObservation) {
          return { observationId: managerDetail.latestDecisionObservation.observationId, correctionOnly: true }
        }
        return null
      },
      getRegistrationObservationFeedbackRefreshPlan: ({ requestedOwnershipKey, currentOwnershipKey }) => ({
        mutatePanelState: requestedOwnershipKey === currentOwnershipKey,
      }),
      loadRegistrationObservationFeedbackForOwnedPanel: ({ requestedOwnershipKey, currentOwnershipKey, load }) => (
        requestedOwnershipKey === currentOwnershipKey ? load() : Promise.resolve(null)
      ),
      shouldMountRegistrationObservationFeedbackOnly: () => false,
    }],
    ["./registration-application-track-actions", {
      REGISTRATION_DIRECTOR_VISIBLE_STATUSES: new Set(),
      REGISTRATION_TRACK_STATUS_LABELS: new Proxy({}, { get: () => "등록" }),
      RegistrationConsultationOutcomeEditor: Passthrough,
      RegistrationEnrollmentTrackEditor: Passthrough,
      RegistrationMigrationConflictNotice: Passthrough,
      RegistrationMigrationReviewEditor: Passthrough,
      RegistrationTrackDirectorSection: Passthrough,
      RegistrationWaitingDetailsEditor: Passthrough,
      canStartRegistrationObservation: canStartObservation,
      getRegistrationIdentityEditLock: () => false,
    }],
    ["./registration-appointment-editor", { RegistrationAppointmentEditor: Passthrough }],
    ["./registration-save-button", { RegistrationSaveButton: Button }],
    ["./registration-enrollment-editor", {
      clearRegistrationEnrollmentDrafts: () => undefined,
      RegistrationAdmissionPanel: Passthrough,
    }],
    ["./registration-observation-model", {
      getRegistrationObservationFeedbackErrorState: () => ({ message: "load failed", reloadRequired: true }),
    }],
    ["./registration-observation-service", {
      ...observationActions,
      withdrawRegistrationObservation: (_client, input) => withdrawObservation(input),
    }],
    ["../../lib/academic-subject-registry.ts", { ACADEMIC_SUBJECT_VALUES: ["영어", "수학", "과학"] }],
    ["./registration-track-model.js", {
      getRegistrationActionPermissions: () => ({ canManage: false, canCompleteConsultation: false, readOnly: true }),
      getRegistrationActiveConsultation: () => null,
      getRegistrationAdmissionApplicationState: () => ({
        targetTrackIds: [],
        canSend: false,
        syncNeeded: false,
      }),
      getRegistrationCurrentClassWaitClassId: () => null,
    }],
    ["./registration-track-service", {
      ensureRegistrationWorkflowNotificationSourceIds: async () => [],
      saveRegistrationCaseInquiry: async () => undefined,
      saveRegistrationPhoneConsultation: async () => undefined,
      setRegistrationWorkflowStatus: setWorkflowStatus,
      isOpsRegistrationWorkflowStatus: isOpsStatus,
    }],
    ["./registration-workspace-route", { createRegistrationObservationAsyncOwnership }],
    ["./registration-consultation-notification.js", {
      dispatchRegistrationManagementNotificationSources: async () => ({ failedSourceEventIds: [] }),
      isRegistrationManagementNotificationWorkflowStatus: () => false,
    }],
    ["./registration-workflow-status.js", {
      REGISTRATION_WORKFLOW_STATUS_LABELS: new Proxy({}, { get: () => "등록 신청" }),
      getRegistrationWorkflowViewKey: () => "registration",
      getRegistrationWorkflowStatusOptions: workflowStatusOptions,
      isRegistrationObservationWorkflowStatus: (status) => String(status).startsWith("observation_"),
    }],
  ])
  const runtimeModule = { exports: {} }
  const runtimeRequire = (specifier) => {
    if (specifier === "react") return { ...hookHarness.react, Children: require("react").Children }
    if (specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unhandled registration application runtime import: ${specifier}`)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: fileName.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return {
    RegistrationApplication: runtimeModule.exports.RegistrationApplication,
    RegistrationApplicationShell,
    RegistrationAlimtalkPreviewDialog,
    RegistrationObservationEditor,
    RegistrationObservationFeedbackPanel,
  }
}

const MOUNTED_REGISTRATION_TRACK_ID = "76000000-0000-4000-8000-000000000001"
const MOUNTED_REGISTRATION_TASK_ID = "76000000-0000-4000-8000-000000000002"
const MOUNTED_REGISTRATION_CLASS_ID = "76000000-0000-4000-8000-000000000003"
const MOUNTED_REGISTRATION_OBSERVATION_ID = "76000000-0000-4000-8000-000000000004"
const MOUNTED_REGISTRATION_OBSERVATION_LESSON_ID = "76000000-0000-4000-8000-000000000005"
const MOUNTED_REGISTRATION_FUTURE_LESSON_ID = "76000000-0000-4000-8000-000000000006"
const MOUNTED_REGISTRATION_FUTURE_SESSION_KEY = "normalized:2026-08-24:2"

const mountedRegistrationObservation = Object.freeze({
  observationId: MOUNTED_REGISTRATION_OBSERVATION_ID,
  taskId: MOUNTED_REGISTRATION_TASK_ID,
  trackId: MOUNTED_REGISTRATION_TRACK_ID,
  appointmentId: "76000000-0000-4000-8000-000000000007",
  studentName: "김학생",
  studentGrade: "중2",
  subject: "영어",
  classId: MOUNTED_REGISTRATION_CLASS_ID,
  className: "중2 영어 A반",
  sessionDate: "2026-08-17",
  startsAt: "2026-08-17T10:00:00.000Z",
  endsAt: "2026-08-17T11:30:00.000Z",
  classroomName: "101호",
  teacherName: "박선생",
  status: "completed",
  attendance: "attended",
  suitabilityResult: "fit",
  feedbackReason: "수업 참여가 안정적입니다.",
  proxySubmitted: false,
  feedbackSubmittedByName: "박선생",
  feedbackSubmittedAt: "2026-08-17T12:00:00.000Z",
  revision: 3,
  feedbackRevision: 2,
  appointmentNotificationRevision: 1,
  trackWorkflowRevision: 4,
  decisionKind: "enrollment",
  sessionAuthority: "normalized",
  sessionKey: "normalized:2026-08-17:1",
  classLessonSessionId: MOUNTED_REGISTRATION_OBSERVATION_LESSON_ID,
  legacySessionKey: null,
  sourceRevision: Object.freeze({
    authority: "normalized",
    sessionId: MOUNTED_REGISTRATION_OBSERVATION_LESSON_ID,
    revision: 7,
  }),
})

function mountedRegistrationEditorProps(overrides = {}) {
  return {
    taskId: MOUNTED_REGISTRATION_TASK_ID,
    viewerId: "76000000-0000-4000-8000-000000000008",
    track: {
      id: MOUNTED_REGISTRATION_TRACK_ID,
      taskId: MOUNTED_REGISTRATION_TASK_ID,
      subject: "영어",
      status: "enrollment_decided",
      stageEnteredAt: "2026-08-18T00:00:00.000Z",
      observationFeedbackRevision: 2,
      enrollmentDetailRows: [],
    },
    enrollments: [],
    admissionBatches: [],
    classes: [{
      id: MOUNTED_REGISTRATION_CLASS_ID,
      label: "중2 영어 A반",
      subject: "영어",
      textbookIds: [],
    }],
    textbooks: [],
    permissions: { canManage: true },
    onReload: async () => undefined,
    onWarning: () => undefined,
    ...overrides,
  }
}

function mountedRegistrationClassDetails() {
  return {
    [MOUNTED_REGISTRATION_CLASS_ID]: {
      id: MOUNTED_REGISTRATION_CLASS_ID,
      textbookIds: [],
      schedulePlan: {
        sessions: [{
          id: MOUNTED_REGISTRATION_FUTURE_LESSON_ID,
          sessionKey: MOUNTED_REGISTRATION_FUTURE_SESSION_KEY,
          date: "2026-08-24",
          sessionNumber: 2,
          scheduleState: "active",
        }],
      },
    },
  }
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start + startMarker.length, end);
}

test("registration application shell separates waiting and registration in fixed process order", async () => {
  const shell = await readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8")
  const inquiry = await readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8")

  const titles = ["문의", "레벨테스트", "상담", "대기", "등록", "입학"]
  let previous = -1
  for (const title of titles) {
    const index = shell.indexOf(title)
    assert.ok(index > previous, `${title} is rendered after the preceding section`)
    assert.equal(shell.indexOf(title, index + 1), -1, `${title} is rendered exactly once`)
    previous = index
  }
  assert.match(shell, /aria-disabled/)
  assert.match(shell, /editable/)
  assert.match(shell, /isRegistrationApplicationSectionContentDisabled/)
  assert.match(shell, /CREATE_UI_SECTION_ORDER = \["inquiry"\]/)
  assert.match(shell, /props\.mode === "create"[\s\S]*?CREATE_UI_SECTION_ORDER[\s\S]*?APPLICATION_UI_SECTION_ORDER/)
  assert.match(shell, /<fieldset[\s\S]*disabled=\{contentDisabled\}/)
  assert.match(shell, /closeAction: ReactNode/)
  assert.match(shell, /\{props\.closeAction\}/)
  assert.doesNotMatch(shell, /자동 이력/)
  assert.doesNotMatch(shell, /\{props\.history\}/)
  assert.match(inquiry, /export type RegistrationInquiryDraft/)
  assert.match(inquiry, /subjects: RegistrationSubject\[\]/)
  assert.match(inquiry, /\{subjectSyncContent\}[\s\S]*\{commonInfoContent\}/)
  assert.match(inquiry, /exceptionContent/)
  assert.doesNotMatch(shell, /이전|다음|stage tabs|StageTabs/)
})

test("registration progress supports consultation to waiting to registration and direct registration", async () => {
  const model = await readFile(new URL("../src/features/tasks/registration-application-model.ts", import.meta.url), "utf8")
  assert.match(model, /"consultation",\s*"waiting",\s*"observation",\s*"registration",\s*"admission"/)
  assert.match(model, /waitingKind[\s\S]*?"skipped"/)
  assert.match(model, /waiting: "대기"/)
  assert.match(model, /observation: "청강 신청"/)
  assert.match(model, /workflowStatus\?\.startsWith\("observation_"\)[\s\S]*?"observation"/)
  assert.match(model, /registration: "등록 신청"/)
})

test("registration start schedule calendar keeps past lessons available for delayed enrollment notice", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /<Calendar/)
  assert.doesNotMatch(source, /afterDateKey: registrationDecisionDateKey/)
  assert.match(source, /수업 시작일 선택/)
  assert.doesNotMatch(source, /<select[\s\S]{0,500}수업일·회차 선택/)
})

test("waiting and registration summaries omit unexplained duplicate fields", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(source, /valueField\("입학 처리 시작 행동"/)
  assert.doesNotMatch(source, /valueField\("문의 요청 사항"/)
  assert.match(source, /placementMode === "waiting"/)
  assert.match(source, /placementMode === "registration"/)
})

test("saved registration uses the subject status selector instead of a separate progress stepper", async () => {
  const detail = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")

  assert.match(detail, /aria-label=\{`\$\{activeGenericTrack\.subject\} 진행상태`\}/)
  assert.match(detail, /aria-label=\{`\$\{activeTrack\.subject\} 진행상태`\}/)
  assert.match(detail, /data-registration-workflow-status="observation"[\s\S]*?<select/)
  assert.match(detail, /await registrationObservationActions\.withdrawRegistrationObservation\(/)
  assert.match(detail, /exitKind:\s*"return_to_previous"/)
  assert.match(detail, /targetWorkflowStatus:\s*nextObservationStatus/)
  assert.doesNotMatch(
    detail,
    /changeObservationWorkflowStatus[\s\S]{0,1800}setRegistrationWorkflowStatus\(/,
    "청강 상태는 일반 상태 변경 RPC가 아니라 청강 철회 계약을 사용해야 한다",
  )
  assert.match(detail, /await setRegistrationWorkflowStatus\(/)
  assert.match(detail, /progress=\{null\}/)
  assert.doesNotMatch(detail, /progress=\{<RegistrationApplicationProgressStepper/)
})

test("new registration owns only the inquiry subject picker before subject journeys begin", async () => {
  const [create, detail, initialPlan] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8"),
  ])
  assert.doesNotMatch(create, /<RegistrationInitialRouteFields/)
  assert.doesNotMatch(initialPlan, /과목별 다음 업무|다음 업무/)
  assert.match(initialPlan, /ProcessSubjectPicker/)
  assert.match(create, /RegistrationSubjectPicker/)
  assert.doesNotMatch(create, /RegistrationInitialLevelTestFields|RegistrationInitialConsultationFields/)
  assert.equal((detail.match(/<RegistrationApplicationSubjectTabs/g) || []).length, 1)
})

test("new registration saves inquiry basics only and starts every subject at registration inquiry", async () => {
  const [shell, create, workspace] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8"),
    readWorkspaceSource(),
  ])

  assert.match(shell, /CREATE_UI_SECTION_ORDER = \["inquiry"\]/)
  assert.doesNotMatch(create, /RegistrationInitialLevelTestFields|RegistrationInitialConsultationFields/)
  assert.doesNotMatch(create, /levelTest=|consultation=/)
  assert.match(workspace, /const initialDraft = createRegistrationInitialWorkflowDraft\(subjects\)/)
  assert.doesNotMatch(workspace, /const initialDraft = registrationPersistence\.mode === "ready_atomic"/)
})

test("registration selects use the shared dashboard select and disabled gray treatment", async () => {
  const [select, initialPlan, shell, workspace] = await Promise.all([
    readFile(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
    readWorkspaceSource(),
  ])
  assert.match(select, /disabled:bg-muted/)
  assert.match(select, /disabled:opacity-100/)
  assert.match(initialPlan, /SelectTrigger/)
  assert.doesNotMatch(initialPlan, /<select/)
  assert.match(shell, /\[&_select:disabled\]:bg-muted/)
  assert.doesNotMatch(workspace, /adminProfileIds/)
  assert.match(workspace, /profileOptions/)
  assert.match(workspace, /profile\.role[\s\S]*?=== "admin"/)
})

test("top progress and actionable editors replace duplicate read-only detail fields", async () => {
  const [shell, detail, initialPlan] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8"),
  ])

  assert.doesNotMatch(shell, />진행 중</)
  assert.doesNotMatch(detail, /valueField\(/)
  assert.doesNotMatch(initialPlan, /ReadonlyInitialField label="진행상태"/)
  assert.doesNotMatch(detail, /RegistrationTrackSectionValues/)
  assert.doesNotMatch(detail, /RegistrationTrackStageEditor/)
  assert.match(detail, /RegistrationWaitingDetailsEditor/)
  assert.equal((detail.match(/<RegistrationAppointmentEditor/g) || []).length, 2)
  assert.match(detail, /RegistrationEnrollmentTrackEditor/)
  assert.doesNotMatch(initialPlan, /시험 시작·완료 상태|ReadonlyInitialField/)
  assert.doesNotMatch(initialPlan, /결과 링크|전화상담 대기 기준일시|상담 결과/)
})

test("saved detail exposes automatic history from a header clock popover only", async () => {
  const [shell, detail, create, action, timeline] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-history-action.tsx", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../src/features/tasks/registration-history-timeline.tsx", import.meta.url), "utf8"),
  ])

  assert.match(shell, /historyAction\?: ReactNode/)
  assert.match(shell, /\{props\.historyAction\}\s*\{props\.closeAction\}/)
  assert.doesNotMatch(shell, /history: ReactNode|history: "history"|history: "자동 이력"/)
  assert.match(action, /Clock3/)
  assert.match(action, /aria-label="자동 이력 보기"/)
  assert.match(action, /<Popover>/)
  assert.match(action, /<PopoverTrigger asChild>/)
  assert.match(action, /<PopoverContent/)
  assert.match(action, /useRef<HTMLButtonElement>\(null\)/)
  assert.match(action, /useRef\(false\)/)
  assert.match(action, /ref=\{historyTriggerRef\}/)
  assert.match(action, /onEscapeKeyDown=\{\(\) => \{[\s\S]*restoreHistoryTriggerFocusRef\.current = true/)
  assert.match(action, /onCloseAutoFocus=\{\(event\) => \{/)
  assert.match(action, /if \(!restoreHistoryTriggerFocusRef\.current\) return/)
  assert.match(
    action,
    /event\.preventDefault\(\)[\s\S]*historyTriggerRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  )
  assert.match(action, /<RegistrationHistoryTimeline[\s\S]*?embedded/)
  assert.doesNotMatch(action, /<Sheet|<Dialog/)
  assert.match(detail, /const genericDetail = useMemo<OpsRegistrationCaseDetail>/)
  assert.match(detail, /historyAction=\{<RegistrationApplicationHistoryAction detail=\{genericDetail\} profiles=\{profiles\} \/>\}/)
  assert.doesNotMatch(detail, /history=\{|<RegistrationHistoryTimeline/)
  assert.doesNotMatch(create, /historyAction=|history=\{/)
  assert.match(timeline, /embedded\?: boolean/)
  assert.match(timeline, /embedded\s*\?[^:]+:[^}]+/)
  assert.doesNotMatch(timeline, /subjectFilter|stageFilter|과목 전체|단계 전체|<select/)
  assert.match(timeline, /누가 · 언제 · 무엇을 · 어떻게/)
})

test("create and detail share the approved subject-first inquiry controls", async () => {
  const fields = await readFile(new URL("../src/features/tasks/registration-application-inquiry-fields.tsx", import.meta.url), "utf8")
  const picker = await readFile(new URL("../src/features/tasks/registration-subject-picker.tsx", import.meta.url), "utf8")
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")
  const inquiry = await readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8")
  assert.match(create, /<RegistrationInquiryCommonFields/)
  assert.match(inquiry, /<RegistrationInquiryCommonFields/)
  assert.match(create, /<RegistrationSubjectPicker/)
  assert.match(inquiry, /<RegistrationSubjectPicker/)
  assert.match(fields, /학생명[\s\S]*학년[\s\S]*학교[\s\S]*학부모 전화[\s\S]*학생 전화[\s\S]*문의일시[\s\S]*요청 사항/)
  assert.match(picker, /const locked = Boolean\(props\.disabledSubjects\?\.has\(subject\)\)/)
  assert.match(picker, /variant=\{selected && locked \? "secondary" : selected \? "default" : "outline"\}/)
  assert.match(picker, /aria-pressed=\{selected\}/)
  assert.match(picker, /<Check/)
  assert.match(picker, /options: readonly RegistrationSubject\[\]/)
  assert.match(picker, /grade: string/)
  assert.match(picker, /disabledReasonBySubject/)
  assert.match(picker, /grid-cols-3/)
  assert.match(picker, /locked \? "disabled:opacity-100"/)
  assert.doesNotMatch(picker, /\["영어", "수학"\]/)
  assert.match(create, /getRegistrationSubjectPickerAvailability/)
  assert.match(create, /reconcileRegistrationSubjectsForGrade/)
  assert.match(inquiry, /sortAcademicSubjects/)
})

test("saved subject tabs fit mobile without truncating the active subject while root-subject controls stay dense", async () => {
  const [tabs, initialPlan, actions, application] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-subject-tabs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
  ])
  assert.doesNotMatch(tabs, /overflow-x-auto/)
  assert.match(tabs, /tracks\.length === 1[\s\S]*?grid-cols-1[\s\S]*?tracks\.length === 2[\s\S]*?grid-cols-2[\s\S]*?grid-cols-3/)
  assert.match(tabs, /hidden sm:inline/)
  assert.match(tabs, /aria-label=\{`\$\{track\.subject\} \$\{track\.statusLabel\}`\}/)
  assert.match(tabs, /border-primary/)
  assert.match(initialPlan, /sortAcademicSubjects/)
  assert.match(initialPlan, /grid-cols-1[^"]*sm:grid-cols-3/)
  assert.match(initialPlan, /md:grid-cols-3/)
  assert.doesNotMatch(initialPlan, /const SUBJECT_ORDER: RegistrationSubject\[\] = \["영어", "수학"\]/)
  assert.doesNotMatch(actions, /const SUBJECTS: RegistrationSubject\[\] = \["영어", "수학"\]/)
  assert.match(application, /ACADEMIC_SUBJECT_VALUES\.indexOf\(left\.subject\)/)
  assert.match(application, /ACADEMIC_SUBJECT_VALUES\.indexOf\(right\.subject\)/)
})

test("science director UI consumes only the configured capability profile and teacher completion remains read-only", async () => {
  const [actions, application, model, workspace] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-model.js", import.meta.url), "utf8"),
    readWorkspaceSource(),
  ])
  assert.match(actions, /defaultDirectorProfileId/)
  assert.match(actions, /profile\.id === configuredProfileId/)
  assert.match(actions, /teacher\.subjects\?\.includes\("과학팀"\)/)
  assert.doesNotMatch(actions, /subject === "과학" \|\| subject === "과학팀"/)
  assert.match(workspace, /teacher\.subjects\?\.includes\("과학팀"\)/)
  assert.doesNotMatch(workspace, /subject === "과학" \|\| subject === "과학팀"/)
  assert.match(actions, /capabilities: subjectCapabilities/)
  assert.match(application, /subjectCapabilities=\{subjectCapabilities\}/)
  assert.match(model, /input\.viewerRole === "teacher" && input\.track\?\.subject === "과학"/)
  assert.match(model, /readOnly: !canManage/)
})

test("consultation outcomes do not load a separate class catalog", async () => {
  const application = await readFile(
    new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(application, /loadAssignedScienceConsultationClassOptions/)
  assert.doesNotMatch(application, /scienceConsultationClassOptions/)
  assert.doesNotMatch(application, /loadOpsTaskWorkspaceOptionData/)
})

test("registration create mounts the shared application with only actionable intake fields", async () => {
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")
  const workspace = await readWorkspaceSource()

  assert.match(create, /import \{ RegistrationApplicationShell \} from "\.\/registration-application-shell"/)
  assert.match(create, /import \{ RegistrationApplicationInquirySection \} from "\.\/registration-application-inquiry-section"/)
  assert.match(create, /getRegistrationCreateSectionStates/)
  assert.match(create, /RegistrationSubjectPicker/)
  assert.doesNotMatch(create, /RegistrationInitialLevelTestFields|RegistrationInitialConsultationFields/)
  assert.doesNotMatch(create, /READY_INITIAL_ACTIONS|INQUIRY_ONLY_INITIAL_ACTIONS|reconcileRegistrationInitialWorkflowCapabilities/)
  assert.doesNotMatch(create, /<form\b/)
  assert.doesNotMatch(create, /useState\(|createRegistrationInitialWorkflowDraft/)

  assert.match(create, /mode="create"/)
  assert.match(create, /inquiryAtLabel="저장 시각"/)
  assert.doesNotMatch(create + workspace, /문의 채널|문의채널|inquiryChannel/)

  assert.match(workspace, /const initialDraft = createRegistrationInitialWorkflowDraft\(subjects\)/)
  assert.doesNotMatch(create, /레벨테스트 예약일시|방문상담 예약일시|상담 책임자/)
  assert.doesNotMatch(create, /RegistrationApplicationPlacementSection|RegistrationApplicationAdmissionSection|대기 종류|수업 시작 일정/)
  assert.doesNotMatch(create, /첫 저장 후 자동 기록됩니다/)
  assert.doesNotMatch(create, /onSaveHistory|이력 추가|이력 수정|이력 삭제/)
})

test("saved appointments expose the two canonical places as direct choices", async () => {
  const [initialPlan, appointmentEditor] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8"),
  ])
  const initialLevelTest = sourceBetween(
    initialPlan,
    "export function RegistrationInitialLevelTestFields",
    "export function RegistrationInitialConsultationFields",
  )
  const initialConsultation = sourceBetween(
    initialPlan,
    "export function RegistrationInitialConsultationFields",
    "export function RegistrationInitialPlanControl",
  )

  assert.match(initialLevelTest, /data-registration-focus="levelTestPlace"[\s\S]*?<RegistrationSelect[\s\S]*?placeholder="장소 선택"[\s\S]*?REGISTRATION_LEVEL_TEST_PLACES\.map/)
  assert.match(initialConsultation, /data-registration-focus="visitConsultationPlace"[\s\S]*?<RegistrationSelect[\s\S]*?placeholder="장소 선택"[\s\S]*?REGISTRATION_LEVEL_TEST_PLACES\.map/)
  const appointmentPlace = sourceBetween(
    appointmentEditor,
    'data-appointment-field="place"',
    "{legacyLevelTestPlace ?",
  )
  assert.doesNotMatch(appointmentPlace, /<RegistrationSelect/)
  assert.match(appointmentPlace, /REGISTRATION_LEVEL_TEST_PLACES\.map\(\(option\) =>/)
  assert.match(appointmentPlace, /aria-label=\{`\$\{appointmentParticipantSubjectLabel\} 예약 장소 \$\{option\}`\}/)
  assert.match(appointmentPlace, /aria-pressed=\{selectedPlace === option\}/)
  assert.match(appointmentEditor, /!selectedPlace[\s\S]*?\[data-appointment-field=place\] button/)
  assert.doesNotMatch(appointmentEditor, /placeholder="상담실"/)
  assert.match(appointmentEditor, /normalizeRegistrationLevelTestPlace\(place\) \?\? ""/)
  assert.match(appointmentEditor, /기존 저장 장소: \{appointment\?\.place\}/)
})

test("registration detail keeps every workflow section visible in one continuous workspace", async () => {
  const [model, shell] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
  ])

  assert.match(model, /upcoming: boolean/)
  assert.match(shell, /id=\{`registration-application-\$\{section\}`\}/)
  assert.match(shell, /<section[\s\S]*?SECTION_TITLES\[section\][\s\S]*?\{children\}[\s\S]*?<\/section>/)
  assert.match(shell, /lg:grid-cols-\[7rem_minmax\(0,1fr\)\]/)
  assert.match(shell, /sticky -top-6/)
  assert.doesNotMatch(shell, /SECTION_INDEX|01|02|03|04|05|06/)
  assert.doesNotMatch(shell, /Collapsible|ChevronDown|data-\[state=closed\]:hidden|<details\b|<summary\b/)
})

test("registration detail owns a booking-only observation slot and guards generic workflow changes", async () => {
  const [editor, shell] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
  ])

  assert.match(editor, /isRegistrationObservationWorkflowStatus\(activeTrack\.workflowStatus\)/)
  assert.match(editor, /<RegistrationObservationEditor/)
  assert.match(editor, /observationRuntime\.available/)
  assert.match(editor, /observationSummaryVisible/)
  assert.match(shell, /observation\?: ReactNode/)
  assert.match(shell, /observation: "observation"/)
})

test("registration detail uses a wide document surface with a compact subject and status header", async () => {
  const [workspace, subjectTabs, editor, inquiryFields] = await Promise.all([
    readFile(new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-subject-tabs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-inquiry-fields.tsx", import.meta.url), "utf8"),
  ])

  assert.match(workspace, /registrationApplicationHost\.kind === "detail"[\s\S]*?sm:max-w-\[min\(96vw,84rem\)\]/)
  assert.match(editor, /scroll-mt-52 lg:scroll-mt-40/)
  assert.match(subjectTabs, /border-b/)
  assert.match(subjectTabs, /border-primary/)
  assert.doesNotMatch(subjectTabs, /sm:grid-cols-3/)
  assert.match(editor, /data-registration-workflow-status=""/)
  assert.match(inquiryFields, /xl:grid-cols-3/)
})

test("empty saved sections show a quiet empty state instead of an outlined blank frame", async () => {
  const [editor, levelTestSection, consultationSection, placementSection] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-level-test-section.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-consultation-section.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-placement-section.tsx", import.meta.url), "utf8"),
  ])

  assert.match(editor, /Children\.toArray\(children\)/)
  assert.match(editor, /입력된 내용 없음/)
  assert.match(editor, /hasVisibleContent \? "grid gap-3" : "py-1"/)
  assert.doesNotMatch(editor, /border-primary\/60|bg-primary\/\[0\.025\]/)
  assert.doesNotMatch(editor, /return section === "inquiry"\s*\|\|/)
  for (const section of [levelTestSection, consultationSection, placementSection]) {
    assert.match(section, /Children\.toArray\(/)
    assert.match(section, /visibleContent\.length > 0/)
  }
})

test("registration create keeps actionable scheduling fields in approved order", async () => {
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")
  const initialPlan = await readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8")
  const levelTest = sourceBetween(
    initialPlan,
    "export function RegistrationInitialLevelTestFields",
    "export function RegistrationInitialConsultationFields",
  )
  const assertOrdered = (source, labels) => {
    let cursor = -1
    for (const label of labels) {
      const next = source.indexOf(label, cursor + 1)
      assert.ok(next > cursor, `${label} follows the approved order`)
      cursor = next
    }
  }

  assertOrdered(levelTest, [
    "<span>레벨테스트 예약일시</span>",
    "<span>장소</span>",
  ])
  assert.doesNotMatch(levelTest, /결과 링크|시험 시작·완료 상태|시험지·결과지 링크|참여 과목|ParticipantBadges/)
  assert.doesNotMatch(create, /waiting=\{|registration=\{|admission=\{|ReadonlyCreateField/)
  assert.match(levelTest, /data-registration-focus="levelTestAt"/)
  assert.match(levelTest, /data-registration-focus="levelTestPlace"/)
  assert.match(initialPlan, /data-registration-focus=\{`counselor:\$\{subject\}`\}/)
  assert.match(initialPlan, /data-registration-focus="visitConsultationAt"/)
  assert.match(initialPlan, /data-registration-focus="visitConsultationPlace"/)
})

test("registration create owns one accurate inquiry lock reason without a duplicate runtime note", async () => {
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")

  assert.match(create, /const inquiryLockReason = disabled[\s\S]*?저장 중입니다/)
  assert.match(create, /persistence\.mode\.startsWith\("blocked_"\)[\s\S]*?note/)
  assert.match(create, /inquiry: \{ \.\.\.base\.inquiry, lockReason: inquiryLockReason \}/)
  assert.match(create, /const showInquiryOnlyNote = persistence\.mode === "canonical_inquiry"[\s\S]*?legacy_inquiry/)
  assert.match(create, /exceptionContent=\{\([\s\S]*?showInquiryOnlyNote/)
  assert.doesNotMatch(create, /RegistrationInitialRouteFields/)
  assert.doesNotMatch(create, /exceptionContent=\{note \?/)
})

test("registration create keeps only actionable fields visible and controls dashboard selects for their full lifetime", async () => {
  const [shell, create, initialPlan, detail] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
  ])

  assert.match(shell, /CREATE_UI_SECTION_ORDER = \["inquiry"\]/)
  assert.match(shell, /props\.mode === "create"\s*\? CREATE_UI_SECTION_ORDER/)
  assert.match(shell, /props\.mode === "detail" && props\.progress/)
  assert.doesNotMatch(shell, />펼치기</)

  assert.doesNotMatch(create, /waiting=\{|registration=\{|admission=\{/)
  assert.doesNotMatch(create, /ReadonlyCreateField|첫 저장 후 자동 기록됩니다/)
  assert.match(create, /inquiryAtLabel="저장 시각"/)
  assert.doesNotMatch(create, /RegistrationApplicationProgressStepper|enabledKeys=|progress=\{/)

  assert.doesNotMatch(initialPlan, /결과 링크|전화상담 대기 기준일시|상담 결과/)
  assert.match(initialPlan, /<Select value=\{value\}/)
  assert.doesNotMatch(initialPlan, /value=\{value \|\| undefined\}/)
  assert.equal((detail.match(/<RegistrationApplicationSubjectTabs/g) || []).length, 1)
})

test("waiting and registration track panels keep unique ids under one subject switcher", async () => {
  const detail = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")

  assert.match(detail, /const panelSection = section === "placement"[\s\S]*?placementMode/)
  assert.match(detail, /id=\{`registration-\$\{panelSection\}-\$\{context\.track\.id\}`\}/)
  assert.match(detail, /panel: "waiting"[\s\S]*?placementMode: "waiting"/)
  assert.match(detail, /panel: "registration"[\s\S]*?placementMode: "registration"/)
  assert.match(detail, /filter\(\(candidate\) => hasRegistrationTrackFrameContent/)
  assert.doesNotMatch(detail, /panel: "admission"/)
  assert.doesNotMatch(detail, /id=\{`registration-\$\{section\}-\$\{context\.track\.id\}`\}/)
})

async function loadCaseListModel() {
  return import("../src/features/tasks/registration-case-list-model.ts");
}

function fixtureTasks() {
  return [{
    id: "case-1",
    type: "registration",
    status: "requested",
    title: "등록: 김다미",
    studentName: "김다미",
    registrationTracks: [
      {
        id: "eng",
        subject: "영어",
        status: "consultation_waiting",
        directorProfileId: "director-1",
        directorName: "강부희",
        stageEnteredAt: "2026-07-10T00:00:00Z",
        phoneReadyAt: "2026-07-10T02:00:00Z",
        phoneReadySource: "inquiry",
        migrationReviewRequired: false,
      },
      {
        id: "math",
        subject: "수학",
        status: "level_test_scheduled",
        directorProfileId: "director-2",
        directorName: "양소윤",
        stageEnteredAt: "2026-07-11T00:00:00Z",
        migrationReviewRequired: false,
      },
    ],
  }];
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("case list renders one keyed application row in each responsive surface", async () => {
  const source = await readListSource();

  assert.match(source, /export function RegistrationCaseList/);
  assert.match(source, /export function RegistrationCaseListRow/);
  assert.match(source, /data-testid="registration-case-desktop-list"/);
  assert.match(source, /data-testid="registration-case-mobile-list"/);
  assert.match(source, /key=\{item\.taskId\}/);
  assert.doesNotMatch(source, /RegistrationCaseTracks|item\.tracks\.map/);
  assert.match(source, /item\.matchingTracks\.map/);
});

test("case list makes the whole visible row a keyboard-accessible entry point", async () => {
  const source = await readListSource()

  assert.equal((source.match(/data-registration-case-row=""/g) || []).length, 2)
  assert.equal(
    (source.match(/const entryAvailable = !disabled && canOpenRegistrationCaseListItem\(item\)/g) || []).length,
    2,
    "both responsive rows must retain base-detail interaction for concealed observation rows",
  )
  assert.equal((source.match(/tabIndex=\{entryAvailable \? 0 : undefined\}/g) || []).length, 2)
  assert.equal(
    (source.match(/onClick=\{entryAvailable \? \(\) => openRegistrationCase\(item\) : undefined\}/g) || []).length,
    2,
  )
  assert.equal(
    (source.match(/aria-label=\{`\$\{item\.studentName\} 등록 신청\$\{entryAvailable \? " 열기" : ""\}`\}/g) || []).length,
    2,
  )
  assert.match(source, /event\.key !== "Enter" && event\.key !== " "/)
  assert.match(
    source,
    /item\.matchingTracks\.find\(\(track\) => track\.observationSummaryVisible\)\s*\|\| item\.representativeTrack/,
    "a concealed observation row must fall back to the general case-detail track",
  )
  assert.doesNotMatch(source, /ArrowUpRight|TRACK_MANAGEMENT_LABELS/)
  assert.match(source, /const showActionColumn = items\.some\(canDelete\)/)
})

test("case projection retains canonical phone and visit dates", async () => {
  const { getRegistrationCaseTrackTimeValue } = await loadCaseListModel()
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "consultation_waiting", stageEnteredAt: "stage", phoneReadyAt: "phone", visitScheduledAt: "visit" }), "phone")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "visit_consultation_scheduled", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "visit" }), "visit")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "consultation_completed", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "" }), "")
})

test("canonical registration deletion is admin-only and allowed only during registration inquiry", async () => {
  const { canDeleteRegistrationCase } = await loadCaseListModel()
  assert.equal(typeof canDeleteRegistrationCase, "function")

  const task = fixtureTasks()[0]
  task.registrationTracks = task.registrationTracks.map((track) => ({
    ...track,
    workflowStatus: "inquiry",
  }))
  assert.equal(canDeleteRegistrationCase(task, "admin"), true)
  assert.equal(canDeleteRegistrationCase(task, "staff"), false)

  const legacyAdvanced = {
    ...task,
    registrationTracks: task.registrationTracks.map((track, index) => index === 0
      ? { ...track, status: "consultation_completed" }
      : track),
  }
  assert.equal(canDeleteRegistrationCase(legacyAdvanced, "admin"), false)

  const enrollmentStarted = {
    ...task,
    registrationTracks: task.registrationTracks.map((track, index) => index === 0
      ? { ...track, enrollmentDetailRows: [{ classId: "class-1" }] }
      : track),
  }
  assert.equal(canDeleteRegistrationCase(enrollmentStarted, "admin"), false)

  for (const workflowStatus of ["level_test_requested", "consultation_requested", "consultation_completed", "waiting_current_class", "enrollment_requested", "payment_in_progress", "registered", "not_registered"]) {
    const advanced = {
      ...task,
      registrationTracks: task.registrationTracks.map((track, index) => index === 0 ? { ...track, workflowStatus } : track),
    }
    assert.equal(canDeleteRegistrationCase(advanced, "admin"), false, workflowStatus)
  }
})

test("one parent application remains one list item while retaining every subject", async () => {
  const { buildRegistrationCaseListItems } = await loadCaseListModel();
  const items = buildRegistrationCaseListItems(fixtureTasks());

  assert.equal(items.length, 1);
  assert.equal(items[0].taskId, "case-1");
  assert.deepEqual(items[0].tracks.map((item) => item.trackId), ["eng", "math"]);
});

test("one application can appear in different views without duplicating a view row", async () => {
  const {
    buildRegistrationCaseListItems,
    filterRegistrationCaseListItems,
  } = await loadCaseListModel();
  const items = buildRegistrationCaseListItems(fixtureTasks());

  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "consulting").map((item) => item.taskId)),
    ["case-1"],
  );
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "level_test").map((item) => item.taskId)),
    ["case-1"],
  );
});

test("application search narrows the selected view by student, phone, subject, director, and place", async () => {
  const {
    buildRegistrationCaseListItems,
    filterRegistrationCaseListItems,
  } = await loadCaseListModel();
  const tasks = fixtureTasks();
  tasks[0].registration = {
    parentPhone: "010-1234-5678",
    studentPhone: "010-8765-4321",
  };
  tasks.push({
    ...tasks[0],
    id: "case-visit",
    title: "등록: 박방문",
    studentName: "박방문",
    registration: {
      parentPhone: "010-9999-0000",
      studentPhone: "",
    },
    registrationTracks: [{
      ...tasks[0].registrationTracks[0],
      id: "math-visit",
      subject: "수학",
      status: "visit_consultation_scheduled",
      directorName: "이상담",
      visitScheduledAt: "2026-07-20T09:00:00Z",
      visitPlace: "별관 상담실",
    }],
  });
  const items = buildRegistrationCaseListItems(tasks);

  for (const query of ["김다미", "1234-5678", "영어", "강부희"]) {
    assert.deepEqual(
      plain(filterRegistrationCaseListItems(items, "consulting", query).map((item) => item.taskId)),
      ["case-1"],
      `${query} should find only the matching application`,
    );
  }
  for (const query of ["박방문", "9999-0000", "이상담", "별관 상담실"]) {
    assert.deepEqual(
      plain(filterRegistrationCaseListItems(items, "consulting", query).map((item) => item.taskId)),
      ["case-visit"],
      `${query} should find only the matching application`,
    );
  }
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "consulting", "수학").map((item) => item.taskId)),
    ["case-1", "case-visit"],
    "subject search should find every matching application in the current view",
  )
});

test("phone consultation applications are oldest-first without reordering other views", async () => {
  const {
    buildRegistrationCaseListItems,
    filterRegistrationCaseListItems,
  } = await loadCaseListModel();
  const tasks = fixtureTasks();
  const baseTask = tasks[0];
  tasks.unshift({
    ...baseTask,
    id: "case-2",
    studentName: "신규",
    registrationTracks: [{
      ...baseTask.registrationTracks[0],
      id: "eng-newer",
      taskId: "case-2",
      stageEnteredAt: "2026-07-12T00:00:00Z",
      phoneReadyAt: "2026-07-12T02:00:00Z",
    }],
  });
  tasks.push({
    ...baseTask,
    id: "case-3",
    studentName: "방문",
    registrationTracks: [{
      ...baseTask.registrationTracks[0],
      id: "eng-visit",
      status: "visit_consultation_scheduled",
      stageEnteredAt: "2026-07-09T00:00:00Z",
    }],
  });
  tasks.push({
    ...baseTask,
    id: "case-4",
    studentName: "수학 후속",
    registrationTracks: [{
      ...baseTask.registrationTracks[1],
      id: "math-second",
      stageEnteredAt: "2026-07-08T00:00:00Z",
    }],
  });

  const items = buildRegistrationCaseListItems(tasks);
  const originalItems = plain(items);
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "consulting").map((item) => item.taskId)),
    ["case-1", "case-2", "case-3"],
  );
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "level_test").map((item) => item.taskId)),
    ["case-1", "case-4"],
  );
  assert.deepEqual(plain(items), originalItems, "filtering must not mutate the shared track list");
});

test("case list renders application-scoped desktop and mobile rows", async () => {
  const source = await readListSource();

  assert.match(source, /export function RegistrationCaseList/);
  assert.match(source, /data-testid="registration-case-desktop-list"/);
  assert.match(source, /data-testid="registration-case-mobile-list"/);
  assert.match(source, /item\.studentName/);
  assert.match(source, /function RegistrationCaseStudentIdentity/);
  assert.match(source, /function RegistrationCasePill/);
  assert.match(source, /registration\?\.schoolGrade/);
  assert.match(source, /registration\?\.schoolName/);
  assert.match(source, /RegistrationCaseTrackValue/);
  assert.doesNotMatch(source, /RegistrationCaseTracks|item\.tracks\.map/);
  assert.match(source, /item\.matchingTracks\.map/);
  assert.match(source, /min-w-0/);
  assert.match(source, /overflow-hidden/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /visitScheduledAt/);
  assert.match(source, /visitPlace/);
  assert.match(source, /phoneReadyAt/);
  assert.match(source, /className="grid min-w-0 gap-2 p-2 lg:hidden"/);
  assert.match(source, /className="hidden w-full min-w-0 overflow-hidden lg:block"/);
  assert.match(source, /className="min-w-0 overflow-hidden bg-background lg:rounded-lg lg:border"/);
  assert.doesNotMatch(source, /md:hidden|md:block/);
  assert.match(source, /const targetTrack = item\.viewKey === "observation"[\s\S]*?item\.matchingTracks\.find\(\(track\) => track\.observationSummaryVisible\)[\s\S]*?: item\.representativeTrack/);
  assert.match(source, /if \(!targetTrack\) return/);
  assert.match(source, /onEdit\(item\.taskId, targetTrack\.trackId\)[\s\S]*?onOpen\(item\.taskId, targetTrack\.trackId\)/);
  assert.match(source, /break-words \[overflow-wrap:anywhere\]/);
  assert.match(source, /"빠른 처리"/);
  assert.match(source, /"요청 사항"/);
  assert.match(source, /"레벨테스트 결과"/);
  assert.match(source, /"상담 방식"/);
  assert.match(source, /"대기 유형 · 수업"/);
  assert.match(source, /"입학신청서"/);
  assert.match(source, /"메이크에듀"/);
  assert.match(source, /"청구서"/);
  assert.match(source, /"수납"/);
  assert.match(source, /levelTestMaterialLink/);
  assert.match(source, /waitingDetailKind/);
  assert.match(source, /enrollmentDetailRows/);
  assert.match(source, /classLabelById\.get\(row\.classId\) \|\| "수업 정보 확인 필요"/);
  assert.match(source, /textbookLabelById\.get\(row\.textbookId\) \|\| "교재 정보 확인 필요"/);
});

test("level-test list uses only active canonical appointment values", async () => {
  const source = await readListSource();
  const levelTestCells = sourceBetween(
    source,
    'if (item.viewKey === "level_test")',
    'if (item.viewKey === "consultation_requested")',
  );

  assert.match(levelTestCells, /getRegistrationCaseLevelTestAppointments/);
  assert.match(levelTestCells, /"미정"/);
  assert.doesNotMatch(levelTestCells, /registration\?\.levelTestAt|registration\?\.levelTestPlace|stageEnteredAt|workflowStatusEnteredAt/);
});

test("consultation-requested list uses only an active phone or visit reservation", async () => {
  const source = await readListSource();
  const consultationCells = sourceBetween(
    source,
    'if (item.viewKey === "consultation_requested")',
    'if (item.viewKey === "consultation_completed")',
  );

  assert.match(source, /getRegistrationCaseConsultationMode/);
  assert.match(consultationCells, /"전화상담"/);
  assert.match(consultationCells, /"방문상담"/);
  assert.match(consultationCells, /"미정"/);
  assert.doesNotMatch(consultationCells, /stageEnteredAt|status === "consultation_waiting"/);
});

test("waiting list shows the manual workflow entry time instead of the legacy pipeline time", async () => {
  const source = await readListSource();
  const waitingCells = sourceBetween(
    source,
    'if (item.viewKey === "waiting")',
    'if (item.viewKey === "enrollment")',
  );

  assert.match(waitingCells, /workflowStatusEnteredAt/);
  assert.doesNotMatch(waitingCells, /track\.stageEnteredAt/);
});

test("desktop application rows provide one table cell for each column while mobile cards stay shared", async () => {
  const source = await readListSource();
  const desktopSource = source.slice(source.indexOf('data-testid="registration-case-desktop-list"'));

  assert.match(desktopSource, /<RegistrationCaseListRow item=\{item\}[\s\S]*?cellRole="cell"/);
  assert.match(source, /role=\{cellRole\}/);
  assert.match(source, /<RegistrationCaseProcessCells[\s\S]*?item=\{item\}[\s\S]*?cellRole=\{cellRole\}/);
  assert.equal((source.match(/role=\{cellRole\}/g) || []).length, 2);
});

test("registration enrollment controls stay responsive without truncated labels", async () => {
  const enrollmentSource = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(enrollmentSource, /className="min-w-0 flex-1 truncate">\{classItem\?\.label/);
  assert.match(enrollmentSource, /sm:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(0,1fr\)_minmax\(0,1\.25fr\)_auto\]/);
  assert.match(enrollmentSource, /<RegistrationSelect[\s\S]*?aria-label=\{`\$\{track\.subject\} 수업 \$\{index \+ 1\} 선택`\}/);
});

test("selected visit consultation card shows the canonical appointment time and place", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /visitAppointment/)
  assert.match(source, /visitConsultation\?\.appointmentId/)
  assert.match(source, /방문상담 일시/)
  assert.match(source, /방문상담 장소/)
  assert.match(source, /visitAppointment\.scheduledAt/)
  assert.match(source, /visitAppointment\.place/)
})

test("selected phone consultation card shows active readiness without a stage fallback", async () => {
  const source = await readRegistrationApplicationSource()
  const detail = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const phoneCard = sourceBetween(
    source,
    'if (track.status === "consultation_waiting")',
    'if (["level_test_scheduled", "level_test_in_progress"].includes(track.status))',
  )

  assert.match(phoneCard, /전화상담 대기 기준일시/)
  assert.match(phoneCard, /activeConsultation\?\.readyAt/)
  assert.match(phoneCard, /formatRegistrationDateTime/)
  assert.doesNotMatch(phoneCard, /stageEnteredAt/)
  assert.doesNotMatch(detail, /<RegistrationTrackStageEditor/)
  assert.match(detail, /RegistrationConsultationOutcomeEditor/)
})

test("unbatched enrollment drafts may omit a schedule without gating the admission checklist", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const draftBlock = sourceBetween(source, "const blockers = useMemo", "function updateRow")
  const checklistBlock = source.slice(source.indexOf("export function RegistrationAdmissionPanel"))
  assert.match(draftBlock, /requireSchedule:\s*false/)
  assert.doesNotMatch(checklistBlock, /classStartSession|selectedEnrollmentsHaveCompleteSchedules|requireSchedule/)
  assert.doesNotMatch(checklistBlock, /먼저 완료|입학 처리 전에/)
})

test("case list keeps the Notion-like workflow status editable in place without a parallel quick-action path", async () => {
  const source = await readListSource();
  const workspace = await readWorkspaceSource();

  assert.match(source, /getRegistrationSummaryActionPermissions/);
  assert.match(source, /getRegistrationInlineWorkflowStatusOptions/);
  assert.match(source, /<RegistrationSelect/);
  assert.match(source, /aria-label=\{`\$\{track\.subject\} \$\{studentName\} 진행상태`\}/);
  assert.match(source, /if \(isRegistrationObservationWorkflowStatus\(track\.workflowStatus\)\) \{[\s\S]*?return <RegistrationTrackStatusBadge/);
  assert.match(source, /onValueChange=\{\(value\) => \{[\s\S]*?const nextStatus = options\.find\(\(option\) => option\.value === value\)\?\.value[\s\S]*?if \(nextStatus\) onStatusChange\(track, nextStatus\)/);
  assert.doesNotMatch(source, /value as OpsRegistrationWorkflowStatus/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /onOpen\(item\.taskId, targetTrack\.trackId\)/);
  assert.match(source, /onEdit\(item\.taskId, targetTrack\.trackId\)/);
  assert.doesNotMatch(source, /onAction|complete_consultation|전화상담 완료/);
  assert.doesNotMatch(source, /getRegistrationActionPermissions/);
  assert.doesNotMatch(source, /\.consultations/);
  assert.match(
    source,
    /permissions\.canManage[\s\S]*?onEdit\(item\.taskId, targetTrack\.trackId\)[\s\S]*?else onOpen\(item\.taskId, targetTrack\.trackId\)/,
    "one contextual open action should replace duplicate detail and management buttons",
  );
  assert.match(workspace, /await setRegistrationWorkflowStatus\(\{/);
  assert.match(workspace, /expectedWorkflowRevision: track\.workflowRevision/);
  assert.match(workspace, /onStatusChange=\{\(track, workflowStatus\)/);
});

test("workspace derives tab counts from application cases before filtering the selected view", async () => {
  const source = await readWorkspaceSource();

  assert.match(source, /buildRegistrationCaseListItems/);
  assert.match(source, /filterRegistrationCaseListItems/);
  assert.match(source, /getRegistrationCaseTabCounts/);
  assert.match(source, /const registrationCaseItems = useMemo/);
  assert.match(source, /getRegistrationCaseTabCounts\(registrationCaseItems\)/);
  assert.match(source, /const visibleRegistrationCaseItems = useMemo/);
  assert.match(
    source,
    /filterRegistrationCaseListItems\(\s*registrationCaseItems,\s*registrationView,\s*deferredQuery,\s*\{ consultationOwnerId \},\s*\)/,
  );
  assert.match(source, /<RegistrationCaseList/);
  assert.match(source, /items=\{displayedRegistrationCaseItems\}/);
  assert.match(source, /viewerId=\{registrationViewerId\}/);
  assert.match(source, /viewerRole=\{registrationViewerRole\}/);
  assert.doesNotMatch(source, /\bregistrationPipeline\b/);
  assert.doesNotMatch(source, /isRegistrationPipelineInView/);
  assert.match(source, /const visibleWorkspaceItemCount = isRegistrationWorkspace[\s\S]*?visibleRegistrationCaseItems\.length/);
  assert.match(source, /shouldHideEmptySurface = !loading && visibleWorkspaceItemCount === 0/);
  assert.match(source, /const registrationEmptyLabel = hasQuery[\s\S]*?현재 단계에서 검색 결과가 없습니다\./);
  assert.match(source, /등록 업무가 없습니다\./);
  assert.match(source, /emptyLabel=\{registrationEmptyLabel\}/);
  assert.match(
    source,
    /loading \? \(\s*isRegistrationWorkspace \? \([\s\S]*?등록 업무를 불러오는 중입니다\./,
  );
});

test("registration deep links preserve task, track, and appointment ids and clear them on close", async () => {
  const source = await readWorkspaceSource();
  const deepLinkEffect = sourceBetween(
    source,
    "  useEffect(() => {\n    if (deleteTarget) return",
    "\n  function handleDetailOpenChange",
  );
  const closeHandler = sourceBetween(
    source,
    "  function handleDetailOpenChange",
    "\n  function closeForm",
  );

  assert.match(source, /const \[selectedRegistrationTrackId, setSelectedRegistrationTrackId\] = useState/);
  assert.match(source, /searchParams\.set\("trackId", nextTrackId\)/);
  assert.match(source, /searchParams\.delete\("trackId"\)/);
  assert.match(source, /searchParams\.set\("appointmentId", nextAppointmentId\)/);
  assert.match(source, /searchParams\.delete\("appointmentId"\)/);
  assert.match(source, /syncTaskDeepLink\(taskId, trackId, null, "push"\)/);
  assert.match(deepLinkEffect, /const currentSearchParams = new URLSearchParams\(window\.location\.search\)/);
  assert.match(deepLinkEffect, /currentSearchParams\.get\("taskId"\)/);
  assert.match(deepLinkEffect, /currentSearchParams\.get\("trackId"\)/);
  assert.match(deepLinkEffect, /getRegistrationDirectDeepLinkTarget\(\{/);
  assert.match(deepLinkEffect, /workspaceReady: Boolean\(data && workspaceDataBelongsToCurrentViewer\)/);
  assert.match(deepLinkEffect, /\{ allowDirectLoad: true \}/);
  assert.doesNotMatch(deepLinkEffect, /(^|[^.\w])searchParams\.get\(/m);
  assert.match(deepLinkEffect, /setSelectedRegistrationTrackId\(deepLinkedTrackId\)/);
  assert.match(closeHandler, /setDetailOpen\(nextOpen\)/);
  assert.match(closeHandler, /setSelectedRegistrationTrackId\(null\)/);
  assert.match(closeHandler, /setRegistrationCaseDetail\(null\)/);
  assert.match(closeHandler, /syncTaskDeepLink\(null\)/);
  assert.match(source, /if \(isLegacyRegistrationTrackId\(trackId\)\)/);
  assert.match(source, /syncTaskDeepLink\(taskId, null\)/);
  assert.match(source, /deepLinkedTask\.type !== "registration" && \(deepLinkedTrackId \|\| deepLinkedAppointmentId\)[\s\S]*?syncTaskDeepLink\(deepLinkedTaskId, null\)/);
});

test("inline status changes reload the list after the optimistic interaction boundary", async () => {
  const source = await readWorkspaceSource();

  assert.match(source, /const handleRegistrationWorkflowStatusChange = useCallback/);
  assert.match(source, /track\.workflowStatus === workflowStatus/);
  assert.match(source, /createRegistrationMutationRequestKey\("registration-workflow-status", track\.trackId\)/);
  assert.match(source, /setRegistrationWorkflowStatus\(\{/);
  assert.match(source, /expectedWorkflowRevision: track\.workflowRevision/);
  assert.match(source, /await reload\(true, false\)/);
  assert.match(source, /진행상태를 변경하지 못했습니다/);
  assert.doesNotMatch(source, /handleRegistrationTrackAction|RegistrationCaseListAction/);
});

test("track editor shows common information once and subject-scoped navigation", async () => {
  const [application, inquiry] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8"),
  ])
  const editorSource = sourceBetween(
    inquiry,
    "export function RegistrationInquiryEditor",
    "export type RegistrationApplicationInquirySectionProps",
  )
  assert.match(application, /<RegistrationInquiryEditor/)
  assert.match(application, /saveRegistrationCaseInquiry/)
  assert.match(application, /expectedCommonRevision:\s*detail\.commonRevision/)
  assert.match(application, /expectedSubjects:\s*orderedTracks\.map/)
  assert.match(application, /const genericDetail = useMemo<OpsRegistrationCaseDetail>/)
  assert.match(application, /getRegistrationIdentityEditLock\(genericDetail\)/)
  assert.match(application, /activeTrackId/)
  assert.match(application, /track\.subject/)
  assert.match(application, /track\.status/)
  assert.match(inquiry, /canonicalDraftKey = `\$\{detail\.task\.id\}:\$\{detail\.commonRevision\}:\$\{canonicalSubjects\.join\("\|"\)\}`/)
  assert.match(inquiry, /payloadKey/)
  assert.doesNotMatch(editorSource, /DateTimePickerControl/)
  assert.match(
    editorSource,
    /inquiryAt: toLocalDateTime\(registration\.inquiryAt \|\| detail\.task\.createdAt\)/,
    "legacy cases without inquiryAt must remain editable by falling back to their immutable creation time",
  )
  assert.match(editorSource, /campus: detail\.task\.campus \|\| "본관"/)
  assert.match(editorSource, /const valid = Boolean\([\s\S]*?draft\.campus\.trim\(\)[\s\S]*?draft\.inquiryAt/)
  assert.doesNotMatch(editorSource, /requiredLabel\("캠퍼스"|aria-label="캠퍼스"/)
  assert.doesNotMatch(editorSource, /requiredLabel\("우선순위"/)
  assert.match(inquiry, /<RegistrationSaveButton[\s\S]*?dirty=\{dirty\}[\s\S]*?actionLabel="변경사항 저장"/)
})

test("canonical detail uses one progressively filled registration application", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /import \{ RegistrationApplicationShell \} from "\.\/registration-application-shell"/)
  assert.match(source, /<RegistrationApplicationShell/)
  assert.match(source, /mode="detail"/)
  assert.match(source, /inquiry=\{/)
  assert.match(source, /levelTest=\{/)
  assert.match(source, /consultation=\{/)
  assert.match(source, /waiting=\{/)
  assert.match(source, /registration=\{/)
  assert.match(source, /admission=\{/)
  assert.match(source, /historyAction=\{<RegistrationApplicationHistoryAction/)
  assert.doesNotMatch(source, /history=\{<RegistrationHistoryTimeline/)
  assert.match(source, /role="tablist"/)
  assert.match(source, /aria-label="과목별 등록 진행"/)
  assert.match(source, /role="tab"/)
  assert.match(source, /aria-selected=\{selected\}/)
  assert.match(source, /role="tabpanel"/)
  assert.match(source, /hidden=\{!selected\}/)
  assert.match(source, /trackStates\.filter\(\(state\) => state\.trackId === activeTrackId\)/)
})

test("one application keeps subject navigation and actionable stage controls without duplicate summaries", async () => {
  const source = await readRegistrationApplicationSource()

  assert.doesNotMatch(source, /function RegistrationSubjectProgress/)
  assert.match(source, /RegistrationApplicationSubjectTabs/)
  assert.match(source, /orderedTracks\.map\(\(track\) =>/)
  assert.match(source, /STATUS_LABELS\[track\.status\]/)
  assert.match(source, /RegistrationTrackStageEditor/)
  assert.match(source, /RegistrationTrackDirectorSection/)
  assert.match(source, /RegistrationConsultationOutcomeEditor/)
  assert.match(source, /RegistrationEnrollmentTrackEditor/)
  assert.doesNotMatch(source, /function Registration(?:LevelTest|Consultation|Placement)Summary/)
})

test("two tracks at different statuses expose both current sections and actions in one saved application", async () => {
  const [source, actions, applicationModel] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    import("../src/features/tasks/registration-application-model.ts"),
  ])
  const makeTrack = (id, subject, status) => ({
    id,
    taskId: "registration-case",
    subject,
    status,
    legacy: false,
    directorProfileId: "director-1",
    directorName: "담당 원장",
    directorAssignmentSource: "default",
    directorAssignmentRuleKey: "fixture",
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: false,
    stageEnteredAt: "2026-07-20T00:00:00Z",
    phoneReadyAt: null,
    phoneReadySource: null,
  })
  const states = [
    applicationModel.getRegistrationApplicationTrackState({
      track: makeTrack("english-track", "영어", "level_test_scheduled"),
      canManage: true,
      canCompleteConsultation: false,
    }),
    applicationModel.getRegistrationApplicationTrackState({
      track: makeTrack("math-track", "수학", "consultation_waiting"),
      canManage: true,
      canCompleteConsultation: true,
    }),
  ]

  assert.deepEqual(states.map((state) => state.currentSection), ["level_test", "consultation"])
  assert.deepEqual(states[0].sections.level_test.actions, ["start_level_test", "record_level_test_result", "cancel_level_test"])
  assert.ok(states[1].sections.consultation.actions.includes("complete_phone_consultation"))
  assert.match(source, /orderedTracks\.map\(\(track\) => getRegistrationApplicationTrackState/)
  assert.match(source, /const trackContexts: TrackContext\[\] = genericTracks\.map/)
  assert.match(source, /return trackContexts[\s\S]*?\.filter\([\s\S]*?\.map\(\(context\) =>/)
  assert.match(source, /<RegistrationApplicationShell/)
  assert.doesNotMatch(source, /focusTrackId === context\.track\.id\) \? \(\s*<RegistrationConsultationOutcomeEditor/)
  assert.match(actions, /export function RegistrationTrackStageEditor/)
  assert.match(actions, /export function RegistrationEnrollmentTrackEditor/)
  assert.doesNotMatch(source, /selectedStageEditor|현재 업무/)
})

test("terminal subjects do not gate common edits and progressed subjects cannot be removed by sync", async () => {
  const [application, inquiry] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8"),
  ])
  const saveInquiry = sourceBetween(application, "async function saveInquiry", "function handleSubjectTabChange")

  assert.match(application, /<RegistrationInquiryEditor[\s\S]*?canEdit=\{canManageCase\}/)
  assert.match(saveInquiry, /saveRegistrationCaseInquiry/)
  assert.match(saveInquiry, /subjects/)
  assert.match(saveInquiry, /expectedSubjects/)
  assert.match(inquiry, /track\.status !== "inquiry" \|\| track\.migrationReviewRequired/)
  assert.match(inquiry, /disabledSubjects=/)
  assert.match(inquiry, /canonicalSubjects\.includes\(subject\) && !removableSubjects\.has\(subject\)/)
  assert.match(inquiry, /registration_subject_removal_blocked/)
})

test("all subjects share one case-level admission checklist without target badges", async () => {
  const application = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const admission = sourceBetween(application, "admission={(\n", "<RegistrationAlimtalkPreviewDialog")

  assert.equal((application.match(/<RegistrationAdmissionPanel/g) || []).length, 1)
  assert.match(application, /getRegistrationApplicationCaseEditableSections\(\{[\s\S]*?admissionBatches: detail\.admissionBatches/)
  assert.match(admission, /checklist=\{detail\.admissionChecklist\}/)
  assert.doesNotMatch(admission, /targetTrackIds|admissionTargetTracks|Badge|알림톡/)
})

test("saved and create applications share the intake shell while saved detail owns later stages", async () => {
  const [detail, create, actions, appointment, workspace] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8"),
    readWorkspaceSource(),
  ])

  for (const consumer of [detail, create]) {
    assert.match(consumer, /import \{ RegistrationApplicationShell \} from "\.\/registration-application-shell"/)
    assert.match(consumer, /RegistrationApplicationInquirySection/)
    assert.match(consumer, /from "\.\/registration-application-inquiry-section"/)
  }
  assert.match(detail, /RegistrationApplicationLevelTestSection/)
  assert.match(detail, /RegistrationApplicationConsultationSection/)
  assert.doesNotMatch(create, /RegistrationApplicationLevelTestSection|RegistrationApplicationConsultationSection/)
  assert.match(detail, /RegistrationApplicationPlacementSection/)
  assert.match(detail, /RegistrationApplicationAdmissionSection/)
  assert.doesNotMatch(create, /RegistrationApplicationPlacementSection|RegistrationApplicationAdmissionSection/)
  assert.match(detail, /closeAction=\{closeAction\}/)
  assert.match(detail, /historyAction=\{<RegistrationApplicationHistoryAction/)
  assert.doesNotMatch(create, /historyAction=/)
  assert.match(workspace, /showCloseButton=\{!canonicalRegistrationApplicationRendered\}/)
  assert.match(workspace, /closeAction=\{registrationDetailCloseAction\}/)
  assert.match(appointment, /embedded\?: boolean/)
  assert.match(appointment, /embedded\s*\?/)
  const outcome = sourceBetween(
    actions,
    "export function RegistrationConsultationOutcomeEditor",
    "export function RegistrationMigrationReviewEditor",
  )
  assert.doesNotMatch(outcome, /<Dialog|<DialogContent/)
  assert.doesNotMatch(detail + create, /<Dialog[\s>]|<DialogContent/)
  assert.match(actions, /from "@\/components\/ui\/dialog"/)
  assert.match(actions, /<Dialog[\s>][\s\S]*?<DialogContent/)
})

test("saved application keeps exception actions in their owning sections", async () => {
  const source = await readRegistrationApplicationSource()
  const inquiry = sourceBetween(source, "inquiry={(\n", "levelTest={(\n")
  const waiting = sourceBetween(source, "waiting={(\n", "observation={observationWorkspaceAvailable")
  const observation = sourceBetween(source, "observation={observationWorkspaceAvailable", "registration={registrationSection}")
  const registration = sourceBetween(source, "const registrationSection = (", "\n\n  return (")
  const admission = sourceBetween(source, "admission={(\n", "<RegistrationAlimtalkPreviewDialog")

  assert.match(source, /RegistrationMigrationReviewEditor/)
  assert.match(inquiry, /renderTrackFrames\("inquiry"\)/)
  assert.match(waiting, /renderTrackFrames\("placement", "waiting"\)/)
  assert.match(registration, /renderTrackFrames\("placement", "registration"\)/)
  assert.match(observation, /<RegistrationObservationEditor/)
  assert.doesNotMatch(observation, /RegistrationEnrollmentTrackEditor|RegistrationAdmissionPanel/)
  assert.match(source, /section === "placement"[\s\S]*?<RegistrationEnrollmentTrackEditor/)
  assert.match(admission, /RegistrationAdmissionPanel/)
  assert.match(admission, /checklist=\{detail\.admissionChecklist\}/)
  assert.doesNotMatch(admission, /cancelRegistrationAdmissionBatch|onOpenCustomerMessage/)
})

test("registration application threads the exact deep-linked attempt into the real observation editor mount", async () => {
  // Production break caught: the workspace loads a bounded row but the actual
  // RegistrationApplication/RegistrationObservationEditor mount drops it or
  // lets the ordinary active attempt override the URL target.
  const detail = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(detail, /deepLinkedAttempt\?: RegistrationObservationAttempt \| null/)
  assert.match(detail, /deepLinkedAttempt = null/)
  assert.match(detail, /const activeDeepLinkedAttempt = deepLinkedAttempt[\s\S]*?deepLinkedAttempt\.trackId === activeTrack\?\.id/)
  assert.match(detail, /deepLinkedAttempt=\{activeDeepLinkedAttempt\}/)
  assert.match(detail, /activeFeedbackObservationId = activeDeepLinkedAttempt\?\.observationId/)
  assert.match(
    detail,
    /const activeFeedbackTeacherProfileId = activeDeepLinkedAttempt\?\.teacherProfileId[\s\S]*?activeObservationDetail\?\.currentObservation\?\.teacherProfileId/,
  )
  assert.match(detail, /viewerId === activeFeedbackTeacherProfileId/)
})

test("mounted registration application accepts only its canonical observation booking target", async () => {
  const taskId = "76500000-0000-4000-8000-000000000001"
  const trackId = "76500000-0000-4000-8000-000000000002"
  const appointmentId = "76500000-0000-4000-8000-000000000003"
  const observationId = "76500000-0000-4000-8000-000000000004"
  const unknownTaskId = "76500000-0000-4000-8000-000000000005"
  const directorId = "76500000-0000-4000-8000-000000000006"
  const currentObservation = {
    observationId,
    taskId,
    trackId,
    appointmentId,
    status: "scheduled",
    appointmentStatus: "scheduled",
    revision: 3,
    appointmentNotificationRevision: 4,
    teacherProfileId: directorId,
  }
  const managerDetail = {
    track: {
      trackId,
      taskId,
      subject: "영어",
      workflowStatus: "observation_requested",
      workflowRevision: 9,
      observationReturnWorkflowStatus: null,
      directorProfileId: directorId,
    },
    currentObservation,
    latestEnrollmentDecisionObservationId: null,
    latestDecisionObservation: null,
    attempts: [currentObservation],
    classes: [],
  }
  const hookHarness = createRegistrationEditorHookHarness()
  const mounted = await loadMountedRegistrationApplication({
    hookHarness,
    loadManagerDetail: async () => managerDetail,
    loadFeedback: async () => null,
  })
  const props = {
    task: { id: taskId, title: "김학생 등록", studentName: "김학생", type: "registration" },
    detail: {
      task: { id: taskId, title: "김학생 등록", studentName: "김학생", registration: null },
      commonRevision: 1,
      tracks: [{
        id: trackId,
        taskId,
        subject: "영어",
        status: "observation_requested",
        workflowStatus: "observation_requested",
        workflowRevision: 9,
        directorProfileId: directorId,
        observationAttemptCount: 1,
        observationSummaryVisible: true,
        migrationReviewRequired: false,
        legacy: false,
        waitingKind: null,
      }],
      appointments: [{ id: appointmentId, taskId, trackId }],
      levelTests: [],
      consultations: [],
      enrollments: [],
      admissionBatches: [],
      admissionApplicationMessageStatus: "not_sent",
      admissionApplicationMessageClaimActive: false,
      admissionApplicationMessageId: null,
    },
    focusTrackId: trackId,
    viewerId: "76500000-0000-4000-8000-000000000007",
    viewerRole: "staff",
    onFocusTrack: () => undefined,
    onReload: async () => undefined,
    onWarning: () => undefined,
    subjectCapabilities: [],
    customerMessageClient: {},
    observationRuntime: { available: true, runtimeVersion: 1 },
    closeAction: null,
  }
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalHTMLElement = globalThis.HTMLElement
  globalThis.HTMLElement = class HTMLElement {}
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback()
      return 1
    },
    cancelAnimationFrame() {},
  }
  globalThis.document = {
    activeElement: null,
    getElementById() {
      return { scrollIntoView() {} }
    },
  }

  try {
    let view = hookHarness.render(mounted.RegistrationApplication, props)
    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(mounted.RegistrationApplication, props)
    hookHarness.flushEffects()
    const shell = findMountedRegistrationElement(
      view,
      (node) => node.type === mounted.RegistrationApplicationShell,
      "registration application shell",
    )
    const editor = findMountedRegistrationElement(
      shell.props.observation,
      (node) => node.type === mounted.RegistrationObservationEditor,
      "current observation editor",
    )

    editor.props.onOpenCustomerMessage({ messageKind: "observation_booking_bundle", sourceId: taskId })
    view = hookHarness.render(mounted.RegistrationApplication, props)
    hookHarness.flushEffects()
    let dialog = findMountedRegistrationElement(
      view,
      (node) => node.type === mounted.RegistrationAlimtalkPreviewDialog,
      "customer message dialog",
    )
    assert.equal(dialog.props.open, true)
    assert.deepEqual(dialog.props.target, { messageKind: "observation_booking_bundle", sourceId: taskId })

    editor.props.onOpenCustomerMessage({ messageKind: "observation_booking_bundle", sourceId: unknownTaskId })
    view = hookHarness.render(mounted.RegistrationApplication, props)
    hookHarness.flushEffects()
    dialog = findMountedRegistrationElement(
      view,
      (node) => node.type === mounted.RegistrationAlimtalkPreviewDialog,
      "fail-closed customer message dialog",
    )
    assert.equal(dialog.props.open, false)
    assert.equal(dialog.props.target, null)
  } finally {
    hookHarness.cleanup()
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.HTMLElement = originalHTMLElement
  }
})

test("mounted observation status selector returns an unbooked request through the withdrawal RPC", async () => {
  const taskId = "76600000-0000-4000-8000-000000000001"
  const trackId = "76600000-0000-4000-8000-000000000002"
  const directorId = "76600000-0000-4000-8000-000000000003"
  const withdrawalCalls = []
  const genericStatusCalls = []
  const reloadCalls = []
  const managerDetail = {
    track: {
      trackId,
      taskId,
      subject: "영어",
      workflowStatus: "observation_requested",
      workflowRevision: 5,
      observationReturnWorkflowStatus: "waiting_current_class",
      directorProfileId: directorId,
    },
    currentObservation: null,
    latestEnrollmentDecisionObservationId: null,
    latestDecisionObservation: null,
    attempts: [],
    classes: [],
  }
  const hookHarness = createRegistrationEditorHookHarness()
  const mounted = await loadMountedRegistrationApplication({
    hookHarness,
    loadManagerDetail: async () => managerDetail,
    loadFeedback: async () => null,
    withdrawObservation: async (input) => {
      withdrawalCalls.push(input)
      return { changed: true }
    },
    setWorkflowStatus: async (input) => {
      genericStatusCalls.push(input)
    },
    isOpsStatus: (status) => !String(status).startsWith("observation_"),
  })
  const props = {
    task: { id: taskId, title: "성다엘 등록", studentName: "성다엘", type: "registration" },
    detail: {
      task: { id: taskId, title: "성다엘 등록", studentName: "성다엘", registration: null },
      commonRevision: 1,
      tracks: [{
        id: trackId,
        taskId,
        subject: "영어",
        status: "observation_requested",
        workflowStatus: "observation_requested",
        workflowRevision: 5,
        observationReturnWorkflowStatus: "waiting_current_class",
        directorProfileId: directorId,
        observationAttemptCount: 0,
        observationCurrentId: null,
        observationSummaryVisible: true,
        migrationReviewRequired: false,
        legacy: false,
        waitingKind: null,
      }],
      appointments: [],
      levelTests: [],
      consultations: [],
      enrollments: [],
      admissionBatches: [],
      admissionApplicationMessageStatus: "not_sent",
      admissionApplicationMessageClaimActive: false,
      admissionApplicationMessageId: null,
    },
    focusTrackId: trackId,
    viewerId: directorId,
    viewerRole: "admin",
    onFocusTrack: () => undefined,
    onReload: async (preferredTrackId) => reloadCalls.push(preferredTrackId),
    onWarning: () => undefined,
    subjectCapabilities: [],
    customerMessageClient: {},
    observationRuntime: { available: true, runtimeVersion: 1 },
    closeAction: null,
  }
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalHTMLElement = globalThis.HTMLElement
  globalThis.HTMLElement = class HTMLElement {}
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback()
      return 1
    },
    cancelAnimationFrame() {},
  }
  globalThis.document = {
    activeElement: null,
    getElementById() {
      return { scrollIntoView() {} }
    },
  }

  try {
    let view = hookHarness.render(mounted.RegistrationApplication, props)
    let shell = findMountedRegistrationElement(
      view,
      (node) => node.type === mounted.RegistrationApplicationShell,
      "registration application shell before manager detail",
    )
    let statusSelect = findMountedRegistrationElement(
      shell.props.subjectNavigation,
      (node) => node.type === "select" && node.props["aria-label"] === "영어 진행상태",
      "observation workflow status select before manager detail",
    )
    assert.equal(statusSelect.props.disabled, false)
    assert.deepEqual(
      statusSelect.props.children.flat().filter(Boolean).map((option) => option.props.value),
      ["observation_requested", "waiting_current_class"],
    )

    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(mounted.RegistrationApplication, props)
    shell = findMountedRegistrationElement(
      view,
      (node) => node.type === mounted.RegistrationApplicationShell,
      "registration application shell",
    )
    statusSelect = findMountedRegistrationElement(
      shell.props.subjectNavigation,
      (node) => node.type === "select" && node.props["aria-label"] === "영어 진행상태",
      "observation workflow status select",
    )
    assert.equal(statusSelect.props.disabled, false)
    assert.deepEqual(
      statusSelect.props.children.flat().filter(Boolean).map((option) => option.props.value),
      ["observation_requested", "waiting_current_class"],
    )

    statusSelect.props.onChange({ target: { value: "waiting_current_class" } })
    await flushMountedRegistrationWork()

    assert.equal(genericStatusCalls.length, 0)
    assert.equal(withdrawalCalls.length, 1)
    assert.deepEqual(withdrawalCalls[0], {
      trackId,
      expectedWorkflowRevision: 5,
      exitKind: "return_to_previous",
      targetWorkflowStatus: "waiting_current_class",
      decisionObservationId: null,
      expectedDecisionObservationRevision: null,
      expectedDecisionFeedbackRevision: null,
      reason: "",
      requestKey: withdrawalCalls[0].requestKey,
    })
    assert.match(withdrawalCalls[0].requestKey, new RegExp(`^registration-observation-withdraw:${trackId}:`))
    assert.deepEqual(reloadCalls, [trackId])
  } finally {
    hookHarness.cleanup()
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.HTMLElement = originalHTMLElement
  }
})

test("mounted consultation status selector enters observation through the same top-level control", async () => {
  const taskId = "76700000-0000-4000-8000-000000000001"
  const trackId = "76700000-0000-4000-8000-000000000002"
  const directorId = "76700000-0000-4000-8000-000000000003"
  const enterCalls = []
  const genericStatusCalls = []
  const reloadCalls = []
  const managerDetail = {
    track: {
      trackId,
      taskId,
      subject: "수학",
      workflowStatus: "consultation_completed",
      workflowRevision: 6,
      observationReturnWorkflowStatus: null,
      directorProfileId: directorId,
    },
    currentObservation: null,
    latestEnrollmentDecisionObservationId: null,
    latestDecisionObservation: null,
    attempts: [],
    classes: [],
  }
  const hookHarness = createRegistrationEditorHookHarness()
  const mounted = await loadMountedRegistrationApplication({
    hookHarness,
    loadManagerDetail: async () => managerDetail,
    loadFeedback: async () => null,
    enterObservation: async (input) => {
      enterCalls.push(input)
      return { changed: true }
    },
    setWorkflowStatus: async (input) => genericStatusCalls.push(input),
    workflowStatusOptions: () => [{ value: "consultation_completed", label: "상담 완료" }],
    canStartObservation: (track) => track.workflowStatus === "consultation_completed",
  })
  const props = {
    task: { id: taskId, title: "수학 등록", studentName: "김학생", type: "registration" },
    detail: {
      task: { id: taskId, title: "수학 등록", studentName: "김학생", registration: null },
      commonRevision: 1,
      tracks: [{
        id: trackId,
        taskId,
        subject: "수학",
        status: "consultation_waiting",
        workflowStatus: "consultation_completed",
        workflowRevision: 6,
        directorProfileId: directorId,
        observationAttemptCount: 0,
        observationCurrentId: null,
        observationSummaryVisible: true,
        migrationReviewRequired: false,
        legacy: false,
        waitingKind: null,
      }],
      appointments: [],
      levelTests: [],
      consultations: [],
      enrollments: [],
      admissionBatches: [],
      admissionApplicationMessageStatus: "not_sent",
      admissionApplicationMessageClaimActive: false,
      admissionApplicationMessageId: null,
    },
    focusTrackId: trackId,
    viewerId: directorId,
    viewerRole: "admin",
    onFocusTrack: () => undefined,
    onReload: async (preferredTrackId) => reloadCalls.push(preferredTrackId),
    onWarning: () => undefined,
    subjectCapabilities: [],
    customerMessageClient: {},
    observationRuntime: { available: true, runtimeVersion: 1 },
    closeAction: null,
  }
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalHTMLElement = globalThis.HTMLElement
  globalThis.HTMLElement = class HTMLElement {}
  globalThis.window = { requestAnimationFrame(callback) { callback(); return 1 }, cancelAnimationFrame() {} }
  globalThis.document = { activeElement: null, getElementById() { return { scrollIntoView() {} } } }

  try {
    let view = hookHarness.render(mounted.RegistrationApplication, props)
    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(mounted.RegistrationApplication, props)
    const shell = findMountedRegistrationElement(view, (node) => node.type === mounted.RegistrationApplicationShell, "registration application shell")
    const statusSelect = findMountedRegistrationElement(
      shell.props.subjectNavigation,
      (node) => node.type === "select" && node.props["aria-label"] === "수학 진행상태",
      "consultation workflow status select",
    )
    assert.equal(statusSelect.props.disabled, false)
    assert.deepEqual(
      statusSelect.props.children.flat().filter(Boolean).map((option) => option.props.value),
      ["consultation_completed", "observation_requested"],
    )

    statusSelect.props.onChange({ target: { value: "observation_requested" } })
    await flushMountedRegistrationWork()

    assert.equal(genericStatusCalls.length, 0)
    assert.equal(enterCalls.length, 1)
    assert.deepEqual(enterCalls[0], {
      trackId,
      expectedWorkflowRevision: 6,
      requestKey: enterCalls[0].requestKey,
    })
    assert.match(enterCalls[0].requestKey, new RegExp(`^registration-observation-enter:${trackId}:`))
    assert.deepEqual(reloadCalls, [trackId])
  } finally {
    hookHarness.cleanup()
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.HTMLElement = originalHTMLElement
  }
})

test("mounted pre-observation detail keeps the guided observation section visible", async () => {
  const taskId = "76800000-0000-4000-8000-000000000001"
  const trackId = "76800000-0000-4000-8000-000000000002"
  const directorId = "76800000-0000-4000-8000-000000000003"
  const hookHarness = createRegistrationEditorHookHarness()
  const mounted = await loadMountedRegistrationApplication({
    hookHarness,
    loadManagerDetail: async () => null,
    loadFeedback: async () => null,
  })
  const props = {
    task: { id: taskId, title: "영어 등록", studentName: "김학생", type: "registration" },
    detail: {
      tracks: [{
        id: trackId,
        taskId,
        subject: "영어",
        status: "consultation_waiting",
        workflowStatus: "consultation_requested",
        workflowRevision: 1,
        directorProfileId: directorId,
        observationAttemptCount: 0,
        observationSummaryVisible: false,
        migrationReviewRequired: false,
        legacy: false,
        waitingKind: null,
      }],
      task: { id: taskId, title: "영어 등록", studentName: "김학생", registration: null },
      commonRevision: 1,
      appointments: [],
      levelTests: [],
      consultations: [],
      enrollments: [],
      admissionBatches: [],
      admissionApplicationMessageStatus: "not_sent",
      admissionApplicationMessageClaimActive: false,
      admissionApplicationMessageId: null,
    },
    focusTrackId: trackId,
    viewerId: directorId,
    viewerRole: "admin",
    onFocusTrack: () => undefined,
    onReload: async () => undefined,
    onWarning: () => undefined,
    subjectCapabilities: [],
    customerMessageClient: {},
    observationRuntime: { available: true, runtimeVersion: 1 },
    closeAction: null,
  }
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalHTMLElement = globalThis.HTMLElement
  globalThis.HTMLElement = class HTMLElement {}
  globalThis.window = { requestAnimationFrame(callback) { callback(); return 1 }, cancelAnimationFrame() {} }
  globalThis.document = { activeElement: null, getElementById() { return { scrollIntoView() {} } } }

  try {
    const view = hookHarness.render(mounted.RegistrationApplication, props)
    const shell = findMountedRegistrationElement(view, (node) => node.type === mounted.RegistrationApplicationShell, "pre-observation application shell")
    assert.notEqual(shell.props.observation, undefined)
    assert.match(renderToStaticMarkup(shell.props.observation), /상담 완료 또는 대기 단계에서 청강 예약 필요를 선택하면 청강 회차를 예약할 수 있습니다\./)
  } finally {
    hookHarness.cleanup()
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.HTMLElement = originalHTMLElement
  }
})

test("mounted terminal deep links preserve exact feedback role and status rules", async (t) => {
  const taskId = "77000000-0000-4000-8000-000000000001"
  const trackId = "77000000-0000-4000-8000-000000000002"
  const directorId = "77000000-0000-4000-8000-000000000003"
  const teacherId = "77000000-0000-4000-8000-000000000013"
  const baseAttempt = {
    observationId: "77000000-0000-4000-8000-000000000004",
    taskId,
    trackId,
    appointmentId: "77000000-0000-4000-8000-000000000005",
    appointmentStatus: "completed",
    classId: "77000000-0000-4000-8000-000000000006",
    subject: "영어",
    className: "영어 심화반",
    scheduleState: "active",
    sessionDate: "2026-08-10",
    startsAt: "2026-08-10T10:00:00.000Z",
    endsAt: "2026-08-10T11:30:00.000Z",
    teacherCatalogId: "77000000-0000-4000-8000-000000000007",
    teacherProfileId: teacherId,
    teacherName: "김선생",
    classroomCatalogId: "77000000-0000-4000-8000-000000000008",
    classroomName: "301호",
    campus: "본관",
    textbooks: [],
    progress: "",
    bookingFactHash: "b".repeat(64),
    attendance: "attended",
    suitabilityResult: "fit",
    decisionKind: "enrollment",
    revision: 3,
    feedbackRevision: 2,
    appointmentNotificationRevision: 4,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    sessionAuthority: "normalized",
    classLessonSessionId: "77000000-0000-4000-8000-000000000009",
    legacySessionKey: null,
    sessionKey: "normalized:history",
    sessionSourceRevision: 1,
    legacySessionSourceHash: null,
    sourceRevision: {
      authority: "normalized",
      sessionId: "77000000-0000-4000-8000-000000000009",
      revision: 1,
    },
  }
  const roleCases = [
    { label: "admin", viewerRole: "admin", viewerId: "77000000-0000-4000-8000-000000000010", canManageCase: true },
    { label: "staff", viewerRole: "staff", viewerId: "77000000-0000-4000-8000-000000000011", canManageCase: true },
    { label: "director", viewerRole: "teacher", viewerId: directorId, canManageCase: false },
  ]
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const scrolledPanelIds = []
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback()
      return 1
    },
    cancelAnimationFrame() {},
  }
  globalThis.document = {
    getElementById(id) {
      return { scrollIntoView: () => scrolledPanelIds.push(id) }
    },
  }

  async function mountTerminalHistory({ status, decisionKind, roleCase }) {
    const deepLinkedAttempt = {
      ...baseAttempt,
      status,
      appointmentStatus: status === "canceled" ? "canceled" : "completed",
      attendance: status === "canceled" ? null : status === "no_show" ? "no_show" : "attended",
      suitabilityResult: status === "canceled" || status === "no_show" ? null : "fit",
      decisionKind,
    }
    const managerDetail = {
      track: {
        trackId,
        taskId,
        subject: "영어",
        workflowStatus: "enrollment_requested",
        workflowRevision: 12,
        observationReturnWorkflowStatus: null,
        directorProfileId: directorId,
      },
      currentObservation: null,
      latestEnrollmentDecisionObservationId: null,
      latestDecisionObservation: null,
      attempts: [],
      classes: [],
    }
    let managerLoads = 0
    let feedbackLoads = 0
    const hookHarness = createRegistrationEditorHookHarness()
    const mounted = await loadMountedRegistrationApplication({
      hookHarness,
      loadManagerDetail: async () => {
        managerLoads += 1
        return managerDetail
      },
      loadFeedback: async () => {
        feedbackLoads += 1
        return {
          observationId: deepLinkedAttempt.observationId,
          status,
          decisionKind,
        }
      },
    })
    const props = {
      task: { id: taskId, title: "김학생 등록", studentName: "김학생", type: "registration" },
      detail: {
        task: { id: taskId, title: "김학생 등록", studentName: "김학생", registration: null },
        commonRevision: 1,
        tracks: [{
          id: trackId,
          taskId,
          subject: "영어",
          status: "enrollment_requested",
          workflowStatus: "enrollment_requested",
          workflowRevision: 12,
          directorProfileId: directorId,
          observationAttemptCount: 0,
          observationSummaryVisible: false,
          migrationReviewRequired: false,
          legacy: false,
          waitingKind: null,
        }],
        appointments: [],
        levelTests: [],
        consultations: [],
        enrollments: [],
        admissionBatches: [],
        admissionApplicationMessageStatus: "not_sent",
        admissionApplicationMessageClaimActive: false,
        admissionApplicationMessageId: null,
      },
      focusTrackId: trackId,
      viewerId: roleCase.viewerId,
      viewerRole: roleCase.viewerRole,
      onFocusTrack: () => undefined,
      onReload: async () => undefined,
      onWarning: () => undefined,
      subjectCapabilities: [],
      customerMessageClient: {},
      observationRuntime: { available: true, runtimeVersion: 1 },
      deepLinkedAttempt,
      closeAction: null,
    }
    try {
      let view = hookHarness.render(mounted.RegistrationApplication, props)
      hookHarness.flushEffects()
      await flushMountedRegistrationWork()
      view = hookHarness.render(mounted.RegistrationApplication, props)
      const shell = findMountedRegistrationElement(
        view,
        (node) => node.type === mounted.RegistrationApplicationShell,
        "registration application shell",
      )
      assert.ok(shell.props.observation, `${roleCase.label}:${status} keeps history mounted`)
      const editor = findMountedRegistrationElement(
        shell.props.observation,
        (node) => node.type === mounted.RegistrationObservationEditor,
        "historical observation editor",
      )
      assert.equal(editor.props.deepLinkedAttempt, deepLinkedAttempt)
      assert.equal(
        typeof editor.props.onOpenCustomerMessage,
        roleCase.canManageCase ? "function" : "undefined",
        `${roleCase.label}:${status} observation customer-message ownership`,
      )
      const feedbackPanel = findMountedRegistrationElement(
        editor.props.feedbackPanel,
        (node) => node.type === mounted.RegistrationObservationFeedbackPanel,
        "historical feedback panel",
      )
      assert.equal(managerLoads, 1)
      assert.equal(feedbackLoads, 1)
      return feedbackPanel.props
    } finally {
      hookHarness.cleanup()
    }
  }

  try {
    await t.test("completed decisions keep correction for management only", async () => {
      for (const roleCase of roleCases) {
        const feedback = await mountTerminalHistory({ status: "completed", decisionKind: "enrollment", roleCase })
        assert.equal(feedback.canRecordAttendance, false)
        assert.equal(feedback.canEditFeedback, roleCase.canManageCase, roleCase.label)
        assert.equal(feedback.canDecide, false, roleCase.label)
      }
    })

    await t.test("undecided completed and no-show attempts keep manager decisions", async () => {
      for (const status of ["completed", "no_show"]) {
        for (const roleCase of roleCases) {
          const feedback = await mountTerminalHistory({ status, decisionKind: null, roleCase })
          assert.equal(feedback.canRecordAttendance, false)
          assert.equal(feedback.canEditFeedback, roleCase.canManageCase, `${roleCase.label}:${status}`)
          assert.equal(feedback.canDecide, true, `${roleCase.label}:${status}`)
        }
      }
    })

    await t.test("canceled attempts keep every feedback action closed", async () => {
      for (const roleCase of roleCases) {
        const feedback = await mountTerminalHistory({ status: "canceled", decisionKind: null, roleCase })
        assert.equal(feedback.canRecordAttendance, false)
        assert.equal(feedback.canEditFeedback, false, roleCase.label)
        assert.equal(feedback.canDecide, false, roleCase.label)
      }
    })
    assert.equal(scrolledPanelIds.length, 12)
    assert.ok(scrolledPanelIds.every((id) => id === "registration-application-observation"))
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
  }
})

test("mounted observation child loads reject A-B-A and passive overwrites", async (t) => {
  const taskId = "78000000-0000-4000-8000-000000000001"
  const trackA = "78000000-0000-4000-8000-000000000002"
  const trackB = "78000000-0000-4000-8000-000000000003"
  const observationId = "78000000-0000-4000-8000-000000000004"
  const directorId = "78000000-0000-4000-8000-000000000005"
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback()
      return 1
    },
    cancelAnimationFrame() {},
  }
  globalThis.document = {
    getElementById() {
      return { scrollIntoView() {} }
    },
  }

  const track = (id, subject) => ({
    id,
    taskId,
    subject,
    status: "observation_completed",
    workflowStatus: "observation_completed",
    workflowRevision: 12,
    directorProfileId: directorId,
    observationAttemptCount: 1,
    observationSummaryVisible: true,
    migrationReviewRequired: false,
    legacy: false,
    waitingKind: null,
  })
  const tracks = [track(trackA, "영어"), track(trackB, "수학")]
  const applicationProps = (focusTrackId, observationRuntime = { available: true, runtimeVersion: 1 }) => ({
    task: { id: taskId, title: "김학생 등록", studentName: "김학생", type: "registration" },
    detail: {
      task: { id: taskId, title: "김학생 등록", studentName: "김학생", registration: null },
      commonRevision: 1,
      tracks,
      appointments: [],
      levelTests: [],
      consultations: [],
      enrollments: [],
      admissionBatches: [],
      admissionApplicationMessageStatus: "not_sent",
      admissionApplicationMessageClaimActive: false,
      admissionApplicationMessageId: null,
    },
    focusTrackId,
    viewerId: "78000000-0000-4000-8000-000000000006",
    viewerRole: "admin",
    onFocusTrack: () => undefined,
    onReload: async () => undefined,
    onWarning: () => undefined,
    subjectCapabilities: [],
    customerMessageClient: {},
    observationRuntime,
    deepLinkedAttempt: null,
    closeAction: null,
  })
  const managerDetail = (trackId, marker, currentObservation = null) => ({
    marker,
    track: {
      trackId,
      taskId,
      subject: trackId === trackA ? "영어" : "수학",
      workflowStatus: "observation_completed",
      workflowRevision: 12,
      observationReturnWorkflowStatus: null,
      directorProfileId: directorId,
    },
    currentObservation,
    latestEnrollmentDecisionObservationId: null,
    latestDecisionObservation: null,
    attempts: currentObservation ? [currentObservation] : [],
    classes: [],
  })
  const currentObservation = {
    observationId,
    taskId,
    trackId: trackA,
    teacherProfileId: "78000000-0000-4000-8000-000000000007",
    status: "completed",
    decisionKind: null,
  }
  const findEditor = (view, mounted) => {
    const shell = findMountedRegistrationElement(
      view,
      (node) => node.type === mounted.RegistrationApplicationShell,
      "registration application shell",
    )
    return findMountedRegistrationElement(
      shell.props.observation,
      (node) => node.type === mounted.RegistrationObservationEditor,
      "observation editor",
    )
  }
  const findFeedback = (view, mounted) => findMountedRegistrationElement(
    findEditor(view, mounted).props.feedbackPanel,
    (node) => node.type === mounted.RegistrationObservationFeedbackPanel,
    "observation feedback panel",
  )

  try {
    await t.test("manager detail commits only the newest A-B-A request", async () => {
      const managerRequests = []
      const hookHarness = createRegistrationEditorHookHarness()
      const mounted = await loadMountedRegistrationApplication({
        hookHarness,
        loadManagerDetail: (_client, { trackId }) => {
          const deferred = createControlledPromise()
          managerRequests.push({ trackId, deferred })
          return deferred.promise
        },
        loadFeedback: async () => {
          throw new Error("feedback should stay unmounted without an observation")
        },
      })
      try {
        for (const focusTrackId of [trackA, trackB, trackA]) {
          hookHarness.render(mounted.RegistrationApplication, applicationProps(focusTrackId))
          hookHarness.flushEffects()
        }
        assert.deepEqual(managerRequests.map((request) => request.trackId), [trackA, trackB, trackA])
        managerRequests[2].deferred.resolve(managerDetail(trackA, "A-newest"))
        await flushMountedRegistrationWork()
        let view = hookHarness.render(mounted.RegistrationApplication, applicationProps(trackA))
        hookHarness.flushEffects()
        assert.equal(findEditor(view, mounted).props.detail.marker, "A-newest")

        managerRequests[0].deferred.resolve(managerDetail(trackA, "A-stale"))
        managerRequests[1].deferred.resolve(managerDetail(trackB, "B-stale"))
        await flushMountedRegistrationWork()
        view = hookHarness.render(mounted.RegistrationApplication, applicationProps(trackA))
        hookHarness.flushEffects()
        assert.equal(findEditor(view, mounted).props.detail.marker, "A-newest")
      } finally {
        hookHarness.cleanup()
      }
    })

    await t.test("forced post-save feedback outranks an older passive refresh", async () => {
      const managerRequests = []
      const feedbackRequests = []
      const hookHarness = createRegistrationEditorHookHarness()
      const mounted = await loadMountedRegistrationApplication({
        hookHarness,
        loadManagerDetail: (_client, { trackId }) => {
          const deferred = createControlledPromise()
          managerRequests.push({ trackId, deferred })
          return deferred.promise
        },
        loadFeedback: (_client, requestedObservationId, options) => {
          const deferred = createControlledPromise()
          feedbackRequests.push({ observationId: requestedObservationId, options, deferred })
          return deferred.promise
        },
      })
      const props = applicationProps(trackA)
      try {
        hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        managerRequests[0].deferred.resolve(managerDetail(trackA, "initial-manager", currentObservation))
        await flushMountedRegistrationWork()
        let view = hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        assert.equal(feedbackRequests.length, 1)
        feedbackRequests[0].deferred.resolve({
          observationId,
          status: "completed",
          decisionKind: null,
          marker: "initial-feedback",
        })
        await flushMountedRegistrationWork()
        view = hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        const initialPanel = findFeedback(view, mounted)
        assert.equal(initialPanel.props.detail.marker, "initial-feedback")

        hookHarness.render(mounted.RegistrationApplication, applicationProps(trackA, { available: false, runtimeVersion: 1 }))
        hookHarness.flushEffects()
        hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        assert.equal(managerRequests.length, 2)
        managerRequests[1].deferred.resolve(managerDetail(trackA, "passive-manager", currentObservation))
        await flushMountedRegistrationWork()
        view = hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        assert.equal(feedbackRequests.length, 2)
        assert.equal(feedbackRequests[1].options, undefined)

        const saved = {
          observationId,
          status: "completed",
          decisionKind: null,
          marker: "saved-feedback",
        }
        const savedRefresh = initialPanel.props.onSaved(saved)
        assert.equal(managerRequests.length, 3)
        managerRequests[2].deferred.resolve(managerDetail(trackA, "forced-manager", currentObservation))
        await flushMountedRegistrationWork()
        assert.equal(feedbackRequests.length, 3)
        assert.deepEqual(feedbackRequests[2].options, { force: true })
        feedbackRequests[2].deferred.resolve({ ...saved, marker: "forced-feedback" })
        await savedRefresh
        view = hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        assert.equal(findFeedback(view, mounted).props.detail.marker, "forced-feedback")

        feedbackRequests[1].deferred.resolve({ ...saved, marker: "passive-stale" })
        await flushMountedRegistrationWork()
        view = hookHarness.render(mounted.RegistrationApplication, props)
        hookHarness.flushEffects()
        assert.equal(findFeedback(view, mounted).props.detail.marker, "forced-feedback")
      } finally {
        hookHarness.cleanup()
      }
    })
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
  }
})

test("canonical track detail resolves and persists director defaults only for management roles", async () => {
  const editor = await readRegistrationApplicationSource()
  const workspace = await readWorkspaceSource()

  assert.match(editor, /resolveRegistrationTrackDirectorDefaults/)
  assert.match(editor, /permissions\.canManage/)
  assert.match(editor, /resolution\.shouldClear\s*\?\s*"clear_default"\s*:\s*"default"/)
  assert.match(editor, /expectedCommonRevision:\s*detail\.commonRevision/)
  assert.match(editor, /registration_common_revision_conflict/)
  assert.match(editor, /registration_director_refresh_required/)
  assert.match(editor, /registration_director_default_stale/)
  assert.match(editor, /isRegistrationDirectorCatalogRefreshError\(message\)/)
  assert.match(editor, /setCatalogRefreshRequired\(true\)/)
  assert.match(editor, /const refreshed = await onRetryDirectorCatalog\(\)/)
  assert.match(editor, /if \(refreshed === false\)/)
  assert.match(editor, /await onReload\(\)/)
  assert.match(editor, /자동 배정 다시 시도/)
  assert.match(editor, /automaticRefreshError/)
  assert.match(editor, /최신 정보 다시 불러오기/)
  assert.match(editor, /visitGuardSignature/)
  assert.match(workspace, /directorCatalogStatus=/)
  assert.match(workspace, /registrationOptionsLoading\s*\?\s*"loading"/)
  assert.match(workspace, /teacherOptions=\{data\?\.teachers/)
  assert.match(workspace, /selectedRegistrationTrackIdRef\.current = selectedRegistrationTrackId/)
  assert.match(workspace, /preferredTrackId \|\| selectedRegistrationTrackIdRef\.current/)

  const automaticBlock = sourceBetween(
    editor,
    "async function applyAutomaticDefaults() {",
    "void applyAutomaticDefaults()",
  )
  assert.doesNotMatch(automaticBlock, /await onReload/)
  assert.match(automaticBlock, /attemptedRef\.current\.add\(attemptKey\)[\s\S]*?setAutomaticError\(""\)/)
  assert.match(automaticBlock, /if \(!attemptedAny\)[\s\S]*?attemptedAny = true[\s\S]*?setAutomaticError\(""\)/)
  assert.match(editor, /advanceRegistrationAutomaticSavingGeneration\([\s\S]*?automaticGenerationRef\.current[\s\S]*?hasAutomaticActions/)
  assert.match(editor, /automaticGenerationRef\.current = generationState\.generation[\s\S]*?if \(!generationState\.saving\)[\s\S]*?setAutomaticSaving\(false\)/)
  assert.match(automaticBlock, /shouldSettleRegistrationAutomaticSavingGeneration\([\s\S]*?generationState\.generation[\s\S]*?automaticGenerationRef\.current/)
  assert.doesNotMatch(automaticBlock, /if \(!cancelled\) setAutomaticSaving\(false\)/)
  assert.match(editor, /automaticRefreshRequest[\s\S]*?await onReload\(request\.preferredTrackId \|\| undefined\)/)
  assert.match(workspace, /registrationOptionsLoadGenerationRef\.current !== loadGeneration[\s\S]*?return false/)
  assert.match(workspace, /setRegistrationOptionsLoading\(false\)[\s\S]*?return enrichmentData\.directorCatalogStatus === "authoritative"/)
})

test("common information conflicts retain the attempted draft when latest-data reload fails", async () => {
  const [application, inquiry] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8"),
  ])
  const editor = sourceBetween(inquiry, "export function RegistrationInquiryEditor", "export type RegistrationApplicationInquirySectionProps")
  const saveInquiry = sourceBetween(application, "async function saveInquiry", "function handleSubjectTabChange")
  const conflict = sourceBetween(editor, 'outcome === "conflict"', '} else {')
  const retry = sourceBetween(editor, "async function retryConflictRefresh", "async function retryRefresh")

  assert.match(inquiry, /type RegistrationInquirySaveOutcome|Promise<RegistrationInquirySaveOutcome>/)
  assert.match(editor, /const outcome = await onSave\(attemptedDraft, requestKey\)[\s\S]*?requestKeysRef\.current\.delete/)
  assert.ok(conflict.indexOf("beginRegistrationConflictComparison") < conflict.indexOf("await onReload"))
  assert.match(conflict, /setConflictAttempt\(comparison\)/)
  assert.match(conflict, /settleRegistrationConflictComparison\(comparison, \{ succeeded: false/)
  assert.match(editor, /conflictAttempt\.latestReady/)
  assert.match(retry, /await onReload\(\)/)
  assert.doesNotMatch(retry, /onSave/)
  assert.match(saveInquiry, /registration_common_revision_conflict[\s\S]*?registration_subjects_conflict[\s\S]*?return "conflict"/)
  assert.doesNotMatch(saveInquiry, /await onReload/)
})

test("ordinary tracks expose compact manual director selection and visit reassignment guidance", async () => {
  const source = await readRegistrationApplicationSource()
  const director = sourceBetween(source, "export const RegistrationTrackDirectorSection", "const REGISTRATION_HISTORY_DATE_FORMATTER")
  const manualSave = sourceBetween(source, "async function saveManualDirector", "async function retryAutomaticRefresh")
  assert.match(source, /RegistrationTrackDirectorSection/)
  assert.match(source, /상담 책임자/)
  assert.doesNotMatch(director, /REGISTRATION_DIRECTOR_EDITABLE_STATUSES/)
  assert.match(director, /const canEdit = permissions\.canManage/)
  assert.doesNotMatch(source, /REGISTRATION_DIRECTOR_VISIBLE_STATUSES\.has\(context\.track\.status\)/)
  assert.match(source, /assignmentSource:\s*"manual"/)
  assert.match(source, /ruleKey:\s*null/)
  assert.match(source, /registration_visit_reassign_requires_reschedule/)
  assert.match(source, /방문상담 예약에서 담당 원장을 다시 확인하세요/)
  assert.match(source, /setVisitCorrectionRequest\(\{ id, trackId: resolution\.trackId \}\)/)
  assert.match(source, /onOpenVisit\(visitCorrectionRequest\.trackId\)/)
  assert.match(source, /const activeVisitAppointment = activeVisitPlan/)
  assert.match(source, /onOpenVisit=\{onFocusTrack\}/)
  assert.match(source, /requestKeysRef\.current\.delete\(logicalKey\)/)
  assert.match(source, /visitCorrectionTrackId/)
  assert.match(source, /preferredTrackId:\s*visitCorrectionTrackId/)
  assert.match(source, /activeDirectorProfileIds/)
  assert.match(source, /teacherOptions\.map\(\(teacher\) => teacher\.profileId\)/)
  assert.match(source, /baselineProfileId === serverDirectorProfileId/)
  assert.match(source, /saveManualDirector[\s\S]*?isRegistrationDirectorCatalogRefreshError\(message\)[\s\S]*?setCatalogRefreshRequired\(true\)/)
  assert.match(source, /const selectedDirectorIsAvailable = availableDirectors\.some\(\(profile\) => profile\.id === directorProfileId\)/)
  assert.match(manualSave, /!selectedDirectorIsAvailable/)
  assert.match(source, /RegistrationTrackDirectorSectionHandle/)
  assert.match(source, /sharedSave/)
  assert.doesNotMatch(director, />\s*담당 저장\s*</)
  assert.doesNotMatch(director, /aria-label=\{`\$\{track\.subject\} 상담 책임자 저장`\}/)
})

test("consultation editor restores phone and visit choice with one shared save action", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /getRegistrationConsultationModeDraft/)
  assert.match(source, /focusedContext\?\.latestConsultation\?\.mode === "visit" && focusedContext\.latestConsultation\.status !== "canceled"/)
  assert.match(source, /aria-label=\{`\$\{activeGenericTrack\.subject\} 상담 방식`\}/)
  assert.match(source, />전화상담</)
  assert.match(source, />방문상담</)
  assert.match(source, /onBeforeSave=\{saveActiveConsultationDirector\}/)
  assert.match(source, /actionLabel="상담 정보 저장"/)
  assert.match(source, /aria-label=\{`\$\{activeGenericTrack\.subject\} 상담 정보 저장`\}/)
  assert.match(source, /saveRegistrationPhoneConsultation\(\{/)
  assert.match(source, /phoneConsultation/)
  assert.match(source, /dirty=\{activeConsultationDirectorDirty \|\| !phoneConsultation\}/)
  assert.doesNotMatch(source, />\s*담당 저장\s*</)
})

test("registration section state keeps the workflow model's current and upcoming steps", async () => {
  const source = await readRegistrationApplicationSource()
  const sectionStateProjection = source.slice(source.indexOf("const openSectionStates"), source.indexOf("const splitPlacementState"))

  assert.match(sectionStateProjection, /current: state\.current/)
  assert.match(sectionStateProjection, /upcoming: state\.upcoming/)
  assert.doesNotMatch(sectionStateProjection, /current: section !== "history"/)
})

test("case managers can correct an existing consultation outcome", async () => {
  const source = await readRegistrationApplicationSource()
  const outcomeEditor = source.slice(source.indexOf("<RegistrationConsultationOutcomeEditor"), source.indexOf("/>\n          ) : null", source.indexOf("<RegistrationConsultationOutcomeEditor")))

  assert.match(outcomeEditor, /editable=\{Boolean\(context\.permissions\.canManage \|\| context\.permissions\.canCompleteConsultation \|\| context\.permissions\.canEditConsultationResult\)\}/)
})

test("레벨테스트 결과는 안전한 URL만 새 탭 링크로 연다", async () => {
  const source = await readRegistrationAppointmentEditorSource()

  assert.match(source, /getRegistrationResultLinkHref\(materialLink\)/)
  assert.match(source, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 레벨테스트 결과 링크 열기`\}/)
  assert.match(source, /target="_blank"/)
  assert.match(source, /rel="noopener noreferrer"/)
  assert.match(source, />\s*결과 열기\s*</)
})

test("operational detail omits the internal subject event log", async () => {
  const source = await readRegistrationApplicationSource()
  assert.doesNotMatch(source, /function RegistrationSubjectHistory/)
  assert.doesNotMatch(source, /<RegistrationSubjectHistory/)
  assert.doesNotMatch(source, /과목별 진행 이력/)
})

test("대기 상세은 저장한 값이 없으면 비어 있는 입력 상태로 연다", async () => {
  const source = await readRegistrationApplicationSource()
  const waiting = sourceBetween(source, "export function RegistrationWaitingDetailsEditor", "function TerminalStageEditor")
  assert.match(waiting, /getRegistrationWaitingDetailsDraft\(track\)/)
  assert.doesNotMatch(waiting, /\|\| "current_term_opening"/)
  assert.doesNotMatch(waiting, /\|\| "not_required"/)
  assert.match(waiting, /cleanLabel=\{savedWaitingPersisted \? "저장됨" : "입력 없음"\}/)
})

test("migration review blocks ordinary actions until explicit attribution", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /과목 분리 확인 필요/)
  assert.match(source, /RegistrationMigrationReviewEditor/)
  assert.match(source, /migrationReviewRequired/)
  assert.match(source, /resolveRegistrationMigrationReview/)
  assert.match(source, /상담 책임자/)
  assert.match(source, /assignRegistrationTrackDirector/)
  assert.match(source, /consultation_waiting/)
  assert.match(source, /visit_consultation_scheduled/)
  assert.match(source, /directorProfileId/)
  assert.match(source, /const requiresExplicitAssignments = reviewTracks\.length > 1/)
  assert.match(source, /migrationDirectorEntityKey/)
  assert.match(source, /migrationReviewEntityKey/)
  assert.match(source, /활성 담당자 다시 선택/)
  assert.match(source, /availableDirectors\.some\(\(profile\) => profile\.id === directorProfileId\)/)
  assert.match(source, /RegistrationMigrationReviewEditor[\s\S]*?onRetryDirectorCatalog/)
  assert.match(source, /saveDirector[\s\S]*?isRegistrationDirectorCatalogRefreshError\(message\)[\s\S]*?setCatalogRefreshRequired\(true\)/)
  assert.match(source, /retryDirectorCatalog[\s\S]*?await onRetryDirectorCatalog\(\)[\s\S]*?담당자 정보 다시 불러오기/)
  assert.match(source, /requiresExplicitAssignments\s*\?\s*groups\.map/)
  assert.match(source, /classOptions\.some\(\(option\) => option\.id === detail\.migrationLegacy\?\.classId && option\.subject === track\.subject\)/)
  assert.match(source, /\{ classId: detail\.migrationLegacy\?\.classId \|\| "" \}/)
})

test("subject removal is routed through the history-aware RPC", async () => {
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(service, /sync_registration_case_subjects/)
  assert.match(service, /p_subjects/)
})

test("migration resolution keeps typed inputs separate and sends one canonical JSON payload", async () => {
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(service, /trackStates/)
  assert.match(service, /p_assignments:\s*\{\s*assignments:\s*input\.assignments,\s*trackStates:\s*input\.trackStates,?\s*\}/)
  assert.doesNotMatch(service, /p_track_states/)
})

test("inquiry decisions are subject-scoped and never fake a phone reservation", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /레벨테스트 예약/)
  assert.match(source, /바로 상담/)
  assert.match(source, /문의만 완료/)
  assert.match(source, /routeRegistrationInquiry/)
  assert.doesNotMatch(source, /phoneConsultationAt/)
})

test("waiting details save separately from the status selector", async () => {
  const source = await readRegistrationApplicationSource()
  const waiting = sourceBetween(source, "export function RegistrationWaitingDetailsEditor", "function TerminalStageEditor")
  assert.match(source, /대기 정보 저장/)
  assert.doesNotMatch(waiting, /레벨테스트 재응시 여부|WAITING_RETAKE_OPTIONS|레벨테스트 예약/)
  assert.match(waiting, /retakeDecision: savedRetakeDecision/)
  assert.match(waiting, /async function clearWaitingDetails\(\)/)
  assert.match(waiting, /waitingKind: "", classId: "", retakeDecision: ""/)
  assert.match(waiting, />\s*입력 지우기\s*</)
  assert.match(waiting, /className="flex flex-wrap justify-end gap-2"[\s\S]*?<RegistrationSaveButton[\s\S]*?dirty=\{waitingDirty\}[\s\S]*?aria-label=\{`\$\{track\.subject\} 대기 정보 저장`\}/)
  assert.match(source, /saveRegistrationWaitingDetails/)
  assert.doesNotMatch(source, /대기 상태 변경/)
  assert.doesNotMatch(source, /대기 종료 · 미등록/)
})

test("level-test result saves separately from the status selector", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /saveRegistrationLevelTestResult/)
  assert.doesNotMatch(source, /completeRegistrationLevelTestAttempt/)
})

test("terminal subject outcomes can be deliberately reopened from the same application", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /reopenRegistrationTrack/)
  assert.match(source, /function TerminalStageEditor/)
  assert.match(source, /문의로 다시 열기/)
  assert.match(source, /전화상담으로 다시 열기/)
  assert.match(source, /재개 사유/)
})

test("new appointments start with the active subject selected", async () => {
  const editor = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const workspace = await readRegistrationApplicationSource()

  assert.match(editor, /initialTrackId\?: string/)
  assert.match(editor, /selectableTracks\.some\(\(track\) => track\.id === initialTrackId\)/)
  assert.doesNotMatch(editor, /:\s*selectableTracks\.map\(\(track\) => track\.id\)/)
  assert.match(workspace, /initialTrackId=\{activeGenericTrack\.id\}/)
  assert.match(workspace, /eligibleTracks=\{genericTracks\}/)
})

test("subject removal renders the deployed history-block error inline", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /registration_subject_removal_blocked/)
  assert.doesNotMatch(source, /registration_subject_has_history/)
})

test("workspace preloads the unified editor while canonical subject detail data loads", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /import \{\s*preloadRegistrationApplication,\s*RegistrationApplication,\s*\} from "\.\/registration-application-lazy"/)
  assert.equal(source.match(/const editorReady = preloadRegistrationApplication\(\)/g)?.length, 3)
  assert.equal(source.match(/Promise\.all\(\[\s*loadRegistrationCaseForWorkspace\(taskId\),[\s\S]*?editorReady,\s*\]\)/g)?.length, 3)
  assert.match(source, /const \[registrationCaseDetail, setRegistrationCaseDetail\] = useState/)
  assert.match(source, /setRegistrationCaseDetail\(detail\)/)
  assert.match(source, /registrationCaseDetail && isCanonicalRegistrationTrackDetail/)
  assert.match(source, /<RegistrationApplication/)
  assert.match(source, /detail=\{registrationCaseDetail\}/)
  assert.match(source, /focusTrackId=\{selectedRegistrationTrackId\}/)
  assert.match(source, /onFocusTrack=\{handleSelectRegistrationTrack\}/)
  assert.match(source, /customerMessageClient=/)
})

test("canonical detail renders before option catalogs begin loading", async () => {
  const source = await readWorkspaceSource()
  const blocks = [
    source.slice(
      source.indexOf("const openRegistrationTrack = useCallback"),
      source.indexOf("\n  const openRegistrationCase"),
    ),
    source.slice(
      source.indexOf("const openRegistrationCase = useCallback"),
      source.indexOf("\n  const editRegistrationTrack"),
    ),
    source.slice(
      source.indexOf("const openRegistrationAppointment = useCallback"),
      source.indexOf("\n  const openRegistrationCalendarItem"),
    ),
  ]

  for (const block of blocks) {
    assert.match(
      block,
      /const \[detail\] = await Promise\.all\(\[\s*loadRegistrationCaseForWorkspace\(taskId\),\s*editorReady,\s*\]\)/,
    )
    const awaitedLoads = block.match(
      /const \[detail\] = await Promise\.all\(\[([\s\S]*?)\]\)/,
    )?.[1] || ""
    assert.doesNotMatch(awaitedLoads, /ensureRegistrationOptions/)
    const detailHostAt = block.lastIndexOf('kind: "detail"')
    const optionsAt = block.indexOf("void ensureRegistrationOptions(true)", detailHostAt)
    assert.ok(detailHostAt >= 0, "canonical detail host must be committed")
    assert.ok(optionsAt > detailHostAt, "option catalogs must start after the detail host is committed")
  }
})

test("ready-mode creation uses one guarded initial-workflow RPC without a director follow-up", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /probeRegistrationSubjectTrackRuntime/)
  assert.match(source, /probeRegistrationIntakeWorkflowRuntime/)
  assert.match(source, /const initialDraft = createRegistrationInitialWorkflowDraft\(subjects\)/)
  assert.match(source, /normalizeRegistrationInitialWorkflow\(initialDraft, subjects\)/)
  assert.match(source, /createRegistrationCaseWithInitialWorkflow\(\{/)
  assert.match(source, /const subjects = parseRegistrationSubjects\(createPayload\.subject\)/)
  assert.match(source, /createRegistrationCreateAttempt\([\s\S]*?subjects,/)
  assert.match(source, /registrationCreateAttemptRef/)
  assert.doesNotMatch(source, /persistCreatedRegistrationDirectorDefaults/)
  assert.match(source, /registrationPersistence\.mode === "blocked_maintenance"/)
})

test("registration director options resolve science as its own subject", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /const configuredScienceProfileId = scienceCapability\?\.defaultDirectorProfileId \|\| ""/)
  assert.match(source, /teacher\.profileId === configuredScienceProfileId/)
  assert.match(source, /과학: configuredScienceProfileId && configuredScienceTeacher && configuredScienceProfile/)
  assert.doesNotMatch(source, /과학:\s*optionsFor\("(?:영어|수학)"\)/)
  assert.doesNotMatch(source, /과학:\s*optionsFor\("과학"\)/)
  assert.match(source, /ACADEMIC_SUBJECT_VALUES\.indexOf\(left\.subject\)/)
  assert.match(source, /ACADEMIC_SUBJECT_VALUES\.indexOf\(right\.subject\)/)
  assert.doesNotMatch(source, /left\.subject === "영어" \? 0 : 1/)
})

test("appointment editor keeps one simple level-test result link action per subject", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /DateTimePickerControl/)
  assert.match(source, /REGISTRATION_TIME_OPTIONS/)
  assert.match(source, /timeOptions=\{REGISTRATION_TIME_OPTIONS\}/)
  assert.doesNotMatch(source, /<legend[^>]*>적용 과목/)
  assert.match(source, /matchingActivities\.filter\(\(activity\) => !visibleTrackId \|\| activity\.trackId === visibleTrackId\)\.map/)
  assert.match(source, />레벨테스트 결과</)
  assert.match(source, /\$\{track\?\.subject \|\| "과목"\} 레벨테스트 결과 링크/)
  assert.match(source, /placeholder="https:\/\/chat\.google\.com\/\.\.\."/)
  assert.match(source, /actionLabel="결과 저장"/)
  assert.match(source, /saveRegistrationLevelTestResult/)
  assert.doesNotMatch(source, /시험 시작|미응시|과목 취소|문의 종료/)
  assert.doesNotMatch(source, /startRegistrationLevelTestAttempt|closeRegistrationLevelTestTrack/)
  assert.doesNotMatch(source, /RegistrationActivityStatusBadge/)
  assert.match(source, /예약 취소/)
  assert.match(source, /cancelRegistrationAppointment/)
})

test("consultation reservation renders before the consultation result", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const start = source.indexOf("consultation={(" )
  const end = source.indexOf("waitingState={waitingState}", start)
  assert.ok(start >= 0 && end > start)
  const consultation = source.slice(start, end)
  assert.ok(
    consultation.indexOf("<RegistrationAppointmentEditor")
      < consultation.lastIndexOf('renderTrackFrames("consultation")'),
    "the visit reservation editor must render before consultation outcome content",
  )
  assert.match(consultation, /전화상담으로 변경할까요/)
  assert.match(consultation, /상담 취소/)
  assert.match(source, /cancelRegistrationAppointment/)
  assert.match(source, /saveRegistrationConsultationDetails/)
})

test("all-terminal appointment results keep details editable while preserving participant integrity", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")

  assert.match(source, /appointment\s*\? currentActivities\.map\(\(activity\) => activity\.trackId\)/)
  assert.match(source, /data-registration-appointment-shared-controls/)
  assert.match(source, /matchingActivities\.filter\(\(activity\) => !visibleTrackId \|\| activity\.trackId === visibleTrackId\)\.map/)
  assert.match(source, /actionLabel="결과 저장"/)
  assert.doesNotMatch(source, /disabled=\{terminal \|\|/)
  assert.doesNotMatch(source, /editMode !== "read_only"/)
  assert.doesNotMatch(source, /data-registration-appointment-readonly-summary/)
  assert.doesNotMatch(source, /완료된 예약 정보는 읽기 전용입니다/)
  assert.doesNotMatch(source, /data-appointment-field="tracks"/)
})

test("appointment editor dispatches only authoritative notification targets before its saved handoff", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /onSaved\(saved\)/)
  assert.match(source, /notificationTargets/)
  assert.match(source, /sendRegistrationVisitNotificationTarget\(target/)
  assert.match(source, /appointment\?\.id \|\| null/)
  assert.match(source, /appointment\?\.notificationRevision \?\? null/)
  assert.match(source, /registration_appointment_revision_conflict/)
  assert.match(source, /다른 사용자가 예약을 변경했습니다\. 최신 내용을 확인하세요/)
  assert.match(source, /replaceRemaining: editMode === "replace_remaining"/)
  assert.doesNotMatch(source, /fetch\("\/api\/registration\/consultation-notification/)
})

test("committed appointment and result mutations cannot be resubmitted when refresh degrades", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /effectiveSelectedTrackIds/)
  assert.match(source, /getRegistrationAppointmentPayloadTrackIds/)
  assert.match(source, /latestLevelTestActivityIds/)
  assert.match(source, /refreshPending/)
  assert.match(source, /저장은 완료/)
  assert.match(source, /최신 내용 다시 불러오기/)
})

test("track editor keeps level-test and visit editors open for the active subject", async () => {
  const source = await readRegistrationApplicationSource()
  const stageSource = sourceBetween(source, "export function RegistrationTrackStageEditor", "export type RegistrationConsultationOutcomeEditorProps")
  assert.match(source, /RegistrationAppointmentEditor/)
  assert.match(source, /getRegistrationApplicationAppointmentActionPlans\(\{/)
  assert.match(source, /const activeLevelTestPlan/)
  assert.match(source, /const activeVisitPlan/)
  assert.match(source, /initialTrackId=\{activeGenericTrack\.id\}/)
  assert.equal((source.match(/eligibleTracks=\{genericTracks\}/g) || []).length, 2)
  assert.match(source, /subjectScoped/)
  assert.equal((source.match(/<RegistrationAppointmentEditor/g) || []).length, 2)
  assert.doesNotMatch(source, /data-registration-appointment-plan-action/)
  assert.doesNotMatch(source, /예약 및 과목별 결과 관리|레벨테스트 결과 보기|방문상담 예약 수정/)
  assert.doesNotMatch(stageSource, /예약 및 과목별 결과 관리|레벨테스트 결과 보기|방문상담 예약 수정/)
})

test("appointment editors have no separate expand or close action", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(source, /예약 및 과목별 결과 관리|레벨테스트 결과 보기|방문상담 예약 수정/)
  assert.doesNotMatch(source, /onClose=\{closeAppointmentEditor\}/)
})

test("phone and visit consultation completion share one inline subject outcome editor", async () => {
  const [application, actions] = await Promise.all([
    readRegistrationApplicationSource(),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
  ])
  const outcomeSource = sourceBetween(actions, "export function RegistrationConsultationOutcomeEditor", "export function RegistrationMigrationReviewEditor")
  const stageSource = sourceBetween(actions, "export function RegistrationTrackStageEditor", "export type RegistrationConsultationOutcomeEditorProps")
  assert.match(application, /RegistrationConsultationOutcomeEditor/)
  assert.match(application, /saveRegistrationConsultationDetails/)
  assert.match(actions, /saveRegistrationConsultationResult/)
  assert.match(outcomeSource, /consultationId: consultation\.id/)
  assert.match(actions, /value: "waiting", label: "대기"/)
  assert.match(actions, /value: "observation", label: "청강"/)
  assert.match(actions, /value: "enrollment", label: "등록"/)
  assert.match(actions, /value: "not_registered", label: "미등록"/)
  assert.match(outcomeSource, /className="grid grid-cols-2 gap-2 sm:grid-cols-5"/)
  assert.doesNotMatch(outcomeSource, /상담 완료일시/)
  assert.match(outcomeSource, /getRegistrationConsultationOutcomeSaveState/)
  assert.match(outcomeSource, /const \[note, setNote\] = useState\(consultation\.note \|\| ""\)/)
  assert.match(outcomeSource, /savedNote: consultation\.note/)
  assert.match(outcomeSource, /draftNote: note/)
  assert.match(outcomeSource, /useOwnedDirtyState\(!refreshPending && saveState\.editable && saveState\.dirty, onDirtyChange\)/)
  assert.match(outcomeSource, /<Label htmlFor=\{`\$\{subject\}-consultation-note`\}>상담 내용<\/Label>/)
  assert.match(outcomeSource, /<Textarea[\s\S]*?id=\{`\$\{subject\}-consultation-note`\}/)
  assert.match(outcomeSource, /value=\{note\}[\s\S]*?onChange=\{\(event\) => setNote\(event\.target\.value\)\}/)
  assert.match(outcomeSource, /rows=\{6\}/)
  assert.match(outcomeSource, /JSON\.stringify\(\{ consultationId: consultation\.id, outcome, note, waitingKind, classId, revision: track\.workflowRevision \}\)/)
  assert.match(outcomeSource, /saveRegistrationConsultationResult\(\{[\s\S]*?consultationId: consultation\.id,[\s\S]*?outcome,[\s\S]*?note,[\s\S]*?waitingKind,[\s\S]*?classId,[\s\S]*?expectedWorkflowRevision: track\.workflowRevision,[\s\S]*?requestKey,/)
  assert.match(outcomeSource, /disabled=\{saving \|\| !saveState\.editable\}/)
  assert.match(outcomeSource, /aria-pressed=\{outcome === option\.value\}/)
  assert.match(outcomeSource, /outcome === "waiting"[\s\S]*?SubjectClassSelect/)
  assert.match(outcomeSource, /if \(option\.value !== "waiting"\) \{ setWaitingKind\(""\); setClassId\(""\) \}/)
  assert.match(outcomeSource, /<RegistrationSaveButton[\s\S]*?dirty=\{saveState\.canSave\}[\s\S]*?cleanLabel=\{saveState\.label\}/)
  assert.match(outcomeSource, /!saveState\.editable && consultation\.status !== "completed"[\s\S]*?상담 책임자만 결과와 내용을 수정할 수 있습니다\./)
  assert.match(application, /editable=\{Boolean\(context\.permissions\.canManage \|\| context\.permissions\.canCompleteConsultation \|\| context\.permissions\.canEditConsultationResult\)\}/)
  assert.match(outcomeSource, /registration_access_denied[\s\S]*?상담 결과를 저장할 권한이 없습니다/)
  assert.doesNotMatch(outcomeSource, /<Dialog|<DialogContent/)
  assert.doesNotMatch(stageSource, /onOpenOutcome|전화상담 완료|방문상담 완료/)
  assert.doesNotMatch(application, /onOpenOutcome=\{/)
})

test("registration stage selects have subject-specific accessible names", async () => {
  const source = await readRegistrationApplicationSource()
  const subjectSelectSource = sourceBetween(source, "function SubjectClassSelect(", "function InquiryStageEditor(")
  const inquirySource = sourceBetween(source, "function InquiryStageEditor(", "export function RegistrationWaitingDetailsEditor(")
  const waitingSource = sourceBetween(source, "export function RegistrationWaitingDetailsEditor(", "export function RegistrationTrackStageEditor(")
  const migrationSource = source.slice(source.indexOf("export function RegistrationMigrationReviewEditor"))

  assert.match(subjectSelectSource, /aria-label=\{`\$\{subject\} 수업 선택`\}/)
  assert.match(subjectSelectSource, /className="h-9 w-full min-w-0/)
  assert.match(inquirySource, /aria-label=\{`\$\{track\.subject\} 대기 종류`\}/)
  assert.match(waitingSource, /aria-label=\{`\$\{track\.subject\} 대기 종류`\}/)
  assert.match(migrationSource, /aria-label=\{`\$\{track\.subject\} 대기 종류`\}/)
})

test("appointment editors are part of the form without open-state scrolling", async () => {
  const source = await readRegistrationApplicationSource()
  assert.equal((source.match(/<RegistrationAppointmentEditor/g) || []).length, 2)
  assert.doesNotMatch(source, /appointmentEditorRef/)
})

test("active subject resolves its existing appointments without an expand state", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")

  assert.match(source, /activeAppointmentActionPlans\.find\(\(plan\) => plan\.kind === "level_test"/)
  assert.match(source, /activeAppointmentActionPlans\.find\(\(plan\) => plan\.kind === "visit_consultation"/)
  assert.match(source, /initialAppointmentId/)
  assert.doesNotMatch(source, /setAppointmentEditor|appointmentDraftParticipantTrackIds/)
})

test("subject tabs own appointment membership without an inner subject picker", async () => {
  const [application, appointment] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8"),
  ])
  assert.match(appointment, /subjectScoped\?: boolean/)
  assert.match(appointment, /subjectScoped = false/)
  assert.doesNotMatch(appointment, /<fieldset data-appointment-field="tracks"/)
  assert.doesNotMatch(application, /appointmentDraftParticipantTrackIds/)
  assert.equal((application.match(/<RegistrationAppointmentEditor/g) || []).length, 2)
})

test("appointment participant report helper keeps its TypeScript contract", async () => {
  const declarations = await readFile(new URL("../src/features/tasks/registration-track-model.d.ts", import.meta.url), "utf8")
  const participantReportDeclaration = sourceBetween(
    declarations,
    "export function getRegistrationAppointmentReportedTrackIds(",
    "export function getLatestRegistrationLevelTestActivityIds(",
  )

  assert.match(participantReportDeclaration, /editMode: "edit" \| "replace_remaining" \| "read_only"/)
  assert.match(participantReportDeclaration, /kind: "level_test" \| "visit_consultation"/)
  assert.match(participantReportDeclaration, /\): string\[\] \| null/)
})

test("phone completion does not call the visit reservation notification helper", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const outcomeBlock = sourceBetween(source, "export function RegistrationConsultationOutcomeEditor", "export function RegistrationMigrationReviewEditor")
  assert.match(outcomeBlock, /saveRegistrationConsultationResult/)
  assert.match(outcomeBlock, /onReload/)
  assert.doesNotMatch(outcomeBlock, /sendRegistrationVisitNotificationTarget/)
  assert.doesNotMatch(outcomeBlock, /consultation-notification/)
})

test("enrollment editor supports stable repeated subject rows and exact class detail hydration", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /export function RegistrationEnrollmentEditor/)
  assert.match(source, /track\.subject/)
  assert.match(source, /수업 추가/)
  assert.match(source, /loadOpsRegistrationClassDetail/)
  assert.match(source, /classDetailById/)
  assert.match(source, /loadingClassIds/)
  assert.match(source, /new Set\(draftRows\.map/)
  assert.match(source, /선택 안 함 · 이미 보유/)
  assert.match(source, /textbookExplicitlyCleared/)
  assert.match(source, /getSelectableRegistrationScheduleSessions/)
  assert.match(source, /saveRegistrationEnrollmentDetails/)
  assert.match(source, /setSaving\(true\)\s+onWarning\(""\)\s+try\s+\{\s+const saved = await saveRegistrationEnrollmentDetails/)
  assert.match(source, /enrollmentDetailRows/)
  assert.match(source, /submissionKeys\.getOrCreate\("enrollment-rows"/)
  assert.match(source, /sm:grid-cols/)
})

test("observation first lesson UI renders the approved compact copy before the picker and clears source on regular override", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editor = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const calendar = sourceBetween(source, "function RegistrationStartScheduleCalendar", "function useScopedDirtyState")
  const suggestionIndex = editor.indexOf("최근 적합 청강")
  const pickerIndex = editor.indexOf("<RegistrationStartScheduleCalendar")

  assert.ok(suggestionIndex >= 0, "the compact suggestion is rendered")
  assert.ok(pickerIndex > suggestionIndex, "the suggestion is immediately before the first lesson picker")
  assert.match(editor, /참석 · 적합/)
  assert.match(editor, /첫 수업일 기본값에 반영했습니다\./)
  assert.match(editor, /applyRegistrationEnrollmentStartSelection/)
  assert.match(editor, /classStartSourceObservationId:\s*option\.source === "regular"[\s\S]*?\? ""/)
  assert.match(editor, /loadRegistrationEnrollmentStartObservation/)
  assert.doesNotMatch(editor, /latestDecisionObservation|\.attempts\b/)
  assert.match(calendar, /selectedSession\?\.sessionDate \|\| valueDate/)
  assert.match(calendar, /selectedSession\?\.label \|\| valueLabel/)
  assert.match(editor, /const currentMatchingObservation = permissions\.canManage && matchingObservation\?\.trackId === track\.id[\s\S]*?\? matchingObservation[\s\S]*?: null/)
  assert.equal((editor.match(/matchingObservation: currentMatchingObservation/g) || []).length, 3)
})

test("mounted observation first lesson suggestion fails closed in the permission downgrade commit", async () => {
  const hookHarness = createRegistrationEditorHookHarness()
  const observation = createControlledPromise()
  const RegistrationEnrollmentEditor = await loadMountedRegistrationEnrollmentEditor({
    hookHarness,
    loadObservation: () => observation.promise,
    loadClassDetails: async () => mountedRegistrationClassDetails(),
  })

  try {
    const managedProps = mountedRegistrationEditorProps()
    let view = hookHarness.render(RegistrationEnrollmentEditor, managedProps)
    hookHarness.flushEffects()
    findMountedRegistrationElement(
      view,
      (element) => element.props["aria-label"] === "영어 수업 1 선택",
      "first class selection",
    ).props.onValueChange(MOUNTED_REGISTRATION_CLASS_ID)
    view = hookHarness.render(RegistrationEnrollmentEditor, managedProps)
    hookHarness.flushEffects()
    observation.resolve(mountedRegistrationObservation)
    await flushMountedRegistrationWork()
    view = hookHarness.render(RegistrationEnrollmentEditor, managedProps)
    const managedText = collectMountedRegistrationText(view).join(" ")
    assert.match(managedText, /최근 적합 청강/)
    const managedCalendar = findMountedRegistrationElement(
      view,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "first lesson calendar",
    )
    assert.equal(managedCalendar.props.valueDate, "2026-08-17")
    assert.equal(managedCalendar.props.sourceObservationId, MOUNTED_REGISTRATION_OBSERVATION_ID)
    hookHarness.flushEffects()

    const downgradedView = hookHarness.render(RegistrationEnrollmentEditor, mountedRegistrationEditorProps({
      permissions: { canManage: false },
    }))
    const synchronousPermissionCommit = collectMountedRegistrationText(downgradedView).join(" ")
    const downgradedCalendar = findMountedRegistrationElement(
      downgradedView,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "downgraded first lesson calendar",
    )
    assert.doesNotMatch(synchronousPermissionCommit, /최근 적합 청강|중2 영어 A반/)
    assert.equal(downgradedCalendar.props.sessions.some((option) => option.source === "observation"), false)
    assert.equal(downgradedCalendar.props.sourceObservationId, MOUNTED_REGISTRATION_OBSERVATION_ID, "the stored draft stays intact")
    hookHarness.flushEffects()
  } finally {
    hookHarness.cleanup()
  }
})

test("mounted observation first lesson defaults only the newly added initiating row", async () => {
  const hookHarness = createRegistrationEditorHookHarness()
  const RegistrationEnrollmentEditor = await loadMountedRegistrationEnrollmentEditor({
    hookHarness,
    loadObservation: async () => mountedRegistrationObservation,
    loadClassDetails: async () => mountedRegistrationClassDetails(),
  })
  const persistedProps = mountedRegistrationEditorProps({
    track: {
      ...mountedRegistrationEditorProps().track,
      enrollmentDetailRows: [{
        id: "persisted-row",
        classId: MOUNTED_REGISTRATION_CLASS_ID,
        textbookId: null,
        classStartDate: null,
        classStartSessionKey: null,
        classStartLessonSessionId: null,
        classStartSession: null,
        classStartSourceObservationId: null,
        sortOrder: 0,
      }],
    },
  })

  try {
    let view = hookHarness.render(RegistrationEnrollmentEditor, persistedProps)
    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(RegistrationEnrollmentEditor, persistedProps)
    let calendars = findMountedRegistrationElements(
      view,
      (element) => element.props.subject === "영어" && Array.isArray(element.props.sessions),
    )
    assert.equal(calendars.length, 1)
    assert.equal(calendars[0].props.sourceObservationId, "", "persisted blank ownership is never defaulted")
    hookHarness.flushEffects()

    findMountedRegistrationElement(
      view,
      (element) => element.props["aria-label"] === "영어 수업 추가",
      "add enrollment row action",
    ).props.onClick()
    view = hookHarness.render(RegistrationEnrollmentEditor, persistedProps)
    hookHarness.flushEffects()
    const classSelections = findMountedRegistrationElements(
      view,
      (element) => String(element.props["aria-label"] || "").match(/^영어 수업 \d+ 선택$/),
    )
    assert.equal(classSelections.length, 2)
    classSelections[1].props.onValueChange(MOUNTED_REGISTRATION_CLASS_ID)
    view = hookHarness.render(RegistrationEnrollmentEditor, persistedProps)
    calendars = findMountedRegistrationElements(
      view,
      (element) => element.props.subject === "영어" && Array.isArray(element.props.sessions),
    )
    assert.equal(calendars.length, 2)
    assert.equal(calendars[0].props.sourceObservationId, "")
    assert.equal(calendars[1].props.sourceObservationId, MOUNTED_REGISTRATION_OBSERVATION_ID)
    assert.equal(collectMountedRegistrationText(view).filter((value) => value === "최근 적합 청강").length, 1)
    hookHarness.flushEffects()
  } finally {
    hookHarness.cleanup()
  }
})

test("mounted observation first lesson keeps a regular override through refresh and saves DB null", async () => {
  const hookHarness = createRegistrationEditorHookHarness()
  const saveCalls = []
  let observationLoads = 0
  const RegistrationEnrollmentEditor = await loadMountedRegistrationEnrollmentEditor({
    hookHarness,
    loadObservation: async () => {
      observationLoads += 1
      return mountedRegistrationObservation
    },
    loadClassDetails: async () => mountedRegistrationClassDetails(),
    saveEnrollmentDetails: async (input) => {
      saveCalls.push(input)
      return { trackId: input.trackId, rows: input.rows }
    },
  })
  const initialProps = mountedRegistrationEditorProps()

  try {
    let view = hookHarness.render(RegistrationEnrollmentEditor, initialProps)
    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(RegistrationEnrollmentEditor, initialProps)
    hookHarness.flushEffects()
    findMountedRegistrationElement(
      view,
      (element) => element.props["aria-label"] === "영어 수업 1 선택",
      "first class selection",
    ).props.onValueChange(MOUNTED_REGISTRATION_CLASS_ID)
    view = hookHarness.render(RegistrationEnrollmentEditor, initialProps)
    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(RegistrationEnrollmentEditor, initialProps)
    let mountedText = collectMountedRegistrationText(view).join(" ")
    assert.match(mountedText, /8월 17일\s*·\s*중2 영어 A반\s*· 참석 · 적합/)
    let calendar = findMountedRegistrationElement(
      view,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "defaulted first lesson calendar",
    )
    assert.equal(calendar.props.valueDate, "2026-08-17")
    assert.equal(calendar.props.sourceObservationId, MOUNTED_REGISTRATION_OBSERVATION_ID)
    const regularOption = calendar.props.sessions.find((option) => option.source === "regular")
    assert.deepEqual({
      source: regularOption?.source,
      sessionDate: regularOption?.sessionDate,
      key: regularOption?.classStartSessionKey,
    }, {
      source: "regular",
      sessionDate: "2026-08-24",
      key: MOUNTED_REGISTRATION_FUTURE_SESSION_KEY,
    })
    hookHarness.flushEffects()

    calendar.props.onSelect(regularOption)
    view = hookHarness.render(RegistrationEnrollmentEditor, initialProps)
    mountedText = collectMountedRegistrationText(view).join(" ")
    assert.doesNotMatch(mountedText, /최근 적합 청강/)
    calendar = findMountedRegistrationElement(
      view,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "regular first lesson calendar",
    )
    assert.equal(calendar.props.valueDate, "2026-08-24")
    assert.equal(calendar.props.sourceObservationId, "")
    hookHarness.flushEffects()

    const refreshedProps = mountedRegistrationEditorProps({
      track: {
        ...initialProps.track,
        observationFeedbackRevision: 3,
        enrollmentDetailRows: [],
      },
    })
    view = hookHarness.render(RegistrationEnrollmentEditor, refreshedProps)
    hookHarness.flushEffects()
    await flushMountedRegistrationWork()
    view = hookHarness.render(RegistrationEnrollmentEditor, refreshedProps)
    mountedText = collectMountedRegistrationText(view).join(" ")
    assert.doesNotMatch(mountedText, /최근 적합 청강/)
    calendar = findMountedRegistrationElement(
      view,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "refreshed regular first lesson calendar",
    )
    assert.equal(calendar.props.valueDate, "2026-08-24")
    assert.equal(calendar.props.sourceObservationId, "")
    assert.equal(observationLoads, 2)
    hookHarness.flushEffects()

    findMountedRegistrationElement(
      view,
      (element) => element.props["aria-label"] === "영어 등록 정보 저장",
      "enrollment save action",
    ).props.onClick()
    await flushMountedRegistrationWork()
    assert.equal(saveCalls.length, 1)
    assert.equal(saveCalls[0].trackId, MOUNTED_REGISTRATION_TRACK_ID)
    assert.deepEqual(saveCalls[0].rows, [{
      classId: MOUNTED_REGISTRATION_CLASS_ID,
      textbookId: null,
      classStartDate: "2026-08-24",
      classStartSessionKey: MOUNTED_REGISTRATION_FUTURE_SESSION_KEY,
      classStartLessonSessionId: MOUNTED_REGISTRATION_FUTURE_LESSON_ID,
      classStartSession: "2회차",
      classStartSourceObservationId: null,
      sortOrder: 0,
    }])
  } finally {
    hookHarness.cleanup()
  }
})

test("mounted observation first lesson ignores an old-track delayed completion", async () => {
  const hookHarness = createRegistrationEditorHookHarness()
  const staleTrackLoad = createControlledPromise()
  const currentTrackLoad = createControlledPromise()
  let loadCount = 0
  const RegistrationEnrollmentEditor = await loadMountedRegistrationEnrollmentEditor({
    hookHarness,
    loadObservation: () => {
      loadCount += 1
      return loadCount === 1 ? staleTrackLoad.promise : currentTrackLoad.promise
    },
    loadClassDetails: async () => mountedRegistrationClassDetails(),
  })
  const firstTrackProps = mountedRegistrationEditorProps()
  const secondTrackId = "76000000-0000-4000-8000-000000000099"
  const secondTrackProps = mountedRegistrationEditorProps({
    taskId: "76000000-0000-4000-8000-000000000098",
    track: {
      ...firstTrackProps.track,
      id: secondTrackId,
      taskId: "76000000-0000-4000-8000-000000000098",
      enrollmentDetailRows: [],
    },
  })

  try {
    hookHarness.render(RegistrationEnrollmentEditor, firstTrackProps)
    hookHarness.flushEffects()
    let view = hookHarness.render(RegistrationEnrollmentEditor, secondTrackProps)
    hookHarness.flushEffects()
    view = hookHarness.render(RegistrationEnrollmentEditor, secondTrackProps)
    hookHarness.flushEffects()
    findMountedRegistrationElement(
      view,
      (element) => element.props["aria-label"] === "영어 수업 1 선택",
      "current-track class selection",
    ).props.onValueChange(MOUNTED_REGISTRATION_CLASS_ID)
    view = hookHarness.render(RegistrationEnrollmentEditor, secondTrackProps)
    hookHarness.flushEffects()

    staleTrackLoad.resolve(mountedRegistrationObservation)
    await flushMountedRegistrationWork()
    view = hookHarness.render(RegistrationEnrollmentEditor, secondTrackProps)
    let calendar = findMountedRegistrationElement(
      view,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "current-track calendar after stale completion",
    )
    assert.equal(calendar.props.sourceObservationId, "")
    assert.equal(calendar.props.sessions.some((option) => option.source === "observation"), false)
    assert.doesNotMatch(collectMountedRegistrationText(view).join(" "), /최근 적합 청강/)
    hookHarness.flushEffects()

    const returnToFirstTrack = hookHarness.render(RegistrationEnrollmentEditor, firstTrackProps)
    calendar = findMountedRegistrationElement(
      returnToFirstTrack,
      (element) => element.props.subject === "영어" && element.props.rowIndex === 1 && Array.isArray(element.props.sessions),
      "returned first-track calendar before effects",
    )
    assert.equal(calendar.props.sourceObservationId, "")
    assert.equal(calendar.props.sessions.some((option) => option.source === "observation"), false)
    assert.doesNotMatch(collectMountedRegistrationText(returnToFirstTrack).join(" "), /최근 적합 청강/)
    hookHarness.flushEffects()
  } finally {
    hookHarness.cleanup()
    currentTrackLoad.resolve(null)
  }
})

test("observation first lesson editor keeps async ownership wiring and React state updaters pure", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editor = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const loadEffect = sourceBetween(editor, "const observationFeedbackRevision", "const missingClassIds")
  const loadTransition = sourceBetween(loadEffect, "const eligibleClientKeys", "}).catch")
  const selectClass = sourceBetween(editor, "function selectClass", "function selectStartSession")
  const selectClassUpdater = sourceBetween(selectClass, "setDraftRows((current) => {", "\n    })")
  const addRow = sourceBetween(editor, "function addRow", "function retryClassDetail")
  const addRowStateUpdate = addRow.slice(addRow.indexOf("setDraftRows"))

  assert.match(loadEffect, /if \(!owner\.owns\(token, track\.id\)\) return/)
  assert.match(loadEffect, /return \(\) => owner\.release\(token\)/)
  assert.match(loadTransition, /setDraftRows\(\(current\) => applyRegistrationEnrollmentStartDefault\(current, observationOption/)
  assert.doesNotMatch(loadTransition, /observationDefaultEligibleClientKeysRef\.current\.(?:add|delete)/)
  assert.doesNotMatch(selectClassUpdater, /observationDefaultEligibleClientKeysRef\.current\.(?:add|delete)/)
  assert.match(addRow, /observationDefaultEligibleClientKeysRef\.current\.add\(row\.clientKey\)[\s\S]*?setDraftRows/)
  assert.doesNotMatch(addRowStateUpdate, /observationDefaultEligibleClientKeysRef\.current\.(?:add|delete)/)
})

test("observation first lesson async ownership rejects old track completions and released generations", () => {
  const createOwner = registrationTrackModel.createRegistrationEnrollmentStartLoadOwner
  assert.equal(typeof createOwner, "function")
  const owner = createOwner()
  const trackA = owner.begin("track-a")
  assert.equal(owner.owns(trackA, "track-a"), true)

  const trackB = owner.begin("track-b")
  assert.equal(owner.owns(trackA, "track-a"), false)
  assert.equal(owner.owns(trackA, "track-b"), false)
  assert.equal(owner.owns(trackB, "track-b"), true)

  owner.release(trackB)
  assert.equal(owner.owns(trackB, "track-b"), false)
})

test("stale observation first lesson save errors stay private and keep a stable Korean recovery message", () => {
  const getMessage = registrationTrackModel.getRegistrationEnrollmentStartSaveErrorMessage
  assert.equal(typeof getMessage, "function")
  const message = getMessage({
    code: "23514",
    message: "registration_observation_class_start_source_invalid: internal row 42",
    details: "select * from public.ops_registration_observations",
  }, "수업 정보를 저장하지 못했습니다.")

  assert.equal(message, "청강 회차 정보가 변경되었습니다. 현재 수업 일정을 다시 선택해 주세요.")
  assert.doesNotMatch(message, /23514|registration_|ops_registration|select/i)
  assert.equal(
    getMessage(new Error("registration_invalid_source_state"), "fallback"),
    "등록 상태가 변경되었습니다. 최신 내용을 다시 불러와 주세요.",
  )
  assert.equal(getMessage(new Error("네트워크 오류"), "fallback"), "네트워크 오류")
})

test("enrollment save rejection uses the private stale-source message without replacing the draft", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editor = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const saveRows = sourceBetween(editor, "async function saveRows", "async function cancelPersistedEnrollment")
  const catchBlock = sourceBetween(saveRows, "} catch (error) {", "} finally")

  assert.match(catchBlock, /onWarning\(getRegistrationEnrollmentStartSaveErrorMessage\(/)
  assert.doesNotMatch(catchBlock, /setDraftRows|initialDraftRowsRef|canonicalDraftRows/)
})

test("enrollment workspace delegates workflow status changes to the subject status selector", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(source, /routeRegistrationEnrollmentDecision/)
  assert.doesNotMatch(source, /등록 대신 다른 단계로 이동/)
})

test("enrollment workspace keeps status routing out of the enrollment form", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const renderedEnrollment = sourceBetween(source, "  return (\n    <section ref={sectionRef}", "\n}\n\nexport type RegistrationAdmissionPanelProps")
  assert.doesNotMatch(renderedEnrollment, /등록 대신 다른 단계로 이동/)
  assert.doesNotMatch(renderedEnrollment, />대기로 전환</)
  assert.doesNotMatch(renderedEnrollment, />미등록 완료</)
  assert.doesNotMatch(renderedEnrollment, /등록 결정 후 대기 종류/)
  assert.match(source, /aria-label=\{`\$\{track\.subject\} 등록 정보 저장`\}/)
  assert.match(renderedEnrollment, /<RegistrationSaveButton[\s\S]*?dirty=\{rowsDirty\}[\s\S]*?cleanLabel=\{draftRows\.some\(\(row\) => row\.classId\) \? "저장됨" : "수업을 선택하세요"\}/)
})

test("appointment editor keeps an unchanged or empty reservation quiet until a field changes", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /<RegistrationSaveButton[\s\S]*?dirty=\{appointmentDirty \|\| externalDirty\}[\s\S]*?cleanLabel=\{appointment \? "저장됨" : "예약 정보를 입력하세요"\}/)
})

test("admission processing is only five freely editable checklist rows", async () => {
  const [progress, enrollment] = await Promise.all([
    readAdmissionProgressSource(),
    readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8"),
  ])
  const panel = enrollment.slice(enrollment.indexOf("export function RegistrationAdmissionPanel"))
  const labels = [
    "입학신청서 발송",
    "메이크에듀 등록(수업, 교재)",
    "청구서 발송",
    "수납 완료 확인",
    "등록 완료",
  ]

  assert.match(progress, /export function RegistrationAdmissionChecklist/)
  assert.equal((progress.match(/<input/g) || []).length, 1)
  assert.match(progress, /type="checkbox"/)
  assert.match(progress, /REGISTRATION_ADMISSION_CHECKLIST_ITEMS\.map/)
  assert.match(progress, /checked=\{checklist\[item\.key\]\}/)
  assert.match(progress, /onChange=\{\(event\) => onCheckedChange\(item\.key, event\.target\.checked\)\}/)
  assert.doesNotMatch(progress, /aria-current|locked|active|pending|optional|content|statusLabel/)

  for (const label of labels) assert.match(progress, new RegExp(label.replace(/[()]/g, "\\$&")))
  assert.equal((panel.match(/\n\s*<RegistrationAdmissionChecklist\n/g) || []).length, 1)
  assert.match(panel, /setRegistrationAdmissionChecklistItem\(\{/)
  assert.match(panel, /taskId,[\s\S]*?item,[\s\S]*?checked,[\s\S]*?requestKey/)
  for (const removedAction of [
    "startRegistrationAdmissionBatch",
    "setRegistrationEnrollmentMakeedu",
    "advanceRegistrationAdmissionBatch",
    "completeRegistrationAdmissionBatch",
    "cancelRegistrationAdmissionBatch",
    "RegistrationAdmissionProgress",
    "onOpenCustomerMessage",
    "입학 처리 취소",
    "이전 입학 처리",
  ]) assert.doesNotMatch(panel, new RegExp(removedAction))
  assert.doesNotMatch(panel, /checklist\.(?:applicationSent|makeeduRegistered|invoiceSent|paymentConfirmed|registrationCompleted)[\s\S]{0,160}disabled/)
})

test("registration-completed may be checked while every earlier checklist item is unchecked", async () => {
  const { RegistrationAdmissionChecklist } = await loadAdmissionProgressRuntime()
  const html = renderToStaticMarkup(createElement(RegistrationAdmissionChecklist, {
    checklist: {
      applicationSent: false,
      makeeduRegistered: false,
      invoiceSent: false,
      paymentConfirmed: false,
      registrationCompleted: true,
    },
    editable: true,
    savingItems: new Set(),
    onCheckedChange: () => undefined,
  }))
  const rows = html.match(/<li\b[\s\S]*?<\/li>/g) || []

  assert.equal(rows.length, 5)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 5)
  assert.equal((html.match(/disabled=""/g) || []).length, 0)
  assert.doesNotMatch(rows[0], /checked=""/)
  assert.doesNotMatch(rows[1], /checked=""/)
  assert.doesNotMatch(rows[2], /checked=""/)
  assert.doesNotMatch(rows[3], /checked=""/)
  assert.match(rows[4], /checked=""/)
})

test("the legacy registration detail does not render a second dependent admission checklist", async () => {
  const source = await readWorkspaceSource()

  assert.doesNotMatch(source, /RegistrationOperationsChecklistChips/)
  assert.doesNotMatch(source, /getRegistrationChecklistAvailability|getMissingRegistrationCheckLabels/)
  assert.doesNotMatch(source, /입학신청서 알림톡 \(선택\)|입학 처리 정보/)
  assert.match(source, /<RegistrationApplication/)
})

test("browser fixture mirrors message-independent identity editing locks", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-fixtures.ts", import.meta.url), "utf8")
  const lock = sourceBetween(
    source,
    "function fixtureRegistrationIdentityFrozen",
    "function fixtureRegistrationTrackRemovalBlocked",
  )

  assert.doesNotMatch(lock, /admissionNoticeSent/)
  assert.match(lock, /detail\.admissionBatches\.length > 0/)
  assert.match(lock, /enrollment\.status === "planned" && enrollment\.admissionBatchId === null/)
  assert.match(lock, /detail\.admissionApplicationMessageClaimActive/)
})

test("unified track editor and workspace mount subject rows plus one case-level admission panel", async () => {
  const trackEditor = await readRegistrationApplicationSource()
  assert.match(trackEditor, /RegistrationEnrollmentTrackEditor/)
  assert.match(trackEditor, /track=\{track\}/)
  assert.match(trackEditor, /enrollments=\{detail\.enrollments/)
  assert.equal((trackEditor.match(/<RegistrationAdmissionPanel/g) || []).length, 1)

  const shell = await readWorkspaceSource()
  assert.match(shell, /<RegistrationApplication/)
  assert.match(shell, /customerMessageClient=\{/)
  assert.doesNotMatch(shell, /<RegistrationAdmissionPanel/)
})

test("canonical registration editors keep messaging outside the admission checklist", async () => {
  const [appointment, observation, actions, enrollment, application] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-observation-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
  ])

  assert.equal((application.match(/<RegistrationAlimtalkPreviewDialog/g) || []).length, 1)
  assert.match(application, /useState<RegistrationCustomerMessageTarget \| null>\(null\)/)
  assert.match(application, /client=\{customerMessageClient\}/)
  assert.match(application, /viewerRole=\{viewerRole \|\| "assistant"\}/)
  assert.match(application, /triggerRef=\{customerMessageTriggerRef\}/)
  assert.match(application, /if \(!canManageCase\) return[\s\S]*setCustomerMessageTarget\(target\)/)
  assert.match(application, /const activeCustomerMessageTarget = canManageCase && customerMessageTarget/)
  assert.equal((application.match(/canOpenCustomerMessage=\{canManageCase\}/g) || []).length, 2)
  assert.match(application, /const reloadAfterCustomerMessageSend = useCallback\(async \(\) => \{[\s\S]*await onReload\(\)/)
  assert.match(application, /onSendSuccess=\{async \(\) => \{[\s\S]*reloadAfterCustomerMessageSend\(\)/)

  const appointmentSave = appointment.indexOf("<RegistrationSaveButton")
  const bookingTrigger = appointment.indexOf("예약 안내 알림톡", appointmentSave)
  const reminderTrigger = appointment.indexOf("리마인드 알림톡", appointmentSave)
  assert.ok(appointmentSave >= 0 && bookingTrigger > appointmentSave)
  assert.equal(reminderTrigger, -1)
  assert.match(appointment, /messageKind: kind === "level_test" \? "level_test_booking_bundle" : "visit_consultation_booking_bundle",\s*sourceId: taskId/)
  assert.doesNotMatch(appointment, /messageKind: "appointment_reminder"/)
  assert.match(appointment, /appointmentDirty \|\| externalDirty \|\| saving \|\| confirmationPending \|\| refreshPending \|\| Boolean\(conflict\) \|\| appointment\?\.status !== "scheduled"/)
  assert.match(appointment, /예약을 저장한 뒤 알림톡을 보낼 수 있습니다\./)
  assert.match(appointment, /canOpenCustomerMessage\?: boolean/)
  assert.match(appointment, /\{canOpenCustomerMessage \? \([\s\S]*예약 안내 알림톡/)
  const customerMessageControls = appointment.slice(
    appointment.indexOf("{canOpenCustomerMessage ? ("),
    appointment.indexOf("</>", appointment.indexOf("{canOpenCustomerMessage ? (")),
  )
  assert.equal((customerMessageControls.match(/className="min-h-11 min-w-11"/g) || []).length, 1)

  assert.match(observation, /messageKind: "observation_booking_bundle", sourceId: detail\.track\.taskId/)

  const waiting = sourceBetween(actions, "export function RegistrationWaitingDetailsEditor", "function TerminalStageEditor")
  const waitingSave = waiting.indexOf("<RegistrationSaveButton")
  const waitingTrigger = waiting.indexOf("대기 안내 알림톡", waitingSave)
  assert.ok(waitingSave >= 0 && waitingTrigger > waitingSave)
  assert.match(waiting, /messageKind: "waiting_notice", sourceId: track\.id/)
  assert.match(waiting, /permissions\.canManage/)
  assert.match(waiting, /waitingDirty \|\| saving \|\| refreshPending \|\| !savedWaitingComplete/)
  assert.match(waiting, /className="min-h-11 min-w-11"[\s\S]*대기 안내 알림톡/)

  const admission = enrollment.slice(enrollment.indexOf("export function RegistrationAdmissionPanel"))
  assert.match(admission, /permissions\.canManage/)
  assert.match(admission, /<RegistrationAdmissionChecklist/)
  assert.doesNotMatch(admission, /알림톡|messageKind|onOpenCustomerMessage|onSendAdmissionMessage|onReconcileAdmissionMessage|onReleaseAdmissionMessageRetry|제공사 확인 증빙|재발송 허용/)

  assert.equal((application.match(/onOpenCustomerMessage=\{openCustomerMessage\}/g) || []).length, 3)
  assert.match(application, /onOpenCustomerMessage=\{canManageCase \? openCustomerMessage : undefined\}/)
  assert.doesNotMatch(application, /admissionActions/)
})

test("always-open appointment and enrollment editors use disjoint React key namespaces", async () => {
  const [detail, actions] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
  ])

  assert.match(detail, /key=\{`level_test:/)
  assert.match(detail, /key=\{`visit_consultation:/)
  assert.match(actions, /<RegistrationEnrollmentEditor[\s\S]*?key=\{`enrollment:/)
  assert.doesNotMatch(detail, /<RegistrationTrackStageEditor/)
})

test("enrollment stages show the real work surface without a redundant placeholder or director row", async () => {
  const source = await readRegistrationApplicationSource()
  const stageEditor = sourceBetween(
    source,
    "export function RegistrationTrackStageEditor(",
    "\nexport type RegistrationConsultationOutcomeEditorProps",
  )

  assert.match(stageEditor, /\["not_registered", "inquiry_closed"\]\.includes\(track\.status\)[\s\S]*?<TerminalStageEditor/)
  assert.match(stageEditor, /\["enrollment_decided", "enrollment_processing", "registered"\]\.includes\(track\.status\)[\s\S]*?return null/)
  assert.doesNotMatch(stageEditor, /전용 입력 화면|현재 상태와 권한/)
  assert.doesNotMatch(source, /REGISTRATION_DIRECTOR_VISIBLE_STATUSES/)
  assert.match(source, /section === "consultation" && !context\.track\.migrationReviewRequired/)
})

test("committed enrollment saves recover refresh without resubmitting mutations", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const enrollmentBlock = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  assert.match(source, /const REGISTRATION_REFRESH_TIMEOUT_MS = 10_000/)
  assert.match(source, /function withRegistrationRefreshTimeout[\s\S]*?Promise\.race/)
  assert.match(enrollmentBlock, /async function retryEnrollmentReload/)
  assert.match(enrollmentBlock, /await withRegistrationRefreshTimeout\(onReload\(\)\)[\s\S]*setOwnerRefreshPending\(owner, false\)[\s\S]*catch[\s\S]*setOwnerRefreshPending\(owner, true\)/)
  assert.doesNotMatch(enrollmentBlock, /setOwnerRefreshPending\([^,]+, true\)\s*\n\s*await reloadCommitted/)
  assert.match(source, /onClick=\{\(\) => void retryEnrollmentReload\(\{ kind: "rows" \}\)\}/)
  assert.doesNotMatch(source, /retryAdmissionReload|setBatchRefreshPending|setMessageRefreshPending/)
})

test("registered add-class starts empty and cannot submit an empty draft list", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /track\.status === "enrollment_decided"[\s\S]*createRegistrationEnrollmentDraft/)
  assert.match(source, /<RegistrationSaveButton[\s\S]*?dirty=\{rowsDirty\}[\s\S]*?blocked=\{rowsRefreshPending \|\| draftRows\.length === 0\}/)
  assert.match(source, /if \(blockers\.length > 0\)[\s\S]*?\.focus\(\)/)
  assert.match(source, /row\.id === null && draftRows\.length === 1 && track\.status === "enrollment_decided"/)
})

test("persisted planned rows cancel explicitly and class detail failures can be retried", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /row\.id === null \? "삭제" : "수강 취소"/)
  assert.match(source, /row\.id === null[\s\S]*setCancelEnrollmentId\(row\.id\)/)
  assert.match(source, /classDetailRetryToken/)
  assert.match(source, /수업 일정 다시 불러오기/)
  assert.match(source, /activeEnrollmentRows/)
})

test("enrollment cancellation UI consumes the canonical history classifier", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /getRegistrationEnrollmentCancellationState/)
  assert.match(source, /selectedEnrollmentCancellation\.requiresDestination/)
  assert.doesNotMatch(source, /const otherActiveRows/)
  assert.match(source, /setCancelDestination\(""\)[\s\S]*setCancelEnrollmentId\(row\.id\)/)
  assert.doesNotMatch(source, /getRegistrationAdmissionBatchCancellationGroups|setCancelBatchOpen/)
})

test("an unrelated subject open batch does not block registered draft editing", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editorBlock = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const canEditBlock = sourceBetween(editorBlock, "const canEditRows", "const selectedCancelEnrollment")
  assert.match(canEditBlock, /permissions\.canManage[\s\S]*?&& !rowsRefreshPending/)
  assert.doesNotMatch(canEditBlock, /trackHasOpenBatch|openBatch/)
  assert.match(editorBlock, /if \(!enrollment \|\| saving \|\| cancellationRefreshPending \|\| trackHasOpenBatch\) return/)
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  const saveBlock = sourceBetween(service, "async function saveRegistrationEnrollmentRows", "async function claimRegistrationAdmissionMessage")
  assert.doesNotMatch(saveBlock, /admissionBatches|hasOtherOpenBatch/)
})

test("persisted null textbooks remain explicitly cleared after editor remount", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /restoreRegistrationEnrollmentDraft/)
  assert.doesNotMatch(source, /textbookExplicitlyCleared:\s*false,\s*\n\s*textbookId:\s*enrollment\.textbookId/)
})

test("read-only admission viewers see checklist status without mutation buttons", async () => {
  const { RegistrationAdmissionChecklist } = await loadAdmissionProgressRuntime()
  const html = renderToStaticMarkup(createElement(RegistrationAdmissionChecklist, {
    checklist: {
      applicationSent: true,
      makeeduRegistered: false,
      invoiceSent: true,
      paymentConfirmed: false,
      registrationCompleted: true,
    },
    editable: false,
    savingItems: new Set(),
    onCheckedChange: () => undefined,
  }))
  assert.equal((html.match(/type="checkbox"/g) || []).length, 5)
  assert.equal((html.match(/disabled=""/g) || []).length, 5)
  assert.equal((html.match(/checked=""/g) || []).length, 3)
})

test("admission panel leaves provider recovery timing to the shared dialog", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(source, /useAdmissionRecoveryAvailable|getRegistrationAdmissionRecoveryDelayMs/)
  assert.doesNotMatch(source, /재발송 허용|onReleaseAdmissionMessageRetry/)
})

test("enrollment saves lock after a committed refresh failure", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /<RegistrationSaveButton[\s\S]*?blocked=\{rowsRefreshPending \|\| draftRows\.length === 0\}/)
  assert.doesNotMatch(source, /batchRefreshPending|messageRefreshPending/)
})

test("enrollment form contains no secondary decision-routing controls", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(source, /등록 대신 다른 단계로 이동/)
  assert.doesNotMatch(source, />단계 변경</)
})

test("registration application owns the exact stable dirty-key aggregates", async () => {
  const source = await readRegistrationApplicationSource()
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")

  assert.match(editor, /useRef<Set<RegistrationApplicationDirtyKey>>\(new Set\(\)\)/)
  assert.match(editor, /updateRegistrationApplicationDirtyKeys/)
  assert.match(editor, /onDirtyChangeRef\.current\?\.\(next\.size > 0\)/)
  for (const key of [
    "inquiry:editor",
    "level_test:track-${trackId}",
    "consultation:track-${context.track.id}",
    "placement:track-${track.id}",
  ]) assert.ok(source.includes(key), `missing dirty owner ${key}`)
  assert.match(editor, /getRegistrationEnrollmentDirtyKey\(track\.id, scope\)/)
  assert.match(editor, /level_test:appointment-/)
  assert.match(editor, /consultation:appointment-/)
})

test("every local registration editor reports dirty state through its owner", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const inquiry = await readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8")

  assert.ok((actions.match(/onDirtyChange\?: \(dirty: boolean\) => void/g) || []).length >= 7)
  assert.match(appointment, /onDirtyChange\?: \(dirty: boolean\) => void/)
  assert.match(appointment, /onTrackDirtyChange\?: \(trackId: string, dirty: boolean\) => void/)
  assert.match(enrollment, /RegistrationEnrollmentEditorProps[\s\S]*?onDirtyChange\?: \(scope: RegistrationEnrollmentDirtyScope, dirty: boolean\) => void/)
  assert.doesNotMatch(enrollment, /RegistrationAdmissionPanelProps[\s\S]*?onDirtyChange/)
  assert.match(inquiry, /onDirtyChange\?: \(dirty: boolean\) => void/)
})

test("sibling canonical reloads preserve editor drafts and dirty membership", async () => {
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(editor, /key=\{`stage:\$\{track\.id\}:\$\{track\.status\}:\$\{track\.waitingKind\}`\}/)
  assert.doesNotMatch(editor, /detail\.enrollments\.map\(\(enrollment\)/)
  assert.doesNotMatch(editor, /appointmentActivitySignature/)
  assert.match(actions, /useOwnedDirtyState/)
  assert.match(editor, /key=\{`consultation:\$\{context\.latestConsultation\.id\}:\$\{context\.latestConsultation\.updatedAt\}`\}/)
})

test("inline consultation completion exposes the locked Task 6 interface and recovery copy", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const outcome = sourceBetween(source, "export type RegistrationConsultationOutcomeEditorProps", "export function RegistrationMigrationReviewEditor")

  assert.match(outcome, /subject: RegistrationSubject/)
  assert.match(outcome, /editable: boolean/)
  assert.match(outcome, /onDirtyChange\?: \(dirty: boolean\) => void/)
  assert.match(source, /const COMMITTED_REFRESH_ERROR = "저장은 완료됐지만 최신 내용을 불러오지 못했습니다"/)
  assert.match(outcome, /\{COMMITTED_REFRESH_ERROR\}/)
  assert.match(outcome, /최신 내용 다시 불러오기/)
  assert.doesNotMatch(outcome, /Dialog|DialogContent|onOpenChange/)
})

test("section validation is local, Korean, and focuses its first invalid control", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  for (const source of [actions, appointment, enrollment]) {
    assert.match(source, /role="alert"/)
    assert.match(source, /\.focus\(\)/)
  }
  assert.match(actions, /입력하세요|선택하세요/)
  assert.match(appointment, /예약 일시와 장소를 모두 입력하세요/)
  assert.match(enrollment, /수업 정보를 확인하세요/)
  assert.match(enrollment, /rowsValidationError && rowBlockers\.length > 0/)
})

test("consultation detail stays compact and omits explanatory card copy already implied by the controls", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(source, /전화상담은 예약 없이 담당자가 순서대로 처리합니다/)
  assert.doesNotMatch(source, /상담 기록만 저장합니다\. 진행상태와 대기 반은 별도로 정합니다/)
  assert.doesNotMatch(source, /\[\{track\.subject\}\] 전화상담 대기|\[\{subject\}\].*상담.*결과/)
  assert.match(source, /className="grid min-w-0 gap-3" aria-label=\{`\$\{track\.subject\} 상담 대기`\}/)
  assert.match(source, /className="grid gap-4 border-t pt-4" aria-label=\{subject \+ " 상담 결과"\}/)
})

test("waiting details stay directly editable regardless of the legacy pipeline stage", async () => {
  const [application, actions] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
  ])

  assert.match(actions, /export function RegistrationWaitingDetailsEditor/)
  assert.match(application, /<RegistrationWaitingDetailsEditor/)
  assert.match(application, /if \(track\.migrationReviewRequired\) return section === "placement" && placementMode === "waiting"/)
  assert.ok(
    application.indexOf('placementMode === "waiting"') < application.indexOf("if (track.migrationReviewRequired) return null"),
    "waiting details render before the migration-only guard",
  )
  assert.doesNotMatch(application, /context\.state\.currentSection !== section\) return null/)
})

test("subject-owned controls name their subject and keep mobile primary actions after inputs", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const consultation = sourceBetween(actions, "export type RegistrationConsultationOutcomeEditorProps", "export function RegistrationMigrationReviewEditor")
  const enrollmentRows = sourceBetween(enrollment, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")

  assert.match(consultation, /aria-label=\{`\$\{subject\} 상담 결과 저장`\}/)
  assert.match(appointment, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 레벨테스트 결과 링크`\}/)
  assert.match(enrollmentRows, /aria-label=\{`\$\{track\.subject\} 수업 \$\{index \+ 1\} 선택`\}/)
  assert.ok(consultation.indexOf("outcome") < consultation.indexOf("상담 결과 저장"))
  assert.ok(enrollmentRows.indexOf("draftRows.map") < enrollmentRows.indexOf("등록 정보 저장"))
})

test("catalog failures lock only their selectors and retain a local retry", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  assert.match(actions, /const directorSelectorLocked =/)
  assert.match(actions, /disabled=\{Boolean\(manualDirectorConflictAttempt\) \|\| directorSelectorLocked \|\| savingManual \|\| automaticSaving\}/)
  assert.match(actions, /담당자 정보 다시 불러오기/)
  assert.match(enrollment, /classDetailById\[row\.classId\] === null/)
  assert.match(enrollment, /수업 일정 다시 불러오기/)
})

test("committed refresh failures clear only their dirty owner and lock mutation replay", async () => {
  const source = await readRegistrationApplicationSource()
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  for (const editor of [source, appointment]) {
    assert.match(editor, /저장은 완료됐지만 최신 내용을 불러오지 못했습니다/)
    assert.match(editor, /onDirtyChange\?\.\(false\)/)
    assert.match(editor, /최신 내용 다시 불러오기/)
  }
  assert.match(enrollment, /저장은 완료됐지만 최신 내용을 불러오지 못했습니다/)
  assert.match(enrollment, /onDirtyChange\?\.\(owner, false\)/)
  assert.match(enrollment, /최신 내용 다시 불러오기/)
  assert.match(appointment, /trackRefreshPendingIds/)
  assert.match(appointment, /reloadAfterCommittedMutation\(trackId: string\)/)
  assert.doesNotMatch(sourceBetween(appointment, "async function reloadAfterCommittedMutation", "async function retryTrackRefresh"), /onTrackDirtyChangeRef\.current\?\.\(trackId, false\)/)
  assert.match(appointment, /const linkDirty =/)
  assert.doesNotMatch(appointment, /reasonDirty/)
  assert.match(enrollment, /rowsRefreshPending/)
  assert.match(enrollment, /cancellationRefreshPending/)
  assert.doesNotMatch(enrollment, /batchRefreshPending|messageRefreshPending/)
  assert.doesNotMatch(sourceBetween(source, "async function retryRefresh()", "return ("), /completeRegistrationConsultation/)
})

test("common revision conflicts show attempted and latest values before an explicit choice", async () => {
  const inquiry = await readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8")
  const editor = sourceBetween(inquiry, "export function RegistrationInquiryEditor", "export type RegistrationApplicationInquirySectionProps")

  assert.match(editor, /registrationInquiryConflictRows/)
  assert.match(editor, /conflictAttempt/)
  assert.match(editor, /내가 입력한 값/)
  assert.match(editor, /최신 저장 값/)
  assert.match(editor, /최신 값 사용/)
  assert.match(editor, /내 입력 다시 적용/)
  assert.match(inquiry, /subjects: "과목"/)
  assert.doesNotMatch(sourceBetween(editor, 'outcome === "conflict"', '} else {'), /await onSave/)
})

test("manual director revision conflicts compare the attempted and latest director before retry", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const director = sourceBetween(actions, "export const RegistrationTrackDirectorSection", "const REGISTRATION_HISTORY_DATE_FORMATTER")
  const manualSave = sourceBetween(director, "async function saveManualDirector", "async function retryAutomaticRefresh")
  const conflict = sourceBetween(manualSave, 'message.includes("registration_common_revision_conflict")', 'message.includes("registration_visit_reassign_requires_reschedule")')

  assert.match(director, /manualDirectorConflictAttempt/)
  assert.match(director, /내가 선택한 담당자/)
  assert.match(director, /최신 저장 담당자/)
  assert.match(director, /최신 담당자 사용/)
  assert.match(director, /내 선택 다시 적용/)
  assert.ok(conflict.indexOf("beginRegistrationConflictComparison") < conflict.indexOf("await onReload"))
  assert.match(conflict, /settleRegistrationConflictComparison/)
  assert.doesNotMatch(conflict, /assignRegistrationTrackDirector/)
})

test("migration review revision conflicts preserve a comparable draft behind an explicit choice", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const editor = await readRegistrationApplicationSource()
  const migrationStart = actions.indexOf("export function RegistrationMigrationReviewEditor")
  assert.notEqual(migrationStart, -1)
  const migration = actions.slice(migrationStart)
  const conflict = sourceBetween(migration, 'message.includes("registration_common_revision_conflict")', "} else {")

  assert.match(editor, /useState<RegistrationMigrationConflictState \| null>\(null\)/)
  assert.match(editor, /<RegistrationMigrationConflictNotice/)
  assert.ok(editor.indexOf("<RegistrationMigrationConflictNotice") < editor.indexOf("<RegistrationMigrationReviewEditor"))
  assert.match(editor, /<RegistrationMigrationReviewEditor[\s\S]*?key=\{detail\.task\.id\}/)
  assert.match(migration, /onConflictStateChange/)
  assert.match(actions, /내가 선택한 분리안/)
  assert.match(actions, /최신 저장 상태/)
  assert.match(actions, /최신 상태 사용/)
  assert.match(actions, /내 분리안 다시 적용/)
  assert.ok(conflict.indexOf("beginRegistrationConflictComparison") < conflict.indexOf("await onResolved"))
  assert.doesNotMatch(conflict, /resolveRegistrationMigrationReview/)
  const retry = sourceBetween(editor, "async function retryMigrationConflictRefresh", "function useLatestMigrationConflict")
  assert.doesNotMatch(retry, /assignRegistrationTrackDirector|resolveRegistrationMigrationReview/)
})

test("migration director and review drafts keep separate dirty and refresh owners", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const migration = actions.slice(actions.indexOf("export function RegistrationMigrationReviewEditor"))
  const directorSave = sourceBetween(migration, "async function saveDirector", "async function retryDirectorCatalog")
  const directorReset = sourceBetween(migration, "if (directorConflictResetVersionRef.current", "useEffect(() => {\n    if (reviewConflictResetVersionRef.current")
  const reviewReset = sourceBetween(migration, "if (reviewConflictResetVersionRef.current", "function groupIsAssignedTo")

  assert.match(migration, /onDirtyChange\?: \(scope: RegistrationMigrationDirtyScope, dirty: boolean\) => void/)
  assert.match(migration, /useOwnedDirtyState\([\s\S]*?directorRefreshPending[\s\S]*?"director"/)
  assert.match(migration, /useOwnedDirtyState\([\s\S]*?reviewRefreshPending[\s\S]*?"review"/)
  assert.match(directorSave, /onDirtyChange\?\.\("director", false\)/)
  assert.doesNotMatch(directorSave, /onDirtyChange\?\.\("review", false\)/)
  assert.doesNotMatch(directorSave, /setReviewRefreshPending/)
  assert.match(directorReset, /setDirectorIds/)
  assert.doesNotMatch(directorReset, /setAssignments|setTargetStates|setWaitingKinds|setClassIds/)
  assert.doesNotMatch(reviewReset, /setDirectorIds/)
})

test("enrollment rows and persisted cancellations report and recover separate owners", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const block = sourceBetween(enrollment, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")

  assert.match(enrollment, /export type RegistrationEnrollmentDirtyScope/)
  assert.match(block, /rowsRefreshPending/)
  assert.match(block, /cancellationRefreshPending/)
  assert.match(block, /reloadCommitted\(owner: RegistrationEnrollmentDirtyScope\)/)
  assert.match(block, /useScopedDirtyState\(\{ kind: "rows" \}/)
  assert.match(block, /kind: "cancellation"/)
  assert.match(block, /persistedRegistrationEnrollmentDrafts/)
  assert.match(block, /cachedEnrollmentDraft/)
  assert.match(block, /reconcileRegistrationEnrollmentDraft/)
  assert.match(block, /canonicalEnrollmentKey/)
  assert.match(block, /canonicalKeyRef/)
  assert.match(editor, /getRegistrationEnrollmentDirtyKey/)
  assert.match(editor, /clearRegistrationEnrollmentDrafts\(detail\.task\.id\)/)
  assert.match(actions, /key=\{`enrollment:\$\{track\.id\}`\}/)
})

test("level-test result saving retains its draft until the mutation commits", async () => {
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const reload = sourceBetween(appointment, "async function reloadAfterCommittedMutation", "async function retryTrackRefresh")
  const complete = sourceBetween(appointment, "async function completeAttempt", "return (")

  assert.doesNotMatch(reload, /onTrackDirtyChangeRef\.current\?\.\(trackId, false\)/)
  assert.match(complete, /setDraftLinks/)
  assert.match(complete, /reloadAfterCommittedMutation\(activity\.trackId\)/)
  assert.doesNotMatch(appointment, /startAttempt|reasonDirty/)
})

test("appointment save confirmation stays visible inside the registration detail modal", async () => {
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(appointment, /from "@\/components\/ui\/dialog"/)
  assert.match(appointment, /pendingConfirmation \? \([\s\S]*?role="alertdialog"/)
  assert.match(appointment, /aria-labelledby="registration-appointment-confirmation-title"/)
  assert.match(appointment, /id="registration-appointment-confirmation-title"[\s\S]*?예약을 저장할까요\?/)
  assert.doesNotMatch(appointment, /registration-appointment-confirmation-description|pendingConfirmation\.message/)
  assert.match(appointment, /className="min-h-11 min-w-11" variant="outline" onClick=\{dismissAppointmentConfirmation\} disabled=\{saving\}>돌아가기<\/Button>/)
  assert.match(appointment, /className="min-h-11 min-w-11" onClick=\{\(\) => void confirmPreparedAppointmentMutation\(\)\} disabled=\{saving\}>저장<\/Button>/)
  assert.match(appointment, /blocked=\{mutationLocked \|\| confirmationPending \|\| Boolean\(conflict\)\}/)
  assert.match(appointment, /disabled=\{saving \|\| confirmationPending \|\| mutationLocked\}/)
})

test("enrollment cancellation validation is local and focuses subject-owned controls", async () => {
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const cancellation = sourceBetween(enrollment, "async function cancelPersistedEnrollment", "const immutableHistory")

  assert.match(cancellation, /취소 후 대기 종류를 선택하세요/)
  assert.match(cancellation, /취소 후 대기 수업을 선택하세요/)
  assert.match(cancellation, /\.focus\(\)/)
  assert.match(enrollment, /cancellationValidationError[\s\S]*role="alert"/)
})

test("remaining subject-owned mutation controls expose their subject in accessible names", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  assert.match(actions, /aria-label=\{`\$\{track\.subject\} 대기 정보 저장`\}/)
  assert.doesNotMatch(actions, /aria-label=\{`\$\{track\.subject\} 등록 전환`\}/)
  assert.match(actions, /aria-label=\{`\$\{track\.subject\} 방문상담 예약`\}/)
  assert.match(enrollment, /aria-label=\{`\$\{track\.subject\} 수업 \$\{index \+ 1\} \$\{row\.id === null \? "삭제" : "수강 취소"\}`\}/)
  assert.match(appointment, /aria-label=\{saveAriaLabel \|\| `\$\{appointmentParticipantSubjectLabel\} 예약 저장`\}/)
  assert.match(appointment, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 레벨테스트 결과 저장`\}/)
})

test("ops task workspace uses the registration application aggregate in the host close guard", async () => {
  const workspace = await readWorkspaceSource()

  assert.match(workspace, /const \[registrationApplicationDirty, setRegistrationApplicationDirty\] = useState\(false\)/)
  assert.match(workspace, /onDirtyChange=\{setRegistrationApplicationDirty\}/)
  assert.match(workspace, /data-registration-application-dirty=\{registrationApplicationDirty \? "true" : "false"\}/)
  assert.match(workspace, /registrationApplicationHost\.kind === "detail" && registrationApplicationDirty/)
  assert.match(workspace, /setConfirmingFormClose\(true\)/)
})

test("registration create and canonical detail share one explicit application host", async () => {
  const [workspace, application] = await Promise.all([
    readWorkspaceSource(),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
  ])

  assert.match(workspace, /type RegistrationApplicationHostState\s*=/)
  for (const kind of ["closed", "create", "loading_detail", "detail", "refresh_failed"]) {
    assert.match(workspace, new RegExp(`kind: "${kind}"`))
  }
  assert.equal((workspace.match(/data-registration-application-host/g) || []).length, 1)
  assert.match(workspace, /data-registration-application-mode=\{registrationApplicationHost\.kind\}/)
  assert.match(workspace, /registrationApplicationHost\.kind === "create"[\s\S]*?<RegistrationApplicationCreate/)
  assert.match(workspace, /registrationApplicationHost\.kind === "detail"[\s\S]*?<RegistrationApplication/)
  assert.match(workspace, /registrationApplicationHost\.kind === "loading_detail"[\s\S]*?등록 신청서를 불러오는 중입니다/)
  assert.match(workspace, /registrationApplicationHost\.kind === "refresh_failed"[\s\S]*?최신 내용 다시 불러오기/)
  assert.match(application, /onDirtyChange\?: \(dirty: boolean\) => void/)
  assert.match(workspace, /onDirtyChange=\{setRegistrationApplicationDirty\}/)
})

test("registration host owns dirty close protection and clears every application deep link", async () => {
  const workspace = await readWorkspaceSource()
  const closeSource = sourceBetween(
    workspace,
    "  const requestRegistrationApplicationClose = useCallback(() =>",
    "\n\n  useEffect(() => {\n    if (deleteTarget) return",
  )

  assert.match(closeSource, /registrationApplicationHost\.kind === "create" && isFormDirty/)
  assert.match(closeSource, /registrationApplicationHost\.kind === "detail" && registrationApplicationDirty/)
  assert.match(closeSource, /setConfirmingFormClose\(true\)/)
  assert.match(closeSource, /closeRegistrationApplicationHost\(\)/)
  assert.match(workspace, /const closeRegistrationApplicationHost = useCallback\(\(\) => \{[\s\S]*?setRegistrationApplicationHost\(\{ kind: "closed" \}\)/)
  assert.match(workspace, /const closeRegistrationApplicationHost = useCallback\(\(\) => \{[\s\S]*?setSelectedRegistrationTrackId\(null\)/)
  assert.match(workspace, /const closeRegistrationApplicationHost = useCallback\(\(\) => \{[\s\S]*?setSelectedRegistrationAppointmentId\(null\)/)
  assert.match(workspace, /const closeRegistrationApplicationHost = useCallback\(\(\) => \{[\s\S]*?setRegistrationCaseDetail\(null\)/)
  assert.match(workspace, /const closeRegistrationApplicationHost = useCallback\(\(\) => \{[\s\S]*?syncTaskDeepLink\(null\)/)
})

test("saved detail owns one unified inquiry draft and removes duplicate inquiry summaries", async () => {
  const [detail, actions, inquiry] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8").catch(() => ""),
  ])
  const detailRender = detail.slice(detail.indexOf("export function RegistrationApplication"))

  assert.match(inquiry, /export type RegistrationInquiryDraft\b/)
  assert.match(detailRender, /<RegistrationInquiryEditor\b/)
  assert.equal((detailRender.match(/<RegistrationInquiryEditor\b/g) || []).length, 1)
  assert.doesNotMatch(detailRender, /<RegistrationSubjectSyncSection\b/)
  assert.doesNotMatch(detail, /RegistrationTrackSectionValues/)
  assert.doesNotMatch(actions, /export function RegistrationLevelTestSummary\b/)
  assert.doesNotMatch(actions, /export function RegistrationConsultationSummary\b/)
  assert.doesNotMatch(actions, /export function RegistrationPlacementSummary\b/)
  assert.doesNotMatch(actions, /공통 정보 저장|과목 저장/)
  assert.match(inquiry, /<RegistrationSaveButton[\s\S]*?dirty=\{dirty\}[\s\S]*?cleanLabel="저장됨"/)
})

test("saved detail keeps every operational frame available without repeating shell lock copy", async () => {
  const detail = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const frame = sourceBetween(detail, "function RegistrationTrackSectionFrame", "export function RegistrationApplication")
  const frameGate = sourceBetween(detail, "function hasRegistrationTrackFrameContent", "function RegistrationTrackSectionFrame")
  const focusPanel = sourceBetween(detail, "function getRegistrationTrackFocusPanelId", "function RegistrationTrackSectionFrame")
  const frameRender = sourceBetween(detail, "function renderTrackFrames", "const activeLevelTestPlan")
  const detailRender = detail.slice(detail.indexOf("export function RegistrationApplication"))

  assert.doesNotMatch(frame, /RegistrationTrackSectionValues/)
  assert.doesNotMatch(frame, /sectionState\.lockReason/)
  assert.match(frameGate, /section === "admission"[\s\S]*?return false/)
  assert.match(frameGate, /section === "inquiry"[\s\S]*?migrationReviewRequired/)
  assert.doesNotMatch(frameGate, /REGISTRATION_DIRECTOR_VISIBLE_STATUSES/)
  assert.match(frameGate, /if \(section === "inquiry"\) return track\.migrationReviewRequired/)
  assert.match(frameGate, /return section === "consultation"/)
  assert.match(frameGate, /placementMode === "waiting"/)
  assert.match(frameGate, /placementMode === "registration"/)
  assert.match(focusPanel, /currentSection === "admission"[\s\S]*?return null/)
  assert.match(focusPanel, /currentSection === "level_test"[\s\S]*?return null/)
  assert.match(focusPanel, /migrationReviewRequired[\s\S]*?reviewTrackId[\s\S]*?registration-inquiry-/)
  assert.match(focusPanel, /track\.status === "waiting" \? "waiting" : "registration"/)
  assert.match(detailRender, /getRegistrationTrackFocusPanelId\(focusedContext, reviewTrack\?\.id \|\| null\)/)
  assert.match(detailRender, /if \(!focusPanelId\) return/)
  assert.match(frameRender, /filter\(\(context\) => hasRegistrationTrackFrameContent/)
  assert.match(detailRender, /migrationReviewPanelId[\s\S]*?context\.track\.migrationReviewRequired[\s\S]*?\[migrationReviewPanelId\]/)
  assert.match(frameRender, /reviewTrack\?\.id === context\.track\.id[\s\S]*?activeTrack\?\.migrationReviewRequired/)
  assert.doesNotMatch(detailRender, /renderTrackFrames\("admission"\)/)
})

test("saved-detail descendants use shared dashboard controls instead of native controls", async () => {
  const fileNames = [
    "registration-application-inquiry-section.tsx",
    "registration-application-inquiry-fields.tsx",
    "registration-application-track-actions.tsx",
    "registration-appointment-editor.tsx",
    "registration-enrollment-editor.tsx",
    "registration-application-shell.tsx",
    "registration-history-timeline.tsx",
  ]
  const sources = await Promise.all(fileNames.map((file) => (
    readFile(new URL(`../src/features/tasks/${file}`, import.meta.url), "utf8")
  )))
  const sourceByFile = Object.fromEntries(fileNames.map((file, index) => [file, sources[index]]))
  const registrationSelect = await readFile(new URL("../src/features/tasks/registration-select.tsx", import.meta.url), "utf8").catch(() => "")
  const combined = sources.join("\n")

  for (const source of sources) assert.doesNotMatch(source, /<select\b/i)
  assert.doesNotMatch(combined, /window\.confirm\s*\(/)
  assert.doesNotMatch(combined, /<details\b|<summary\b/i)
  assert.doesNotMatch(combined, /<div[^>]*role="alert"[^>]*className="[^"]*amber/i)

  assert.match(registrationSelect, /from "@\/components\/ui\/select"/)
  assert.match(registrationSelect, /EMPTY_VALUE_SENTINEL/)
  assert.match(registrationSelect, /<SelectItem[\s\S]*?disabled=\{option\.disabled\}/)
  assert.match(registrationSelect, /option\.value === ""[\s\S]*?EMPTY_VALUE_SENTINEL/)
  for (const file of [
    "registration-application-inquiry-fields.tsx",
    "registration-application-track-actions.tsx",
    "registration-enrollment-editor.tsx",
  ]) {
    assert.match(sourceByFile[file], /import \{ RegistrationSelect \} from "\.\/registration-select"/)
  }
  assert.match(sourceByFile["registration-application-track-actions.tsx"], /from "@\/components\/ui\/dialog"/)
  assert.doesNotMatch(sourceByFile["registration-appointment-editor.tsx"], /from "@\/components\/ui\/dialog"/)
  for (const file of ["registration-enrollment-editor.tsx", "registration-history-timeline.tsx"]) {
    assert.match(sourceByFile[file], /from "@\/components\/ui\/collapsible"/)
  }
  assert.doesNotMatch(sourceByFile["registration-application-shell.tsx"], /Collapsible/)
  assert.match(sourceByFile["registration-application-shell.tsx"], /<section/)
  for (const file of [
    "registration-application-inquiry-section.tsx",
    "registration-application-track-actions.tsx",
    "registration-appointment-editor.tsx",
    "registration-enrollment-editor.tsx",
  ]) {
    assert.match(sourceByFile[file], /from "@\/components\/ui\/alert"/)
  }
})
