import { normalizePage } from "../../lib/numbered-pagination.ts";
import { normalizeManagementNumberedSort, type ManagementNumberedKind, type ManagementNumberedSort } from "./management-numbered-service.ts";
import { replaceManagementListUrl, serializeManagementListFilters } from "./management-filter-transition.js";

export type ManagementNumberedQuery = { page: number; sort: ManagementNumberedSort };
export const MANAGEMENT_TABLE_STORAGE_VERSION = 14;
export function managementTableStorageKey(kind: ManagementNumberedKind) {
  return `tips-management-table:${kind}:v${MANAGEMENT_TABLE_STORAGE_VERSION}`;
}
export function defaultManagementNumberedSort(kind: ManagementNumberedKind): ManagementNumberedSort {
  return kind === "students" ? [{ id: "status", desc: false }, { id: "title", desc: false }]
    : kind === "textbooks" ? [{ id: "subject", desc: false }, { id: "title", desc: false }]
      : [{ id: "title", desc: false }];
}
export function sanitizeManagementNumberedSort(kind: ManagementNumberedKind, value: unknown) {
  const normalized = normalizeManagementNumberedSort(kind, value);
  return normalized.length || (Array.isArray(value) && value.length === 0) ? normalized : defaultManagementNumberedSort(kind);
}
export function readManagementNumberedQuery(kind: ManagementNumberedKind, search: string, savedSort?: unknown): ManagementNumberedQuery {
  const params = new URLSearchParams(search);
  let sort = savedSort;
  if (params.has("sort")) {
    try { sort = JSON.parse(params.get("sort") || "null"); } catch { sort = undefined; }
  }
  const page = normalizePage(Number(params.get("page")));
  return { page: page <= 2147483647 ? page : 1, sort: sanitizeManagementNumberedSort(kind, sort) };
}
export function updateManagementNumberedQuery(search: string, query: ManagementNumberedQuery) {
  const params = new URLSearchParams(search);
  if (query.page <= 1) params.delete("page"); else params.set("page", String(query.page));
  params.set("sort", JSON.stringify(query.sort));
  return params.toString();
}

export function replaceManagementNumberedQuery(target: Pick<Window, "history" | "location">, pathname: string, query: ManagementNumberedQuery) {
  const params = updateManagementNumberedQuery(target.location.search, query);
  // Passing Next's __NA/_N state would bypass useSearchParams synchronization.
  replaceManagementListUrl(target.history, params ? `${pathname}?${params}` : pathname);
}

export function resetManagementPageForFilters(kind: ManagementNumberedKind, previousSearch: string, next: URLSearchParams, canonicalPeriod = "") {
  const previous = JSON.parse(serializeManagementListFilters(kind, previousSearch));
  const changed = JSON.parse(serializeManagementListFilters(kind, next.toString()));
  if (kind === "classes" && !previous.periodId && changed.periodId === canonicalPeriod) previous.periodId = canonicalPeriod;
  if (JSON.stringify(previous) !== JSON.stringify(changed)) next.delete("page");
}
