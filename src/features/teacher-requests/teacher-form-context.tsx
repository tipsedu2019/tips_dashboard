"use client"

import { useEffect, useMemo, useState } from "react"
import { computeClassStatus, normalizeClassStatus } from "@/lib/class-status.js"
import { requestClassOptions } from "@/lib/request-class-options"
import { useAuth } from "@/providers/auth-provider"
import { supabase } from "@/lib/supabase"
import { createOperationsReadService } from "@/features/operations/operations-read-service"
import { normalizedLessonDisplayOrdinals } from "@/features/operations/normalized-lesson-display"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { DataTableSearchField } from "@/components/data-table/data-table-search-field"
import { useCommittedSearch } from "@/hooks/use-committed-search"
import { Button } from "@/components/ui/button"
import type { OpsClassOption } from "@/features/tasks/ops-task-service"

type Row = Record<string, unknown>
const text = (value: unknown) => typeof value === "string" ? value : ""
export function teacherFormMonthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid_month")
  const end = new Date(`${month}-01T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0)
  return { dateFrom: `${month}-01`, dateTo: end.toISOString().slice(0, 10) }
}

// This adapter is display-only. Session UUIDs remain separate from derived labels.
export function teacherFormClass(row: Row, schedule?: Row, month?: string, calculationSnapshot = false): OpsClassOption {
  const legacy = row.schedulePlan && typeof row.schedulePlan === "object" ? row.schedulePlan as Row : {}
  let schedulePlan = legacy
  if (row.scheduleStorageMode === "normalized" && !calculationSnapshot) {
    if (!schedule || !Array.isArray(schedule.sessions) || !month) throw new Error("schedule_missing")
    const sessions = (schedule.sessions as Row[]).map(session => ({
      id: text(session.id), sessionKey: text(session.session_key) || text(session.id),
      date: text(session.session_date), scheduleState: text(session.schedule_state),
      startTime: text(session.start_time).slice(0, 5), endTime: text(session.end_time).slice(0, 5),
      billingId: text(session.legacy_billing_id), billingLabel: text(session.legacy_billing_label), billingColor: text(session.legacy_billing_color),
    }))
    const ordinals = normalizedLessonDisplayOrdinals(sessions, teacherFormMonthRange(month))
    schedulePlan = { ...legacy, sessions: sessions.map(session => ({ ...session, sessionNumber: ordinals.get(session.id) ?? undefined })) }
  }
  return { id: text(row.id), startDate: text(row.startDate), endDate: text(row.endDate), status: text(row.status), label: text(row.name), subject: text(row.subject), grade: text(row.grade),
    teacher: text(row.teacher) || text(row.teacherName), room: text(row.room), schedule: text(row.schedule),
    scheduleStorageMode: text(row.scheduleStorageMode), schedulePlan, studentIds: [], waitlistIds: [], textbookIds: [] }
}

export function useTeacherFormClass({ id, month, subject, teacher, onPermissionDenied, enabled = true }: {
  id: string; month: string; subject: string; teacher: string; onPermissionDenied: () => void; enabled?: boolean
}) {
  const { user, role } = useAuth()
  const actor = `${user?.id || ""}:${role}`
  const service = useMemo(() => createOperationsReadService({ supabase, actorScope: actor }), [actor])
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0)
  const searchInput = useCommittedSearch("")
  const search = searchInput.committed
  const [pageState, setPageState] = useState<{ key: string; data?: Awaited<ReturnType<typeof service.readClassScheduleNumberedPage>>; error?: boolean }>()
  const [detailState, setDetailState] = useState<{ key: string; scope: string; data?: OpsClassOption; calculationClass?: OpsClassOption; error?: boolean }>()
  const pageKey = JSON.stringify([actor, subject, teacher, search, page, retry])
  const detailScope = JSON.stringify([actor, id])
  const detailKey = JSON.stringify([actor, id, month, retry])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void service.readClassScheduleNumberedPage({ filters: { termId: null, search, subject: subject || null, teacher: teacher || null, grade: null, syncGroupId: null }, page, pageSize: 15, signal: controller.signal })
      .then(async data => {
        // The numbered DTO carries raw status but no dates. Resolve only unknown
        // statuses through the existing authorized detail reader (at most 15).
        const rows = await Promise.all(data.rows.map(async row => {
          if (normalizeClassStatus(row.status)) return row
          controller.signal.throwIfAborted()
          const detail = await service.loadClassLessonDesignDetail(row.id)
          controller.signal.throwIfAborted()
          return { ...row, status: computeClassStatus(detail.classItem) }
        }))
        if (!controller.signal.aborted) setPageState({ key: pageKey, data: { ...data, rows } })
      })
      .catch(error => { if (!controller.signal.aborted) { if (error?.code === "42501") onPermissionDenied(); else setPageState({ key: pageKey, error: true }) } })
    return () => controller.abort()
  }, [service, enabled, pageKey, subject, teacher, search, page, onPermissionDenied])
  useEffect(() => {
    if (!id || !enabled) return
    let current = true
    void service.loadClassLessonDesignDetail(id).then(async detail => {
      const row = detail.classItem as Row
      const schedule = row.scheduleStorageMode === "normalized"
        ? await service.loadClassScheduleDetail({ classId: id, ...teacherFormMonthRange(month) }) : undefined
      const data = teacherFormClass(row, schedule, month)
      // Management calculates from the complete saved projection. The monthly
      // calendar's display ordinals and sessions are not a billing-cycle snapshot.
      const calculationClass = (row.schedulePlan as Row | null)?.withdrawalHoursUnavailable === true
        ? undefined : teacherFormClass(row, undefined, undefined, true)
      if (current) setDetailState({ key: detailKey, scope: detailScope, data, calculationClass })
    }).catch(error => { if (current) { if (error?.code === "42501") onPermissionDenied(); else setDetailState({ key: detailKey, scope: detailScope, error: true }) } })
    return () => { current = false }
  }, [service, enabled, detailKey, detailScope, id, month, onPermissionDenied])
  const result = pageState?.key === pageKey ? pageState : undefined
  const detail = detailState?.key === detailKey ? detailState : undefined
  const selected = detail?.data || (detailState?.scope === detailScope && detailState.data ? { ...detailState.data, schedulePlan: { ...detailState.data.schedulePlan, sessions: [] } } : undefined)
  // A current page is never presented as the entire catalog.
  const options = requestClassOptions((result?.data?.rows || []).map(row => teacherFormClass(row)), id)
  if (selected && !options.some(row => row.id === selected.id)) options.unshift(selected)
  return { options, selected, calculationClass: detail?.calculationClass, subjects: result?.data?.filterOptions.subjects || [], teachers: result?.data?.filterOptions.teachers || [],
    page, search: searchInput.value, searchInput, totalCount: result?.data?.totalCount ?? null, loading: enabled && !result, detailLoading: Boolean(id && !detail), error: Boolean(result?.error || detail?.error),
    setPage, setSearch: (value: string) => { searchInput.onChange(value); setPage(1) }, retry: () => setRetry(value => value + 1) }
}

export function TeacherFormClassPager({ context, label }: { context: ReturnType<typeof useTeacherFormClass>; label: string }) {
  return <div className="grid gap-2"><DataTableSearchField value={context.search} onValueChange={context.setSearch} onCompositionStart={context.searchInput.onCompositionStart} onCompositionEnd={context.searchInput.onCompositionEnd} onSubmit={context.searchInput.onSubmit} placeholder={`${label} 검색`} label={`${label} 전체 검색`} />
    <DataTablePagination page={context.page} pageSize={15} totalCount={context.totalCount} loading={context.loading} onPageChange={context.setPage} ariaLabel={`${label} 페이지`} />
    {context.error && <div role="alert" className="text-sm text-destructive">수업·일정을 불러오지 못했습니다. 입력은 유지됩니다. <Button type="button" variant="outline" onClick={context.retry}>다시 조회</Button></div>}
  </div>
}
