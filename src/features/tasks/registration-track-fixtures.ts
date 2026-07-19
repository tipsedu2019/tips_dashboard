import type {
  OpsClassOption,
  OpsProfileOption,
  OpsRegistrationClassDetail,
  OpsTask,
  OpsTaskWorkspaceData,
  OpsTeacherOption,
  OpsTextbookOption,
} from "./ops-task-service"
import type {
  RegistrationAppointmentCalendarLoadInput,
  RegistrationAppointmentCalendarRow,
  RegistrationAppointmentCalendarStatus,
} from "./registration-appointment-calendar-model"
import type {
  OpsRegistrationAdmissionBatch,
  OpsRegistrationAppointment,
  OpsRegistrationCaseDetail,
  OpsRegistrationConsultation,
  OpsRegistrationEnrollment,
  OpsRegistrationLevelTest,
  OpsRegistrationTrackEvent,
  OpsRegistrationTrackStatus,
  OpsRegistrationTrackSummary,
  RegistrationCaseCreateWithInitialWorkflowInput,
  RegistrationCaseCreateWithInitialWorkflowResponse,
  RegistrationPhoneReadySource,
  RegistrationSubject,
} from "./registration-track-service"
import type {
  RegistrationSubjectTrackFixtureAdapter,
  RegistrationSubjectTrackFixtureDebugActionBehavior,
  RegistrationSubjectTrackFixtureDebugCounts,
  RegistrationSubjectTrackFixtureDebugFault,
  RegistrationSubjectTrackFixtureDebugSnapshot,
} from "./registration-track-fixture-runtime"

const FIXTURE_NOW = "2026-07-13T09:00:00+09:00"
const FIXTURE_ACTOR_ID = "fixture-profile-staff"
const REGISTRATION_SUBJECT_ORDER: RegistrationSubject[] = ["영어", "수학"]
const REGISTRATION_INITIAL_ACTIONS = ["inquiry", "level_test", "direct_phone", "visit"] as const
type RegistrationInitialAction = typeof REGISTRATION_INITIAL_ACTIONS[number]

export const REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS = [
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
  "reopenRegistrationTrack",
  "sendRegistrationVisitNotificationTarget",
  "sendRegistrationAdmissionMessage",
  "checkRegistrationAdmissionMessage",
  "reconcileRegistrationAdmissionMessage",
  "releaseRegistrationAdmissionMessageRetry",
] as const

export type RegistrationSubjectTrackFixtureAction = typeof REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS[number]
export const REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_DELAY_MAX_MS = 5_000
export const REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_ERROR_VALUE = "forced_failure"
export const REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_ERROR_MESSAGE = "registration_fixture_forced_failure"

export function parseRegistrationSubjectTrackFixtureQueryActionBehavior(input: {
  enabled: boolean
  type: string | null | undefined
  delayMs: string | null | undefined
  error: string | null | undefined
}): Required<RegistrationSubjectTrackFixtureDebugActionBehavior> | null {
  if (!input.enabled) return null
  const type = String(input.type || "")
  if (!REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS.includes(type as RegistrationSubjectTrackFixtureAction)) return null

  const rawDelayMs = String(input.delayMs || "")
  if (rawDelayMs && !/^\d+$/.test(rawDelayMs)) return null
  const delayMs = rawDelayMs
    ? Math.min(REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_DELAY_MAX_MS, Number(rawDelayMs))
    : 0
  const rawError = String(input.error || "")
  if (rawError && rawError !== REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_ERROR_VALUE) return null
  const error = rawError ? REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_ERROR_MESSAGE : ""
  if (delayMs <= 0 && !error) return null
  return { type, delayMs, error }
}

export function parseRegistrationSubjectTrackFixtureQueryFault(input: {
  enabled: boolean
  type: string | null | undefined
  taskId?: string | null | undefined
  canonicalRequestNote?: string | null | undefined
  error?: string | null | undefined
}): RegistrationSubjectTrackFixtureDebugFault | null {
  if (!input.enabled) return null
  const kind = String(input.type || "").trim()
  if (kind === "option_data_once") {
    const error = String(input.error || "").trim().slice(0, 160)
    return error ? { kind, error } : null
  }
  if (kind === "common_revision_conflict_once") {
    const taskId = String(input.taskId || "").trim().slice(0, 160)
    const canonicalRequestNote = String(input.canonicalRequestNote || "").trim().slice(0, 2_000)
    return taskId && canonicalRequestNote
      ? { kind, taskId, canonicalRequestNote }
      : null
  }
  return null
}

export type RegistrationSubjectTrackFixtureViewerKey = "english_admin" | "math_admin" | "staff" | "assistant"

export type RegistrationSubjectTrackFixtureViewer = {
  key: RegistrationSubjectTrackFixtureViewerKey
  viewerId: string
  viewerRole: "admin" | "staff" | "assistant"
}

export type RegistrationSubjectTrackFixtureReceipt = {
  action: RegistrationSubjectTrackFixtureAction
  requestKey: string
  payloadFingerprint: string
  result: unknown
}

export type RegistrationSubjectTrackFixtureNotificationTargetSnapshot = {
  appointmentId: string
  sourceRevision: number
  targetGeneration: string
  targetProfileIds: string[]
  targetSetHash: string
}

export type RegistrationSubjectTrackFixtureNotificationJob = {
  jobKind: "target_reconciliation"
  jobId: string
  appointmentId: string
  sourceRevision: number
  targetGeneration: string
  targetSetHash: string
  status: "succeeded"
  outcome: "applied" | "superseded"
  createdOrder: number
  resolvedOrder: number
}

export type RegistrationSubjectTrackFixtureState = {
  workspaceData: OpsTaskWorkspaceData
  optionData: {
    profiles: OpsProfileOption[]
    students: []
    classes: OpsClassOption[]
    textbooks: OpsTextbookOption[]
    teachers: OpsTeacherOption[]
    schemaReady: true
    error: null
    directorCatalogStatus: "authoritative"
  }
  caseDetails: Record<string, OpsRegistrationCaseDetail>
  classDetails: Record<string, OpsRegistrationClassDetail>
  viewers: Record<RegistrationSubjectTrackFixtureViewerKey, RegistrationSubjectTrackFixtureViewer>
  samples: Array<{ name: string; taskId: string }>
  receipts: Record<string, RegistrationSubjectTrackFixtureReceipt>
  notificationTargetHistory: RegistrationSubjectTrackFixtureNotificationTargetSnapshot[]
  notificationJobs: RegistrationSubjectTrackFixtureNotificationJob[]
  externalCallLedger: never[]
  sequence: number
}

export type RegistrationSubjectTrackFixtureCommand = {
  type: RegistrationSubjectTrackFixtureAction | string
  requestKey?: string
  payload?: Record<string, unknown>
}

export type RegistrationSubjectTrackFixtureOutcome = {
  state: RegistrationSubjectTrackFixtureState
  result: unknown
  receipt: RegistrationSubjectTrackFixtureReceipt
}

export type RegistrationSubjectTrackFixtureRuntime = {
  getState: () => RegistrationSubjectTrackFixtureState
  replaceState: (state: RegistrationSubjectTrackFixtureState) => void
}

