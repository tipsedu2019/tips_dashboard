import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const serviceModule = await import(
  new URL("../src/features/operations/operations-read-service.js", import.meta.url),
).catch(() => ({}));

const createOperationsReadService = serviceModule.createOperationsReadService;
const normalizeAcademicEventDetail = serviceModule.normalizeAcademicEventDetail;
const resolveAnnualBoardEntryParentId = serviceModule.resolveAnnualBoardEntryParentId;
const buildClassLessonDesignRow = serviceModule.buildClassLessonDesignRow;
const resolveRequestedClassRow = serviceModule.resolveRequestedClassRow;
const appendOperationsPageIfCurrent = serviceModule.appendOperationsPageIfCurrent;
const buildSevenDayRangeKeys = serviceModule.buildSevenDayRangeKeys;
const inferAcademicExamTerm = serviceModule.inferAcademicExamTerm;

const academicEventUtils = await import(
  new URL("../src/features/operations/academic-event-utils.js", import.meta.url),
).catch(() => ({}));
const buildAcademicEventFormScopeFields = academicEventUtils.buildAcademicEventFormScopeFields;
const buildAcademicEventNote = academicEventUtils.buildAcademicEventNote;
const buildAcademicEventMutationPayload = academicEventUtils.buildAcademicEventMutationPayload;
const extractAcademicEventNoteMetadata = academicEventUtils.extractAcademicEventNoteMetadata;
const adaptAcademicEventDetailToCalendarEvent = academicEventUtils.adaptAcademicEventDetailToCalendarEvent;
const isCurrentAcademicDetailRequest = academicEventUtils.isCurrentAcademicDetailRequest;
const buildAcademicEventFormOutputScopeFields = academicEventUtils.buildAcademicEventFormOutputScopeFields;

function makeRpcBuilder(result, calls) {
  return {
    limit(value) {
      calls.push(["limit", value]);
      return this;
    },
    abortSignal(signal) {
      calls.push(["abortSignal", signal]);
      return this;
    },
    retry(value) {
      calls.push(["retry", value]);
      return Promise.resolve(result);
    },
  };
}

function makeClient(responses, calls) {
  return {
    rpc(name, args) {
      calls.push([name, args]);
      const response = responses[name];
      if (typeof response === "function") return makeRpcBuilder(response(args), calls);
      if (!response) throw new Error(`unexpected rpc ${name}`);
      return makeRpcBuilder(response, calls);
    },
  };
}

test("operations calendar starts only its visible-range RPC and preserves complete rows", async () => {
  assert.equal(typeof createOperationsReadService, "function");
  const calls = [];
  const response = {
    ok: true,
    range: { dateFrom: "2026-08-01", dateTo: "2026-09-11" },
    rows: [{ id: "event-1", title: "개학", startsAt: "2026-08-17" }],
    complete: true,
  };
  const service = createOperationsReadService({
    supabase: makeClient({ get_operations_calendar_range_v1: { data: response, error: null } }, calls),
    actorScope: "user-1:admin",
  });

  assert.deepEqual(await service.load({ mode: "calendar", dateFrom: "2026-08-01", dateTo: "2026-09-11" }), response);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_") || name.startsWith("list_")), [[
    "get_operations_calendar_range_v1",
    { p_date_from: "2026-08-01", p_date_to: "2026-09-11" },
  ]]);
  assert.equal(calls.filter(([name]) => name === "abortSignal").length, 1);
  assert.deepEqual(calls.filter(([name]) => name === "retry").map(([, value]) => value), [false]);
});

test("calendar density errors remain all-or-nothing and suggest a seven-day retry", async () => {
  const calls = [];
  const response = {
    ok: false,
    code: "visible_range_too_dense",
    range: { dateFrom: "2026-08-01", dateTo: "2026-09-11" },
    rows: [],
    observedRowsAtLeast: 2001,
    suggestedDays: 7,
  };
  const service = createOperationsReadService({
    supabase: makeClient({ get_operations_calendar_range_v1: { data: response, error: null } }, calls),
    actorScope: "user-1:admin",
  });

  assert.deepEqual(await service.load({ mode: "calendar", dateFrom: "2026-08-01", dateTo: "2026-09-11" }), response);
});

