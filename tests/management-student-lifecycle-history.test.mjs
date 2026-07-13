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

test("class relation removal can clear orphaned student references", async () => {
  const serviceSource = await readFile(new URL("src/features/management/management-service.js", root), "utf8");
  const assignStart = serviceSource.indexOf("async assignStudentToClass");
  const removeStart = serviceSource.indexOf("async removeStudentFromClass", assignStart);
  const serviceEnd = serviceSource.indexOf("\n  };\n}", removeStart);
  const assignSource = serviceSource.slice(assignStart, removeStart);
  const removeSource = serviceSource.slice(removeStart, serviceEnd);

  assert.match(serviceSource, /function getClassWaitlistIds/);
  assert.match(serviceSource, /function getClassStudentMode/);
  assert.match(assignSource, /if \(!student \|\| !classItem\)/);
  assert.match(removeSource, /const safeStudentId = trimText\(studentId\)/);
  assert.match(removeSource, /const safeClassId = trimText\(classId\)/);
  assert.match(removeSource, /if \(!student && !classItem\)/);
  assert.match(removeSource, /getStudentClassMode\(student, safeClassId\) \|\| getClassStudentMode\(classItem, safeStudentId\)/);
  assert.match(removeSource, /if \(nextStudent\) \{\s*await upsertStudentRows/);
  assert.match(removeSource, /if \(nextClass\) \{\s*await upsertClassRows/);
  assert.match(removeSource, /if \(previousMode && student && classItem\)/);
});

test("student delete actions become withdrawal actions while classes end through status edits only", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(pageSource, /status: WITHDRAWN_STUDENT_STATUS/);
  assert.match(pageSource, /kind === "classes" \? undefined : canMutateRows \? \(row: ManagementRow\) =>/);
  assert.match(tableSource, /kind === "classes" \? null : \(/);
  assert.match(tableSource, /kind === "students" \? "퇴원 처리" : "삭제"/);
  assert.match(tableSource, /kind === "students" \? "일괄 퇴원" : "일괄 삭제"/);
  assert.doesNotMatch(pageSource, /종강 처리/);
  assert.doesNotMatch(tableSource, /종강 처리/);
  assert.doesNotMatch(tableSource, /일괄 종강/);
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

test("student detail class cards open the official class detail with return context", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const requestedStudentId = kind === "students" \? text\(searchParams\.get\("studentId"\)\) : ""/);
  assert.match(pageSource, /const writeStudentDetailRoute = useCallback/);
  assert.match(pageSource, /params\.set\("studentId", studentId\)/);
  assert.match(pageSource, /const buildStudentDetailReturnPath = \(\) =>/);
  assert.match(pageSource, /return `\/admin\/students\?\$\{params\.toString\(\)\}`/);
  assert.match(pageSource, /const handleStudentClassDetailOpen = \(classId: string, tab: ClassDetailTab = "students"\) =>/);
  assert.match(pageSource, /params\.set\("classId", targetClassId\)/);
  assert.match(pageSource, /params\.set\("tab", tab\)/);
  assert.match(pageSource, /params\.set\("studentId", selectedRow\.id\)/);
  assert.match(pageSource, /params\.set\("returnTo", buildStudentDetailReturnPath\(\)\)/);
  assert.match(pageSource, /router\.push\(`\/admin\/classes\?\$\{params\.toString\(\)\}`\)/);
  assert.match(pageSource, /data-testid="student-class-official-link"/);
  assert.match(pageSource, /onClick=\{\(\) => handleStudentClassDetailOpen\(id, "students"\)\}/);
  assert.match(pageSource, /학생 현황/);
  assert.doesNotMatch(pageSource, /data-testid="student-class-counseling-link"/);
  assert.doesNotMatch(pageSource, /onClick=\{\(\) => handleStudentClassDetailOpen\(id, "counseling"\)\}/);
  assert.doesNotMatch(pageSource, /상담 보기/);
  assert.match(pageSource, /data-testid="class-detail-return-to-student"/);
  assert.match(pageSource, /openRow\(targetRow, \{ syncRoute: false \}\)/);
});

test("class detail student rows open the official student detail with return context", async () => {
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(pageSource, /const requestedStudentReturnPath = kind === "students" \? normalizeReturnToPath\(searchParams\.get\("returnTo"\)\) : ""/);
  assert.match(pageSource, /const handleClassStudentDetailOpen = \(studentId: string\) =>/);
  assert.match(pageSource, /params\.set\("studentId", targetStudentId\)/);
  assert.match(pageSource, /params\.set\("returnTo", buildClassDetailReturnPath\("students", \{ studentId: targetStudentId \}\)\)/);
  assert.match(pageSource, /router\.push\(`\/admin\/students\?\$\{params\.toString\(\)\}`\)/);
  assert.match(pageSource, /data-testid="class-student-official-link"/);
  assert.match(pageSource, /onClick=\{\(\) => handleClassStudentDetailOpen\(id\)\}/);
  assert.match(pageSource, /data-testid="student-detail-return-to-class"/);
  assert.match(pageSource, /router\.push\(requestedStudentReturnPath\)/);
});
