import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeClassManagementRecord } from "../src/features/management/records.js";

const root = new URL("../", import.meta.url);

test("class toolbar uses the shared class filter panel", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const panelSource = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");

  assert.match(source, /<ClassFilterPanel\s+selects=\{classFilterSelects\}/);
  assert.match(source, /quickSelectIds=\{CLASS_QUICK_FILTER_IDS\}/);
  assert.match(source, /const CLASS_QUICK_FILTER_IDS = CLASS_FILTERS\.map/);
  assert.match(source, /classFilterChips/);
  assert.match(panelSource, /searchPlaceholder/);
  assert.match(panelSource, /role="search" aria-label=\{searchPlaceholder\}/);
  assert.match(panelSource, /type="search"/);
  assert.match(panelSource, /autoComplete="off"/);
  assert.match(panelSource, /enterKeyHint="search"/);
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
  assert.match(source, /data-testid="student-quick-filters"/);
  assert.match(source, /renderStudentQuickFilter\("학교 구분", renderStudentSchoolCategorySelect\(\)\)/);
  assert.match(source, /renderStudentQuickFilter\("학교", renderStudentSchoolSelect\(\)\)/);
  assert.match(source, /renderStudentQuickFilter\("학년", renderStudentGradeSelect\(\)\)/);
  assert.match(source, /studentSchoolCategoryFilter/);
  assert.match(source, /<div className="text-sm font-semibold">필터<\/div>/);
  assert.match(source, /\{resetControl\}/);
  assert.match(source, /const activeStudentMenuFilterCount = \[statusFilter\]/);
  assert.doesNotMatch(source, /sm:grid-cols-4/);
  assert.doesNotMatch(source, /kind !== "students" && statusFilter/);
});

test("student management keeps search and school filters in the URL for cross-view returns", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const STUDENT_LIST_QUERY_PARAM_KEYS =/);
  assert.match(source, /function getStudentListQueryState/);
  assert.match(source, /q: normalizeScalar\(params\.get\(STUDENT_LIST_QUERY_PARAM_KEYS\.q\)\)/);
  assert.match(source, /status: normalizeScalar\(params\.get\(STUDENT_LIST_QUERY_PARAM_KEYS\.status\)\)/);
  assert.match(source, /schoolCategory: normalizeScalar\(params\.get\(STUDENT_LIST_QUERY_PARAM_KEYS\.schoolCategory\)\)/);
  assert.match(source, /school: normalizeScalar\(params\.get\(STUDENT_LIST_QUERY_PARAM_KEYS\.school\)\)/);
  assert.match(source, /grade: normalizeScalar\(params\.get\(STUDENT_LIST_QUERY_PARAM_KEYS\.grade\)\)/);
  assert.match(source, /function buildStudentListHref/);
  assert.match(source, /const requestedStudentListQueryState = useMemo/);
  assert.match(source, /syncStudentListQueryState\(\{ q: value \}\)/);
  assert.match(source, /syncStudentListQueryState\(\{ status: nextStatusValue \}\)/);
  assert.match(source, /syncStudentListQueryState\(\{ schoolCategory: nextSchoolCategoryFilter, school: "", grade: "" \}\)/);
  assert.match(source, /syncStudentListQueryState\(\{ school: nextSchoolFilter, grade: "" \}\)/);
  assert.match(source, /syncStudentListQueryState\(\{ grade: nextGradeFilter \}\)/);
});

test("student management opens with active students before withdrawn records", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const studentDefaultConfig = source.match(/students:\s*\{[\s\S]*?\n\s*\},\n\s*classes:/)?.[0] || "";

  assert.match(source, /const STORAGE_VERSION = 14/);
  assert.match(source, /const STUDENT_STATUS_SORT_ORDER = \["재원", "퇴원"\]/);
  assert.match(source, /function compareStudentStatusForTable/);
  assert.match(studentDefaultConfig, /\{ id: "status", desc: false \},\s*\{ id: "title", desc: false \}/);
  assert.match(source, /sortingFn: kind === "students"[\s\S]*compareStudentStatusForTable/);
});

test("student edit dialog optimizes first entry and phone fields", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /inputMode\?: "text" \| "search" \| "tel"/);
  assert.match(source, /name: "contact"[\s\S]*inputMode: "tel"[\s\S]*autoComplete: "tel"/);
  assert.match(source, /name: "parentContact"[\s\S]*inputMode: "tel"[\s\S]*autoComplete: "tel"/);
  assert.match(source, /autoFocus=\{scope === "form" && field\.name === FORM_FIELDS\[kind\]\[0\]\?\.name\}/);
  assert.match(source, /name=\{field\.name\}/);
  assert.match(source, /autoComplete=\{field\.autoComplete \|\| "off"\}/);
});

