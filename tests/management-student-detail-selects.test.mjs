import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("student detail uses linked selects for school category, school, and grade", async () => {
  const source = await readFile(new URL("src/features/management/management-page.tsx", root), "utf8");

  assert.match(source, /const STUDENT_SCHOOL_CATEGORY_OPTIONS = \["고등", "중등", "초등"\] as const/);
  assert.match(source, /const STUDENT_SELECT_FIELD_NAMES = new Set\(\["school_category", "school", "grade"\]\)/);
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
