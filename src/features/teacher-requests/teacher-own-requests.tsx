"use client"
import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { ScrollableDialogContent } from "@/components/ui/form-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { isoToSeoulDateTimeInput } from "@/features/tasks/ops-task-service"
import { TeacherRequestFields, blankRequestInput, type TeacherRequestFieldProps } from "./teacher-request-fields"
import { useRequestNavigation } from "./use-request-navigation"
import { actionLabels, domainLabels, failureCode, isDefinitiveRequestFailure, mutateOwnRequest, readOwnRequest, readOwnRequests, readRequestReferences, requestFailureMessage, requestStatusLabel, teacherWithdrawalHoursDisplay,
  type MakeupSlot, type OwnRequest, type OwnRequestDetail, type RequestAction, type RequestAttempt, type RequestDomain, type RequestInput, type RequestPage, type RequestReferences } from "./teacher-request-service"

function currentMonth() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()) }
const dateLabel = (value: string | null) => value?.slice(0, 10) || "—"
export function TeacherOwnRequests({ domain, actorId, onChanged, includeCreate = true, Fields = TeacherRequestFields }: { Fields?: ComponentType<TeacherRequestFieldProps>; domain: RequestDomain; actorId: string; onChanged: () => void; includeCreate?: boolean }) {
  const [open, setOpen] = useState(false), [stage, setStage] = useState<"list" | "detail" | "form" | "action">("list")
  const [page, setPage] = useState(1), [reload, setReload] = useState(0)
  const [list, setList] = useState<RequestPage<OwnRequest> | null>(null), [detail, setDetail] = useState<OwnRequestDetail | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("")
  const [permissionLost, setPermissionLost] = useState(false), [saved, setSaved] = useState("")
  const [action, setAction] = useState<RequestAction>("create"), [input, setInput] = useState<RequestInput>(() => blankRequestInput(domain)), [baseline, setBaseline] = useState("")
  const [note, setNote] = useState(""), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false)
  const [referenceState, setReferenceState] = useState<{ key: string; data: RequestReferences | null; loading: boolean; error: boolean } | null>(null), [referenceRetry, setReferenceRetry] = useState(0)
  const [fieldsReady, setFieldsReady] = useState(Fields === TeacherRequestFields)
  const [month, setMonth] = useState(currentMonth)
  const formId = useId(), heading = useRef<HTMLElement | null>(null), opener = useRef<HTMLElement | null>(null)
  const lastRow = useRef<string | null>(null)
  const attempt = useRef<RequestAttempt | null>(null), inFlight = useRef(false), lifetime = useRef(0), sequence = useRef(0), listAbort = useRef<AbortController | null>(null), detailAbort = useRef<AbortController | null>(null), referenceAbort = useRef<AbortController | null>(null)
  const locked = pending || uncertain
  const dirty = open && (stage === "form" ? JSON.stringify(input) !== baseline : stage === "action" && Boolean(note))
  const blocked = useCallback(() => setError("저장 결과를 확인한 후 이동해 주세요."), [])
  const navigation = useRequestNavigation(dirty, locked, blocked)
  const revoke = useCallback(() => {
    lifetime.current += 1; sequence.current += 1
    listAbort.current?.abort(); detailAbort.current?.abort(); referenceAbort.current?.abort()
    attempt.current = null; inFlight.current = false
    setList(null); setDetail(null); setSelectedId(null); setReferenceState(null); setInput(blankRequestInput(domain)); setNote(""); setPending(false); setUncertain(false); setOpen(false); setSaved(""); setPermissionLost(true)
    setError("신청 권한 또는 로그인 상태가 변경됐습니다. 화면을 다시 확인해 주세요.")
  }, [domain])
  useEffect(() => () => { lifetime.current += 1; sequence.current += 1; listAbort.current?.abort(); detailAbort.current?.abort(); referenceAbort.current?.abort() }, [])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const row = stage === "list" && lastRow.current ? heading.current?.querySelector<HTMLButtonElement>(`[data-request-id="${lastRow.current}"]`) : null
      ;(row || heading.current)?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, stage])
  useEffect(() => {
    if (!open || stage !== "list" || permissionLost) return
    const controller = new AbortController(), epoch = lifetime.current
    listAbort.current = controller; setLoading(true); setError("")
    void readOwnRequests(domain, actorId, page, controller.signal).then(result => {
      if (controller.signal.aborted || epoch !== lifetime.current) return
      setList(result); const last = Math.max(1, Math.ceil(result.totalCount / 10)); if (page > last) setPage(last)
    }).catch(error => { if (!controller.signal.aborted && epoch === lifetime.current) { if (failureCode(error) === "42501") revoke(); else { setList(null); setError("내 신청 목록을 불러오지 못했습니다.") } } })
      .finally(() => { if (!controller.signal.aborted && epoch === lifetime.current) setLoading(false) })
    return () => controller.abort()
  }, [open, stage, domain, actorId, page, reload, permissionLost, revoke])
  const selectedClass = domain === "transfer" ? input.from_class_id : input.class_id
  const classId = typeof selectedClass === "string" && selectedClass ? selectedClass : null
  const needsReferences = domain !== "textbook" && (domain === "makeup" || action === "create")
  const referenceMonth = domain === "makeup" ? month : ""
  const referenceKey = `${domain}:${classId || ""}:${referenceMonth}`
  const currentReferences = referenceState?.key === referenceKey ? referenceState : null
  const references = needsReferences && classId ? currentReferences?.data || null : null
  const referenceLoading = Boolean(needsReferences && classId && (!currentReferences || currentReferences.loading))
  const referenceError = Boolean(needsReferences && classId && currentReferences?.error)
  const referenceBlocked = !fieldsReady || needsReferences && (!classId || referenceLoading || referenceError || !references)
  useEffect(() => {
    if (!open || stage !== "form" || !needsReferences || !classId || permissionLost) return
    const controller = new AbortController(), epoch = lifetime.current
    referenceAbort.current = controller; setReferenceState({ key: referenceKey, data: null, loading: true, error: false })
    void readRequestReferences(domain, classId, referenceMonth, controller.signal).then(result => {
      if (!controller.signal.aborted && epoch === lifetime.current) setReferenceState({ key: referenceKey, data: result, loading: false, error: false })
    }).catch(error => { if (!controller.signal.aborted && epoch === lifetime.current) { if (failureCode(error) === "42501") revoke(); else setReferenceState({ key: referenceKey, data: null, loading: false, error: true }) } })
    return () => controller.abort()
  }, [open, stage, domain, classId, referenceMonth, referenceKey, needsReferences, referenceRetry, permissionLost, revoke])
  async function loadDetail(id: string) {
    lastRow.current = id
    detailAbort.current?.abort(); const controller = new AbortController(), token = ++sequence.current, epoch = lifetime.current
    detailAbort.current = controller; setSelectedId(id); setDetail(null); setStage("detail"); setLoading(true); setError("")
    try { const result = await readOwnRequest(domain, actorId, id, controller.signal); if (!controller.signal.aborted && token === sequence.current && epoch === lifetime.current) setDetail(result) }
    catch (error) { if (!controller.signal.aborted && token === sequence.current && epoch === lifetime.current) { if (failureCode(error) === "42501") revoke(); else setError("신청 상세를 불러오지 못했습니다.") } }
    finally { if (!controller.signal.aborted && token === sequence.current && epoch === lifetime.current) setLoading(false) }
  }
  function enterForm(record: OwnRequestDetail | null) {
    if (record && (!record.input || !record.allowedActions.includes("update"))) return
    const next = record?.input ? structuredClone(record.input) : blankRequestInput(domain)
    referenceAbort.current?.abort(); setReferenceState(null)
    setFieldsReady(Fields === TeacherRequestFields)
    setInput(next); setBaseline(JSON.stringify(next)); setAction(record ? "update" : "create"); setStage("form"); setError(""); setSaved(""); setUncertain(false); attempt.current = null
    setMonth(typeof next.cancel_date === "string" ? next.cancel_date.slice(0, 7) : currentMonth())
  }
  function begin(create: boolean) { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSaved(""); setError(""); setOpen(true); setDetail(null); setSelectedId(null); if (create) enterForm(null); else setStage("list") }
  function close() { navigation.move(() => { sequence.current += 1; detailAbort.current?.abort(); setOpen(false); setDetail(null); setInput(blankRequestInput(domain)); setNote(""); setError("") }) }
  function back() { navigation.move(() => { setError(""); setNote(""); if (stage === "form" || stage === "action") { if (detail) setStage("detail"); else setStage("list") } else { sequence.current += 1; detailAbort.current?.abort(); setDetail(null); setSelectedId(null); setStage("list") } }) }
  function selectAction(next: RequestAction) { if (!detail?.allowedActions.includes(next as Exclude<RequestAction, "create">)) return; setAction(next); setNote(""); setError(""); setStage("action") }
  async function submit() {
    if (inFlight.current) return
    if (!uncertain) {
      if (action !== "create" && (!detail || !detail.allowedActions.includes(action))) return
      if (stage === "form" && referenceBlocked) { setError("수업을 선택하고 선택 항목을 불러온 후 다시 진행해 주세요."); return }
      if (stage === "action" && !note.trim()) { setError("요청 사유를 입력해 주세요."); return }
      attempt.current = { domain, id: action === "create" ? null : detail!.id, action, input: structuredClone(stage === "action" ? { note: note.trim() } : input), revision: action === "create" ? null : detail!.revision, requestId: crypto.randomUUID() }
    }
    const submission = attempt.current; if (!submission) return
    inFlight.current = true; const epoch = lifetime.current
    setPending(true); setError("")
    try {
      const result = await mutateOwnRequest(actorId, submission)
      if (epoch !== lifetime.current) return
      attempt.current = null; setUncertain(false); setNote(""); setBaseline(JSON.stringify(input)); setSaved(`${actionLabels[submission.action]} 결과를 확인했습니다.`); onChanged(); setReload(value => value + 1)
      await loadDetail(result.id)
    } catch (error) {
      if (epoch !== lifetime.current) return
      if (failureCode(error) === "42501") { revoke(); return }
      const definitive = isDefinitiveRequestFailure(error)
      setUncertain(!definitive); if (definitive) attempt.current = null
      setError(requestFailureMessage(error))
    } finally { if (epoch === lifetime.current) { inFlight.current = false; setPending(false) } }
  }
  const title = stage === "list" ? `내 ${domainLabels[domain]} 신청` : stage === "form" ? `${domainLabels[domain]} ${action === "create" ? "신청" : "신청 수정"}` : stage === "action" ? actionLabels[action] : `${domainLabels[domain]} 신청 상세`
  return <>
    <Button type="button" variant="outline" size="sm" disabled={permissionLost} onClick={() => begin(false)}>내 신청</Button>
    {includeCreate && <Button type="button" size="sm" disabled={permissionLost} onClick={() => begin(true)}><Plus className="size-4" aria-hidden="true" />추가</Button>}
    {!open && error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    <Dialog open={open} onOpenChange={value => { if (!value) close() }}><ScrollableDialogContent className={stage === "form" ? domain === "transfer" ? "sm:max-w-5xl xl:max-w-6xl" : domain === "makeup" ? "sm:max-w-4xl" : domain === "withdrawal" ? "sm:max-w-3xl" : undefined : undefined} title={title} description={`${domainLabels[domain]} 본인 신청의 내용과 처리 이력을 확인합니다.`} restoreFocusToOpener
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }) } }} onCloseButtonClick={close}
      footer={<div className="flex flex-wrap justify-end gap-2">{stage !== "list" && <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={locked} onClick={back}>목록·상세로 돌아가기</Button>}<Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={locked} onClick={close}>닫기</Button>
        {(stage === "form" || stage === "action") && <Button type="submit" form={formId} className="min-h-11 sm:min-h-9" disabled={pending || !uncertain && stage === "form" && referenceBlocked}>{pending ? "처리 중…" : uncertain ? "저장 결과 확인" : actionLabels[action]}</Button>}</div>}>
      <section ref={heading} tabIndex={-1} aria-label={title} className="grid min-w-0 gap-4">
        {saved && <p role="status" className="text-sm">{saved}</p>}
        {error && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error}</p>{!locked && <Button type="button" variant="outline" className="justify-self-start" onClick={() => navigation.move(() => { if (selectedId) void loadDetail(selectedId); else setReload(value => value + 1) })}>{selectedId ? "최신 신청 확인" : "다시 조회"}</Button>}</div>}
        {loading && (stage === "list" || stage === "detail") && <p role="status">불러오는 중…</p>}
        {stage === "list" && <><div className="divide-y">{list?.rows.map(row => <div key={row.id} className="grid gap-1 py-3"><Button data-request-id={row.id} type="button" variant="link" className="h-auto min-h-11 justify-start whitespace-normal p-0 text-left sm:min-h-9" onClick={() => void loadDetail(row.id)}>{row.title || `${domainLabels[domain]} 신청`}</Button><p className="text-sm text-muted-foreground">{requestStatusLabel(row.status)} · {dateLabel(row.createdAt)}</p></div>)}</div>
          {!loading && !error && list?.totalCount === 0 && <p role="status">등록한 신청이 없습니다.</p>}<DataTablePagination page={page} pageSize={10} totalCount={list?.totalCount ?? null} loading={loading} onPageChange={setPage} ariaLabel="내 신청 페이지" /></>}
        {stage === "detail" && detail && <><div><h3 className="break-words font-medium">{detail.title}</h3><p className="text-sm text-muted-foreground">{requestStatusLabel(detail.status)} · {dateLabel(detail.createdAt)}</p></div>
          {detail.blockedReason && <p className="text-sm">{detail.blockedReason}</p>}
          {detail.input ? <RequestInputSummary domain={domain} input={detail.input} labels={detail.referenceLabels} /> : <p className="text-sm text-muted-foreground">이전 신청의 원문을 확인할 수 없습니다. 필요한 변경 내용을 요청 사유에 남겨 주세요.</p>}
          {detail.approver && <p className="text-sm">승인: 해당 과목 원장 · 기존 지정: {detail.approver.label || "확인 필요"}</p>}
          <div className="flex flex-wrap gap-2">{detail.allowedActions.includes("update") && <Button type="button" onClick={() => enterForm(detail)}>신청 수정</Button>}{detail.allowedActions.filter(value => value !== "update").map(value => <Button type="button" variant="outline" key={value} onClick={() => selectAction(value)}>{actionLabels[value]}</Button>)}</div>
          {detail.changes.map(change => <div className="grid gap-1 border-t pt-3 text-sm" key={change.id}><p className="font-medium">{actionLabels[change.kind]} · {change.status === "pending" ? "처리 대기" : change.status === "confirmed" ? (domain === "makeup" ? "원장 결정 기록" : "처리 기록 확인") : "반려"}</p><p className="whitespace-pre-wrap break-words">{change.note}</p>{change.resolutionNote && <p className="whitespace-pre-wrap break-words">{domain === "makeup" ? "원장 결정" : "처리 기록"}: {change.resolutionNote}</p>}</div>)}
          <details><summary className="cursor-pointer text-sm">신청 이력</summary><ol className="mt-3 grid gap-2 text-sm">{detail.history.map(event => <li key={event.id}>{dateLabel(event.createdAt)} · {actionLabels[event.action as RequestAction] || (event.action === "confirmed" ? (domain === "makeup" ? "원장 결정 기록" : "처리 기록 확인") : event.action === "rejected" ? "반려" : event.action === "noted" ? "관리팀 경과 기록" : "이력")} {event.note && <p className="whitespace-pre-wrap break-words text-muted-foreground">{event.note}</p>}</li>)}</ol></details></>}
        {(stage === "form" || stage === "action") && <form id={formId} onSubmit={event => { event.preventDefault(); void submit() }} className="grid gap-4">
          {stage === "form" ? <>{referenceLoading && <p role="status">선택 항목을 불러오는 중…</p>}{referenceError && <div role="alert" className="grid gap-2"><p>선택 항목을 불러오지 못했습니다. 입력은 유지됩니다.</p><Button type="button" variant="outline" onClick={() => setReferenceRetry(value => value + 1)}>선택 항목 다시 조회</Button></div>}
            <Fields key={`${action}:${detail?.id || "new"}`} domain={domain} input={input} onChange={setInput} editing={action === "update"} labels={detail?.referenceLabels || {}} approver={detail?.approver} references={references} disabled={locked} month={month} onMonthChange={setMonth} onPermissionDenied={revoke} onReadyChange={setFieldsReady} /></>
            : <><p className="text-sm text-muted-foreground">{action === "withdraw" ? "신청은 철회되며 원문과 이력은 남습니다." : "요청은 담당자에게 접수됩니다. 원래 신청의 일정·명단·교재·정산은 즉시 변경되지 않습니다."}</p><Label htmlFor={`${formId}-note`}>요청 사유</Label><Textarea id={`${formId}-note`} aria-label="요청 사유" value={note} maxLength={4000} required disabled={locked} onChange={event => setNote(event.target.value)} /></>}
        </form>}
      </section>
    </ScrollableDialogContent></Dialog>{navigation.confirmation}
  </>
}

