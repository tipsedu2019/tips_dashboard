import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("statistics has its own dashboard-authorized route and is discoverable outside assistant navigation", async () => {
  const [page, navigation] = await Promise.all([
    source("src/app/admin/statistics/page.tsx"),
    source("src/lib/navigation.ts"),
  ]);

  assert.match(page, /StatisticsWorkspace/);
  assert.match(navigation, /match: "\/admin\/statistics"/);
  assert.match(navigation, /title: "통계"[\s\S]*url: "\/admin\/statistics"/);
  const assistantItems = navigation.slice(
    navigation.indexOf("const assistantOverviewItems"),
    navigation.indexOf("const fullOverviewItems"),
  );
  assert.doesNotMatch(assistantItems, /\/admin\/statistics/);
});

test("statistics workspace mounts exactly the selected aggregate tab and leaves the dashboard home independent", async () => {
  const [workspace, dashboard] = await Promise.all([
    source("src/features/dashboard/statistics-workspace.tsx"),
    source("src/app/admin/dashboard/page.tsx"),
  ]);

  assert.match(workspace, /const STATISTICS_TABS/);
  assert.match(workspace, /activeTab === "overview"/);
  assert.match(workspace, /activeTab === "students_classes"/);
  assert.match(workspace, /activeTab === "schedule_conflicts"/);
  assert.match(workspace, /activeTab === "textbooks"/);
  assert.match(workspace, /useStatisticsSnapshot/);
  assert.match(workspace, /마지막 갱신/);
  assert.match(workspace, /새로고침/);
  assert.doesNotMatch(dashboard, /StatisticsWorkspace|useStatisticsSnapshot|SectionCards/);
});

test("only the schedule-conflict panel mounts conflict actions and the textbook panel keeps its bounded presets", async () => {
  const workspace = await source("src/features/dashboard/statistics-workspace.tsx");
  const conflicts = workspace.slice(
    workspace.indexOf("function ScheduleConflictsPanel"),
    workspace.indexOf("function TextbookStatisticsPanel"),
  );
  const textbooks = workspace.slice(workspace.indexOf("function TextbookStatisticsPanel"));

  assert.match(conflicts, /ConflictWarning/);
  assert.match(conflicts, /DASHBOARD_STATISTICS_RANGE_PRESETS\.schedule_conflicts/);
  assert.doesNotMatch(textbooks, /ConflictWarning/);
  assert.match(textbooks, /DASHBOARD_STATISTICS_RANGE_PRESETS\.textbooks/);
  assert.match(textbooks, /activeTitles/);
  assert.match(textbooks, /activeClassesWithTextbook/);
  assert.match(textbooks, /activeClassesWithoutTextbook/);
  assert.match(textbooks, /updatedProgressSessions/);
});

test("statistics keeps the legacy class-average KPI and full conflict task workflow", async () => {
  const [workspace, sectionCards] = await Promise.all([
    source("src/features/dashboard/statistics-workspace.tsx"),
    source("src/app/admin/dashboard/components/section-cards.tsx"),
  ]);
  const summary = workspace.slice(workspace.indexOf("function SummaryCards"), workspace.indexOf("function OverviewPanel"));
  const conflicts = workspace.slice(
    workspace.indexOf("function ScheduleConflictsPanel"),
    workspace.indexOf("function TextbookStatisticsPanel"),
  );

  assert.match(summary, /"수업당"/);
  assert.match(summary, /registeredEnrollmentCount/);
  assert.match(summary, /activeClassesCount/);
  assert.match(conflicts, /DashboardConflictWarning/);
  assert.match(sectionCards, /export function ConflictWarning/);
  assert.match(sectionCards, /createDashboardConflictTask/);
  assert.match(sectionCards, /listDashboardConflictTaskLinks/);
});
