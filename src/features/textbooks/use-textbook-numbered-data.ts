"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size"
import { createNumberedPageController, type NumberedPageSnapshot } from "@/lib/numbered-page-controller"
import { normalizePage, type DataTablePageSize, type DataTablePageSizePreference, type NumberedPage } from "@/lib/numbered-pagination"
import {
  getTextbookInventorySummary, getTextbookMasterSummary, getTextbookOperationsSummary,
  getTextbookPurchaseSummary, getTextbookSaleHistorySummary, getTextbookSaleSummary,
  listTextbookClosingMovementPage, listTextbookClosingPage, listTextbookInventoryHistoryPage,
  listTextbookInventoryPage, listTextbookMasterPage, listTextbookPurchasePage,
  listTextbookSaleHistoryPage, listTextbookSalePage,
} from "./textbook-read-service"
import type {
  ClosingFilters, ClosingMovementFilters, ClosingMovementRow, ClosingRow, InventoryCountRow,
  InventoryFilters, InventoryHistoryFilters, MasterFilters, PurchaseFilters, SaleFilters,
  SaleHistoryFilters, SaleHistorySummaryRow, SaleLineRow, TextbookInventoryHistoryTransport,
  TextbookMasterRow, TextbookPurchaseCaseRow,
} from "./textbook-read-types"

type Actor = { key: string }
type PageCommit = { scope: string; page: number; pageSize: DataTablePageSize }
export type TextbookNumberedEntry<F> = {
  enabled: boolean
  filters: F
  restoredPage?: number
  restoredPageSize?: DataTablePageSize
  restorationKey?: string
  onPageCommit?: (page: PageCommit) => void
}
export type TextbookNumberedDataInput = {
  viewerId: string
  viewerRole: string
  authReady: boolean
  operationsEnabled: boolean
  master: TextbookNumberedEntry<MasterFilters>
  requests: TextbookNumberedEntry<Omit<PurchaseFilters, "mode">>
  purchase: TextbookNumberedEntry<Omit<PurchaseFilters, "mode">>
  sales: TextbookNumberedEntry<SaleFilters>
  saleHistory: TextbookNumberedEntry<SaleHistoryFilters>
  inventory: TextbookNumberedEntry<InventoryFilters>
  inventoryHistory: TextbookNumberedEntry<InventoryHistoryFilters>
  closing: TextbookNumberedEntry<ClosingFilters>
  closingMovements: TextbookNumberedEntry<ClosingMovementFilters>
}
export type TextbookSummaryResource<T> = {
  // For page summaries, value is exposed only for the accepted page's filters.
  // scope identifies actor/route/table/filters, not page number or page size;
  // it must not be compared directly with a NumberedPageSnapshot.scope.
  value: T | null
  scope: string | null
  loading: boolean
  error: unknown
  retry: () => Promise<void>
}
type PageReader<F, T> = (filters: F, page: number, pageSize: DataTablePageSize, signal: AbortSignal) => Promise<NumberedPage<T>>
type SummaryReader<F, T> = (filters: F, options: { signal: AbortSignal }) => Promise<T>
const emptyPage = <T,>(): NumberedPageSnapshot<T> => ({ rows: [], page: 1, requestedPage: 1, pageSize: 10, totalCount: null, scope: null, loading: false, error: null })
const emptySummary = <T,>() => ({ value: null as T | null, scope: null as string | null, loading: false, error: null as unknown })

