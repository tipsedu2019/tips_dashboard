import test from "node:test";
import assert from "node:assert/strict";

import { buildTimetableGridPanels } from "../src/features/academic/records.js";
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
