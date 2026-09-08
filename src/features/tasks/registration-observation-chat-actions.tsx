"use client"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { withPromiseTimeout } from "@/lib/promise-timeout"
import { createRegistrationObservationChatService, type RegistrationObservationChatIntent, type RegistrationObservationChatPreview } from "./registration-observation-chat-service"

const defaultService = createRegistrationObservationChatService()
async function defaultAccessToken() {
  const { supabase } = await import("@/lib/supabase")
  const result = await withPromiseTimeout(Promise.resolve(supabase?.auth.getSession()), {
    timeoutMs: 15_000, code: "registration_observation_chat_auth_timeout", message: "로그인 상태를 확인하는 시간이 초과되었습니다. 다시 시도해 주세요.",
  })
  const token = result?.data.session?.access_token
  if (!token) throw new Error("로그인 상태를 다시 확인해 주세요.")
  return token
}
type Props = { observationId: string; disabled?: boolean; feedbackAvailable?: boolean; service?: typeof defaultService; getAccessToken?: () => Promise<string> }

export function RegistrationObservationChatActions(props: Props) {
  return <ObservationChatActionsScope key={props.observationId} {...props} />
}

function ObservationChatActionsScope({ observationId, disabled = false, feedbackAvailable = true,
  service = defaultService, getAccessToken = defaultAccessToken,
}: Props) {
  const [intent, setIntent] = useState<RegistrationObservationChatIntent | null>(null)
  const [preview, setPreview] = useState<RegistrationObservationChatPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState("")
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const busy = useRef(false)
  const requestIds = useRef(new Map<string, string>())
  const trigger = useRef<HTMLButtonElement | null>(null)
  const sendController = useRef<AbortController | null>(null)
  const currentlyDisabled = useRef(disabled)
  currentlyDisabled.current = disabled
  useEffect(() => {
    return () => { generation.current += 1; sendController.current?.abort() }
  }, [])
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let previousUser: string | undefined
    if (getAccessToken !== defaultAccessToken) return
    void import("@/lib/supabase").then(({ supabase }) => {
      if (disposed || !supabase || typeof supabase.auth.onAuthStateChange !== "function") return
      const subscription = supabase.auth.onAuthStateChange((_event, session) => {
        const nextUser = session?.user.id || ""
        if (previousUser !== undefined && previousUser !== nextUser) {
          generation.current += 1
          sendController.current?.abort()
          setIntent(null); setPreview(null); setError(""); setReceipt("")
          setSending(false); setLoading(false)
          requestIds.current.clear()
        }
        previousUser = nextUser
      })
      unsubscribe = () => subscription.data.subscription.unsubscribe()
    })
    return () => { disposed = true; unsubscribe?.() }
  }, [getAccessToken])
  useEffect(() => {
    if (!intent) return
    const controller = new AbortController()
    const current = ++generation.current
    setLoading(true); setPreview(null); setError("")
    void getAccessToken().then((token) => {
      if (controller.signal.aborted || current !== generation.current) throw new DOMException("Request canceled", "AbortError")
      return service.preview(observationId, intent, token, controller.signal)
    })
      .then((result) => { if (generation.current === current) setPreview(result) })
      .catch((e) => { if (generation.current === current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "청강 알림을 불러오지 못했습니다.") })
      .finally(() => { if (generation.current === current) setLoading(false) })
    return () => { generation.current += 1; controller.abort() }
  }, [intent, observationId, service, getAccessToken, refresh])
  async function send() {
    if (!preview?.canSend || busy.current || currentlyDisabled.current) return
    busy.current = true; setSending(true); setError("")
    const current = generation.current
    const key = `${preview.observationId}:${preview.intent}:${preview.previewChecksum}`
    const requestId = requestIds.current.get(key) || crypto.randomUUID()
    requestIds.current.set(key, requestId)
    const controller = new AbortController()
    sendController.current = controller
    try {
      const token = await getAccessToken()
      if (current !== generation.current || controller.signal.aborted || currentlyDisabled.current) return
      const status = await service.send(preview, token, requestId, controller.signal)
      if (current !== generation.current) return
      setPreview({ ...preview, status, canSend: status === "failed" })
      if (status === "failed") requestIds.current.delete(key)
      const text = status === "sent" ? "청강 알림을 전달했습니다." : status === "unknown" ? "전달 결과를 확인할 수 없습니다. 중복 전송을 막기 위해 다시 보내지 않습니다." : "알림이 전달되지 않았습니다. 내용을 확인한 뒤 다시 시도할 수 있습니다."
      setReceipt(text)
    } catch (e) {
      if (current === generation.current) {
        if (e instanceof Error && "code" in e && e.code === "registration_observation_chat_send_timeout") {
          setPreview({ ...preview, status: "unknown", canSend: false })
          setReceipt("전달 결과를 확인할 수 없습니다. 전달 상태를 다시 확인한 뒤 진행해 주세요.")
        } else {
          setError(e instanceof Error ? e.message : "전달 결과를 다시 확인해 주세요.")
          setPreview(null)
        }
      }
    } finally {
      if (sendController.current === controller) {
        busy.current = false
        sendController.current = null
        if (current === generation.current) setSending(false)
      }
    }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {([ ["handoff", "청강 담당 전달"], ["feedback_request", "청강 피드백 요청"] ] as const).map(([value, label]) =>
        <Button key={value} type="button" variant="outline" disabled={disabled || sending || (value === "feedback_request" && !feedbackAvailable)}
          title={value === "feedback_request" && !feedbackAvailable ? "수업 종료 후 요청할 수 있습니다." : undefined}
          onClick={(event) => { trigger.current = event.currentTarget; setReceipt(""); setIntent(value) }}>{label}</Button>)}
    </div>
    {receipt && !intent ? <p role="status" className="text-sm">{receipt}</p> : null}
    <Dialog open={intent !== null} onOpenChange={(open) => { if (!open && !busy.current) setIntent(null) }}>
      <DialogContent className="z-[95] max-h-[85dvh] overflow-y-auto" overlayClassName="z-[95]" showCloseButton={!sending} closeButtonLabel="청강 알림 미리보기 닫기"
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader><DialogTitle>{intent === "feedback_request" ? "청강 피드백 요청" : "청강 담당 전달"}</DialogTitle>
          <DialogDescription>받는 선생님과 내용을 확인한 뒤 Google Chat으로 전달합니다.</DialogDescription></DialogHeader>
        {loading ? <p role="status">알림 내용을 불러오는 중입니다.</p> : null}
        {preview ? <div className="space-y-3 text-sm"><p className="font-medium">{preview.targetLabel}</p>
          <div className="whitespace-pre-wrap rounded-md border p-3">{preview.renderedBody}</div>
          {!receipt && preview.status === "sent" ? <p role="status">이미 전달한 알림입니다.</p> : !receipt && preview.status === "unknown" ? <p role="status">전달 결과 확인이 필요합니다. 중복 알림은 보내지 않습니다.</p> : null}</div> : null}
        {error ? <div role="alert" className="space-y-1 text-sm text-destructive"><p>{error}</p>
          {error.includes("계정 연결") ? <a className="underline underline-offset-4" href="/admin/settings/teachers#teacher-google-chat-identity-title">선생님 Google Chat 계정 확인</a>
            : error.includes("Chat 연결") ? <a className="underline underline-offset-4" href="/admin/settings/notifications?workflow=registration&section=connections">수신 채팅방 설정</a> : null}
        </div> : null}
        {receipt ? <p role="status" className="text-sm">{receipt}</p> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={sending} onClick={() => setIntent(null)}>닫기</Button>
          {(error || preview?.status === "unknown") ? <Button type="button" variant="outline" disabled={loading || sending} onClick={() => { setReceipt(""); setRefresh((value) => value + 1) }}>전달 상태 다시 확인</Button> : null}
          <Button type="button" disabled={disabled || loading || sending || !preview?.canSend} onClick={() => void send()}>{sending ? "전달 중" : "확인하고 전달"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