test("management list search exposes the current data type to operators", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /role="search" aria-label=\{`\$\{emptyLabel\} 검색`\}/);
  assert.match(source, /type="search"/);
  assert.match(source, /aria-label=\{`\$\{emptyLabel\} 검색`\}/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /enterKeyHint="search"/);
  assert.doesNotMatch(source, /aria-label="검색"/);
});

test("management table empty state stays compact and action-first", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const emptyStateTitle = rows\.length === 0 \? `\$\{emptyLabel\} 없음` : `\$\{emptyLabel\} 결과 없음`/);
  assert.doesNotMatch(source, /emptyStateSummary/);
  assert.doesNotMatch(source, /관리 레코드가 아직 비어 있습니다/);
  assert.doesNotMatch(source, /현재 조건 적용 중/);
  assert.doesNotMatch(source, /border border-dashed border-border\/70/);
  assert.match(source, /<span className="text-sm font-medium text-muted-foreground">\{emptyStateTitle\}<\/span>/);
  assert.match(source, /hasActiveFilters \? \([\s\S]*조건 초기화[\s\S]*\) : hasCreateAction \? \(/);
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

test("management table defers heavy global filtering while typing", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /useDeferredValue/);
  assert.match(source, /const deferredGlobalFilter = useDeferredValue\(globalFilter\)/);
  assert.match(source, /globalFilter:\s*deferredGlobalFilter/);
  assert.match(source, /value=\{globalFilter \?\? ""\}/);
});

test("management search preserves Korean IME composition before syncing URL filters", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const panelSource = await readFile(new URL("src/features/management/class-filter-panel.tsx", root), "utf8");

  assert.match(tableSource, /const globalFilterCompositionRef = useRef\(false\)/);
  assert.match(tableSource, /options\.syncUrl !== false && !globalFilterCompositionRef\.current/);
  assert.match(tableSource, /onChange=\{handleGlobalFilterChange\}/);
  assert.match(tableSource, /onCompositionStart=\{handleGlobalFilterCompositionStart\}/);
  assert.match(tableSource, /onCompositionEnd=\{handleGlobalFilterCompositionEnd\}/);
  assert.match(tableSource, /!globalFilterCompositionRef\.current && globalFilter !== requestedClassListQueryState\.q/);
  assert.match(tableSource, /!globalFilterCompositionRef\.current && globalFilter !== requestedStudentListQueryState\.q/);
  assert.match(panelSource, /onSearchChange: \(value: string, options\?: \{ syncUrl\?: boolean \}\) => void/);
  assert.match(panelSource, /isComposingSearchInput\(event\)/);
  assert.match(panelSource, /onCompositionEnd=\{\(event\) => onSearchCompositionEnd\?\.\(event\.currentTarget\.value\)\}/);
});

test("management table exposes resize handles with a clear reset action", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const resizeHandle = source.match(/header\.column\.getCanResize\(\)[\s\S]*?onKeyDown=\{\(event\) => \{[\s\S]*?\}\}/)?.[0] || "";

  assert.match(resizeHandle, /aria-label=\{`\$\{columnLabel\} 열 너비 조절`\}/);
  assert.match(resizeHandle, /title=\{`\$\{columnLabel\} 열 너비 조절`\}/);
  assert.match(resizeHandle, /w-4 cursor-col-resize/);
  assert.match(resizeHandle, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(resizeHandle, /header\.column\.resetSize\(\)/);
  assert.doesNotMatch(resizeHandle, /aria-hidden="true"/);
  assert.doesNotMatch(resizeHandle, /tabIndex=\{-1\}/);
});

test("class teacher and classroom cells space comma-delimited values for scanning", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /function formatDelimitedLabel\(value: unknown\)/);
  assert.match(source, /replace\(\/\\s\*,\\s\*\/g, ", "\)/);
  assert.match(source, /renderPlainCell\(formatDelimitedLabel\(\(row\.original\.raw \|\| \{\}\)\.teacher/);
  assert.match(source, /renderPlainCell\(formatDelimitedLabel\(\(row\.original\.raw \|\| \{\}\)\.classroom/);
});

test("class table caption announces operational totals instead of status counts", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const captionSuffix = kind === "classes"\s*\?\s*summaryLabel/);
  assert.match(source, /classRegisteredTotal/);
  assert.match(source, /classWeeklyMinutesTotal/);
  assert.match(source, /return minutes > 0 \? `\$\{hours\}시간 \$\{minutes\}분` : `\$\{hours\}시간`/);
  assert.doesNotMatch(source, /padStart\(2, "0"\).*시간/);
});

