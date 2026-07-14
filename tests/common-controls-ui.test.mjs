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
  assert.match(classroomSource, /data-testid="classroom-settings-mobile-list"/);
  assert.match(classroomSource, /data-testid=\{`classroom-settings-mobile-card-\$\{row\.id\}`\}/);
  assert.match(classroomSource, /<div className="hidden md:block">[\s\S]*<SettingsTableFrame>/);
});

test("select menus can show long option lists inside modals", async () => {
  const source = await readFile(new URL("src/components/ui/select.tsx", root), "utf8");

  assert.match(source, /max-h-\(--radix-select-content-available-height\)/);
  assert.match(source, /min-w-\[var\(--radix-select-trigger-width\)\]/);
  assert.doesNotMatch(source, /h-\[var\(--radix-select-trigger-height\)\]/);
});

test("ported option panels stay above high-layer management dialogs", async () => {
  const [selectSource, popoverSource, managementSource] = await Promise.all([
    readFile(new URL("src/components/ui/select.tsx", root), "utf8"),
    readFile(new URL("src/components/ui/popover.tsx", root), "utf8"),
    readFile(new URL("src/features/management/management-page.tsx", root), "utf8"),
  ]);

  assert.match(managementSource, /<DialogContent[\s\S]*?className="z-\[80\]/);
  assert.match(selectSource, /data-slot="select-content"[\s\S]*relative z-\[90\]/);
  assert.match(popoverSource, /data-slot="popover-content"[\s\S]*z-\[90\]/);
  assert.doesNotMatch(selectSource, /data-slot="select-content"[\s\S]*relative z-50/);
  assert.doesNotMatch(popoverSource, /data-slot="popover-content"[\s\S]*z-50/);
});

test("shared dialog can expose explicit top close copy for unsaved forms", async () => {
  const source = await readFile(new URL("src/components/ui/dialog.tsx", root), "utf8");

  assert.match(source, /closeButtonLabel = "모달 닫기"/);
  assert.match(source, /onCloseButtonClick\?: React\.MouseEventHandler<HTMLButtonElement>/);
  assert.match(source, /showCloseButtonText\?: boolean/);
  assert.match(source, /showCloseButtonText \? "whitespace-nowrap" : "sr-only"/);
  assert.match(source, /aria-label=\{closeButtonLabel\}/);
  assert.match(source, /onClick=\{onCloseButtonClick\}/);
});
