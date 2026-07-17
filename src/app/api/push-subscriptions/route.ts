import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { validateWebPushEndpoint } from "@/features/notifications/server/web-push-endpoint"

export const runtime = "nodejs"

type JsonRecord = Record<string, unknown>

const HTTPS_ENDPOINT_MAX_LENGTH = 4_096
const PUSH_KEY_MAX_LENGTH = 1_024
const USER_AGENT_MAX_LENGTH = 512

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: JsonRecord,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys,
) {
  const actualKeys = Object.keys(value)
  return actualKeys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function endpointText(value: unknown) {
  const endpoint = text(value)
  if (!endpoint || endpoint.length > HTTPS_ENDPOINT_MAX_LENGTH) return ""
  try {
    return validateWebPushEndpoint(endpoint)
  } catch {
    return ""
  }
}

function pushKey(value: unknown) {
  const key = text(value)
  return key
    && key.length <= PUSH_KEY_MAX_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(key)
    ? key
    : ""
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function invalidRequest() {
  return json({
    ok: false,
    code: "push_subscription_invalid_request",
    message: "푸시 구독 요청 형식이 올바르지 않습니다.",
  }, 400)
}

function unavailable() {
  return json({
    ok: false,
    code: "push_subscription_store_unavailable",
    message: "푸시 구독 정보를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  }, 503)
}

function unauthorized() {
  return json({
    ok: false,
    code: "push_subscription_unauthorized",
    message: "로그인 정보를 확인한 뒤 다시 시도해 주세요.",
  }, 401)
}

async function getAuthenticatedClient(request: Request) {
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const supabaseAnonKey = text(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  )
  const authorization = request.headers.get("authorization") || ""
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] || ""

  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return { client: null, user: null }
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  return { client, user: error ? null : data.user || null }
}

export async function POST(request: Request) {
  const { client, user } = await getAuthenticatedClient(request)
  if (!client || !user?.id) {
    return unauthorized()
  }

  const body = await request.json().catch(() => null)
  if (
    !isRecord(body)
    || !exactKeys(body, ["action", "subscription", "userAgent"], ["subscription"])
    || (Object.prototype.hasOwnProperty.call(body, "action") && body.action !== "rebind")
  ) {
    return invalidRequest()
  }
  if (Object.prototype.hasOwnProperty.call(body, "userAgent") && typeof body.userAgent !== "string") {
    return invalidRequest()
  }

  const subscription = body.subscription
  if (
    !isRecord(subscription)
    || !exactKeys(subscription, ["endpoint", "expirationTime", "keys"], ["endpoint", "keys"])
    || (Object.prototype.hasOwnProperty.call(subscription, "expirationTime")
      && subscription.expirationTime !== null
      && (typeof subscription.expirationTime !== "number"
        || !Number.isFinite(subscription.expirationTime)
        || subscription.expirationTime < 0))
    || !isRecord(subscription.keys)
    || !exactKeys(subscription.keys, ["p256dh", "auth"])
  ) {
    return invalidRequest()
  }

  const endpoint = endpointText(subscription.endpoint)
  const p256dh = pushKey(subscription.keys.p256dh)
  const auth = pushKey(subscription.keys.auth)
  if (!endpoint || !p256dh || !auth) return invalidRequest()

  const userAgent = text(body.userAgent || request.headers.get("user-agent"))
    .slice(0, USER_AGENT_MAX_LENGTH)
  if (body.action === "rebind") {
    const { data, error } = await client.rpc("rebind_dashboard_push_subscription_v1", {
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: userAgent,
    })
    const status = isRecord(data) && (data.status === "current" || data.status === "rebound")
      ? data.status
      : null
    if (error || !status) return unavailable()
    return json({ ok: true, status })
  }

  const row = {
    profile_id: user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: userAgent,
    last_seen_at: new Date().toISOString(),
  }

  const { data: ownedRow, error: ownershipReadError } = await client
    .from("dashboard_push_subscriptions")
    .select("profile_id")
    .eq("endpoint", endpoint)
    .eq("profile_id", user.id)
    .maybeSingle()
  if (ownershipReadError) {
    return unavailable()
  }

  const mutation = ownedRow
    ? client
      .from("dashboard_push_subscriptions")
      .upsert(row, { onConflict: "endpoint" })
    : client
      .from("dashboard_push_subscriptions")
      .insert(row)
  const { error } = await mutation

  if (error && !ownedRow) {
    const { data: racedOwnedRow } = await client
      .from("dashboard_push_subscriptions")
      .select("profile_id")
      .eq("endpoint", endpoint)
      .eq("profile_id", user.id)
      .maybeSingle()
    if (racedOwnedRow) {
      const { error: retryError } = await client
        .from("dashboard_push_subscriptions")
        .upsert(row, { onConflict: "endpoint" })
      if (!retryError) return json({ ok: true })
    }
    const conflictCode = (error as { code?: unknown })?.code
    if (conflictCode === "23505" || conflictCode === "42501") {
      return json({
        ok: false,
        code: "push_subscription_owner_conflict",
        message: "이 브라우저의 푸시 구독은 다른 계정에 연결되어 있습니다.",
      }, 409)
    }
    return unavailable()
  }
  if (error) {
    return unavailable()
  }

  return json({ ok: true })
}

export async function DELETE(request: Request) {
  const { client, user } = await getAuthenticatedClient(request)
  if (!client || !user?.id) {
    return unauthorized()
  }

  const body = await request.json().catch(() => null)
  if (!isRecord(body) || !exactKeys(body, ["endpoint"])) return invalidRequest()

  const endpoint = endpointText(body.endpoint)
  if (!endpoint) return invalidRequest()

  const { data, error } = await client
    .from("dashboard_push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("profile_id", user.id)
    .select("id")

  if (error || !Array.isArray(data) || data.length > 1) {
    return unavailable()
  }
  return json({ ok: true, deleted: data.length === 1 })
}
