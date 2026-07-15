"use client"

import { type ReactNode, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

type DashboardSubjectKey = "all" | "english" | "math"
type DashboardDivisionKey = "all" | "middle" | "high"
type StudentBasis = "students" | "enrollments"
type ClassOperationGroupMode = "grade" | "teacher" | "classroom"

type BreakdownRow = {
  label: string
  enrollmentCount: number
  studentCount: number
  schools?: BreakdownRow[]
  grades?: BreakdownRow[]
}
type ClassSummaryRow = {
  id: string
  title: string
  subject: string
  scheduleLabel: string
  teacherLabel: string
  classroomLabel: string
  studentCount: number
  enrollmentCount: number
  weeklyMinutes?: number
  weeklyHoursLabel?: string
}

type ClassBreakdownRow = BreakdownRow & {
  classCount: number
  weeklyMinutes?: number
  weeklyHoursLabel?: string
  classSummaries?: ClassSummaryRow[]
}

type DashboardBucketSummary = {
  activeClassesCount: number
  registeredEnrollmentCount: number
  waitlistEnrollmentCount: number
  uniqueRegisteredStudentCount: number
  uniqueWaitlistStudentCount: number
  schoolCount: number
  gradeCount: number
  weeklyHoursLabel?: string
}

type DashboardBucket = {
  studentBreakdowns: {
    bySubject: BreakdownRow[]
    byGrade: BreakdownRow[]
    bySchool: BreakdownRow[]
  }
  classBreakdowns?: {
    bySubject: ClassBreakdownRow[]
    byGrade: ClassBreakdownRow[]
    bySchool: ClassBreakdownRow[]
    byTeacher?: ClassBreakdownRow[]
    byClassroom?: ClassBreakdownRow[]
  }
  summary?: DashboardBucketSummary
}

type ExamConflictClass = {
  classId: string
  title: string
  subject: string
  teacherLabel?: string
  conflicts: Array<{
    rule?: string
    message: string
    sessionDate: string
    examDate: string
    students: string[]
    schoolName?: string
    grade?: string
  }>
}

type DashboardMetrics = {
  activeClassesCount: number
  studentsCount: number
  registeredEnrollmentCount?: number
  waitlistEnrollmentCount?: number
  uniqueRegisteredStudentCount?: number
  uniqueWaitlistStudentCount?: number
  weeklyHoursLabel?: string
  riskCount?: number
  examConflicts?: ExamConflictClass[]
  studentBreakdowns?: DashboardBucket["studentBreakdowns"]
  classBreakdowns?: DashboardBucket["classBreakdowns"]
  analyticsBySubject?: Partial<Record<DashboardSubjectKey, DashboardBucket>>
  analyticsByView?: Partial<Record<DashboardSubjectKey, Partial<Record<DashboardDivisionKey, DashboardBucket>>>>
  isLoading: boolean
  isConnected: boolean
  error: string | null
}

type ConflictBoardRow = {
  id: string
  classTitle: string
  subjectLabel: string
  teacherLabel: string
  examLabel: string
  whatTargetLabel: string
  dateLabel: string
  schoolLabel: string
  gradeLabel: string
  whoLabel: string
  whyLabel: string
  affectedCount: number
}

const SUBJECT_TABS: Array<{ key: DashboardSubjectKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "english", label: "영어" },
  { key: "math", label: "수학" },
]

const DIVISION_TABS: Array<{ key: DashboardDivisionKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "middle", label: "초중등부" },
  { key: "high", label: "고등부" },
]

const CLASS_OPERATION_GROUP_TABS: Array<{ key: ClassOperationGroupMode; label: string }> = [
  { key: "grade", label: "학년" },
  { key: "teacher", label: "선생님" },
  { key: "classroom", label: "강의실" },
]

const EMPTY_BUCKET: DashboardBucket = {
  studentBreakdowns: {
    bySubject: [],
    byGrade: [],
    bySchool: [],
  },
  classBreakdowns: {
    bySubject: [],
    byGrade: [],
    bySchool: [],
    byTeacher: [],
    byClassroom: [],
  },
}

function formatNumber(value: number | undefined) {
  return Number(value || 0).toLocaleString("ko-KR")
}

function isMetricUnavailable(metrics: DashboardMetrics) {
  return metrics.isLoading || Boolean(metrics.error) || !metrics.isConnected
}

function getMetricValue(value: number | undefined, metrics: DashboardMetrics) {
  if (metrics.isLoading) return "-"
  if (metrics.error || !metrics.isConnected) return "-"
  return formatNumber(value)
}

function getSupportingLabel(value: string | undefined, metrics: DashboardMetrics) {
  if (isMetricUnavailable(metrics)) return undefined
  if (!value || value === "0분") return undefined
  return value
}

