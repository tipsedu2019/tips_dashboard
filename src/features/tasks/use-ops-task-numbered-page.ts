"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size"
import { createNumberedPageController, type NumberedPageSnapshot } from "@/lib/numbered-page-controller"
import { getNumberedPagination, normalizePage, type DataTablePageSize } from "@/lib/numbered-pagination"
import { supabase } from "@/lib/supabase"
import { createOpsTaskNumberedReadService } from "./ops-task-numbered-service"
import type { OpsTask, OpsTaskPageFilters } from "./ops-task-service"

const EMPTY: NumberedPageSnapshot<OpsTask> = {
  rows: [], page: 1, requestedPage: 1, pageSize: 10, totalCount: null, scope: null, loading: false, error: null,
}

// Only callers holding an explicit complete development fixture may use this adapter.
export function getCompleteOpsTaskFixturePage<T>(rows: T[], requestedPage: number, pageSize: DataTablePageSize) {
  const { page } = getNumberedPagination({ page: requestedPage, pageSize, totalCount: rows.length })
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalCount: rows.length }
}

export function useOpsTaskNumberedPage({ viewerId, viewerRole, filters, enabled, restoredPage = 1, restorationKey, onPageCommit }: {
  viewerId: string
  viewerRole: string
  filters: OpsTaskPageFilters
  enabled: boolean
  restoredPage?: number
  restorationKey?: string
  onPageCommit?: (page: { scope: string; page: number; pageSize: DataTablePageSize }) => void
}) {
  const preference = useDataTablePageSize(`ops-task:${filters.taskType}`)
  const actor = viewerId && viewerRole ? JSON.stringify([viewerId, viewerRole]) : ""
  const route = typeof window === "undefined" ? "" : window.location.pathname
  const scope = JSON.stringify({ actor, route, filters, pageSize: preference.pageSize })
  const [display, setDisplay] = useState<{ actor: string; snapshot: NumberedPageSnapshot<OpsTask> }>({ actor: "", snapshot: EMPTY })
  const controllerRef = useRef<ReturnType<typeof createNumberedPageController<OpsTask>> | null>(null)
  const activeScope = useRef("")
  const scopeRef = useRef(scope)
  const actorRef = useRef(actor)
  const enabledRef = useRef(enabled)
  const consumedRestoration = useRef<string | undefined>(undefined)
  const resumeRequired = useRef(false)
  const onPageCommitRef = useRef(onPageCommit)
  useLayoutEffect(() => {
    scopeRef.current = scope
    actorRef.current = actor
    enabledRef.current = enabled
    onPageCommitRef.current = onPageCommit
  }, [actor, enabled, onPageCommit, scope])

  useEffect(() => {
    activeScope.current = ""
    consumedRestoration.current = undefined
    resumeRequired.current = false
    if (!actor) return
    const controller = createNumberedPageController<OpsTask>({
      loadPage: async ({ scope: requestScope, page, pageSize, signal }) => {
        if (!supabase) throw new Error("데이터 연결을 확인할 수 없습니다.")
        const request = JSON.parse(requestScope) as { actor: string; filters: OpsTaskPageFilters }
        const [requestViewerId] = JSON.parse(request.actor) as [string, string]
        const result = await createOpsTaskNumberedReadService({ supabase }).readPage({ viewerId: requestViewerId, filters: request.filters, page, pageSize, signal })
        if (!enabledRef.current || actorRef.current !== actor || scopeRef.current !== requestScope) throw new Error("Obsolete task page")
        return result
      },
      onChange(snapshot) {
        if (actorRef.current !== actor) return
        if (!enabledRef.current) {
          // The controller settled while its UI subscription was paused. Its
          // retry target still owns the interrupted page.
          resumeRequired.current = true
          return
        }
        resumeRequired.current = false
        setDisplay({ actor, snapshot })
        if (!snapshot.loading && !snapshot.error && snapshot.scope === scopeRef.current) {
          onPageCommitRef.current?.({ scope: snapshot.scope, page: snapshot.page, pageSize: snapshot.pageSize })
        }
      },
    })
    controllerRef.current = controller
    return () => { controller.dispose(); controllerRef.current = null }
  }, [actor])

  useEffect(() => {
    if (!enabled || !actor || !preference.ready || !controllerRef.current) return
    const restoring = restorationKey !== undefined && restorationKey !== consumedRestoration.current
    if (!restoring && activeScope.current === scope) {
      if (resumeRequired.current) {
        resumeRequired.current = false
        void controllerRef.current.retry()
      }
      return
    }
    const page = restoring && restoredPage <= 2147483647 ? normalizePage(restoredPage) : 1
    consumedRestoration.current = restorationKey
    activeScope.current = scope
    resumeRequired.current = false
    void controllerRef.current.load({ scope, page, pageSize: preference.pageSize })
  }, [actor, enabled, preference.pageSize, preference.ready, restorationKey, restoredPage, scope])

  const goToPage = useCallback((page: number) => {
    if (!enabled || !actor || !preference.ready) return Promise.resolve()
    return controllerRef.current?.load({ scope, page, pageSize: preference.pageSize }) ?? Promise.resolve()
  }, [actor, enabled, preference.pageSize, preference.ready, scope])
  const snapshot = actor && display.actor === actor ? display.snapshot : EMPTY
  const retry = useCallback(() => controllerRef.current?.retry() ?? Promise.resolve(), [])
  const refresh = useCallback(() => {
    if (!enabled || !actor || !preference.ready) return Promise.resolve()
    // A retained page belongs to its accepted scope, not the pending filters.
    // Retry preserves this scope's reset/restoration target, including failures.
    if (snapshot.scope !== scope && activeScope.current === scope) return retry()
    return goToPage(snapshot.scope === scope ? snapshot.page : 1)
  }, [actor, enabled, goToPage, preference.ready, retry, scope, snapshot.page, snapshot.scope])
  const setPageSizePreference = preference.setPreference
  return { ...snapshot, loading: Boolean(actor) && (!preference.ready || snapshot.loading || (snapshot.scope === null && !snapshot.error)),
    goToPage, retry, refresh, pageSizeMode: preference.mode, setPageSizePreference }
}
