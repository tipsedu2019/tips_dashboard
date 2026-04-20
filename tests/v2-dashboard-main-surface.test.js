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

test("admin dashboard page replaces template analytics widgets with operator-facing briefing and workspace links", () => {
  const pageSource = read("v2/src/app/admin/dashboard/page.tsx");

  assert.match(pageSource, /오늘의 운영 브리핑/);
  assert.match(pageSource, /오늘의 운영 포인트/);
  assert.match(pageSource, /운영 상태 요약/);
  assert.match(pageSource, /현재 운영 스냅샷/);
  assert.match(pageSource, /운영 워크스페이스 바로가기/);
  assert.match(pageSource, /관리자 전용 동선/);
  assert.match(pageSource, /수업일정 워크스페이스/);
  assert.match(pageSource, /커리큘럼 워크스페이스/);
  assert.match(pageSource, /학생 관리/);
  assert.match(pageSource, /교재 관리/);
  assert.match(pageSource, /href: "\/admin\/class-schedule"/);
  assert.match(pageSource, /href: "\/admin\/curriculum"/);
  assert.match(pageSource, /href: "\/admin\/academic-calendar"/);
  assert.match(pageSource, /href: "\/admin\/students"/);
  assert.match(pageSource, /href: "\/admin\/textbooks"/);

  assert.equal(pageSource.includes("ChartAreaInteractive"), false);
  assert.equal(pageSource.includes("DataTable"), false);
  assert.equal(pageSource.includes("./data/data.json"), false);
  assert.equal(pageSource.includes("Total Visitors"), false);
  assert.equal(pageSource.includes("past-performance-data.json"), false);
  assert.equal(pageSource.includes("대시보드 사용 순서"), false);
});
