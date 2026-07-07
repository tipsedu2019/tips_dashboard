import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

type PushSubscriptionBody = {
  subscription?: {
    endpoint?: unknown
    keys?: {
      p256dh?: unknown
      auth?: unknown
    }
  }
  endpoint?: unknown
  userAgent?: unknown
}

function text(value: unknown) {
  return String(value || "").trim()
}

async function getAuthenticatedClient(request: Request) {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")

  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return { client: null, user: null, error: "Unauthorized" }
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
  const { data, error } = await client.auth.getUser(token)
  return { client, user: data.user || null, error: error?.message || "" }
}

export async function POST(request: Request) {
  const { client, user } = await getAuthenticatedClient(request)
  if (!client || !user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as PushSubscriptionBody
  const subscription = body.subscription || {}
  const endpoint = text(subscription.endpoint)
  const p256dh = text(subscription.keys?.p256dh)
  const auth = text(subscription.keys?.auth)

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "Invalid push subscription" }, { status: 400 })
  }

  const { error } = await client
    .from("dashboard_push_subscriptions")
    .upsert({
      profile_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: text(body.userAgent || request.headers.get("user-agent")),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "endpoint" })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { client, user } = await getAuthenticatedClient(request)
  if (!client || !user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as PushSubscriptionBody
  const endpoint = text(body.endpoint)
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: "Invalid endpoint" }, { status: 400 })
  }

  const { error } = await client
    .from("dashboard_push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("profile_id", user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
