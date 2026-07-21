import type { LucideIcon } from "lucide-react"
import {
  BellRing,
  BookOpen,
  CalendarDays,
  CalendarClock,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  NotebookPen,
  Repeat2,
  Settings2,
  SpellCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react"

type NavSubItem = {
  title: string
  url: string
  isActive?: boolean
}

type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  target?: string
  items?: NavSubItem[]
}

type NavGroup = {
  label: string
  items: NavItem[]
}

export type AdminWorkspaceMeta = {
  section: string
  title: string
  summary: string
}

const defaultWorkspaceMeta: AdminWorkspaceMeta = {
  section: "운영 포털",
  title: "대시보드",
  summary: "오늘 운영 흐름과 핵심 워크스페이스 상태를 빠르게 점검합니다.",
}

const workspaceMetaEntries: Array<{
  match: string
  meta: AdminWorkspaceMeta
}> = [
  {
    match: "/admin/settings/notifications",
    meta: {
      section: "설정",
      title: "알림 설정",
      summary: "일곱 업무의 알림 규칙, 문구, 연결 상태를 한곳에서 관리합니다.",
    },
  },
  {
    match: "/admin/settings/schools",
    meta: {
      section: "설정",
      title: "학교 설정",
      summary: "학생 배정에 쓰는 학교 기준 정보를 바로 수정합니다.",
    },
  },
  {
    match: "/admin/settings/teachers",
    meta: {
      section: "설정",
      title: "선생님 설정",
      summary: "수업 배정에 쓰는 선생님 기준 정보를 바로 수정합니다.",
    },
  },
  {
    match: "/admin/settings/classrooms",
    meta: {
      section: "설정",
      title: "강의실 설정",
      summary: "수업 배정에 쓰는 강의실 기준 정보를 바로 수정합니다.",
    },
  },
  {
    match: "/admin/settings/class-groups",
    meta: {
      section: "설정",
      title: "기간 설정",
      summary: "시간표와 수업관리에 쓰는 기간 기준을 바로 수정합니다.",
    },
  },
  {
    match: "/admin/settings/terms",
    meta: {
      section: "설정",
      title: "기간 설정",
      summary: "시간표와 수업관리에 쓰는 기간 기준을 바로 수정합니다.",
    },
  },
  {
    match: "/admin/settings/textbook-suppliers",
    meta: {
      section: "설정",
      title: "교재 설정",
      summary: "교재 분류, 출판사별 총판 연결을 관리합니다.",
    },
  },
  {
    match: "/admin/settings",
    meta: {
      section: "설정",
      title: "설정",
      summary: "운영 기준값과 표 구성을 관리합니다.",
    },
  },
  {
    match: "/admin/academic-calendar/annual-board",
    meta: {
      section: "학사일정",
      title: "학교 연간 일정표",
      summary: "학교별 연간 이벤트와 시험 일정을 월별로 비교합니다.",
    },
  },
  {
    match: "/admin/academic-calendar",
    meta: {
      section: "학사일정",
      title: "캘린더",
      summary: "학교 일정과 운영 메모를 한 화면에서 정리합니다.",
    },
  },
  {
    match: "/admin/class-schedule",
    meta: {
      section: "수업일정",
      title: "수업일정",
      summary: "반 진행 상황, 기간, 최근 기록 메모를 빠르게 확인합니다.",
    },
  },
  {
    match: "/admin/timetable",
    meta: {
      section: "시간표",
      title: "시간표 비교 뷰",
      summary: "교사·강의실 축으로 운영 겹침과 주간 흐름을 점검합니다.",
    },
  },
  {
    match: "/admin/curriculum/lesson-design",
    meta: {
      section: "수업계획",
      title: "수업 설계",
      summary: "월별 회차 생성, 휴강, 보강 일정을 바로 조정합니다.",
    },
  },
  {
    match: "/admin/class-schedule/lesson-design",
    meta: {
      section: "수업계획",
      title: "수업 설계",
      summary: "월별 회차 생성, 휴강, 보강 일정을 바로 조정합니다.",
    },
  },
  {
    match: "/admin/curriculum",
    meta: {
      section: "수업계획",
      title: "수업계획",
      summary: "수업 일정과 교재 진도를 연결해 회차별 계획을 관리합니다.",
    },
  },
  {
    match: "/admin/students",
    meta: {
      section: "관리",
      title: "학생관리",
      summary: "학생 정보, 등록반, 대기반 상태를 운영 흐름 기준으로 정리합니다.",
    },
  },
  {
    match: "/admin/schools",
    meta: {
      section: "설정",
      title: "학교 설정",
      summary: "학생 배정에 쓰는 학교 기준 정보를 바로 수정합니다.",
    },
  },
  {
    match: "/admin/teachers",
    meta: {
      section: "설정",
      title: "선생님 설정",
      summary: "수업 배정에 쓰는 선생님 기준 정보를 바로 수정합니다.",
    },
  },
  {
    match: "/admin/classrooms",
    meta: {
      section: "설정",
      title: "강의실 설정",
      summary: "수업 배정에 쓰는 강의실 기준 정보를 바로 수정합니다.",
    },
  },
  {
    match: "/admin/terms",
    meta: {
      section: "설정",
      title: "기간 설정",
      summary: "시간표와 수업관리에 쓰는 기간 기준을 바로 수정합니다.",
    },
  },
  {
    match: "/admin/classes",
    meta: {
      section: "관리",
      title: "수업관리",
      summary: "수업 기본정보와 학생 배정 상태를 관리합니다.",
    },
  },
  {
    match: "/admin/textbooks",
    meta: {
      section: "관리",
      title: "교재관리",
      summary: "교재 메타와 차시 구성을 운영 관점에서 유지보수합니다.",
    },
  },
  {
    match: "/admin/registration",
    meta: {
      section: "운영",
      title: "등록",
      summary: "문의부터 등록완료까지 등록 흐름만 처리합니다.",
    },
  },
  {
    match: "/admin/transfer",
    meta: {
      section: "운영",
      title: "전반",
      summary: "전 수업과 후 수업을 연결해 전반 업무를 처리합니다.",
    },
  },
  {
    match: "/admin/withdrawal",
    meta: {
      section: "운영",
      title: "퇴원",
      summary: "퇴원일, 사유, 메이크에듀 처리와 비용 체크를 정리합니다.",
    },
  },
  {
    match: "/admin/word-retests",
    meta: {
      section: "운영",
      title: "영어 단어 재시험",
      summary: "본관과 별관 단어 재시험 요청, 응시, 점수를 처리합니다.",
    },
  },
  {
    match: "/admin/makeup-requests",
    meta: {
      section: "운영",
      title: "휴보강",
      summary: "휴강 신청부터 보강 강의실 확인, 결재, 관리팀 최종 반영까지 처리합니다.",
    },
  },
  {
    match: "/admin/approvals",
    meta: {
      section: "운영",
      title: "전자결재",
      summary: "월간 보고서 제출과 결재 대기 문서를 처리합니다.",
    },
  },
  {
    match: "/admin/tasks",
    meta: {
      section: "운영",
      title: "할 일",
      summary: "받은함, 보낸함, 완료 큐로 팀 할 일의 다음 액션을 정리합니다.",
    },
  },
  {
    match: "/admin/dashboard",
    meta: defaultWorkspaceMeta,
  },
]

