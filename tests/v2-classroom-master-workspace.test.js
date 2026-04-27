import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const managementPageFile = path.join(root, "v2", "src", "features", "management", "management-page.tsx");
const classroomMasterPageFile = path.join(root, "v2", "src", "app", "admin", "settings", "classrooms", "page.tsx");
const legacyClassroomMasterPageFile = path.join(root, "v2", "src", "app", "admin", "classrooms", "page.tsx");
const classroomMasterWorkspaceFile = path.join(root, "v2", "src", "features", "management", "classroom-master-workspace.tsx");
const navigationFile = path.join(root, "v2", "src", "lib", "navigation.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("class management wires the classroom-master action into a dedicated admin route", () => {
  const source = read(managementPageFile);

  assert.match(source, /router\.push\("\/admin\/settings\/classrooms"\)/);
  assert.match(source, /onOpenClassroomMaster:\s*\(\)\s*=>\s*router\.push\("\/admin\/settings\/classrooms"\)/);
});

test("classroom settings route stays minimal and renders the dedicated workspace", () => {
  const source = read(classroomMasterPageFile);

  assert.match(source, /ClassroomMasterWorkspace/);
  assert.match(source, /return\s+<ClassroomMasterWorkspace\s*\/?>/);
});

test("legacy classroom route redirects into settings", () => {
  const source = read(legacyClassroomMasterPageFile);

  assert.match(source, /redirect\("\/admin\/settings\/classrooms"\)/);
});

test("classroom master workspace supports practical CRUD through the shared management service", () => {
  const source = read(classroomMasterWorkspaceFile);

  for (const marker of [
    "managementService.upsertClassroomCatalogs",
    "managementService.deleteClassroomCatalogs",
    "강의실 마스터",
    "강의실 추가",
    "저장",
    "삭제",
    "const parsedSortOrder = Number.parseInt(row.sortOrder, 10);",
    "sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : nextSortOrder",
    'name="classroom-name"',
    'aria-label="강의실 표시 여부"',
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
    'aria-label="강의실 순서 위로 이동"',
    'aria-label="강의실 순서 아래로 이동"',
    'useSettingsTableColumns',
    'CLASSROOM_TABLE_COLUMNS',
    '{ id: "subjects", label: "과목" }',
    'columnSettingsControl',
    'visibleColumnCount',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  assert.match(source, /supabase\s*\.from\("classroom_catalogs"\)/);

  for (const stale of [
    "운영 브리핑",
    "요약 카드",
    "도움말",
    "관리자 전용 동선",
    'name="classroom-sort-order"',
    '{ id: "sortOrder", label: "정렬" }',
    '{ id: "subjects", label: "사용 과목" }',
    ">사용 과목</TableHead>",
    'placeholder="사용 과목"',
    'aria-label="강의실 목록 새로고침"',
  ]) {
    assert.equal(source.includes(stale), false, `unexpected ${stale}`);
  }
});

test("navigation exposes route metadata for the classroom master workspace", () => {
  const source = read(navigationFile);

  assert.match(source, /match:\s*"\/admin\/settings\/classrooms"/);
  assert.match(source, /title:\s*"강의실 설정"/);
});
