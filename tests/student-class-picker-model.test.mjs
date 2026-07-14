import test from "node:test";
import assert from "node:assert/strict";

import {
  filterStudentClassCandidates,
  getDefaultStudentClassPickerScope,
} from "../src/features/management/student-class-picker-model.ts";

const classes = [
  { id: "h2-math", name: "고2 수학", subject: "수학", grade: "고2", schedule: "월 18:00-20:00" },
  { id: "h2-english", name: "고2 영어", subject: "영어", grade: "고2", schedule: "화 19:00-21:00" },
  { id: "h3-math", name: "고3 수학", subject: "수학", grade: "고3", schedule: "수 18:00-20:00" },
  { id: "ungraded", name: "공통 특강", subject: "수학", grade: "", schedule: "토 10:00-12:00" },
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
