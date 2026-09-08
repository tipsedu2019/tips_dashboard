import { createProductionRegistrationCustomerMessageAuth } from "./registration-customer-message-auth.ts"
import { parseRegistrationObservationChatPreview } from "../registration-observation-chat-service.ts"
import { createGoogleChatProvider, buildGoogleChatCardPayload } from "../../notifications/server/providers/google-chat-provider.ts"
import { decodeNotificationConnectionEncryptionKey, decryptNotificationConnectionSecret, validateGoogleChatWebhookUrl } from "../../notifications/server/notification-connection-crypto.ts"
import type { SupabaseClient } from "@supabase/supabase-js"

type RecordValue = Record<string, unknown>
type Client = { rpc(name: string, input: RecordValue): PromiseLike<{ data: unknown; error: unknown }> }
type Context = { actorProfileId: string; role: string; actorClient: Client; serviceClient: Client }
type Dependencies = {
  authenticate(request: Request): Promise<Context>
  readWebhook(client: Client, connectionKey: string, revision: string): Promise<string>
  fetch: typeof fetch
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value) }
function response(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }) }
async function rpc(client: Client, name: string, input: RecordValue) { const result = await client.rpc(name, input); if (result.error) throw result.error; return result.data }
function parseTarget(row: RecordValue) {
  if (typeof row.observationId !== "string" || !UUID.test(row.observationId)
    || !["handoff", "feedback_request"].includes(String(row.intent))) throw Object.assign(new Error("invalid"), { status: 400 })
  return { p_observation_id: row.observationId, p_intent: row.intent }
}
function errorResponse(error: unknown) {
  const row = record(error) ? error : {}
  const message = typeof row.message === "string" ? row.message : ""
  if ([401, 403].includes(Number(row.status)) || row.code === "42501") return response({ ok: false, error: "알림을 보낼 권한을 확인해 주세요." }, row.status === 401 ? 401 : 403)
  if (row.status === 400 || row.code === "22023") return response({ ok: false, error: "알림 요청 형식을 확인해 주세요." }, 400)
  const copy = message.includes("teacher_unverified") ? "담당 선생님의 Google Chat 계정 연결을 먼저 확인해 주세요."
    : message.includes("connection_missing") ? "과목팀의 Google Chat 연결을 먼저 설정해 주세요."
      : message.includes("source_changed") || message.includes("source_dirty") ? "청강 수업 정보가 변경되었습니다. 예약 정보를 다시 확인해 주세요."
        : message.includes("not_ready") ? "현재 청강 상태에서는 이 알림을 보낼 수 없습니다. 예약과 수업 종료 여부를 확인해 주세요."
          : "청강 알림을 처리하지 못했습니다. 내용을 다시 확인해 주세요."
  return response({ ok: false, error: copy }, ["23514", "55000", "P0002"].includes(String(row.code)) ? 409 : 503)
}
function parseBegun(value: unknown) {
  if (!record(value) || typeof value.acquired !== "boolean") throw new Error("invalid claim")
  if (!value.acquired) {
    if (!["sent", "failed", "unknown"].includes(String(value.status))) throw new Error("invalid receipt")
    return { acquired: false as const, status: value.status }
  }
  if (typeof value.attemptId !== "string" || !UUID.test(value.attemptId)
    || typeof value.claimToken !== "string" || !UUID.test(value.claimToken) || !record(value.context)) throw new Error("invalid claim")
  const c = value.context
  const preview = parseRegistrationObservationChatPreview({ ...c, status: "ready", canSend: true })
  if (!/^google_chat\.(english|math|science)$/.test(String(c.connectionKey))
    || typeof c.connectionRevision !== "string" || !/^\d+$/.test(c.connectionRevision)
    || typeof c.teacherMention !== "string" || !/^users\/[1-9]\d{0,31}$/.test(c.teacherMention)
    || typeof c.href !== "string") throw new Error("invalid dispatch context")
  return { acquired: true as const, attemptId: value.attemptId, claimToken: value.claimToken, preview,
    connectionKey: c.connectionKey as string, connectionRevision: c.connectionRevision,
    teacherMention: c.teacherMention, href: c.href }
}
export function createRegistrationObservationChatHandlers(dependencies: Dependencies) {
  async function authenticate(request: Request) {
    const context = await dependencies.authenticate(request)
    if (!["admin", "staff"].includes(context.role)) throw Object.assign(new Error("forbidden"), { status: 403 })
    return context
  }
  return {
    async GET(request: Request) {
      try {
        const context = await authenticate(request)
        const parameters = new URL(request.url).searchParams
        if ([...parameters.keys()].length !== 2 || parameters.getAll("observationId").length !== 1 || parameters.getAll("intent").length !== 1) return response({ ok: false }, 400)
        const target = parseTarget(Object.fromEntries(parameters))
        const raw = await rpc(context.actorClient, "get_registration_observation_explicit_chat_preview_v1", target)
        return response({ ok: true, preview: parseRegistrationObservationChatPreview(raw) })
      } catch (error) { return errorResponse(error) }
    },
    async POST(request: Request) {
      try {
        const context = await authenticate(request)
        const body = await request.json().catch(() => null)
        if (!record(body) || Object.keys(body).sort().join() !== "confirmed,intent,observationId,previewChecksum,requestId"
          || body.confirmed !== true || typeof body.requestId !== "string" || !UUID.test(body.requestId)
          || typeof body.previewChecksum !== "string" || !/^[a-f0-9]{64}$/.test(body.previewChecksum)) return response({ ok: false }, 400)
        const target = parseTarget(body)
        const begun = parseBegun(await rpc(context.serviceClient, "begin_registration_observation_explicit_chat_v1", {
          ...target, p_actor: context.actorProfileId, p_request_id: body.requestId, p_preview_checksum: body.previewChecksum,
        }))
        if (!begun.acquired) return response({ ok: true, status: begun.status })
        const claim = { p_attempt_id: begun.attemptId, p_claim_token: begun.claimToken }
        let registered = false
        let attemptRequested = false
        const finish = (status: string, reference: string) => rpc(context.serviceClient, "finish_registration_observation_explicit_chat_v1", {
          ...claim, p_status: status, p_provider_reference: reference,
        })
        try {
          if (begun.preview.observationId !== body.observationId || begun.preview.intent !== body.intent || begun.preview.previewChecksum !== body.previewChecksum) throw new Error("claim identity mismatch")
          const webhook = validateGoogleChatWebhookUrl(await dependencies.readWebhook(context.serviceClient, begun.connectionKey, begun.connectionRevision))
          const providerContext = { delivery_id: begun.attemptId, claim_token: begun.claimToken, dispatch_token: begun.claimToken,
            status: "sending" as const, workflow_key: "registration" as const, channel_key: "google_chat" as const,
            connection_key: begun.connectionKey, webhook_url: webhook, rendered_title: begun.preview.renderedTitle,
            rendered_body: begun.preview.renderedBody, href: begun.href, mention_user_names: [begun.teacherMention] }
          if (!buildGoogleChatCardPayload(providerContext, { includeAppLink: false }).ok) throw new Error("unsafe render")
          // The fixed-purpose external-attempt gate revalidates the source and recipient immediately before HTTP.
          attemptRequested = true
          const allowed = await rpc(context.serviceClient, "register_registration_observation_explicit_chat_attempt_v1", claim)
          if (allowed !== true) { await finish("unknown", "external_attempt_not_acquired"); return response({ ok: true, status: "unknown" }) }
          registered = true
          const result = await createGoogleChatProvider({
            http408Disposition: "delivery_unknown",
            includeAppLink: false,
            fetch: (url, init) => dependencies.fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
          }).send(providerContext)
          const status = result.status === "sent" ? "sent" : result.status === "delivery_unknown" ? "unknown" : "failed"
          await finish(status, result.providerMessageId || result.errorCode || result.providerResponseCode || status)
          return response({ ok: true, status })
        } catch (error) {
          // A committed attempt or lost registration response can never be retried as a known failure.
          const knownRejection = record(error) && ["23514", "42501", "55000", "P0002"].includes(String(error.code))
          const uncertain = registered || (attemptRequested && !knownRejection)
          const status = uncertain ? "unknown" : "failed"
          await finish(status, uncertain ? "provider_outcome_unavailable" : "pre_dispatch_validation_failed").catch(() => undefined)
          if (uncertain) return response({ ok: true, status: "unknown" })
          return errorResponse(error)
        }
      } catch (error) { return errorResponse(error) }
    },
  }
}
export function createProductionRegistrationObservationChatHandlers() {
  return createRegistrationObservationChatHandlers({
    authenticate: (request) => createProductionRegistrationCustomerMessageAuth().authenticate(request),
    fetch: (...args) => fetch(...args),
    async readWebhook(client, connectionKey, revision) {
      const channel = connectionKey.slice("google_chat.".length)
      const { data, error } = await (client as SupabaseClient).from("google_chat_webhook_settings")
        .select("revision,connection_state,webhook_url,webhook_url_ciphertext").eq("channel", channel).maybeSingle()
      if (error || !data || String(data.revision) !== revision || !["legacy_active", "encrypted_active"].includes(data.connection_state)) throw new Error("connection changed")
      return data.connection_state === "encrypted_active"
        ? decryptNotificationConnectionSecret(data.webhook_url_ciphertext, decodeNotificationConnectionEncryptionKey(process.env.NOTIFICATION_CONNECTION_ENCRYPTION_KEY || ""))
        : data.webhook_url
    },
  })
}
