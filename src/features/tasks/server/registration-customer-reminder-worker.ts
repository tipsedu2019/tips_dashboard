import { createHash, timingSafeEqual } from "node:crypto"

import type { RegistrationCustomerMessageStatus } from "../registration-customer-message-contract.ts"
import type { RegistrationCustomerMessageButton } from "./registration-customer-message-catalog.ts"
import type { RegistrationCustomerMessageProviderResult } from "./registration-customer-message-solapi.ts"

type JsonRecord = Record<string, unknown>

export type RegistrationCustomerReminderClaim = Readonly<{
  jobId: string
  messageKind: "appointment_reminder" | "observation_reminder"
  appointmentId: string
  observationId: string | null
  claimToken: string
  sourceRevision: number
  scheduledFor: string
  requestKey: string
}>

export type RegistrationCustomerReminderPrepared = Readonly<{
  to: string
  templateId: string
  variables: Readonly<Record<string, string>>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
  contract: Readonly<JsonRecord>
  readinessContract: Readonly<JsonRecord>
}>

export type RegistrationCustomerReminderBegin = Readonly<{
  allowed: boolean
  messageId: string | null
  dispatchToken: string | null
  currentStatus: RegistrationCustomerMessageStatus
    | "refresh_required"
    | "settings_refresh_required"
    | "runtime_inactive"
    | "source_dirty"
    | "duplicate_locked"
    | "canceled"
}>

type RegistrationCustomerReminderWorkerDependencies = Readonly<{
  claim(): Promise<RegistrationCustomerReminderClaim | null>
  prepare(claim: RegistrationCustomerReminderClaim): Promise<RegistrationCustomerReminderPrepared>
  begin(input: Readonly<{
    claim: RegistrationCustomerReminderClaim
    prepared: RegistrationCustomerReminderPrepared
  }>): Promise<RegistrationCustomerReminderBegin>
  release(input: Readonly<{
    claim: RegistrationCustomerReminderClaim
    errorCode: string
  }>): Promise<void>
  send(input: Readonly<{
    claim: RegistrationCustomerReminderClaim
    prepared: RegistrationCustomerReminderPrepared
  }>): Promise<RegistrationCustomerMessageProviderResult>
  finalize(input: Readonly<{
    claim: RegistrationCustomerReminderClaim
    begin: RegistrationCustomerReminderBegin
    provider: RegistrationCustomerMessageProviderResult
  }>): Promise<void>
  now?: () => Date
}>

export type RegistrationCustomerReminderWorkerResult = Readonly<{
  ok: true
  processed: boolean
  providerAttempted: boolean
  outcome: "idle" | "held" | "skipped" | "accepted" | "failed_hold" | "unknown"
}>

export class RegistrationCustomerReminderSourceIneligibleError extends Error {
  constructor() {
    super("registration_customer_message_source_ineligible")
    this.name = "RegistrationCustomerReminderSourceIneligibleError"
  }
}

export class RegistrationCustomerReminderBookingFactChangedError extends Error {
  constructor() {
    super("registration_customer_reminder_booking_fact_changed")
    this.name = "RegistrationCustomerReminderBookingFactChangedError"
  }
}

export class RegistrationObservationRuntimeInactiveError extends Error {
  constructor() {
    super("registration_observation_runtime_inactive")
    this.name = "RegistrationObservationRuntimeInactiveError"
  }
}

function secretDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest()
}

export function authorizeRegistrationCustomerReminderWorker(
  request: Request,
  configuredSecret: string,
) {
  const expected = configuredSecret.trim()
  const match = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/u)
  const actual = match?.[1] ?? ""
  if (!expected || !actual) return false
  return timingSafeEqual(secretDigest(actual), secretDigest(expected))
}

function result(
  outcome: RegistrationCustomerReminderWorkerResult["outcome"],
  providerAttempted: boolean,
  processed = true,
): RegistrationCustomerReminderWorkerResult {
  return Object.freeze({ ok: true, processed, providerAttempted, outcome })
}

export function createRegistrationCustomerReminderWorker(
  dependencies: RegistrationCustomerReminderWorkerDependencies,
) {
  const now = dependencies.now ?? (() => new Date())

  return Object.freeze({
    async runOnce(): Promise<RegistrationCustomerReminderWorkerResult> {
      const claim = await dependencies.claim()
      if (!claim) return result("idle", false, false)

      const releaseTerminal = async (errorCode: string) => {
        try {
          await dependencies.release({ claim, errorCode })
          return result("skipped", false)
        } catch {
          return result("held", false)
        }
      }
      const prepare = async () => {
        try {
          return await dependencies.prepare(claim)
        } catch (error) {
          if (error instanceof RegistrationCustomerReminderSourceIneligibleError) {
            return releaseTerminal("source_ineligible")
          }
          if (error instanceof RegistrationCustomerReminderBookingFactChangedError) {
            return releaseTerminal("booking_fact_changed")
          }
          if (error instanceof RegistrationObservationRuntimeInactiveError) {
            return releaseTerminal("runtime_inactive")
          }
          try {
            await dependencies.release({ claim, errorCode: "pre_send_preparation_failed" })
          } catch {
            // The lease expires without crossing the provider boundary.
          }
          return result("held", false)
        }
      }

      const initialPrepared = await prepare()
      if ("outcome" in initialPrepared) return initialPrepared

      let prepared = initialPrepared
      let begin: RegistrationCustomerReminderBegin
      try {
        begin = await dependencies.begin({ claim, prepared })
      } catch {
        try {
          await dependencies.release({ claim, errorCode: "pre_send_preparation_failed" })
        } catch {
          // The lease expires without crossing the provider boundary.
        }
        return result("held", false)
      }

      if (begin.currentStatus === "refresh_required") {
        const refreshedPrepared = await prepare()
        if ("outcome" in refreshedPrepared) return refreshedPrepared
        prepared = refreshedPrepared
        try {
          begin = await dependencies.begin({ claim, prepared })
        } catch {
          try {
            await dependencies.release({ claim, errorCode: "pre_send_preparation_failed" })
          } catch {
            // The lease expires without crossing the provider boundary.
          }
          return result("held", false)
        }
      }

      if (!begin.allowed) return result("skipped", false)

      let provider: RegistrationCustomerMessageProviderResult
      try {
        provider = await dependencies.send({ claim, prepared })
      } catch {
        provider = Object.freeze({
          outcome: "unknown",
          evidence: Object.freeze({
            statusCode: "provider_dispatch_uncertain",
            statusMessage: "SOLAPI 호출 결과를 확인할 수 없습니다.",
            observedAt: now().toISOString(),
            requestKeyMatched: true,
          }),
        })
      }

      try {
        await dependencies.finalize({ claim, begin, provider })
      } catch {
        return result("unknown", true)
      }
      return result(provider.outcome, true)
    },
  })
}