test("annual mode reads one selected year and rejects partial dense boards", async () => {
  const calls = [];
  const dense = { ok: false, code: "annual_board_too_dense" };
  const service = createOperationsReadService({
    supabase: makeClient({ get_operations_annual_board_v1: { data: dense, error: null } }, calls),
    actorScope: "user-1:admin",
  });

  assert.deepEqual(await service.load({ mode: "annual", academicYear: 2026 }), dense);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_") || name.startsWith("list_")), [[
    "get_operations_annual_board_v1",
    { p_academic_year: 2026 },
  ]]);
});

test("class schedule list uses 30 plus one server rows, authoritative stats, and all server filters", async () => {
  const calls = [];
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sort_key: `수업 ${String(index + 1).padStart(2, "0")}`,
    row_data: { id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `수업 ${index + 1}` },
  }));
  const service = createOperationsReadService({
    supabase: makeClient({
      get_operations_class_schedule_page_v1: {
        data: { rows, stats: { total: 31, active: 20, draft: 11 }, filterOptions: { subjects: ["수학"] } },
        error: null,
      },
    }, calls),
    actorScope: "user-1:admin",
  });
  const request = {
    mode: "class_schedule",
    termId: "20000000-0000-4000-8000-000000000001",
    search: "심화",
    subject: "수학",
    grade: "고2",
    teacher: "김교사",
    syncGroupId: "30000000-0000-4000-8000-000000000001",
    cursor: null,
  };

  const result = await service.load(request);
  assert.equal(result.page.rows.length, 30);
  assert.equal(result.page.hasMore, true);
  assert.equal(result.stats.total, 31);
  assert.deepEqual(result.filterOptions.subjects, ["수학"]);
  const args = calls.find(([name]) => name === "get_operations_class_schedule_page_v1")[1];
  assert.deepEqual(args.p_filters, {
    termId: request.termId,
    search: "심화",
    subject: "수학",
    grade: "고2",
    teacher: "김교사",
    syncGroupId: request.syncGroupId,
  });
  assert.equal(args.p_limit, 30);
  assert.equal(args.p_cursor_sort_key, null);
  assert.equal(args.p_cursor_id, null);
  assert.equal(calls.filter(([name]) => name === "get_class_schedule_v1").length, 0);
  assert.equal(calls.filter(([name]) => name === "get_academic_event_detail_v1").length, 0);

  await assert.rejects(
    service.load({ ...request, subject: "영어", cursor: result.page.nextCursor }),
    (error) => error?.code === "operations_cursor_mismatch",
  );
  assert.equal(calls.filter(([name]) => name === "get_operations_class_schedule_page_v1").length, 1);
});

test("event and class full details are selection-driven exact RPCs", async () => {
  const calls = [];
  const eventId = "40000000-0000-4000-8000-000000000001";
  const classId = "50000000-0000-4000-8000-000000000001";
  const service = createOperationsReadService({
    supabase: makeClient({
      get_academic_event_detail_v1: { data: { id: eventId, note: "상세" }, error: null },
      get_class_schedule_v1: { data: { classId, sessions: [] }, error: null },
    }, calls),
    actorScope: "user-1:admin",
  });

  assert.equal(calls.length, 0);
  assert.equal((await service.loadEventDetail(eventId)).id, eventId);
  assert.equal((await service.loadClassScheduleDetail({ classId, dateFrom: "2026-08-01", dateTo: "2026-08-31" })).classId, classId);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_")), [
    ["get_academic_event_detail_v1", { p_event_id: eventId }],
    ["get_class_schedule_v1", { p_class_id: classId, p_date_from: "2026-08-01", p_date_to: "2026-08-31" }],
  ]);
  assert.deepEqual(calls.filter(([name]) => name === "retry").map(([, value]) => value), [false, false]);
});

