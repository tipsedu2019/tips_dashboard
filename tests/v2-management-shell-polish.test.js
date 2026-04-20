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
    "이전",
    "다음",
    "현재 조건에 맞는",
    "표시 {filteredRowCount}건",
    "선택 {selectedRowCount}건",
    "컬럼 {visibleColumns}개",
    "그룹 {grouping.length}단",
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
    "검색 · 필터 · 컬럼 구성",
    "학생 관리",
    "수업 관리",
    "교재 관리",
    "운영 목록 준비 상태",
    "검색과 필터 조건만 적용된 상태입니다.",
    "컬럼 보기/숨기기, 순서, 정렬, 그룹화를 조정하면 브라우저에 자동 저장됩니다.",
    "최대 2단까지 묶어 볼 수 있습니다.",
    "최대 2단까지 저장합니다.",
    "표시 여부와 순서를 저장합니다.",
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
