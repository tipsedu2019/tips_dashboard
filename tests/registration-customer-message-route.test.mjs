import assert from "node:assert/strict"
import test from "node:test"

import {
  RegistrationCustomerMessageHttpError,
  createRegistrationCustomerMessageAuth,
} from "../src/features/tasks/server/registration-customer-message-auth.ts"
import {
  createProductionRegistrationCustomerMessageRouteHandlers,
  createRegistrationCustomerMessageRouteHandlers,
  registrationCustomerMessageHistoryRpcError,
  registrationCustomerMessageSourceRpcError,
} from "../src/features/tasks/server/registration-customer-message-route.ts"

const IDS = Object.freeze({
  actor: "00000000-0000-4000-8000-000000000001",
  source: "00000000-0000-4000-8000-000000000002",
  task: "00000000-0000-4000-8000-000000000003",
  preview: "00000000-0000-4000-8000-000000000004",
  message: "00000000-0000-4000-8000-000000000005",
  request: "00000000-0000-4000-8000-000000000006",
  claim: "00000000-0000-4000-8000-000000000007",
  dispatch: "00000000-0000-4000-8000-000000000008",
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
  source: Object.freeze({}),
  parentPhoneDigits: "01012345678",
  recipientHash: "recipient-hash",
  sourceFingerprint: "source-fingerprint",
  sourceFactsChecksum: "facts-checksum",
  rendered: Object.freeze({
    kind: "waiting_notice",
    body: SOURCE.body,
    variables: Object.freeze({ 학생명: "김팁스", 과목: "수학", 대기종류: "현재반 대기", 대기내용: "중2 수학 A" }),
    buttons: Object.freeze([]),
    facts: SOURCE.facts,
    checksums: Object.freeze({ variables: "variables-checksum", body: "body-checksum", buttons: "buttons-checksum" }),
  }),
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

const TEACHER_HISTORY_READINESS = Object.freeze({
  runtimeReady: false,
  activationMode: "off",
  activationEligible: false,
  credentialsConfigured: false,
  pfConfigured: false,
  templateConfigured: false,
  templateVerified: false,
  verifiedAt: null,
  sourceValid: false,
  sendAllowed: false,
  blockers: Object.freeze(["role_not_authorized"]),
})

const HISTORY = Object.freeze([{
  messageId: IDS.message,
  messageKind: "waiting_notice",
  currentStatus: "pending",
  confirmedByName: "김관리",
  confirmedAt: "2026-08-05T00:05:00.000Z",
  updatedAt: "2026-08-05T00:06:00.000Z",
  recipientLast4: "5678",
  canCheck: true,
}])

const TERMINAL_OBSERVATION_TARGET = Object.freeze({
  messageKind: "observation_booking",
  sourceId: "00000000-0000-4000-8000-000000000009",
})

const TERMINAL_OBSERVATION_HISTORY = Object.freeze([{
  messageId: IDS.message,
  messageKind: "observation_booking",
  sourceId: TERMINAL_OBSERVATION_TARGET.sourceId,
  observationId: TERMINAL_OBSERVATION_TARGET.sourceId,
  currentStatus: "accepted",
  confirmedByName: "김관리",
  confirmedAt: "2026-08-05T00:05:00.000Z",
  updatedAt: "2026-08-05T00:06:00.000Z",
  recipientLast4: "5678",
  canCheck: false,
  deliveryOrigin: "manual",
  providerMessageId: "must-not-leak",
}])

const TERMINAL_HISTORY_READINESS = Object.freeze({
  runtimeReady: false,
  activationMode: "off",
  activationEligible: false,
  credentialsConfigured: false,
  pfConfigured: false,
  templateConfigured: false,
  templateVerified: false,
  verifiedAt: null,
  sourceValid: false,
  sendAllowed: false,
  blockers: Object.freeze(["source_invalid"]),
})

const PRODUCTION_HISTORY_ENV = Object.freeze({
  SOLAPI_API_KEY: "local-api-key",
  SOLAPI_API_SECRET: "local-api-secret",
  SOLAPI_KAKAO_PF_ID: "local-pf",
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "level-test",
  SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "visit",
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "reminder",
  SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "waiting",
  SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: "admission",
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "observation-booking",
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "observation-reminder",
  REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "local-history-pepper",
})

function createProductionHistoryHarness({
  role = "staff",
  messageKind = TERMINAL_OBSERVATION_TARGET.messageKind,
  sourceState = "canceled",
  sourceExists = true,
  taskVisible = true,
} = {}) {
  const calls = {
    actorTables: [],
    rpcNames: [],
    provider: 0,
  }
  const actorClient = {
    auth: {
      async getUser(token) {
        assert.equal(token, "test-token")
        return { data: { user: { id: IDS.actor } }, error: null }
      },
    },
    from(table) {
      calls.actorTables.push(table)
      const filters = []
      return {
        select() { return this },
        eq(column, value) {
          filters.push([column, value])
          return this
        },
        async maybeSingle() {
          if (table === "ops_registration_observations") {
            assert.deepEqual(filters, [["id", TERMINAL_OBSERVATION_TARGET.sourceId]])
            return { data: sourceExists ? { task_id: IDS.task } : null, error: null }
          }
          assert.equal(table, "ops_tasks")
          assert.deepEqual(filters, [["id", IDS.task], ["type", "registration"]])
          return { data: taskVisible ? { id: IDS.task, type: "registration" } : null, error: null }
        },
      }
    },
  }
  const serviceClient = {
    from(table) {
      assert.equal(table, "profiles")
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: { role }, error: null } },
      }
    },
    async rpc(name, args) {
      calls.rpcNames.push(name)
      if (name === "list_registration_customer_messages_v1") {
        assert.deepEqual(args, {
          p_actor_profile_id: IDS.actor,
          p_message_kind: messageKind,
          p_source_id: TERMINAL_OBSERVATION_TARGET.sourceId,
          p_limit: 20,
        })
        return {
          data: TERMINAL_OBSERVATION_HISTORY.map((row) => ({ ...row, messageKind })),
          error: null,
        }
      }
      if (name === "resolve_registration_customer_message_source_v1") {
        assert.ok(["canceled", "attended", "no_show", "elapsed"].includes(sourceState))
        return {
          data: null,
          error: {
            code: "22023",
            message: "registration_customer_message_source_ineligible",
          },
        }
      }
      throw new Error(`unexpected production history RPC: ${name}`)
    },
  }
  const auth = createRegistrationCustomerMessageAuth({
    createAuthenticatedClient: () => actorClient,
    createServiceClient: () => serviceClient,
  })
  return {
    calls,
    handlers: createProductionRegistrationCustomerMessageRouteHandlers({
      auth,
      environment: PRODUCTION_HISTORY_ENV,
      providerFetch: async () => {
        calls.provider += 1
        throw new Error("terminal_history_must_not_call_provider")
      },
    }),
  }
}

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
    readPreviewTarget: 0,
    claim: 0,
    release: 0,
    marker: 0,
    providerSend: 0,
    finalize: 0,
    checkContext: 0,
    providerLookup: 0,
    recordCheck: 0,
    preflight: 0,
    receipt: 0,
    admin: 0,
    observationReadiness: 0,
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
    async readPreviewTarget(input) {
      calls.readPreviewTarget += 1
      assert.equal(input.previewId, IDS.preview)
      return { ...TARGET, taskId: IDS.task }
    },
    async claimMessage(input) {
      calls.claim += 1
      assert.equal(input.previewId, IDS.preview)
      assert.equal(input.requestKey, IDS.request)
      return {
        ok: false,
        messageId: IDS.message,
        messageKind: TARGET.messageKind,
        currentStatus: "pending",
        recipientLast4: "5678",
        confirmedByName: "김관리",
        confirmedAt: "2026-08-05T00:05:00.000Z",
        updatedAt: "2026-08-05T00:05:00.000Z",
        canCheck: false,
        idempotent: false,
        owner: true,
        claimToken: IDS.claim,
        dispatchToken: IDS.dispatch,
      }
    },
    async releasePreSendClaim() {
      calls.release += 1
      return { released: true }
    },
    async markAttemptStarted(input) {
      calls.marker += 1
      assert.equal(input.claimToken, IDS.claim)
      assert.equal(input.dispatchToken, IDS.dispatch)
      return { allowed: true, messageId: IDS.message, currentStatus: "pending", dispatchToken: IDS.dispatch }
    },
    async sendProvider(input) {
      calls.providerSend += 1
      assert.equal(input.to, "01012345678")
      assert.equal(input.requestKey, IDS.request)
      return {
        outcome: "accepted",
        evidence: {
          providerMessageId: "provider-message-1",
          statusCode: "2000",
          statusMessage: "접수",
          observedAt: "2026-08-05T00:06:00.000Z",
          requestKeyMatched: true,
        },
      }
    },
    async finalizeMessage(input) {
      calls.finalize += 1
      return {
        ok: input.outcome === "accepted",
        messageId: IDS.message,
        messageKind: TARGET.messageKind,
        currentStatus: input.outcome,
        recipientLast4: "5678",
        confirmedByName: "김관리",
        confirmedAt: "2026-08-05T00:05:00.000Z",
        updatedAt: "2026-08-05T00:06:00.000Z",
        canCheck: false,
        idempotent: false,
      }
    },
    async readCheckContext(input) {
      calls.checkContext += 1
      assert.equal(input.messageId, IDS.message)
      return {
        result: HISTORY[0],
        providerMessageId: "provider-message-1",
        providerGroupId: null,
        requestKey: IDS.request,
      }
    },
    async lookupProvider(input) {
      calls.providerLookup += 1
      assert.equal(input.requestKey, IDS.request)
      return {
        outcome: "accepted",
        evidence: {
          providerMessageId: "provider-message-1",
          statusCode: "4000",
          statusMessage: "성공",
          observedAt: "2026-08-05T00:20:00.000Z",
          requestKeyMatched: true,
        },
      }
    },
    async recordProviderCheck(input) {
      calls.recordCheck += 1
      assert.equal(input.requestKey, IDS.request)
      return { ...HISTORY[0], ok: true, currentStatus: input.resolution, idempotent: false }
    },
    async preflightTemplate() {
      calls.preflight += 1
      return {
        matched: true,
        receipt: {
          templateId: "template-id",
          pfId: "pf-id",
          catalogChecksum: "a".repeat(64),
          providerChecksum: "a".repeat(64),
          providerStatus: "sendable",
        },
      }
    },
    async recordTemplateReceipt() {
      calls.receipt += 1
      return { messageKind: TARGET.messageKind, templateVerified: true, verifiedAt: "2026-08-05T00:00:00.000Z" }
    },
    async performAdminAction(input) {
      calls.admin += 1
      return { ok: true, action: input.action.action }
    },
    async inspectObservationReadiness() {
      calls.observationReadiness += 1
      return {
        runtimeReady: true,
        settingsEnabled: true,
        leadHours: 3,
        schedule: {
          installed: true,
          active: true,
          contractReady: true,
          vaultReady: true,
          heartbeatCurrent: true,
          lastSucceededAt: "2026-08-12T00:00:00.000Z",
        },
        bookingMode: "off",
        reminderMode: "verification",
        bookingReceipt: false,
        reminderReceipt: false,
        reminderCutoffAt: null,
        observationMessages: 0,
        providerAttemptMarkers: 0,
        pending: 1,
        sourceDirty: 2,
        deliveryUnknown: 3,
      }
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

test("preview preserves only safe actionable source validation codes", async () => {
  for (const code of [
    "registration_customer_message_source_ineligible",
    "registration_customer_message_admission_schedule_incomplete",
    "registration_customer_message_body_too_long",
  ]) {
    const { deps } = makeDeps({
      resolveSource: async () => {
        throw new Error(code)
      },
    })
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).preview(
      request("/preview", { method: "POST", body: JSON.stringify(TARGET) }),
    ))
    assert.equal(result.response.status, 422)
    assert.deepEqual(result.body, { ok: false, code })
  }

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

test("production source RPC strips database details and retains exact safe codes", () => {
  assert.equal(
    registrationCustomerMessageSourceRpcError({
      code: "22023",
      message: "registration_customer_message_source_ineligible: secret detail",
    }).message,
    "registration_customer_message_source_ineligible",
  )
  assert.equal(
    registrationCustomerMessageSourceRpcError({
      code: "22023",
      message: "registration_customer_message_admission_schedule_incomplete",
    }).message,
    "registration_customer_message_admission_schedule_incomplete",
  )
  assert.equal(
    registrationCustomerMessageSourceRpcError({
      code: "22023",
      message: "raw postgres validation detail",
    }).message,
    "registration_customer_message_source_invalid",
  )
  const unavailable = registrationCustomerMessageSourceRpcError({
    code: "XX000",
    message: "connection secret",
  })
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.code, "registration_customer_message_runtime_unavailable")
  assert.equal(unavailable.message.includes("connection secret"), false)
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

test("observation preview derives task visibility from the source RPC when its row is not directly actor-readable", async () => {
  const target = {
    messageKind: "observation_booking",
    sourceId: TERMINAL_OBSERVATION_TARGET.sourceId,
  }
  const source = { ...SOURCE, ...target }
  let sourceCalls = 0
  const { deps, calls } = makeDeps({
    async resolveTaskId() {
      throw new Error("observation_preview_must_not_require_direct_observation_select")
    },
    async authorizeTask() {
      throw new Error("observation_preview_source_rpc_already_authorizes_the_actor")
    },
    async resolveSource(input) {
      sourceCalls += 1
      assert.deepEqual({
        actorProfileId: input.actorProfileId,
        messageKind: input.messageKind,
        sourceId: input.sourceId,
      }, {
        actorProfileId: IDS.actor,
        ...target,
      })
      return source
    },
    readPrivateSource(value) {
      assert.equal(value, source)
      return PRIVATE_SOURCE
    },
    async listCurrentObservationHistory() {
      return []
    },
    async createPreview() {
      return {
        previewId: IDS.preview,
        expiresAt: "2026-08-05T00:10:00.000Z",
        messageKind: target.messageKind,
        recipientLast4: "5678",
      }
    },
  })

  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).preview(
    request("/preview", { method: "POST", body: JSON.stringify(target) }),
  ))

  assert.equal(result.response.status, 200)
  assert.equal(result.body.messageKind, target.messageKind)
  assert.equal(calls.resolveTaskId, 0)
  assert.equal(sourceCalls, 1)
  assert.equal(calls.authorize, 0)
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
      confirmedByName: "김관리",
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
    assert.deepEqual(result.body, {
      ok: true,
      messageKind: TARGET.messageKind,
      readiness: role === "teacher" ? TEACHER_HISTORY_READINESS : ACTIVE_READINESS,
      history: expected,
    })
    assert.equal(calls.resolve, role === "teacher" ? 0 : 1)
    assert.equal(calls.readiness, role === "teacher" ? 0 : 1)
    assert.equal(calls.history, 1)
    assert.equal(calls.resolveTaskId, role === "teacher" ? 0 : 1)
  }
})

