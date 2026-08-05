import type { SupabaseClient } from "@supabase/supabase-js"

import {
  REGISTRATION_CUSTOMER_MESSAGE_READINESS_CODES,
  assertRegistrationCustomerMessagePublicPayload,
  isRegistrationCustomerMessageKind,
  parseRegistrationCustomerMessageTarget,
  type RegistrationCustomerMessageHistoryItem,
  type RegistrationCustomerMessageKind,
  type RegistrationCustomerMessagePreviewResponse,
  type RegistrationCustomerMessageReadiness,
  type RegistrationCustomerMessageStatus,
} from "../registration-customer-message-contract.ts"
import {
  RegistrationCustomerMessageHttpError,
  createProductionRegistrationCustomerMessageAuth,
} from "./registration-customer-message-auth.ts"
import {
  createRegistrationCustomerMessageCatalog,
} from "./registration-customer-message-catalog.ts"
import {
  createRegistrationCustomerMessageSourceResolver,
  readRegistrationCustomerMessagePrivateSource,
  type RegistrationCustomerMessagePrivateSource,
  type RegistrationCustomerMessagePublicSource,
  type RegistrationCustomerMessageReadinessContract,
  type RegistrationCustomerMessagePreviewContract,
} from "./registration-customer-message-source.ts"

type JsonRecord = Record<string, unknown>
export type RegistrationCustomerMessageMaskedHistoryItem =
  | RegistrationCustomerMessageHistoryItem
  | Readonly<{
      messageKind: RegistrationCustomerMessageKind
      currentStatus: RegistrationCustomerMessageStatus
      confirmedAt: string
      updatedAt: string
    }>
type HandlerAuthContext = Readonly<{
  actorProfileId: string
  role: string
  actorClient: unknown
  serviceClient?: unknown
}>

type RouteDependencies = Readonly<{
  now?: () => Date
  authenticate(request: Request): Promise<HandlerAuthContext>
  authorizeTask(context: HandlerAuthContext, taskId: string): Promise<boolean>
  resolveSource(input: Readonly<{
    actorProfileId: string
    messageKind: RegistrationCustomerMessageKind
    sourceId: string
    context: HandlerAuthContext
  }>): Promise<RegistrationCustomerMessagePublicSource>
  resolveTaskId(input: Readonly<{
    messageKind: RegistrationCustomerMessageKind
    sourceId: string
    context: HandlerAuthContext
  }>): Promise<string | null>
  readPrivateSource(source: RegistrationCustomerMessagePublicSource): RegistrationCustomerMessagePrivateSource
  getReadiness(input: Readonly<{
    actorProfileId: string
    taskId: string
    messageKind: RegistrationCustomerMessageKind
    sourceId: string
    contract: RegistrationCustomerMessageReadinessContract
    context: HandlerAuthContext
  }>): Promise<unknown>
  createPreview(input: Readonly<{
    actorProfileId: string
    taskId: string
    messageKind: RegistrationCustomerMessageKind
    sourceId: string
    contract: RegistrationCustomerMessagePreviewContract
    context: HandlerAuthContext
  }>): Promise<unknown>
  listHistory(input: Readonly<{
    actorProfileId: string
    messageKind: RegistrationCustomerMessageKind
    sourceId: string
    limit: number
    context: HandlerAuthContext
  }>): Promise<unknown>
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const OPERATOR_ROLES = Object.freeze(["admin", "staff"])
const HISTORY_ROLES = Object.freeze(["admin", "staff", "teacher"])
const MESSAGE_STATUSES = new Set(["pending", "accepted", "unknown", "failed_hold"])
const READINESS_CODES = new Set(REGISTRATION_CUSTOMER_MESSAGE_READINESS_CODES)

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && value.trim() === value && Number.isFinite(Date.parse(value))
}

function exactKeys(value: JsonRecord, keys: ReadonlyArray<string>) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function errorResponse(error: unknown) {
  if (error instanceof RegistrationCustomerMessageHttpError) {
    return json({ ok: false, code: error.code }, error.status)
  }
  return json(
    { ok: false, code: "registration_customer_message_runtime_unavailable" },
    503,
  )
}

function httpError(status: number, code: string): never {
  throw new RegistrationCustomerMessageHttpError(status, code)
}

function requireRole(context: HandlerAuthContext, roles: ReadonlyArray<string>) {
  if (!roles.includes(context.role)) {
    httpError(403, "registration_customer_message_forbidden")
  }
}

