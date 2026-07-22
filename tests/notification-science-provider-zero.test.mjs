import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const scienceMigrationUrl = new URL(
  "../supabase/migrations/20260722120000_science_notification_connection.sql",
  import.meta.url,
)
const prepareAclMigrationUrl = new URL(
  "../supabase/migrations/20260722130000_notification_prepare_acl_hardening.sql",
  import.meta.url,
)
const notificationRuntimePgTapUrl = new URL(
  "../supabase/tests/notification_control_plane_runtime_test.sql",
  import.meta.url,
)
const PREPARE_FUNCTION_SIGNATURE =
  "public.prepare_notification_immediate_delivery_v1(text,uuid,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)"
const PREPARE_ACL_MIGRATION_SHA256 =
  "970d203f816736b05ed56d973d415a75e00e2f659f55f84c7831c60db8c261a3"
const runtimeFlagsMigrationUrl = new URL(
  "../supabase/migrations/20260716110000_notification_control_plane_expand.sql",
  import.meta.url,
)
const repositoryModuleUrl = new URL(
  "../src/features/notifications/server/notification-connection-repository.ts",
  import.meta.url,
)

const originalFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls += 1
  throw new Error("science provider-zero test must not fetch")
}

test.after(() => {
  globalThis.fetch = originalFetch
  assert.equal(fetchCalls, 0, "fetch calls 0")
})

