import type {
  OpsTask,
  OpsTaskWorkspaceData,
} from "./ops-task-service"

export const WORD_RETEST_BROWSER_FIXTURE_QUERY = "word-retest-expected-schedule"
export const WORD_RETEST_BROWSER_FIXTURE_ROLES = ["assistant", "teacher", "admin"] as const

export type WordRetestBrowserFixtureRole = (typeof WORD_RETEST_BROWSER_FIXTURE_ROLES)[number]

export type WordRetestBrowserFixtureViewer = {
  viewerId: string
  viewerRole: WordRetestBrowserFixtureRole
}

const VIEWERS: Record<WordRetestBrowserFixtureRole, WordRetestBrowserFixtureViewer> = {
  assistant: { viewerId: "fixture-assistant-profile", viewerRole: "assistant" },
  teacher: { viewerId: "fixture-teacher-profile", viewerRole: "teacher" },
  admin: { viewerId: "fixture-admin-profile", viewerRole: "admin" },
}

function createTask(
  id: string,
  overrides: Pick<OpsTask, "status" | "studentId" | "studentName" | "classId" | "className">
    & Partial<Pick<OpsTask, "requestedBy" | "memo" | "wordRetest">>,
): OpsTask {
  const createdAt = "2026-07-20T01:00:00.000Z"
  return {
    id,
    title: `영어 단어 재시험: ${overrides.studentName}`,
    type: "word_retest",
    status: overrides.status,
    priority: "normal",
    requestedBy: overrides.requestedBy || "fixture-teacher-profile",
    requestedByLabel: "연결 선생님",
    requestedTeam: "영어팀",
    assigneeId: "fixture-assistant-profile",
    assigneeLabel: "Fixture 조교",
    assigneeTeam: "조교팀",
    secondaryAssigneeId: "",
    secondaryAssigneeLabel: "",
    studentId: overrides.studentId,
    studentName: overrides.studentName,
    classId: overrides.classId,
    className: overrides.className,
    textbookId: "fixture-textbook-vocabulary",
    textbookTitle: "Fixture 어휘 교재",
    campus: "본관",
    subject: "영어",
    startAt: "",
    dueAt: "",
    completedAt: overrides.status === "done" ? "2026-07-22T10:00:00.000Z" : "",
    memo: overrides.memo || "",
    createdAt,
    updatedAt: "2026-07-22T12:34:56.000Z",
    wordRetest: overrides.wordRetest || {
      branch: "본관",
      teacherId: "fixture-teacher-catalog-linked",
      teacherName: "연결 선생님",
      className: overrides.className,
      studentName: overrides.studentName,
      testAt: "2026-07-21T09:00:00+09:00",
      expectedRetestAt: "2026-07-24T09:00:00+09:00",
      textbookName: "Fixture 어휘 교재",
      unit: "Unit 7",
      requestNote: "사전 준비가 필요한 학생",
      totalQuestionCount: "30",
      cutoffQuestionCount: "27",
      firstScore: "",
      secondScore: "",
      thirdScore: "",
      retestStatus: "not_started",
    },
    comments: [],
    attachments: [],
    events: [],
  }
}

