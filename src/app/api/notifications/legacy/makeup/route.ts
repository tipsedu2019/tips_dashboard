import { createHash } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { readLegacyGoogleChatWebhookUrl } from "@/features/notifications/server/legacy-google-chat-connection"
import { requireRegisteredNotificationExternalAttempt } from "@/features/notifications/server/external-attempt-gate"
import { recordLegacyNotificationDeliveryIntent } from "@/features/notifications/server/legacy-delivery-intent"
import { createGoogleChatProvider } from "@/features/notifications/server/providers/google-chat-provider"
import { createWebPushProvider } from "@/features/notifications/server/providers/web-push-provider"

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
  channelKey: "in_app" | "google_chat"
  audienceKey: string
  targetGeneration: string
  targetKind: "profile" | "connection"
  targetKey: string
  targetProfileId: string | null
  connectionKey: string | null
  targetSnapshot: JsonRecord
  renderedTitle: string
  renderedBody: string
  href: string
  scheduledFor: string
}>

type LegacyWebPushItem = Readonly<{
  deliveryId: string
  acquired: boolean
  recoveredUnknown: boolean
  replayOutcome: string
  claimId: string
  ownerGeneration: string
  dispatchToken: string
  templateChecksum: string
  subscription: Readonly<{
    endpoint: string
    keys: Readonly<{ p256dh: string; auth: string }>
  }>
  renderedTitle: string
  renderedBody: string
  href: string
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TEMPLATE_CHECKSUM = /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/
const CONNECTION_CHANNEL = {
  "google_chat.management": "admin",
  "google_chat.executive": "executive",
  "google_chat.math": "math",
  "google_chat.english": "english",
} as const
const CONNECTION_ENV = {
  "google_chat.management": "GOOGLE_CHAT_WEBHOOK_ADMIN",
  "google_chat.executive": "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  "google_chat.math": "GOOGLE_CHAT_WEBHOOK_MATH",
  "google_chat.english": "GOOGLE_CHAT_WEBHOOK_ENGLISH",
} as const

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deterministicRequestId(scope: string, ...parts: string[]) {
  const bytes = createHash("sha256")
    .update([scope, ...parts].join("\u001f"))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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

function parsePlan(value: unknown): LegacyDispatchItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("makeup_legacy_dispatch_plan_invalid")
  }
  return value.items.map((raw) => {
    if (!isRecord(raw)) throw new Error("makeup_legacy_dispatch_plan_invalid")
    const channelKey = text(raw.channelKey)
    const targetKind = text(raw.targetKind)
    const item = {
      eventId: text(raw.eventId),
      eventKey: text(raw.eventKey),
      occurrenceKey: text(raw.occurrenceKey),
      ruleId: text(raw.ruleId),
      ruleRevision: text(raw.ruleRevision),
      templateId: text(raw.templateId),
      templateChecksum: text(raw.templateChecksum),
      channelKey,
      audienceKey: text(raw.audienceKey),
      targetGeneration: text(raw.targetGeneration),
      targetKind,
      targetKey: text(raw.targetKey),
      targetProfileId: text(raw.targetProfileId) || null,
      connectionKey: text(raw.connectionKey) || null,
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
      || !item.occurrenceKey
      || !["in_app", "google_chat"].includes(channelKey)
      || !["profile", "connection"].includes(targetKind)
      || !item.targetKey
      || item.targetGeneration !== "0"
      || !item.renderedTitle
      || !item.renderedBody
      || !item.href.startsWith("/admin/")
    ) throw new Error("makeup_legacy_dispatch_plan_invalid")
    return item as LegacyDispatchItem
  })
}

