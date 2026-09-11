import type {
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

export const textbookTabs = ["master", "requests", "purchase", "sales", "inventory"] as const
export type TextbookTab = (typeof textbookTabs)[number]
export const textbookDetailKinds = ["master", "purchase", "sale"] as const
export type TextbookDetailKind = (typeof textbookDetailKinds)[number]

type PrimaryFilters = MasterFilters | Omit<InventoryFilters, "locationId" | "audit"> | Omit<import("./textbook-read-types").PurchaseFilters, "mode"> | SaleFilters
export type TextbookNavigationState = {
  tab: TextbookTab
  primary: { page: number; pageSize: DataTablePageSize; filters: PrimaryFilters }
  history: { page: number; pageSize: DataTablePageSize; filters: SaleHistoryFilters }
  detail: { kind: TextbookDetailKind; id: string } | null
}

const masterDefaults: MasterFilters = {
  search: "", subject: "all", schoolLevel: "all", gradeLevel: "all", subSubject: "all", quality: "all", inventory: "all",
}
const purchaseDefaults = { search: "", boardScope: "active" as PurchaseBoardScope, requestFilter: "all" as PurchaseRequestFilter, orderFilter: "all" as PurchaseOrderFilter }
const saleDefaults: SaleFilters = { search: "", status: "all" }
const historyDefaults: SaleHistoryFilters = { search: "", year: "all", month: "all", classId: "all" }
const quality = new Set<TextbookQualityFilter>(["all", "attention", "duplicate", "missingCode", "missingPublisher", "missingCategory", "missingPrice", "subjectMismatch", "inactive"])
const inventory = new Set(["all", "shortage", "surplus", "unused", "negative"])
const boardScopes = new Set<PurchaseBoardScope>(["active", "recent", "all"])
const requestFilters = new Set<PurchaseRequestFilter>(["all", "unregistered", "orderable"])
const orderFilters = new Set<PurchaseOrderFilter>(["all", "waiting", "partial", "returnable", "returned"])
const saleStatuses = new Set<SalesProcessFilter>(["all", "waiting", "issued", "returned", "cancelled"])
const subjects = new Set(["all", "english", "math", "science", "other"])
const schoolLevels = new Set(["all", "elementary", "middle", "high"])
const gradeLevels = new Set(["all", "e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const month = /^\d{4}-(0[1-9]|1[0-2])$/
const year = /^\d{4}$/
const positiveInteger = /^[1-9]\d*$/
const controlCharacters = /[\p{Cc}\p{Cf}]/u

function page(value: string | null) {
  if (!value || !positiveInteger.test(value)) return 1
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 2147483647 ? parsed : 1
}
function pageSize(value: string | null): DataTablePageSize {
  return value && ["10", "15", "20"].includes(value) ? Number(value) as DataTablePageSize : 10
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
function boundedText(value: unknown, maximum = 120, allowEmpty = true) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  if ((!allowEmpty && !normalized) || normalized.length > maximum || controlCharacters.test(normalized)) return null
  return normalized
}
function primaryDefaults(tab: TextbookTab): PrimaryFilters {
  if (tab === "requests" || tab === "purchase") return { ...purchaseDefaults }
  if (tab === "sales") return { ...saleDefaults }
  return { ...masterDefaults }
}
function parsePrimary(tab: TextbookTab, raw: string | null): PrimaryFilters {
  const value = record(raw)
  if (!value) return primaryDefaults(tab)
  if (tab === "master" || tab === "inventory") {
    const keys = ["search", "subject", "schoolLevel", "gradeLevel", "subSubject", "quality", "inventory"]
    if (!exactKeys(value, keys) || !strings(value, keys) || !subjects.has(value.subject as string) || !schoolLevels.has(value.schoolLevel as string)
      || !gradeLevels.has(value.gradeLevel as string) || !quality.has(value.quality as TextbookQualityFilter) || !inventory.has(value.inventory as string)) return primaryDefaults(tab)
    const search = boundedText(value.search)
    const subSubject = value.subSubject === "all" ? "all" : boundedText(value.subSubject, 80, false)
    return search !== null && subSubject !== null ? { ...value, search, subSubject } as MasterFilters : primaryDefaults(tab)
  }
  if (tab === "requests" || tab === "purchase") {
    const keys = ["search", "boardScope", "requestFilter", "orderFilter"]
    return exactKeys(value, keys) && strings(value, keys) && boundedText(value.search) !== null && boardScopes.has(value.boardScope as PurchaseBoardScope)
      && requestFilters.has(value.requestFilter as PurchaseRequestFilter) && orderFilters.has(value.orderFilter as PurchaseOrderFilter)
      ? { ...value, search: boundedText(value.search) as string } as typeof purchaseDefaults : primaryDefaults(tab)
  }
  if (tab === "sales") {
    const keys = ["search", "status"]
    return exactKeys(value, keys) && strings(value, keys) && boundedText(value.search) !== null && saleStatuses.has(value.status as SalesProcessFilter)
      ? { ...value, search: boundedText(value.search) as string } as SaleFilters : primaryDefaults(tab)
  }
  return primaryDefaults(tab)
}
function parseHistory(raw: string | null): SaleHistoryFilters {
  const value = record(raw)
  const keys = ["search", "year", "month", "classId"]
  return value && exactKeys(value, keys) && strings(value, keys) && value.search === "" && (value.year === "all" || year.test(value.year as string))
    && (value.month === "all" || month.test(value.month as string)) && (value.classId === "all" || uuid.test(value.classId as string)) ? value as SaleHistoryFilters : { ...historyDefaults }
}

// Accept old bookmarks, but never keep a removed catalog filter active invisibly.
function normalizeCatalogPrimary(tab: TextbookTab, primary: TextbookNavigationState["primary"]): TextbookNavigationState["primary"] {
  if (tab !== "master" && tab !== "inventory") return primary
  const filters = primary.filters as MasterFilters
  const quality = tab === "master" && filters.quality === "inactive" ? "inactive" : "all"
  const changed = filters.quality !== quality || filters.inventory !== "all"
  return {
    ...primary,
    page: changed ? 1 : primary.page,
    filters: {
      search: filters.search, subject: filters.subject, schoolLevel: filters.schoolLevel,
      gradeLevel: filters.gradeLevel, subSubject: filters.subSubject, quality, inventory: "all",
    },
  }
}

export function parseTextbookNavigation(params: URLSearchParams): TextbookNavigationState {
  const candidate = params.get("textbookTab")
  const tab = textbookTabs.includes(candidate as TextbookTab) ? candidate as TextbookTab : "master"
  const kind = params.get("textbookDetailKind")
  const id = params.get("textbookDetail") || ""
  return {
    tab,
    primary: normalizeCatalogPrimary(tab, { page: candidate === "closing" ? 1 : page(params.get("textbookPage")), pageSize: pageSize(params.get("textbookPageSize")), filters: parsePrimary(tab, params.get("textbookFilters")) }),
    history: { page: page(params.get("textbookHistoryPage")), pageSize: pageSize(params.get("textbookHistoryPageSize")), filters: parseHistory(params.get("textbookHistoryFilters")) },
    detail: candidate !== "closing" && textbookDetailKinds.includes(kind as TextbookDetailKind) && uuid.test(id) ? { kind: kind as TextbookDetailKind, id } : null,
  }
}

const canonicalKeys = ["textbookTab", "textbookPage", "textbookPageSize", "textbookFilters", "textbookHistoryPage", "textbookHistoryPageSize", "textbookHistoryFilters", "textbookMovementPage", "textbookMovementPageSize", "textbookMovementSearch", "textbookDetailKind", "textbookDetail"]
const privateKeys = ["selectedIds", "selectedTextbookIds", "selectedPurchaseLineIds", "selectedSaleLineIds", "selectedClosingIds", "draft", "drafts", "memo", "quantity", "pendingWrite"]

export function serializeTextbookNavigation(current: URLSearchParams, state: TextbookNavigationState) {
  const next = new URLSearchParams(current)
  const primary = normalizeCatalogPrimary(state.tab, state.primary)
  for (const key of [...canonicalKeys, ...privateKeys]) next.delete(key)
  next.set("textbookTab", state.tab)
  next.set("textbookPage", String(primary.page))
  next.set("textbookPageSize", String(primary.pageSize))
  next.set("textbookFilters", JSON.stringify(primary.filters))
  next.set("textbookHistoryPage", String(state.history.page))
  next.set("textbookHistoryPageSize", String(state.history.pageSize))
  next.set("textbookHistoryFilters", JSON.stringify(state.history.filters))
  if (state.detail) {
    next.set("textbookDetailKind", state.detail.kind)
    next.set("textbookDetail", state.detail.id)
  }
  return next
}
