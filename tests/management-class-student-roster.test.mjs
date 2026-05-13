import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("class student rosters never use raw UUIDs as display names", async () => {
  const hookSource = await readFile(new URL("src/features/management/use-management-records.ts", root), "utf8");
  const pageSource = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const tableSource = await readFile(new URL("src/features/management/management-data-table.tsx", root), "utf8");

  assert.match(hookSource, /const studentName = textValue\(student\?\.name\)/);
  assert.match(hookSource, /name: studentName \|\| "학생 정보 확인 필요"/);
  assert.doesNotMatch(hookSource, /name: textValue\(student\?\.name\) \|\| id/);

  assert.match(pageSource, /function isUuidLike/);
  assert.match(pageSource, /function getMissingRelatedTitle/);
  assert.match(pageSource, /kind === "classes"\) return "학생 정보 확인 필요"/);
  assert.match(pageSource, /return isUuidLike\(id\) \? fallbackTitle : id/);
  assert.doesNotMatch(pageSource, /return id \? \{ id, name: id \} : null/);

  assert.match(tableSource, /function isUuidLike/);
  assert.match(tableSource, /const rawName = student\.name \|\| ""/);
  assert.match(tableSource, /: "학생 정보 확인 필요"/);
  assert.doesNotMatch(tableSource, /const name = student\.name \|\| student\.id \|\| "학생"/);
});
