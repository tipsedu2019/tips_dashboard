"use client"

import { useState } from "react"
import type { OpsTaskPageFilters } from "./ops-task-service"

function isDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function getOpsTaskPeriodDraftError(dateFrom: string | null, dateTo: string | null) {
  if (!dateFrom || !dateTo) return ""
  if (!isDate(dateFrom) || !isDate(dateTo)) return "유효한 날짜를 선택해 주세요."
  return dateFrom > dateTo ? "종료일은 시작일보다 빠를 수 없습니다." : ""
}

// Date controls are drafts until both bounds form a valid range. Keep the
// committed filters (and their identity) so page and stats reads stay together.
export function useOpsTaskPeriodFilters(draft: OpsTaskPageFilters, owner: string): OpsTaskPageFilters {
  const scope = JSON.stringify([owner, draft.taskType, "view" in draft ? draft.view : draft.queue])
  const complete = !("period" in draft) || draft.period !== "custom"
    || (Boolean(draft.dateFrom && draft.dateTo) && !getOpsTaskPeriodDraftError(draft.dateFrom, draft.dateTo))
  const fallback = complete ? draft : { ...draft, period: "all" as const, dateFrom: null, dateTo: null }
  const [committed, setCommitted] = useState(() => ({ scope, filters: fallback, key: JSON.stringify(fallback) }))

  if (committed.scope !== scope) {
    const next = { scope, filters: fallback, key: JSON.stringify(fallback) }
    setCommitted(next)
    return next.filters
  }
  if (!complete) return committed.filters
  const key = JSON.stringify(draft)
  if (key !== committed.key) {
    setCommitted({ scope, filters: draft, key })
    return draft
  }
  return committed.filters
}
