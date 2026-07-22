import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademicEventNote,
  buildAcademicEventMutationPayload,
  DEFAULT_ACADEMIC_EVENT_TYPES,
  getAcademicEventFilterTypeKey,
  getAcademicEventTypeLabel,
  isSubjectExamType,
  parseActiveScienceSubjectAreas,
  prepareAcademicEventMetadataForWrite,
  runAcademicEventMutation,
  validateScienceExamDraft,
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

test("science exam day is the fourth explicit subject exam type", () => {
  assert.deepEqual(DEFAULT_ACADEMIC_EVENT_TYPES.slice(0, 4), [
    "시험기간",
    "영어시험일",
    "수학시험일",
    "과학시험일",
  ]);
  assert.equal(isSubjectExamType("과학시험일"), true);
  assert.equal(isSubjectExamType("알 수 없는 과학 일정"), false);
  assert.equal(getAcademicEventTypeLabel("과학시험일"), "과학 시험일 및 시험범위");
  assert.equal(getAcademicEventFilterTypeKey("과학시험일"), "type:과학시험일");
});

test("academic event writes fail closed for missing and unknown event types", () => {
  for (const type of ["", "future-science-exam"]) {
    const result = buildAcademicEventMutationPayload(
      {
        title: "미지원 일정",
        schoolId: "school-high",
        type,
        start: "2026-04-29",
        grade: "고1",
      },
      schoolOptions,
    );

    assert.equal(result.isValid, false);
    assert.equal(result.payload, null);
    assert.equal(result.errors.type, "지원하는 일정 유형을 선택해 주세요.");
  }
});

test("active science area responses are normalized once for form and drag validation", () => {
  assert.deepEqual(
    parseActiveScienceSubjectAreas([
      { area_key: "physics", label: "물리", sort_order: null, is_active: true },
      { area_key: "integrated_science", label: "통합과학", sort_order: 10, is_active: true },
      { area_key: "chemistry", label: "화학", sort_order: 30, is_active: false },
      { area_key: "life_science", label: "생명과학", sort_order: 35 },
      { area_key: "earth_science", label: "", sort_order: 40, is_active: true },
      { area_key: "future_science", label: "미래과학", sort_order: 50, is_active: true },
    ]),
    [
      { areaKey: "integrated_science", label: "통합과학", sortOrder: 10, isActive: true },
      { areaKey: "physics", label: "물리", sortOrder: 20, isActive: true },
    ],
  );
});

test("calendar drag preparation preserves science and unknown embedded metadata", () => {
  const result = prepareAcademicEventMetadataForWrite(
    {
      typeLabel: "과학시험일",
      grade: "고2",
      scienceAreaKey: "physics",
      note: "기존 사용자 메모",
      embeddedNoteMeta: { scienceAreaKey: "physics", legacyFlag: "keep" },
    },
    [{ areaKey: "physics", label: "물리", sortOrder: 20, isActive: true }],
  );

  assert.equal(result.isValid, true);
  assert.equal(result.scienceAreaKey, "physics");
  assert.match(result.note, /기존 사용자 메모/);
  assert.deepEqual(JSON.parse(result.note.split("[[TIPS_META]]")[1].trim()), {
    scienceAreaKey: "physics",
    legacyFlag: "keep",
  });
});

test("science exam validation requires only high-school grades and an active stable area", () => {
  const activeAreas = [
    { area_key: "integrated_science", label: "통합과학", is_active: true },
    { area_key: "physics", label: "물리학", is_active: false },
  ];

  assert.deepEqual(
    validateScienceExamDraft(
      { type: "과학시험일", grade: "중3", scienceAreaKey: "integrated_science" },
      activeAreas,
    ),
    {
      isValid: false,
      errors: { grade: "과학 시험일은 고1~고3만 선택할 수 있습니다." },
    },
  );
  assert.deepEqual(
    validateScienceExamDraft(
      { type: "과학시험일", grade: "고1", scienceAreaKey: "physics" },
      activeAreas,
    ),
    {
      isValid: false,
      errors: { scienceAreaKey: "활성 과학 영역을 선택해 주세요." },
    },
  );
  assert.deepEqual(
    validateScienceExamDraft(
      { type: "과학시험일", grade: "고1,고2", scienceAreaKey: "integrated_science" },
      activeAreas,
    ),
    { isValid: true, errors: {} },
  );
});

test("science area metadata extends the embedded note without losing note or existing metadata", () => {
  const note = buildAcademicEventNote(
    '사용자 메모\n\n[[TIPS_META]] {"legacyFlag":"keep","scienceAreaKey":"physics"}',
    { scienceAreaKey: "chemistry", examTerm: "1학기 중간" },
  );
  const [visibleNote, encodedMeta] = note.split("[[TIPS_META]]");

  assert.equal(visibleNote.trim(), "사용자 메모");
  assert.deepEqual(JSON.parse(encodedMeta.trim()), {
    legacyFlag: "keep",
    scienceAreaKey: "chemistry",
    examTerm: "1학기 중간",
  });

  const payloadResult = buildAcademicEventMutationPayload(
    {
      title: "통합과학 시험",
      schoolId: "school-high",
      type: "과학시험일",
      start: "2026-04-29",
      end: "2026-04-29",
      grade: "고1",
      note,
    },
    schoolOptions,
  );
  const payloadMeta = JSON.parse(payloadResult.payload.note.split("[[TIPS_META]]")[1].trim());
  assert.equal(payloadMeta.legacyFlag, "keep");
  assert.equal(payloadMeta.scienceAreaKey, "chemistry");
});

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
