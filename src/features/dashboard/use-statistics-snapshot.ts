"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  buildDashboardStatisticsRequest,
  normalizeDashboardStatisticsRange,
  type DashboardStatisticsRangeTab,
  type DashboardStatisticsSnapshot,
  type DashboardStatisticsTab,
} from "./statistics-contract.ts"
import {
  buildDashboardStatisticsCacheKey,
  createDashboardStatisticsForceIntent,
  dashboardStatisticsSnapshotForKey,
  dashboardStatisticsMemoryCache,
  fetchDashboardStatisticsSnapshot,
  isDashboardStatisticsForcePending,
  loadActiveDashboardStatisticsSnapshot,
  requestDashboardStatisticsForce,
  settleDashboardStatisticsForce,
  type DashboardStatisticsKeyedSnapshot,
} from "./statistics-cache.ts"
import { useAuth } from "@/providers/auth-provider"

type StatisticsSnapshotInput = Readonly<{
  active?: boolean
  tab: DashboardStatisticsTab
  subject?: string
  division?: string
  rangeQuery?: string | null
}>

type StatisticsSnapshotState = Readonly<{
  snapshot: DashboardStatisticsSnapshot | null
  data: unknown
  loading: boolean
  error: string | null
  generatedAt: string | null
  expiresAt: string | null
  cacheStatus: DashboardStatisticsSnapshot["cacheStatus"] | null
  range: number
  setRange: (range: number) => void
  refresh: () => void
}>

function rangeTab(tab: DashboardStatisticsTab): DashboardStatisticsRangeTab | null {
  return tab === "schedule_conflicts" || tab === "textbooks" ? tab : null
}

export function useStatisticsSnapshot(input: StatisticsSnapshotInput): StatisticsSnapshotState {
  const { session, user, role } = useAuth()
  const selectedRangeTab = rangeTab(input.tab)
  const rangeInputKey = `${selectedRangeTab ?? "none"}:${input.rangeQuery ?? ""}`
  const [rangeOverride, setRangeOverride] = useState<{
    key: string
    value: number
  } | null>(null)
  const range = selectedRangeTab
    ? rangeOverride?.key === rangeInputKey
      ? rangeOverride.value
      : normalizeDashboardStatisticsRange(selectedRangeTab, input.rangeQuery)
    : 90
  const [snapshotResult, setSnapshotResult] = useState<DashboardStatisticsKeyedSnapshot | null>(null)
  const [loading, setLoading] = useState(Boolean(input.active ?? true))
  const [error, setError] = useState<string | null>(null)
  const [forceRevision, setForceRevision] = useState(0)
  const forceIntentRef = useRef(createDashboardStatisticsForceIntent())

  const request = useMemo(() => buildDashboardStatisticsRequest({
    tab: input.tab,
    subject: input.subject,
    division: input.division,
    range,
  }), [input.division, input.subject, input.tab, range])

  const userId = user?.id ?? ""
  const accessToken = session?.access_token ?? ""
  const cacheKey = useMemo(() => buildDashboardStatisticsCacheKey({
    userId,
    role,
    ...request,
  }), [request, role, userId])

  const setRange = useCallback((nextRange: number) => {
    if (!selectedRangeTab) return
    setRangeOverride({
      key: rangeInputKey,
      value: normalizeDashboardStatisticsRange(selectedRangeTab, nextRange),
    })
  }, [rangeInputKey, selectedRangeTab, setRangeOverride])

  const refresh = useCallback(() => {
    if (!cacheKey) return
    dashboardStatisticsMemoryCache.invalidate(cacheKey)
    const requested = requestDashboardStatisticsForce(forceIntentRef.current)
    forceIntentRef.current = requested
    setForceRevision(requested.requestedRevision)
  }, [cacheKey])

  const snapshot = dashboardStatisticsSnapshotForKey(snapshotResult, cacheKey)

  useEffect(() => {
    const active = input.active ?? true
    const controller = new AbortController()
    const requestForceRevision = forceIntentRef.current.requestedRevision
    const force = isDashboardStatisticsForcePending(forceIntentRef.current)

    async function load() {
      await Promise.resolve()
      if (controller.signal.aborted) return
      if (!active) {
        setLoading(false)
        return
      }
      if (!userId || !role || !accessToken) {
        setSnapshotResult(null)
        setLoading(false)
        setError("통계를 불러오려면 다시 로그인해 주세요.")
        return
      }

      setLoading(true)
      setError(null)
      try {
        const nextSnapshot = await loadActiveDashboardStatisticsSnapshot({
          active,
          cache: dashboardStatisticsMemoryCache,
          key: cacheKey,
          force,
          loader: () => fetchDashboardStatisticsSnapshot({
            accessToken,
            request,
            signal: controller.signal,
            refresh: force,
          }),
        })
        if (controller.signal.aborted || !nextSnapshot) return
        setSnapshotResult({ key: cacheKey, snapshot: nextSnapshot })
        forceIntentRef.current = settleDashboardStatisticsForce(forceIntentRef.current, {
          revision: requestForceRevision,
          completed: force,
        })
        setLoading(false)
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return
        setSnapshotResult(null)
        setLoading(false)
        setError(
          loadError instanceof Error && loadError.message === "statistics_cache_busy"
            ? "통계를 계산하고 있습니다. 잠시 후 다시 시도해 주세요."
            : "통계를 불러오지 못했습니다.",
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [accessToken, cacheKey, forceRevision, input.active, request, role, userId])

  return {
    snapshot,
    data: snapshot?.data ?? null,
    loading,
    error,
    generatedAt: snapshot?.generatedAt ?? null,
    expiresAt: snapshot?.expiresAt ?? null,
    cacheStatus: snapshot?.cacheStatus ?? null,
    range,
    setRange,
    refresh,
  }
}
