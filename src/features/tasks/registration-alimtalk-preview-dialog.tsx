"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

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
  RegistrationCustomerMessageDeliveryResult,
  RegistrationCustomerMessageHistoryItem,
  RegistrationCustomerMessagePreviewResponse,
  RegistrationCustomerMessageSendResult,
  RegistrationCustomerMessageTarget,
} from "./registration-customer-message-contract"
import { getRegistrationCustomerMessageErrorMessage, getRegistrationCustomerMessageReadinessMessage } from "./registration-customer-message-errors"
import { formatRegistrationMessageTimestamp } from "./registration-customer-message-labels"

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
  return formatRegistrationMessageTimestamp(value)
}

function auditActorLabel(confirmedByName: string) {
  return confirmedByName === "자동 발송"
    ? "자동 발송"
    : `발송 요청 · ${confirmedByName}`
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
  const sendOutcomeUncertainRef = useRef(false)
  const previewAbortRef = useRef<AbortController | null>(null)
  const previewTitleRef = useRef<HTMLHeadingElement | null>(null)
  const retryButtonRef = useRef<HTMLButtonElement | null>(null)
  const [preview, setPreview] = useState<RegistrationCustomerMessagePreviewResponse | null>(null)
  const [latestMessage, setLatestMessage] = useState<RegistrationCustomerMessageHistoryItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [previewNotice, setPreviewNotice] = useState("")
  const [retrying, setRetrying] = useState(false)
  const [result, setResult] = useState<RegistrationCustomerMessageSendResult | null>(null)
  const [refreshWarning, setRefreshWarning] = useState("")
  const [deliveryResult, setDeliveryResult] = useState<RegistrationCustomerMessageDeliveryResult | null>(null)
  const deliveryAbortRef = useRef<AbortController | null>(null)
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

  const loadPreview = useCallback((source: "initial" | "manual" | "conflict" = "initial") => {
    const generation = ++generationRef.current
    previewAbortRef.current?.abort()
    const controller = new AbortController()
    previewAbortRef.current = controller
    const restorePreviewFocus = source === "manual" && document.activeElement === retryButtonRef.current
    setLoading(Boolean(open && targetMessageKind && targetSourceId))
    setRetrying(source === "manual")
    setSending(false)
    setError("")
    setPreviewNotice(source === "conflict" ? "등록 수업 정보가 변경되었습니다. 새 미리보기를 확인해 주세요." : "")
    setResult(null)
    setRefreshWarning("")
    setDeliveryResult(null)
    deliveryAbortRef.current?.abort()
    deliveryAbortRef.current = null
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
    sendOutcomeUncertainRef.current = false
    if (!open || !targetMessageKind || !targetSourceId) {
      previewAbortRef.current = null
      return
    }

    void client.preview({ messageKind: targetMessageKind, sourceId: targetSourceId }, controller.signal)
      .then((next) => {
        if (generation !== generationRef.current || controller.signal.aborted) return
        setPreview(next)
        setLatestMessage(next.latestMessage)
        if (restorePreviewFocus && (document.activeElement === retryButtonRef.current || document.activeElement === document.body)) {
          previewTitleRef.current?.focus()
        }
      })
      .catch((cause: unknown) => {
        if (generation !== generationRef.current || controller.signal.aborted) return
        setError(getRegistrationCustomerMessageErrorMessage(cause, "미리보기를 불러오지 못했습니다."))
      })
      .finally(() => {
        if (generation === generationRef.current && !controller.signal.aborted) {
          previewAbortRef.current = null
          setLoading(false)
          setRetrying(false)
        }
      })
  }, [client, open, targetMessageKind, targetSourceId])

  const cancelPendingResponses = useCallback(() => {
    ++generationRef.current
    previewAbortRef.current?.abort()
    previewAbortRef.current = null
    deliveryAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    loadPreview()
    return cancelPendingResponses
  }, [loadPreview, cancelPendingResponses])

  const expiryTime = previewExpiryTime(preview)
  useEffect(() => {
    if (!open || expiryTime === null) return
    const remaining = expiryTime - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setClockTick((value) => value + 1), Math.min(2_147_483_647, remaining + 1))
    return () => window.clearTimeout(timer)
  }, [expiryTime, open, clockTick])

  const now = Date.now() + clockTick * 0
  const currentStatus = result?.currentStatus || latestMessage?.currentStatus || null
  const canCheck = (currentStatus === "unknown" || currentStatus === "pending")
    && Boolean(result?.canCheck ?? latestMessage?.canCheck)
  const canCheckPending = currentStatus === "pending" && canCheck
  const duplicateLocked = preview?.readiness.blockers.includes("duplicate_locked") || false
  const expired = !expiryTime || expiryTime <= now
  const previewNeedsRenewal = Boolean(preview?.previewId) && expired && !currentStatus && !duplicateLocked
  const canReloadPreview = !currentStatus && !requestKeyRef.current && !duplicateLocked
    && ((!preview && Boolean(error)) || previewNeedsRenewal)
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
    if (!nextOpen) {
      cancelPendingResponses()
      confirmationLockedRef.current = true
    }
    onOpenChange(nextOpen)
    if (!nextOpen) returnFocus()
  }

  function applyResult(next: RegistrationCustomerMessageSendResult) {
    setResult(next)
    setLatestMessage(toHistory(next))
  }

  async function confirm() {
    if (confirmationLockedRef.current || previewAbortRef.current || confirmDisabled || !preview?.previewId || !target) return
    // Recheck at the gesture: background tabs can delay the expiry timer.
    if (expiryTime === null || expiryTime <= Date.now()) {
      setClockTick((value) => value + 1)
      return
    }
    const generation = generationRef.current
    const confirmedTarget = target
    requestKeyRef.current ??= createRequestKey()
    confirmationLockedRef.current = true
    setSending(true)
    setError("")
    try {
      const next = await client.send({ previewId: preview.previewId, requestKey: requestKeyRef.current })
      if (generation !== generationRef.current) return
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
      if (cause instanceof Error && cause.message === "registration_customer_message_confirmation_conflict" && !sendOutcomeUncertainRef.current) {
        loadPreview("conflict")
        return
      }
      // An ambiguous send failure must retain its request key, including after expiry.
      sendOutcomeUncertainRef.current = true
      confirmationLockedRef.current = false
      setError(getRegistrationCustomerMessageErrorMessage(cause, "발송 요청을 처리하지 못했습니다."))
    } finally {
      if (generation === generationRef.current) setSending(false)
    }
  }

  function retryPreview() {
    if (!open || !canReloadPreview || previewAbortRef.current || sending || confirmationLockedRef.current) return
    loadPreview("manual")
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
      if (generation === generationRef.current) setError(getRegistrationCustomerMessageErrorMessage(cause, "상태를 확인하지 못했습니다."))
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
      if (generation === generationRef.current) setError(getRegistrationCustomerMessageErrorMessage(cause, "관리자 복구를 처리하지 못했습니다."))
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
      if (generation === generationRef.current) setError(getRegistrationCustomerMessageErrorMessage(cause, "사전 발송 해제를 처리하지 못했습니다."))
    } finally {
      if (generation === generationRef.current) setSending(false)
    }
  }

  const last4 = result?.recipientLast4 || preview?.recipientLast4 || latestMessage?.recipientLast4 || ""
  const auditMessage = result || latestMessage
  const observationFacts = preview?.messageKind === "observation_booking"
    || preview?.messageKind === "observation_reminder"
    ? preview.facts as RegistrationCustomerMessagePreviewResponse["facts"] & Readonly<{
        className: string
        teacherLabel: string
      }>
    : null
  async function checkDelivery() {
    const messageId = result?.messageId || latestMessage?.messageId
    if (!messageId || currentStatus !== "accepted" || !client.checkDelivery || deliveryAbortRef.current) return
    const generation = generationRef.current
    const controller = new AbortController()
    deliveryAbortRef.current = controller
    setSending(true)
    setError("")
    try {
      const next = await client.checkDelivery({ messageId }, controller.signal)
      if (generation === generationRef.current && !controller.signal.aborted) setDeliveryResult(next)
    } catch (cause) {
      if (generation === generationRef.current && !controller.signal.aborted) {
        setError(getRegistrationCustomerMessageErrorMessage(cause, "전달 결과를 확인하지 못했습니다. 다시 확인해 주세요."))
      }
    } finally {
      if (deliveryAbortRef.current === controller) deliveryAbortRef.current = null
      if (generation === generationRef.current) setSending(false)
    }
  }

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
              <DialogTitle ref={previewTitleRef} tabIndex={-1}>알림톡 미리보기</DialogTitle>
            <DialogDescription>{currentStatus === "accepted"
              ? "접수한 알림톡의 전달 결과를 확인할 수 있습니다."
              : "내용과 수신자 끝자리를 확인한 뒤 발송합니다."}</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button type="button" className="min-h-11 min-w-11" variant="outline" aria-label="알림톡 미리보기 닫기">닫기</Button>
            </DialogClose>
          </div>
        </DialogHeader>

        {error ? <p role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm">{error}</p> : null}
        {previewNotice ? <p role="status" className="text-sm">{previewNotice}</p> : null}
        {previewNeedsRenewal ? <p role="status" className="text-sm">
          {expiryTime === null ? "미리보기 유효 시간을 확인할 수 없습니다." : "미리보기가 만료되었습니다."}
          {expiryTime !== null && preview?.expiresAt ? <span className="block text-muted-foreground">만료 시각 · <time dateTime={preview.expiresAt}>{formatAuditTimestamp(preview.expiresAt)}</time></span> : null}
          <span className="block">{requestKeyRef.current ? "발송 이력을 확인해 주세요." : "새 미리보기를 확인해 주세요."}</span>
        </p> : null}
        {refreshWarning ? <p role="status" className="rounded-md border border-amber-300 px-3 py-2 text-sm">{refreshWarning}</p> : null}
        {currentStatus === "accepted" ? <p role="status" className="text-sm">
          {deliveryResult?.deliveryStatus === "delivered" ? "알림톡 전달 완료"
            : deliveryResult?.deliveryStatus === "failed" ? "알림톡 전달 실패 · 재발송 전 수신 정보를 확인해 주세요"
            : deliveryResult?.deliveryStatus === "pending" ? "SOLAPI 접수 완료 · 전달 처리 중"
            : deliveryResult?.deliveryStatus === "unavailable" ? "SOLAPI 접수 완료 · 전달 결과 확인 불가"
            : "SOLAPI 접수 완료"} · 학부모 전화 끝 {last4}
          {deliveryResult ? <span className="block text-xs text-muted-foreground">조회 시각 · {formatAuditTimestamp(deliveryResult.checkedAt)}</span> : null}
        </p> : null}
        {currentStatus === "unknown" ? <p role="alert" className="text-sm">발송 결과 확인 필요</p> : null}
        {currentStatus === "failed_hold" ? <p role="alert" className="text-sm">발송 실패 · 같은 내용 재발송 불가</p> : null}

        {loading ? <p className="text-sm text-muted-foreground">미리보기를 불러오는 중입니다.</p> : null}
        {preview ? (
          <div className="grid gap-4 text-sm">
            <dl className="grid gap-1">
              <div><dt className="inline text-muted-foreground">학생 · </dt><dd className="inline">{preview.studentName}</dd></div>
              <div><dt className="inline text-muted-foreground">학부모 전화 · </dt><dd className="inline">끝 {preview.recipientLast4}</dd></div>
              <div><dt className="inline text-muted-foreground">대상 · </dt><dd className="inline">{preview.facts.subjectLabel}</dd></div>
              {observationFacts?.className ? <div><dt className="inline text-muted-foreground">수업 · </dt><dd className="inline">{observationFacts.className}</dd></div> : null}
              {preview.facts.scheduleLabel ? <div><dt className="inline text-muted-foreground">일정 · </dt><dd className="inline">{preview.facts.scheduleLabel}</dd></div> : null}
              {preview.facts.placeLabel ? <div><dt className="inline text-muted-foreground">장소 · </dt><dd className="inline">{preview.facts.placeLabel}</dd></div> : null}
              {observationFacts?.teacherLabel ? <div><dt className="inline text-muted-foreground">선생님 · </dt><dd className="inline">{observationFacts.teacherLabel}</dd></div> : null}
              {preview.facts.waitingKindLabel ? <div><dt className="inline text-muted-foreground">대기 · </dt><dd className="inline">{preview.facts.waitingKindLabel} {preview.facts.waitingDetailLabel || ""}</dd></div> : null}
            </dl>
            {preview.facts.reservations?.length ? (
              <section aria-label="예약 목록" className="rounded-md border p-3">
                <h3 className="mb-2 font-medium">예약 목록</h3>
                <ol className="grid gap-3">
                  {preview.facts.reservations.map((reservation, index) => (
                    <li key={`${reservation.subjectLabel}:${reservation.scheduleLabel}:${index}`}>
                      <p>{index + 1}. {reservation.subjectLabel} · {reservation.scheduleLabel} · {reservation.placeLabel}</p>
                      {reservation.className && reservation.teacherLabel ? <p className="text-muted-foreground">수업: {reservation.className} · 담당: {reservation.teacherLabel}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {preview.facts.admissionPlans?.map((plan, index) => (
              <section key={`${plan.subjectLabel}:${plan.className}:${index}`} className="rounded-md border p-3">
                <dl className="grid gap-1">
                  <div><dt className="inline text-muted-foreground">과목/수업 · </dt><dd className="inline">[{plan.subjectLabel}] {plan.className}</dd></div>
                  <div><dt className="inline text-muted-foreground">교재 · </dt><dd className="inline">{plan.textbookLabel}</dd></div>
                  <div><dt className="inline text-muted-foreground">요일/시간 · </dt><dd className="inline">{plan.scheduleLabel}</dd></div>
                  <div><dt className="inline text-muted-foreground">선생님 · </dt><dd className="inline">{plan.teacherLabel}</dd></div>
                  <div><dt className="inline text-muted-foreground">강의실 · </dt><dd className="inline">{plan.classroomLabel}</dd></div>
                  <div className="mt-2 border-t pt-2 font-semibold"><dt className="inline">첫 수업일 · </dt><dd className="inline">{plan.firstLessonLabel}</dd></div>
                </dl>
              </section>
            ))}
            <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">{preview.body}</p>
            {preview.buttons.map((button) => <p key={`${button.name}:${button.host}`} className="break-words text-muted-foreground">카카오 버튼 · {button.name} ({button.host})</p>)}
            <p className="text-muted-foreground">준비 상태 · {preview.readiness.sendAllowed ? "발송 가능" : getRegistrationCustomerMessageReadinessMessage(preview.readiness.blockers)}</p>
            {latestMessage ? <p className="text-muted-foreground">최근 상태 · {statusLabel(latestMessage.currentStatus)}</p> : null}
            {auditMessage ? <p className="text-muted-foreground">{auditActorLabel(auditMessage.confirmedByName)} · {formatAuditTimestamp(auditMessage.confirmedAt)}</p> : null}
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
          {canReloadPreview || retrying ? <Button ref={retryButtonRef} type="button" className="min-h-11" variant="outline" disabled={loading || sending} onClick={retryPreview}>미리보기 다시 확인</Button> : null}
          {currentStatus === "accepted" && client.checkDelivery && (viewerRole === "admin" || viewerRole === "staff") ? <Button type="button" className="min-h-11" disabled={sending} onClick={() => void checkDelivery()}>{sending ? "확인 중" : "전달 결과 확인"}</Button> : (currentStatus === "unknown" && canCheck) || canCheckPending ? <Button type="button" className="min-h-11" disabled={sending} onClick={() => void check()}>상태 확인</Button> : (
            <Button type="button" className="min-h-11" disabled={confirmDisabled} onClick={() => void confirm()}>{confirmLabel}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