function parseWebPushPlan(value: unknown): LegacyWebPushItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("makeup_legacy_web_push_plan_invalid")
  }
  return value.items.map((raw) => {
    if (!isRecord(raw) || !isRecord(raw.subscription) || !isRecord(raw.subscription.keys)) {
      throw new Error("makeup_legacy_web_push_plan_invalid")
    }
    const item = {
      deliveryId: text(raw.deliveryId),
      acquired: raw.acquired === true,
      recoveredUnknown: raw.recoveredUnknown === true,
      replayOutcome: text(raw.replayOutcome),
      claimId: text(raw.claimId),
      ownerGeneration: text(raw.ownerGeneration),
      dispatchToken: text(raw.dispatchToken),
      templateChecksum: text(raw.templateChecksum),
      subscription: {
        endpoint: text(raw.subscription.endpoint),
        keys: {
          p256dh: text(raw.subscription.keys.p256dh),
          auth: text(raw.subscription.keys.auth),
        },
      },
      renderedTitle: text(raw.renderedTitle),
      renderedBody: text(raw.renderedBody),
      href: text(raw.href),
    }
    if (
      !UUID.test(item.deliveryId)
      || typeof raw.acquired !== "boolean"
      || typeof raw.recoveredUnknown !== "boolean"
      || !TEMPLATE_CHECKSUM.test(item.templateChecksum)
      || ((item.acquired || item.recoveredUnknown) && (
        !UUID.test(item.claimId)
        || !UUID.test(item.dispatchToken)
        || item.ownerGeneration !== "0"
      ))
      || !item.subscription.endpoint.startsWith("https://")
      || !item.subscription.keys.p256dh
      || !item.subscription.keys.auth
      || !item.renderedTitle
      || !item.renderedBody
      || !item.href.startsWith("/admin/")
    ) throw new Error("makeup_legacy_web_push_plan_invalid")
    return item
  })
}

async function createLegacyWebPushProvider() {
  const publicKey = text(
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  )
  const privateKey = text(process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY)
  const contact = text(process.env.WEB_PUSH_CONTACT)
  if (!publicKey || !privateKey || !contact) return null
  const webPushModule = await import("web-push")
  const webPush = webPushModule.default
  webPush.setVapidDetails(contact, publicKey, privateKey)
  return createWebPushProvider({
    sendNotification(subscription, payload) {
      return webPush.sendNotification(subscription, payload)
    },
  })
}

async function finalizeGoogleChatDispatch(
  client: SupabaseClient,
  deliveryId: string,
  begun: JsonRecord,
  outcome: "sent" | "failed" | "delivery_unknown",
  providerReference: string,
) {
  await rpc(client, "finalize_makeup_legacy_google_chat_v1", {
    p_delivery_id: deliveryId,
    p_claim_id: text(begun.claimId),
    p_owner_generation: text(begun.ownerGeneration),
    p_dispatch_token: text(begun.dispatchToken),
    p_outcome: outcome,
    p_provider_reference: providerReference.slice(0, 512),
  })
}

