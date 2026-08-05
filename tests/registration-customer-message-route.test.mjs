import assert from "node:assert/strict"
import test from "node:test"

import {
  RegistrationCustomerMessageHttpError,
  createRegistrationCustomerMessageAuth,
} from "../src/features/tasks/server/registration-customer-message-auth.ts"
import {
  createRegistrationCustomerMessageRouteHandlers,
  registrationCustomerMessageHistoryRpcError,
} from "../src/features/tasks/server/registration-customer-message-route.ts"

const IDS = Object.freeze({
  actor: "00000000-0000-4000-8000-000000000001",
  source: "00000000-0000-4000-8000-000000000002",
  task: "00000000-0000-4000-8000-000000000003",
  preview: "00000000-0000-4000-8000-000000000004",
  message: "00000000-0000-4000-8000-000000000005",
})

const TARGET = Object.freeze({
  messageKind: "waiting_notice",
  sourceId: IDS.source,
})

const SOURCE = Object.freeze({
  messageKind: "waiting_notice",
  sourceId: IDS.source,
  taskId: IDS.task,
  sourceRevision: 3,
  studentName: "김팁스",
  recipientLast4: "5678",
  facts: Object.freeze({
    subjectLabel: "수학",
    waitingKindLabel: "현재반 대기",
    waitingDetailLabel: "중2 수학 A",
  }),
  body: "안녕하세요. 김팁스 학생의 수학 현재반 대기 요청이 접수되었습니다.",
  buttons: Object.freeze([]),
})

const PRIVATE_SOURCE = Object.freeze({
  previewContract: Object.freeze({
    parentPhoneDigits: "01012345678",
    sourceFingerprint: "source-fingerprint",
    recipientHash: "recipient-hash",
    templateKey: "waiting_notice",
    templateRevision: 1,
    templateChecksum: "template-checksum",
    renderedVariablesChecksum: "variables-checksum",
    renderedBodyChecksum: "body-checksum",
    renderedButtonsChecksum: "buttons-checksum",
  }),
  readinessContract: Object.freeze({
    credentialsConfigured: true,
    pfId: "pf-id",
    templateId: "template-id",
    catalogChecksum: "catalog-checksum",
    recipientHash: "recipient-hash",
    sourceFingerprint: "source-fingerprint",
    sourceFactsChecksum: "facts-checksum",
  }),
})

const ACTIVE_READINESS = Object.freeze({
  runtimeReady: true,
  activationMode: "live",
  activationEligible: true,
  credentialsConfigured: true,
  pfConfigured: true,
  templateConfigured: true,
  templateVerified: true,
  verifiedAt: "2026-08-05T00:00:00.000Z",
  sourceValid: true,
  sendAllowed: true,
  blockers: Object.freeze([]),
})

const HISTORY = Object.freeze([{
  messageId: IDS.message,
  messageKind: "waiting_notice",
  currentStatus: "pending",
  confirmedAt: "2026-08-05T00:05:00.000Z",
  updatedAt: "2026-08-05T00:06:00.000Z",
  recipientLast4: "5678",
  canCheck: true,
}])

function request(path, init = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer test-token", ...init.headers },
    ...init,
  })
}

function makeDeps(overrides = {}) {
  const calls = {
    auth: 0,
    authorize: 0,
    resolve: 0,
    resolveTaskId: 0,
    readiness: 0,
    createPreview: 0,
    history: 0,
  }
  const deps = {
    now: () => new Date("2026-08-05T00:00:00.000Z"),
    async authenticate() {
      calls.auth += 1
      return { actorProfileId: IDS.actor, role: "staff", actorClient: {} }
    },
    async authorizeTask(context, taskId) {
      calls.authorize += 1
      assert.equal(context.actorProfileId, IDS.actor)
      assert.equal(taskId, IDS.task)
      return true
    },
    async resolveSource(input) {
      calls.resolve += 1
      assert.deepEqual(
        { actorProfileId: input.actorProfileId, messageKind: input.messageKind, sourceId: input.sourceId },
        { actorProfileId: IDS.actor, ...TARGET },
      )
      assert.equal(input.context.actorProfileId, IDS.actor)
      return SOURCE
    },
    async resolveTaskId(input) {
      calls.resolveTaskId += 1
      assert.equal(input.messageKind, TARGET.messageKind)
      assert.equal(input.sourceId, TARGET.sourceId)
      return IDS.task
    },
    readPrivateSource(source) {
      assert.equal(source, SOURCE)
      return PRIVATE_SOURCE
    },
    async getReadiness(input) {
      calls.readiness += 1
      assert.equal(input.actorProfileId, IDS.actor)
      assert.equal(input.taskId, IDS.task)
      assert.deepEqual(input.contract, PRIVATE_SOURCE.readinessContract)
      return ACTIVE_READINESS
    },
    async createPreview(input) {
      calls.createPreview += 1
      assert.equal(input.actorProfileId, IDS.actor)
      assert.equal(input.taskId, IDS.task)
      assert.deepEqual(input.contract, PRIVATE_SOURCE.previewContract)
      return {
        previewId: IDS.preview,
        expiresAt: "2026-08-05T00:10:00.000Z",
        messageKind: "waiting_notice",
        recipientLast4: "5678",
      }
    },
    async listHistory(input) {
      calls.history += 1
      assert.equal(input.actorProfileId, IDS.actor)
      return HISTORY
    },
    ...overrides,
  }
  return { deps, calls }
}

