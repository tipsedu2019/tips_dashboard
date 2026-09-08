"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { GoogleChatDeliveryControl } from "@/features/notifications/notification-delivery-control"
import { supabase } from "@/lib/supabase"
import { dispatchRegistrationManagementNotificationSources } from "./registration-consultation-notification.js"
import { createRegistrationManagementPreviewService, type RegistrationManagementPreview } from "./registration-management-notification-preview-service"

const service = createRegistrationManagementPreviewService(supabase)
const settingsHref = "/admin/settings/notifications?workflow=registration&section=rules&group=progress"

type Props = {
  trackId: string
  workflowRevision: number
  viewerId: string | null
  sessionToken: string
  disabled: boolean
  hasUnsavedChanges: () => boolean
  onWarning: (message: string) => void
  previewService?: ReturnType<typeof createRegistrationManagementPreviewService>
  dispatch?: typeof dispatchRegistrationManagementNotificationSources
  renderDeliveryStatus?: (eventId: string | null) => ReactNode
}

export function RegistrationManagementNotificationActions(props: Props) {
  return <ManagementNotificationScope key={`${props.trackId}:${props.workflowRevision}:${props.viewerId}:${props.sessionToken}`} {...props} />
}

function ManagementNotificationScope({ trackId, workflowRevision, sessionToken, disabled, hasUnsavedChanges, onWarning, previewService = service, dispatch = dispatchRegistrationManagementNotificationSources, renderDeliveryStatus }: Props) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<RegistrationManagementPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [eventId, setEventId] = useState<string | null>(null)
  const [recoveredRequest, setRecoveredRequest] = useState<{ previousEventId?: string } | null>(null)
  const mounted = useRef(true)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const requestKeys = useRef(new Map<string, string>())
  const currentGuards = useRef({ disabled, hasUnsavedChanges })
  currentGuards.current = { disabled, hasUnsavedChanges }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1 }
  }, [])

  async function loadPreview() {
    const attempt = ++generation.current
    setLoading(true)
    setError("")
    setPreview(null)
    if (hasUnsavedChanges()) {
      setError("입력 중인 등록 정보를 먼저 저장한 뒤 알림을 확인해 주세요.")
      setLoading(false)
      return
    }
    try {
      const data = await previewService.preview(trackId, workflowRevision)
      if (mounted.current && attempt === generation.current) setPreview(data)
    } catch (failure) {
      if (mounted.current && attempt === generation.current) setError(failure instanceof Error ? failure.message : "미리보기를 불러오지 못했습니다.")
    } finally {
      if (mounted.current && attempt === generation.current) setLoading(false)
    }
  }

  async function send() {
    if (!preview?.canSend || inFlight.current || currentGuards.current.disabled) return
    if (currentGuards.current.hasUnsavedChanges()) {
      setError("입력 중인 등록 정보를 먼저 저장한 뒤 미리보기를 다시 확인해 주세요.")
      setPreview(null)
      return
    }
    inFlight.current = true
    setSending(true)
    setError("")
    onWarning("")
    const requestKey = requestKeys.current.get(preview.previewChecksum) ?? crypto.randomUUID()
    requestKeys.current.set(preview.previewChecksum, requestKey)
    try {
      const confirmation = await previewService.confirm(preview, requestKey)
      const { sourceEventIds } = confirmation
      // An identity/track change while confirmation was in flight must not
      // start a provider request for the next viewer or selected subject.
      if (!mounted.current) return
      setRecoveredRequest(confirmation.recovered
        ? { previousEventId: confirmation.previousEventId }
        : preview.recoveredFromEventId ? { previousEventId: preview.recoveredFromEventId } : null)
      if (currentGuards.current.disabled || currentGuards.current.hasUnsavedChanges()) {
        setPreview(null)
        setError("등록 정보가 변경되었습니다. 저장 후 미리보기를 다시 확인해 주세요.")
        return
      }
      const result = await dispatch(sourceEventIds, sessionToken)
      if (!mounted.current) return
      setEventId(result.googleChatEventIds[result.googleChatEventIds.length - 1] || null)
      if (result.failedSourceEventIds.length > 0 || result.googleChatEventIds.length === 0) {
        throw new Error("관리팀 알림의 전달 결과를 확인하지 못했습니다. 발송 이력을 확인해 주세요.")
      }
      setOpen(false)
    } catch (failure) {
      if (!mounted.current) return
      const message = failure instanceof Error ? failure.message : "관리팀 알림을 보내지 못했습니다."
      setError(message)
      onWarning(message)
    } finally {
      inFlight.current = false
      if (mounted.current) setSending(false)
    }
  }

  return <div className="grid min-w-0 gap-1.5">
    <Dialog open={open} onOpenChange={(next) => {
      if (inFlight.current) return
      setOpen(next)
      if (next) void loadPreview()
      else { generation.current += 1; setPreview(null) }
    }}>
      <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled || !sessionToken}>관리팀 알림 미리보기</Button></DialogTrigger>
      <DialogContent className="z-[90] max-h-[85dvh] overflow-y-auto sm:max-w-xl" overlayClassName="z-[90]" closeButtonLabel="관리팀 알림 미리보기 닫기">
        <DialogHeader>
          <DialogTitle>관리팀 알림 보내기</DialogTitle>
          <DialogDescription>저장된 등록 정보와 알림 설정을 확인한 뒤 직접 전달합니다.</DialogDescription>
        </DialogHeader>
        {loading ? <p role="status" className="text-sm text-muted-foreground">알림 내용 확인 중…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {preview ? <div className="grid min-w-0 gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">진행단계</dt><dd>{preview.stepLabel}</dd>
            <dt className="text-muted-foreground">수신 채팅방</dt><dd>{preview.targetLabel}</dd>
            <dt className="text-muted-foreground">담당자 멘션</dt><dd>{preview.mentionLabel}</dd>
          </dl>
          {!preview.canSend ? <p role="status" className="text-sm text-destructive">{preview.reason}</p> : null}
          {preview.recoveryAvailable ? <div role="status" className="grid gap-1 text-sm">
            <p className="font-medium">현재 내용으로 새 안내 준비</p>
            <p className="text-muted-foreground">이전 요청은 발송을 시도하지 않았습니다. 아래 내용을 확인하고 전달하면 이전 기록을 보관하고 새 안내를 준비합니다.</p>
          </div> : null}
          {!preview.recoveryAvailable && preview.recoveredFromEventId ? <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">보관된 이전 요청</summary>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              <p>이전 요청을 보관하고 준비한 새 안내입니다.</p>
              {renderDeliveryStatus ? renderDeliveryStatus(preview.recoveredFromEventId) : <GoogleChatDeliveryControl eventId={preview.recoveredFromEventId} onWarning={onWarning} allowRetry={false} />}
            </div>
          </details> : null}
          {preview.existingEventId ? <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{preview.recoveryAvailable ? "보관할 이전 요청" : preview.recoveredFromEventId ? "새 안내 전달 기록" : "이전 관리팀 알림 기록"}</summary>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              {preview.existingRequestedAt ? <p>요청 시각 · {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(new Date(preview.existingRequestedAt))}</p> : null}
              {preview.existingRuleEnabled !== undefined ? <p>요청 당시 설정 · {preview.existingRuleEnabled ? "켜짐" : "꺼짐"}</p> : null}
              {renderDeliveryStatus ? renderDeliveryStatus(preview.existingEventId) : <GoogleChatDeliveryControl eventId={preview.existingEventId} onWarning={onWarning} allowRetry={false} />}
            </div>
          </details> : null}
          {preview.renderedTitle || preview.renderedBody ? <div className="min-w-0 rounded-md border bg-muted/30 p-4">
            <p className="break-words font-semibold">{preview.renderedTitle}</p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{preview.renderedBody}</p>
          </div> : null}
          {!preview.canSend && ["rule_disabled", "template_missing", "connection_missing"].includes(preview.status) ? <Link
            href={preview.status === "connection_missing" ? "/admin/settings/notifications?workflow=registration&section=connections" : settingsHref}
            className="w-fit text-sm font-medium text-primary underline underline-offset-4">{preview.status === "connection_missing" ? "수신 채팅방 연결" : "관리팀 진행 공유 설정"}</Link> : null}
        </div> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={() => { setOpen(false); generation.current += 1 }}>취소</Button>
          {error && !loading ? <Button type="button" variant="outline" disabled={sending} onClick={() => void loadPreview()}>미리보기 다시 확인</Button> : null}
          <Button type="button" disabled={loading || sending || disabled || !preview?.canSend || Boolean(error)} onClick={() => void send()}>{sending ? "전달 중…" : "이 내용으로 관리팀에 전달"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {recoveredRequest ? <div className="grid gap-2 text-xs text-muted-foreground">
      <p role="status">이전 요청을 보관하고 현재 내용으로 새 안내를 준비했습니다.</p>
      {recoveredRequest.previousEventId ? <details>
        <summary className="w-fit cursor-pointer">보관된 이전 요청</summary>
        <div className="mt-2">{renderDeliveryStatus ? renderDeliveryStatus(recoveredRequest.previousEventId) : <GoogleChatDeliveryControl eventId={recoveredRequest.previousEventId} onWarning={onWarning} allowRetry={false} />}</div>
      </details> : null}
      {eventId ? <p className="font-medium text-foreground">새 안내 전달 상태</p> : null}
    </div> : null}
    {renderDeliveryStatus ? renderDeliveryStatus(eventId) : <GoogleChatDeliveryControl eventId={eventId} onWarning={onWarning} allowRetry={false} />}
  </div>
}
