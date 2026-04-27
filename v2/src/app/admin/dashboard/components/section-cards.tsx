"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  GraduationCap,
  LoaderCircle,
  Users,
  Wifi,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

type DashboardMetrics = {
  activeClassesCount: number
  studentsCount: number
  textbooksCount: number
  progressLogsCount: number
  registeredEnrollmentCount?: number
  waitlistEnrollmentCount?: number
  uniqueRegisteredStudentCount?: number
  uniqueWaitlistStudentCount?: number
  weeklyHoursLabel?: string
  teacherCount?: number
  classroomCount?: number
  collisionSummary?: {
    student: CollisionGroup[]
    teacher: CollisionGroup[]
    classroom: CollisionGroup[]
    total: number
  }
  examConflicts?: ExamConflictClass[]
  studentBreakdowns?: {
    bySubject: BreakdownRow[]
    byGrade: BreakdownRow[]
    bySchool: BreakdownRow[]
  }
  analyticsBySubject?: Partial<Record<DashboardSubjectKey, DashboardAnalyticsBucket>>
  teacherLoad?: LoadRow[]
  classroomLoad?: LoadRow[]
  riskCount?: number
  isLoading: boolean
  isConnected: boolean
  error: string | null
}

type CollisionGroup = {
  id: string
  label: string
  meta?: string
  overlaps: CollisionOverlap[]
}

type CollisionOverlap = {
  day: string
  start: string
  end: string
  left: { className: string; start: string; end: string }
  right: { className: string; start: string; end: string }
}

type ExamConflictClass = {
  classId: string
  title: string
  subject: string
  conflicts: Array<{
    message: string
    sessionDate: string
    examDate: string
    students: string[]
    schoolName?: string
    grade?: string
  }>
}

type BreakdownRow = {
  label: string
  enrollmentCount: number
  studentCount: number
  schools?: BreakdownRow[]
}

type LoadClassRow = {
  id: string
  title: string
  scheduleLabel: string
  teacherLabel: string
  classroomLabel: string
  registeredCount: number
  waitlistCount: number
  registeredStudents: string[]
  waitlistStudents: string[]
}

type LoadRow = {
  name: string
  minutes: number
  slotCount: number
  classCount: number
  enrollmentCount?: number
  waitlistCount?: number
  classes?: LoadClassRow[]
}

type DashboardSubjectKey = "all" | "english" | "math"

type DashboardAnalyticsBucket = {
  studentBreakdowns: {
    bySubject: BreakdownRow[]
    byGrade: BreakdownRow[]
    bySchool: BreakdownRow[]
  }
  teacherLoad: LoadRow[]
  classroomLoad: LoadRow[]
}

type LoadSortBasis = "minutes" | "enrollment"

const LOAD_SORT_OPTIONS: Array<{ key: LoadSortBasis; label: string }> = [
  { key: "minutes", label: "주간 수업시수" },
  { key: "enrollment", label: "수강생수" },
]

type MetricCard = {
  title: string
  value: number
  summary: string
  sourceLabel: string
  href: string
  destinationLabel: string
}

const DASHBOARD_SUBJECT_TABS: Array<{ key: DashboardSubjectKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "english", label: "영어" },
  { key: "math", label: "수학" },
]

const EMPTY_ANALYTICS_BUCKET: DashboardAnalyticsBucket = {
  studentBreakdowns: {
    bySubject: [],
    byGrade: [],
    bySchool: [],
  },
  teacherLoad: [],
  classroomLoad: [],
}

function getConnectionState(metrics: DashboardMetrics): {
  badgeLabel: string
  badgeVariant: "default" | "destructive" | "outline"
  icon: typeof Wifi
} {
  if (metrics.isLoading) {
    return {
      badgeLabel: "연결 확인 중",
      badgeVariant: "outline",
      icon: LoaderCircle,
    }
  }

  if (metrics.error || !metrics.isConnected) {
    return {
      badgeLabel: "점검 필요",
      badgeVariant: "destructive",
      icon: AlertTriangle,
    }
  }

  return {
    badgeLabel: "실시간 연결",
    badgeVariant: "default",
    icon: Wifi,
  }
}

function getConnectionSummary(metrics: DashboardMetrics) {
  if (metrics.isLoading) {
    return "운영 지표를 불러오는 중입니다."
  }

  if (metrics.error || !metrics.isConnected) {
    return metrics.error || "운영 데이터 연결 상태에 문제가 감지되었습니다."
  }

  return "현재 운영 데이터 기준으로 집계했습니다."
}

