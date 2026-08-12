import assert from "node:assert/strict"
import test from "node:test"

import * as reminderRoute from "../src/features/tasks/server/registration-customer-reminder-route.ts"
import {
  RegistrationCustomerReminderHttpError,
  createRegistrationCustomerReminderRouteHandlers,
} from "../src/features/tasks/server/registration-customer-reminder-route.ts"
import { createRegistrationCustomerMessageCatalog } from "../src/features/tasks/server/registration-customer-message-catalog.ts"

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

const DATABASE_OFF_SETTINGS = Object.freeze({
  enabled: false,
  leadHours: 3,
  revision: "7",
  updatedAt: "2026-08-12T00:00:00.000Z",
  ready: false,
  status: "not_ready",
  activeKinds: Object.freeze(["observation_reminder"]),
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
      activeKinds: [],
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

test("DB activeKinds는 서버가 공개하고 OFF 조회·저장은 템플릿 환경 없이 성공한다", async () => {
  let templateContractReads = 0
  const { calls, handlers } = makeDependencies({
    async getSettings() {
      calls.get += 1
      return DATABASE_OFF_SETTINGS
    },
    async setSettings() {
      calls.set += 1
      return { ...DATABASE_OFF_SETTINGS, revision: "8" }
    },
    templateContractForSettings() {
      templateContractReads += 1
      throw new Error("observation template must not be read while OFF")
    },
  })

  const get = await handlers.settings(request("/settings"))
  assert.equal(get.status, 200)
  assert.deepEqual(await get.json(), {
    ok: true,
    settings: {
      enabled: false,
      leadHours: 3,
      revision: "7",
      updatedAt: "2026-08-12T00:00:00.000Z",
      ready: false,
      status: "approval_pending",
      editable: true,
      activeKinds: ["observation_reminder"],
    },
  })

  const patch = await handlers.settings(request("/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false, leadHours: 3, expectedRevision: "7" }),
  }))
  assert.equal(patch.status, 200)
  assert.equal(calls.set, 1)
  assert.equal(templateContractReads, 0)
  assert.deepEqual((await patch.json()).settings, {
    enabled: false,
    leadHours: 3,
    revision: "8",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ready: false,
    status: "approval_pending",
    editable: true,
    activeKinds: ["observation_reminder"],
  })
})

test("enabled active kinds with an unready schedule stay scheduler_pending without exposing template facts", async () => {
  const { handlers } = makeDependencies({
    async getSettings() {
      return {
        ...DATABASE_OFF_SETTINGS,
        enabled: true,
        revision: "9",
      }
    },
  })

  const response = await handlers.settings(request("/settings"))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body.settings, {
    enabled: true,
    leadHours: 3,
    revision: "9",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ready: false,
    status: "scheduler_pending",
    editable: true,
    activeKinds: ["observation_reminder"],
  })
  assert.equal(JSON.stringify(body).includes("templateId"), false)
  assert.equal(JSON.stringify(body).includes("pfId"), false)
  assert.equal(JSON.stringify(body).includes("catalogChecksum"), false)
})

test("reminder settings contract derives active kinds from the server catalog", () => {
  const catalog = createRegistrationCustomerMessageCatalog({
    SOLAPI_API_KEY: "api-key",
    SOLAPI_API_SECRET: "api-secret",
    SOLAPI_KAKAO_PF_ID: "pf-id",
    SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "template-appointment",
    SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "template-observation",
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "server-only-recipient-pepper",
  })
  const appointment = catalog.templates.appointment_reminder
  const observation = catalog.templates.observation_reminder
  const contract = reminderRoute.reminderTemplateContract

  assert.deepEqual(contract(catalog, ["appointment_reminder"]), {
    templateId: appointment.templateId,
    pfId: catalog.pfId,
    catalogChecksum: appointment.checksums.template,
  })
  assert.deepEqual(contract(catalog, ["observation_reminder"]), {
    templates: [{
      messageKind: "observation_reminder",
      templateId: observation.templateId,
      pfId: catalog.pfId,
      catalogChecksum: observation.checksums.template,
    }],
  })
  assert.equal(contract(catalog, ["appointment_reminder", "observation_reminder"]).templates.length, 2)
  assert.throws(() => contract(catalog, []), /template_contract_invalid/)
  assert.throws(
    () => contract(catalog, ["observation_reminder", "observation_reminder"]),
    /template_contract_invalid/,
  )
  assert.throws(() => contract(catalog, ["unknown_reminder"]), /template_contract_invalid|not_ready/)
})