async function resolvePreviewSource(
  dependencies: RouteDependencies,
  input: Parameters<RouteDependencies["resolveSource"]>[0],
) {
  try {
    return await dependencies.resolveSource(input)
  } catch (error) {
    if (error instanceof RegistrationCustomerMessageHttpError) throw error
    if (
      error instanceof Error
      && error.message.startsWith("registration_customer_message_")
      && ![
        "registration_customer_message_checksum_value_invalid",
        "registration_customer_message_clock_invalid",
        "registration_customer_message_recipient_hash_pepper_missing",
        "registration_customer_message_template_missing",
      ].includes(error.message)
    ) httpError(422, "registration_customer_message_source_invalid")
    throw error
  }
}

async function previewTarget(request: Request) {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    value = null
  }
  const target = parseRegistrationCustomerMessageTarget(value)
  if (!target) httpError(400, "registration_customer_message_preview_input_invalid")
  return target
}

function historyTarget(request: Request) {
  const params = new URL(request.url).searchParams
  if (
    [...params.keys()].length !== 2
    || params.getAll("messageKind").length !== 1
    || params.getAll("sourceId").length !== 1
  ) httpError(400, "registration_customer_message_history_input_invalid")
  const target = parseRegistrationCustomerMessageTarget({
    messageKind: params.get("messageKind"),
    sourceId: params.get("sourceId"),
  })
  if (!target) httpError(400, "registration_customer_message_history_input_invalid")
  return target
}

function readiness(value: unknown): RegistrationCustomerMessageReadiness {
  if (!isRecord(value) || !exactKeys(value, [
    "runtimeReady",
    "activationMode",
    "activationEligible",
    "credentialsConfigured",
    "pfConfigured",
    "templateConfigured",
    "templateVerified",
    "verifiedAt",
    "sourceValid",
    "sendAllowed",
    "blockers",
  ])) httpError(503, "registration_customer_message_readiness_unavailable")
  const booleans = [
    "runtimeReady",
    "activationEligible",
    "credentialsConfigured",
    "pfConfigured",
    "templateConfigured",
    "templateVerified",
    "sourceValid",
    "sendAllowed",
  ]
  if (
    booleans.some((key) => typeof value[key] !== "boolean")
    || !["off", "verification", "live"].includes(text(value.activationMode))
    || (value.verifiedAt !== null && !isTimestamp(value.verifiedAt))
    || !Array.isArray(value.blockers)
    || value.blockers.some((code) => !READINESS_CODES.has(code as never))
  ) httpError(503, "registration_customer_message_readiness_unavailable")
  return Object.freeze({
    runtimeReady: value.runtimeReady as boolean,
    activationMode: value.activationMode as RegistrationCustomerMessageReadiness["activationMode"],
    activationEligible: value.activationEligible as boolean,
    credentialsConfigured: value.credentialsConfigured as boolean,
    pfConfigured: value.pfConfigured as boolean,
    templateConfigured: value.templateConfigured as boolean,
    templateVerified: value.templateVerified as boolean,
    verifiedAt: value.verifiedAt as string | null,
    sourceValid: value.sourceValid as boolean,
    sendAllowed: value.sendAllowed as boolean,
    blockers: [...(value.blockers as RegistrationCustomerMessageReadiness["blockers"])],
  })
}

function historyItem(
  value: unknown,
  role: string,
  expectedKind: RegistrationCustomerMessageKind,
) {
  if (!isRecord(value)) httpError(503, "registration_customer_message_history_unavailable")
  if (
    !isRegistrationCustomerMessageKind(value.messageKind)
    || value.messageKind !== expectedKind
    || !MESSAGE_STATUSES.has(value.currentStatus as string)
    || !isTimestamp(value.confirmedAt)
    || !isTimestamp(value.updatedAt)
  ) httpError(503, "registration_customer_message_history_unavailable")
  const base = {
    messageKind: value.messageKind,
    currentStatus: value.currentStatus as RegistrationCustomerMessageStatus,
    confirmedAt: value.confirmedAt as string,
    updatedAt: value.updatedAt as string,
  }
  if (role === "teacher") return Object.freeze(base)
  if (
    !UUID_PATTERN.test(text(value.messageId))
    || !/^\d{4}$/u.test(text(value.recipientLast4))
    || typeof value.canCheck !== "boolean"
  ) httpError(503, "registration_customer_message_history_unavailable")
  return Object.freeze({
    messageId: value.messageId as string,
    ...base,
    recipientLast4: value.recipientLast4 as string,
    canCheck: value.canCheck,
  }) satisfies RegistrationCustomerMessageHistoryItem
}

function history(
  value: unknown,
  role: string,
  expectedKind: RegistrationCustomerMessageKind,
) {
  if (!Array.isArray(value)) httpError(503, "registration_customer_message_history_unavailable")
  return Object.freeze(
    value.map((item) => historyItem(item, role, expectedKind)),
  ) as ReadonlyArray<RegistrationCustomerMessageMaskedHistoryItem>
}

