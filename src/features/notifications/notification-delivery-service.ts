import { supabase } from "@/lib/supabase"

export type GoogleChatDeliveryStatus = {
  eventId: string
  status: "processing" | "delayed" | "sent" | "failed" | "unknown" | "not_applicable"
  updatedAt: string | null
  reasonCode: string | null
  retryAllowed: boolean
  confirmationRequired: boolean
  sentCount: number
  totalCount: number
}

function mapStatus(value: unknown): GoogleChatDeliveryStatus {
  const row = value as Record<string, unknown>
  const status = String(row?.status || "")
  if (!["processing", "delayed", "sent", "failed", "unknown", "not_applicable"].includes(status)) throw new Error("notification_delivery_response_invalid")
  return {
    eventId: String(row.event_id || ""), status: status as GoogleChatDeliveryStatus["status"],
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    reasonCode: typeof row.reason_code === "string" ? row.reason_code : null,
    retryAllowed: row.retry_allowed === true, confirmationRequired: row.confirmation_required === true,
    sentCount: Number(row.sent_count || 0), totalCount: Number(row.total_count || 0),
  }
}

function mapEventStatus(value: unknown, eventId: string) {
  const status = mapStatus(value)
  if (status.eventId !== eventId) throw new Error("notification_delivery_response_invalid")
  return status
}

async function token() {
  if (!supabase) throw new Error("notification_unavailable")
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw new Error("notification_unauthorized")
  return data.session.access_token
}

export async function readGoogleChatDeliveryStatus(eventId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/notifications/events/${eventId}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store", signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(String(body?.code || "notification_delivery_read_failed"))
  return mapEventStatus(body, eventId)
}

export async function retryGoogleChatDelivery(eventId: string, requestId: string, confirmedAbsent: boolean) {
  const response = await fetch(`/api/notifications/events/${eventId}/retry`, {
    method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, confirmedAbsent }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(String(body?.code || "notification_delivery_retry_failed"))
  return mapEventStatus(body, eventId)
}
