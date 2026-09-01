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

export function getManagementListViewportHeight({
  viewportHeight,
  viewportDocumentTop,
  footerHeight,
  footerGap,
  bottomReserve,
}: {
  viewportHeight: number;
  viewportDocumentTop: number;
  footerHeight: number;
  footerGap: number;
  bottomReserve: number;
}) {
  // Extremely short windows may scroll the page; never collapse the table to zero.
  return Math.max(160, Math.floor(viewportHeight - viewportDocumentTop
    - footerHeight - Math.max(0, footerGap) - Math.max(0, bottomReserve)));
}

export function getManagementListRowCapacity({
  viewportHeight,
  bodyViewportTop,
  documentScrollTop,
  rowHeight,
  footerHeight,
  bodyToFooterGap,
  bottomReserve,
}: {
  viewportHeight: number;
  bodyViewportTop: number;
  documentScrollTop: number;
  rowHeight: number;
  footerHeight: number;
  bodyToFooterGap: number;
  bottomReserve: number;
}) {
  const bodyDocumentTop = bodyViewportTop + documentScrollTop;
  const availableHeight = viewportHeight - bodyDocumentTop - footerHeight
    - Math.max(0, bodyToFooterGap) - Math.max(0, bottomReserve);
  return Math.max(0, Math.floor(availableHeight / (rowHeight > 0 ? rowHeight : 34)));
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
