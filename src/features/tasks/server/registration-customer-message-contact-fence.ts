import {
  evaluateRegistrationContactMessageGate,
  type RegistrationContactCanonicalAppointmentKind,
  type RegistrationContactMessageAction,
  type RegistrationContactMessageRequestDigest,
} from "../registration-contact-message-policy.ts"
import type { RegistrationCustomerMessageProviderEvidenceInput } from "../registration-customer-message-contract.ts"

/** A server RPC result, never a browser-supplied approval or workflow array. */
export type RegistrationCustomerMessageContactFence = Readonly<{
  version: 1
  taskId: string
  sourceId: string
  messageKind: string
  contactPhase: "open" | "closed"
  contactGeneration: string
  allPhasesClosed: boolean
  sourcePhaseOpen: boolean
  canonicalAppointmentKind: RegistrationContactCanonicalAppointmentKind | null
}>

export type RegistrationCustomerMessageContactScope = Readonly<{
  taskId: string
  sourceId: string
  messageKind: string
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const GENERATION = /^[1-9][0-9]{0,18}$/u
const FENCE_KEYS = ["version", "taskId", "sourceId", "messageKind", "contactPhase",
  "contactGeneration", "allPhasesClosed", "sourcePhaseOpen", "canonicalAppointmentKind"] as const

function invalid(): never { throw new Error("registration_customer_message_contact_fence_invalid") }

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  return ownKeys.length === keys.length && ownKeys.every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && "value" in descriptor
  })
}

export function isRegistrationCustomerMessageContactGeneration(value: unknown): value is string {
  return typeof value === "string" && GENERATION.test(value)
    && (value.length < 19 || value <= "9223372036854775807")
}

export function parseRegistrationCustomerMessageContactFence(
  value: unknown,
  expected: RegistrationCustomerMessageContactScope,
): RegistrationCustomerMessageContactFence {
  if (!exactRecord(value, FENCE_KEYS) || value.version !== 1
    || typeof value.taskId !== "string" || !UUID.test(value.taskId)
    || typeof value.sourceId !== "string" || !UUID.test(value.sourceId)
    || value.taskId !== expected.taskId || value.sourceId !== expected.sourceId
    || value.messageKind !== expected.messageKind
    || (value.contactPhase !== "open" && value.contactPhase !== "closed")
    || !isRegistrationCustomerMessageContactGeneration(value.contactGeneration)
    || typeof value.allPhasesClosed !== "boolean" || typeof value.sourcePhaseOpen !== "boolean"
    || (value.canonicalAppointmentKind !== null && !["level_test", "visit_consultation", "observation_class"]
      .includes(value.canonicalAppointmentKind as string))) invalid()
  return Object.freeze({ ...value }) as RegistrationCustomerMessageContactFence
}

export function assertRegistrationCustomerMessageContactUse(input: Readonly<{
  fence: RegistrationCustomerMessageContactFence
  action: Exclude<RegistrationContactMessageAction, "close" | "replay">
  expectedContactGeneration: string
  request: Readonly<{ requestKey: string; digest: RegistrationContactMessageRequestDigest }> | null
  claimed?: boolean
}>) {
  const policyKind = registrationContactPolicyKind(input.fence.messageKind)
  if ((policyKind === "level_test_booking" && input.fence.canonicalAppointmentKind !== "level_test")
    || (policyKind === "admission_application" && input.fence.canonicalAppointmentKind !== null)
    || (["observation_booking", "observation_reminder"].includes(policyKind)
      && input.fence.canonicalAppointmentKind !== "observation_class")) {
    throw new Error("registration_customer_message_contact_use_not_allowed")
  }
  const decision = evaluateRegistrationContactMessageGate({
    action: input.action,
    messageKind: policyKind,
    canonicalAppointmentKind: input.fence.canonicalAppointmentKind,
    contactPhase: input.fence.contactPhase,
    allPhasesClosed: input.fence.allPhasesClosed,
    sourcePhaseOpen: input.fence.sourcePhaseOpen,
    expectedContactGeneration: input.expectedContactGeneration,
    currentContactGeneration: input.fence.contactGeneration,
    dispatchState: input.claimed === undefined ? null
      : { status: "pending", claimed: input.claimed, providerAttemptStarted: false },
    request: input.request,
    replayReceipt: null,
  })
  if (decision.decision !== "allow") {
    throw new Error("registration_customer_message_contact_use_not_allowed")
  }
  return decision
}

/** Bundle labels are presentation variants of the same seven semantic kinds. */
export function registrationContactPolicyKind(kind: string) {
  const bundles: Readonly<Record<string, string>> = {
    level_test_booking_bundle: "level_test_booking",
    level_test_reminder_bundle: "appointment_reminder",
    visit_consultation_booking_bundle: "visit_consultation_booking",
    visit_consultation_reminder_bundle: "appointment_reminder",
    observation_booking_bundle: "observation_booking",
    observation_reminder_bundle: "observation_reminder",
  }
  return Object.prototype.hasOwnProperty.call(bundles, kind) ? bundles[kind] : kind
}

/** Provider status prose and arbitrary response keys are never copied to receipts. */
export function registrationCustomerMessageMinimalProviderEvidence(
  outcome: "accepted" | "failed_hold" | "unknown",
  evidence: RegistrationCustomerMessageProviderEvidenceInput,
  now: Date,
): RegistrationCustomerMessageProviderEvidenceInput {
  const providerId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/u.test(value)
    ? value : null
  const messageId = providerId(evidence.providerMessageId)
  const groupId = providerId(evidence.providerGroupId)
  const statusCode = typeof evidence.statusCode === "string"
    && /^(?:[a-zA-Z_][a-zA-Z0-9_:-]{0,99}|[0-9]{1,6})$/u.test(evidence.statusCode)
    ? evidence.statusCode : "provider_status_unavailable"
  return Object.freeze({
    ...(messageId ? { providerMessageId: messageId } : {}),
    ...(groupId ? { providerGroupId: groupId } : {}),
    statusCode,
    statusMessage: outcome === "accepted" ? "공급자 접수 확인"
      : outcome === "failed_hold" ? "공급자 거절 확인" : "공급자 결과 확인 필요",
    observedAt: now.toISOString(),
    requestKeyMatched: evidence.requestKeyMatched === true,
  })
}

/**
 * Validate the locked send-start RPC's receipt. Parsing is not proof that its
 * implementation acquired the lock: ordered SQL and DB tests remain required.
 */
export function assertRegistrationCustomerMessageContactAttemptGrant(value: unknown, expected: Readonly<{
  scope: RegistrationCustomerMessageContactScope
  contactGeneration: string
  messageId: string
  dispatchToken: string
  request: Readonly<{ requestKey: string; digest: RegistrationContactMessageRequestDigest }>
}>) {
  if (!exactRecord(value, ["version", "action", "linearization", "messageId", "dispatchToken", "contactFence"])
    || value.version !== 1 || value.action !== "attempt"
    || value.linearization !== "registration_contact_case_lock_v1"
    || value.messageId !== expected.messageId || value.dispatchToken !== expected.dispatchToken) invalid()
  const fence = parseRegistrationCustomerMessageContactFence(value.contactFence, expected.scope)
  assertRegistrationCustomerMessageContactUse({ fence, action: "attempt", claimed: true,
    expectedContactGeneration: expected.contactGeneration, request: expected.request })
  return fence
}
