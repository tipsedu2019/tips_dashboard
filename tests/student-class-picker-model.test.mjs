import test from "node:test";
import assert from "node:assert/strict";

import * as pickerModel from "../src/features/management/student-class-picker-model.ts";

const {
  filterStudentClassCandidates,
  getDefaultStudentClassPickerScope,
} = pickerModel;

const classes = [
  { id: "h2-math", name: "고2 수학", subject: "수학", grade: "고2", schedule: "월 18:00-20:00" },
  { id: "h2-english", name: "고2 영어", subject: "영어", grade: "고2", schedule: "화 19:00-21:00" },
  { id: "h3-math", name: "고3 수학", subject: "수학", grade: "고3", schedule: "수 18:00-20:00" },
  { id: "ungraded", name: "공통 특강", subject: "수학", grade: "", schedule: "토 10:00-12:00" },
];

const students = [
  { id: "h2-jeju", name: "김학생", grade: "고2", school: "제주여고" },
  { id: "h2-ohyeon", name: "이학생", grade: "고2", school: "오현고" },
  { id: "h3-jeju", name: "박학생", grade: "고3", school: "제주여고" },
  { id: "ungraded", name: "최학생", grade: "", school: "" },
];

test("graded students default to same grade and ungraded students default to all grades", () => {
  assert.equal(getDefaultStudentClassPickerScope({ grade: "고2" }), "same-grade");
  assert.equal(getDefaultStudentClassPickerScope({ grade: "" }), "all-grades");
});

test("same-grade scope includes only the exact student grade", () => {
  assert.deepEqual(
    filterStudentClassCandidates(classes, {
      studentGrade: "고2",
      scope: "same-grade",
      query: "",
    }).map((row) => row.id),
    ["h2-math", "h2-english"],
  );
});

test("all-grade scope restores other and ungraded classes", () => {
  assert.deepEqual(
    filterStudentClassCandidates(classes, {
      studentGrade: "고2",
      scope: "all-grades",
      query: "",
    }).map((row) => row.id),
    ["h2-math", "h2-english", "h3-math", "ungraded"],
  );
});

test("text search applies inside the active grade scope", () => {
  assert.deepEqual(
    filterStudentClassCandidates(classes, {
      studentGrade: "고2",
      scope: "same-grade",
      query: "영어",
    }).map((row) => row.id),
    ["h2-english"],
  );
});

test("a missing student grade safely exposes the catalog", () => {
  assert.equal(
    filterStudentClassCandidates(classes, {
      studentGrade: "",
      scope: "same-grade",
      query: "",
    }).length,
    classes.length,
  );
});

test("student class picker defaults to the student's grade and filters subject before grade", () => {
  assert.equal(typeof pickerModel.getDefaultStudentClassPickerFilters, "function");
  assert.deepEqual(
    pickerModel.getDefaultStudentClassPickerFilters({ grade: "고2" }),
    { subject: "", grade: "고2" },
  );
  assert.deepEqual(
    pickerModel.filterStudentClassCandidates(classes, {
      studentGrade: "고2",
      scope: "all-grades",
      subject: "수학",
      grade: "고2",
      query: "",
    }).map((row) => row.id),
    ["h2-math"],
  );
  assert.deepEqual(pickerModel.getStudentClassSubjectOptions(classes), ["수학", "영어"]);
  assert.deepEqual(pickerModel.getStudentClassGradeOptions(classes, "수학"), ["고2", "고3"]);
});

test("class student picker defaults to the class grade and filters grade before school", () => {
  assert.equal(typeof pickerModel.getDefaultClassStudentPickerFilters, "function");
  assert.deepEqual(
    pickerModel.getDefaultClassStudentPickerFilters({ grade: "고2" }),
    { grade: "고2", school: "" },
  );
  assert.deepEqual(
    pickerModel.filterClassStudentCandidates(students, {
      grade: "고2",
      school: "제주여고",
      query: "",
    }).map((row) => row.id),
    ["h2-jeju"],
  );
  assert.deepEqual(pickerModel.getClassStudentGradeOptions(students), ["고2", "고3"]);
  assert.deepEqual(pickerModel.getClassStudentSchoolOptions(students, "고2"), ["오현고", "제주여고"]);
});
