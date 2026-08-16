import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)
const baselineManifestUrl = new URL("../supabase/test-baselines/dashboard-free-tier-v1.manifest.json", import.meta.url)

async function latestMigration(name) {
  const fileName = (await readdir(migrationsUrl))
    .filter((entry) => entry.endsWith(`_${name}.sql`))
    .sort()
    .at(-1)
  assert.ok(fileName, `${name} migration must exist`)
  return (await readFile(new URL(fileName, migrationsUrl), "utf8"))
    .toLowerCase()
    .replace(/\s+/gu, " ")
}

async function latestMigrationBytes(name) {
  const fileName = (await readdir(migrationsUrl))
    .filter((entry) => entry.endsWith(`_${name}.sql`))
    .sort()
    .at(-1)
  assert.ok(fileName, `${name} migration must exist`)
  return readFile(new URL(fileName, migrationsUrl))
}

function functionBody(sql, signature) {
  const start = sql.lastIndexOf(`create or replace function ${signature}`)
  assert.ok(start >= 0, `${signature} must be redefined`)
  const end = sql.indexOf("alter function", start)
  assert.ok(end > start, `${signature} definition must end with alter function`)
  return sql.slice(start, end)
}

test("당일 예약 리마인드는 KST 당일·전일 확정 기준을 사용한다", async () => {
  const sql = await latestMigration("registration_same_day_customer_reminders")
  const sync = functionBody(sql, "dashboard_private.sync_registration_customer_reminder_jobs_v1()")

  assert.match(sql, /add column(?: if not exists)? schedule_confirmed_at timestamptz/)
  assert.match(sync, /at time zone 'asia\/seoul'/)
  assert.match(sync, /appointment\.schedule_confirmed_at < v_day_start/)
  assert.match(sync, /v_send_at := v_day_start \+ interval '10 hours'/)
  assert.doesNotMatch(sync, /settings\.lead_hours/)
  assert.match(sync, /appointment\.kind in \('level_test', 'visit_consultation'\)/)
  assert.match(sync, /appointment\.scheduled_at >= v_day_start/)
  assert.match(sync, /appointment\.scheduled_at < v_day_end/)
})

test("당일 예약 리마인드 migration은 격리 DB 후보 manifest에 정확한 바이트로 등록된다", async () => {
  const [migration, manifestSource] = await Promise.all([
    latestMigrationBytes("registration_same_day_customer_reminders"),
    readFile(baselineManifestUrl, "utf8"),
  ])
  const manifest = JSON.parse(manifestSource)
  const entry = manifest.orderedNewMigrations.find(
    ({ fileName }) => fileName === "20260816003407_registration_same_day_customer_reminders.sql",
  )

  assert.deepEqual(entry, {
    fileName: "20260816003407_registration_same_day_customer_reminders.sql",
    status: "final",
    sha256: createHash("sha256").update(migration).digest("hex"),
  })
  assert.equal(manifest.orderedNewMigrations.filter(
    ({ fileName }) => fileName === "20260816003407_registration_same_day_customer_reminders.sql",
  ).length, 1)
})

test("등록 상세는 민감 정보 없이 리마인드 상태만 읽는다", async () => {
  const sql = await latestMigration("registration_same_day_customer_reminders")
  const summary = functionBody(sql, "public.get_registration_customer_reminder_summaries_v1(")

  assert.match(summary, /security definer/)
  assert.match(summary, /auth\.uid\(\).*is null/)
  assert.match(summary, /appointment_id/)
  assert.match(summary, /scheduled_for/)
  assert.match(summary, /sent_at/)
  assert.match(summary, /updated_at/)
  assert.doesNotMatch(summary, /recipient_hash|provider_message_id|request_key|parent_phone/)
  assert.match(sql, /grant execute on function public\.get_registration_customer_reminder_summaries_v1\(uuid\)\s+to authenticated/)
})

test("일일 배치의 후속 실행은 backlog가 있을 때만 service role로 제한한다", async () => {
  const sql = await latestMigration("registration_same_day_customer_reminders")
  const backlog = functionBody(sql, "public.has_registration_customer_reminder_backlog_v1()")
  const continuation = functionBody(sql, "public.continue_registration_customer_reminder_worker_v1()")

  assert.match(backlog, /security definer/)
  assert.match(backlog, /auth\.role\(\).*service_role/)
  assert.match(backlog, /job\.status = 'pending'/)
  assert.match(backlog, /registration_appointment_reminder_due_v1\(/)
  assert.doesNotMatch(backlog, /net\.http_post/)
  assert.match(sql, /create table dashboard_private\.registration_customer_reminder_continuation_leases/)
  assert.match(continuation, /pg_advisory_xact_lock/)
  assert.match(continuation, /lease_expires_at/)
  assert.match(continuation, /invoke_registration_customer_reminder_worker_v1\(\)/)
  assert.match(sql, /grant execute on function public\.has_registration_customer_reminder_backlog_v1\(\)\s+to service_role/)
  assert.match(sql, /grant execute on function public\.continue_registration_customer_reminder_worker_v1\(\)\s+to service_role/)
})

test("당일 예약 규칙은 청강 리마인드의 독립 claim 경로를 덮어쓰지 않는다", async () => {
  const sql = await latestMigration("registration_same_day_customer_reminders")
  const claim = functionBody(sql, "public.claim_registration_customer_reminder_job_v1()")

  assert.match(claim, /materialize_registration_observation_solapi_events_v1\(100\)/)
  assert.match(claim, /when 'appointment_reminder' then[\s\S]*dashboard_private\.registration_appointment_reminder_due_v1\(/)
  assert.match(claim, /when 'observation_reminder' then[\s\S]*public\.registration_observation_runtime_version\(\) = 1/)
  assert.match(claim, /'messagekind', v_job\.message_kind/)
  assert.match(claim, /'observationid', v_job\.observation_id/)
})
