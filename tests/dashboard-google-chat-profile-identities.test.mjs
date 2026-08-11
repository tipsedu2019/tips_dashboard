import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  parseGoogleChatProfileIdentity,
  parseGoogleChatProfileIdentitySnapshot,
} from "../src/features/management/google-chat-profile-identity-types.ts"
import { createGoogleChatProfileIdentityService } from "../src/features/management/google-chat-profile-identity-service.ts"
import {
  createGoogleWorkspaceDirectoryClient,
  createProductionGoogleWorkspaceDirectoryClient,
} from "../src/features/management/server/google-workspace-directory-client.ts"
import { createGoogleChatProfileIdentityRouteHandlers } from "../src/features/management/server/google-chat-profile-identity-route.ts"

const root = new URL("../", import.meta.url)
const PROFILE_ID = "99460000-0000-4000-8000-000000000101"
const ACTOR_ID = "99460000-0000-4000-8000-000000000102"
const REQUEST_ID = "99460000-0000-4000-8000-000000000103"
const CHAT_USER_ID = "12345678901234567890"
const ACCOUNT_EMAIL = "teacher@example.com"

const IDENTITY = Object.freeze({
  profileId: PROFILE_ID,
  profileName: "김선생",
  accountEmail: ACCOUNT_EMAIL,
  dashboardRole: "teacher",
  chatUserId: CHAT_USER_ID,
  resourceName: `users/${CHAT_USER_ID}`,
  source: "directory",
  verificationStatus: "verified",
  verifiedAt: "2026-08-11T00:00:00.000Z",
  lastSyncStatus: "ok",
  lastSyncAt: "2026-08-11T00:00:00.000Z",
  identityRevision: "1",
  eligible: true,
})

const SOURCE = Object.freeze({
  profileId: PROFILE_ID,
  profileName: "김선생",
  accountEmail: ACCOUNT_EMAIL,
  dashboardRole: "teacher",
  identityRevision: "0",
})

const SNAPSHOT = Object.freeze({
  identities: [IDENTITY],
  directory: { status: "ready", configured: true },
  editable: true,
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function validRequestBody(overrides = {}) {
  return {
    profile_id: PROFILE_ID,
    lookup_mode: "auto",
    chat_user_id: null,
    expected_identity_revision: "0",
    request_id: REQUEST_ID,
    ...overrides,
  }
}

function withinDeadline(promise, timeoutMs = 200) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("test_deadline_exceeded")), timeoutMs)
    }),
  ])
}

function makeActorClient({ role = "admin", identities = [IDENTITY], userId = ACTOR_ID } = {}) {
  const calls = []
  return {
    calls,
    auth: {
      async getUser(token) {
        calls.push({ kind: "getUser", token })
        return { data: { user: { id: userId } }, error: null }
      },
    },
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args })
      if (name === "current_dashboard_role") return { data: role, error: null }
      if (name === "list_google_chat_profile_identities_v1") {
        return { data: identities, error: null }
      }
      throw new Error(`unexpected_actor_rpc:${name}`)
    },
  }
}

function makeServiceClient({ source = SOURCE, applyResult = IDENTITY } = {}) {
  const calls = []
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === "read_google_chat_profile_identity_sync_source_v1") {
        return { data: source, error: null }
      }
      if (name === "apply_google_chat_profile_identity_sync_v1") {
        return { data: applyResult, error: null }
      }
      throw new Error(`unexpected_service_rpc:${name}`)
    },
  }
}

function makeRoute({
  role = "admin",
  identities = [IDENTITY],
  source = SOURCE,
  applyResult = IDENTITY,
  directoryConfigured = true,
  directoryLookup,
} = {}) {
  const actorClient = makeActorClient({ role, identities })
  const serviceClient = makeServiceClient({ source, applyResult })
  const lookups = []
  const directory = {
    configuration: Object.freeze({
      status: directoryConfigured ? "ready" : "not_configured",
      configured: directoryConfigured,
    }),
    async lookup(userKey) {
      lookups.push(userKey)
      return directoryLookup
        ? directoryLookup(userKey)
        : {
            kind: "found",
            id: CHAT_USER_ID,
            primaryEmail: ACCOUNT_EMAIL,
            aliases: [],
            suspended: false,
          }
    },
  }
  const handlers = createGoogleChatProfileIdentityRouteHandlers({
    createAuthenticatedClient() {
      return actorClient
    },
    createServiceClient() {
      return serviceClient
    },
    directory,
  })
  return { handlers, actorClient, serviceClient, lookups }
}

