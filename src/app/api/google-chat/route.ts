import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

type GoogleChatChannel = "executive" | "admin" | "math" | "english"

const GOOGLE_CHAT_WEBHOOK_ENV: Record<GoogleChatChannel, string> = {
  executive: "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  admin: "GOOGLE_CHAT_WEBHOOK_ADMIN",
  math: "GOOGLE_CHAT_WEBHOOK_MATH",
  english: "GOOGLE_CHAT_WEBHOOK_ENGLISH",
}

const GOOGLE_CHAT_WEBHOOK_URL_PREFIX = "https://chat.googleapis.com/"

function text(value: unknown) {
  return String(value || "").trim()
}

function getSupabaseUrl() {
  return text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
}

function getAuthenticatedClient(token: string) {
  const supabaseUrl = getSupabaseUrl()
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  if (!supabaseUrl || !supabaseAnonKey || !token) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

function getServiceClient() {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>

function isGoogleChatWebhookUrl(value: string) {
  return text(value).startsWith(GOOGLE_CHAT_WEBHOOK_URL_PREFIX)
}

function maskSecretSegment(value: string) {
  if (!value) return ""
  if (value.length <= 8) return "..."
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function maskGoogleChatWebhookUrl(value: string) {
  const url = text(value)
  if (!url) return ""

  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split("/").filter(Boolean)
    const maskedSegments = segments.map((segment, index) => (
      segments[index - 1] === "spaces" ? maskSecretSegment(segment) : segment
    ))
    parsed.pathname = `/${maskedSegments.join("/")}`
    parsed.search = parsed.search ? "?key=...&token=..." : ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return maskSecretSegment(url)
  }
}

async function getAuthenticatedContext(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const client = getAuthenticatedClient(token)
  const serviceClient = getServiceClient()

  if (!client || !token) return { user: null, role: "", serviceClient }
  const { data, error } = await client.auth.getUser(token)
  const user = data.user || null
  if (!user?.id || error) return { user: null, role: "", serviceClient }

  let role = ""
  if (serviceClient) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    role = text((profile as { role?: unknown } | null)?.role)
  }

  return { user, role, serviceClient }
}

async function getGoogleChatWebhookUrl(serviceClient: ServiceClient | null, channel: GoogleChatChannel, envName: string) {
  if (serviceClient) {
    const { data } = await serviceClient
      .from("google_chat_webhook_settings")
      .select("webhook_url")
      .eq("channel", channel)
      .maybeSingle()
    const storedUrl = text((data as { webhook_url?: unknown } | null)?.webhook_url)
    if (storedUrl) return storedUrl
  }

  return text(process.env[envName])
}

function canManageGoogleChatWebhooks(role: string) {
  return role === "admin" || role === "staff"
}

export async function GET(request: Request) {
  const { user, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const channel = text(new URL(request.url).searchParams.get("channel")) as GoogleChatChannel
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]
  if (!envName) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const resolvedWebhookUrl = await getGoogleChatWebhookUrl(serviceClient, channel, envName)
  return NextResponse.json({
    ok: true,
    channel,
    envName,
    configured: Boolean(resolvedWebhookUrl),
    maskedUrl: maskGoogleChatWebhookUrl(resolvedWebhookUrl),
  })
}

export async function PATCH(request: Request) {
  const { user, role, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  if (!serviceClient) {
    return NextResponse.json({ ok: false, error: "Missing service role" }, { status: 500 })
  }
  if (!canManageGoogleChatWebhooks(role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const channel = text(body.channel) as GoogleChatChannel
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]
  const webhookUrl = text(body.webhookUrl || body.url)

  if (!envName || !webhookUrl || !isGoogleChatWebhookUrl(webhookUrl)) {
    return NextResponse.json({ ok: false, error: "Invalid Google Chat webhook URL" }, { status: 400 })
  }

  const { error } = await serviceClient
    .from("google_chat_webhook_settings")
    .upsert({
      channel,
      webhook_url: webhookUrl,
      updated_by: user.id,
    }, { onConflict: "channel" })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const resolvedWebhookUrl = await getGoogleChatWebhookUrl(serviceClient, channel, envName)
  return NextResponse.json({
    ok: true,
    channel,
    envName,
    configured: Boolean(resolvedWebhookUrl),
    maskedUrl: maskGoogleChatWebhookUrl(resolvedWebhookUrl),
  })
}

export async function POST(request: Request) {
  const { user, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const channel = text(body.channel) as GoogleChatChannel
  const messageText = text(body.text)
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]

  if (!envName || !messageText) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  const webhookUrl = await getGoogleChatWebhookUrl(serviceClient, channel, envName)
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