export function resolveAdminWorkspaceMeta(pathname: string): AdminWorkspaceMeta {
  return workspaceMetaEntries.find((entry) => pathname.startsWith(entry.match))?.meta ?? defaultWorkspaceMeta
}

export function buildAdminNavGroups({
  canManageAll,
  canEditCurriculumPlanning,
  canUseAssistantOperations = false,
}: {
  canManageAll: boolean
  canEditCurriculumPlanning: boolean
  canUseAssistantOperations?: boolean
}): NavGroup[] {
  const assistantOverviewItems: NavItem[] = [
    {
      title: "할 일",
      url: "/admin/tasks",
      icon: ClipboardCheck,
      items: [
        { title: "받은함", url: "/admin/tasks?list=inbox" },
        { title: "보낸함", url: "/admin/tasks?list=sent" },
        { title: "완료", url: "/admin/tasks?list=completed" },
      ],
    },
    { title: "영어 단어 재시험", url: "/admin/word-retests", icon: SpellCheck },
    {
      title: "학사일정",
      url: "/admin/academic-calendar",
      icon: CalendarDays,
      items: [
        { title: "캘린더", url: "/admin/academic-calendar" },
        { title: "학교 연간 일정표", url: "/admin/academic-calendar/annual-board" },
      ],
    },
    { title: "시간표", url: "/admin/timetable", icon: LayoutGrid },
  ]
  const fullOverviewItems: NavItem[] = [
    { title: "대시보드", url: "/admin/dashboard", icon: LayoutDashboard },
    {
      title: "할 일",
      url: "/admin/tasks",
      icon: ClipboardCheck,
      items: [
        { title: "받은함", url: "/admin/tasks?list=inbox" },
        { title: "보낸함", url: "/admin/tasks?list=sent" },
        { title: "완료", url: "/admin/tasks?list=completed" },
      ],
    },
    { title: "영어 단어 재시험", url: "/admin/word-retests", icon: SpellCheck },
    { title: "등록", url: "/admin/registration", icon: UserPlus },
    { title: "전반", url: "/admin/transfer", icon: Repeat2 },
    { title: "퇴원", url: "/admin/withdrawal", icon: UserMinus },
    { title: "휴보강", url: "/admin/makeup-requests", icon: CalendarClock },
    { title: "전자결재", url: "/admin/approvals", icon: FileCheck2 },
    {
      title: "학사일정",
      url: "/admin/academic-calendar",
      icon: CalendarDays,
      items: [
        { title: "캘린더", url: "/admin/academic-calendar" },
        { title: "학교 연간 일정표", url: "/admin/academic-calendar/annual-board" },
      ],
    },
    { title: "시간표", url: "/admin/timetable", icon: LayoutGrid },
  ]
  const overview: NavGroup = {
    label: "운영",
    items: canUseAssistantOperations ? assistantOverviewItems : fullOverviewItems,
  }

  const managementItems: NavItem[] = []

  if (canEditCurriculumPlanning) {
    managementItems.push({
      title: "수업계획",
      url: "/admin/curriculum",
      icon: NotebookPen,
    })
  }

  if (canManageAll) {
    managementItems.push(
      {
        title: "학생관리",
        url: "/admin/students",
        icon: Users,
      },
      {
        title: "수업관리",
        url: "/admin/classes",
        icon: GraduationCap,
      },
      { title: "교재관리", url: "/admin/textbooks", icon: BookOpen },
    )
  }

  const groups: NavGroup[] = [overview]

  if (managementItems.length > 0) {
    groups.push({
      label: "관리",
      items: managementItems,
    })
  }

  if (canManageAll) {
    groups.push({
      label: "설정",
      items: [
        {
          title: "환경 설정",
          url: "/admin/settings/schools",
          icon: Settings2,
          items: [
            { title: "학교 설정", url: "/admin/settings/schools" },
            { title: "선생님 설정", url: "/admin/settings/teachers" },
            { title: "강의실 설정", url: "/admin/settings/classrooms" },
            { title: "기간 설정", url: "/admin/settings/class-groups" },
            { title: "교재 설정", url: "/admin/settings/textbook-suppliers" },
          ],
        },
        {
          title: "알림 설정",
          url: "/admin/settings/notifications",
          icon: BellRing,
        },
      ],
    })
  }

  return groups
}
