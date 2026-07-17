import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import test from "node:test"

const gateUrl = new URL(
  "../src/features/notifications/server/external-attempt-gate.js",
  import.meta.url,
)

test("외부 발송 등록기는 허용 응답과 UUID 시도 ID가 모두 있어야 provider를 연다", async () => {
  assert.equal(existsSync(gateUrl), true, "외부 발송 등록기 게이트가 필요합니다.")
  const source = await readFile(gateUrl, "utf8")
  assert.match(source, /allowed\s*===\s*true/)
  assert.match(source, /attempt_id/)

  const { requireRegisteredNotificationExternalAttempt } = await import(gateUrl)
  let providerCalls = 0
  let unknownFinalizations = 0
  const decision = await requireRegisteredNotificationExternalAttempt({
    register: async () => ({
      allowed: true,
      attempt_id: "a1000000-0000-4000-8000-000000000001",
    }),
    finalizeUnknown: async () => {
      unknownFinalizations += 1
    },
  })
  if (decision.allowed) providerCalls += 1

  assert.equal(decision.allowed, true)
  assert.equal(decision.attemptId, "a1000000-0000-4000-8000-000000000001")
  assert.equal(providerCalls, 1)
  assert.equal(unknownFinalizations, 0)
})

test("외부 발송 등록 거부는 미확정 종결 뒤 provider를 0회로 유지한다", async () => {
  assert.equal(existsSync(gateUrl), true, "외부 발송 등록기 게이트가 필요합니다.")
  const { requireRegisteredNotificationExternalAttempt } = await import(gateUrl)
  let providerCalls = 0
  const finalizations = []
  const decision = await requireRegisteredNotificationExternalAttempt({
    register: async () => ({ allowed: false, reason: "attempt_already_registered" }),
    finalizeUnknown: async (reason) => {
      finalizations.push(reason)
      return { status: "delivery_unknown" }
    },
  })
  if (decision.allowed) providerCalls += 1

  assert.equal(decision.allowed, false)
  assert.equal(providerCalls, 0)
  assert.deepEqual(finalizations, ["external_attempt_registration_denied"])
  assert.deepEqual(decision.finalization, { status: "delivery_unknown" })
})

test("외부 발송 등록 RPC 오류도 미확정 종결 뒤 provider를 0회로 유지한다", async () => {
  assert.equal(existsSync(gateUrl), true, "외부 발송 등록기 게이트가 필요합니다.")
  const { requireRegisteredNotificationExternalAttempt } = await import(gateUrl)
  let providerCalls = 0
  const finalizations = []
  const decision = await requireRegisteredNotificationExternalAttempt({
    register: async () => {
      throw new Error("rpc unavailable")
    },
    finalizeUnknown: async (reason) => {
      finalizations.push(reason)
      return { status: "delivery_unknown" }
    },
  })
  if (decision.allowed) providerCalls += 1

  assert.equal(decision.allowed, false)
  assert.equal(providerCalls, 0)
  assert.deepEqual(finalizations, ["external_attempt_registration_failed"])
  assert.deepEqual(decision.finalization, { status: "delivery_unknown" })
})
