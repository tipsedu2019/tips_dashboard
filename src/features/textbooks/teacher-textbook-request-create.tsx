"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useAuth } from "@/providers/auth-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchCombobox, SearchComboboxItem, SearchComboboxOptionContent, SearchComboboxPagination } from "@/components/ui/search-combobox"
import { useCommittedSearch } from "@/hooks/use-committed-search"
import { useRequestNavigation } from "@/features/teacher-requests/use-request-navigation"
import { isNumberedPagePermissionError } from "@/lib/numbered-page-controller"
import { readTeacherTextbookRequestOptions, submitTeacherTextbookRequest, type TeacherBookOption, type TeacherBookOptionScope } from "./teacher-textbook-request-submit"

export function RequestOption({ scope, label, triggerId, value, onChange, disabled, onPermissionDenied }: {
  scope: TeacherBookOptionScope; label: string; triggerId: string; value: TeacherBookOption | null
  onChange: (value: TeacherBookOption | null) => void; disabled: boolean; onPermissionDenied?: () => void
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1)
  const search = useCommittedSearch("")
  const [result, setResult] = useState<{ rows: TeacherBookOption[]; totalCount: number } | null>(null)
  const [error, setError] = useState(false), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false)
  const pendingSearch = search.value !== search.committed
  const busy = loading || pendingSearch
  useEffect(() => {
    if (!open || disabled) return
    const controller = new AbortController()
    setLoading(true); setError(false); setResult(null)
    void readTeacherTextbookRequestOptions({ scope, search: search.committed, page }, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }).catch(error => { if (!controller.signal.aborted) { setError(true); if (isNumberedPagePermissionError(error)) onPermissionDenied?.() } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, disabled, search.committed, page, scope, retry, onPermissionDenied])
  return <SearchCombobox
    open={open && !disabled} onOpenChange={setOpen}
    triggerId={triggerId} triggerLabel={value?.label || "선택 안 함"} triggerPlaceholder={!value} triggerAriaLabel={label} wrapTrigger
    searchValue={search.value} onSearchValueChange={value => { search.onChange(value); setPage(1) }}
    onSearchCompositionStart={search.onCompositionStart} onSearchCompositionEnd={event => { search.onCompositionEnd(event.currentTarget.value); setPage(1) }}
    searchPlaceholder={scope === "textbooks" ? "교재명 검색" : scope === "classes" ? "수업명 검색" : "위치 검색"}
    searchAriaLabel={`${label} 검색`} selectedValue={value?.id || ""} listAriaLabel={`${label} 목록`}
    disabled={disabled} loading={busy} loadingMessage="불러오는 중…"
    emptyMessage={error ? <div className="grid justify-items-center gap-2" role="alert"><span>목록을 불러오지 못했습니다.</span><Button type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>다시 시도</Button></div> : <span role="status">{search.value.trim() ? "검색 결과가 없습니다." : "선택할 항목이 없습니다."}</span>}
    footer={<SearchComboboxPagination label={label} page={page} pageSize={15} totalCount={result?.totalCount ?? null} loading={busy}
      onPageChange={setPage} onClear={() => { onChange(null); setOpen(false) }} clearDisabled={!value || disabled} />}
  >
    {!error && result?.rows.map(option => <SearchComboboxItem key={option.id} value={option.id} onSelect={() => { onChange(option); setOpen(false) }}>
      <SearchComboboxOptionContent label={option.label} selected={option.id === value?.id} />
    </SearchComboboxItem>)}
  </SearchCombobox>
}