test("event exact detail preserves every embedded metadata field through the edit payload", async () => {
  assert.equal(typeof normalizeAcademicEventDetail, "function");
  const eventId = "40000000-0000-4000-8000-000000000002";
  const storedNote = `보이는 메모\n\n[[TIPS_META]] ${JSON.stringify({
    examTerm: "1학기 중간",
    scienceAreaKey: "physics",
    textbookScope: "10~30쪽",
    subtextbookScope: "워크북 2단원",
    textbookScopes: [{ name: "기본서", publisher: "팁스", scope: "10~30쪽" }],
    subtextbookScopes: [{ name: "워크북", publisher: "팁스", scope: "2단원" }],
    legacyFlag: "keep",
  })}`;
  const calls = [];
  const service = createOperationsReadService({
    supabase: makeClient({
      get_academic_event_detail_v1: {
        data: {
          id: eventId,
          storedNote,
          embeddedNoteMeta: null,
          textbookScopes: [],
          subtextbookScopes: [],
          materialSections: [],
        },
        error: null,
      },
    }, calls),
    actorScope: "user-meta:admin",
  });

  const detail = await service.loadEventDetail(eventId);
  assert.equal(detail.note, "보이는 메모");
  assert.equal(detail.examTerm, "1학기 중간");
  assert.equal(detail.scienceAreaKey, "physics");
  assert.equal(detail.textbookScope, "10~30쪽");
  assert.equal(detail.subtextbookScope, "워크북 2단원");
  assert.deepEqual(detail.textbookScopes, [{ name: "기본서", publisher: "팁스", scope: "10~30쪽" }]);
  assert.deepEqual(detail.subtextbookScopes, [{ name: "워크북", publisher: "팁스", scope: "2단원" }]);
  assert.equal(detail.embeddedNoteMeta.legacyFlag, "keep");
});

test("event form scalar and structured textbook scopes survive a direct read-form-save roundtrip", async () => {
  assert.equal(typeof buildAcademicEventFormScopeFields, "function");
  const detail = normalizeAcademicEventDetail({
    storedNote: `메모\n\n[[TIPS_META]] ${JSON.stringify({
      textbookScope: "기본서 12~34쪽",
      subtextbookScope: "워크북 3단원",
      textbookScopes: [{ name: "기본서", publisher: "A", scope: "12~34쪽" }],
      subtextbookScopes: [{ name: "워크북", publisher: "B", scope: "3단원" }],
      legacyFlag: "keep",
    })}`,
    textbookScopes: [],
    subtextbookScopes: [],
  });
  const formScopes = buildAcademicEventFormScopeFields(detail, {});
  assert.deepEqual(formScopes, {
    textbookScope: "기본서 12~34쪽",
    subtextbookScope: "워크북 3단원",
    textbookScopes: [{ name: "기본서", publisher: "A", scope: "12~34쪽" }],
    subtextbookScopes: [{ name: "워크북", publisher: "B", scope: "3단원" }],
  });
  const note = buildAcademicEventNote(detail.note, detail.embeddedNoteMeta);
  const result = buildAcademicEventMutationPayload({
    title: "시험",
    type: "팁스",
    start: "2026-08-20",
    end: "2026-08-20",
    grade: "고1",
    note,
    ...formScopes,
  }, []);
  assert.equal(result.isValid, true);
  assert.deepEqual(extractAcademicEventNoteMetadata(result.payload.note), {
    textbookScope: "기본서 12~34쪽",
    subtextbookScope: "워크북 3단원",
    textbookScopes: [{ name: "기본서", publisher: "A", scope: "12~34쪽" }],
    subtextbookScopes: [{ name: "워크북", publisher: "B", scope: "3단원" }],
    legacyFlag: "keep",
  });
  const eventFormSource = await readFile(
    new URL("src/app/admin/calendar/components/event-form.tsx", root),
    "utf8",
  );
  assert.match(eventFormSource, /const scopeFieldsForSave = buildAcademicEventFormOutputScopeFields\(formData\)/);
  assert.match(eventFormSource, /\.\.\.scopeFieldsForSave/);
});

