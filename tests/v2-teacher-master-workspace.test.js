import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const managementPageFile = path.join(root, "v2", "src", "features", "management", "management-page.tsx");
const teacherMasterPageFile = path.join(root, "v2", "src", "app", "admin", "settings", "teachers", "page.tsx");
const legacyTeacherMasterPageFile = path.join(root, "v2", "src", "app", "admin", "teachers", "page.tsx");
const teacherMasterWorkspaceFile = path.join(root, "v2", "src", "features", "management", "teacher-master-workspace.tsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("class management wires the teacher-master action into a dedicated admin route", () => {
  const source = read(managementPageFile);

  assert.match(source, /useRouter/);
  assert.match(source, /router\.push\("\/admin\/settings\/teachers"\)/);
  assert.match(source, /onOpenTeacherMaster:\s*\(\)\s*=>\s*router\.push\("\/admin\/settings\/teachers"\)/);
});

test("teacher settings route stays minimal and renders the dedicated workspace", () => {
  const source = read(teacherMasterPageFile);

  assert.match(source, /TeacherMasterWorkspace/);
  assert.match(source, /return\s+<TeacherMasterWorkspace\s*\/?>/);
});

test("legacy teacher route redirects into settings", () => {
  const source = read(legacyTeacherMasterPageFile);

  assert.match(source, /redirect\("\/admin\/settings\/teachers"\)/);
});

test("teacher master workspace supports practical CRUD through the shared management service", () => {
  const source = read(teacherMasterWorkspaceFile);

  for (const marker of [
    "managementService.upsertTeacherCatalogs",
    "managementService.deleteTeacherCatalogs",
    "선생님 마스터",
    "선생님 추가",
    "저장",
    "삭제",
    "const parsedSortOrder = Number.parseInt(row.sortOrder, 10);",
    "sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : nextSortOrder",
    'name="teacher-name"',
    'aria-label="선생님 표시 여부"',
    'const SUBJECT_OPTIONS = ["영어", "수학"] as const;',
    'SelectTrigger',
    'SelectContent',
    'SelectItem',
    'handleSubjectsChange',
    'const SUBJECT_FILTERS = ["전체", ...SUBJECT_OPTIONS] as const;',
    'subjectFilter',
    'SUBJECT_FILTERS.map((filter) =>',
    'variant={subjectFilter === filter ? "default" : "outline"}',
    'setSubjectFilter(filter)',
    'rows.filter((row) =>',
    'subjectFilter === "전체"',
    'row.subjects.includes(subjectFilter)',
    'ArrowUp',
    'ArrowDown',
    'handleMoveRow',
    'aria-label="선생님 순서 위로 이동"',
    'aria-label="선생님 순서 아래로 이동"',
    'useSettingsTableColumns',
    'TEACHER_TABLE_COLUMNS',
    '{ id: "subjects", label: "과목" }',
    'columnSettingsControl',
    'visibleColumnCount',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  assert.match(source, /supabase\s*\.from\("teacher_catalogs"\)/);

  for (const stale of [
    "운영 브리핑",
    "요약 카드",
    "도움말",
    "관리자 전용 동선",
    'name="teacher-sort-order"',
    '{ id: "sortOrder", label: "정렬" }',
    '{ id: "subjects", label: "담당 과목" }',
    ">담당 과목</TableHead>",
    'placeholder="담당 과목"',
    'aria-label="선생님 목록 새로고침"',
  ]) {
    assert.equal(source.includes(stale), false, `unexpected ${stale}`);
  }
});
