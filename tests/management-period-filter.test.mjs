import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("class period filter is built from configured periods only", async () => {
  const source = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(source, /function getAvailableClassGroupOptions/);
  assert.match(source, /raw\.availableClassGroups/);
  assert.doesNotMatch(source, /rows\.flatMap\(getClassGroupValues\)/);
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
