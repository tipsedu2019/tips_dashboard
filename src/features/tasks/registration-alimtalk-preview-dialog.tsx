"use client"

import { useEffect, useRef, useState, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import type {
  RegistrationCustomerMessageClient,
  RegistrationCustomerMessageHistoryItem,
  RegistrationCustomerMessagePreviewResponse,
  RegistrationCustomerMessageSendResult,
  RegistrationCustomerMessageTarget,
} from "./registration-customer-message-contract"

type RegistrationAlimtalkPreviewDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  target: RegistrationCustomerMessageTarget | null
  client: RegistrationCustomerMessageClient
  viewerRole: "admin" | "staff" | "teacher" | "assistant"
  triggerRef?: RefObject<HTMLElement | null>
  canReleasePreSend?: boolean
  onSendSuccess?: (input: Readonly<{
    target: RegistrationCustomerMessageTarget
    result: RegistrationCustomerMessageSendResult
  }>) => void | Promise<void>
}>

function createRequestKey() {
  return globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`
}

function toHistory(result: RegistrationCustomerMessageSendResult): RegistrationCustomerMessageHistoryItem {
  return {
    messageId: result.messageId,
    messageKind: result.messageKind,
    currentStatus: result.currentStatus,
    confirmedByName: result.confirmedByName,
    confirmedAt: result.confirmedAt,
    updatedAt: result.updatedAt,
    recipientLast4: result.recipientLast4,
    canCheck: result.canCheck,
  }
}

function statusLabel(status: RegistrationCustomerMessageHistoryItem["currentStatus"]) {
  if (status === "accepted") return "SOLAPI 접수 완료"
  if (status === "unknown") return "발송 결과 확인 필요"
  if (status === "failed_hold") return "발송 실패 · 같은 내용 재발송 불가"
  return "발송 처리 중"
}

function previewExpiryTime(preview: RegistrationCustomerMessagePreviewResponse | null) {
  if (!preview?.expiresAt) return null
  const value = Date.parse(preview.expiresAt)
  return Number.isFinite(value) ? value : null
}

function normalizedTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function formatAuditTimestamp(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp))
}

export function RegistrationAlimtalkPreviewDialog({
  open,
  onOpenChange,
  target,
  client,
  viewerRole,
  triggerRef,
  canReleasePreSend,
  onSendSuccess,
}: RegistrationAlimtalkPreviewDialogProps) {
  const generationRef = useRef(0)
  const requestKeyRef = useRef<string | null>(null)
  const confirmationLockedRef = useRef(false)
  const [preview, setPreview] = useState<RegistrationCustomerMessagePreviewResponse | null>(null)
  const [latestMessage, setLatestMessage] = useState<RegistrationCustomerMessageHistoryItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<RegistrationCustomerMessageSendResult | null>(null)
  const [refreshWarning, setRefreshWarning] = useState("")
  const [clockTick, setClockTick] = useState(0)
  const [reason, setReason] = useState("")
  const [recoveryResolution, setRecoveryResolution] = useState<"accepted" | "failed_hold">("accepted")
  const [recoveryStatus, setRecoveryStatus] = useState("")
  const [recoveryMessage, setRecoveryMessage] = useState("")
  const [recoveryObservedAt, setRecoveryObservedAt] = useState("")
  const [recoveryRequestKeyMatched, setRecoveryRequestKeyMatched] = useState<"" | "true">("")
  const [recoveryProviderMessageId, setRecoveryProviderMessageId] = useState("")
  const [recoveryProviderGroupId, setRecoveryProviderGroupId] = useState("")
  const targetMessageKind = target?.messageKind
  const targetSourceId = target?.sourceId

  useEffect(() => {
    const generation = ++generationRef.current
    const controller = new AbortController()
    setLoading(Boolean(open && targetMessageKind && targetSourceId))
    setSending(false)
    setError("")
    setResult(null)
    setRefreshWarning("")
    setPreview(null)
    setLatestMessage(null)
    setReason("")
    setRecoveryResolution("accepted")
    setRecoveryStatus("")
    setRecoveryMessage("")
    setRecoveryObservedAt("")
    setRecoveryRequestKeyMatched("")
    setRecoveryProviderMessageId("")
    setRecoveryProviderGroupId("")
    requestKeyRef.current = null
    confirmationLockedRef.current = false
    if (!open || !targetMessageKind || !targetSourceId) return () => controller.abort()

    void client.preview({ messageKind: targetMessageKind, sourceId: targetSourceId }, controller.signal)
      .then((next) => {
        if (generation !== generationRef.current) return
        setPreview(next)
        setLatestMessage(next.latestMessage)
      })
      .catch((cause: unknown) => {
        if (generation !== generationRef.current) return
        setError(cause instanceof Error ? cause.message : "미리보기를 불러오지 못했습니다.")
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false)
      })
    return () => controller.abort()
  }, [client, open, targetMessageKind, targetSourceId])

  const expiryTime = previewExpiryTime(preview)
  useEffect(() => {
    if (!expiryTime) return
    const timer = window.setTimeout(() => setClockTick((value) => value + 1), Math.max(0, expiryTime - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [expiryTime])

  const now = Date.now() + clockTick * 0
  const currentStatus = result?.currentStatus || latestMessage?.currentStatus || null
  const canCheck = (currentStatus === "unknown" || currentStatus === "pending")
    && Boolean(result?.canCheck ?? latestMessage?.canCheck)
  const canCheckPending = currentStatus === "pending" && canCheck
  const duplicateLocked = preview?.readiness.blockers.includes("duplicate_locked") || false
  const expired = !expiryTime || expiryTime <= now
  const confirmDisabled = loading || sending || confirmationLockedRef.current || !preview?.previewId || expired
    || !preview.readiness.sendAllowed || duplicateLocked || currentStatus === "pending" || currentStatus === "accepted" || currentStatus === "unknown" || currentStatus === "failed_hold"
  const canReconcile = viewerRole === "admin" && currentStatus === "unknown"
  const releasePreSendEligible = canReleasePreSend ?? false
  const activeMessageId = result?.messageId || latestMessage?.messageId || ""
  const canReleasePending = viewerRole === "admin" && currentStatus === "pending" && releasePreSendEligible && Boolean(activeMessageId)
  const recoveryEvidenceComplete = Boolean(
    recoveryStatus.trim()
      && recoveryMessage.trim()
      && normalizedTimestamp(recoveryObservedAt)
      && recoveryRequestKeyMatched === "true",
  )

  function returnFocus() {
    window.setTimeout(() => triggerRef?.current?.focus(), 0)
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) returnFocus()
  }

  function applyResult(next: RegistrationCustomerMessageSendResult) {
    setResult(next)
    setLatestMessage(toHistory(next))
  }

  async function confirm() {
    if (confirmDisabled || !preview?.previewId || !target) return
    const generation = generationRef.current
    const confirmedTarget = target
    requestKeyRef.current ??= createRequestKey()
    setSending(true)
    setError("")
    try {
      const next = await client.send({ previewId: preview.previewId, requestKey: requestKeyRef.current })
      if (generation !== generationRef.current) return
      confirmationLockedRef.current = true
      applyResult(next)
      if (next.ok && onSendSuccess) {
        try {
          await onSendSuccess({ target: confirmedTarget, result: next })
        } catch {
          if (generation === generationRef.current) {
            setRefreshWarning("알림톡은 접수됐지만 최신 내용을 불러오지 못했습니다. 잠시 후 다시 확인하세요.")
          }
        }
      }
    } catch (cause) {
      if (generation !== generationRef.current) return
      setError(cause instanceof Error ? cause.message : "발송 요청을 처리하지 못했습니다.")
    } finally {
      if (generation === generationRef.current) setSending(false)
    }
  }

  async function check() {
    const messageId = result?.messageId || latestMessage?.messageId
    if (!messageId || !canCheck) return
    const generation = generationRef.current
    setSending(true)
    setError("")
    try {
      const next = await client.check({ messageId })
      if (generation === generationRef.current) applyResult(next)
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : "상태를 확인하지 못했습니다.")
    } finally {
      if (generation === generationRef.current) setSending(false)
    }
  }

  async function reconcile() {
    const messageId = result?.messageId || latestMessage?.messageId
    if (!messageId || !canReconcile || !reason.trim() || !recoveryEvidenceComplete) return
    const generation = generationRef.current
    setSending(true)
    setError("")
    try {
      const next = await client.reconcile({
        messageId,
        resolution: recoveryResolution,
        reason: reason.trim(),
        requestKey: createRequestKey(),
        evidence: {
          ...(recoveryProviderMessageId.trim() ? { providerMessageId: recoveryProviderMessageId.trim() } : {}),
          ...(recoveryProviderGroupId.trim() ? { providerGroupId: recoveryProviderGroupId.trim() } : {}),
          statusCode: recoveryStatus.trim(),
          statusMessage: recoveryMessage.trim(),
          observedAt: normalizedTimestamp(recoveryObservedAt) as string,
          requestKeyMatched: recoveryRequestKeyMatched === "true",
        },
      })
      if (generation === generationRef.current) applyResult(next)
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : "관리자 복구를 처리하지 못했습니다.")
    } finally {
      if (generation === generationRef.current) setSending(false)
    }
  }

  async function releasePreSend() {
    const messageId = activeMessageId
    if (!messageId || !canReleasePending || !reason.trim()) return
    const generation = generationRef.current
    setSending(true)
    setError("")
    try {
      const next = await client.releasePreSend({ messageId, reason: reason.trim(), requestKey: createRequestKey() })
      if (generation === generationRef.current) applyResult(next)
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : "사전 발송 해제를 처리하지 못했습니다.")
    } finally {
      if (generation === generationRef.current) setSending(false)
    }
  }

  const last4 = result?.recipientLast4 || preview?.recipientLast4 || latestMessage?.recipientLast4 || ""
  const auditMessage = result || latestMessage
  const confirmLabel = sending
    ? "처리 중"
    : duplicateLocked || Boolean(currentStatus)
      ? "이미 발송 요청됨"
      : "확인 후 발송"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName="z-[90]"
        className="z-[90] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => { event.preventDefault(); handleOpenChange(false) }}
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>알림톡 미리보기</DialogTitle>
              <DialogDescription>내용과 수신자 끝자리를 확인한 뒤 발송합니다.</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button type="button" className="min-h-11 min-w-11" variant="outline" aria-label="알림톡 미리보기 닫기">닫기</Button>
            </DialogClose>
          </div>
        </DialogHeader>

        {error ? <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm">{error}</p> : null}
        {refreshWarning ? <p role="status" className="rounded-md border border-amber-300 px-3 py-2 text-sm">{refreshWarning}</p> : null}
        {currentStatus === "accepted" ? <p role="status" className="text-sm">SOLAPI 접수 완료 · 학부모 전화 끝 {last4}</p> : null}
        {currentStatus === "unknown" ? <p role="alert" className="text-sm">발송 결과 확인 필요</p> : null}
        {currentStatus === "failed_hold" ? <p role="alert" className="text-sm">발송 실패 · 같은 내용 재발송 불가</p> : null}

        {loading ? <p className="text-sm text-muted-foreground">미리보기를 불러오는 중입니다.</p> : null}
        {preview ? (
          <div className="grid gap-4 text-sm">
            <dl className="grid gap-1">
              <div><dt className="inline text-muted-foreground">학생 · </dt><dd className="inline">{preview.studentName}</dd></div>
              <div><dt className="inline text-muted-foreground">학부모 전화 · </dt><dd className="inline">끝 {preview.recipientLast4}</dd></div>
              <div><dt className="inline text-muted-foreground">대상 · </dt><dd className="inline">{preview.facts.subjectLabel}</dd></div>
              {preview.facts.scheduleLabel ? <div><dt className="inline text-muted-foreground">일정 · </dt><dd className="inline">{preview.facts.scheduleLabel}</dd></div> : null}
              {preview.facts.placeLabel ? <div><dt className="inline text-muted-foreground">장소 · </dt><dd className="inline">{preview.facts.placeLabel}</dd></div> : null}
              {preview.facts.waitingKindLabel ? <div><dt className="inline text-muted-foreground">대기 · </dt><dd className="inline">{preview.facts.waitingKindLabel} {preview.facts.waitingDetailLabel || ""}</dd></div> : null}
            </dl>
            <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">{preview.body}</p>
            {preview.buttons.map((button) => <p key={`${button.name}:${button.host}`} className="break-words text-muted-foreground">카카오 버튼 · {button.name} ({button.host})</p>)}
            <p className="text-muted-foreground">준비 상태 · {preview.readiness.sendAllowed ? "발송 가능" : preview.readiness.blockers.join(", ") || "발송 불가"}</p>
            {latestMessage ? <p className="text-muted-foreground">최근 상태 · {statusLabel(latestMessage.currentStatus)}</p> : null}
            {auditMessage ? <p className="text-muted-foreground">발송 요청 · {auditMessage.confirmedByName} · {formatAuditTimestamp(auditMessage.confirmedAt)}</p> : null}
          </div>
        ) : null}

        {viewerRole === "admin" && (canReconcile || canReleasePending) ? (
          <details className="rounded-md border p-3">
            <summary>관리자 복구</summary>
            <div className="mt-3 grid gap-2">
              <input className="min-h-11 rounded-md border px-3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="복구 사유" required />
              {canReconcile ? <>
                <select className="min-h-11 rounded-md border px-3" value={recoveryResolution} onChange={(event) => setRecoveryResolution(event.target.value as "accepted" | "failed_hold")}> <option value="accepted">접수 완료로 확정</option><option value="failed_hold">실패로 확정</option></select>
                <input className="min-h-11 rounded-md border px-3" value={recoveryStatus} onChange={(event) => setRecoveryStatus(event.target.value)} placeholder="provider 상태 코드" required />
                <input className="min-h-11 rounded-md border px-3" value={recoveryMessage} onChange={(event) => setRecoveryMessage(event.target.value)} placeholder="provider 상태 메시지" required />
                <input className="min-h-11 rounded-md border px-3" type="datetime-local" value={recoveryObservedAt} onChange={(event) => setRecoveryObservedAt(event.target.value)} required />
                <select className="min-h-11 rounded-md border px-3" value={recoveryRequestKeyMatched} onChange={(event) => setRecoveryRequestKeyMatched(event.target.value as "" | "true")} required><option value="">원 요청 키가 provider 증거와 일치함을 확인</option><option value="true">요청 키 일치 확인</option></select>
                <input className="min-h-11 rounded-md border px-3" value={recoveryProviderMessageId} onChange={(event) => setRecoveryProviderMessageId(event.target.value)} placeholder="provider 메시지 ID (선택)" />
                <input className="min-h-11 rounded-md border px-3" value={recoveryProviderGroupId} onChange={(event) => setRecoveryProviderGroupId(event.target.value)} placeholder="provider 그룹 ID (선택)" />
                <Button type="button" className="min-h-11" disabled={sending || !reason.trim() || !recoveryEvidenceComplete} onClick={() => void reconcile()}>상태 확정</Button>
              </> : null}
              {canReleasePending ? <Button type="button" className="min-h-11" variant="outline" disabled={sending || !reason.trim()} onClick={() => void releasePreSend()}>사전 발송 해제</Button> : null}
            </div>
          </details>
        ) : null}

        <DialogFooter>
          <Button type="button" className="min-h-11" variant="outline" onClick={() => handleOpenChange(false)}>돌아가기</Button>
          {(currentStatus === "unknown" && canCheck) || canCheckPending ? <Button type="button" className="min-h-11" disabled={sending} onClick={() => void check()}>상태 확인</Button> : (
            <Button type="button" className="min-h-11" disabled={confirmDisabled} onClick={() => void confirm()}>{confirmLabel}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
