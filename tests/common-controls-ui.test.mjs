import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("shared checkbox keeps a comfortable click target", async () => {
  const source = await readFile(new URL("src/components/ui/checkbox.tsx", root), "utf8");

  assert.match(source, /size-5 shrink-0 rounded-\[5px\]/);
  assert.match(source, /<CheckIcon className="size-4" \/>/);
});

test("settings row text inputs announce the edited row", async () => {
  const [teacherSource, schoolSource, classroomSource] = await Promise.all([
    readFile(new URL("src/features/management/teacher-master-workspace.tsx", root), "utf8"),
    readFile(new URL("src/features/management/school-master-workspace.tsx", root), "utf8"),
    readFile(new URL("src/features/management/classroom-master-workspace.tsx", root), "utf8"),
  ]);

  assert.match(teacherSource, /aria-label=\{`\$\{row\.name \|\| "새 선생님"\} 이름`\}/);
  assert.match(schoolSource, /aria-label=\{`\$\{row\.name \|\| "새 학교"\} 학교명`\}/);
  assert.match(classroomSource, /aria-label=\{`\$\{row\.name \|\| "새 강의실"\} 강의실 이름`\}/);
});

test("select menus can show long option lists inside modals", async () => {
  const source = await readFile(new URL("src/components/ui/select.tsx", root), "utf8");

  assert.match(source, /max-h-\(--radix-select-content-available-height\)/);
  assert.match(source, /min-w-\[var\(--radix-select-trigger-width\)\]/);
  assert.doesNotMatch(source, /h-\[var\(--radix-select-trigger-height\)\]/);
});