function formatMetricValue(value: number, metrics: DashboardMetrics) {
  if (metrics.isLoading) {
    return "-"
  }

  if (metrics.error || !metrics.isConnected) {
    return "점검"
  }

  return formatNumber(value)
}

function formatNumber(value: number | undefined) {
  return Number(value || 0).toLocaleString("ko-KR")
}

function formatMinutes(minutes: number | undefined) {
  const safeMinutes = Math.max(0, Number(minutes || 0))
  const hours = Math.floor(safeMinutes / 60)
  const rest = safeMinutes % 60
  if (hours > 0 && rest > 0) return `${hours}시간 ${rest}분`
  if (hours > 0) return `${hours}시간`
  return `${rest}분`
}

function getMax(rows: BreakdownRow[], key: "enrollmentCount" | "studentCount") {
  return Math.max(1, ...rows.map((row) => Number(row[key] || 0)))
}

function getLoadValue(row: LoadRow, basis: LoadSortBasis) {
  return basis === "enrollment" ? Number(row.enrollmentCount || 0) : Number(row.minutes || 0)
}

function getLoadMax(rows: LoadRow[], basis: LoadSortBasis = "minutes") {
  return Math.max(1, ...rows.map((row) => getLoadValue(row, basis)))
}

function StudentNamesHover({
  label,
  count,
  students,
  tone = "primary",
}: {
  label: string
  count: number
  students: string[]
  tone?: "primary" | "orange"
}) {
  const badgeClassName = tone === "orange"
    ? "bg-orange-50 text-orange-700 hover:bg-orange-100"
    : "bg-primary/10 text-primary hover:bg-primary/15"

  return (
    <HoverCard openDelay={80} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span data-testid="dashboard-load-students-trigger" tabIndex={0} className={`inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${badgeClassName}`}>
          {label} {formatNumber(count)}
        </span>
      </HoverCardTrigger>
      <HoverCardContent data-testid="dashboard-load-students-content" side="right" align="start" className="w-56 p-3">
        <div className="space-y-2">
          <div className="text-sm font-semibold">{label} 학생</div>
          {students.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {students.map((student) => (
                <span key={student} className="rounded-md bg-muted px-2 py-1 text-xs">
                  {student}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">명단 없음</p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function ClassDetailHover({ classItem }: { classItem: LoadClassRow }) {
  const rows = [
    ["요일/시간", classItem.scheduleLabel],
    ["선생님", classItem.teacherLabel],
    ["강의실", classItem.classroomLabel],
  ] as const

  return (
    <HoverCard openDelay={80} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span data-testid="dashboard-load-class-trigger" tabIndex={0} className="min-w-0 cursor-help truncate text-sm font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {classItem.title}
        </span>
      </HoverCardTrigger>
      <HoverCardContent data-testid="dashboard-load-class-content" side="right" align="start" className="w-72 p-3">
        <div className="space-y-3">
          <div className="truncate text-sm font-semibold">{classItem.title}</div>
          <div className="grid gap-2">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="min-w-0 break-words font-medium">{value || "미정"}</span>
              </div>
            ))}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function topRows<T>(rows: T[] | undefined, limit = 8) {
  return (rows || []).slice(0, limit)
}

function sortStudentRows(rows: BreakdownRow[] | undefined) {
  return [...(rows || [])].sort((left, right) => (
    right.studentCount - left.studentCount ||
    right.enrollmentCount - left.enrollmentCount ||
    left.label.localeCompare(right.label, "ko", { numeric: true })
  ))
}

function getCollisionAction(title: string, first: CollisionOverlap) {
  const time = `${first.day} ${first.start}-${first.end}`

  if (title === "학생") {
    return {
      who: "학생",
      what: `${first.left.className} / ${first.right.className}`,
      how: "한 학생이 동시에 듣는 수업 중 하나의 배정을 해제하거나 시간표를 변경하세요.",
      why: `${time}에 수업 시간이 겹칩니다.`,
    }
  }

  if (title === "선생님") {
    return {
      who: "선생님",
      what: `${first.left.className} / ${first.right.className}`,
      how: "담당 선생님을 바꾸거나 한 수업의 요일/시간을 조정하세요.",
      why: `${time}에 같은 선생님이 두 수업에 배정되어 있습니다.`,
    }
  }

  return {
    who: "강의실",
    what: `${first.left.className} / ${first.right.className}`,
    how: "한 수업의 강의실을 바꾸거나 수업 시간을 조정하세요.",
    why: `${time}에 같은 강의실을 두 수업이 사용합니다.`,
  }
}

function MetricCards({ metrics }: { metrics: DashboardMetrics }) {
  const connectionState = getConnectionState(metrics)
  const connectionSummary = getConnectionSummary(metrics)
  const showConnectionState = metrics.isLoading || Boolean(metrics.error) || !metrics.isConnected
  const cards: MetricCard[] = [
    {
      title: "운영 중 수업",
      value: metrics.activeClassesCount,
      summary: `등록 ${formatNumber(metrics.registeredEnrollmentCount)} · 대기 ${formatNumber(metrics.waitlistEnrollmentCount)}`,
      sourceLabel: metrics.weeklyHoursLabel ? `주간 ${metrics.weeklyHoursLabel}` : "수업일정 기준",
      href: "/admin/classes",
      destinationLabel: "수업관리",
    },
    {
      title: "등록 학생",
      value: metrics.uniqueRegisteredStudentCount || metrics.studentsCount,
      summary: `전체 ${formatNumber(metrics.studentsCount)} · 대기 ${formatNumber(metrics.uniqueWaitlistStudentCount)}`,
      sourceLabel: "학생관리 기준",
      href: "/admin/students",
      destinationLabel: "학생관리",
    },
    {
      title: "교재 수",
      value: metrics.textbooksCount,
      summary: `수업 ${formatNumber(metrics.activeClassesCount)}개 연결 점검`,
      sourceLabel: "교재관리 기준",
      href: "/admin/textbooks",
      destinationLabel: "교재관리",
    },
    {
      title: "진도 기록",
      value: metrics.progressLogsCount,
      summary: `충돌 ${formatNumber(metrics.riskCount)}건`,
      sourceLabel: "수업계획 기준",
      href: "/admin/curriculum",
      destinationLabel: "수업계획",
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const StatusIcon = connectionState.icon

        return (
          <Link
            key={card.title}
            href={card.href}
            aria-label={`${card.title} ${card.destinationLabel} 열기`}
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="@container/card h-full gap-4 py-5 shadow-xs transition-colors group-hover:border-primary/45 group-hover:bg-accent/25">
              <CardHeader className="px-5">
                <CardDescription>{card.title}</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {formatMetricValue(card.value, metrics)}
                </CardTitle>
                {showConnectionState ? (
                  <CardAction>
                    <Badge variant={connectionState.badgeVariant}>
                      <StatusIcon className={metrics.isLoading ? "animate-spin" : undefined} />
                      {connectionState.badgeLabel}
                    </Badge>
                    <span className="sr-only">{connectionSummary}</span>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1 px-5 text-sm">
                <div className="font-medium">{card.summary}</div>
                <div className="inline-flex items-center gap-1 text-muted-foreground">
                  {card.sourceLabel}
                  <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
              </CardFooter>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}

function CollisionList({
  title,
  rows,
}: {
  title: string
  rows: CollisionGroup[]
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="destructive">{formatNumber(rows.length)}</Badge>
      </div>
      <div className="space-y-2">
        {topRows(rows, 3).map((group) => {
          const first = group.overlaps[0]
          const action = getCollisionAction(title, first)
          return (
            <div key={group.id} className="rounded-lg border bg-background px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{group.label}</p>
                  <p className="text-xs text-muted-foreground">{action.who} 충돌</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-destructive">{first.day} {first.start}-{first.end}</span>
              </div>
              <div className="mt-2 grid gap-1.5 text-xs">
                <p className="line-clamp-2 font-medium text-foreground">수업: {action.what}</p>
                <p className="line-clamp-2 text-muted-foreground">조치: {action.how}</p>
                <p className="line-clamp-2 text-muted-foreground">이유: {action.why}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RiskPanel({ metrics }: { metrics: DashboardMetrics }) {
  const collision = metrics.collisionSummary || { student: [], teacher: [], classroom: [], total: 0 }
  const examConflicts = metrics.examConflicts || []
  const firstExamConflicts = topRows(examConflicts, 4)
  const totalRisk = collision.total + examConflicts.length
  const collisionSections = [
    { title: "학생", rows: collision.student },
    { title: "선생님", rows: collision.teacher },
    { title: "강의실", rows: collision.classroom },
  ].filter((section) => section.rows.length > 0)
  const sectionCount = collisionSections.length + (firstExamConflicts.length > 0 ? 1 : 0)
  const gridClassName = [
    "grid gap-3 px-5 md:grid-cols-2",
    sectionCount <= 3 ? "xl:grid-cols-3" : "xl:grid-cols-4",
  ].join(" ")

  if (totalRisk === 0) return null

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" />
          충돌 알림
        </CardTitle>
        <CardAction>
          <Badge variant="destructive">{formatNumber(totalRisk)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className={gridClassName}>
        {collisionSections.map((section) => (
          <CollisionList key={section.title} title={section.title} rows={section.rows} />
        ))}
        {firstExamConflicts.length > 0 ? (
          <section className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">시험/수업</h3>
              <Badge variant="destructive">{formatNumber(examConflicts.length)}</Badge>
            </div>
            <div className="space-y-2">
              {firstExamConflicts.map((classItem) => {
                const first = classItem.conflicts[0]
                return (
                  <div key={classItem.classId} className="rounded-lg border bg-background px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{classItem.title}</p>
                        <p className="text-xs text-muted-foreground">{first.schoolName} {first.grade}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-destructive">{first.sessionDate}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                      <p className="line-clamp-2 font-medium text-foreground">
                        대상: {first.students.slice(0, 4).join(", ")} 학생
                      </p>
                      <p className="line-clamp-2">수업: {classItem.title}</p>
                      <p className="line-clamp-2">
                        조치: 보강일을 잡거나 해당 회차를 휴강 처리하세요.
                      </p>
                      <p className="line-clamp-2">
                        이유: {first.message} 때문에 시험 당일/전일 수업 조정이 필요합니다.
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

function GradeBreakdownPanel({ rows, subjectRows }: { rows: BreakdownRow[]; subjectRows: BreakdownRow[] }) {
  const sortedRows = topRows(sortStudentRows(rows), 10)
  const sortedSubjectRows = topRows(sortStudentRows(subjectRows), 4)
  const studentMax = getMax(sortedRows, "studentCount")
  const subjectEnrollmentMax = getMax(sortedSubjectRows, "enrollmentCount")

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="size-4 text-primary" />
          학년별 학생수
        </CardTitle>
        <CardAction className="text-xs text-muted-foreground">학교별</CardAction>
      </CardHeader>
      <CardContent className="space-y-2 px-5">
        {sortedSubjectRows.length > 0 ? (
          <div className="mb-3 rounded-lg border bg-muted/25 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">전체 학년</span>
              <span>수강생 / 학생</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {sortedSubjectRows.map((row) => (
                <div key={row.label} className="min-w-0">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{row.label}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatNumber(row.enrollmentCount)}
                      <span className="px-1 text-muted-foreground">/</span>
                      <span className="text-muted-foreground">{formatNumber(row.studentCount)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(4, (row.enrollmentCount / subjectEnrollmentMax) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {sortedRows.map((row) => {
          const schoolRows = topRows(sortStudentRows(row.schools), 8)
          const schoolMax = getMax(schoolRows, "studentCount")

          return (
            <HoverCard key={row.label} openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <div className="grid cursor-default grid-cols-[minmax(0,1fr)_3.8rem_3.8rem] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.label}</div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(4, (row.studentCount / studentMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-right text-sm tabular-nums">{formatNumber(row.enrollmentCount)}</span>
                  <span className="text-right text-sm tabular-nums text-muted-foreground">{formatNumber(row.studentCount)}</span>
                </div>
              </HoverCardTrigger>
              <HoverCardContent align="start" className="w-80">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{row.label} 학교별 학생수</p>
                    <p className="text-xs text-muted-foreground">수강생 / 학생</p>
                  </div>
                  <div className="space-y-2">
                    {schoolRows.map((school) => (
                      <div key={school.label} className="grid grid-cols-[minmax(0,1fr)_3.2rem_3.2rem] items-center gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm">{school.label}</div>
                          <div className="mt-1 h-1.5 rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.max(4, (school.studentCount / schoolMax) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-right text-xs tabular-nums">{formatNumber(school.enrollmentCount)}</span>
                        <span className="text-right text-xs tabular-nums text-muted-foreground">{formatNumber(school.studentCount)}</span>
                      </div>
                    ))}
                    {schoolRows.length === 0 ? (
                      <div className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
                        학교 데이터 없음
                      </div>
                    ) : null}
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>
          )
        })}
        {sortedRows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">데이터 없음</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function LoadTable({
  title,
  rows,
}: {
  title: string
  rows: LoadRow[]
}) {
  const [sortBasis, setSortBasis] = useState<LoadSortBasis>("minutes")
  const secondarySortBasis: LoadSortBasis = sortBasis === "minutes" ? "enrollment" : "minutes"
  const sortedRows = [...rows].sort((left, right) => (
    getLoadValue(right, sortBasis) - getLoadValue(left, sortBasis) ||
    getLoadValue(right, secondarySortBasis) - getLoadValue(left, secondarySortBasis) ||
    right.classCount - left.classCount ||
    left.name.localeCompare(right.name, "ko", { numeric: true })
  )).slice(0, 5)
  const max = getLoadMax(sortedRows, sortBasis)

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock3 className="size-4 text-primary" />
          {title}
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">TOP 5</span>
          <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
            {LOAD_SORT_OPTIONS.map((option) => {
              const isActive = sortBasis === option.key

              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSortBasis(option.key)}
                  className={[
                    "rounded px-2 py-1 text-xs font-medium transition-colors active:translate-y-px",
                    isActive
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2 px-5">
        {sortedRows.map((row, index) => {
          const classes = row.classes || []
          const primaryValue = getLoadValue(row, sortBasis)
          const summary = sortBasis === "enrollment"
            ? `수강 ${formatNumber(row.enrollmentCount)}명 · ${formatNumber(row.classCount)}개 · ${formatMinutes(row.minutes)}`
            : `${formatMinutes(row.minutes)} · ${formatNumber(row.classCount)}개 · 수강 ${formatNumber(row.enrollmentCount)}명`

          return (
            <HoverCard key={row.name} openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <div data-testid="dashboard-load-row-trigger" tabIndex={0} className="grid cursor-help grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{row.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {summary}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (primaryValue / max) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              </HoverCardTrigger>
              <HoverCardContent data-testid="dashboard-load-row-content" align="start" className="w-[29rem] p-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        수강 {formatNumber(row.enrollmentCount)}명 · 대기 {formatNumber(row.waitlistCount)}명
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs tabular-nums">
                      {formatMinutes(row.minutes)}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {classes.length > 0 ? classes.map((classItem) => (
                      <div key={classItem.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-background px-3 py-2">
                        <ClassDetailHover classItem={classItem} />
                        <div className="flex shrink-0 items-center gap-1.5">
                          <StudentNamesHover
                            label="등록"
                            count={classItem.registeredCount}
                            students={classItem.registeredStudents}
                          />
                          <StudentNamesHover
                            label="대기"
                            count={classItem.waitlistCount}
                            students={classItem.waitlistStudents}
                            tone="orange"
                          />
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">수업 목록 없음</div>
                    )}
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>
          )
        })}
        {sortedRows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">데이터 없음</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SectionCards({ metrics }: { metrics: DashboardMetrics }) {
  const [activeSubject, setActiveSubject] = useState<DashboardSubjectKey>("all")
  const analytics = useMemo<DashboardAnalyticsBucket>(() => {
    const fallback: DashboardAnalyticsBucket = {
      studentBreakdowns: metrics.studentBreakdowns || EMPTY_ANALYTICS_BUCKET.studentBreakdowns,
      teacherLoad: metrics.teacherLoad || [],
      classroomLoad: metrics.classroomLoad || [],
    }

    return metrics.analyticsBySubject?.[activeSubject] || fallback
  }, [activeSubject, metrics.analyticsBySubject, metrics.classroomLoad, metrics.studentBreakdowns, metrics.teacherLoad])

  const gradeRows = analytics.studentBreakdowns.byGrade || []
  const subjectRows = analytics.studentBreakdowns.bySubject || []
  const teacherRows = analytics.teacherLoad || []
  const classroomRows = analytics.classroomLoad || []

  return (
    <div className="grid gap-4">
      <MetricCards metrics={metrics} />
      <RiskPanel metrics={metrics} />
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-primary" />
            학생 · 리소스 분석
          </div>
          <div data-testid="dashboard-subject-tabs" className="inline-flex rounded-lg border bg-muted/40 p-1">
            {DASHBOARD_SUBJECT_TABS.map((tab) => {
              const isActive = activeSubject === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`dashboard-subject-tab-${tab.key}`}
                  onClick={() => setActiveSubject(tab.key)}
                  className={[
                    "min-w-14 rounded-md px-3 py-1.5 text-sm font-medium transition-colors active:translate-y-px",
                    isActive
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>
      <GradeBreakdownPanel rows={gradeRows} subjectRows={subjectRows} />
      <div className="grid gap-4 xl:grid-cols-2">
        <LoadTable title="선생님 담당량" rows={teacherRows} />
        <LoadTable title="강의실 사용량" rows={classroomRows} />
      </div>
    </div>
  )
}
