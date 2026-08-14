import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const academicReadModule = await import(
  new URL("../src/features/academic/academic-read-service.js", import.meta.url),
).catch(() => ({}));

const createAcademicReadService = academicReadModule.createAcademicReadService;
const appendAcademicCurriculumPageIfCurrent = academicReadModule.appendAcademicCurriculumPageIfCurrent;
const isAcademicContinuationLoadingForScope = academicReadModule.isAcademicContinuationLoadingForScope;
const selectAcademicDisplayRequest = academicReadModule.selectAcademicDisplayRequest;
const getCurriculumDesignAction = academicReadModule.getCurriculumDesignAction;
const isAcademicResultCurrentForScope = academicReadModule.isAcademicResultCurrentForScope;
const createAcademicExecutionContext = academicReadModule.createAcademicExecutionContext;
const selectAcademicScopedValue = academicReadModule.selectAcademicScopedValue;

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
              range: { dateFrom: "2026-08-03", dateTo: "2026-08-16" },
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
    range: { dateFrom: "2026-08-03", dateTo: "2026-08-16" },
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

test("every timetable density result is bound to the requested visible range", async () => {
  const service = createAcademicReadService({
    supabase: makeClient({
      get_academic_timetable_range_v1: {
        data: {
          ok: false,
          code: "timetable_collection_too_dense",
          collection: "class_groups",
          observedItemsAtLeast: 501,
          action: "narrow_filters",
          rows: [],
        },
        error: null,
      },
    }, []),
    actorScope: "actor-a:admin",
  });
  await assert.rejects(service.load({
    mode: "timetable",
    dateFrom: "2026-08-03",
    dateTo: "2026-08-09",
    filters: { classGroupId: null, status: null, subject: null },
  }), (error) => error?.code === "academic_timetable_response_invalid");
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

test("curriculum cursor scope is actor-bound before any database continuation", async () => {
  const calls = [];
  const row = {
    id: "41000000-0000-4000-8000-000000000001",
    sort_key: "수업 1",
    row_data: { id: "41000000-0000-4000-8000-000000000001" },
  };
  const response = { data: { rows: Array.from({ length: 31 }, () => row), stats: {}, filterOptions: {} }, error: null };
  const client = makeClient({ get_academic_curriculum_page_v1: response }, calls);
  const request = {
    mode: "curriculum",
    periodId: null,
    search: "",
    status: null,
    subject: null,
    grade: null,
    teacher: null,
    classroom: null,
    viewMode: "all",
    cursor: null,
  };
  const first = await createAcademicReadService({ supabase: client, actorScope: "actor-a:admin" }).load(request);

  await assert.rejects(
    createAcademicReadService({ supabase: client, actorScope: "actor-b:admin" }).load({
      ...request,
      cursor: first.page.nextCursor,
    }),
    (error) => error?.code === "academic_cursor_mismatch",
  );
  assert.equal(calls.filter(([name]) => name === "get_academic_curriculum_page_v1").length, 1);
});

test("curriculum continuation reuses first-page stats and facets without requesting recomputation", async () => {
  const calls = [];
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: `42000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sort_key: `수업 ${String(index + 1).padStart(2, "0")}`,
    row_data: { id: `42000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` },
  }));
  const client = makeClient({
    get_academic_curriculum_page_v1: ({ p_cursor_id: cursorId }) => ({
      data: cursorId
        ? { rows: [], stats: null, filterOptions: null }
        : { rows, stats: { total: 31 }, filterOptions: { subjects: ["수학"] } },
      error: null,
    }),
  }, calls);
  const service = createAcademicReadService({ supabase: client, actorScope: "actor-a:admin" });
  const request = {
    mode: "curriculum",
    periodId: null,
    search: "",
    status: null,
    subject: null,
    grade: null,
    teacher: null,
    classroom: null,
    viewMode: "all",
    cursor: null,
  };
  const first = await service.load(request);
  const next = await service.load({ ...request, cursor: first.page.nextCursor });
  const rpcCalls = calls.filter(([name]) => name === "get_academic_curriculum_page_v1");

  assert.equal(rpcCalls[0][1].p_include_scope_metadata, true);
  assert.equal(rpcCalls[1][1].p_include_scope_metadata, false);
  assert.deepEqual(next.stats, first.stats);
  assert.deepEqual(next.filterOptions, first.filterOptions);
  assert.deepEqual(appendAcademicCurriculumPageIfCurrent({
    current: first,
    next: { ...next, stats: { total: 999 }, filterOptions: { subjects: ["영어"] } },
    expectedRevision: 1,
    currentRevision: 1,
    expectedFingerprint: "same",
    currentFingerprint: "same",
  }).stats, first.stats);
});

test("null-period first page canonicalizes the resolved default before continuation", async () => {
  const calls = [];
  const resolvedPeriodId = "43000000-0000-4000-8000-000000000001";
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: `43000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    sort_key: `수업 ${index}`,
    row_data: { id: `43000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}` },
  }));
  const service = createAcademicReadService({
    supabase: makeClient({
      get_academic_curriculum_page_v1: ({ p_cursor_id: cursorId }) => ({
        data: cursorId
          ? { rows: [], stats: null, filterOptions: null, resolvedPeriodId }
          : { rows, stats: { total: 31 }, filterOptions: {}, resolvedPeriodId },
        error: null,
      }),
    }, calls),
    actorScope: "actor-a:admin",
  });
  const request = {
    mode: "curriculum", periodId: null, search: "", status: null, subject: null,
    grade: null, teacher: null, classroom: null, viewMode: "all", cursor: null,
  };
  const first = await service.load(request);
  assert.equal(first.page.nextCursor.resolvedPeriodId, resolvedPeriodId);
  await service.load({ ...request, cursor: first.page.nextCursor });
  const rpcCalls = calls.filter(([name]) => name === "get_academic_curriculum_page_v1");
  assert.equal(rpcCalls[1][1].p_filters.periodId, resolvedPeriodId);
  await assert.rejects(
    service.load({
      ...request,
      periodId: "43000000-0000-4000-8000-000000000002",
      cursor: first.page.nextCursor,
    }),
    (error) => error?.code === "academic_cursor_mismatch",
  );
  assert.equal(calls.filter(([name]) => name === "get_academic_curriculum_page_v1").length, 2);
});

