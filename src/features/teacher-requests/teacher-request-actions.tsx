"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/providers/auth-provider"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { ScrollableDialogContent } from "@/components/ui/form-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { TeacherOwnRequests } from "./teacher-own-requests"
import { useRequestNavigation } from "./use-request-navigation"
import { useMakeupDirectorSubjects } from "./use-makeup-director-subjects"
import { actionLabels, domainLabels, failureCode, isDefinitiveRequestFailure, originalRequestHref, readRequestChanges, requestFailureMessage, requestStatusLabel, resolveRequestChange,
  type RequestChange, type RequestDomain, type RequestPage, type ResolveAttempt } from "./teacher-request-service"

export function TeacherRequestActions({ domain, onChanged, includeCreate = true }: { domain: RequestDomain; onChanged: () => void; includeCreate?: boolean }) {
  const { user, role } = useAuth()
  const directorSubjects = useMakeupDirectorSubjects(domain === "makeup")
  if (!user?.id || !role) return null
  const scope = `${user.id}:${role}:${domain}`
  if (role === "teacher") return <><TeacherOwnRequests key={scope} domain={domain} actorId={user.id} onChanged={onChanged} includeCreate={includeCreate} />{domain === "makeup" && directorSubjects.length > 0 && <TeacherRequestChangeInbox key={scope + ":director"} domain={domain} />}</>
  if (role === "admin" || role === "staff" || domain === "makeup" && directorSubjects.length > 0) return <TeacherRequestChangeInbox key={scope} domain={domain} />
  return null
}

