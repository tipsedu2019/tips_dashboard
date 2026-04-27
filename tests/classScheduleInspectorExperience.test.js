import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildInspectorSessionSummary } from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("buildInspectorSessionSummary centers the visible session rail around the current selection", () => {
  const row = {
    warningSummary: {
      planDrift: { message: "Behind by 1" },
      syncGap: null,
    },
    sessions: Array.from({ length: 8 }, (_, index) => ({
      id: `session-${index + 1}`,
      sessionNumber: index + 1,
      progressStatus:
        index < 2 ? "done" : index < 4 ? "partial" : "pending",
    })),
  };

  const summary = buildInspectorSessionSummary(row, "session-4", 5);

  assert.equal(summary.selectedSessionId, "session-4");
  assert.equal(summary.previousSessionId, "session-3");
  assert.equal(summary.nextSessionId, "session-5");
  assert.equal(summary.totalSessions, 8);
  assert.equal(summary.doneCount, 2);
  assert.equal(summary.partialCount, 2);
  assert.equal(summary.pendingCount, 4);
  assert.equal(summary.warningCount, 1);
  assert.deepEqual(summary.visibleSessionIds, [
    "session-2",
    "session-3",
    "session-4",
    "session-5",
    "session-6",
  ]);
});

test("inspector and public preview expose the new shared session context hooks", () => {
  const inspectorSource = read("src/components/class-schedule/ClassScheduleQuickProgressPopover.jsx");
  const publicSource = read("src/components/class-schedule/PublicClassVerticalTimeline.jsx");

  assert.match(inspectorSource, /class-schedule-inspector__metrics/);
  assert.match(inspectorSource, /class-schedule-inspector__section-heading/);
  assert.match(publicSource, /selectedSessionId/);
});
