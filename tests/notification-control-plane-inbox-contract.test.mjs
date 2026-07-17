import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716113500_notification_inbox_contract_fix.sql",
  import.meta.url,
)
const runtimePgTapUrl = new URL(
  "../supabase/tests/notification_control_plane_runtime_test.sql",
  import.meta.url,
)

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionBlock(source, qualifiedName) {
  const start = source.search(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegex(qualifiedName)}\\b`,
    "i",
  ))
  assert.notEqual(start, -1, `missing ${qualifiedName}`)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`)
  return source.slice(start, end + 4)
}

test("inbox contract fix is one additive transaction with no data rewrite", async () => {
  const migration = await readFile(migrationUrl, "utf8")

  assert.match(migration.trim(), /^begin;[\s\S]*commit;$/i)
  assert.equal((migration.match(/^begin;$/gim) || []).length, 1)
  assert.equal((migration.match(/^commit;$/gim) || []).length, 1)
  assert.match(migration, /set\s+local\s+lock_timeout\s*=\s*'5s'/i)
  assert.doesNotMatch(migration, /\b(?:truncate|delete\s+from|drop\s+table|drop\s+function)\b/i)
  assert.doesNotMatch(migration, /update\s+public\.dashboard_notifications\b/i)
  assert.doesNotMatch(migration, /\bbackfill\b/i)
  assert.doesNotMatch(migration, /pg_catalog\.coalesce\s*\(/i)
})

test("one closed visible relation excludes the internal registration Chat claim", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  const visible = functionBlock(
    migration,
    "dashboard_private.visible_dashboard_notification_rows_v1",
  )

  assert.match(visible, /security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i)
  assert.match(visible, /notification\.revoked_at\s+is\s+null/i)
  assert.match(
    visible,
    /notification\.type\s*<>\s*'registration_consultation_admin_chat'/i,
  )
  assert.match(visible, /dashboard_notification_read_receipts/i)
  assert.match(visible, /receipt\.profile_id\s*=\s*p_profile_id/i)
  assert.match(visible, /coalesce\s*\(\s*receipt\.read_at\s*,\s*notification\.read_at\s*\)/i)
  assert.match(visible, /notification\.recipient_profile_id\s*=\s*p_profile_id/i)
  assert.match(
    visible,
    /notification\.recipient_profile_id\s+is\s+null[\s\S]*?notification\.recipient_team\s*=\s*'관리팀'[\s\S]*?profile\.role\s+in\s*\(\s*'admin'\s*,\s*'staff'\s*\)/i,
  )
})

test("list count and mark use auth uid and the same visible relation", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  const functions = [
    functionBlock(migration, "public.get_dashboard_notification_inbox_v1"),
    functionBlock(migration, "public.get_dashboard_notification_unread_count_v1"),
    functionBlock(migration, "public.mark_dashboard_notification_read_v1"),
  ]

  for (const source of functions) {
    assert.match(source, /v_profile_id\s+uuid\s*:=\s*\(\s*select\s+auth\.uid\(\)\s*\)/i)
    assert.match(source, /dashboard_private\.visible_dashboard_notification_rows_v1\s*\(\s*v_profile_id\s*\)/i)
    assert.match(source, /security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i)
    assert.match(source, /'unread_count'\s*,\s*v_unread_count::text/i)
  }
})

test("inbox cursor is a stable descending created_at and id pair", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  const inbox = functionBlock(migration, "public.get_dashboard_notification_inbox_v1")

  assert.match(inbox, /\(\s*visible\.created_at\s*,\s*visible\.id\s*\)\s*<\s*\(\s*p_before_created_at\s*,\s*p_before_id\s*\)/i)
  assert.match(inbox, /order\s+by\s+visible\.created_at\s+desc\s*,\s*visible\.id\s+desc/i)
  assert.match(
    inbox,
    /'next_cursor'[\s\S]*?'created_at'\s*,\s*v_next_created_at[\s\S]*?'id'\s*,\s*v_next_id/i,
  )
})

