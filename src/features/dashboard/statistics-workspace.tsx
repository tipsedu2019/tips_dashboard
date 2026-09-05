"use client"

import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConflictWarning as DashboardConflictWarning } from "@/app/admin/dashboard/components/section-cards"
import type { DashboardConflictRow } from "@/features/dashboard/conflict-contract"
import { DASHBOARD_STATISTICS_RANGE_PRESETS, type DashboardStatisticsTab } from "@/features/dashboard/statistics-contract"
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
  renderOnError = false,
  children,
}: {
  loading: boolean
  error: string | null
  generatedAt: string | null
  onRefresh: () => void
  controls?: ReactNode
  renderOnError?: boolean
  children: ReactNode
}) {
  const updated = generatedAt ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(generatedAt)) : "-"
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <span className="text-xs text-muted-foreground">마지막 갱신 {updated}</span>
      <Button type="button" size="sm" variant="outline" onClick={onRefresh}>새로고침</Button>
    </div>
    {controls ? <div className="min-w-0">{controls}</div> : null}
    <div role="region" aria-label="통계 결과" aria-busy={loading} className="grid gap-4">
      {loading ? <Card role="status"><CardContent className="py-10 text-sm text-muted-foreground">통계를 불러오는 중입니다.</CardContent></Card> : null}
      {error && !renderOnError ? <Card role="alert"><CardContent className="flex items-center justify-between gap-3 py-6 text-sm"><span>{error}</span><Button type="button" size="sm" onClick={onRefresh}>다시 시도</Button></CardContent></Card> : null}
      {!loading && (!error || renderOnError) ? children : null}
    </div>
  </div>
}

