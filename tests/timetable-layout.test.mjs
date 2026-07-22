import test from "node:test";
import assert from "node:assert/strict";

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
