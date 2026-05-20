"use client"

import { useEffect, useState } from "react"

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

type DashboardMetricsState = DashboardMetricsData & {
  isLoading: boolean
  isConnected: boolean
  error: string | null
}

const buildMetrics = buildDashboardMetrics as unknown as (args: Record<string, unknown>) => DashboardMetricsData
const createEmptyMetrics = createEmptyDashboardMetrics as unknown as () => DashboardMetricsData

const EMPTY_METRICS = {
  ...createEmptyMetrics(),
  isLoading: true,
  isConnected: false,
  error: null as string | null,
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

const DASHBOARD_TABLE_COLUMNS: Record<string, string> = {
  classes: [
    "id",
    "name",
    "subject",
    "status",
    "schedule",
    "schedule_plan",
    "teacher",
    "room",
    "grade",
    "student_ids",
    "waitlist_student_ids",
  ].join(","),
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
  academic_events: "id,title,type,type_label,school_id,school,school_name,grade,exam_date,start,start_date,date,note",
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
  { optional, timeoutMs }: { optional: boolean; timeoutMs: number },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      if (optional) {
        resolve({ data: [], error: null } as T)
        return
      }

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

async function readTable(tableName: string, options: DashboardTableReadOptions = {}): Promise<unknown[]> {
  if (!supabase) {
    return []
  }

  const optional = options.optional ?? false
  const columns = options.columns || DASHBOARD_TABLE_COLUMNS[tableName] || "*"
  const timeoutMs = options.timeoutMs || (optional ? DASHBOARD_OPTIONAL_TABLE_TIMEOUT_MS : DASHBOARD_CORE_TABLE_TIMEOUT_MS)
  let result = await queryTable(tableName, columns, optional, timeoutMs)

  if (result.error && columns !== "*" && isMissingColumnError(result.error)) {
    result = await queryTable(tableName, "*", optional, timeoutMs)
  }

  if (result.error) {
    if (optional || isMissingRelationError(result.error)) {
      return []
    }
    throw result.error
  }

  return result.data || []
}

export function useTipsDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetricsState>(EMPTY_METRICS)

  useEffect(() => {
    let isMounted = true

    async function loadMetrics() {
      if (!supabase) {
        if (isMounted) {
          setMetrics({
            ...EMPTY_METRICS,
            isLoading: false,
            error: "Supabase 연결 설정을 확인해 주세요.",
          })
        }
        return
      }

      try {
        const [classes, students] = await Promise.all([
          readTable("classes"),
          readTable("students"),
        ])

        if (isMounted) {
          setMetrics({
            ...buildMetrics({
              classes,
              students,
            }),
            isLoading: false,
            isConnected: true,
            error: null,
          })
        }

        const [
          classTerms,
          classGroups,
          classGroupMembers,
          academicSchools,
          academicExamDays,
          academicEventExamDetails,
          academicEvents,
        ] = await Promise.all([
          readTable("class_terms", { optional: true }),
          readTable("class_schedule_sync_groups", { optional: true }),
          readTable("class_schedule_sync_group_members", { optional: true }),
          readTable("academic_schools", { optional: true }),
          readTable("academic_exam_days", { optional: true }),
          readTable("academic_event_exam_details", { optional: true }),
          readTable("academic_events", { optional: true }),
        ])

        if (isMounted) {
          setMetrics({
            ...buildMetrics({
              classes,
              students,
              classTerms,
              classGroups,
              classGroupMembers,
              academicSchools,
              academicExamDays,
              academicEventExamDetails,
              academicEvents,
            }),
            isLoading: false,
            isConnected: true,
            error: null,
          })
        }
      } catch (error) {
        if (isMounted) {
          setMetrics({
            ...EMPTY_METRICS,
            isLoading: false,
            error: error instanceof Error ? error.message : "알 수 없는 연결 오류가 발생했습니다.",
          })
        }
      }
    }

    loadMetrics()

    return () => {
      isMounted = false
    }
  }, [])

  return metrics
}
