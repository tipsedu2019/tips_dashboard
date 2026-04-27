import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademicEventMutationPayload,
  buildAcademicEventMutationPayloadCandidates,
  createAcademicEventDraft,
  DEFAULT_ACADEMIC_EVENT_TYPES,
  normalizeAcademicEventType,
} from "../v2/src/features/operations/academic-event-utils.js";

test("academic event utils expose only canonical event type options", () => {
  assert.deepEqual(DEFAULT_ACADEMIC_EVENT_TYPES, [
    "시험기간",
    "영어시험일",
    "수학시험일",
    "체험학습",
    "방학·휴일·기타",
    "팁스",
  ]);
  assert.equal(normalizeAcademicEventType("시험"), "시험기간");
  assert.equal(normalizeAcademicEventType("설명회"), "팁스");
  assert.equal(normalizeAcademicEventType("특강"), "팁스");
  assert.equal(normalizeAcademicEventType("학교행사"), "체험학습");
  assert.equal(normalizeAcademicEventType("방학"), "방학·휴일·기타");
  assert.equal(normalizeAcademicEventType(""), "방학·휴일·기타");
  assert.equal(normalizeAcademicEventType("알 수 없는 일정"), "방학·휴일·기타");
});

test("createAcademicEventDraft reuses normalized event values for editing", () => {
  const draft = createAcademicEventDraft(
    {
      id: "event-1",
      title: "중간고사",
      schoolId: "school-1",
      schoolName: "중앙고",
      category: "high",
      type: "시험기간",
      start: "2026-04-21",
      end: "2026-04-25",
      grade: "고1",
      note: "시험 범위 공지 예정",
    },
    {
      schoolOptions: [{ id: "school-1", name: "중앙고", category: "high" }],
    },
  );

  assert.equal(draft.id, "event-1");
  assert.equal(draft.title, "중간고사");
  assert.equal(draft.schoolId, "school-1");
  assert.equal(draft.category, "high");
  assert.equal(draft.start, "2026-04-21");
  assert.equal(draft.end, "2026-04-25");
  assert.equal(draft.grade, "고1");
  assert.equal(draft.note, "시험 범위 공지 예정");
});

test("buildAcademicEventMutationPayload normalizes school metadata, canonical event type, and date range", () => {
  const result = buildAcademicEventMutationPayload(
    {
      title: "학교 설명회",
      schoolId: "school-2",
      type: "설명회",
      start: "2026-05-07",
      end: "2026-05-05",
      grade: "",
      note: "  ",
    },
    [{ id: "school-2", name: "대치고", category: "high" }],
  );

  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.payload, {
    title: "학교 설명회",
    school_id: "school-2",
    school: "대치고",
    type: "팁스",
    start: "2026-05-07",
    end: "2026-05-07",
    grade: "all",
    category: "high",
    note: null,
  });
});

test("buildAcademicEventMutationPayload returns field errors for required data", () => {
  const result = buildAcademicEventMutationPayload(
    {
      title: "",
      schoolId: "",
      start: "",
    },
    [],
  );

  assert.equal(result.isValid, false);
  assert.equal(result.payload, null);
  assert.equal(result.errors.title, "제목을 입력해 주세요.");
  assert.equal(result.errors.schoolId, "학교를 선택해 주세요.");
  assert.equal(result.errors.start, "시작일을 입력해 주세요.");
});

test("academic event mutation candidates support legacy date-column fallbacks", () => {
  const candidates = buildAcademicEventMutationPayloadCandidates({
    id: "event-1",
    title: "중간고사",
    school_id: "school-1",
    school: "중앙고",
    type: "시험기간",
    start: "2026-04-21",
    end: "2026-04-25",
    grade: "고1",
    category: "high",
    note: "메모",
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].payload.start, "2026-04-21");
  assert.equal(candidates[0].payload.end, "2026-04-25");
  assert.equal(candidates[0].payload.date, "2026-04-21");
  assert.equal(candidates[1].payload.start_date, "2026-04-21");
  assert.equal(candidates[1].payload.end_date, "2026-04-25");
  assert.equal(candidates[1].payload.date, "2026-04-21");
  assert.deepEqual(candidates[2].payload, {
    id: "event-1",
    title: "중간고사",
    school: "중앙고",
    school_id: "school-1",
    type: "시험기간",
    color: null,
    grade: "고1",
    note: "메모",
    category: "high",
    date: "2026-04-21",
  });
});

test("academic event mutation candidates generate an id for new Supabase rows", () => {
  const candidates = buildAcademicEventMutationPayloadCandidates({
    title: "새 중간고사",
    school_id: "11111111-1111-4111-8111-111111111111",
    school: "중앙고",
    type: "시험기간",
    start: "2026-04-21",
    end: "2026-04-25",
    grade: "고1",
    category: "high",
  });

  assert.match(candidates[0].payload.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(candidates[1].payload.id, candidates[0].payload.id);
  assert.equal(candidates[2].payload.id, candidates[0].payload.id);
});
