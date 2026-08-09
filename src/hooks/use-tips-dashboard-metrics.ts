"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  buildDashboardMetrics,
  createEmptyDashboardMetrics,
} from "@/features/dashboard/metrics"
import {
  attachDashboardClassSessionDates,
  buildDashboardSessionDateWindow,
} from "@/features/dashboard/session-dates"
import {
  DASHBOARD_SNAPSHOT_VERSION,
  dashboardSnapshotCache,
} from "@/features/dashboard/snapshot-cache.js"
import {
  getDashboardSourceError,
  normalizeDashboardConflictSources,
  normalizeDashboardSummarySources,
  type DashboardConflictSourcesSnapshot,
  type DashboardSummarySources,
} from "@/features/dashboard/snapshot-sources.js"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/providers/auth-provider"

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
  retryCoreSources: () => void
  retryConflictSources: () => void
  retryExamSources: () => void
}

type DashboardCoreData = DashboardSummarySources & {
  scope: string
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

const DASHBOARD_SNAPSHOT_TIMEOUT_MS = 8_000

async function readDashboardSummarySources(): Promise<DashboardSummarySources> {
  const { data, error } = await supabase!
    .rpc("get_dashboard_summary_sources_v1")
    .abortSignal(AbortSignal.timeout(DASHBOARD_SNAPSHOT_TIMEOUT_MS))
    .retry(false)

  if (error) throw error
  return normalizeDashboardSummarySources(data)
}

async function readDashboardConflictSources(): Promise<DashboardConflictSourcesSnapshot> {
  const { dateFrom, dateTo } = buildDashboardSessionDateWindow(new Date())
  const { data, error } = await supabase!
    .rpc("get_dashboard_conflict_sources_v1", {
      p_date_from: dateFrom,
      p_date_to: dateTo,
    })
    .abortSignal(AbortSignal.timeout(DASHBOARD_SNAPSHOT_TIMEOUT_MS))
    .retry(false)

  if (error) throw error
  return normalizeDashboardConflictSources(data)
}

function disconnectedMetrics(message: string): DashboardMetricsState {
  return {
    ...EMPTY_METRICS,
    isLoading: false,
    error: message,
    conflictSources: {
      schedule: { status: "error", error: message },
      exam: { status: "error", error: message },
    },
  }
}

export function useTipsDashboardMetrics() {
  const { user, role } = useAuth()
  const userId = user?.id || ""
  const cacheScope = userId && role
    ? `${userId}:${role}:${DASHBOARD_SNAPSHOT_VERSION}`
    : ""
  const previousCacheScopeRef = useRef("")
  const [metrics, setMetrics] = useState<DashboardMetricsState>(EMPTY_METRICS)
  const [coreData, setCoreData] = useState<DashboardCoreData | null>(null)
  const [summarySourceRevision, setSummarySourceRevision] = useState(0)
  const [conflictSourceRevision, setConflictSourceRevision] = useState(0)

  useEffect(() => {
    const previousScope = previousCacheScopeRef.current
    if (previousScope && previousScope !== cacheScope) {
      dashboardSnapshotCache.invalidate(previousScope)
    }
    previousCacheScopeRef.current = cacheScope
  }, [cacheScope])

  const retryCoreSources = useCallback(() => {
    if (!cacheScope) return
    dashboardSnapshotCache.invalidate(cacheScope)
    setCoreData(null)
    setMetrics(EMPTY_METRICS)
    setSummarySourceRevision((current) => current + 1)
  }, [cacheScope])

  const retryConflictSources = useCallback(() => {
    if (!cacheScope || coreData?.scope !== cacheScope) return
    dashboardSnapshotCache.invalidate(cacheScope, "conflict")
    setMetrics((current) => ({
      ...current,
      conflictSources: {
        schedule: { status: "loading", error: "" },
        exam: { status: "loading", error: "" },
      },
    }))
    setConflictSourceRevision((current) => current + 1)
  }, [cacheScope, coreData?.scope])

  useEffect(() => {
    let isCurrent = true

    async function loadSummary() {
      await Promise.resolve()
      if (!isCurrent) return

      setCoreData(null)
      if (!cacheScope) {
        setMetrics(EMPTY_METRICS)
        return
      }
      if (!supabase) {
        setMetrics(disconnectedMetrics("Supabase 연결 설정을 확인해 주세요."))
        return
      }

      setMetrics(EMPTY_METRICS)
      try {
        const summary = await dashboardSnapshotCache.load(
          cacheScope,
          "summary",
          readDashboardSummarySources,
        )
        if (!isCurrent) return
        setMetrics({
          ...buildMetrics({ classes: summary.classes, students: summary.students }),
          isLoading: false,
          isConnected: true,
          error: null,
          conflictSources: {
            schedule: { status: "loading", error: "" },
            exam: { status: "loading", error: "" },
          },
        })
        setCoreData({ ...summary, scope: cacheScope })
      } catch (error) {
        if (!isCurrent) return
        setMetrics(disconnectedMetrics(getDashboardSourceError(error)))
      }
    }

    void loadSummary()

    return () => {
      isCurrent = false
    }
  }, [cacheScope, summarySourceRevision])

  useEffect(() => {
    if (!cacheScope || !coreData || coreData.scope !== cacheScope || !supabase) return
    const sourceData = coreData
    let isCurrent = true

    dashboardSnapshotCache
      .load(cacheScope, "conflict", readDashboardConflictSources)
      .then((conflict) => {
        if (!isCurrent) return
        const classes = attachDashboardClassSessionDates(sourceData.classes, conflict.sessionDates)
        setMetrics({
          ...buildMetrics({
            classes,
            students: sourceData.students,
            classTerms: conflict.classTerms,
            classGroups: conflict.classGroups,
            classGroupMembers: conflict.classGroupMembers,
            teacherCatalogs: conflict.teacherCatalogs,
            classroomCatalogs: conflict.classroomCatalogs,
            academicSchools: conflict.academicSchools,
            academicExamDays: conflict.academicExamDays,
            academicEventExamDetails: conflict.academicEventExamDetails,
            academicEvents: conflict.academicEvents,
          }),
          isLoading: false,
          isConnected: true,
          error: null,
          conflictSources: {
            schedule: { status: "ready", error: "" },
            exam: { status: "ready", error: "" },
          },
        })
      })
      .catch((error: unknown) => {
        if (!isCurrent) return
        const message = getDashboardSourceError(error)
        setMetrics((current) => ({
          ...current,
          conflictSources: {
            schedule: { status: "error", error: message },
            exam: { status: "error", error: message },
          },
        }))
      })

    return () => {
      isCurrent = false
    }
  }, [cacheScope, conflictSourceRevision, coreData])

  return useMemo<DashboardMetrics>(
    () => ({
      ...metrics,
      retryCoreSources,
      retryConflictSources,
      retryExamSources: retryConflictSources,
    }),
    [metrics, retryConflictSources, retryCoreSources],
  )
}
