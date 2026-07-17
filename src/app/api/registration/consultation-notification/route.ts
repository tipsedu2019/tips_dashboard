import { createHash } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { readLegacyGoogleChatWebhookUrl } from "@/features/notifications/server/legacy-google-chat-connection"
import { requireRegisteredNotificationExternalAttempt } from "@/features/notifications/server/external-attempt-gate"
import { recordLegacyNotificationDeliveryIntent } from "@/features/notifications/server/legacy-delivery-intent"
import { createGoogleChatProvider } from "@/features/notifications/server/providers/google-chat-provider"

export const runtime = "nodejs"

type JsonRecord = Record<string, unknown>
type LegacyVisitDispatchItem = Readonly<{
  eventId: string
  eventKey: string
  occurrenceKey: string
  ruleId: string
  ruleRevision: string
  templateId: string
  templateChecksum: string
  channelKey: "in_app" | "google_chat"
  audienceKey: "track_director" | "management_team"
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
type VisitDispatchPlan = Readonly<{
  appointmentId: string
  notificationRevision: number
  recipientRevision: string
  notifiedTrackIds: string[]
  items: LegacyVisitDispatchItem[]
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TEMPLATE_CHECKSUM = /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

async function rpc(client: SupabaseClient, name: string, parameters: JsonRecord = {}) {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw error
  return data
}

async function getAuthenticatedContext(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const client = authenticatedClient(token)
  const serverClient = serviceClient()
  if (!client || !token) return { userId: "", role: "", client: null, serverClient }
  const { data, error } = await client.auth.getUser(token)
  const userId = data.user?.id || ""
  if (error || !userId) return { userId: "", role: "", client: null, serverClient }
  const { data: profile, error: profileError } = serverClient
    ? await serverClient.from("profiles").select("role").eq("id", userId).maybeSingle()
    : { data: null, error: null }
  return {
    userId,
    role: profileError ? "" : text((profile as JsonRecord | null)?.role),
    client,
    serverClient,
  }
}

async function probeRegistrationNotificationRuntime(client: SupabaseClient) {
  const subjectRuntime = await rpc(client, "registration_subject_tracks_runtime_version")
  if (subjectRuntime !== 1) return { mode: "maintenance" as const }
  const handoffRuntime = await rpc(client, "registration_notification_handoffs_runtime_version")
  return { mode: handoffRuntime === 1 ? "ready" as const : "maintenance" as const }
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

function parsePlan(value: unknown): VisitDispatchPlan {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("registration_visit_legacy_dispatch_plan_invalid")
  }
  const appointmentId = text(value.appointmentId)
  const notificationRevision = numberValue(value.notificationRevision)
  const recipientRevision = text(value.recipientRevision)
  const notifiedTrackIds = Array.isArray(value.notifiedTrackIds)
    ? value.notifiedTrackIds.map(text).filter(Boolean)
    : []
  if (!UUID.test(appointmentId) || !Number.isInteger(notificationRevision) || notificationRevision < 1) {
    throw new Error("registration_visit_legacy_dispatch_plan_invalid")
  }
  const items = value.items.map((raw) => {
    if (!isRecord(raw)) throw new Error("registration_visit_legacy_dispatch_plan_invalid")
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
      || !item.eventKey.startsWith("registration.visit_")
      || !item.occurrenceKey
      || !["in_app", "google_chat"].includes(item.channelKey)
      || !["track_director", "management_team"].includes(item.audienceKey)
      || !["profile", "connection"].includes(item.targetKind)
      || !item.targetKey
      || item.targetGeneration !== recipientRevision
      || !item.renderedTitle
      || !item.renderedBody
      || !item.href.startsWith("/admin/registration")
    ) throw new Error("registration_visit_legacy_dispatch_plan_invalid")
    return item as LegacyVisitDispatchItem
  })
  return { appointmentId, notificationRevision, recipientRevision, notifiedTrackIds, items }
}

async function dispatchInApp(
  client: SupabaseClient,
  actorProfileId: string,
  plan: VisitDispatchPlan,
  item: LegacyVisitDispatchItem,
) {
  if (!item.targetProfileId) throw new Error("registration_visit_profile_missing")
  const requestId = deterministicRequestId(
    "registration-visit-in-app-v1",
    plan.appointmentId,
    plan.notificationRevision.toString(),
    item.ruleId,
    item.targetKey,
    item.targetGeneration,
  )
  const committed = await rpc(client, "commit_registration_visit_legacy_in_app_v1", {
    p_appointment_id: plan.appointmentId,
    p_rule_id: item.ruleId,
    p_profile_id: item.targetProfileId,
    p_target_generation: item.targetGeneration,
    p_actor_profile_id: actorProfileId,
    p_request_id: requestId,
  })
  if (!isRecord(committed) || !UUID.test(text(committed.deliveryId))
    || typeof committed.acquired !== "boolean") {
    throw new Error("registration_visit_projection_invalid")
  }
  if (!committed.acquired) return "deduped" as const
  if (committed.committed !== true) throw new Error("registration_visit_projection_not_committed")
  return "sent" as const
}

async function readAdminWebhook(client: SupabaseClient) {
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

async function finalizeGoogleChat(
  client: SupabaseClient,
  deliveryId: string,
  begun: JsonRecord,
  outcome: "sent" | "failed" | "delivery_unknown",
  providerReference: string,
) {
  await rpc(client, "finalize_registration_visit_legacy_google_chat_v1", {
    p_delivery_id: deliveryId,
    p_claim_id: text(begun.claim_id),
    p_owner_generation: text(begun.owner_generation),
    p_dispatch_token: text(begun.dispatch_token),
    p_outcome: outcome,
    p_provider_reference: providerReference.slice(0, 512),
  })
}

function isInterruptedDispatchReplay(value: JsonRecord, expectedRequestId: string) {
  return value.acquired === false
    && text(value.status) === "dispatch_already_started"
    && text(value.reason) === "idempotent_dispatch_replay"
    && text(value.request_id) === expectedRequestId
    && UUID.test(text(value.claim_id))
    && /^\d+$/.test(text(value.owner_generation))
    && UUID.test(text(value.dispatch_token))
}

function hasInterruptedDispatchReplayStatus(value: JsonRecord) {
  return value.acquired === false
    && text(value.status) === "dispatch_already_started"
    && text(value.reason) === "idempotent_dispatch_replay"
}

async function dispatchGoogleChat(
  client: SupabaseClient,
  actorProfileId: string,
  plan: VisitDispatchPlan,
  item: LegacyVisitDispatchItem,
) {
  const materialized = await rpc(client, "materialize_registration_visit_legacy_google_chat_v1", {
    p_appointment_id: plan.appointmentId,
    p_rule_id: item.ruleId,
    p_target_generation: item.targetGeneration,
    p_actor_profile_id: actorProfileId,
  })
  const deliveryId = isRecord(materialized) ? text(materialized.deliveryId) : ""
  if (!UUID.test(deliveryId)) throw new Error("registration_visit_projection_invalid")
  if (isRecord(materialized) && materialized.canonicalOwned === true) return "deduped" as const

  // The fixed-purpose wrapper re-reads the event/target and delegates to
  // begin_legacy_notification_dispatch_v1. Only a definite failed target may
  // be explicitly re-armed; sent and delivery_unknown remain terminal.
  const requestId = deterministicRequestId(
    "registration-visit-google-chat-v1",
    plan.appointmentId,
    plan.notificationRevision.toString(),
    item.ruleId,
    item.targetKey,
    item.targetGeneration,
  )
  const begun = await rpc(client, "begin_registration_visit_legacy_google_chat_v1", {
    p_appointment_id: plan.appointmentId,
    p_rule_id: item.ruleId,
    p_target_generation: item.targetGeneration,
    p_actor_profile_id: actorProfileId,
    p_request_id: requestId,
  })
  if (!isRecord(begun) || typeof begun.acquired !== "boolean") {
    throw new Error("registration_visit_ownership_invalid")
  }
  if (isInterruptedDispatchReplay(begun, requestId)) {
    await finalizeGoogleChat(
      client,
      deliveryId,
      begun,
      "delivery_unknown",
      "legacy_dispatch_recovered_after_interruption",
    )
    return "delivery_unknown" as const
  }
  if (!begun.acquired) {
    if (hasInterruptedDispatchReplayStatus(begun)) {
      throw new Error("registration_visit_ownership_invalid")
    }
    return "deduped" as const
  }

  try {
    const provider = createGoogleChatProvider({
      fetch(input, init) {
        return fetch(input, { ...init, signal: AbortSignal.timeout(10_000) })
      },
    })
    const webhookUrl = await readAdminWebhook(client)
    await recordLegacyNotificationDeliveryIntent({
      deliveryId,
      requestId: text(begun.dispatch_token),
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
        p_claim_id: text(begun.claim_id),
        p_owner_generation: text(begun.owner_generation),
        p_claim_token: null,
        p_dispatch_token: text(begun.dispatch_token),
        p_request_id: text(begun.dispatch_token),
      }),
      finalizeUnknown: (reason: string) => finalizeGoogleChat(
        client,
        deliveryId,
        begun,
        "delivery_unknown",
        reason,
      ),
    })
    if (!attempt.allowed) return "delivery_unknown" as const

    const result = await provider.send({
      delivery_id: deliveryId,
      claim_token: text(begun.claim_id),
      dispatch_token: text(begun.dispatch_token),
      status: "sending",
      channel_key: "google_chat",
      connection_key: "google_chat.management",
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
    const providerReference = outcome === "sent"
      ? result.providerMessageId || result.providerResponseCode || outcome
      : result.errorCode || result.providerResponseCode || outcome
    await finalizeGoogleChat(client, deliveryId, begun, outcome, providerReference)
    return outcome
  } catch (error) {
    const providerReference = text((error as { code?: unknown })?.code) || "provider_exception"
    await finalizeGoogleChat(client, deliveryId, begun, "delivery_unknown", providerReference)
    return "delivery_unknown" as const
  }
}

export async function POST(request: Request) {
  const { userId, role, client, serverClient } = await getAuthenticatedContext(request)
  if (!userId || !client) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  if (!(role === "admin" || role === "staff")) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }
  if (!serverClient) {
    return NextResponse.json({ ok: false, error: "알림 저장소를 사용할 수 없습니다." }, { status: 503 })
  }

  let runtimeState: { mode: "ready" | "maintenance" }
  try {
    runtimeState = await probeRegistrationNotificationRuntime(client)
  } catch {
    runtimeState = { mode: "maintenance" }
  }
  if (runtimeState.mode !== "ready") {
    return NextResponse.json({
      ok: false,
      code: "REGISTRATION_MIGRATION_IN_PROGRESS",
      error: "등록 알림 데이터 전환 중입니다. 잠시 후 다시 시도해 주세요.",
    }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  if (!isRecord(body) || Object.keys(body).length !== 1 || Object.keys(body)[0] !== "appointmentId") {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }
  const appointmentId = text(body.appointmentId)
  if (!UUID.test(appointmentId)) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 })
  }

  try {
    const plan = parsePlan(await rpc(serverClient, "get_registration_visit_legacy_dispatch_plan_v1", {
      p_appointment_id: appointmentId,
      p_actor_profile_id: userId,
    }))
    const outcomes: string[] = []
    for (const item of plan.items) {
      try {
        outcomes.push(item.channelKey === "in_app"
          ? await dispatchInApp(serverClient, userId, plan, item)
          : await dispatchGoogleChat(serverClient, userId, plan, item))
      } catch (error) {
        console.warn("방문상담 알림 후처리에 실패했습니다.", error)
        outcomes.push("failed")
      }
    }
    const sent = outcomes.filter((outcome) => outcome === "sent").length
    const deduped = outcomes.filter((outcome) => outcome === "deduped").length
    const deliveryUnknown = outcomes.filter((outcome) => outcome === "delivery_unknown").length
    const failed = outcomes.filter((outcome) => outcome === "failed").length
    const payload = {
      ok: failed === 0,
      appointmentId: plan.appointmentId,
      notificationRevision: plan.notificationRevision,
      notifiedTrackIds: plan.notifiedTrackIds,
      sent,
      deduped,
      failed,
      warning: deliveryUnknown > 0
        ? "Google Chat 전달 여부를 알 수 없어 자동 재전송하지 않았습니다. 전달 상태를 확인해 주세요."
        : "",
    }
    if (failed > 0) return NextResponse.json(payload, { status: 502 })
    const status = plan.items.length > 0 && deduped === plan.items.length ? 202 : 200
    return NextResponse.json(payload, { status })
  } catch (error) {
    const code = text((error as { code?: unknown })?.code)
    const status = code === "42501" ? 403 : code === "P0002" ? 404 : 503
    return NextResponse.json({ ok: false, error: "방문상담 알림 후처리를 완료하지 못했습니다." }, { status })
  }
}
