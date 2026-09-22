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
  assert.match(source, /className="absolute right-2 top-2 size-11/);
  assert.match(source, /pr-16/);
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


  assert.match(source, /수업 \{panelSummary\.lessonCount\}개/);
  assert.match(source, /view.endsWith\("weekly"\)/);
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
  assert.match(css, /\.scope :global\(\.timetable-block\.is-compact \.block-name\) \{[\s\S]*word-break:\s*keep-all/);
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

test("timetable reuses shared tabs and responsive filters without semester controls", async () => {
  const source = await readSource("src/features/academic/timetable-workspace.tsx");
  assert.match(source, /WorkspaceTabsList\s+aria-label="시간표 보기"/);
  assert.match(source, /DataTableFilterPanel\s+label="시간표 조건"/);
  assert.match(source, /TimetableTargetFilter/);
  assert.doesNotMatch(source, /period-filter|setClassGroupId/);
  assert.match(source, /xl:\[grid-template-columns:var\(--timetable-panel-columns\)\]/);
});
