import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademicEventMutationPayload,
  DEFAULT_ACADEMIC_EVENT_TYPES,
  runAcademicEventMutation,
} from "../src/features/operations/academic-event-utils.js";
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

test("academic event mutation preserves multi-day end date on start_date end_date schemas", async () => {
  const attempts = [];
  const result = await runAcademicEventMutation(
    {
      title: "1학기 기말고사",
      school_id: "school-high",
      school: "동여중",
      type: DEFAULT_ACADEMIC_EVENT_TYPES[0],
      start: "2026-07-07",
      end: "2026-07-10",
      date: "2026-07-07",
      grade: "all",
      category: "middle",
      note: "시험기간",
    },
    async (payload) => {
      attempts.push({ ...payload });
      if ("start" in payload) {
        return { error: { message: "Could not find the 'start' column of 'academic_events' in the schema cache" } };
      }
      if ("end" in payload) {
        return { error: { message: "Could not find the 'end' column of 'academic_events' in the schema cache" } };
      }
      return { error: null };
    },
  );

  assert.equal(result.error, null);
  const successfulPayload = attempts.at(-1);
  assert.equal(successfulPayload.start_date, "2026-07-07");
  assert.equal(successfulPayload.end_date, "2026-07-10");
  assert.equal(successfulPayload.date, "2026-07-07");
  assert.equal("start" in successfulPayload, false);
  assert.equal("end" in successfulPayload, false);
});

test("academic event payload keeps range end metadata for date-only fallback schemas", () => {
  const result = buildAcademicEventMutationPayload(
    {
      title: "1학기 기말고사",
      type: DEFAULT_ACADEMIC_EVENT_TYPES[0],
      schoolId: "school-high",
      start: "2026-07-07",
      end: "2026-07-10",
      grade: "all",
      note: "시험기간",
    },
    schoolOptions,
  );

  assert.equal(result.isValid, true);
  assert.match(result.payload.note, /\[\[TIPS_META\]\]/);
  assert.match(result.payload.note, /"rangeEnd":"2026-07-10"/);
});
