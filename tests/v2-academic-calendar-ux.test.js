import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDateSelectionRange,
  buildDragPreviewRange,
  buildMonthEventSegments,
  getEventGradeOptions,
  getGradeBadgeLabels,
  getSchoolOptionsForGrade,
  getGradeOptionsForSchoolCategory,
  parseGradeSelection,
  serializeGradeSelection,
  moveCalendarEventByAnchorDate,
  moveCalendarEventToDate,
} from "../v2/src/app/admin/calendar/utils/calendar-grid.js";
import { buildAcademicEventMutationPayload } from "../v2/src/features/operations/academic-event-utils.js";
import { buildAcademicCalendarTemplateModel } from "../v2/src/features/operations/academic-calendar-models.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("buildMonthEventSegments keeps a multi-day event visually connected across days and week boundaries", () => {
  const calendarDays = Array.from({ length: 14 }, (_, index) => new Date(2026, 3, 5 + index, 12));
  const event = {
    id: "exam-week",
    title: "중간고사",
    date: new Date(2026, 3, 8, 12),
    endDate: new Date(2026, 3, 14, 12),
  };

  const segments = buildMonthEventSegments(calendarDays, [event]);
  const eventSegments = segments.filter((segment) => segment.event.id === "exam-week");

  assert.equal(eventSegments.length, 2);
  assert.deepEqual(
    eventSegments.map((segment) => ({
      weekIndex: segment.weekIndex,
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      span: segment.span,
      continuesBefore: segment.continuesBefore,
      continuesAfter: segment.continuesAfter,
    })),
    [
      { weekIndex: 0, startIndex: 3, endIndex: 6, span: 4, continuesBefore: false, continuesAfter: true },
      { weekIndex: 1, startIndex: 0, endIndex: 2, span: 3, continuesBefore: true, continuesAfter: false },
    ],
  );
});

test("academic calendar template model keeps one event object for multi-day entries while date counts span the full range", () => {
  const model = buildAcademicCalendarTemplateModel({
    academicSchools: [{ id: "ms", name: "중앙여중", category: "middle" }],
    academicEvents: [
      {
        id: "trip",
        title: "중앙여중2 수학여행",
        school_id: "ms",
        school: "중앙여중",
        type: "체험학습",
        start: "2026-04-14",
        end: "2026-04-16",
        grade: "중2",
        note: "숙소 공지",
      },
    ],
  });

  assert.equal(model.events.length, 1);
  assert.equal(model.events[0].sourceId, "trip");
  assert.equal(model.events[0].note, "숙소 공지");
  assert.equal(model.events[0].date.getDate(), 14);
  assert.equal(model.events[0].endDate.getDate(), 16);
  assert.deepEqual(
    model.eventDates.map((entry) => entry.date.getDate()),
    [14, 15, 16],
  );
});

test("legacy exam labels normalize to 시험기간 in calendar model", () => {
  const model = buildAcademicCalendarTemplateModel({
    academicSchools: [{ id: "hs", name: "고등학교", category: "high" }],
    academicEvents: [
      {
        id: "legacy-exam",
        title: "중간고사",
        school_id: "hs",
        school: "고등학교",
        type: "시험",
        start: "2026-04-14",
        end: "2026-04-14",
        grade: "고1",
      },
      {
        id: "legacy-unknown",
        title: "기타 일정",
        school_id: "hs",
        school: "고등학교",
        type: "알 수 없는 일정",
        start: "2026-04-20",
        end: "2026-04-20",
        grade: "고1",
      },
    ],
  });

  assert.equal(model.events[0].typeLabel, "시험기간");
  assert.equal(model.events[1].typeLabel, "방학·휴일·기타");
});

test("buildDateSelectionRange normalizes dragged calendar selection into ascending start/end dates", () => {
  const range = buildDateSelectionRange(new Date(2026, 3, 19, 12), new Date(2026, 3, 14, 12));

  assert.equal(range.start.getFullYear(), 2026);
  assert.equal(range.start.getMonth(), 3);
  assert.equal(range.start.getDate(), 14);
  assert.equal(range.end.getFullYear(), 2026);
  assert.equal(range.end.getMonth(), 3);
  assert.equal(range.end.getDate(), 19);
});

