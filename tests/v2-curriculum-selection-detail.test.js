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

test("curriculum workspace keeps the lesson-design link but drops the right-side selection detail pane", () => {
  const source = read("v2/src/features/academic/curriculum-workspace.tsx");

  assert.match(source, /import Link from "next\/link"/);
  assert.match(source, /function buildLessonDesignHref\(classId: string\)/);
  assert.match(source, /params\.set\("classId", normalizedClassId\)/);
  assert.match(source, /params\.set\("lessonDesign", "1"\)/);
  assert.match(source, /href=\{buildLessonDesignHref\(row.id\)\}/);
  assert.match(source, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(source, /const \[selectedClassId, setSelectedClassId\] = useState\(""\)/);
  assert.doesNotMatch(source, /aria-selected=\{selectedClassId === row.id\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setSelectedClassId\(row.id\)\}/);
  assert.doesNotMatch(source, /선택한 반 상세/);
  assert.doesNotMatch(source, /다음으로 확인할 회차/);
  assert.doesNotMatch(source, /연결 교재/);
  assert.doesNotMatch(source, /운영 체크포인트/);
  assert.doesNotMatch(source, /최근 기록 메모/);
  assert.doesNotMatch(source, /const priorityRows = useMemo/);
  assert.doesNotMatch(source, /priorityRows\.length > 0/);
  assert.doesNotMatch(source, /업데이트 대기 회차 \{row\.delayedSessions\}회/);
  assert.doesNotMatch(source, /회차 편집 UI 분리 예정/);
  assert.doesNotMatch(source, /다음 이식 우선순위입니다\./);
});
