import { createHmac } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  REGISTRATION_CUSTOMER_MESSAGE_READINESS_CODES,
  assertRegistrationCustomerMessagePublicPayload,
  isRegistrationCustomerMessageKind,
  parseRegistrationCustomerMessageAdminAction,
  parseRegistrationCustomerMessageCheckInput,
  parseRegistrationCustomerMessageSendInput,
  parseRegistrationCustomerMessageTarget,
  type RegistrationCustomerMessageAdminAction,
  type RegistrationCustomerMessageHistoryItem,
  type RegistrationCustomerMessageKind,
  type RegistrationCustomerMessagePreviewResponse,
  type RegistrationCustomerMessageProviderEvidenceInput,
  type RegistrationCustomerMessageReadiness,
  type RegistrationCustomerMessageSendResult,
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
  createRegistrationCustomerMessageSolapi,
  type RegistrationCustomerMessageProviderResult,
} from "./registration-customer-message-solapi.ts"
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
  readPreviewTarget(input: Readonly<{
    actorProfileId: string
    previewId: string
    context: HandlerAuthContext
  }>): Promise<unknown>
  claimMessage(input: Readonly<{
    actorProfileId: string
    previewId: string
    requestKey: string
    contract: RegistrationCustomerMessagePreviewContract
    context: HandlerAuthContext
  }>): Promise<unknown>
  releasePreSendClaim(input: Readonly<{
    messageId: string
    claimToken: string
    errorCode: string
    context: HandlerAuthContext
  }>): Promise<unknown>
  markAttemptStarted(input: Readonly<{
    messageId: string
    claimToken: string
    dispatchToken: string
    contract: RegistrationCustomerMessagePreviewContract
    context: HandlerAuthContext
  }>): Promise<unknown>
  sendProvider(input: Readonly<{
    to: string
    templateId: string
    variables: Readonly<Record<string, string>>
    buttons: RegistrationCustomerMessagePrivateSource["rendered"]["buttons"]
    requestKey: string
  }>): Promise<RegistrationCustomerMessageProviderResult>
  finalizeMessage(input: Readonly<{
    messageId: string
    dispatchToken: string
    outcome: "accepted" | "failed_hold" | "unknown"
    evidence: RegistrationCustomerMessageProviderEvidenceInput
    context: HandlerAuthContext
  }>): Promise<unknown>
  readCheckContext(input: Readonly<{
    actorProfileId: string
    messageId: string
    context: HandlerAuthContext
  }>): Promise<unknown>
  lookupProvider(input: Readonly<{
    providerMessageId: string
    providerGroupId?: string
    requestKey: string
  }>): Promise<RegistrationCustomerMessageProviderResult>
  recordProviderCheck(input: Readonly<{
    actorProfileId: string
    messageId: string
    resolution: "accepted" | "failed_hold"
    evidence: RegistrationCustomerMessageProviderEvidenceInput
    requestKey: string
    context: HandlerAuthContext
  }>): Promise<unknown>
  preflightTemplate(input: Readonly<{
    messageKind: RegistrationCustomerMessageKind
    context: HandlerAuthContext
  }>): Promise<unknown>
  recordTemplateReceipt(input: Readonly<{
    actorProfileId: string
    messageKind: RegistrationCustomerMessageKind
    receipt: JsonRecord
    context: HandlerAuthContext
  }>): Promise<unknown>
  performAdminAction(input: Readonly<{
    actorProfileId: string
    action: RegistrationCustomerMessageAdminAction
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

function text(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
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

async function strictJson(request: Request) {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}

async function sendInput(request: Request) {
  const input = parseRegistrationCustomerMessageSendInput(await strictJson(request))
  if (!input) httpError(400, "registration_customer_message_send_input_invalid")
  return input
}

async function checkInput(request: Request) {
  const input = parseRegistrationCustomerMessageCheckInput(await strictJson(request))
  if (!input) httpError(400, "registration_customer_message_check_input_invalid")
  return input
}

async function adminInput(request: Request) {
  const input = parseRegistrationCustomerMessageAdminAction(await strictJson(request))
  if (!input) httpError(400, "registration_customer_message_admin_input_invalid")
  return input
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

type PrivateSendResult = RegistrationCustomerMessageSendResult & Readonly<{
  owner?: boolean
  claimToken?: string
  dispatchToken?: string
}>

function sendResult(value: unknown): PrivateSendResult {
  if (!isRecord(value)) httpError(503, "registration_customer_message_result_unavailable")
  if (
    typeof value.ok !== "boolean"
    || !UUID_PATTERN.test(text(value.messageId))
    || !isRegistrationCustomerMessageKind(value.messageKind)
    || !MESSAGE_STATUSES.has(value.currentStatus as string)
    || !/^\d{4}$/u.test(text(value.recipientLast4))
    || !isTimestamp(value.confirmedAt)
    || !isTimestamp(value.updatedAt)
    || typeof value.canCheck !== "boolean"
    || typeof value.idempotent !== "boolean"
    || (value.owner !== undefined && typeof value.owner !== "boolean")
    || (value.claimToken !== undefined && !UUID_PATTERN.test(text(value.claimToken)))
    || (value.dispatchToken !== undefined && !UUID_PATTERN.test(text(value.dispatchToken)))
  ) httpError(503, "registration_customer_message_result_unavailable")
  return Object.freeze({
    ok: value.ok,
    messageId: value.messageId as string,
    messageKind: value.messageKind,
    currentStatus: value.currentStatus as RegistrationCustomerMessageStatus,
    recipientLast4: value.recipientLast4 as string,
    confirmedAt: value.confirmedAt as string,
    updatedAt: value.updatedAt as string,
    canCheck: value.canCheck,
    idempotent: value.idempotent,
    ...(value.owner === undefined ? {} : { owner: value.owner }),
    ...(value.claimToken === undefined ? {} : { claimToken: value.claimToken as string }),
    ...(value.dispatchToken === undefined ? {} : { dispatchToken: value.dispatchToken as string }),
  })
}

function publicSendResult(value: PrivateSendResult): RegistrationCustomerMessageSendResult {
  return Object.freeze({
    ok: value.ok,
    messageId: value.messageId,
    messageKind: value.messageKind,
    currentStatus: value.currentStatus,
    recipientLast4: value.recipientLast4,
    confirmedAt: value.confirmedAt,
    updatedAt: value.updatedAt,
    canCheck: value.canCheck,
    idempotent: value.idempotent,
  })
}

function previewTargetValue(value: unknown) {
  if (!isRecord(value)) httpError(409, "registration_customer_message_confirmation_conflict")
  const target = parseRegistrationCustomerMessageTarget({
    messageKind: value.messageKind,
    sourceId: value.sourceId,
  })
  const taskId = text(value.taskId).toLowerCase()
  if (!target || !UUID_PATTERN.test(taskId)) {
    httpError(409, "registration_customer_message_confirmation_conflict")
  }
  return { ...target, taskId }
}

function marker(value: unknown, expected: Readonly<{ messageId: string; dispatchToken: string }>) {
  if (
    !isRecord(value)
    || typeof value.allowed !== "boolean"
    || text(value.messageId).toLowerCase() !== expected.messageId
    || !MESSAGE_STATUSES.has(value.currentStatus as string)
    || (value.allowed && text(value.dispatchToken).toLowerCase() !== expected.dispatchToken)
    || (!value.allowed && value.dispatchToken !== undefined)
  ) httpError(503, "registration_customer_message_attempt_unavailable")
  return {
    allowed: value.allowed,
    messageId: value.messageId as string,
    currentStatus: value.currentStatus as RegistrationCustomerMessageStatus,
  }
}

function databaseCode(error: unknown) {
  return isRecord(error) ? text(error.code) : ""
}

function claimError(error: unknown): never {
  if (["23505", "40001", "P0002", "42501", "22023"].includes(databaseCode(error))) {
    httpError(409, "registration_customer_message_confirmation_conflict")
  }
  httpError(503, "registration_customer_message_runtime_unavailable")
}

function unknownAfterMarker(claim: PrivateSendResult): RegistrationCustomerMessageSendResult {
  return Object.freeze({
    ...publicSendResult(claim),
    ok: false,
    currentStatus: "unknown",
    canCheck: false,
  })
}

function checkContext(value: unknown) {
  if (!isRecord(value)) httpError(409, "registration_customer_message_check_not_allowed")
  const providerMessageId = text(value.providerMessageId, 200)
  const providerGroupId = text(value.providerGroupId, 200)
  const requestKey = text(value.requestKey).toLowerCase()
  if (!providerMessageId || !UUID_PATTERN.test(requestKey)) {
    httpError(409, "registration_customer_message_check_not_allowed")
  }
  return {
    providerMessageId,
    ...(providerGroupId ? { providerGroupId } : {}),
    requestKey,
  }
}

function adminPublicResult(action: RegistrationCustomerMessageAdminAction, value: unknown) {
  if (action.action === "reconcile" || action.action === "release_pre_send") {
    return publicSendResult(sendResult(value))
  }
  if (!isRecord(value) || value.messageKind !== action.messageKind) {
    httpError(503, "registration_customer_message_admin_result_unavailable")
  }
  if (action.action === "set_activation") {
    if (
      !["off", "verification", "live"].includes(text(value.activationMode))
      || !isTimestamp(value.updatedAt)
    ) httpError(503, "registration_customer_message_admin_result_unavailable")
    return Object.freeze({
      ok: true,
      messageKind: action.messageKind,
      activationMode: value.activationMode,
      updatedAt: value.updatedAt,
    })
  }
  if (action.action === "record_live_test_receipt") {
    if (value.recorded !== true || !isTimestamp(value.receivedAt)) {
      httpError(503, "registration_customer_message_admin_result_unavailable")
    }
    return Object.freeze({
      ok: true,
      messageKind: action.messageKind,
      updatedAt: value.receivedAt,
    })
  }
  httpError(503, "registration_customer_message_admin_result_unavailable")
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

    async send(request: Request) {
      try {
        const input = await sendInput(request)
        const context = await dependencies.authenticate(request)
        requireRole(context, OPERATOR_ROLES)
        let target: ReturnType<typeof previewTargetValue>
        try {
          target = previewTargetValue(await dependencies.readPreviewTarget({
            actorProfileId: context.actorProfileId,
            previewId: input.previewId,
            context,
          }))
        } catch (error) {
          if (error instanceof RegistrationCustomerMessageHttpError) throw error
          claimError(error)
        }
        if (!await dependencies.authorizeTask(context, target.taskId)) {
          httpError(409, "registration_customer_message_confirmation_conflict")
        }
        const initialSource = await resolvePreviewSource(dependencies, {
          actorProfileId: context.actorProfileId,
          messageKind: target.messageKind,
          sourceId: target.sourceId,
          context,
        })
        if (initialSource.taskId !== target.taskId) {
          httpError(409, "registration_customer_message_confirmation_conflict")
        }
        const initialPrivateSource = dependencies.readPrivateSource(initialSource)
        let claim: PrivateSendResult
        try {
          claim = sendResult(await dependencies.claimMessage({
            actorProfileId: context.actorProfileId,
            previewId: input.previewId,
            requestKey: input.requestKey,
            contract: initialPrivateSource.previewContract,
            context,
          }))
        } catch (error) {
          claimError(error)
        }
        if (!claim.owner) {
          return json(assertRegistrationCustomerMessagePublicPayload(publicSendResult(claim)))
        }
        const claimToken = claim.claimToken
        const dispatchToken = claim.dispatchToken
        if (!claimToken || !dispatchToken) {
          httpError(503, "registration_customer_message_result_unavailable")
        }

        let privateSource: RegistrationCustomerMessagePrivateSource
        let attempt: ReturnType<typeof marker>
        try {
          const canonicalSource = await resolvePreviewSource(dependencies, {
            actorProfileId: context.actorProfileId,
            messageKind: target.messageKind,
            sourceId: target.sourceId,
            context,
          })
          if (canonicalSource.taskId !== target.taskId) throw new Error("source_task_mismatch")
          privateSource = dependencies.readPrivateSource(canonicalSource)
          const templateId = privateSource.readinessContract.templateId
          if (!templateId) throw new Error("template_missing")
          attempt = marker(await dependencies.markAttemptStarted({
            messageId: claim.messageId,
            claimToken,
            dispatchToken,
            contract: privateSource.previewContract,
            context,
          }), { messageId: claim.messageId, dispatchToken })
        } catch {
          try {
            await dependencies.releasePreSendClaim({
              messageId: claim.messageId,
              claimToken,
              errorCode: "pre_send_preparation_failed",
              context,
            })
            httpError(503, "registration_customer_message_pre_send_failed")
          } catch (releaseError) {
            if (releaseError instanceof RegistrationCustomerMessageHttpError) throw releaseError
            return json(
              assertRegistrationCustomerMessagePublicPayload(unknownAfterMarker(claim)),
              502,
            )
          }
        }
        if (!attempt.allowed) {
          const result = Object.freeze({
            ...publicSendResult(claim),
            ok: attempt.currentStatus === "accepted",
            currentStatus: attempt.currentStatus,
            idempotent: true,
          })
          return json(assertRegistrationCustomerMessagePublicPayload(result))
        }

        let provider: RegistrationCustomerMessageProviderResult
        try {
          provider = await dependencies.sendProvider({
            to: privateSource.parentPhoneDigits,
            templateId: privateSource.readinessContract.templateId as string,
            variables: privateSource.rendered.variables,
            buttons: privateSource.rendered.buttons,
            requestKey: input.requestKey,
          })
        } catch {
          provider = {
            outcome: "unknown",
            evidence: {
              statusCode: "provider_dispatch_uncertain",
              statusMessage: "SOLAPI 호출 결과를 확인할 수 없습니다.",
              observedAt: now().toISOString(),
              requestKeyMatched: true,
            },
          }
        }
        try {
          const finalized = sendResult(await dependencies.finalizeMessage({
            messageId: claim.messageId,
            dispatchToken,
            outcome: provider.outcome,
            evidence: provider.evidence,
            context,
          }))
          return json(assertRegistrationCustomerMessagePublicPayload(publicSendResult(finalized)))
        } catch {
          return json(
            assertRegistrationCustomerMessagePublicPayload(unknownAfterMarker(claim)),
            502,
          )
        }
      } catch (error) {
        return errorResponse(error)
      }
    },

    async check(request: Request) {
      try {
        const input = await checkInput(request)
        const context = await dependencies.authenticate(request)
        requireRole(context, OPERATOR_ROLES)
        let lookupContext: ReturnType<typeof checkContext>
        try {
          lookupContext = checkContext(await dependencies.readCheckContext({
            actorProfileId: context.actorProfileId,
            messageId: input.messageId,
            context,
          }))
        } catch (error) {
          if (error instanceof RegistrationCustomerMessageHttpError) throw error
          httpError(409, "registration_customer_message_check_not_allowed")
        }
        const provider = await dependencies.lookupProvider(lookupContext)
        if (provider.outcome === "unknown" || !provider.evidence.requestKeyMatched) {
          httpError(409, "registration_customer_message_check_unresolved")
        }
        const result = sendResult(await dependencies.recordProviderCheck({
          actorProfileId: context.actorProfileId,
          messageId: input.messageId,
          resolution: provider.outcome,
          evidence: provider.evidence,
          requestKey: lookupContext.requestKey,
          context,
        }))
        return json(assertRegistrationCustomerMessagePublicPayload(publicSendResult(result)))
      } catch (error) {
        return errorResponse(error)
      }
    },

    async admin(request: Request) {
      try {
        const action = await adminInput(request)
        const context = await dependencies.authenticate(request)
        requireRole(context, ["admin"])
        if (action.action === "preflight_template") {
          const preflight = await dependencies.preflightTemplate({
            messageKind: action.messageKind,
            context,
          })
          if (isRecord(preflight) && preflight.code === "provider_unavailable") {
            httpError(503, "registration_customer_message_provider_unavailable")
          }
          if (!isRecord(preflight) || preflight.matched !== true || !isRecord(preflight.receipt)) {
            httpError(409, "registration_customer_message_template_drift")
          }
          const result = await dependencies.recordTemplateReceipt({
            actorProfileId: context.actorProfileId,
            messageKind: action.messageKind,
            receipt: preflight.receipt,
            context,
          })
          return json(assertRegistrationCustomerMessagePublicPayload(result))
        }
        const result = await dependencies.performAdminAction({
          actorProfileId: context.actorProfileId,
          action,
          context,
        })
        return json(assertRegistrationCustomerMessagePublicPayload(adminPublicResult(action, result)))
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

async function exactRpc(context: HandlerAuthContext, name: string, args: JsonRecord) {
  const result = await serviceClient(context).rpc(name, args)
  if (result.error) throw result.error
  return result.data
}

function recipientHashForActivation(phone: unknown, pepper: string) {
  const digits = text(phone).replace(/\D/gu, "")
  if (!/^01(?:0|1|[6-9])[0-9]{7,8}$/u.test(digits) || !pepper) {
    httpError(409, "registration_customer_message_verification_scope_invalid")
  }
  return createHmac("sha256", pepper)
    .update(`registration-customer-message-recipient-v1\u001f${digits}`, "utf8")
    .digest("hex")
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
  const provider = createRegistrationCustomerMessageSolapi({
    apiKey: text(process.env.SOLAPI_API_KEY),
    apiSecret: text(process.env.SOLAPI_API_SECRET),
    pfId: text(process.env.SOLAPI_KAKAO_PF_ID),
    fetch: globalThis.fetch.bind(globalThis),
  })
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
    async readPreviewTarget(input) {
      const result = await serviceClient(input.context)
        .from("ops_registration_customer_message_previews")
        .select("task_id,track_id,appointment_id,message_kind,created_by")
        .eq("id", input.previewId)
        .maybeSingle()
      if (result.error) throw result.error
      const row = result.data as JsonRecord | null
      if (!row || text(row.created_by).toLowerCase() !== input.actorProfileId) {
        throw Object.assign(new Error("preview_unavailable"), { code: "P0002" })
      }
      const messageKind = row.message_kind
      const taskId = text(row.task_id).toLowerCase()
      const sourceId = text(row.appointment_id || row.track_id || row.task_id).toLowerCase()
      return { messageKind, sourceId, taskId }
    },
    claimMessage(input) {
      return exactRpc(input.context, "claim_registration_customer_message_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_preview_id: input.previewId,
        p_request_key: input.requestKey,
        p_contract: input.contract,
      })
    },
    releasePreSendClaim(input) {
      return exactRpc(input.context, "release_registration_customer_message_pre_send_claim_v1", {
        p_message_id: input.messageId,
        p_claim_token: input.claimToken,
        p_error_code: input.errorCode,
      })
    },
    markAttemptStarted(input) {
      return exactRpc(input.context, "mark_registration_customer_message_attempt_started_v1", {
        p_message_id: input.messageId,
        p_claim_token: input.claimToken,
        p_dispatch_token: input.dispatchToken,
        p_contract: input.contract,
      })
    },
    sendProvider(input) {
      return provider.send(input)
    },
    finalizeMessage(input) {
      return exactRpc(input.context, "finalize_registration_customer_message_v1", {
        p_message_id: input.messageId,
        p_dispatch_token: input.dispatchToken,
        p_result: input.outcome,
        p_provider_result: input.evidence,
      })
    },
    readCheckContext(input) {
      return exactRpc(input.context, "record_registration_customer_message_provider_check_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_message_id: input.messageId,
        p_resolution: "lookup_context",
        p_provider_evidence: {},
        p_request_key: null,
      })
    },
    lookupProvider(input) {
      return provider.lookup(input)
    },
    recordProviderCheck(input) {
      return exactRpc(input.context, "record_registration_customer_message_provider_check_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_message_id: input.messageId,
        p_resolution: input.resolution,
        p_provider_evidence: input.evidence,
        p_request_key: input.requestKey,
      })
    },
    preflightTemplate(input) {
      return provider.preflight({ entry: catalog.templates[input.messageKind] })
    },
    recordTemplateReceipt(input) {
      return exactRpc(input.context, "record_registration_customer_solapi_template_receipt_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_message_kind: input.messageKind,
        p_receipt: input.receipt,
      })
    },
    async performAdminAction(input) {
      const action = input.action
      if (action.action === "reconcile") {
        return exactRpc(input.context, "reconcile_registration_customer_message_v1", {
          p_actor_profile_id: input.actorProfileId,
          p_message_id: action.messageId,
          p_resolution: action.resolution,
          p_provider_evidence: action.evidence,
          p_reason: action.reason,
          p_request_key: action.requestKey,
        })
      }
      if (action.action === "release_pre_send") {
        return exactRpc(input.context, "release_registration_customer_message_pre_send_claim_admin_v1", {
          p_actor_profile_id: input.actorProfileId,
          p_message_id: action.messageId,
          p_reason: action.reason,
          p_request_key: action.requestKey,
        })
      }
      if (action.action === "record_live_test_receipt") {
        return exactRpc(input.context, "record_registration_customer_solapi_live_test_receipt_v1", {
          p_actor_profile_id: input.actorProfileId,
          p_message_kind: action.messageKind,
          p_message_id: action.messageId,
          p_received_at: action.receivedAt,
          p_request_key: action.requestKey,
        })
      }
      if (action.action !== "set_activation") {
        httpError(400, "registration_customer_message_admin_input_invalid")
      }
      const entry = catalog.templates[action.messageKind]
      if (action.mode !== "off" && (!entry.templateId || !catalog.pfId)) {
        httpError(409, "registration_customer_message_template_drift")
      }
      const evidence: JsonRecord = action.mode === "off"
        ? { requestKey: action.requestKey }
        : {
            requestKey: action.requestKey,
            templateId: entry.templateId,
            pfId: catalog.pfId,
            catalogChecksum: entry.checksums.template,
          }
      if (action.mode === "verification") {
        if (!action.verificationTaskId) {
          httpError(400, "registration_customer_message_admin_input_invalid")
        }
        const result = await serviceClient(input.context)
          .from("ops_registration_details")
          .select("parent_phone")
          .eq("task_id", action.verificationTaskId)
          .maybeSingle()
        if (result.error || !result.data) {
          httpError(409, "registration_customer_message_verification_scope_invalid")
        }
        evidence.verificationTaskId = action.verificationTaskId
        evidence.verificationRecipientHash = recipientHashForActivation(
          (result.data as { parent_phone?: unknown }).parent_phone,
          pepper,
        )
      }
      return exactRpc(input.context, "set_registration_customer_solapi_activation_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_message_kind: action.messageKind,
        p_mode: action.mode,
        p_evidence: evidence,
      })
    },
  })
}