test("identity DTO parsers accept only the exact safe wire contract", () => {
  assert.deepEqual(parseGoogleChatProfileIdentity(IDENTITY), IDENTITY)
  assert.deepEqual(parseGoogleChatProfileIdentitySnapshot(SNAPSHOT), SNAPSHOT)

  const mutations = [
    { ...IDENTITY, extra: "no" },
    { ...IDENTITY, profileId: "not-a-uuid" },
    { ...IDENTITY, accountEmail: "Teacher@Example.com" },
    { ...IDENTITY, dashboardRole: "owner" },
    { ...IDENTITY, chatUserId: "users/123" },
    { ...IDENTITY, resourceName: "users/999" },
    { ...IDENTITY, source: "browser" },
    { ...IDENTITY, verificationStatus: "ready" },
    { ...IDENTITY, verifiedAt: "yesterday" },
    { ...IDENTITY, lastSyncStatus: "raw_sdk_error" },
    { ...IDENTITY, lastSyncAt: "2026-08-11" },
    { ...IDENTITY, identityRevision: "01" },
    { ...IDENTITY, eligible: "true" },
    { ...IDENTITY, chatUserId: null, resourceName: null },
    { ...IDENTITY, lastSyncStatus: null, lastSyncAt: null },
    {
      ...IDENTITY,
      chatUserId: null,
      resourceName: null,
      source: null,
      verificationStatus: "not_found",
      verifiedAt: null,
      lastSyncStatus: null,
      lastSyncAt: null,
      eligible: false,
    },
  ]
  for (const mutation of mutations) {
    assert.throws(
      () => parseGoogleChatProfileIdentity(mutation),
      /google_chat_profile_identity_invalid/,
    )
  }

  const unconfigured = {
    identities: [{
      ...IDENTITY,
      chatUserId: null,
      resourceName: null,
      source: null,
      verificationStatus: "unverified",
      verifiedAt: null,
      lastSyncStatus: null,
      lastSyncAt: null,
      identityRevision: "0",
      eligible: false,
    }],
    directory: { status: "not_configured", configured: false },
    editable: true,
  }
  assert.deepEqual(parseGoogleChatProfileIdentitySnapshot(unconfigured), unconfigured)
  assert.throws(
    () => parseGoogleChatProfileIdentitySnapshot({
      ...SNAPSHOT,
      directory: { status: "ready", configured: false },
    }),
    /google_chat_profile_identity_snapshot_invalid/,
  )
  assert.throws(
    () => parseGoogleChatProfileIdentitySnapshot({ ...SNAPSHOT, extra: true }),
    /google_chat_profile_identity_snapshot_invalid/,
  )
})

test("browser service sends exact authenticated GET and POST requests", async () => {
  const requests = []
  const service = createGoogleChatProfileIdentityService({
    getAccessToken: async () => "session-token",
    fetch: async (url, init) => {
      requests.push({ url, init })
      return init.method === "GET" ? json(SNAPSHOT) : json(IDENTITY)
    },
  })

  assert.deepEqual(await service.list(), SNAPSHOT)
  assert.deepEqual(await service.sync(validRequestBody()), IDENTITY)
  assert.deepEqual(requests.map(({ url, init }) => ({
    url,
    method: init.method,
    accept: init.headers.Accept,
    authorization: init.headers.Authorization,
    contentType: init.headers["Content-Type"] ?? null,
    body: init.body ? JSON.parse(init.body) : null,
    hasSignal: init.signal instanceof AbortSignal,
  })), [
    {
      url: "/api/admin/google-chat-identities",
      method: "GET",
      accept: "application/json",
      authorization: "Bearer session-token",
      contentType: null,
      body: null,
      hasSignal: true,
    },
    {
      url: "/api/admin/google-chat-identities",
      method: "POST",
      accept: "application/json",
      authorization: "Bearer session-token",
      contentType: "application/json",
      body: validRequestBody(),
      hasSignal: true,
    },
  ])
})

