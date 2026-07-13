import test from "node:test";
import assert from "node:assert/strict";

import { resolveAcademicDirector } from "../src/lib/academic-director-assignment.js";

test("English academic directors follow the approved 2026 base and three-year rotation", () => {
  const baseAssignments = [
    { grades: ["초4", "중1", "고1"], directorName: "강부희" },
    { grades: ["초5", "중2", "고2"], directorName: "정보영" },
    { grades: ["초6", "중3", "고3"], directorName: "김민경" },
  ];

  for (const { grades, directorName } of baseAssignments) {
    for (const grade of grades) {
      const result = resolveAcademicDirector({ subjects: ["영어"], grade, effectiveYear: 2026 });
      assert.equal(result.status, "resolved");
      assert.equal(result.directorName, directorName);
      assert.deepEqual(result.candidateNames, [directorName]);
      assert.equal(result.normalizedGrade, grade);
      assert.deepEqual(result.normalizedSubjects, ["영어"]);
    }
  }

  assert.equal(resolveAcademicDirector({ subjects: ["영어"], grade: "고2", effectiveYear: 2027 }).directorName, "강부희");
  assert.equal(resolveAcademicDirector({ subjects: ["영어"], grade: "고2", effectiveYear: 2028 }).directorName, "김민경");
  assert.equal(resolveAcademicDirector({ subjects: ["영어"], grade: "고2", effectiveYear: 2029 }).directorName, "정보영");
});

test("mathematics academic directors are divided by exact school grade", () => {
  for (const grade of ["초1", "초6", "중1", "중3"]) {
    assert.equal(
      resolveAcademicDirector({ subjects: ["수학"], grade, effectiveYear: 2026 }).directorName,
      "강정은",
    );
  }

  for (const grade of ["고1", "고2", "고3"]) {
    assert.equal(
      resolveAcademicDirector({ subjects: ["수학"], grade, effectiveYear: 2026 }).directorName,
      "양소윤",
    );
  }
});

test("different subject owners are ambiguous and expose both candidates", () => {
  const result = resolveAcademicDirector({ subjects: [" 영어 ", "수학", "영어"], grade: " 고2 ", effectiveYear: 2026 });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.directorName, "");
  assert.deepEqual(result.candidateNames, ["정보영", "양소윤"]);
  assert.equal(result.normalizedGrade, "고2");
  assert.deepEqual(result.normalizedSubjects, ["영어", "수학"]);
});

test("unsupported grades and incomplete rules never guess an academic director", () => {
  for (const input of [
    { subjects: ["영어"], grade: "초2", effectiveYear: 2026 },
    { subjects: ["영어"], grade: "고등", effectiveYear: 2026 },
    { subjects: ["과학"], grade: "고2", effectiveYear: 2026 },
    { subjects: ["영어"], grade: "고2", effectiveYear: undefined },
  ]) {
    const result = resolveAcademicDirector(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.directorName, "");
  }
});
