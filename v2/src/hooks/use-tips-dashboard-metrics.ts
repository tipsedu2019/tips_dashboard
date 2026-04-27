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

const DASHBOARD_TABLE_TIMEOUT_MS = 8000

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

function withTableTimeout<T>(request: PromiseLike<T>, tableName: string, optional: boolean): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      if (optional) {
        resolve([] as T)
        return
      }

      reject(new Error(`${tableName} 데이터를 불러오지 못했습니다.`))
    }, DASHBOARD_TABLE_TIMEOUT_MS)
  })

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

async function readTable(tableName: string, optional = false): Promise<unknown[]> {
  if (!supabase) {
    return []
  }

  const result = await withTableTimeout(supabase.from(tableName).select("*"), tableName, optional)
  if (result.error) {
    if (optional && isMissingRelationError(result.error)) {
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
        const [
          classes,
          students,
          textbooks,
          progressLogs,
          classTerms,
          classGroups,
          classGroupMembers,
          academicSchools,
          academicExamDays,
          academicEventExamDetails,
          academicEvents,
        ] = await Promise.all([
          readTable("classes"),
          readTable("students"),
          readTable("textbooks", true),
          readTable("progress_logs", true),
          readTable("class_terms", true),
          readTable("class_schedule_sync_groups", true),
          readTable("class_schedule_sync_group_members", true),
          readTable("academic_schools", true),
          readTable("academic_exam_days", true),
          readTable("academic_event_exam_details", true),
          readTable("academic_events", true),
        ])

        if (isMounted) {
          setMetrics({
            ...buildMetrics({
              classes,
              students,
              textbooks,
              progressLogs,
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
