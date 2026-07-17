import { createHash } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { readLegacyGoogleChatWebhookUrl } from "@/features/notifications/server/legacy-google-chat-connection"
import { requireRegisteredNotificationExternalAttempt } from "@/features/notifications/server/external-attempt-gate"
import { normalizedNotificationRenderedHash } from "@/features/notifications/server/legacy-delivery-intent"
import { createGoogleChatProvider } from "@/features/notifications/server/providers/google-chat-provider"

export const runtime = "nodejs"

type JsonRecord = Record<string, unknown>

type LegacyDispatchItem = Readonly<{
  eventId: string
  eventKey: string
  occurrenceKey: string
  ruleId: string
  ruleRevision: string
  templateId: string
  templateChecksum: string
  channelKey: "google_chat"
  audienceKey: "management_team"
  targetGeneration: "0"
  targetKind: "connection"
  targetKey: string
  connectionKey: "google_chat.management"
  targetSnapshot: JsonRecord
  renderedTitle: string
  renderedBody: string
  href: string
  scheduledFor: string
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// 기존 설정 RPC가 만든 MD5 checksum과 신규 SHA-256 checksum을 모두 읽는다.
// 신규 template 저장은 DB trigger에서 SHA-256으로 정규화한다.
const TEMPLATE_CHECKSUM = /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/

function deterministicUuid(namespace: string, key: string) {
  const digest = createHash("sha256").update(`${namespace}:${key}`, "utf8").digest("hex")
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function supabaseUrl() {
  return text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
}

function authenticatedClient(token: string) {
  const url = supabaseUrl()
  const key = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  if (!url || !key || !token) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function serviceClient() {
  const url = supabaseUrl()
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function rpc(client: SupabaseClient, name: string, parameters: JsonRecord) {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw error
  return data
}

function isMissingRpc(error: unknown) {
  if (!isRecord(error)) return false
  const code = text(error.code).toUpperCase()
  const message = text(error.message).toLowerCase()
  return code === "PGRST202" || code === "42883"
    || (message.includes("schema cache") && message.includes("could not find the function"))
}

function parsePlan(value: unknown): LegacyDispatchItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("ops_task_legacy_dispatch_plan_invalid")
  }
  return value.items.map((raw) => {
    if (!isRecord(raw)) throw new Error("ops_task_legacy_dispatch_plan_invalid")
    const item = {
      eventId: text(raw.eventId),
      eventKey: text(raw.eventKey),
      occurrenceKey: text(raw.occurrenceKey),
      ruleId: text(raw.ruleId),
      ruleRevision: text(raw.ruleRevision),
      templateId: text(raw.templateId),
      templateChecksum: text(raw.templateChecksum),
      channelKey: text(raw.channelKey),
      audienceKey: text(raw.audienceKey),
      targetGeneration: text(raw.targetGeneration),
      targetKind: text(raw.targetKind),
      targetKey: text(raw.targetKey),
      connectionKey: text(raw.connectionKey),
      targetSnapshot: isRecord(raw.targetSnapshot) ? raw.targetSnapshot : {},
      renderedTitle: text(raw.renderedTitle),
      renderedBody: text(raw.renderedBody),
      href: text(raw.href),
      scheduledFor: text(raw.scheduledFor),
    }
    if (
      !UUID.test(item.eventId)
      || !UUID.test(item.ruleId)
      || !UUID.test(item.templateId)
      || !TEMPLATE_CHECKSUM.test(item.templateChecksum)
      || !["task", "word_retest", "registration", "transfer", "withdrawal"].includes(item.eventKey.split(".")[0] || "")
      || !item.occurrenceKey
      || item.channelKey !== "google_chat"
      || item.audienceKey !== "management_team"
      || item.targetGeneration !== "0"
      || item.targetKind !== "connection"
      || item.targetKey !== "connection:google_chat.management"
      || item.connectionKey !== "google_chat.management"
      || !item.renderedTitle
      || !item.renderedBody
      || !item.href.startsWith("/admin/")
    ) throw new Error("ops_task_legacy_dispatch_plan_invalid")
    return item as LegacyDispatchItem
  })
}

async function beginLegacyDispatch(client: SupabaseClient, item: LegacyDispatchItem) {
  const prefix = item.eventKey.split(".")[0]
  const workflowKey = prefix === "task"
    ? "tasks"
    : prefix === "word_retest"
      ? "word_retests"
      : prefix
  const renderedHash = normalizedNotificationRenderedHash({
    title: item.renderedTitle,
    body: item.renderedBody,
    href: item.href,
  })
  const identity = [
    workflowKey,
    item.occurrenceKey,
    item.ruleId,
    item.channelKey,
    item.targetKey,
    item.targetGeneration,
  ].join("\u001f")
  try {
    const intent = await rpc(client, "record_legacy_notification_intent_v1", {
      p_workflow_key: workflowKey,
      p_occurrence_key: item.occurrenceKey,
      p_rule_id: item.ruleId,
      p_channel_key: item.channelKey,
      p_target_key: item.targetKey,
      p_target_generation: item.targetGeneration,
      p_legacy_template_checksum: item.templateChecksum,
      p_normalized_rendered_hash: renderedHash,
      p_request_id: deterministicUuid(
        "legacy-normalized-intent-v1",
        `${identity}\u001f${renderedHash}`,
      ),
    })
    const inactiveNoop = isRecord(intent)
      && intent.recorded === false
      && intent.shadow === false
      && text(intent.reason) === "shadow_inactive"
    if ((!isRecord(intent) || intent.recorded !== true) && !inactiveNoop) {
      throw new Error("ops_task_legacy_intent_invalid")
    }
  } catch (error) {
    // 구 DB와 신규 번들의 순차 배포 구간에서만 의도 기록 RPC 부재를 허용한다.
    if (!isMissingRpc(error)) throw error
  }
  const value = await rpc(client, "begin_legacy_notification_dispatch_v1", {
    p_workflow_key: workflowKey,
    p_occurrence_key: item.occurrenceKey,
    p_rule_id: item.ruleId,
    p_channel_key: item.channelKey,
    p_target_key: item.targetKey,
    p_target_generation: item.targetGeneration,
    p_legacy_owner_key: workflowKey === "registration"
      ? "registration_core_legacy_bridge_v1"
      : "ops_task_legacy_bridge_v1",
    p_expected_owner_generation: "0",
    p_request_id: deterministicUuid("legacy-dispatch-begin-v1", identity),
  })
  if (!isRecord(value) || typeof value.acquired !== "boolean") {
    throw new Error("ops_task_legacy_ownership_invalid")
  }
  return value
}

async function loadLegacyDispatchPlan(
  client: SupabaseClient,
  sourceEventId: string,
  actorProfileId: string,
) {
  const parameters = {
    p_source_event_id: sourceEventId,
    p_actor_profile_id: actorProfileId,
  }
  try {
    return await rpc(client, "get_ops_task_legacy_dispatch_plan_v1", parameters)
  } catch (error) {
    if (text((error as { code?: unknown })?.code) !== "P0002") throw error
    return rpc(client, "get_registration_core_legacy_dispatch_plan_v1", parameters)
  }
}

async function finalizeLegacyDispatch(
  client: SupabaseClient,
  begun: JsonRecord,
  outcome: "sent" | "failed" | "delivery_unknown",
  providerReference: string,
) {
  await rpc(client, "finalize_legacy_notification_dispatch_v1", {
    p_claim_id: text(begun.claim_id),
    p_owner_generation: text(begun.owner_generation),
    p_dispatch_token: text(begun.dispatch_token),
    p_outcome: outcome,
    p_provider_reference: providerReference.slice(0, 512),
  })
}

function isInterruptedDispatchReplay(value: JsonRecord) {
  return value.acquired === false
    && text(value.status) === "dispatch_already_started"
    && text(value.reason) === "idempotent_dispatch_replay"
    && UUID.test(text(value.claim_id))
    && /^\d+$/.test(text(value.owner_generation))
    && UUID.test(text(value.dispatch_token))
}

async function readWebhook(client: SupabaseClient) {
  return readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: text(process.env.GOOGLE_CHAT_WEBHOOK_ADMIN),
    async loadRow() {
      const { data, error } = await client
        .from("google_chat_webhook_settings")
        .select("webhook_url,connection_state")
        .eq("channel", "admin")
        .maybeSingle()
      if (error) throw error
      const row = data as { webhook_url?: unknown; connection_state?: unknown } | null
      return {
        found: row !== null,
        connectionState: row ? text(row.connection_state) : null,
        webhookUrl: row ? text(row.webhook_url) : null,
      }
    },
  })
}

