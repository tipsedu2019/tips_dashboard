import assert from "node:assert/strict"
import test from "node:test"
import { parseRegistrationCaseCustomerMessageHistory, parseRegistrationCaseCustomerMessageHistoryInput } from "../src/features/tasks/registration-customer-message-case-history-contract.ts"
import { createRegistrationCaseCustomerMessageHistoryHandler } from "../src/features/tasks/server/registration-customer-message-case-history-route.ts"
import { RegistrationCustomerMessageHttpError } from "../src/features/tasks/server/registration-customer-message-auth.ts"
import { REGISTRATION_CUSTOMER_GUIDANCE, parseRegistrationCustomerGuidanceSettings } from "../src/features/tasks/registration-customer-message-settings-contract.ts"
import { createRegistrationCustomerGuidanceSettingsHandler } from "../src/features/tasks/server/registration-customer-message-settings-route.ts"

const taskId = "9ac20000-0000-4000-8000-000000000010"
const input = { taskId, page: 1, pageSize: 10 }
const context = { role: "admin", actorProfileId: "9ac20000-0000-4000-8000-000000000001" }
const historyItem = {
  messageId: "9ac20000-0000-4000-8000-000000000030", messageKind: "visit_consultation_booking",
  currentStatus: "accepted", confirmedByName: "확인 담당자", confirmedAt: "2026-08-17T01:00:00+00:00",
  updatedAt: "2026-08-17T01:01:00+00:00", recipientLast4: "1234", canCheck: false, canCheckDelivery: true,
}
const payload = { ok: true, page: 1, pageSize: 10, totalCount: 1, history: [historyItem] }
const settings = REGISTRATION_CUSTOMER_GUIDANCE.map(({ messageKind }) => ({ messageKind, mode: "off", templateVerifiedAt: null }))
const historyUrl = `https://local.invalid/api/solapi/registration/case-history?taskId=${taskId}&page=1&pageSize=10`

test("history input accepts only exact bounded numbered pagination", () => {
  for (const pageSize of [10, 15, 20]) {
    assert.deepEqual(parseRegistrationCaseCustomerMessageHistoryInput(new URLSearchParams({ taskId, page: "2", pageSize: String(pageSize) })), { taskId, page: 2, pageSize })
  }
  for (const query of [
    `taskId=${taskId}&page=0&pageSize=10`, `taskId=${taskId}&page=100001&pageSize=10`,
    `taskId=${taskId}&page=01&pageSize=10`, `taskId=${taskId}&page=1&pageSize=100`,
    `taskId=${taskId}&page=1&pageSize=10&send=true`, `taskId=${taskId}&taskId=${taskId}&page=1`,
    `taskId=${taskId}&page=1`, "taskId=not-a-uuid&page=1&pageSize=10",
  ]) assert.equal(parseRegistrationCaseCustomerMessageHistoryInput(new URLSearchParams(query)), null, query)
})

test("historical canceled-booking receipt is valid without current appointment or readiness", () => {
  assert.deepEqual(parseRegistrationCaseCustomerMessageHistory(payload, input), payload)
  assert.deepEqual(parseRegistrationCaseCustomerMessageHistory({ ...payload, totalCount: 0, history: [] }, input).history, [])
})

test("private and inconsistent history payloads fail closed", () => {
  const invalidPayloads = [
    { ...payload, providerMessageId: "private-provider-id" },
    { ...payload, page: 2 }, { ...payload, pageSize: 20 }, { ...payload, totalCount: -1 },
    { ...payload, totalCount: 0 }, { ...payload, history: [historyItem, historyItem], totalCount: 2 },
    { ...payload, history: Array.from({ length: 11 }, (_, index) => ({ ...historyItem, messageId: `9ac20000-0000-4000-8000-${String(index).padStart(12, "0")}` })), totalCount: 11 },
    ...[
      { providerMessageId: "provider-secret" }, { providerGroupId: "group-secret" }, { recipientPhone: "01099991234" },
      { recipientLast4: "01099991234" }, { currentStatus: "pending", canCheckDelivery: true },
      { currentStatus: "accepted", canCheck: true }, { messageKind: "custom_send" },
      { confirmedAt: "invalid" }, { confirmedByName: "" }, { canCheck: "false" },
    ].map((change) => ({ ...payload, history: [{ ...historyItem, ...change }] })),
  ]
  for (const invalid of invalidPayloads) assert.throws(() => parseRegistrationCaseCustomerMessageHistory(invalid, input), /history_unavailable/)
})

