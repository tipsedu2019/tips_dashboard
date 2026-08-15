import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260815093650_fix_observation_frozen_state_rpc_name.sql",
  import.meta.url,
)
const workerUrl = new URL(
  "../src/features/notifications/server/notification-worker.ts",
  import.meta.url,
)

test("observation frozen-state RPC stays within PostgreSQL identifier limits", async () => {
  const [migration, worker] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(workerUrl, "utf8"),
  ])

  const rpcName = "read_registration_observation_delivery_frozen_state_v1"
  assert.ok(Buffer.byteLength(rpcName, "utf8") <= 63)
  assert.match(migration, new RegExp(`rename to ${rpcName}`, "i"))
  assert.match(worker, new RegExp(`rpc\\(\\s*"${rpcName}"`))
  assert.doesNotMatch(worker, /read_registration_observation_notification_delivery_frozen_state_v1/)
})
