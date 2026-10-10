"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchCombobox, SearchComboboxItem } from "@/components/ui/search-combobox"
import { normalizeRegistrationCaseContact, type RegistrationCaseContactState } from "./registration-contact-client"
import { bindRegistrationStudent, searchRegistrationStudentCandidates } from "./registration-track-service"
import type {
  RegistrationStudentBindingInput,
  RegistrationStudentBindingResult,
  RegistrationStudentCandidate,
  RegistrationStudentCandidatePage,
} from "./registration-student-binding-service"

type Props = {
  taskId: string
  studentName: string
  viewerId: string | null
  viewerRole: "admin" | "staff" | "teacher" | "assistant" | null
  contactState: RegistrationCaseContactState | null
  searchStudents?: typeof searchRegistrationStudentCandidates
  bindStudent?: typeof bindRegistrationStudent
  onBound: (result: RegistrationStudentBindingResult) => void | Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

function studentLabel(student: RegistrationStudentCandidate) {
  return [student.name, student.school, student.grade, student.uid].filter(Boolean).join(" · ")
}

export function RegistrationStudentBinding({
  taskId, viewerId, viewerRole, contactState,
  searchStudents = searchRegistrationStudentCandidates,
  bindStudent = bindRegistrationStudent, onBound, onDirtyChange,
}: Props) {
  const triggerId = useId()
  const canManage = Boolean(viewerId && (viewerRole === "admin" || viewerRole === "staff"))
  let snapshot: RegistrationCaseContactState | null = null
  try {
    // Binding never needs the temporary phone returned by the scoped detail read.
    if (contactState) snapshot = normalizeRegistrationCaseContact({ ...contactState, parentPhone: null }, taskId)
  } catch { /* A missing or malformed snapshot cannot authorize a binding. */ }
  const contextKey = `${taskId}:${viewerId}:${viewerRole}:${snapshot?.generation}:${snapshot?.revision}`
  const contextRef = useRef(contextKey)
  contextRef.current = contextKey
  const mountedRef = useRef(false)
  const intentRef = useRef<{
    contextKey: string; input: RegistrationStudentBindingInput; inFlight: boolean; acknowledged: boolean
  } | null>(null)
  if (intentRef.current?.contextKey !== contextKey) intentRef.current = null
  const statusRef = useRef<HTMLParagraphElement>(null)
  const focusAcknowledgedRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [readEpoch, setReadEpoch] = useState(0)
  const [selected, setSelected] = useState<{ contextKey: string; student: RegistrationStudentCandidate } | null>(null)
  const [attempt, setAttempt] = useState<{
    contextKey: string; input: RegistrationStudentBindingInput; saving: boolean; error: string
  } | null>(null)
  const [acknowledged, setAcknowledged] = useState<{ contextKey: string; result: RegistrationStudentBindingResult } | null>(null)
  const [lookup, setLookup] = useState<{ scope: string; result: RegistrationStudentCandidatePage | null; error: string } | null>(null)
  const selection = selected?.contextKey === contextKey ? selected.student : null
  const pending = attempt?.contextKey === contextKey ? attempt : null
  const bound = Boolean(snapshot?.studentId || acknowledged?.contextKey === contextKey)
  const disabled = !canManage || !snapshot || bound || Boolean(pending)
  const scope = `${contextKey}:${open}:${search}:${page}:${readEpoch}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const accepted = lookup?.scope === scope ? lookup : null

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    setOpen(false)
    setSearch("")
    setPage(1)
    setSelected(null)
    setAttempt(null)
    setAcknowledged(null)
    setLookup(null)
  }, [contextKey])
  useEffect(() => {
    onDirtyChange?.(Boolean(selection && !bound))
  }, [selection, bound, onDirtyChange])
  useEffect(() => {
    if (bound && focusAcknowledgedRef.current && statusRef.current) {
      statusRef.current.focus()
      focusAcknowledgedRef.current = false
    }
  }, [bound, acknowledged, contextKey])
  useEffect(() => {
    if (!open || disabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void searchStudents({ search, page, signal: controller.signal }).then(result => {
        if (!controller.signal.aborted && mountedRef.current && scopeRef.current === scope) {
          setLookup({ scope, result, error: "" })
        }
      }).catch(() => {
        if (!controller.signal.aborted && mountedRef.current && scopeRef.current === scope) {
          setLookup({ scope, result: null, error: "학생 목록을 불러오지 못했습니다." })
        }
      })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, disabled, search, page, scope, searchStudents])

  async function bindSelected() {
    if (!mountedRef.current || contextRef.current !== contextKey || !canManage || !snapshot
      || !selection || bound || pending?.saving || intentRef.current?.inFlight || intentRef.current?.acknowledged) return
    const input = intentRef.current?.input ?? pending?.input ?? {
      taskId, studentId: selection.id, requestKey: crypto.randomUUID(), contactState: snapshot,
    }
    const owner = contextKey
    intentRef.current = { contextKey: owner, input, inFlight: true, acknowledged: false }
    setAttempt({ contextKey: owner, input, saving: true, error: "" })
    setOpen(false)
    try {
      const saved = await bindStudent(input)
      if (!mountedRef.current || contextRef.current !== owner) return
      if (saved.taskId.toLowerCase() !== taskId.toLowerCase()
        || saved.studentId.toLowerCase() !== input.studentId.toLowerCase()
        || saved.contactState.studentId?.toLowerCase() !== input.studentId.toLowerCase()
        || saved.contactState.parentPhone !== null) throw new Error("registration_student_binding_response_invalid")
      intentRef.current = { contextKey: owner, input, inFlight: false, acknowledged: true }
      setAcknowledged({ contextKey: owner, result: saved })
      focusAcknowledgedRef.current = true
      setAttempt(null)
      setSelected(null)
      onDirtyChange?.(false)
      try { await onBound(saved) } catch {
        // Acknowledged binding is kept; a failed refresh never causes resubmission.
      }
    } catch {
      if (mountedRef.current && contextRef.current === owner) {
        intentRef.current = { contextKey: owner, input, inFlight: false, acknowledged: false }
        setAttempt({ contextKey: owner, input, saving: false, error: "학생을 연결하지 못했습니다. 같은 학생으로 다시 시도하세요." })
      }
    }
  }

  if (!canManage) return null
  if (bound) return <p ref={statusRef} tabIndex={-1} role="status" className="text-sm">학생 연결 완료</p>
  const result = accepted?.result
  return (
    <div data-registration-student-binding="" className="grid min-w-0 gap-1.5">
      <Label htmlFor={triggerId}>학생</Label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <SearchCombobox
          triggerId={triggerId}
          triggerAriaLabel="등록 학생 선택"
          triggerLabel={selection ? studentLabel(selection) : "학생 선택"}
          triggerPlaceholder={!selection}
          triggerClassName="h-11 min-w-0 sm:h-9 sm:w-auto sm:flex-1 sm:shrink"
          open={open && !disabled}
          onOpenChange={setOpen}
          searchValue={search}
          onSearchValueChange={value => { setSearch(value); setPage(1) }}
          searchPlaceholder="이름·학교·학년 검색"
          searchAriaLabel="등록 학생 검색"
          selectedValue={selection?.id}
          listAriaLabel="등록 학생 후보"
          disabled={disabled}
          loading={!accepted}
          emptyMessage={accepted?.error || (
            <div className="grid justify-items-center gap-1.5">
              <span>검색 결과가 없습니다.</span>
              <Button asChild type="button" variant="ghost" size="form">
                <a href="/admin/students" target="_blank" rel="noopener noreferrer" aria-label="학생관리 새 탭에서 열기">학생관리</a>
              </Button>
            </div>
          )}
          footer={accepted?.error ? (
            <Button type="button" variant="ghost" size="form" onClick={() => setReadEpoch(value => value + 1)}>다시 불러오기</Button>
          ) : result?.totalCount === 0 ? (
            <Button type="button" variant="ghost" size="form" onClick={() => setReadEpoch(value => value + 1)}>다시 불러오기</Button>
          ) : result ? (
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="form" disabled={page === 1} onClick={() => setPage(value => value - 1)}>이전</Button>
              <span className="text-xs text-muted-foreground">{page}페이지</span>
              <Button type="button" variant="ghost" size="form" disabled={page * result.pageSize >= result.totalCount} onClick={() => setPage(value => value + 1)}>다음</Button>
            </div>
          ) : undefined}
        >
          {result?.rows.map(student => (
            <SearchComboboxItem
              key={student.id} value={student.id}
              onSelect={() => {
                if (scopeRef.current !== scope || contextRef.current !== contextKey || disabled) return
                setSelected({ contextKey, student }); setOpen(false)
              }}
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="break-words">{student.name}</span>
                <span className="break-words text-xs text-muted-foreground">{[student.school, student.grade, student.uid].filter(Boolean).join(" · ")}</span>
              </div>
            </SearchComboboxItem>
          ))}
        </SearchCombobox>
        <Button type="button" size="form" disabled={!snapshot || !selection || Boolean(pending?.saving)} onClick={() => void bindSelected()}>
          {pending?.saving ? "학생 연결 중" : "학생 연결"}
        </Button>
      </div>
      {!snapshot ? <p role="alert" className="text-sm text-destructive">등록 정보를 다시 불러온 뒤 학생을 연결하세요.</p> : null}
      {pending?.error ? <p role="alert" className="text-sm text-destructive">{pending.error}</p> : null}
    </div>
  )
}
