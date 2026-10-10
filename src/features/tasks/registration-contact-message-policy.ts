/** Server-consumed policy facts. This module performs no storage or delivery. */
export const REGISTRATION_CONTACT_MESSAGE_PURPOSES = Object.freeze([
  "level_test", "observation", "registration",
] as const)

export type RegistrationContactMessagePurpose = typeof REGISTRATION_CONTACT_MESSAGE_PURPOSES[number]
export type RegistrationContactMessageStatus = "pending" | "accepted" | "unknown" | "failed_hold"
export type RegistrationContactMessageAction = "preview" | "claim" | "attempt" | "retry" | "close" | "replay"
export type RegistrationContactCanonicalAppointmentKind = "level_test" | "visit_consultation" | "observation_class"

export const REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING = Object.freeze({
  level_test_booking: Object.freeze({ label: "레벨테스트 예약", purpose: "level_test", decision: "allowed" }),
  visit_consultation_booking: Object.freeze({ label: "방문상담 예약", purpose: null, decision: "candidate" }),
  appointment_reminder: Object.freeze({ label: "예약 리마인드", purpose: null, decision: "candidate" }),
  waiting_notice: Object.freeze({ label: "대기 안내", purpose: null, decision: "candidate" }),
  admission_application: Object.freeze({ label: "입학신청서", purpose: "registration", decision: "allowed" }),
  observation_booking: Object.freeze({ label: "청강 예약", purpose: "observation", decision: "allowed" }),
  observation_reminder: Object.freeze({ label: "청강 리마인드", purpose: "observation", decision: "allowed" }),
} as const)

export type RegistrationContactMessageKind = keyof typeof REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING
export type RegistrationContactMessagePurposeDecision = Readonly<{
  decision: "allowed" | "candidate" | "blocked"
  messageKind: RegistrationContactMessageKind | null
  label: string | null
  purpose: RegistrationContactMessagePurpose | null
  reasonCode: "allowed_purpose" | "canonical_appointment_kind_required" | "purpose_outside_policy"
    | "registration_mapping_requires_review" | "unsupported_message_kind"
}>

/** Labels identify existing features; a candidate never grants contact use. */
export function resolveRegistrationContactMessagePurpose(
  messageKind: unknown,
  canonicalAppointmentKind?: unknown,
): RegistrationContactMessagePurposeDecision {
  if (typeof messageKind !== "string"
    || !Object.prototype.hasOwnProperty.call(REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING, messageKind)) {
    return Object.freeze({ decision: "blocked", messageKind: null, label: null, purpose: null,
      reasonCode: "unsupported_message_kind" })
  }
  const kind = messageKind as RegistrationContactMessageKind
  const mapping = REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING[kind]
  if (kind === "appointment_reminder") {
    if (canonicalAppointmentKind === "level_test") {
      return Object.freeze({ decision: "allowed", messageKind: kind, label: mapping.label,
        purpose: "level_test", reasonCode: "allowed_purpose" })
    }
    return Object.freeze({ decision: "candidate", messageKind: kind, label: mapping.label, purpose: null,
      reasonCode: canonicalAppointmentKind === "visit_consultation"
        ? "purpose_outside_policy" : "canonical_appointment_kind_required" })
  }
  return Object.freeze({ decision: mapping.decision, messageKind: kind, label: mapping.label,
    purpose: mapping.purpose, reasonCode: mapping.decision === "allowed"
      ? "allowed_purpose" : "purpose_outside_policy" })
}

