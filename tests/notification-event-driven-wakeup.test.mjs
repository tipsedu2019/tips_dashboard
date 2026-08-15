import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationPath = join(root, "supabase", "migrations", "20260815120000_event_driven_notification_worker.sql")
const workerRoutePath = join(root, "src", "app", "api", "notifications", "worker", "route.ts")

test("fanout inserts request one statement-level wakeup and periodic jobs are retired", async () => {
  const sql = await readFile(migrationPath, "utf8")
  assert.match(sql, /create table dashboard_private\.notification_worker_wakeup_state/i)
  assert.match(sql, /after insert on dashboard_private\.notification_event_fanout_jobs[\s\S]*referencing new table as inserted_jobs[\s\S]*for each statement/i)
  assert.match(sql, /requested_generation\s*=\s*wakeup\.requested_generation\s*\+\s*1/i)
  assert.match(sql, /tips-notification-worker-v1[\s\S]*cron\.unschedule/i)
  assert.match(sql, /tips-notification-cutover-watchdog-v1[\s\S]*cron\.unschedule/i)
  assert.match(sql, /notification_periodic_worker_retired/i)
  assert.doesNotMatch(sql, /cron\.schedule[\s\S]*(notification-worker|watchdog|recovery)/i)
})

test("wakeup failure is recorded without rolling back the producer transaction", async () => {
  const sql = await readFile(migrationPath, "utf8")
  assert.match(sql, /create or replace function dashboard_private\.request_notification_worker_wakeup_v1\(\s*p_reason text\s*\)/i)
  assert.match(sql, /exception[\s\S]*when others then[\s\S]*last_error_code/i)
  assert.match(sql, /return pg_catalog\.jsonb_build_object\('ok', false, 'errorCode', 'notification_worker_wakeup_failed'\)/i)
  assert.match(sql, /'wakeup_generation', v_generation/i)
  assert.match(sql, /timeout_milliseconds\s*:=\s*25000/i)
})

test("generation completion coalesces new work and keeps private helpers closed", async () => {
  const sql = await readFile(migrationPath, "utf8")
  assert.match(sql, /create or replace function public\.complete_notification_worker_generation_v1\(\s*p_generation bigint,\s*p_succeeded boolean/i)
  assert.match(sql, /requested_generation\s*>\s*p_generation/i)
  assert.match(sql, /notification_event_fanout_jobs[\s\S]*status\s*=\s*'pending'/i)
  assert.match(sql, /revoke all on function dashboard_private\.request_notification_worker_wakeup_v1\(text\)[\s\S]*from public, anon, authenticated, service_role/i)
  assert.match(sql, /grant execute on function public\.complete_notification_worker_generation_v1\(bigint,boolean\)\s+to service_role/i)
})

test("worker route accepts a bounded generation and always acknowledges it through the database", async () => {
  const source = await readFile(workerRoutePath, "utf8")
  assert.match(source, /\["batch_size", "lease_seconds", "wakeup_generation"\]/)
  assert.match(source, /boundedInteger\(body\.wakeup_generation, 0, 0, Number\.MAX_SAFE_INTEGER\)/)
  assert.match(source, /complete_notification_worker_generation_v1/)
  assert.match(source, /p_generation:\s*wakeupGeneration/)
  assert.match(source, /p_succeeded:\s*succeeded/)
  assert.doesNotMatch(source, /fetch\([^)]*notifications\/worker/)
})
