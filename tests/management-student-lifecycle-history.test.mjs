import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("student lifecycle status is a persisted student field", async () => {
  const statusSource = await readFile(new URL("src/lib/student-status.js", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const recordsSource = await readFile(new URL("src/features/management/records.js", root), "utf8");
  const migrationSource = await readFile(new URL("supabase/migrations/20260503120000_student_status_and_enrollment_history.sql", root), "utf8");

  assert.match(statusSource, /ACTIVE_STUDENT_STATUS = "재원"/);
  assert.match(statusSource, /WITHDRAWN_STUDENT_STATUS = "퇴원"/);
  assert.match(serviceSource, /status: normalizeStudentStatus\(record\.status\)/);
  assert.match(recordsSource, /const status = normalizeStudentStatus\(row\.status\)/);
  assert.match(migrationSource, /add column if not exists status text not null default '재원'/);
  assert.match(migrationSource, /check \(status in \('재원', '퇴원'\)\)/);
});

test("student delete actions become withdrawal actions instead of physical deletion", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(pageSource, /status: WITHDRAWN_STUDENT_STATUS/);
  assert.match(pageSource, /kind === "students" \? "퇴원 처리" : "삭제"/);
  assert.match(tableSource, /kind === "students" \? "퇴원 처리" : "삭제"/);
  assert.match(tableSource, /kind === "students" \? "일괄 퇴원" : "일괄 삭제"/);
});

test("student detail loads class and textbook history", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const migrationSource = await readFile(new URL("supabase/migrations/20260503120000_student_status_and_enrollment_history.sql", root), "utf8");

  assert.match(serviceSource, /student_class_enrollment_history/);
  assert.match(serviceSource, /insertStudentClassHistory/);
  assert.match(hookSource, /readOptionalTable\("student_class_enrollment_history"\)/);
  assert.match(hookSource, /readOptionalTable\("textbook_sale_lines"\)/);
  assert.match(hookSource, /attachStudentHistorySummaries/);
  assert.match(pageSource, /function renderStudentHistoryPanel/);
  assert.match(pageSource, /수업·교재 이력/);
  assert.match(migrationSource, /create table if not exists public\.student_class_enrollment_history/);
  assert.match(migrationSource, /student_class_enrollment_history_staff_write/);
});