export type RegistrationContactMessageRequestDigest = Readonly<{ version: 1; digest: string }>
export type RegistrationContactMessageRecordedResult = Readonly<{
  messageId: string
  status: RegistrationContactMessageStatus
  providerAttemptStarted: boolean
}>
export type RegistrationContactMessageReplayReceipt = Readonly<{
  version: 1
  requestKey: string
  digest: RegistrationContactMessageRequestDigest
  contactGeneration: string
  result: RegistrationContactMessageRecordedResult
}>
export type RegistrationContactMessageGateInput = Readonly<{
  action: RegistrationContactMessageAction
  messageKind: RegistrationContactMessageKind
  canonicalAppointmentKind: RegistrationContactCanonicalAppointmentKind | null
  contactPhase: "open" | "closed"
  allPhasesClosed: boolean
  sourcePhaseOpen: boolean
  expectedContactGeneration: string
  currentContactGeneration: string
  dispatchState: Readonly<{
    status: RegistrationContactMessageStatus
    claimed: boolean
    providerAttemptStarted: boolean
  }> | null
  request: Readonly<{ requestKey: string; digest: RegistrationContactMessageRequestDigest }> | null
  replayReceipt: RegistrationContactMessageReplayReceipt | null
}>
export type RegistrationContactMessageGateDecision = Readonly<{
  decision: "allow" | "deny" | "close_intent" | "replay"
  reasonCode: "input_invalid" | "purpose_outside_policy" | "registration_mapping_requires_review"
    | "canonical_appointment_kind_required" | "unsupported_message_kind" | "all_phases_closed"
    | "source_phase_closed" | "contact_generation_changed" | "case_still_open" | "not_claimed"
    | "provider_attempt_already_started" | "terminal_result_no_retry" | "allowed_purpose"
    | "replay_mismatch" | "exact_request_replay"
  purpose: RegistrationContactMessagePurpose | null
  canStartProviderAttempt: boolean
  cancellationIntent: "none" | "invalidate_preparation" | "cancel_before_attempt"
    | "record_inflight_without_retry" | "leave_result_only"
  replayResult: RegistrationContactMessageRecordedResult | null
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const GENERATION_PATTERN = /^[1-9][0-9]{0,18}$/u
const HASH_PATTERN = /^[a-f0-9]{64}$/u
const STATUSES = new Set(["pending", "accepted", "unknown", "failed_hold"])
const ACTIONS = new Set(["preview", "claim", "attempt", "retry", "close", "replay"])
const APPOINTMENT_KINDS = new Set(["level_test", "visit_consultation", "observation_class"])

function exactRecord(value: unknown, keys: ReadonlyArray<string>): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && "value" in descriptor
  })
}

function validGeneration(value: unknown): value is string {
  // Match PostgreSQL positive bigint without Number conversion or precision loss.
  return typeof value === "string" && GENERATION_PATTERN.test(value)
    && (value.length < 19 || value <= "9223372036854775807")
}

function validDigest(value: unknown): value is RegistrationContactMessageRequestDigest {
  return exactRecord(value, ["version", "digest"]) && value.version === 1
    && typeof value.digest === "string" && HASH_PATTERN.test(value.digest)
}

function validStatus(value: unknown): value is RegistrationContactMessageStatus {
  return typeof value === "string" && STATUSES.has(value)
}

function validResult(value: unknown): value is RegistrationContactMessageRecordedResult {
  return exactRecord(value, ["messageId", "status", "providerAttemptStarted"])
    && typeof value.messageId === "string" && UUID_PATTERN.test(value.messageId)
    && validStatus(value.status) && typeof value.providerAttemptStarted === "boolean"
    && (value.status === "pending" || value.providerAttemptStarted)
}

function validReceipt(value: unknown): value is RegistrationContactMessageReplayReceipt {
  return exactRecord(value, ["version", "requestKey", "digest", "contactGeneration", "result"])
    && value.version === 1 && typeof value.requestKey === "string" && UUID_PATTERN.test(value.requestKey)
    && validDigest(value.digest) && validGeneration(value.contactGeneration) && validResult(value.result)
}

function validInput(value: unknown): value is RegistrationContactMessageGateInput {
  if (!exactRecord(value, ["action", "messageKind", "canonicalAppointmentKind", "allPhasesClosed",
    "contactPhase", "sourcePhaseOpen", "expectedContactGeneration", "currentContactGeneration", "dispatchState",
    "request", "replayReceipt"])) return false
  if (typeof value.action !== "string" || !ACTIONS.has(value.action)
    || typeof value.messageKind !== "string"
    || (value.canonicalAppointmentKind !== null && (typeof value.canonicalAppointmentKind !== "string"
      || !APPOINTMENT_KINDS.has(value.canonicalAppointmentKind)))
    || (value.contactPhase !== "open" && value.contactPhase !== "closed")
    || typeof value.allPhasesClosed !== "boolean" || typeof value.sourcePhaseOpen !== "boolean"
    || !validGeneration(value.expectedContactGeneration) || !validGeneration(value.currentContactGeneration)) return false
  if (value.dispatchState !== null) {
    if (!exactRecord(value.dispatchState, ["status", "claimed", "providerAttemptStarted"])
      || !validStatus(value.dispatchState.status) || typeof value.dispatchState.claimed !== "boolean"
      || typeof value.dispatchState.providerAttemptStarted !== "boolean"
      || (value.dispatchState.status !== "pending" && !value.dispatchState.providerAttemptStarted)) return false
  }
  if (value.request !== null && (!exactRecord(value.request, ["requestKey", "digest"])
    || typeof value.request.requestKey !== "string" || !UUID_PATTERN.test(value.request.requestKey)
    || !validDigest(value.request.digest))) return false
  if (["claim", "attempt", "retry"].includes(value.action) && value.request === null) return false
  return value.replayReceipt === null || validReceipt(value.replayReceipt)
}

