import assert from "node:assert/strict"
import test from "node:test"

import {
  authorizeRegistrationCustomerReminderWorker,
  createRegistrationCustomerReminderWorker,
} from "../src/features/tasks/server/registration-customer-reminder-worker.ts"

const CLAIM = Object.freeze({
  jobId: "00000000-0000-4000-8000-000000000001",
  appointmentId: "00000000-0000-4000-8000-000000000002",
  claimToken: "00000000-0000-4000-8000-000000000003",
  sourceRevision: 4,
  scheduledFor: "2026-08-10T06:00:00.000Z",
  requestKey: "00000000-0000-4000-8000-000000000004",
})

const PREPARED = Object.freeze({
  to: "01012345678",
  templateId: "template-reminder",
  variables: Object.freeze({ "#{학생명}": "김팁스" }),
  buttons: Object.freeze([]),
  contract: Object.freeze({ sourceFingerprint: "f".repeat(64) }),
})

const BEGIN = Object.freeze({
  allowed: true,
  messageId: "00000000-0000-4000-8000-000000000005",
  dispatchToken: "00000000-0000-4000-8000-000000000006",
  currentStatus: "pending",
})

function makeDependencies(overrides = {}) {
  const calls = { claim: 0, prepare: 0, begin: 0, release: 0, send: 0, finalize: 0 }
  const dependencies = {
    async claim() {
      calls.claim += 1
      return CLAIM
    },
    async prepare() {
      calls.prepare += 1
      return PREPARED
    },
    async begin() {
      calls.begin += 1
      return BEGIN
    },
    async release() {
      calls.release += 1
    },
    async send() {
      calls.send += 1
      return {
        outcome: "accepted",
        evidence: {
          providerMessageId: "provider-message",
          statusCode: "2000",
          statusMessage: "accepted",
          observedAt: "2026-08-10T06:00:01.000Z",
          requestKeyMatched: true,
        },
      }
    },
    async finalize() {
      calls.finalize += 1
    },
    now: () => new Date("2026-08-10T06:00:02.000Z"),
    ...overrides,
  }
  return { calls, worker: createRegistrationCustomerReminderWorker(dependencies) }
}

test("자동 리마인드 worker는 정확한 Bearer 비밀키만 허용한다", () => {
  const secret = "worker-secret-with-enough-length"
  assert.equal(authorizeRegistrationCustomerReminderWorker(
    new Request("http://localhost", { headers: { authorization: `Bearer ${secret}` } }),
    secret,
  ), true)
  assert.equal(authorizeRegistrationCustomerReminderWorker(
    new Request("http://localhost", { headers: { authorization: "Bearer wrong" } }),
    secret,
  ), false)
  assert.equal(authorizeRegistrationCustomerReminderWorker(new Request("http://localhost"), secret), false)
  assert.equal(authorizeRegistrationCustomerReminderWorker(
    new Request("http://localhost", { headers: { authorization: `Bearer ${secret}` } }),
    "",
  ), false)
})

test("도래한 작업이 없으면 provider를 호출하지 않는다", async () => {
  const { calls, worker } = makeDependencies({ claim: async () => null })
  const result = await worker.runOnce()

  assert.deepEqual(result, { ok: true, processed: false, providerAttempted: false, outcome: "idle" })
  assert.equal(calls.send, 0)
  assert.equal(calls.finalize, 0)
})

test("사전 준비가 실패하면 claim을 안전하게 해제하고 provider를 호출하지 않는다", async () => {
  const { calls, worker } = makeDependencies({
    prepare: async () => { throw new Error("template_drift") },
  })
  const result = await worker.runOnce()

  assert.equal(result.outcome, "held")
  assert.equal(result.providerAttempted, false)
  assert.equal(calls.release, 1)
  assert.equal(calls.send, 0)
  assert.equal(calls.finalize, 0)
})

test("DB 시도 마커가 거절되면 provider를 호출하지 않는다", async () => {
  const { calls, worker } = makeDependencies({
    begin: async () => ({ ...BEGIN, allowed: false, currentStatus: "accepted" }),
  })
  const result = await worker.runOnce()

  assert.equal(result.outcome, "skipped")
  assert.equal(result.providerAttempted, false)
  assert.equal(calls.release, 0)
  assert.equal(calls.send, 0)
  assert.equal(calls.finalize, 0)
})

test("시도 마커 이후 SOLAPI를 정확히 한 번 호출하고 결과를 마감한다", async () => {
  let sendInput
  let finalizeInput
  const { calls, worker } = makeDependencies({
    async send(input) {
      calls.send += 1
      sendInput = input
      return {
        outcome: "accepted",
        evidence: {
          providerMessageId: "provider-message",
          statusCode: "2000",
          statusMessage: "accepted",
          observedAt: "2026-08-10T06:00:01.000Z",
          requestKeyMatched: true,
        },
      }
    },
    async finalize(input) {
      calls.finalize += 1
      finalizeInput = input
    },
  })
  const result = await worker.runOnce()

  assert.equal(result.outcome, "accepted")
  assert.equal(result.providerAttempted, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.finalize, 1)
  assert.equal(sendInput.claim.requestKey, CLAIM.requestKey)
  assert.equal(finalizeInput.begin.dispatchToken, BEGIN.dispatchToken)
})

test("provider 예외는 unknown으로 한 번만 마감하고 자동 재시도하지 않는다", async () => {
  let finalized
  const { calls, worker } = makeDependencies({
    async send() {
      calls.send += 1
      throw new Error("network lost")
    },
    async finalize(input) {
      calls.finalize += 1
      finalized = input.provider
    },
  })
  const result = await worker.runOnce()

  assert.equal(result.outcome, "unknown")
  assert.equal(result.providerAttempted, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.finalize, 1)
  assert.equal(finalized.outcome, "unknown")
  assert.equal(finalized.evidence.statusCode, "provider_dispatch_uncertain")
  assert.equal(finalized.evidence.requestKeyMatched, true)
})

test("provider 호출 뒤 finalize가 실패해도 unknown을 반환하고 두 번째 호출은 하지 않는다", async () => {
  const { calls, worker } = makeDependencies({
    async finalize() {
      calls.finalize += 1
      throw new Error("db unavailable")
    },
  })
  const result = await worker.runOnce()

  assert.equal(result.outcome, "unknown")
  assert.equal(result.providerAttempted, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.finalize, 1)
})