test("calendar exact-detail adapter preserves scalar scopes through a direct save roundtrip", () => {
  assert.equal(typeof adaptAcademicEventDetailToCalendarEvent, "function");
  const detail = normalizeAcademicEventDetail({
    id: "41000000-0000-4000-8000-000000000041",
    title: "2학기 기말고사",
    startsAt: "2026-11-20",
    endsAt: "2026-11-20",
    typeLabel: "시험기간",
    grade: "고1",
    schoolId: "42000000-0000-4000-8000-000000000041",
    schoolName: "검증고",
    storedNote: `정확한 메모\n\n[[TIPS_META]] ${JSON.stringify({
      textbookScope: "본교재 10~20쪽",
      subtextbookScope: "부교재 3단원",
      textbookScopes: [{ name: "본교재", publisher: "A", scope: "10~20쪽" }],
      subtextbookScopes: [{ name: "부교재", publisher: "B", scope: "3단원" }],
      legacyFlag: "keep",
    })}`,
  });
  const calendarEvent = adaptAcademicEventDetailToCalendarEvent(detail);
  assert.equal(calendarEvent.textbookScope, "본교재 10~20쪽");
  assert.equal(calendarEvent.subtextbookScope, "부교재 3단원");
  const formScopes = buildAcademicEventFormScopeFields(calendarEvent, {});
  const result = buildAcademicEventMutationPayload({
    title: calendarEvent.title,
    type: calendarEvent.typeLabel,
    start: "2026-11-20",
    end: "2026-11-20",
    grade: calendarEvent.grade,
    schoolId: calendarEvent.schoolId,
    note: buildAcademicEventNote(calendarEvent.note, calendarEvent.embeddedNoteMeta),
    ...formScopes,
  }, [{ id: calendarEvent.schoolId, name: "검증고", category: "high" }]);
  assert.equal(result.isValid, true);
  assert.deepEqual(formScopes, {
    textbookScope: "본교재 10~20쪽",
    subtextbookScope: "부교재 3단원",
    textbookScopes: [{ name: "본교재", publisher: "A", scope: "10~20쪽" }],
    subtextbookScopes: [{ name: "부교재", publisher: "B", scope: "3단원" }],
  });
  assert.equal(calendarEvent.embeddedNoteMeta.legacyFlag, "keep");
  assert.deepEqual(extractAcademicEventNoteMetadata(result.payload.note), {
    textbookScope: "본교재 10~20쪽",
    subtextbookScope: "부교재 3단원",
    textbookScopes: [{ name: "본교재", publisher: "A", scope: "10~20쪽" }],
    subtextbookScopes: [{ name: "부교재", publisher: "B", scope: "3단원" }],
    legacyFlag: "keep",
  });
});

test("actual form output preserves existing scopes when the selected type hides scope inputs", async () => {
  assert.equal(typeof buildAcademicEventFormOutputScopeFields, "function");
  const formData = {
    typeLabel: "시험기간",
    textbookScope: "숨은 본교재 20~40쪽",
    subtextbookScope: "숨은 부교재 4단원",
    textbookScopes: [{ name: "본교재", publisher: "A", scope: "20~40쪽" }],
    subtextbookScopes: [{ name: "부교재", publisher: "B", scope: "4단원" }],
  };
  const outputScopes = buildAcademicEventFormOutputScopeFields(formData);
  assert.deepEqual(outputScopes, {
    textbookScope: "숨은 본교재 20~40쪽",
    subtextbookScope: "숨은 부교재 4단원",
    textbookScopes: [{ name: "본교재", publisher: "A", scope: "20~40쪽" }],
    subtextbookScopes: [{ name: "부교재", publisher: "B", scope: "4단원" }],
  });
  const payload = buildAcademicEventMutationPayload({
    title: "시험기간",
    type: formData.typeLabel,
    start: "2026-11-20",
    end: "2026-11-20",
    grade: "고1",
    schoolId: "42000000-0000-4000-8000-000000000042",
    note: buildAcademicEventNote("메모", { legacyFlag: "keep" }),
    ...outputScopes,
  }, [{ id: "42000000-0000-4000-8000-000000000042", name: "검증고", category: "high" }]);
  assert.equal(payload.isValid, true);
  assert.deepEqual(extractAcademicEventNoteMetadata(payload.payload.note), {
    legacyFlag: "keep",
    textbookScope: "숨은 본교재 20~40쪽",
    subtextbookScope: "숨은 부교재 4단원",
    textbookScopes: [{ name: "본교재", publisher: "A", scope: "20~40쪽" }],
    subtextbookScopes: [{ name: "부교재", publisher: "B", scope: "4단원" }],
  });
  const eventFormSource = await readFile(
    new URL("src/app/admin/calendar/components/event-form.tsx", root),
    "utf8",
  );
  assert.match(eventFormSource, /const scopeFieldsForSave = buildAcademicEventFormOutputScopeFields\(formData\)/);
  assert.match(eventFormSource, /\.\.\.scopeFieldsForSave/);
  assert.doesNotMatch(eventFormSource, /textbookScope: showScopeFields \?/);
  assert.doesNotMatch(eventFormSource, /textbookScopes: showScopeFields \?/);
});

