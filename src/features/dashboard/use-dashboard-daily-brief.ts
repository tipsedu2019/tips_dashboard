"use client"

import { useCallback, useEffect, useState } from "react"

import type { DashboardDailyBrief } from "./daily-brief-contract.ts"
import { readDashboardDailyBrief } from "./daily-brief-service.ts"
import { supabase } from "@/lib/supabase"

type DashboardDailyBriefState = Readonly<{
  brief: DashboardDailyBrief | null
  loading: boolean
  error: string | null
  retry: () => void
}>

export function useDashboardDailyBrief(): DashboardDailyBriefState {
  const [brief, setBrief] = useState<DashboardDailyBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)

  const retry = useCallback(() => {
    setRequestRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      if (!supabase) {
        if (!active) return
        setBrief(null)
        setError("브리프를 불러오지 못했습니다.")
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const nextBrief = await readDashboardDailyBrief(supabase)
        if (!active) return
        setBrief(nextBrief)
      } catch {
        if (!active) return
        setBrief(null)
        setError("브리프를 불러오지 못했습니다.")
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [requestRevision])

  return { brief, loading, error, retry }
}
