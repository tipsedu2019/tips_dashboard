import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildInspectorSessionNavigator,
  resolveWorkspaceSelection,
} from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function createRows() {
  return [
    {
      classItem: {
        id: "class-1",
        className: "A반",
        subject: "영어",
        teacher: "Kim Teacher",
      },
      warningSummary: {
        planDrift: null,
        syncGap: null,
      },
      sessions: [
        {
          id: "session-1",
          sessionNumber: 1,
          date: "2026-03-02",
          progressStatus: "done",
          textbookEntries: [
            {
              textbookId: "tb-main",
              plan: { label: "Lesson 1" },
              actual: { status: "done", label: "Lesson 1" },
            },
          ],
        },
        {
          id: "session-2",
          sessionNumber: 2,
          date: "2026-03-09",
          progressStatus: "partial",
          textbookEntries: [
            {
              textbookId: "tb-main",
              plan: { label: "Lesson 2" },
              actual: { status: "partial", label: "Lesson 2" },
            },
            {
              textbookId: "tb-supplement",
              plan: { label: "Workbook 2" },
              actual: { status: "pending", label: "" },
            },
          ],
        },
      ],
    },
    {
      classItem: {
        id: "class-2",
        className: "B반",
        subject: "수학",
        teacher: "Lee Teacher",
      },
      warningSummary: {
        planDrift: { sessions: 1, variant: "behind", message: "계획보다 1회차 뒤처짐" },
        syncGap: null,
      },
      sessions: [
        {
          id: "session-3",
          sessionNumber: 1,
          date: "2026-03-03",
          progressStatus: "pending",
          textbookEntries: [
            {
              textbookId: "tb-math",
              plan: { label: "Unit 1" },
              actual: { status: "pending", label: "" },
            },
          ],
        },
      ],
    },
  ];
}

test("resolveWorkspaceSelection preserves the current class, session, and textbook when available", () => {
  const selection = resolveWorkspaceSelection(
    createRows(),
    "class-1",
    "session-2",
    "tb-supplement",
  );

  assert.equal(selection.classId, "class-1");
  assert.equal(selection.sessionId, "session-2");
  assert.equal(selection.textbookId, "tb-supplement");
  assert.equal(selection.entry?.plan?.label, "Workbook 2");
});

test("resolveWorkspaceSelection falls back to the first available target when the current one disappears", () => {
  const selection = resolveWorkspaceSelection(
    createRows(),
    "class-1",
    "missing-session",
    "missing-textbook",
  );

  assert.equal(selection.classId, "class-1");
  assert.equal(selection.sessionId, "session-1");
  assert.equal(selection.textbookId, "tb-main");
});

test("buildInspectorSessionNavigator returns adjacent sessions and aggregate counts", () => {
  const navigator = buildInspectorSessionNavigator(createRows()[0].sessions, "session-2");

  assert.equal(navigator.selectedIndex, 1);
  assert.equal(navigator.totalSessions, 2);
  assert.equal(navigator.completedCount, 1);
  assert.equal(navigator.partialCount, 1);
  assert.equal(navigator.pendingCount, 0);
  assert.equal(navigator.previousSession?.id, "session-1");
  assert.equal(navigator.nextSession, null);
});

test("workspace keeps the shared selection wired into timeline, inspector, and public preview", () => {
  const workspaceSource = fs.readFileSync(
    path.join(root, "src/components/class-schedule/ClassScheduleWorkspace.jsx"),
    "utf8",
  );
  const inspectorSource = fs.readFileSync(
    path.join(root, "src/components/class-schedule/ClassScheduleQuickProgressPopover.jsx"),
    "utf8",
  );

  assert.match(workspaceSource, /resolveWorkspaceSelection/);
  assert.match(workspaceSource, /ClassScheduleTimelineView/);
  assert.match(workspaceSource, /timelineZoom="day"|timelineZoom=\{minimalViewState\.timelineZoom\}/);
  assert.doesNotMatch(workspaceSource, /ClassScheduleCalendarView/);
  assert.doesNotMatch(workspaceSource, /ClassScheduleTableView/);
  assert.match(workspaceSource, /onSelectEntry\s*=/);
  assert.match(inspectorSource, /PublicClassVerticalTimeline/);
  assert.match(inspectorSource, /selectedSessionId=\{selectedSession\?\.id \|\| ""\}/);
});
