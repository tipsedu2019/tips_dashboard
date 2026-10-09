import assert from "node:assert/strict"
import test from "node:test"

import {
  REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING,
  evaluateRegistrationContactMessageGate,
  resolveRegistrationContactMessagePurpose,
} from "../src/features/tasks/registration-contact-message-policy.ts"
import { REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS } from "../src/features/tasks/registration-customer-message-contract.ts"
import { REGISTRATION_CUSTOMER_MESSAGE_LABELS } from "../src/features/tasks/registration-customer-message-labels.ts"
import {
  applyRegistrationContactLifecycleTransition,
  createRegistrationContactLifecycle,
  getRegistrationContactCaseClosure,
} from "../src/features/tasks/registration-contact-lifecycle.ts"

const REQUEST_KEY = "00000000-0000-4000-8000-000000000001"
const MESSAGE_ID = "00000000-0000-4000-8000-000000000002"
const DIGEST = Object.freeze({ version: 1, digest: "a".repeat(64) })
const REQUEST = Object.freeze({ requestKey: REQUEST_KEY, digest: DIGEST })

function gateInput(overrides = {}) {
  return {
    action: "preview",
    messageKind: "level_test_booking",
    canonicalAppointmentKind: "level_test",
    contactPhase: "open",
    allPhasesClosed: false,
    sourcePhaseOpen: true,
    expectedContactGeneration: "7",
    currentContactGeneration: "7",
    dispatchState: null,
    request: REQUEST,
    replayReceipt: null,
    ...overrides,
  }
}

function state(status = "pending", claimed = true, providerAttemptStarted = false) {
  return { status, claimed, providerAttemptStarted }
}

function replayReceipt(status = "accepted", providerAttemptStarted = true) {
  return {
    version: 1,
    requestKey: REQUEST_KEY,
    digest: DIGEST,
    contactGeneration: "7",
    result: { messageId: MESSAGE_ID, status, providerAttemptStarted },
  }
}

test("purpose policy retains all seven existing IDs and their current Korean labels", () => {
  assert.deepEqual(Object.keys(REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING),
    [...REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS])
  for (const kind of REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS) {
    assert.equal(resolveRegistrationContactMessagePurpose(kind).label, REGISTRATION_CUSTOMER_MESSAGE_LABELS[kind])
  }
  assert.ok(Object.isFrozen(REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING))
  assert.ok(Object.values(REGISTRATION_CONTACT_MESSAGE_PURPOSE_MAPPING).every(Object.isFrozen))
})

test("direct level-test and observation notices bind to their allowed purposes", () => {
  for (const [kind, purpose] of [["level_test_booking", "level_test"],
    ["observation_booking", "observation"], ["observation_reminder", "observation"]]) {
    assert.equal(resolveRegistrationContactMessagePurpose(kind).purpose, purpose)
    assert.equal(resolveRegistrationContactMessagePurpose(kind).decision, "allowed")
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ messageKind: kind })).decision, "allow")
  }
})

test("a reminder's label cannot grant a purpose without canonical appointment facts", () => {
  assert.equal(resolveRegistrationContactMessagePurpose("appointment_reminder", "level_test").purpose, "level_test")
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ messageKind: "appointment_reminder" })).decision, "allow")
  for (const canonicalAppointmentKind of [null, "visit_consultation", "observation_class"]) {
    const result = evaluateRegistrationContactMessageGate(gateInput({ messageKind: "appointment_reminder", canonicalAppointmentKind }))
    assert.equal(result.decision, "deny")
    assert.equal(result.canStartProviderAttempt, false)
  }
})

test("admission_application remains an explicit registration candidate and fails closed", () => {
  assert.deepEqual(resolveRegistrationContactMessagePurpose("admission_application"), {
    decision: "candidate", messageKind: "admission_application", label: "입학신청서",
    purpose: "registration", reasonCode: "registration_mapping_requires_review",
  })
  for (const action of ["preview", "claim", "attempt", "retry"]) {
    const result = evaluateRegistrationContactMessageGate(gateInput({ action, messageKind: "admission_application", dispatchState: state() }))
    assert.equal(result.decision, "deny")
    assert.equal(result.reasonCode, "registration_mapping_requires_review")
  }
})

test("visit and waiting features remain discoverable candidates without contact-use permission", () => {
  for (const messageKind of ["visit_consultation_booking", "waiting_notice"]) {
    assert.equal(resolveRegistrationContactMessagePurpose(messageKind).decision, "candidate")
    const result = evaluateRegistrationContactMessageGate(gateInput({ messageKind }))
    assert.equal(result.reasonCode, "purpose_outside_policy")
    assert.equal(result.decision, "deny")
  }
  for (const kind of ["level_test_booking_bundle", "arbitrary_notice", "__proto__", null]) {
    assert.equal(resolveRegistrationContactMessagePurpose(kind).decision, "blocked")
  }
})