test("production operator history never consults terminal observation eligibility or exposes stored internals", async () => {
  for (const role of ["admin", "staff"]) {
    for (const messageKind of ["observation_booking", "observation_reminder"]) {
      for (const sourceState of ["canceled", "attended", "no_show", "elapsed"]) {
        const label = `${role}:${messageKind}:${sourceState}`
        const harness = createProductionHistoryHarness({ role, messageKind, sourceState })
        const result = await json(await harness.handlers.messages(request(
          `/messages?messageKind=${messageKind}&sourceId=${TERMINAL_OBSERVATION_TARGET.sourceId}`,
        )))

        assert.equal(result.response.status, 200, label)
        assert.deepEqual(result.body, {
          ok: true,
          messageKind,
          readiness: TERMINAL_HISTORY_READINESS,
          history: [{
            messageId: IDS.message,
            messageKind,
            currentStatus: "accepted",
            confirmedByName: "김관리",
            confirmedAt: "2026-08-05T00:05:00.000Z",
            updatedAt: "2026-08-05T00:06:00.000Z",
            recipientLast4: "5678",
            canCheck: false,
          }],
        }, label)
        assert.deepEqual(harness.calls.actorTables, [
          "ops_registration_observations",
          "ops_tasks",
        ], label)
        assert.equal(
          harness.calls.rpcNames.filter((name) => name === "list_registration_customer_messages_v1").length,
          1,
          label,
        )
        assert.equal(
          harness.calls.rpcNames.filter((name) => name === "resolve_registration_customer_message_source_v1").length,
          0,
          label,
        )
        assert.equal(harness.calls.rpcNames.includes("get_registration_customer_solapi_readiness_v1"), false)
        assert.equal(harness.calls.provider, 0)
        const serialized = JSON.stringify(result.body)
        for (const forbidden of [
          "providerMessageId", "deliveryOrigin", "sourceId", "observationId", "must-not-leak",
        ]) assert.equal(serialized.includes(forbidden), false, `${label}:${forbidden}`)
      }
    }
  }
})

