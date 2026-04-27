import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const managementPageFile = path.join(root, "v2", "src", "features", "management", "management-page.tsx");
const schoolMasterPageFile = path.join(root, "v2", "src", "app", "admin", "settings", "schools", "page.tsx");
const legacySchoolMasterPageFile = path.join(root, "v2", "src", "app", "admin", "schools", "page.tsx");
const schoolMasterWorkspaceFile = path.join(root, "v2", "src", "features", "management", "school-master-workspace.tsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("student management wires the school-master action into a dedicated admin route", () => {
  const source = read(managementPageFile);

  assert.match(source, /useRouter/);
  assert.match(source, /router\.push\("\/admin\/settings\/schools"\)/);
  assert.match(source, /onOpenSchoolMaster:\s*\(\)\s*=>\s*router\.push\("\/admin\/settings\/schools"\)/);
});

test("school settings route stays minimal and renders the dedicated workspace", () => {
  const source = read(schoolMasterPageFile);

  assert.match(source, /SchoolMasterWorkspace/);
  assert.match(source, /return\s+<SchoolMasterWorkspace\s*\/?>/);
});

test("legacy school route redirects into settings", () => {
  const source = read(legacySchoolMasterPageFile);

  assert.match(source, /redirect\("\/admin\/settings\/schools"\)/);
});

test("school master workspace supports practical CRUD through the shared management service", () => {
  const source = read(schoolMasterWorkspaceFile);

  for (const marker of [
    'managementService.upsertAcademicSchools',
    'managementService.deleteAcademicSchools',
    '학교 마스터',
    '학교 추가',
    '변경 저장',
    '삭제',
    'handleSaveAll',
    'handleNameSort',
    'name="school-name"',
    'const CATEGORY_FILTERS = ["전체", "초등", "중등", "고등"] as const;',
    'const SCHOOL_CATEGORY_LABELS',
    'const SCHOOL_CATEGORY_VALUES',
    'normalizeSchoolCategory',
    'toSchoolCategoryValue',
    'elementary: "초등"',
    'middle: "중등"',
    'high: "고등"',
    '초등: "elementary"',
    '중등: "middle"',
    '고등: "high"',
    'category: toSchoolCategoryValue(row.category)',
    'SelectTrigger',
    'SelectContent',
    'SelectItem',
    'value={normalizeSchoolCategory(row.category)}',
    'categoryFilter',
    'CATEGORY_FILTERS.map((filter) =>',
    'variant={categoryFilter === filter ? "default" : "outline"}',
    'setCategoryFilter(filter)',
    'categoryFilter === "전체"',
    'row.category.trim() === categoryFilter',
    'ArrowUp',
    'ArrowDown',
    'handleMoveRow',
    'aria-label="학교 순서 위로 이동"',
    'aria-label="학교 순서 아래로 이동"',
    'useSettingsTableColumns',
    'SCHOOL_TABLE_COLUMNS',
    'columnSettingsControl',
    'visibleColumnCount',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  assert.match(source, /supabase\s*\.from\("academic_schools"\)/);

  for (const stale of [
    '운영 브리핑',
    '요약 카드',
    '도움말',
    '관리자 전용 동선',
    'name="school-sort-order"',
    '{ id: "color", label: "색상" }',
    '{ id: "sortOrder", label: "정렬" }',
    'aria-label="학교 목록 새로고침"',
  ]) {
    assert.equal(source.includes(stale), false, `unexpected ${stale}`);
  }
});