export function createRegistrationSubjectTrackFixtureAdapter(
  runtime: RegistrationSubjectTrackFixtureRuntime,
): RegistrationSubjectTrackFixtureAdapter {
  let lastCreate: RegistrationSubjectTrackFixtureDebugSnapshot["lastCreate"] = null
  let nextActionBehavior: Required<RegistrationSubjectTrackFixtureDebugActionBehavior> | null = null
  let nextFault: RegistrationSubjectTrackFixtureDebugFault | null = null

  function debugCounts(state: RegistrationSubjectTrackFixtureState): RegistrationSubjectTrackFixtureDebugCounts {
    const details = Object.values(state.caseDetails)
    return {
      tasks: state.workspaceData.tasks.length,
      cases: details.length,
      tracks: details.reduce((total, detail) => total + detail.tracks.length, 0),
      appointments: details.reduce((total, detail) => total + detail.appointments.length, 0),
      consultations: details.reduce((total, detail) => total + detail.consultations.length, 0),
      levelTests: details.reduce((total, detail) => total + detail.levelTests.length, 0),
      receipts: Object.keys(state.receipts).length,
      notificationReceipts: Object.values(state.receipts).filter((receipt) => (
        receipt.action === "sendRegistrationVisitNotificationTarget"
      )).length,
      externalCalls: state.externalCallLedger.length,
    }
  }

  function debugSnapshot(): RegistrationSubjectTrackFixtureDebugSnapshot & {
    notificationTargetHistory: RegistrationSubjectTrackFixtureNotificationTargetSnapshot[]
    notificationJobs: RegistrationSubjectTrackFixtureNotificationJob[]
  } {
    const state = runtime.getState()
    if (!lastCreate) {
      return {
        counts: debugCounts(state),
        lastCreate: null,
        notificationTargetHistory: clone(state.notificationTargetHistory),
        notificationJobs: clone(state.notificationJobs),
      }
    }
    const taskId = String((lastCreate.result as { taskId?: unknown } | null)?.taskId || "")
    return {
      counts: debugCounts(state),
      notificationTargetHistory: clone(state.notificationTargetHistory),
      notificationJobs: clone(state.notificationJobs),
      lastCreate: {
        command: clone(lastCreate.command),
        result: clone(lastCreate.result),
        receipt: clone(state.receipts[lastCreate.command.requestKey] || lastCreate.receipt),
        detail: taskId && state.caseDetails[taskId] ? clone(state.caseDetails[taskId]) : null,
      },
    }
  }

  return {
    intakeWorkflowRuntimeVersion: 1,
    executeAction: <T = unknown>(type: string, payload: Record<string, unknown>) => {
      const behavior = nextActionBehavior?.type === type ? nextActionBehavior : null
      if (behavior) nextActionBehavior = null
      const consumeCommonRevisionConflictFault = () => {
        if (
          nextFault?.kind === "common_revision_conflict_once"
          && type === "updateRegistrationCaseCommon"
          && String(payload.taskId || "") === nextFault.taskId
        ) {
          const fault = nextFault
          nextFault = null
          const faultState = clone(runtime.getState())
          const detail = requireCase(faultState.caseDetails[fault.taskId], "case_not_found")
          detail.task.registration = {
            ...detail.task.registration,
            requestNote: fault.canonicalRequestNote,
          }
          detail.commonRevision += 1
          syncCase(faultState, detail)
          runtime.replaceState(faultState)
          return new Error("registration_common_revision_conflict")
        }
        return null
      }
      const executeNow = () => {
        const outcome = reduceRegistrationSubjectTrackFixture(runtime.getState(), {
          type,
          requestKey: String(payload.requestKey || ""),
          payload,
        })
        runtime.replaceState(outcome.state)
        if (type === "createRegistrationCaseWithInitialWorkflow") {
          lastCreate = {
            command: {
              type,
              requestKey: String(payload.requestKey || ""),
              payload: clone(payload),
            },
            result: clone(outcome.result),
            receipt: clone(outcome.receipt),
            detail: null,
          }
        }
        return outcome.result as T
      }
      if (behavior?.delayMs) {
        return new Promise<T>((resolve, reject) => {
          setTimeout(() => {
            if (behavior.error) {
              reject(new Error(behavior.error))
              return
            }
            const faultError = consumeCommonRevisionConflictFault()
            if (faultError) {
              reject(faultError)
              return
            }
            try {
              resolve(executeNow())
            } catch (error) {
              reject(error)
            }
          }, behavior.delayMs)
        })
      }
      if (behavior?.error) return Promise.reject(new Error(behavior.error))
      const faultError = consumeCommonRevisionConflictFault()
      if (faultError) return Promise.reject(faultError)
      return Promise.resolve(executeNow())
    },
    loadAppointmentCalendarRows: (input) => Promise.resolve(
      getRegistrationSubjectTrackFixtureAppointmentCalendarRows(runtime.getState(), input),
    ),
    loadCase: (taskId) => {
      const detail = getRegistrationSubjectTrackFixtureCase(runtime.getState(), taskId)
      if (!detail) return Promise.reject(new Error("registration_subject_track_fixture_case_not_found"))
      return Promise.resolve(detail)
    },
    loadWorkspaceData: () => Promise.resolve(clone(runtime.getState().workspaceData)),
    loadOptionData: () => {
      if (nextFault?.kind === "option_data_once") {
        const fault = nextFault
        nextFault = null
        return Promise.reject(new Error(fault.error))
      }
      return Promise.resolve(clone(runtime.getState().optionData))
    },
    loadClassDetails: (classIds) => Promise.resolve(getRegistrationSubjectTrackFixtureClassDetails(runtime.getState(), classIds)),
    debugSnapshot,
    debugSetNextActionBehavior: (behavior) => {
      const type = String(behavior?.type || "").trim()
      const delayMs = Math.min(30_000, Math.max(0, Math.trunc(Number(behavior?.delayMs) || 0)))
      const error = String(behavior?.error || "").trim().slice(0, 160)
      if (!REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS.includes(type as RegistrationSubjectTrackFixtureAction)) {
        throw new Error("registration_subject_track_fixture_debug_action_invalid")
      }
      nextActionBehavior = { type, delayMs, error }
    },
    debugSetNextFault: (fault) => {
      if (fault?.kind === "option_data_once") {
        const error = String(fault.error || "").trim().slice(0, 160)
        if (!error) throw new Error("registration_subject_track_fixture_debug_fault_invalid")
        nextFault = { kind: fault.kind, error }
        return
      }
      if (fault?.kind === "common_revision_conflict_once") {
        const taskId = String(fault.taskId || "").trim().slice(0, 160)
        const canonicalRequestNote = String(fault.canonicalRequestNote || "").trim().slice(0, 2_000)
        if (!taskId || !canonicalRequestNote) {
          throw new Error("registration_subject_track_fixture_debug_fault_invalid")
        }
        nextFault = { kind: fault.kind, taskId, canonicalRequestNote }
        return
      }
      throw new Error("registration_subject_track_fixture_debug_fault_invalid")
    },
    debugReplayLastCreate: () => {
      if (!lastCreate) return Promise.reject(new Error("registration_subject_track_fixture_debug_create_missing"))
      const command = clone(lastCreate.command)
      const originalResult = clone(lastCreate.result)
      const originalReceipt = clone(lastCreate.receipt)
      const beforeCounts = debugCounts(runtime.getState())
      const replay = reduceRegistrationSubjectTrackFixture(runtime.getState(), {
        type: command.type,
        requestKey: command.requestKey,
        payload: command.payload,
      })
      runtime.replaceState(replay.state)
      return Promise.resolve({
        requestKey: command.requestKey,
        originalResult,
        replayResult: clone(replay.result),
        originalReceipt,
        replayReceipt: clone(replay.receipt),
        beforeCounts,
        afterCounts: debugCounts(runtime.getState()),
      })
    },
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function fixtureNotificationTargetSetHash(profileIds: string[]) {
  const canonical = Array.from(new Set(profileIds)).sort().join("|")
  return Array.from({ length: 8 }, (_, salt) => {
    let hash = (2166136261 ^ salt) >>> 0
    for (let index = 0; index < canonical.length; index += 1) {
      hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619) >>> 0
    }
    return hash.toString(16).padStart(8, "0")
  }).join("")
}

function createFixtureNotificationTargetScenario() {
  const appointmentId = "fixture-appointment-split-visit"
  const sourceRevision = 1
  const targetA = ["fixture-profile-english-director"]
  const targetB = ["fixture-profile-math-director"]
  const targetAHash = fixtureNotificationTargetSetHash(targetA)
  const targetBHash = fixtureNotificationTargetSetHash(targetB)
  const notificationTargetHistory: RegistrationSubjectTrackFixtureNotificationTargetSnapshot[] = [
    { appointmentId, sourceRevision, targetGeneration: "1", targetProfileIds: targetA, targetSetHash: targetAHash },
    { appointmentId, sourceRevision, targetGeneration: "2", targetProfileIds: targetB, targetSetHash: targetBHash },
    { appointmentId, sourceRevision, targetGeneration: "3", targetProfileIds: targetA, targetSetHash: targetAHash },
  ]
  const notificationJobs: RegistrationSubjectTrackFixtureNotificationJob[] = [
    {
      jobKind: "target_reconciliation",
      jobId: "fixture-target-reconciliation-generation-2",
      appointmentId,
      sourceRevision,
      targetGeneration: "2",
      targetSetHash: targetBHash,
      status: "succeeded",
      outcome: "superseded",
      createdOrder: 2,
      resolvedOrder: 5,
    },
    {
      jobKind: "target_reconciliation",
      jobId: "fixture-target-reconciliation-generation-3",
      appointmentId,
      sourceRevision,
      targetGeneration: "3",
      targetSetHash: targetAHash,
      status: "succeeded",
      outcome: "applied",
      createdOrder: 3,
      resolvedOrder: 4,
    },
  ]
  return { notificationTargetHistory, notificationJobs }
}

function taskTemplate(input: {
  id: string
  studentName: string
  subject: string
  tracks: OpsRegistrationTrackSummary[]
}): OpsTask {
  return {
    id: input.id,
    title: `등록: ${input.studentName}`,
    type: "registration",
    status: "in_progress",
    priority: "normal",
    requestedBy: "fixture-profile-staff",
    requestedByLabel: "운영팀",
    requestedTeam: "management",
    assigneeId: "fixture-profile-staff",
    assigneeLabel: "운영팀",
    assigneeTeam: "management",
    secondaryAssigneeId: "",
    secondaryAssigneeLabel: "",
    studentId: `fixture-student-${input.id}`,
    studentName: input.studentName,
    classId: "",
    className: "",
    textbookId: "",
    textbookTitle: "",
    campus: "본관",
    subject: input.subject,
    startAt: "",
    dueAt: "",
    completedAt: "",
    memo: "",
    createdAt: "2026-07-12T09:00:00+09:00",
    updatedAt: FIXTURE_NOW,
    registration: {
      pipelineStatus: "과목별 진행",
      inquiryAt: "2026-07-12T09:00:00+09:00",
      schoolGrade: "고1",
      schoolName: "중앙고",
      parentPhone: "01012345678",
      studentPhone: "01098765432",
      counselor: "",
      requestNote: "브라우저 QA 전용 고정 fixture",
      admissionNoticeSent: false,
    },
    registrationTracks: input.tracks,
    comments: [],
    attachments: [],
    events: [],
  }
}

function track(input: {
  id: string
  taskId: string
  subject: RegistrationSubject
  status: OpsRegistrationTrackStatus
  directorProfileId?: string | null
  directorName?: string
  migrationReviewRequired?: boolean
  stageEnteredAt?: string
  phoneReadyAt?: string | null
  phoneReadySource?: RegistrationPhoneReadySource | null
}): OpsRegistrationTrackSummary {
  return {
    id: input.id,
    taskId: input.taskId,
    subject: input.subject,
    status: input.status,
    legacy: false,
    directorProfileId: input.directorProfileId === undefined
      ? (input.subject === "영어" ? "fixture-profile-english-director" : "fixture-profile-math-director")
      : input.directorProfileId,
    directorName: input.directorName ?? (input.subject === "영어" ? "강부희" : "양소윤"),
    directorAssignmentSource: input.migrationReviewRequired ? "migration" : "default",
    directorAssignmentRuleKey: input.migrationReviewRequired ? "" : `academic-director-v1:2026:${input.subject}:고1`,
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: Boolean(input.migrationReviewRequired),
    stageEnteredAt: input.stageEnteredAt || "2026-07-12T10:00:00+09:00",
    phoneReadyAt: input.phoneReadyAt ?? null,
    phoneReadySource: input.phoneReadySource ?? null,
  }
}

function enrollment(input: Partial<OpsRegistrationEnrollment> & Pick<OpsRegistrationEnrollment, "id" | "trackId" | "classId">): OpsRegistrationEnrollment {
  return {
    id: input.id,
    trackId: input.trackId,
    studentId: input.studentId ?? null,
    admissionBatchId: input.admissionBatchId ?? null,
    classId: input.classId,
    textbookId: input.textbookId ?? null,
    classStartDate: input.classStartDate ?? "2026-07-20",
    classStartSessionKey: input.classStartSessionKey ?? "2026-07-20:1",
    classStartSession: input.classStartSession ?? "1회차",
    status: input.status || "planned",
    makeeduRegistered: Boolean(input.makeeduRegistered),
    rosterActive: Boolean(input.rosterActive),
    rosterReleasedAt: input.rosterReleasedAt ?? null,
    rosterReleaseReason: input.rosterReleaseReason ?? null,
    rosterReleaseSourceTaskId: input.rosterReleaseSourceTaskId ?? null,
    rosterReleaseKind: input.rosterReleaseKind ?? null,
    sortOrder: input.sortOrder || 0,
    createdAt: input.createdAt || FIXTURE_NOW,
    updatedAt: input.updatedAt || FIXTURE_NOW,
  }
}

function batch(input: Partial<OpsRegistrationAdmissionBatch> & Pick<OpsRegistrationAdmissionBatch, "id" | "taskId" | "revisionNumber" | "status">): OpsRegistrationAdmissionBatch {
  return {
    id: input.id,
    taskId: input.taskId,
    revisionNumber: input.revisionNumber,
    status: input.status,
    invoiceSentAt: input.invoiceSentAt ?? null,
    paymentConfirmedAt: input.paymentConfirmedAt ?? null,
    createdAt: input.createdAt || FIXTURE_NOW,
    updatedAt: input.updatedAt || FIXTURE_NOW,
  }
}

function caseDetail(input: {
  task: OpsTask
  tracks: OpsRegistrationTrackSummary[]
  appointments?: OpsRegistrationAppointment[]
  levelTests?: OpsRegistrationLevelTest[]
  consultations?: OpsRegistrationConsultation[]
  admissionBatches?: OpsRegistrationAdmissionBatch[]
  enrollments?: OpsRegistrationEnrollment[]
  migrationLegacy?: OpsRegistrationCaseDetail["migrationLegacy"]
}): OpsRegistrationCaseDetail {
  return {
    task: input.task,
    commonRevision: 1,
    admissionApplicationMessageId: null,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
    admissionApplicationMessageUpdatedAt: null,
    admissionApplicationAccepted: false,
    comments: [],
    attachments: [],
    tracks: input.tracks,
    appointments: input.appointments || [],
    levelTests: input.levelTests || [],
    consultations: input.consultations || [],
    admissionBatches: input.admissionBatches || [],
    enrollments: input.enrollments || [],
    events: [],
    migrationLegacy: input.migrationLegacy || null,
  }
}

function classOption(input: {
  id: string
  label: string
  subject: RegistrationSubject
  textbookIds: string[]
  startDate: string
}): OpsRegistrationClassDetail {
  return {
    id: input.id,
    label: input.label,
    meta: `${input.subject} · 고1`,
    subject: input.subject,
    grade: "고1",
    teacher: input.subject === "영어" ? "강부희" : "양소윤",
    room: input.subject === "영어" ? "201" : "301",
    schedule: "주 2회",
    schedulePlan: {
      sessions: [
        { date: input.startDate, sessionNumber: 1, scheduleState: "active" },
        { date: "2026-07-21", sessionNumber: 2, scheduleState: "active" },
        { date: "2026-07-24", sessionNumber: 3, scheduleState: "active" },
      ],
    },
    studentIds: [],
    waitlistIds: [],
    textbookIds: input.textbookIds,
  }
}

function buildFixtureCases() {
  const dualTaskId = "fixture-task-dual-test"
  const dualTracks = [
    track({ id: "fixture-track-dual-english", taskId: dualTaskId, subject: "영어", status: "level_test_scheduled" }),
    track({ id: "fixture-track-dual-math", taskId: dualTaskId, subject: "수학", status: "level_test_scheduled" }),
  ]
  const dualTask = taskTemplate({ id: dualTaskId, studentName: "김다미", subject: "영어, 수학", tracks: dualTracks })
  const dualAppointment: OpsRegistrationAppointment = {
    id: "fixture-appointment-dual-test",
    taskId: dualTaskId,
    kind: "level_test",
    scheduledAt: "2026-07-15T10:00:00+09:00",
    place: "본관 201호",
    status: "scheduled",
    notificationRevision: 1,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  }
  const dualAttempts: OpsRegistrationLevelTest[] = dualTracks.map((item) => ({
    id: item.subject === "영어" ? "fixture-attempt-dual-english" : "fixture-attempt-dual-math",
    trackId: item.id,
    appointmentId: dualAppointment.id,
    attemptNumber: 1,
    status: "scheduled",
    startedAt: null,
    completedAt: null,
    materialLink: null,
  }))

  const calendarNeighborTaskId = "fixture-task-calendar-neighbor"
  const calendarNeighborTracks = [
    track({
      id: "fixture-track-calendar-neighbor-english",
      taskId: calendarNeighborTaskId,
      subject: "영어",
      status: "level_test_scheduled",
    }),
  ]
  const calendarNeighborTask = taskTemplate({
    id: calendarNeighborTaskId,
    studentName: "오하늘",
    subject: "영어",
    tracks: calendarNeighborTracks,
  })
  const calendarNeighborAppointment: OpsRegistrationAppointment = {
    id: "fixture-appointment-calendar-neighbor",
    taskId: calendarNeighborTaskId,
    kind: "level_test",
    scheduledAt: "2026-07-15T11:00:00+09:00",
    place: "본관 202호",
    status: "scheduled",
    notificationRevision: 1,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  }
  const calendarNeighborAttempt: OpsRegistrationLevelTest = {
    id: "fixture-attempt-calendar-neighbor-english",
    trackId: calendarNeighborTracks[0].id,
    appointmentId: calendarNeighborAppointment.id,
    attemptNumber: 1,
    status: "scheduled",
    startedAt: null,
    completedAt: null,
    materialLink: null,
  }

  const splitTaskId = "fixture-task-split-consultation"
  const splitTracks = [
    track({ id: "fixture-track-split-english", taskId: splitTaskId, subject: "영어", status: "visit_consultation_scheduled" }),
    track({ id: "fixture-track-split-math", taskId: splitTaskId, subject: "수학", status: "consultation_waiting", stageEnteredAt: "2026-07-10T09:00:00+09:00" }),
  ]
  const splitTask = taskTemplate({ id: splitTaskId, studentName: "박서준", subject: "영어, 수학", tracks: splitTracks })
  const visitAppointment: OpsRegistrationAppointment = {
    id: "fixture-appointment-split-visit",
    taskId: splitTaskId,
    kind: "visit_consultation",
    scheduledAt: "2026-07-16T14:00:00+09:00",
    place: "본관 상담실",
    status: "scheduled",
    notificationRevision: 1,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  }
  const splitConsultations: OpsRegistrationConsultation[] = [
    {
      id: "fixture-consultation-split-english",
      trackId: splitTracks[0].id,
      appointmentId: visitAppointment.id,
      mode: "visit",
      status: "scheduled",
      directorProfileId: "fixture-profile-english-director",
      readyAt: null,
      readySource: null,
      completedAt: null,
      outcome: null,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
    {
      id: "fixture-consultation-split-math",
      trackId: splitTracks[1].id,
      appointmentId: null,
      mode: "phone",
      status: "waiting",
      directorProfileId: "fixture-profile-math-director",
      readyAt: "2026-07-10T09:00:00+09:00",
      readySource: "inquiry",
      completedAt: null,
      outcome: null,
      createdAt: "2026-07-10T09:00:00+09:00",
      updatedAt: "2026-07-10T09:00:00+09:00",
    },
  ]

  const crossStageTaskId = "fixture-task-cross-stage"
  const crossStageTracks = [
    track({ id: "fixture-track-cross-english", taskId: crossStageTaskId, subject: "영어", status: "consultation_waiting", stageEnteredAt: "2026-07-09T09:00:00+09:00" }),
    track({ id: "fixture-track-cross-math", taskId: crossStageTaskId, subject: "수학", status: "level_test_scheduled" }),
  ]
  const crossStageTask = taskTemplate({ id: crossStageTaskId, studentName: "김예린", subject: "영어, 수학", tracks: crossStageTracks })
  const crossStageAppointment: OpsRegistrationAppointment = {
    id: "fixture-appointment-cross-math-test",
    taskId: crossStageTaskId,
    kind: "level_test",
    scheduledAt: "2026-07-19T10:00:00+09:00",
    place: "본관 301호",
    status: "scheduled",
    notificationRevision: 1,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  }
  const crossStageAttempt: OpsRegistrationLevelTest = {
    id: "fixture-attempt-cross-math",
    trackId: crossStageTracks[1].id,
    appointmentId: crossStageAppointment.id,
    attemptNumber: 1,
    status: "scheduled",
    startedAt: null,
    completedAt: null,
    materialLink: null,
  }
  const crossStageConsultation: OpsRegistrationConsultation = {
    id: "fixture-consultation-cross-english",
    trackId: crossStageTracks[0].id,
    appointmentId: null,
    mode: "phone",
    status: "waiting",
    directorProfileId: "fixture-profile-english-director",
    readyAt: "2026-07-09T09:00:00+09:00",
    readySource: "inquiry",
    completedAt: null,
    outcome: null,
    createdAt: "2026-07-09T09:00:00+09:00",
    updatedAt: "2026-07-09T09:00:00+09:00",
  }

  const partialTaskId = "fixture-task-partial-registration"
  const partialTracks = [
    track({ id: "fixture-track-partial-english", taskId: partialTaskId, subject: "영어", status: "registered" }),
    track({ id: "fixture-track-partial-math", taskId: partialTaskId, subject: "수학", status: "enrollment_processing" }),
  ]
  const partialTask = taskTemplate({ id: partialTaskId, studentName: "이도윤", subject: "영어, 수학", tracks: partialTracks })
  partialTask.registration = { ...partialTask.registration, admissionNoticeSent: true }
  const completedAdmission = batch({ id: "fixture-batch-partial-1", taskId: partialTaskId, revisionNumber: 1, status: "completed", invoiceSentAt: FIXTURE_NOW, paymentConfirmedAt: FIXTURE_NOW })
  const openAdmission = batch({ id: "fixture-batch-partial-2", taskId: partialTaskId, revisionNumber: 2, status: "draft" })
  const partialEnrollments = [
    enrollment({ id: "fixture-enrollment-partial-english", trackId: partialTracks[0].id, classId: "fixture-class-eng-a", textbookId: "fixture-textbook-eng-a", admissionBatchId: completedAdmission.id, studentId: "fixture-student-partial", status: "enrolled", makeeduRegistered: true, rosterActive: true }),
    enrollment({ id: "fixture-enrollment-partial-math", trackId: partialTracks[1].id, classId: "fixture-class-math-a", textbookId: "fixture-textbook-math-a", admissionBatchId: openAdmission.id, status: "planned" }),
  ]

  const allTerminalTaskId = "fixture-task-all-terminal"
  const allTerminalTracks = [
    track({ id: "fixture-track-all-terminal-english", taskId: allTerminalTaskId, subject: "영어", status: "registered" }),
    track({ id: "fixture-track-all-terminal-math", taskId: allTerminalTaskId, subject: "수학", status: "not_registered" }),
  ]
  const allTerminalTask = taskTemplate({
    id: allTerminalTaskId,
    studentName: "서지안",
    subject: "영어, 수학",
    tracks: allTerminalTracks,
  })
  allTerminalTask.status = "done"
  allTerminalTask.completedAt = FIXTURE_NOW

  const multipleTaskId = "fixture-task-multiple-classes"
  const multipleTracks = [track({ id: "fixture-track-multiple-english", taskId: multipleTaskId, subject: "영어", status: "enrollment_decided" })]
  const multipleTask = taskTemplate({ id: multipleTaskId, studentName: "최유진", subject: "영어", tracks: multipleTracks })
  const multipleEnrollments = [
    enrollment({ id: "fixture-enrollment-multiple-a", trackId: multipleTracks[0].id, classId: "fixture-class-eng-a", textbookId: "fixture-textbook-eng-a", admissionBatchId: null, status: "planned", sortOrder: 0 }),
    enrollment({ id: "fixture-enrollment-multiple-special", trackId: multipleTracks[0].id, classId: "fixture-class-eng-special", textbookId: null, admissionBatchId: null, classStartDate: "2026-07-21", classStartSessionKey: "2026-07-21:1", classStartSession: "1회차", status: "planned", sortOrder: 1 }),
  ]

  const decidedTaskId = "fixture-task-enrollment-decided"
  const decidedTracks = [track({ id: "fixture-track-enrollment-decided-english", taskId: decidedTaskId, subject: "영어", status: "enrollment_decided" })]
  const decidedTask = taskTemplate({ id: decidedTaskId, studentName: "정하린", subject: "영어", tracks: decidedTracks })

  const siblingTaskId = "fixture-task-admission-sibling"
  const siblingTracks = [
    track({ id: "fixture-track-admission-sibling-english", taskId: siblingTaskId, subject: "영어", status: "level_test_scheduled" }),
    track({ id: "fixture-track-admission-sibling-math", taskId: siblingTaskId, subject: "수학", status: "enrollment_processing" }),
  ]
  const siblingTask = taskTemplate({ id: siblingTaskId, studentName: "한시우", subject: "영어, 수학", tracks: siblingTracks })
  siblingTask.registration = { ...siblingTask.registration, admissionNoticeSent: true }
  const siblingAppointment: OpsRegistrationAppointment = {
    id: "fixture-appointment-admission-sibling",
    taskId: siblingTaskId,
    kind: "level_test",
    scheduledAt: "2026-07-18T11:00:00+09:00",
    place: "본관 201호",
    status: "scheduled",
    notificationRevision: 1,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  }
  const siblingAttempt: OpsRegistrationLevelTest = {
    id: "fixture-attempt-admission-sibling-english",
    trackId: siblingTracks[0].id,
    appointmentId: siblingAppointment.id,
    attemptNumber: 1,
    status: "scheduled",
    startedAt: null,
    completedAt: null,
    materialLink: null,
  }
  const siblingBatch = batch({ id: "fixture-batch-admission-sibling", taskId: siblingTaskId, revisionNumber: 1, status: "draft" })
  const siblingEnrollment = enrollment({
    id: "fixture-enrollment-admission-sibling-math",
    trackId: siblingTracks[1].id,
    classId: "fixture-class-math-a",
    textbookId: "fixture-textbook-math-a",
    admissionBatchId: siblingBatch.id,
    status: "planned",
  })

  const reviewTaskId = "fixture-task-migration-review"
  const reviewTracks = [
    track({ id: "fixture-track-review-english", taskId: reviewTaskId, subject: "영어", status: "migration_review", directorProfileId: null, directorName: "", migrationReviewRequired: true }),
    track({ id: "fixture-track-review-math", taskId: reviewTaskId, subject: "수학", status: "migration_review", directorProfileId: null, directorName: "", migrationReviewRequired: true }),
  ]
  const reviewTask = taskTemplate({ id: reviewTaskId, studentName: "윤지호", subject: "영어, 수학", tracks: reviewTracks })
  const migrationLegacy: NonNullable<OpsRegistrationCaseDetail["migrationLegacy"]> = {
    snapshotMissing: false,
    pipelineStatus: "3. 상담 진행",
    studentId: "",
    classId: "",
    textbookId: "",
    currentStudentId: "",
    currentClassId: "",
    currentTextbookId: "",
    levelTestAt: "",
    levelTestCompletedAt: "",
    phoneConsultationAt: "",
    visitConsultationAt: "",
    consultationAt: "",
    classStartDate: "",
    classStartSession: "",
    levelTestPlace: "",
    levelTestMaterialLink: "",
    levelTestResult: "",
    visitConsultationPlace: "",
    admissionNoticeSent: false,
    makeeduRegistered: false,
    makeeduInvoiceSent: false,
    paymentChecked: false,
    groups: { levelTest: false, consultation: true, placement: false },
  }

  return {
    [dualTaskId]: caseDetail({ task: dualTask, tracks: dualTracks, appointments: [dualAppointment], levelTests: dualAttempts }),
    [calendarNeighborTaskId]: caseDetail({
      task: calendarNeighborTask,
      tracks: calendarNeighborTracks,
      appointments: [calendarNeighborAppointment],
      levelTests: [calendarNeighborAttempt],
    }),
    [splitTaskId]: caseDetail({ task: splitTask, tracks: splitTracks, appointments: [visitAppointment], consultations: splitConsultations }),
    [crossStageTaskId]: caseDetail({ task: crossStageTask, tracks: crossStageTracks, appointments: [crossStageAppointment], levelTests: [crossStageAttempt], consultations: [crossStageConsultation] }),
    [partialTaskId]: caseDetail({ task: partialTask, tracks: partialTracks, admissionBatches: [completedAdmission, openAdmission], enrollments: partialEnrollments }),
    [allTerminalTaskId]: caseDetail({ task: allTerminalTask, tracks: allTerminalTracks }),
    [multipleTaskId]: caseDetail({ task: multipleTask, tracks: multipleTracks, enrollments: multipleEnrollments }),
    [decidedTaskId]: caseDetail({ task: decidedTask, tracks: decidedTracks }),
    [siblingTaskId]: caseDetail({ task: siblingTask, tracks: siblingTracks, appointments: [siblingAppointment], levelTests: [siblingAttempt], admissionBatches: [siblingBatch], enrollments: [siblingEnrollment] }),
    [reviewTaskId]: caseDetail({ task: reviewTask, tracks: reviewTracks, migrationLegacy }),
  }
}

export function createRegistrationSubjectTrackFixtureState(): RegistrationSubjectTrackFixtureState {
  const classDetails = {
    "fixture-class-eng-a": classOption({ id: "fixture-class-eng-a", label: "고1 영어 정규 A", subject: "영어", textbookIds: ["fixture-textbook-eng-a"], startDate: "2026-07-20" }),
    "fixture-class-eng-special": classOption({ id: "fixture-class-eng-special", label: "고1 영어 특강", subject: "영어", textbookIds: ["fixture-textbook-eng-special"], startDate: "2026-07-21" }),
    "fixture-class-math-a": classOption({ id: "fixture-class-math-a", label: "고1 수학 정규 A", subject: "수학", textbookIds: ["fixture-textbook-math-a"], startDate: "2026-07-20" }),
  }
  const textbooks: OpsTextbookOption[] = [
    { id: "fixture-textbook-eng-a", label: "고1 영어 기본서", publisher: "TIPS", subject: "영어" },
    { id: "fixture-textbook-eng-special", label: "고1 영어 특강 교재", publisher: "TIPS", subject: "영어" },
    { id: "fixture-textbook-math-a", label: "고1 수학 기본서", publisher: "TIPS", subject: "수학" },
  ]
  const profiles: OpsProfileOption[] = [
    { id: "fixture-profile-english-director", label: "강부희", email: "english-director@fixture.local", loginId: "fixture-english-director", role: "admin" },
    { id: "fixture-profile-math-director", label: "양소윤", email: "math-director@fixture.local", loginId: "fixture-math-director", role: "admin" },
    { id: "fixture-profile-staff", label: "운영팀", email: "staff@fixture.local", loginId: "fixture-staff", role: "staff" },
    { id: "fixture-profile-assistant", label: "조교", email: "assistant@fixture.local", loginId: "fixture-assistant", role: "assistant" },
  ]
  const teachers: OpsTeacherOption[] = [
    { id: "fixture-teacher-english", label: "강부희", subjects: ["영어"], profileId: "fixture-profile-english-director", accountEmail: "english-director@fixture.local", sortOrder: 1 },
    { id: "fixture-teacher-math", label: "양소윤", subjects: ["수학"], profileId: "fixture-profile-math-director", accountEmail: "math-director@fixture.local", sortOrder: 2 },
  ]
  const caseDetails = buildFixtureCases()
  for (const detail of Object.values(caseDetails)) {
    projectFixturePhoneReadiness(detail)
    projectFixtureVisitSchedule(detail)
    detail.task.registrationTracks = detail.tracks
  }
  const workspaceData: OpsTaskWorkspaceData = {
    tasks: Object.values(caseDetails).map((detail) => detail.task),
    profiles,
    students: [],
    classes: Object.values(classDetails),
    textbooks,
    teachers,
    schemaReady: true,
    error: null,
  }
  const notificationTargetScenario = createFixtureNotificationTargetScenario()
  return {
    workspaceData,
    optionData: {
      profiles,
      students: [],
      classes: Object.values(classDetails),
      textbooks,
      teachers,
      schemaReady: true,
      error: null,
      directorCatalogStatus: "authoritative",
    },
    caseDetails,
    classDetails,
    viewers: {
      english_admin: { key: "english_admin", viewerId: "fixture-profile-english-director", viewerRole: "admin" },
      math_admin: { key: "math_admin", viewerId: "fixture-profile-math-director", viewerRole: "admin" },
      staff: { key: "staff", viewerId: "fixture-profile-staff", viewerRole: "staff" },
      assistant: { key: "assistant", viewerId: "fixture-profile-assistant", viewerRole: "assistant" },
    },
    samples: [
      { name: "same-day dual level test", taskId: "fixture-task-dual-test" },
      { name: "same-day single level test neighbor", taskId: "fixture-task-calendar-neighbor" },
      { name: "split visit and phone consultation", taskId: "fixture-task-split-consultation" },
      { name: "independent consultation and level-test stages", taskId: "fixture-task-cross-stage" },
      { name: "partial registration with later batch", taskId: "fixture-task-partial-registration" },
      { name: "all subject tracks terminal", taskId: "fixture-task-all-terminal" },
      { name: "multiple English classes", taskId: "fixture-task-multiple-classes" },
      { name: "enrollment decided add-button", taskId: "fixture-task-enrollment-decided" },
      { name: "admission panel with non-enrollment sibling", taskId: "fixture-task-admission-sibling" },
      { name: "migration review", taskId: "fixture-task-migration-review" },
    ],
    receipts: {},
    notificationTargetHistory: notificationTargetScenario.notificationTargetHistory,
    notificationJobs: notificationTargetScenario.notificationJobs,
    externalCallLedger: [],
    sequence: 0,
  }
}

export function resolveRegistrationSubjectTrackFixtureViewer(
  state: RegistrationSubjectTrackFixtureState,
  key: string | null | undefined,
) {
  return clone(state.viewers[key as RegistrationSubjectTrackFixtureViewerKey] || state.viewers.english_admin)
}

export function getRegistrationSubjectTrackFixtureCase(
  state: RegistrationSubjectTrackFixtureState,
  taskId: string,
) {
  return state.caseDetails[taskId] ? clone(state.caseDetails[taskId]) : null
}

export function getRegistrationSubjectTrackFixtureClassDetails(
  state: RegistrationSubjectTrackFixtureState,
  classIds: string[],
) {
  const result: Record<string, OpsRegistrationClassDetail> = {}
  for (const classId of Array.from(new Set(classIds.map(String).filter(Boolean)))) {
    const detail = state.classDetails[classId]
    if (detail) result[classId] = clone(detail)
  }
  return result
}

function normalizeFixtureAppointmentCalendarInput(
  input: RegistrationAppointmentCalendarLoadInput,
) {
  const rangeStart = String(input?.rangeStart || "").trim()
  const rangeEnd = String(input?.rangeEnd || "").trim()
  const startTime = Date.parse(rangeStart)
  const endTime = Date.parse(rangeEnd)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error("registration_calendar_range_invalid")
  }

  const allowedStatuses: RegistrationAppointmentCalendarStatus[] = ["scheduled", "completed", "canceled"]
  const requestedStatuses = input.statuses === undefined ? ["scheduled"] : input.statuses
  if (!Array.isArray(requestedStatuses)) throw new Error("registration_calendar_status_invalid")
  const requested = new Set<unknown>(requestedStatuses)
  if ([...requested].some((status) => !allowedStatuses.includes(status as RegistrationAppointmentCalendarStatus))) {
    throw new Error("registration_calendar_status_invalid")
  }
  return {
    endTime,
    startTime,
    statuses: new Set(allowedStatuses.filter((status) => requested.has(status))),
  }
}

export function getRegistrationSubjectTrackFixtureAppointmentCalendarRows(
  state: RegistrationSubjectTrackFixtureState,
  input: RegistrationAppointmentCalendarLoadInput,
): RegistrationAppointmentCalendarRow[] {
  const { endTime, startTime, statuses } = normalizeFixtureAppointmentCalendarInput(input)
  if (statuses.size === 0) return []

  const rowsByAppointmentId = new Map<string, RegistrationAppointmentCalendarRow>()
  for (const detail of Object.values(state.caseDetails)) {
    const tracksById = new Map(detail.tracks.map((trackItem) => [trackItem.id, trackItem]))
    for (const appointment of detail.appointments) {
      const scheduledTime = Date.parse(appointment.scheduledAt)
      if (
        !Number.isFinite(scheduledTime)
        || scheduledTime < startTime
        || scheduledTime >= endTime
        || !statuses.has(appointment.status)
      ) continue

      const participatingTrackIds = appointment.kind === "level_test"
        ? detail.levelTests
          .filter((attempt) => attempt.appointmentId === appointment.id)
          .map((attempt) => attempt.trackId)
        : detail.consultations
          .filter((consultation) => (
            consultation.mode === "visit"
            && consultation.appointmentId === appointment.id
          ))
          .map((consultation) => consultation.trackId)
      const participants = [...new Set(participatingTrackIds)]
        .map((trackId) => tracksById.get(trackId) || null)
        .filter((trackItem): trackItem is OpsRegistrationTrackSummary => Boolean(trackItem))
        .sort((left, right) => (
          REGISTRATION_SUBJECT_ORDER.indexOf(left.subject) - REGISTRATION_SUBJECT_ORDER.indexOf(right.subject)
          || left.id.localeCompare(right.id)
        ))

      if (participants.length === 0) continue

      if (!rowsByAppointmentId.has(appointment.id)) {
        rowsByAppointmentId.set(appointment.id, {
          appointment_id: appointment.id,
          task_id: appointment.taskId,
          student_name: detail.task.studentName,
          kind: appointment.kind,
          scheduled_at: appointment.scheduledAt,
          place: appointment.place,
          status: appointment.status,
          notification_revision: appointment.notificationRevision,
          track_ids: participants.map((trackItem) => trackItem.id),
          subjects: participants.map((trackItem) => trackItem.subject),
        })
      }
    }
  }

  return [...rowsByAppointmentId.values()].sort((left, right) => (
    Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at)
    || left.appointment_id.localeCompare(right.appointment_id)
  ))
}