test("production observation history keeps source, task, and role authorization before service history", async () => {
  for (const [label, configuration, expectedStatus] of [
    ["wrong observation", { sourceExists: false }, 404],
    ["wrong task", { taskVisible: false }, 404],
    ["wrong role", { role: "assistant" }, 403],
  ]) {
    const harness = createProductionHistoryHarness(configuration)
    const result = await json(await harness.handlers.messages(request(
      `/messages?messageKind=${TERMINAL_OBSERVATION_TARGET.messageKind}&sourceId=${TERMINAL_OBSERVATION_TARGET.sourceId}`,
    )))
    assert.equal(result.response.status, expectedStatus, label)
    assert.equal(harness.calls.rpcNames.length, 0, label)
    assert.equal(harness.calls.provider, 0, label)
  }
})

test("production teacher terminal observation history stays DB-authorized and route-masked", async () => {
  const harness = createProductionHistoryHarness({ role: "teacher" })
  const result = await json(await harness.handlers.messages(request(
    `/messages?messageKind=${TERMINAL_OBSERVATION_TARGET.messageKind}&sourceId=${TERMINAL_OBSERVATION_TARGET.sourceId}`,
  )))

  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, {
    ok: true,
    messageKind: "observation_booking",
    readiness: TEACHER_HISTORY_READINESS,
    history: [{
      messageKind: "observation_booking",
      currentStatus: "accepted",
      confirmedByName: "김관리",
      confirmedAt: "2026-08-05T00:05:00.000Z",
      updatedAt: "2026-08-05T00:06:00.000Z",
    }],
  })
  assert.deepEqual(harness.calls.actorTables, [])
  assert.deepEqual(harness.calls.rpcNames, ["list_registration_customer_messages_v1"])
  assert.equal(harness.calls.provider, 0)
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

test("teacher history stays masked and skips operator-only source and readiness dependencies", async () => {
  const restrictedCalls = {
    authorizeTask: 0,
    resolveSource: 0,
    getReadiness: 0,
    history: 0,
  }
  const { deps, calls } = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "teacher", actorClient: {} }),
    authorizeTask: async () => {
      restrictedCalls.authorizeTask += 1
      throw new Error("teacher_must_not_authorize_operator_task")
    },
    resolveSource: async () => {
      restrictedCalls.resolveSource += 1
      throw new Error("teacher_must_not_resolve_operator_source")
    },
    getReadiness: async () => {
      restrictedCalls.getReadiness += 1
      throw new Error("teacher_must_not_read_operator_readiness")
    },
    listHistory: async (input) => {
      restrictedCalls.history += 1
      assert.deepEqual({
        actorProfileId: input.actorProfileId,
        messageKind: input.messageKind,
        sourceId: input.sourceId,
        limit: input.limit,
        role: input.context.role,
      }, {
        actorProfileId: IDS.actor,
        ...TARGET,
        limit: 20,
        role: "teacher",
      })
      return HISTORY
    },
  })

  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).messages(
    request(`/messages?messageKind=${TARGET.messageKind}&sourceId=${TARGET.sourceId}`),
  ))

  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, {
    ok: true,
    messageKind: TARGET.messageKind,
    readiness: TEACHER_HISTORY_READINESS,
    history: [{
      messageKind: "waiting_notice",
      currentStatus: "pending",
      confirmedByName: "김관리",
      confirmedAt: "2026-08-05T00:05:00.000Z",
      updatedAt: "2026-08-05T00:06:00.000Z",
    }],
  })
  assert.deepEqual(restrictedCalls, {
    authorizeTask: 0,
    resolveSource: 0,
    getReadiness: 0,
    history: 1,
  })
  assert.equal(calls.resolveTaskId, 0)
  assert.equal(calls.providerSend, 0)
  assert.equal(calls.providerLookup, 0)
  const serialized = JSON.stringify(result.body)
  for (const forbidden of ["messageId", "recipientLast4", "canCheck", "providerMessageId", "providerGroupId"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
})

