import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const authModuleUrl = new URL(
  "../src/features/notifications/server/notification-auth.ts",
  import.meta.url,
)
const serviceModuleUrl = new URL(
  "../src/features/notifications/notification-control-plane-service.ts",
  import.meta.url,
)
const cryptoModuleUrl = new URL(
  "../src/features/notifications/server/notification-connection-crypto.ts",
  import.meta.url,
)
const repositoryModuleUrl = new URL(
  "../src/features/notifications/server/notification-connection-repository.ts",
  import.meta.url,
)
const legacyConnectionModuleUrl = new URL(
  "../src/features/notifications/server/legacy-google-chat-connection.ts",
  import.meta.url,
)
const controlPlaneRouteUrl = new URL(
  "../src/features/notifications/server/notification-control-plane-route.ts",
  import.meta.url,
)
const connectionsRouteUrl = new URL(
  "../src/features/notifications/server/notification-connections-route.ts",
  import.meta.url,
)
const legacyGoogleChatRouteUrl = new URL(
  "../src/app/api/google-chat/route.ts",
  import.meta.url,
)
const registrationConsultationNotificationRouteUrl = new URL(
  "../src/app/api/registration/consultation-notification/route.ts",
  import.meta.url,
)
const backfillModuleUrl = new URL(
  "../scripts/backfill-google-chat-webhook-encryption.mjs",
  import.meta.url,
)
const settingsMigrationUrl = new URL(
  "../supabase/migrations/20260716111000_notification_control_plane_settings_rpc.sql",
  import.meta.url,
)
const deferredDeliveryRouteUrl = new URL(
  "../src/app/api/notifications/deliveries/[deliveryId]/route.ts",
  import.meta.url,
)

const ADMIN_ID = "30000000-0000-4000-8000-000000000001"
const STAFF_ID = "30000000-0000-4000-8000-000000000002"
const RULE_ID = "30000000-0000-4000-8000-000000000101"
const REQUEST_ID = "30000000-0000-4000-8000-000000000201"
const BIG_REVISION = "9007199254740997"
const NEXT_BIG_REVISION = "9007199254740998"
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
const OTHER_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64")
const GOOGLE_CHAT_URL =
  "https://chat.googleapis.com/v1/spaces/SPACEIDENTIFIER123456/messages?key=key-secret&token=token-secret"
const SECOND_GOOGLE_CHAT_URL =
  "https://chat.googleapis.com/v1/spaces/SECONDSPACE654321/messages?key=second-key&token=second-token"

const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  throw new Error("UNEXPECTED_REAL_NETWORK_CALL")
}
test.after(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function jsonRequest(url, method, body, token = "session-token") {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function createWireSnapshot(overrides = {}) {
  return {
    scope_key: "global",
    workflow_key: "tasks",
    rules: [
      {
        id: RULE_ID,
        workflow_key: "tasks",
        event_key: "task.created",
        event_label: "할 일 생성",
        group_label: "할 일",
        trigger_description: "할 일이 생성되면",
        sort_order: 10,
        audience_key: "management_team",
        audience_label: "관리팀",
        channel_key: "google_chat",
        channel_label: "Google Chat",
        connection_key: "google_chat.management",
        rule_variant_key: "immediate",
        delivery_mode: "immediate",
        schedule_key: null,
        schedule_config: null,
        enabled: false,
        active_template_id: "30000000-0000-4000-8000-000000000102",
        revision: BIG_REVISION,
        updated_at: "2026-07-17T00:00:00.000Z",
        template: {
          id: "30000000-0000-4000-8000-000000000102",
          rule_id: RULE_ID,
          version: BIG_REVISION,
          title_template: "새 할 일",
          body_template: "새 할 일이 등록되었습니다.",
          allowed_variables: [],
          payload_schema_version: 1,
          checksum: "fixture-checksum",
        },
      },
    ],
    connections: [
      {
        connection_key: "google_chat.management",
        connection_state: "encrypted_active",
        revision: BIG_REVISION,
        webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
        last_verified_at: null,
        last_error_code: null,
        editable: true,
      },
    ],
    delivery_summary: {
      pending_count: 0,
      sent_count: 0,
      failed_count: 0,
      unknown_count: 0,
      latest_delivery_at: null,
    },
    loaded_at: "2026-07-17T00:00:00.000Z",
    ...overrides,
  }
}

function makeAuthClient({ userId = ADMIN_ID, role = "admin", userError = null, roleError = null } = {}) {
  const calls = []
  return {
    calls,
    auth: {
      async getUser(token) {
        calls.push(["getUser", token])
        return userError
          ? { data: { user: null }, error: userError }
          : { data: { user: { id: userId } }, error: null }
      },
    },
    async rpc(name, parameters) {
      calls.push(["rpc", name, parameters])
      assert.equal(name, "current_dashboard_role")
      return roleError
        ? { data: null, error: roleError }
        : { data: role, error: null }
    },
  }
}

function expectHttpError(status, code) {
  return (error) => {
    assert.equal(error?.status, status)
    assert.equal(error?.code, code)
    return true
  }
}

function makeConnectionRow(overrides = {}) {
  return {
    channel: "admin",
    webhook_url: GOOGLE_CHAT_URL,
    webhook_url_ciphertext: null,
    webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    connection_state: "legacy_active",
    revision: BIG_REVISION,
    updated_by: ADMIN_ID,
    last_verified_at: null,
    last_error_code: null,
    ...overrides,
  }
}

function clone(value) {
  return structuredClone(value)
}

async function readOptionalSource(url) {
  try {
    return await readFile(url, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
  }
}

function createConnectionStore(initialRows) {
  const rows = new Map(initialRows.map((row) => [row.channel, clone(row)]))
  const calls = []
  const ledger = new Map()

  function mutationError(code) {
    return Object.assign(new Error(code), { code, status: 409 })
  }

  function fingerprint(operation, input) {
    return JSON.stringify({
      operation,
      channel: input.channel,
      expectedRevision: input.expectedRevision,
      actorUserId: input.actorUserId,
      webhookUrl: input.webhookUrl,
      webhookUrlMask: input.webhookUrlMask,
    })
  }

  function beginMutation(operation, input) {
    const requestFingerprint = fingerprint(operation, input)
    const existing = ledger.get(input.requestId)
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw mutationError("idempotency_key_reused")
      }
      return { existing, requestFingerprint, current: rows.get(input.channel) }
    }
    const current = rows.get(input.channel)
    if (!current || String(current.revision) !== input.expectedRevision) {
      throw mutationError("notification_connection_revision_conflict")
    }
    return { existing: null, requestFingerprint, current }
  }

  return {
    calls,
    rows,
    ledger,
    async listRows() {
      calls.push({ operation: "listRows" })
      return Array.from(rows.values(), clone)
    },
    async getRow(channel, actor) {
      calls.push({
        operation: "getRow",
        channel,
        actor: actor === undefined ? undefined : clone(actor),
      })
      return rows.has(channel) ? clone(rows.get(channel)) : null
    },
    async replaceAtomic(input) {
      calls.push({ operation: "replaceAtomic", input: clone(input) })
      const { existing, requestFingerprint, current } = beginMutation("replace", input)
      if (existing?.state === "completed") return clone(existing.response)
      const next = {
        ...current,
        webhook_url: input.webhookUrl,
        webhook_url_ciphertext: input.webhookUrlCiphertext,
        webhook_url_mask: input.webhookUrlMask,
        connection_state: "encrypted_active",
        revision: (BigInt(current.revision) + 1n).toString(),
        last_verified_at: null,
        last_error_code: null,
      }
      rows.set(input.channel, next)
      ledger.set(input.requestId, {
        state: "completed",
        fingerprint: requestFingerprint,
        response: clone(next),
      })
      return clone(next)
    },
    async disconnectAtomic(input) {
      calls.push({ operation: "disconnectAtomic", input: clone(input) })
      const { existing, requestFingerprint, current } = beginMutation("disconnect", input)
      if (existing?.state === "completed") return clone(existing.response)
      const next = {
        ...current,
        webhook_url: "",
        webhook_url_ciphertext: null,
        webhook_url_mask: null,
        connection_state: "disconnected",
        revision: (BigInt(current.revision) + 1n).toString(),
        last_verified_at: null,
        last_error_code: null,
      }
      rows.set(input.channel, next)
      ledger.set(input.requestId, {
        state: "completed",
        fingerprint: requestFingerprint,
        response: clone(next),
      })
      return clone(next)
    },
    async beginVerificationAtomic(input) {
      calls.push({ operation: "beginVerificationAtomic", input: clone(input) })
      const { existing, requestFingerprint, current } = beginMutation("verify", input)
      if (existing?.state === "completed") {
        return { shouldSend: false, pending: false, row: clone(existing.response) }
      }
      if (existing?.state === "reserved") {
        return { shouldSend: false, pending: true, row: null }
      }
      ledger.set(input.requestId, {
        state: "reserved",
        fingerprint: requestFingerprint,
        response: null,
      })
      return { shouldSend: true, pending: false, row: clone(current) }
    },
    async recordVerificationAtomic(input) {
      calls.push({ operation: "recordVerificationAtomic", input: clone(input) })
      const existing = ledger.get(input.requestId)
      if (!existing || existing.fingerprint !== fingerprint("verify", input)) {
        throw mutationError("idempotency_key_reused")
      }
      const current = rows.get(input.channel)
      if (!current || String(current.revision) !== input.expectedRevision) {
        throw mutationError("notification_connection_revision_conflict")
      }
      const next = {
        ...current,
        revision: (BigInt(current.revision) + 1n).toString(),
        last_verified_at: input.verifiedAt,
        last_error_code: input.succeeded ? null : input.resultCode,
      }
      rows.set(input.channel, next)
      const response = input.resultCode === "configuration_error"
        ? {
            connectionKey: "google_chat.management",
            connectionState: next.connection_state,
            revision: next.revision,
            configured: next.connection_state !== "disconnected",
            webhookUrlMask: next.webhook_url_mask,
            lastVerifiedAt: next.last_verified_at,
            lastErrorCode: next.last_error_code,
            editable: true,
          }
        : clone(next)
      ledger.set(input.requestId, {
        ...existing,
        state: "completed",
        response: clone(response),
      })
      return clone(response)
    },
  }
}

test("auth rejects missing or malformed Bearer credentials before creating a Supabase client", async () => {
  const { authenticateNotificationRequest } = await import(authModuleUrl)
  let createCalls = 0
  const dependencies = {
    createAuthenticatedClient() {
      createCalls += 1
      return makeAuthClient()
    },
  }

  await assert.rejects(
    authenticateNotificationRequest(new Request("http://localhost/api"), dependencies),
    expectHttpError(401, "notification_unauthorized"),
  )
  await assert.rejects(
    authenticateNotificationRequest(new Request("http://localhost/api", {
      headers: { Authorization: "Basic not-a-bearer-token" },
    }), dependencies),
    expectHttpError(401, "notification_unauthorized"),
  )
  assert.equal(createCalls, 0)
})

test("auth validates the user with the bearer client and accepts only exact dashboard roles", async () => {
  const {
    authenticateNotificationRequest,
    requireNotificationRole,
  } = await import(authModuleUrl)
  const client = makeAuthClient({ userId: STAFF_ID, role: "staff" })
  let receivedToken = ""
  const context = await authenticateNotificationRequest(
    new Request("http://localhost/api", {
      headers: { Authorization: "Bearer exact-session-token" },
    }),
    {
      createAuthenticatedClient(token) {
        receivedToken = token
        return client
      },
    },
  )

  assert.equal(receivedToken, "exact-session-token")
  assert.deepEqual(context, { userId: STAFF_ID, role: "staff", client })
  assert.deepEqual(client.calls, [
    ["getUser", "exact-session-token"],
    ["rpc", "current_dashboard_role", undefined],
  ])
  assert.equal(requireNotificationRole(context, ["admin", "staff"]), context)
  assert.throws(
    () => requireNotificationRole({ ...context, role: "viewer" }, ["admin", "staff"]),
    expectHttpError(403, "notification_forbidden"),
  )
  assert.throws(
    () => requireNotificationRole({ ...context, role: "super_admin" }, ["admin", "staff"]),
    expectHttpError(403, "notification_forbidden"),
  )
})

test("auth fails closed when getUser or the authoritative role RPC fails", async () => {
  const { authenticateNotificationRequest } = await import(authModuleUrl)
  const request = new Request("http://localhost/api", {
    headers: { Authorization: "Bearer session-token" },
  })

  await assert.rejects(
    authenticateNotificationRequest(request, {
      createAuthenticatedClient: () => makeAuthClient({ userError: new Error("invalid jwt") }),
    }),
    expectHttpError(401, "notification_unauthorized"),
  )
  await assert.rejects(
    authenticateNotificationRequest(request, {
      createAuthenticatedClient: () => makeAuthClient({ roleError: new Error("role lookup failed") }),
    }),
    expectHttpError(503, "notification_auth_unavailable"),
  )
})

test("browser service maps one snake_case snapshot and preserves bigint revisions as strings", async () => {
  const { createNotificationControlPlaneService } = await import(serviceModuleUrl)
  const requests = []
  const service = createNotificationControlPlaneService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return jsonResponse(createWireSnapshot())
    },
  })

  const snapshot = await service.getControlPlane({ workflowKey: "tasks" })
  assert.equal(requests.length, 1)
  assert.equal(new URL(requests[0].url).pathname, "/api/notifications/control-plane")
  assert.equal(new URL(requests[0].url).searchParams.get("workflow_key"), "tasks")
  assert.equal(requests[0].init.headers.Authorization, "Bearer session-token")
  assert.equal(snapshot.workflowKey, "tasks")
  assert.equal(snapshot.rules[0].revision, BIG_REVISION)
  assert.equal(snapshot.rules[0].template.version, BIG_REVISION)
  assert.equal(snapshot.connections[0].revision, BIG_REVISION)
  assert.equal(typeof snapshot.rules[0].revision, "string")
  assert.equal("workflow_key" in snapshot, false)
})

