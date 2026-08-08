import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  createRegistrationCustomerMessageCatalog,
} from "./registration-customer-message-catalog.ts"
import {
  RegistrationCustomerMessageHttpError,
  createProductionRegistrationCustomerMessageAuth,
} from "./registration-customer-message-auth.ts"
import {
  createRegistrationCustomerMessageSolapi,
} from "./registration-customer-message-solapi.ts"
import {
  createRegistrationCustomerMessageSourceResolver,
  readRegistrationCustomerMessagePrivateSource,
} from "./registration-customer-message-source.ts"
import {
  RegistrationCustomerReminderSourceIneligibleError,
  authorizeRegistrationCustomerReminderWorker,
  createRegistrationCustomerReminderWorker,
} from "./registration-customer-reminder-worker.ts"
import type {
  RegistrationCustomerReminderBegin,
  RegistrationCustomerReminderClaim,
  RegistrationCustomerReminderPrepared,
  RegistrationCustomerReminderWorkerResult,
} from "./registration-customer-reminder-worker.ts"

type JsonRecord = Record<string, unknown>

type ReminderSettingsRecord = Readonly<{
  enabled: boolean
  leadHours: number
  revision: string
  updatedAt: string
  activationMode: "off" | "verification" | "live"
  templateVerified: boolean
  scheduleReady: boolean
  verifiedTemplateId: string | null
  verifiedPfId: string | null
  verifiedCatalogChecksum: string | null
}>

type ReminderTemplateContract = Readonly<{
  templateId: string | null
  pfId: string | null
  catalogChecksum: string
}>

type ReminderRouteDependencies = Readonly<{
  workerSecret: string
  worker: Readonly<{ runOnce(): Promise<RegistrationCustomerReminderWorkerResult> }>
  authenticate(request: Request): Promise<Readonly<{
    actorProfileId: string
    role: string
  }>>
  getSettings(input: Readonly<{
    actorProfileId: string
  }>): Promise<unknown>
  setSettings(input: Readonly<{
    actorProfileId: string
    enabled: boolean
    leadHours: number
    expectedRevision: string
    templateContract: ReminderTemplateContract
  }>): Promise<unknown>
  templateContract: ReminderTemplateContract
}>

export class RegistrationCustomerReminderHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = "RegistrationCustomerReminderHttpError"
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: JsonRecord, keys: ReadonlyArray<string>) {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  return expected.length === actual.length
    && expected.every((key, index) => key === actual[index])
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function normalizedSettings(value: unknown): ReminderSettingsRecord {
  if (!isRecord(value)) {
    throw new RegistrationCustomerReminderHttpError(503, "registration_customer_reminder_runtime_unavailable")
  }
  const activationMode = text(value.activationMode)
  const updatedAt = text(value.updatedAt)
  const revision = text(value.revision)
  const verifiedCatalogChecksum = value.verifiedCatalogChecksum === null
    ? null
    : text(value.verifiedCatalogChecksum)
  const verifiedTemplateId = value.verifiedTemplateId === null
    ? null
    : text(value.verifiedTemplateId)
  const verifiedPfId = value.verifiedPfId === null ? null : text(value.verifiedPfId)
  if (
    typeof value.enabled !== "boolean"
    || !Number.isInteger(value.leadHours)
    || (value.leadHours as number) < 1
    || (value.leadHours as number) > 72
    || !/^\d+$/u.test(revision)
    || !updatedAt
    || !["off", "verification", "live"].includes(activationMode)
    || typeof value.templateVerified !== "boolean"
    || typeof value.scheduleReady !== "boolean"
    || (verifiedCatalogChecksum !== null && !/^[a-f0-9]{64}$/u.test(verifiedCatalogChecksum))
  ) {
    throw new RegistrationCustomerReminderHttpError(503, "registration_customer_reminder_runtime_unavailable")
  }
  return Object.freeze({
    enabled: value.enabled,
    leadHours: value.leadHours as number,
    revision,
    updatedAt,
    activationMode: activationMode as ReminderSettingsRecord["activationMode"],
    templateVerified: value.templateVerified,
    scheduleReady: value.scheduleReady,
    verifiedTemplateId,
    verifiedPfId,
    verifiedCatalogChecksum,
  })
}

function publicSettings(
  value: ReminderSettingsRecord,
  contract: ReminderTemplateContract,
) {
  const approvalReady = value.activationMode === "live"
    && value.templateVerified
    && Boolean(contract.templateId)
    && Boolean(contract.pfId)
    && value.verifiedTemplateId === contract.templateId
    && value.verifiedPfId === contract.pfId
    && value.verifiedCatalogChecksum === contract.catalogChecksum
  const ready = approvalReady && value.scheduleReady
  const status = ready
    ? "ready"
    : approvalReady
      ? "scheduler_pending"
      : "approval_pending"
  return Object.freeze({
    enabled: value.enabled,
    leadHours: value.leadHours,
    revision: value.revision,
    updatedAt: value.updatedAt,
    ready,
    status,
  })
}

async function settingsMutation(request: Request) {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new RegistrationCustomerReminderHttpError(400, "registration_customer_reminder_settings_invalid")
  }
  if (!isRecord(value) || !exactKeys(value, ["enabled", "leadHours", "expectedRevision"])) {
    throw new RegistrationCustomerReminderHttpError(400, "registration_customer_reminder_settings_invalid")
  }
  const expectedRevision = text(value.expectedRevision)
  if (
    typeof value.enabled !== "boolean"
    || !Number.isInteger(value.leadHours)
    || (value.leadHours as number) < 1
    || (value.leadHours as number) > 72
    || !/^[1-9]\d*$/u.test(expectedRevision)
  ) {
    throw new RegistrationCustomerReminderHttpError(400, "registration_customer_reminder_settings_invalid")
  }
  return {
    enabled: value.enabled,
    leadHours: value.leadHours as number,
    expectedRevision,
  }
}