async function dispatchGoogleChat(client: SupabaseClient, item: LegacyDispatchItem) {
  const begun = await beginLegacyDispatch(client, item)
  if (!begun.acquired) {
    if (isInterruptedDispatchReplay(begun)) {
      await finalizeLegacyDispatch(
        client,
        begun,
        "delivery_unknown",
        "legacy_dispatch_recovered_after_interruption",
      )
      return "delivery_unknown" as const
    }
    return "deduped" as const
  }

  let webhookUrl: string
  try {
    webhookUrl = await readWebhook(client)
  } catch (error) {
    const providerReference = text((error as { code?: unknown })?.code) || "webhook_configuration_error"
    await finalizeLegacyDispatch(client, begun, "failed", providerReference)
    return "failed" as const
  }

  let provider: ReturnType<typeof createGoogleChatProvider>
  try {
    provider = createGoogleChatProvider({
      fetch(input, init) {
        return fetch(input, { ...init, signal: AbortSignal.timeout(10_000) })
      },
    })
  } catch (error) {
    const providerReference = text((error as { code?: unknown })?.code) || "provider_configuration_error"
    await finalizeLegacyDispatch(client, begun, "failed", providerReference)
    return "failed" as const
  }

  try {
    const attempt = await requireRegisteredNotificationExternalAttempt({
      register: () => rpc(client, "register_notification_external_attempt_v1", {
        p_delivery_id: null,
        p_claim_id: text(begun.claim_id),
        p_owner_generation: text(begun.owner_generation),
        p_claim_token: null,
        p_dispatch_token: text(begun.dispatch_token),
        p_request_id: text(begun.dispatch_token),
      }),
      finalizeUnknown: (reason: string) => finalizeLegacyDispatch(
        client,
        begun,
        "delivery_unknown",
        reason,
      ),
    })
    if (!attempt.allowed) return "delivery_unknown" as const

    const result = await provider.send({
      delivery_id: item.eventId,
      claim_token: text(begun.claim_id),
      dispatch_token: text(begun.dispatch_token),
      status: "sending",
      channel_key: "google_chat",
      connection_key: item.connectionKey,
      webhook_url: webhookUrl,
      rendered_title: item.renderedTitle,
      rendered_body: item.renderedBody,
      href: item.href,
    })
    const outcome = result.status === "sent"
      ? "sent"
      : result.status === "delivery_unknown"
        ? "delivery_unknown"
        : "failed"
    await finalizeLegacyDispatch(
      client,
      begun,
      outcome,
      result.providerMessageId || result.providerResponseCode || result.errorCode || outcome,
    )
    return outcome
  } catch (error) {
    const providerReference = text((error as { code?: unknown })?.code) || "provider_exception"
    await finalizeLegacyDispatch(client, begun, "delivery_unknown", providerReference)
    return "delivery_unknown" as const
  }
}

