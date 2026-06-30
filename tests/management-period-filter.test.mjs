import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("class period filter is built from configured periods only", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const groupSource = await readFile(new URL("src/features/management/class-group-master-workspace.tsx", root), "utf8");

  assert.match(source, /function getAvailableClassGroupOptions/);
  assert.match(source, /raw\.availableClassGroups/);
  assert.doesNotMatch(source, /rows\.flatMap\(getClassGroupValues\)/);
  assert.match(groupSource, /data-testid="class-group-settings-mobile-list"/);
  assert.match(groupSource, /data-testid=\{`class-group-settings-mobile-card-\$\{row\.id\}`\}/);
  assert.match(groupSource, /<div className="hidden md:block">[\s\S]*<SettingsTableFrame>/);
});

test("explicit class group membership wins over legacy year term labels", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /if \(assignedGroups\.length > 0\) \{\s*return \[\.\.\.new Set\(assignedGroups\)\];\s*\}/);
  assert.doesNotMatch(
    source,
    /return \[\.\.\.new Set\(\[\.\.\.assignedGroups,\s*getLegacyClassPeriodLabel\(row\)\]\.filter\(Boolean\)\)\]/,
  );
});

test("class detail preselects matching legacy period only when no group is assigned", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /const assignedGroupIds = normalizeClassGroupOptions/);
  assert.match(source, /if \(assignedGroupIds\.length > 0\) \{\s*return \[\.\.\.new Set\(assignedGroupIds\)\];\s*\}/);
  assert.match(source, /const legacyLabel = \[getClassAcademicYearOption\(raw\), getClassTermOption\(raw\)\]/);
  assert.match(source, /\.filter\(\(group\) => group\.id === legacyLabel \|\| group\.name === legacyLabel\)/);
});

test("class detail period menu does not render checkbox buttons inside option buttons", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.doesNotMatch(source, /<Checkbox\b/);
  assert.match(source, /<Check className="size-3" \/>/);
});

test("class creation preselects the default period so new classes stay visible", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /import \{ pickDefaultPeriodValue \} from "\.\/period-preferences";/);
  assert.match(source, /function getDefaultClassGroupIdsForCreate\(classGroupOptions: ClassGroupOption\[\]\)/);
  assert.match(source, /const defaultGroupId = pickDefaultPeriodValue/);
  assert.match(source, /const defaultClassGroupIdsForCreate = useMemo/);
  assert.match(source, /if \(kind === "classes" && defaultClassGroupIdsForCreate\) \{\s*nextForm\.classGroupIds = defaultClassGroupIdsForCreate;\s*\}/);
});

test("default period preference uses the server-configured period before stored fallback", async () => {
  const preferenceSource = await readFile(new URL("src/features/management/period-preferences.ts", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");
  const recordsSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");

  assert.match(preferenceSource, /isDefault\?: boolean/);
  assert.match(preferenceSource, /const configuredDefault = options\.find\(\(option\) => option\.isDefault === true\)/);
  assert.match(preferenceSource, /if \(configuredDefault\) \{\s*return configuredDefault\.value;\s*\}/);
  assert.match(tableSource, /isDefault: record\.is_default === true \|\| record\.isDefault === true/);
  assert.match(recordsSource, /readOptionalTable\("class_schedule_sync_groups"\)/);
});