function findCaseByTrackId(state: RegistrationSubjectTrackFixtureState, trackId: string) {
  return Object.values(state.caseDetails).find((detail) => detail.tracks.some((item) => item.id === trackId)) || null
}

function findCaseByAppointmentId(state: RegistrationSubjectTrackFixtureState, appointmentId: string) {
  return Object.values(state.caseDetails).find((detail) => detail.appointments.some((item) => item.id === appointmentId)) || null
}

function findCaseByAttemptId(state: RegistrationSubjectTrackFixtureState, attemptId: string) {
  return Object.values(state.caseDetails).find((detail) => detail.levelTests.some((item) => item.id === attemptId)) || null
}

function findCaseByConsultationId(state: RegistrationSubjectTrackFixtureState, consultationId: string) {
  return Object.values(state.caseDetails).find((detail) => detail.consultations.some((item) => item.id === consultationId)) || null
}

function findCaseByEnrollmentId(state: RegistrationSubjectTrackFixtureState, enrollmentId: string) {
  return Object.values(state.caseDetails).find((detail) => detail.enrollments.some((item) => item.id === enrollmentId)) || null
}

function findCaseByBatchId(state: RegistrationSubjectTrackFixtureState, batchId: string) {
  return Object.values(state.caseDetails).find((detail) => detail.admissionBatches.some((item) => item.id === batchId)) || null
}