test("history and readiness failures stay public, stable, and provider-free", async () => {
  for (const [overrides, expectedCode] of [
    [{ getReadiness: async () => ({}) }, "registration_customer_message_readiness_unavailable"],
    [{
      listHistory: async () => {
        throw new RegistrationCustomerMessageHttpError(
          503,
          "registration_customer_message_history_unavailable",
        )
      },
    }, "registration_customer_message_history_unavailable"],
  ]) {
    const { deps, calls } = makeDeps(overrides)
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).messages(
      request(`/messages?messageKind=${TARGET.messageKind}&sourceId=${TARGET.sourceId}`),
    ))
    assert.equal(result.response.status, 503)
    assert.deepEqual(result.body, { ok: false, code: expectedCode })
    assert.equal(calls.providerSend, 0)
    assert.equal(calls.providerLookup, 0)
  }
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

test("send validates browser input before auth and never accepts provider-owned fields", async () => {
  for (const body of [
    "{",
    JSON.stringify({ previewId: IDS.preview }),
    JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request, to: "01012345678" }),
    JSON.stringify({ previewId: "bad", requestKey: IDS.request }),
  ]) {
    const { deps, calls } = makeDeps()
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
      request("/send", { method: "POST", body }),
    ))
    assert.equal(result.response.status, 400)
    assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_send_input_invalid" })
    assert.equal(calls.auth, 0)
    assert.equal(calls.providerSend, 0)
  }
})

