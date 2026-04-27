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

test("dashboard metric panels keep production analytics compact and switchable", () => {
  const sectionCardsSource = read("v2/src/app/admin/dashboard/components/section-cards.tsx");
  const metricsHookSource = read("v2/src/hooks/use-tips-dashboard-metrics.ts");

  assert.match(sectionCardsSource, /badgeLabel: "연결 확인 중"/);
  assert.match(sectionCardsSource, /badgeLabel: "점검 필요"/);
  assert.match(sectionCardsSource, /badgeLabel: "실시간 연결"/);
  assert.match(sectionCardsSource, /type LoadSortBasis = "minutes" \| "enrollment"/);
  assert.match(sectionCardsSource, /LOAD_SORT_OPTIONS/);
  assert.match(sectionCardsSource, /주간 수업시수/);
  assert.match(sectionCardsSource, /수강생수/);
  assert.match(sectionCardsSource, /function GradeBreakdownPanel\(\{ rows, subjectRows \}/);
  assert.match(sectionCardsSource, /전체 학년/);
  assert.match(sectionCardsSource, /<GradeBreakdownPanel rows=\{gradeRows\} subjectRows=\{subjectRows\} \/>/);
  assert.match(sectionCardsSource, /aria-pressed=\{isActive\}/);
  assert.match(sectionCardsSource, /getLoadValue\(right, sortBasis\)/);
  assert.match(sectionCardsSource, /운영 지표를 불러오는 중입니다\./);
  assert.match(sectionCardsSource, /현재 운영 데이터 기준으로 집계했습니다\./);
  assert.match(sectionCardsSource, /운영 데이터 연결 상태에 문제가 감지되었습니다\./);

  assert.equal(sectionCardsSource.includes("과목별 학생수"), false);
  assert.equal(sectionCardsSource.includes("function BreakdownTable"), false);
  assert.equal(sectionCardsSource.includes("LegacyLoadTable"), false);
  assert.equal(sectionCardsSource.includes("TrendingUp"), false);
  assert.equal(sectionCardsSource.includes("TrendingDown"), false);
  assert.equal(sectionCardsSource.includes("trend:"), false);
  assert.equal(sectionCardsSource.includes("Live"), false);
  assert.equal(sectionCardsSource.includes("Sync"), false);
  assert.equal(sectionCardsSource.includes("Ready"), false);
  assert.equal(sectionCardsSource.includes("In progress"), false);
  assert.equal(sectionCardsSource.includes("v1 Supabase snapshot 기반"), false);
  assert.equal(sectionCardsSource.includes("parity 기준 지표"), false);
  assert.equal(sectionCardsSource.includes("순차 전환 예정"), false);

  assert.match(metricsHookSource, /Supabase 연결 설정을 확인해 주세요\./);
  assert.match(metricsHookSource, /알 수 없는 연결 오류가 발생했습니다\./);
  assert.equal(metricsHookSource.includes("Supabase is not configured."), false);
  assert.equal(metricsHookSource.includes("Unknown error"), false);
});
