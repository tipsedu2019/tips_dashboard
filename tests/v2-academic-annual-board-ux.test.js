import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAcademicAnnualBoardModel } from "../v2/src/features/operations/academic-calendar-models.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("annual board model expands multi-grade events into per-grade rows while keeping canonical event-type columns", () => {
  const model = buildAcademicAnnualBoardModel({
    academicSchools: [{ id: "hs", name: "해성고", category: "high" }],
    academicEvents: [
      {
        id: "exam-window",
        school_id: "hs",
        school: "해성고",
        title: "1학기 중간고사",
        type: "시험",
        start: "2026-04-21",
        end: "2026-04-25",
        grade: "고1, 고2",
        note: '[[TIPS_META]] {"examTerm":"1학기 중간"}',
      },
      {
        id: "english-day",
        school_id: "hs",
        school: "해성고",
        title: "영어 듣기평가",
        type: "영어시험일",
        start: "2026-04-28",
        end: "2026-04-28",
        grade: "고1",
      },
    ],
    selectedYear: "2026",
  });

  assert.deepEqual(model.boardTypes, ["시험기간", "영어시험일", "수학시험일", "체험학습", "방학·휴일·기타"]);
  assert.equal(model.rows.length, 2);
  const grade1Row = model.rows.find((row) => row.schoolName === "해성고" && row.grade === "고1");
  const grade2Row = model.rows.find((row) => row.schoolName === "해성고" && row.grade === "고2");
  assert.ok(grade1Row);
  assert.ok(grade2Row);
  assert.equal(grade1Row.typeBuckets["시험기간"][0].examTerm, "1학기 중간");
  assert.equal(grade1Row.typeBuckets["영어시험일"][0].title, "영어 듣기평가");
  assert.equal(grade2Row.typeBuckets["시험기간"][0].title, "1학기 중간고사");
});

test("annual board model derives 영어/수학 시험일 entries from exam details with exam dates and DB-backed materials", () => {
  const model = buildAcademicAnnualBoardModel({
    academicSchools: [{ id: "hs", name: "대기고", category: "high" }],
    academicEvents: [
      {
        id: "exam-window",
        school_id: "hs",
        school: "대기고",
        title: "1학기 중간고사",
        type: "시험기간",
        start: "2026-04-28",
        end: "2026-04-30",
        grade: "고2",
        academic_year: "2026",
        note: '[[TIPS_META]] {"examTerm":"1학기 중간"}',
      },
    ],
    academicEventExamDetails: [
      {
        id: "detail-eng",
        academic_event_id: "exam-window",
        school_id: "hs",
        grade: "고2",
        subject: "영어",
        exam_date: "2026-04-29",
        textbook_scope: "영어 본문 4-6과",
        supplement_scope: "워크북 2-3단원",
      },
      {
        id: "detail-math",
        academic_event_id: "exam-window",
        school_id: "hs",
        grade: "고2",
        subject: "수학",
        exam_date: "2026-04-30",
        textbook_scope: "수학Ⅰ 1-3단원",
        supplement_scope: "쎈 1단원",
      },
    ],
    selectedYear: "2026",
  });

  const row = model.rows.find((entry) => entry.schoolName === "대기고" && entry.grade === "고2");
  assert.ok(row);
  assert.equal(row.typeBuckets["영어시험일"][0].dateLabel, "2026-04-29");
  assert.equal(row.typeBuckets["수학시험일"][0].dateLabel, "2026-04-30");
});

test("annual board workspace promotes school-category and subject to top filter tabs while removing missing-data controls", () => {
  const source = read("v2/src/features/operations/academic-annual-board-workspace.tsx");
  assert.match(source, /학교 분류/);
  assert.match(source, /과목/);
  assert.match(source, /categoryOptions\.map/);
  assert.match(source, /\(\["영어", "수학", "전체 과목"\] as const\)\.map/);
  assert.doesNotMatch(source, /missingDataFilter/);
  assert.doesNotMatch(source, /누락 필터/);
  assert.doesNotMatch(source, /시험일 미입력만/);
});