test("browser service bounds stalled auth and fetch with one abort deadline", async () => {
  let fetchCalls = 0
  const stalledAuth = createGoogleChatProfileIdentityService({
    timeoutMs: 5,
    getAccessToken: async () => new Promise(() => {}),
    fetch: async () => {
      fetchCalls += 1
      throw new Error("must_not_call")
    },
  })
  await assert.rejects(withinDeadline(stalledAuth.list()), /google_chat_profile_identity_timeout/)
  assert.equal(fetchCalls, 0)

  let resolveLateAuth
  const lateAuth = createGoogleChatProfileIdentityService({
    timeoutMs: 5,
    getAccessToken: () => new Promise((resolve) => {
      resolveLateAuth = resolve
    }),
    fetch: async () => {
      fetchCalls += 1
      return json(SNAPSHOT)
    },
  })
  await assert.rejects(withinDeadline(lateAuth.list()), /google_chat_profile_identity_timeout/)
  resolveLateAuth("late-session-token")
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(fetchCalls, 0)

  let aborted = false
  const stalledFetch = createGoogleChatProfileIdentityService({
    timeoutMs: 5,
    getAccessToken: async () => "session-token",
    fetch: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true
        reject(new Error("private transport text"))
      }, { once: true })
    }),
  })
  await assert.rejects(withinDeadline(stalledFetch.list()), /google_chat_profile_identity_timeout/)
  assert.equal(aborted, true)
})

test("browser service rejects absent auth, unsafe errors, and malformed success bodies", async () => {
  let calls = 0
  const unauthenticated = createGoogleChatProfileIdentityService({
    getAccessToken: async () => null,
    fetch: async () => {
      calls += 1
      return json(SNAPSHOT)
    },
  })
  await assert.rejects(unauthenticated.list(), /google_chat_profile_identity_auth_required/)
  assert.equal(calls, 0)

  const rawError = createGoogleChatProfileIdentityService({
    getAccessToken: async () => "session-token",
    fetch: async () => json({
      ok: false,
      code: "private-key-secret raw SDK payload",
      stack: "access-token-secret",
    }, 503),
  })
  await assert.rejects(rawError.list(), /^Error: google_chat_profile_identity_request_failed$/)

  const malformed = createGoogleChatProfileIdentityService({
    getAccessToken: async () => "session-token",
    fetch: async () => json({ ...SNAPSHOT, extra: true }),
  })
  await assert.rejects(malformed.list(), /google_chat_profile_identity_snapshot_invalid/)
})

test("Directory boundary issues exact users.get parameters and returns a closed user", async () => {
  const calls = []
  const client = createGoogleWorkspaceDirectoryClient({
    configured: true,
    async getUser(parameters) {
      calls.push(parameters)
      return {
        data: {
          id: CHAT_USER_ID,
          primaryEmail: "Teacher@Example.com",
          aliases: ["alias@example.com"],
          suspended: false,
          kind: "admin#directory#user",
          secret: "must-not-cross-boundary",
        },
      }
    },
  })

  assert.deepEqual(await client.lookup("teacher@example.com"), {
    kind: "found",
    id: CHAT_USER_ID,
    primaryEmail: "Teacher@Example.com",
    aliases: ["alias@example.com"],
    suspended: false,
  })
  assert.deepEqual(calls, [{
    userKey: "teacher@example.com",
    projection: "basic",
    viewType: "admin_view",
  }])
})

