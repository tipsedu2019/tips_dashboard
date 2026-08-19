import assert from "node:assert/strict"
import test from "node:test"

import { createRegistrationCustomerMessageBundleWorker } from "../src/features/tasks/server/registration-customer-message-bundle-worker.ts"

test("bundle worker releases pre-send preparation failures without provider access", async () => {
  let sends = 0
  let releases = 0
  const worker = createRegistrationCustomerMessageBundleWorker({
    claim: async () => ({ bundleId: "bundle-1", claimToken: "claim-1" }),
    prepare: async () => { throw new Error("source_invalid") },
    begin: async () => ({ allowed: true, messageId: "message-1", dispatchToken: "dispatch-1" }),
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
    claim: async () => ({ bundleId: "bundle-1", claimToken: "claim-1" }),
    prepare: async () => ({ to: "01012345678", templateId: "template", variables: {}, buttons: [] }),
    begin: async () => ({ allowed: true, messageId: "message-1", dispatchToken: "dispatch-1" }),
    release: async () => {},
    send: async () => ({ outcome: "accepted" }),
    finalize: async () => { finalizes += 1 },
  })
  assert.deepEqual(await worker.runOnce(), { ok: true, processed: true, providerAttempted: true, outcome: "accepted" })
  assert.equal(finalizes, 1)
})
