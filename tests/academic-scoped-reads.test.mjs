import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const module = await import(
  new URL("../src/features/academic/academic-read-service.js", import.meta.url),
).catch(() => ({}));

const createAcademicReadService = module.createAcademicReadService;
const appendAcademicCurriculumPageIfCurrent = module.appendAcademicCurriculumPageIfCurrent;

function makeRpcBuilder(result, calls) {
  return {
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
      if (!response) throw new Error(`unexpected rpc ${name}`);
      return makeRpcBuilder(
        typeof response === "function" ? response(args) : response,
        calls,
      );
    },
  };
}

test("timetable mode performs one range RPC and never reads curriculum detail sources", async () => {
  assert.equal(typeof createAcademicReadService, "function");
  const calls = [];
  const rows = [{ id: "class-1:월:18:00:19:00", classId: "class-1", day: "월" }];
  const response = {
    ok: true,
    range: { dateFrom: "2026-08-03", dateTo: "2026-08-16" },
    rows,
    classSummaries: [{ id: "class-1", title: "고1 수학" }],
    classTerms: [],
    classGroups: [],
    classGroupMembers: [],
    teacherCatalogs: [],
    classroomCatalogs: [],
    statusOptions: ["수강"],
    subjectOptions: ["수학"],
    complete: true,
  };
  const service = createAcademicReadService({
    supabase: makeClient({ get_academic_timetable_range_v1: { data: response, error: null } }, calls),
    actorScope: "user-1:admin",
  });

  assert.deepEqual(await service.load({
    mode: "timetable",
    dateFrom: "2026-08-03",
    dateTo: "2026-08-16",
    filters: { classGroupId: null, status: "수강", subject: "수학" },
  }), response);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_") || name.startsWith("list_")), [[
    "get_academic_timetable_range_v1",
    {
      p_date_from: "2026-08-03",
      p_date_to: "2026-08-16",
      p_class_group_id: null,
      p_status: "수강",
      p_subject: "수학",
    },
  ]]);
  assert.equal(calls.some(([name]) => /curriculum|textbook|progress/i.test(name)), false);
  assert.equal(calls.filter(([name]) => name === "abortSignal").length, 1);
  assert.deepEqual(calls.filter(([name]) => name === "retry").map(([, value]) => value), [false]);
});

test("timetable density branches are all-or-nothing and distinguish row from collection pressure", async () => {
  const calls = [];
  const service = createAcademicReadService({
    supabase: makeClient({
      get_academic_timetable_range_v1: ({ p_subject: subject }) => ({
        data: subject === "수학"
          ? {
              ok: false,
              code: "visible_range_too_dense",
              range: { dateFrom: "2026-08-03", dateTo: "2026-08-16" },
              rows: [],
              observedRowsAtLeast: 2001,
              suggestedDays: 7,
            }
          : {
              ok: false,
              code: "timetable_collection_too_dense",
              collection: "class_group_members",
              observedItemsAtLeast: 501,
              action: "narrow_filters",
              rows: [],
            },
        error: null,
      }),
    }, calls),
    actorScope: "user-1:admin",
  });
  const base = {
    mode: "timetable",
    dateFrom: "2026-08-03",
    dateTo: "2026-08-16",
    filters: { classGroupId: null, status: "수강", subject: null },
  };

  assert.deepEqual((await service.load({ ...base, filters: { ...base.filters, subject: "수학" } })).rows, []);
  assert.deepEqual(await service.load({ ...base, filters: { ...base.filters, subject: "영어" } }), {
    ok: false,
    code: "timetable_collection_too_dense",
    collection: "class_group_members",
    observedItemsAtLeast: 501,
    action: "narrow_filters",
    rows: [],
  });
  await assert.rejects(
    service.load({ ...base, subject: "수학", dateTo: "2026-08-17" }),
    (error) => error?.code === "academic_range_invalid",
  );
});