async function readWebhook(client: SupabaseClient, connectionKey: string) {
  const channel = CONNECTION_CHANNEL[connectionKey as keyof typeof CONNECTION_CHANNEL]
  const environmentName = CONNECTION_ENV[connectionKey as keyof typeof CONNECTION_ENV]
  if (!channel || !environmentName) return ""
  return readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: text(process.env[environmentName]),
    async loadRow() {
      const { data, error } = await client
        .from("google_chat_webhook_settings")
        .select("webhook_url,connection_state")
        .eq("channel", channel)
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

async function dispatchInApp(
  client: SupabaseClient,
  sourceEventId: string,
  item: LegacyDispatchItem,
) {
  if (!item.targetProfileId) throw new Error("makeup_legacy_profile_missing")
  const requestId = deterministicRequestId(
    "makeup-legacy-in-app-materialize-v1",
    sourceEventId,
    item.ruleId,
    item.targetKey,
    item.targetGeneration,
  )
  const materialized = await rpc(client, "materialize_makeup_legacy_in_app_v1", {
    p_source_event_id: sourceEventId,
    p_rule_id: item.ruleId,
    p_profile_id: item.targetProfileId,
    p_target_generation: item.targetGeneration,
    p_request_id: requestId,
  })
  if (
    !isRecord(materialized)
    || !UUID.test(text(materialized.deliveryId))
    || typeof materialized.acquired !== "boolean"
    || typeof materialized.projectionCommitted !== "boolean"
  ) {
    throw new Error("makeup_legacy_projection_invalid")
  }
  if (!materialized.projectionCommitted) return ["deduped"] as const
  const parentDeliveryId = text(materialized.deliveryId)
  const outcomes: string[] = [materialized.acquired ? "sent" : "deduped"]

  let pushProvider
  try {
    pushProvider = await createLegacyWebPushProvider()
  } catch (error) {
    console.warn("휴보강 웹푸시 공급자 구성을 준비하지 못했습니다.", error)
    return outcomes
  }
  if (!pushProvider) return outcomes

  const pushRequestId = deterministicRequestId(
    "makeup-legacy-web-push-prepare-v1",
    sourceEventId,
    item.ruleId,
    item.targetKey,
    item.targetGeneration,
  )
  const pushPlan = parseWebPushPlan(await rpc(client, "prepare_makeup_legacy_web_push_v1", {
    p_parent_delivery_id: parentDeliveryId,
    p_request_id: pushRequestId,
  }))
  for (const pushItem of pushPlan) {
    if (pushItem.recoveredUnknown) {
      await rpc(client, "finalize_makeup_legacy_web_push_v1", {
        p_delivery_id: pushItem.deliveryId,
        p_claim_id: pushItem.claimId,
        p_owner_generation: pushItem.ownerGeneration,
        p_dispatch_token: pushItem.dispatchToken,
        p_outcome: "delivery_unknown",
        p_provider_reference: "idempotent_dispatch_replay",
      })
      outcomes.push("delivery_unknown")
      continue
    }
    if (!pushItem.acquired) {
      outcomes.push(
        ["sent", "failed", "delivery_unknown"].includes(pushItem.replayOutcome)
          ? pushItem.replayOutcome
          : "deduped",
      )
      continue
    }
    await recordLegacyNotificationDeliveryIntent({
      deliveryId: pushItem.deliveryId,
      requestId: pushItem.dispatchToken,
      legacyTemplateChecksum: pushItem.templateChecksum,
      title: pushItem.renderedTitle,
      body: pushItem.renderedBody,
      href: pushItem.href,
      record: (intent) => rpc(client, "record_legacy_notification_delivery_intent_v1", {
        p_delivery_id: intent.deliveryId,
        p_legacy_template_checksum: intent.legacyTemplateChecksum,
        p_normalized_rendered_hash: intent.normalizedRenderedHash,
        p_request_id: intent.requestId,
      }),
    })
    const attempt = await requireRegisteredNotificationExternalAttempt({
      register: () => rpc(client, "register_notification_external_attempt_v1", {
        p_delivery_id: null,
        p_claim_id: pushItem.claimId,
        p_owner_generation: pushItem.ownerGeneration,
        p_claim_token: null,
        p_dispatch_token: pushItem.dispatchToken,
        p_request_id: pushItem.dispatchToken,
      }),
      finalizeUnknown: (reason: string) => rpc(client, "finalize_makeup_legacy_web_push_v1", {
        p_delivery_id: pushItem.deliveryId,
        p_claim_id: pushItem.claimId,
        p_owner_generation: pushItem.ownerGeneration,
        p_dispatch_token: pushItem.dispatchToken,
        p_outcome: "delivery_unknown",
        p_provider_reference: reason,
      }),
    })
    if (!attempt.allowed) {
      outcomes.push("delivery_unknown")
      continue
    }
    let result
    try {
      result = await pushProvider.send({
        delivery_id: pushItem.deliveryId,
        claim_token: pushItem.claimId,
        dispatch_token: pushItem.dispatchToken,
        status: "sending",
        channel_key: "web_push",
        subscription: pushItem.subscription,
        rendered_title: pushItem.renderedTitle,
        rendered_body: pushItem.renderedBody,
        href: pushItem.href,
      })
    } catch {
      result = {
        status: "delivery_unknown" as const,
        statusReason: "provider_ambiguous_response",
        providerMessageId: null,
        providerResponseCode: null,
        errorCode: "provider_transport_error",
        errorSummary: "provider result unavailable",
        nextAttemptAt: null,
      }
    }
    const outcome = result.status === "sent"
      ? "sent"
      : result.status === "delivery_unknown"
        ? "delivery_unknown"
        : "failed"
    const providerReference = outcome === "sent"
      ? result.providerMessageId || result.providerResponseCode || outcome
      : result.errorCode || result.providerResponseCode || outcome
    await rpc(client, "finalize_makeup_legacy_web_push_v1", {
      p_delivery_id: pushItem.deliveryId,
      p_claim_id: pushItem.claimId,
      p_owner_generation: pushItem.ownerGeneration,
      p_dispatch_token: pushItem.dispatchToken,
      p_outcome: outcome,
      p_provider_reference: providerReference,
    })
    outcomes.push(outcome)
  }
  return outcomes
}

async function dispatchGoogleChat(
  client: SupabaseClient,
  sourceEventId: string,
  actorProfileId: string,
  item: LegacyDispatchItem,
) {
  const materializeRequestId = deterministicRequestId(
    "makeup-legacy-google-chat-materialize-v1",
    sourceEventId,
    item.ruleId,
    item.connectionKey || "",
    item.targetGeneration,
  )
  const materialized = await rpc(client, "materialize_makeup_legacy_google_chat_v1", {
    p_source_event_id: sourceEventId,
    p_rule_id: item.ruleId,
    p_connection_key: item.connectionKey,
    p_target_generation: item.targetGeneration,
    p_actor_profile_id: actorProfileId,
    p_request_id: materializeRequestId,
  })
  const deliveryId = isRecord(materialized) ? text(materialized.deliveryId) : ""
  if (
    !UUID.test(deliveryId)
    || !isRecord(materialized)
    || typeof materialized.acquired !== "boolean"
    || typeof materialized.recoveredUnknown !== "boolean"
    || ((materialized.acquired || materialized.recoveredUnknown) && (
      !UUID.test(text(materialized.claimId))
      || !UUID.test(text(materialized.dispatchToken))
      || text(materialized.ownerGeneration) !== "0"
    ))
  ) throw new Error("makeup_legacy_projection_invalid")
  if (materialized.recoveredUnknown) {
    await finalizeGoogleChatDispatch(
      client,
      deliveryId,
      materialized,
      "delivery_unknown",
      "idempotent_dispatch_replay",
    )
    return "delivery_unknown" as const
  }
  if (!materialized.acquired) {
    const replayOutcome = text(materialized.replayOutcome)
    return ["sent", "failed", "delivery_unknown"].includes(replayOutcome)
      ? replayOutcome as "sent" | "failed" | "delivery_unknown"
      : "deduped" as const
  }

  let webhookUrl = ""
  try {
    webhookUrl = await readWebhook(client, item.connectionKey || "")
  } catch (error) {
    const providerReference = text((error as { code?: unknown })?.code) || "provider_configuration_error"
    await finalizeGoogleChatDispatch(client, deliveryId, materialized, "failed", providerReference)
    return "failed" as const
  }

  const provider = createGoogleChatProvider({
    fetch(input, init) {
      return fetch(input, {
        ...init,
        signal: AbortSignal.timeout(10_000),
      })
    },
  })
  await recordLegacyNotificationDeliveryIntent({
    deliveryId,
    requestId: text(materialized.dispatchToken),
    legacyTemplateChecksum: item.templateChecksum,
    title: item.renderedTitle,
    body: item.renderedBody,
    href: item.href,
    record: (intent) => rpc(client, "record_legacy_notification_delivery_intent_v1", {
      p_delivery_id: intent.deliveryId,
      p_legacy_template_checksum: intent.legacyTemplateChecksum,
      p_normalized_rendered_hash: intent.normalizedRenderedHash,
      p_request_id: intent.requestId,
    }),
  })
  const attempt = await requireRegisteredNotificationExternalAttempt({
    register: () => rpc(client, "register_notification_external_attempt_v1", {
      p_delivery_id: null,
      p_claim_id: text(materialized.claimId),
      p_owner_generation: text(materialized.ownerGeneration),
      p_claim_token: null,
      p_dispatch_token: text(materialized.dispatchToken),
      p_request_id: text(materialized.dispatchToken),
    }),
    finalizeUnknown: (reason: string) => finalizeGoogleChatDispatch(
      client,
      deliveryId,
      materialized,
      "delivery_unknown",
      reason,
    ),
  })
  if (!attempt.allowed) return "delivery_unknown" as const

  let result
  try {
    result = await provider.send({
      delivery_id: deliveryId,
      claim_token: text(materialized.claimId),
      dispatch_token: text(materialized.dispatchToken),
      status: "sending",
      channel_key: "google_chat",
      connection_key: item.connectionKey,
      webhook_url: webhookUrl,
      rendered_title: item.renderedTitle,
      rendered_body: item.renderedBody,
      href: item.href,
    })
  } catch (error) {
    const providerReference = text((error as { code?: unknown })?.code) || "provider_exception"
    await finalizeGoogleChatDispatch(
      client,
      deliveryId,
      materialized,
      "delivery_unknown",
      providerReference,
    )
    return "delivery_unknown" as const
  }
  const outcome = result.status === "sent"
    ? "sent"
    : result.status === "delivery_unknown"
      ? "delivery_unknown"
      : "failed"
  const providerReference = outcome === "sent"
    ? result.providerMessageId || result.providerResponseCode || outcome
    : result.errorCode || result.providerResponseCode || outcome
  await finalizeGoogleChatDispatch(
    client,
    deliveryId,
    materialized,
    outcome,
    providerReference,
  )
  return outcome
}

export async function POST(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const actorClient = authenticatedClient(token)
  if (!actorClient || !token) return response({ ok: false, error: "Unauthorized" }, 401)

  const { data: actor, error: actorError } = await actorClient.auth.getUser(token)
  if (actorError || !actor.user?.id) return response({ ok: false, error: "Unauthorized" }, 401)

  const { data: actorProfile, error: actorProfileError } = await actorClient
    .from("profiles")
    .select("role")
    .eq("id", actor.user.id)
    .single()
  if (actorProfileError || !isRecord(actorProfile)) return response({ ok: false, error: "휴보강 권한을 확인할 수 없습니다." }, 503)
  if (text(actorProfile.role) === "assistant") return response({ ok: false, error: "휴보강 접근 권한이 없습니다." }, 403)

  const serverClient = serviceClient()
  if (!serverClient) return response({ ok: false, error: "알림 저장소를 사용할 수 없습니다." }, 503)

  const body = await request.json().catch(() => null)
  if (
    !isRecord(body)
    || Object.keys(body).length !== 1
    || Object.keys(body)[0] !== "sourceEventId"
  ) return response({ ok: false, error: "Invalid request" }, 400)
  const sourceEventId = text(body.sourceEventId)
  if (!UUID.test(sourceEventId)) return response({ ok: false, error: "Invalid request" }, 400)

  try {
    const plan = await rpc(serverClient, "get_makeup_legacy_dispatch_plan_v1", {
      p_source_event_id: sourceEventId,
      p_actor_profile_id: actor.user.id,
    })
    const items = parsePlan(plan)
    const outcomes: string[] = []
    for (const item of items) {
      try {
        if (item.channelKey === "in_app") {
          outcomes.push(...await dispatchInApp(serverClient, sourceEventId, item))
        } else {
          outcomes.push(await dispatchGoogleChat(serverClient, sourceEventId, actor.user.id, item))
        }
      } catch (error) {
        outcomes.push("failed")
        console.warn("휴보강 레거시 알림 후처리에 실패했습니다.", error)
      }
    }
    const sent = outcomes.filter((outcome) => outcome === "sent").length
    const deduped = outcomes.filter((outcome) => outcome === "deduped").length
    const failed = outcomes.length - sent - deduped
    const status = items.length > 0 && deduped === items.length ? 202 : 200
    return response({ ok: true, sent, deduped, failed }, status)
  } catch (error) {
    const code = text((error as { code?: unknown })?.code)
    const status = code === "42501" ? 403 : code === "P0002" ? 404 : 503
    return response({ ok: false, error: "휴보강 알림 후처리를 완료하지 못했습니다." }, status)
  }
}
