"use client"

import { useCallback, useEffect, useState } from "react"

import type { DashboardDailyBrief } from "./daily-brief-contract.ts"
import { dashboardLocalDate, nextDashboardMidnight } from "./daily-brief-date.ts"
import { readDashboardDailyBrief } from "./daily-brief-service.ts"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/providers/auth-provider"

type DashboardDailyBriefState = Readonly<{
  brief: DashboardDailyBrief | null
  localDate: string
  loading: boolean
  error: string | null
  retry: () => void
}>

type KeyedBriefState = Readonly<{
  key: string
  brief: DashboardDailyBrief | null
  loading: boolean
  error: string | null
}>

export function useDashboardDailyBrief(): DashboardDailyBriefState {
  const { session, user, role, loading: authLoading, canAccessDashboard } = useAuth()
  const [result, setResult] = useState<KeyedBriefState | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)
  const [, setDateRevision] = useState(0)
  const localDate = dashboardLocalDate()
  const userId = user?.id ?? ""
  const accessToken = session?.access_token ?? ""
  const ready = !authLoading && canAccessDashboard && Boolean(userId && accessToken && session?.user.id === userId)
  const key = ready ? JSON.stringify([userId, role, localDate]) : ""

  const retry = useCallback(() => {
    setRequestRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    // A single calendar-boundary wakeup, not a polling or retry loop.
    const checkDate = () => {
      if (dashboardLocalDate() !== localDate) setDateRevision((current) => current + 1)
    }
    const timeout = window.setTimeout(checkDate, Math.max(1, nextDashboardMidnight(localDate) - Date.now()))
    window.addEventListener("focus", checkDate)
    document.addEventListener("visibilitychange", checkDate)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener("focus", checkDate)
      document.removeEventListener("visibilitychange", checkDate)
    }
  }, [localDate])

  useEffect(() => {
    let active = true

    async function load() {
      await Promise.resolve()
      if (!active) return
      if (!key) {
        setResult(null)
        return
      }
      setResult((previous) => ({ key, brief: previous?.key === key ? previous.brief : null, loading: true, error: null }))
      try {
        if (!supabase) throw new Error("dashboard_client_unavailable")
        const nextBrief = await readDashboardDailyBrief(supabase)
        if (!active) return
        if (dashboardLocalDate() !== localDate || nextBrief.localDate !== localDate) {
          throw new Error("dashboard_date_changed")
        }
        setResult({ key, brief: nextBrief, loading: false, error: null })
      } catch {
        if (!active) return
        setResult((previous) => ({
          key,
          brief: previous?.key === key ? previous.brief : null,
          loading: false,
          error: "일정을 불러오지 못했습니다.",
        }))
      }
    }

    void load()
    return () => { active = false }
  }, [accessToken, key, localDate, requestRevision])

  // Hide protected data in the very render that changes identity or date.
  const current = key && result?.key === key ? result : null
  return {
    brief: current?.brief ?? null,
    localDate,
    loading: authLoading || Boolean(key && (current?.loading ?? true)),
    error: current?.error ?? (!authLoading && !key ? "일정을 불러오려면 다시 로그인해 주세요." : null),
    retry,
  }
}