test("moveCalendarEventByAnchorDate preserves the dragged offset for continued multi-day bars", () => {
  const moved = moveCalendarEventByAnchorDate(
    {
      id: "event-anchor",
      title: "중간고사",
      date: new Date(2026, 3, 14, 12),
      endDate: new Date(2026, 3, 16, 12),
      duration: "2026-04-14 ~ 2026-04-16",
    },
    new Date(2026, 3, 15, 12),
    new Date(2026, 3, 22, 12),
  );

  assert.equal(moved.date.getDate(), 21);
  assert.equal(moved.endDate.getDate(), 23);
});

test("moveCalendarEventToDate preserves span while shifting an existing event across the month grid", () => {
  const moved = moveCalendarEventToDate(
    {
      id: "event-1",
      title: "중간고사",
      date: new Date(2026, 3, 14, 12),
      endDate: new Date(2026, 3, 16, 12),
      duration: "2026-04-14 ~ 2026-04-16",
    },
    new Date(2026, 3, 21, 12),
  );

  assert.equal(moved.date.getDate(), 21);
  assert.equal(moved.endDate.getDate(), 23);
  assert.equal(moved.duration, "2026-04-21 ~ 2026-04-23");
});

test("buildDragPreviewRange exposes the shifted span used for month-grid drop feedback", () => {
  const preview = buildDragPreviewRange(
    {
      id: "event-2",
      title: "영어시험일",
      date: new Date(2026, 3, 10, 12),
      endDate: new Date(2026, 3, 12, 12),
    },
    new Date(2026, 3, 18, 12),
    new Date(2026, 3, 11, 12),
  );

  assert.equal(preview.start.getDate(), 17);
  assert.equal(preview.end.getDate(), 19);
});

test("grade options narrow to the selected school category", () => {
  assert.deepEqual(
    getGradeOptionsForSchoolCategory("middle").map((option) => option.value),
    ["all", "중1", "중2", "중3"],
  );
  assert.deepEqual(
    getGradeOptionsForSchoolCategory("high").map((option) => option.value),
    ["all", "고1", "고2", "고3", "N수"],
  );
});

test("school options narrow to the selected grade band", () => {
  const schools = [
    { id: "es", name: "초등학교", category: "elementary" },
    { id: "ms", name: "중학교", category: "middle" },
    { id: "hs", name: "고등학교", category: "high" },
  ];

  assert.deepEqual(
    getSchoolOptionsForGrade("중2", schools).map((school) => school.id),
    ["ms"],
  );
  assert.deepEqual(
    getSchoolOptionsForGrade("고3", schools).map((school) => school.id),
    ["hs"],
  );
  assert.deepEqual(
    getSchoolOptionsForGrade("all", schools).map((school) => school.id),
    ["es", "ms", "hs"],
  );
});

test("academic event mutation payload embeds exam metadata into note without changing schema", () => {
  const result = buildAcademicEventMutationPayload(
    {
      title: "고1 영어 중간고사",
      schoolId: "hs",
      type: "영어시험일",
      start: "2026-04-14",
      end: "2026-04-14",
      grade: "고1",
      note: "시험 대비",
      examTerm: "1학기 중간",
      textbookScope: "독해 1~3강",
      subtextbookScope: "워크북 2단원",
      textbookScopes: [
        { name: "Reading Power", publisher: "A사", scope: "1~3과" },
      ],
      subtextbookScopes: [
        { name: "Workbook", publisher: "B사", scope: "1권 20쪽까지" },
      ],
    },
    [{ id: "hs", name: "고등학교", category: "high" }],
  );

  assert.equal(result.isValid, true);
  assert.match(result.payload.note, /시험 대비/);
  assert.match(result.payload.note, /\[\[TIPS_META\]\]/);
  assert.match(result.payload.note, /1학기 중간/);
  assert.match(result.payload.note, /독해 1~3강/);
  assert.match(result.payload.note, /워크북 2단원/);
  assert.match(result.payload.note, /Reading Power/);
  assert.match(result.payload.note, /Workbook/);
});

test("grade options are selectable presets instead of free-form text entry", () => {
  assert.deepEqual(getEventGradeOptions(), [
    { value: "all", label: "전체" },
    { value: "초등", label: "초등" },
    { value: "중1", label: "중1" },
    { value: "중2", label: "중2" },
    { value: "중3", label: "중3" },
    { value: "고1", label: "고1" },
    { value: "고2", label: "고2" },
    { value: "고3", label: "고3" },
    { value: "N수", label: "N수" },
  ]);
});

