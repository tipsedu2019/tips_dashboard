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
  ops_tasks: [
    "id",
    "title",
    "type",
    "status",
    "subject",
    "campus",
    "student_name",
    "class_name",
    "completed_at",
    "created_at",
    "updated_at",
  ].join(","),
  ops_registration_details: "task_id,pipeline_status,class_start_date,inquiry_at,level_test_at,consultation_at,school_grade,school_name",
  ops_withdrawal_details: "task_id,withdrawal_date,withdrawal_session,teacher_name,school_grade",
}

function text(value: unknown) {
  return String(value || "").trim()
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

function indexByTaskId(rows: unknown[]) {
  const map = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const taskId = text(record.task_id)
    if (taskId) map.set(taskId, record)
  }
  return map
}

function buildDashboardOpsTasks(
  tasks: unknown[],
  registrationRows: unknown[],
  withdrawalRows: unknown[],
) {
  const registrationsByTaskId = indexByTaskId(registrationRows)
  const withdrawalsByTaskId = indexByTaskId(withdrawalRows)

  return tasks
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const task = row as Record<string, unknown>
      const id = text(task.id)
      if (!id) return null
      const registration = registrationsByTaskId.get(id)
      const withdrawal = withdrawalsByTaskId.get(id)

      return {
        id,
        title: text(task.title),
        type: text(task.type),
        status: text(task.status),
        subject: text(task.subject),
        campus: text(task.campus),
        studentName: text(task.student_name),
        className: text(task.class_name),
        completedAt: text(task.completed_at),
        createdAt: text(task.created_at),
        updatedAt: text(task.updated_at),
        registration: registration ? {
          pipelineStatus: text(registration.pipeline_status),
          classStartDate: text(registration.class_start_date),
          inquiryAt: text(registration.inquiry_at),
          levelTestAt: text(registration.level_test_at),
          consultationAt: text(registration.consultation_at),
          schoolGrade: text(registration.school_grade),
          schoolName: text(registration.school_name),
        } : undefined,
        withdrawal: withdrawal ? {
          withdrawalDate: text(withdrawal.withdrawal_date),
          withdrawalSession: text(withdrawal.withdrawal_session),
          teacherName: text(withdrawal.teacher_name),
          schoolGrade: text(withdrawal.school_grade),
        } : undefined,
      }
    })
    .filter(Boolean)
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
          opsTasks,
          opsRegistrationDetails,
          opsWithdrawalDetails,
        ] = await Promise.all([
          readTable("class_terms", { optional: true }),
          readTable("class_schedule_sync_groups", { optional: true }),
          readTable("class_schedule_sync_group_members", { optional: true }),
          readTable("academic_schools", { optional: true }),
          readTable("academic_exam_days", { optional: true }),
          readTable("academic_event_exam_details", { optional: true }),
          readTable("academic_events", { optional: true }),
          readTable("ops_tasks", { optional: true }),
          readTable("ops_registration_details", { optional: true }),
          readTable("ops_withdrawal_details", { optional: true }),
        ])
        const dashboardOpsTasks = buildDashboardOpsTasks(opsTasks, opsRegistrationDetails, opsWithdrawalDetails)

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
              opsTasks: dashboardOpsTasks,
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