function decision(
  kind: RegistrationContactMessageGateDecision["decision"],
  reasonCode: RegistrationContactMessageGateDecision["reasonCode"],
  purpose: RegistrationContactMessagePurpose | null,
  cancellationIntent: RegistrationContactMessageGateDecision["cancellationIntent"] = "none",
  canStartProviderAttempt = false,
  replayResult: RegistrationContactMessageRecordedResult | null = null,
): RegistrationContactMessageGateDecision {
  return Object.freeze({ decision: kind, reasonCode, purpose, canStartProviderAttempt,
    cancellationIntent, replayResult })
}

/**
 * Consume freshly locked server facts at every boundary. A replay reads an
 * actor-scoped saved result only; it never grants permission to send again.
 * Cancellation intents are commands for an adapter, not current DB enum values.
 */
export function evaluateRegistrationContactMessageGate(input: unknown): RegistrationContactMessageGateDecision {
  if (!validInput(input)) return decision("deny", "input_invalid", null)
  const purpose = resolveRegistrationContactMessagePurpose(input.messageKind, input.canonicalAppointmentKind)
  if (input.action === "replay") {
    const request = input.request
    const receipt = input.replayReceipt
    if (!request || !receipt || request.requestKey !== receipt.requestKey
      || request.digest.digest !== receipt.digest.digest
      || input.expectedContactGeneration !== receipt.contactGeneration) {
      return decision("deny", "replay_mismatch", purpose.purpose)
    }
    return decision("replay", "exact_request_replay", purpose.purpose, "none", false,
      Object.freeze({ messageId: receipt.result.messageId, status: receipt.result.status,
        providerAttemptStarted: receipt.result.providerAttemptStarted }))
  }
  if (input.expectedContactGeneration !== input.currentContactGeneration) {
    return decision("deny", "contact_generation_changed", purpose.purpose)
  }
  if (input.action === "close") {
    if (input.contactPhase !== "closed" && !input.allPhasesClosed) return decision("deny", "case_still_open", purpose.purpose)
    const state = input.dispatchState
    if (!state) return decision("close_intent", "all_phases_closed", purpose.purpose, "invalidate_preparation")
    if (state.status !== "pending") {
      return decision("close_intent", "terminal_result_no_retry", purpose.purpose, "leave_result_only")
    }
    return state.providerAttemptStarted
      ? decision("close_intent", "provider_attempt_already_started", purpose.purpose, "record_inflight_without_retry")
      : decision("close_intent", "all_phases_closed", purpose.purpose, "cancel_before_attempt")
  }
  if (input.contactPhase === "closed" || input.allPhasesClosed) return decision("deny", "all_phases_closed", purpose.purpose)
  if (!input.sourcePhaseOpen) return decision("deny", "source_phase_closed", purpose.purpose)
  if (purpose.decision !== "allowed") return decision("deny", purpose.reasonCode, purpose.purpose)
  const state = input.dispatchState
  if (state && state.status !== "pending") return decision("deny", "terminal_result_no_retry", purpose.purpose)
  if (state?.providerAttemptStarted) return decision("deny", "provider_attempt_already_started", purpose.purpose)
  if (input.action === "attempt" && !state?.claimed) return decision("deny", "not_claimed", purpose.purpose)
  return decision("allow", "allowed_purpose", purpose.purpose, "none", input.action === "attempt")
}
