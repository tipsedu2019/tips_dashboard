"use client"

import { useEffect, useState, type ReactNode } from "react"

import { useSearchParams } from "next/navigation"
import { requestAppNavigation } from "@/lib/guarded-navigation"
import { parseStatisticsRouteState, serializeStatisticsRouteState, type StatisticsRouteState } from "@/features/dashboard/statistics-route-state"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConflictWarning as DashboardConflictWarning } from "@/app/admin/dashboard/components/section-cards"
import type { DashboardConflictRow } from "@/features/dashboard/conflict-contract"
import { DASHBOARD_STATISTICS_RANGE_PRESETS, type DashboardStatisticsTab } from "@/features/dashboard/statistics-contract"
import { sortStatisticsDistribution, statisticsBarPercent } from "@/features/dashboard/statistics-presentation"
import { StatisticsDrilldown } from "@/features/dashboard/statistics-drilldown"
import { useStatisticsSnapshot } from "@/features/dashboard/use-statistics-snapshot"

const STATISTICS_TABS: Array<{ key: DashboardStatisticsTab; label: string }> = [
  { key: "overview", label: "운영 요약" },
  { key: "students_classes", label: "학생·수업" },
  { key: "schedule_conflicts", label: "일정 충돌" },
  { key: "textbooks", label: "교재" },
]

type Data = Record<string, unknown>
type Subject = "all" | "english" | "math" | "science"
type Division = "all" | "middle" | "high"

const subjects: Array<{ key: Subject; label: string }> = [
  { key: "all", label: "전체" }, { key: "english", label: "영어" }, { key: "math", label: "수학" }, { key: "science", label: "과학" },
]
const divisions: Array<{ key: Division; label: string }> = [
  { key: "all", label: "전체" }, { key: "middle", label: "초중등부" }, { key: "high", label: "고등부" },
]

function object(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {} }
function list(value: unknown): Data[] { return Array.isArray(value) ? value.map(object) : [] }
function text(value: unknown) { return typeof value === "string" ? value : "" }
function number(value: unknown) { return Number.isFinite(Number(value)) ? Number(value) : 0 }
function format(value: unknown) { return number(value).toLocaleString("ko-KR") }

function PanelState({
  loading,
  error,
  generatedAt,
  onRefresh,
  controls,
  snapshot,
  renderOnError = false,
  children,
}: {
  loading: boolean
  error: string | null
  generatedAt: string | null
  onRefresh: () => void
  controls?: ReactNode
  snapshot: unknown
  renderOnError?: boolean
  children: ReactNode
}) {
  const hasSnapshot = snapshot != null
  const updated = generatedAt ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(generatedAt)) : "-"
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <span className="text-xs text-muted-foreground">마지막 갱신 {updated}</span>
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onRefresh}>새로고침</Button>
    </div>
    {controls ? <div className="min-w-0">{controls}</div> : null}
    <div role="region" aria-label="통계 결과" aria-busy={loading} className="grid gap-4">
      {loading && hasSnapshot ? <p role="status" className="text-sm text-muted-foreground">통계를 갱신하는 중입니다.</p> : null}
      {loading && !hasSnapshot ? <Card role="status"><CardContent className="py-10 text-sm text-muted-foreground">통계를 불러오는 중입니다.</CardContent></Card> : null}
      {error && (!renderOnError || hasSnapshot) ? <Card role="alert"><CardContent className="flex items-center justify-between gap-3 py-6 text-sm"><span>{hasSnapshot ? `갱신 실패 · ${error} 이전 통계를 표시합니다.` : error}</span><Button type="button" size="sm" onClick={onRefresh}>다시 시도</Button></CardContent></Card> : null}
      {hasSnapshot || (!loading && (!error || renderOnError)) ? children : null}
    </div>
  </div>
}

