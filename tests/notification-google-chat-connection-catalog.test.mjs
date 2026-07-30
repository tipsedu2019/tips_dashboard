import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { NOTIFICATION_CONNECTION_KEYS } from "../src/features/notifications/notification-control-plane-types.ts"
import { createNotificationConnectionRepository } from "../src/features/notifications/server/notification-connection-repository.ts"
import {
  findGoogleChatConnectionFallbackConflicts,
  runGoogleChatConnectionFallbackPreflight,
} from "../scripts/preflight-google-chat-connection-fallbacks.mjs"

const migrationUrl = new URL(
  "../supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql",
  import.meta.url,
)
const preflightUrl = new URL(
  "../scripts/preflight-google-chat-connection-fallbacks.mjs",
  import.meta.url,
)

const GOOGLE_CHAT_URL =
  "https://chat.googleapis.com/v1/spaces/SPACEIDENTIFIER123456/messages?key=key-secret&token=token-secret"
const ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64")

const EXPECTED_CONNECTION_KEYS = [
  "google_chat.management",
  "google_chat.executive",
  "google_chat.english",
  "google_chat.math",
  "google_chat.science",
]

function makeRow(channel) {
  return {
    channel,
    webhook_url: GOOGLE_CHAT_URL,
    webhook_url_ciphertext: null,
    webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
    connection_state: "legacy_active",
    revision: "1",
    last_verified_at: null,
    last_error_code: null,
  }
}

test("Google Chat connection keys have the exact five-slot operator order", () => {
  assert.deepEqual(NOTIFICATION_CONNECTION_KEYS, EXPECTED_CONNECTION_KEYS)
  assert.equal(NOTIFICATION_CONNECTION_KEYS.some((key) => key.includes("assistant")), false)
})

test("connection repository projects missing fixed slots without writing rows", async () => {
  const rows = [makeRow("admin"), makeRow("executive"), makeRow("science")]
  let listCalls = 0
  const repository = createNotificationConnectionRepository({
    encryptionKey: ENCRYPTION_KEY,
    store: {
      async listRows() {
        listCalls += 1
        return structuredClone(rows)
      },
      async getRow() {
        throw new Error("not used")
      },
      async beginVerificationAtomic() {
        throw new Error("not used")
      },
      async replaceAtomic() {
        throw new Error("not used")
      },
      async disconnectAtomic() {
        throw new Error("not used")
      },
      async recordVerificationAtomic() {
        throw new Error("not used")
      },
    },
    async sendVerification() {
      throw new Error("listing connections must not send a provider request")
    },
  })

  const connections = await repository.listConnections()

  assert.equal(listCalls, 1)
  assert.deepEqual(connections.map((connection) => connection.connectionKey), EXPECTED_CONNECTION_KEYS)
  assert.deepEqual(connections.slice(2, 4), [
    {
      connectionKey: "google_chat.english",
      connectionState: "disconnected",
      revision: "0",
      configured: false,
      webhookUrlMask: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      editable: true,
    },
    {
      connectionKey: "google_chat.math",
      connectionState: "disconnected",
      revision: "0",
      configured: false,
      webhookUrlMask: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      editable: true,
    },
  ])
  assert.equal(rows.length, 3)
})

test("preflight reports only missing fixed slots with a valid legacy fallback", () => {
  assert.deepEqual(
    findGoogleChatConnectionFallbackConflicts({
      storedChannels: ["admin", "science"],
      environment: {
        GOOGLE_CHAT_WEBHOOK_EXECUTIVE: GOOGLE_CHAT_URL,
        GOOGLE_CHAT_WEBHOOK_ENGLISH: GOOGLE_CHAT_URL,
        GOOGLE_CHAT_WEBHOOK_MATH: "not-a-webhook",
      },
    }),
    ["google_chat.executive", "google_chat.english"],
  )
})

test("connection catalog migration keeps the snapshot frame and projects five virtual-safe slots", async () => {
  const migration = await readFile(migrationUrl, "utf8")

  assert.match(migration, /^begin;\nset local lock_timeout = '5s';/i)
  assert.match(migration, /create or replace function dashboard_private\.notification_control_plane_snapshot_v1\(\s*p_workflow_key text,\s*p_editable boolean\s*\)/i)
  assert.match(migration, /language sql\s+stable\s+security definer\s+set search_path = ''/i)
  assert.match(
    migration,
    /\(1,\s*'admin'.*google_chat\.management[\s\S]*\(2,\s*'executive'.*google_chat\.executive[\s\S]*\(3,\s*'english'.*google_chat\.english[\s\S]*\(4,\s*'math'.*google_chat\.math[\s\S]*\(5,\s*'science'.*google_chat\.science/i,
  )
  assert.match(migration, /left join public\.google_chat_webhook_settings connection_row/i)
  assert.match(migration, /'connection_state',\s*'disconnected'[\s\S]*'revision',\s*'0'[\s\S]*'configured',\s*false/i)
  assert.match(migration, /'delivery_summary'[\s\S]*dashboard_private\.notification_deliveries/i)
  assert.match(migration, /owner to postgres;[\s\S]*revoke all on function[\s\S]*from public, anon, authenticated, service_role;[\s\S]*commit;/i)
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i)
})

test("preflight reads only channel metadata and emits no secret-bearing result", async () => {
  const calls = []
  const result = await runGoogleChatConnectionFallbackPreflight({
    environment: {
      NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    },
    createClientImpl(url, key, options) {
      calls.push({ operation: "createClient", url, key, options })
      return {
        from(table) {
          calls.push({ operation: "from", table })
          return {
            async select(columns) {
              calls.push({ operation: "select", columns })
              return { data: [{ channel: "admin" }], error: null }
            },
          }
        },
      }
    },
  })

  assert.deepEqual(result, { ok: true, checkedChannelCount: 1 })
  assert.deepEqual(calls.slice(1), [
    { operation: "from", table: "google_chat_webhook_settings" },
    { operation: "select", columns: "channel" },
  ])
  assert.doesNotMatch(JSON.stringify(result), /service-role-secret|key-secret|token-secret/)
})

test("preflight CLI is direct-run guarded and reports closed safe messages", async () => {
  const source = await readFile(preflightUrl, "utf8")
  assert.match(source, /pathToFileURL/)
  assert.match(source, /isDirectRun\(\)/)
  assert.match(source, /google_chat_connection_preflight_passed/)
  assert.match(source, /google_chat_connection_preflight_failed/)
  assert.match(source, /process\.exitCode\s*=\s*1/)
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:serviceRoleKey|environment\[|webhook)/)
})