test("browser service emits only the strict snake_case save wire contract", async () => {
  const { createNotificationControlPlaneService } = await import(serviceModuleUrl)
  let sentBody = null
  const service = createNotificationControlPlaneService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async (_url, init) => {
      sentBody = JSON.parse(init.body)
      return jsonResponse({
        ...createWireSnapshot(),
        reconciliation_job: {
          job_kind: "rule_reconciliation",
          job_id: "30000000-0000-4000-8000-000000000301",
          status: "pending",
          attempt_count: 0,
        },
      })
    },
  })

  const result = await service.saveControlPlane({
    workflowKey: "tasks",
    expectedRevisions: { [RULE_ID]: BIG_REVISION },
    patch: {
      rules: {
        [RULE_ID]: {
          enabled: true,
          titleTemplate: "바뀐 제목",
          bodyTemplate: "바뀐 본문",
          scheduleConfig: null,
        },
      },
    },
    requestId: REQUEST_ID,
  })

  assert.deepEqual(Object.keys(sentBody).sort(), [
    "expected_revisions",
    "patch",
    "request_id",
    "workflow_key",
  ])
  assert.equal(sentBody.workflow_key, "tasks")
  assert.equal(sentBody.expected_revisions[RULE_ID], BIG_REVISION)
  assert.deepEqual(sentBody.patch.rules[RULE_ID], {
    enabled: true,
    title_template: "바뀐 제목",
    body_template: "바뀐 본문",
    schedule_config: null,
  })
  assert.equal("titleTemplate" in sentBody.patch.rules[RULE_ID], false)
  assert.equal(result.reconciliationJob.jobKind, "rule_reconciliation")
  assert.equal(result.reconciliationJob.attemptCount, 0)
})

test("browser service treats a committed no-op save as success without inventing a reconciliation job", async () => {
  const { createNotificationControlPlaneService } = await import(serviceModuleUrl)
  const service = createNotificationControlPlaneService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async () => jsonResponse(createWireSnapshot()),
  })

  const result = await service.saveControlPlane({
    workflowKey: "tasks",
    expectedRevisions: { [RULE_ID]: BIG_REVISION },
    patch: { rules: { [RULE_ID]: { enabled: false } } },
    requestId: "30000000-0000-4000-8000-000000000202",
  })

  assert.equal(result.workflowKey, "tasks")
  assert.equal(result.reconciliationJob, null)
})

test("browser service maps revision conflicts without losing the current safe snapshot", async () => {
  const { createNotificationControlPlaneService } = await import(serviceModuleUrl)
  const service = createNotificationControlPlaneService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async () => jsonResponse({
      ok: false,
      code: "notification_revision_conflict",
      current_snapshot: createWireSnapshot(),
      current_revisions: { [RULE_ID]: NEXT_BIG_REVISION },
    }, 409),
  })

  await assert.rejects(
    service.saveControlPlane({
      workflowKey: "tasks",
      expectedRevisions: { [RULE_ID]: BIG_REVISION },
      patch: { rules: { [RULE_ID]: { enabled: true } } },
      requestId: REQUEST_ID,
    }),
    (error) => {
      assert.equal(error.code, "notification_revision_conflict")
      assert.equal(error.status, 409)
      assert.equal(error.currentSnapshot.workflowKey, "tasks")
      assert.equal(error.currentSnapshot.rules[0].revision, BIG_REVISION)
      assert.equal(error.currentRevisions[RULE_ID], NEXT_BIG_REVISION)
      return true
    },
  )
})

test("browser service rejects a snapshot containing a plaintext or ciphertext connection secret", async () => {
  const { createNotificationControlPlaneService } = await import(serviceModuleUrl)
  for (const unsafeField of ["webhook_url", "webhook_url_ciphertext"]) {
    const unsafeSnapshot = createWireSnapshot()
    unsafeSnapshot.connections[0][unsafeField] = GOOGLE_CHAT_URL
    const service = createNotificationControlPlaneService({
      baseUrl: "http://localhost",
      getAccessToken: async () => "session-token",
      fetch: async () => jsonResponse(unsafeSnapshot),
    })
    await assert.rejects(
      service.getControlPlane({ workflowKey: "tasks" }),
      (error) => {
        assert.equal(error.code, "notification_unsafe_response")
        assert.doesNotMatch(String(error.message), /key-secret|token-secret/)
        return true
      },
    )
  }
})

test("browser service rejects connection result codes outside the closed registry", async () => {
  const { createNotificationControlPlaneService } = await import(serviceModuleUrl)
  const unsafeSnapshot = createWireSnapshot()
  unsafeSnapshot.connections[0].last_error_code = "provider_body_key-secret"
  const service = createNotificationControlPlaneService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async () => jsonResponse(unsafeSnapshot),
  })

  await assert.rejects(service.getControlPlane({ workflowKey: "tasks" }), (error) => {
    assert.equal(error.code, "notification_unsafe_response")
    assert.doesNotMatch(String(error.message), /key-secret/)
    return true
  })
})

