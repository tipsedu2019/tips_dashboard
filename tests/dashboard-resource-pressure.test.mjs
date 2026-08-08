import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  attachDashboardClassSessionDates,
  buildDashboardSessionDateWindow,
} from "../src/features/dashboard/session-dates.js"

const hookUrl = new URL("../src/hooks/use-tips-dashboard-metrics.ts", import.meta.url)
const migrationUrl = new URL(
  "../supabase/migrations/20260809090000_dashboard_class_session_dates.sql",
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