test("send claims, re-reads canonical source, commits the marker, then calls SOLAPI once", async () => {
  const order = []
  const { deps, calls } = makeDeps({
    async resolveSource() {
      order.push("canonical-read")
      return SOURCE
    },
    async claimMessage(input) {
      order.push("claim-commit")
      return makeDeps().deps.claimMessage(input)
    },
    async markAttemptStarted(input) {
      order.push("marker-commit")
      return makeDeps().deps.markAttemptStarted(input)
    },
    async sendProvider(input) {
      order.push("provider")
      return makeDeps().deps.sendProvider(input)
    },
    async finalizeMessage(input) {
      order.push("finalize")
      return makeDeps().deps.finalizeMessage(input)
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
    request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
  ))
  assert.equal(result.response.status, 200)
  assert.equal(result.body.currentStatus, "accepted")
  assert.deepEqual(order, ["canonical-read", "claim-commit", "canonical-read", "marker-commit", "provider", "finalize"])
  assert.equal(calls.providerSend, 0, "overridden provider owns the call counter")
  assert.equal(JSON.stringify(result.body).includes("claimToken"), false)
  assert.equal(JSON.stringify(result.body).includes("provider"), false)
})

test("all five legacy kinds preserve the same preview and provider sequence without an observation-runtime dependency", async () => {
  for (const messageKind of [
    "level_test_booking",
    "visit_consultation_booking",
    "appointment_reminder",
    "waiting_notice",
    "admission_application",
  ]) {
    const target = { messageKind, sourceId: IDS.source }
    const source = { ...SOURCE, messageKind }
    const order = []
    const { deps } = makeDeps({
      async resolveTaskId(input) {
        assert.deepEqual({ messageKind: input.messageKind, sourceId: input.sourceId }, target)
        return IDS.task
      },
      async resolveSource(input) {
        order.push("canonical-source")
        assert.deepEqual({ messageKind: input.messageKind, sourceId: input.sourceId }, target)
        return source
      },
      readPrivateSource(input) {
        assert.equal(input, source)
        return PRIVATE_SOURCE
      },
      async listHistory() {
        return []
      },
      async createPreview() {
        order.push("create-preview")
        return {
          previewId: IDS.preview,
          expiresAt: "2026-08-05T00:10:00.000Z",
          messageKind,
          recipientLast4: "5678",
        }
      },
      async readPreviewTarget() {
        return { ...target, taskId: IDS.task }
      },
      async claimMessage() {
        order.push("claim")
        return {
          ok: false,
          messageId: IDS.message,
          messageKind,
          currentStatus: "pending",
          recipientLast4: "5678",
          confirmedByName: "김관리",
          confirmedAt: "2026-08-05T00:05:00.000Z",
          updatedAt: "2026-08-05T00:05:00.000Z",
          canCheck: false,
          idempotent: false,
          owner: true,
          claimToken: IDS.claim,
          dispatchToken: IDS.dispatch,
        }
      },
      async markAttemptStarted() {
        order.push("marker")
        return {
          allowed: true,
          messageId: IDS.message,
          currentStatus: "pending",
          dispatchToken: IDS.dispatch,
        }
      },
      async sendProvider() {
        order.push("provider")
        return {
          outcome: "accepted",
          evidence: {
            providerMessageId: "provider-message-1",
            statusCode: "2000",
            statusMessage: "접수",
            observedAt: "2026-08-05T00:06:00.000Z",
            requestKeyMatched: true,
          },
        }
      },
      async finalizeMessage() {
        order.push("finalize")
        return {
          ok: true,
          messageId: IDS.message,
          messageKind,
          currentStatus: "accepted",
          recipientLast4: "5678",
          confirmedByName: "김관리",
          confirmedAt: "2026-08-05T00:05:00.000Z",
          updatedAt: "2026-08-05T00:06:00.000Z",
          canCheck: false,
          idempotent: false,
        }
      },
    })
    const handlers = createRegistrationCustomerMessageRouteHandlers(deps)
    const preview = await json(await handlers.preview(request("/preview", {
      method: "POST",
      body: JSON.stringify(target),
    })))
    assert.equal(preview.response.status, 200, messageKind)
    assert.equal(
      JSON.stringify(preview.body),
      JSON.stringify({
        ok: true,
        previewId: IDS.preview,
        expiresAt: "2026-08-05T00:10:00.000Z",
        messageKind,
        studentName: "김팁스",
        recipientLast4: "5678",
        facts: SOURCE.facts,
        body: SOURCE.body,
        buttons: [],
        readiness: ACTIVE_READINESS,
        latestMessage: null,
      }),
      messageKind,
    )
    const send = await json(await handlers.send(request("/send", {
      method: "POST",
      body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }),
    })))
    assert.equal(send.response.status, 200, messageKind)
    assert.equal(send.body.currentStatus, "accepted", messageKind)
    assert.deepEqual(order, [
      "canonical-source",
      "create-preview",
      "canonical-source",
      "claim",
      "canonical-source",
      "marker",
      "provider",
      "finalize",
    ], messageKind)
  }
})

