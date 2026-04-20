import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const managementPageFile = path.join(
  root,
  "v2",
  "src",
  "features",
  "management",
  "management-page.tsx",
);
const managementTableFile = path.join(
  root,
  "v2",
  "src",
  "features",
  "management",
  "management-data-table.tsx",
);

test("management page passes live stats into the shared data table", () => {
  const source = fs.readFileSync(managementPageFile, "utf8");

  assert.match(source, /const\s+\{\s*rows,\s*stats,\s*loading,\s*error,\s*refresh\s*\}\s*=\s*useManagementRecords\(kind\)/);
  assert.match(source, /stats=\{stats\}/);
});

test("management data table keeps the workspace minimal and removes broad summary theater from work pages", () => {
  const source = fs.readFileSync(managementTableFile, "utf8");

  for (const marker of [
    "검색",
    "새로고침",
    "컬럼 구성",
    "페이지 이동",
    "이전",
    "다음",
    "운영 목록 준비 상태",
    "현재 조건에 맞는",
    'aria-label="현재 페이지 전체 선택"',
    'aria-label={`${emptyLabel} 항목 선택`}',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const marker of [
    "운영 워크스페이스",
    "라이브 운영 요약",
    "현재 선택",
    "내보내기 준비",
    "연동 상태와 현재 필터 결과를 요약한 화면입니다.",
    "JSON 저장 가능",
    "선택됨",
    "JSON 내보내기",
    ">Export<",
    ">Columns <",
    ">Page<",
    ">Previous<",
    ">Next<",
    'aria-label="Select all"',
    'aria-label="Select row"',
  ]) {
    assert.equal(source.includes(marker), false, `unexpected stale label ${marker}`);
  }

  assert.match(source, /<caption className="sr-only">/);
});
