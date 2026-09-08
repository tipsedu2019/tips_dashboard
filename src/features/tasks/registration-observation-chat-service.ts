export type RegistrationObservationChatIntent = "handoff" | "feedback_request"
export type RegistrationObservationChatPreview = Readonly<{
  observationId: string
  intent: RegistrationObservationChatIntent
  status: "ready" | "sent" | "failed" | "unknown"
  canSend: boolean
  targetLabel: string
  renderedTitle: string
  renderedBody: string
  previewChecksum: string
}>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function parseRegistrationObservationChatPreview(value: unknown): RegistrationObservationChatPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("청강 전달 정보를 확인하지 못했습니다.")
  const row = value as Record<string, unknown>
  if (typeof row.observationId !== "string" || !UUID.test(row.observationId)
    || !["handoff", "feedback_request"].includes(String(row.intent))
    || !["ready", "sent", "failed", "unknown"].includes(String(row.status))
    || typeof row.canSend !== "boolean"
    || row.canSend !== ["ready", "failed"].includes(String(row.status))
    || [row.targetLabel, row.renderedTitle, row.renderedBody].some((v) => typeof v !== "string" || !v.trim())
    || typeof row.previewChecksum !== "string" || !/^[a-f0-9]{64}$/.test(row.previewChecksum)) {
    throw new Error("청강 전달 정보를 확인하지 못했습니다.")
  }
  return { observationId: row.observationId, intent: row.intent as RegistrationObservationChatIntent,
    status: row.status as RegistrationObservationChatPreview["status"], canSend: row.canSend,
    targetLabel: row.targetLabel as string, renderedTitle: row.renderedTitle as string,
    renderedBody: row.renderedBody as string, previewChecksum: row.previewChecksum }
}
export function createRegistrationObservationChatService(transport: typeof fetch = fetch, timeoutMs = 15_000) {
  const endpoint = "/api/registration/observation-chat"
  async function result(response: Response) {
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.ok !== true) throw new Error(body?.error || "청강 알림 요청을 처리하지 못했습니다.")
    return body
  }
  async function request(url: string, init: RequestInit) {
    const controller = new AbortController()
    const signal = init.signal
    let cancel = () => {}
    const canceled = new Promise<never>((_, reject) => {
      cancel = () => {
        controller.abort(signal?.reason)
        reject(signal?.reason || new DOMException("Request canceled", "AbortError"))
      }
      signal?.addEventListener("abort", cancel, { once: true })
    })
    try {
      if (signal?.aborted) { cancel(); return await canceled }
      return await withPromiseTimeout(Promise.race([transport(url, { ...init, signal: controller.signal }).then(result), canceled]), {
        timeoutMs, code: init.method === "POST" ? "registration_observation_chat_send_timeout" : "registration_observation_chat_preview_timeout",
        message: init.method === "POST" ? "전달 결과를 확인할 수 없습니다. 전달 상태를 다시 확인해 주세요." : "알림 내용을 불러오는 시간이 초과되었습니다. 다시 확인해 주세요.",
      })
    } finally { signal?.removeEventListener("abort", cancel); controller.abort() }
  }
  return {
    async preview(observationId: string, intent: RegistrationObservationChatIntent, token: string, signal?: AbortSignal) {
      const body = await request(`${endpoint}?${new URLSearchParams({ observationId, intent })}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
      })
      const preview = parseRegistrationObservationChatPreview(body.preview)
      if (preview.observationId !== observationId || preview.intent !== intent) throw new Error("청강 전달 대상이 변경되었습니다.")
      return preview
    },
    async send(preview: RegistrationObservationChatPreview, token: string, requestId: string, signal?: AbortSignal) {
      if (!preview.canSend || !UUID.test(requestId)) throw new Error("현재 상태에서는 청강 알림을 보낼 수 없습니다.")
      const body = await request(endpoint, { method: "POST", signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ observationId: preview.observationId, intent: preview.intent,
          previewChecksum: preview.previewChecksum, requestId, confirmed: true }),
      })
      if (!["sent", "failed", "unknown"].includes(body.status)) throw new Error("청강 알림의 전달 결과를 다시 확인해 주세요.")
      return body.status as "sent" | "failed" | "unknown"
    },
  }
}
import { withPromiseTimeout } from "../../lib/promise-timeout.ts"
