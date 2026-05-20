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

test("student management filters lifecycle status separately from school filters", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const STUDENT_SCHOOL_CATEGORY_OPTIONS = \["고등", "중등", "초등"\]/);
  assert.match(source, /STUDENT_STATUS_OPTIONS/);
  assert.match(source, /renderStudentStatusSelect/);
  assert.match(source, /renderStudentSchoolCategorySelect/);
  assert.match(source, /renderStudentSchoolSelect/);
  assert.match(source, /renderStudentGradeSelect/);
  assert.match(source, /studentSchoolCategoryFilter/);
  assert.doesNotMatch(source, /kind !== "students" && statusFilter/);
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
  assert.match(tableSource, /row\.statusValue \|\| row\.status/);
  assert.match(tableSource, /aria-label=\{`\$\{row\.title\} \$\{label\} 수업 \$\{count\}개 보기`\}/);
  assert.match(hookSource, /function attachStudentClassSummaries/);
  assert.match(hookSource, /const \[classes, classHistory, textbookSaleLines, textbooks\] = await Promise\.all/);
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

test("management table keeps resize handles out of the keyboard command flow", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const resizeHandle = source.match(/header\.column\.getCanResize\(\)[\s\S]*?onDoubleClick=\{\(\) => header\.column\.resetSize\(\)\}/)?.[0] || "";

  assert.match(resizeHandle, /aria-hidden="true"/);
  assert.match(resizeHandle, /tabIndex=\{-1\}/);
  assert.doesNotMatch(resizeHandle, /aria-label=\{`\$\{columnLabel\} 너비 조절`\}/);
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
  assert.match(tableSource, /deleteLabel=\{kind === "students" \? "일괄 퇴원" : "일괄 삭제"\}/);
  assert.match(tableSource, /일괄 수정/);
  assert.match(tableSource, /일괄 퇴원/);
  assert.match(pageSource, /handleBulkUpdateRows/);
  assert.match(pageSource, /handleBulkDeleteRows/);
  assert.match(pageSource, /Promise\.all\(rows\.map/);
  assert.match(pageSource, /WITHDRAWN_STUDENT_STATUS/);
  assert.match(pageSource, /onBulkUpdateRows: handleBulkUpdateRows/);
  assert.match(pageSource, /onBulkDeleteRows: handleBulkDeleteRows/);
});

test("management deletes use an in-app confirmation dialog", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /type DeleteRequest = \{ rows: ManagementRow\[\] \}/);
  assert.match(source, /const \[deleteRequest, setDeleteRequest\] = useState<DeleteRequest \| null>\(null\)/);
  assert.match(source, /setDeleteRequest\(\{ rows: \[row\] \}\)/);
  assert.match(source, /<Dialog open=\{Boolean\(deleteRequest\)\}/);
  assert.match(source, /onClick=\{handleConfirmDelete\}/);
});

test("management table keeps filter and search actions visible and reversible", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const panelSource = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");

  assert.match(panelSource, /primaryLabel\?: string/);
  assert.match(panelSource, /aria-label=\{`\$\{searchPlaceholder\} 지우기`\}/);
  assert.match(panelSource, /필터 \$\{String\(primaryLabel\)\}|필터 \$\{primaryLabel\}/);
  assert.match(tableSource, /const DEFAULT_PAGE_SIZE = 20/);
  assert.match(tableSource, /onSearchChange=\{updateGlobalFilter\}/);
  assert.match(tableSource, /primaryLabel=\{activePeriodLabel\}/);
  assert.match(tableSource, /setRowSelection\(\{\}\);[\s\S]*table\.resetPagination\(\);/);
  assert.match(tableSource, /aria-busy=\{loading\}/);
  assert.match(tableSource, /데이터를 불러오는 중입니다/);
});