test("curriculum mode applies every filter at the server and returns a 30 plus one keyset page", async () => {
  const calls = [];
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sort_key: `수업 ${String(index + 1).padStart(2, "0")}`,
    row_data: { id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, title: `수업 ${index + 1}` },
  }));
  const service = createAcademicReadService({
    supabase: makeClient({
      get_academic_curriculum_page_v1: {
        data: {
          rows,
          stats: { total: 31, totalSessions: 60, linkedTextbooks: 20 },
          filterOptions: { subjects: ["수학"], grades: ["고1"] },
        },
        error: null,
      },
    }, calls),
    actorScope: "user-1:admin",
  });
  const request = {
    mode: "curriculum",
    periodId: "20000000-0000-4000-8000-000000000001",
    search: "심화",
    status: "수강",
    subject: "수학",
    grade: "고1",
    teacher: "김교사",
    classroom: "본관 3강",
    viewMode: "update",
    cursor: null,
  };

  const result = await service.load(request);
  assert.equal(result.page.rows.length, 30);
  assert.equal(result.page.hasMore, true);
  assert.equal(result.stats.total, 31);
  assert.deepEqual(result.filterOptions.subjects, ["수학"]);
  const args = calls.find(([name]) => name === "get_academic_curriculum_page_v1")[1];
  assert.deepEqual(args.p_filters, {
    periodId: request.periodId,
    search: "심화",
    status: "수강",
    subject: "수학",
    grade: "고1",
    teacher: "김교사",
    classroom: "본관 3강",
    viewMode: "update",
  });
  assert.equal(args.p_limit, 30);
  assert.equal(args.p_cursor_sort_key, null);
  assert.equal(args.p_cursor_id, null);
  assert.equal(calls.some(([name]) => /detail|session/i.test(name)), false);

  await assert.rejects(
    service.load({ ...request, subject: "영어", cursor: result.page.nextCursor }),
    (error) => error?.code === "academic_cursor_mismatch",
  );
  assert.equal(calls.filter(([name]) => name === "get_academic_curriculum_page_v1").length, 1);
});

test("curriculum detail is selection-driven and exact while stale continuation is rejected", async () => {
  assert.equal(typeof appendAcademicCurriculumPageIfCurrent, "function");
  const calls = [];
  const classId = "30000000-0000-4000-8000-000000000001";
  const service = createAcademicReadService({
    supabase: makeClient({
      get_academic_curriculum_detail_v1: {
        data: { id: classId, scheduleRows: [], progressRows: [], textbookRows: [] },
        error: null,
      },
    }, calls),
    actorScope: "user-1:admin",
  });

  assert.equal(calls.length, 0);
  assert.equal((await service.loadCurriculumDetail(classId)).id, classId);
  assert.deepEqual(calls.filter(([name]) => name.startsWith("get_")), [[
    "get_academic_curriculum_detail_v1",
    { p_class_id: classId },
  ]]);
  assert.equal(appendAcademicCurriculumPageIfCurrent({
    current: { page: { rows: [{ id: "old" }] } },
    next: { page: { rows: [{ id: "new" }] } },
    expectedRevision: 1,
    currentRevision: 2,
    expectedFingerprint: "old",
    currentFingerprint: "new",
  }).page.rows.length, 1);
});

test("academic scoped migration is invoker-only, authenticated-only, bounded and explicit", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260814062437_academic_scoped_reads.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /get_academic_timetable_range_v1/i);
  assert.match(sql, /get_academic_curriculum_page_v1/i);
  assert.match(sql, /get_academic_curriculum_detail_v1/i);
  assert.match(sql, /security invoker/gi);
  assert.match(sql, /set search_path = ''/gi);
  assert.match(sql, /visible_range_too_dense/i);
  assert.match(sql, /timetable_collection_too_dense/i);
  assert.match(sql, /limit\s+2001/i);
  assert.match(sql, /limit\s+501/i);
  assert.match(sql, /p_limit\s*<>\s*30/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /service_role/i);
  assert.doesNotMatch(sql, /select\s+\*/i);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]+to authenticated/i);
});