test("academic detail request guard rejects stale revisions and stale identities", () => {
  assert.equal(typeof isCurrentAcademicDetailRequest, "function");
  assert.equal(isCurrentAcademicDetailRequest({
    expectedRevision: 4,
    currentRevision: 4,
    expectedIdentity: "event-b",
    currentIdentity: "event-b",
  }), true);
  assert.equal(isCurrentAcademicDetailRequest({
    expectedRevision: 3,
    currentRevision: 4,
    expectedIdentity: "event-a",
    currentIdentity: "event-b",
  }), false);
  assert.equal(isCurrentAcademicDetailRequest({
    expectedRevision: 4,
    currentRevision: 4,
    expectedIdentity: "event-a",
    currentIdentity: "event-b",
  }), false);
});

test("legacy exact event detail infers its renderer exam term from the parent title", () => {
  assert.equal(typeof inferAcademicExamTerm, "function");
  assert.equal(inferAcademicExamTerm("1학기 기말고사", "2026-06-20"), "1학기 기말");
  assert.equal(inferAcademicExamTerm("2학기 중간평가", "2026-10-05"), "2학기 중간");
  assert.equal(normalizeAcademicEventDetail({ title: "중간고사", startsAt: "2026-09-20", storedNote: "메모" }).examTerm, "2학기 중간");
});

test("derived annual entries resolve and edit their parent event instead of the detail row id", () => {
  assert.equal(typeof resolveAnnualBoardEntryParentId, "function");
  assert.equal(resolveAnnualBoardEntryParentId({
    id: "exam-detail:41000000-0000-4000-8000-000000000001",
    parentEventId: "42000000-0000-4000-8000-000000000001",
    sourceKind: "academic_event_exam_detail",
  }), "42000000-0000-4000-8000-000000000001");
});

test("selected class lesson design hydrates exact legacy plan, textbooks, and catalogs", async () => {
  assert.equal(typeof buildClassLessonDesignRow, "function");
  const calls = [];
  const classId = "50000000-0000-4000-8000-000000000002";
  const legacyPlan = { revision: 7, sessions: [{ id: "legacy-session", date: "2026-08-20" }] };
  const exact = {
    classItem: {
      id: classId,
      name: "오프페이지 수업",
      subject: "수학",
      schedulePlan: legacyPlan,
      textbookIds: ["51000000-0000-4000-8000-000000000001"],
    },
    textbooks: [{ id: "51000000-0000-4000-8000-000000000001", title: "정확한 교재" }],
    teacherCatalogs: [{ id: "52000000-0000-4000-8000-000000000001", name: "김교사" }],
    classroomCatalogs: [{ id: "53000000-0000-4000-8000-000000000001", name: "1강의실" }],
  };
  const service = createOperationsReadService({
    supabase: makeClient({ get_operations_class_lesson_design_detail_v1: { data: exact, error: null } }, calls),
    actorScope: "user-class:admin",
  });

  const detail = await service.loadClassLessonDesignDetail(classId);
  const row = buildClassLessonDesignRow(detail);
  assert.deepEqual(row.raw.classItem.schedulePlan, legacyPlan);
  assert.deepEqual(detail.textbooks, exact.textbooks);
  assert.deepEqual(detail.teacherCatalogs, exact.teacherCatalogs);
  assert.deepEqual(detail.classroomCatalogs, exact.classroomCatalogs);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_")), [[
    "get_operations_class_lesson_design_detail_v1",
    { p_class_id: classId },
  ]]);
});

