import assert from "node:assert/strict"
import test from "node:test"
import {
  assertRegistrationCustomerMessageContactUse,
  parseRegistrationCustomerMessageContactFence,
} from "../src/features/tasks/server/registration-customer-message-contact-fence.ts"

const id = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`
const taskId = id(1)
const scope = { taskId, sourceId: taskId, messageKind: "admission_application" }
const digest = { version: 1, digest: "a".repeat(64) }
const request = { requestKey: id(2), digest }
const fence = (overrides = {}) => ({ version: 1, ...scope, contactPhase: "open",
  contactGeneration: "7", allPhasesClosed: false, sourcePhaseOpen: true,
  canonicalAppointmentKind: null, ...overrides })
const consume = (value, overrides = {}) => assertRegistrationCustomerMessageContactUse({
  fence: parseRegistrationCustomerMessageContactFence(value, scope), action: "preview",
  expectedContactGeneration: "7", request, ...overrides,
})

test("real server fence consumer accepts task-scoped registration preview but does not grant an attempt", () => {
  const result = consume(fence())
  assert.equal(result.purpose, "registration")
  assert.equal(result.decision, "allow")
  assert.equal(result.canStartProviderAttempt, false)
})

test("registration attempt requires the same generation and an actual claim", () => {
  for (const claimed of [undefined, false]) {
    assert.throws(() => consume(fence(), { action: "attempt", claimed }), /contact_use_not_allowed/u)
  }
  const result = consume(fence(), { action: "attempt", claimed: true })
  assert.equal(result.purpose, "registration")
  assert.equal(result.canStartProviderAttempt, true)
})

test("closed, all-terminal, missing eligible plan and stale generations fail at the real consumer", () => {
  for (const overrides of [{ contactPhase: "closed" }, { allPhasesClosed: true },
    { sourcePhaseOpen: false }, { contactGeneration: "8" }]) {
    assert.throws(() => consume(fence(overrides)), /contact_use_not_allowed/u)
  }
})

test("registration source cannot borrow appointment provenance or another task/source", () => {
  for (const canonicalAppointmentKind of ["level_test", "observation_class", "visit_consultation"]) {
    assert.throws(() => consume(fence({ canonicalAppointmentKind })), /contact_use_not_allowed/u)
  }
  for (const overrides of [{ taskId: id(3) }, { sourceId: id(4) }]) {
    assert.throws(() => consume(fence(overrides)), /contact_fence_invalid/u)
  }
})

test("raw recipient or caller approval fields cannot become a registration fence", () => {
  for (const extra of [{ parentPhoneDigits: "01000000001" }, { registrationApproved: true },
    { requestDigest: digest }, { purpose: "registration" }]) {
    assert.throws(() => consume({ ...fence(), ...extra }), /contact_fence_invalid/u)
  }
})