function getPositiveMetricSub(value: number | undefined, label: string, unit: string, metrics: DashboardMetrics) {
  if (isMetricUnavailable(metrics) || !value) return undefined
  return `${label} ${formatNumber(value)}${unit}`
}

function formatAverage(numerator: number | undefined, denominator: number | undefined) {
  const safeDenominator = Number(denominator || 0)
  if (safeDenominator <= 0) return "-"

  return (Number(numerator || 0) / safeDenominator).toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  })
}

function getAverageMetricValue(numerator: number | undefined, denominator: number | undefined, metrics: DashboardMetrics) {
  if (metrics.isLoading) return "-"
  if (metrics.error || !metrics.isConnected) return "-"
  if (Number(denominator || 0) <= 0) return "-"
  return formatAverage(numerator, denominator)
}

function withUnit(value: string, unit: string) {
  return value === "-" ? value : `${value}${unit}`
}

function getBucket(metrics: DashboardMetrics, subject: DashboardSubjectKey, division: DashboardDivisionKey) {
  return (
    metrics.analyticsByView?.[subject]?.[division] ||
    metrics.analyticsBySubject?.[subject] ||
    {
      ...EMPTY_BUCKET,
      studentBreakdowns: metrics.studentBreakdowns || EMPTY_BUCKET.studentBreakdowns,
      classBreakdowns: metrics.classBreakdowns || EMPTY_BUCKET.classBreakdowns,
    }
  )
}

function getSummary(metrics: DashboardMetrics, bucket: DashboardBucket): DashboardBucketSummary {
  return {
    activeClassesCount: bucket.summary?.activeClassesCount ?? metrics.activeClassesCount,
    registeredEnrollmentCount: bucket.summary?.registeredEnrollmentCount ?? metrics.registeredEnrollmentCount ?? 0,
    waitlistEnrollmentCount: bucket.summary?.waitlistEnrollmentCount ?? metrics.waitlistEnrollmentCount ?? 0,
    uniqueRegisteredStudentCount:
      bucket.summary?.uniqueRegisteredStudentCount ?? metrics.uniqueRegisteredStudentCount ?? metrics.studentsCount,
    uniqueWaitlistStudentCount: bucket.summary?.uniqueWaitlistStudentCount ?? metrics.uniqueWaitlistStudentCount ?? 0,
    schoolCount:
      bucket.summary?.schoolCount ?? bucket.studentBreakdowns.bySchool.filter((row) => row.studentCount > 0).length,
    gradeCount:
      bucket.summary?.gradeCount ?? bucket.studentBreakdowns.byGrade.filter((row) => row.studentCount > 0).length,
    weeklyHoursLabel: bucket.summary?.weeklyHoursLabel ?? metrics.weeklyHoursLabel,
  }
}

function normalizeText(value: string | undefined) {
  return String(value || "").replace(/\s+/g, "").toLowerCase()
}