function previewReceipt(value: unknown, target: { messageKind: RegistrationCustomerMessageKind }, now: Date) {
  if (
    !isRecord(value)
    || !exactKeys(value, ["previewId", "expiresAt", "messageKind", "recipientLast4"])
    || !UUID_PATTERN.test(text(value.previewId))
    || !isTimestamp(value.expiresAt)
    || value.messageKind !== target.messageKind
    || !/^\d{4}$/u.test(text(value.recipientLast4))
    || Date.parse(value.expiresAt as string) <= now.getTime()
  ) httpError(503, "registration_customer_message_preview_unavailable")
  return {
    previewId: value.previewId as string,
    expiresAt: value.expiresAt as string,
    recipientLast4: value.recipientLast4 as string,
  }
}

export function createRegistrationCustomerMessageRouteHandlers(dependencies: RouteDependencies) {
  const now = dependencies.now ?? (() => new Date())

  return Object.freeze({
    async preview(request: Request) {
      try {
        const target = await previewTarget(request)
        const context = await dependencies.authenticate(request)
        requireRole(context, OPERATOR_ROLES)
        const taskId = await dependencies.resolveTaskId({ ...target, context })
        if (!taskId || !await dependencies.authorizeTask(context, taskId)) {
          httpError(404, "registration_customer_message_source_not_found")
        }
        const source = await resolvePreviewSource(dependencies, {
          actorProfileId: context.actorProfileId,
          ...target,
          context,
        })
        if (source.taskId !== taskId) {
          httpError(503, "registration_customer_message_source_unavailable")
        }
        const privateSource = dependencies.readPrivateSource(source)
        const [readinessValue, historyValue] = await Promise.all([
          dependencies.getReadiness({
            actorProfileId: context.actorProfileId,
            taskId: source.taskId,
            ...target,
            contract: privateSource.readinessContract,
            context,
          }),
          dependencies.listHistory({
            actorProfileId: context.actorProfileId,
            ...target,
            limit: 1,
            context,
          }),
        ])
        const normalizedReadiness = readiness(readinessValue)
        const normalizedHistory = history(
          historyValue,
          context.role,
          target.messageKind,
        )
        const latestMessage = normalizedHistory[0] ?? null
        if (
          latestMessage
          && (!("messageId" in latestMessage) || !("canCheck" in latestMessage))
        ) httpError(503, "registration_customer_message_history_unavailable")
        let receipt: { previewId: string; expiresAt: string; recipientLast4: string } | null = null
        if (normalizedReadiness.sendAllowed) {
          receipt = previewReceipt(await dependencies.createPreview({
            actorProfileId: context.actorProfileId,
            taskId: source.taskId,
            ...target,
            contract: privateSource.previewContract,
            context,
          }), target, now())
          if (receipt.recipientLast4 !== source.recipientLast4) {
            httpError(503, "registration_customer_message_preview_unavailable")
          }
        }
        const payload: RegistrationCustomerMessagePreviewResponse = {
          ok: true,
          previewId: receipt?.previewId ?? null,
          expiresAt: receipt?.expiresAt ?? null,
          messageKind: source.messageKind,
          studentName: source.studentName,
          recipientLast4: source.recipientLast4,
          facts: source.facts,
          body: source.body,
          buttons: source.buttons,
          readiness: normalizedReadiness,
          latestMessage,
        }
        return json(assertRegistrationCustomerMessagePublicPayload(payload))
      } catch (error) {
        return errorResponse(error)
      }
    },

    async messages(request: Request) {
      try {
        const target = historyTarget(request)
        const context = await dependencies.authenticate(request)
        requireRole(context, HISTORY_ROLES)
        if (context.role !== "teacher") {
          const taskId = await dependencies.resolveTaskId({ ...target, context })
          if (!taskId || !await dependencies.authorizeTask(context, taskId)) {
            httpError(404, "registration_customer_message_source_not_found")
          }
        }
        const result = history(await dependencies.listHistory({
          actorProfileId: context.actorProfileId,
          ...target,
          limit: 20,
          context,
        }), context.role, target.messageKind)
        return json(assertRegistrationCustomerMessagePublicPayload(result))
      } catch (error) {
        return errorResponse(error)
      }
    },
  })
}

function serviceClient(context: HandlerAuthContext) {
  if (!context.serviceClient) {
    httpError(503, "registration_customer_message_runtime_unavailable")
  }
  return context.serviceClient as SupabaseClient
}

function actorClient(context: HandlerAuthContext) {
  if (!context.actorClient) {
    httpError(503, "registration_customer_message_runtime_unavailable")
  }
  return context.actorClient as SupabaseClient
}

