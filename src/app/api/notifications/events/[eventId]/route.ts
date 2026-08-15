import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { "Cache-Control": "no-store" }

function actorClient(request: Request) {
  const authorization = request.headers.get("authorization") || ""
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "")
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")
  if (!authorization.startsWith("Bearer ") || !url || !key) return null
  return createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } })
}

export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params
  const client = actorClient(request)
  if (!client) return NextResponse.json({ code: "notification_unauthorized" }, { status: 401, headers })
  if (!UUID.test(eventId)) return NextResponse.json({ code: "notification_invalid_request" }, { status: 400, headers })
  const { data, error } = await client.rpc("get_google_chat_notification_event_status_v1", { p_event_id: eventId })
  if (error) return NextResponse.json({ code: "notification_delivery_read_failed" }, { status: error.code === "42501" ? 403 : 400, headers })
  return NextResponse.json(data, { headers })
}
