import { createClient } from "@supabase/supabase-js"

import {
  isAllowedGoogleChatWebhookUrl,
  maskGoogleChatWebhookUrl as maskAllowedGoogleChatWebhookUrl,
} from "@/features/notifications/server/notification-connection-crypto"
import { replaceLegacyGoogleChatConnection } from "@/features/notifications/server/notification-connection-repository"
import { readLegacyGoogleChatWebhookUrl } from "@/features/notifications/server/legacy-google-chat-connection"

export const runtime = "nodejs"

type GoogleChatChannel = "executive" | "admin" | "math" | "english"

const GOOGLE_CHAT_WEBHOOK_ENV: Record<GoogleChatChannel, string> = {
  executive: "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  admin: "GOOGLE_CHAT_WEBHOOK_ADMIN",
  math: "GOOGLE_CHAT_WEBHOOK_MATH",
  english: "GOOGLE_CHAT_WEBHOOK_ENGLISH",
}

const DECIMAL_REVISION = /^(0|[1-9]\d*)$/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function text(value: unknown) {
  return String(value || "").trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

async function getAuthenticatedContext(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const client = getAuthenticatedClient(token)
  const serviceClient = getServiceClient()

  if (!client || !token) return { user: null, role: "", client: null, serviceClient }
  const { data, error } = await client.auth.getUser(token)
  const user = data.user || null
  if (!user?.id || error) return { user: null, role: "", client: null, serviceClient }

  let role = ""
  if (serviceClient) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    role = text((profile as { role?: unknown } | null)?.role)
  }

  return { user, role, client, serviceClient }
}

async function getGoogleChatWebhookUrl(serviceClient: ServiceClient | null, channel: GoogleChatChannel, envName: string) {
  return readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: text(process.env[envName]),
    async loadRow() {
      if (!serviceClient) {
        return { found: false, connectionState: null, webhookUrl: null }
      }
      const { data, error } = await serviceClient
        .from("google_chat_webhook_settings")
        .select("webhook_url,connection_state")
        .eq("channel", channel)
        .maybeSingle()
      if (error) throw error
      const row = data as {
        webhook_url?: unknown
        connection_state?: unknown
      } | null
      return {
        found: row !== null,
        connectionState: row ? text(row.connection_state) : null,
        webhookUrl: row ? text(row.webhook_url) : null,
      }
    },
  })
}

function canManageGoogleChatWebhooks(role: string) {
  return role === "admin"
}

function normalizeRevision(value: unknown) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("notification_connection_revision_unsafe")
  }
  const normalized = typeof value === "string" ? value : String(value ?? "")
  if (!DECIMAL_REVISION.test(normalized)) {
    throw new Error("notification_connection_revision_invalid")
  }
  return normalized
}

export async function GET(request: Request) {
  const { user, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return json({ ok: false, error: "Unauthorized" }, 401)
  }

  const channel = text(new URL(request.url).searchParams.get("channel")) as GoogleChatChannel
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]
  if (!envName) {
    return json({ ok: false, error: "Invalid request" }, 400)
  }

  const resolvedWebhookUrl = await getGoogleChatWebhookUrl(serviceClient, channel, envName)
  const configured = isAllowedGoogleChatWebhookUrl(resolvedWebhookUrl)
  return json({
    ok: true,
    channel,
    envName,
    configured,
    maskedUrl: configured ? maskAllowedGoogleChatWebhookUrl(resolvedWebhookUrl) : "",
  })
}

export async function PATCH(request: Request) {
  const { user, role, client, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return json({ ok: false, error: "Unauthorized" }, 401)
  }
  if (!serviceClient || !client) {
    return json({ ok: false, error: "연결 설정을 사용할 수 없습니다." }, 503)
  }
  if (!canManageGoogleChatWebhooks(role)) {
    return json({ ok: false, error: "Forbidden" }, 403)
  }

  const body = await request.json().catch(() => null)
  if (!isRecord(body)) {
    return json({ ok: false, error: "Invalid request" }, 400)
  }
  const channel = text(body.channel) as GoogleChatChannel
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]
  const webhookUrl = text(body.webhookUrl || body.url)

  if (
    Object.keys(body).some((key) => !["channel", "webhookUrl"].includes(key)) ||
    !envName ||
    !webhookUrl ||
    !isAllowedGoogleChatWebhookUrl(webhookUrl)
  ) {
    return json({ ok: false, error: "Invalid Google Chat webhook URL" }, 400)
  }

  const encryptionKey = text(process.env.NOTIFICATION_CONNECTION_ENCRYPTION_KEY)
  if (!encryptionKey) {
    return json({ ok: false, error: "연결 암호화 설정을 사용할 수 없습니다." }, 503)
  }

  try {
    const replaced = await replaceLegacyGoogleChatConnection({
      role,
      userId: user.id,
      channel,
      webhookUrl,
      encryptionKey,
    }, {
      async loadCurrentRevision(targetChannel) {
        const { data, error } = await serviceClient
          .from("google_chat_webhook_settings")
          .select("revision")
          .eq("channel", targetChannel)
          .maybeSingle()
        if (error) throw new Error("notification_connection_unavailable")
        return data ? normalizeRevision(data.revision) : "0"
      },
      async replaceAtomic(input) {
        const { data, error } = await serviceClient.rpc("replace_google_chat_connection_v1", {
          p_actor: input.actorUserId,
          p_channel: input.channel,
          p_webhook_url: input.webhookUrl,
          p_webhook_url_ciphertext: input.webhookUrlCiphertext,
          p_webhook_url_mask: input.webhookUrlMask,
          p_expected_revision: input.expectedRevision,
          p_request_id: input.requestId,
        })
        if (error) throw new Error("notification_connection_replace_failed")
        return (data ?? {}) as {
          connection_key?: unknown
          connection_state?: unknown
          revision?: unknown
          configured?: unknown
          webhook_url_mask?: unknown
        }
      },
    })
    return json({
      ok: true,
      channel,
      envName,
      configured: replaced.configured,
      maskedUrl: replaced.maskedUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    const status = message === "notification_access_denied"
      ? 403
      : message.includes("revision")
        ? 409
        : message.includes("invalid")
          ? 400
          : 503
    return json({ ok: false, error: "웹훅 URL을 안전하게 저장하지 못했습니다." }, status)
  }
}

export async function POST(request: Request) {
  const { user, serviceClient } = await getAuthenticatedContext(request)
  if (!user?.id) {
    return json({ ok: false, error: "Unauthorized" }, 401)
  }

  const body = await request.json().catch(() => null)
  if (!isRecord(body)) {
    return json({ ok: false, error: "Invalid request" }, 400)
  }
  const channel = text(body.channel) as GoogleChatChannel
  const messageText = text(body.text)
  const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]

  if (!envName || !messageText) {
    return json({ ok: false, error: "Invalid request" }, 400)
  }

  const webhookUrl = await getGoogleChatWebhookUrl(serviceClient, channel, envName)
  if (!webhookUrl) {
    return json({ ok: true, skipped: true })
  }
  if (!isAllowedGoogleChatWebhookUrl(webhookUrl)) {
    return json({ ok: false, error: "Google Chat 연결 설정이 올바르지 않습니다." }, 503)
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: messageText }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    return json({ ok: false, error: "Google Chat 전송에 실패했습니다." }, 502)
  }

  return json({ ok: true })
}