function requireCase<T>(value: T | null | undefined, code: string): T {
  if (!value) throw new Error(`registration_subject_track_fixture_${code}`)
  return value
}

function projectFixturePhoneReadiness(detail: OpsRegistrationCaseDetail) {
  for (const selected of detail.tracks) {
    const activePhone = detail.consultations
      .filter((item) => (
        item.trackId === selected.id
        && item.mode === "phone"
        && item.status === "waiting"
      ))
      .sort((left, right) => {
        const leftParsed = Date.parse(left.createdAt)
        const rightParsed = Date.parse(right.createdAt)
        const leftTime = Number.isFinite(leftParsed) ? leftParsed : Number.NEGATIVE_INFINITY
        const rightTime = Number.isFinite(rightParsed) ? rightParsed : Number.NEGATIVE_INFINITY
        if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1
        return right.id.localeCompare(left.id)
      })[0] || null
    selected.phoneReadyAt = activePhone?.readyAt || null
    selected.phoneReadySource = activePhone?.readySource || null
  }
}

function projectFixtureVisitSchedule(detail: OpsRegistrationCaseDetail) {
  for (const selected of detail.tracks) {
    const activeVisit = detail.consultations
      .filter((item) => (
        item.trackId === selected.id
        && item.mode === "visit"
        && item.status === "scheduled"
      ))
      .map((consultation) => ({
        consultation,
        appointment: detail.appointments.find((item) => (
          item.id === consultation.appointmentId
          && item.kind === "visit_consultation"
          && item.status === "scheduled"
        )) || null,
      }))
      .filter((item) => item.appointment)
      .sort((left, right) => (
        right.consultation.createdAt.localeCompare(left.consultation.createdAt)
        || right.consultation.id.localeCompare(left.consultation.id)
      ))[0]?.appointment || null

    delete selected.visitScheduledAt
    delete selected.visitPlace
    if (activeVisit) {
      selected.visitScheduledAt = activeVisit.scheduledAt
      selected.visitPlace = activeVisit.place
    }
  }
}

function syncCase(state: RegistrationSubjectTrackFixtureState, detail: OpsRegistrationCaseDetail) {
  projectFixturePhoneReadiness(detail)
  projectFixtureVisitSchedule(detail)
  detail.task.registrationTracks = detail.tracks
  detail.task.subject = detail.tracks.map((item) => item.subject).join(", ")
  detail.task.updatedAt = FIXTURE_NOW
  state.caseDetails[detail.task.id] = detail
  const existingTask = state.workspaceData.tasks.some((task) => task.id === detail.task.id)
  state.workspaceData.tasks = existingTask
    ? state.workspaceData.tasks.map((task) => task.id === detail.task.id ? detail.task : task)
    : [...state.workspaceData.tasks, detail.task]
}

function nextId(state: RegistrationSubjectTrackFixtureState, kind: string) {
  state.sequence += 1
  return `fixture-${kind}-${String(state.sequence).padStart(3, "0")}`
}

function reconcileFixtureCurrentClassWait(
  state: RegistrationSubjectTrackFixtureState,
  detail: OpsRegistrationCaseDetail,
  selected: OpsRegistrationTrackSummary,
  waitingKind: string,
  classId: string,
) {
  const activeClaims = detail.enrollments.filter((item) => (
    item.trackId === selected.id
    && item.status === "waitlisted"
    && item.rosterActive
  ))
  const targetClassId = waitingKind === "current_class"
    ? classId.trim() || activeClaims[0]?.classId || ""
    : ""
  if (waitingKind === "current_class") {
    if (!targetClassId) throw new Error("registration_current_class_required")
    const classItem = state.optionData.classes.find((item) => item.id === targetClassId)
    if (!classItem) throw new Error("registration_class_not_found")
    if (classItem.subject !== selected.subject) throw new Error("registration_class_subject_mismatch")
  }

  for (const claim of activeClaims) {
    if (targetClassId && claim.classId === targetClassId) continue
    claim.status = "canceled"
    claim.rosterActive = false
    claim.updatedAt = FIXTURE_NOW
  }
  if (!targetClassId || activeClaims.some((item) => item.classId === targetClassId && item.rosterActive)) return

  detail.enrollments.push({
    ...enrollment({
      id: nextId(state, "enrollment"),
      trackId: selected.id,
      studentId: detail.task.studentId || null,
      classId: targetClassId,
      status: "waitlisted",
      rosterActive: true,
      sortOrder: 0,
    }),
    classStartDate: null,
    classStartSessionKey: null,
    classStartSession: null,
  })
}

function asText(payload: Record<string, unknown>, key: string) {
  return String(payload[key] || "")
}

function transitionResult(track: OpsRegistrationTrackSummary) {
  return {
    taskId: track.taskId,
    trackId: track.id,
    subject: track.subject,
    status: track.status,
    waitingKind: track.waitingKind,
    levelTestRetakeDecision: track.levelTestRetakeDecision,
    stageEnteredAt: track.stageEnteredAt,
  }
}

function receiptKey(command: RegistrationSubjectTrackFixtureCommand) {
  const explicit = String(command.requestKey || command.payload?.requestKey || "").trim()
  if (explicit) return explicit
  const payload = command.payload || {}
  return `fixture:${command.type}:${JSON.stringify(payload)}`
}

function canonicalizeFixturePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeFixturePayload)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeFixturePayload(entry)]),
  )
}

function fixturePayloadFingerprint(payload: Record<string, unknown>) {
  return JSON.stringify(canonicalizeFixturePayload(payload))
}

function fixtureInputText(value: unknown) {
  return String(value ?? "").trim()
}

function fixtureInitialError(code: string): never {
  throw new Error(code)
}

function orderedFixtureSubjects(value: unknown): RegistrationSubject[] {
  if (!Array.isArray(value)) fixtureInitialError("registration_subjects_required")
  if (value.some((entry) => !REGISTRATION_SUBJECT_ORDER.includes(fixtureInputText(entry) as RegistrationSubject))) {
    fixtureInitialError("registration_subject_invalid")
  }
  const selected = new Set(value.map(fixtureInputText))
  const subjects = REGISTRATION_SUBJECT_ORDER.filter((subject) => selected.has(subject))
  if (subjects.length === 0) fixtureInitialError("registration_subjects_required")
  return subjects
}

