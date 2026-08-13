import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = new URL(
  "../supabase/migrations/20260813192115_dashboard_daily_brief.sql",
  import.meta.url,
)
const manifestPath = new URL(
  "../supabase/test-baselines/dashboard-free-tier-v1.manifest.json",
  import.meta.url,
)
const pgTapPath = new URL(
  "../supabase/tests/dashboard_daily_brief_test.sql",
  import.meta.url,
)

const normalizeSql = (value) => value.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim()
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

test("daily brief migration is the CLI-created manifest-owned artifact", async () => {
  const [migration, manifestSource] = await Promise.all([
    readFile(migrationPath),
    readFile(manifestPath, "utf8"),
  ])
  const manifest = JSON.parse(manifestSource)
  const entries = manifest.orderedNewMigrations.filter(
    (entry) => entry.fileName === "20260813192115_dashboard_daily_brief.sql",
  )

  assert.equal(entries.length, 1)
  assert.ok(["candidate", "final"].includes(entries[0].status))
  assert.equal(entries[0].sha256, sha256(migration))
})

test("daily brief RPC is a stable invoker with one KST statement snapshot", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))

  assert.match(
    sql,
    /create or replace function public\.get_dashboard_daily_brief_v1\(\) returns jsonb language sql stable security invoker set search_path = '' as \$function\$ with bounds as \( select \(pg_catalog\.statement_timestamp\(\) at time zone 'Asia\/Seoul'\)::date as local_date, \(\(pg_catalog\.statement_timestamp\(\) at time zone 'Asia\/Seoul'\)::date::timestamp at time zone 'Asia\/Seoul'\) as starts_at, \(\(\(pg_catalog\.statement_timestamp\(\) at time zone 'Asia\/Seoul'\)::date \+ 1\)::timestamp at time zone 'Asia\/Seoul'\) as ends_at,/iu,
  )
  assert.doesNotMatch(sql, /\b(?:current_date|now|clock_timestamp)\s*\(/iu)
  assert.equal((sql.match(/\bwith bounds as\b/giu) ?? []).length, 1)
})

test("daily brief counts only visible scheduled appointments and visible open tasks due today", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))

  assert.match(sql, /from public\.ops_registration_appointment_calendar appointment/iu)
  assert.doesNotMatch(sql, /from public\.ops_registration_appointments\b/iu)
  assert.match(sql, /appointment\.status = 'scheduled'/iu)
  assert.match(sql, /appointment\.scheduled_at >= bounds\.starts_at/iu)
  assert.match(sql, /appointment\.scheduled_at < bounds\.ends_at/iu)
  assert.match(sql, /appointment\.source_kind = 'level_test'/iu)
  assert.match(sql, /appointment\.source_kind = 'visit_consultation'/iu)
  assert.match(sql, /appointment\.source_kind = 'observation_class'/iu)
  assert.match(sql, /from public\.ops_tasks task/iu)
  assert.match(sql, /task\.status in \('requested', 'confirmed', 'in_progress', 'on_hold'\)/iu)
  assert.match(sql, /task\.due_at >= bounds\.starts_at/iu)
  assert.match(sql, /task\.due_at < bounds\.ends_at/iu)
})

test("daily brief returns four counts and five deterministic appointment projections without private data", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))

  for (const key of [
    "localDate",
    "generatedAt",
    "counts",
    "levelTests",
    "visitConsultations",
    "observationClasses",
    "openTasks",
    "upcoming",
    "sourceKind",
    "sourceId",
    "scheduledAt",
    "title",
    "subjectLabels",
    "placeLabel",
    "href",
  ]) {
    assert.match(sql, new RegExp(`'${key}'`, "iu"))
  }
  assert.match(sql, /order by scheduled\.scheduled_at, scheduled\.source_id/iu)
  assert.match(sql, /limit 5/iu)
  assert.doesNotMatch(sql, /\bselect\s+\*/iu)
  assert.doesNotMatch(sql, /\b(?:phone|contact|consultation_note|counseling_note|memo|message_body|request_note)\b/iu)
  assert.doesNotMatch(sql, /(?:to_jsonb|row_to_json)\s*\(\s*appointment\s*\)/iu)
  assert.doesNotMatch(sql, /(?:to_jsonb|row_to_json)\s*\(\s*task\s*\)/iu)
})

test("daily brief RPC is authenticated-only and pgTAP owns boundary RLS fixtures", async () => {
  const [migration, pgTap] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(pgTapPath, "utf8"),
  ])
  const sql = normalizeSql(migration)
  const tap = normalizeSql(pgTap)

  assert.match(
    sql,
    /revoke all on function public\.get_dashboard_daily_brief_v1\(\) from public, anon/iu,
  )
  assert.match(
    sql,
    /grant execute on function public\.get_dashboard_daily_brief_v1\(\) to authenticated/iu,
  )
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.get_dashboard_daily_brief_v1\(\) to (?:public|anon|service_role)/iu,
  )
  assert.match(tap, /begin;/iu)
  assert.match(tap, /rollback;/iu)
  for (const contract of [
    "KST 00:00",
    "KST 23:59",
    "canceled and completed",
    "scheduled_at and source_id tie-breaker",
    "six appointments are limited to five",
    "RLS-hidden task",
  ]) {
    assert.match(tap, new RegExp(contract, "iu"))
  }
})

const dailyBriefFixture = Object.freeze({
  localDate: "2026-08-14",
  generatedAt: "2026-08-14T00:00:00.000Z",
  counts: {
    levelTests: 1,
    visitConsultations: 2,
    observationClasses: 3,
    openTasks: 4,
  },
  upcoming: [
    {
      sourceKind: "level_test",
      sourceId: "appointment-1",
      scheduledAt: "2026-08-14T01:00:00.000Z",
      title: "학생 · 레벨테스트",
      subjectLabels: ["수학"],
      placeLabel: "본관",
      href: "/admin/registration?appointmentId=appointment-1&view=calendar",
    },
  ],
})

test("daily brief service makes one bounded RPC request and returns the strict contract", async () => {
  const { readDashboardDailyBrief } = await import("../src/features/dashboard/daily-brief-service.ts")
  const calls = []
  const client = {
    rpc(name) {
      calls.push({ name })
      return {
        abortSignal(signal) {
          calls[0].signal = signal
          return this
        },
        async retry(value) {
          calls[0].retry = value
          return { data: dailyBriefFixture, error: null }
        },
      }
    },
  }

  assert.deepEqual(await readDashboardDailyBrief(client), dailyBriefFixture)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, "get_dashboard_daily_brief_v1")
  assert.equal(calls[0].retry, false)
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test("daily brief contract fails closed for a sixth item or unknown source kind", async () => {
  const { normalizeDashboardDailyBrief } = await import("../src/features/dashboard/daily-brief-contract.ts")

  assert.throws(
    () => normalizeDashboardDailyBrief({
      ...dailyBriefFixture,
      upcoming: Array.from({ length: 6 }, () => dailyBriefFixture.upcoming[0]),
    }),
    /dashboard_daily_brief_contract_invalid/,
  )
  assert.throws(
    () => normalizeDashboardDailyBrief({
      ...dailyBriefFixture,
      upcoming: [{ ...dailyBriefFixture.upcoming[0], sourceKind: "task" }],
    }),
    /dashboard_daily_brief_contract_invalid/,
  )
})
