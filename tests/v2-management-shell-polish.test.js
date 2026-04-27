import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const managementPageFile = path.join(
  root,
  "v2",
  "src",
  "features",
  "management",
  "management-page.tsx",
);
const managementTableFile = path.join(
  root,
  "v2",
  "src",
  "features",
  "management",
  "management-data-table.tsx",
);

test("management page passes live stats into the shared data table", () => {
  const source = fs.readFileSync(managementPageFile, "utf8");

  assert.match(source, /const\s+\{\s*rows,\s*stats,\s*loading,\s*error,\s*refresh\s*\}\s*=\s*useManagementRecords\(kind\)/);
  assert.match(source, /stats=\{stats\}/);
});

test("management data table keeps the workspace minimal while using compact live-state pills and descriptive empty states", () => {
  const source = fs.readFileSync(managementTableFile, "utf8");

  for (const marker of [
    "검색",
    "조건 초기화",
    "컬럼 구성",
    "이전",
    "다음",
    'aria-label="현재 페이지 전체 선택"',
    'aria-label={`${emptyLabel} 항목 선택`}',
    "normalizedGlobalFilter",
    "normalizedColumnSearchQuery",
    "matchingColumnOrder",
    "hasActiveFilters",
    "sortClassStudentSummariesAscending",
    "sortClassFilterOptions",
    "splitClassFilterValue",
    "getClassFilterValues",
    "CLASS_STATUS_FILTER_OPTIONS",
    "getClassAcademicYear",
    "getClassTerm",
    "getClassStatusFilterValue",
    "const [classYearFilter, setClassYearFilter] = useState(\"\")",
    "const [classTermFilter, setClassTermFilter] = useState(\"\")",
    "const classYearOptions = useMemo(",
    "const classTermOptions = useMemo(() =>",
    "periodFilteredRows",
    "renderClassPeriodTabs",
    "전체 {label}",
    "selectedSubjectFilter",
    'table.getColumn("teacher")?.setFilterValue("");',
    'table.getColumn("classroom")?.setFilterValue("");',
    "getClassCount",
    "parseWeeklyMinutes",
    "formatWeeklyMinutes",
    "PAGE_SIZE_OPTIONS",
    'aria-label="페이지당 표시 개수"',
    "table.setPageSize(Number(value))",
    "summaryLabel",
    "주간 수업시수",
    "emptyStateTitle",
    "emptyStateSummary",
    "등록된 ${emptyLabel} 데이터가 없습니다.",
    "현재 조건에 맞는 ${emptyLabel} 데이터가 없습니다.",
    "관리 레코드가 아직 비어 있습니다.",
    "검색·필터 결과가 비어 있습니다.",
    "columnSettingsControl",
    'aria-label="컬럼 구성"',
    '<Trash2 className="size-4" />',
    '검색할 컬럼 이름',
    '일치하는 컬럼이 없습니다.',
    '표시 {visibleColumns} / 전체 {columnOptions.length}열',
    '현재 조건 적용 중',
    '검색어 {normalizedGlobalFilter}',
    'CLASS_TABLE_COLUMN_IDS',
    'id: "subject"',
    'id: "grade"',
    'id: "schedule"',
    'id: "teacher"',
    'id: "classroom"',
    'id: "enrollmentStatus"',
    'id: "capacity"',
    'id: "weeklyHours"',
    'id: "tuition"',
    'id: "action"',
    'kind === "classes" ? "수업명" : "이름"',
    '요일/시간',
    '수강 현황',
    '주간 수업시간',
    '수업료',
    'renderEnrollmentRosterPopover("등록", registeredCount, registeredStudents)',
    'renderEnrollmentRosterPopover("대기", waitlistCount, waitlistStudents)',
    "capacityStatus ? <span",
    "renderClassCapacityCell",
    'const CLASS_FILTERS = [',
    'function getClassFilterValue(row: ManagementRow, columnId: ClassFilterColumnId)',
    'const classFilterOptions = useMemo(() =>',
    'const activeClassFilters = kind === "classes" ? classFilterValues.filter((filter) => filter.value) : []',
    '전체 {filter.label}',
    'header.column.toggleSorting(sortState === "asc")',
    '학생 등록',
    '수업 등록',
    '교재 등록',
    'const hasCreateAction = typeof actions.onCreate === "function";',
    'disabled={!hasCreateAction}',
    '.filter((columnId) => columnId !== "select" && columnId !== "action")',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const marker of [
    "운영 워크스페이스",
    "라이브 운영 요약",
    "현재 선택",
    "내보내기 준비",
    "연동 상태와 현재 필터 결과를 요약한 화면입니다.",
    "JSON 저장 가능",
    "선택됨",
    "JSON 내보내기",
    "템플릿 다운로드",
    "데이터 업로드",
    "onEditRow",
    "학교 마스터",
    "선생님 마스터",
    "강의실 마스터",
    "학기 마스터",
    "hasSchoolMasterAction",
    "hasTeacherMasterAction",
    "hasClassroomMasterAction",
    "hasTermManagerAction",
    "검색 · 필터 · 컬럼 구성",
    "학생 관리",
    "수업 관리",
    "교재 관리",
    "검색과 필터 조건만 적용된 상태입니다.",
    "검색·필터 없이 전체 목록을 보는 중입니다.",
    "{visibleRangeStart}–{visibleRangeEnd} / {filteredRowCount}건",
    "컬럼 보기/숨기기, 순서, 정렬, 그룹화를 조정하면 브라우저에 자동 저장됩니다.",
    "최대 2단까지 묶어 볼 수 있습니다.",
    "최대 2단까지 저장합니다.",
    "표시 여부와 순서를 저장합니다.",
    ">Export<",
    ">Columns <",
    ">Page<",
    ">Previous<",
    ">Next<",
    'aria-label="Select all"',
    'aria-label="Select row"',
  ]) {
    assert.equal(source.includes(marker), false, `unexpected stale label ${marker}`);
  }

  assert.match(source, /<caption className="sr-only">/);
});

test("management column settings hide raw DB source columns from the user-facing configurator", () => {
  const source = fs.readFileSync(managementTableFile, "utf8");

  for (const marker of [
    "STUDENT_TABLE_COLUMN_IDS",
    "TEXTBOOK_TABLE_COLUMN_IDS",
    "id: \"school\"",
    "id: \"contact\"",
    "id: \"parentContact\"",
    "id: \"publisher\"",
    "id: \"price\"",
    "id: \"updatedAt\"",
    'const USER_FACING_COLUMN_IDS',
    'const TABLE_COLUMN_IDS_BY_KIND',
    'function getKindColumnIds(kind: ManagementKind)',
    'return getKindColumnIds(kind).has(columnId) && USER_FACING_COLUMN_IDS.has(columnId);',
    ".filter((columnId) => USER_FACING_COLUMN_IDS.has(columnId))",
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const staleMarker of [
    "DB 원본 열",
    "rawColumns",
    "...rawColumns",
    "raw:school",
    "raw:contact",
    "raw:parent_contact",
    "raw:teacher",
    "raw:publisher",
    "raw:price",
    "raw:updated_at",
  ]) {
    assert.equal(source.includes(staleMarker), false, `unexpected raw DB column exposure ${staleMarker}`);
  }
});

test("management column settings persist per-column widths alongside per-resource columns", () => {
  const source = fs.readFileSync(managementTableFile, "utf8");

  for (const marker of [
    "type ColumnSizingState",
    "const DEFAULT_COLUMN_WIDTHS",
    "columnSizing: ColumnSizingState",
    "function buildDefaultColumnSizing(columnIds: string[])",
    "function normalizeColumnWidth(value: unknown, fallback: number)",
    "const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});",
    "onColumnSizingChange: setColumnSizing",
    "columnResizeMode: \"onChange\"",
    "setColumnSizing(sanitized.columnSizing)",
    "setColumnSizing(defaultColumnSizing)",
    'aria-label={`${option.label} 너비`}',
    "id={`column-width-${kind}-${columnId}`}",
    "setColumnSizing((current) => ({",
    "style={getColumnSizeStyle(header.getSize())}",
    "style={getColumnSizeStyle(cell.column.getSize())}",
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }
});

test("management records hook localizes missing-connection fallback errors", () => {
  const source = fs.readFileSync(managementPageFile.replace("management-page.tsx", "use-management-records.ts"), "utf8");

  assert.match(source, /Supabase 연결 설정을 확인해 주세요\./);
  assert.match(source, /알 수 없는 연결 오류가 발생했습니다\./);
  assert.equal(source.includes("Supabase is not configured."), false);
  assert.equal(source.includes("Unknown error"), false);
});
