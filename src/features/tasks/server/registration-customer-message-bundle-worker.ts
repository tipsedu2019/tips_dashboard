import type { RegistrationCustomerMessageButton } from "./registration-customer-message-catalog.ts"
import {
  assertRegistrationCustomerMessageContactAttemptGrant,
  assertRegistrationCustomerMessageContactUse,
  parseRegistrationCustomerMessageContactFence,
  type RegistrationCustomerMessageContactFence,
} from "./registration-customer-message-contact-fence.ts"
import type { RegistrationContactMessageRequestDigest } from "../registration-contact-message-policy.ts"

export type RegistrationCustomerMessageBundleWorkerClaim = Readonly<{
  bundleId: string
  claimToken: string
  contactFence: RegistrationCustomerMessageContactFence
  requestKey: string
  requestDigest: RegistrationContactMessageRequestDigest
}>
export type RegistrationCustomerMessageBundleWorkerPrepared = Readonly<{
  to: string
  templateId: string
  variables: Readonly<Record<string, string>>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
}>
export type RegistrationCustomerMessageBundleWorkerBegin = Readonly<{
  allowed: boolean
  messageId: string | null
  dispatchToken: string | null
  contactGrant?: unknown
}>
export type RegistrationCustomerMessageBundleWorkerResult = Readonly<{
  ok: true
  processed: boolean
  providerAttempted: boolean
  outcome: "idle" | "held" | "skipped" | "accepted" | "failed_hold" | "unknown"
}>

type Dependencies = Readonly<{
  claim(): Promise<RegistrationCustomerMessageBundleWorkerClaim | null>
  prepare(claim: RegistrationCustomerMessageBundleWorkerClaim): Promise<RegistrationCustomerMessageBundleWorkerPrepared>
  begin(input: Readonly<{ claim: RegistrationCustomerMessageBundleWorkerClaim; prepared: RegistrationCustomerMessageBundleWorkerPrepared }>): Promise<RegistrationCustomerMessageBundleWorkerBegin>
  release(input: Readonly<{ claim: RegistrationCustomerMessageBundleWorkerClaim; errorCode: string }>): Promise<void>
  send(input: Readonly<{ claim: RegistrationCustomerMessageBundleWorkerClaim; prepared: RegistrationCustomerMessageBundleWorkerPrepared; dispatchToken: string }>): Promise<Readonly<{ outcome: "accepted" | "failed_hold" }>>
  finalize(input: Readonly<{ claim: RegistrationCustomerMessageBundleWorkerClaim; begin: RegistrationCustomerMessageBundleWorkerBegin; provider: Readonly<{ outcome: "accepted" | "failed_hold" | "unknown" }> }>): Promise<void>
}>

export function createRegistrationCustomerMessageBundleWorker(dependencies: Dependencies) {
  return Object.freeze({
    async runOnce(): Promise<RegistrationCustomerMessageBundleWorkerResult> {
      const claim = await dependencies.claim()
      if (!claim) return { ok: true, processed: false, providerAttempted: false, outcome: "idle" }
      const requestIdentity = { requestKey: claim.requestKey, digest: claim.requestDigest }
      let prepared: RegistrationCustomerMessageBundleWorkerPrepared
      try {
        const fence = parseRegistrationCustomerMessageContactFence(claim.contactFence, claim.contactFence)
        assertRegistrationCustomerMessageContactUse({ fence, action: "claim",
          expectedContactGeneration: fence.contactGeneration, request: requestIdentity })
        prepared = await dependencies.prepare(claim)
      } catch {
        try { await dependencies.release({ claim, errorCode: "pre_send_preparation_failed" }) } catch { /* lease expiry remains safe */ }
        return { ok: true, processed: true, providerAttempted: false, outcome: "held" }
      }
      let begin: RegistrationCustomerMessageBundleWorkerBegin
      try {
        begin = await dependencies.begin({ claim, prepared })
        if (begin.allowed && begin.messageId && begin.dispatchToken) {
          assertRegistrationCustomerMessageContactAttemptGrant(begin.contactGrant, {
            scope: claim.contactFence, contactGeneration: claim.contactFence.contactGeneration,
            messageId: begin.messageId, dispatchToken: begin.dispatchToken, request: requestIdentity,
          })
        }
      } catch {
        try { await dependencies.release({ claim, errorCode: "pre_send_preparation_failed" }) } catch { /* lease expiry remains safe */ }
        return { ok: true, processed: true, providerAttempted: false, outcome: "held" }
      }
      if (!begin.allowed || !begin.messageId || !begin.dispatchToken) {
        return { ok: true, processed: true, providerAttempted: false, outcome: "skipped" }
      }
      let provider: Readonly<{ outcome: "accepted" | "failed_hold" | "unknown" }>
      try {
        provider = await dependencies.send({ claim, prepared, dispatchToken: begin.dispatchToken })
      } catch {
        provider = { outcome: "unknown" }
      }
      try {
        await dependencies.finalize({ claim, begin, provider })
      } catch {
        return { ok: true, processed: true, providerAttempted: true, outcome: "unknown" }
      }
      return { ok: true, processed: true, providerAttempted: true, outcome: provider.outcome }
    },
  })
}
