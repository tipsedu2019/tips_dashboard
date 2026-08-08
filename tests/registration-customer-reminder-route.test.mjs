import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  RegistrationCustomerReminderHttpError,
  createRegistrationCustomerReminderRouteHandlers,
} from "../src/features/tasks/server/registration-customer-reminder-route.ts"

const ACTOR = "00000000-0000-4000-8000-000000000001"

const SETTINGS = Object.freeze({
  enabled: false,
  leadHours: 3,
  revision: "1",
  updatedAt: "2026-08-08T06:00:00.000Z",
  activationMode: "off",
  templateVerified: true,
  scheduleReady: false,
  verifiedTemplateId: "template-reminder",
  verifiedPfId: "pf-id",
  verifiedCatalogChecksum: "a".repeat(64),
})

const TEMPLATE = Object.freeze({
  templateId: "template-reminder",
  pfId: "pf-id",
  catalogChecksum: "a".repeat(64),
})

function request(path, init = {}) {
  return new Request(`http://localhost${path}`, init)
}

function makeDependencies(overrides = {}) {
  const calls = { worker: 0, auth: 0, get: 0, set: 0 }
  const dependencies = {
    workerSecret: "registration-reminder-worker-secret-value",
    worker: {
      async runOnce() {
        calls.worker += 1
        return { ok: true, processed: false, providerAttempted: false, outcome: "idle" }
      },
    },
    async authenticate() {
      calls.auth += 1
      return { actorProfileId: ACTOR, role: "admin" }
    },
    async getSettings() {
      calls.get += 1
      return SETTINGS
    },
    async setSettings() {
      calls.set += 1
      return { ...SETTINGS, enabled: true, revision: "2", activationMode: "live", scheduleReady: true }
    },
    templateContract: TEMPLATE,
    ...overrides,
  }
  return { calls, handlers: createRegistrationCustomerReminderRouteHandlers(dependencies) }
}

test("worker route는 비밀키를 DB 접근보다 먼저 검증한다", async () => {
  const { calls, handlers } = makeDependencies()
  const response = await handlers.worker(request("/worker", { method: "POST" }))
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { ok: false, error: "registration_customer_reminder_worker_unauthorized" })
  assert.equal(calls.worker, 0)
})

test("worker route는 정확한 비밀키에서만 상태 기계를 한 번 실행한다", async () => {
  const secret = "registration-reminder-worker-secret-value"
  const { calls, handlers } = makeDependencies()
  const response = await handlers.worker(request("/worker", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).outcome, "idle")
  assert.equal(calls.worker, 1)
})

test("설정 조회는 인증된 운영자에게 안전한 준비 상태만 반환한다", async () => {
  const { handlers } = makeDependencies()
  const response = await handlers.settings(request("/settings"))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, {
    ok: true,
    settings: {
      enabled: false,
      leadHours: 3,
      revision: "1",
      updatedAt: "2026-08-08T06:00:00.000Z",
      ready: false,
      status: "approval_pending",
      editable: true,
    },
  })
  assert.equal(JSON.stringify(body).includes("template-reminder"), false)
  assert.equal(JSON.stringify(body).includes("pf-id"), false)
})

test("설정 변경은 관리자만 가능하고 클라이언트가 template 계약을 주입할 수 없다", async () => {
  let setInput
  const { calls, handlers } = makeDependencies({
    authenticate: async () => ({ actorProfileId: ACTOR, role: "staff" }),
    async setSettings(input) {
      calls.set += 1
      setInput = input
      return SETTINGS
    },
  })
  const forbidden = await handlers.settings(request("/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, leadHours: 3, expectedRevision: "1" }),
  }))
  assert.equal(forbidden.status, 403)
  assert.equal(calls.set, 0)
  assert.equal(setInput, undefined)
})

test("설정 변경은 lead time과 revision을 엄격히 검증한다", async () => {
  const { calls, handlers } = makeDependencies()
  const invalid = await handlers.settings(request("/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, leadHours: 0, expectedRevision: "1" }),
  }))
  assert.equal(invalid.status, 400)
  assert.equal(calls.set, 0)
})

test("ON 전환은 서버 카탈로그 계약을 사용하고 준비 미완료를 안전한 문구로 반환한다", async () => {
  let setInput
  const { handlers } = makeDependencies({
    async setSettings(input) {
      setInput = input
      throw new RegistrationCustomerReminderHttpError(409, "registration_customer_reminder_not_ready")
    },
  })
  const response = await handlers.settings(request("/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, leadHours: 3, expectedRevision: "1" }),
  }))
  const body = await response.json()

  assert.equal(response.status, 409)
  assert.deepEqual(body, {
    ok: false,
    error: "SOLAPI 승인 또는 자동 발송 준비가 완료되지 않았습니다.",
  })
  assert.deepEqual(setInput.templateContract, TEMPLATE)
})

test("OFF 전환은 승인 상태와 무관하게 저장할 수 있다", async () => {
  let setInput
  const { handlers } = makeDependencies({
    async setSettings(input) {
      setInput = input
      return { ...SETTINGS, enabled: false, revision: "2" }
    },
  })
  const response = await handlers.settings(request("/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false, leadHours: 5, expectedRevision: "1" }),
  }))

  assert.equal(response.status, 200)
  assert.equal(setInput.enabled, false)
  assert.equal(setInput.leadHours, 5)
  assert.deepEqual(setInput.templateContract, TEMPLATE)
})

test("production route는 service RPC·canonical renderer·기존 SOLAPI adapter만 조합한다", async () => {
  const [source, workerRoute, settingsRoute] = await Promise.all([
    readFile(new URL("../src/features/tasks/server/registration-customer-reminder-route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/solapi/registration/reminders/worker/route.ts", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../src/app/api/solapi/registration/reminders/settings/route.ts", import.meta.url), "utf8").catch(() => ""),
  ])

  assert.match(source, /export function createProductionRegistrationCustomerReminderRouteHandlers/)
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(source, /REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET/)
  assert.match(source, /createRegistrationCustomerMessageCatalog/)
  assert.match(source, /createRegistrationCustomerMessageSourceResolver/)
  assert.match(source, /createRegistrationCustomerMessageSolapi/)
  assert.match(source, /const REGISTRATION_CUSTOMER_REMINDER_RPC_TIMEOUT_MS = 12_000/)
  assert.match(source, /client\.rpc\(name, args\)[\s\S]*\.abortSignal\(AbortSignal\.timeout\(REGISTRATION_CUSTOMER_REMINDER_RPC_TIMEOUT_MS\)\)[\s\S]*\.retry\(false\)/)
  for (const rpc of [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "release_registration_customer_reminder_job_v1",
    "finalize_registration_customer_reminder_dispatch_v1",
    "get_registration_customer_reminder_settings_v1",
    "set_registration_customer_reminder_settings_v1",
  ]) {
    assert.match(source, new RegExp(rpc))
  }
  assert.match(workerRoute, /handlers\.worker\(request\)/)
  assert.match(settingsRoute, /(?:handlers|productionHandlers\(\))\.settings\(request\)/)
  assert.doesNotMatch(workerRoute + settingsRoute, /SOLAPI_API_SECRET|SUPABASE_SERVICE_ROLE_KEY/)
})
