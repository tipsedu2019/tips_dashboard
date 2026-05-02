import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("class toolbar uses the shared class filter panel", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const panelSource = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");

  assert.match(source, /<ClassFilterPanel\s+selects=\{classFilterSelects\}/);
  assert.match(source, /classFilterChips/);
  assert.match(panelSource, /searchPlaceholder/);
  assert.match(panelSource, /createLabel/);
  assert.match(panelSource, /조건 초기화/);
});

test("student management uses school filters instead of assignment status filter", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const STUDENT_SCHOOL_CATEGORY_OPTIONS = \["고등", "중등", "초등"\]/);
  assert.match(source, /renderStudentSchoolCategorySelect/);
  assert.match(source, /renderStudentSchoolSelect/);
  assert.match(source, /renderStudentGradeSelect/);
  assert.match(source, /studentSchoolCategoryFilter/);
  assert.match(source, /kind !== "students" && statusFilter/);
});

test("class-only column filters never access missing student or textbook columns", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /kind === "classes" && allColumnIds\.includes\("subject"\) \? table\.getColumn\("subject"\) : undefined/);
  assert.match(source, /const classFilterValues = kind === "classes"\s*\?\s*CLASS_FILTERS\.map/);
  assert.match(source, /if \(kind === "classes"\) \{\s*for \(const filter of CLASS_FILTERS\)/);
});

test("student status badge can open a class roster popover", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");

  assert.match(tableSource, /function renderStudentClassStatusPopover/);
  assert.match(tableSource, /aria-label=\{`\$\{row\.title\} \$\{label\} 수업 \$\{count\}개 보기`\}/);
  assert.match(hookSource, /function attachStudentClassSummaries/);
  assert.match(hookSource, /const classes = await readOptionalTable\("classes"\)/);
});

test("student name cells do not repeat school and grade subtitle", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /kind === "textbooks" \? \(\s*<span className="truncate text-xs text-muted-foreground">\{row\.original\.subtitle/);
  assert.doesNotMatch(source, /kind === "classes" \? null : \(\s*<span className="truncate text-xs text-muted-foreground">\{row\.original\.subtitle/);
});

test("editable management titles expose pointer, hover, and focus feedback", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /cursor-pointer/);
  assert.match(source, /hover:bg-primary\/5/);
  assert.match(source, /hover:text-primary/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /hover:bg-muted\/30/);
});

test("management table disables TanStack render-time auto reset queues", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const tableOptions = source.match(/const table = useReactTable\(\{[\s\S]*?\n  \}\);/)?.[0] || "";

  assert.match(tableOptions, /autoResetAll:\s*false/);
});

test("student and class tables expose bulk edit and delete actions for selected rows", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(tableSource, /type BulkEditField/);
  assert.match(tableSource, /const BULK_EDIT_FIELDS/);
  assert.match(tableSource, /function ManagementBulkActionBar/);
  assert.match(tableSource, /selectedRows/);
  assert.match(tableSource, /actions\.onBulkUpdateRows/);
  assert.match(tableSource, /actions\.onBulkDeleteRows/);
  assert.match(tableSource, /bulkEditField/);
  assert.match(tableSource, /일괄 수정/);
  assert.match(tableSource, /일괄 삭제/);
  assert.match(pageSource, /handleBulkUpdateRows/);
  assert.match(pageSource, /handleBulkDeleteRows/);
  assert.match(pageSource, /Promise\.all\(rows\.map/);
  assert.match(pageSource, /onBulkUpdateRows: handleBulkUpdateRows/);
  assert.match(pageSource, /onBulkDeleteRows: handleBulkDeleteRows/);
});