test("continuation loading and last-good display are synchronously bound to the active scope", () => {
  assert.equal(typeof isAcademicContinuationLoadingForScope, "function");
  assert.equal(typeof selectAcademicDisplayRequest, "function");
  assert.equal(isAcademicContinuationLoadingForScope("scope-a", "scope-a"), true);
  assert.equal(isAcademicContinuationLoadingForScope("scope-a", "scope-b"), false);
  const successfulRequest = { mode: "timetable", filters: { subject: "수학" } };
  const failedRequest = { mode: "timetable", filters: { subject: "영어" } };
  assert.equal(selectAcademicDisplayRequest({
    data: { rows: [{ id: "old" }] },
    successfulRequest,
    currentRequest: failedRequest,
  }), successfulRequest);
  assert.equal(selectAcademicDisplayRequest({
    data: null,
    successfulRequest,
    currentRequest: failedRequest,
  }), failedRequest);
});

test("curriculum CTA prioritizes missing sessions while textbook counts remain independent", () => {
  assert.equal(typeof getCurriculumDesignAction, "function");
  assert.deepEqual(getCurriculumDesignAction({ textbookCount: 0, totalSessions: 0 }), {
    label: "일정", tab: "schedule", sectionId: "lesson-design-periods", sessionId: "", reason: "회차 생성 필요",
  });
  assert.equal(getCurriculumDesignAction({ textbookCount: 0, totalSessions: 2 }).reason, "교재 연결 필요");
});

test("current-scope rendering requires data and display fingerprints to both match", () => {
  assert.equal(typeof isAcademicResultCurrentForScope, "function");
  assert.equal(isAcademicResultCurrentForScope("scope-a", "scope-a", "scope-a"), true);
  assert.equal(isAcademicResultCurrentForScope("scope-a", "scope-b", "scope-a"), false);
  assert.equal(isAcademicResultCurrentForScope("scope-a", "scope-a", "scope-b"), false);
});

test("authenticated user and resolved dashboard role isolate every academic execution state", () => {
  assert.equal(typeof createAcademicExecutionContext, "function");
  assert.equal(typeof selectAcademicScopedValue, "function");
  const request = {
    mode: "timetable",
    dateFrom: "2026-08-03",
    dateTo: "2026-08-09",
    filters: { classGroupId: null, status: "수강", subject: null },
  };
  const userAAdmin = createAcademicExecutionContext({ userId: "user-a", role: "admin", request });
  const userAStaff = createAcademicExecutionContext({ userId: "user-a", role: "staff", request });
  const userBAdmin = createAcademicExecutionContext({ userId: "user-b", role: "admin", request });
  const previousData = { rows: [{ id: "user-a-row" }] };
  const previousDensity = { code: "visible_range_too_dense" };

  assert.notEqual(userAAdmin.actorScope, userAStaff.actorScope);
  assert.notEqual(userAAdmin.actorScope, userBAdmin.actorScope);
  assert.notEqual(userAAdmin.fingerprint, userAStaff.fingerprint);
  assert.notEqual(userAAdmin.fingerprint, userBAdmin.fingerprint);
  assert.equal(selectAcademicScopedValue(previousData, userAAdmin.actorScope, userAAdmin.actorScope), previousData);
  assert.equal(selectAcademicScopedValue(previousData, userAAdmin.actorScope, userBAdmin.actorScope), null);
  assert.equal(selectAcademicScopedValue(previousData, userAAdmin.actorScope, userAStaff.actorScope), null);
  assert.equal(selectAcademicScopedValue(previousDensity, userAAdmin.fingerprint, userBAdmin.fingerprint), null);
  assert.equal(isAcademicContinuationLoadingForScope(userAAdmin.fingerprint, userAStaff.fingerprint), false);
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

test("academic SQL filters candidates before aggregates and keeps continuation metadata optional", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260814062437_academic_scoped_reads.sql", import.meta.url),
    "utf8",
  );
  const curriculum = sql.slice(
    sql.indexOf("create function public.get_academic_curriculum_page_v1"),
    sql.indexOf("create function public.get_academic_curriculum_detail_v1"),
  );
  assert.ok(curriculum.indexOf("eligible_classes as materialized") < curriculum.indexOf("progress_agg as materialized"));
  assert.match(curriculum, /p_include_scope_metadata boolean default true/i);
  assert.match(curriculum, /case when p_include_scope_metadata then[\s\S]+from stats/i);
  assert.match(curriculum, /case when p_include_scope_metadata then[\s\S]+from filter_options/i);
  assert.doesNotMatch(curriculum, /from public\.progress_logs log group by log\.class_id/i);
  assert.doesNotMatch(curriculum, /from public\.class_lesson_sessions session group by session\.class_id/i);
});