export async function POST(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const actorClient = authenticatedClient(token)
  const serverClient = serviceClient()
  if (!actorClient || !token) return response({ ok: false, error: "Unauthorized" }, 401)
  if (!serverClient) return response({ ok: false, error: "알림 저장소를 사용할 수 없습니다." }, 503)

  const { data: actor, error: actorError } = await actorClient.auth.getUser(token)
  if (actorError || !actor.user?.id) return response({ ok: false, error: "Unauthorized" }, 401)

  const body = await request.json().catch(() => null)
  if (
    !isRecord(body)
    || Object.keys(body).length !== 1
    || Object.keys(body)[0] !== "sourceEventId"
  ) return response({ ok: false, error: "notification_payload_forbidden" }, 422)
  const sourceEventId = text(body.sourceEventId)
  if (!UUID.test(sourceEventId)) return response({ ok: false, error: "Invalid request" }, 400)

  try {
    const plan = await loadLegacyDispatchPlan(serverClient, sourceEventId, actor.user.id)
    const items = parsePlan(plan)
    const outcomes: string[] = []
    for (const item of items) {
      try {
        outcomes.push(await dispatchGoogleChat(serverClient, item))
      } catch (error) {
        outcomes.push("failed")
        console.warn("등록·전반·퇴원 알림 후처리에 실패했습니다.", error)
      }
    }
    const sent = outcomes.filter((outcome) => outcome === "sent").length
    const deduped = outcomes.filter((outcome) => outcome === "deduped").length
    const failed = outcomes.length - sent - deduped
    const status = items.length === 0 || deduped === items.length ? 202 : 200
    return response({ ok: true, sent, deduped, failed }, status)
  } catch (error) {
    const code = text((error as { code?: unknown })?.code)
    const status = code === "42501" ? 403 : code === "P0002" ? 404 : 503
    return response({ ok: false, error: "등록·전반·퇴원 알림 후처리를 완료하지 못했습니다." }, status)
  }
}
