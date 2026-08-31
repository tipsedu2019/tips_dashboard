export const DATA_TABLE_PAGE_SIZES = [10, 15, 20] as const

export type DataTablePageSize = (typeof DATA_TABLE_PAGE_SIZES)[number]

export type DataTablePageSizePreference = "auto" | DataTablePageSize

export type NumberedPage<T> = {
  rows: T[]
  page: number
  pageSize: DataTablePageSize
  totalCount: number
}

export type NumberedPagination = {
  page: number
  totalPages: number | null
  pages: number[]
  rangeStart: number
  rangeEnd: number
  canPrevious: boolean
  canNext: boolean
}

export function normalizePage(page: unknown): number {
  return typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : 1
}

export function validatePageSize(pageSize: unknown): DataTablePageSize {
  if (typeof pageSize === "number" && (DATA_TABLE_PAGE_SIZES as readonly number[]).includes(pageSize)) {
    return pageSize as DataTablePageSize
  }

  throw new RangeError("Invalid page size: expected 10, 15, or 20")
}

export function getNumberedPagination({
  page,
  pageSize,
  totalCount,
}: {
  page: unknown
  pageSize: unknown
  totalCount: number | null
}): NumberedPagination {
  const validPageSize = validatePageSize(pageSize)
  const requestedPage = normalizePage(page)

  if (totalCount === null) {
    return {
      page: requestedPage,
      totalPages: null,
      pages: [],
      rangeStart: 0,
      rangeEnd: 0,
      canPrevious: false,
      canNext: false,
    }
  }

  const normalizedTotalCount = Number.isFinite(totalCount) && totalCount > 0 ? Math.floor(totalCount) : 0
  const totalPages = Math.ceil(normalizedTotalCount / validPageSize)
  const currentPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages)

  if (totalPages === 0) {
    return {
      page: currentPage,
      totalPages,
      pages: [],
      rangeStart: 0,
      rangeEnd: 0,
      canPrevious: false,
      canNext: false,
    }
  }

  const blockStart = Math.floor((currentPage - 1) / 10) * 10 + 1
  const blockEnd = Math.min(blockStart + 9, totalPages)

  return {
    page: currentPage,
    totalPages,
    pages: Array.from({ length: blockEnd - blockStart + 1 }, (_, index) => blockStart + index),
    rangeStart: (currentPage - 1) * validPageSize + 1,
    rangeEnd: Math.min(currentPage * validPageSize, normalizedTotalCount),
    canPrevious: currentPage > 1,
    canNext: currentPage < totalPages,
  }
}
