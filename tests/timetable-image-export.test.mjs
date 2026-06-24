import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("timetable panels expose per-panel high resolution image export", async () => {
  const source = await readSource("src/features/academic/timetable-workspace.tsx");

  assert.match(source, /ImageDown/);
  assert.match(source, /Loader2/);
  assert.match(source, /exportElementAsImage/);
  assert.match(source, /timetablePanelRefs/);
  assert.match(source, /getTimetableCaptureWidth/);
  assert.match(source, /scale:\s*3/);
  assert.match(source, /aria-label=\{`\$\{panel\.title\} 이미지 저장`\}/);
  assert.match(source, /className="absolute right-3 top-3 size-9/);
  assert.match(source, /pr-14/);
});

test("timetable blocks expose structured hover details", async () => {
  const records = await readSource("src/features/academic/records.js");
  const component = await readSource("src/features/academic/components/legacy-timetable-grid.jsx");

  assert.match(records, /tooltipDetails:\s*\{/);
  assert.match(records, /function buildLessonScheduleMap/);
  assert.match(records, /function formatFullLessonSchedule/);
  assert.match(records, /lessonKey,\s*\n\s*subject/);
  assert.match(records, /title,\s*\n\s*schedule/);
  assert.match(records, /teacher,\s*\n\s*classroom/);
  assert.match(records, /detailLines:\s*detailValue \? \[\{ value: detailValue \}\]/);
  assert.match(records, /timetableScheduleRows/);
  assert.doesNotMatch(records, /label:\s*detailLabel/);
  assert.doesNotMatch(records, /강의실",\s*\n\s*row\.classroom/);
  assert.doesNotMatch(records, /선생님",\s*\n\s*row\.teacher/);
  assert.match(component, /timetable-tooltip-title/);
  assert.match(component, /timetable-tooltip-schedule/);
  assert.match(component, /timetable-tooltip-badges/);
  assert.match(component, /timetable-tooltip-badge/);
  assert.doesNotMatch(component, /<dt>\{label\}<\/dt>/);
});

test("timetable panel headers show lesson count and weekly hours", async () => {
  const source = await readSource("src/features/academic/timetable-workspace.tsx");

  assert.match(source, /function getTimetablePanelSummary/);
  assert.match(source, /new Set\(/);
  assert.match(source, /block\.lessonKey \|\| block\.classId \|\| block\.key/);
  assert.match(source, /weeklyHoursLabel:\s*formatWeeklyHours/);
  assert.match(source, /flex-col gap-1\.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2/);
  assert.match(source, /flex max-w-full flex-wrap items-center gap-1\.5/);
  assert.match(source, /수업 \{panelSummary\.lessonCount\}개/);
  assert.match(source, /주간 \{panelSummary\.weeklyHoursLabel\}/);
  assert.match(source, /timetableScheduleRows:\s*workspace\.rows/);
});

test("compact timetable blocks keep class names readable", async () => {
  const css = await readSource("src/features/academic/timetable-grid-skin.module.css");
  const component = await readSource("src/features/academic/components/legacy-timetable-grid.jsx");
  const globals = await readSource("src/app/globals.css");

  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /\.scope :global\(\.timetable-cell\) \{[\s\S]*overflow:\s*visible/);
  assert.match(css, /word-break:\s*keep-all/);
  assert.match(css, /\.scope :global\(\.block-value\)/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.block-name\)/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact\) \{[\s\S]*justify-content:\s*flex-start/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.block-subject\) \{[\s\S]*align-self:\s*flex-start/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.block-name\) \{[\s\S]*word-break:\s*break-all/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.block-name\) \{[\s\S]*text-align:\s*left/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.block-info\) \{[\s\S]*margin-top:\s*auto/);
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.info-label\) \{[\s\S]*display:\s*none/);
  assert.match(css, /--timetable-fit-min-width:\s*560px/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*\.scope :global\(\.timetable-grid-shell\.is-fit-columns\) \{[\s\S]*overflow-x:\s*auto !important/);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*\.scope :global\(\.timetable-grid-shell\.is-fit-columns \.timetable-grid\) \{[\s\S]*min-width:\s*560px/);
  assert.match(component, /minWidth:\s*fitColumns \? 'var\(--timetable-fit-min-width, 0\)' : undefined/);
  assert.match(globals, /\.timetable-floating-tooltip/);
  assert.match(globals, /\.timetable-tooltip-title/);
  assert.match(globals, /\.timetable-tooltip-badge/);
});

test("timetable toolbar separates dense controls from scrollable target filters", async () => {
  const source = await readSource("src/features/academic/timetable-workspace.tsx");

  assert.match(source, /lg:grid-cols-\[12rem_minmax\(0,1fr\)_minmax\(0,1fr\)_9rem\]/);
  assert.match(source, /xl:grid-cols-\[minmax\(18rem,0\.7fr\)_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /grid grid-cols-2 gap-1\.5 sm:grid-cols-4/);
  assert.match(source, /className="h-8 min-w-0 justify-center rounded-md px-2 text-\[11px\] font-medium"/);
  assert.match(source, /overflow-x-auto px-1 pb-1 \[scrollbar-width:thin\]/);
  assert.match(source, /whitespace-nowrap/);
  assert.match(source, /"--timetable-panel-columns": `repeat\(\$\{Math\.min\(/);
  assert.match(source, /grid grid-cols-1 gap-6 lg:\[grid-template-columns:var\(--timetable-panel-columns\)\]/);
  assert.match(source, /필터 초기화/);
});
