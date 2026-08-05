import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const catalogUrl = new URL(
  "../supabase/migrations/20260730161538_notification_google_chat_connection_catalog.sql",
  import.meta.url,
)
const ownerUrl = new URL(
  "../supabase/migrations/20260731011229_notification_owner_aware_delivery_summary.sql",
  import.meta.url,
)

function normalizeSql(value) {
  return value.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

function snapshotFunction(source) {
  const start = source.indexOf("create or replace function dashboard_private.notification_control_plane_snapshot_v1")
  const end = source.indexOf("\n$$;", start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end + 4)
}

test("owner-aware summary preserves the fixed five-slot snapshot outside delivery summary", async () => {
  const [catalog, owner] = await Promise.all([readFile(catalogUrl, "utf8"), readFile(ownerUrl, "utf8")])
  const catalogFunction = snapshotFunction(catalog)
  const ownerFunction = snapshotFunction(owner)
  const catalogBefore = normalizeSql(catalogFunction.slice(0, catalogFunction.indexOf("'delivery_summary'")))
  const ownerBefore = normalizeSql(ownerFunction.slice(0, ownerFunction.indexOf("'delivery_summary'")))
  const catalogAfter = normalizeSql(catalogFunction.slice(catalogFunction.indexOf("'loaded_at'")))
  const ownerAfter = normalizeSql(ownerFunction.slice(ownerFunction.indexOf("'loaded_at'")))
  assert.equal(ownerBefore, catalogBefore)
  assert.equal(ownerAfter, catalogAfter)
})

test("owner-aware summary uses only the six-field logical identity and legacy terminal state mapping", async () => {
  const source = normalizeSql(await readFile(ownerUrl, "utf8"))
  for (const field of [
    "event_row.workflow_key",
    "event_row.occurrence_key",
    "delivery_row.rule_id",
    "delivery_row.channel_key",
    "delivery_row.target_key",
    "delivery_row.target_generation",
  ]) assert.ok(source.includes(field), `identity field missing: ${field}`)
  for (const equality of [
    "ownership_row.workflow_key = event_row.workflow_key",
    "ownership_row.occurrence_key = event_row.occurrence_key",
    "ownership_row.rule_id = delivery_row.rule_id",
    "ownership_row.channel_key = delivery_row.channel_key",
    "ownership_row.target_key = delivery_row.target_key",
    "ownership_row.target_generation = delivery_row.target_generation",
  ]) assert.ok(source.includes(equality), `ownership join missing: ${equality}`)
  assert.match(source, /ownership_row.owner_kind is distinct from 'legacy'/)
  assert.match(source, /when ownership_row.terminal_outcome = 'sent' then 'sent'/)
  assert.match(source, /when ownership_row.state = 'reserved' then 'pending'/)
  assert.doesNotMatch(source, /owner_generation|dispatch_token|provider_reference/)
})