function SummaryCards({ summary }: { summary: Data }) {
  const activeClassesCount = number(summary.activeClassesCount)
  const averageEnrollmentsPerClass = activeClassesCount > 0
    ? (number(summary.registeredEnrollmentCount) / activeClassesCount).toLocaleString("ko-KR", { maximumFractionDigits: 1 })
    : "-"
  const values = [
    ["재원", `${format(summary.uniqueRegisteredStudentCount)}명`, summary.uniqueWaitlistStudentCount ? `대기 ${format(summary.uniqueWaitlistStudentCount)}명` : ""],
    ["수강", `${format(summary.registeredEnrollmentCount)}명`, ""],
    ["수업", `${format(summary.activeClassesCount)}개`, text(summary.weeklyHoursLabel) ? `주간 ${text(summary.weeklyHoursLabel)}` : ""],
    ["수업당", `${averageEnrollmentsPerClass}명`, ""],
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

function StudentBreakdowns({ data, subject, division }: { data: Data; subject: Subject; division: Division }) {
  const breakdowns = object(data.studentBreakdowns)
  const groups: Array<{ axis: "grade" | "school"; title: string; rows: Data[] }> = [
    { axis: "grade", title: "학년별 학생 분포", rows: list(breakdowns.byGrade) },
    { axis: "school", title: "학교별 학생 분포", rows: list(breakdowns.bySchool) },
  ]
  return <div className="grid gap-4 lg:grid-cols-2">{groups.map((group) => <Card key={group.axis}><CardHeader><CardTitle className="text-base">{group.title}</CardTitle></CardHeader><CardContent className="grid gap-2">{group.rows.length ? group.rows.map((row) => {
    const key = text(row.key) || text(row.label)
    const children = list(row.children)
    return <div key={key} className="rounded-lg border p-3"><div className="flex justify-between gap-3"><span className="font-medium">{text(row.label)}</span><span className="tabular-nums text-sm">{format(row.studentCount)}명 · {format(row.enrollmentCount)}건</span></div>
      <StatisticsDrilldown label="학생 명단 보기" input={{ kind: "student-roster", subject, division, axis: group.axis, key, parentKey: "" }} />
      {children.length ? <div className="mt-2 grid gap-1 border-l pl-3">{children.map((child) => {
        const childKey = text(child.key) || text(child.label)
        const nestedAxis = group.axis === "grade" ? "grade_school" : "school_grade"
        return <div key={childKey} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{text(child.label)} · {format(child.studentCount)}명</span><StatisticsDrilldown label="학생 명단 보기" input={{ kind: "student-roster", subject, division, axis: nestedAxis, key: childKey, parentKey: key }} /></div>
      })}</div> : null}
    </div>
  }) : <p className="text-sm text-muted-foreground">학생 데이터 없음</p>}</CardContent></Card>)}</div>
}

function ClassGroups({ data, subject, division }: { data: Data; subject: Subject; division: Division }) {
  const classGroups = object(data.classGroups)
  const [axis, setAxis] = useState<"grade" | "teacher" | "classroom">("grade")
  const rows = list(axis === "grade" ? classGroups.byGrade : axis === "teacher" ? classGroups.byTeacher : classGroups.byClassroom)
  return <Card><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle className="text-base">수업 운영</CardTitle><FilterButtons label="그룹" active={axis} onChange={setAxis} values={[{ key: "grade", label: "학년" }, { key: "teacher", label: "선생님" }, { key: "classroom", label: "강의실" }]} /></CardHeader><CardContent className="grid gap-2">{rows.length ? rows.map((row) => {
    const key = text(row.key) || text(row.label)
    return <div key={key} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{text(row.label)}</span><span className="text-sm tabular-nums">{format(row.classCount)}개 · {text(row.weeklyHoursLabel)} · {format(row.studentCount)}명</span></div>
      <StatisticsDrilldown label="수업 목록 보기" input={{ kind: "class-group", subject, division, axis, key }} renderRow={(classRow) => <div className="flex flex-wrap items-center justify-between gap-2"><span>{text(classRow.title)}</span><StatisticsDrilldown label="학생 명단 보기" input={{ kind: "class-roster", classId: text(classRow.id) }} /></div>} />
    </div>
  }) : <p className="text-sm text-muted-foreground">수업 데이터 없음</p>}</CardContent></Card>
}

function StudentsClassesPanel() {
  const [subject, setSubject] = useState<Subject>("all")
  const [division, setDivision] = useState<Division>("all")
  const state = useStatisticsSnapshot({ tab: "students_classes", subject, division })
  const data = object(state.data)
  const controls = <div className="flex flex-wrap gap-4"><FilterButtons label="과목" values={subjects} active={subject} onChange={setSubject} /><FilterButtons label="부서" values={divisions} active={division} onChange={setDivision} /></div>
  return <PanelState {...state} onRefresh={state.refresh} controls={controls}>
    <SummaryCards summary={object(data.summary)} /><StudentBreakdowns data={data} subject={subject} division={division} /><ClassGroups data={data} subject={subject} division={division} />
  </PanelState>
}

function ScheduleConflictsPanel() {
  const state = useStatisticsSnapshot({ tab: "schedule_conflicts" })
  const data = object(state.data)
  const rows = [...list(data.teacherConflicts), ...list(data.classroomConflicts), ...list(data.examConflicts)]
  const sourceStatus: "loading" | "ready" | "error" = state.loading
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
  const controls = <div role="group" aria-label="일정 기간" className="flex flex-wrap gap-1.5">{DASHBOARD_STATISTICS_RANGE_PRESETS.schedule_conflicts.map((preset) => <Button key={preset} type="button" size="sm" aria-pressed={state.range === preset} variant={state.range === preset ? "default" : "outline"} onClick={() => state.setRange(preset)}>앞으로 {preset}일</Button>)}</div>
  return <PanelState {...state} onRefresh={state.refresh} controls={controls} renderOnError>
    <DashboardConflictWarning metrics={conflictMetrics} />
  </PanelState>
}

function TextbookStatisticsPanel() {
  const state = useStatisticsSnapshot({ tab: "textbooks" })
  const data = object(state.data)
  const progress = object(data.progressSessions)
  const controls = <div role="group" aria-label="교재 기간" className="flex flex-wrap gap-1.5">{DASHBOARD_STATISTICS_RANGE_PRESETS.textbooks.map((preset) => <Button key={preset} type="button" size="sm" aria-pressed={state.range === preset} variant={state.range === preset ? "default" : "outline"} onClick={() => state.setRange(preset)}>{preset}일</Button>)}</div>
  return <PanelState {...state} onRefresh={state.refresh} controls={controls}>
    <section aria-label="교재 통계" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[ ["사용 교재", data.activeTitles], ["교재 배정 수업", data.activeClassesWithTextbook], ["교재 미배정 수업", data.activeClassesWithoutTextbook], ["진도 기록", data.updatedProgressSessions], ["진도 완료", progress.done], ["진도 예정", progress.pending], ["진도 진행", progress.partial] ].map(([label, value]) => <Card key={String(label)}><CardContent className="py-5"><p className="text-sm text-muted-foreground">{String(label)}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{format(value)}건</p></CardContent></Card>)}
    </section>
  </PanelState>
}

export function StatisticsWorkspace() {
  const [activeTab, setActiveTab] = useState<DashboardStatisticsTab>("overview")
  return <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DashboardStatisticsTab)} activationMode="manual" className="min-w-0 gap-4 px-3 pb-5 sm:px-4 sm:pb-6 lg:px-6">
    <TabsList aria-label="통계 탭" className="grid h-auto w-full grid-cols-4 gap-1 p-1">
      {STATISTICS_TABS.map((tab) => <TabsTrigger key={tab.key} value={tab.key} className="min-w-0 px-1.5 text-xs sm:px-3 sm:text-sm">{tab.label}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="overview"><OverviewPanel /></TabsContent>
    <TabsContent value="students_classes"><StudentsClassesPanel /></TabsContent>
    <TabsContent value="schedule_conflicts"><ScheduleConflictsPanel /></TabsContent>
    <TabsContent value="textbooks"><TextbookStatisticsPanel /></TabsContent>
  </Tabs>
}