// Readers are literal, typed domain boundaries. Actor identity never enters RPC arguments.
const readMaster: PageReader<MasterFilters, TextbookMasterRow> = (filters, page, pageSize, signal) => listTextbookMasterPage({ filters, page, pageSize, sort: "quality-title" }, { signal })
const readPurchase: PageReader<PurchaseFilters, TextbookPurchaseCaseRow> = (filters, page, pageSize, signal) => listTextbookPurchasePage({ filters, page, pageSize, sort: "status-event" }, { signal })
const readSale: PageReader<SaleFilters, SaleLineRow> = (filters, page, pageSize, signal) => listTextbookSalePage({ filters, page, pageSize, sort: "status-event" }, { signal })
const readSaleHistory: PageReader<SaleHistoryFilters, SaleHistorySummaryRow> = (filters, page, pageSize, signal) => listTextbookSaleHistoryPage({ filters, page, pageSize, sort: "month-class-title" }, { signal })
const readInventory: PageReader<InventoryFilters, InventoryCountRow> = (filters, page, pageSize, signal) => listTextbookInventoryPage({ filters, page, pageSize, sort: "audit-priority" }, { signal })
const readInventoryHistory: PageReader<InventoryHistoryFilters, TextbookInventoryHistoryTransport> = (filters, page, pageSize, signal) => listTextbookInventoryHistoryPage({ filters, page, pageSize, sort: "event-desc" }, { signal })
const readClosing: PageReader<ClosingFilters, ClosingRow> = (filters, page, pageSize, signal) => listTextbookClosingPage({ filters, page, pageSize, sort: "month-desc" }, { signal })
const readClosingMovements: PageReader<ClosingMovementFilters, ClosingMovementRow> = (filters, page, pageSize, signal) => listTextbookClosingMovementPage({ filters, page, pageSize, sort: "event-desc" }, { signal })
const readOperations = (_filters: null, options: { signal: AbortSignal }) => getTextbookOperationsSummary(options)

