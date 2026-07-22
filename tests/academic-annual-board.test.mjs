import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  getPersistedAcademicEventId,
  runAcademicEventMutation,
} from "../src/features/operations/academic-event-utils.js";
import {
  buildAcademicAnnualBoardModel,
  buildAcademicCalendarTemplateModel,
} from "../src/features/operations/academic-calendar-models.js";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("annual board orders science after math and derives its area and scope summary", () => {
  const model = buildAcademicAnnualBoardModel({
    selectedYear: "2026",
    academicSchools: [{ id: "school-high", name: "대기고", category: "high" }],
    academicEvents: [
      {
        id: "exam-period-1",
        title: "대기고 1학기 중간고사",
        school_id: "school-high",
        school: "대기고",
        type: "시험기간",
        grade: "고1",
        start: "2026-04-27",
        end: "2026-04-30",
        note: '사용자 메모\n\n[[TIPS_META]] {"examTerm":"1학기 중간","scienceAreaKey":"integrated_science","legacyFlag":"keep"}',
      },
    ],
    academicEventExamDetails: [
      {
        academic_event_id: "exam-period-1",
        grade: "고1",
        subject: "과학",
        exam_date: "2026-04-29",
        textbook_scope: "1단원 물질의 규칙성",
      },
    ],
  });

  assert.deepEqual(model.boardTypes.slice(0, 4), [
    "시험기간",
    "영어시험일",
    "수학시험일",
    "과학시험일",
  ]);
  const scienceEntry = model.rows[0].typeBuckets["과학시험일"][0];
  assert.equal(scienceEntry.title, "과학 시험일 및 시험범위");
  assert.equal(scienceEntry.scienceAreaKey, "integrated_science");
  assert.equal(scienceEntry.scienceAreaLabel, "통합과학");
  assert.match(scienceEntry.scopeSummary, /통합과학/);
  assert.match(scienceEntry.scopeSummary, /1단원 물질의 규칙성/);
  assert.equal(scienceEntry.note, "사용자 메모");
  assert.equal(scienceEntry.embeddedNoteMeta.legacyFlag, "keep");
});

test("calendar and annual board display the current active label for a stable science area key", () => {
  const input = {
    academicSchools: [{ id: "school-high", name: "대기고", category: "high" }],
    scienceSubjectAreas: [
      { areaKey: "physics", label: "물리", sortOrder: 20, isActive: true },
    ],
    academicEvents: [
      {
        id: "renamed-physics-event",
        title: "물리 시험",
        school_id: "school-high",
        school: "대기고",
        type: "과학시험일",
        grade: "고2",
        start: "2026-04-29",
        note: '[[TIPS_META]] {"scienceAreaKey":"physics"}',
      },
    ],
  };

  const calendar = buildAcademicCalendarTemplateModel(input);
  const annual = buildAcademicAnnualBoardModel({ ...input, selectedYear: "2026" });

  assert.equal(calendar.events[0].scienceAreaKey, "physics");
  assert.equal(calendar.events[0].scienceAreaLabel, "물리");
  assert.equal(annual.rows[0].typeBuckets["과학시험일"][0].scienceAreaLabel, "물리");
  assert.match(annual.rows[0].typeBuckets["과학시험일"][0].scopeSummary, /물리/);
});

test("annual board displays legacy middle-school science events but hides their create action", async () => {
  const model = buildAcademicAnnualBoardModel({
    selectedYear: "2026",
    academicSchools: [{ id: "school-middle", name: "대기중", category: "middle" }],
    academicEvents: [
      {
        id: "legacy-science-event",
        title: "기존 과학 시험",
        school_id: "school-middle",
        school: "대기중",
        type: "과학시험일",
        grade: "중3",
        start: "2026-04-29",
        note: '기존 메모\n\n[[TIPS_META]] {"scienceAreaKey":"physics"}',
      },
    ],
  });
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.equal(model.rows[0].typeBuckets["과학시험일"][0].title, "기존 과학 시험");
  assert.match(source, /const legacySubjectEntry/);
  assert.match(source, /examTerm\.endsWith\("중간"\)/);
  assert.match(source, /canCreateScienceExam/);
  assert.match(source, /HIGH_SCHOOL_GRADES\.includes/);
  assert.match(source, /primaryEntry \|\| canCreateScienceExam/);
});

