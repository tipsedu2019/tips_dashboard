"use client"

import { type ReactNode, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  Layers3,
  SearchCheck,
  Users,
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
}

type ClassBreakdownRow = BreakdownRow & {
  classCount: number
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
  contextLabel: string
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
  },
}

function formatNumber(value: number | undefined) {
  return Number(value || 0).toLocaleString("ko-KR")
}

function getMetricValue(value: number | undefined, metrics: DashboardMetrics) {
  if (metrics.isLoading) return "-"
  if (metrics.error || !metrics.isConnected) return "확인 필요"
  return formatNumber(value)
}

function formatAverage(numerator: number | undefined, denominator: number | undefined) {
  const safeDenominator = Number(denominator || 0)
  if (safeDenominator <= 0) return "0"

  return (Number(numerator || 0) / safeDenominator).toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  })
}

function getAverageMetricValue(numerator: number | undefined, denominator: number | undefined, metrics: DashboardMetrics) {
  if (metrics.isLoading) return "-"
  if (metrics.error || !metrics.isConnected) return "확인 필요"
  return formatAverage(numerator, denominator)
}

function withUnit(value: string, unit: string) {
  return value === "-" || value === "확인 필요" ? value : `${value}${unit}`
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
    weeklyHoursLabel: bucket.summary?.weeklyHoursLabel ?? metrics.weeklyHoursLabel ?? "0분",
  }
}

