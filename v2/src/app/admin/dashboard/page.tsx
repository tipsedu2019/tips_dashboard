"use client"

import Link from "next/link"
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  Clock3,
  GraduationCap,
  NotebookPen,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTipsDashboardMetrics } from "@/hooks/use-tips-dashboard-metrics"

import { SectionCards } from "./components/section-cards"

type DashboardMetrics = ReturnType<typeof useTipsDashboardMetrics>

type BriefingCard = {
  title: string
  description: string
}

type WorkspaceLink = {
  href: string
  title: string
  description: string
  summary: string
}

const workspaceLinks: WorkspaceLink[] = [
  {
    href: "/admin/class-schedule",
    title: "수업일정 워크스페이스",
    description: "진도 기록과 실제 회차 반영 상태를 한 화면에서 점검합니다.",
    summary: "업데이트 대기 회차와 동기 그룹 흐름을 확인합니다.",
  },
  {
    href: "/admin/curriculum",
    title: "커리큘럼 워크스페이스",
    description: "계획·진도 데이터와 최근 기록 메모를 함께 확인합니다.",
    summary: "반별 계획 범위와 업데이트 공백을 빠르게 점검합니다.",
  },
  {
    href: "/admin/timetable",
    title: "시간표 운영",
    description: "교사·강의실·반 기준 비교 뷰를 통해 배치 상태를 검토합니다.",
    summary: "주간 운영 맥락과 시간표 충돌 가능성을 확인합니다.",
  },
  {
    href: "/admin/academic-calendar",
    title: "학사일정 운영",
    description: "학사 이벤트와 연간 일정판을 같은 기준으로 점검합니다.",
    summary: "운영 일정 변경과 학교 이벤트 연결 상태를 확인합니다.",
  },
  {
    href: "/admin/students",
    title: "학생 관리",
    description: "학생 배정, 등록 상태, 반 연결 흐름을 점검합니다.",
    summary: "운영 목록에서 학생 배정과 등록 현황을 함께 봅니다.",
  },
  {
    href: "/admin/textbooks",
    title: "교재 관리",
    description: "교재 연결 상태와 운영 준비도를 점검합니다.",
    summary: "수업별 교재 연결과 차시 준비 상태를 확인합니다.",
  },
]

function buildBriefingCards(metrics: DashboardMetrics): BriefingCard[] {
  if (metrics.isLoading) {
    return [
      {
        title: "운영 상태 요약",
        description: "실시간 운영 지표를 확인하는 중입니다.",
      },
      {
        title: "현재 운영 스냅샷",
        description: "수업·학생·교재·진도 흐름을 최신 상태로 다시 집계하고 있습니다.",
      },
      {
        title: "오늘의 운영 포인트",
        description: "연결 확인이 끝나면 핵심 워크스페이스 우선순위를 바로 검토할 수 있습니다.",
      },
    ]
  }

  if (metrics.error || !metrics.isConnected) {
    return [
      {
        title: "운영 상태 요약",
        description: metrics.error || "운영 데이터 연결 상태를 다시 확인해야 합니다.",
      },
      {
        title: "현재 운영 스냅샷",
        description: "학사일정, 수업일정, 관리 목록 연결 상태를 우선 점검할 시점입니다.",
      },
      {
        title: "오늘의 운영 포인트",
        description: "Supabase 연결과 읽기 권한 상태를 확인한 뒤 핵심 워크스페이스를 다시 열어 주세요.",
      },
    ]
  }

  const busiestArea = [
    { label: "수업", value: metrics.activeClassesCount },
    { label: "학생", value: metrics.studentsCount },
    { label: "교재", value: metrics.textbooksCount },
    { label: "진도 기록", value: metrics.progressLogsCount },
  ].sort((left, right) => right.value - left.value)[0]

  return [
    {
      title: "운영 상태 요약",
      description: `${metrics.activeClassesCount.toLocaleString("ko-KR")}개 수업과 ${metrics.studentsCount.toLocaleString("ko-KR")}명 학생 기준으로 운영 현황을 집계했습니다.`,
    },
    {
      title: "현재 운영 스냅샷",
      description: `${metrics.progressLogsCount.toLocaleString("ko-KR")}건 진도 기록과 ${metrics.textbooksCount.toLocaleString("ko-KR")}권 교재 데이터를 같은 기준으로 보고 있습니다.`,
    },
    {
      title: "오늘의 운영 포인트",
      description: `${busiestArea.label} 데이터가 가장 크게 반영되어 있어 관련 워크스페이스를 먼저 확인하면 좋습니다.`,
    },
  ]
}

function getWorkspaceIcon(href: string) {
  switch (href) {
    case "/admin/class-schedule":
      return Clock3
    case "/admin/curriculum":
      return BookOpenCheck
    case "/admin/timetable":
      return GraduationCap
    case "/admin/academic-calendar":
      return CalendarDays
    case "/admin/students":
      return Users
    case "/admin/textbooks":
      return ClipboardList
    default:
      return NotebookPen
  }
}

export default function Page() {
  const metrics = useTipsDashboardMetrics()
  const briefingCards = buildBriefingCards(metrics)

  return (
    <div className="space-y-6 px-4 pb-6 lg:px-6">
      <section className="space-y-4 rounded-2xl border border-border/70 bg-background/95 p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">오늘의 운영 브리핑</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                운영 현황, 일정, 수업 데이터를 한 곳에서 빠르게 확인하고 관리합니다.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">운영 기준 메모</p>
            <p className="mt-1">대시보드는 전체 요약만 유지하고 실제 작업은 각 워크스페이스에서 이어집니다.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {briefingCards.map((item) => (
            <Card key={item.title} className="border-border/70 bg-background/90 shadow-none">
              <CardHeader className="gap-2">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription className="text-sm leading-6">{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <SectionCards metrics={metrics} />

      <section className="space-y-4">
        <div className="space-y-2">
          <Badge variant="outline">관리자 전용 동선</Badge>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">운영 워크스페이스 바로가기</h2>
            <p className="text-sm text-muted-foreground">핵심 운영 화면만 바로 열 수 있도록 정리했습니다.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaceLinks.map((item) => {
            const Icon = getWorkspaceIcon(item.href)

            return (
              <Card key={item.href} className="border-border/70 bg-background/95">
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="rounded-lg border border-border/70 bg-muted/40 p-2">
                      <Icon className="size-4" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-6 text-muted-foreground">{item.summary}</p>
                  <Button asChild variant="outline" className="w-full justify-between">
                    <Link href={item.href}>
                      화면 열기
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