test("lesson textbook picker searches a separate bounded candidate page without replacing connected legacy books", async () => {
  const calls = [];
  const classId = "50000000-0000-4000-8000-000000000002";
  const candidateId = "51000000-0000-4000-8000-000000000099";
  const service = createOperationsReadService({
    supabase: makeClient({
      get_operations_lesson_textbook_candidate_page_v1: {
        data: { rows: [{ id: candidateId, title: "검색 후보", subject: "수학" }], hasMore: false },
        error: null,
      },
    }, calls),
    actorScope: "user-candidate:admin",
  });
  const page = await service.loadLessonTextbookCandidates({ classId, search: "검색", cursor: null });
  assert.equal(page.rows[0].id, candidateId);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_")), [[
    "get_operations_lesson_textbook_candidate_page_v1",
    { p_class_id: classId, p_search: "검색", p_cursor_title: null, p_cursor_id: null, p_limit: 30 },
  ]]);
  assert.deepEqual(calls.filter(([name]) => name === "retry").map(([, value]) => value), [false]);
});

test("class lesson-design deep links use exact detail even when the class is outside page one", () => {
  assert.equal(typeof resolveRequestedClassRow, "function");
  const requestedId = "50000000-0000-4000-8000-000000000099";
  const exactRow = { id: requestedId, title: "정확한 오프페이지 수업", raw: { classItem: { id: requestedId } } };
  assert.equal(resolveRequestedClassRow({
    requestedClassId: requestedId,
    pageRows: [{ id: "50000000-0000-4000-8000-000000000001" }],
    exactRow,
  }), exactRow);
});

test("a stale continuation response cannot append after the request scope changes", () => {
  assert.equal(typeof appendOperationsPageIfCurrent, "function");
  const current = { page: { rows: [{ id: "class-1" }], hasMore: true } };
  const next = { page: { rows: [{ id: "class-2" }], hasMore: false } };
  assert.equal(appendOperationsPageIfCurrent({
    current,
    next,
    expectedRevision: 3,
    currentRevision: 4,
    expectedFingerprint: "scope-a",
    currentFingerprint: "scope-b",
  }), current);
  assert.deepEqual(appendOperationsPageIfCurrent({
    current,
    next,
    expectedRevision: 4,
    currentRevision: 4,
    expectedFingerprint: "scope-b",
    currentFingerprint: "scope-b",
  }).page.rows, [{ id: "class-1" }, { id: "class-2" }]);
});

test("dense calendar recovery produces exactly seven rendered day keys", () => {
  assert.equal(typeof buildSevenDayRangeKeys, "function");
  assert.deepEqual(buildSevenDayRangeKeys("2026-08-10"), [
    "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16",
  ]);
});

test("small operations catalogs are cached for thirty minutes within actor role scope", async () => {
  const calls = [];
  let now = 1_000;
  const service = createOperationsReadService({
    supabase: makeClient({
      list_operations_catalogs_v1: { data: { teachers: [], classrooms: [], subjects: [] }, error: null },
    }, calls),
    actorScope: "user-1:admin",
    now: () => now,
  });

  await service.loadCatalogs();
  now += 29 * 60 * 1_000;
  await service.loadCatalogs();
  assert.equal(calls.filter(([name]) => name === "list_operations_catalogs_v1").length, 1);
  now += 61 * 1_000;
  await service.loadCatalogs();
  assert.equal(calls.filter(([name]) => name === "list_operations_catalogs_v1").length, 2);
});