function normalizeFixtureAppointment(
  raw: unknown,
  participants: RegistrationSubject[],
): RegistrationCaseCreateWithInitialWorkflowInput["levelTestAppointment"] {
  const absent = raw === null || raw === undefined
  if ((participants.length === 0) !== absent) {
    fixtureInitialError("registration_initial_appointment_membership_invalid")
  }
  if (absent) return null
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fixtureInitialError("registration_initial_appointment_invalid")
  }
  const appointment = raw as Record<string, unknown>
  if (!Array.isArray(appointment.subjects)) {
    fixtureInitialError("registration_initial_appointment_membership_invalid")
  }
  const rawSubjects = appointment.subjects.map(fixtureInputText)
  if (rawSubjects.some((subject) => !REGISTRATION_SUBJECT_ORDER.includes(subject as RegistrationSubject))) {
    fixtureInitialError("registration_initial_appointment_membership_invalid")
  }
  const selected = new Set(rawSubjects)
  const appointmentSubjects = REGISTRATION_SUBJECT_ORDER.filter((subject) => selected.has(subject))
  if (
    appointmentSubjects.length !== rawSubjects.length
    || appointmentSubjects.length !== participants.length
    || appointmentSubjects.some((subject, index) => subject !== participants[index])
  ) {
    fixtureInitialError("registration_initial_appointment_membership_invalid")
  }
  const keys = Object.keys(appointment).sort()
  if (
    keys.length !== 3
    || keys[0] !== "place"
    || keys[1] !== "scheduledAt"
    || keys[2] !== "subjects"
    || typeof appointment.scheduledAt !== "string"
    || typeof appointment.place !== "string"
  ) {
    fixtureInitialError("registration_initial_appointment_invalid")
  }
  const scheduledAt = fixtureInputText(appointment.scheduledAt)
  const place = fixtureInputText(appointment.place)
  if (!Number.isFinite(Date.parse(scheduledAt)) || !place) {
    fixtureInitialError("registration_initial_appointment_invalid")
  }
  return { scheduledAt, place, subjects: appointmentSubjects }
}

function isFixtureDirectorEligible(
  state: RegistrationSubjectTrackFixtureState,
  subject: RegistrationSubject,
  profileId: string,
) {
  const profile = state.optionData.profiles.find((item) => item.id === profileId)
  return Boolean(
    profile
    && ["admin", "staff"].includes(profile.role)
    && state.optionData.teachers.some((teacher) => (
      teacher.profileId === profileId && teacher.subjects.includes(subject)
    )),
  )
}

function normalizeFixtureInitialWorkflowInput(
  state: RegistrationSubjectTrackFixtureState,
  payload: Record<string, unknown>,
  commandRequestKey: string | undefined,
): RegistrationCaseCreateWithInitialWorkflowInput {
  const campus = fixtureInputText(payload.campus)
  if (!campus || !["본관", "별관"].includes(campus)) {
    fixtureInitialError("registration_campus_invalid")
  }
  const subjects = orderedFixtureSubjects(payload.subjects)
  const rawPlans = payload.subjectPlans
  if (!rawPlans || typeof rawPlans !== "object" || Array.isArray(rawPlans)) {
    fixtureInitialError("registration_initial_subject_plan_invalid")
  }
  const planEntries = Object.entries(rawPlans as Record<string, unknown>)
  if (
    planEntries.length !== subjects.length
    || planEntries.some(([subject, action]) => (
      !subjects.includes(subject as RegistrationSubject)
      || !REGISTRATION_INITIAL_ACTIONS.includes(action as RegistrationInitialAction)
    ))
  ) {
    fixtureInitialError("registration_initial_subject_plan_invalid")
  }
  const subjectPlans: Partial<Record<RegistrationSubject, RegistrationInitialAction>> = {}
  for (const subject of subjects) subjectPlans[subject] = (rawPlans as Record<string, RegistrationInitialAction>)[subject]
  const levelTestSubjects = subjects.filter((subject) => subjectPlans[subject] === "level_test")
  const visitSubjects = subjects.filter((subject) => subjectPlans[subject] === "visit")
  const levelTestAppointment = normalizeFixtureAppointment(payload.levelTestAppointment, levelTestSubjects)
  const visitAppointment = normalizeFixtureAppointment(payload.visitAppointment, visitSubjects)

  const rawOverrides = payload.directorOverrides ?? {}
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
    fixtureInitialError("registration_director_override_invalid")
  }
  const directorOverrides: Partial<Record<RegistrationSubject, string>> = {}
  for (const [rawSubject, rawProfileId] of Object.entries(rawOverrides as Record<string, unknown>)) {
    const subject = rawSubject as RegistrationSubject
    const profileId = fixtureInputText(rawProfileId)
    if (!subjects.includes(subject) || !profileId || !isFixtureDirectorEligible(state, subject, profileId)) {
      fixtureInitialError("registration_director_override_invalid")
    }
    directorOverrides[subject] = profileId
  }

  const studentName = fixtureInputText(payload.studentName)
  if (!studentName) fixtureInitialError("registration_student_name_required")
  const schoolGrade = fixtureInputText(payload.schoolGrade)
  if (!schoolGrade) fixtureInitialError("registration_school_grade_required")
  const parentPhone = fixtureInputText(payload.parentPhone)
  const parentPhoneDigits = parentPhone.replace(/\D+/g, "")
  if (!/^01(0|1|[6-9])[0-9]{7,8}$/.test(parentPhoneDigits)) {
    fixtureInitialError("registration_parent_phone_invalid")
  }
  const inquiryAt = fixtureInputText(payload.inquiryAt)
  if (!inquiryAt || !Number.isFinite(Date.parse(inquiryAt))) {
    fixtureInitialError("registration_inquiry_at_required")
  }
  const priority = fixtureInputText(payload.priority)
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    fixtureInitialError("registration_priority_invalid")
  }
  const requestKey = fixtureInputText(payload.requestKey || commandRequestKey)
  if (!requestKey) fixtureInitialError("request_key_required")

  return {
    studentName,
    schoolGrade,
    schoolName: fixtureInputText(payload.schoolName),
    parentPhone,
    studentPhone: fixtureInputText(payload.studentPhone),
    campus,
    inquiryAt,
    subjects,
    requestNote: fixtureInputText(payload.requestNote),
    priority,
    subjectPlans,
    levelTestAppointment,
    visitAppointment,
    directorOverrides,
    requestKey,
  }
}

type FixtureDirectorResolution = {
  profileId: string | null
  source: "default" | "manual" | ""
  ruleKey: string
  name: string
}

function resolveFixtureInitialDirectors(
  state: RegistrationSubjectTrackFixtureState,
  input: RegistrationCaseCreateWithInitialWorkflowInput,
) {
  const resolutions: Partial<Record<RegistrationSubject, FixtureDirectorResolution>> = {}
  for (const subject of input.subjects) {
    const override = input.directorOverrides[subject]
    const teacher = override
      ? state.optionData.teachers.find((item) => item.profileId === override)
      : state.optionData.teachers.find((item) => item.subjects.includes(subject))
    const profileId = override || teacher?.profileId || null
    const profile = state.optionData.profiles.find((item) => item.id === profileId)
    const eligibleProfileId = profileId && isFixtureDirectorEligible(state, subject, profileId)
      ? profileId
      : null
    const action = input.subjectPlans[subject]
    if ((action === "direct_phone" || action === "visit") && !eligibleProfileId) {
      fixtureInitialError("registration_director_required")
    }
    resolutions[subject] = {
      profileId: eligibleProfileId,
      source: eligibleProfileId ? (override ? "manual" : "default") : "",
      ruleKey: eligibleProfileId && !override
        ? `academic-director-v1:2026:${subject}:${input.schoolGrade}`
        : "",
      name: eligibleProfileId ? profile?.label || teacher?.label || "" : "",
    }
  }
  return resolutions
}

function createFixtureTrackEvent(
  state: RegistrationSubjectTrackFixtureState,
  input: Omit<
    OpsRegistrationTrackEvent,
    | "id"
    | "actorId"
    | "actorKind"
    | "systemSource"
    | "reasonCode"
    | "payloadVersion"
    | "occurredAt"
    | "legacyText"
  >,
): OpsRegistrationTrackEvent {
  return {
    ...input,
    id: nextId(state, "event"),
    metadata: clone(input.metadata),
    actorId: FIXTURE_ACTOR_ID,
    actorKind: "user",
    systemSource: null,
    reasonCode: input.reason,
    payloadVersion: 2,
    occurredAt: FIXTURE_NOW,
    legacyText: null,
  }
}

function projectFixtureInitialParent(detail: OpsRegistrationCaseDetail) {
  const workflowOrder: Partial<Record<OpsRegistrationTrackStatus, number>> = {
    inquiry: 0,
    migration_review: 0,
    level_test_scheduled: 1,
    level_test_in_progress: 1,
    consultation_waiting: 2,
    visit_consultation_scheduled: 2,
    waiting: 3,
    enrollment_decided: 4,
    enrollment_processing: 5,
  }
  const pipelineStatus: Partial<Record<OpsRegistrationTrackStatus, string>> = {
    inquiry: "0. 등록 문의",
    migration_review: "0. 등록 문의",
    level_test_scheduled: "1. 레벨테스트 예약",
    level_test_in_progress: "1. 레벨테스트 예약",
    consultation_waiting: "2. 상담 예약",
    visit_consultation_scheduled: "2. 상담 예약",
  }
  const subjectOrder = (subject: RegistrationSubject) => REGISTRATION_SUBJECT_ORDER.indexOf(subject)
  const selectedTrack = [...detail.tracks].sort((left, right) => (
    (workflowOrder[left.status] ?? 9) - (workflowOrder[right.status] ?? 9)
    || subjectOrder(left.subject) - subjectOrder(right.subject)
    || left.id.localeCompare(right.id)
  ))[0]
  const selectedDirector = [...detail.tracks].sort((left, right) => (
    subjectOrder(left.subject) - subjectOrder(right.subject)
    || left.id.localeCompare(right.id)
  ))[0]

  detail.task.status = detail.tracks.every((selected) => selected.status === "inquiry")
    ? "requested"
    : "in_progress"
  detail.task.secondaryAssigneeId = selectedDirector?.directorProfileId || ""
  detail.task.secondaryAssigneeLabel = selectedDirector?.directorName || ""
  if (detail.task.registration) {
    detail.task.registration.counselor = selectedDirector?.directorName || ""
    detail.task.registration.pipelineStatus = selectedTrack
      ? pipelineStatus[selectedTrack.status] || "0. 등록 문의"
      : "0. 등록 문의"
  }
}

function createFixtureRegistrationCaseWithInitialWorkflow(
  state: RegistrationSubjectTrackFixtureState,
  input: RegistrationCaseCreateWithInitialWorkflowInput,
): RegistrationCaseCreateWithInitialWorkflowResponse & { notificationJobs: [] } {
  const directors = resolveFixtureInitialDirectors(state, input)
  const taskId = nextId(state, "task")
  const tracks = input.subjects.map((subject) => {
    const director = directors[subject]!
    const selected = track({
      id: nextId(state, "track"),
      taskId,
      subject,
      status: "inquiry",
      directorProfileId: director.profileId,
      directorName: director.name,
      stageEnteredAt: FIXTURE_NOW,
    })
    selected.directorAssignmentSource = director.source
    selected.directorAssignmentRuleKey = director.ruleKey
    return selected
  })
  const task = taskTemplate({
    id: taskId,
    studentName: input.studentName,
    subject: input.subjects.join(", "),
    tracks,
  })
  task.status = "requested"
  task.priority = input.priority as OpsTask["priority"]
  task.assigneeId = ""
  task.assigneeLabel = ""
  task.assigneeTeam = ""
  task.studentId = ""
  task.campus = input.campus
  task.createdAt = FIXTURE_NOW
  task.updatedAt = FIXTURE_NOW
  task.registration = {
    pipelineStatus: "0. 등록 문의",
    inquiryAt: input.inquiryAt,
    schoolGrade: input.schoolGrade,
    schoolName: input.schoolName,
    parentPhone: input.parentPhone,
    studentPhone: input.studentPhone,
    counselor: "",
    requestNote: input.requestNote,
    admissionNoticeSent: false,
  }
  const detail = caseDetail({ task, tracks })
  detail.events.push(createFixtureTrackEvent(state, {
    taskId,
    trackId: null,
    eventType: "registration_case_created",
    subject: null,
    source: null,
    destination: null,
    reason: null,
    metadata: {
      version: 1,
      actorId: FIXTURE_ACTOR_ID,
      subjects: [...input.subjects],
      occurredAt: FIXTURE_NOW,
    },
  }))

  const levelTestSubjects = input.subjects.filter((subject) => input.subjectPlans[subject] === "level_test")
  if (input.levelTestAppointment && levelTestSubjects.length > 0) {
    const appointment: OpsRegistrationAppointment = {
      id: nextId(state, "appointment"),
      taskId,
      kind: "level_test",
      scheduledAt: input.levelTestAppointment.scheduledAt,
      place: input.levelTestAppointment.place,
      status: "scheduled",
      notificationRevision: 1,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    }
    detail.appointments.push(appointment)
    const activeTracks = tracks.filter((selected) => levelTestSubjects.includes(selected.subject))
    const activeTrackIds = activeTracks.map((selected) => selected.id).sort()
    for (const selected of activeTracks) {
      const attempt: OpsRegistrationLevelTest = {
        id: nextId(state, "attempt"),
        trackId: selected.id,
        appointmentId: appointment.id,
        attemptNumber: 1,
        status: "scheduled",
        startedAt: null,
        completedAt: null,
        materialLink: null,
      }
      detail.levelTests.push(attempt)
      selected.status = "level_test_scheduled"
      selected.stageEnteredAt = FIXTURE_NOW
      detail.events.push(createFixtureTrackEvent(state, {
        taskId,
        trackId: selected.id,
        eventType: "level_test_scheduled",
        subject: selected.subject,
        source: "inquiry",
        destination: "level_test_scheduled",
        reason: null,
        metadata: {
          appointmentId: appointment.id,
          notificationRevision: 1,
          kind: "level_test",
          scheduledAt: appointment.scheduledAt,
          place: appointment.place,
          activityId: attempt.id,
          attemptNumber: 1,
          activeTrackIds,
          canceledTrackIds: [],
          changeKind: "created",
        },
      }))
    }
  }

  for (const selected of tracks.filter((item) => input.subjectPlans[item.subject] === "direct_phone")) {
    const consultation: OpsRegistrationConsultation = {
      id: nextId(state, "consultation"),
      trackId: selected.id,
      appointmentId: null,
      mode: "phone",
      status: "waiting",
      directorProfileId: selected.directorProfileId || "",
      readyAt: input.inquiryAt,
      readySource: "inquiry",
      completedAt: null,
      outcome: null,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    }
    detail.consultations.push(consultation)
    selected.status = "consultation_waiting"
    selected.stageEnteredAt = FIXTURE_NOW
    detail.events.push(createFixtureTrackEvent(state, {
      taskId,
      trackId: selected.id,
      eventType: "inquiry_routed",
      subject: selected.subject,
      source: "inquiry",
      destination: "consultation_waiting",
      reason: null,
      metadata: { consultationId: consultation.id, initialAction: "direct_phone" },
    }))
  }

  const notificationTargets: Array<{ appointmentId: string; notificationRevision: number }> = []
  const visitSubjects = input.subjects.filter((subject) => input.subjectPlans[subject] === "visit")
  if (input.visitAppointment && visitSubjects.length > 0) {
    const appointment: OpsRegistrationAppointment = {
      id: nextId(state, "appointment"),
      taskId,
      kind: "visit_consultation",
      scheduledAt: input.visitAppointment.scheduledAt,
      place: input.visitAppointment.place,
      status: "scheduled",
      notificationRevision: 1,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    }
    detail.appointments.push(appointment)
    const activeTracks = tracks.filter((selected) => visitSubjects.includes(selected.subject))
    const activeTrackIds = activeTracks.map((selected) => selected.id).sort()
    for (const selected of activeTracks) {
      const consultation: OpsRegistrationConsultation = {
        id: nextId(state, "consultation"),
        trackId: selected.id,
        appointmentId: appointment.id,
        mode: "visit",
        status: "scheduled",
        directorProfileId: selected.directorProfileId || "",
        readyAt: null,
        readySource: null,
        completedAt: null,
        outcome: null,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      }
      detail.consultations.push(consultation)
      selected.status = "visit_consultation_scheduled"
      selected.stageEnteredAt = FIXTURE_NOW
      detail.events.push(createFixtureTrackEvent(state, {
        taskId,
        trackId: selected.id,
        eventType: "visit_scheduled",
        subject: selected.subject,
        source: "inquiry",
        destination: "visit_consultation_scheduled",
        reason: null,
        metadata: {
          appointmentId: appointment.id,
          notificationRevision: 1,
          kind: "visit_consultation",
          scheduledAt: appointment.scheduledAt,
          place: appointment.place,
          activityId: consultation.id,
          activeTrackIds,
          canceledTrackIds: [],
          changeKind: "created",
        },
      }))
    }
    notificationTargets.push({ appointmentId: appointment.id, notificationRevision: 1 })
  }

  for (const selected of tracks.filter((item) => input.subjectPlans[item.subject] === "inquiry")) {
    detail.events.push(createFixtureTrackEvent(state, {
      taskId,
      trackId: selected.id,
      eventType: "initial_inquiry_selected",
      subject: selected.subject,
      source: "inquiry",
      destination: "inquiry",
      reason: null,
      metadata: { initialAction: "inquiry" },
    }))
  }

  projectFixtureInitialParent(detail)
  syncCase(state, detail)
  return {
    taskId,
    commonRevision: 1,
    subjects: [...input.subjects],
    tracks: clone(detail.tracks),
    appointments: clone(detail.appointments),
    notificationTargets,
    notificationJobs: [],
  }
}