test("dedupe/exact replay returns the existing masked result with provider zero", async () => {
  for (const currentStatus of ["accepted", "unknown", "failed_hold"]) {
    const { deps, calls } = makeDeps({
      claimMessage: async () => ({
        ok: currentStatus === "accepted",
        messageId: IDS.message,
        messageKind: TARGET.messageKind,
        currentStatus,
        recipientLast4: "5678",
        confirmedByName: "김관리",
        confirmedAt: "2026-08-05T00:05:00.000Z",
        updatedAt: "2026-08-05T00:06:00.000Z",
        canCheck: currentStatus === "unknown",
        idempotent: true,
        owner: false,
      }),
    })
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
      request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
    ))
    assert.equal(result.response.status, 200)
    assert.equal(result.body.currentStatus, currentStatus)
    assert.equal(result.body.idempotent, true)
    assert.equal(calls.marker, 0)
    assert.equal(calls.providerSend, 0)
  }
})

test("claim conflicts are non-disclosing and stale state calls provider zero", async () => {
  for (const code of ["23505", "40001", "P0002", "42501"]) {
    const { deps, calls } = makeDeps({
      claimMessage: async () => { throw Object.assign(new Error("raw database detail"), { code }) },
    })
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
      request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
    ))
    assert.equal(result.response.status, 409)
    assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_confirmation_conflict" })
    assert.equal(calls.providerSend, 0)
  }

  const missingPreview = makeDeps({
    readPreviewTarget: async () => {
      throw Object.assign(new Error("raw preview owner detail"), { code: "P0002" })
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(missingPreview.deps).send(
    request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
  ))
  assert.equal(result.response.status, 409)
  assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_confirmation_conflict" })
  assert.equal(missingPreview.calls.claim, 0)
  assert.equal(missingPreview.calls.providerSend, 0)
})

test("pre-marker preparation failure releases the count-0 claim and permits exact replay", async () => {
  let reads = 0
  const { deps, calls } = makeDeps({
    async resolveSource() {
      reads += 1
      if (reads === 2) throw new Error("registration_customer_message_source_invalid")
      return SOURCE
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
    request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
  ))
  assert.equal(result.response.status, 503)
  assert.deepEqual(result.body, { ok: false, code: "registration_customer_message_pre_send_failed" })
  assert.equal(calls.release, 1)
  assert.equal(calls.marker, 0)
  assert.equal(calls.providerSend, 0)
})

test("marker message or dispatch-token drift fails closed before provider access", async () => {
  for (const marker of [
    { allowed: true, messageId: IDS.preview, currentStatus: "pending", dispatchToken: IDS.dispatch },
    { allowed: true, messageId: IDS.message, currentStatus: "pending", dispatchToken: IDS.claim },
    { allowed: true, messageId: IDS.message, currentStatus: "pending" },
  ]) {
    const { deps, calls } = makeDeps({ markAttemptStarted: async () => marker })
    const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
      request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
    ))
    assert.equal(result.response.status, 503)
    assert.equal(calls.release, 1)
    assert.equal(calls.providerSend, 0)
  }
})

test("post-marker finalization uncertainty returns unknown and never repeats the provider in-request", async () => {
  const { deps, calls } = makeDeps({
    finalizeMessage: async () => { throw new Error("database unavailable after provider response") },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
    request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
  ))
  assert.equal(result.response.status, 502)
  assert.equal(result.body.currentStatus, "unknown")
  assert.equal(result.body.ok, false)
  assert.equal(calls.providerSend, 1)
  assert.equal(calls.release, 0)
})