test("all phase closure prohibits every fresh contact boundary for every kind", () => {
  for (const messageKind of REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS) {
    for (const action of ["preview", "claim", "attempt", "retry"]) {
      const result = evaluateRegistrationContactMessageGate(gateInput({ messageKind, action,
        allPhasesClosed: true, sourcePhaseOpen: false, dispatchState: state() }))
      assert.equal(result.decision, "deny")
      assert.equal(result.reasonCode, "all_phases_closed")
      assert.equal(result.canStartProviderAttempt, false)
    }
  }
})

test("another open subject does not authorize a closed source phase's observation reminder", () => {
  const result = evaluateRegistrationContactMessageGate(gateInput({ action: "attempt",
    messageKind: "observation_reminder", canonicalAppointmentKind: "observation_class",
    allPhasesClosed: false, sourcePhaseOpen: false, dispatchState: state() }))
  assert.equal(result.reasonCode, "source_phase_closed")
  assert.equal(result.canStartProviderAttempt, false)
})

test("generation changes reject stale fresh actions even after reopening", () => {
  for (const action of ["preview", "claim", "attempt", "retry", "close"]) {
    const result = evaluateRegistrationContactMessageGate(gateInput({ action,
      currentContactGeneration: "8", dispatchState: state(), allPhasesClosed: action === "close" }))
    assert.equal(result.reasonCode, "contact_generation_changed")
    assert.equal(result.canStartProviderAttempt, false)
  }
})

test("generation comparison retains PostgreSQL bigint precision and rejects malformed counters", () => {
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({
    expectedContactGeneration: "9007199254740992", currentContactGeneration: "9007199254740993",
  })).reasonCode, "contact_generation_changed")
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({
    expectedContactGeneration: "9223372036854775807", currentContactGeneration: "9223372036854775807",
  })).decision, "allow")
  for (const invalid of ["0", "01", "-1", "7.0", "7e0", " 7", "9223372036854775808", 7]) {
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ currentContactGeneration: invalid })).reasonCode, "input_invalid")
  }
})

test("preview and claim do not themselves grant a provider attempt; a claim is required", () => {
  for (const action of ["preview", "claim", "retry"]) {
    const result = evaluateRegistrationContactMessageGate(gateInput({ action, dispatchState: state() }))
    assert.equal(result.decision, "allow")
    assert.equal(result.canStartProviderAttempt, false)
  }
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "attempt" })).reasonCode, "not_claimed")
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "attempt", dispatchState: state("pending", false) })).reasonCode, "not_claimed")
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "attempt", dispatchState: state() })).canStartProviderAttempt, true)
})

test("fresh delivery boundaries require a canonical request digest and key", () => {
  for (const action of ["claim", "attempt", "retry"]) {
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action, request: null, dispatchState: state() })).reasonCode, "input_invalid")
  }
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ request: null })).decision, "allow")
})

test("closure cancels unclaimed and claimed work only before its attempt marker", () => {
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "close", allPhasesClosed: true })).cancellationIntent, "invalidate_preparation")
  for (const claimed of [false, true]) {
    const result = evaluateRegistrationContactMessageGate(gateInput({ action: "close", allPhasesClosed: true,
      dispatchState: state("pending", claimed) }))
    assert.equal(result.cancellationIntent, "cancel_before_attempt")
    assert.equal(result.canStartProviderAttempt, false)
  }
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "close", dispatchState: state() })).reasonCode, "case_still_open")
})

test("a pending attempt marker cannot be unsent or retried after closure", () => {
  const dispatchState = state("pending", true, true)
  const closed = evaluateRegistrationContactMessageGate(gateInput({ action: "close", allPhasesClosed: true, dispatchState }))
  assert.equal(closed.cancellationIntent, "record_inflight_without_retry")
  assert.equal(closed.canStartProviderAttempt, false)
  for (const action of ["attempt", "retry"]) {
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action, dispatchState })).reasonCode, "provider_attempt_already_started")
  }
})

test("accepted, unknown and failed_hold are result-only at closure and never auto retry", () => {
  for (const status of ["accepted", "unknown", "failed_hold"]) {
    const dispatchState = state(status, false, true)
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "close", allPhasesClosed: true,
      dispatchState })).cancellationIntent, "leave_result_only")
    for (const action of ["preview", "claim", "attempt", "retry"]) {
      const result = evaluateRegistrationContactMessageGate(gateInput({ action, dispatchState }))
      assert.equal(result.reasonCode, "terminal_result_no_retry")
      assert.equal(result.canStartProviderAttempt, false)
    }
  }
})