test("grade helpers preserve multi-select db values as ordered selections and badge labels", () => {
  assert.deepEqual(parseGradeSelection("고2, 고1, 고2, all"), ["고2", "고1"]);
  assert.equal(serializeGradeSelection(["고2", "고1", "고2"]), "고2, 고1");
  assert.equal(serializeGradeSelection([]), "all");
  assert.deepEqual(getGradeBadgeLabels("고1, 고2"), ["고1", "고2"]);
  assert.deepEqual(getGradeBadgeLabels("all"), ["전체"]);
});

test("calendar main source exposes overflow, quick-add, existing-event drag-drop hooks, annual-board shortcuts, and exam-range hover details", () => {
  const source = read("v2/src/app/admin/calendar/components/calendar-main.tsx");
  const linkSource = read("v2/src/features/operations/academic-calendar-links.ts");

  assert.match(source, /readOnly/);
  assert.match(source, /initialQuery/);
  assert.match(source, /appliedInitialQueryRef/);
  assert.match(source, /setQuery\(initialQuery\)/);
  assert.match(source, /matchesCalendarQuery/);
  assert.match(source, /HoverCard/);
  assert.match(source, /HoverCardTrigger/);
  assert.match(source, /HoverCardContent/);
  assert.match(source, /시험 범위 보기/);
  assert.match(source, /getAcademicEventTypeLabel\(event\.typeLabel\)/);
  assert.match(source, /교재 시험범위/);
  assert.match(source, /부교재 시험범위/);
  assert.match(source, /textbookScope/);
  assert.match(source, /subtextbookScope/);
  assert.match(source, /renderExamScopeHover/);
  assert.match(source, /event\.typeLabel !== "시험기간" && event\.typeLabel !== "영어시험일" && event\.typeLabel !== "수학시험일"/);
  assert.match(source, /const schoolBadgeLabel = event\.schoolName \|\| event\.location/);
  assert.match(source, /const gradeBadgeLabels = .*event\.grade/);
  assert.match(source, /\.filter\(\(label\) => label && label !== "전체"\)/);
  assert.doesNotMatch(source, /\.slice\(0, size === "month" \? 1 : 3\)/);
  assert.match(source, /renderEventContextBadges/);
  assert.match(source, /hover:-translate-y-px hover:shadow-md/);
  assert.match(source, /{renderExamScopeHover\(event, "h-4 px-1 text-\[9px\]"\)}/);
  assert.match(source, /<span className="truncate">\{event\.title\}<\/span>/);
  assert.match(source, /{renderEventContextBadges\(event, "month"\)}/);
  assert.match(source, /{renderExamScopeHover\(event\)}/);
  assert.match(source, /<h3 className="font-medium">\{event\.title\}<\/h3>/);
  assert.match(source, /{renderEventContextBadges\(event, "list"\)}/);
  assert.match(source, /buildAcademicAnnualBoardEventHref/);
  assert.match(source, /const annualBoardHref = buildAcademicAnnualBoardEventHref\(event\)/);
  assert.match(source, /const annualBoardHref = buildAcademicAnnualBoardEventHref\(event, group\.date\)/);
  assert.match(source, /const annualBoardHref = buildAcademicAnnualBoardEventHref\(event, overflowDate \|\| event\.date\)/);
  assert.match(source, /aria-label=\{`\$\{event\.title\} 연간 일정표 바로가기`\}/);
  assert.match(source, /title="연간 일정표 바로가기"/);
  assert.match(source, /split\(\/\\s\+\/\)/);
  assert.match(source, /tokens\.every\(\(token\) => searchText\.includes\(token\)\)/);
  assert.match(source, /onOverflowClick/);
  assert.match(source, /onEmptySlotClick/);
  assert.match(source, /onRangeSelect/);
  assert.match(source, /try \{/);
  assert.match(source, /const moveResult = await onEventDrop\?\.\(draggedEvent, nextEvent\)/);
  assert.match(source, /if \(moveResult === false\) \{/);
  assert.match(source, /\} finally \{/);
  assert.match(source, /const hasSameStartDate = nextEvent\.date\.getTime\(\) === getEventRange\(draggedEvent\)\.start\.getTime\(\)/);
  assert.match(source, /if \(hasSameStartDate\) \{/);
  assert.match(source, /draggable=\{!readOnly\}/);
  assert.match(source, /dragAnchorDate/);
  assert.match(source, /pendingDragAnchorDateRef/);
  assert.match(source, /if \(!draggedEvent \|\| readOnly\)/);
  assert.match(source, /onDragStart/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /onPointerDown=\{\(pointerEvent\) => \{/);
  assert.match(source, /!readOnly \? \(/);
  assert.match(source, /pointerEvent\.currentTarget\.getBoundingClientRect\(\)/);
  assert.match(source, /window.addEventListener\("pointerup", resetSelection\)/);
  assert.match(source, /window.addEventListener\("pointercancel", resetSelection\)/);
  assert.match(source, /isWithinDragPreview/);
  assert.match(source, /formatAgendaDay/);
  assert.match(source, /eachDayOfInterval\(\{ start, end \}\)/);
  assert.match(source, /handleSelectionFinish/);
  assert.match(source, /selectionAnchor\.getTime\(\) !== day\.getTime\(\)/);
  assert.match(source, /Agenda/);
  assert.match(source, /이 날 일정 추가/);
  assert.match(source, /overflowEvents.length\}개 일정/);
  assert.match(source, /선택한 날짜에 표시할 일정이 없습니다/);
  assert.match(source, /setOverflowDate\(null\)/);
  assert.match(source, /openOverflow\(day, dayEvents\)/);
  assert.match(source, /buildAcademicAnnualBoardHref/);
  assert.match(source, /grade: event\.grade/);
  assert.match(source, /연간 일정표/);
  assert.match(source, /연간 일정표에서 보기/);
  assert.match(source, /<div className="inline-flex w-fit items-center rounded-lg border bg-muted\/20 p-1">/);
  assert.match(source, /aria-pressed=\{viewMode === "month"\}/);
  assert.match(source, /aria-pressed=\{viewMode === "list"\}/);
  assert.match(source, /onClick=\{\(\) => setViewMode\("month"\)\}/);
  assert.match(source, /onClick=\{\(\) => setViewMode\("list"\)\}/);
  assert.doesNotMatch(source, /DropdownMenuTrigger/);
  assert.doesNotMatch(source, /ChevronDown/);
  assert.match(linkSource, /buildAcademicAnnualBoardHref/);
});

test("calendar month overflow control stops range-selection pointer events before opening the day dialog", () => {
  const source = read("v2/src/app/admin/calendar/components/calendar-main.tsx");

  assert.match(
    source,
    /hiddenCount > 0[\s\S]*onPointerDown=\{\(pointerEvent\) => \{[\s\S]*pointerEvent\.stopPropagation\(\)[\s\S]*onClick=\{\(clickEvent\) => \{[\s\S]*openOverflow\(day, dayEvents\)/,
  );
});

test("calendar source wires left sidebar filters and event-move handoff into the workspace shell", () => {
  const source = read("v2/src/app/admin/calendar/components/calendar.tsx");

  assert.match(source, /activeFilters/);
  assert.match(source, /handleCalendarToggle/);
  assert.match(source, /type:/);
  assert.match(source, /category:/);
  assert.match(source, /visibleEvents = useMemo/);
  assert.match(source, /onMoveEvent/);
  assert.match(source, /onEventDrop/);
  assert.match(source, /setActiveFilters\(\(prev\) => \{/);
  assert.match(source, /prev\[key\] \?\? visible/);
  assert.match(source, /setShowCalendarSheet\(false\)/);
  assert.match(source, /appliedInitialDateRef/);
  assert.match(source, /initialDate instanceof Date/);
  assert.match(source, /const handleNewEvent = \(date\?: Date\) => \{/);
  assert.match(source, /if \(date instanceof Date && !Number\.isNaN\(date\.getTime\(\)\)\) \{/);
  assert.match(source, /setSelectedDate\(date\)/);
  assert.match(source, /defaultDate=\{selectedDate\}/);
  assert.match(source, /readOnly=\{readOnly\}/);
  assert.match(source, /SheetTitle>학사일정 캘린더/);
  assert.doesNotMatch(source, /SheetDescription/);
  assert.doesNotMatch(source, /날짜별 밀도를 보고 일정 분류를 함께 확인할 수 있습니다/);
});

test("calendar sidebar source keeps filter controls minimal and removes dead add actions in read-only mode", () => {
  const source = read("v2/src/app/admin/calendar/components/calendars.tsx");
  const sidebarSource = read("v2/src/app/admin/calendar/components/calendar-sidebar.tsx");

  assert.doesNotMatch(source, /Eye/);
  assert.doesNotMatch(source, /EyeOff/);
  assert.doesNotMatch(source, /MoreHorizontal/);
  assert.doesNotMatch(source, /Plus/);
  assert.doesNotMatch(source, /DropdownMenu/);
  assert.doesNotMatch(source, /opacity-0/);
  assert.match(sidebarSource, /readOnly\?: boolean/);
  assert.match(sidebarSource, /!readOnly \? \(/);
  assert.doesNotMatch(sidebarSource, /Add New Event Button/);
});

test("event form source uses exam-focused fields and compact row layout", () => {
  const source = read("v2/src/app/admin/calendar/components/event-form.tsx");

  assert.match(source, /getEventGradeOptions/);
  assert.match(source, /getGradeBadgeLabels/);
  assert.match(source, /parseGradeSelection/);
  assert.match(source, /serializeGradeSelection/);
  assert.match(source, /toggleGradeSelection/);
  assert.match(source, /DropdownMenu/);
  assert.match(source, /DropdownMenuCheckboxItem/);
  assert.match(source, /getGradeOptionsForSchoolCategory/);
  assert.match(source, /getSchoolOptionsForGrade/);
  assert.match(source, /md:grid-cols-2/);
  assert.match(source, /<Label className="flex items-center gap-2">[\s\S]*일정 유형[\s\S]*<Label className="flex items-center gap-2">[\s\S]*시기/s);
  assert.match(source, /showExamTermField && "md:grid-cols-2"/);
  assert.match(source, /일정 제목/);
  assert.match(source, /<div className="space-y-2">[\s\S]*일정 제목[\s\S]*<\/div>\n\n          <div className="grid gap-4 md:grid-cols-2">[\s\S]*학년[\s\S]*학교/s);
  assert.match(source, /일정 유형/);
  assert.match(source, /학년/);
  assert.match(source, /학교/);
  assert.match(source, /시작일/);
  assert.match(source, /종료일/);
  assert.match(source, /메모/);
  assert.match(source, /DEFAULT_ACADEMIC_EVENT_TYPES/);
  assert.match(source, /getAcademicEventTypeLabel\(typeOption\)/);
  assert.match(source, /showScopeFields/);
  assert.match(source, /showExamTermField/);
  assert.match(source, /grade: serializeGradeSelection\(selectedGrades\)/);
  assert.match(source, /selectedGrades/);
  assert.match(source, /학년 미선택/);
  assert.match(source, /대상 학년 선택/);
  assert.doesNotMatch(source, /selected-grade-/);
  assert.match(source, /1학기 중간/);
  assert.match(source, /교재명/);
  assert.match(source, /출판사/);
  assert.match(source, /범위/);
  assert.match(source, /부교재/);
  assert.match(source, /시기/);
  assert.match(source, /showScopeFields \? formData\.textbookScopes : \[\]/);
  assert.match(source, /showExamTermField \? formData\.examTerm : ""/);
  assert.match(source, /<Select\s+value=\{formData\.schoolId\}/s);
  assert.doesNotMatch(source, /연간 일정표 보기/);
  assert.doesNotMatch(source, /buildAcademicAnnualBoardHref/);
  assert.doesNotMatch(source, /ArrowUpRight/);
  assert.doesNotMatch(source, /DialogDescription/);
  assert.doesNotMatch(source, /운영 메모/);
  assert.doesNotMatch(source, /<Input\s+id="grade"/s);
});

test("event form save path does not silently return without visible user feedback", () => {
  const source = read("v2/src/app/admin/calendar/components/event-form.tsx");
  assert.doesNotMatch(source, /if \(!selectedSchool && !readOnly\) \{\s*return\s*\}/s);
  assert.match(source, /시작일을 확인해 주세요/);
  assert.match(source, /종료일을 확인해 주세요/);
  assert.match(source, /if \(saved !== false\) \{/);
});

test("calendar shell and workspace keep failed mutations from looking successful while keeping readonly state compact", () => {
  const calendarSource = read("v2/src/app/admin/calendar/components/calendar.tsx");
  const workspaceSource = read("v2/src/features/operations/academic-calendar-workspace.tsx");

  assert.match(calendarSource, /if \(saved === false\) \{/);
  assert.match(calendarSource, /onEventDrop=\{readOnly \? undefined/);
  assert.match(workspaceSource, /읽기 전용 상태에서는 학사 일정을 수정할 수 없습니다/);
  assert.match(workspaceSource, /기본 일정 세트 표시 중/);
  assert.match(workspaceSource, /수정 기능 비활성화/);
  assert.doesNotMatch(workspaceSource, /현재는 TIPS 기본 일정 세트가 표시되고 있습니다/);
  assert.doesNotMatch(workspaceSource, /학사일정 조회 전용 상태입니다/);
  assert.match(workspaceSource, /return false;/);
  assert.match(workspaceSource, /return true;/);
});
