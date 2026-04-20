import type { LucideIcon } from "lucide-react"
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  NotebookPen,
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
      title: "수업일정 워크스페이스",
      summary: "반 진행 상황, 동기 그룹, 최근 기록 메모를 빠르게 확인합니다.",
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
    match: "/admin/curriculum",
    meta: {
      section: "수업계획",
      title: "커리큘럼 운영",
      summary: "진행 회차와 최근 기록 메모를 바탕으로 업데이트 대기 구간을 확인합니다.",
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
    match: "/admin/classes",
    meta: {
      section: "관리",
      title: "수업관리",
      summary: "반 편성, 교재 연결, 진행 상태를 한 흐름으로 점검합니다.",
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
    match: "/admin/manual",
    meta: {
      section: "사용설명",
      title: "사용설명서",
      summary: "운영 화면 구조와 주요 워크스페이스 이동 경로를 확인합니다.",
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
}: {
  canManageAll: boolean
  canEditCurriculumPlanning: boolean
}): NavGroup[] {
  const overview: NavGroup = {
    label: "운영",
    items: [
      { title: "대시보드", url: "/admin/dashboard", icon: LayoutDashboard },
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
    ],
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
      { title: "학생관리", url: "/admin/students", icon: Users },
      { title: "수업관리", url: "/admin/classes", icon: GraduationCap },
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

  return groups
}