test("a provider exception after the marker is finalized as unknown without a second call", async () => {
  const { deps, calls } = makeDeps({
    sendProvider: async () => {
      calls.providerSend += 1
      throw new Error("raw provider exception with private data")
    },
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).send(
    request("/send", { method: "POST", body: JSON.stringify({ previewId: IDS.preview, requestKey: IDS.request }) }),
  ))
  assert.equal(result.response.status, 200)
  assert.equal(result.body.currentStatus, "unknown")
  assert.equal(result.body.ok, false)
  assert.equal(calls.providerSend, 1)
  assert.equal(calls.finalize, 1)
  assert.equal(JSON.stringify(result.body).includes("raw provider exception"), false)
})

test("check is operator-only, uses the stored request key, and records only exact provider evidence", async () => {
  const { deps, calls } = makeDeps()
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).check(
    request("/check", { method: "POST", body: JSON.stringify({ messageId: IDS.message }) }),
  ))
  assert.equal(result.response.status, 200)
  assert.equal(result.body.currentStatus, "accepted")
  assert.equal(calls.providerLookup, 1)
  assert.equal(calls.recordCheck, 1)

  for (const overrides of [
    { authenticate: async () => ({ actorProfileId: IDS.actor, role: "teacher", actorClient: {} }) },
    { readCheckContext: async () => { throw Object.assign(new Error("too early"), { code: "40001" }) } },
    { readCheckContext: async () => ({ result: HISTORY[0], providerMessageId: null, requestKey: IDS.request }) },
    { lookupProvider: async () => ({ outcome: "unknown", evidence: { statusCode: "provider_request_key_mismatch", statusMessage: "mismatch", observedAt: "2026-08-05T00:20:00.000Z", requestKeyMatched: false } }) },
  ]) {
    const current = makeDeps(overrides)
    const denied = await json(await createRegistrationCustomerMessageRouteHandlers(current.deps).check(
      request("/check", { method: "POST", body: JSON.stringify({ messageId: IDS.message }) }),
    ))
    assert.equal(denied.response.status, overrides.authenticate ? 403 : 409)
    assert.equal(current.calls.recordCheck, 0)
  }
})

test("admin preflight records only an exact provider match and all admin mutations reject staff", async () => {
  const preflight = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
  })
  const success = await json(await createRegistrationCustomerMessageRouteHandlers(preflight.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "preflight_template", messageKind: TARGET.messageKind }) }),
  ))
  assert.equal(success.response.status, 200)
  assert.equal(success.body.templateVerified, true)
  assert.equal(preflight.calls.receipt, 1)

  const drift = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
    preflightTemplate: async () => ({ matched: false, code: "template_drift" }),
  })
  const blocked = await json(await createRegistrationCustomerMessageRouteHandlers(drift.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "preflight_template", messageKind: TARGET.messageKind }) }),
  ))
  assert.equal(blocked.response.status, 409)
  assert.equal(drift.calls.receipt, 0)

  const outage = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
    preflightTemplate: async () => ({ matched: false, code: "provider_unavailable" }),
  })
  const unavailable = await json(await createRegistrationCustomerMessageRouteHandlers(outage.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "preflight_template", messageKind: TARGET.messageKind }) }),
  ))
  assert.equal(unavailable.response.status, 503)
  assert.equal(outage.calls.receipt, 0)

  for (const action of [
    { action: "set_activation", messageKind: TARGET.messageKind, mode: "off", requestKey: IDS.request },
    { action: "record_live_test_receipt", messageKind: TARGET.messageKind, messageId: IDS.message, receivedAt: "2026-08-05T00:20:00.000Z", requestKey: IDS.request },
    { action: "release_pre_send", messageId: IDS.message, reason: "확인", requestKey: IDS.request },
    { action: "reconcile", messageId: IDS.message, resolution: "accepted", evidence: { providerMessageId: "provider-message-1", statusCode: "4000", statusMessage: "성공", observedAt: "2026-08-05T00:20:00.000Z", requestKeyMatched: true }, reason: "확인", requestKey: IDS.request },
  ]) {
    const staff = makeDeps()
    const denied = await json(await createRegistrationCustomerMessageRouteHandlers(staff.deps).admin(
      request("/admin", { method: "POST", body: JSON.stringify(action) }),
    ))
    assert.equal(denied.response.status, 403)
    assert.equal(staff.calls.admin, 0)
  }
})

test("admin mutation responses are reduced to action-specific public DTOs", async () => {
  const { deps } = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
    performAdminAction: async () => ({
      messageKind: TARGET.messageKind,
      activationMode: "off",
      updatedAt: "2026-08-05T00:30:00.000Z",
      liveTestRecorded: true,
      providerEvidence: { secret: "must-not-escape" },
    }),
  })
  const result = await json(await createRegistrationCustomerMessageRouteHandlers(deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({
      action: "set_activation",
      messageKind: TARGET.messageKind,
      mode: "off",
      requestKey: IDS.request,
    }) }),
  ))
  assert.equal(result.response.status, 200)
  assert.deepEqual(result.body, {
    ok: true,
    messageKind: TARGET.messageKind,
    activationMode: "off",
    updatedAt: "2026-08-05T00:30:00.000Z",
  })
  assert.equal(JSON.stringify(result.body).includes("secret"), false)
})