test("science migration aborts before data changes unless every existing runtime flag is false", async () => {
  const [migration, runtimeFlagsMigration] = await Promise.all([
    readFile(scienceMigrationUrl, "utf8"),
    readFile(runtimeFlagsMigrationUrl, "utf8"),
  ])
  const seededFlags = [...runtimeFlagsMigration.matchAll(
    /\('(?<key>notification_control_plane_[a-z_]+)',\s*false,\s*1\)/g,
  )].map((match) => match.groups.key)
  assert.equal(seededFlags.length, 12)
  assert.equal(new Set(seededFlags).size, 12)

  const guard = migration.indexOf("science_notification_provider_zero_required")
  const firstAlter = migration.search(/alter\s+table\s+public\.google_chat_webhook_settings/i)
  const firstInsert = migration.search(/insert\s+into\s+public\.google_chat_webhook_settings/i)
  const firstFunction = migration.search(/create\s+or\s+replace\s+function/i)
  const dataPhase = migration.slice(0, firstFunction)
  assert.ok(guard >= 0 && guard < firstAlter && guard < firstInsert)
  assert.match(
    migration,
    /check\s*\(\s*channel\s+in\s*\(\s*'executive'\s*,\s*'admin'\s*,\s*'math'\s*,\s*'english'\s*,\s*'science'\s*\)\s*\)/i,
  )
  assert.match(
    migration,
    /if\s+exists\s*\([\s\S]*?from\s+dashboard_private\.notification_runtime_flags[\s\S]*?where\s+flag_row\.enabled\s+is\s+true[\s\S]*?raise\s+exception\s+'science_notification_provider_zero_required'/i,
  )
  assert.doesNotMatch(dataPhase, /(?:insert\s+into|update)\s+dashboard_private\.notification_runtime_flags/i)
  assert.doesNotMatch(dataPhase, /(?:insert\s+into|update)\s+dashboard_private\.notification_rules/i)
  assert.doesNotMatch(dataPhase, /(?:insert\s+into|update)\s+dashboard_private\.notification_cutover_owners/i)
  assert.doesNotMatch(
    migration,
    /cron\.schedule|net\.http|fetch\s*\(|sendVerification|google_chat_provider/i,
  )
})

test("science connection SQL keeps admin-only CAS, encrypted writes, and safe audit boundaries", async () => {
  const migration = await readFile(scienceMigrationUrl, "utf8")
  for (const qualifiedName of [
    "dashboard_private.notification_google_chat_audience_ready_v1",
    "dashboard_private.replace_google_chat_connection_v1_impl",
    "dashboard_private.disconnect_google_chat_connection_v1_impl",
    "dashboard_private.begin_google_chat_connection_verification_v1_impl",
    "dashboard_private.record_google_chat_connection_verification_v1_impl",
    "dashboard_private.notification_connection_safe_json_v1",
    "dashboard_private.notification_control_plane_snapshot_v1",
    "dashboard_private.save_notification_control_plane_unchecked_v1",
    "public.backfill_google_chat_connection_encryption_v1",
    "public.prepare_notification_immediate_delivery_v1",
  ]) {
    assert.match(
      migration,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+${qualifiedName.replaceAll(".", "\\.")}\\b`, "i"),
    )
  }
  assert.equal((migration.match(/profile\.role\s*=\s*'admin'/g) ?? []).length, 4)
  assert.match(migration, /notification_connection_revision_conflict/i)
  assert.match(migration, /webhook_url_ciphertext\s*!~\s*'\^v1:/i)
  assert.match(migration, /notification_request_ledger/i)
  assert.match(migration, /notification_audit_logs/i)
  assert.match(migration, /notification_connection_safe_json_v1/i)
  assert.doesNotMatch(migration, /grant\s+execute[\s\S]*authenticated/i)
})

test("prepare ACL hardening is one exact forward-only service-role contract", async () => {
  const pgTap = await readFile(notificationRuntimePgTapUrl, "utf8")
  assert.match(pgTap, /select\s+plan\(228\);/i)
  assert.equal((pgTap.match(new RegExp(PREPARE_FUNCTION_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 4)
  assert.match(
    pgTap,
    /has_function_privilege\(\s*'service_role',[\s\S]*?'EXECUTE'\s*\)[\s\S]*?and\s+not\s+pg_catalog\.has_function_privilege\(\s*'anon',[\s\S]*?'EXECUTE'\s*\)[\s\S]*?and\s+not\s+pg_catalog\.has_function_privilege\(\s*'authenticated',[\s\S]*?'EXECUTE'\s*\)/i,
  )
  assert.match(pgTap, /pg_catalog\.count\(\*\)\s*=\s*2/i)
  assert.match(pgTap, /acl_row\.grantee\s*=\s*function_row\.proowner/i)
  assert.match(pgTap, /role_row\.rolname\s*=\s*'service_role'/i)
  assert.equal((pgTap.match(/acl_row\.is_grantable\s+is\s+false/gi) ?? []).length >= 2, true)

  const migration = await readFile(prepareAclMigrationUrl, "utf8")
  assert.equal(createHash("sha256").update(migration).digest("hex"), PREPARE_ACL_MIGRATION_SHA256)
  assert.match(migration, /^begin;\n/i)
  assert.match(migration, /\ncommit;\n$/i)
  assert.match(migration, /set\s+local\s+lock_timeout\s*=\s*'5s';/i)
  assert.match(migration, /set\s+local\s+statement_timeout\s*=\s*'30s';/i)
  assert.match(migration, /set\s+local\s+search_path\s*=\s*'';/i)
  assert.equal((migration.match(new RegExp(PREPARE_FUNCTION_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 2)
  assert.match(
    migration,
    /alter\s+function\s+public\.prepare_notification_immediate_delivery_v1\([\s\S]*?timestamptz,\s*jsonb\s*\)\s+owner\s+to\s+postgres;/i,
  )
  assert.match(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.prepare_notification_immediate_delivery_v1\([\s\S]*?timestamptz,\s*jsonb\s*\)\s+from\s+public,\s*anon,\s*authenticated,\s*service_role;/i,
  )
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.prepare_notification_immediate_delivery_v1\([\s\S]*?timestamptz,\s*jsonb\s*\)\s+to\s+service_role;/i,
  )
  assert.match(migration, /pg_catalog\.to_regprocedure\(/i)
  assert.match(migration, /function_row\.prosecdef/i)
  assert.match(migration, /pg_catalog\.pg_get_userbyid\(function_row\.proowner\)/i)
  assert.match(migration, /pg_catalog\.has_function_privilege\(\s*'service_role'/i)
  assert.match(migration, /pg_catalog\.has_function_privilege\(\s*'anon'/i)
  assert.match(migration, /pg_catalog\.has_function_privilege\(\s*'authenticated'/i)
  assert.match(migration, /pg_catalog\.count\(\*\)\s*=\s*2/i)
  assert.match(migration, /acl_row\.grantee\s*=\s*v_owner_oid/i)
  assert.match(migration, /acl_row\.grantee\s*=\s*v_service_role_oid/i)
  assert.equal((migration.match(/acl_row\.is_grantable\s+is\s+false/gi) ?? []).length, 2)
  assert.match(migration, /v_acl_is_exact\s+is\s+not\s+true/i)
  assert.doesNotMatch(migration, /\bcreate\s+(?:or\s+replace\s+)?function\b|\bdrop\s+function\b/i)
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i)
  assert.doesNotMatch(
    migration,
    /notification_runtime_flags|google_chat_webhook_settings|cron\.schedule|net\.http|fetch\s*\(|provider|secret/i,
  )
})

test("science row is seeded disconnected with no secret and snapshot listing makes provider/fetch calls 0", async () => {
  const migration = await readFile(scienceMigrationUrl, "utf8")
  assert.match(
    migration,
    /values\s*\(\s*'science'\s*,\s*''\s*,\s*null\s*,\s*null\s*,\s*'disconnected'\s*,\s*1\s*,\s*null\s*,\s*null\s*,\s*null\s*\)/i,
  )
  assert.match(migration, /on\s+conflict\s*\(\s*channel\s*\)\s+do\s+nothing/i)

  const { createNotificationConnectionRepository } = await import(repositoryModuleUrl)
  let providerCalls = 0
  const repository = createNotificationConnectionRepository({
    encryptionKey: Buffer.alloc(32, 9).toString("base64"),
    store: {
      async listRows() {
        return [{
          channel: "science",
          webhook_url: "",
          webhook_url_ciphertext: null,
          webhook_url_mask: null,
          connection_state: "disconnected",
          revision: "1",
          updated_by: null,
          last_verified_at: null,
          last_error_code: null,
        }]
      },
    },
    async sendVerification() {
      providerCalls += 1
      return { succeeded: true, resultCode: "accepted" }
    },
  })

  const result = await repository.listConnections()
  assert.deepEqual(result, [{
    connectionKey: "google_chat.science",
    connectionState: "disconnected",
    revision: "1",
    configured: false,
    webhookUrlMask: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    editable: true,
  }])
  assert.equal(providerCalls, 0, "provider calls 0")
  assert.equal(fetchCalls, 0, "fetch calls 0")
})
