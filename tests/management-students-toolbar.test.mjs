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
