"use client"

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DATA_TABLE_PAGE_SIZES,
  type DataTablePageSize,
  type DataTablePageSizePreference,
  getNumberedPagination,
  validatePageSize,
} from "@/lib/numbered-pagination"

export type DataTablePaginationProps = {
  page: number
  pageSize: DataTablePageSize
  totalCount: number | null
  loading?: boolean
  onPageChange: (page: number) => void
  pageSizeMode?: "auto" | "manual"
  onPageSizeChange?: (preference: DataTablePageSizePreference) => void
  ariaLabel?: string
}

export function DataTablePagination({
  page,
  pageSize,
  totalCount,
  loading = false,
  onPageChange,
  pageSizeMode = "auto",
  onPageSizeChange,
  ariaLabel = "페이지 탐색",
}: DataTablePaginationProps) {
  const pagination = getNumberedPagination({ page, pageSize, totalCount })
  const navigationDisabled = loading || pagination.totalPages === null
  const changePage = (nextPage: number) => {
    if (!navigationDisabled && nextPage !== pagination.page) onPageChange(nextPage)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {pagination.totalPages === null
          ? "건수 확인 중"
          : `${totalCount ?? 0}건 · ${pagination.rangeStart}–${pagination.rangeEnd}번째`}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onPageSizeChange ? (
          <Select
            value={pageSizeMode === "auto" ? "auto" : String(pageSize)}
            onValueChange={(value) => onPageSizeChange(value === "auto" ? "auto" : validatePageSize(Number(value)))}
            disabled={loading}
          >
            <SelectTrigger size="sm" aria-label="페이지당 행 수">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="auto">자동</SelectItem>
                {DATA_TABLE_PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}개씩 보기</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Pagination aria-label={ariaLabel} className="w-auto">
          <PaginationContent className="flex-wrap justify-center">
            <PaginationItem>
              <Button type="button" variant="outline" size="sm" aria-label="첫 페이지" disabled={navigationDisabled || !pagination.canPrevious} onClick={() => changePage(1)}>
                <ChevronsLeft data-icon="inline-start" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button type="button" variant="outline" size="sm" aria-label="이전 페이지" disabled={navigationDisabled || !pagination.canPrevious} onClick={() => changePage(pagination.page - 1)}>
                <ChevronLeft data-icon="inline-start" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <div data-slot="pagination-number-group" className="flex flex-wrap justify-center gap-1">
                {pagination.pages.map((number) => (
                  <Button key={number} type="button" variant={number === pagination.page ? "default" : "outline"} size="sm" aria-label={`${number} 페이지`} aria-current={number === pagination.page ? "page" : undefined} onClick={() => changePage(number)} disabled={navigationDisabled}>
                    {number}
                  </Button>
                ))}
              </div>
            </PaginationItem>
            <PaginationItem>
              <Button type="button" variant="outline" size="sm" aria-label="다음 페이지" disabled={navigationDisabled || !pagination.canNext} onClick={() => changePage(pagination.page + 1)}>
                <ChevronRight data-icon="inline-end" />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button type="button" variant="outline" size="sm" aria-label="마지막 페이지" disabled={navigationDisabled || !pagination.canNext} onClick={() => changePage(pagination.totalPages ?? pagination.page)}>
                <ChevronsRight data-icon="inline-end" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
