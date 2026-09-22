import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildTimetableGridPanels,
  buildTimetableWorkspaceModel,
} from "../src/features/academic/records.js";
import { getTimetablePanelLayout } from "../src/features/academic/timetable-layout.ts";

function createWorkspace() {
  return {
    teacherOptions: ["강부희", "강택중", "권승재", "김동엽"],
    classroomOptions: ["101호", "102호", "103호"],
    rows: [],
  };
}

test("selected teacher panels remain visible beyond the grid column count", () => {
  const grid = buildTimetableGridPanels({
    workspace: createWorkspace(),
    view: "teacher-weekly",
    gridCount: 2,
    selectedTargets: ["강부희", "강택중", "권승재"],
  });

  assert.deepEqual(grid.activeTargets, ["강부희", "강택중", "권승재"]);
  assert.equal(grid.panels.length, 3);
});

test("default panels include every available target when nothing is selected", () => {
  const grid = buildTimetableGridPanels({
    workspace: createWorkspace(),
    view: "teacher-weekly",
    gridCount: 2,
    selectedTargets: [],
  });

  assert.deepEqual(grid.activeTargets, ["강부희", "강택중", "권승재", "김동엽"]);
  assert.equal(grid.panels.length, 4);
});

test("teacher timetable filters only academic teams for the selected subject", () => {
  const classes = [
    {
      id: "english-class",
      name: "고3 영어",
      subject: "영어",
      teacher: "강부희",
      classroom: "별관 4강",
      schedule: "월 19:00-20:00",
      status: "수강",
    },
    {
      id: "admin-class",
      name: "운영 확인",
      subject: "영어",
      teacher: "정보영",
      classroom: "본관 1강",
      schedule: "화 19:00-20:00",
      status: "수강",
    },
    {
      id: "assistant-class",
      name: "보조 확인",
      subject: "영어",
      teacher: "허승주",
      classroom: "본관 2강",
      schedule: "수 19:00-20:00",
      status: "수강",
    },
    {
      id: "math-class",
      name: "고3 수학",
      subject: "수학",
      teacher: "김민경",
      classroom: "본관 3강",
      schedule: "목 19:00-20:00",
      status: "수강",
    },
    {
      id: "science-class",
      name: "고3 과학",
      subject: "과학",
      teacher: "이과학",
      classroom: "별관 4강",
      schedule: "금 19:00-20:00",
      status: "수강",
    },
  ];
  const teacherCatalogs = [
    { name: "강부희", subjects: "영어팀", sort_order: 1 },
    { name: "김민경", subjects: "수학팀", sort_order: 2 },
    { name: "이과학", subjects: "science", sort_order: 3 },
    { name: "정보영", subjects: "관리팀", sort_order: 4 },
    { name: "허승주", subjects: "조교팀", sort_order: 5 },
  ];

  const allSubjects = buildTimetableWorkspaceModel({ classes, teacherCatalogs });
  const englishOnly = buildTimetableWorkspaceModel({
    classes,
    teacherCatalogs,
    filters: { subject: "영어" },
  });
  const mathOnly = buildTimetableWorkspaceModel({
    classes,
    teacherCatalogs,
    filters: { subject: "수학" },
  });
  const scienceOnly = buildTimetableWorkspaceModel({
    classes,
    teacherCatalogs,
    filters: { subject: "과학" },
  });

  assert.deepEqual(allSubjects.teacherOptions, ["강부희", "김민경", "이과학"]);
  assert.deepEqual(englishOnly.teacherOptions, ["강부희"]);
  assert.deepEqual(mathOnly.teacherOptions, ["김민경"]);
  assert.deepEqual(scienceOnly.teacherOptions, ["이과학"]);
});