test("Directory boundary closes not-found, provider, and malformed SDK results", async (t) => {
  const cases = [
    ["404", Object.assign(new Error("raw 404 user text"), { code: 404 }), "not_found"],
    ["429", Object.assign(new Error("quota secret"), { response: { status: 429 } }), "provider_error"],
    ["5xx", Object.assign(new Error("upstream secret"), { status: 503 }), "provider_error"],
    ["network", new TypeError("credential and token secret"), "provider_error"],
  ]
  for (const [name, failure, expectedKind] of cases) {
    await t.test(name, async () => {
      const client = createGoogleWorkspaceDirectoryClient({
        configured: true,
        async getUser() {
          throw failure
        },
      })
      assert.deepEqual(await client.lookup(ACCOUNT_EMAIL), { kind: expectedKind })
    })
  }

  for (const malformed of [
    null,
    {},
    { data: null },
    { data: { id: "abc", primaryEmail: ACCOUNT_EMAIL } },
    { data: { id: CHAT_USER_ID, primaryEmail: 3 } },
    { data: { id: CHAT_USER_ID, primaryEmail: ACCOUNT_EMAIL, aliases: [3] } },
    { data: { id: CHAT_USER_ID, primaryEmail: ACCOUNT_EMAIL, suspended: "false" } },
  ]) {
    const client = createGoogleWorkspaceDirectoryClient({
      configured: true,
      async getUser() {
        return malformed
      },
    })
    assert.deepEqual(await client.lookup(ACCOUNT_EMAIL), { kind: "provider_error" })
  }
})

test("production Directory readiness is not configured without all three server credentials", () => {
  const client = createProductionGoogleWorkspaceDirectoryClient({
    GOOGLE_WORKSPACE_DIRECTORY_CLIENT_EMAIL: "service@example.iam.gserviceaccount.com",
    GOOGLE_WORKSPACE_DIRECTORY_PRIVATE_KEY: "private-key-secret",
  })
  assert.deepEqual(client.configuration, { status: "not_configured", configured: false })
})

test("GET route requires bearer admin/staff and rejects query parameters", async () => {
  for (const role of ["admin", "staff"]) {
    const { handlers, actorClient } = makeRoute({ role })
    const response = await handlers.get(new Request("https://dashboard.test/api/admin/google-chat-identities", {
      headers: { Authorization: "Bearer exact-session-token" },
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), SNAPSHOT)
    assert.deepEqual(actorClient.calls.slice(0, 2), [
      { kind: "getUser", token: "exact-session-token" },
      { kind: "rpc", name: "current_dashboard_role", args: undefined },
    ])
  }

  for (const role of ["teacher", "assistant", "viewer", ""]) {
    const { handlers, actorClient } = makeRoute({ role })
    const response = await handlers.get(new Request("https://dashboard.test/api/admin/google-chat-identities", {
      headers: { Authorization: "Bearer exact-session-token" },
    }))
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { ok: false, code: "google_chat_profile_identity_forbidden" })
    assert.equal(actorClient.calls.some(({ name }) => name === "list_google_chat_profile_identities_v1"), false)
  }

  const { handlers } = makeRoute()
  assert.equal((await handlers.get(new Request(
    "https://dashboard.test/api/admin/google-chat-identities?profile_id=secret",
    { headers: { Authorization: "Bearer exact-session-token" } },
  ))).status, 400)
  assert.equal((await handlers.get(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
  ))).status, 401)
})

test("GET route returns only strict identities plus closed Directory readiness", async () => {
  const { handlers } = makeRoute({ directoryConfigured: false })
  const response = await handlers.get(new Request("https://dashboard.test/api/admin/google-chat-identities", {
    headers: { Authorization: "Bearer token" },
  }))
  assert.deepEqual(await response.json(), {
    identities: [IDENTITY],
    directory: { status: "not_configured", configured: false },
    editable: true,
  })

  const unsafe = makeRoute({ identities: [{ ...IDENTITY, rawSdkError: "credential-secret" }] })
  const unsafeResponse = await unsafe.handlers.get(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
    { headers: { Authorization: "Bearer token" } },
  ))
  assert.equal(unsafeResponse.status, 502)
  assert.deepEqual(await unsafeResponse.json(), {
    ok: false,
    code: "google_chat_profile_identity_unsafe_response",
  })
})