test("annual board workspace source uses hover-first details instead of a right-side inspector", () => {
  const source = read("v2/src/features/operations/academic-annual-board-workspace.tsx");
  assert.match(source, /buildBoardEntryMissingItems/);
  assert.match(source, /buildEntryTooltipRows/);
  assert.match(source, /TooltipContent/);
  assert.match(source, /linkedScheduleLabel/);
  assert.match(source, /누락 ·/);
  assert.doesNotMatch(source, /selectedBoardEntry/);
  assert.doesNotMatch(source, /SheetContent/);
  assert.doesNotMatch(source, /선택한 일정 상세/);
});

test("annual board workspace source groups rows by school-first columns, fixes category-specific 3-grade columns, and supports spreadsheet-like column resizing", () => {
  const source = read("v2/src/features/operations/academic-annual-board-workspace.tsx");
  const loaderSource = read("v2/src/features/operations/use-operations-workspace-data.ts");

  assert.match(source, /selectedSubject/);
  assert.doesNotMatch(source, /annual-board-subject/);
  assert.match(source, /const activeSubjectTab =/);
  assert.match(source, /const activeGradeColumnLabels = useMemo\(/);
  assert.match(source, /HIGH_GRADE_COLUMN_LABELS/);
  assert.match(source, /MIDDLE_GRADE_COLUMN_LABELS/);
  assert.match(source, /selectedCategory === "middle"/);
  assert.doesNotMatch(source, /const categoryColumnStyle = useMemo\(/);
  assert.match(source, /const schoolColumnStyle = useMemo\(/);
  assert.match(source, /createDefaultColumnWidths/);
  assert.match(source, /window\.localStorage\.setItem\(ANNUAL_BOARD_LAYOUT_STORAGE_KEY, JSON\.stringify\(columnWidths\)\)/);
  assert.match(source, /handleColumnResizePointerDown/);
  assert.match(source, /handleColumnAutoFit/);
  assert.match(source, /getAutoFitWidth/);
  assert.match(source, /cursor-col-resize/);
  assert.match(source, /data-column-content-key/);
  assert.doesNotMatch(source, /renderColumnHeaderContent\("분류", "category"/);
  assert.match(source, /renderColumnHeaderContent\("학교", "school"/);
  assert.match(source, /renderColumnHeaderContent\(gradeLabel, gradeLabel/);
  assert.match(source, /const groupedSchoolRows = useMemo\(/);
  assert.match(source, /const gradeColumnLabels = activeGradeColumnLabels/);
  assert.doesNotMatch(source, /renderColumnHeaderContent\("분류", "category"/);
  assert.match(source, /renderColumnHeaderContent\("학교", "school"/);
  assert.match(source, /gradeColumnLabels\.map/);
  assert.match(source, /groupedSchoolRows\.map/);
  assert.match(source, /handleBoardEntrySelect\(gradeRow, entry\)/);
  assert.match(source, /handleBoardEntryEdit\(gradeRow, \{/);
  assert.match(source, /TooltipContent/);
  assert.match(source, /buildEntryTooltipRows/);
  assert.match(source, /buildAggregateTooltipRows/);
  assert.doesNotMatch(source, /캘린더 보기/);
  assert.doesNotMatch(source, /rowSpan=\{4\}/);
  assert.doesNotMatch(source, /BOARD_COLUMN_LABELS/);
  assert.match(loaderSource, /academicEventExamDetails/);
});

test("annual board workspace keeps empty exam cells quick-add, hover-rich tooltips, and minimal in-cell rendering", () => {
  const source = read("v2/src/features/operations/academic-annual-board-workspace.tsx");

  assert.doesNotMatch(source, /학교·학년·시험 시기를 밀도 높게 비교하는 데이터 그리드/);
  assert.doesNotMatch(source, /<p className="text-sm font-semibold text-foreground">\{model\.selectedYear\} 연간 일정표<\/p>/);
  assert.match(source, /handleBoardCellCreate\(gradeRow, type, label\)/);
  assert.match(source, /disabled=\{false\}/);
  assert.match(source, /시험범위 일부 미입력/);
  assert.match(source, /buildBoardEntryMissingItems/);
  assert.match(source, /buildEntryTooltipRows/);
  assert.match(source, /연동 일정 ·/);
  assert.match(source, /누락 ·/);
  assert.match(source, /buildExamCellToneClasses/);
  assert.match(source, /flex min-h-12 items-center border px-2 py-1\.5 text-\[11px\] leading-4 transition-colors/);
  assert.match(source, /span className=\{toneClasses\.date\}>\{entry \? formatExamCellDateLabel\(entry\.dateLabel, type\) : "—"\}<\/span>/);
  assert.doesNotMatch(source, /toneClasses\.label/);
  assert.doesNotMatch(source, /toneClasses\.meta/);
  assert.doesNotMatch(source, /toneClasses\.status/);
  assert.doesNotMatch(source, /buildSubjectCellStatusLabel/);
  assert.doesNotMatch(source, /시험 시기 4개 행 비교/);
  assert.match(source, /bg-muted\/\[0\.02\] text-\[10px\] text-muted-foreground\/55/);
  assert.match(source, /grid-cols-\[72px_minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  assert.match(source, /grid-cols-\[72px_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  assert.match(source, /min-h-\[172px\]/);
  assert.doesNotMatch(source, /sm:max-w-\[560px\]/);
  assert.doesNotMatch(source, /선택한 일정의 상세 정보를 확인합니다/);
});

test("annual board workspace source exposes direct filter reset, high-school default category, and searchable query clear controls", () => {
  const source = read("v2/src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /const hasActiveFilters =/);
  assert.match(source, /const handleResetFilters = \(\) => \{/);
  assert.match(source, /setSelectedCategory\("high"\);/);
  assert.match(source, /setSelectedSemester\("전체"\);/);
  assert.match(source, /setSelectedSubject\("전체 과목"\);/);
  assert.match(source, /setSelectedSchoolId\(""\);/);
  assert.match(source, /setSelectedGrade\("all"\);/);
  assert.match(source, /setQuery\(""\);/);
  assert.match(source, /setHighlightEventId\(""\);/);
  assert.match(source, /setSelectedCategory\(option\.value as "high" \| "middle"\)/);
  assert.match(source, /value: "high", label: "고등"/);
  assert.match(source, /value: "middle", label: "중등"/);
  assert.doesNotMatch(source, /전체 분류/);
  assert.match(source, /placeholder="학교명, 학년, 일정명으로 검색"/);
  assert.match(source, /event\.key === "Escape" && query/);
  assert.match(source, /className=\{cn\("h-9 pl-9", query \? "pr-16" : ""\)\}/);
  assert.match(source, /aria-label="연간 일정표 검색어 지우기"/);
  assert.match(source, /필터 초기화/);
  assert.match(source, />\s*지우기\s*<\/button>/);
});

test("calendar workspace keeps routed initial date context without forcing a side inspector from annual-board jumps", () => {
  const workspaceSource = read("v2/src/features/operations/academic-calendar-workspace.tsx");
  const calendarSource = read("v2/src/app/admin/calendar/components/calendar.tsx");
  const formSource = read("v2/src/app/admin/calendar/components/event-form.tsx");
  const annualBoardSource = read("v2/src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(workspaceSource, /useSearchParams/);
  assert.match(calendarSource, /initialDate\?: Date/);
  assert.match(annualBoardSource, /handleBoardEntrySelect\(gradeRow, entry\)/);
  assert.doesNotMatch(annualBoardSource, /selectedBoardEntry/);
  assert.doesNotMatch(annualBoardSource, /SheetContent/);
  assert.doesNotMatch(annualBoardSource, /eventId: entry\.id/);
  assert.doesNotMatch(formSource, /연간 일정표 보기/);
});
