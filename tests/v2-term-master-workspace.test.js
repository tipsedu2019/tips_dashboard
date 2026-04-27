import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const managementPageFile = path.join(root, "v2", "src", "features", "management", "management-page.tsx");
const termMasterPageFile = path.join(root, "v2", "src", "app", "admin", "settings", "terms", "page.tsx");
const legacyTermMasterPageFile = path.join(root, "v2", "src", "app", "admin", "terms", "page.tsx");
const termMasterWorkspaceFile = path.join(root, "v2", "src", "features", "management", "term-master-workspace.tsx");
const classGroupMasterWorkspaceFile = path.join(root, "v2", "src", "features", "management", "class-group-master-workspace.tsx");
const managementServiceFile = path.join(root, "v2", "src", "features", "management", "management-service.js");
const navigationFile = path.join(root, "v2", "src", "lib", "navigation.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("class management wires the term-master action into a dedicated admin route", () => {
  const source = read(managementPageFile);

  assert.match(source, /router\.push\("\/admin\/settings\/class-groups"\)/);
  assert.match(source, /onOpenTermManager:\s*\(\)\s*=>\s*router\.push\("\/admin\/settings\/class-groups"\)/);
});

test("legacy term settings route redirects into period settings", () => {
  const source = read(termMasterPageFile);

  assert.match(source, /redirect\("\/admin\/settings\/class-groups"\)/);
});

test("legacy term route redirects into settings", () => {
  const source = read(legacyTermMasterPageFile);

  assert.match(source, /redirect\("\/admin\/settings\/class-groups"\)/);
});

test("management service exposes shared term CRUD helpers", () => {
  const source = read(managementServiceFile);

  for (const marker of [
    "buildClassTermPayload",
    "upsertClassTerms",
    'return upsertRows(client, "class_terms", buildClassTermPayload(terms, { generateId }))',
    "deleteClassTerm",
    'return deleteRows(client, "class_terms", id ? [id] : [])',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }
});

test("term master workspace supports practical CRUD through the shared management service", () => {
  const source = read(termMasterWorkspaceFile);

  for (const marker of [
    "managementService.upsertClassTerms",
    "managementService.deleteClassTerm",
    'supabase\n        .from("class_terms")',
    "학기 마스터",
    "학기 추가",
    "학년도",
    "학기명",
    "시작일",
    "종료일",
    "저장",
    "삭제",
    "const parsedSortOrder = Number.parseInt(row.sortOrder, 10);",
    "sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : nextSortOrder",
    'name="term-academic-year"',
    'name="term-name"',
    'name="term-status"',
    'name="term-start-date"',
    'name="term-end-date"',
    'useSettingsTableColumns',
    'TERM_TABLE_COLUMNS',
    'columnSettingsControl',
    'visibleColumnCount',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const stale of [
    "운영 브리핑",
    "요약 카드",
    "도움말",
    "관리자 전용 동선",
    'name="term-sort-order"',
    '{ id: "sortOrder", label: "정렬" }',
    'aria-label="학기 목록 새로고침"',
  ]) {
    assert.equal(source.includes(stale), false, `unexpected ${stale}`);
  }
});

test("navigation exposes route metadata for the term master workspace", () => {
  const source = read(navigationFile);

  assert.match(source, /match:\s*"\/admin\/settings\/terms"/);
  assert.match(source, /title:\s*"기간 설정"/);
});

test("period settings table omits the subject column", () => {
  const source = read(classGroupMasterWorkspaceFile);

  for (const marker of [
    'CLASS_GROUP_TABLE_COLUMNS',
    '{ id: "name", label: "기간명" }',
    '{ id: "default", label: "기본값" }',
    '{ id: "action", label: "작업", required: true }',
    'name="class-group-name"',
  ]) {
    assert.equal(source.includes(marker), true, `expected ${marker}`);
  }

  for (const stale of [
    '{ id: "subject", label: "과목" }',
    'isColumnVisible("subject")',
    'name="class-group-subject"',
    ">과목</TableHead>",
  ]) {
    assert.equal(source.includes(stale), false, `unexpected ${stale}`);
  }
});
