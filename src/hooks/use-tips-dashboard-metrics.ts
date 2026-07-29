"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  buildDashboardMetrics,
  createEmptyDashboardMetrics,
} from "@/features/dashboard/metrics"
import { supabase } from "@/lib/supabase"

type DashboardMetricsData = Record<string, unknown> & {
  activeClassesCount: number
  studentsCount: number
  textbooksCount: number
  progressLogsCount: number
}

type ConflictSourceStatus = "loading" | "ready" | "error"

type DashboardConflictSources = {
  schedule: { status: ConflictSourceStatus; error: string }
  exam: { status: ConflictSourceStatus; error: string }
}

type DashboardMetricsState = DashboardMetricsData & {
  isLoading: boolean
  isConnected: boolean
  error: string | null
  conflictSources: DashboardConflictSources
}

type DashboardMetrics = DashboardMetricsState & {
  retryExamSources: () => void
}

type DashboardCoreData = {
  classes: unknown[]
  students: unknown[]
}

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10)
}

async function attachNormalizedLessonSessions(classes: unknown[]) {
  if (!supabase) return classes
  const normalizedIds = classes
    .filter((row) => typeof row === "object" && row !== null && String((row as { schedule_storage_mode?: unknown }).schedule_storage_mode || "") === "normalized")
    .map((row) => String((row as { id?: unknown }).id || "")).filter(Boolean)
  if (normalizedIds.length === 0) return classes
  const from = new Date()
  const to = new Date(from)
  to.setDate(to.getDate() + 180)
  const { data, error } = await supabase.from("class_lesson_sessions")
    .select("id,class_id,session_date,schedule_state")
    .in("class_id", normalizedIds)
    .gte("session_date", dayKey(from))
    .lte("session_date", dayKey(to))
  if (error) return classes
  const byClassId = new Map<string, unknown[]>()
  for (const row of data || []) {
    const classId = String((row as { class_id?: unknown }).class_id || "")
    const list = byClassId.get(classId) || []
    list.push(row)
    byClassId.set(classId, list)
  }
  const sessionsByClass = classes.map((row) => {
    if (typeof row !== "object" || row === null) return row
    const record = row as Record<string, unknown>
    return { ...record, lessonSessions: byClassId.get(String(record.id || "")) || [] }
  })
  classes.splice(0, classes.length, ...sessionsByClass)
  return classes
}

const buildMetrics = buildDashboardMetrics as unknown as (args: Record<string, unknown>) => DashboardMetricsData
const createEmptyMetrics = createEmptyDashboardMetrics as unknown as () => DashboardMetricsData

const EMPTY_METRICS = {
  ...createEmptyMetrics(),
  isLoading: true,
  isConnected: false,
  error: null as string | null,
  conflictSources: {
    schedule: { status: "loading", error: "" },
    exam: { status: "loading", error: "" },
  },
} satisfies DashboardMetricsState

const DASHBOARD_CORE_TABLE_TIMEOUT_MS = 15000
const DASHBOARD_OPTIONAL_TABLE_TIMEOUT_MS = 5000

type DashboardTableReadOptions = {
  optional?: boolean
  columns?: string
  timeoutMs?: number
}

type SupabaseTableResult = {
  data?: unknown[] | null
  error?: unknown | null
}

type DashboardTableReadResult = {
  data: unknown[]
  error: unknown | null
}

const DASHBOARD_TABLE_COLUMNS: Record<string, string> = {
  classes: "*",
  students: [
    "id",
    "name",
    "school",
    "grade",
    "status",
    "class_ids",
    "waitlist_class_ids",
  ].join(","),
  class_terms: "id,academic_year,name,status,start_date,end_date,sort_order",
  class_schedule_sync_groups: "id,term_id,name,subject,sort_order,is_default",
  class_schedule_sync_group_members: "group_id,class_id,sort_order",
  academic_schools: "id,name,category",
  academic_exam_days: "id,school_id,grade,subject,exam_date",
  academic_event_exam_details: "id,academic_event_id,school_id,grade,subject,exam_date",
  academic_events: "*",
  teacher_catalogs: "id,name,profile_id,subjects,is_visible",
  classroom_catalogs: "id,name,subjects,is_visible",
}

function isMissingRelationError(error: unknown) {
  const code = typeof error === "object" && error ? String((error as { code?: string }).code || "") : ""
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "")

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("Could not find the table")
  )
}

function isMissingColumnError(error: unknown) {
  const code = typeof error === "object" && error ? String((error as { code?: string }).code || "") : ""
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "")

  return code === "PGRST204" || message.includes("Could not find") || message.includes("column")
}

