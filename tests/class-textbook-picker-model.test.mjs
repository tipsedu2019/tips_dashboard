import test from "node:test";
import assert from "node:assert/strict";

import {
  filterClassTextbookCandidates,
  getDefaultClassTextbookFilters,
} from "../src/features/management/class-textbook-picker-model.ts";

const catalog = [
  { id: "broad", title: "공용 수학", subject: "math", school_levels: ["elementary", "middle", "high"], grade_levels: ["e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"], sub_subject: "기타", publisher: "A" },
  { id: "h3", title: "고3 모고", subject: "math", school_levels: ["high"], grade_levels: ["h3"], sub_subject: "모고", publisher: "B" },
  { id: "m2", title: "중2 수학", subject: "math", school_levels: ["middle"], grade_levels: ["m2"], sub_subject: "내신", publisher: "C" },
];

test("class defaults derive subject, school, and grade", () => {
  assert.deepEqual(getDefaultClassTextbookFilters({ subject: "수학", grade: "고3" }), {
    subject: "math",
    schoolLevel: "high",
    gradeLevel: "h3",
    subSubject: "",
  });
});

test("default candidates include broad and exact books only", () => {
  const filters = getDefaultClassTextbookFilters({ subject: "수학", grade: "고3" });
  assert.deepEqual(filterClassTextbookCandidates(catalog, filters, "").map((book) => book.id), ["broad", "h3"]);
});

test("sub-subject and text search narrow independently", () => {
  const filters = { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "모고" };
  assert.deepEqual(filterClassTextbookCandidates(catalog, filters, "고3").map((book) => book.id), ["h3"]);
});

test("cleared taxonomy filters expose the full catalog", () => {
  const filters = { subject: "", schoolLevel: "", gradeLevel: "", subSubject: "" };
  assert.deepEqual(filterClassTextbookCandidates(catalog, filters, "").map((book) => book.id), ["broad", "h3", "m2"]);
});

test('class textbook defaults remove unavailable filter choices without removing legacy books', () => {
  for (const grade of ['초1', '초2', '초3', '초4']) {
    assert.deepEqual(getDefaultClassTextbookFilters({ subject: '기타', grade, subSubject: 'legacy' }), { subject: '', schoolLevel: 'elementary', gradeLevel: '', subSubject: '' })
  }
  assert.deepEqual(getDefaultClassTextbookFilters({ subject: '영어', grade: '초5', subSubject: '기타' }), { subject: 'english', schoolLevel: 'elementary', gradeLevel: 'e5', subSubject: '기타' })
  const legacy = { id: 'legacy', title: '합성 초1 교재', subject: 'other', school_levels: ['elementary'], grade_levels: ['e1'], sub_subject: '기타' }
  const all = { subject: '', schoolLevel: '', gradeLevel: '', subSubject: '' }
  assert.deepEqual(filterClassTextbookCandidates([legacy, ...catalog], all, '').map(b => b.id), ['legacy', 'broad', 'h3', 'm2'])
  assert.deepEqual(filterClassTextbookCandidates([legacy, ...catalog], all, '합성 초1').map(b => b.id), ['legacy'])
})


test('stored taxonomy keeps removed browsing choices available to authoring forms', async () => {
  const { TEXTBOOK_SUBJECT_OPTIONS, TEXTBOOK_GRADE_OPTIONS } = await import('../src/features/textbooks/textbook-taxonomy.ts')
  assert.ok(TEXTBOOK_SUBJECT_OPTIONS.some(o => o.value === 'other'))
  for (const grade of ['e1', 'e2', 'e3', 'e4']) assert.ok(TEXTBOOK_GRADE_OPTIONS.some(o => o.value === grade))
})
