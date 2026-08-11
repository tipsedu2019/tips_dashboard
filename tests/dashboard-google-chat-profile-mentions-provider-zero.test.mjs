import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { createGoogleChatProfileIdentityRouteHandlers } from "../src/features/management/server/google-chat-profile-identity-route.ts"
import { createNotificationMentionSettingsRouteHandlers } from "../src/features/notifications/server/notification-mention-settings-route.ts"
import { createGoogleChatProvider } from "../src/features/notifications/server/providers/google-chat-provider.ts"

const ACTOR_ID = "99500000-0000-4000-8000-000000000001"
const PROFILE_ID = "99500000-0000-4000-8000-000000000101"
const RULE_ID = "99500000-0000-4000-8000-000000000201"
const DELIVERY_ID = "99500000-0000-4000-8000-000000000301"
const CLAIM_TOKEN = "99500000-0000-4000-8000-000000000302"
const IDENTITY_REQUEST_ID = "99500000-0000-4000-8000-000000000401"
const SETTING_REQUEST_ID = "99500000-0000-4000-8000-000000000402"
const CHAT_USER_ID = "12345678901234567890"
const ACCOUNT_EMAIL = "provider-zero@example.com"

const UNSYNCED_IDENTITY = Object.freeze({
  profileId: PROFILE_ID,
  profileName: "Provider Zero 선생님",
  accountEmail: ACCOUNT_EMAIL,
  dashboardRole: "teacher",
  chatUserId: null,
  resourceName: null,
  source: null,
  verificationStatus: "unverified",
  verifiedAt: null,
  lastSyncStatus: null,
  lastSyncAt: null,
  identityRevision: "0",
  eligible: false,
})