test("annual board uses one unified editable map without mode tabs", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.doesNotMatch(source, /빠른 편집/);
  assert.doesNotMatch(source, /전체 맵/);
  assert.doesNotMatch(source, /Tabs/);
  assert.match(source, /AnnualBoardMapView/);
  assert.match(source, /onCellCreate/);
  assert.match(source, /onEntryEdit/);
});

test("annual board exposes only 전체, 1학기, 2학기 period filtering", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /const SEMESTER_FILTER_OPTIONS = \["전체", "1학기", "2학기"\] as const/);
  assert.match(source, /Label htmlFor="annual-board-semester"[^>]*>시기<\/Label>/);
  assert.match(source, /getTermRows\(selectedSemester\)/);
  assert.match(source, /row\.semester === selectedSemester/);
});

test("annual board hover popover shows subject scope and opens existing edit modal", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /HoverCard/);
  assert.match(source, /교재 시험범위/);
  assert.match(source, /부교재 시험범위/);
  assert.match(source, /getStructuredScopeItems/);
  assert.match(source, /setShowBoardEventForm\(true\)/);
  assert.match(source, /<EventForm/);
});

test("annual board exports the visible annual map as a high resolution image", async () => {
  const [source, globals] = await Promise.all([
    readSource("src/features/operations/academic-annual-board-workspace.tsx"),
    readSource("src/app/globals.css"),
  ]);

  assert.match(source, /ImageDown/);
  assert.match(source, /Loader2/);
  assert.match(source, /exportElementAsImage/);
  assert.match(source, /annualBoardExportRef/);
  assert.match(source, /prepareAnnualBoardImageExport/);
  assert.match(source, /scale:\s*3/);
  assert.match(source, /annual-board-export-scroll/);
  assert.match(source, /이미지 저장/);
  assert.doesNotMatch(source, /window\.print\(\)/);
  assert.match(source, /ml-auto flex w-full shrink-0 justify-end gap-2 sm:w-auto/);
  assert.match(globals, /@page\s*\{\s*size:\s*A4 landscape/);
  assert.match(globals, /\.annual-board-map-row-alt/);
  assert.match(globals, /\.annual-board-row-active/);
  assert.match(globals, /\.annual-board-column-active/);
  assert.match(globals, /\.annual-board-value-period/);
  assert.match(globals, /\.annual-board-value-empty/);
  assert.match(globals, /\.annual-board-image-export-surface\[data-image-exporting="true"\] \.annual-board-value > span/);
  assert.match(globals, /\[data-slot="sidebar"\][\s\S]*?display:\s*none !important/);
  assert.doesNotMatch(globals, /\[data-slot="sidebar-inset"\][\s\S]{0,80}display:\s*none !important/);
});

test("image export uses browser-rendered capture first and keeps html2canvas as a safe fallback", async () => {
  const source = await readSource("src/lib/export-as-image.ts");

  assert.match(source, /html-to-image/);
  assert.match(source, /renderElementToBlobWithHtmlToImage/);
  assert.match(source, /renderElementToBlobWithHtml2Canvas/);
  assert.match(source, /data-image-exporting/);
  assert.match(source, /waitForDocumentFonts/);
  assert.match(source, /sanitizeHtml2CanvasTextRendering/);
  assert.match(source, /normalizeLabFunction/);
  assert.match(source, /normalizeOklchFunction/);
  assert.match(source, /normalizeOklabFunction/);
  assert.match(source, /normalizeLchFunction/);
  assert.match(source, /normalizeColorMixFunction/);
  assert.match(source, /sanitizeHtml2CanvasDocumentBackground/);
  assert.match(source, /document\.documentElement/);
  assert.match(source, /\[element, \.\.\.Array\.from\(element\.querySelectorAll/);
  assert.match(source, /html2canvas/);
  assert.match(source, /falling back to html2canvas/);
  assert.match(source, /\(\?:color-mix\|color\|lab\|lch\|oklab\|oklch\)/);
});

test("annual board keeps the school column compact", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /annual-board-table min-w-\[1228px\]/);
  assert.match(source, /data-testid="annual-board-mobile-list"/);
  assert.match(source, /data-testid=\{`annual-board-mobile-school-\$\{schoolRow\.schoolKey\}`\}/);
  assert.match(source, /annual-board-export-scroll hidden overflow-x-auto md:block/);
  assert.match(source, /sticky left-0 z-20 w-\[96px\]/);
  assert.match(source, /annual-board-school-cell sticky left-0 z-10 w-\[96px\]/);
  assert.doesNotMatch(source, /w-\[148px\]/);
});

test("annual board CSS keeps all four exam columns and only clears the science edge", async () => {
  const globals = await readSource("src/app/globals.css");

  assert.match(
    globals,
    /\.annual-board-grade-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(132px,\s*1\.6fr\)\s+repeat\(3,\s*minmax\(76px,\s*1fr\)\)/,
  );
  assert.match(globals, /\.annual-board-grade-grid \.annual-board-grade-subheader:nth-child\(4n\)/);
  assert.doesNotMatch(globals, /\.annual-board-grade-grid \.annual-board-grade-subheader:nth-child\(3n\)/);
});

test("annual board model classifies event semesters by requested month split", async () => {
  const source = await readSource("src/features/operations/academic-calendar-models.js");

  assert.match(source, /\["01", "02", "03", "04", "05", "06", "07"\]\.includes\(month\)\) return "1학기"/);
  assert.match(source, /\["08", "09", "10", "11", "12"\]\.includes\(month\)\) return "2학기"/);
});