test("operations migration enforces invoker ACLs, range density, annual density, bounded paging, and exact detail", async () => {
  const sql = await readFile(new URL("supabase/migrations/20260814035710_operations_scoped_reads.sql", root), "utf8");

  for (const name of [
    "get_operations_calendar_range_v1",
    "get_operations_annual_board_v1",
    "get_operations_class_schedule_page_v1",
    "get_academic_event_detail_v1",
    "get_operations_class_lesson_design_detail_v1",
    "get_operations_lesson_textbook_candidate_page_v1",
    "list_operations_catalogs_v1",
  ]) {
    assert.match(sql, new RegExp(`create function public\\.${name}\\s*\\(`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public, anon`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /security\s+definer/i);
  assert.match(sql, /security\s+invoker/i);
  assert.match(sql, /set\s+search_path\s*=\s*''/i);
  assert.match(sql, /p_date_to\s*-\s*p_date_from\s*>\s*41/i);
  assert.match(sql, /visible_range_too_dense/i);
  assert.match(sql, /annual_board_too_dense/i);
  assert.match(sql, /400\s*\*\s*1024/i);
  assert.match(sql, /p_limit\s*\+\s*1/i);
  assert.match(sql, /p_limit\s*=\s*30/i);
  assert.match(sql, /extract_academic_event_meta_v1/i);
  assert.match(sql, /parentEventId/i);
  assert.match(sql, /exam-detail:/i);
  assert.match(sql, /'examTerm'/i);
  assert.match(sql, /regexp_split_to_table[\s\S]*grade/i);
  assert.match(sql, /pg_catalog\.coalesce\(grouped\.school_id::text, pg_catalog\.md5\(grouped\.school_name\)\) \|\| ':' \|\| grouped\.grade/);
  assert.match(sql, /storedNote/i);
  assert.match(sql, /get_operations_class_lesson_design_detail_v1/i);
  assert.match(sql, /get_operations_lesson_textbook_candidate_page_v1/i);
  assert.match(sql, /term_source_title/i);
  const classListBody = sql.match(/create function public\.get_operations_class_schedule_page_v1[\s\S]*?\n\$function\$;/i)?.[0] || "";
  assert.doesNotMatch(classListBody, /schedule_plan/i);
});

test("operations workspaces issue mode requests and expose dense-range recovery without the legacy fan-out", async () => {
  const [hook, calendar, annual, schedule] = await Promise.all([
    readFile(new URL("src/features/operations/use-operations-workspace-data.ts", root), "utf8"),
    readFile(new URL("src/features/operations/academic-calendar-workspace.tsx", root), "utf8"),
    readFile(new URL("src/features/operations/academic-annual-board-workspace.tsx", root), "utf8"),
    readFile(new URL("src/features/operations/class-schedule-workspace.tsx", root), "utf8"),
  ]);

  assert.match(hook, /useOperationsWorkspaceData\(request:\s*OperationsWorkspaceRequest\)/);
  assert.doesNotMatch(hook, /readTable|Promise\.all\(\[|\.select\("\*"\)/);
  assert.match(calendar, /mode:\s*"calendar"/);
  assert.match(calendar, /visible_range_too_dense/);
  assert.match(calendar, /한 주 보기/);
  assert.match(calendar, /operations-seven-day-agenda/);
  assert.match(annual, /mode:\s*"annual"/);
  assert.match(annual, /annual_board_too_dense/);
  assert.match(annual, /resolveAnnualBoardEntryParentId/);
  assert.match(schedule, /mode:\s*"class_schedule"/);
  assert.match(schedule, /다음 30건/);
  assert.match(schedule, /loadClassLessonDesignDetail/);
  assert.match(schedule, /loadLessonTextbookCandidates/);
  assert.match(schedule, /lessonTextbookCandidatePage/);
  assert.match(schedule, /isLessonDesignRouteActive\s*&&/);
  assert.doesNotMatch(schedule, /data\.classes\.filter/);
});