function useNumberedPage<F, T>(actor: Actor | null, tableId: string, entry: TextbookNumberedEntry<F>, read: PageReader<F, T>) {
  const preference = useDataTablePageSize(tableId)
  const setPreference = preference.setPreference
  const { enabled, restoredPage = 1, restoredPageSize, restorationKey, onPageCommit } = entry
  const route = typeof window === "undefined" ? "" : window.location.pathname
  const [restoredSize, setRestoredSize] = useState<{ key: string | undefined; value: DataTablePageSize | undefined; explicit: boolean }>(() => ({
    key: restorationKey,
    value: restoredPageSize,
    explicit: false,
  }))
  if (restoredSize.key !== restorationKey) {
    setRestoredSize({ key: restorationKey, value: restoredPageSize, explicit: false })
  }
  const effectivePageSize = restoredSize.key === restorationKey && !restoredSize.explicit
    ? restoredSize.value ?? preference.pageSize
    : preference.pageSize
  const resourceScope = JSON.stringify({ actor: actor?.key, route, tableId, filters: entry.filters })
  const scope = JSON.stringify({ actor: actor?.key, route, tableId, filters: entry.filters, pageSize: effectivePageSize })
  const [display, setDisplay] = useState<{ actor: Actor | null; snapshot: NumberedPageSnapshot<T> }>({ actor: null, snapshot: emptyPage() })
  const controllerRef = useRef<ReturnType<typeof createNumberedPageController<T>> | null>(null)
  const current = useRef({ actor, enabled, scope, ready: preference.ready, onPageCommit })
  const requestAbort = useRef<AbortController | null>(null)
  const activeScope = useRef("")
  const consumedRestoration = useRef<string | undefined>(undefined)
  const latest = useRef<NumberedPageSnapshot<T>>(emptyPage())
  const resumeRequired = useRef(false)
  useLayoutEffect(() => {
    if (!enabled || current.current.scope !== scope || current.current.actor !== actor) {
      if (latest.current.loading) resumeRequired.current = true
      requestAbort.current?.abort()
    }
    current.current = { actor, enabled, scope, ready: preference.ready, onPageCommit }
  }, [actor, enabled, scope, preference.ready, onPageCommit])

  useEffect(() => {
    activeScope.current = ""
    consumedRestoration.current = undefined
    resumeRequired.current = false
    latest.current = emptyPage()
    if (!actor) return
    const controller = createNumberedPageController<T>({
      async loadPage({ scope: requestScope, page, pageSize, signal }) {
        const abort = new AbortController()
        requestAbort.current = abort
        const request = JSON.parse(requestScope) as { filters: F }
        const result = await read(request.filters, page, pageSize, AbortSignal.any([signal, abort.signal]))
        if (current.current.actor !== actor || !current.current.enabled || current.current.scope !== requestScope) throw new Error("Obsolete textbook page")
        return result
      },
      onChange(snapshot) {
        if (current.current.actor !== actor) return
        latest.current = snapshot
        if (!current.current.enabled) return
        setDisplay({ actor, snapshot })
        if (!snapshot.loading && !snapshot.error && snapshot.scope === current.current.scope) {
          current.current.onPageCommit?.({ scope: snapshot.scope, page: snapshot.page, pageSize: snapshot.pageSize })
        }
      },
    })
    controllerRef.current = controller
    return () => { controller.dispose(); requestAbort.current?.abort(); controllerRef.current = null }
  }, [actor, read])

  useEffect(() => {
    if (!actor || !enabled || !preference.ready || !controllerRef.current) return
    const restoring = restorationKey !== undefined && restorationKey !== consumedRestoration.current
    if (!restoring && activeScope.current === scope) {
      if (resumeRequired.current) {
        resumeRequired.current = false
        void controllerRef.current.retry()
      }
      return
    }
    const first = activeScope.current === ""
    const page = (restoring || first) && restoredPage <= 2147483647 ? normalizePage(restoredPage) : 1
    consumedRestoration.current = restorationKey
    activeScope.current = scope
    resumeRequired.current = false
    void controllerRef.current.load({ scope, page, pageSize: effectivePageSize })
  }, [actor, effectivePageSize, enabled, preference.ready, restorationKey, restoredPage, scope])

  const isCurrent = useCallback(() => Boolean(actor && current.current.actor === actor && current.current.enabled && current.current.ready && current.current.scope === scope), [actor, scope])
  const goToPage = useCallback((page: number) => isCurrent()
    ? controllerRef.current?.load({ scope, page, pageSize: effectivePageSize }) ?? Promise.resolve() : Promise.resolve(), [effectivePageSize, isCurrent, scope])
  const retry = useCallback(() => isCurrent() ? controllerRef.current?.retry() ?? Promise.resolve() : Promise.resolve(), [isCurrent])
  const refresh = useCallback(() => {
    if (!isCurrent()) return Promise.resolve()
    const accepted = latest.current
    return accepted.scope === scope ? goToPage(accepted.page) : retry()
  }, [isCurrent, scope, goToPage, retry])
  const setPageSizePreference = useCallback((value: DataTablePageSizePreference) => {
    if (actor && current.current.actor === actor && current.current.scope === scope) {
      setRestoredSize({ key: restorationKey, value: undefined, explicit: true })
      setPreference(value)
    }
  }, [actor, restorationKey, scope, setPreference])
  const snapshot = actor && display.actor === actor ? display.snapshot : emptyPage<T>()
  const acceptedFilters = useMemo(() => snapshot.scope === null ? null : (JSON.parse(snapshot.scope) as { filters: F }).filters, [snapshot.scope])
  return { page: { ...snapshot, loading: Boolean(actor && enabled && (!preference.ready || snapshot.loading)), acceptedFilters,
    goToPage, retry, refresh, pageSizeMode: preference.mode, setPageSizePreference },
    resourceScope, resourceReady: preference.ready,
  }
}

function useSummary<F, T>(actor: Actor | null, enabled: boolean, scope: string, filters: F, read: SummaryReader<F, T>): TextbookSummaryResource<T> {
  const [display, setDisplay] = useState<{ actor: Actor | null; resource: Omit<TextbookSummaryResource<T>, "retry"> }>({ actor: null, resource: emptySummary() })
  const current = useRef({ actor, enabled, scope, filters })
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; active.current?.abort() }
  }, [])
  useLayoutEffect(() => {
    if (current.current.actor !== actor || current.current.scope !== scope || !enabled) active.current?.abort()
    current.current = { actor, enabled, scope, filters }
  }, [actor, enabled, scope, filters])
  const retry = useCallback(async () => {
    if (!mounted.current || !actor || current.current.actor !== actor || !current.current.enabled || current.current.scope !== scope) return
    active.current?.abort()
    const abort = new AbortController()
    active.current = abort
    const valid = () => mounted.current && !abort.signal.aborted && active.current === abort && current.current.actor === actor && current.current.enabled && current.current.scope === scope
    setDisplay({ actor, resource: { value: null, scope, loading: true, error: null } })
    try {
      const value = await read(current.current.filters, { signal: abort.signal })
      if (valid()) setDisplay({ actor, resource: { value, scope, loading: false, error: null } })
    } catch (error) {
      if (valid()) setDisplay({ actor, resource: { value: null, scope, loading: false, error } })
    }
  }, [actor, scope, read])
  useEffect(() => {
    let live = true
    queueMicrotask(() => { if (live && enabled) void retry() })
    return () => { live = false; active.current?.abort() }
  }, [enabled, retry])
  const resource = actor && display.actor === actor && display.resource.scope === scope ? display.resource : emptySummary<T>()
  return { ...resource, loading: Boolean(actor && enabled && resource.loading), retry }
}

