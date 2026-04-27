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

test("class schedule workspace adds row selection and shared detail panel copy", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /const \[selectedClassId, setSelectedClassId\] = useState\(""\)/);
  assert.match(source, /const openLessonDesignPageForRow = useCallback\(/);
  assert.match(source, /aria-selected=\{selectedClassId === row.id\}/);
  assert.match(source, /onClick=\{\(\) => setSelectedClassId\(row.id\)\}/);
  assert.match(source, /row\.nextActionSessionId \|\| ""/);
  assert.match(source, /row\.nextActionSessionId\s*\? LESSON_DESIGN_SECTION_IDS\.session\s*:\s*LESSON_DESIGN_SECTION_IDS\.overview/);
  assert.match(source, /href=\{buildLessonDesignPageHref\(/);
  assert.match(source, /event\.stopPropagation\(\);/);
  assert.match(source, /className="inline-flex text-left font-medium underline-offset-4 hover:underline"/);
  assert.match(source, /setSelectedClassId\(group.members\[0\]\?\.classId \|\| ""\)/);
  assert.match(source, /선택한 반 진행 상세/);
  assert.match(source, /nextSessionId/);
  assert.match(source, /nextSessionTone/);
  assert.match(source, /pendingSessions: actionableSessions\.slice\(0, 4\)/);
  assert.match(source, /const nextActionSession = actionableSessions\[0\] \|\| null;/);
  assert.match(source, /const targetSectionId =/);
  assert.match(source, /router\.push\(buildLessonDesignPageHref\(row, resolvedSessionId, targetSectionId\), \{/);
  assert.match(source, /Button asChild type="button" size="sm"/);
  assert.match(source, /수업 설계/);
  assert.match(source, /onClick=\{\s*selectedSnapshot\.nextSessionId\s*\? \(\) => openLessonDesignPageForRow\(selectedRow, selectedSnapshot\.nextSessionId \|\| ""\)\s*:\s*undefined\s*\}/s);
  assert.match(source, /href=\{buildLessonDesignPageHref\(\s*selectedRow,\s*selectedSnapshot\.nextSessionId \|\| "",\s*selectedSnapshot\.nextSessionId\s*\? LESSON_DESIGN_SECTION_IDS\.session\s*:\s*LESSON_DESIGN_SECTION_IDS\.overview,\s*\)\}/s);
  assert.match(source, /selectedSnapshot\.pendingSessions\.map\(\(session\) => \(/);
  assert.match(source, /onClick=\{\(\) => openLessonDesignPageForRow\(selectedRow, session\.id\)\}/);
  assert.match(source, /바로 확인할 회차/);
  assert.match(source, /동기 그룹 상태/);
  assert.match(source, /계획 대비 경고/);
  assert.match(source, /연결 교재/);
  assert.match(source, /최근 기록 메모/);
  assert.match(source, /업데이트 대기 회차/);
  assert.match(source, /최근 회차 흐름/);
  assert.doesNotMatch(source, /같은 그룹의 실제 회차 정렬 상태를 요약합니다\./);
  assert.doesNotMatch(source, /선택 중인 반의 실제 기록과 진행 데이터를 행 중심으로 빠르게 점검합니다\./);
  assert.doesNotMatch(source, /현재 회차 링크/);
  assert.doesNotMatch(source, /<CardTitle>운영 상태<\/CardTitle>/);
});