test("admin/staff read a case history with no provider or write dependencies", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("provider must not be called") })
  for (const role of ["admin", "staff"]) {
    const calls = []
    const handler = createRegistrationCaseCustomerMessageHistoryHandler({
      authenticate: async () => ({ ...context, role }),
      authorizeTask: async (_context, id) => { calls.push(["authorize", id]); return true },
      listHistory: async (_context, requested) => { calls.push(["list", requested]); return payload },
    })
    const result = await handler(new Request(historyUrl))
    assert.equal(result.status, 200)
    assert.equal(result.headers.get("cache-control"), "no-store")
    assert.equal(result.headers.get("vary"), "Authorization")
    assert.deepEqual(await result.json(), payload)
    assert.deepEqual(calls, [["authorize", taskId], ["list", input]])
  }
  assert.equal(provider.mock.callCount(), 0)
})

test("role/task boundaries stop lookup before touching receipt storage", async () => {
  for (const [role, authorized, expected] of [["teacher", true, 403], ["assistant", true, 403], ["staff", false, 404]]) {
    let reads = 0
    const handler = createRegistrationCaseCustomerMessageHistoryHandler({
      authenticate: async () => ({ ...context, role }), authorizeTask: async () => authorized,
      listHistory: async () => { reads++; return payload },
    })
    const response = await handler(new Request(historyUrl))
    assert.equal(response.status, expected)
    assert.equal(reads, 0)
    assert.doesNotMatch(JSON.stringify(await response.json()), /1234|확인 담당자/)
  }
})

test("history rejects write requests, extra selectors, unavailable runtime, and private RPC payloads", async () => {
  for (const [request, authenticate, value, expected] of [
    [new Request(historyUrl, { method: "POST" }), async () => context, payload, 400],
    [new Request(`${historyUrl}&recipient=01012341234`), async () => context, payload, 400],
    [new Request(historyUrl), async () => { throw new RegistrationCustomerMessageHttpError(503, "runtime_missing") }, payload, 503],
    [new Request(historyUrl), async () => context, { ...payload, secret: "provider-token" }, 503],
  ]) {
    const handler = createRegistrationCaseCustomerMessageHistoryHandler({ authenticate,
      authorizeTask: async () => true, listHistory: async () => value,
    })
    const response = await handler(request)
    assert.equal(response.status, expected)
    assert.doesNotMatch(JSON.stringify(await response.json()), /provider-token|01012341234/)
  }
})

test("settings expose only five current guidance kinds and require one record per kind", () => {
  assert.deepEqual(parseRegistrationCustomerGuidanceSettings([...settings].reverse()), settings)
  for (const invalid of [
    null, [], settings.slice(1), [...settings, settings[0]], [settings[0], settings[0], ...settings.slice(2)],
    settings.map((item, index) => index === 0 ? { ...item, pfId: "private-pf" } : item),
    settings.map((item, index) => index === 0 ? { ...item, templateId: "private-template" } : item),
    settings.map((item, index) => index === 0 ? { ...item, mode: "automatic" } : item),
    settings.map((item, index) => index === 0 ? { ...item, templateVerifiedAt: "invalid" } : item),
  ]) assert.throws(() => parseRegistrationCustomerGuidanceSettings(invalid), /settings_unavailable/)
  assert.ok(!settings.some((item) => item.messageKind.includes("reminder") || item.messageKind.includes("bundle")))
})

test("settings reads are staff-only, query-free, no-store and provider-free", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("provider must not be called") })
  for (const [role, query, method, expected] of [
    ["admin", "", "GET", 200], ["staff", "", "GET", 200], ["teacher", "", "GET", 403],
    ["admin", "?activate=true", "GET", 400], ["admin", "", "POST", 400],
  ]) {
    let reads = 0
    const handler = createRegistrationCustomerGuidanceSettingsHandler({
      authenticate: async () => ({ ...context, role }), listSettings: async () => { reads++; return settings },
    })
    const response = await handler(new Request(`https://local.invalid/settings${query}`, { method }))
    assert.equal(response.status, expected)
    assert.equal(reads, expected === 200 ? 1 : 0)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("vary"), "Authorization")
  }
  assert.equal(provider.mock.callCount(), 0)
})

test("missing settings runtime and incomplete/private settings never appear as usable defaults", async () => {
  for (const listSettings of [
    async () => { throw new Error("missing_rpc") }, async () => [],
    async () => settings.map((entry) => ({ ...entry, providerApiKey: "secret" })),
  ]) {
    const handler = createRegistrationCustomerGuidanceSettingsHandler({ authenticate: async () => context, listSettings })
    const result = await handler(new Request("https://local.invalid/settings"))
    assert.equal(result.status, 503)
    assert.deepEqual(await result.json(), { ok: false, code: "registration_customer_message_settings_unavailable" })
  }
})
