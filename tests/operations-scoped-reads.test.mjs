import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const serviceModule = await import(
  new URL("../src/features/operations/operations-read-service.js", import.meta.url),
).catch(() => ({}));

const createOperationsReadService = serviceModule.createOperationsReadService;

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
  assert.doesNotMatch(sql, /schedule_plan/i);
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
  assert.match(annual, /mode:\s*"annual"/);
  assert.match(annual, /annual_board_too_dense/);
  assert.match(schedule, /mode:\s*"class_schedule"/);
  assert.match(schedule, /다음 30건/);
  assert.doesNotMatch(schedule, /data\.classes\.filter/);
});