function withTableTimeout<T>(
  request: PromiseLike<T>,
  tableName: string,
  { timeoutMs }: { optional: boolean; timeoutMs: number },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${tableName} 데이터를 불러오지 못했습니다.`))
    }, timeoutMs)
  })

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

async function queryTable(tableName: string, columns: string, optional: boolean, timeoutMs: number) {
  return withTableTimeout<SupabaseTableResult>(
    supabase!.from(tableName).select(columns) as unknown as PromiseLike<SupabaseTableResult>,
    tableName,
    { optional, timeoutMs },
  )
}

async function readTableResult(
  tableName: string,
  options: DashboardTableReadOptions = {},
): Promise<DashboardTableReadResult> {
  if (!supabase) {
    return {
      data: [],
      error: new Error("Supabase 연결 설정을 확인해 주세요."),
    }
  }

  const optional = options.optional ?? false
  const columns = options.columns || DASHBOARD_TABLE_COLUMNS[tableName] || "*"
  const timeoutMs = options.timeoutMs || (optional ? DASHBOARD_OPTIONAL_TABLE_TIMEOUT_MS : DASHBOARD_CORE_TABLE_TIMEOUT_MS)

  try {
    let result = await queryTable(tableName, columns, optional, timeoutMs)

    if (result.error && columns !== "*" && isMissingColumnError(result.error)) {
      result = await queryTable(tableName, "*", optional, timeoutMs)
    }

    return {
      data: result.data || [],
      error: result.error || null,
    }
  } catch (error) {
    return { data: [], error }
  }
}

async function readTable(tableName: string, options: DashboardTableReadOptions = {}): Promise<unknown[]> {
  const result = await readTableResult(tableName, options)
  if (!result.error) {
    return result.data
  }
  if (options.optional) {
    return []
  }
  if (isMissingRelationError(result.error)) {
    throw new Error(`${tableName} 데이터 원본을 찾지 못했습니다.`)
  }
  throw result.error
}

function getSourceError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

export function useTipsDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetricsState>(EMPTY_METRICS)
  const [coreData, setCoreData] = useState<DashboardCoreData | null>(null)
  const [examSourceRevision, setExamSourceRevision] = useState(0)

  const retryExamSources = useCallback(() => {
    setMetrics((current) => ({
      ...current,
      conflictSources: {
        ...current.conflictSources,
        exam: { status: "loading", error: "" },
      },
    }))
    setExamSourceRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadCoreMetrics() {
      if (!supabase) {
        if (isMounted) {
          const connectionError = "Supabase 연결 설정을 확인해 주세요."
          setMetrics({
            ...EMPTY_METRICS,
            isLoading: false,
            error: connectionError,
            conflictSources: {
              schedule: { status: "error", error: connectionError },
              exam: { status: "error", error: connectionError },
            },
          })
        }
        return
      }

      try {
        const [classes, students] = await Promise.all([readTable("classes"), readTable("students")])
        await attachNormalizedLessonSessions(classes)

        if (isMounted) {
          setMetrics({
            ...buildMetrics({ classes, students, }),
            isLoading: false,
            isConnected: true,
            error: null,
            conflictSources: {
              schedule: { status: "ready", error: "" },
              exam: { status: "loading", error: "" },
            },
          })
          setCoreData({ classes, students })
        }
      } catch (error) {
        if (isMounted) {
          const message = getSourceError(error, "알 수 없는 연결 오류가 발생했습니다.")
          setMetrics({
            ...EMPTY_METRICS,
            isLoading: false,
            error: message,
            conflictSources: {
              schedule: { status: "error", error: message },
              exam: { status: "loading", error: "" },
            },
          })
        }
      }
    }

    loadCoreMetrics()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!coreData) return
    const sourceData = coreData

    let isMounted = true

    async function loadEnrichment() {
      setMetrics((current) => ({
        ...current,
        conflictSources: {
          ...current.conflictSources,
          exam: { status: "loading", error: "" },
        },
      }))

      const [
        classTerms,
        classGroups,
        classGroupMembers,
        teacherCatalogs,
        classroomCatalogs,
        academicSchoolsResult,
        academicExamDaysResult,
        academicEventExamDetailsResult,
        academicEventsResult,
      ] = await Promise.all([
        readTable("class_terms", { optional: true }),
        readTable("class_schedule_sync_groups", { optional: true }),
        readTable("class_schedule_sync_group_members", { optional: true }),
        readTable("teacher_catalogs", { optional: true }),
        readTable("classroom_catalogs", { optional: true }),
        readTableResult("academic_schools", { optional: true }),
        readTableResult("academic_exam_days", { optional: true }),
        readTableResult("academic_event_exam_details", { optional: true }),
        readTableResult("academic_events", { optional: true }),
      ])

      if (!isMounted) return

      const examErrors = [
        academicSchoolsResult.error,
        academicExamDaysResult.error,
        academicEventExamDetailsResult.error,
        academicEventsResult.error,
      ].filter(Boolean)
      const examReady = examErrors.length === 0
      const examError = examReady
        ? ""
        : getSourceError(examErrors[0], "시험 일정 데이터를 불러오지 못했습니다.")

      setMetrics({
        ...buildMetrics({
          classes: sourceData.classes,
          students: sourceData.students,
          classTerms,
          classGroups,
          classGroupMembers,
          teacherCatalogs,
          classroomCatalogs,
          academicSchools: examReady ? academicSchoolsResult.data : [],
          academicExamDays: examReady ? academicExamDaysResult.data : [],
          academicEventExamDetails: examReady ? academicEventExamDetailsResult.data : [],
          academicEvents: examReady ? academicEventsResult.data : [],
        }),
        isLoading: false,
        isConnected: true,
        error: null,
        conflictSources: {
          schedule: { status: "ready", error: "" },
          exam: {
            status: examReady ? "ready" : "error",
            error: examError,
          },
        },
      })
    }

    loadEnrichment()

    return () => {
      isMounted = false
    }
  }, [coreData, examSourceRevision])

  return useMemo<DashboardMetrics>(
    () => ({ ...metrics, retryExamSources }),
    [metrics, retryExamSources],
  )
}
