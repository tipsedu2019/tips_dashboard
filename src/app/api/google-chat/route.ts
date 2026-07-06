import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

type GoogleChatChannel = "executive" | "admin" | "math" | "english"

const GOOGLE_CHAT_WEBHOOK_ENV: Record<GoogleChatChannel, string> = {
  executive: "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  admin: "GOOGLE_CHAT_WEBHOOK_ADMIN",
  math: "GOOGLE_CHAT_WEBHOOK_MATH",
  english: "GOOGLE_CHAT_WEBHOOK_ENGLISH",
}

function text(value: unknown) {
  return String(value || "").trim()
}

async function assertAuthenticated(request: Request) {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")

  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return false
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
  const { data, error } = await client.auth.getUser(token)
  return Boolean(data.user?.id && !error)
}

export async function POST(request: Request) {
  const isAuthenticated = await assertAuthenticated(request)
  if (!isAuthenticated) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const channel = text(body.channel) as GoogleChatChannel
  const messageText = text(body.text)
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]

  if (!envName || !messageText) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const webhookUrl = text(process.env[envName])
  if (!webhookUrl) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: messageText }),
  })

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, error: await response.text() },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