test("annual board saves empty-cell drafts through the resilient academic event mutation path", async () => {
  const source = await readSource("src/features/operations/academic-annual-board-workspace.tsx");

  assert.match(source, /runAcademicEventMutation/);
  assert.match(source, /getAcademicEventMutationErrorMessage\(saveError, "학사 일정 저장 중 오류가 발생했습니다\."\)/);
  assert.doesNotMatch(source, /\.insert\(\[result\.payload\]\)/);
});

test("annual board treats synthetic subject exam entry ids as new academic events", async () => {
  const [source, eventFormSource] = await Promise.all([
    readSource("src/features/operations/academic-annual-board-workspace.tsx"),
    readSource("src/app/admin/calendar/components/event-form.tsx"),
  ]);

  assert.equal(
    getPersistedAcademicEventId("ebc14155-43d9-4a76-8ee2-a555e389c787:subject-exam:fallback"),
    "",
  );
  assert.equal(
    getPersistedAcademicEventId("ebc14155-43d9-4a76-8ee2-a555e389c787"),
    "ebc14155-43d9-4a76-8ee2-a555e389c787",
  );
  assert.match(source, /const persistedId = getPersistedAcademicEventId\(entry\.id\)/);
  assert.match(source, /sourceId: persistedId/);
  assert.match(source, /const existingId = getPersistedAcademicEventId\(eventData\.id\)/);
  assert.doesNotMatch(source, /const existingId = text\(eventData\.id\)/);
  assert.match(eventFormSource, /const persistedEventId = getPersistedAcademicEventId\(event\?\.sourceId \|\| event\?\.id\)/);
  assert.match(eventFormSource, /id: persistedEventId/);
});

test("annual board strips internal metadata from displayed note sections", async () => {
  const source = await readSource("src/features/operations/academic-calendar-models.js");

  assert.match(source, /function stripEmbeddedNoteMeta/);
  assert.match(source, /const pushLabeledNote = \(bucket, label, value\) =>/);
  assert.match(source, /pushLabeledNote\(noteItems, "계획 메모", plan\?\.note\)/);
  assert.match(source, /pushLabeledNote\(noteItems, "계획 메모", examMaterialPlan\?\.note\)/);
  assert.match(source, /pushLabeledNote\(noteItems, "메모", detail\?\.note\)/);
  assert.doesNotMatch(source, /계획 메모 · \$\{text\(plan\.note\)\}/);
});

test("academic event mutation drops optional columns when Supabase reports schema drift", async () => {
  const attempts = [];
  const result = await runAcademicEventMutation(
    {
      title: "대기고 1학기 중간고사",
      school_id: "school-1",
      school: "대기고",
      type: "시험기간",
      start: "2026-04-28",
      end: "2026-04-28",
      date: "2026-04-28",
      grade: "고1",
      category: "high",
      note: null,
    },
    async (payload) => {
      attempts.push({ ...payload });
      if ("school_id" in payload) {
        return { error: { message: "Could not find the 'school_id' column of 'academic_events' in the schema cache" } };
      }
      return { error: null };
    },
  );

  assert.equal(result.error, null);
  assert.ok(attempts.length >= 2);
  assert.equal("school_id" in attempts.at(-1), false);
  assert.equal(attempts.at(-1).title, "대기고 1학기 중간고사");
});
