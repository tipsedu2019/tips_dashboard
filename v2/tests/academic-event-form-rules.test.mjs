import test from "node:test";
import assert from "node:assert/strict";

import { buildAcademicEventMutationPayload } from "../src/features/operations/academic-event-utils.js";
import {
  getEventGradeOptions,
  getGradeOptionsForSchoolCategory,
} from "../src/app/admin/calendar/utils/calendar-grid.js";

const schoolOptions = [
  {
    id: "school-high",
    name: "대기고",
    category: "high",
  },
];

test("academic calendar grade selection does not expose N수", () => {
  assert.equal(getEventGradeOptions().some((option) => option.value === "N수"), false);
  assert.equal(getGradeOptionsForSchoolCategory("high").some((option) => option.value === "N수"), false);
});

test("tips events can be saved without school selection", () => {
  const result = buildAcademicEventMutationPayload(
    {
      title: "입시설명회",
      type: "팁스",
      start: "2026-04-28",
      end: "2026-04-28",
      grade: "all",
    },
    schoolOptions,
  );

  assert.equal(result.isValid, true);
  assert.equal(result.payload.school_id, null);
  assert.equal(result.payload.school, null);
});

test("school-linked events still explain the missing school", () => {
  const result = buildAcademicEventMutationPayload(
    {
      title: "고1 시험",
      type: "시험기간",
      start: "2026-04-28",
      grade: "고1",
    },
    schoolOptions,
  );

  assert.equal(result.isValid, false);
  assert.equal(result.errors.schoolId, "학교를 선택해 주세요.");
});
