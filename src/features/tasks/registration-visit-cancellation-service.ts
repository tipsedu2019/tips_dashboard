export type RegistrationVisitCancellation = Readonly<{
  appointmentId: string
  notificationRevision: number
  status: "ready" | "failed" | "sent" | "unknown" | "not_needed" | "blocked" | "not_canceled"
  reason: string
  canSend: boolean
  scheduledAt: string | null
  sourceDeliveryId?: string
  sourceSentAt?: string | null
  sourceTitle?: string
  sourceBody?: string
  targetLabel?: string
  renderedTitle?: string
  renderedBody?: string
  previewChecksum?: string
}>

export type RegistrationVisitCancellationPage = Readonly<{
  items: ReadonlyArray<RegistrationVisitCancellation>
  page: number
  pageSize: 10 | 15 | 20
  totalCount: number
}>

const ENDPOINT = "/api/registration/consultation-cancellation-notification"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ITEM_KEYS = new Set(["appointmentId", "notificationRevision", "status", "reason", "canSend", "scheduledAt", "sourceDeliveryId", "sourceSentAt", "sourceTitle", "sourceBody", "targetLabel", "renderedTitle", "renderedBody", "previewChecksum"])

export function parseRegistrationVisitCancellationPage(value: unknown, page: number, pageSize: 10 | 15 | 20): RegistrationVisitCancellationPage {
  const invalid = (): never => { throw new Error("취소 안내 목록을 확인하지 못했습니다.") }
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid()
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).some((key) => !["items", "page", "pageSize", "totalCount", "ok"].includes(key))
    || payload.page !== page || payload.pageSize !== pageSize
    || !Number.isSafeInteger(payload.totalCount) || Number(payload.totalCount) < 0
    || !Array.isArray(payload.items) || payload.items.length > pageSize || payload.items.length > Number(payload.totalCount)) return invalid()
  const ids = new Set<string>()
  const items = payload.items.map((item): RegistrationVisitCancellation => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => !ITEM_KEYS.has(key))
      || typeof item.appointmentId !== "string" || !UUID.test(item.appointmentId) || ids.has(item.appointmentId)
      || !Number.isInteger(item.notificationRevision) || item.notificationRevision < 1
      || !["ready", "failed", "sent", "unknown", "not_needed", "blocked", "not_canceled"].includes(item.status)
      || typeof item.reason !== "string" || typeof item.canSend !== "boolean"
      || (item.canSend && !["ready", "failed"].includes(item.status))
      || !(item.scheduledAt === null || (typeof item.scheduledAt === "string" && Number.isFinite(Date.parse(item.scheduledAt))))
      || (item.sourceDeliveryId !== undefined && !UUID.test(item.sourceDeliveryId))
      || (item.previewChecksum !== undefined && !/^[a-f0-9]{64}$/.test(item.previewChecksum))
      || (item.canSend && (!item.sourceDeliveryId || !item.previewChecksum || !item.renderedTitle || !item.renderedBody))) return invalid()
    for (const key of ["sourceTitle", "sourceBody", "targetLabel", "renderedTitle", "renderedBody"]) {
      if (item[key] !== undefined && typeof item[key] !== "string") return invalid()
    }
    ids.add(item.appointmentId)
    return item
  })
  return { items, page, pageSize, totalCount: Number(payload.totalCount) }
}

export function createRegistrationVisitCancellationService(transport: typeof fetch = fetch, timeoutMs = 15_000) {
  async function read(response: Response) {
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error(response.status === 409
        ? "취소 안내 정보가 변경되었습니다. 목록을 새로 확인한 뒤 보내세요."
        : payload?.error || "방문상담 취소 안내를 처리하지 못했습니다.")
    }
    return payload
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
      return await withPromiseTimeout(Promise.race([transport(url, { ...init, signal: controller.signal }).then(read), canceled]), {
        timeoutMs, code: init.method === "POST" ? "registration_visit_cancellation_send_timeout" : "registration_visit_cancellation_list_timeout",
        message: init.method === "POST" ? "취소 안내의 전달 결과를 확인할 수 없습니다. 목록에서 전달 상태를 다시 확인해 주세요." : "취소 안내 목록을 불러오는 시간이 초과되었습니다. 다시 확인해 주세요.",
      })
    } finally { signal?.removeEventListener("abort", cancel); controller.abort() }
  }
  return {
    async list(taskId: string, token: string, page = 1, pageSize: 10 | 15 | 20 = 10, signal?: AbortSignal): Promise<RegistrationVisitCancellationPage> {
      const parameters = new URLSearchParams({ taskId, page: String(page), pageSize: String(pageSize) })
      const payload = await request(`${ENDPOINT}?${parameters}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
      })
      return parseRegistrationVisitCancellationPage(payload, page, pageSize)
    },
    async send(item: RegistrationVisitCancellation, token: string, requestKey: string, signal?: AbortSignal) {
      if (!item.canSend || !["ready", "failed"].includes(item.status)
        || !item.sourceDeliveryId || !item.previewChecksum) {
        throw new Error("현재 상태에서는 취소 안내를 보낼 수 없습니다.")
      }
      return request(ENDPOINT, { signal,
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: item.appointmentId, notificationRevision: item.notificationRevision,
          sourceDeliveryId: item.sourceDeliveryId, previewChecksum: item.previewChecksum,
          requestKey, intent: "send_registration_visit_cancellation",
        }),
      })
    },
  }
}
import { withPromiseTimeout } from "../../lib/promise-timeout.ts"