async function json(response) {
  return { response, body: await response.json() }
}

test("authentication requires a strict bearer token and keeps task visibility on the actor client", async () => {
  let createdActorClients = 0
  let createdServiceClients = 0
  let visibleTask = true
  const actorClient = {
    auth: {
      async getUser(token) {
        assert.equal(token, "test-token")
        return { data: { user: { id: IDS.actor } }, error: null }
      },
    },
    from(table) {
      assert.equal(table, "ops_tasks")
      const filters = []
      return {
        select(columns) {
          assert.equal(columns, "id,type")
          return this
        },
        eq(column, value) {
          filters.push([column, value])
          return this
        },
        async maybeSingle() {
          assert.deepEqual(filters, [["id", IDS.task], ["type", "registration"]])
          return { data: visibleTask ? { id: IDS.task, type: "registration" } : null, error: null }
        },
      }
    },
  }
  const serviceClient = {
    from(table) {
      assert.equal(table, "profiles")
      return {
        select(columns) {
          assert.equal(columns, "role")
          return this
        },
        eq(column, value) {
          assert.deepEqual([column, value], ["id", IDS.actor])
          return this
        },
        async maybeSingle() {
          return { data: { role: "staff" }, error: null }
        },
      }
    },
  }
  const auth = createRegistrationCustomerMessageAuth({
    createAuthenticatedClient() {
      createdActorClients += 1
      return actorClient
    },
    createServiceClient() {
      createdServiceClients += 1
      return serviceClient
    },
  })

  for (const authorization of [null, "test-token", "Bearer test-token extra", "Bearer "]) {
    await assert.rejects(
      () => auth.authenticate(request("/preview", {
        headers: authorization ? { authorization } : { authorization: "" },
      })),
      { status: 401, code: "registration_customer_message_unauthorized" },
    )
  }
  assert.equal(createdActorClients, 0)
  assert.equal(createdServiceClients, 0)

  const context = await auth.authenticate(request("/preview"))
  assert.equal(context.actorProfileId, IDS.actor)
  assert.equal(context.role, "staff")
  assert.equal(context.actorClient, actorClient)
  assert.equal(context.serviceClient, serviceClient)
  assert.equal(await auth.authorizeTask(context, IDS.task), true)
  visibleTask = false
  assert.equal(await auth.authorizeTask(context, IDS.task), false)
})

test("authentication distinguishes profile-query outages from a missing role", async () => {
  const actorClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: IDS.actor } }, error: null }
      },
    },
  }
  function serviceClient(result) {
    return {
      from() {
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() { return result },
        }
      },
    }
  }

  for (const [result, status, code] of [
    [{ data: null, error: { code: "08006" } }, 503, "registration_customer_message_runtime_unavailable"],
    [{ data: null, error: null }, 403, "registration_customer_message_forbidden"],
  ]) {
    const auth = createRegistrationCustomerMessageAuth({
      createAuthenticatedClient: () => actorClient,
      createServiceClient: () => serviceClient(result),
    })
    await assert.rejects(
      () => auth.authenticate(request("/preview")),
      { status, code },
    )
  }
})

