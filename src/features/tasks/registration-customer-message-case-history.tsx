"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { MessageSquare, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import type { RegistrationCustomerMessageClient, RegistrationCustomerMessageDeliveryResult, RegistrationCustomerMessageTarget } from "./registration-customer-message-contract"
import type { RegistrationCaseCustomerMessageHistory } from "./registration-customer-message-case-history-contract"
import { formatRegistrationMessageTimestamp, REGISTRATION_CUSTOMER_MESSAGE_LABELS, registrationCustomerMessageStatusLabel } from "./registration-customer-message-labels"

type Props = Readonly<{ taskId: string; client: RegistrationCustomerMessageClient; refreshKey?: string; viewerKey?: string; onOpenPreview?: (target: RegistrationCustomerMessageTarget) => void }>

export function RegistrationCustomerMessageCaseHistory(props: Props) {
  return <CaseHistory key={`${props.taskId}:${props.viewerKey || ""}`} {...props} />
}

function CaseHistory({ taskId, client, refreshKey, onOpenPreview }: Props) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 15 | 20>(10)
  const [refresh, setRefresh] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const transition = useRef({ active: true, pending: null as RegistrationCustomerMessageTarget | null, onOpenPreview })
  useLayoutEffect(() => {
    transition.current.onOpenPreview = onOpenPreview
    if (!onOpenPreview) transition.current.pending = null
  }, [onOpenPreview])
  useEffect(() => {
    const state = transition.current
    state.active = true
    return () => { state.active = false; state.pending = null }
  }, [])

  function requestPreview(target: RegistrationCustomerMessageTarget) {
    const state = transition.current
    if (!state.active || !state.onOpenPreview || state.pending || target.messageKind !== "admission_application" || target.sourceId !== taskId) return
    state.pending = target
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { transition.current.pending = null; setOpen(next); if (next) setPage(1) }}>
      <DialogTrigger asChild><Button ref={triggerRef} type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9"><MessageSquare className="size-4" /><span>발송 이력</span></Button></DialogTrigger>
      <DialogContent className="z-[90] flex max-h-[85dvh] flex-col sm:max-w-2xl" overlayClassName="z-[90]" closeButtonLabel="발송 이력 닫기"
        onCloseAutoFocus={(event) => {
          const state = transition.current
          const target = state.pending
          state.pending = null
          if (!state.active || !state.onOpenPreview || !target || target.sourceId !== taskId || target.messageKind !== "admission_application") return
          // The row unmounts with the history dialog. Use its persistent trigger
          // as the return destination before opening the existing preview.
          event.preventDefault()
          triggerRef.current?.focus({ preventScroll: true })
          state.onOpenPreview(target)
        }}>
        <DialogHeader><DialogTitle>발송 이력</DialogTitle><DialogDescription>이 등록 건의 전체 안내 · 취소된 예약 포함</DialogDescription></DialogHeader>
        {open ? <CaseHistoryPage taskId={taskId} client={client} page={page} pageSize={pageSize} refreshKey={`${refresh}:${refreshKey || ""}`}
          onRefresh={() => setRefresh((value) => value + 1)} onPageChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1) }} onOpenPreview={onOpenPreview ? requestPreview : undefined} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function CaseHistoryPage({ taskId, client, page, pageSize, refreshKey, onRefresh, onPageChange, onPageSizeChange, onOpenPreview }: Props & {
  page: number; pageSize: 10 | 15 | 20; onRefresh: () => void; onPageChange: (value: number) => void; onPageSizeChange: (value: 10 | 15 | 20) => void
}) {
  const requestScope = `${taskId}:${page}:${pageSize}:${refreshKey || ""}`
  const [result, setResult] = useState<{ scope: string; data?: RegistrationCaseCustomerMessageHistory; error?: string } | null>(null)
  const data = result?.scope === requestScope ? result.data : null
  const error = result?.scope === requestScope ? result.error : ""
  const [deliveryResults, setDeliveryResults] = useState<Record<string, RegistrationCustomerMessageDeliveryResult | "error">>({})
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState<string | null>(null)
  const active = useRef(true)
  const checkingRef = useRef<string | null>(null)
  const deliveryAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    setChecking(null)
    checkingRef.current = null
    setDeliveryResults({})
    setCheckErrors({})
    void (async () => {
      try {
        if (!client.listCaseHistory) throw new Error("unavailable")
        const result = await client.listCaseHistory({ taskId, page, pageSize }, controller.signal)
        if (!controller.signal.aborted) setResult({ scope: requestScope, data: result })
      } catch {
        if (!controller.signal.aborted) setResult({ scope: requestScope, error: "발송 이력을 불러오지 못했습니다." })
      }
    })()
    return () => { active.current = false; controller.abort(); deliveryAbort.current?.abort(); deliveryAbort.current = null }
  }, [client, taskId, page, pageSize, requestScope])

  async function checkReceipt(messageId: string) {
    if (checkingRef.current || !data?.history.some((item) => item.messageId === messageId && item.canCheck)) return
    checkingRef.current = messageId
    setChecking(messageId)
    setCheckErrors((previous) => ({ ...previous, [messageId]: "" }))
    // Keep stored receipt identity and discard late results, including clients
    // whose transport cannot cancel a request that has already started.
    const controller = new AbortController()
    deliveryAbort.current = controller
    try {
      const result = await client.check({ messageId }, controller.signal)
      if (!active.current || controller.signal.aborted) return
      if (result.messageId !== messageId || !["accepted", "failed_hold"].includes(result.currentStatus)) {
        throw new Error("result unavailable")
      }
      onRefresh()
    } catch {
      if (active.current && !controller.signal.aborted) {
        setCheckErrors((previous) => ({ ...previous, [messageId]: "발송 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." }))
      }
    } finally {
      if (deliveryAbort.current === controller) {
        checkingRef.current = null
        deliveryAbort.current = null
        if (active.current && !controller.signal.aborted) setChecking(null)
      }
    }
  }

  async function checkDelivery(messageId: string) {
    if (!client.checkDelivery || checkingRef.current) return
    checkingRef.current = messageId
    setChecking(messageId)
    const controller = new AbortController()
    deliveryAbort.current = controller
    try {
      const result = await client.checkDelivery({ messageId }, controller.signal)
      if (active.current && !controller.signal.aborted) setDeliveryResults((previous) => ({ ...previous, [messageId]: result }))
    } catch {
      if (active.current && !controller.signal.aborted) setDeliveryResults((previous) => ({ ...previous, [messageId]: "error" }))
    } finally {
      if (deliveryAbort.current === controller) {
        checkingRef.current = null
        deliveryAbort.current = null
        if (active.current && !controller.signal.aborted) setChecking(null)
      }
    }
  }

  const loading = !data && !error
  function previewCurrentAdmission(messageId: string) {
    if (!active.current || checkingRef.current || !onOpenPreview || !data?.history.some((item) => item.messageId === messageId && item.messageKind === "admission_application")) return
    onOpenPreview({ messageKind: "admission_application", sourceId: taskId })
  }
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex justify-end"><Button variant="ghost" size="sm" disabled={Boolean(checking)} onClick={onRefresh}><RefreshCw className="size-4" />새로고침</Button></div>
      <div className="min-h-0 overflow-y-auto rounded-md border" aria-busy={loading}>
        {loading ? <p role="status" className="p-6 text-sm text-muted-foreground">발송 이력 불러오는 중…</p> : null}
        {error ? <p role="alert" className="p-6 text-sm text-destructive">{error}</p> : null}
        {data?.history.length === 0 ? <p className="p-6 text-sm text-muted-foreground">발송 요청 이력이 없습니다.</p> : null}
        <ul className="divide-y">
          {data?.history.map((item) => {
            const delivery = deliveryResults[item.messageId]
            return (
              <li key={item.messageId} className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{REGISTRATION_CUSTOMER_MESSAGE_LABELS[item.messageKind]}</span><span className="text-xs text-muted-foreground">{registrationCustomerMessageStatusLabel(item.currentStatus)}</span></div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><time dateTime={item.confirmedAt}>{formatRegistrationMessageTimestamp(item.confirmedAt)}</time><span>{item.confirmedByName}</span>{item.recipientLast4 ? <span>수신 번호 끝 {item.recipientLast4}</span> : null}</div>
                {item.messageKind === "admission_application" ? onOpenPreview ? <div className="grid justify-items-start gap-2">
                  <p className="text-xs text-muted-foreground">현재 저장된 등록 정보로 미리보기를 엽니다. 과거 발송 내용과 다를 수 있으며, 발송 전 다시 확인해야 합니다.</p>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={Boolean(checking)} onClick={() => previewCurrentAdmission(item.messageId)}>현재 입학신청서 미리보기</Button>
                </div> : null : <p className="text-xs text-muted-foreground">이 이력의 원본 예약·대기 정보를 확인할 수 없어 미리보기로 연결할 수 없습니다. 해당 항목에서 현재 정보를 확인해 주세요.</p>}
                {item.canCheck ? <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={Boolean(checking)} onClick={() => void checkReceipt(item.messageId)}>{checking === item.messageId ? "확인 중…" : "발송 결과 확인"}</Button>
                  {checkErrors[item.messageId] ? <span role="alert" className="text-xs text-destructive">{checkErrors[item.messageId]}</span> : null}
                </div> : null}
                {item.canCheckDelivery && client.checkDelivery ? <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={Boolean(checking)} onClick={() => void checkDelivery(item.messageId)}>{checking === item.messageId ? "확인 중…" : "도착 여부 확인"}</Button>
                  {delivery ? <span role="status" className="text-xs">{delivery === "error" ? "조회하지 못했습니다. 다시 확인해 주세요." : delivery.deliveryStatus === "delivered" ? "도착 확인" : delivery.deliveryStatus === "failed" ? "전달 실패" : delivery.deliveryStatus === "pending" ? "전달 처리 중" : "도착 여부 확인 필요"}</span> : null}
                </div> : null}
              </li>
            )
          })}
        </ul>
      </div>
      <DataTablePagination page={page} pageSize={pageSize} totalCount={data?.totalCount ?? result?.data?.totalCount ?? null} loading={loading || Boolean(checking)} onPageChange={onPageChange}
        onPageSizeChange={(value) => { if (value === 10 || value === 15 || value === 20) onPageSizeChange(value) }} ariaLabel="발송 이력 페이지" />
    </div>
  )
}
