import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildSyncGroupCards } from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

const root = path.resolve("C:/Antigravity/tips_dashboard");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("toolbar reuses the curriculum command bar and removes custom view or zoom chrome", () => {
  const source = read("src/components/class-schedule/ClassScheduleToolbar.jsx");

  assert.match(source, /ManagementCommandBar/);
  assert.match(source, /CheckboxMenu/);
  assert.match(source, /SegmentedControl/);
  assert.doesNotMatch(source, /CLASS_SCHEDULE_VIEW_ITEMS/);
  assert.doesNotMatch(source, /CLASS_SCHEDULE_ZOOM_ITEMS/);
});

test("workspace is timeline-only and keeps the public preview inside the inspector", () => {
  const workspaceSource = read("src/components/class-schedule/ClassScheduleWorkspace.jsx");
  const inspectorSource = read("src/components/class-schedule/ClassScheduleQuickProgressPopover.jsx");

  assert.doesNotMatch(workspaceSource, /DashboardSummaryStrip/);
  assert.doesNotMatch(workspaceSource, /summaryItems=\{summaryItems\}/);
  assert.doesNotMatch(workspaceSource, /ClassScheduleCalendarView/);
  assert.doesNotMatch(workspaceSource, /ClassScheduleTableView/);
  assert.doesNotMatch(workspaceSource, /현재 필터 결과를 기준으로 계획·실제·경고가 함께 계산됩니다/);
  assert.doesNotMatch(workspaceSource, /<PublicClassVerticalTimeline/);
  assert.match(inspectorSource, /PublicClassVerticalTimeline/);
  assert.match(inspectorSource, /class-schedule-inspector__section-heading/);
});

test("sync group panel is class-based instead of inline-style driven", () => {
  const source = read("src/components/class-schedule/ClassScheduleSyncGroupPanel.jsx");

  assert.doesNotMatch(source, /style=\{\{/);
  assert.match(source, /class-schedule-sync-panel/);
  assert.match(source, /class-schedule-sync-panel__empty/);
});

test("buildSyncGroupCards only keeps groups that are visible in the current filtered workspace", () => {
  const groups = [
    { id: "group-english", name: "English Sync", subject: "영어", color: "#3182f6" },
    { id: "group-math", name: "Math Sync", subject: "수학", color: "#16a34a" },
  ];
  const members = [
    { groupId: "group-english", classId: "class-english", sortOrder: 0 },
    { groupId: "group-math", classId: "class-math", sortOrder: 0 },
  ];
  const rows = [
    {
      classItem: { id: "class-english", className: "Middle English A" },
      warningSummary: {
        syncGap: { message: "Middle English A이 Middle English B보다 1회차 뒤처짐" },
      },
    },
  ];
  const classes = [
    { id: "class-english", className: "Middle English A" },
    { id: "class-math", className: "Middle Math B" },
  ];

  const result = buildSyncGroupCards(groups, members, rows, classes);

  assert.deepEqual(result.map((item) => item.id), ["group-english"]);
  assert.equal(result[0].memberCount, 1);
  assert.equal(result[0].warningText, "Middle English A이 Middle English B보다 1회차 뒤처짐");
});
