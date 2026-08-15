import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const responseHeaders = { "Cache-Control": "no-store" }

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params
  const authorization = request.headers.get("authorization") || ""
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "")
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")
  if (!authorization.startsWith("Bearer ") || !url || !key) return NextResponse.json({ code: "notification_unauthorized" }, { status: 401, headers: responseHeaders })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Object.keys(body).sort().join() !== ["requestId", "confirmedAbsent"].sort().join()
    || !UUID.test(eventId) || typeof body.requestId !== "string" || !UUID.test(body.requestId)
    || typeof body.confirmedAbsent !== "boolean") {
    return NextResponse.json({ code: "notification_invalid_request" }, { status: 400, headers: responseHeaders })
  }
  const client = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } })
  const { data, error } = await client.rpc("retry_google_chat_notification_event_v1", {
    p_event_id: eventId, p_request_id: body.requestId, p_confirmed_absent: body.confirmedAbsent,
  })
  if (error) return NextResponse.json({ code: "notification_delivery_retry_failed" }, { status: error.code === "42501" ? 403 : 400, headers: responseHeaders })
  return NextResponse.json(data, { headers: responseHeaders })
}