export function reduceRegistrationSubjectTrackFixture(
  current: RegistrationSubjectTrackFixtureState,
  command: RegistrationSubjectTrackFixtureCommand,
): RegistrationSubjectTrackFixtureOutcome {
  if (!REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS.includes(command.type as RegistrationSubjectTrackFixtureAction)) {
    throw new Error("registration_subject_track_fixture_unsupported_action")
  }
  const type = command.type as RegistrationSubjectTrackFixtureAction
  const rawPayload = clone(command.payload || {})
  const normalizedInitialInput = type === "createRegistrationCaseWithInitialWorkflow"
    ? normalizeFixtureInitialWorkflowInput(current, rawPayload, command.requestKey)
    : null
  const payload = normalizedInitialInput
    ? normalizedInitialInput as unknown as Record<string, unknown>
    : rawPayload
  const key = normalizedInitialInput?.requestKey || receiptKey(command)
  const fingerprintPayload = normalizedInitialInput
    ? Object.fromEntries(Object.entries(payload).filter(([entryKey]) => entryKey !== "requestKey"))
    : payload
  const payloadFingerprint = fixturePayloadFingerprint(fingerprintPayload)
  const existing = current.receipts[key]
  if (existing) {
    if (existing.action !== type || existing.payloadFingerprint !== payloadFingerprint) {
      throw new Error("registration_subject_track_fixture_request_key_conflict")
    }
    return { state: current, result: clone(existing.result), receipt: clone(existing) }
  }

  const state = clone(current)
  let result: unknown

  switch (type) {
    case "createRegistrationCaseWithInitialWorkflow": {
      result = createFixtureRegistrationCaseWithInitialWorkflow(state, normalizedInitialInput!)
      break
    }
    case "syncRegistrationCaseSubjects": {
      const taskId = asText(payload, "taskId")
      const detail = requireCase(state.caseDetails[taskId], "case_not_found")
      const subjects = Array.from(new Set((payload.subjects as RegistrationSubject[] || []).filter((item) => ["영어", "수학"].includes(item))))
      const kept = detail.tracks.filter((item) => subjects.includes(item.subject))
      for (const subject of subjects) {
        if (!kept.some((item) => item.subject === subject)) {
          kept.push(track({ id: `fixture-track-${taskId}-${subject === "영어" ? "english" : "math"}`, taskId, subject, status: "inquiry" }))
        }
      }
      detail.tracks = kept
      syncCase(state, detail)
      result = { taskId, subjects, tracks: detail.tracks }
      break
    }
    case "updateRegistrationCaseCommon": {
      const taskId = asText(payload, "taskId")
      const detail = requireCase(state.caseDetails[taskId], "case_not_found")
      if (Number(payload.expectedCommonRevision) !== detail.commonRevision) throw new Error("registration_common_revision_conflict")
      detail.task.studentName = asText(payload, "studentName") || detail.task.studentName
      detail.task.title = `등록: ${detail.task.studentName}`
      detail.task.campus = asText(payload, "campus")
      detail.task.priority = (payload.priority as OpsTask["priority"]) || detail.task.priority
      detail.task.registration = {
        ...detail.task.registration,
        schoolGrade: asText(payload, "schoolGrade"),
        schoolName: asText(payload, "schoolName"),
        parentPhone: asText(payload, "parentPhone"),
        studentPhone: asText(payload, "studentPhone"),
        inquiryAt: asText(payload, "inquiryAt"),
        requestNote: asText(payload, "requestNote"),
      }
      detail.commonRevision += 1
      syncCase(state, detail)
      result = { taskId, commonRevision: detail.commonRevision }
      break
    }
    case "routeRegistrationInquiry": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      selected.status = payload.destination as OpsRegistrationTrackStatus
      selected.waitingKind = (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || ""
      reconcileFixtureCurrentClassWait(state, detail, selected, selected.waitingKind, asText(payload, "classId"))
      selected.stageEnteredAt = FIXTURE_NOW
      if (selected.status === "consultation_waiting") {
        detail.consultations.push({
          id: nextId(state, "consultation"),
          trackId: selected.id,
          appointmentId: null,
          mode: "phone",
          status: "waiting",
          directorProfileId: selected.directorProfileId || "",
          readyAt: detail.task.registration?.inquiryAt || null,
          readySource: detail.task.registration?.inquiryAt ? "inquiry" : null,
          completedAt: null,
          outcome: null,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
        })
      }
      syncCase(state, detail)
      result = transitionResult(selected)
      break
    }
    case "assignRegistrationTrackDirector": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      const profileId = payload.directorProfileId ? String(payload.directorProfileId) : null
      const profile = state.optionData.profiles.find((item) => item.id === profileId)
      selected.directorProfileId = profileId
      selected.directorName = profile?.label || ""
      selected.directorAssignmentSource = payload.assignmentSource === "manual" ? "manual" : payload.assignmentSource === "default" ? "default" : ""
      selected.directorAssignmentRuleKey = asText(payload, "ruleKey")
      detail.consultations.forEach((item) => {
        if (item.trackId === selected.id && !["completed", "canceled"].includes(item.status)) item.directorProfileId = profileId || ""
      })
      if (
        selected.status === "consultation_waiting"
        && profileId
        && !detail.consultations.some((item) => item.trackId === selected.id && item.mode === "phone" && item.status === "waiting")
      ) {
        detail.consultations.push({
          id: nextId(state, "consultation"),
          trackId: selected.id,
          appointmentId: null,
          mode: "phone",
          status: "waiting",
          directorProfileId: profileId,
          readyAt: FIXTURE_NOW,
          readySource: "director_resolved",
          completedAt: null,
          outcome: null,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
        })
      }
      syncCase(state, detail)
      result = { ...transitionResult(selected), directorProfileId: profileId, directorAssignmentSource: selected.directorAssignmentSource, directorAssignmentRuleKey: selected.directorAssignmentRuleKey, commonRevision: detail.commonRevision }
      break
    }
    case "saveRegistrationSharedAppointment": {
      const taskId = asText(payload, "taskId")
      const detail = requireCase(state.caseDetails[taskId], "case_not_found")
      const kind = payload.kind as OpsRegistrationAppointment["kind"]
      const selectedTrackIds = Array.from(new Set((payload.trackIds as string[] || []).map(String)))
      let appointment = payload.appointmentId
        ? detail.appointments.find((item) => item.id === payload.appointmentId)
        : null
      const existingScheduledTrackIds = appointment
        ? (kind === "level_test"
            ? detail.levelTests.filter((item) => item.appointmentId === appointment?.id && item.status === "scheduled").map((item) => item.trackId)
            : detail.consultations.filter((item) => item.appointmentId === appointment?.id && item.mode === "visit" && item.status === "scheduled").map((item) => item.trackId))
        : []
      if (appointment && payload.expectedNotificationRevision != null && Number(payload.expectedNotificationRevision) !== appointment.notificationRevision) {
        throw new Error("registration_appointment_revision_conflict")
      }
      if (appointment && payload.replaceRemaining === true) {
        const selectedSet = [...selectedTrackIds].sort().join("|")
        const existingSet = [...existingScheduledTrackIds].sort().join("|")
        if (!selectedSet || selectedSet !== existingSet) {
          throw new Error("registration_appointment_replacement_track_set_mismatch")
        }
        const oldAppointment = appointment
        const hadTerminalChild = kind === "level_test"
          ? detail.levelTests.some((item) => item.appointmentId === oldAppointment.id && ["in_progress", "completed", "absent", "canceled"].includes(item.status))
          : detail.consultations.some((item) => item.appointmentId === oldAppointment.id && item.mode === "visit" && ["completed", "canceled"].includes(item.status))
        if (!hadTerminalChild) throw new Error("registration_appointment_immutable")
        detail.levelTests.forEach((item) => {
          if (item.appointmentId === oldAppointment.id && item.status === "scheduled") {
            item.status = "canceled"
            item.completedAt = FIXTURE_NOW
          }
        })
        detail.consultations.forEach((item) => {
          if (item.appointmentId === oldAppointment.id && item.mode === "visit" && item.status === "scheduled") {
            item.status = "canceled"
            item.updatedAt = FIXTURE_NOW
          }
        })
        const oldHasActiveChild = kind === "level_test"
          ? detail.levelTests.some((item) => item.appointmentId === oldAppointment.id && ["scheduled", "in_progress"].includes(item.status))
          : detail.consultations.some((item) => item.appointmentId === oldAppointment.id && item.mode === "visit" && item.status === "scheduled")
        const oldHasCompletedChild = kind === "level_test"
          ? detail.levelTests.some((item) => item.appointmentId === oldAppointment.id && ["completed", "absent"].includes(item.status))
          : detail.consultations.some((item) => item.appointmentId === oldAppointment.id && item.mode === "visit" && item.status === "completed")
        oldAppointment.status = oldHasActiveChild ? "scheduled" : oldHasCompletedChild ? "completed" : "canceled"
        oldAppointment.notificationRevision += 1
        oldAppointment.updatedAt = FIXTURE_NOW
        appointment = {
          id: nextId(state, "appointment"),
          taskId,
          kind,
          scheduledAt: asText(payload, "scheduledAt"),
          place: asText(payload, "place"),
          status: "scheduled",
          notificationRevision: 1,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
        }
        detail.appointments.push(appointment)
        const requiresDirectorAssignmentTrackIds: string[] = []
        for (const trackId of selectedTrackIds) {
          const selected = requireCase(detail.tracks.find((item) => item.id === trackId), "track_not_found")
          selected.status = kind === "level_test" ? "level_test_scheduled" : "visit_consultation_scheduled"
          selected.stageEnteredAt = FIXTURE_NOW
          if (kind === "level_test") {
            const previousAttempts = detail.levelTests.filter((item) => item.trackId === trackId)
            detail.levelTests.push({
              id: nextId(state, "attempt"),
              trackId,
              appointmentId: appointment.id,
              attemptNumber: Math.max(0, ...previousAttempts.map((item) => item.attemptNumber)) + 1,
              status: "scheduled",
              startedAt: null,
              completedAt: null,
              materialLink: null,
            })
          } else if (selected.directorProfileId) {
            detail.consultations.push({ id: nextId(state, "consultation"), trackId, appointmentId: appointment.id, mode: "visit", status: "scheduled", directorProfileId: selected.directorProfileId, readyAt: null, readySource: null, completedAt: null, outcome: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW })
          } else {
            requiresDirectorAssignmentTrackIds.push(trackId)
          }
        }
        syncCase(state, detail)
        result = {
          appointmentId: appointment.id,
          notificationRevision: appointment.notificationRevision,
          notificationTargets: kind === "visit_consultation"
            ? [
                { appointmentId: oldAppointment.id, notificationRevision: oldAppointment.notificationRevision },
                { appointmentId: appointment.id, notificationRevision: appointment.notificationRevision },
              ]
            : [],
          requiresDirectorAssignmentTrackIds,
          notificationJobs: [],
        }
        break
      }
      if (!appointment) {
        appointment = {
          id: nextId(state, "appointment"),
          taskId,
          kind,
          scheduledAt: asText(payload, "scheduledAt"),
          place: asText(payload, "place"),
          status: "scheduled",
          notificationRevision: 0,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
        }
        detail.appointments.push(appointment)
      }
      appointment.scheduledAt = asText(payload, "scheduledAt")
      appointment.place = asText(payload, "place")
      appointment.status = "scheduled"
      appointment.notificationRevision += 1
      appointment.updatedAt = FIXTURE_NOW
      const deselectedTrackIds = existingScheduledTrackIds.filter((trackId) => !selectedTrackIds.includes(trackId))
      const requiresDirectorAssignmentTrackIds: string[] = []
      for (const trackId of deselectedTrackIds) {
        const selected = requireCase(detail.tracks.find((item) => item.id === trackId), "track_not_found")
        if (kind === "level_test") {
          detail.levelTests.forEach((item) => {
            if (item.trackId === trackId && item.appointmentId === appointment?.id && item.status === "scheduled") {
              item.status = "canceled"
              item.completedAt = FIXTURE_NOW
            }
          })
          const hasOtherActiveAttempt = detail.levelTests.some((item) => item.trackId === trackId && ["scheduled", "in_progress"].includes(item.status))
          if (!hasOtherActiveAttempt) selected.status = "inquiry"
        } else {
          detail.consultations.forEach((item) => {
            if (item.trackId === trackId && item.appointmentId === appointment?.id && item.mode === "visit" && item.status === "scheduled") {
              item.status = "canceled"
              item.updatedAt = FIXTURE_NOW
            }
          })
          selected.status = "consultation_waiting"
          const hasActiveConsultation = detail.consultations.some((item) => item.trackId === trackId && ["waiting", "scheduled"].includes(item.status))
          if (selected.directorProfileId && !hasActiveConsultation) {
            detail.consultations.push({
              id: nextId(state, "consultation"),
              trackId,
              appointmentId: null,
              mode: "phone",
              status: "waiting",
              directorProfileId: selected.directorProfileId,
              readyAt: FIXTURE_NOW,
              readySource: "visit_reopened",
              completedAt: null,
              outcome: null,
              createdAt: FIXTURE_NOW,
              updatedAt: FIXTURE_NOW,
            })
          } else if (!selected.directorProfileId) {
            requiresDirectorAssignmentTrackIds.push(trackId)
          }
        }
        selected.stageEnteredAt = FIXTURE_NOW
      }
      for (const trackId of selectedTrackIds) {
        const selected = requireCase(detail.tracks.find((item) => item.id === trackId), "track_not_found")
        selected.status = kind === "level_test" ? "level_test_scheduled" : "visit_consultation_scheduled"
        selected.stageEnteredAt = FIXTURE_NOW
        if (kind === "level_test") {
          const previousAttempts = detail.levelTests.filter((item) => item.trackId === trackId)
          const active = previousAttempts.find((item) => item.appointmentId === appointment?.id && item.status === "scheduled")
          if (!active) detail.levelTests.push({ id: nextId(state, "attempt"), trackId, appointmentId: appointment.id, attemptNumber: Math.max(0, ...previousAttempts.map((item) => item.attemptNumber)) + 1, status: "scheduled", startedAt: null, completedAt: null, materialLink: null })
        } else {
          const current = detail.consultations.find((item) => item.trackId === trackId && item.mode === "visit" && item.status === "scheduled")
          if (current) current.appointmentId = appointment.id
          else {
            detail.consultations.forEach((item) => {
              if (item.trackId === trackId && item.mode === "phone" && item.status === "waiting") {
                item.status = "canceled"
                item.updatedAt = FIXTURE_NOW
              }
            })
            detail.consultations.push({ id: nextId(state, "consultation"), trackId, appointmentId: appointment.id, mode: "visit", status: "scheduled", directorProfileId: selected.directorProfileId || "", readyAt: null, readySource: null, completedAt: null, outcome: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW })
          }
        }
      }
      syncCase(state, detail)
      result = {
        appointmentId: appointment.id,
        notificationRevision: appointment.notificationRevision,
        notificationTargets: kind === "visit_consultation" ? [{ appointmentId: appointment.id, notificationRevision: appointment.notificationRevision }] : [],
        requiresDirectorAssignmentTrackIds: Array.from(new Set([
          ...requiresDirectorAssignmentTrackIds,
          ...selectedTrackIds.filter((trackId) => !detail.tracks.find((item) => item.id === trackId)?.directorProfileId),
        ])),
        notificationJobs: [],
      }
      break
    }
    case "cancelRegistrationAppointment": {
      const detail = requireCase(findCaseByAppointmentId(state, asText(payload, "appointmentId")), "appointment_not_found")
      const appointment = requireCase(detail.appointments.find((item) => item.id === payload.appointmentId), "appointment_not_found")
      if (Number(payload.expectedNotificationRevision) !== appointment.notificationRevision) throw new Error("registration_appointment_revision_conflict")
      appointment.notificationRevision += 1
      appointment.updatedAt = FIXTURE_NOW
      const scheduledTrackIds = appointment.kind === "level_test"
        ? detail.levelTests.filter((item) => item.appointmentId === appointment.id && item.status === "scheduled").map((item) => item.trackId)
        : detail.consultations.filter((item) => item.appointmentId === appointment.id && item.mode === "visit" && item.status === "scheduled").map((item) => item.trackId)
      const requiresDirectorAssignmentTrackIds: string[] = []
      detail.levelTests.forEach((item) => {
        if (item.appointmentId === appointment.id && item.status === "scheduled") {
          item.status = "canceled"
          item.completedAt = FIXTURE_NOW
        }
      })
      detail.consultations.forEach((item) => {
        if (item.appointmentId === appointment.id && item.status === "scheduled") {
          item.status = "canceled"
          item.updatedAt = FIXTURE_NOW
        }
      })
      for (const trackId of scheduledTrackIds) {
        const selected = requireCase(detail.tracks.find((item) => item.id === trackId), "track_not_found")
        if (appointment.kind === "level_test") {
          const hasOtherActiveAttempt = detail.levelTests.some((item) => item.trackId === trackId && ["scheduled", "in_progress"].includes(item.status))
          if (!hasOtherActiveAttempt) selected.status = "inquiry"
        } else {
          selected.status = "consultation_waiting"
          const hasActiveConsultation = detail.consultations.some((item) => item.trackId === trackId && ["waiting", "scheduled"].includes(item.status))
          if (selected.directorProfileId && !hasActiveConsultation) {
            detail.consultations.push({ id: nextId(state, "consultation"), trackId, appointmentId: null, mode: "phone", status: "waiting", directorProfileId: selected.directorProfileId, readyAt: FIXTURE_NOW, readySource: "visit_reopened", completedAt: null, outcome: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW })
          } else if (!selected.directorProfileId) {
            requiresDirectorAssignmentTrackIds.push(trackId)
          }
        }
        selected.stageEnteredAt = FIXTURE_NOW
      }
      const hasActiveChild = appointment.kind === "level_test"
        ? detail.levelTests.some((item) => item.appointmentId === appointment.id && ["scheduled", "in_progress"].includes(item.status))
        : detail.consultations.some((item) => item.appointmentId === appointment.id && item.mode === "visit" && item.status === "scheduled")
      const hasCompletedChild = appointment.kind === "level_test"
        ? detail.levelTests.some((item) => item.appointmentId === appointment.id && ["completed", "absent"].includes(item.status))
        : detail.consultations.some((item) => item.appointmentId === appointment.id && item.mode === "visit" && item.status === "completed")
      appointment.status = hasActiveChild ? "scheduled" : hasCompletedChild ? "completed" : "canceled"
      syncCase(state, detail)
      result = { appointmentId: appointment.id, notificationRevision: appointment.notificationRevision, notificationTargets: appointment.kind === "visit_consultation" ? [{ appointmentId: appointment.id, notificationRevision: appointment.notificationRevision }] : [], requiresDirectorAssignmentTrackIds, notificationJobs: [] }
      break
    }
    case "startRegistrationLevelTestAttempt": {
      const detail = requireCase(findCaseByAttemptId(state, asText(payload, "attemptId")), "attempt_not_found")
      const attempt = requireCase(detail.levelTests.find((item) => item.id === payload.attemptId), "attempt_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === attempt.trackId), "track_not_found")
      attempt.status = "in_progress"
      attempt.startedAt = FIXTURE_NOW
      selected.status = "level_test_in_progress"
      syncCase(state, detail)
      result = { taskId: detail.task.id, trackId: selected.id, attemptId: attempt.id, appointmentId: attempt.appointmentId, attemptNumber: attempt.attemptNumber, status: attempt.status, trackStatus: selected.status, appointmentStatus: "scheduled", startedAt: attempt.startedAt }
      break
    }
    case "completeRegistrationLevelTestAttempt": {
      const detail = requireCase(findCaseByAttemptId(state, asText(payload, "attemptId")), "attempt_not_found")
      const attempt = requireCase(detail.levelTests.find((item) => item.id === payload.attemptId), "attempt_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === attempt.trackId), "track_not_found")
      attempt.status = payload.status as OpsRegistrationLevelTest["status"]
      attempt.completedAt = FIXTURE_NOW
      attempt.materialLink = payload.status === "completed" ? asText(payload, "materialLink") : null
      let consultationId: string | null = null
      if (attempt.status === "completed") {
        selected.status = "consultation_waiting"
        const consultation: OpsRegistrationConsultation = { id: nextId(state, "consultation"), trackId: selected.id, appointmentId: null, mode: "phone", status: "waiting", directorProfileId: selected.directorProfileId || "", readyAt: FIXTURE_NOW, readySource: "level_test_completion", completedAt: null, outcome: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW }
        detail.consultations.push(consultation)
        consultationId = consultation.id
      } else {
        selected.status = "inquiry"
      }
      selected.stageEnteredAt = FIXTURE_NOW
      const appointment = detail.appointments.find((item) => item.id === attempt.appointmentId)
      if (appointment && detail.levelTests.filter((item) => item.appointmentId === appointment.id).every((item) => ["completed", "absent", "canceled"].includes(item.status))) appointment.status = "completed"
      syncCase(state, detail)
      result = { taskId: detail.task.id, trackId: selected.id, attemptId: attempt.id, appointmentId: attempt.appointmentId, attemptNumber: attempt.attemptNumber, status: attempt.status, trackStatus: selected.status, appointmentStatus: appointment?.status || "completed", completedAt: attempt.completedAt, materialLink: attempt.materialLink, consultationId }
      break
    }
    case "closeRegistrationLevelTestTrack": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      selected.status = "inquiry_closed"
      selected.stageEnteredAt = FIXTURE_NOW
      syncCase(state, detail)
      result = transitionResult(selected)
      break
    }
    case "completeRegistrationConsultation": {
      const detail = requireCase(findCaseByConsultationId(state, asText(payload, "consultationId")), "consultation_not_found")
      const consultation = requireCase(detail.consultations.find((item) => item.id === payload.consultationId), "consultation_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === consultation.trackId), "track_not_found")
      consultation.status = "completed"
      consultation.completedAt = FIXTURE_NOW
      consultation.outcome = payload.outcome as OpsRegistrationConsultation["outcome"]
      consultation.updatedAt = FIXTURE_NOW
      selected.status = payload.outcome === "enrollment" ? "enrollment_decided" : payload.outcome === "waiting" ? "waiting" : "not_registered"
      selected.waitingKind = payload.outcome === "waiting" ? (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || "current_term_opening" : ""
      reconcileFixtureCurrentClassWait(state, detail, selected, selected.waitingKind, asText(payload, "classId"))
      selected.stageEnteredAt = FIXTURE_NOW
      syncCase(state, detail)
      result = { consultation, track: selected }
      break
    }
    case "transitionRegistrationWaiting": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      const action = asText(payload, "action")
      if (action === "change_waiting_kind") {
        selected.waitingKind = (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || ""
      }
      if (action === "record_retest_required") {
        selected.levelTestRetakeDecision = (payload.retakeDecision as OpsRegistrationTrackSummary["levelTestRetakeDecision"]) || "required"
        if (selected.levelTestRetakeDecision === "required") selected.status = "inquiry"
      }
      if (action === "move_to_enrollment") {
        selected.status = "enrollment_decided"
        selected.waitingKind = ""
      }
      if (action === "close_not_registered") {
        selected.status = "not_registered"
        selected.waitingKind = ""
      }
      reconcileFixtureCurrentClassWait(state, detail, selected, selected.waitingKind, asText(payload, "classId"))
      selected.stageEnteredAt = FIXTURE_NOW
      syncCase(state, detail)
      result = transitionResult(selected)
      break
    }
    case "routeRegistrationEnrollmentDecision": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      detail.enrollments.forEach((item) => {
        if (item.trackId !== selected.id || item.admissionBatchId || item.status !== "planned") return
        item.status = "canceled"
        item.rosterActive = false
        item.updatedAt = FIXTURE_NOW
      })
      selected.status = payload.destination as OpsRegistrationTrackStatus
      selected.waitingKind = selected.status === "waiting" ? (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || "" : ""
      reconcileFixtureCurrentClassWait(state, detail, selected, selected.waitingKind, asText(payload, "classId"))
      selected.stageEnteredAt = FIXTURE_NOW
      syncCase(state, detail)
      result = transitionResult(selected)
      break
    }
    case "saveRegistrationEnrollmentRows": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const trackId = asText(payload, "trackId")
      const immutable = detail.enrollments.filter((item) => item.trackId !== trackId || item.admissionBatchId || item.status !== "planned")
      const rows = (payload.rows as Array<Record<string, unknown>> || []).map((row, index) => enrollment({
        id: String(row.id || `fixture-enrollment-${trackId}-${index + 1}`),
        trackId,
        classId: String(row.classId || ""),
        textbookId: row.textbookId ? String(row.textbookId) : null,
        classStartDate: row.classStartDate ? String(row.classStartDate) : null,
        classStartSessionKey: row.classStartSessionKey ? String(row.classStartSessionKey) : null,
        classStartSession: row.classStartSession ? String(row.classStartSession) : null,
        sortOrder: Number(row.sortOrder ?? index),
        status: "planned",
      }))
      detail.enrollments = [...immutable, ...rows]
      syncCase(state, detail)
      result = { trackId, rows }
      break
    }
    case "cancelRegistrationEnrollment": {
      const detail = requireCase(findCaseByEnrollmentId(state, asText(payload, "enrollmentId")), "enrollment_not_found")
      const selectedEnrollment = requireCase(detail.enrollments.find((item) => item.id === payload.enrollmentId), "enrollment_not_found")
      const selectedTrack = requireCase(detail.tracks.find((item) => item.id === selectedEnrollment.trackId), "track_not_found")
      selectedEnrollment.status = "canceled"
      selectedEnrollment.rosterActive = false
      selectedEnrollment.updatedAt = FIXTURE_NOW
      if (payload.destination) selectedTrack.status = payload.destination as OpsRegistrationTrackStatus
      selectedTrack.waitingKind = selectedTrack.status === "waiting" ? (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || "" : ""
      reconcileFixtureCurrentClassWait(state, detail, selectedTrack, selectedTrack.waitingKind, asText(payload, "classId"))
      syncCase(state, detail)
      result = { applied: true, enrollment: selectedEnrollment, track: selectedTrack }
      break
    }
    case "startRegistrationAdmissionBatch": {
      const taskId = asText(payload, "taskId")
      const detail = requireCase(state.caseDetails[taskId], "case_not_found")
      const enrollmentIds = new Set((payload.enrollmentIds as string[] || []).map(String))
      const revisionNumber = Math.max(0, ...detail.admissionBatches.map((item) => item.revisionNumber)) + 1
      const created = batch({ id: nextId(state, "batch"), taskId, revisionNumber, status: "draft" })
      detail.admissionBatches.push(created)
      const selectedEnrollments = detail.enrollments.filter((item) => enrollmentIds.has(item.id))
      selectedEnrollments.forEach((item) => { item.admissionBatchId = created.id; item.updatedAt = FIXTURE_NOW })
      const trackIds = Array.from(new Set((payload.trackIds as string[] || []).map(String)))
      detail.tracks.forEach((item) => { if (trackIds.includes(item.id)) item.status = "enrollment_processing" })
      syncCase(state, detail)
      result = { applied: true, batch: created, trackIds, enrollments: selectedEnrollments }
      break
    }
    case "setRegistrationEnrollmentMakeedu": {
      const detail = requireCase(findCaseByEnrollmentId(state, asText(payload, "enrollmentId")), "enrollment_not_found")
      const selectedEnrollment = requireCase(detail.enrollments.find((item) => item.id === payload.enrollmentId), "enrollment_not_found")
      selectedEnrollment.makeeduRegistered = Boolean(payload.registered)
      selectedEnrollment.updatedAt = FIXTURE_NOW
      syncCase(state, detail)
      result = { applied: true, enrollment: selectedEnrollment }
      break
    }
    case "advanceRegistrationAdmissionBatch": {
      const detail = requireCase(findCaseByBatchId(state, asText(payload, "batchId")), "batch_not_found")
      const selectedBatch = requireCase(detail.admissionBatches.find((item) => item.id === payload.batchId), "batch_not_found")
      if (payload.action === "invoice_sent") { selectedBatch.status = "invoiced"; selectedBatch.invoiceSentAt = FIXTURE_NOW }
      else { selectedBatch.status = "paid"; selectedBatch.paymentConfirmedAt = FIXTURE_NOW }
      selectedBatch.updatedAt = FIXTURE_NOW
      syncCase(state, detail)
      result = { applied: true, batch: selectedBatch }
      break
    }
    case "cancelRegistrationAdmissionBatch": {
      const detail = requireCase(findCaseByBatchId(state, asText(payload, "batchId")), "batch_not_found")
      const selectedBatch = requireCase(detail.admissionBatches.find((item) => item.id === payload.batchId), "batch_not_found")
      selectedBatch.status = "canceled"
      selectedBatch.updatedAt = FIXTURE_NOW
      const selectedEnrollments = detail.enrollments.filter((item) => item.admissionBatchId === selectedBatch.id)
      selectedEnrollments.forEach((item) => {
        item.status = "canceled"
        item.rosterActive = false
        item.updatedAt = FIXTURE_NOW
      })
      for (const resolution of (payload.resolutions as Array<Record<string, unknown>> || [])) {
        const selectedTrack = detail.tracks.find((item) => item.id === resolution.trackId)
        if (!selectedTrack) continue
        selectedTrack.status = resolution.destination as OpsRegistrationTrackStatus
        selectedTrack.waitingKind = selectedTrack.status === "waiting"
          ? (resolution.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || ""
          : ""
        reconcileFixtureCurrentClassWait(state, detail, selectedTrack, selectedTrack.waitingKind, asText(resolution, "classId"))
      }
      syncCase(state, detail)
      result = { applied: true, batch: selectedBatch, enrollments: selectedEnrollments }
      break
    }
    case "completeRegistrationAdmissionBatch": {
      const detail = requireCase(findCaseByBatchId(state, asText(payload, "batchId")), "batch_not_found")
      const selectedBatch = requireCase(detail.admissionBatches.find((item) => item.id === payload.batchId), "batch_not_found")
      selectedBatch.status = "completed"
      selectedBatch.updatedAt = FIXTURE_NOW
      const selectedEnrollments = detail.enrollments.filter((item) => item.admissionBatchId === selectedBatch.id)
      const trackIds = new Set(selectedEnrollments.map((item) => item.trackId))
      selectedEnrollments.forEach((item) => { item.status = "enrolled"; item.rosterActive = true; item.studentId = item.studentId || detail.task.studentId; item.updatedAt = FIXTURE_NOW })
      detail.tracks.forEach((item) => { if (trackIds.has(item.id)) item.status = "registered" })
      syncCase(state, detail)
      result = { batch: selectedBatch, enrollments: selectedEnrollments }
      break
    }
    case "resolveRegistrationMigrationReview": {
      const taskId = asText(payload, "taskId")
      const detail = requireCase(state.caseDetails[taskId], "case_not_found")
      const assignments = payload.assignments as Array<Record<string, unknown>> || []
      const trackStates = payload.trackStates as Array<Record<string, unknown>> || []
      detail.tracks.forEach((item) => {
        const assignment = assignments.find((entry) => entry.trackId === item.id)
        const nextState = trackStates.find((entry) => entry.trackId === item.id)
        const profile = state.optionData.profiles.find((entry) => entry.id === assignment?.directorProfileId)
        item.directorProfileId = assignment?.directorProfileId ? String(assignment.directorProfileId) : item.directorProfileId
        item.directorName = profile?.label || item.directorName
        item.directorAssignmentSource = "manual"
        item.migrationReviewRequired = false
        item.status = (nextState?.targetStatus as OpsRegistrationTrackStatus) || "consultation_waiting"
        item.waitingKind = item.status === "waiting"
          ? (nextState?.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || ""
          : ""
        reconcileFixtureCurrentClassWait(
          state,
          detail,
          item,
          item.waitingKind,
          nextState ? asText(nextState, "classId") : "",
        )
        item.stageEnteredAt = FIXTURE_NOW
        if (
          item.status === "consultation_waiting"
          && item.directorProfileId
          && !detail.consultations.some((consultation) => consultation.trackId === item.id && ["waiting", "scheduled"].includes(consultation.status))
        ) {
          detail.consultations.push({
            id: nextId(state, "consultation"),
            trackId: item.id,
            appointmentId: null,
            mode: "phone",
            status: "waiting",
            directorProfileId: item.directorProfileId,
            readyAt: FIXTURE_NOW,
            readySource: "migration",
            completedAt: null,
            outcome: null,
            createdAt: FIXTURE_NOW,
            updatedAt: FIXTURE_NOW,
          })
        }
      })
      detail.migrationLegacy = null
      syncCase(state, detail)
      result = { taskId, tracks: detail.tracks }
      break
    }
    case "reopenRegistrationTrack": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      const destination = asText(payload, "destination")
      const reason = asText(payload, "reason").trim()
      if (!reason) throw new Error("registration_reopen_reason_required")
      if (!(["inquiry", "consultation_waiting"] as string[]).includes(destination)) {
        throw new Error("registration_reopen_destination_invalid")
      }
      if (!["not_registered", "inquiry_closed"].includes(selected.status) || selected.migrationReviewRequired) {
        throw new Error("registration_invalid_source_state")
      }
      const hasOpenAdmissionBatch = detail.enrollments.some((item) => {
        if (item.trackId !== selected.id || !item.admissionBatchId) return false
        const admissionBatch = detail.admissionBatches.find((batchItem) => batchItem.id === item.admissionBatchId)
        return Boolean(admissionBatch && !["completed", "canceled"].includes(admissionBatch.status))
      })
      if (hasOpenAdmissionBatch) throw new Error("registration_open_admission_batch")

      const source = selected.status
      let consultationId: string | null = null
      if (destination === "consultation_waiting") {
        if (!selected.directorProfileId) throw new Error("registration_director_refresh_required")
        if (detail.consultations.some((item) => item.trackId === selected.id && ["waiting", "scheduled"].includes(item.status))) {
          throw new Error("registration_active_consultation_conflict")
        }
        consultationId = nextId(state, "consultation")
        detail.consultations.push({
          id: consultationId,
          trackId: selected.id,
          appointmentId: null,
          mode: "phone",
          status: "waiting",
          directorProfileId: selected.directorProfileId,
          readyAt: FIXTURE_NOW,
          readySource: "track_reopened",
          completedAt: null,
          outcome: null,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
        })
      }

      selected.status = destination as OpsRegistrationTrackStatus
      selected.waitingKind = ""
      selected.levelTestRetakeDecision = ""
      selected.migrationReviewRequired = false
      selected.stageEnteredAt = FIXTURE_NOW
      detail.events.push(createFixtureTrackEvent(state, {
        taskId: detail.task.id,
        trackId: selected.id,
        eventType: "track_reopened",
        subject: selected.subject,
        source,
        destination,
        reason,
        metadata: { consultationId },
      }))
      syncCase(state, detail)
      result = {
        ...transitionResult(selected),
        directorProfileId: selected.directorProfileId,
        consultationId,
      }
      break
    }
    case "sendRegistrationVisitNotificationTarget": {
      result = { warning: "", fixture: true }
      break
    }
    case "sendRegistrationAdmissionMessage": {
      const taskId = asText(payload, "taskId")
      const detail = requireCase(state.caseDetails[taskId], "case_not_found")
      detail.admissionApplicationMessageId = detail.admissionApplicationMessageId || nextId(state, "message")
      detail.admissionApplicationMessageStatus = "accepted"
      detail.admissionApplicationMessageClaimActive = false
      detail.admissionApplicationMessageUpdatedAt = FIXTURE_NOW
      detail.admissionApplicationAccepted = true
      detail.task.registration = { ...detail.task.registration, admissionNoticeSent: true }
      syncCase(state, detail)
      result = { ok: true, fixture: true, messageId: detail.admissionApplicationMessageId }
      break
    }
    case "checkRegistrationAdmissionMessage": {
      result = { ok: true, fixture: true }
      break
    }
    case "reconcileRegistrationAdmissionMessage": {
      const detail = requireCase(
        Object.values(state.caseDetails).find((item) => item.admissionApplicationMessageId === payload.messageId),
        "message_not_found",
      )
      detail.admissionApplicationMessageStatus = payload.resolution === "accepted" ? "accepted" : "failed_hold"
      detail.admissionApplicationMessageClaimActive = payload.resolution !== "accepted"
      detail.admissionApplicationAccepted = payload.resolution === "accepted"
      syncCase(state, detail)
      result = { ok: true, fixture: true }
      break
    }
    case "releaseRegistrationAdmissionMessageRetry": {
      const detail = requireCase(
        Object.values(state.caseDetails).find((item) => item.admissionApplicationMessageId === payload.messageId),
        "message_not_found",
      )
      detail.admissionApplicationMessageStatus = "failed_hold"
      detail.admissionApplicationMessageClaimActive = false
      syncCase(state, detail)
      result = { ok: true, fixture: true }
      break
    }
  }

  const receipt: RegistrationSubjectTrackFixtureReceipt = {
    action: type,
    requestKey: key,
    payloadFingerprint,
    result: clone(result),
  }
  state.receipts[key] = receipt
  return { state, result: clone(result), receipt: clone(receipt) }
}
