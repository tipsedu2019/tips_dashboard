"use client"
import { useSearchParams } from "next/navigation"
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react"
import { DataTableSearchField } from "@/components/data-table/data-table-search-field"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { DATA_TABLE_LAYOUT_CLASS_NAME, DATA_TABLE_TABLE_CLASS_NAME, DataTableWorkspaceToolbar, DataTableReadFeedback, DataTableViewport, DataTableHeaderRow, DataTableHeaderCell, DataTableBodyRow, DataTableBodyCell } from "@/components/data-table/data-table-surface"
import { isNumberedPagePermissionError } from "@/lib/numbered-page-controller"
import type { DataTablePageSize, NumberedPage } from "@/lib/numbered-pagination"
import { readTeacherTextbookRequestDetail, readTeacherTextbookRequests, type TeacherTextbookRequest } from "./teacher-textbook-request-read"
import { TeacherTextbookRequestCreate } from "./teacher-textbook-request-create"

export function TeacherTextbookRequestWorkspace() {
  const [search, setSearch] = useState("")
  const searchInput = useRef<HTMLInputElement | null>(null)
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<DataTablePageSize>(15)
  const [accepted, setAccepted] = useState<NumberedPage<TeacherTextbookRequest> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<TeacherTextbookRequest | null>(null)
  const [detailError, setDetailError] = useState("")
  const [detailRetry, setDetailRetry] = useState(0)
  const generation = useRef(0)
  const detailGeneration = useRef(0)
  const permissionEpoch = useRef(0)
  const pageAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)
  const revokeCommonRead = useCallback(() => {
    permissionEpoch.current += 1
    pageAbort.current?.abort(); detailAbort.current?.abort()
    setAccepted(null); setSelected(null); setDetailError(""); setLoading(false)
    setError("교재요청 조회 권한 또는 로그인 상태를 확인해 주세요.")
  }, [])
  const query = useSearchParams().toString()
  const params = new URLSearchParams(query)
  const detailAnchor = params.get("textbookDetailKind") === "purchase" ? params.get("textbookDetail") || "" : ""
  useEffect(() => {
    const controller = new AbortController()
    detailAbort.current = controller
    const epoch = permissionEpoch.current, token = ++detailGeneration.current
    const current = () => !controller.signal.aborted && epoch === permissionEpoch.current && token === detailGeneration.current
    setSelected(null); setDetailError("")
    if (detailAnchor) void readTeacherTextbookRequestDetail(detailAnchor, controller.signal).then(row => {
      if (!current()) return
      setSelected(row)
      if (!row) setDetailError("교재요청을 찾을 수 없습니다.")
    }).catch(error => {
      if (!current()) return
      if (isNumberedPagePermissionError(error)) revokeCommonRead()
      else setDetailError("교재요청 상세를 불러오지 못했습니다.")
    })
    return () => controller.abort()
  }, [detailAnchor, detailRetry, revokeCommonRead])
  useEffect(() => {
    const token = ++generation.current, epoch = permissionEpoch.current
    const controller = new AbortController()
    pageAbort.current = controller
    const current = () => !controller.signal.aborted && generation.current === token && permissionEpoch.current === epoch
    setLoading(true); setError("")
    void readTeacherTextbookRequests({ search: deferredSearch, page, pageSize }, { signal: controller.signal }).then(result => {
      if (!current()) return
      setAccepted(result)
      // A concurrent deletion can shrink the last page. Adopt the valid page
      // and read it once; the shared footer must not mask a stranded page state.
      const lastPage = Math.max(1, Math.ceil(result.totalCount / result.pageSize))
      if (page > lastPage) setPage(lastPage)
    }).catch(error => {
      if (!current()) return
      if (isNumberedPagePermissionError(error)) { revokeCommonRead(); return }
      setAccepted(null); setSelected(null); setError("교재요청을 불러오지 못했습니다.")
    }).finally(() => {
      if (current()) setLoading(false)
    })
    return () => controller.abort()
  }, [deferredSearch, page, pageSize, reload, revokeCommonRead])
  const readFeedback = error ? <DataTableReadFeedback
    label={detailError ? "목록·상세 조회 실패" : "목록 조회 실패"}
    message={`${error}${detailError ? ` 상세: ${detailError}` : ""}`}
    retryLabel="교재요청 다시 조회" returnFocusRef={searchInput}
    onRetry={() => { setReload(value => value + 1); setDetailRetry(value => value + 1) }}
  /> : detailError ? <DataTableReadFeedback label="상세 조회 실패" message={detailError}
    retryLabel="상세 다시 조회" returnFocusRef={searchInput} onRetry={() => setDetailRetry(value => value + 1)}
  /> : loading ? <span role="status" className="min-w-0 text-xs text-muted-foreground">{accepted ? "목록 갱신 중…" : "조회 중…"}</span> : null
  return <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
    <DataTableWorkspaceToolbar
      search={<DataTableSearchField ref={searchInput} label="교재요청 검색" placeholder="교재·수업·신청자 검색" value={search} onValueChange={value => { setSearch(value); setPage(1) }} />}
      actions={<>{readFeedback}<div className="flex min-w-0 items-center gap-2">
        <TeacherTextbookRequestCreate onSaved={() => { setSearch(""); setPage(1); setReload(value => value + 1) }} />
      </div></>}
      summary={accepted ? `전체 ${accepted.totalCount}건` : error ? "건수 미확인" : "건수 확인 중"}
    />
    <DataTableViewport role="region" aria-label="교재요청 목록" tabIndex={0} className="[&>[data-slot=table-container]]:overflow-visible">
      <Table className={DATA_TABLE_TABLE_CLASS_NAME}>
        <TableHeader><DataTableHeaderRow>{["교재", "수업", "학생용", "교사용", "신청자", "요청일"].map(label => <DataTableHeaderCell key={label}>{label}</DataTableHeaderCell>)}</DataTableHeaderRow></TableHeader>
        <TableBody>{accepted?.rows.map(row => <DataTableBodyRow key={row.id}>
          <DataTableBodyCell wrap><Button variant="link" className="h-auto whitespace-normal px-0 text-left" onClick={() => { detailGeneration.current += 1; detailAbort.current?.abort(); setSelected(row) }}>{row.bookTitle}</Button></DataTableBodyCell>
          <DataTableBodyCell wrap>{row.className || "-"}</DataTableBodyCell><DataTableBodyCell>{row.studentQuantity}권</DataTableBodyCell><DataTableBodyCell>{row.teacherQuantity}권</DataTableBodyCell><DataTableBodyCell>{row.requesterLabel}</DataTableBodyCell><DataTableBodyCell>{row.requestedAt.slice(0, 10) || "-"}</DataTableBodyCell>
        </DataTableBodyRow>)}</TableBody>
      </Table>
      {!loading && !error && accepted?.rows.length === 0 && <p role="status" className="px-3 py-10 text-center text-sm text-muted-foreground">{search.trim() ? "검색 조건에 맞는 교재요청이 없습니다." : "등록된 교재요청이 없습니다."}</p>}
    </DataTableViewport>
    <DataTablePagination page={page} pageSize={pageSize} totalCount={accepted?.totalCount ?? null} loading={loading} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1) }} />
    <Dialog open={selected !== null} onOpenChange={open => { if (!open) {
      detailGeneration.current += 1; detailAbort.current?.abort()
      setSelected(null)
      const params = new URLSearchParams(window.location.search)
      params.delete("textbookDetailKind"); params.delete("textbookDetail")
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`)
    } }}><DialogContent aria-describedby={undefined} restoreFocusToOpener restoreFocusFallbackRef={searchInput}><DialogHeader><DialogTitle>{selected?.bookTitle || "교재요청"}</DialogTitle></DialogHeader>{selected && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm"><dt>수업</dt><dd>{selected.className || "-"}</dd><dt>학생용</dt><dd>{selected.studentQuantity}권</dd><dt>교사용</dt><dd>{selected.teacherQuantity}권</dd><dt>신청자</dt><dd>{selected.requesterLabel}</dd><dt>요청일</dt><dd>{selected.requestedAt.slice(0, 10) || "-"}</dd></dl>}</DialogContent></Dialog>
  </div>
}
