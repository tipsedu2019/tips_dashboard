"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { readGoogleChatDeliveryStatus, retryGoogleChatDelivery, type GoogleChatDeliveryStatus } from "./notification-delivery-service"

export function GoogleChatDeliveryControl({ eventId, onWarning }: { eventId: string | null; onWarning: (message: string) => void }) {
  const [status, setStatus] = useState<GoogleChatDeliveryStatus | null>(null)
  const [confirmedAbsent, setConfirmedAbsent] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setConfirmedAbsent(false)
    setBusy(false)
    if (!eventId) { setStatus(null); return }
    const controller = new AbortController()
    const read = () => void readGoogleChatDeliveryStatus(eventId, controller.signal).then(setStatus).catch((error) => {
      if (!controller.signal.aborted) onWarning(error instanceof Error ? error.message : "Google Chat 상태를 확인하지 못했습니다.")
    })
    read()
    const secondRead = window.setTimeout(read, 2000)
    const finalRead = window.setTimeout(read, 5000)
    return () => { controller.abort(); window.clearTimeout(secondRead); window.clearTimeout(finalRead) }
  }, [eventId, onWarning])
  if (!eventId || !status || status.status === "not_applicable") return null
  if (status.status === "sent") return <p className="text-xs text-emerald-700">Google Chat 전송 완료</p>
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <span>{status.status === "processing" ? "Google Chat 전송 중" : status.status === "delayed" ? "Google Chat 전송 지연" : status.status === "unknown" ? "Google Chat 결과 확인 필요" : "Google Chat 전송 실패"}</span>
    {status.status === "unknown" ? <label className="flex items-center gap-2"><Checkbox checked={confirmedAbsent} onCheckedChange={(value) => setConfirmedAbsent(value === true)} />Google Chat 방에 메시지가 없음을 확인했습니다</label> : null}
    {status.retryAllowed ? <Button type="button" size="sm" variant="outline" disabled={busy || (status.confirmationRequired && !confirmedAbsent)} onClick={async () => {
      setBusy(true)
      try { setStatus(await retryGoogleChatDelivery(eventId, crypto.randomUUID(), confirmedAbsent)) }
      catch (error) { onWarning(error instanceof Error ? error.message : "Google Chat 재발송을 요청하지 못했습니다.") }
      finally { setBusy(false) }
    }}>Google Chat 재발송</Button> : null}
  </div>
}
