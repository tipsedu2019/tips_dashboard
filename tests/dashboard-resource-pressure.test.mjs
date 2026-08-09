import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  attachDashboardClassSessionDates,
  buildDashboardSessionDateWindow,
} from "../src/features/dashboard/session-dates.js"

const hookUrl = new URL("../src/hooks/use-tips-dashboard-metrics.ts", import.meta.url)
const migrationUrl = new URL(
  "../supabase/migrations/20260808172543_dashboard_class_session_dates.sql",
  import.meta.url,
)
const snapshotMigrationUrl = new URL(
  "../supabase/migrations/20260809015836_dashboard_snapshot_sources.sql",
  import.meta.url,
)

test("dashboard session window is bounded to the operational exam horizon", () => {
  assert.deepEqual(
    buildDashboardSessionDateWindow(new Date("2026-08-09T12:00:00.000Z")),
    { dateFrom: "2026-07-10", dateTo: "2027-08-09" },
  )
})

test("dashboard session dates preserve legacy and normalized metric shapes", () => {
  const result = attachDashboardClassSessionDates(
    [
      { id: "legacy", schedule_storage_mode: "legacy" },
      { id: "normalized", schedule_storage_mode: "normalized" },
      { id: "empty", schedule_storage_mode: "legacy" },
    ],
    [
      {
        class_id: "legacy",
        session_date: "2026-08-10",
        schedule_state: "active",
        storage_mode: "legacy",
      },
      {
        class_id: "legacy",
        session_date: "2026-08-10",
        schedule_state: "active",
        storage_mode: "legacy",
      },
      {
        class_id: "normalized",
        session_date: "2026-08-11",
        schedule_state: "makeup",
        storage_mode: "normalized",
      },
    ],
  )

  assert.deepEqual(result[0].schedule_plan, {
    sessions: [{ date: "2026-08-10", state: "active" }],
  })
  assert.deepEqual(result[1].lessonSessions, [
    { date: "2026-08-11", scheduleState: "makeup" },
  ])
  assert.deepEqual(result[2].schedule_plan, { sessions: [] })
})

test("dashboard reads narrow class fields and a bounded no-retry session RPC", async () => {
  const source = await readFile(hookUrl, "utf8")
  const columnsMatch = source.match(
    /const DASHBOARD_TABLE_COLUMNS:[\s\S]*?classes:\s*([\s\S]*?),\n\s*students:/,
  )

  assert.ok(columnsMatch, "dashboard class projection must be explicit")
  assert.doesNotMatch(columnsMatch[1], /schedule_plan|["']\*["']/)
  for (const column of [
    "id",
    "name",
    "subject",
    "grade",
    "teacher",
    "room",
    "schedule",
    "status",
    "start_date",
    "end_date",
    "student_ids",
    "waitlist_ids",
    "schedule_storage_mode",
  ]) {
    assert.match(columnsMatch[1], new RegExp(`\\b${column}\\b`))
  }

  assert.match(source, /rpc\("list_dashboard_class_session_dates_v1"/)
  assert.match(source, /\.abortSignal\(AbortSignal\.timeout\([^)]*\)\)\s*\.retry\(false\)/)
  assert.match(source, /\.select\(columns\)\s*\.abortSignal\(AbortSignal\.timeout\([^)]*\)\)\s*\.retry\(false\)/)
  assert.doesNotMatch(source, /attachNormalizedLessonSessions/)
})

test("dashboard session RPC returns only active dates inside a guarded range", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase().replace(/\s+/gu, " ")

  assert.match(sql, /create or replace function public\.list_dashboard_class_session_dates_v1\(/)
  assert.match(sql, /p_date_to - p_date_from\) > 400/)
  assert.match(sql, /jsonb_array_elements/)
  assert.match(sql, /class_lesson_sessions/)
  assert.match(sql, /in \('active', 'makeup'\)/)
  assert.match(sql, /revoke all on function public\.list_dashboard_class_session_dates_v1\(date, date\) from public, anon/)
  assert.match(sql, /grant execute on function public\.list_dashboard_class_session_dates_v1\(date, date\) to authenticated/)
})

test("dashboard snapshot RPCs are bounded authenticated security-invoker reads", async () => {
  const sql = (await readFile(snapshotMigrationUrl, "utf8")).toLowerCase().replace(/\s+/gu, " ")

  assert.match(sql, /create or replace function public\.get_dashboard_summary_sources_v1\(\)/)
  assert.match(
    sql,
    /create or replace function public\.get_dashboard_conflict_sources_v1\( p_date_from date, p_date_to date \)/,
  )
  assert.equal((sql.match(/security invoker/gu) || []).length, 2)
  assert.equal((sql.match(/set search_path = ''/gu) || []).length, 2)
  assert.match(sql, /p_date_to - p_date_from\) > 400/)
  assert.doesNotMatch(sql, /select \*/)
  assert.doesNotMatch(sql, /security definer/)
  assert.match(
    sql,
    /revoke all on function public\.get_dashboard_summary_sources_v1\(\) from public, anon/,
  )
  assert.match(
    sql,
    /grant execute on function public\.get_dashboard_summary_sources_v1\(\) to authenticated/,
  )
  assert.match(
    sql,
    /revoke all on function public\.get_dashboard_conflict_sources_v1\(date, date\) from public, anon/,
  )
  assert.match(
    sql,
    /grant execute on function public\.get_dashboard_conflict_sources_v1\(date, date\) to authenticated/,
  )
})

test("dashboard snapshot RPCs exclude heavyweight and unused columns", async () => {
  const sql = (await readFile(snapshotMigrationUrl, "utf8")).toLowerCase().replace(/\s+/gu, " ")
  const summaryBlock = sql.slice(
    sql.indexOf("create or replace function public.get_dashboard_summary_sources_v1"),
    sql.indexOf("create or replace function public.get_dashboard_conflict_sources_v1"),
  )
  const academicEventsBlock = sql.slice(
    sql.indexOf("'academicevents'"),
    sql.indexOf("'[]'::jsonb", sql.indexOf("'academicevents'")),
  )

  for (const column of [
    "id", "name", "subject", "grade", "teacher", "room", "schedule", "status",
    "start_date", "end_date", "student_ids", "waitlist_ids", "schedule_storage_mode",
  ]) {
    assert.match(summaryBlock, new RegExp(`\\b${column}\\b`))
  }
  assert.doesNotMatch(summaryBlock, /schedule_plan/)
  assert.doesNotMatch(summaryBlock, /textbook_info|lessons/)
  for (const column of ["id", "title", "date", "type", "school_id", "grade", "note"]) {
    assert.match(academicEventsBlock, new RegExp(`\\b${column}\\b`))
  }
  assert.doesNotMatch(academicEventsBlock, /content|created_at/)
})