async function rpc(context: HandlerAuthContext, name: string, args: JsonRecord) {
  const result = await serviceClient(context).rpc(name, args)
  if (result.error) {
    httpError(503, "registration_customer_message_runtime_unavailable")
  }
  return result.data
}

async function sourceRpc(context: HandlerAuthContext, args: JsonRecord) {
  const result = await serviceClient(context).rpc(
    "resolve_registration_customer_message_source_v1",
    args,
  )
  if (result.error) {
    const code = text((result.error as { code?: unknown }).code)
    if (code === "42501" || code === "P0002") {
      httpError(404, "registration_customer_message_source_not_found")
    }
    if (code === "22023" || code === "23505") {
      throw new Error("registration_customer_message_source_invalid")
    }
    httpError(503, "registration_customer_message_runtime_unavailable")
  }
  return result.data
}

export function registrationCustomerMessageHistoryRpcError(error: unknown) {
  const code = isRecord(error) ? text(error.code) : ""
  return code === "42501" || code === "P0002" || code === "22023"
    ? new RegistrationCustomerMessageHttpError(
        404,
        "registration_customer_message_source_not_found",
      )
    : new RegistrationCustomerMessageHttpError(
        503,
        "registration_customer_message_history_unavailable",
      )
}

async function historyRpc(context: HandlerAuthContext, args: JsonRecord) {
  const result = await serviceClient(context).rpc(
    "list_registration_customer_messages_v1",
    args,
  )
  if (result.error) {
    throw registrationCustomerMessageHistoryRpcError(result.error)
  }
  return result.data
}

export function createProductionRegistrationCustomerMessageRouteHandlers() {
  const catalog = createRegistrationCustomerMessageCatalog({
    SOLAPI_API_KEY: process.env.SOLAPI_API_KEY,
    SOLAPI_API_SECRET: process.env.SOLAPI_API_SECRET,
    SOLAPI_KAKAO_PF_ID: process.env.SOLAPI_KAKAO_PF_ID,
    SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID:
      process.env.SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID:
      process.env.SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID:
      process.env.SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID,
    SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID:
      process.env.SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID:
      process.env.SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID,
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER:
      process.env.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER,
  })
  const pepper = text(process.env.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER)
  let auth: ReturnType<typeof createProductionRegistrationCustomerMessageAuth> | null = null
  const productionAuth = () => {
    auth ??= createProductionRegistrationCustomerMessageAuth()
    return auth
  }

  return createRegistrationCustomerMessageRouteHandlers({
    authenticate(request) {
      return productionAuth().authenticate(request)
    },
    authorizeTask(context, taskId) {
      return productionAuth().authorizeTask(
        context as Parameters<ReturnType<typeof createProductionRegistrationCustomerMessageAuth>["authorizeTask"]>[0],
        taskId,
      )
    },
    async resolveSource(input) {
      const resolver = createRegistrationCustomerMessageSourceResolver({
        catalog,
        recipientHashPepper: pepper,
        async resolveSource(target) {
          return sourceRpc(input.context, {
            p_actor_profile_id: target.actorProfileId,
            p_message_kind: target.messageKind,
            p_source_id: target.sourceId,
          })
        },
      })
      return resolver.resolve(input)
    },
    async resolveTaskId(input) {
      if (input.messageKind === "admission_application") return input.sourceId
      const table = input.messageKind === "waiting_notice"
        ? "ops_registration_subject_tracks"
        : "ops_registration_appointments"
      const result = await actorClient(input.context)
        .from(table)
        .select("task_id")
        .eq("id", input.sourceId)
        .maybeSingle()
      if (result.error) {
        httpError(503, "registration_customer_message_runtime_unavailable")
      }
      const taskId = text((result.data as { task_id?: unknown } | null)?.task_id).toLowerCase()
      return UUID_PATTERN.test(taskId) ? taskId : null
    },
    readPrivateSource: readRegistrationCustomerMessagePrivateSource,
    getReadiness(input) {
      return rpc(input.context, "get_registration_customer_solapi_readiness_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_message_kind: input.messageKind,
        p_source_id: input.sourceId,
        p_template_contract: input.contract,
      })
    },
    createPreview(input) {
      return rpc(input.context, "create_registration_customer_message_preview_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_message_kind: input.messageKind,
        p_source_id: input.sourceId,
        p_contract: input.contract,
      })
    },
    listHistory(input) {
      return historyRpc(input.context, {
        p_actor_profile_id: input.actorProfileId,
        p_message_kind: input.messageKind,
        p_source_id: input.sourceId,
        p_limit: input.limit,
      })
    },
  })
}