function buildFixtureData(role: WordRetestBrowserFixtureRole): OpsTaskWorkspaceData {
  const linkedAssistantStage = createTask("fixture-word-retest-assistant-stage", {
    status: "requested",
    studentId: "fixture-student-linked",
    studentName: "김연결",
    classId: "fixture-class-with-schedule",
    className: "영어 어휘 A",
  })
  if (role === "teacher") {
    linkedAssistantStage.wordRetest = {
      ...linkedAssistantStage.wordRetest,
      testAt: "2026-07-01T09:00:00+09:00",
    }
  }

  const linkedTeacherStage = createTask("fixture-word-retest-teacher-stage", {
    status: "review_requested",
    studentId: "fixture-student-legacy-note",
    studentName: "이메모",
    classId: "fixture-class-without-schedule",
    className: "영어 어휘 B",
    memo: "기존 업무 메모에서 표시",
    wordRetest: {
      branch: "별관",
      teacherId: "fixture-teacher-catalog-linked",
      teacherName: "연결 선생님",
      className: "영어 어휘 B",
      studentName: "이메모",
      testAt: "2026-07-22T09:00:00+09:00",
      expectedRetestAt: "",
      textbookName: "Fixture 어휘 교재",
      unit: "Unit 8",
      requestNote: "",
      totalQuestionCount: "20",
      cutoffQuestionCount: "18",
      firstScore: "17",
      secondScore: "",
      thirdScore: "",
      retestStatus: "done",
    },
  })

  const completed = createTask("fixture-word-retest-completed", {
    status: "done",
    studentId: "fixture-student-completed",
    studentName: "박완료",
    classId: "fixture-class-with-schedule",
    className: "영어 어휘 A",
    wordRetest: {
      branch: "본관",
      teacherId: "fixture-teacher-catalog-linked",
      teacherName: "연결 선생님",
      className: "영어 어휘 A",
      studentName: "박완료",
      testAt: "2026-07-18T09:00:00+09:00",
      expectedRetestAt: "2026-07-21T09:00:00+09:00",
      textbookName: "Fixture 어휘 교재",
      unit: "Unit 6",
      requestNote: "완료 업무 메모",
      totalQuestionCount: "30",
      cutoffQuestionCount: "27",
      firstScore: "29",
      secondScore: "",
      thirdScore: "",
      retestStatus: "done",
    },
  })

  const completedFailed = createTask("fixture-word-retest-completed-failed", {
    status: "done",
    studentId: "fixture-student-completed-failed",
    studentName: "최불합격완료",
    classId: "fixture-class-with-schedule",
    className: "영어 어휘 A",
    wordRetest: {
      branch: "본관",
      teacherId: "fixture-teacher-catalog-linked",
      teacherName: "연결 선생님",
      className: "영어 어휘 A",
      studentName: "최불합격완료",
      testAt: "2026-07-19T09:00:00+09:00",
      expectedRetestAt: "2026-07-22T19:30:00+09:00",
      textbookName: "Fixture 어휘 교재",
      unit: "Unit 6 재시험",
      requestNote: "완료 뒤 재재시험 추가 확인용",
      totalQuestionCount: "30",
      cutoffQuestionCount: "27",
      firstScore: "24",
      secondScore: "",
      thirdScore: "",
      retestStatus: "done",
    },
  })

  const nameOnlyUnrelated = createTask("fixture-word-retest-name-only", {
    status: "requested",
    studentId: "fixture-student-unrelated",
    studentName: "최비연결",
    classId: "fixture-class-with-schedule",
    className: "영어 어휘 A",
    requestedBy: "fixture-other-profile",
    wordRetest: {
      branch: "본관",
      teacherId: "fixture-teacher-catalog-unrelated",
      teacherName: "연결 선생님",
      className: "영어 어휘 A",
      studentName: "최비연결",
      testAt: "2026-07-23T09:00:00+09:00",
      expectedRetestAt: "2026-07-25T10:20:00+09:00",
      textbookName: "Fixture 어휘 교재",
      unit: "Unit 9",
      requestNote: "이름만 같은 비연결 업무",
      totalQuestionCount: "30",
      cutoffQuestionCount: "27",
      retestStatus: "not_started",
    },
  })

  return {
    tasks: [linkedAssistantStage, linkedTeacherStage, completed, completedFailed, nameOnlyUnrelated],
    profiles: [
      { id: "fixture-admin-profile", label: "Fixture 관리자", email: "admin@fixture.invalid", loginId: "fixture-admin", role: "admin" },
      { id: "fixture-assistant-profile", label: "Fixture 조교", email: "assistant@fixture.invalid", loginId: "fixture-assistant", role: "assistant" },
      { id: "fixture-teacher-profile", label: "연결 선생님", email: "teacher@fixture.invalid", loginId: "fixture-teacher", role: "teacher" },
      { id: "fixture-other-profile", label: "연결 선생님", email: "other@fixture.invalid", loginId: "fixture-other", role: "teacher" },
    ],
    students: [
      { id: "fixture-student-linked", label: "김연결", grade: "고1", school: "새봄고", contact: "", parentContact: "", status: "재원", classIds: ["fixture-class-with-schedule"], waitlistClassIds: [] },
      { id: "fixture-student-legacy-note", label: "이메모", grade: "고1", school: "새봄고", contact: "", parentContact: "", status: "재원", classIds: ["fixture-class-without-schedule"], waitlistClassIds: [] },
      { id: "fixture-student-completed", label: "박완료", grade: "고1", school: "새봄고", contact: "", parentContact: "", status: "재원", classIds: ["fixture-class-with-schedule"], waitlistClassIds: [] },
      { id: "fixture-student-completed-failed", label: "최불합격완료", grade: "고1", school: "새봄고", contact: "", parentContact: "", status: "재원", classIds: ["fixture-class-with-schedule"], waitlistClassIds: [] },
      { id: "fixture-student-unrelated", label: "최비연결", grade: "고1", school: "새봄고", contact: "", parentContact: "", status: "재원", classIds: ["fixture-class-with-schedule"], waitlistClassIds: [] },
    ],
    classes: [
      {
        id: "fixture-class-with-schedule",
        label: "영어 어휘 A",
        subject: "영어",
        grade: "고1",
        teacher: "연결 선생님",
        room: "본관 2강",
        schedule: "화목 18:00-20:00",
        schedulePlan: {
          sessions: [
            { date: "2026-07-21", sessionNumber: 7, state: "active" },
            { date: "2026-07-23", sessionNumber: 8, state: "active" },
            { date: "2026-07-28", sessionNumber: 9, state: "makeup" },
          ],
        },
        studentIds: ["fixture-student-linked", "fixture-student-completed", "fixture-student-completed-failed", "fixture-student-unrelated"],
        waitlistIds: [],
        textbookIds: ["fixture-textbook-vocabulary"],
      },
      {
        id: "fixture-class-without-schedule",
        label: "영어 어휘 B",
        subject: "영어",
        grade: "고1",
        teacher: "연결 선생님",
        room: "별관 3강",
        schedule: "",
        schedulePlan: null,
        studentIds: ["fixture-student-legacy-note"],
        waitlistIds: [],
        textbookIds: ["fixture-textbook-vocabulary"],
      },
    ],
    textbooks: [
      { id: "fixture-textbook-vocabulary", label: "Fixture 어휘 교재", publisher: "Fixture 출판", subject: "영어 어휘" },
    ],
    teachers: [
      {
        id: "fixture-teacher-catalog-linked",
        label: "연결 선생님",
        subjects: ["영어"],
        profileId: "fixture-teacher-profile",
        accountEmail: "teacher@fixture.invalid",
        sortOrder: 1,
      },
      {
        id: "fixture-teacher-catalog-unrelated",
        label: "연결 선생님",
        subjects: ["영어"],
        profileId: "fixture-other-profile",
        accountEmail: "other@fixture.invalid",
        sortOrder: 2,
      },
    ],
    schemaReady: true,
    error: null,
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item))
  return Object.freeze(value)
}

export function shouldEnableWordRetestBrowserFixture(
  fixtureValue: string | null | undefined,
  fixtureRole: string | null | undefined,
) {
  return fixtureValue === WORD_RETEST_BROWSER_FIXTURE_QUERY
    && WORD_RETEST_BROWSER_FIXTURE_ROLES.includes(fixtureRole as WordRetestBrowserFixtureRole)
}

export function resolveWordRetestBrowserFixtureViewer(
  fixtureRole: string | null | undefined,
): WordRetestBrowserFixtureViewer | null {
  if (!WORD_RETEST_BROWSER_FIXTURE_ROLES.includes(fixtureRole as WordRetestBrowserFixtureRole)) return null
  return { ...VIEWERS[fixtureRole as WordRetestBrowserFixtureRole] }
}

export function getWordRetestBrowserFixtureData(
  fixtureRole: WordRetestBrowserFixtureRole,
): OpsTaskWorkspaceData {
  const clone = JSON.parse(JSON.stringify(buildFixtureData(fixtureRole))) as OpsTaskWorkspaceData
  return deepFreeze(clone)
}