test("mark locks identity and base row before one atomic visible recheck and receipt", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  const mark = functionBlock(migration, "public.mark_dashboard_notification_read_v1")
  const profileLock = mark.search(/from\s+public\.profiles\s+profile[\s\S]*?for\s+share\s+of\s+profile/i)
  const notificationLock = mark.search(/from\s+public\.dashboard_notifications\s+notification[\s\S]*?for\s+share\s+of\s+notification/i)
  const advisoryLock = mark.search(/pg_advisory_xact_lock/i)
  const visibleRecheck = mark.search(/from\s+dashboard_private\.visible_dashboard_notification_rows_v1\s*\(\s*v_profile_id\s*\)/i)
  const receiptInsert = mark.search(/insert\s+into\s+public\.dashboard_notification_read_receipts/i)

  assert.ok(profileLock >= 0)
  assert.ok(notificationLock > profileLock)
  assert.ok(advisoryLock > notificationLock)
  assert.ok(visibleRecheck > advisoryLock)
  assert.ok(receiptInsert > visibleRecheck)
  assert.match(mark, /if\s+not\s+found\s+then[\s\S]*?notification_not_found/i)
  assert.match(mark, /if\s+v_effective_read_at\s+is\s+null\s+then[\s\S]*?insert\s+into\s+public\.dashboard_notification_read_receipts/i)
  assert.match(mark, /notification_id\s*,\s*profile_id\s*,\s*read_at[\s\S]*?p_notification_id\s*,\s*v_profile_id/i)
  assert.match(mark, /on\s+conflict\s*\(\s*notification_id\s*,\s*profile_id\s*\)\s+do\s+nothing/i)
  assert.doesNotMatch(mark, /update\s+public\.dashboard_notifications/i)
  assert.doesNotMatch(mark, /notification_not_visible/i)
})

test("inbox RPC ownership and execution stay closed to authenticated callers", async () => {
  const migration = await readFile(migrationUrl, "utf8")

  for (const signature of [
    "dashboard_private.visible_dashboard_notification_rows_v1(uuid)",
    "public.get_dashboard_notification_inbox_v1(integer, timestamptz, uuid)",
    "public.get_dashboard_notification_unread_count_v1()",
    "public.mark_dashboard_notification_read_v1(uuid)",
  ]) {
    const escaped = escapeRegex(signature)
      .replaceAll(" ", "\\s+")
      .replaceAll("\\(", "\\s*\\(\\s*")
      .replaceAll(",", "\\s*,\\s*")
      .replaceAll("\\)", "\\s*\\)")
    assert.match(migration, new RegExp(`alter\\s+function\\s+${escaped}\\s+owner\\s+to\\s+postgres`, "i"))
    assert.match(migration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escaped}`, "i"))
  }

  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.get_dashboard_notification_inbox_v1\s*\(\s*integer\s*,\s*timestamptz\s*,\s*uuid\s*\)\s+to\s+authenticated/i,
  )
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.get_dashboard_notification_unread_count_v1\s*\(\s*\)\s+to\s+authenticated/i,
  )
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.mark_dashboard_notification_read_v1\s*\(\s*uuid\s*\)\s+to\s+authenticated/i,
  )
  assert.doesNotMatch(migration, /grant\s+execute[\s\S]*?to\s+(?:anon|service_role)/i)
})

test("pgTAP keeps the complete per-profile inbox regression contract", async () => {
  const pgTap = await readFile(runtimePgTapUrl, "utf8")

  for (const contract of [
    "internal registration Chat claim is absent from list and count",
    "internal registration Chat claim cannot be marked and creates no receipt",
    "revoked notification collapses to notification_not_found",
    "non-owner notification collapses to notification_not_found",
    "two profiles keep independent receipts and shared read_at stays null",
    "personal and historical management-team visibility stays exact",
    "inbox list, count, and mark return decimal-string unread counts",
    "inbox cursor remains stable across equal created_at rows",
  ]) {
    assert.ok(pgTap.includes(contract), `missing pgTAP contract: ${contract}`)
  }
})