function SummaryCards({ summary }: { summary: Data }) {
  const activeClassesCount = number(summary.activeClassesCount)
  const averageEnrollmentsPerClass = activeClassesCount > 0
    ? (number(summary.registeredEnrollmentCount) / activeClassesCount).toLocaleString("ko-KR", { maximumFractionDigits: 1 })
    : "-"
  const values = [
    ["재원 학생", `${format(summary.uniqueRegisteredStudentCount)}명`, summary.uniqueWaitlistStudentCount ? `대기 ${format(summary.uniqueWaitlistStudentCount)}명` : ""],
    ["수강 등록", `${format(summary.registeredEnrollmentCount)}건`, ""],
    ["운영 수업", `${format(summary.activeClassesCount)}개`, text(summary.weeklyHoursLabel) ? `주간 ${text(summary.weeklyHoursLabel)}` : ""],
    ["수업당 평균", `${averageEnrollmentsPerClass}명`, ""],
  ]
  return <section aria-label="핵심 운영 지표" className="grid overflow-hidden rounded-xl border bg-background md:grid-cols-2 lg:grid-cols-4">
    {values.map(([label, value, sub], index) => <div key={label} className={`min-w-0 px-4 py-3 ${index > 0 ? "border-t md:border-l md:border-t-0" : ""}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>{sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>)}
  </section>
}

function OverviewPanel() {
  const state = useStatisticsSnapshot({ tab: "overview" })
  const data = object(state.data)
  return <PanelState {...state} onRefresh={state.refresh}><SummaryCards summary={object(data.summary)} /></PanelState>
}

function FilterButtons<T extends string>({ label, values, active, onChange }: { label: string; values: Array<{ key: T; label: string }>; active: T; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs font-semibold text-muted-foreground">{label}</span>{values.map((value) => <Button key={value.key} type="button" size="sm" aria-pressed={active === value.key} variant={active === value.key ? "default" : "outline"} onClick={() => onChange(value.key)}>{value.label}</Button>)}</div>
}

function DistributionBar({ label, value, maximum, unit }: { label: string; value: number; maximum: number; unit: string }) {
  return <span className="grid w-full min-w-0 gap-2 text-left">
    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="min-w-0 whitespace-normal break-words font-medium">{label}</span><span className="shrink-0 tabular-nums">{format(value)}{unit}</span></span>
    <span aria-hidden="true" className="block h-2 w-full overflow-hidden border-l border-foreground/40 bg-muted"><span className="block h-full bg-primary" style={{ width: `${statisticsBarPercent(value, maximum)}%` }} /></span>
  </span>
}

function StudentBreakdowns({ data, subject, division }: { data: Data; subject: Subject; division: Division }) {
  const [showAllSchools, setShowAllSchools] = useState(false)
  const breakdowns = object(data.studentBreakdowns)
  const groups: Array<{ axis: "grade" | "school"; title: string; rows: Data[] }> = [
    { axis: "grade", title: "학년별 학생 분포", rows: sortStatisticsDistribution(list(breakdowns.byGrade), "grade") },
    { axis: "school", title: "학교별 학생 분포", rows: sortStatisticsDistribution(list(breakdowns.bySchool), "school") },
  ]
  const maximum = Math.max(0, ...groups.flatMap(group => group.rows.map(row => number(row.studentCount))))
  return <div className="grid items-start gap-4 lg:grid-cols-2">{groups.map((group) => <Card key={group.axis}><CardHeader><CardTitle className="text-base">{group.title}</CardTitle><p className="text-xs text-muted-foreground">전체 {group.rows.length}{group.axis === "school" ? "개 학교" : "개 학년"}</p></CardHeader><CardContent className="grid gap-3">{group.rows.length ? (group.axis === "school" && !showAllSchools ? group.rows.slice(0, 8) : group.rows).map((row) => {
    const key = text(row.key)
    const children = sortStatisticsDistribution(list(row.children), group.axis === "school" ? "grade" : "school")
    return <div key={key} className="grid min-w-0 gap-2 border-b pb-3 last:border-0">
      <StatisticsDrilldown label={`${text(row.label)} 학생 명단 보기`} trigger={<DistributionBar label={text(row.label)} value={number(row.studentCount)} maximum={maximum} unit="명" />} input={{ kind: "student-roster", subject, division, axis: group.axis, key, parentKey: "" }} />
      <span className="text-xs text-muted-foreground">수강 등록 {format(row.enrollmentCount)}건</span>
      {children.length ? <details className="text-sm"><summary className="cursor-pointer py-1 text-muted-foreground">{group.axis === "grade" ? "학교별" : "학년별"} 보기</summary><div className="mt-2 grid gap-2 border-l pl-3">{children.map((child) => {
        const childKey = text(child.key)
        const nestedAxis = group.axis === "grade" ? "grade_school" : "school_grade"
        return <div key={childKey} className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="break-words">{text(child.label)} · {format(child.studentCount)}명</span><StatisticsDrilldown label="학생 명단 보기" input={{ kind: "student-roster", subject, division, axis: nestedAxis, key: childKey, parentKey: key }} /></div>
      })}</div></details> : null}
    </div>
  }) : <p className="text-sm text-muted-foreground">학생 데이터 없음</p>}{group.axis === "school" && group.rows.length > 8 ? <Button type="button" variant="outline" aria-expanded={showAllSchools} onClick={() => setShowAllSchools(!showAllSchools)}>{showAllSchools ? "상위 8개 보기" : `모두 보기 (${group.rows.length}개 학교)`}</Button> : null}</CardContent></Card>)}</div>
}

function ClassGroups({ data, subject, division }: { data: Data; subject: Subject; division: Division }) {
  const classGroups = object(data.classGroups)
  const [axis, setAxis] = useState<"grade" | "teacher" | "classroom">("grade")
  const rows = sortStatisticsDistribution(list(axis === "grade" ? classGroups.byGrade : axis === "teacher" ? classGroups.byTeacher : classGroups.byClassroom), axis, "classCount")
  const maximum = Math.max(0, ...rows.map(row => number(row.classCount)))
  return <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-3"><CardTitle className="text-base">수업 운영</CardTitle><FilterButtons label="그룹" active={axis} onChange={setAxis} values={[{ key: "grade", label: "학년" }, { key: "teacher", label: "선생님" }, { key: "classroom", label: "강의실" }]} /></CardHeader><CardContent className="grid gap-2">{rows.length ? rows.map((row) => {
    const key = text(row.key)
    return <div key={key} className="rounded-lg border p-3"><p className="text-sm text-muted-foreground tabular-nums">주간 {text(row.weeklyHoursLabel)} · 학생 {format(row.studentCount)}명</p>
      <StatisticsDrilldown label={`${text(row.label)} 수업 목록 보기`} trigger={<DistributionBar label={text(row.label)} value={number(row.classCount)} maximum={maximum} unit="개" />} input={{ kind: "class-group", subject, division, axis, key }} renderRow={(classRow) => <div className="flex flex-wrap items-center justify-between gap-2"><span>{text(classRow.title)}</span><StatisticsDrilldown label="학생 명단 보기" input={{ kind: "class-roster", classId: text(classRow.id) }} /></div>} />
    </div>
  }) : <p className="text-sm text-muted-foreground">수업 데이터 없음</p>}</CardContent></Card>
}

type RoutePanelProps = { route: StatisticsRouteState; onFilter: (patch: Partial<StatisticsRouteState>) => void }

function StudentsClassesPanel({ route, onFilter }: RoutePanelProps) {
  const { subject, division } = route
  const state = useStatisticsSnapshot({ tab: "students_classes", subject, division })
  const data = object(state.data)
  const controls = <div className="flex flex-wrap gap-4"><FilterButtons label="과목" values={subjects} active={subject} onChange={subject => onFilter({ subject })} /><FilterButtons label="부서" values={divisions} active={division} onChange={division => onFilter({ division })} /></div>
  return <PanelState {...state} onRefresh={state.refresh} controls={controls}>
    <SummaryCards summary={object(data.summary)} /><StudentBreakdowns key={`students:${subject}:${division}`} data={data} subject={subject} division={division} /><ClassGroups key={`classes:${subject}:${division}`} data={data} subject={subject} division={division} />
  </PanelState>
}

function ScheduleConflictsPanel({ route, onFilter }: RoutePanelProps) {
  const state = useStatisticsSnapshot({ tab: "schedule_conflicts", rangeQuery: String(route.range) })
  const data = object(state.data)
  const rows = [...list(data.teacherConflicts), ...list(data.classroomConflicts), ...list(data.examConflicts)]
  const sourceStatus: "loading" | "ready" | "error" = state.snapshot ? "ready" : state.loading
    ? "loading"
    : state.error
      ? "error"
      : "ready"
  const conflictMetrics = {
    conflictRows: rows as DashboardConflictRow[],
    conflictSources: {
      schedule: { status: sourceStatus, error: state.error || "" },
      exam: { status: sourceStatus, error: state.error || "" },
    },
    retryConflictSources: state.refresh,
  }
  const controls = <div role="group" aria-label="일정 기간" className="flex flex-wrap gap-1.5">{DASHBOARD_STATISTICS_RANGE_PRESETS.schedule_conflicts.map((preset) => <Button key={preset} type="button" size="sm" aria-pressed={state.range === preset} variant={state.range === preset ? "default" : "outline"} onClick={() => onFilter({ range: preset })}>앞으로 {preset}일</Button>)}</div>
  return <PanelState {...state} onRefresh={state.refresh} controls={controls} renderOnError>
    <DashboardConflictWarning metrics={conflictMetrics} />
  </PanelState>
}

function TextbookStatisticsPanel({ route, onFilter }: RoutePanelProps) {
  const state = useStatisticsSnapshot({ tab: "textbooks", rangeQuery: String(route.range) })
  const data = object(state.data)
  const progress = object(data.progressSessions)
  const controls = <div role="group" aria-label="교재 기간" className="flex flex-wrap gap-1.5">{DASHBOARD_STATISTICS_RANGE_PRESETS.textbooks.map((preset) => <Button key={preset} type="button" size="sm" aria-pressed={state.range === preset} variant={state.range === preset ? "default" : "outline"} onClick={() => onFilter({ range: preset })}>{preset}일</Button>)}</div>
  return <PanelState {...state} onRefresh={state.refresh} controls={controls}>
    <section aria-label="교재 통계" className="grid items-start gap-4 md:grid-cols-2">
      {[
        { title: "교재·수업 배정", rows: [["사용 교재", data.activeTitles, "종"], ["교재 배정 수업", data.activeClassesWithTextbook, "개"], ["교재 미배정 수업", data.activeClassesWithoutTextbook, "개"]] },
        { title: "기간 내 진도 기록", rows: [["전체 기록", data.updatedProgressSessions, "건"], ["진도 완료", progress.done, "건"], ["진도 예정", progress.pending, "건"], ["진도 진행", progress.partial, "건"]] },
      ].map(group => <Card key={group.title}><CardHeader><CardTitle className="text-base">{group.title}</CardTitle></CardHeader><CardContent><dl className="grid gap-3">{group.rows.map(([label, value, unit]) => <div key={String(label)} className="flex items-baseline justify-between gap-3"><dt className="text-sm text-muted-foreground">{String(label)}</dt><dd className="font-semibold tabular-nums">{format(value)}{String(unit)}</dd></div>)}</dl></CardContent></Card>)}
    </section>
  </PanelState>
}

export function StatisticsWorkspace() {
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const route = parseStatisticsRouteState(search)
  const canonical = serializeStatisticsRouteState(route)
  useEffect(() => {
    if (search !== canonical) window.history.replaceState(null, "", `${window.location.pathname}${canonical ? `?${canonical}` : ""}${window.location.hash}`)
  }, [canonical, search])
  const navigate = (next: StatisticsRouteState, mode: "pushState" | "replaceState") => {
    const query = serializeStatisticsRouteState(next)
    requestAppNavigation(() => window.history[mode](null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`))
  }
  const onFilter = (patch: Partial<StatisticsRouteState>) => navigate({ ...route, ...patch }, "replaceState")
  return <Tabs value={route.tab} onValueChange={(value) => navigate({ tab: value as DashboardStatisticsTab, subject: "all", division: "all", range: 90 }, "pushState")} activationMode="manual" className="min-w-0 gap-4 px-3 pb-5 sm:px-4 sm:pb-6 lg:px-6">
    <TabsList aria-label="통계 탭" className="grid h-auto w-full grid-cols-4 gap-1 p-1">
      {STATISTICS_TABS.map((tab) => <TabsTrigger key={tab.key} value={tab.key} className="min-w-0 px-1.5 text-xs sm:px-3 sm:text-sm">{tab.label}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="overview"><OverviewPanel /></TabsContent>
    <TabsContent value="students_classes"><StudentsClassesPanel route={route} onFilter={onFilter} /></TabsContent>
    <TabsContent value="schedule_conflicts"><ScheduleConflictsPanel route={route} onFilter={onFilter} /></TabsContent>
    <TabsContent value="textbooks"><TextbookStatisticsPanel route={route} onFilter={onFilter} /></TabsContent>
  </Tabs>
}