function settingsError(error: unknown) {
  if (error instanceof RegistrationCustomerReminderHttpError) {
    if (error.code === "registration_customer_reminder_not_ready") {
      return json({ ok: false, error: "SOLAPI 승인 또는 자동 발송 준비가 완료되지 않았습니다." }, error.status)
    }
    if (error.code === "registration_customer_reminder_settings_conflict") {
      return json({ ok: false, error: "다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요." }, 409)
    }
    return json({ ok: false, error: error.code }, error.status)
  }
  return json({ ok: false, error: "registration_customer_reminder_runtime_unavailable" }, 503)
}

export function createRegistrationCustomerReminderRouteHandlers(
  dependencies: ReminderRouteDependencies,
) {
  return Object.freeze({
    async worker(request: Request) {
      if (!authorizeRegistrationCustomerReminderWorker(request, dependencies.workerSecret)) {
        return json({ ok: false, error: "registration_customer_reminder_worker_unauthorized" }, 401)
      }
      try {
        return json(await dependencies.worker.runOnce())
      } catch {
        return json({ ok: false, error: "registration_customer_reminder_worker_unavailable" }, 503)
      }
    },

    async settings(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        if (!context.actorProfileId || !["admin", "staff"].includes(context.role)) {
          throw new RegistrationCustomerReminderHttpError(403, "registration_customer_reminder_forbidden")
        }
        if (request.method === "GET") {
          const settings = normalizedSettings(await dependencies.getSettings({
            actorProfileId: context.actorProfileId,
          }))
          return json({
            ok: true,
            settings: {
              ...publicSettings(settings, dependencies.templateContract),
              editable: context.role === "admin",
            },
          })
        }
        if (request.method !== "PATCH") {
          throw new RegistrationCustomerReminderHttpError(405, "registration_customer_reminder_method_not_allowed")
        }
        if (context.role !== "admin") {
          throw new RegistrationCustomerReminderHttpError(403, "registration_customer_reminder_forbidden")
        }
        const mutation = await settingsMutation(request)
        const settings = normalizedSettings(await dependencies.setSettings({
          actorProfileId: context.actorProfileId,
          ...mutation,
          templateContract: dependencies.templateContract,
        }))
        return json({
          ok: true,
          settings: {
            ...publicSettings(settings, dependencies.templateContract),
            editable: true,
          },
        })
      } catch (error) {
        return settingsError(error)
      }
    },
  })
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REGISTRATION_CUSTOMER_REMINDER_RPC_TIMEOUT_MS = 12_000
type ServiceRpcOptions = Readonly<{ sourceIneligibleIsTerminal?: boolean }>