export function TeacherTextbookRequestCreate({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false), [title, setTitle] = useState(""), [memo, setMemo] = useState("")
  const [studentQuantity, setStudentQuantity] = useState(""), [teacherQuantity, setTeacherQuantity] = useState("")
  const [book, setBook] = useState<TeacherBookOption | null>(null), [classItem, setClassItem] = useState<TeacherBookOption | null>(null), [location, setLocation] = useState<TeacherBookOption | null>(null)
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false)
  const inFlight = useRef(false), mounted = useRef(true)
  const request = useRef<{ id: string; input: Parameters<typeof submitTeacherTextbookRequest>[1] } | null>(null)
  const dirty = Boolean(title || memo || studentQuantity || teacherQuantity || book || classItem || location)
  const locked = pending || uncertain
  const { move: requestLocalAction, confirmation } = useRequestNavigation(open && dirty, locked, () => setError("저장 결과를 확인한 후 이동해 주세요."))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const clear = useCallback(() => {
    setTitle(""); setMemo(""); setStudentQuantity(""); setTeacherQuantity("")
    setBook(null); setClassItem(null); setLocation(null); setError(""); setUncertain(false); request.current = null
  }, [])
  const revoke = useCallback(() => { clear(); setOpen(false); setSaved(false); setError("신청 권한 또는 로그인 상태가 변경됐습니다."); onSaved() }, [clear, onSaved])
  function close() {
    if (locked) return
    requestLocalAction(() => { clear(); setOpen(false) })
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const quantity = (value: string) => value === "" ? 0 : /^(0|[1-9]\d*)$/.test(value) && Number(value) <= 2147483647 ? Number(value) : -1
    const student = quantity(studentQuantity), teacher = quantity(teacherQuantity)
    if (!uncertain && (!title.trim() || student < 0 || teacher < 0 || student + teacher < 1)) {
      setError("교재명과 1권 이상의 정수 요청 수량을 입력해 주세요."); return
    }
    if (!uncertain) request.current = { id: crypto.randomUUID(), input: { title: title.trim(), textbookId: book?.id || null, classId: classItem?.id || null, locationId: location?.id || null, studentQuantity: student, teacherQuantity: teacher, memo } }
    const submission = request.current
    if (!submission) return
    inFlight.current = true; setPending(true); setError(""); setSaved(false)
    try {
      await submitTeacherTextbookRequest(submission.id, submission.input, user?.id || "")
      if (!mounted.current) return
      clear(); setOpen(false); setSaved(true); onSaved()
    } catch (failure) {
      if (!mounted.current) return
      if (isNumberedPagePermissionError(failure)) { revoke(); return }
      const deterministic = isNumberedPagePermissionError(failure) || (failure && typeof failure === "object" && "code" in failure && ["22023", "22P02", "23503"].includes(String(failure.code)))
      setUncertain(!deterministic)
      setError(deterministic ? "요청을 저장하지 못했습니다. 입력값과 로그인 권한을 확인해 주세요." : "저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 다시 확인해 주세요.")
    } finally { inFlight.current = false; if (mounted.current) setPending(false) }
  }
  return <>
    <Button onClick={() => { setSaved(false); setOpen(true) }}>요청 추가</Button>
    {!open && error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    {saved && <span role="status" className="min-w-0 truncate text-sm text-muted-foreground" title="교재 요청을 등록했습니다.">교재 요청을 등록했습니다.</span>}
    <Dialog open={open} onOpenChange={value => { if (!value) close() }}><DialogContent aria-describedby={undefined} restoreFocusToOpener className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>교재 요청</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-2"><Label htmlFor="teacher-request-book">등록 교재</Label><RequestOption triggerId="teacher-request-book" scope="textbooks" onPermissionDenied={revoke} label="등록 교재 선택" value={book} disabled={locked} onChange={value => { setBook(value); if (value) setTitle(value.label) }} /></div>
        <div className="grid gap-2"><Label htmlFor="teacher-request-title">교재명 <span aria-hidden="true">*</span><span className="sr-only">필수 입력</span></Label><Input required name="title" autoComplete="off" id="teacher-request-title" aria-label="요청 교재명" value={title} disabled={locked} onChange={event => { setTitle(event.target.value); setBook(null) }} /></div>
        <div className="grid gap-2"><Label htmlFor="teacher-request-class">수업</Label><RequestOption triggerId="teacher-request-class" scope="classes" onPermissionDenied={revoke} label="요청 수업 선택" value={classItem} onChange={setClassItem} disabled={locked} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2"><Label htmlFor="teacher-request-students">학생용 요청</Label><Input id="teacher-request-students" aria-label="학생용 요청 수량" inputMode="numeric" value={studentQuantity} disabled={locked} onChange={event => setStudentQuantity(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="teacher-request-teachers">교사용 요청</Label><Input id="teacher-request-teachers" aria-label="교사용 요청 수량" inputMode="numeric" value={teacherQuantity} disabled={locked} onChange={event => setTeacherQuantity(event.target.value)} /></div>
        </div>
        <div className="grid gap-2"><Label htmlFor="teacher-request-location">위치</Label><RequestOption triggerId="teacher-request-location" scope="locations" onPermissionDenied={revoke} label="요청 위치 선택" value={location} onChange={setLocation} disabled={locked} /></div>
        <div className="grid gap-2"><Label htmlFor="teacher-request-memo">메모</Label><Textarea id="teacher-request-memo" aria-label="요청 메모" value={memo} disabled={locked} onChange={event => setMemo(event.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={locked} onClick={close}>취소</Button><Button type="submit" disabled={pending}>{pending ? "요청 등록 중…" : uncertain ? "저장 결과 확인" : "요청 등록"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    {confirmation}
  </>
}
