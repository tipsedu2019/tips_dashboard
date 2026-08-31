import type {
  ClosingFilters,
  InventoryFilters,
  MasterFilters,
  PurchaseBoardScope,
  PurchaseOrderFilter,
  PurchaseRequestFilter,
  SaleFilters,
  SaleHistoryFilters,
  SalesProcessFilter,
  TextbookQualityFilter,
} from "./textbook-read-types"
import type { DataTablePageSize } from "@/lib/numbered-pagination"

export const textbookTabs = ["master", "requests", "purchase", "sales", "inventory", "closing"] as const
export type TextbookTab = (typeof textbookTabs)[number]
export const textbookDetailKinds = ["master", "purchase", "sale", "closing"] as const
export type TextbookDetailKind = (typeof textbookDetailKinds)[number]

type PrimaryFilters = MasterFilters | Omit<InventoryFilters, "locationId" | "audit"> | Omit<import("./textbook-read-types").PurchaseFilters, "mode"> | SaleFilters | ClosingFilters
export type TextbookNavigationState = {
  tab: TextbookTab
  primary: { page: number; pageSize: DataTablePageSize; filters: PrimaryFilters }
  history: { page: number; pageSize: DataTablePageSize; filters: SaleHistoryFilters }
  movements: { page: number; pageSize: DataTablePageSize; search: string }
  detail: { kind: TextbookDetailKind; id: string } | null
}

const masterDefaults: MasterFilters = {
  search: "", subject: "all", schoolLevel: "all", gradeLevel: "all", subSubject: "all", quality: "all", inventory: "all",
}
const purchaseDefaults = { search: "", boardScope: "active" as PurchaseBoardScope, requestFilter: "all" as PurchaseRequestFilter, orderFilter: "all" as PurchaseOrderFilter }
const saleDefaults: SaleFilters = { search: "", status: "all" }
const closingDefaults: ClosingFilters = { month: "all", subject: "all", status: "all" }
const historyDefaults: SaleHistoryFilters = { search: "", year: "all", month: "all", classId: "all" }
const pageSizes = new Set([10, 15, 20])
const quality = new Set<TextbookQualityFilter>(["all", "attention", "duplicate", "missingCode", "missingPublisher", "missingCategory", "missingPrice", "subjectMismatch", "inactive"])
const inventory = new Set(["all", "shortage", "surplus", "unused", "negative"])
const boardScopes = new Set<PurchaseBoardScope>(["active", "recent", "all"])
const requestFilters = new Set<PurchaseRequestFilter>(["all", "unregistered", "orderable"])
const orderFilters = new Set<PurchaseOrderFilter>(["all", "waiting", "partial", "returnable", "returned"])
const saleStatuses = new Set<SalesProcessFilter>(["all", "waiting", "issued", "returned", "cancelled"])
const closingStatuses = new Set(["all", "draft", "locked"])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function page(value: string | null) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 2147483647 ? parsed : 1
}
function pageSize(value: string | null): DataTablePageSize {
  const parsed = Number(value)
  return pageSizes.has(parsed) ? parsed as DataTablePageSize : 10
}
function record(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "string")
}
function primaryDefaults(tab: TextbookTab): PrimaryFilters {
  if (tab === "requests" || tab === "purchase") return { ...purchaseDefaults }
  if (tab === "sales") return { ...saleDefaults }
  if (tab === "closing") return { ...closingDefaults }
  return { ...masterDefaults }
}
function parsePrimary(tab: TextbookTab, raw: string | null): PrimaryFilters {
  const value = record(raw)
  if (!value) return primaryDefaults(tab)
  if (tab === "master" || tab === "inventory") {
    const keys = ["search", "subject", "schoolLevel", "gradeLevel", "subSubject", "quality", "inventory"]
    return exactKeys(value, keys) && strings(value, keys) && quality.has(value.quality as TextbookQualityFilter) && inventory.has(value.inventory as string)
      ? value as MasterFilters : primaryDefaults(tab)
  }
  if (tab === "requests" || tab === "purchase") {
    const keys = ["search", "boardScope", "requestFilter", "orderFilter"]
    return exactKeys(value, keys) && strings(value, keys) && boardScopes.has(value.boardScope as PurchaseBoardScope)
      && requestFilters.has(value.requestFilter as PurchaseRequestFilter) && orderFilters.has(value.orderFilter as PurchaseOrderFilter)
      ? value as typeof purchaseDefaults : primaryDefaults(tab)
  }
  if (tab === "sales") {
    const keys = ["search", "status"]
    return exactKeys(value, keys) && strings(value, keys) && saleStatuses.has(value.status as SalesProcessFilter)
      ? value as SaleFilters : primaryDefaults(tab)
  }
  const keys = ["month", "subject", "status"]
  return exactKeys(value, keys) && strings(value, keys) && closingStatuses.has(value.status as string)
    ? value as ClosingFilters : primaryDefaults(tab)
}
function parseHistory(raw: string | null): SaleHistoryFilters {
  const value = record(raw)
  const keys = ["search", "year", "month", "classId"]
  return value && exactKeys(value, keys) && strings(value, keys) && value.search === "" ? value as SaleHistoryFilters : { ...historyDefaults }
}