test("control-plane route accepts only the exact workflow query and admin/staff roles", async () => {
  const { createNotificationControlPlaneRouteHandlers } = await import(controlPlaneRouteUrl)
  const calls = []
  const authenticatedRequests = []
  const handlers = createNotificationControlPlaneRouteHandlers({
    authenticate: async (request) => {
      authenticatedRequests.push(request)
      return { userId: STAFF_ID, role: "staff", client: { id: "caller-client" } }
    },
    getControlPlane: async (input) => {
      calls.push(input)
      return createWireSnapshot()
    },
    saveControlPlane: async () => {
      throw new Error("save should not run")
    },
  })

  const validRequest = new Request(
    "http://localhost/api/notifications/control-plane?workflow_key=tasks",
    { headers: { Authorization: "Bearer session-token" } },
  )
  const response = await handlers.get(validRequest)
  assert.equal(response.status, 200)
  assert.equal(
    authenticatedRequests[0],
    validRequest,
    "handler must authenticate the actual Request object",
  )
  assert.equal((await response.json()).workflow_key, "tasks")
  assert.deepEqual(calls, [{ workflowKey: "tasks", client: { id: "caller-client" } }])

  const extraRequest = new Request(
    "http://localhost/api/notifications/control-plane?workflow_key=tasks&table=notification_rules",
  )
  const unknownRequest = new Request(
    "http://localhost/api/notifications/control-plane?workflow_key=unknown",
  )
  const extra = await handlers.get(extraRequest)
  const unknown = await handlers.get(unknownRequest)
  assert.equal(extra.status, 400)
  assert.equal(unknown.status, 400)
  assert.equal(authenticatedRequests[1], extraRequest, "authentication precedes query validation")
  assert.equal(authenticatedRequests[2], unknownRequest, "authentication precedes workflow validation")
  assert.equal(calls.length, 1)
})

test("control-plane route preserves the closed configuration error without exposing a secret", async () => {
  const { createNotificationControlPlaneRouteHandlers } = await import(controlPlaneRouteUrl)
  const snapshot = createWireSnapshot()
  snapshot.connections[0].last_error_code = "configuration_error"
  const handlers = createNotificationControlPlaneRouteHandlers({
    authenticate: async () => ({ userId: ADMIN_ID, role: "admin", client: {} }),
    getControlPlane: async () => snapshot,
    saveControlPlane: async () => snapshot,
  })

  const response = await handlers.get(new Request(
    "http://localhost/api/notifications/control-plane?workflow_key=tasks",
  ))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.connections[0].last_error_code, "configuration_error")
  assert.doesNotMatch(JSON.stringify(payload), /key-secret|token-secret|webhook_url_ciphertext/)
})

test("control-plane route rejects ordinary users and strict-save payload violations before RPC work", async () => {
  const { createNotificationControlPlaneRouteHandlers } = await import(controlPlaneRouteUrl)
  let saveCalls = 0
  const makeHandlers = (role) => createNotificationControlPlaneRouteHandlers({
    authenticate: async () => ({ userId: ADMIN_ID, role, client: {} }),
    getControlPlane: async () => createWireSnapshot(),
    saveControlPlane: async () => {
      saveCalls += 1
      return createWireSnapshot()
    },
  })

  const viewerResponse = await makeHandlers("viewer").patch(jsonRequest(
    "http://localhost/api/notifications/control-plane",
    "PATCH",
    {
      workflow_key: "tasks",
      expected_revisions: { [RULE_ID]: BIG_REVISION },
      patch: { rules: { [RULE_ID]: { enabled: true } } },
      request_id: REQUEST_ID,
    },
  ))
  assert.equal(viewerResponse.status, 403)

  const invalidBodies = [
    {
      workflowKey: "tasks",
      expectedRevisions: { [RULE_ID]: BIG_REVISION },
      patch: { rules: {} },
      requestId: REQUEST_ID,
    },
    {
      workflow_key: "tasks",
      expected_revisions: { [RULE_ID]: Number(BIG_REVISION) },
      patch: { rules: {} },
      request_id: REQUEST_ID,
    },
    {
      workflow_key: "tasks",
      expected_revisions: { [RULE_ID]: BIG_REVISION },
      patch: { rules: { [RULE_ID]: { enabled: true, webhook_url: GOOGLE_CHAT_URL } } },
      request_id: REQUEST_ID,
    },
    {
      workflow_key: "tasks",
      expected_revisions: { [RULE_ID]: BIG_REVISION },
      patch: { rules: {} },
      request_id: REQUEST_ID,
      table_name: "dashboard_private.notification_rules",
    },
  ]
  for (const body of invalidBodies) {
    const response = await makeHandlers("admin").patch(jsonRequest(
      "http://localhost/api/notifications/control-plane",
      "PATCH",
      body,
    ))
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  assert.equal(saveCalls, 0)
})

test("control-plane route forwards one strict save and returns a safe 409 snapshot on conflict", async () => {
  const { createNotificationControlPlaneRouteHandlers } = await import(controlPlaneRouteUrl)
  const calls = []
  let authenticatedRequest = null
  const handlers = createNotificationControlPlaneRouteHandlers({
    authenticate: async (request) => {
      authenticatedRequest = request
      return { userId: ADMIN_ID, role: "admin", client: { id: "caller" } }
    },
    getControlPlane: async () => createWireSnapshot(),
    saveControlPlane: async (input) => {
      calls.push(input)
      const error = new Error("stale")
      error.code = "notification_revision_conflict"
      error.currentSnapshot = createWireSnapshot()
      error.currentRevisions = { [RULE_ID]: NEXT_BIG_REVISION }
      throw error
    },
  })

  const patchRequest = jsonRequest(
    "http://localhost/api/notifications/control-plane",
    "PATCH",
    {
      workflow_key: "tasks",
      expected_revisions: { [RULE_ID]: BIG_REVISION },
      patch: { rules: { [RULE_ID]: { enabled: true, title_template: "새 제목" } } },
      request_id: REQUEST_ID,
    },
  )
  const response = await handlers.patch(patchRequest)
  assert.equal(response.status, 409)
  assert.equal(authenticatedRequest, patchRequest, "PATCH must authenticate the actual Request")
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    workflowKey: "tasks",
    expectedRevisions: { [RULE_ID]: BIG_REVISION },
    patch: { rules: { [RULE_ID]: { enabled: true, title_template: "새 제목" } } },
    requestId: REQUEST_ID,
    client: { id: "caller" },
  })
  const payload = await response.json()
  assert.equal(payload.code, "notification_revision_conflict")
  assert.equal(payload.current_snapshot.workflow_key, "tasks")
  assert.equal(payload.current_revisions[RULE_ID], NEXT_BIG_REVISION)
  assert.doesNotMatch(JSON.stringify(payload), /key-secret|token-secret|webhook_url_ciphertext/)
})

test("AES-256-GCM connection envelopes round-trip and reject wrong keys or tampering", async () => {
  const {
    decodeNotificationConnectionEncryptionKey,
    decryptNotificationConnectionSecret,
    encryptNotificationConnectionSecret,
  } = await import(cryptoModuleUrl)
  const key = decodeNotificationConnectionEncryptionKey(ENCRYPTION_KEY)
  assert.equal(key.byteLength, 32)
  assert.throws(() => decodeNotificationConnectionEncryptionKey(Buffer.alloc(31).toString("base64")))

  const envelope = encryptNotificationConnectionSecret(GOOGLE_CHAT_URL, key)
  assert.match(envelope, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(envelope, /chat\.googleapis\.com|key-secret|token-secret/)
  assert.equal(decryptNotificationConnectionSecret(envelope, key), GOOGLE_CHAT_URL)

  const parts = envelope.split(":")
  const last = parts[3].at(-1)
  parts[3] = `${parts[3].slice(0, -1)}${last === "A" ? "B" : "A"}`
  assert.throws(() => decryptNotificationConnectionSecret(parts.join(":"), key))
  assert.throws(() => decryptNotificationConnectionSecret(
    envelope,
    decodeNotificationConnectionEncryptionKey(OTHER_ENCRYPTION_KEY),
  ))
  assert.throws(() => decryptNotificationConnectionSecret(envelope.replace(/^v1:/, "v2:"), key))
})

test("Google Chat URL validation is exact and masks every credential", async () => {
  const {
    isAllowedGoogleChatWebhookUrl,
    maskGoogleChatWebhookUrl,
  } = await import(cryptoModuleUrl)
  assert.equal(isAllowedGoogleChatWebhookUrl(GOOGLE_CHAT_URL), true)
  for (const invalid of [
    GOOGLE_CHAT_URL.replace("https://", "http://"),
    GOOGLE_CHAT_URL.replace("chat.googleapis.com", "chat.googleapis.com.attacker.invalid"),
    GOOGLE_CHAT_URL.replace("/v1/spaces/", "/v2/spaces/"),
    GOOGLE_CHAT_URL.replace("/messages", "/members"),
    GOOGLE_CHAT_URL.replace("?key=", "?extra=x&key="),
    "https://user:password@chat.googleapis.com/v1/spaces/SPACE/messages?key=x&token=y",
    "https://chat.googleapis.com/v1/spaces/SPACE/messages?key=x&token=y#fragment",
  ]) {
    assert.equal(isAllowedGoogleChatWebhookUrl(invalid), false, invalid)
  }

  const mask = maskGoogleChatWebhookUrl(GOOGLE_CHAT_URL)
  assert.match(mask, /^chat\.googleapis\.com\//)
  assert.doesNotMatch(mask, /SPACEIDENTIFIER123456|key-secret|token-secret|\?key=|token=/)
})

test("legacy Google Chat readers never revive a disconnected database row from an environment fallback", async () => {
  const { readLegacyGoogleChatWebhookUrl } = await import(legacyConnectionModuleUrl)
  const environmentUrl = SECOND_GOOGLE_CHAT_URL

  assert.equal(await readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: environmentUrl,
    loadRow: async () => ({
      found: true,
      connectionState: "disconnected",
      webhookUrl: "",
    }),
  }), "")
  assert.equal(await readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: environmentUrl,
    loadRow: async () => ({
      found: true,
      connectionState: "encrypted_active",
      webhookUrl: GOOGLE_CHAT_URL,
    }),
  }), GOOGLE_CHAT_URL)
  assert.equal(await readLegacyGoogleChatWebhookUrl({
    legacyEnvironmentUrl: environmentUrl,
    loadRow: async () => ({
      found: false,
      connectionState: null,
      webhookUrl: null,
    }),
  }), environmentUrl)

  const [legacyRoute, registrationRoute] = await Promise.all([
    readFile(legacyGoogleChatRouteUrl, "utf8"),
    readFile(registrationConsultationNotificationRouteUrl, "utf8"),
  ])
  for (const source of [legacyRoute, registrationRoute]) {
    assert.match(source, /readLegacyGoogleChatWebhookUrl/)
    assert.match(source, /webhook_url,connection_state/)
  }
})

