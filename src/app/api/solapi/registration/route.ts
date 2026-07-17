import { createHash, createHmac, randomBytes } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getRegistrationAdmissionApplicationState } from "@/features/tasks/registration-track-model"
import {
  createRegistrationRuntimeProbe,
  type RegistrationRuntimeProbeClient,
} from "@/features/tasks/registration-runtime-probe"

import { createRegistrationAdmissionRouteHandlers } from "./core.js"

export const runtime = "nodejs"

type Row = Record<string, unknown>
type Client = SupabaseClient

type AdmissionFinalizationResponse = {
  taskId: string
  messageId: string
  messageRequestKey: string
  applied: boolean
  currentStatus: "pending" | "accepted" | "failed" | "unknown"
  claimActive: boolean
  requiresAdmissionMark: boolean
  retryRequiresNewMessageKey: boolean
}

function text(value: unknown) {
  return String(value || "").trim()
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, "")
}

function getSupabaseUrl() {
  return text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
}

function getAuthenticatedClient(token: string) {
  const supabaseUrl = getSupabaseUrl()
  const supabaseAnonKey = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  if (!supabaseUrl || !supabaseAnonKey || !token) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function getServiceClient() {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

async function getAuthenticatedContext(request: Request) {
  const authorization = text(request.headers.get("authorization"))
  const token = authorization.replace(/^Bearer\s+/i, "")
  const client = getAuthenticatedClient(token)
  const serviceClient = getServiceClient()
  if (!client || !token) return { userId: "", role: "", client, serviceClient }

  const { data, error } = await client.auth.getUser(token)
  const userId = text(data.user?.id)
  if (!userId || error) return { userId: "", role: "", client, serviceClient }

  let role = ""
  if (serviceClient) {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
    role = text((profile as Row | null)?.role)
  }
  return { userId, role, client, serviceClient }
}

function getSolapiConfiguration() {
  const apiKey = text(process.env.SOLAPI_API_KEY)
  const apiSecret = text(process.env.SOLAPI_API_SECRET)
  const pfId = text(process.env.SOLAPI_KAKAO_PF_ID)
  const templateId = text(process.env.SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID)
  const missing = [
    !apiKey ? "API 키" : "",
    !apiSecret ? "API 시크릿" : "",
    !pfId ? "카카오 채널 ID" : "",
    !templateId ? "승인 템플릿 ID" : "",
  ].filter(Boolean)
  return { apiKey, apiSecret, pfId, templateId, configured: missing.length === 0, missing }
}

function createSolapiAuthorization(apiKey: string, apiSecret: string) {
  const date = new Date().toISOString()
  const salt = randomBytes(16).toString("hex")
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex")
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

function deterministicDeliveryRequestId(messageId: string, messageRequestKey: string) {
  const bytes = createHash("sha256")
    .update(["registration-solapi-delivery-v1", messageId, messageRequestKey].join("\u001f"))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function throwQueryError(error: unknown) {
  if (error) throw error
}

async function loadReadyCase(
  client: Client,
  serviceClient: Client | null,
  taskId: string,
  options: { includeProvider?: boolean } = {},
) {
  const includeProvider = Boolean(options.includeProvider)
  const protectedClient = includeProvider ? serviceClient : client
  if (!protectedClient) throw new Error("Missing service role")

  const detailColumns = includeProvider
    ? "task_id,admission_notice_sent,parent_phone"
    : "task_id,admission_notice_sent"
  const messageColumns = includeProvider
    ? "id,status,claim_active,request_key,recipient_last4,provider_message_id,provider_group_id,provider_status_code,provider_status_message,created_at,updated_at"
    : "id,status,claim_active,request_key,created_at,updated_at"
  const [taskResult, detailResult, trackResult, messageResult] = await Promise.all([
    client.from("ops_tasks").select("id,type").eq("id", taskId).maybeSingle(),
    protectedClient.from("ops_registration_details").select(detailColumns).eq("task_id", taskId).maybeSingle(),
    client.from("ops_registration_subject_tracks").select("id,pipeline_status").eq("task_id", taskId),
    protectedClient
      .from("ops_registration_messages")
      .select(messageColumns)
      .eq("task_id", taskId)
      .eq("template_key", "admission_application")
      .eq("claim_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  throwQueryError(taskResult.error)
  throwQueryError(detailResult.error)
  throwQueryError(trackResult.error)
  throwQueryError(messageResult.error)

  const trackRows = (trackResult.data || []) as Row[]
  const trackIds = trackRows.map((track) => text(track.id)).filter(Boolean)
  let enrollmentRows: Row[] = []
  if (trackIds.length > 0) {
    const enrollmentResult = await client
      .from("ops_registration_enrollments")
      .select("track_id,status,admission_batch_id,roster_active")
      .in("track_id", trackIds)
    throwQueryError(enrollmentResult.error)
    enrollmentRows = (enrollmentResult.data || []) as Row[]
  }

  const activeMessage = messageResult.data as Row | null
  const currentRecipient = digits((detailResult.data as Row | null)?.parent_phone)
  const frozenRecipientLast4 = text(activeMessage?.recipient_last4)
  const frozenRecipient = includeProvider
    && Boolean(activeMessage?.claim_active)
    && frozenRecipientLast4.length === 4
    && currentRecipient.endsWith(frozenRecipientLast4)
    ? currentRecipient
    : ""

  return {
    task: taskResult.data as Row | null,
    detail: detailResult.data as Row | null,
    tracks: trackRows.map((track) => ({
      id: text(track.id),
      status: text(track.pipeline_status),
    })),
    enrollments: enrollmentRows.map((enrollment) => ({
      trackId: text(enrollment.track_id),
      status: text(enrollment.status),
      admissionBatchId: text(enrollment.admission_batch_id) || null,
      rosterActive: Boolean(enrollment.roster_active),
    })),
    activeMessage,
    frozenRecipient,
  }
}

async function callRpc<T>(client: Client, name: string, parameters: Row): Promise<T> {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw error
  if (!data || typeof data !== "object") throw new Error(`${name} returned no result`)
  return data as T
}

async function finalizeAdmissionMessage(
  serviceClient: Client,
  input: { messageId: string; result: "accepted" | "failed" | "unknown"; providerResult: Row },
) {
  const { data, error } = await serviceClient.rpc("finalize_registration_admission_message", {
    p_message_id: input.messageId,
    p_result: input.result,
    p_provider_result: input.providerResult,
  })
  if (error) throw error
  if (!data || typeof data !== "object") throw new Error("Admission message finalizer returned no result")
  return data as AdmissionFinalizationResponse
}

const handlers = createRegistrationAdmissionRouteHandlers({
  authenticate: getAuthenticatedContext,
  probeRuntime: (client: Client) => createRegistrationRuntimeProbe(
    client as unknown as RegistrationRuntimeProbeClient,
  ).probe(),
  loadLegacyHandlers: () => import("./legacy"),
  loadReadyCase,
  getAdmissionState: getRegistrationAdmissionApplicationState,
  getConfiguration: getSolapiConfiguration,
  createAuthorization: createSolapiAuthorization,
  fetch: globalThis.fetch,
  now: () => new Date(),
  claim: (client: Client, input: { taskId: string; messageRequestKey: string }) => callRpc(client, "claim_registration_admission_message", {
    p_task_id: input.taskId,
    p_message_request_key: input.messageRequestKey,
  }),
  beginDelivery: (serviceClient: Client, input: { messageId: string; messageRequestKey: string }) => callRpc(
    serviceClient,
    "begin_registration_admission_delivery_v1",
    {
      p_message_id: input.messageId,
      p_request_id: deterministicDeliveryRequestId(input.messageId, input.messageRequestKey),
    },
  ),
  recordLegacyIntent: (serviceClient: Client, input: {
    deliveryId: string
    legacyTemplateChecksum: string
    normalizedRenderedHash: string
    requestId: string
  }) => callRpc(serviceClient, "record_legacy_notification_delivery_intent_v1", {
    p_delivery_id: input.deliveryId,
    p_legacy_template_checksum: input.legacyTemplateChecksum,
    p_normalized_rendered_hash: input.normalizedRenderedHash,
    p_request_id: input.requestId,
  }),
  registerExternalAttempt: (serviceClient: Client, input: {
    deliveryId: string
    claimId: string
    ownerGeneration: string
    claimToken: string | null
    dispatchToken: string
  }) => callRpc(serviceClient, "register_notification_external_attempt_v1", {
    p_delivery_id: input.claimToken ? input.deliveryId : null,
    p_claim_id: input.claimId,
    p_owner_generation: input.ownerGeneration,
    p_claim_token: input.claimToken,
    p_dispatch_token: input.dispatchToken,
    p_request_id: input.dispatchToken,
  }),
  completeDelivery: (serviceClient: Client, input: {
    messageId: string
    deliveryId: string
    claimId: string
    ownerGeneration: string
    claimToken: string | null
    dispatchToken: string
    result: "accepted" | "failed" | "unknown"
    providerResult: Row
    outcome: "sent" | "failed" | "delivery_unknown"
    providerReference: string
  }) => callRpc<AdmissionFinalizationResponse>(
    serviceClient,
    "complete_registration_admission_delivery_v1",
    {
      p_message_id: input.messageId,
      p_delivery_id: input.deliveryId,
      p_claim_id: input.claimId,
      p_owner_generation: input.ownerGeneration,
      p_claim_token: input.claimToken,
      p_dispatch_token: input.dispatchToken,
      p_result: input.result,
      p_provider_result: input.providerResult,
      p_outcome: input.outcome,
      p_provider_reference: input.providerReference.slice(0, 512),
    },
  ),
  finalize: finalizeAdmissionMessage,
  reconcile: (client: Client, input: {
    messageId: string
    resolution: "accepted" | "failed"
    providerEvidence: Row
    reason: string
    requestKey: string
  }) => callRpc(client, "reconcile_registration_admission_message", {
    p_message_id: input.messageId,
    p_resolution: input.resolution,
    p_provider_evidence: input.providerEvidence,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  }),
  release: (client: Client, input: {
    messageId: string
    providerEvidence: Row
    reason: string
    requestKey: string
  }) => callRpc(client, "release_registration_admission_message_retry", {
    p_message_id: input.messageId,
    p_provider_evidence: input.providerEvidence,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  }),
  mark: (client: Client, input: { taskId: string; messageRequestKey: string; requestKey: string }) => callRpc(client, "mark_registration_admission_notice_sent", {
    p_task_id: input.taskId,
    p_message_request_key: input.messageRequestKey,
    p_request_key: input.requestKey,
  }),
})

export async function GET(request: Request) {
  return handlers.get(request)
}

export async function POST(request: Request) {
  return handlers.post(request)
}
