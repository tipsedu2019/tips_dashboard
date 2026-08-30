import type { ManagementKind } from "./use-management-records";

export const MANAGEMENT_LIST_PAGE_SIZES = [10, 15, 20] as const;
export type ManagementListPageSize = (typeof MANAGEMENT_LIST_PAGE_SIZES)[number];
export type ManagementPageSizePreference = { version: 1; size: ManagementListPageSize };

export function clampManagementPageIndex(pageIndex: number, rowCount: number, pageSize: number) {
  const safePageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
  const safeRowCount = Number.isFinite(rowCount) ? Math.max(0, Math.floor(rowCount)) : 0;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  const lastPageIndex = Math.max(0, Math.ceil(safeRowCount / safePageSize) - 1);
  return Math.min(safePageIndex, lastPageIndex);
}

export function pickManagementListPageSize(fitRows: number): ManagementListPageSize {
  const safeFit = Number.isFinite(fitRows) ? Math.floor(fitRows) : 20;
  return [...MANAGEMENT_LIST_PAGE_SIZES].reverse().find((size) => size <= safeFit) ?? 10;
}

export function estimateManagementListPageSize(viewportHeight: number): ManagementListPageSize {
  if (viewportHeight >= 940) return 20;
  if (viewportHeight >= 760) return 15;
  return 10;
}

export function parseManagementPageSizePreference(raw: string | null): ManagementPageSizePreference | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.version === 1 && MANAGEMENT_LIST_PAGE_SIZES.includes(value.size)
      ? value as ManagementPageSizePreference
      : null;
  } catch {
    return null;
  }
}

export function managementPageSizeStorageKey(kind: ManagementKind) {
  return `tips:management-page-size:${kind}:v1`;
}