export function parseTextbookNavigation(params: URLSearchParams): TextbookNavigationState {
  const candidate = params.get("textbookTab")
  const tab = textbookTabs.includes(candidate as TextbookTab) ? candidate as TextbookTab : "master"
  const kind = params.get("textbookDetailKind")
  const id = params.get("textbookDetail") || ""
  return {
    tab,
    primary: { page: page(params.get("textbookPage")), pageSize: pageSize(params.get("textbookPageSize")), filters: parsePrimary(tab, params.get("textbookFilters")) },
    history: { page: page(params.get("textbookHistoryPage")), pageSize: pageSize(params.get("textbookHistoryPageSize")), filters: parseHistory(params.get("textbookHistoryFilters")) },
    movements: { page: page(params.get("textbookMovementPage")), pageSize: pageSize(params.get("textbookMovementPageSize")), search: params.get("textbookMovementSearch") || "" },
    detail: textbookDetailKinds.includes(kind as TextbookDetailKind) && uuid.test(id) ? { kind: kind as TextbookDetailKind, id } : null,
  }
}

const canonicalKeys = ["textbookTab", "textbookPage", "textbookPageSize", "textbookFilters", "textbookHistoryPage", "textbookHistoryPageSize", "textbookHistoryFilters", "textbookMovementPage", "textbookMovementPageSize", "textbookMovementSearch", "textbookDetailKind", "textbookDetail"]
const privateKeys = ["selectedIds", "selectedTextbookIds", "selectedPurchaseLineIds", "selectedSaleLineIds", "selectedClosingIds", "draft", "drafts", "memo", "quantity", "pendingWrite"]

export function serializeTextbookNavigation(current: URLSearchParams, state: TextbookNavigationState) {
  const next = new URLSearchParams(current)
  for (const key of [...canonicalKeys, ...privateKeys]) next.delete(key)
  next.set("textbookTab", state.tab)
  next.set("textbookPage", String(state.primary.page))
  next.set("textbookPageSize", String(state.primary.pageSize))
  next.set("textbookFilters", JSON.stringify(state.primary.filters))
  next.set("textbookHistoryPage", String(state.history.page))
  next.set("textbookHistoryPageSize", String(state.history.pageSize))
  next.set("textbookHistoryFilters", JSON.stringify(state.history.filters))
  next.set("textbookMovementPage", String(state.movements.page))
  next.set("textbookMovementPageSize", String(state.movements.pageSize))
  if (state.movements.search) next.set("textbookMovementSearch", state.movements.search)
  if (state.detail) {
    next.set("textbookDetailKind", state.detail.kind)
    next.set("textbookDetail", state.detail.id)
  }
  return next
}
