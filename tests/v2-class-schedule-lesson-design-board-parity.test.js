import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("lesson-design workspace shows session flow as a stepper-style 회차 목록 without the old board chrome", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /lessonSessionGroups\.map\(\(group\) => \(/);
  assert.match(source, /lessonFlowStateMap\.get\(session\.id\) \|\| "pending"/);
  assert.match(source, /focusLessonDesignSession\(session\.id, \{/);
  assert.match(source, /sectionId: LESSON_DESIGN_SECTION_IDS\.periods/);
  assert.match(source, /selectedLessonSessionGroupScopeLabel/);
  assert.match(source, /const lessonPreviewBadges = useMemo\(/);
  assert.match(source, /buildLessonPreviewBadges\(lessonSessionGroups\)/);
  assert.match(source, /lessonPreviewBadges\.map\(\(badge\) => \(/);
  assert.match(source, /회차 목록/);
  assert.match(source, /absolute left-5 top-10 bottom-10 w-px bg-border/);
  assert.match(source, /rounded-full border-4 border-background/);
  assert.match(source, /const sessionMemoLine = \[text\(session\.memo\), session\.noteSummary !== "기록 메모 없음" \? session\.noteSummary : ""\]/);
  assert.match(source, /const sessionDetailLine = \[sessionMemoLine, session\.scheduleConnectionLabel\]/);
  assert.match(source, /<Badge variant=\{getScheduleStateTone\(session\.scheduleState\)\}>/);
  assert.match(source, /기록 메모/);
  assert.match(source, /현재 필터에 맞는 회차 목록이 없습니다\./);
  assert.match(source, /월 선택으로 돌아가기/);
  assert.match(source, /모든 월 보기/);
  assert.match(source, /scheduleConnectionLabel/);
  assert.doesNotMatch(source, /getLessonFlowStateLabel/);
  assert.doesNotMatch(source, /getLessonFlowStateTone/);
  assert.doesNotMatch(source, /완료 흐름/);
  assert.doesNotMatch(source, /현재 기준/);
  assert.doesNotMatch(source, /예정 회차/);
  assert.doesNotMatch(source, /sessionIndex \+ 1\}단계/);
  assert.doesNotMatch(source, /session\.monthLabel \|\| "날짜 미정"/);
  assert.doesNotMatch(source, /대기 \{group\.pendingCount\}회/);
  assert.doesNotMatch(source, /lessonScheduleStateCounts/);
  assert.doesNotMatch(source, /selectedLessonScheduleStateLabel/);
  assert.doesNotMatch(source, /setSelectedLessonScheduleState\(value\)/);
  assert.doesNotMatch(source, /calendar-jump-/);
  assert.doesNotMatch(source, /정규 수업 \$\{count\}건/);
  assert.doesNotMatch(source, /수업 일정 보드/);
  assert.doesNotMatch(source, /이전 회차/);
  assert.doesNotMatch(source, /다음 회차/);
  assert.doesNotMatch(source, /교재 범위 보드/);
  assert.doesNotMatch(source, /현재 필터 기준 회차가 없습니다\./);
});
