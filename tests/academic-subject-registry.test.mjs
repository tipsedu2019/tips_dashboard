import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMIC_SUBJECTS,
  ACADEMIC_SUBJECT_VALUES,
  isScienceGrade,
  parseAcademicSubject,
  parseAcademicSubjectKey,
  serializeAcademicSubjects,
  sortAcademicSubjects,
  subjectSupports,
} from "../src/lib/academic-subject-registry.ts";

test("the root registry keeps three stable subjects", () => {
  assert.deepEqual(ACADEMIC_SUBJECT_VALUES, ["영어", "수학", "과학"]);
  assert.deepEqual(
    ACADEMIC_SUBJECTS.map(({ key, value, team, sortOrder }) => ({ key, value, team, sortOrder })),
    [
      { key: "english", value: "영어", team: "영어팀", sortOrder: 10 },
      { key: "math", value: "수학", team: "수학팀", sortOrder: 20 },
      { key: "science", value: "과학", team: "과학팀", sortOrder: 30 },
    ],
  );
  assert.equal(parseAcademicSubject("science"), "과학");
  assert.equal(parseAcademicSubjectKey("과학"), "science");
  assert.equal(parseAcademicSubject("unknown"), null);
});

test("subject aliases normalize while sorting and serialization fail closed", () => {
  assert.equal(parseAcademicSubject(" English "), "영어");
  assert.equal(parseAcademicSubject("MATH"), "수학");
  assert.equal(parseAcademicSubjectKey(" SCIENCE "), "science");
  assert.equal(parseAcademicSubjectKey("unknown"), null);
  assert.deepEqual(
    sortAcademicSubjects(["과학", "unknown", "영어", "science", "수학"]),
    ["영어", "수학", "과학"],
  );
  assert.equal(
    serializeAcademicSubjects(["science", "수학", "영어", "영어", "unknown"]),
    "영어, 수학, 과학",
  );
});

test("science stays high-school-only and out of English-only workflows", () => {
  assert.equal(isScienceGrade("고1"), true);
  assert.equal(isScienceGrade("중3"), false);
  assert.equal(subjectSupports("과학", "registration"), true);
  assert.equal(subjectSupports("과학", "word_retest"), false);
  assert.equal(subjectSupports("수학", "word_retest"), false);
  assert.equal(subjectSupports("영어", "word_retest"), true);
  assert.equal(subjectSupports("unknown", "registration"), false);
  assert.deepEqual(sortAcademicSubjects(["과학", "영어", "수학"]), ["영어", "수학", "과학"]);
});