test("exact request replay preserves a saved result after closure and generation changes without resending", () => {
  for (const [status, started] of [["pending", false], ["pending", true], ["accepted", true], ["unknown", true], ["failed_hold", true]]) {
    const receipt = replayReceipt(status, started)
    const result = evaluateRegistrationContactMessageGate(gateInput({ action: "replay", allPhasesClosed: true,
      sourcePhaseOpen: false, currentContactGeneration: "8", replayReceipt: receipt }))
    assert.equal(result.decision, "replay")
    assert.deepEqual(result.replayResult, receipt.result)
    assert.notStrictEqual(result.replayResult, receipt.result)
    assert.ok(Object.isFrozen(result.replayResult))
    assert.equal(result.canStartProviderAttempt, false)
  }
})

test("replay refuses another request key, digest, original generation, or missing receipt", () => {
  const receipt = replayReceipt()
  for (const overrides of [
    { request: { ...REQUEST, requestKey: MESSAGE_ID } },
    { request: { ...REQUEST, digest: { version: 1, digest: "b".repeat(64) } } },
    { expectedContactGeneration: "8" },
    { replayReceipt: null },
    { request: null },
  ]) {
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "replay", replayReceipt: receipt,
      ...overrides })).reasonCode, "replay_mismatch")
  }
})

test("result-only historical replay survives a currently unapproved purpose without granting contact use", () => {
  const result = evaluateRegistrationContactMessageGate(gateInput({ action: "replay", messageKind: "waiting_notice",
    replayReceipt: replayReceipt(), allPhasesClosed: true }))
  assert.equal(result.decision, "replay")
  assert.equal(result.canStartProviderAttempt, false)
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ messageKind: "waiting_notice" })).decision, "deny")
})

test("strict input and receipt contracts reject raw contact fields without echoing them", () => {
  for (const key of ["parentPhone", "studentPhone", "recipientHash", "recipientLast4", "studentName", "actor", "timestamp", "approvedRegistrationKind"]) {
    const malformed = [
      gateInput({ [key]: "forbidden" }),
      gateInput({ request: { ...REQUEST, [key]: "forbidden" } }),
      gateInput({ action: "replay", replayReceipt: { ...replayReceipt(), [key]: "forbidden" } }),
      gateInput({ action: "replay", replayReceipt: { ...replayReceipt(), result: { ...replayReceipt().result, [key]: "forbidden" } } }),
    ]
    for (const input of malformed) {
      const result = evaluateRegistrationContactMessageGate(input)
      assert.equal(result.reasonCode, "input_invalid")
      assert.equal(JSON.stringify(result).includes("forbidden"), false)
      assert.equal(result.replayResult, null)
    }
  }
})

test("invalid status/marker combinations and accessors fail closed", () => {
  for (const status of ["accepted", "unknown", "failed_hold", "canceled"]) {
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ dispatchState: state(status, false, false) })).reasonCode, "input_invalid")
  }
  let getterCalls = 0
  const poisoned = gateInput()
  Object.defineProperty(poisoned, "allPhasesClosed", { enumerable: true, get() { getterCalls += 1; return false } })
  assert.equal(evaluateRegistrationContactMessageGate(poisoned).reasonCode, "input_invalid")
  assert.equal(getterCalls, 0)
})

function syntheticDispatch({ changeAfter = null, uncertain = false } = {}) {
  let facts = { allPhasesClosed: false, sourcePhaseOpen: true, currentContactGeneration: "7" }
  let dispatchState = null
  const calls = { previews: 0, claims: 0, markers: 0, provider: 0 }
  const decisions = []
  for (const action of ["preview", "claim", "attempt"]) {
    const verdict = evaluateRegistrationContactMessageGate(gateInput({ action, ...facts, dispatchState }))
    decisions.push(verdict)
    if (verdict.decision !== "allow") return { calls, decisions, dispatchState, facts }
    if (action === "preview") calls.previews += 1
    if (action === "claim") { calls.claims += 1; dispatchState = state() }
    if (action === "attempt") { calls.markers += 1; dispatchState = state("pending", true, true) }
    if (changeAfter === action) facts = { allPhasesClosed: true, sourcePhaseOpen: false, currentContactGeneration: "8" }
    if (action === "attempt") {
      assert.equal(verdict.canStartProviderAttempt, true)
      calls.provider += 1
      dispatchState = state(uncertain ? "unknown" : "accepted", false, true)
    }
  }
  return { calls, decisions, dispatchState, facts }
}

test("synthetic closure between preparation and claim/attempt prevents every provider call", () => {
  for (const changeAfter of ["preview", "claim"]) {
    const flow = syntheticDispatch({ changeAfter })
    assert.equal(flow.calls.provider, 0)
    assert.equal(flow.calls.markers, 0)
    assert.equal(flow.decisions.at(-1).reasonCode, "contact_generation_changed")
  }
})

