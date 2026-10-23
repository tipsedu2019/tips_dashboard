"use client"

import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchCombobox, SearchComboboxItem } from "@/components/ui/search-combobox"
import { useDraftNavigation } from "@/hooks/use-draft-navigation"
import { isNumberedPagePermissionError } from "@/lib/numbered-page-controller"
import { readTeacherTextbookRequestOptions, submitTeacherTextbookRequest, type TeacherBookOption, type TeacherBookOptionScope } from "./teacher-textbook-request-submit"

function RequestOption({ scope, label, value, onChange, disabled }: {
  scope: TeacherBookOptionScope; label: string; value: TeacherBookOption | null
  onChange: (value: TeacherBookOption | null) => void; disabled: boolean
}) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(search)
  const [result, setResult] = useState<{ rows: TeacherBookOption[]; totalCount: number } | null>(null)
  const [error, setError] = useState(false), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(false); setResult(null)
    void readTeacherTextbookRequestOptions({ scope, search: deferredSearch, page }, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, deferredSearch, page, scope, retry])
  return <SearchCombobox open={open && !disabled} onOpenChange={setOpen} triggerLabel={value?.label || "선택 안 함"}
    triggerAriaLabel={label} searchValue={search} onSearchValueChange={value => { setSearch(value); setPage(1) }}
    searchPlaceholder={`${label} 검색`} searchAriaLabel={`${label} 검색`} selectedValue={value?.id || ""}
    disabled={disabled} loading={loading} emptyMessage={error ? <Button type="button" variant="ghost" onClick={() => setRetry(value => value + 1)}>다시 조회</Button> : "검색 결과 없음"}
    footer={<div className="flex items-center justify-between gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => { onChange(null); setOpen(false) }}>선택 해제</Button><div className="flex gap-1"><Button type="button" size="sm" variant="ghost" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>이전</Button><Button type="button" size="sm" variant="ghost" disabled={loading || !result || page * 15 >= result.totalCount} onClick={() => setPage(value => value + 1)}>다음</Button></div></div>}>
    {result?.rows.map(option => <SearchComboboxItem key={option.id} value={option.id} onSelect={() => { onChange(option); setOpen(false) }}>{option.label}</SearchComboboxItem>)}
  </SearchCombobox>
}

export function TeacherTextbookRequestCreate({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false), [title, setTitle] = useState(""), [memo, setMemo] = useState("")
  const [studentQuantity, setStudentQuantity] = useState(""), [teacherQuantity, setTeacherQuantity] = useState("")
  const [book, setBook] = useState<TeacherBookOption | null>(null), [classItem, setClassItem] = useState<TeacherBookOption | null>(null), [location, setLocation] = useState<TeacherBookOption | null>(null)
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false)
  const inFlight = useRef(false), mounted = useRef(true)
  const request = useRef<{ id: string; input: Parameters<typeof submitTeacherTextbookRequest>[1] } | null>(null)
  const dirty = Boolean(title || memo || studentQuantity || teacherQuantity || book || classItem || location)
  const { requestLocalAction, confirmation } = useDraftNavigation({ dirty: open && dirty })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const locked = pending || uncertain
  function clear() {
    setTitle(""); setMemo(""); setStudentQuantity(""); setTeacherQuantity("")
    setBook(null); setClassItem(null); setLocation(null); setError(""); setUncertain(false); request.current = null
  }
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
      await submitTeacherTextbookRequest(submission.id, submission.input)
      if (!mounted.current) return
      clear(); setOpen(false); setSaved(true); onSaved()
    } catch (failure) {
      if (!mounted.current) return
      const deterministic = isNumberedPagePermissionError(failure) || (failure && typeof failure === "object" && "code" in failure && ["22023", "22P02", "23503"].includes(String(failure.code)))
      setUncertain(!deterministic)
      setError(deterministic ? "요청을 저장하지 못했습니다. 입력값과 로그인 권한을 확인해 주세요." : "저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 다시 확인해 주세요.")
    } finally { inFlight.current = false; if (mounted.current) setPending(false) }
  }
  return <>
    <Button onClick={() => { setSaved(false); setOpen(true) }}>요청 추가</Button>
    {saved && <span role="status" className="text-sm text-muted-foreground">교재 요청을 등록했습니다.</span>}
    <Dialog open={open} onOpenChange={value => { if (!value) close() }}><DialogContent aria-describedby={undefined} restoreFocusToOpener className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>교재 요청</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-2"><Label>등록 교재 (선택)</Label><RequestOption scope="textbooks" label="등록 교재 선택" value={book} disabled={locked} onChange={value => { setBook(value); if (value) setTitle(value.label) }} /></div>
        <div className="grid gap-2"><Label htmlFor="teacher-request-title">교재명</Label><Input id="teacher-request-title" aria-label="요청 교재명" value={title} disabled={locked} onChange={event => { setTitle(event.target.value); setBook(null) }} /></div>
        <div className="grid gap-2"><Label>수업 (선택)</Label><RequestOption scope="classes" label="요청 수업 선택" value={classItem} onChange={setClassItem} disabled={locked} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2"><Label htmlFor="teacher-request-students">학생용 요청</Label><Input id="teacher-request-students" aria-label="학생용 요청 수량" inputMode="numeric" value={studentQuantity} disabled={locked} onChange={event => setStudentQuantity(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="teacher-request-teachers">교사용 요청</Label><Input id="teacher-request-teachers" aria-label="교사용 요청 수량" inputMode="numeric" value={teacherQuantity} disabled={locked} onChange={event => setTeacherQuantity(event.target.value)} /></div>
        </div>
        <div className="grid gap-2"><Label>위치 (선택)</Label><RequestOption scope="locations" label="요청 위치 선택" value={location} onChange={setLocation} disabled={locked} /></div>
        <div className="grid gap-2"><Label htmlFor="teacher-request-memo">메모</Label><Textarea id="teacher-request-memo" aria-label="요청 메모" value={memo} disabled={locked} onChange={event => setMemo(event.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={locked} onClick={close}>취소</Button><Button type="submit" disabled={pending}>{pending ? "요청 등록 중…" : uncertain ? "저장 결과 확인" : "요청 등록"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    {confirmation}
  </>
}
