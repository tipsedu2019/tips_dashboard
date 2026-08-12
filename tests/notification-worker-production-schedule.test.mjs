import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationDirectory = join(repositoryRoot, "supabase", "migrations")

async function readMigration() {
  const matches = (await readdir(migrationDirectory))
    .filter((entry) => /^[0-9]{14}_notification_worker_production_schedule\.sql$/u.test(entry))
    .sort()
  assert.equal(matches.length, 1, "one CLI-generated worker schedule migration is required")
  return readFile(join(migrationDirectory, matches[0]), "utf8")
}

function functionBlock(source, signature, terminator) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(terminator, start + signature.length)
  assert.notEqual(end, -1, `missing ${terminator}`)
  return source.slice(start, end)
}

test("production worker schedule migration installs only the current shared worker boundary", async () => {
  const source = await readMigration()
  assert.match(source, /^begin;\s*/iu)
  assert.match(source, /commit;\s*$/iu)
  assert.match(source, /create table dashboard_private\.notification_worker_stop_latch/iu)
  assert.match(source, /create table dashboard_private\.notification_watchdog_heartbeats/iu)
  assert.match(source, /public\.assert_notification_worker_run_allowed_v1\s*\(\s*p_worker_id text/iu)
  assert.match(source, /public\.manage_notification_worker_schedule_v1\s*\(\s*p_action text\s*,\s*p_request_id uuid/iu)
  assert.match(source, /'tips-notification-worker-v1'[\s\S]*?'\* \* \* \* \*'/iu)
  assert.match(source, /'tips-notification-cutover-watchdog-v1'[\s\S]*?'\* \* \* \* \*'/iu)
  assert.match(source, /select dashboard_private\.invoke_notification_worker_v1\(\);/iu)
  assert.match(source, /select dashboard_private\.run_notification_worker_watchdog_v1\(\);/iu)
})

test("schedule install validates secret input and cannot activate rules or providers", async () => {
  const source = await readMigration()
  assert.match(source, /notification_worker_url/iu)
  assert.match(source, /notification_worker_bearer_secret/iu)
  assert.match(source, /octet_length\(p_secret\) < 32/iu)
  assert.match(source, /p_url not in \(/iu)
  assert.match(source, /net\.http_post/iu)
  assert.doesNotMatch(source, /\bupdate\s+dashboard_private\.notification_runtime_flags\b/iu)
  assert.doesNotMatch(source, /\bupdate\s+dashboard_private\.notification_rules\b/iu)
  assert.doesNotMatch(source, /\benabled\s*=\s*true\b/iu)
  assert.doesNotMatch(source, /google_chat_webhook|solapi_api|provider_reference/iu)
  assert.doesNotMatch(source, /pending-migrations|20260716195500_notification_worker_schedule/iu)
})

test("schedule public RPCs are service-role-only and private execution helpers stay closed", async () => {
  const source = await readMigration()
  for (const signature of [
    "public.assert_notification_worker_run_allowed_v1(text)",
    "public.manage_notification_worker_schedule_v1(text,uuid)",
  ]) {
    assert.match(
      source,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${signature.replace(/[().]/g, "\\$&")}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, "iu"),
    )
    assert.match(
      source,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${signature.replace(/[().]/g, "\\$&")}\\s+to\\s+service_role`, "iu"),
    )
  }
  for (const helper of [
    "dashboard_private.invoke_notification_worker_v1()",
    "dashboard_private.run_notification_worker_watchdog_v1()",
    "dashboard_private.inspect_notification_schedules_v1()",
  ]) {
    assert.match(
      source,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${helper.replace(/[().]/g, "\\$&")}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, "iu"),
    )
  }
  const manager = functionBlock(
    source,
    "create or replace function public.manage_notification_worker_schedule_v1",
    "alter function public.manage_notification_worker_schedule_v1",
  )
  assert.match(manager, /security definer/iu)
  assert.match(manager, /set search_path = ''/iu)
  assert.match(manager, /auth\.role\(\)\) <> 'service_role'/iu)
})

test("worker invocation uses the exact authenticated production route without exposing secrets", async () => {
  const source = await readMigration()
  const invoke = functionBlock(
    source,
    "create or replace function dashboard_private.invoke_notification_worker_v1",
    "alter function dashboard_private.invoke_notification_worker_v1",
  )
  assert.match(invoke, /'Authorization', 'Bearer ' \|\| v_secret/iu)
  assert.match(invoke, /'Content-Type', 'application\/json'/iu)
  assert.match(invoke, /'batch_size', 50, 'lease_seconds', 60/iu)
  assert.match(invoke, /timeout_milliseconds := 25000/iu)
  assert.doesNotMatch(invoke, /raise notice|raise log|returning[\s\S]*v_secret/iu)
})
