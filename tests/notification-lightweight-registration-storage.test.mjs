import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

async function loadMigration() {
  const names = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((name) => name.endsWith("_lightweight_registration_external_alerts.sql"))
  assert.equal(names.length, 1, "one CLI-generated lightweight registration alert migration is required")
  return readFile(new URL(`../supabase/migrations/${names[0]}`, import.meta.url), "utf8")
}

test("migration keeps compact external-only state with durable channel-local dedupe", async () => {
  const sql = await loadMigration()
  assert.match(sql, /create table dashboard_private\.lightweight_registration_alert_runtime_settings/iu)
  assert.match(sql, /values \(true, false\)/iu)
  assert.match(sql, /create table dashboard_private\.lightweight_registration_alert_states/iu)
  assert.match(sql, /create table dashboard_private\.lightweight_registration_alert_deliveries/iu)
  assert.match(sql, /unique\s*\(source_kind, source_id, event_kind, channel, event_key\)/iu)
  assert.match(sql, /channel in \('customer_alimtalk', 'google_chat'\)/iu)
  assert.doesNotMatch(sql, /channel in \([^)]*'in_app'/iu)
  assert.match(sql, /enable row level security/iu)
  assert.match(sql, /revoke all on table dashboard_private\.lightweight_registration_alert_states\s+from public, anon, authenticated/iu)
})

test("migration creates matrix intents without level-test Chat and without provider calls", async () => {
  const sql = await loadMigration()
  assert.match(sql, /create or replace function public\.enqueue_lightweight_registration_booking_alerts_v1/iu)
  assert.match(sql, /v_channels text\[\] := case[\s\S]*when p_source_kind = 'level_test' then array\['customer_alimtalk'\]/iu)
  assert.match(sql, /when p_source_kind in \('visit_consultation', 'observation_class'\)[\s\S]*array\['customer_alimtalk', 'google_chat'\]/iu)
  assert.doesNotMatch(sql, /net\.http_post|http_post\s*\(/iu)
  assert.doesNotMatch(sql, /notification_events|notification_deliveries|dashboard_notification/iu)
})

test("migration retains compact state but prunes receipts and run details at seven days", async () => {
  const sql = await loadMigration()
  assert.match(sql, /create or replace function public\.prune_lightweight_registration_alert_history_v1/iu)
  assert.match(sql, /terminalized_at <= v_now - interval '7 days'/iu)
  assert.match(sql, /finished_at <= v_now - interval '7 days'/iu)
  assert.match(sql, /terminalized_at = delivery\.created_at/iu)
  assert.match(sql, /finished_at = run\.started_at/iu)
  assert.match(sql, /loop[\s\S]*exit when v_batch_count < p_limit/iu)
  assert.match(sql, /on conflict \(kst_date\) do update[\s\S]*status = 'running'[\s\S]*where dashboard_private\.lightweight_registration_alert_daily_runs\.status = 'failed'/iu)
  assert.match(sql, /provider_reference ~ '\^\[a-f0-9\]\{64\}\$'/iu)
  assert.doesNotMatch(sql, /delete from dashboard_private\.lightweight_registration_alert_states/iu)
  assert.match(sql, /p_limit between 1 and 500/iu)
})

test("migration exposes only an exact daily 10:00 KST schedule and never activates it on install", async () => {
  const sql = await loadMigration()
  assert.match(sql, /'tips-lightweight-registration-reminder-v1'/u)
  assert.match(sql, /'0 1 \* \* \*'/u)
  assert.doesNotMatch(sql, /'\* \* \* \* \*'/u)
  assert.doesNotMatch(sql, /cron\.schedule\([\s\S]{0,160}(?:watchdog|heartbeat)/iu)
  assert.doesNotMatch(sql, /run_notification_worker_watchdog|record_notification_worker_heartbeat/iu)
  assert.match(sql, /cron\.alter_job\(v_job_id, active := false\)/iu)
  assert.doesNotMatch(sql, /select public\.manage_lightweight_registration_alert_schedule_v1\s*\(/iu)
})