const VERIFIED_IDENTITY = Object.freeze({
  ...UNSYNCED_IDENTITY,
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

const SYNC_SOURCE = Object.freeze({
  profileId: PROFILE_ID,
  profileName: UNSYNCED_IDENTITY.profileName,
  accountEmail: ACCOUNT_EMAIL,
  dashboardRole: "teacher",
  identityRevision: "0",
})

function request(url, method = "GET", body) {
  return new Request(url, {
    method,
    headers: {
      Authorization: "Bearer provider-zero-session",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function createFoundationFixture({ directoryConfigured = true } = {}) {
  const counters = {
    directoryCalls: 0,
    webhookFetchCalls: 0,
  }
  const rpcCalls = []
  const snapshots = new Map()
  const state = {
    identities: [UNSYNCED_IDENTITY],
    mentionSettings: [],
  }

  function adoptedSetting(overrides = {}) {
    return {
      ruleId: RULE_ID,
      workflowKey: "registration",
      eventKey: "registration.observation.provider_zero",
      channelKey: "google_chat",
      mentionEnabled: false,
      revision: "1",
      updatedAt: null,
      editable: true,
      ...overrides,
    }
  }

  function resolveMentions(profileIds) {
    const uniqueProfileIds = [...new Set(profileIds)]
    const verified = uniqueProfileIds.filter((profileId) => state.identities.some((identity) => (
      identity.profileId === profileId && identity.eligible
    )))
    return {
      profile_ids: verified,
      user_names: verified.map(() => `users/${CHAT_USER_ID}`),
      omitted: uniqueProfileIds
        .filter((profileId) => !verified.includes(profileId))
        .map((profileId) => ({ profile_id: profileId, reason: "identity_unverified" })),
      identity_revision_fingerprint: "a".repeat(64),
    }
  }

  const actorClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: ACTOR_ID } }, error: null }
      },
    },
    async rpc(name, args) {
      rpcCalls.push({ client: "actor", name, args })
      if (name === "current_dashboard_role") return { data: "admin", error: null }
      if (name === "list_google_chat_profile_identities_v1") {
        return { data: state.identities, error: null }
      }
      throw new Error(`unexpected_actor_rpc:${name}`)
    },
  }

  const serviceClient = {
    async rpc(name, args = {}) {
      rpcCalls.push({ client: "service", name, args })
      if (name === "read_google_chat_profile_identity_sync_source_v1") {
        return { data: SYNC_SOURCE, error: null }
      }
      if (name === "apply_google_chat_profile_identity_sync_v1") {
        state.identities = [VERIFIED_IDENTITY]
        return { data: VERIFIED_IDENTITY, error: null }
      }
      if (name === "resolve_google_chat_profile_mentions_v1") {
        return { data: resolveMentions(args.p_profile_ids), error: null }
      }
      if (name === "prepare_google_chat_delivery_mention_snapshot_v1") {
        const existing = snapshots.get(args.p_delivery_id)
        if (args.p_retry_frozen) return { data: existing, error: null }
        const setting = state.mentionSettings.find((row) => row.ruleId === args.p_rule_id)
        const resolved = setting?.mentionEnabled
          ? resolveMentions(args.p_profile_ids)
          : {
              profile_ids: [],
              user_names: [],
              omitted: [],
              identity_revision_fingerprint: "b".repeat(64),
            }
        const snapshot = Object.freeze({
          ...resolved,
          mention_enabled: setting?.mentionEnabled === true,
          setting_revision: setting?.revision ?? "0",
        })
        snapshots.set(args.p_delivery_id, snapshot)
        return { data: snapshot, error: null }
      }
      throw new Error(`unexpected_service_rpc:${name}`)
    },
  }

  const directory = {
    configuration: Object.freeze({
      status: directoryConfigured ? "ready" : "not_configured",
      configured: directoryConfigured,
    }),
    async lookup(userKey) {
      counters.directoryCalls += 1
      assert.equal(userKey, ACCOUNT_EMAIL)
      return {
        kind: "found",
        id: CHAT_USER_ID,
        primaryEmail: ACCOUNT_EMAIL,
        aliases: [],
        suspended: false,
      }
    },
  }

  const identityRoute = createGoogleChatProfileIdentityRouteHandlers({
    createAuthenticatedClient: () => actorClient,
    createServiceClient: () => serviceClient,
    directory,
  })

  const mentionRoute = createNotificationMentionSettingsRouteHandlers({
    authenticate: async () => ({ userId: ACTOR_ID, role: "admin", client: actorClient }),
    getMentionSettings: async ({ workflowKey }) => state.mentionSettings
      .filter((setting) => setting.workflowKey === workflowKey),
    saveMentionSetting: async ({ ruleId, mentionEnabled, expectedRevision }) => {
      const current = state.mentionSettings.find((setting) => setting.ruleId === ruleId)
      assert.ok(current)
      assert.equal(current.revision, expectedRevision)
      const next = adoptedSetting({
        mentionEnabled,
        revision: String(Number(current.revision) + 1),
        updatedAt: "2026-08-11T00:01:00.000Z",
      })
      state.mentionSettings = [next]
      return next
    },
  })

  const provider = createGoogleChatProvider({
    async fetch() {
      counters.webhookFetchCalls += 1
      throw new Error("provider transport must stay disabled")
    },
  })

  return {
    counters,
    rpcCalls,
    snapshots,
    state,
    identityRoute,
    mentionRoute,
    provider,
    serviceClient,
    adoptRule() {
      state.mentionSettings = [adoptedSetting()]
    },
  }
}

async function rpcData(client, name, args) {
  const result = await client.rpc(name, args)
  assert.equal(result.error, null)
  return result.data
}

test("readiness and missing credentials exercise real routes with zero Directory or webhook calls", async () => {
  const ready = createFoundationFixture()
  const response = await ready.identityRoute.get(request(
    "https://dashboard.test/api/admin/google-chat-identities",
  ))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    identities: [UNSYNCED_IDENTITY],
    directory: { status: "ready", configured: true },
    editable: true,
  })

  const missing = createFoundationFixture({ directoryConfigured: false })
  const missingResponse = await missing.identityRoute.post(request(
    "https://dashboard.test/api/admin/google-chat-identities",
    "POST",
    {
      profile_id: PROFILE_ID,
      lookup_mode: "auto",
      chat_user_id: null,
      expected_identity_revision: "0",
      request_id: IDENTITY_REQUEST_ID,
    },
  ))
  assert.equal(missingResponse.status, 503)
  assert.deepEqual(await missingResponse.json(), {
    ok: false,
    code: "google_chat_directory_not_configured",
  })

  const noConnection = await ready.provider.send({
    delivery_id: DELIVERY_ID,
    claim_token: CLAIM_TOKEN,
    dispatch_token: "99500000-0000-4000-8000-000000000303",
    status: "sending",
    channel_key: "google_chat",
    connection_key: null,
    webhook_url: null,
    rendered_title: "Provider-zero",
    rendered_body: "연결이 없으면 외부 호출을 시작하지 않습니다.",
    href: null,
  })
  assert.equal(noConnection.status, "failed")
  assert.equal(noConnection.statusReason, "connection_missing")
  assert.deepEqual(ready.counters, { directoryCalls: 0, webhookFetchCalls: 0 })
  assert.deepEqual(missing.counters, { directoryCalls: 0, webhookFetchCalls: 0 })
})

