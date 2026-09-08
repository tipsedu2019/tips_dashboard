"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { DataTablePagination } from "@/components/data-table/data-table-pagination"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useDataTablePageSize } from "@/hooks/use-data-table-page-size"
import { createRegistrationVisitCancellationService, type RegistrationVisitCancellation, type RegistrationVisitCancellationPage } from "./registration-visit-cancellation-service"

const defaultService = createRegistrationVisitCancellationService()
const STATUS_LABELS = {
  ready: "취소 전달 필요", failed: "전달 실패", sent: "취소 전달 완료",
  unknown: "전달 결과 확인 필요", not_needed: "전달할 기존 안내 없음",
  blocked: "설정 확인 필요", not_canceled: "취소되지 않음",
} as const

function scheduleLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "예약 시각 없음"
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "Asia/Seoul",
  }).format(new Date(value))
}

type RegistrationVisitCancellationActionsProps = {
  service?: typeof defaultService
  taskId: string
  sessionToken: string
  refreshKey?: string | number
  onWarning?: (message: string) => void
}

export function RegistrationVisitCancellationActions(props: RegistrationVisitCancellationActionsProps) {
  return <VisitCancellationActionsScope key={`${props.taskId}:${props.sessionToken}`} {...props} />
}

function VisitCancellationActionsScope({ taskId, sessionToken, refreshKey, onWarning, service = defaultService }: RegistrationVisitCancellationActionsProps) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const { pageSize, ready, setPreference } = useDataTablePageSize("registration:visit-cancellations")
  const [data, setData] = useState<RegistrationVisitCancellationPage | null>(null)
  const [selected, setSelected] = useState<RegistrationVisitCancellation | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const scope = useRef({ taskId, sessionToken })
  scope.current = { taskId, sessionToken }
  const sendLock = useRef(false)
  const requestKeys = useRef(new Map<string, string>())
  const controller = useRef<AbortController | null>(null)
  const sendController = useRef<AbortController | null>(null)
  useEffect(() => () => { sendController.current?.abort() }, [])

  const reload = useCallback(async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    const currentGeneration = ++generation.current
    setLoading(true)
    setError("")
    try {
      const result = await service.list(taskId, sessionToken, page, pageSize, request.signal)
      if (currentGeneration !== generation.current) return
      setData(result)
      setSelected((current) => current ? result.items.find((item) => item.appointmentId === current.appointmentId) ?? null : null)
    } catch (failure) {
      if (request.signal.aborted || currentGeneration !== generation.current) return
      setError(failure instanceof Error ? failure.message : "취소 안내 목록을 불러오지 못했습니다.")
    } finally {
      if (currentGeneration === generation.current) setLoading(false)
    }
  }, [page, pageSize, sessionToken, taskId, service])

  useEffect(() => {
    if (open && sessionToken && ready) void reload()
    return () => {
      generation.current += 1
      controller.current?.abort()
    }
  }, [open, reload, refreshKey, sessionToken, ready])

  async function send() {
    if (!selected?.canSend || sendLock.current) return
    sendLock.current = true
    setSending(true)
    setError("")
    onWarning?.("")
    const currentGeneration = generation.current
    const currentScope = scope.current
    const intentKey = `${selected.appointmentId}:${selected.notificationRevision}:${selected.previewChecksum}`
    const requestKey = requestKeys.current.get(intentKey) ?? crypto.randomUUID()
    requestKeys.current.set(intentKey, requestKey)
    const request = new AbortController()
    sendController.current = request
    try {
      await service.send(selected, sessionToken, requestKey, request.signal)
      if (currentGeneration === generation.current) await reload()
    } catch (failure) {
      if (currentGeneration !== generation.current) return
      const message = failure instanceof Error ? failure.message : "취소 안내를 보내지 못했습니다."
      if (failure instanceof Error && "code" in failure && failure.code === "registration_visit_cancellation_send_timeout") {
        const unknown = { ...selected, status: "unknown" as const, canSend: false, reason: message }
        setSelected(unknown)
        setData((current) => current ? { ...current, items: current.items.map((item) => item.appointmentId === selected.appointmentId ? unknown : item) } : current)
        setError(message)
        onWarning?.(message)
        return
      }
      await reload()
      if (scope.current.taskId !== currentScope.taskId || scope.current.sessionToken !== currentScope.sessionToken) return
      setError(message)
      onWarning?.(message)
    } finally {
      sendLock.current = false
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (sending) return
      setOpen(next)
      if (!next) setSelected(null)
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={!sessionToken}>방문 취소 전달</Button>
      </DialogTrigger>
      <DialogContent overlayClassName="z-[90]" closeButtonLabel="방문상담 취소 전달 닫기" className="z-[90] max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>방문상담 취소 전달</DialogTitle>
          <DialogDescription>관리팀에 전달했던 예약 안내를 확인하고 취소를 알립니다.</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {loading && !data ? <p role="status" className="text-sm text-muted-foreground">취소 안내 목록을 불러오는 중</p> : null}
        {data?.items.length === 0 ? <p className="py-4 text-sm text-muted-foreground">취소된 방문상담 예약이 없습니다.</p> : null}
        {selected ? (
          <div className="min-w-0 space-y-4">
            <Button type="button" variant="ghost" disabled={sending} onClick={() => setSelected(null)}>목록으로</Button>
            <div className="space-y-1 text-sm">
              <p className="font-medium">{STATUS_LABELS[selected.status]}</p>
              <p className="text-muted-foreground">{selected.reason}</p>
            </div>
            {selected.sourceBody ? (
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">이전에 전달한 예약 안내</summary>
                <p className="mt-3 whitespace-pre-wrap break-words text-muted-foreground">{selected.sourceBody}</p>
              </details>
            ) : null}
            {selected.renderedBody ? (
              <section aria-label="취소 안내 미리보기" className="min-w-0 rounded-md border p-4">
                <p className="mb-3 text-xs text-muted-foreground">받는 곳: {selected.targetLabel || "관리팀"} · Google Chat</p>
                <p className="font-semibold break-words">{selected.renderedTitle}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm">{selected.renderedBody}</p>
              </section>
            ) : null}
            {selected.canSend ? (
              <Button className="w-full sm:w-auto" disabled={sending || loading} onClick={() => void send()}>
                {sending ? "취소 전달 중" : selected.status === "failed" ? "취소 안내 다시 보내기" : "관리팀에 취소 전달"}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {data?.items.map((item) => (
              <button key={item.appointmentId} type="button" disabled={loading || sending}
                className="flex min-h-16 w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                onClick={() => setSelected(item)}>
                <span>{scheduleLabel(item.scheduledAt)}</span>
                <span className={item.canSend ? "font-medium text-primary" : "text-muted-foreground"}>{STATUS_LABELS[item.status]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" disabled={loading || sending} onClick={() => void reload()}>
            {loading ? "확인 중" : "목록 새로 확인"}
          </Button>
        </div>
        {!selected ? <DataTablePagination page={page} pageSize={pageSize} totalCount={data?.totalCount ?? null}
          loading={loading || sending || !ready} onPageChange={setPage} ariaLabel="방문 취소 전달 목록 페이지"
          onPageSizeChange={(value) => { setPreference(value); setPage(1) }} /> : null}
      </DialogContent>
    </Dialog>
  )
}
