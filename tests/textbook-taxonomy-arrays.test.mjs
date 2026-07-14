import test from "node:test";
import assert from "node:assert/strict";

import {
  getTextbookGradeSummary,
  getTextbookSchoolLevelSummary,
  getTextbookTaxonomySelection,
  matchesTextbookTaxonomy,
  toggleTextbookGradeLevel,
  toggleTextbookSchoolLevel,
  validateTextbookTaxonomy,
} from "../src/features/textbooks/textbook-taxonomy.ts";

test("arrays are authoritative and canonical", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({
      school_levels: ["high", "elementary", "high"],
      grade_levels: ["h3", "e6", "h1", "h3"],
      school_level: "middle",
      grade_level: "m2",
    }),
    {
      schoolLevels: ["elementary", "high"],
      gradeLevels: ["e6", "h1", "h3"],
    },
  );
});

test("a scalar school without a grade expands to every grade in that school", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({ school_level: "high" }),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
});

test("a scalar grade derives its school", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({ grade_level: "e6" }),
    { schoolLevels: ["elementary"], gradeLevels: ["e6"] },
  );
});

test("an unclassified legacy textbook becomes broad", () => {
  const result = getTextbookTaxonomySelection({ title: "공용 교재", category: "기타" });
  assert.deepEqual(result.schoolLevels, ["elementary", "middle", "high"]);
  assert.equal(result.gradeLevels.length, 12);
});

test("checking a school adds all of its grades", () => {
  assert.deepEqual(
    toggleTextbookSchoolLevel({ schoolLevels: [], gradeLevels: [] }, "high", true),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
});

test("checking a grade adds its school and removing the final grade removes the school", () => {
  const checked = toggleTextbookGradeLevel({ schoolLevels: [], gradeLevels: [] }, "e6", true);
  assert.deepEqual(checked, { schoolLevels: ["elementary"], gradeLevels: ["e6"] });
  assert.deepEqual(toggleTextbookGradeLevel(checked, "e6", false), { schoolLevels: [], gradeLevels: [] });
});

test("unchecking a school removes all grades in that school", () => {
  assert.deepEqual(
    toggleTextbookSchoolLevel(
      { schoolLevels: ["middle", "high"], gradeLevels: ["m1", "m3", "h2"] },
      "middle",
      false,
    ),
    { schoolLevels: ["high"], gradeLevels: ["h2"] },
  );
});

test("required taxonomy validation returns a Korean field error", () => {
  assert.deepEqual(
    validateTextbookTaxonomy({ subject: "math", schoolLevels: ["high"], gradeLevels: [], subSubject: "기하" }),
    { valid: false, field: "gradeLevels", message: "학년을 하나 이상 선택하세요." },
  );
});

test("broad summaries stay compact", () => {
  const broad = {
    school_levels: ["elementary", "middle", "high"],
    grade_levels: ["e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"],
  };
  assert.equal(getTextbookSchoolLevelSummary(broad), "초·중·고");
  assert.equal(getTextbookGradeSummary(broad), "전 학년");
  assert.equal(getTextbookGradeSummary({ school_levels: ["high"], grade_levels: ["h1", "h2", "h3"] }), "고1–고3");
  assert.equal(getTextbookGradeSummary({ school_levels: ["high"], grade_levels: ["h1", "h3"] }), "고1 · 고3");
});

test("containment includes broad books and excludes unrelated grades", () => {
  const broad = {
    school_levels: ["elementary", "middle", "high"],
    grade_levels: ["e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"],
    subject: "math",
    sub_subject: "기타",
  };
  assert.equal(matchesTextbookTaxonomy(broad, { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "" }), true);
  assert.equal(matchesTextbookTaxonomy({ ...broad, grade_levels: ["h1"] }, { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "" }), false);
});
