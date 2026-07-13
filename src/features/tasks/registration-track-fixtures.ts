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
  OpsRegistrationAdmissionBatch,
  OpsRegistrationAppointment,
  OpsRegistrationCaseDetail,
  OpsRegistrationConsultation,
  OpsRegistrationEnrollment,
  OpsRegistrationLevelTest,
  OpsRegistrationTrackStatus,
  OpsRegistrationTrackSummary,
  RegistrationSubject,
} from "./registration-track-service"
import type { RegistrationSubjectTrackFixtureAdapter } from "./registration-track-fixture-runtime"

const FIXTURE_NOW = "2026-07-13T09:00:00+09:00"

export const REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS = [
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
] as const

export type RegistrationSubjectTrackFixtureAction = typeof REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS[number]
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
  return {
    executeAction: <T = unknown>(type: string, payload: Record<string, unknown>) => {
      const outcome = reduceRegistrationSubjectTrackFixture(runtime.getState(), {
        type,
        requestKey: String(payload.requestKey || ""),
        payload,
      })
      runtime.replaceState(outcome.state)
      return Promise.resolve(outcome.result as T)
    },
    loadCase: (taskId) => {
      const detail = getRegistrationSubjectTrackFixtureCase(runtime.getState(), taskId)
      if (!detail) return Promise.reject(new Error("registration_subject_track_fixture_case_not_found"))
      return Promise.resolve(detail)
    },
    loadWorkspaceData: () => Promise.resolve(clone(runtime.getState().workspaceData)),
    loadOptionData: () => Promise.resolve(clone(runtime.getState().optionData)),
    loadClassDetails: (classIds) => Promise.resolve(getRegistrationSubjectTrackFixtureClassDetails(runtime.getState(), classIds)),
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
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
}): OpsRegistrationTrackSummary {
  return {
    id: input.id,
    taskId: input.taskId,
    subject: input.subject,
    status: input.status,
    legacy: false,
    directorProfileId: input.directorProfileId ?? (input.subject === "영어" ? "fixture-profile-english-director" : "fixture-profile-math-director"),
    directorName: input.directorName ?? (input.subject === "영어" ? "강부희" : "양소윤"),
    directorAssignmentSource: input.migrationReviewRequired ? "migration" : "default",
    directorAssignmentRuleKey: input.migrationReviewRequired ? "" : `academic-director-v1:2026:${input.subject}:고1`,
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: Boolean(input.migrationReviewRequired),
    stageEnteredAt: input.stageEnteredAt || "2026-07-12T10:00:00+09:00",
    phoneReadyAt: null,
    phoneReadySource: null,
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
      readyAt: null,
      readySource: null,
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
    readyAt: null,
    readySource: null,
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
    [splitTaskId]: caseDetail({ task: splitTask, tracks: splitTracks, appointments: [visitAppointment], consultations: splitConsultations }),
    [crossStageTaskId]: caseDetail({ task: crossStageTask, tracks: crossStageTracks, appointments: [crossStageAppointment], levelTests: [crossStageAttempt], consultations: [crossStageConsultation] }),
    [partialTaskId]: caseDetail({ task: partialTask, tracks: partialTracks, admissionBatches: [completedAdmission, openAdmission], enrollments: partialEnrollments }),
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
      { name: "split visit and phone consultation", taskId: "fixture-task-split-consultation" },
      { name: "independent consultation and level-test stages", taskId: "fixture-task-cross-stage" },
      { name: "partial registration with later batch", taskId: "fixture-task-partial-registration" },
      { name: "multiple English classes", taskId: "fixture-task-multiple-classes" },
      { name: "enrollment decided add-button", taskId: "fixture-task-enrollment-decided" },
      { name: "admission panel with non-enrollment sibling", taskId: "fixture-task-admission-sibling" },
      { name: "migration review", taskId: "fixture-task-migration-review" },
    ],
    receipts: {},
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

function syncCase(state: RegistrationSubjectTrackFixtureState, detail: OpsRegistrationCaseDetail) {
  detail.task.registrationTracks = detail.tracks
  detail.task.subject = detail.tracks.map((item) => item.subject).join(", ")
  detail.task.updatedAt = FIXTURE_NOW
  state.caseDetails[detail.task.id] = detail
  state.workspaceData.tasks = state.workspaceData.tasks.map((task) => task.id === detail.task.id ? detail.task : task)
}

function nextId(state: RegistrationSubjectTrackFixtureState, kind: string) {
  state.sequence += 1
  return `fixture-${kind}-${String(state.sequence).padStart(3, "0")}`
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

export function reduceRegistrationSubjectTrackFixture(
  current: RegistrationSubjectTrackFixtureState,
  command: RegistrationSubjectTrackFixtureCommand,
): RegistrationSubjectTrackFixtureOutcome {
  if (!REGISTRATION_SUBJECT_TRACK_FIXTURE_ACTIONS.includes(command.type as RegistrationSubjectTrackFixtureAction)) {
    throw new Error("registration_subject_track_fixture_unsupported_action")
  }
  const type = command.type as RegistrationSubjectTrackFixtureAction
  const key = receiptKey(command)
  const payloadFingerprint = fixturePayloadFingerprint(command.payload || {})
  const existing = current.receipts[key]
  if (existing) {
    if (existing.action !== type || existing.payloadFingerprint !== payloadFingerprint) {
      throw new Error("registration_subject_track_fixture_request_key_conflict")
    }
    return { state: current, result: clone(existing.result), receipt: clone(existing) }
  }

  const state = clone(current)
  const payload = clone(command.payload || {})
  let result: unknown

  switch (type) {
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
      selected.stageEnteredAt = FIXTURE_NOW
      if (selected.status === "consultation_waiting") {
        detail.consultations.push({
          id: nextId(state, "consultation"),
          trackId: selected.id,
          appointmentId: null,
          mode: "phone",
          status: "waiting",
          directorProfileId: selected.directorProfileId || "",
          readyAt: null,
          readySource: null,
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
              readyAt: null,
              readySource: null,
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
            detail.consultations.push({ id: nextId(state, "consultation"), trackId, appointmentId: null, mode: "phone", status: "waiting", directorProfileId: selected.directorProfileId, readyAt: null, readySource: null, completedAt: null, outcome: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW })
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
      result = { appointmentId: appointment.id, notificationRevision: appointment.notificationRevision, notificationTargets: appointment.kind === "visit_consultation" ? [{ appointmentId: appointment.id, notificationRevision: appointment.notificationRevision }] : [], requiresDirectorAssignmentTrackIds }
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
        const consultation: OpsRegistrationConsultation = { id: nextId(state, "consultation"), trackId: selected.id, appointmentId: null, mode: "phone", status: "waiting", directorProfileId: selected.directorProfileId || "", readyAt: null, readySource: null, completedAt: null, outcome: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW }
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
      selected.stageEnteredAt = FIXTURE_NOW
      syncCase(state, detail)
      result = { consultation, track: selected }
      break
    }
    case "transitionRegistrationWaiting": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      const action = asText(payload, "action")
      if (action === "change_waiting_kind") selected.waitingKind = (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || ""
      if (action === "record_retest_required") {
        selected.levelTestRetakeDecision = (payload.retakeDecision as OpsRegistrationTrackSummary["levelTestRetakeDecision"]) || "required"
        if (selected.levelTestRetakeDecision === "required") selected.status = "inquiry"
      }
      if (action === "move_to_enrollment") selected.status = "enrollment_decided"
      if (action === "close_not_registered") selected.status = "not_registered"
      selected.stageEnteredAt = FIXTURE_NOW
      syncCase(state, detail)
      result = transitionResult(selected)
      break
    }
    case "routeRegistrationEnrollmentDecision": {
      const detail = requireCase(findCaseByTrackId(state, asText(payload, "trackId")), "track_not_found")
      const selected = requireCase(detail.tracks.find((item) => item.id === payload.trackId), "track_not_found")
      selected.status = payload.destination as OpsRegistrationTrackStatus
      selected.waitingKind = selected.status === "waiting" ? (payload.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || "" : ""
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
      selectedEnrollments.forEach((item) => { item.admissionBatchId = null; item.updatedAt = FIXTURE_NOW })
      for (const resolution of (payload.resolutions as Array<Record<string, unknown>> || [])) {
        const selectedTrack = detail.tracks.find((item) => item.id === resolution.trackId)
        if (!selectedTrack) continue
        selectedTrack.status = resolution.destination as OpsRegistrationTrackStatus
        selectedTrack.waitingKind = (resolution.waitingKind as OpsRegistrationTrackSummary["waitingKind"]) || ""
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
            readyAt: null,
            readySource: null,
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
