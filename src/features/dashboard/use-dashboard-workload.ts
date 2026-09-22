"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/providers/auth-provider"
import { readWorkloadPage, readWorkloadSummary } from "./workload-service.ts"
import type {
  WorkloadFilter,
  WorkloadPage,
  WorkloadSummary,
} from "./workload-contract.ts"

type Request = { filter: WorkloadFilter; page: number; pageSize: 10 | 15 | 20 }
export function useDashboardWorkload<
  T extends WorkloadSummary | WorkloadPage = WorkloadSummary,
>(request?: Request) {
  const {
    session,
    user,
    role,
    loading: authLoading,
    canAccessDashboard,
  } = useAuth()
  const requestJson = JSON.stringify(request ?? null)
  const userId = user?.id ?? "",
    accessToken = session?.access_token ?? ""
  const ready =
    !authLoading &&
    canAccessDashboard &&
    Boolean(userId && accessToken && session?.user.id === userId)
  const key = ready ? JSON.stringify([userId, role, requestJson]) : ""
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    key: string
    data: T | null
    loading: boolean
    error: string | null
  } | null>(null)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let active = true,
      lastAttempt = 0,
      pending = false
    const parsed = JSON.parse(requestJson) as Request | null
    async function load() {
      if (!key || pending) return
      pending = true
      lastAttempt = Date.now()
      await Promise.resolve()
      if (!active) return
      setResult((previous) => ({
        key,
        data: previous?.key === key ? previous.data : null,
        loading: true,
        error: null,
      }))
      try {
        if (!supabase) throw new Error("dashboard_client_unavailable")
        const data = (
          parsed
            ? await readWorkloadPage(
                supabase,
                parsed.filter,
                parsed.page,
                parsed.pageSize,
              )
            : await readWorkloadSummary(supabase)
        ) as T
        if (active) setResult({ key, data, loading: false, error: null })
      } catch {
        if (active)
          setResult((previous) => ({
            key,
            data: previous?.key === key ? previous.data : null,
            loading: false,
            error: "업무 현황을 불러오지 못했습니다.",
          }))
      } finally {
        pending = false
      }
    }
    const refreshVisible = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine !== false &&
        Date.now() - lastAttempt >= 30_000
      )
        void load()
    }
    void load()
    const timer = window.setInterval(refreshVisible, 60_000)
    window.addEventListener("focus", refreshVisible)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshVisible)
      document.removeEventListener("visibilitychange", refreshVisible)
    }
  }, [accessToken, key, requestJson, revision])

  const current = key && result?.key === key ? result : null
  return {
    data: current?.data ?? null,
    loading: authLoading || Boolean(key && (current?.loading ?? true)),
    error:
      current?.error ??
      (!authLoading && !ready
        ? "업무 현황을 보려면 다시 로그인해 주세요."
        : null),
    refresh,
  }
}