test("connection repository returns masked DTOs and never exposes either stored secret column", async () => {
  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  const { encryptNotificationConnectionSecret, decodeNotificationConnectionEncryptionKey } = await import(cryptoModuleUrl)
  const ciphertext = encryptNotificationConnectionSecret(
    SECOND_GOOGLE_CHAT_URL,
    decodeNotificationConnectionEncryptionKey(ENCRYPTION_KEY),
  )
  const store = createConnectionStore([
    makeConnectionRow({ webhook_url_mask: GOOGLE_CHAT_URL }),
    makeConnectionRow({
      channel: "executive",
      webhook_url: "legacy-value-that-must-not-win",
      webhook_url_ciphertext: ciphertext,
      webhook_url_mask: SECOND_GOOGLE_CHAT_URL,
      connection_state: "encrypted_active",
    }),
    makeConnectionRow({
      channel: "math",
      webhook_url: GOOGLE_CHAT_URL,
      webhook_url_ciphertext: ciphertext,
      webhook_url_mask: null,
      connection_state: "disconnected",
    }),
  ])
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async () => {
      throw new Error("list must not verify")
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  const result = await repository.listConnections()
  assert.deepEqual(result.map((entry) => [entry.connectionKey, entry.connectionState]), [
    ["google_chat.management", "legacy_active"],
    ["google_chat.executive", "encrypted_active"],
    ["google_chat.math", "disconnected"],
  ])
  assert.equal(result[2].configured, false)
  assert.doesNotMatch(
    JSON.stringify(result),
    /key-secret|token-secret|second-key|second-token|webhook_url_ciphertext|legacy-value-that-must-not-win/,
  )
})

test("connection replace dual-writes legacy plaintext and ciphertext atomically without verification", async () => {
  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  const {
    decodeNotificationConnectionEncryptionKey,
    decryptNotificationConnectionSecret,
  } = await import(cryptoModuleUrl)
  const store = createConnectionStore([makeConnectionRow()])
  const actorClient = { id: "admin-authenticated-client" }
  let providerCalls = 0
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async () => {
      providerCalls += 1
      return { succeeded: true, resultCode: "accepted" }
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  const result = await repository.replaceConnection({
    connectionKey: "google_chat.management",
    webhookUrl: SECOND_GOOGLE_CHAT_URL,
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  const mutation = store.calls.find((call) => call.operation === "replaceAtomic").input
  assert.equal(mutation.channel, "admin")
  assert.equal(mutation.webhookUrl, SECOND_GOOGLE_CHAT_URL)
  assert.equal(mutation.expectedRevision, BIG_REVISION)
  assert.equal(mutation.requestId, REQUEST_ID)
  assert.equal(mutation.actorUserId, ADMIN_ID)
  assert.deepEqual(mutation.actorClient, actorClient)
  assert.match(mutation.webhookUrlCiphertext, /^v1:/)
  assert.equal(
    decryptNotificationConnectionSecret(
      mutation.webhookUrlCiphertext,
      decodeNotificationConnectionEncryptionKey(ENCRYPTION_KEY),
    ),
    SECOND_GOOGLE_CHAT_URL,
  )
  assert.doesNotMatch(mutation.webhookUrlMask, /second-key|second-token|SECONDSPACE654321/)
  assert.equal(result.connectionState, "encrypted_active")
  assert.equal(result.revision, NEXT_BIG_REVISION)
  assert.equal(providerCalls, 0)
  assert.doesNotMatch(JSON.stringify(result), /second-key|second-token|webhookUrlCiphertext/)

  const replay = await repository.replaceConnection({
    connectionKey: "google_chat.management",
    webhookUrl: SECOND_GOOGLE_CHAT_URL,
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  assert.deepEqual(replay, result)
  const replaceCalls = store.calls.filter((call) => call.operation === "replaceAtomic")
  assert.equal(replaceCalls.length, 2)
  assert.notEqual(
    replaceCalls[0].input.webhookUrlCiphertext,
    replaceCalls[1].input.webhookUrlCiphertext,
    "randomized AES envelopes may differ without changing the logical request fingerprint",
  )
})

test("connection disconnect blanks legacy plaintext, clears ciphertext, and cannot call a provider", async () => {
  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  const store = createConnectionStore([makeConnectionRow({ connection_state: "encrypted_active" })])
  const actorClient = { id: "admin-authenticated-client" }
  let providerCalls = 0
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async () => {
      providerCalls += 1
      return { succeeded: true, resultCode: "accepted" }
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  const result = await repository.disconnectConnection({
    connectionKey: "google_chat.management",
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  const stored = store.rows.get("admin")
  assert.equal(stored.connection_state, "disconnected")
  assert.equal(stored.webhook_url, "")
  assert.equal(stored.webhook_url_ciphertext, null)
  assert.equal(stored.webhook_url_mask, null)
  assert.equal(result.configured, false)
  assert.equal(providerCalls, 0)
  const mutation = store.calls.find((call) => call.operation === "disconnectAtomic").input
  assert.equal(mutation.actorUserId, ADMIN_ID)
  assert.deepEqual(mutation.actorClient, actorClient)
})

test("connection stale revisions fail before every mutation and before verification provider work", async () => {
  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  const actorClient = { id: "admin-authenticated-client" }
  const store = createConnectionStore([makeConnectionRow()])
  const initialRow = clone(store.rows.get("admin"))
  let providerCalls = 0
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async () => {
      providerCalls += 1
      return { succeeded: true, resultCode: "accepted" }
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })
  const staleRevision = "1"
  const common = { actorUserId: ADMIN_ID, actorClient, expectedRevision: staleRevision }

  for (const operation of [
    () => repository.replaceConnection({
      ...common,
      connectionKey: "google_chat.management",
      webhookUrl: SECOND_GOOGLE_CHAT_URL,
      requestId: "30000000-0000-4000-8000-000000000231",
    }),
    () => repository.disconnectConnection({
      ...common,
      connectionKey: "google_chat.management",
      requestId: "30000000-0000-4000-8000-000000000232",
    }),
    () => repository.verifyConnection({
      ...common,
      connectionKey: "google_chat.management",
      requestId: "30000000-0000-4000-8000-000000000233",
      confirmed: true,
    }),
  ]) {
    await assert.rejects(operation(), (error) => {
      assert.equal(error.code, "notification_connection_revision_conflict")
      assert.equal(error.status, 409)
      return true
    })
  }

  assert.deepEqual(store.rows.get("admin"), initialRow)
  assert.equal(providerCalls, 0)
  assert.equal(
    store.calls.some((call) => call.operation === "recordVerificationAtomic"),
    false,
  )
})

test("verification requires a fresh confirmation and uses one fixed non-business message", async () => {
  const {
    GOOGLE_CHAT_CONNECTION_TEST_MESSAGE,
    createNotificationConnectionRepository,
  } = await import(repositoryModuleUrl)
  const store = createConnectionStore([makeConnectionRow()])
  const actorClient = { id: "admin-authenticated-client" }
  const providerCalls = []
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async (input) => {
      providerCalls.push(clone(input))
      return { succeeded: true, resultCode: "accepted" }
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  await assert.rejects(repository.verifyConnection({
    connectionKey: "google_chat.management",
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    confirmed: false,
    actorUserId: ADMIN_ID,
    actorClient,
  }))
  assert.equal(providerCalls.length, 0)

  const result = await repository.verifyConnection({
    connectionKey: "google_chat.management",
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    confirmed: true,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  assert.equal(providerCalls.length, 1)
  assert.deepEqual(providerCalls[0], {
    webhookUrl: GOOGLE_CHAT_URL,
    text: GOOGLE_CHAT_CONNECTION_TEST_MESSAGE,
  })
  assert.equal(typeof GOOGLE_CHAT_CONNECTION_TEST_MESSAGE, "string")
  assert.match(GOOGLE_CHAT_CONNECTION_TEST_MESSAGE, /테스트/)
  assert.doesNotMatch(GOOGLE_CHAT_CONNECTION_TEST_MESSAGE, /학생|학부모|전화|업무|key-secret/)
  assert.equal(result.lastErrorCode, null)

  const replay = await repository.verifyConnection({
    connectionKey: "google_chat.management",
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    confirmed: true,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  assert.deepEqual(replay, result)
  assert.equal(providerCalls.length, 1, "same verification request must never send twice")
  await assert.rejects(
    repository.verifyConnection({
      connectionKey: "google_chat.management",
      expectedRevision: NEXT_BIG_REVISION,
      requestId: REQUEST_ID,
      confirmed: true,
      actorUserId: ADMIN_ID,
      actorClient,
    }),
    (error) => {
      assert.equal(error.code, "idempotency_key_reused")
      return true
    },
  )
  assert.equal(providerCalls.length, 1, "changed-fingerprint replay must fail before provider work")
  const record = store.calls.find((call) => call.operation === "recordVerificationAtomic").input
  assert.deepEqual(record, {
    channel: "admin",
    succeeded: true,
    resultCode: "accepted",
    verifiedAt: "2026-07-17T01:00:00.000Z",
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  const reservation = store.calls.find((call) => call.operation === "beginVerificationAtomic").input
  assert.equal(reservation.actorUserId, ADMIN_ID)
  assert.deepEqual(reservation.actorClient, actorClient)
})

test("verification resolves legacy plaintext, encrypted ciphertext, and ignores both when disconnected", async () => {
  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  const {
    decodeNotificationConnectionEncryptionKey,
    encryptNotificationConnectionSecret,
  } = await import(cryptoModuleUrl)
  const ciphertext = encryptNotificationConnectionSecret(
    SECOND_GOOGLE_CHAT_URL,
    decodeNotificationConnectionEncryptionKey(ENCRYPTION_KEY),
  )
  const store = createConnectionStore([
    makeConnectionRow(),
    makeConnectionRow({
      channel: "executive",
      webhook_url: GOOGLE_CHAT_URL,
      webhook_url_ciphertext: ciphertext,
      connection_state: "encrypted_active",
    }),
    makeConnectionRow({
      channel: "math",
      webhook_url: GOOGLE_CHAT_URL,
      webhook_url_ciphertext: ciphertext,
      connection_state: "disconnected",
    }),
  ])
  const providerUrls = []
  const actorClient = { id: "admin-authenticated-client" }
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async ({ webhookUrl }) => {
      providerUrls.push(webhookUrl)
      return { succeeded: true, resultCode: "accepted" }
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  await repository.verifyConnection({
    connectionKey: "google_chat.management",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000211",
    confirmed: true,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  await repository.verifyConnection({
    connectionKey: "google_chat.executive",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000212",
    confirmed: true,
    actorUserId: ADMIN_ID,
    actorClient,
  })
  await assert.rejects(repository.verifyConnection({
    connectionKey: "google_chat.math",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000213",
    confirmed: true,
    actorUserId: ADMIN_ID,
    actorClient,
  }))
  assert.deepEqual(providerUrls, [GOOGLE_CHAT_URL, SECOND_GOOGLE_CHAT_URL])
})

test("verification terminalizes corrupt encrypted configuration before provider work", async () => {
  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  const store = createConnectionStore([makeConnectionRow({
    webhook_url_ciphertext: "v1:corrupt:envelope:value",
    webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    connection_state: "encrypted_active",
  })])
  let providerCalls = 0
  const repository = createNotificationConnectionRepository({
    store,
    encryptionKey: ENCRYPTION_KEY,
    sendVerification: async () => {
      providerCalls += 1
      return { succeeded: true, resultCode: "accepted" }
    },
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })
  const input = {
    connectionKey: "google_chat.management",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000256",
    confirmed: true,
    actorUserId: ADMIN_ID,
    actorClient: { id: "admin-authenticated-client" },
  }

  const first = await repository.verifyConnection(input)
  assert.equal(first.lastErrorCode, "configuration_error")
  assert.equal(providerCalls, 0)
  const terminal = store.calls.find((call) => call.operation === "recordVerificationAtomic")
  assert.equal(terminal.input.succeeded, false)
  assert.equal(terminal.input.resultCode, "configuration_error")

  const replay = await repository.verifyConnection(input)
  assert.deepEqual(replay, first)
  assert.equal(providerCalls, 0)
  assert.equal(
    store.calls.filter((call) => call.operation === "recordVerificationAtomic").length,
    1,
    "same request must replay the terminal result instead of staying reserved",
  )
})

test("production Supabase connection store mutates only through service-role RPC wrappers with an explicit verified actor", async () => {
  const { createSupabaseNotificationConnectionStore } = await import(connectionsRouteUrl)
  const rawRow = makeConnectionRow()
  const serviceCalls = []
  const rpcCalls = []
  const safeConnection = {
    connection_key: "google_chat.management",
    connection_state: "encrypted_active",
    revision: NEXT_BIG_REVISION,
    configured: true,
    webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    last_verified_at: null,
    last_error_code: null,
  }
  const beginResponses = new Map([
    [
      "30000000-0000-4000-8000-000000000253",
      { should_send: true, pending: false, connection: null },
    ],
    [
      "30000000-0000-4000-8000-000000000254",
      { should_send: false, pending: true, connection: null },
    ],
    [
      "30000000-0000-4000-8000-000000000255",
      { should_send: false, pending: false, connection: safeConnection },
    ],
    [
      "30000000-0000-4000-8000-000000000256",
      {
        should_send: false,
        pending: false,
        terminal_code: "verification_expired",
        connection: safeConnection,
      },
    ],
    [
      "30000000-0000-4000-8000-000000000257",
      {
        should_send: false,
        pending: false,
        terminal_code: "verification_superseded",
        connection: safeConnection,
      },
    ],
  ])
  const recordTerminalResponses = new Map([
    [
      "30000000-0000-4000-8000-000000000258",
      { terminal_code: "verification_expired", connection: safeConnection },
    ],
    [
      "30000000-0000-4000-8000-000000000259",
      { terminal_code: "verification_superseded", connection: safeConnection },
    ],
  ])
  const serviceClient = {
    async rpc(name, parameters) {
      rpcCalls.push([name, clone(parameters)])
      if (name === "begin_google_chat_connection_verification_v1") {
        return { data: clone(beginResponses.get(parameters.p_request_id)), error: null }
      }
      if (
        name === "record_google_chat_connection_verification_v1" &&
        recordTerminalResponses.has(parameters.p_request_id)
      ) {
        return { data: clone(recordTerminalResponses.get(parameters.p_request_id)), error: null }
      }
      return { data: clone(safeConnection), error: null }
    },
    from(table) {
      serviceCalls.push(["from", table])
      const builder = {
        select(columns) {
          serviceCalls.push(["select", columns])
          return builder
        },
        eq(column, value) {
          serviceCalls.push(["eq", column, value])
          return builder
        },
        async maybeSingle() {
          serviceCalls.push(["maybeSingle"])
          return { data: clone(rawRow), error: null }
        },
        update() {
          throw new Error("service role update is forbidden")
        },
        upsert() {
          throw new Error("service role upsert is forbidden")
        },
        insert() {
          throw new Error("service role insert is forbidden")
        },
        delete() {
          throw new Error("service role delete is forbidden")
        },
      }
      return builder
    },
  }
  const actorClient = {
    rpc() {
      throw new Error("browser-authenticated clients must not invoke connection mutation RPCs")
    },
  }
  const store = createSupabaseNotificationConnectionStore(serviceClient)
  const actor = { actorUserId: ADMIN_ID, actorClient }

  await store.replaceAtomic({
    ...actor,
    channel: "admin",
    webhookUrl: SECOND_GOOGLE_CHAT_URL,
    webhookUrlCiphertext: "v1:iv:tag:ciphertext",
    webhookUrlMask: "chat.googleapis.com/v1/spaces/SECO…4321/messages",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000251",
  })
  await store.disconnectAtomic({
    ...actor,
    channel: "admin",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000252",
  })
  const sendReservation = await store.beginVerificationAtomic({
    ...actor,
    channel: "admin",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000253",
  })
  assert.equal(sendReservation.shouldSend, true)
  assert.equal(sendReservation.row.webhook_url, GOOGLE_CHAT_URL)
  const readsAfterSendReservation = serviceCalls.length

  const pendingReplay = await store.beginVerificationAtomic({
    ...actor,
    channel: "admin",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000254",
  })
  const completedReplay = await store.beginVerificationAtomic({
    ...actor,
    channel: "admin",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000255",
  })
  assert.deepEqual(pendingReplay, { shouldSend: false, pending: true, row: null })
  assert.equal(completedReplay.shouldSend, false)
  assert.equal(completedReplay.pending, false)
  assert.doesNotMatch(JSON.stringify(completedReplay), /key-secret|token-secret|webhook_url|ciphertext/)
  assert.equal(
    serviceCalls.length,
    readsAfterSendReservation,
    "pending and completed begin replays must not service-read a sendable secret",
  )
  for (const [requestId, expectedCode] of [
    ["30000000-0000-4000-8000-000000000256", "notification_connection_verification_expired"],
    ["30000000-0000-4000-8000-000000000257", "notification_connection_verification_superseded"],
  ]) {
    await assert.rejects(store.beginVerificationAtomic({
      ...actor,
      channel: "admin",
      expectedRevision: BIG_REVISION,
      requestId,
    }), (error) => error?.code === expectedCode && error?.status === 409)
  }

  await store.recordVerificationAtomic({
    ...actor,
    channel: "admin",
    succeeded: true,
    resultCode: "accepted",
    verifiedAt: "2026-07-17T01:00:00.000Z",
    expectedRevision: BIG_REVISION,
    requestId: "30000000-0000-4000-8000-000000000253",
  })
  for (const [requestId, expectedCode] of [
    ["30000000-0000-4000-8000-000000000258", "notification_connection_verification_expired"],
    ["30000000-0000-4000-8000-000000000259", "notification_connection_verification_superseded"],
  ]) {
    await assert.rejects(store.recordVerificationAtomic({
      ...actor,
      channel: "admin",
      succeeded: false,
      resultCode: "transport_error",
      verifiedAt: "2026-07-17T01:00:00.000Z",
      expectedRevision: BIG_REVISION,
      requestId,
    }), (error) => error?.code === expectedCode && error?.status === 409)
  }

  assert.deepEqual(rpcCalls, [
    ["replace_google_chat_connection_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_webhook_url: SECOND_GOOGLE_CHAT_URL,
      p_webhook_url_ciphertext: "v1:iv:tag:ciphertext",
      p_webhook_url_mask: "chat.googleapis.com/v1/spaces/SECO…4321/messages",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000251",
    }],
    ["disconnect_google_chat_connection_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000252",
    }],
    ["begin_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000253",
    }],
    ["begin_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000254",
    }],
    ["begin_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000255",
    }],
    ["begin_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000256",
    }],
    ["begin_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000257",
    }],
    ["record_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_succeeded: true,
      p_result_code: "accepted",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000253",
    }],
    ["record_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_succeeded: false,
      p_result_code: "transport_error",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000258",
    }],
    ["record_google_chat_connection_verification_v1", {
      p_actor: ADMIN_ID,
      p_channel: "admin",
      p_succeeded: false,
      p_result_code: "transport_error",
      p_expected_revision: BIG_REVISION,
      p_request_id: "30000000-0000-4000-8000-000000000259",
    }],
  ])
  assert.equal(rpcCalls.every(([, parameters]) => parameters.p_actor === ADMIN_ID), true)
})

test("connections route is masked for staff and reserves every mutation for exact admins", async () => {
  const { createNotificationConnectionsRouteHandlers } = await import(connectionsRouteUrl)
  const safeConnection = {
    connectionKey: "google_chat.management",
    connectionState: "encrypted_active",
    revision: BIG_REVISION,
    configured: true,
    webhookUrlMask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    lastVerifiedAt: null,
    lastErrorCode: null,
    editable: false,
  }
  const calls = []
  const authenticatedRequests = []
  const staffClient = { id: "staff-authenticated-client" }
  const repository = {
    async listConnections() {
      calls.push(["list"])
      return [safeConnection]
    },
    async replaceConnection(input) {
      calls.push(["replace", input])
      return { ...safeConnection, editable: true }
    },
    async verifyConnection(input) {
      calls.push(["verify", input])
      return { ...safeConnection, editable: true, lastVerifiedAt: "2026-07-17T01:00:00.000Z" }
    },
    async disconnectConnection(input) {
      calls.push(["disconnect", input])
      return { ...safeConnection, connectionState: "disconnected", configured: false, editable: true }
    },
  }

  const staffHandlers = createNotificationConnectionsRouteHandlers({
    authenticate: async (request) => {
      authenticatedRequests.push(request)
      return { userId: STAFF_ID, role: "staff", client: staffClient }
    },
    repository,
  })
  const getRequest = new Request(
    "http://localhost/api/notifications/connections",
    { headers: { Authorization: "Bearer session-token" } },
  )
  const getResponse = await staffHandlers.get(getRequest)
  assert.equal(getResponse.status, 200)
  assert.equal(authenticatedRequests[0], getRequest, "GET must authenticate the actual Request")
  const getPayload = await getResponse.json()
  assert.equal(getPayload.connections[0].connection_key, "google_chat.management")
  assert.equal(getPayload.connections[0].editable, false)
  assert.doesNotMatch(JSON.stringify(getPayload), /key-secret|token-secret|webhook_url_ciphertext/)

  const staffPatchRequest = jsonRequest(
    "http://localhost/api/notifications/connections",
    "PATCH",
    {
      action: "disconnect",
      connection_key: "google_chat.management",
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
    },
  )
  const staffPatch = await staffHandlers.patch(staffPatchRequest)
  assert.equal(staffPatch.status, 403)
  assert.equal(authenticatedRequests[1], staffPatchRequest, "PATCH must authenticate the actual Request")
  assert.deepEqual(calls, [["list"]])
})

test("connections route uses closed action payloads and never accepts content or stored secrets", async () => {
  const { createNotificationConnectionsRouteHandlers } = await import(connectionsRouteUrl)
  const calls = []
  const authenticatedRequests = []
  const adminClient = { id: "admin-authenticated-client" }
  const safeConnection = {
    connectionKey: "google_chat.management",
    connectionState: "encrypted_active",
    revision: NEXT_BIG_REVISION,
    configured: true,
    webhookUrlMask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    lastVerifiedAt: null,
    lastErrorCode: null,
    editable: true,
  }
  const repository = {
    listConnections: async () => [safeConnection],
    replaceConnection: async (input) => {
      calls.push(["replace", input])
      return safeConnection
    },
    verifyConnection: async (input) => {
      calls.push(["verify", input])
      return safeConnection
    },
    disconnectConnection: async (input) => {
      calls.push(["disconnect", input])
      return { ...safeConnection, connectionState: "disconnected", configured: false }
    },
  }
  const handlers = createNotificationConnectionsRouteHandlers({
    authenticate: async (request) => {
      authenticatedRequests.push(request)
      return { userId: ADMIN_ID, role: "admin", client: adminClient }
    },
    repository,
  })

  const invalidBodies = [
    {
      action: "replace",
      connection_key: "google_chat.management",
      webhook_url: GOOGLE_CHAT_URL,
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
      webhook_url_ciphertext: "v1:secret",
    },
    {
      action: "replace",
      connection_key: "google_chat.management",
      webhook_url: GOOGLE_CHAT_URL,
      webhookUrl: SECOND_GOOGLE_CHAT_URL,
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
    },
    {
      action: "verify",
      connection_key: "google_chat.management",
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
      confirmed: false,
    },
    {
      action: "verify",
      connection_key: "google_chat.management",
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
      confirmed: true,
      text: "arbitrary provider payload",
    },
    {
      action: "verify",
      connection_key: "google_chat.management",
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
      confirmed: true,
      provider: { text: "nested arbitrary provider payload" },
    },
    {
      action: "disconnect",
      connection_key: "google_chat.unknown",
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
    },
    {
      action: "disconnect",
      connection_key: "google_chat.management",
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
      actor_user_id: ADMIN_ID,
    },
  ]
  for (const body of invalidBodies) {
    const request = jsonRequest(
      "http://localhost/api/notifications/connections",
      "PATCH",
      body,
    )
    const response = await handlers.patch(request)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal(
      authenticatedRequests.at(-1),
      request,
      "authentication must precede mutation-body validation",
    )
  }
  assert.equal(calls.length, 0)

  const replaceRequest = jsonRequest(
    "http://localhost/api/notifications/connections",
    "PATCH",
    {
      action: "replace",
      connection_key: "google_chat.management",
      webhook_url: GOOGLE_CHAT_URL,
      expected_revision: BIG_REVISION,
      request_id: REQUEST_ID,
    },
  )
  const replaceResponse = await handlers.patch(replaceRequest)
  assert.equal(authenticatedRequests.at(-1), replaceRequest)
  assert.equal(replaceResponse.status, 200)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ["replace", {
    connectionKey: "google_chat.management",
    webhookUrl: GOOGLE_CHAT_URL,
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    actorUserId: ADMIN_ID,
    actorClient: adminClient,
  }])
  assert.doesNotMatch(JSON.stringify(await replaceResponse.json()), /key-secret|token-secret|webhook_url_ciphertext/)

  const verifyResponse = await handlers.patch(jsonRequest(
    "http://localhost/api/notifications/connections",
    "PATCH",
    {
      action: "verify",
      connection_key: "google_chat.management",
      expected_revision: NEXT_BIG_REVISION,
      request_id: "30000000-0000-4000-8000-000000000221",
      confirmed: true,
    },
  ))
  assert.equal(verifyResponse.status, 200)
  assert.equal(calls[1][0], "verify")
  assert.equal(calls[1][1].actorUserId, ADMIN_ID)
  assert.deepEqual(calls[1][1].actorClient, adminClient)
})

test("legacy Google Chat PATCH delegates to the encrypted audited service-role CAS path", async () => {
  const { replaceLegacyGoogleChatConnection } = await import(repositoryModuleUrl)
  const calls = []
  const result = await replaceLegacyGoogleChatConnection({
    role: "admin",
    userId: ADMIN_ID,
    channel: "admin",
    webhookUrl: GOOGLE_CHAT_URL,
    encryptionKey: ENCRYPTION_KEY,
  }, {
    requestId: () => REQUEST_ID,
    async loadCurrentRevision(channel) {
      calls.push(["read_revision", channel])
      return BIG_REVISION
    },
    async replaceAtomic(input) {
      calls.push(["replace_atomic", input])
      return {
        connection_key: "google_chat.management",
        connection_state: "encrypted_active",
        revision: NEXT_BIG_REVISION,
        configured: true,
        webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
      }
    },
  })

  assert.deepEqual(calls[0], ["read_revision", "admin"])
  assert.equal(calls[1][0], "replace_atomic")
  assert.deepEqual({
    channel: calls[1][1].channel,
    webhookUrl: calls[1][1].webhookUrl,
    webhookUrlMask: calls[1][1].webhookUrlMask,
    expectedRevision: calls[1][1].expectedRevision,
    requestId: calls[1][1].requestId,
    actorUserId: calls[1][1].actorUserId,
  }, {
    channel: "admin",
    webhookUrl: GOOGLE_CHAT_URL,
    webhookUrlMask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    expectedRevision: BIG_REVISION,
    requestId: REQUEST_ID,
    actorUserId: ADMIN_ID,
  })
  assert.match(calls[1][1].webhookUrlCiphertext, /^v1:/)
  assert.notEqual(calls[1][1].webhookUrlCiphertext, GOOGLE_CHAT_URL)
  assert.deepEqual(result, {
    configured: true,
    maskedUrl: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
  })

  await assert.rejects(replaceLegacyGoogleChatConnection({
    role: "staff",
    userId: STAFF_ID,
    channel: "admin",
    webhookUrl: SECOND_GOOGLE_CHAT_URL,
    encryptionKey: ENCRYPTION_KEY,
  }, {
    requestId: () => REQUEST_ID,
    loadCurrentRevision: async () => BIG_REVISION,
    replaceAtomic: async () => {
      throw new Error("staff must never reach the writer")
    },
  }), /notification_access_denied/)

  const legacyRouteSource = await readFile(legacyGoogleChatRouteUrl, "utf8")
  assert.doesNotMatch(
    legacyRouteSource,
    /\.from\(["']google_chat_webhook_settings["']\)[\s\S]{0,300}\.(?:upsert|update|insert|delete)\s*\(/,
    "legacy PATCH must not write the plaintext table through service-role CRUD",
  )
  assert.match(legacyRouteSource, /replace_google_chat_connection_v1/)
  assert.match(legacyRouteSource, /serviceClient\.rpc\("replace_google_chat_connection_v1"/)
  assert.match(legacyRouteSource, /p_actor: input\.actorUserId/)
  assert.doesNotMatch(legacyRouteSource, /client\.rpc\("replace_google_chat_connection_v1"/)
})

test("backfill CLI is dry-run by default and rejects unknown arguments", async () => {
  const { parseGoogleChatWebhookBackfillArgs } = await import(backfillModuleUrl)
  assert.deepEqual(parseGoogleChatWebhookBackfillArgs([]), { apply: false })
  assert.deepEqual(parseGoogleChatWebhookBackfillArgs(["--apply"]), { apply: true })
  assert.throws(() => parseGoogleChatWebhookBackfillArgs(["--write", "--print-secrets"]))
})

test("backfill dry-run reports only channel/state and performs zero writes", async () => {
  const { runGoogleChatWebhookEncryptionBackfill } = await import(backfillModuleUrl)
  const logs = []
  const writes = []
  const result = await runGoogleChatWebhookEncryptionBackfill({
    apply: false,
    encryptionKey: ENCRYPTION_KEY,
    loadRows: async () => [
      makeConnectionRow(),
      makeConnectionRow({ channel: "executive", webhook_url: "", connection_state: "legacy_active" }),
      makeConnectionRow({ channel: "math", connection_state: "disconnected" }),
    ],
    applyEncryptedRow: async (input) => writes.push(input),
    log: (entry) => logs.push(entry),
  })

  assert.deepEqual(result, { mode: "dry_run", candidates: 1, applied: 0, skipped: 2 })
  assert.deepEqual(writes, [])
  const output = logs.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n")
  assert.match(output, /admin/)
  assert.match(output, /legacy_active/)
  assert.doesNotMatch(output, /key-secret|token-secret|SPACEIDENTIFIER123456|webhook_url_ciphertext|^v1:/m)
})

test("backfill apply encrypts once, preserves legacy plaintext, and a second run is a no-op", async () => {
  const { runGoogleChatWebhookEncryptionBackfill } = await import(backfillModuleUrl)
  const {
    decodeNotificationConnectionEncryptionKey,
    decryptNotificationConnectionSecret,
  } = await import(cryptoModuleUrl)
  const rows = [makeConnectionRow()]
  const logs = []
  const writes = []
  const dependencies = {
    apply: true,
    encryptionKey: ENCRYPTION_KEY,
    loadRows: async () => rows.map(clone),
    applyEncryptedRow: async (input) => {
      writes.push(clone(input))
      assert.equal("webhookUrl" in input, false, "backfill must not rewrite or print legacy plaintext")
      Object.assign(rows[0], {
        webhook_url_ciphertext: input.webhookUrlCiphertext,
        webhook_url_mask: input.webhookUrlMask,
        connection_state: "encrypted_active",
      })
    },
    log: (entry) => logs.push(entry),
  }

  const first = await runGoogleChatWebhookEncryptionBackfill(dependencies)
  const second = await runGoogleChatWebhookEncryptionBackfill(dependencies)
  assert.deepEqual(first, { mode: "apply", candidates: 1, applied: 1, skipped: 0 })
  assert.deepEqual(second, { mode: "apply", candidates: 0, applied: 0, skipped: 1 })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].channel, "admin")
  assert.match(writes[0].expectedWebhookFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(
    decryptNotificationConnectionSecret(
      writes[0].webhookUrlCiphertext,
      decodeNotificationConnectionEncryptionKey(ENCRYPTION_KEY),
    ),
    GOOGLE_CHAT_URL,
  )
  assert.equal(rows[0].webhook_url, GOOGLE_CHAT_URL, "legacy reader stays valid until cutover")
  const output = logs.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n")
  assert.doesNotMatch(output, /key-secret|token-secret|SPACEIDENTIFIER123456|webhook_url_ciphertext|v1:/)
})

test("backfill rejects a rounded unsafe numeric revision before any write", async () => {
  const { runGoogleChatWebhookEncryptionBackfill } = await import(backfillModuleUrl)
  const writes = []
  await assert.rejects(runGoogleChatWebhookEncryptionBackfill({
    apply: true,
    encryptionKey: ENCRYPTION_KEY,
    loadRows: async () => [makeConnectionRow({ revision: Number(BIG_REVISION) })],
    applyEncryptedRow: async (input) => writes.push(input),
    log: () => {},
  }), /안전한 정수 범위/)
  assert.deepEqual(writes, [])
})

test("Task 6 migration and HTTP layer do not absorb Task 7 delivery or worker RPCs", async () => {
  const [
    migration,
    service,
    auth,
    crypto,
    repository,
    controlRoute,
    connectionRoute,
    backfill,
    optionalDeliveryRoute,
  ] = await Promise.all([
    readFile(settingsMigrationUrl, "utf8"),
    readFile(serviceModuleUrl, "utf8"),
    readFile(authModuleUrl, "utf8"),
    readFile(cryptoModuleUrl, "utf8"),
    readFile(repositoryModuleUrl, "utf8"),
    readFile(controlPlaneRouteUrl, "utf8"),
    readFile(connectionsRouteUrl, "utf8"),
    readFile(backfillModuleUrl, "utf8"),
    readOptionalSource(deferredDeliveryRouteUrl),
  ])
  const task6Source = [
    migration,
    service,
    auth,
    crypto,
    repository,
    controlRoute,
    connectionRoute,
    backfill,
    optionalDeliveryRoute,
  ].join("\n")
  for (const required of [
    "get_notification_control_plane_v1",
    "save_notification_control_plane_v1",
    "get_notification_runtime_flags_v1",
    "set_notification_runtime_flag_v1",
    "replace_google_chat_connection_v1",
    "disconnect_google_chat_connection_v1",
    "begin_google_chat_connection_verification_v1",
    "record_google_chat_connection_verification_v1",
  ]) {
    assert.match(migration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${required}\\b`, "i"))
  }
  assert.doesNotMatch(
    connectionRoute,
    /\.(?:update|upsert|insert|delete)\s*\(/,
    "service-role connection access is read-only outside the audited mutation RPCs",
  )
  assert.match(controlRoute, /notification_patch_invalid/)
  assert.match(controlRoute, /notification_google_chat_connection_required/)
  for (const task7Contract of [
    "record_notification_event_v1",
    "enqueue_notification_target_reconciliation_job_v1",
    "claim_notification_fanout_jobs_v1",
    "claim_notification_rule_reconciliation_jobs_v1",
    "claim_notification_target_reconciliation_jobs_v1",
    "apply_notification_rule_reconciliation_batch_v1",
    "apply_notification_target_reconciliation_batch_v1",
    "finish_notification_orchestration_job_v1",
    "get_notification_orchestration_job_status_v1",
    "retry_notification_orchestration_job_v1",
    "claim_notification_deliveries_v1",
    "record_notification_worker_heartbeat_v1",
    "begin_notification_delivery_send_v1",
    "commit_notification_in_app_delivery_v1",
    "finalize_notification_delivery_v1",
    "reap_notification_leases_v1",
    "reconcile_notification_delivery_v1",
    "get_dashboard_notification_inbox_v1",
    "get_dashboard_notification_unread_count_v1",
    "mark_dashboard_notification_read_v1",
    "reserve_canonical_dispatch_ownership_v1",
    "begin_legacy_notification_dispatch_v1",
    "finalize_legacy_notification_dispatch_v1",
    "commit_legacy_notification_in_app_projection_v1",
    "transfer_notification_dispatch_ownership_v1",
  ]) {
    assert.doesNotMatch(task6Source, new RegExp(task7Contract, "i"), task7Contract)
  }
  assert.doesNotMatch(migration, /common_notification_control_plane_runtime_version/i)
  assert.match(migration, /backfill_google_chat_connection_encryption_v1/i)
  assert.match(migration, /webhook_url_ciphertext\s+is\s+null/i)
  assert.match(migration, /(?:digest\s*\([^;]+sha256|sha256\s*\()/is)
  assert.doesNotMatch(
    backfill,
    /\.from\(["']google_chat_webhook_settings["']\)[\s\S]{0,300}\.update\s*\(/,
    "backfill writes must use the single transactional CAS RPC",
  )
})

test("Task 6 SQL source seals transaction, privilege, CAS, audit, and fail-closed contracts", async () => {
  const migration = await readFile(settingsMigrationUrl, "utf8")
  const functionBlock = (qualifiedName) => {
    const marker = `create or replace function ${qualifiedName}`
    const start = migration.toLowerCase().indexOf(marker.toLowerCase())
    assert.notEqual(start, -1, qualifiedName)
    const next = migration.toLowerCase().indexOf("\ncreate or replace function ", start + marker.length)
    return migration.slice(start, next === -1 ? migration.length : next)
  }

  assert.equal((migration.match(/^begin;$/gim) ?? []).length, 1)
  assert.equal((migration.match(/^commit;$/gim) ?? []).length, 1)
  assert.match(migration, /set local lock_timeout = '5s'/i)
  assert.ok(migration.toLowerCase().indexOf("begin;") < migration.toLowerCase().indexOf("commit;"))

  const publicFunctions = [
    "public.get_notification_runtime_flags_v1",
    "public.get_notification_control_plane_v1",
    "public.save_notification_control_plane_v1",
    "public.set_notification_runtime_flag_v1",
    "public.backfill_google_chat_connection_encryption_v1",
    "public.replace_google_chat_connection_v1",
    "public.disconnect_google_chat_connection_v1",
    "public.begin_google_chat_connection_verification_v1",
    "public.record_google_chat_connection_verification_v1",
  ]
  for (const name of publicFunctions) {
    const block = functionBlock(name)
    assert.match(block, /security definer/i, `${name} must be security definer`)
    assert.match(block, /set search_path = ''/i, `${name} must use an empty search_path`)
  }

  for (const name of [
    "dashboard_private.set_notification_runtime_flag_v1_impl",
    "dashboard_private.replace_google_chat_connection_v1_impl",
    "dashboard_private.disconnect_google_chat_connection_v1_impl",
    "dashboard_private.begin_google_chat_connection_verification_v1_impl",
    "dashboard_private.record_google_chat_connection_verification_v1_impl",
  ]) {
    const block = functionBlock(name)
    assert.match(block, /security definer/i)
    assert.match(block, /set search_path = ''/i)
  }

  assert.match(
    migration,
    /revoke all on function public\.save_notification_control_plane_v1[\s\S]+?from public, anon, authenticated, service_role;/i,
  )
  assert.match(
    migration,
    /grant execute on function public\.save_notification_control_plane_v1[\s\S]+?to authenticated;/i,
  )
  assert.match(
    migration,
    /revoke all on function public\.backfill_google_chat_connection_encryption_v1[\s\S]+?from public, anon, authenticated, service_role;/i,
  )
  assert.match(
    migration,
    /grant execute on function public\.backfill_google_chat_connection_encryption_v1[\s\S]+?to service_role;/i,
  )

  const save = functionBlock("public.save_notification_control_plane_v1")
  assert.match(save, /notification_control_plane_settings_ui_enabled[\s\S]+?for share;/i)
  assert.equal((save.match(/order by patch_key\.value/gi) ?? []).length, 2)
  assert.match(save, /notification_revision_conflict[\s\S]+?insert into dashboard_private\.notification_templates/is)
  assert.match(save, /v_template_changed[\s\S]+?v_new_checksum[\s\S]+?notification_templates/is)
  assert.match(save, /notification_audit_logs/i)
  assert.match(save, /notification_rule_reconciliation_jobs/i)
  assert.match(save, /notification_request_ledger/i)

  const flags = functionBlock("dashboard_private.set_notification_runtime_flag_v1_impl")
  assert.match(flags, /notification_runtime_dependency_ready_v1\('common'\)/i)
  assert.match(flags, /notification_runtime_dependency_ready_v1\('adapters'\)/i)
  assert.match(flags, /notification_runtime_dependency_ready_v1\('registration'\)/i)
  assert.match(flags, /notification_worker_heartbeats[\s\S]+?interval '3 minutes'/i)
  assert.match(flags, /status in \('pending', 'retry_wait'\)[\s\S]+?status = 'claimed'/i)
  assert.doesNotMatch(flags, /status\s+in\s*\([^)]*sending|status\s*=\s*'sent'/i)
  assert.match(flags, /registration\.phone_consultation_ready/i)
  assert.match(flags, /registration\.visit_scheduled/i)
  assert.match(flags, /registration\.visit_canceled/i)
  assert.match(flags, /customer_message/i)

  const dependency = functionBlock("dashboard_private.notification_runtime_dependency_ready_v1")
  assert.match(dependency, /to_regprocedure/i)
  assert.match(dependency, /when others then\s+return false/is)
  assert.doesNotMatch(dependency, /p_dependency\s*\|\|/i)
})

test("Task 6 SQL keeps connection mutations server-only and validates settings authoritatively", async () => {
  const migration = await readFile(settingsMigrationUrl, "utf8")
  const functionBlock = (qualifiedName) => {
    const marker = `create or replace function ${qualifiedName}`
    const start = migration.toLowerCase().indexOf(marker.toLowerCase())
    assert.notEqual(start, -1, qualifiedName)
    const next = migration.toLowerCase().indexOf("\ncreate or replace function ", start + marker.length)
    return migration.slice(start, next === -1 ? migration.length : next)
  }

  for (const name of [
    "replace_google_chat_connection_v1",
    "disconnect_google_chat_connection_v1",
    "begin_google_chat_connection_verification_v1",
    "record_google_chat_connection_verification_v1",
  ]) {
    const block = functionBlock(`public.${name}`)
    assert.match(block, /\(\s*p_actor\s+uuid\s*,/i)
    assert.match(block, /auth\.role\(\)\s*=\s*'service_role'/i)
    assert.doesNotMatch(block, /auth\.uid\(\)|current_dashboard_role/i)
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+?\\)\\s+to service_role;`, "i"),
    )
    assert.doesNotMatch(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+?\\)\\s+to authenticated;`, "i"),
    )
  }

  const save = functionBlock("public.save_notification_control_plane_v1")
  assert.match(save, /notification-control-plane-workflow:[\s\S]+?p_workflow_key/i)
  assert.match(save, /notification_template_content_valid_v1/i)
  assert.match(save, /notification_google_chat_audience_ready_v1/i)
  assert.match(save, /not\s+v_enabled[\s\S]+?v_next_enabled/i)

  const schedule = functionBlock("dashboard_private.notification_schedule_config_valid_v1")
  assert.match(schedule, /p_workflow_key[\s\S]+?p_event_key/i)
  assert.match(schedule, /registration[\s\S]+?registration\.appointment_reminder_due/i)
  assert.match(schedule, /appointment_scheduled_at/i)

  const template = functionBlock("dashboard_private.notification_template_content_valid_v1")
  assert.match(template, /allowed_variables/i)
  assert.match(template, /jsonb_array_elements/i)
  assert.match(template, /https\?|protocol|\/\//i)

  const beginVerification = functionBlock(
    "dashboard_private.begin_google_chat_connection_verification_v1_impl",
  )
  assert.match(beginVerification, /reserved_at/i)
  assert.match(beginVerification, /expires_at/i)
  assert.match(beginVerification, /profile\.role\s*=\s*'admin'/i)
  const recordVerification = functionBlock(
    "dashboard_private.record_google_chat_connection_verification_v1_impl",
  )
  assert.match(recordVerification, /superseded/i)
  assert.match(recordVerification, /verification_expired/i)
  assert.match(recordVerification, /verification_superseded/i)
  assert.match(recordVerification, /v_row\.revision\s*<>\s*p_expected_revision/i)
  const recordAdminChecks = recordVerification.match(/profile\.role\s*=\s*'admin'/gi) ?? []
  assert.equal(recordAdminChecks.length, 1)
  assert.ok(
    recordVerification.indexOf("profile.role = 'admin'") <
      recordVerification.indexOf("from dashboard_private.notification_request_ledger"),
  )
  assert.match(recordVerification, /not\s+v_ledger_found[\s\S]+?not\s+v_actor_is_admin/i)
  assert.match(recordVerification, /v_ledger_kind\s*<>[\s\S]+?not\s+v_actor_is_admin/i)
  assert.match(recordVerification, /v_ledger_response\s*->>\s*'state'\s*=\s*'completed'/i)

  const safeConnection = functionBlock(
    "dashboard_private.notification_connection_safe_json_v1",
  )
  assert.match(
    safeConnection,
    /legacy_active[\s\S]+?notification_google_chat_webhook_mask_v1/i,
  )
})
