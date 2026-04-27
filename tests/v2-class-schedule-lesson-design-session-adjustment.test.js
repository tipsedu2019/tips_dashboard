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

test("lesson-design workspace keeps editable session adjustment controls under the selected session", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");
  const plannerSource = read("v2/src/lib/class-schedule-planner.js");

  assert.match(source, /applyCalendarDateSubstitution/);
  assert.match(source, /buildLessonSessionStateDraft/);
  assert.match(source, /applyLessonSessionStateChange/);
  assert.match(source, /resolveLessonSessionDraftDate/);
  assert.match(source, /const selectedLessonSessionDraftDate = resolveLessonSessionDraftDate\(selectedLessonSession\)/);
  assert.match(source, /const selectedLessonSessionEditableState = getLessonSessionDraftState\(/);
  assert.match(source, /const selectedLessonSessionEditableMemo = getLessonSessionEditableMemo\(/);
  assert.match(source, /const selectedLessonSessionEditableMakeupDate = getLessonSessionDraftMakeupDate\(/);
  assert.match(source, /function getLessonSessionEditableMemo\(/);
  assert.match(source, /function getLessonSessionDraftMakeupMemo\(/);
  assert.match(source, /makeupMemo: isMakeupSession \? nextMemo : getLessonSessionDraftMakeupMemo\(session, currentState\)/);
  assert.match(plannerSource, /makeupMemo/);
  assert.match(plannerSource, /memo: override\?\.makeupMemo \|\| ""/);
  assert.match(plannerSource, /makeupMemo: planInput\?\.sessionStates\?\.\[sourceDate\]\?\.makeupMemo \|\| ""/);
  assert.match(source, /const handleLessonSessionStateChange = useCallback\(/);
  assert.match(source, /const handleLessonSessionMemoChange = useCallback\(/);
  assert.match(source, /const handleLessonSessionMakeupDateDirectChange = useCallback\(/);
  assert.match(source, /const handleLessonSessionSubstitution = useCallback\(/);
  assert.match(source, /const handleLessonSessionClearSubstitution = useCallback\(/);
  assert.match(source, /rows=\{1\}/);
  assert.match(source, /className="h-9 min-h-9 resize-none overflow-hidden py-2"/);
  assert.doesNotMatch(source, /min-h-\[72px\]/);
  assert.doesNotMatch(source, /<p className="text-xs font-medium text-muted-foreground">선택 회차 수정<\/p>/);
  assert.match(source, /보강일/);
  assert.match(source, /보강 적용/);
  assert.match(source, /보강 해제/);
  assert.match(source, /휴강/);
  assert.match(source, /추가 수업/);
  assert.doesNotMatch(source, /variant=\{getScheduleStateTone\(selectedLessonSessionEditableState\)\}/);
  assert.match(source, /onClick=\{\(\) => handleLessonSessionStateChange\(selectedLessonSession, "exception"\)\}/);
  assert.match(source, /onClick=\{\(\) => handleLessonSessionStateChange\(selectedLessonSession, "makeup"\)\}/);
  assert.match(source, /originalDate \|\| session\.original_date \|\| session\.dateValue/);
  assert.match(source, /handleLessonSessionSubstitution\(\s*selectedLessonSession,\s*selectedLessonSessionEditableMakeupDate,/);
  assert.match(source, /onClick=\{\(\) => handleLessonSessionClearSubstitution\(selectedLessonSession\)\}/);
  assert.doesNotMatch(source, /selectedLessonSessionGroupScopeLabel/);
  assert.doesNotMatch(source, /variant=\{badge\.variant\}/);
  assert.match(source, /style=\{\{ backgroundColor: badge\.color \}\}/);
  assert.match(source, /items-center justify-center gap-1\.5 text-center/);
});
