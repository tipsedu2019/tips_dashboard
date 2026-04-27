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

test("lesson-design workspace keeps per-session textbook plan editing under the selected session", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /planStart: text\(plan\.start\)/);
  assert.match(source, /planEnd: text\(plan\.end\)/);
  assert.match(source, /const handleLessonTextbookPlanChange = useCallback\(/);
  assert.match(source, /field: "start" \| "end" \| "label" \| "memo"/);
  assert.match(source, /if \(!sessionId \|\| !entryId\) \{/);
  assert.match(source, /sessions: sessions\.map\(\(session\) => \{/);
  assert.match(source, /const periodSummariesWithSessionCounts = periodSummaries\.map\(\(period\) => \{/);
  assert.match(source, /isDateWithinRange\(session\.dateValue, period\.startDate, period\.endDate\)/);
  assert.match(source, /textbookEntries: textbookEntries\.map\(\(entry, index\) => \{/);
  assert.match(source, /const resolvedEntryId = text\(entry\.id\) \|\| /);
  assert.match(source, /plan: \{/);
  assert.match(source, /\[field\]: value/);
  assert.match(source, /const isSelectedSession = selectedLessonSession\?\.id === session\.id/);
  assert.match(source, /isSelectedSession && selectedLessonSession \? \(/);
  assert.match(source, /\{selectedLessonSession\.textbookEntries\.length > 0 \? \(/);
  assert.match(source, /계획 범위 편집/);
  assert.match(source, /시작 범위/);
  assert.match(source, /종료 범위/);
  assert.match(source, /표시 문구/);
  assert.match(source, /계획 메모/);
  assert.match(source, /plan-editor-\$\{selectedLessonSession\.id\}-\$\{entry\.id\}/);
  assert.match(source, /handleLessonTextbookPlanChange\(\s*selectedLessonSession\.id,\s*entry\.id,\s*"start",\s*event\.target\.value,/);
  assert.match(source, /handleLessonTextbookPlanChange\(\s*selectedLessonSession\.id,\s*entry\.id,\s*"end",\s*event\.target\.value,/);
  assert.match(source, /entry\.planLabel === "계획 범위 미지정" \? "" : entry\.planLabel/);
  assert.match(source, /handleLessonTextbookPlanChange\(\s*selectedLessonSession\.id,\s*entry\.id,\s*"label",\s*event\.target\.value,/);
  assert.match(source, /handleLessonTextbookPlanChange\(\s*selectedLessonSession\.id,\s*entry\.id,\s*"memo",\s*event\.target\.value,/);
  assert.doesNotMatch(source, /편집할 계획 범위가 없습니다\./);
});
