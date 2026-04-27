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

test("academic calendar readonly and seed states use neutral operational copy", () => {
  const source = read("v2/src/features/operations/academic-calendar-workspace.tsx");

  assert.match(source, /현재는 TIPS 기본 일정 세트가 표시되고 있습니다/);
  assert.match(source, /학사일정 조회 전용 상태입니다/);
  assert.equal(source.includes("기본 일정 세트 표시 중"), false);
  assert.equal(source.includes("학사일정 조회 상태"), false);
  assert.equal(source.includes("수정 기능 비활성화"), false);
});