test("academic SQL resolves defaults once and uses canonical classroom and work-state semantics", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260814062437_academic_scoped_reads.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /order by group_row\.is_default desc[\s\S]+limit 1/i);
  assert.match(sql, /v_class_group_id/i);
  assert.match(sql, /academic_classroom_name_v1\(pg_catalog\.btrim\(token\)\)[\s\S]+academic_classroom_name_v1\(pg_catalog\.btrim\(v_filters ->> 'classroom'\)\)/i);
  assert.match(sql, /when base\.session_count = 0 then '회차 미생성'[\s\S]+when base\.textbook_count = 0 then '교재 미연결'/i);
  assert.match(sql, /when base\.session_count = 0 then 'unscheduled'[\s\S]+when base\.textbook_count = 0 then 'unlinked'/i);
  assert.match(sql, /'unlinkedClassCount', pg_catalog\.count\(\*\) filter \(where textbook_count=0\)/i);
});

test("academic SQL returns the earliest exact unplanned session and an explicit detail class projection", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260814062437_academic_scoped_reads.sql", import.meta.url),
    "utf8",
  );
  const detail = sql.slice(
    sql.indexOf("create function public.get_academic_curriculum_detail_v1"),
    sql.indexOf("revoke all on function dashboard_private"),
  );
  assert.match(sql, /next_unplanned as materialized/i);
  assert.match(sql, /'sessionId',\s*next_session_id/i);
  assert.match(sql, /not exists \([\s\S]+from public\.progress_logs/i);
  assert.match(sql, /log\.progress_key in \(session\.id::text, session\.session_key\)/i);
  assert.doesNotMatch(detail, /to_jsonb\(class\)/i);
  assert.match(detail, /jsonb_build_object\([\s\S]+'id',\s*class\.id[\s\S]+'scheduleRevision',\s*class\.schedule_revision/i);
  assert.doesNotMatch(detail, /student_ids|waitlist_ids|schedule_plan|lessons|fee|capacity/i);
});

test("timetable support collections project only explicit scalar fields", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260814062437_academic_scoped_reads.sql", import.meta.url),
    "utf8",
  );
  const timetable = sql.slice(
    sql.indexOf("create function public.get_academic_timetable_range_v1"),
    sql.indexOf("create function public.get_academic_curriculum_page_v1"),
  );
  assert.doesNotMatch(timetable, /\bto_jsonb\s*\(/i);
  assert.match(timetable, /class_summary_limited as materialized \([\s\S]*?'id',\s*class\.id[\s\S]*?'subject',\s*class\.subject[\s\S]*?'grade',\s*class\.grade[\s\S]*?'term_id',\s*class\.term_id[\s\S]*?'period',\s*class\.period[\s\S]*?'academic_year',\s*class\.academic_year/i);
  assert.match(timetable, /'id',\s*group_row\.id[\s\S]*?'name',\s*group_row\.name[\s\S]*?'subject',\s*group_row\.subject[\s\S]*?'sort_order',\s*group_row\.sort_order[\s\S]*?'is_default',\s*group_row\.is_default/i);
  assert.match(timetable, /'group_id',\s*member\.group_id[\s\S]*?'class_id',\s*member\.class_id[\s\S]*?'sort_order',\s*member\.sort_order/i);
  assert.match(timetable, /'name',\s*catalog\.name[\s\S]*?'subjects',\s*catalog\.subjects[\s\S]*?'is_visible',\s*catalog\.is_visible[\s\S]*?'sort_order',\s*catalog\.sort_order/i);
});