test("POST route exact-parses input before source, Directory, or persistence", async () => {
  const invalidBodies = [
    { ...validRequestBody(), extra: true },
    validRequestBody({ profile_id: "not-a-uuid" }),
    validRequestBody({ lookup_mode: "browser" }),
    validRequestBody({ chat_user_id: "123" }),
    validRequestBody({ lookup_mode: "manual", chat_user_id: null }),
    validRequestBody({ lookup_mode: "manual", chat_user_id: "users/123" }),
    validRequestBody({ expected_identity_revision: "01" }),
    validRequestBody({ request_id: "not-a-uuid" }),
  ]
  for (const body of invalidBodies) {
    const { handlers, serviceClient, lookups } = makeRoute()
    const response = await handlers.post(new Request(
      "https://dashboard.test/api/admin/google-chat-identities",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    ))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "google_chat_profile_identity_invalid_request",
    })
    assert.equal(serviceClient.calls.length, 0)
    assert.equal(lookups.length, 0)
  }
})

test("POST auto lookup uses current DB email and persists only the verified closed outcome", async () => {
  const { handlers, serviceClient, lookups } = makeRoute()
  const response = await handlers.post(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
    {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody()),
    },
  ))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), IDENTITY)
  assert.deepEqual(lookups, [ACCOUNT_EMAIL])
  assert.deepEqual(serviceClient.calls, [
    {
      name: "read_google_chat_profile_identity_sync_source_v1",
      args: { p_actor_profile_id: ACTOR_ID, p_profile_id: PROFILE_ID },
    },
    {
      name: "apply_google_chat_profile_identity_sync_v1",
      args: {
        p_actor_profile_id: ACTOR_ID,
        p_profile_id: PROFILE_ID,
        p_account_email_snapshot: ACCOUNT_EMAIL,
        p_lookup_mode: "auto",
        p_candidate_chat_user_id: CHAT_USER_ID,
        p_sync_outcome: "verified",
        p_expected_identity_revision: "0",
        p_request_id: REQUEST_ID,
      },
    },
  ])
})

test("POST manual lookup verifies the numeric ID and dashboard email", async () => {
  const { handlers, serviceClient, lookups } = makeRoute({
    directoryLookup: async () => ({
      kind: "found",
      id: CHAT_USER_ID,
      primaryEmail: "other@example.com",
      aliases: ["TEACHER@EXAMPLE.COM"],
      suspended: false,
    }),
  })
  const response = await handlers.post(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
    {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody({
        lookup_mode: "manual",
        chat_user_id: CHAT_USER_ID,
      })),
    },
  ))
  assert.equal(response.status, 200)
  assert.deepEqual(lookups, [CHAT_USER_ID])
  assert.deepEqual(serviceClient.calls.at(-1).args, {
    p_actor_profile_id: ACTOR_ID,
    p_profile_id: PROFILE_ID,
    p_account_email_snapshot: ACCOUNT_EMAIL,
    p_lookup_mode: "manual",
    p_candidate_chat_user_id: CHAT_USER_ID,
    p_sync_outcome: "verified",
    p_expected_identity_revision: "0",
    p_request_id: REQUEST_ID,
  })
})

test("POST closes not-found, suspended, mismatch, and provider failures before persistence", async (t) => {
  const cases = [
    ["not found", { kind: "not_found" }, "not_found"],
    ["suspended", {
      kind: "found",
      id: CHAT_USER_ID,
      primaryEmail: ACCOUNT_EMAIL,
      aliases: [],
      suspended: true,
    }, "not_found"],
    ["email mismatch", {
      kind: "found",
      id: CHAT_USER_ID,
      primaryEmail: "different@example.com",
      aliases: ["alias@example.com"],
      suspended: false,
    }, "email_mismatch"],
    ["provider", { kind: "provider_error" }, "provider_error"],
    ["wrong manual id", {
      kind: "found",
      id: "999999999",
      primaryEmail: ACCOUNT_EMAIL,
      aliases: [],
      suspended: false,
    }, "provider_error"],
  ]
  for (const [name, result, expectedOutcome] of cases) {
    await t.test(name, async () => {
      const { handlers, serviceClient } = makeRoute({
        directoryLookup: async () => result,
      })
      const manual = name === "wrong manual id"
      const response = await handlers.post(new Request(
        "https://dashboard.test/api/admin/google-chat-identities",
        {
          method: "POST",
          headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
          body: JSON.stringify(validRequestBody(manual ? {
            lookup_mode: "manual",
            chat_user_id: CHAT_USER_ID,
          } : {})),
        },
      ))
      assert.equal(response.status, 200)
      const apply = serviceClient.calls.at(-1)
      assert.equal(apply.name, "apply_google_chat_profile_identity_sync_v1")
      assert.equal(apply.args.p_sync_outcome, expectedOutcome)
      assert.equal(apply.args.p_candidate_chat_user_id, null)
    })
  }
})

