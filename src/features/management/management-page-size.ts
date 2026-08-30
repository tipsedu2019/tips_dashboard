import type { ManagementKind } from "./use-management-records";

export const MANAGEMENT_LIST_PAGE_SIZES = [10, 15, 20] as const;
export type ManagementListPageSize = (typeof MANAGEMENT_LIST_PAGE_SIZES)[number];
export type ManagementPageSizePreference = { version: 1; size: ManagementListPageSize };

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
