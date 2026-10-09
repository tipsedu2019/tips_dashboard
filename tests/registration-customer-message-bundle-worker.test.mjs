import assert from "node:assert/strict"
import test from "node:test"

import { createRegistrationCustomerMessageBundleWorker } from "../src/features/tasks/server/registration-customer-message-bundle-worker.ts"

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const contactFence = { version: 1, taskId: id(1), sourceId: id(1), messageKind: "level_test_reminder_bundle",
  contactPhase: "open", contactGeneration: "1", allPhasesClosed: false, sourcePhaseOpen: true, canonicalAppointmentKind: "level_test" }
const claim = { bundleId: id(2), claimToken: id(3), contactFence, requestKey: id(4), requestDigest: { version: 1, digest: "a".repeat(64) } }
const begin = { allowed: true, messageId: id(5), dispatchToken: id(6), contactGrant: { version: 1, action: "attempt",
  linearization: "registration_contact_case_lock_v1", messageId: id(5), dispatchToken: id(6), contactFence } }

test("bundle worker releases pre-send preparation failures without provider access", async () => {
  let sends = 0
  let releases = 0
  const worker = createRegistrationCustomerMessageBundleWorker({
    claim: async () => claim,
    prepare: async () => { throw new Error("source_invalid") },
    begin: async () => begin,
    release: async () => { releases += 1 },
    send: async () => { sends += 1; return { outcome: "accepted" } },
    finalize: async () => {},
  })
  assert.deepEqual(await worker.runOnce(), { ok: true, processed: true, providerAttempted: false, outcome: "held" })
  assert.equal(releases, 1)
  assert.equal(sends, 0)
})

test("bundle worker finalizes a provider attempt exactly once", async () => {
  let finalizes = 0
  const worker = createRegistrationCustomerMessageBundleWorker({
    claim: async () => claim,
    prepare: async () => ({ to: "01012345678", templateId: "template", variables: {}, buttons: [] }),
    begin: async () => begin,
    release: async () => {},
    send: async () => ({ outcome: "accepted" }),
    finalize: async () => { finalizes += 1 },
  })
  assert.deepEqual(await worker.runOnce(), { ok: true, processed: true, providerAttempted: true, outcome: "accepted" })
  assert.equal(finalizes, 1)
})