function usePageWithSummary<F, T, S>(actor: Actor | null, tableId: string, entry: TextbookNumberedEntry<F>, read: PageReader<F, T>, summaryRead: SummaryReader<F, S>) {
  const { resourceScope, resourceReady, page } = useNumberedPage(actor, tableId, entry, read)
  const summary = useSummary(actor, entry.enabled && resourceReady, resourceScope, entry.filters, summaryRead)
  const matchesAccepted = page.acceptedFilters !== null && JSON.stringify(page.acceptedFilters) === JSON.stringify(entry.filters)
  return { ...page, summary: { ...summary, value: matchesAccepted ? summary.value : null } }
}
function usePageOnly<F, T>(actor: Actor | null, tableId: string, entry: TextbookNumberedEntry<F>, read: PageReader<F, T>) {
  const { page } = useNumberedPage(actor, tableId, entry, read)
  return page
}

export function useTextbookNumberedData(input: TextbookNumberedDataInput) {
  const actorKey = input.authReady && input.viewerId.trim() && input.viewerRole.trim() ? JSON.stringify([input.viewerId, input.viewerRole]) : ""
  // A fresh identity object also invalidates callbacks from an earlier login of the same user.
  const actor = useMemo(() => actorKey ? { key: actorKey } : null, [actorKey])
  const management = ["admin", "staff"].includes(input.viewerRole) ? actor : null
  const requester = ["admin", "staff", "teacher"].includes(input.viewerRole) ? actor : null
  const master = usePageWithSummary(management, "textbooks:master", input.master, readMaster, getTextbookMasterSummary)
  const requests = usePageWithSummary(requester, "textbooks:requests", { ...input.requests, filters: { ...input.requests.filters, mode: "request" as const } }, readPurchase, getTextbookPurchaseSummary)
  const purchase = usePageWithSummary(management, "textbooks:purchase", { ...input.purchase, filters: { ...input.purchase.filters, mode: "order" as const } }, readPurchase, getTextbookPurchaseSummary)
  const sales = usePageWithSummary(management, "textbooks:sales", input.sales, readSale, getTextbookSaleSummary)
  const saleHistory = usePageWithSummary(management, "textbooks:sales-history", input.saleHistory, readSaleHistory, getTextbookSaleHistorySummary)
  const inventory = usePageWithSummary(management, "textbooks:inventory", input.inventory, readInventory, getTextbookInventorySummary)
  const inventoryHistory = usePageOnly(management, "textbooks:inventory-history", input.inventoryHistory, readInventoryHistory)
  const closing = usePageOnly(management, "textbooks:closing", input.closing, readClosing)
  const closingMovements = usePageOnly(management, "textbooks:closing-movements", input.closingMovements, readClosingMovements)
  const operations = useSummary(management, input.operationsEnabled, JSON.stringify({ actor: management?.key, resource: "operations" }), null, readOperations)
  const refreshVisible = async () => {
    await Promise.all([
      master.refresh(), requests.refresh(), purchase.refresh(), sales.refresh(), saleHistory.refresh(), inventory.refresh(),
      inventoryHistory.refresh(), closing.refresh(), closingMovements.refresh(),
      master.summary.retry(), requests.summary.retry(), purchase.summary.retry(), sales.summary.retry(), saleHistory.summary.retry(), inventory.summary.retry(), operations.retry(),
    ])
  }
  return { master, requests, purchase, sales, saleHistory, inventory, inventoryHistory, closing, closingMovements, operations, refreshVisible }
}
