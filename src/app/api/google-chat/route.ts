import { createClient } from "@supabase/supabase-js"
import { createHash, randomUUID } from "node:crypto"

import { POST as dispatchLegacyMakeupSource } from "@/app/api/notifications/legacy/makeup/route"
import { POST as dispatchLegacyOpsTaskSource } from "@/app/api/notifications/legacy/ops-task/route"
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GIT_COMMIT_SHA = /^[a-f0-9]{40}$/
const NOTIFICATION_CONTRACT_VERSION = "2"

function currentNotificationBuildRevisionHash() {
  const revision = text(process.env.VERCEL_GIT_COMMIT_SHA)
  return GIT_COMMIT_SHA.test(revision)
    ? createHash("sha256").update(revision, "utf8").digest("hex")
    : ""
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Notification-Contract-Version": NOTIFICATION_CONTRACT_VERSION,
    },
  })
}

function contractResponse(response: Response) {
  const headers = new Headers(response.headers)
  headers.set("X-Notification-Contract-Version", NOTIFICATION_CONTRACT_VERSION)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function classifyNotificationContractRouteResponse(response: Response) {
  if (!response.ok) return "failed" as const
  const result = await response.clone().json().catch(() => null)
  if (!isRecord(result) || result.ok !== true) return "failed" as const
  const sent = result.sent
  const deduped = result.deduped
  const failed = result.failed
  if (
    !Number.isSafeInteger(sent)
    || !Number.isSafeInteger(deduped)
    || !Number.isSafeInteger(failed)
    || Number(sent) < 0
    || Number(deduped) < 0
    || Number(failed) < 0
  ) return "failed" as const
  const sentCount = Number(sent)
  const dedupedCount = Number(deduped)
  const failedCount = Number(failed)
  if (failedCount > 0) return "failed" as const
  return sentCount + dedupedCount > 0 ? "succeeded" as const : "failed" as const
}

function sourceRequest(request: Request, sourceEventId: string) {
  return new Request(request.url, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("authorization") || "",
      "Content-Type": "application/json",
      "X-Notification-Contract-Version": NOTIFICATION_CONTRACT_VERSION,
    },
    body: JSON.stringify({ sourceEventId }),
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

type NotificationContractFixedRoute =
  | "/api/notifications/legacy/ops-task"
  | "/api/notifications/legacy/makeup"

async function recordNotificationContractTraffic(input: {
  serviceClient: ServiceClient
  actorProfileId: string
  requestId: string
  contractKind: "legacy_untranslatable"
  outcome: "observed" | "rejected"
}) {
  const { data, error } = await input.serviceClient.rpc("record_notification_contract_traffic_v1", {
    p_entry_point: "google_chat",
    p_contract_kind: input.contractKind,
    p_outcome: input.outcome,
    p_actor_profile_id: input.actorProfileId,
    p_request_id: input.requestId,
  })
  const recorded = isRecord(data) ? data : null
  if (error || recorded?.recorded !== true || typeof recorded.closed !== "boolean") {
    throw new Error("notification_contract_telemetry_unavailable")
  }
  return { closed: recorded.closed }
}

async function beginNotificationContractV2Route(input: {
  serviceClient: ServiceClient
  actorProfileId: string
  requestId: string
  sourceEventId: string
  buildRevisionHash: string
}) {
  const { data, error } = await input.serviceClient.rpc("begin_notification_contract_v2_route_v1", {
    p_source_event_id: input.sourceEventId,
    p_actor_profile_id: input.actorProfileId,
    p_request_id: input.requestId,
    p_build_revision_hash: input.buildRevisionHash,
  })
  const started = isRecord(data) ? data : null
  if (
    error
    || started?.recorded !== true
    || typeof started.translatable !== "boolean"
    || started.buildRevisionHash !== input.buildRevisionHash
  ) {
    throw new Error("notification_contract_telemetry_unavailable")
  }
  if (started.translatable !== true) {
    if (started.outcome !== "translator_failed") {
      throw new Error("notification_contract_telemetry_unavailable")
    }
    return { translatable: false as const, route: null }
  }
  if (
    started.route !== "/api/notifications/legacy/ops-task"
    && started.route !== "/api/notifications/legacy/makeup"
  ) {
    throw new Error("notification_contract_telemetry_unavailable")
  }
  return {
    translatable: true as const,
    route: started.route as NotificationContractFixedRoute,
  }
}

async function recordNotificationContractRouteOutcome(input: {
  serviceClient: ServiceClient
  requestId: string
  fixedRoute: NotificationContractFixedRoute
  outcome: "succeeded" | "failed"
  responseStatus: number
  buildRevisionHash: string
}) {
  const { data, error } = await input.serviceClient.rpc("record_notification_contract_route_outcome_v1", {
    p_request_id: input.requestId,
    p_fixed_route: input.fixedRoute,
    p_outcome: input.outcome,
    p_response_status: input.responseStatus,
    p_build_revision_hash: input.buildRevisionHash,
  })
  const recorded = isRecord(data) ? data : null
  if (
    error
    || recorded?.recorded !== true
    || recorded.requestId !== input.requestId
    || recorded.buildRevisionHash !== input.buildRevisionHash
  ) {
    throw new Error("notification_contract_outcome_unavailable")
  }
}

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
  if (!serviceClient) {
    return json({ ok: false, error: "알림 저장소를 사용할 수 없습니다." }, 503)
  }

  const body = await request.json().catch(() => null)
  const sourceEventId = isRecord(body) ? text(body.sourceEventId) : ""
  const isV2SourceContract = isRecord(body)
    && Object.keys(body).length === 1
    && Object.keys(body)[0] === "sourceEventId"
    && UUID.test(sourceEventId)
  const requestId = randomUUID()

  if (!isV2SourceContract) {
    const channel = isRecord(body) ? text(body.channel) as GoogleChatChannel : "" as GoogleChatChannel
    const messageText = isRecord(body) ? text(body.text) : ""
    const envName = GOOGLE_CHAT_WEBHOOK_ENV[channel]
    const validLegacyContract = Boolean(envName && messageText)

    try {
      const closure = await recordNotificationContractTraffic({
        serviceClient,
        actorProfileId: user.id,
        requestId,
        contractKind: "legacy_untranslatable",
        outcome: validLegacyContract ? "observed" : "rejected",
      })
      if (closure.closed) {
        return json({
          ok: false,
          code: "notification_payload_forbidden",
          contractVersion: NOTIFICATION_CONTRACT_VERSION,
        }, 422)
      }
    } catch {
      return json({ ok: false, error: "알림 계약 계측을 사용할 수 없습니다." }, 503)
    }

    if (!validLegacyContract) {
      return json({ ok: false, error: "Invalid request" }, 400)
    }

    // 구형 번들의 raw payload는 관찰만 한다. 실제 전송은 같은 업무 변경에서
    // 생성된 canonical source event와 고정 legacy route가 담당한다. 여기서 다시
    // provider를 호출하면 소유권/멱등성 없이 중복 외부 전송이 가능해진다.
    return json({
      ok: true,
      skipped: true,
      reason: "legacy_payload_observed",
      compatibilityPath: true,
    })
  }

  const buildRevisionHash = currentNotificationBuildRevisionHash()
  if (!buildRevisionHash) {
    return json({ ok: false, error: "운영 빌드 식별자를 확인할 수 없습니다." }, 503)
  }

  let startedRoute: Awaited<ReturnType<typeof beginNotificationContractV2Route>>
  try {
    startedRoute = await beginNotificationContractV2Route({
      serviceClient,
      actorProfileId: user.id,
      requestId,
      sourceEventId,
      buildRevisionHash,
    })
  } catch {
    return json({ ok: false, error: "알림 계약 계측을 사용할 수 없습니다." }, 503)
  }
  if (!startedRoute.translatable) {
    return json({
      ok: false,
      code: "notification_payload_forbidden",
      contractVersion: NOTIFICATION_CONTRACT_VERSION,
    }, 422)
  }

  let routeResponse: Response
  try {
    if (startedRoute.route === "/api/notifications/legacy/ops-task") {
      routeResponse = await dispatchLegacyOpsTaskSource(sourceRequest(request, sourceEventId))
    } else {
      routeResponse = await dispatchLegacyMakeupSource(sourceRequest(request, sourceEventId))
    }
  } catch {
    try {
      await recordNotificationContractRouteOutcome({
        serviceClient,
        requestId,
        fixedRoute: startedRoute.route,
        outcome: "failed",
        responseStatus: 500,
        buildRevisionHash,
      })
    } catch {
      return json({ ok: false, error: "알림 계약 결과를 기록하지 못했습니다." }, 503)
    }
    return json({ ok: false, error: "고정 알림 경로 실행에 실패했습니다." }, 502)
  }

  try {
    const routeOutcome = await classifyNotificationContractRouteResponse(routeResponse)
    await recordNotificationContractRouteOutcome({
      serviceClient,
      requestId,
      fixedRoute: startedRoute.route,
      outcome: routeOutcome,
      responseStatus: routeResponse.status,
      buildRevisionHash,
    })
  } catch {
    return json({ ok: false, error: "알림 계약 결과를 기록하지 못했습니다." }, 503)
  }
  return contractResponse(routeResponse)
}