function normalizeText(value: string | undefined) {
  return String(value || "").replace(/\s+/g, "").toLowerCase()
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
      const schoolGrade = [first.schoolName, first.grade].filter(Boolean).join(" ")
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
        contextLabel: [schoolGrade, first.sessionDate || first.examDate].filter(Boolean).join(" · "),
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

function getBarScale(value: number, max: number, minimum = 5) {
  return Math.min(100, Math.max(minimum, (value / Math.max(1, max)) * 100))
}

const DISTRIBUTION_ROW_CLASS =
  "grid grid-cols-[minmax(3.75rem,5.25rem)_minmax(0,1fr)_3.25rem] items-center gap-2 sm:grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_3.75rem]"

const CLASS_OPERATION_ROW_CLASS =
  "grid w-full grid-cols-[3.25rem_minmax(0,1fr)_3.75rem] items-center gap-2 rounded-md text-left transition-colors hover:bg-muted/45 active:translate-y-px sm:grid-cols-[4rem_minmax(0,1fr)_4.5rem] sm:gap-3"

function AnimatedBar({ percent, className }: { percent: number; className?: string }) {
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setScale(Math.min(100, Math.max(0, percent)) / 100)
    })

    return () => cancelAnimationFrame(frame)
  }, [percent])

  return (
    <div
      className={cn("h-full origin-left rounded-full transition-transform duration-700 ease-out", className)}
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
    <div aria-label={label} className="inline-flex max-w-full rounded-lg border bg-muted/35 p-1">
      {items.map((item) => {
        const isActive = value === item.key

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              "min-w-14 rounded-md px-2.5 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] active:translate-y-px sm:min-w-16 sm:px-3",
              isActive
                ? "bg-primary text-primary-foreground shadow-xs"
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

function DashboardHeader({
  subject,
  division,
  onSubjectChange,
  onDivisionChange,
  metrics,
}: {
  subject: DashboardSubjectKey
  division: DashboardDivisionKey
  onSubjectChange: (next: DashboardSubjectKey) => void
  onDivisionChange: (next: DashboardDivisionKey) => void
  metrics: DashboardMetrics
}) {
  return (
    <div className="min-w-0">
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">대시보드</h1>
          {metrics.error || !metrics.isConnected ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              <AlertTriangle className="size-3.5" />
              연결 확인
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="과목 보기"
            value={subject}
            items={SUBJECT_TABS}
            onChange={onSubjectChange}
          />
          <SegmentedControl
            label="부서 보기"
            value={division}
            items={DIVISION_TABS}
            onChange={onDivisionChange}
          />
        </div>
      </div>
    </div>
  )
}

function KpiStrip({
  metrics,
  summary,
}: {
  metrics: DashboardMetrics
  summary: DashboardBucketSummary
}) {
  const averageStudentsPerClass = getAverageMetricValue(
    summary.uniqueRegisteredStudentCount,
    summary.activeClassesCount,
    metrics,
  )
  const averageEnrollmentsPerClass = getAverageMetricValue(
    summary.registeredEnrollmentCount,
    summary.activeClassesCount,
    metrics,
  )
  const cards = [
    {
      title: "학생수 (인원 기준)",
      value: getMetricValue(summary.uniqueRegisteredStudentCount, metrics),
      sub: `대기 ${formatNumber(summary.uniqueWaitlistStudentCount)}명`,
      icon: Users,
      tone: "text-primary",
    },
    {
      title: "학생수 (수강 기준)",
      value: getMetricValue(summary.registeredEnrollmentCount, metrics),
      sub: `대기 ${formatNumber(summary.waitlistEnrollmentCount)}건`,
      icon: SearchCheck,
      tone: "text-primary",
    },
    {
      title: "운영 수업",
      value: getMetricValue(summary.activeClassesCount, metrics),
      sub: `주간 ${summary.weeklyHoursLabel}`,
      icon: Layers3,
      tone: "text-primary",
    },
    {
      title: "수업당 학생수",
      value: withUnit(averageStudentsPerClass, "명"),
      sub: `인원 기준 · 수강 기준 ${withUnit(averageEnrollmentsPerClass, "명")}`,
      icon: Users,
      tone: "text-primary",
    },
  ]

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon

        return (
          <Card key={card.title} className="min-w-0 gap-3 rounded-xl py-4 shadow-xs">
            <CardHeader className="grid-cols-[1fr_auto] gap-3 px-4">
              <div className="min-w-0 space-y-2">
                <div className="text-sm text-muted-foreground">{card.title}</div>
                <CardTitle className="text-2xl font-semibold tracking-tight tabular-nums">
                  {card.value}
                </CardTitle>
              </div>
              <CardAction className="col-start-2 row-span-1 row-start-1">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-muted">
                  <Icon className={cn("size-4", card.tone)} />
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="px-4 text-sm font-medium text-muted-foreground">
              {card.sub}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function StudentDistributionPanel({ bucket }: { bucket: DashboardBucket }) {
  const [basis, setBasis] = useState<StudentBasis>("students")
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const getValue = (row: BreakdownRow) => (basis === "students" ? row.studentCount : row.enrollmentCount)
  const unit = basis === "students" ? "명" : "건"
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
    .slice(0, 6)
  const schoolRows = [...bucket.studentBreakdowns.bySchool]
    .sort((left, right) => getValue(right) - getValue(left) || left.label.localeCompare(right.label, "ko", { numeric: true }))
    .slice(0, 6)
  const gradeMax = getMaxValue(gradeRows, basis)
  const schoolMax = getMaxValue(schoolRows, basis)

  return (
    <Card className="min-w-0 gap-4 rounded-xl py-5 shadow-xs">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 gap-3 px-4 sm:px-5 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" />
          학생 분포 매트릭스
        </CardTitle>
        <CardAction className="col-start-1 row-span-1 row-start-2 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          <SegmentedControl
            label="학생 기준"
            value={basis}
            items={[
              { key: "students", label: "인원 기준" },
              { key: "enrollments", label: "수강 기준" },
            ]}
            onChange={setBasis}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 px-4 sm:px-5 xl:grid-cols-2">
        <section className="min-w-0 rounded-xl border bg-muted/15 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">학년별 학교 분포</h3>
            <span className="text-xs text-muted-foreground">{basis === "students" ? "인원 기준" : "수강 기준"}</span>
          </div>
          <div className="space-y-3">
          {gradeRows.map((row) => {
            const value = getValue(row)
            const expansionKey = `grade:${row.label}`
            const isExpanded = expandedKeys.has(expansionKey)
            const allSchoolRowsForGrade = row.schools || []
            const schoolRowsForGrade = isExpanded ? allSchoolRowsForGrade : allSchoolRowsForGrade.slice(0, 3)
            const schoolMaxForGrade = getMaxValue(allSchoolRowsForGrade, basis)

            return (
              <div key={row.label} className="min-w-0 rounded-lg bg-background p-3">
                <div className={cn(DISTRIBUTION_ROW_CLASS, "text-sm")}>
                  <span className="truncate text-sm font-semibold">{row.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <AnimatedBar percent={getBarScale(value, gradeMax)} className="bg-primary" />
                  </div>
                  <span className="text-right tabular-nums">{formatNumber(value)}{unit}</span>
                </div>
                <div className="mt-3 grid gap-1.5">
                  {schoolRowsForGrade.map((school) => {
                    const schoolValue = getValue(school)

                    return (
                      <div key={school.label} className={cn(DISTRIBUTION_ROW_CLASS, "text-xs")}>
                        <span className="truncate font-medium text-muted-foreground">{school.label}</span>
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <AnimatedBar percent={getBarScale(schoolValue, schoolMaxForGrade, 6)} className="bg-primary/65" />
                        </div>
                        <span className="text-right tabular-nums">{formatNumber(schoolValue)}{unit}</span>
                      </div>
                    )
                  })}
                  {schoolRowsForGrade.length === 0 ? <EmptyLine label="학교 분포 없음" /> : null}
                  {allSchoolRowsForGrade.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(expansionKey)}
                      className="w-fit rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 active:translate-y-px"
                    >
                      {isExpanded ? "접기" : "더 보기"}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
          {gradeRows.length === 0 ? (
            <EmptyLine label="선택 탭에 표시할 학생 데이터가 없습니다." />
          ) : null}
          </div>
        </section>
        <section className="min-w-0 rounded-xl border bg-muted/15 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">학교별 학년 분포</h3>
            <span className="text-xs text-muted-foreground">{basis === "students" ? "인원 기준" : "수강 기준"}</span>
          </div>
          <div className="space-y-3">
            {schoolRows.map((row) => {
              const value = getValue(row)
              const expansionKey = `school:${row.label}`
              const isExpanded = expandedKeys.has(expansionKey)
              const allGradeRowsForSchool = row.grades || []
              const gradeRowsForSchool = isExpanded ? allGradeRowsForSchool : allGradeRowsForSchool.slice(0, 3)
              const gradeMaxForSchool = getMaxValue(allGradeRowsForSchool, basis)

              return (
                <div key={row.label} className="min-w-0 rounded-lg bg-background p-3">
                  <div className={cn(DISTRIBUTION_ROW_CLASS, "text-sm")}>
                    <span className="truncate font-semibold">{row.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <AnimatedBar percent={getBarScale(value, schoolMax)} className="bg-primary" />
                    </div>
                    <span className="text-right tabular-nums">{formatNumber(value)}{unit}</span>
                  </div>
                  <div className="mt-3 grid gap-1.5">
                    {gradeRowsForSchool.map((grade) => {
                      const gradeValue = getValue(grade)

                      return (
                        <div key={grade.label} className={cn(DISTRIBUTION_ROW_CLASS, "text-xs")}>
                          <span className="font-medium text-muted-foreground">{grade.label}</span>
                          <div className="h-1 overflow-hidden rounded-full bg-muted">
                            <AnimatedBar percent={getBarScale(gradeValue, gradeMaxForSchool, 6)} className="bg-primary/65" />
                          </div>
                          <span className="text-right tabular-nums">{formatNumber(gradeValue)}{unit}</span>
                        </div>
                      )
                    })}
                    {gradeRowsForSchool.length === 0 ? <EmptyLine label="학년 분포 없음" /> : null}
                    {allGradeRowsForSchool.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(expansionKey)}
                        className="w-fit rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 active:translate-y-px"
                      >
                        {isExpanded ? "접기" : "더 보기"}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
            {schoolRows.length === 0 ? <EmptyLine label="학교별 데이터 없음" /> : null}
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

function ClassOperationsPanel({ bucket }: { bucket: DashboardBucket }) {
  const [openGradeKeys, setOpenGradeKeys] = useState<Set<string>>(() => new Set())
  const [expandedClassKeys, setExpandedClassKeys] = useState<Set<string>>(() => new Set())
  const gradeRows = (bucket.classBreakdowns?.byGrade || []).slice(0, 5)
  const classMax = getClassMaxValue(gradeRows)
  const toggleOpenGrade = (key: string) => {
    setOpenGradeKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
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
    <Card className="min-w-0 gap-4 rounded-xl py-5 shadow-xs">
      <CardHeader className="px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers3 className="size-4 text-primary" />
          수업 운영
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 sm:px-5">
        <div className="grid gap-2">
          {gradeRows.map((row) => {
            const openKey = `class-grade:${row.label}`
            const isOpen = openGradeKeys.has(openKey)
            const isExpanded = expandedClassKeys.has(openKey)
            const allClassRows = row.classSummaries || []
            const classRows = isExpanded ? allClassRows : allClassRows.slice(0, 3)

            return (
              <div key={row.label} className="min-w-0 rounded-lg border bg-background p-2.5">
                <button
                  type="button"
                  onClick={() => toggleOpenGrade(openKey)}
                  className={CLASS_OPERATION_ROW_CLASS}
                  aria-expanded={isOpen}
                >
                  <span className="truncate px-1 text-sm font-medium">{row.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <AnimatedBar percent={getBarScale(row.classCount, classMax)} className="bg-primary" />
                  </div>
                  <span className="px-1 text-right text-sm tabular-nums">{formatNumber(row.classCount)}개</span>
                </button>
                {isOpen ? (
                  <div className="mt-3 grid gap-2 border-t pt-3">
                    {classRows.map((classItem) => (
                      <div key={classItem.id} className="min-w-0 rounded-lg bg-muted/35 px-3 py-2">
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5">
                          <Badge variant="outline" className="bg-primary/5 text-primary">{classItem.subject}</Badge>
                          <span className="min-w-0 truncate text-sm font-semibold">{classItem.title}</span>
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {formatNumber(classItem.studentCount)}명
                          </span>
                        </div>
                        <div className="mt-2 grid min-w-0 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                          <span className="min-w-0 truncate">{classItem.scheduleLabel}</span>
                          <span className="min-w-0 truncate sm:text-right">{classItem.teacherLabel} · {classItem.classroomLabel}</span>
                        </div>
                      </div>
                    ))}
                    {allClassRows.length === 0 ? <EmptyLine label="수업 정보 없음" /> : null}
                    {allClassRows.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpandedClassList(openKey)}
                        className="w-fit rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 active:translate-y-px"
                      >
                        {isExpanded ? "접기" : "더 보기"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {gradeRows.length === 0 ? <EmptyLine label="수업 데이터 없음" /> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ConflictBoard({ rows }: { rows: ConflictBoardRow[] }) {
  const affectedCount = rows.reduce((sum, row) => sum + row.affectedCount, 0)

  return (
    <Card className="min-w-0 gap-4 rounded-xl py-5 shadow-xs">
      <CardHeader className="px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" />
          일정 충돌 보드
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <Badge variant={rows.length > 0 ? "destructive" : "outline"}>{formatNumber(rows.length)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-4 sm:px-5">
        <div className="grid gap-3 xl:grid-cols-3">
          {rows.slice(0, 3).map((row) => (
            <div key={row.id} className="min-w-0 rounded-xl border bg-background p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="bg-primary/5 text-primary">{row.subjectLabel}</Badge>
                  <Badge variant="outline">{row.teacherLabel}</Badge>
                  <span className="min-w-0 max-w-full text-sm font-semibold leading-5">{row.classTitle}</span>
                  <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
                  <span className="text-sm font-semibold leading-5 text-destructive">{row.examLabel}</span>
                </div>
                <div className="mt-1 text-xs font-medium text-destructive">{row.contextLabel}</div>
              </div>
              <div className="mt-4 grid gap-2 text-xs">
                <ProcessRow
                  label="What"
                  value={(
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>본과목 수업일</span>
                      <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
                      <span>{row.whatTargetLabel}</span>
                    </span>
                  )}
                />
                <ProcessRow label="Who" value={row.whoLabel} />
                <ProcessRow label="Why" value={row.whyLabel} />
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)]">
                  <span className="text-muted-foreground">How</span>
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
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            선택 탭의 일정 충돌이 없습니다.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Badge variant="outline">충돌 영향 학생 {formatNumber(affectedCount)}명</Badge>
            <Badge variant="outline">대상 수업 {formatNumber(rows.length)}개</Badge>
            <Badge variant="outline">오늘 확정 필요 {formatNumber(rows.length)}건</Badge>
          </div>
        )}
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
    <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
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

  return (
    <div className="grid min-w-0 gap-4">
      <DashboardHeader
        subject={activeSubject}
        division={activeDivision}
        onSubjectChange={setActiveSubject}
        onDivisionChange={setActiveDivision}
        metrics={metrics}
      />
      <KpiStrip metrics={metrics} summary={summary} />
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.85fr)]">
        <StudentDistributionPanel bucket={activeBucket} />
        <ClassOperationsPanel bucket={activeBucket} />
      </div>
      <ConflictBoard rows={conflictRows} />
    </div>
  )
}