test("class management uses mobile cards instead of a clipped wide table", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const classMobileList = kind === "classes" \? \(/);
  assert.match(source, /className="grid gap-2 md:hidden"/);
  assert.match(source, /row\.toggleSelected\(\!\!value\)/);
  assert.match(source, /renderClassScheduleCell\(row\.original\)/);
  assert.match(source, /\(kind === "classes" \|\| kind === "students"\) && "hidden md:block"/);
});

test("student management uses mobile cards instead of a clipped wide table", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /const studentMobileList = kind === "students" \? \(/);
  assert.match(source, /aria-label=\{`\$\{emptyLabel\} 모바일 학생 목록`\}/);
  assert.match(source, /data-testid=\{`student-mobile-card-\$\{row\.id\}`\}/);
  assert.match(source, /renderStudentClassStatusPopover\(record\)/);
  assert.match(source, /parent_contact \|\| raw\.parentContact/);
  assert.match(source, /\(kind === "classes" \|\| kind === "students"\) && "hidden md:block"/);
});

test("class weekly hours count compact Korean weekday groups", () => {
  const saturdaySunday = normalizeClassManagementRecord({
    id: "compact-weekend",
    name: "고2 기하",
    schedule: "토일 17:00-18:30",
  });
  const wednesdayFriday = normalizeClassManagementRecord({
    id: "compact-weekdays",
    name: "고3 미적분",
    schedule: "수금 19:30-21:30",
  });
  const halfHour = normalizeClassManagementRecord({
    id: "half-hour",
    name: "고1A 공통수학1",
    schedule: "수 21:30-23:30 / 일 11:30-13:00",
  });

  assert.equal(saturdaySunday.metrics.weeklyMinutes, 180);
  assert.equal(saturdaySunday.metrics.weeklyHoursLabel, "3시간");
  assert.equal(wednesdayFriday.metrics.weeklyMinutes, 240);
  assert.equal(wednesdayFriday.metrics.weeklyHoursLabel, "4시간");
  assert.equal(halfHour.metrics.weeklyMinutes, 210);
  assert.equal(halfHour.metrics.weeklyHoursLabel, "3시간 30분");
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
  assert.match(tableSource, /onDelete=\{actions\.onBulkDeleteRows \? \(\) => void submitBulkDelete\(\) : undefined\}/);
  assert.match(tableSource, /일괄 수정/);
  assert.match(tableSource, /일괄 퇴원/);
  assert.doesNotMatch(tableSource, /일괄 종강/);
  assert.match(pageSource, /handleBulkUpdateRows/);
  assert.match(pageSource, /handleBulkDeleteRows/);
  assert.match(pageSource, /Promise\.all\(rows\.map/);
  assert.match(pageSource, /WITHDRAWN_STUDENT_STATUS/);
  assert.match(pageSource, /onBulkUpdateRows: canMutateRows \? handleBulkUpdateRows : undefined/);
  assert.match(pageSource, /onBulkDeleteRows: canMutateRows && kind !== "classes" \? handleBulkDeleteRows : undefined/);
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

test("management databases restore list scroll after opening a record", async () => {
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(tableSource, /MANAGEMENT_SCROLL_STORAGE_PREFIX/);
  assert.match(tableSource, /function getManagementListScrollStorageKey/);
  assert.match(tableSource, /params\.delete\("classId"\)/);
  assert.match(tableSource, /params\.delete\("studentId"\)/);
  assert.match(tableSource, /function parseStoredManagementScroll/);
  assert.match(tableSource, /const tableViewportRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(tableSource, /const rememberManagementScrollPosition = useCallback/);
  assert.match(tableSource, /window\.sessionStorage\.setItem/);
  assert.match(tableSource, /pageY: window\.scrollY/);
  assert.match(tableSource, /tableX: tableViewportRef\.current\?\.scrollLeft \|\| 0/);
  assert.match(tableSource, /const openManagementRow = useCallback/);
  assert.match(tableSource, /rememberManagementScrollPosition\(\)/);
  assert.match(tableSource, /actions\.onOpenRow\?\.\(row\)/);
  assert.match(tableSource, /window\.requestAnimationFrame/);
  assert.match(tableSource, /window\.scrollTo\(\{ top: savedScroll\.pageY \}\)/);
  assert.match(tableSource, /tableViewportRef\.current\.scrollLeft = savedScroll\.tableX/);
  assert.match(tableSource, /ref=\{tableViewportRef\}/);
});