test("preview rejects malformed and extra input before authentication", async () => {
  const { deps, calls } = makeDeps()
  const handlers = createRegistrationCustomerMessageRouteHandlers(deps)

  for (const body of [
    "{",
    JSON.stringify({ messageKind: TARGET.messageKind }),
    JSON.stringify({ ...TARGET, parentPhoneDigits: "01012345678" }),
    JSON.stringify({ ...TARGET, sourceId: "not-a-uuid" }),
  ]) {
    const result = await json(await handlers.preview(request("/preview", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    })))
    assert.equal(result.response.status, 400)
    assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_preview_input_invalid" })
  }
  assert.equal(calls.auth, 0)
})

test("preview enforces authentication, operator role, and task visibility", async () => {
  const cases = [
    [{ authenticate: async () => { throw new RegistrationCustomerMessageHttpError(401, "registration_customer_message_unauthorized") } }, 401, "registration_customer_message_unauthorized"],
    [{ authenticate: async () => ({ actorProfileId: IDS.actor, role: "teacher", actorClient: {} }) }, 403, "registration_customer_message_forbidden"],
    [{ authorizeTask: async () => false }, 404, "registration_customer_message_source_not_found"],
  ]

  for (const [overrides, status, code] of cases) {
    const { deps } = makeDeps(overrides)
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const result = await json(await handlers.preview(request("/preview", {
      method: "POST",
      body: JSON.stringify(TARGET),
    })))
    assert.equal(result.response.status, status)
    assert.deepEqual(result.body, { ok: false, code })
  }
})

