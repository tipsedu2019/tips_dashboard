import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("shared lesson design workspace content does not depend on dialog title primitives", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const workspaceContentMatch = source.match(
    /const lessonDesignWorkspaceContent = \(([\s\S]*?)\r?\n\r?\n  const classScheduleWorkspaceContent = \(/,
  );

  assert.ok(workspaceContentMatch, "lesson design workspace content block should exist");
  assert.doesNotMatch(workspaceContentMatch[1], /DialogHeader/);
  assert.doesNotMatch(workspaceContentMatch[1], /DialogTitle/);
  assert.doesNotMatch(workspaceContentMatch[1], /DialogDescription/);
});

test("lesson design page keeps schedule controls direct and non-duplicative", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const plannerSource = await readSource("src/lib/class-schedule-planner.js");

  assert.doesNotMatch(source, /월 기준 회차/);
  assert.doesNotMatch(source, /handleLessonGlobalSessionCountChange/);
  assert.match(plannerSource, /const globalSessionCount = getRecommendedSessionCount\(selectedDays\);/);
  assert.match(source, /selectedDays\.length > 0 \? selectedDays\.length \* 4 : 0/);
  assert.match(source, /lessonCalendarMonths\.map\(\(month\) =>/);
  assert.match(source, /월 선택/);
  assert.match(
    source,
    /2xl:grid-cols-\[minmax\(18rem,0\.85fr\)_minmax\(30rem,1\.35fr\)_minmax\(22rem,1fr\)\]/,
  );
  assert.doesNotMatch(source, /aria-label="수업 일정 현황"/);
  assert.doesNotMatch(source, /생성 \{month\.activeCount\}회 · 대기 \{month\.pendingCount\}회/);
  assert.doesNotMatch(source, /<Badge variant="outline">\{month\.label\}<\/Badge>/);
  assert.doesNotMatch(source, /rounded-3xl border bg-background shadow-sm/);
  assert.doesNotMatch(source, /lessonStatusCounts/);
  assert.doesNotMatch(source, /setSelectedLessonStatus/);
  assert.doesNotMatch(source, /lessonScheduleStateCounts/);
  assert.doesNotMatch(source, /calendar-jump-/);
  assert.doesNotMatch(source, /setSelectedLessonScheduleState\(value\)/);
});

test("lesson design session timeline connects through centered markers", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /"absolute left-2\.5 w-px bg-border"/);
  assert.match(source, /isFirstFlowItem \? "top-1\/2" : "-top-3"/);
  assert.match(source, /isLastFlowItem \? "bottom-1\/2" : "-bottom-3"/);
  assert.match(source, /"absolute left-0 top-1\/2 z-10 flex size-5 -translate-y-1\/2/);
  assert.doesNotMatch(source, /absolute left-5 top-10 bottom-10 w-px bg-border/);
  assert.doesNotMatch(source, /absolute -left-7 top-5/);
});