test("missing Directory credentials never persist and raw provider failures never escape", async () => {
  const missing = makeRoute({ directoryConfigured: false })
  const missingResponse = await missing.handlers.post(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
    {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody()),
    },
  ))
  assert.equal(missingResponse.status, 503)
  assert.deepEqual(await missingResponse.json(), {
    ok: false,
    code: "google_chat_directory_not_configured",
  })
  assert.equal(
    missing.serviceClient.calls.some(({ name }) => name === "apply_google_chat_profile_identity_sync_v1"),
    false,
  )

  const secret = "private-key-secret access-token-secret raw-sdk-stack"
  const failed = makeRoute({
    directoryLookup: async () => {
      throw new Error(secret)
    },
  })
  const failedResponse = await failed.handlers.post(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
    {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody()),
    },
  ))
  const serialized = JSON.stringify(await failedResponse.json())
  assert.equal(failedResponse.status, 200)
  assert.doesNotMatch(serialized, /private-key|access-token|raw-sdk|stack/iu)
  assert.equal(failed.serviceClient.calls.at(-1).args.p_sync_outcome, "provider_error")
})

test("POST rejects stale source revisions before Directory lookup", async () => {
  const { handlers, serviceClient, lookups } = makeRoute({
    source: { ...SOURCE, identityRevision: "2" },
  })
  const response = await handlers.post(new Request(
    "https://dashboard.test/api/admin/google-chat-identities",
    {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody()),
    },
  ))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "google_chat_profile_identity_revision_conflict",
  })
  assert.equal(lookups.length, 0)
  assert.equal(
    serviceClient.calls.some(({ name }) => name === "apply_google_chat_profile_identity_sync_v1"),
    false,
  )
})

test("production modules keep the official minimal SDK server-only and App Route exact", async () => {
  const [directorySource, appRouteSource, packageJson, lockfile] = await Promise.all([
    readFile(new URL("src/features/management/server/google-workspace-directory-client.ts", root), "utf8"),
    readFile(new URL("src/app/api/admin/google-chat-identities/route.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("pnpm-lock.yaml", root), "utf8"),
  ])
  assert.match(directorySource, /import \{ admin, auth \} from "@googleapis\/admin"/)
  assert.match(directorySource, /new auth\.JWT\(\{[\s\S]*email: clientEmail,[\s\S]*key: privateKey\.replace\(\/\\\\n\/gu, "\\n"\),[\s\S]*scopes: \["https:\/\/www\.googleapis\.com\/auth\/admin\.directory\.user\.readonly"\],[\s\S]*subject,[\s\S]*\}\)/)
  assert.match(directorySource, /admin\(\{ version: "directory_v1", auth: jwt \}\)/)
  assert.doesNotMatch(directorySource, /console\.(?:log|error|warn)/)
  assert.match(appRouteSource, /export const runtime = "nodejs"/)
  assert.match(appRouteSource, /export function GET/)
  assert.match(appRouteSource, /export function POST/)

  const parsedPackage = JSON.parse(packageJson)
  assert.equal(parsedPackage.dependencies["@googleapis/admin"], "31.0.0")
  assert.equal(Object.hasOwn(parsedPackage.dependencies, "googleapis"), false)
  assert.match(
    lockfile,
    /'@googleapis\/admin':\n\s+specifier: 31\.0\.0\n\s+version: 31\.0\.0/,
  )
})
