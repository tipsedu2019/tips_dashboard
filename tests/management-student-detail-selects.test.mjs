import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("student detail uses linked selects for status, school category, school, and grade", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /const STUDENT_SCHOOL_CATEGORY_OPTIONS = \["고등", "중등", "초등"\] as const/);
  assert.match(source, /const STUDENT_SELECT_FIELD_NAMES = new Set\(\["status", "school_category", "school", "grade"\]\)/);
  assert.match(source, /\{ name: "status", label: "재원 상태"/);
  assert.match(source, /\{ name: "school_category", label: "학교 구분"/);
  assert.match(source, /if \(name === "school_category"\) return getStudentSchoolCategoryFromRaw\(raw\)/);
});

test("changing student school category resets incompatible school and grade values", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /function getStudentSchoolOptions\(rawRows: Record<string, unknown>\[\], category: string\)/);
  assert.match(source, /function getStudentGradeOptions\(rawRows: Record<string, unknown>\[\], category: string\)/);
  assert.match(source, /if \(fieldName === "school_category"\)/);
  assert.match(source, /if \(next\.school && category && !schoolOptions\.includes\(next\.school\)\)/);
  assert.match(source, /if \(next\.grade && category && !gradeOptions\.includes\(next\.grade\)\)/);
});

test("student select fields use the shared select renderer instead of plain inputs", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /kind === "students" && STUDENT_SELECT_FIELD_NAMES\.has\(fieldName\)/);
  assert.match(source, /const options = studentSelectOptions\[fieldName\] \|\| \[\]/);
  assert.match(source, /onValueChange=\{\(nextValue\) => handleEditableFieldChange\(field\.name, nextValue\)\}/);
});

test("student detail keeps only actionable student fields", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");
  const studentDetailFieldsStart = source.indexOf("const STUDENT_DETAIL_FIELD_NAMES");
  const studentDetailFieldsEnd = source.indexOf("];", studentDetailFieldsStart) + 2;
  const studentDetailFieldsSource = source.slice(studentDetailFieldsStart, studentDetailFieldsEnd);

  assert.match(source, /\{ name: "uid", label: "메이크에듀 원생고유번호"/);
  assert.notEqual(studentDetailFieldsStart, -1);
  assert.doesNotMatch(studentDetailFieldsSource, /"enrollDate"/);
  assert.match(source, /\{kind !== "students" \? \(\s*<section className="space-y-2">/);
  assert.match(source, /\{kind !== "students" \? \(\s*<section className="border-y py-3">/);
  assert.match(source, /\{kind !== "students" \? <div className="text-sm font-semibold">/);
  assert.match(source, /renderEditableFields\("detail", kind === "students" \? STUDENT_DETAIL_FIELD_NAMES : undefined\)/);
});

test("student detail uses student-specific labels without redundant badges", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /\{ name: "contact", label: "학생 연락처"/);
  assert.match(source, /kind === "students"\s*\? `\$\{selectedRow\?\.title \|\| ""\} 학생정보`/);
  assert.match(source, /\{kind !== "students" \? \(\s*<div className="flex flex-wrap items-center gap-2">\s*<Badge>\{selectedRow\.badge\}<\/Badge>/);
  assert.match(source, /kind === "students" \? "수강 추가" : "등록 추가"/);
  assert.match(source, /\{modeLabel === "수강" \? "대기 전환" : "수강 전환"\}/);
  assert.match(source, /\{modeLabel === "수강" \? "수강 해제" : "대기 해제"\}/);
  assert.match(source, /renderRelationList\("수강 수업", getStudentEnrolledClassIds\(selectedRow\), "수강"\)/);
});