test("explicit sync, setting, resolver, and frozen snapshot transitions remain webhook-provider-zero", async () => {
  const fixture = createFoundationFixture()

  const emptySettings = await fixture.mentionRoute.get(request(
    "https://dashboard.test/api/notifications/mention-settings?workflow_key=registration",
  ))
  assert.deepEqual(await emptySettings.json(), { settings: [] })

  const syncResponse = await fixture.identityRoute.post(request(
    "https://dashboard.test/api/admin/google-chat-identities",
    "POST",
    {
      profile_id: PROFILE_ID,
      lookup_mode: "auto",
      chat_user_id: null,
      expected_identity_revision: "0",
      request_id: IDENTITY_REQUEST_ID,
    },
  ))
  assert.equal(syncResponse.status, 200)
  assert.deepEqual(await syncResponse.json(), VERIFIED_IDENTITY)
  assert.equal(fixture.counters.directoryCalls, 1)
  assert.equal(fixture.counters.webhookFetchCalls, 0)

  fixture.adoptRule()
  const settingResponse = await fixture.mentionRoute.patch(request(
    "https://dashboard.test/api/notifications/mention-settings",
    "PATCH",
    {
      rule_id: RULE_ID,
      mention_enabled: true,
      expected_revision: "1",
      request_id: SETTING_REQUEST_ID,
    },
  ))
  assert.equal(settingResponse.status, 200)
  assert.deepEqual((await settingResponse.json()).setting, {
    rule_id: RULE_ID,
    workflow_key: "registration",
    event_key: "registration.observation.provider_zero",
    channel_key: "google_chat",
    mention_enabled: true,
    revision: "2",
    updated_at: "2026-08-11T00:01:00.000Z",
    editable: true,
  })

  const resolved = await rpcData(
    fixture.serviceClient,
    "resolve_google_chat_profile_mentions_v1",
    { p_profile_ids: [PROFILE_ID, PROFILE_ID] },
  )
  assert.deepEqual(resolved, {
    profile_ids: [PROFILE_ID],
    user_names: [`users/${CHAT_USER_ID}`],
    omitted: [],
    identity_revision_fingerprint: "a".repeat(64),
  })

  const first = await rpcData(
    fixture.serviceClient,
    "prepare_google_chat_delivery_mention_snapshot_v1",
    {
      p_delivery_id: DELIVERY_ID,
      p_claim_token: CLAIM_TOKEN,
      p_rule_id: RULE_ID,
      p_profile_ids: [PROFILE_ID],
      p_retry_frozen: false,
    },
  )
  fixture.state.identities = [UNSYNCED_IDENTITY]
  fixture.state.mentionSettings = [{ ...fixture.state.mentionSettings[0], mentionEnabled: false }]
  const retry = await rpcData(
    fixture.serviceClient,
    "prepare_google_chat_delivery_mention_snapshot_v1",
    {
      p_delivery_id: DELIVERY_ID,
      p_claim_token: CLAIM_TOKEN,
      p_rule_id: RULE_ID,
      p_profile_ids: [],
      p_retry_frozen: true,
    },
  )
  assert.deepEqual(retry, first)
  assert.equal(first.mention_enabled, true)
  assert.deepEqual(first.user_names, [`users/${CHAT_USER_ID}`])
  assert.deepEqual(fixture.counters, { directoryCalls: 1, webhookFetchCalls: 0 })
})

test("notification worker dependency graph has no management Directory import", async () => {
  const source = await readFile(
    new URL("../src/features/notifications/server/notification-worker.ts", import.meta.url),
    "utf8",
  )
  const imports = [
    ...source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu),
  ].map((match) => match[1])
  assert.equal(
    imports.some((specifier) => (
      specifier.includes("google-workspace-directory")
      || specifier.includes("google-chat-profile-identity")
      || specifier.includes("/management/")
    )),
    false,
  )
})
