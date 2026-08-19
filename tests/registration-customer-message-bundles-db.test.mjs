import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url)

async function bundleMigration() {
  const names = (await readdir(migrationDirectory)).filter((name) => (
    name.endsWith("_registration_customer_message_bundles.sql")
  ))
  assert.deepEqual(names.length, 1, "exactly one CLI-created bundle migration is required")
  return readFile(new URL(names[0], migrationDirectory), "utf8")
}

test("bundle migration installs private manifests with runtime 0 and no provider attempt", async () => {
  const sql = await bundleMigration()
  assert.match(sql, /create table dashboard_private\.registration_customer_message_bundles/iu)
  assert.match(sql, /create table dashboard_private\.registration_customer_message_bundle_items/iu)
  assert.match(sql, /create table dashboard_private\.registration_customer_message_bundle_runs/iu)
  assert.match(sql, /active_version integer not null default 0/iu)
  assert.match(sql, /'0 1 \* \* \*'/u)
  assert.doesNotMatch(sql, /update[\s\S]+provider_attempt_count\s*=\s*1/iu)
  assert.match(sql, /values[\s\S]+'level_test_booking_bundle'[\s\S]+'off'/iu)
  assert.match(sql, /guard_registration_customer_message_bundle_item_v1/iu)
  assert.match(sql, /before update or delete on dashboard_private\.registration_customer_message_bundle_items/iu)
  assert.match(sql, /registration_customer_message_bundle_status_transition_invalid/iu)
  assert.match(sql, /collect_registration_customer_message_bundle_items_v1/iu)
  assert.match(sql, /registration_customer_message_bundle_source_ambiguous/iu)
  assert.match(sql, /materialize_registration_customer_message_bundle_v1/iu)
  assert.match(sql, /pg_advisory_xact_lock/iu)
  assert.match(sql, /insert into dashboard_private\.registration_customer_message_bundles/iu)
  assert.doesNotMatch(sql, /registration_customer_message_bundle_materializer_not_enabled/iu)
  assert.match(sql, /get_registration_customer_message_bundle_runtime_v1/iu)
  assert.match(sql, /'installedVersion', v_runtime\.installed_version/iu)
  assert.match(sql, /'activeVersion', v_runtime\.active_version/iu)
})

test("bundle migration preserves legacy rows and keeps new storage private", async () => {
  const sql = await bundleMigration()
  assert.match(sql, /enable row level security/iu)
  assert.match(sql, /revoke all on table dashboard_private\.registration_customer_message_bundles from public, anon, authenticated, service_role/iu)
  assert.doesNotMatch(sql, /delete from public\.ops_registration_customer_messages/iu)
  assert.doesNotMatch(sql, /delete from public\.ops_registration_customer_message_previews/iu)
  assert.doesNotMatch(sql, /update public\.ops_registration_customer_messages[\s\S]+set[\s\S]+message_kind/iu)
})