export function TeacherRequestChangeInbox({ domain }: { domain: RequestDomain }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [reload, setReload] = useState(0)
  const [result, setResult] = useState<RequestPage<RequestChange> | null>(null), [selected, setSelected] = useState<RequestChange | null>(null)
  const [note, setNote] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [permissionLost, setPermissionLost] = useState(false)
  const attempt = useRef<ResolveAttempt | null>(null), inFlight = useRef(false), lifetime = useRef(0), abort = useRef<AbortController | null>(null), opener = useRef<HTMLElement | null>(null)
  const focusArea = useRef<HTMLElement | null>(null), lastRow = useRef<string | null>(null)
  const locked = pending || uncertain
  const blocked = useCallback(() => setError("처리 기록의 저장 결과를 확인한 후 이동해 주세요."), [])
  const navigation = useRequestNavigation(open && Boolean(note), locked, blocked)
  const revoke = useCallback(() => { lifetime.current += 1; abort.current?.abort(); setPermissionLost(true); setResult(null); setSelected(null); setNote(""); setOpen(false); setPending(false); setUncertain(false); attempt.current = null; setError("처리 요청을 확인할 권한 또는 로그인 상태가 변경됐습니다.") }, [])
  useEffect(() => () => { lifetime.current += 1; abort.current?.abort() }, [])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const row = !selected && lastRow.current ? focusArea.current?.querySelector<HTMLButtonElement>(`[data-change-id="${lastRow.current}"]`) : null
      ;(row || focusArea.current)?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selected?.id])
  useEffect(() => {
    if (!open || selected || permissionLost) return
    const controller = new AbortController(), epoch = lifetime.current
    abort.current = controller; setLoading(true); setError("")
    void readRequestChanges(domain, page, controller.signal).then(data => { if (!controller.signal.aborted && epoch === lifetime.current) { setResult(data); const last = Math.max(1, Math.ceil(data.totalCount / 10)); if (page > last) setPage(last) } })
      .catch(error => { if (!controller.signal.aborted && epoch === lifetime.current) { if (failureCode(error) === "42501") revoke(); else { setResult(null); setError("변경·취소 요청을 불러오지 못했습니다.") } } })
      .finally(() => { if (!controller.signal.aborted && epoch === lifetime.current) setLoading(false) })
    return () => controller.abort()
  }, [open, selected, permissionLost, domain, page, reload, revoke])
  function close() { navigation.move(() => { setOpen(false); setSelected(null); setNote(""); setError("") }) }
  async function resolve(resolution: "confirmed" | "rejected" | "noted") {
    if (inFlight.current || !selected) return
    if (resolution === "noted" ? !selected.canRecordProgress : !selected.canResolve) return
    if (!uncertain) {
      if (!note.trim()) { setError("기존 업무에서 확인한 처리 결과나 반려 사유를 입력해 주세요."); return }
      attempt.current = { id: selected.id, resolution, note: note.trim(), revision: selected.revision, requestId: crypto.randomUUID() }
    }
    const submission = attempt.current; if (!submission) return
    inFlight.current = true; const epoch = lifetime.current; setPending(true); setError("")
    try { await resolveRequestChange(submission); if (epoch !== lifetime.current) return; setUncertain(false); attempt.current = null; setSelected(null); setNote(""); setReload(value => value + 1) }
    catch (error) { if (epoch !== lifetime.current) return; if (failureCode(error) === "42501") { revoke(); return }; const definitive = isDefinitiveRequestFailure(error); setUncertain(!definitive); if (definitive) attempt.current = null; setError(requestFailureMessage(error)) }
    finally { if (epoch === lifetime.current) { inFlight.current = false; setPending(false) } }
  }
  const link = selected ? originalRequestHref(selected) : null
  return <><Button type="button" size="sm" variant="outline" disabled={permissionLost} onClick={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true) }}>변경·취소 요청</Button>
    {!open && error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    <Dialog open={open} onOpenChange={value => { if (!value) close() }}><ScrollableDialogContent title={`${domainLabels[domain]} 변경·취소 요청`} description={domain === "makeup" ? "과목 원장의 결정과 관리팀의 처리 경과를 구분해 기록합니다." : "신청자가 남긴 변경·취소 요청과 기존 업무의 처리 결과를 기록합니다."} restoreFocusToOpener onCloseButtonClick={close}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }) } }}
      footer={<div className="flex flex-wrap justify-end gap-2">{selected && <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={locked} onClick={() => navigation.move(() => { setSelected(null); setNote(""); setError("") })}>목록으로</Button>}<Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={locked} onClick={close}>닫기</Button>
        {selected?.status === "pending" && (uncertain ? <Button type="button" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => void resolve(attempt.current!.resolution)}>{pending ? "확인 중…" : "저장 결과 확인"}</Button> : <>{selected.canRecordProgress && <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => void resolve("noted")}>처리 경과 기록</Button>}{selected.canResolve && <><Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => void resolve("rejected")}>반려 기록</Button><Button type="button" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => void resolve("confirmed")}>{pending ? "기록 중…" : domain === "makeup" ? "원장 결정 기록" : "처리 결과 기록"}</Button></>}</>)}</div>}>
      <section ref={focusArea} tabIndex={-1} aria-label={selected ? "변경 요청 상세" : "변경 요청 목록"} className="grid gap-4">{error && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{error}</p>{!locked && <Button type="button" variant="outline" onClick={() => navigation.move(() => { setSelected(null); setNote(""); setReload(value => value + 1) })}>최신 요청 다시 조회</Button>}</div>}
        {!selected ? <>{loading && <p role="status">불러오는 중…</p>}<div className="divide-y">{result?.rows.map(row => <div key={row.id} className="grid gap-1 py-3"><Button data-change-id={row.id} type="button" variant="link" className="h-auto min-h-11 justify-start whitespace-normal p-0 text-left sm:min-h-9" onClick={() => { lastRow.current = row.id; setSelected(row); setNote(""); setError("") }}>{row.title || "신청"} · {actionLabels[row.kind]}</Button><p className="text-sm text-muted-foreground">{row.status === "pending" ? "처리 대기" : row.status === "confirmed" ? domain === "makeup" ? "원장 결정 기록" : "처리 기록 확인" : "반려"} · {row.createdAt.slice(0, 10)}</p></div>)}</div>{!loading && !error && result?.totalCount === 0 && <p role="status">확인할 변경·취소 요청이 없습니다.</p>}<DataTablePagination page={page} pageSize={10} totalCount={result?.totalCount ?? null} loading={loading} onPageChange={setPage} ariaLabel="변경 요청 페이지" /></>
          : <><div><h3 className="break-words font-medium">{selected.title}</h3><p className="text-sm text-muted-foreground">{selected.requestStatus ? requestStatusLabel(selected.requestStatus) : "원본 상태 확인 필요"}</p></div><p className="whitespace-pre-wrap break-words">{selected.note}</p>
            {link && <Button asChild variant="outline" className="justify-self-start"><a href={link} target="_blank" rel="noopener noreferrer">기존 신청 확인 (새 탭)</a></Button>}
            <p className="text-sm text-muted-foreground">{domain === "makeup" ? "관리팀의 경과 기록은 요청을 종결하지 않습니다. 원장 결정 기록도 일정 승인·취소를 실행하지 않으므로 기존 신청에서 별도로 처리해야 합니다." : "기존 업무 화면에서 필요한 처리를 확인한 후 결과를 기록해 주세요. 이 기록은 일정·명단·재고·정산을 바꾸거나 휴보강을 승인하지 않습니다."}</p>
            {selected.progressNotes.length > 0 && <section aria-label="처리 경과"><h4 className="font-medium">처리 경과</h4>{selected.progressNotes.map(item => <p key={item.id} className="whitespace-pre-wrap break-words text-sm">{item.note}</p>)}</section>}
            {selected.status === "pending" ? <div className="grid gap-2"><Label htmlFor="teacher-change-resolution">처리 결과 또는 반려 사유</Label><Textarea id="teacher-change-resolution" aria-label="처리 결과 또는 반려 사유" value={note} maxLength={4000} disabled={locked} onChange={event => setNote(event.target.value)} /></div> : <p className="whitespace-pre-wrap break-words text-sm">처리 기록: {selected.resolutionNote}</p>}</>}
      </section>
    </ScrollableDialogContent></Dialog>{navigation.confirmation}</>
}