const inputLabels: Record<string, string> = { title: "교재명", memo: "메모", student_id: "학생", class_id: "수업", classId: "수업", from_class_id: "전 수업", to_class_id: "후 수업", textbookId: "등록 교재", locationId: "위치", studentQuantity: "학생용 수량", teacherQuantity: "교사용 수량", transfer_reason: "전반 사유", from_class_end_date: "전 수업 종료일", from_class_end_session: "전 수업 종료 회차", to_class_start_date: "후 수업 시작일", to_class_start_session: "후 수업 시작 회차", from_undistributed_textbooks: "전 수업 미배부 교재", to_undistributed_textbooks: "후 수업 미배부 교재", withdrawal_date: "퇴원일", withdrawal_session: "퇴원 회차", customer_reason: "고객 사유", teacher_opinion: "선생님 의견", undistributed_textbooks: "미배부 교재", request_kind: "종류", reason: "휴보강 사유", cancel_date: "휴강일" }
function RequestInputSummary({ domain, input, labels }: { domain: RequestDomain; input: RequestInput; labels: OwnRequestDetail["referenceLabels"] }) {
  const references: Record<string, string | undefined> = { student_id: labels.student, class_id: labels.class, classId: labels.class, from_class_id: labels.fromClass, to_class_id: labels.toClass, textbookId: labels.textbook, locationId: labels.location }
  const hours = teacherWithdrawalHoursDisplay(input)
  return <dl className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">{Object.entries(input).flatMap(([key, value]) => {
    if (domain === "withdrawal" && (key === "completed_lesson_hours" || key === "four_week_lesson_hours")) return []
    if (key === "original_lesson_session_id") return []
    if (key === "makeup_slots") return (value as MakeupSlot[]).map((slot, index) => <div key={`${key}-${index}`} className="col-span-2 grid gap-1"><dt>보강 {index + 1}</dt><dd className="break-words">{isoToSeoulDateTimeInput(slot.startAt).replace("T", " ")} – {isoToSeoulDateTimeInput(slot.endAt).replace("T", " ")} · {slot.classroom}</dd></div>)
    const display = key in references ? references[key] || (value ? "기존 선택 항목" : "—") : key === "request_kind" ? ({ cancel_makeup: "휴강 및 보강", cancel_only: "휴강", makeup_only: "보강" } as Record<string, string>)[String(value)] : value === null || value === "" ? "—" : String(value)
    return [<div key={key} className="contents"><dt className="text-muted-foreground">{inputLabels[key] || "신청 항목"}</dt><dd className="whitespace-pre-wrap break-words">{display}</dd></div>]
  })}{domain === "withdrawal" && [["진행 수업시수", hours.completed], ["4주 기준 수업시수", hours.total], ["수업진행률", hours.progress]].map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
}
