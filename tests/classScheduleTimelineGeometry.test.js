import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  getSessionBarMetrics,
  getTimelineStepperNodeGeometry,
  getTimelineScheduleRailGeometry,
} from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

const timelineViewSource = fs.readFileSync(
  new URL("../src/components/class-schedule/ClassScheduleTimelineView.jsx", import.meta.url),
  "utf8",
);

const timelineCssSource = fs.readFileSync(
  new URL("../src/styles/tds-dashboard.css", import.meta.url),
  "utf8",
);

test("getSessionBarMetrics keeps week zoom sessions visibly wider than a one-day sliver", () => {
  const metrics = getSessionBarMetrics(
    { date: "2026-03-16" },
    "2026-03-09",
    18,
  );

  assert.ok(metrics.left >= 126);
  assert.ok(metrics.width >= 18);
});

test("getTimelineScheduleRailGeometry spans the full schedule window for class rows", () => {
  const geometry = getTimelineScheduleRailGeometry(
    [
      { date: "2026-03-09" },
      { date: "2026-03-16" },
      { date: "2026-03-23" },
      { date: "2026-03-30" },
    ],
    "2026-03-09",
    18,
    16,
  );

  assert.ok(geometry.left >= 16);
  assert.ok(geometry.width >= 72);
});

test("getTimelineStepperNodeGeometry centers a numbered step on the session date", () => {
  const geometry = getTimelineStepperNodeGeometry(
    { date: "2026-03-16", sessionNumber: 2 },
    "2026-03-09",
    18,
    16,
    28,
  );

  assert.equal(geometry.size, 28);
  assert.equal(geometry.left + geometry.size / 2, geometry.center);
  assert.ok(geometry.center > 140);
});

test("timeline renders a single body today track instead of one line per row", () => {
  const todayLineMatches =
    timelineViewSource.match(/className=\"class-schedule-timeline__today-line\"/g) || [];

  assert.equal(todayLineMatches.length, 1);
  assert.match(timelineViewSource, /class-schedule-timeline__today-track/);
});

test("timeline css clears legacy row padding and gap so header and lane share one grid", () => {
  assert.match(timelineCssSource, /\.class-schedule-timeline__row\s*\{[^}]*padding:\s*0;/s);
  assert.match(timelineCssSource, /\.class-schedule-timeline__row\s*\{[^}]*gap:\s*0;/s);
  assert.match(timelineCssSource, /\.class-schedule-timeline__lane\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test("timeline renders a stepper rail and numbered step nodes instead of bars", () => {
  assert.match(timelineViewSource, /class-schedule-timeline__stepper-rail/);
  assert.match(timelineViewSource, /class-schedule-timeline__stepper-node/);
  assert.doesNotMatch(timelineViewSource, /class-schedule-timeline__plan-bar/);
  assert.match(
    timelineCssSource,
    /\.class-schedule-timeline__header-left-copy\s*\{[^}]*justify-content:\s*center;/s,
  );
  assert.match(
    timelineCssSource,
    /\.class-schedule-timeline__stepper-node\s*\{/s,
  );
  assert.match(
    timelineCssSource,
    /\.class-schedule-timeline__stepper-node\s*\{[^}]*outline:\s*3px solid #fff;/s,
  );
  assert.match(
    timelineCssSource,
    /\.class-schedule-timeline__stepper-node\s*\{[^}]*z-index:\s*4;/s,
  );
});

test("workspace timeline surface no longer renders public page or class manager buttons", () => {
  assert.match(
    timelineCssSource,
    /\.class-schedule-workspace__surface-actions\s*\{[^}]*display:\s*none\s*!important;/s,
  );
});
