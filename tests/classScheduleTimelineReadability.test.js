import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTimelineDayLabel } from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("buildTimelineDayLabel keeps week zoom readable by suppressing secondary labels on non-anchor days", () => {
  const monday = {
    date: new Date("2026-03-16T00:00:00Z"),
    label: "16",
    weekdayLabel: "월",
    monthLabel: "3월",
    isToday: false,
  };
  const tuesday = {
    date: new Date("2026-03-17T00:00:00Z"),
    label: "17",
    weekdayLabel: "화",
    monthLabel: "3월",
    isToday: false,
  };

  assert.deepEqual(buildTimelineDayLabel(monday, "week"), {
    primary: "16",
    secondary: "월",
    emphasis: "major",
  });
  assert.deepEqual(buildTimelineDayLabel(tuesday, "week"), {
    primary: "17",
    secondary: "",
    emphasis: "quiet",
  });
});

test("buildTimelineDayLabel turns 4week zoom into anchor-only labels", () => {
  const firstDay = {
    date: new Date("2026-04-01T00:00:00Z"),
    label: "1",
    weekdayLabel: "수",
    monthLabel: "4월",
    isToday: false,
  };
  const plainDay = {
    date: new Date("2026-04-02T00:00:00Z"),
    label: "2",
    weekdayLabel: "목",
    monthLabel: "4월",
    isToday: false,
  };

  assert.deepEqual(buildTimelineDayLabel(firstDay, "4week"), {
    primary: "4월",
    secondary: "1",
    emphasis: "major",
  });
  assert.deepEqual(buildTimelineDayLabel(plainDay, "4week"), {
    primary: "",
    secondary: "",
    emphasis: "quiet",
  });
});

test("timeline view renders a dedicated today pill for the axis header", () => {
  const source = read("src/components/class-schedule/ClassScheduleTimelineView.jsx");

  assert.match(source, /class-schedule-timeline__today-pill/);
});