function environmentText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function serviceClient() {
  const url = environmentText(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const key = environmentText(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!url || !key) {
    throw new RegistrationCustomerReminderHttpError(503, "registration_customer_reminder_runtime_unavailable")
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function rpcFailure(error: unknown, options: ServiceRpcOptions = {}): never {
  const message = isRecord(error) ? text(error.message) : ""
  if (
    options.sourceIneligibleIsTerminal
    && message.includes("registration_customer_message_source_ineligible")
  ) {
    throw new RegistrationCustomerReminderSourceIneligibleError()
  }
  if (message.includes("registration_customer_reminder_not_ready")) {
    throw new RegistrationCustomerReminderHttpError(409, "registration_customer_reminder_not_ready")
  }
  if (message.includes("registration_customer_reminder_settings_conflict")) {
    throw new RegistrationCustomerReminderHttpError(409, "registration_customer_reminder_settings_conflict")
  }
  if (message.includes("invalid")) {
    throw new RegistrationCustomerReminderHttpError(400, "registration_customer_reminder_settings_invalid")
  }
  throw new RegistrationCustomerReminderHttpError(503, "registration_customer_reminder_runtime_unavailable")
}

async function serviceRpc(
  client: SupabaseClient,
  name: string,
  args: JsonRecord = {},
  options: ServiceRpcOptions = {},
) {
  const result = await client.rpc(name, args)
    .abortSignal(AbortSignal.timeout(REGISTRATION_CUSTOMER_REMINDER_RPC_TIMEOUT_MS))
    .retry(false)
  if (result.error) rpcFailure(result.error, options)
  return result.data
}

function reminderClaim(value: unknown): RegistrationCustomerReminderClaim | null {
  if (value === null) return null
  if (!isRecord(value)) rpcFailure(null)
  const jobId = text(value.jobId)
  const appointmentId = text(value.appointmentId)
  const claimToken = text(value.claimToken)
  const scheduledFor = text(value.scheduledFor)
  const requestKey = text(value.requestKey)
  const sourceRevision = typeof value.sourceRevision === "number"
    ? value.sourceRevision
    : Number(value.sourceRevision)
  if (
    !UUID_PATTERN.test(jobId)
    || !UUID_PATTERN.test(appointmentId)
    || !UUID_PATTERN.test(claimToken)
    || !UUID_PATTERN.test(requestKey)
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
    || !Number.isFinite(Date.parse(scheduledFor))
  ) rpcFailure(null)
  return Object.freeze({
    jobId,
    appointmentId,
    claimToken,
    sourceRevision,
    scheduledFor,
    requestKey,
  })
}

function reminderBegin(value: unknown): RegistrationCustomerReminderBegin {
  if (!isRecord(value)) rpcFailure(null)
  const messageId = text(value.messageId)
  const dispatchToken = text(value.dispatchToken)
  const currentStatus = text(value.currentStatus)
  if (
    typeof value.allowed !== "boolean"
    || !UUID_PATTERN.test(messageId)
    || !UUID_PATTERN.test(dispatchToken)
    || !["pending", "accepted", "unknown", "failed_hold"].includes(currentStatus)
  ) rpcFailure(null)
  return Object.freeze({
    allowed: value.allowed,
    messageId,
    dispatchToken,
    currentStatus: currentStatus as RegistrationCustomerReminderBegin["currentStatus"],
  })
}

export function createProductionRegistrationCustomerReminderRouteHandlers() {
  const client = serviceClient()
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
  const reminderTemplate = catalog.templates.appointment_reminder
  const templateContract: ReminderTemplateContract = Object.freeze({
    templateId: reminderTemplate.templateId,
    pfId: catalog.pfId,
    catalogChecksum: reminderTemplate.checksums.template,
  })
  const provider = createRegistrationCustomerMessageSolapi({
    apiKey: environmentText(process.env.SOLAPI_API_KEY),
    apiSecret: environmentText(process.env.SOLAPI_API_SECRET),
    pfId: environmentText(process.env.SOLAPI_KAKAO_PF_ID),
    fetch: globalThis.fetch.bind(globalThis),
  })
  const worker = createRegistrationCustomerReminderWorker({
    async claim() {
      return reminderClaim(await serviceRpc(client, "claim_registration_customer_reminder_job_v1"))
    },
    async prepare(claim): Promise<RegistrationCustomerReminderPrepared> {
      const rawSource = await serviceRpc(client, "read_registration_customer_reminder_source_v1", {
        p_job_id: claim.jobId,
        p_claim_token: claim.claimToken,
      }, {
        sourceIneligibleIsTerminal: true,
      })
      const resolver = createRegistrationCustomerMessageSourceResolver({
        catalog,
        recipientHashPepper: environmentText(process.env.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER),
        resolveSource: async () => rawSource,
      })
      const source = await resolver.resolve({
        actorProfileId: "00000000-0000-4000-8000-000000000000",
        messageKind: "appointment_reminder",
        sourceId: claim.appointmentId,
      })
      const privateSource = readRegistrationCustomerMessagePrivateSource(source)
      if (!privateSource.readinessContract.templateId) {
        throw new Error("registration_customer_reminder_template_missing")
      }
      return Object.freeze({
        to: privateSource.parentPhoneDigits,
        templateId: privateSource.readinessContract.templateId,
        variables: privateSource.rendered.variables,
        buttons: privateSource.rendered.buttons,
        contract: privateSource.previewContract,
        readinessContract: privateSource.readinessContract,
      })
    },
    async begin({ claim, prepared }) {
      return reminderBegin(await serviceRpc(client, "begin_registration_customer_reminder_dispatch_v1", {
        p_job_id: claim.jobId,
        p_claim_token: claim.claimToken,
        p_contract: prepared.contract,
        p_readiness_contract: prepared.readinessContract,
      }))
    },
    async release({ claim, errorCode }) {
      await serviceRpc(client, "release_registration_customer_reminder_job_v1", {
        p_job_id: claim.jobId,
        p_claim_token: claim.claimToken,
        p_error_code: errorCode,
      })
    },
    async send({ claim, prepared }) {
      return provider.send({
        to: prepared.to,
        templateId: prepared.templateId,
        variables: prepared.variables,
        buttons: prepared.buttons,
        requestKey: claim.requestKey,
      })
    },
    async finalize({ begin, provider: providerResult }) {
      await serviceRpc(client, "finalize_registration_customer_reminder_dispatch_v1", {
        p_message_id: begin.messageId,
        p_dispatch_token: begin.dispatchToken,
        p_result: providerResult.outcome,
        p_provider_result: providerResult.evidence,
      })
    },
  })
  let productionAuth: ReturnType<typeof createProductionRegistrationCustomerMessageAuth> | null = null

  return createRegistrationCustomerReminderRouteHandlers({
    workerSecret: environmentText(process.env.REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET),
    worker,
    async authenticate(request) {
      try {
        productionAuth ??= createProductionRegistrationCustomerMessageAuth()
        const context = await productionAuth.authenticate(request)
        return { actorProfileId: context.actorProfileId, role: context.role }
      } catch (error) {
        if (error instanceof RegistrationCustomerMessageHttpError) {
          throw new RegistrationCustomerReminderHttpError(error.status, error.code)
        }
        throw error
      }
    },
    getSettings(input) {
      return serviceRpc(client, "get_registration_customer_reminder_settings_v1", {
        p_actor_profile_id: input.actorProfileId,
      })
    },
    setSettings(input) {
      return serviceRpc(client, "set_registration_customer_reminder_settings_v1", {
        p_actor_profile_id: input.actorProfileId,
        p_enabled: input.enabled,
        p_lead_hours: input.leadHours,
        p_expected_revision: input.expectedRevision,
        p_template_contract: input.templateContract,
      })
    },
    templateContract,
  })
}