test("preview maps source validation failures to one stable public code", async () => {
  const { deps } = makeDeps({
    resolveSource: async () => {
      throw new Error("registration_customer_message_phone_invalid")
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).preview(
    request("/preview", { method: "POST", body: JSON.stringify(TARGET) }),
  ))
  assert.equal(result.response.status, 422)
  assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_source_invalid" })
})

test("preview establishes actor task visibility before the service-only source RPC", async () => {
  const order = []
  const { deps } = makeDeps({
    async authorizeTask() {
      order.push("actor-task-visibility")
      return true
    },
    async resolveSource() {
      order.push("service-source-rpc")
      return SOURCE
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).preview(
    request("/preview", { method: "POST", body: JSON.stringify(TARGET) }),
  ))
  assert.equal(result.response.status, 200)
  assert.deepEqual(order, ["actor-task-visibility", "service-source-rpc"])
})

test("off and verification-mismatch readiness return a read-only preview without creating a receipt", async () => {
  for (const readiness of [
    { ...ACTIVE_READINESS, activationMode: "off", activationEligible: false, sendAllowed: false, blockers: ["activation_off"] },
    { ...ACTIVE_READINESS, activationMode: "verification", activationEligible: false, sendAllowed: false, blockers: ["verification_scope_mismatch"] },
  ]) {
    const { deps, calls } = makeDeps({ getReadiness: async () => readiness })
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const result = await json(await handlers.preview(request("/preview", {
      method: "POST",
      body: JSON.stringify(TARGET),
    })))

    assert.equal(result.response.status, 200)
    assert.equal(result.body.previewId, null)
    assert.equal(result.body.expiresAt, null)
    assert.equal(result.body.body, SOURCE.body)
    assert.deepEqual(result.body.readiness, readiness)
    assert.deepEqual(result.body.latestMessage, HISTORY[0])
    assert.equal(calls.createPreview, 0)
  }
})

test("active preview creates a future receipt and emits only the public DTO", async () => {
  const originalFetch = globalThis.fetch
  let providerCalls = 0
  globalThis.fetch = async () => {
    providerCalls += 1
    throw new Error("provider_must_not_be_called")
  }
  try {
    const { deps, calls } = makeDeps()
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const result = await json(await handlers.preview(request("/preview", {
      method: "POST",
      body: JSON.stringify(TARGET),
    })))

    assert.equal(result.response.status, 200)
    assert.equal(result.response.headers.get("cache-control"), "no-store")
    assert.equal(result.body.previewId, IDS.preview)
    assert.equal(result.body.expiresAt, "2026-08-05T00:10:00.000Z")
    assert.equal(result.body.recipientLast4, "5678")
    assert.equal(calls.createPreview, 1)
    assert.equal(providerCalls, 0)
    const serialized = JSON.stringify(result.body)
    for (const forbidden of [
      "01012345678", "recipientHash", "templateId", "pfId", "checksum", "provider",
    ]) assert.equal(serialized.includes(forbidden), false, forbidden)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("invalid or expired preview receipts fail closed", async () => {
  for (const receipt of [
    null,
    { previewId: IDS.preview, expiresAt: "2026-08-04T23:59:59.000Z", messageKind: "waiting_notice", recipientLast4: "5678" },
    { previewId: IDS.preview, expiresAt: "not-a-date", messageKind: "waiting_notice", recipientLast4: "5678" },
  ]) {
    const { deps } = makeDeps({ createPreview: async () => receipt })
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const result = await json(await handlers.preview(request("/preview", {
      method: "POST",
      body: JSON.stringify(TARGET),
    })))
    assert.equal(result.response.status, 503)
    assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_preview_unavailable" })
  }
})

test("history uses strict query input and masks teacher-only fields", async () => {
  const malformed = [
    "/messages",
    `/messages?messageKind=${TARGET.messageKind}&sourceId=${TARGET.sourceId}&extra=1`,
    `/messages?messageKind=other&sourceId=${TARGET.sourceId}`,
  ]
  for (const path of malformed) {
    const { deps, calls } = makeDeps()
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).messages(request(path)))
    assert.equal(result.response.status, 400)
    assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_history_input_invalid" })
    assert.equal(calls.auth, 0)
  }

  for (const [role, expected] of [
    ["staff", HISTORY],
    ["teacher", [{
      messageKind: "waiting_notice",
      currentStatus: "pending",
      confirmedAt: "2026-08-05T00:05:00.000Z",
      updatedAt: "2026-08-05T00:06:00.000Z",
    }]],
  ]) {
    const { deps, calls } = makeDeps({
      authenticate: async () => ({ actorProfileId: IDS.actor, role, actorClient: {} }),
    })
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const result = await json(await handlers.messages(request(
      `/messages?messageKind=${TARGET.messageKind}&sourceId=${TARGET.sourceId}`,
    )))
    assert.equal(result.response.status, 200)
    assert.deepEqual(result.body, expected)
    assert.equal(calls.resolve, 0)
    assert.equal(calls.resolveTaskId, role === "teacher" ? 0 : 1)
  }
})

test("assigned-teacher history delegates visibility to the masked service RPC", async () => {
  const { deps, calls } = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "teacher", actorClient: {} }),
    resolveTaskId: async () => {
      throw new Error("teacher_must_not_depend_on_operator_task_rls")
    },
    listHistory: async () => {
      throw new RegistrationCustomerMessageHttpError(
        404,
        "registration_customer_message_source_not_found",
      )
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).messages(
    request(`/messages?messageKind=${TARGET.messageKind}&sourceId=${TARGET.sourceId}`),
  ))
  assert.equal(result.response.status, 404)
  assert.deepEqual(result.body, {
    ok: false,
    code: "registration_customer_message_source_not_found",
  })
  assert.equal(calls.authorize, 0)
})

test("history adapter maps access and invalid-source SQLSTATEs to the same stable 404", () => {
  for (const code of ["42501", "P0002", "22023"]) {
    const error = registrationCustomerMessageHistoryRpcError({
      code,
      message: "raw database detail must not escape",
    })
    assert.equal(error.status, 404)
    assert.equal(error.code, "registration_customer_message_source_not_found")
    assert.equal(error.message.includes("raw database detail"), false)
  }
  const unavailable = registrationCustomerMessageHistoryRpcError({
    code: "08006",
    message: "connection detail must not escape",
  })
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.code, "registration_customer_message_history_unavailable")
  assert.equal(unavailable.message.includes("connection detail"), false)
})

test("history rejects unsupported roles and never calls a provider", async () => {
  const originalFetch = globalThis.fetch
  let providerCalls = 0
  globalThis.fetch = async () => {
    providerCalls += 1
    throw new Error("provider_must_not_be_called")
  }
  try {
    const { deps } = makeDeps({
      authenticate: async () => ({ actorProfileId: IDS.actor, role: "assistant", actorClient: {} }),
    })
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const result = await json(await handlers.messages(request(
      `/messages?messageKind=${TARGET.messageKind}&sourceId=${TARGET.sourceId}`,
    )))
    assert.equal(result.response.status, 403)
    assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_forbidden" })
    assert.equal(providerCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
