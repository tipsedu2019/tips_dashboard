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

test("lesson-design selected-session rail keeps editable progress-log save flow", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /import \{ Textarea \} from "@\/components\/ui\/textarea";/);
  assert.match(source, /buildLessonSessionProgressDraft/);
  assert.match(source, /buildLessonSessionProgressKey/);
  assert.match(source, /const \[lessonProgressDraft, setLessonProgressDraft\] = useState<ReturnType<typeof buildLessonSessionProgressDraft> \| null>\(null\)/);
  assert.match(source, /const \[isLessonProgressSaving, setIsLessonProgressSaving\] = useState\(false\)/);
  assert.match(source, /const \[lessonProgressSaveError, setLessonProgressSaveError\] = useState\(""\)/);
  assert.match(source, /const \[lessonProgressSaveNotice, setLessonProgressSaveNotice\] = useState\(""\)/);
  assert.match(source, /setLessonProgressDraft\(buildLessonSessionProgressDraft\(text\(selectedRow\?\.id\), selectedLessonSession\)\)/);
  assert.match(source, /const handleLessonProgressSharedFieldChange = useCallback\(/);
  assert.match(source, /const handleLessonProgressEntryChange = useCallback\(/);
  assert.match(source, /const handleSaveLessonProgress = useCallback\(async \(\) => \{/);
  assert.match(source, /from\("progress_logs"\)/);
  assert.match(source, /upsert\(payload, \{ onConflict: "progress_key" \}\)/);
  assert.match(source, /maybeSingle\(\)/);
  assert.match(source, /delete\(\)\.eq\("progress_key", progressKey\)/);
  assert.match(source, /실진도 기록/);
  assert.match(source, /실진도 저장 중/);
  assert.match(source, /실진도 저장/);
  assert.match(source, /공개 메모/);
  assert.match(source, /교사 메모/);
  assert.match(source, /수업 기록/);
  assert.match(source, /과제/);
  assert.match(source, /handleLessonProgressEntryChange\(entry\.textbookId, "status", value\)/);
  assert.match(source, /handleLessonProgressEntryChange\(entry\.textbookId, "rangeLabel", event\.target\.value\)/);
  assert.match(source, /handleLessonProgressSharedFieldChange\("content", event\.target\.value\)/);
  assert.match(source, /handleLessonProgressSharedFieldChange\("homework", event\.target\.value\)/);
});