test("admin observation readiness refresh is admin-only, parser-strict, and provider-zero", async () => {
  const readiness = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
    async inspectObservationReadiness() {
      readiness.calls.observationReadiness += 1
      return {
        runtimeReady: true,
        settingsEnabled: true,
        leadHours: 3,
        schedule: {
          installed: true,
          active: true,
          contractReady: true,
          vaultReady: true,
          heartbeatCurrent: true,
          lastSucceededAt: "2026-08-12T00:00:00.000Z",
        },
        bookingMode: "off",
        reminderMode: "verification",
        bookingReceipt: false,
        reminderReceipt: false,
        reminderCutoffAt: null,
        observationMessages: 0,
        providerAttemptMarkers: 0,
        pending: 1,
        sourceDirty: 2,
        deliveryUnknown: 3,
        recipientHash: "must-not-escape",
        taskId: IDS.task,
        templateId: "must-not-escape",
        apiSecret: "must-not-escape",
        parentPhone: "01012345678",
      }
    },
  })
  const malformed = await json(await createRegistrationCustomerMessageRouteHandlers(readiness.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "inspect_observation_readiness" }) }),
  ))
  assert.equal(malformed.response.status, 500)
  assert.equal(readiness.calls.observationReadiness, 1)
  assert.equal(readiness.calls.providerSend, 0)

  const admin = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
  })
  const current = await json(await createRegistrationCustomerMessageRouteHandlers(admin.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "inspect_observation_readiness" }) }),
  ))
  assert.equal(current.response.status, 200)
  assert.deepEqual(current.body.schedule, {
    installed: true,
    active: true,
    contractReady: true,
    vaultReady: true,
    heartbeatCurrent: true,
    lastSucceededAt: "2026-08-12T00:00:00.000Z",
  })
  assert.equal(admin.calls.observationReadiness, 1)
  assert.equal(admin.calls.admin, 0)
  assert.equal(admin.calls.providerSend, 0)
  const serialized = JSON.stringify(current.body)
  for (const privateKey of ["recipientHash", "taskId", "templateId", "apiSecret", "parentPhone"]) {
    assert.equal(serialized.includes(privateKey), false)
  }

  const missing = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
    inspectObservationReadiness: async () => ({
      runtimeReady: true,
      settingsEnabled: false,
      leadHours: 3,
      schedule: {
        installed: true,
        active: false,
        contractReady: false,
        vaultReady: false,
        heartbeatCurrent: false,
        lastSucceededAt: null,
      },
      bookingMode: "off",
      reminderMode: "off",
      bookingReceipt: false,
      reminderReceipt: false,
      reminderCutoffAt: null,
      observationMessages: 0,
      providerAttemptMarkers: 0,
      pending: 0,
      sourceDirty: 0,
      deliveryUnknown: 0,
    }),
  })
  const noHeartbeat = await json(await createRegistrationCustomerMessageRouteHandlers(missing.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "inspect_observation_readiness" }) }),
  ))
  assert.equal(noHeartbeat.response.status, 200)
  assert.deepEqual(noHeartbeat.body.schedule, {
    installed: true,
    active: false,
    contractReady: false,
    vaultReady: false,
    heartbeatCurrent: false,
    lastSucceededAt: null,
  })

  const stale = makeDeps({
    authenticate: async () => ({ actorProfileId: IDS.actor, role: "admin", actorClient: {} }),
    inspectObservationReadiness: async () => ({
      runtimeReady: true,
      settingsEnabled: false,
      leadHours: 3,
      schedule: {
        installed: true,
        active: true,
        contractReady: true,
        vaultReady: true,
        heartbeatCurrent: false,
        lastSucceededAt: "2026-08-11T23:00:00.000Z",
      },
      bookingMode: "off",
      reminderMode: "off",
      bookingReceipt: false,
      reminderReceipt: false,
      reminderCutoffAt: null,
      observationMessages: 0,
      providerAttemptMarkers: 0,
      pending: 0,
      sourceDirty: 0,
      deliveryUnknown: 0,
    }),
  })
  const staleHeartbeat = await json(await createRegistrationCustomerMessageRouteHandlers(stale.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "inspect_observation_readiness" }) }),
  ))
  assert.equal(staleHeartbeat.response.status, 200)
  assert.deepEqual(staleHeartbeat.body.schedule, {
    installed: true,
    active: true,
    contractReady: true,
    vaultReady: true,
    heartbeatCurrent: false,
    lastSucceededAt: "2026-08-11T23:00:00.000Z",
  })

  const staff = makeDeps()
  const denied = await json(await createRegistrationCustomerMessageRouteHandlers(staff.deps).admin(
    request("/admin", { method: "POST", body: JSON.stringify({ action: "inspect_observation_readiness" }) }),
  ))
  assert.equal(denied.response.status, 403)
  assert.equal(staff.calls.observationReadiness, 0)
  assert.equal(staff.calls.providerSend, 0)
})