test("synthetic closure after the attempt marker retains outcome and prevents a second call", () => {
  for (const uncertain of [false, true]) {
    const flow = syntheticDispatch({ changeAfter: "attempt", uncertain })
    assert.equal(flow.calls.provider, 1)
    const retry = evaluateRegistrationContactMessageGate(gateInput({ action: "retry", ...flow.facts,
      dispatchState: flow.dispatchState }))
    assert.equal(retry.canStartProviderAttempt, false)
    const replay = evaluateRegistrationContactMessageGate(gateInput({ action: "replay", ...flow.facts,
      replayReceipt: replayReceipt(flow.dispatchState.status, true) }))
    assert.equal(replay.decision, "replay")
    assert.equal(replay.replayResult.status, uncertain ? "unknown" : "accepted")
    assert.equal(replay.canStartProviderAttempt, false)
  }
})

test("synthetic delayed pre-send work rereads the canonical generation before crossing the provider boundary", async () => {
  let unblock
  const delay = new Promise((resolve) => { unblock = resolve })
  let currentGeneration = "7"
  let allPhasesClosed = false
  let providerCalls = 0
  const run = async () => {
    assert.equal(evaluateRegistrationContactMessageGate(gateInput({ action: "claim" })).decision, "allow")
    await delay
    const attempt = evaluateRegistrationContactMessageGate(gateInput({ action: "attempt", dispatchState: state(),
      currentContactGeneration: currentGeneration, allPhasesClosed }))
    if (attempt.canStartProviderAttempt) providerCalls += 1
    return attempt
  }
  const pending = run()
  currentGeneration = "8"
  allPhasesClosed = true
  unblock()
  assert.equal((await pending).reasonCode, "contact_generation_changed")
  assert.equal(providerCalls, 0)
})

test("the real closure helper requires all current subjects and does not close an empty roster", () => {
  const tracks = [
    { id: REQUEST_KEY, workflowStatus: "registered" },
    { id: MESSAGE_ID, workflowStatus: "waiting" },
  ]
  const current = getRegistrationContactCaseClosure({ tracks })
  assert.equal(current.allPhasesClosed, false)
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ allPhasesClosed: current.allPhasesClosed })).decision, "allow")
  const complete = getRegistrationContactCaseClosure({ tracks: tracks.map((track) => ({ ...track, workflowStatus: "registered" })) })
  assert.equal(complete.allPhasesClosed, true)
  assert.equal(evaluateRegistrationContactMessageGate(gateInput({ allPhasesClosed: complete.allPhasesClosed })).reasonCode, "all_phases_closed")
  assert.equal(getRegistrationContactCaseClosure({ tracks: [] }).allPhasesClosed, false)
})

test("a real last-track exclusion stays closed even though empty current tracks are not inferred terminal", () => {
  const initial = createRegistrationContactLifecycle({
    caseId: "00000000-0000-4000-8000-000000000003",
    tracks: [{ id: REQUEST_KEY, workflowStatus: "waiting" }],
    business: { lessonIds: [MESSAGE_ID] },
  })
  const closed = applyRegistrationContactLifecycleTransition(initial,
    { kind: "replace_tracks", tracks: initial.tracks.map((track) => ({ ...track,
      archivedAt: "2026-10-09T08:00:00Z" })), closeWhenLastTrackExcluded: true },
    { actorId: "00000000-0000-4000-8000-000000000004", requestKey: REQUEST_KEY,
      fingerprint: DIGEST, expectedGeneration: initial.generation, expectedRevision: initial.revision })
  assert.equal(closed.state.phase, "closed")
  assert.equal(closed.effects.shouldSendNotice, false)
  const facts = getRegistrationContactCaseClosure({ tracks: closed.state.tracks })
  assert.equal(facts.allPhasesClosed, false)
  for (const action of ["preview", "claim", "attempt", "retry"]) {
    const verdict = evaluateRegistrationContactMessageGate(gateInput({ action,
      contactPhase: closed.state.phase, allPhasesClosed: facts.allPhasesClosed,
      expectedContactGeneration: closed.state.generation, currentContactGeneration: closed.state.generation,
      dispatchState: state() }))
    assert.equal(verdict.reasonCode, "all_phases_closed")
    assert.equal(verdict.canStartProviderAttempt, false)
  }
  const intent = evaluateRegistrationContactMessageGate(gateInput({ action: "close", contactPhase: closed.state.phase,
    allPhasesClosed: facts.allPhasesClosed, expectedContactGeneration: closed.state.generation,
    currentContactGeneration: closed.state.generation, dispatchState: state() }))
  assert.equal(intent.cancellationIntent, "cancel_before_attempt")
})