test("precomputed timetable rows preserve the legacy workspace and grid model", () => {
  const classes = [{
    id: "class-1",
    name: "[수학] 고1 심화",
    academic_year: "2026",
    subject: "수학",
    subject_area_key: "math",
    grade: "고1",
    teacher: "김교사",
    classroom: "본3",
    schedule: "월수 18:00-19:30",
    status: "수강",
  }];
  const legacy = buildTimetableWorkspaceModel({ classes });
  const precomputed = buildTimetableWorkspaceModel({
    classes: [],
    precomputedRows: legacy.rows,
  });

  assert.deepEqual(precomputed.rows, legacy.rows);
  assert.deepEqual(precomputed.summary, legacy.summary);
  assert.deepEqual(precomputed.teacherLoad, legacy.teacherLoad);
  assert.deepEqual(precomputed.classroomLoad, legacy.classroomLoad);
  assert.deepEqual(
    buildTimetableGridPanels({ workspace: precomputed, view: "teacher-weekly", gridCount: 1 }),
    buildTimetableGridPanels({ workspace: legacy, view: "teacher-weekly", gridCount: 1 }),
  );
});

test("timetable workspace requests only its active mode and keeps dense recovery explicit", async () => {
  const source = await readFile(
    new URL("../src/features/academic/timetable-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /useAcademicWorkspaceData\(\{\s*mode: "timetable"/);
  assert.match(source, /precomputedRows: data\.rows/);
  assert.match(source, /densityError \?/);
  assert.match(source, /successfulRequest/);
  assert.match(source, /filters: displayTimetableRequest\.filters/);
  assert.match(source, /다시 시도/);
  assert.doesNotMatch(source, /period-filter|readDefaultPeriod|setClassGroupId|setRangeDays/);
  assert.doesNotMatch(source, /data\.textbooks|data\.progressLogs/);
});

test("weekly timetable panels fit all weekdays without horizontal scrolling", () => {
  const layout = getTimetablePanelLayout({
    view: "teacher-weekly",
    gridCount: 2,
  });

  assert.equal(layout.allowHorizontalScroll, false);
  assert.equal(layout.timeColumnWidth, 76);
  assert.equal(layout.minColumnWidth, 0);
});

test("daily timetable panels keep horizontal scrolling for wider axis sets", () => {
  const layout = getTimetablePanelLayout({
    view: "daily-teacher",
    gridCount: 2,
  });

  assert.equal(layout.allowHorizontalScroll, true);
  assert.equal(layout.timeColumnWidth, 84);
  assert.equal(layout.minColumnWidth, 120);
});

// Memberships and a saved legacy group must not hide continuous classes.
test("timetable ignores retired period scopes and keeps exactly three status choices", () => {
  const classes = ["수강", "개강 준비", "종강"].map((status, i) => ({id:`class-${i}`,name:status,subject:"수학",teacher:"김선생",schedule:"월 18:00-19:00",status}));
  const all = buildTimetableWorkspaceModel({classes,filters:{classGroupId:"retired-period"}});
  assert.equal(all.rows.length, 3);
  assert.deepEqual(all.statusOptions,["수강","개강 준비","종강"]);
  for (const status of all.statusOptions) {
    const filtered = buildTimetableWorkspaceModel({classes,filters:{classGroupId:"retired-period",status}});
    assert.deepEqual(filtered.rows.map(row=>row.statusFilter),[status]);
  }
});

test("comparison panels share a cropped axis without losing morning or late lessons", () => {
  const classes = [{id:"a",teacher:"A",name:"오전",schedule:"월 09:00-10:00",status:"수강"},{id:"b",teacher:"B",name:"야간",schedule:"월 23:00-24:00",status:"수강"}];
  const grid = buildTimetableGridPanels({workspace:buildTimetableWorkspaceModel({classes})});
  assert.equal(grid.timeSlots[0],"08:30-09:00");
  assert.equal(grid.timeSlots.at(-1),"23:30-24:00");
  assert.deepEqual(grid.panels.map(panel=>panel.blocks[0].endSlot-panel.blocks[0].startSlot),[2,2]);
  for (const panel of grid.panels) for (const block of panel.blocks) {
    assert.ok(block.startSlot >= 0 && block.endSlot <= grid.timeSlots.length);
  }
});