function splitBadgeLabels(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function matchesSubject(subject: string | undefined, subjectKey: DashboardSubjectKey) {
  if (subjectKey === "all") return true
  const normalized = normalizeText(subject)
  if (subjectKey === "english") return normalized.includes("영어") || normalized.includes("english")
  return normalized.includes("수학") || normalized.includes("math")
}

function matchesDivision(grade: string | undefined, division: DashboardDivisionKey) {
  if (division === "all") return true

  const normalized = normalizeText(grade)
  if (!normalized) return true
  if (division === "high") {
    return normalized.includes("고") || normalized.includes("high") || /(10|11|12)/.test(normalized)
  }
  return (
    normalized.includes("초") ||
    normalized.includes("중") ||
    normalized.includes("elementary") ||
    normalized.includes("middle") ||
    /^[1-9]$/.test(normalized)
  )
}

function getConflictExamLabel(conflict: ExamConflictClass["conflicts"][number], fallbackSubject: string) {
  const message = conflict.message || `${fallbackSubject || "시험"} 시험`
  const withoutTiming = message.replace(/\s*(전날|당일).*$/, "").trim()
  if (!withoutTiming) return `${fallbackSubject || "학교"} 시험`
  return withoutTiming.includes("시험") ? withoutTiming : `${withoutTiming} 시험`
}

function getConflictRows(
  conflicts: ExamConflictClass[] | undefined,
  subject: DashboardSubjectKey,
  division: DashboardDivisionKey,
) {
  return (conflicts || [])
    .filter((classItem) => matchesSubject(classItem.subject, subject))
    .map((classItem): ConflictBoardRow | null => {
      const scopedConflicts = classItem.conflicts.filter((conflict) => matchesDivision(conflict.grade, division))
      const first = scopedConflicts[0]
      if (!first) return null

      const affectedStudents = new Set(scopedConflicts.flatMap((conflict) => conflict.students || []))
      const examLabel = getConflictExamLabel(first, classItem.subject)
      const isDayBeforeOtherSubject = first.rule === "day-before-other-subject" || first.message?.includes("전날")
      const whyLabel = isDayBeforeOtherSubject
        ? "타과목 시험일 전날에는 수업을 진행하지 않습니다."
        : "본과목 시험일 당일에는 수업을 진행하지 않습니다."
      const studentNames = [...affectedStudents].filter(Boolean)

      return {
        id: classItem.classId,
        classTitle: classItem.title,
        subjectLabel: classItem.subject || "과목",
        teacherLabel: classItem.teacherLabel || "미정",
        examLabel,
        whatTargetLabel: isDayBeforeOtherSubject ? "타과목 시험일 전날" : "본과목 시험일",
        dateLabel: first.sessionDate || first.examDate,
        schoolLabel: first.schoolName || "",
        gradeLabel: first.grade || "",
        whoLabel: studentNames.length > 0 ? studentNames.join(", ") : "영향 학생 없음",
        whyLabel,
        affectedCount: affectedStudents.size || first.students?.length || 0,
      }
    })
    .filter((row): row is ConflictBoardRow => Boolean(row))
    .sort((left, right) => left.dateLabel.localeCompare(right.dateLabel, "ko", { numeric: true }))
}

function getMaxValue(rows: BreakdownRow[], basis: StudentBasis) {
  return Math.max(1, ...rows.map((row) => (basis === "students" ? row.studentCount : row.enrollmentCount)))
}

function getClassMaxValue(rows: ClassBreakdownRow[]) {
  return Math.max(1, ...rows.map((row) => row.classCount))
}

function sortClassOperationRows(rows: ClassBreakdownRow[]) {
  return [...rows].sort((left, right) => (
    right.classCount - left.classCount ||
    right.studentCount - left.studentCount ||
    left.label.localeCompare(right.label, "ko", { numeric: true })
  ))
}

function getClassOperationGroupKey(mode: ClassOperationGroupMode, label: string) {
  return `class-${mode}:${label}`
}

function getBarScale(value: number, max: number, minimum = 5) {
  return Math.min(100, Math.max(minimum, (value / Math.max(1, max)) * 100))
}

const DISTRIBUTION_ROW_CLASS =
  "grid grid-cols-[minmax(3.75rem,5.25rem)_minmax(0,1fr)_3.25rem] items-center gap-2 sm:grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_3.75rem]"

const CLASS_OPERATION_ROW_CLASS =
  "grid w-full grid-cols-[1rem_minmax(4.5rem,7rem)_minmax(0,1fr)_6.25rem] items-center gap-2 px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,transform] hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px sm:grid-cols-[1rem_minmax(5.5rem,9rem)_minmax(0,1fr)_6.75rem] sm:gap-3"

const DISTRIBUTION_PREVIEW_LIMIT = 5
const CLASS_PREVIEW_LIMIT = 3
const DISTRIBUTION_TOGGLE_ROW_CLASS =
  "w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px"
const LIST_SCOPE_TOGGLE_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2.5 text-xs font-semibold text-primary shadow-xs transition-[background-color,border-color,color,box-shadow,transform] hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px"

function formatWeeklyHoursLabel(label: string | undefined) {
  return label && label !== "0분" ? `주 ${label}` : "시수 미정"
}

function AnimatedBar({ percent, className }: { percent: number; className?: string }) {
  const scale = Math.min(100, Math.max(0, percent)) / 100

  return (
    <div
      className={cn("h-full origin-left rounded-full transition-transform duration-500 ease-out", className)}
      style={{ transform: `scaleX(${scale})` }}
    />
  )
}

function SegmentedControl<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: T
  items: Array<{ key: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full rounded-md border bg-muted/30 p-0.5">
      {items.map((item) => {
        const isActive = value === item.key

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              "min-w-12 rounded-[5px] px-2.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px sm:min-w-14 sm:px-3",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={isActive}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function ListScopeToggle({
  label,
  expanded,
  visibleCount,
  totalCount,
  onClick,
}: {
  label: string
  expanded: boolean
  visibleCount: number
  totalCount: number
  onClick: () => void
}) {
  if (totalCount <= visibleCount) return null
  const actionLabel = expanded ? "접기" : "전체 보기"
  const countLabel = expanded ? `상위 ${formatNumber(visibleCount)}개` : `${formatNumber(totalCount)}개`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={expanded}
      aria-label={expanded ? `${label} 접고 상위 ${formatNumber(visibleCount)}개만 보기` : `${label} 전체 ${formatNumber(totalCount)}개 보기`}
      className={LIST_SCOPE_TOGGLE_CLASS}
    >
      <ChevronDown
        className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
        aria-hidden="true"
      />
      <span>{actionLabel}</span>
      <span className="rounded-[4px] bg-background/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground shadow-xs">
        {countLabel}
      </span>
    </button>
  )
}

function getActiveLabel<T extends string>(items: Array<{ key: T; label: string }>, value: T) {
  return items.find((item) => item.key === value)?.label ?? value
}

function DashboardVisibleFilters({
  subject,
  division,
  onSubjectChange,
  onDivisionChange,
}: {
  subject: DashboardSubjectKey
  division: DashboardDivisionKey
  onSubjectChange: (next: DashboardSubjectKey) => void
  onDivisionChange: (next: DashboardDivisionKey) => void
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">과목</span>
        <SegmentedControl
          label="과목"
          value={subject}
          items={SUBJECT_TABS}
          onChange={onSubjectChange}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">부서</span>
        <SegmentedControl
          label="부서"
          value={division}
          items={DIVISION_TABS}
          onChange={onDivisionChange}
        />
      </div>
    </div>
  )
}

function DashboardHeader({
  subject,
  division,
  onSubjectChange,
  onDivisionChange,
  metrics,
  conflictCount,
}: {
  subject: DashboardSubjectKey
  division: DashboardDivisionKey
  onSubjectChange: (next: DashboardSubjectKey) => void
  onDivisionChange: (next: DashboardDivisionKey) => void
  metrics: DashboardMetrics
  conflictCount: number
}) {
  const isDisconnected = !metrics.isLoading && (metrics.error || !metrics.isConnected)
  const statusBadge = isDisconnected ? (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
      <AlertTriangle className="size-3.5" />
      연결 확인
    </Badge>
  ) : conflictCount > 0 ? (
    <Badge variant="destructive" className="font-medium">
      충돌 {formatNumber(conflictCount)}건
    </Badge>
  ) : null

  return (
    <section aria-label="대시보드 작업 기준" className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border bg-background px-2.5 py-2">
        <DashboardVisibleFilters
          subject={subject}
          division={division}
          onSubjectChange={onSubjectChange}
          onDivisionChange={onDivisionChange}
        />
        {statusBadge ? (
          <div aria-label="운영 상태" className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {statusBadge}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function KpiStrip({
  metrics,
  summary,
}: {
  metrics: DashboardMetrics
  summary: DashboardBucketSummary
}) {
  const averageEnrollmentsPerClass = getAverageMetricValue(
    summary.registeredEnrollmentCount,
    summary.activeClassesCount,
    metrics,
  )
  const weeklyHoursLabel = getSupportingLabel(summary.weeklyHoursLabel, metrics)
  const cards = [
    {
      title: "재원",
      value: withUnit(getMetricValue(summary.uniqueRegisteredStudentCount, metrics), "명"),
      sub: getPositiveMetricSub(summary.uniqueWaitlistStudentCount, "대기", "명", metrics),
    },
    {
      title: "수강",
      value: withUnit(getMetricValue(summary.registeredEnrollmentCount, metrics), "명"),
    },
    {
      title: "수업",
      value: withUnit(getMetricValue(summary.activeClassesCount, metrics), "개"),
      sub: weeklyHoursLabel ? `주간 ${weeklyHoursLabel}` : undefined,
    },
    {
      title: "수업당",
      value: withUnit(averageEnrollmentsPerClass, "명"),
    },
  ]

  return (
    <section
      aria-label="핵심 운영 지표"
      className="grid min-w-0 overflow-hidden rounded-xl border bg-background md:grid-cols-2 lg:grid-cols-4"
    >
      {cards.map((card, index) => {
        return (
          <div
            key={card.title}
            className={cn(
              "min-w-0 px-4 py-3 sm:px-5",
              index > 0 && "border-t md:border-t-0 md:border-l",
              index === 2 && "md:border-l-0 lg:border-l",
            )}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="text-xs font-medium text-muted-foreground">{card.title}</div>
              {card.sub ? (
                <div className="truncate text-xs font-medium text-muted-foreground">
                  {card.sub}
                </div>
              ) : null}
            </div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
              {card.value}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function DashboardLoadingState() {
  return (
    <>
      <section
        aria-label="대시보드 지표 불러오는 중"
        className="grid min-w-0 overflow-hidden rounded-xl border bg-background md:grid-cols-2 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "min-h-28 px-4 py-3",
              index > 0 && "border-t md:border-t-0 md:border-l",
              index === 2 && "md:border-l-0 lg:border-l",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-14 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-4 h-8 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
        <div className="min-h-[24rem] rounded-xl border bg-card p-5 shadow-xs">
          <div className="h-5 w-36 animate-pulse rounded bg-muted" />
          <div className="mt-8 grid gap-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-3">
                <div className="h-4 animate-pulse rounded bg-muted" />
                <div className="h-2 animate-pulse rounded-full bg-muted" />
                <div className="h-4 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
        <div className="min-h-[24rem] rounded-xl border bg-card p-5 shadow-xs">
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          <div className="mt-8 grid gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function StudentDistributionPanel({ bucket }: { bucket: DashboardBucket }) {
  const [basis, setBasis] = useState<StudentBasis>("students")
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [showAllGrades, setShowAllGrades] = useState(false)
  const [showAllSchools, setShowAllSchools] = useState(false)
  const getValue = (row: BreakdownRow) => (basis === "students" ? row.studentCount : row.enrollmentCount)
  const unit = "명"
  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  const gradeRows = [...bucket.studentBreakdowns.byGrade]
    .sort((left, right) => (
      getValue(right) - getValue(left) ||
      left.label.localeCompare(right.label, "ko", { numeric: true })
    ))
  const schoolRows = [...bucket.studentBreakdowns.bySchool]
    .sort((left, right) => getValue(right) - getValue(left) || left.label.localeCompare(right.label, "ko", { numeric: true }))
  const gradeMax = getMaxValue(gradeRows, basis)
  const schoolMax = getMaxValue(schoolRows, basis)
  const visibleGradeRows = showAllGrades ? gradeRows : gradeRows.slice(0, DISTRIBUTION_PREVIEW_LIMIT)
  const visibleSchoolRows = showAllSchools ? schoolRows : schoolRows.slice(0, DISTRIBUTION_PREVIEW_LIMIT)
  const hasDistributionRows = gradeRows.length > 0 || schoolRows.length > 0

  return (
    <Card className="min-w-0 gap-4 rounded-xl py-4 shadow-none">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 gap-3 border-b px-4 pb-3 sm:px-5 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle className="text-base">학생 분포</CardTitle>
        {hasDistributionRows ? (
          <CardAction className="col-start-1 row-span-1 row-start-2 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
            <SegmentedControl
              label="학생 기준"
              value={basis}
              items={[
                { key: "students", label: "재원" },
                { key: "enrollments", label: "수강" },
              ]}
              onChange={setBasis}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent
        className={cn(
          "min-w-0 px-4 sm:px-5",
          hasDistributionRows && "grid gap-4 xl:grid-cols-2 xl:divide-x",
        )}
      >
        {hasDistributionRows ? (
          <>
            <section aria-label="학년별 학생 분포" className="min-w-0 xl:pr-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">학년별</h3>
                <ListScopeToggle
                  label="학년 분포"
                  expanded={showAllGrades}
                  visibleCount={DISTRIBUTION_PREVIEW_LIMIT}
                  totalCount={gradeRows.length}
                  onClick={() => setShowAllGrades((current) => !current)}
                />
              </div>
              <div role="list" className="grid gap-3">
                {visibleGradeRows.map((row) => {
                  const value = getValue(row)
                  const expansionKey = `grade:${row.label}`
                  const isExpanded = expandedKeys.has(expansionKey)
                  const allSchoolRowsForGrade = row.schools || []
                  const schoolRowsForGrade = isExpanded ? allSchoolRowsForGrade : []
                  const canExpand = allSchoolRowsForGrade.length > 0
                  return (
                    <div key={row.label} role="listitem" className="min-w-0 border-b pb-3 last:border-b-0 last:pb-0">
                      {canExpand ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(expansionKey)}
                          aria-expanded={isExpanded}
                          aria-label={`${row.label} 학교 분포 ${isExpanded ? "접기" : "펼치기"}`}
                          className={cn(DISTRIBUTION_ROW_CLASS, DISTRIBUTION_TOGGLE_ROW_CLASS, "text-sm")}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ChevronDown
                              className={cn(
                                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                isExpanded && "rotate-180 text-primary",
                              )}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm font-semibold">{row.label}</span>
                          </span>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <AnimatedBar percent={getBarScale(value, gradeMax)} className="bg-primary" />
                          </div>
                          <span className="text-right tabular-nums">{formatNumber(value)}{unit}</span>
                        </button>
                      ) : (
                        <div className={cn(DISTRIBUTION_ROW_CLASS, "text-sm")}>
                          <span className="truncate text-sm font-semibold">{row.label}</span>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <AnimatedBar percent={getBarScale(value, gradeMax)} className="bg-primary" />
                          </div>
                          <span className="text-right tabular-nums">{formatNumber(value)}{unit}</span>
                        </div>
                      )}
                      <div role="list" aria-label={`${row.label} 학교 분포`} className="mt-3 grid gap-1.5">
                        {schoolRowsForGrade.map((school) => {
                          const schoolValue = getValue(school)

                          return (
                            <div key={school.label} role="listitem" className={cn(DISTRIBUTION_ROW_CLASS, "text-xs")}>
                              <span className="truncate pl-5 font-medium text-muted-foreground">{school.label}</span>
                              <div className="h-1 overflow-hidden rounded-full bg-muted">
                                <AnimatedBar percent={getBarScale(schoolValue, gradeMax, 4)} className="bg-primary/65" />
                              </div>
                              <span className="text-right tabular-nums">{formatNumber(schoolValue)}{unit}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {gradeRows.length === 0 ? <EmptyLine label="학년 데이터 없음" /> : null}
              </div>
            </section>
            <section aria-label="학교별 학생 분포" className="min-w-0 xl:pl-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">학교별</h3>
                <ListScopeToggle
                  label="학교 분포"
                  expanded={showAllSchools}
                  visibleCount={DISTRIBUTION_PREVIEW_LIMIT}
                  totalCount={schoolRows.length}
                  onClick={() => setShowAllSchools((current) => !current)}
                />
              </div>
              <div role="list" className="grid gap-3">
                {visibleSchoolRows.map((row) => {
                  const value = getValue(row)
                  const expansionKey = `school:${row.label}`
                  const isExpanded = expandedKeys.has(expansionKey)
                  const allGradeRowsForSchool = row.grades || []
                  const gradeRowsForSchool = isExpanded ? allGradeRowsForSchool : []
                  const canExpand = allGradeRowsForSchool.length > 0

                  return (
                    <div key={row.label} role="listitem" className="min-w-0 border-b pb-3 last:border-b-0 last:pb-0">
                      {canExpand ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(expansionKey)}
                          aria-expanded={isExpanded}
                          aria-label={`${row.label} 학년 분포 ${isExpanded ? "접기" : "펼치기"}`}
                          className={cn(DISTRIBUTION_ROW_CLASS, DISTRIBUTION_TOGGLE_ROW_CLASS, "text-sm")}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ChevronDown
                              className={cn(
                                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                isExpanded && "rotate-180 text-primary",
                              )}
                              aria-hidden="true"
                            />
                            <span className="truncate font-semibold">{row.label}</span>
                          </span>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <AnimatedBar percent={getBarScale(value, schoolMax)} className="bg-primary" />
                          </div>
                          <span className="text-right tabular-nums">{formatNumber(value)}{unit}</span>
                        </button>
                      ) : (
                        <div className={cn(DISTRIBUTION_ROW_CLASS, "text-sm")}>
                          <span className="truncate font-semibold">{row.label}</span>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <AnimatedBar percent={getBarScale(value, schoolMax)} className="bg-primary" />
                          </div>
                          <span className="text-right tabular-nums">{formatNumber(value)}{unit}</span>
                        </div>
                      )}
                      <div role="list" aria-label={`${row.label} 학년 분포`} className="mt-3 grid gap-1.5">
                        {gradeRowsForSchool.map((grade) => {
                          const gradeValue = getValue(grade)

                          return (
                            <div key={grade.label} role="listitem" className={cn(DISTRIBUTION_ROW_CLASS, "text-xs")}>
                              <span className="truncate pl-5 font-medium text-muted-foreground">{grade.label}</span>
                              <div className="h-1 overflow-hidden rounded-full bg-muted">
                                <AnimatedBar percent={getBarScale(gradeValue, schoolMax, 4)} className="bg-primary/65" />
                              </div>
                              <span className="text-right tabular-nums">{formatNumber(gradeValue)}{unit}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {schoolRows.length === 0 ? <EmptyLine label="학교 데이터 없음" /> : null}
              </div>
            </section>
          </>
        ) : (
          <EmptyLine label="학생 데이터 없음" />
        )}
      </CardContent>
    </Card>
  )
}

function ClassOperationsPanel({ bucket }: { bucket: DashboardBucket }) {
  const [groupMode, setGroupMode] = useState<ClassOperationGroupMode>("grade")
  const groupRowsByMode = useMemo(
    () => ({
      grade: sortClassOperationRows(bucket.classBreakdowns?.byGrade || []),
      teacher: sortClassOperationRows(bucket.classBreakdowns?.byTeacher || []),
      classroom: sortClassOperationRows(bucket.classBreakdowns?.byClassroom || []),
    }),
    [bucket.classBreakdowns?.byClassroom, bucket.classBreakdowns?.byGrade, bucket.classBreakdowns?.byTeacher],
  )
  const groupRows = groupRowsByMode[groupMode]
  const groupLabel = getActiveLabel(CLASS_OPERATION_GROUP_TABS, groupMode)
  const defaultOpenGroupKey = groupRows[0] ? getClassOperationGroupKey(groupMode, groupRows[0].label) : undefined
  const [openGroupKeys, setOpenGroupKeys] = useState<Set<string>>(
    () => new Set(defaultOpenGroupKey ? [defaultOpenGroupKey] : []),
  )
  const [expandedClassKeys, setExpandedClassKeys] = useState<Set<string>>(() => new Set())
  const classMax = getClassMaxValue(groupRows)
  const hasClassGroups = Object.values(groupRowsByMode).some((rows) => rows.length > 0)

  const toggleOpenGroup = (key: string) => {
    setOpenGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  const changeGroupMode = (nextMode: ClassOperationGroupMode) => {
    const nextRows = groupRowsByMode[nextMode]
    const nextPrefix = `class-${nextMode}:`
    const nextDefaultOpenKey = nextRows[0] ? getClassOperationGroupKey(nextMode, nextRows[0].label) : undefined
    setGroupMode(nextMode)
    if (!nextDefaultOpenKey) return
    setOpenGroupKeys((current) => {
      if ([...current].some((key) => key.startsWith(nextPrefix))) {
        return current
      }
      return new Set([...current, nextDefaultOpenKey])
    })
  }
  const toggleExpandedClassList = (key: string) => {
    setExpandedClassKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <Card className="min-w-0 gap-4 rounded-xl py-4 shadow-none">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 gap-3 border-b px-4 pb-3 sm:px-5 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle className="text-base">수업 운영</CardTitle>
        {hasClassGroups ? (
          <CardAction className="col-start-1 row-span-1 row-start-2 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
            <SegmentedControl
              label="수업 운영 보기"
              value={groupMode}
              items={CLASS_OPERATION_GROUP_TABS}
              onChange={changeGroupMode}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-4 sm:px-5">
        {groupRows.length > 0 ? (
          <div role="list" aria-label={`${groupLabel}별 수업 운영`} className="overflow-hidden rounded-lg border bg-background">
            {groupRows.map((row) => {
              const openKey = getClassOperationGroupKey(groupMode, row.label)
              const isOpen = openGroupKeys.has(openKey)
              const isExpanded = expandedClassKeys.has(openKey)
              const allClassRows = row.classSummaries || []
              const classRows = isExpanded ? allClassRows : allClassRows.slice(0, CLASS_PREVIEW_LIMIT)

              return (
                <div key={row.label} role="listitem" className="min-w-0 border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleOpenGroup(openKey)}
                    className={CLASS_OPERATION_ROW_CLASS}
                    aria-expanded={isOpen}
                    aria-label={`${row.label} ${groupLabel} 수업 ${isOpen ? "접기" : "펼치기"}`}
                  >
                    <ChevronDown
                      className={cn(
                        "size-4 text-muted-foreground transition-transform",
                        isOpen && "rotate-180 text-primary",
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate px-1 text-sm font-medium" title={row.label}>{row.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <AnimatedBar percent={getBarScale(row.classCount, classMax)} className="bg-primary" />
                    </div>
                    <span className="grid justify-items-end gap-0.5 px-1 text-right leading-none tabular-nums">
                      <span className="text-sm font-semibold">{formatNumber(row.classCount)}개</span>
                      <span className="text-[11px] font-medium text-muted-foreground">{formatWeeklyHoursLabel(row.weeklyHoursLabel)}</span>
                      <span className="text-[11px] font-medium text-muted-foreground">{formatNumber(row.studentCount)}명</span>
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="grid gap-1.5 border-t bg-muted/15 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium tabular-nums text-muted-foreground">
                          합계 {formatNumber(row.classCount)}개 · {formatWeeklyHoursLabel(row.weeklyHoursLabel)} · {formatNumber(row.studentCount)}명
                        </span>
                        {allClassRows.length > CLASS_PREVIEW_LIMIT ? (
                          <ListScopeToggle
                            label={`${row.label} 수업 목록`}
                            expanded={isExpanded}
                            visibleCount={CLASS_PREVIEW_LIMIT}
                            totalCount={allClassRows.length}
                            onClick={() => toggleExpandedClassList(openKey)}
                          />
                        ) : null}
                      </div>
                      <div role="list" aria-label={`${row.label} 수업 목록`} className="grid gap-1.5">
                        {classRows.map((classItem) => (
                          <div
                            key={classItem.id}
                            role="listitem"
                            className="min-w-0 border-l-2 border-l-primary/35 bg-background px-3 py-2"
                          >
                            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                              <Badge variant="outline" className="bg-primary/5 text-primary">{classItem.subject}</Badge>
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="min-w-0 max-w-full text-sm font-semibold leading-5">{classItem.title}</span>
                                {splitBadgeLabels(classItem.teacherLabel).map((label) => (
                                  <Badge
                                    key={`teacher:${classItem.id}:${label}`}
                                    variant="outline"
                                    className="min-w-0 max-w-full shrink justify-start !overflow-visible !whitespace-normal break-keep bg-background px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                                {splitBadgeLabels(classItem.classroomLabel).map((label) => (
                                  <Badge
                                    key={`classroom:${classItem.id}:${label}`}
                                    variant="outline"
                                    className="min-w-0 max-w-full shrink justify-start !overflow-visible !whitespace-normal break-keep bg-background px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                              </div>
                              <span className="col-start-2 grid justify-items-start gap-0.5 text-xs font-medium tabular-nums text-muted-foreground sm:col-start-3 sm:justify-items-end">
                                <span>{formatWeeklyHoursLabel(classItem.weeklyHoursLabel)}</span>
                                <span>{formatNumber(classItem.studentCount)}명</span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {allClassRows.length === 0 ? <EmptyLine label="수업 정보 없음" /> : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyLine label="수업 데이터 없음" />
        )}
      </CardContent>
    </Card>
  )
}

function ConflictBoard({ rows }: { rows: ConflictBoardRow[] }) {
  const [showAllConflicts, setShowAllConflicts] = useState(false)
  const affectedCount = rows.reduce((sum, row) => sum + row.affectedCount, 0)
  const visibleRows = showAllConflicts ? rows : rows.slice(0, 3)

  if (rows.length === 0) {
    return null
  }

  return (
    <Card className="min-w-0 gap-4 rounded-xl py-5 shadow-xs">
      <CardHeader className="px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" />
          일정 충돌 보드
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <ListScopeToggle
            label="일정 충돌"
            expanded={showAllConflicts}
            visibleCount={3}
            totalCount={rows.length}
            onClick={() => setShowAllConflicts((current) => !current)}
          />
          <Badge variant={rows.length > 0 ? "destructive" : "outline"}>{formatNumber(rows.length)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-4 sm:px-5">
        <div className="grid gap-3 xl:grid-cols-3">
          {visibleRows.map((row) => (
            <div key={row.id} className="min-w-0 rounded-xl border bg-background p-4">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="bg-primary/5 text-primary">{row.subjectLabel}</Badge>
                    <Badge variant="outline">{row.teacherLabel}</Badge>
                    <span className="min-w-0 max-w-full text-sm font-semibold leading-5 text-destructive">{row.classTitle}</span>
                    <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
                    <span className="text-sm font-semibold leading-5 text-destructive">{row.examLabel}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                  {[row.schoolLabel, row.gradeLabel].filter(Boolean).map((label, index) => (
                    <Badge key={`${label}-${index}`} variant="outline" className="bg-muted/45">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-xs">
                <ProcessRow label="일시" value={row.dateLabel} />
                <ProcessRow
                  label="충돌"
                  value={(
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>본과목 수업일</span>
                      <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
                      <span>{row.whatTargetLabel}</span>
                    </span>
                  )}
                />
                <ProcessRow label="대상" value={row.whoLabel} />
                <ProcessRow label="사유" value={row.whyLabel} />
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)]">
                  <span className="text-muted-foreground">처리</span>
                  <div className="flex flex-wrap gap-1.5">
                    {["보강 제안", "회차 휴강", "보호자 안내"].map((label) => (
                      <span key={label} className="rounded-md bg-muted px-2 py-1 font-medium">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Badge variant="outline">충돌 영향 학생 {formatNumber(affectedCount)}명</Badge>
          <Badge variant="outline">대상 수업 {formatNumber(rows.length)}개</Badge>
          <Badge variant="outline">오늘 확정 필요 {formatNumber(rows.length)}건</Badge>
        </div>
      </CardContent>
    </Card>
  )
}

function ProcessRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium">{value}</span>
    </div>
  )
}

function EmptyLine({ label }: { label: string }) {
  return (
    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export function SectionCards({ metrics }: { metrics: DashboardMetrics }) {
  const [activeSubject, setActiveSubject] = useState<DashboardSubjectKey>("all")
  const [activeDivision, setActiveDivision] = useState<DashboardDivisionKey>("all")
  const activeBucket = useMemo(
    () => getBucket(metrics, activeSubject, activeDivision),
    [activeDivision, activeSubject, metrics],
  )
  const summary = useMemo(() => getSummary(metrics, activeBucket), [activeBucket, metrics])
  const conflictRows = useMemo(
    () => getConflictRows(metrics.examConflicts, activeSubject, activeDivision),
    [activeDivision, activeSubject, metrics.examConflicts],
  )

  if (metrics.isLoading) {
    return (
      <div className="grid min-w-0 gap-4">
        <DashboardHeader
          subject={activeSubject}
          division={activeDivision}
          onSubjectChange={setActiveSubject}
          onDivisionChange={setActiveDivision}
          metrics={metrics}
          conflictCount={conflictRows.length}
        />
        <DashboardLoadingState />
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-4">
      <DashboardHeader
        subject={activeSubject}
        division={activeDivision}
        onSubjectChange={setActiveSubject}
        onDivisionChange={setActiveDivision}
        metrics={metrics}
        conflictCount={conflictRows.length}
      />
      <KpiStrip metrics={metrics} summary={summary} />
      <ConflictBoard rows={conflictRows} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
        <div className="order-2 min-w-0 lg:order-1">
          <StudentDistributionPanel bucket={activeBucket} />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <ClassOperationsPanel key={`${activeSubject}:${activeDivision}`} bucket={activeBucket} />
        </div>
      </div>
    </div>
  )
}
