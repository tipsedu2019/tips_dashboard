import test from "node:test";
import assert from "node:assert/strict";
import { createManagementNumberedReadService, normalizeManagementNumberedSort } from "../src/features/management/management-numbered-service.ts";

const filters = {
  students: { kind: "students", search: "검색", status: null, schoolCategory: null, school: null, grade: null },
  classes: { kind: "classes", search: "검색", status: "수강", periodId: "period-2", subject: "영어", grade: null, teacher: null, classroom: null },
  textbooks: { kind: "textbooks", search: "검색", status: null, subject: null, publisher: null },
};
const student = {
  kind: "students", id: "91000000-0000-4000-8000-000000000101", name: "학생 101", grade: "중2", school: "관리중",
  contact: null, parentContact: "01012345678", status: "재원", sortKey: "학생 101", updatedAt: "2026-08-31T00:00:00+00:00",
};
const classRow = {
  kind: "classes", id: "92000000-0000-4000-8000-000000000101", name: "수업 101", subject: "영어", grade: "중2",
  schedule: "월 18:00", teacherName: "교사", classroom: "1강", capacity: 12, weeklyMinutes: null, fee: 320000,
  status: "수강", studentCount: 7, sortKey: "수업 101", updatedAt: "2026-08-31T00:00:00+00:00",
};
const textbook = {
  kind: "textbooks", id: "93000000-0000-4000-8000-000000000101", title: "교재 101", subject: "영어", publisher: "출판사",
  status: "active", price: 15000, activeClassCount: 3, sortKey: "교재 101", updatedAt: "2026-08-31T00:00:00+00:00",
};

// Only the network boundary is doubled: the production service must produce this exact
// RPC contract and parse real DTOs. Any table/cursor/metadata/default-period call fails.
function transport(expected, response, inspectSignal = () => {}) {
  let calls = 0;
  return {
    client: {
      rpc(name, args) {
        assert.equal(++calls, 1, "one direct request, never intermediate/cursor reads");
        assert.equal(name, "list_management_numbered_page_v1");
        assert.deepEqual(args, expected);
        return {
          abortSignal(signal) {
            assert.ok(signal instanceof AbortSignal);
            inspectSignal(signal);
            return { retry(value) { assert.equal(value, false); return Promise.resolve(response); } };
          },
        };
      },
    },
    assertCalled() { assert.equal(calls, 1); },
  };
}
function request(kind = "students", overrides = {}) {
  return { kind, filters: filters[kind], page: 11, pageSize: 10, sort: [], ...overrides };
}
function rpcArgs(req) {
  return { p_kind: req.kind, p_filters: req.filters, p_page: req.page, p_page_size: req.pageSize, p_sort: req.sort };
}

for (const [kind, row] of [["students", student], ["classes", classRow], ["textbooks", textbook]]) {
  test(`${kind}: jumps directly to page 11, preserves DTO and full total`, async () => {
    const req = request(kind, { sort: [{ id: "status", desc: true }, { id: "title", desc: false }] });
    const result = { rows: [row], page: 11, pageSize: 10, totalCount: 101 };
    const wire = transport(rpcArgs(req), { data: result, error: null });
    assert.deepEqual(await createManagementNumberedReadService({ supabase: wire.client }).readPage(req), result);
    wire.assertCalled();
  });
}

test("out-of-range page preserves requested page and full-filter count", async () => {
  const req = request("classes", { page: 2147483647, pageSize: 20 });
  const result = { rows: [], page: 2147483647, pageSize: 20, totalCount: 101 };
  const wire = transport(rpcArgs(req), { data: result, error: null });
  assert.deepEqual(await createManagementNumberedReadService({ supabase: wire.client }).readPage(req), result);
  wire.assertCalled();
});

test("zero results and all allowed sizes are accepted without inventing pages", async () => {
  for (const pageSize of [10, 15, 20]) {
    const req = request("students", { page: 1, pageSize });
    const result = { rows: [], page: 1, pageSize, totalCount: 0 };
    const wire = transport(rpcArgs(req), { data: result, error: null });
    assert.deepEqual(await createManagementNumberedReadService({ supabase: wire.client }).readPage(req), result);
  }
});

test("request composes caller cancellation with the eight-second deadline", async (t) => {
  const caller = new AbortController();
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 8000); return deadline.signal; });
  let sentSignal;
  const req = request("students", { signal: caller.signal });
  const wire = transport(rpcArgs(req), { data: { rows: [student], page: 11, pageSize: 10, totalCount: 101 }, error: null }, (signal) => { sentSignal = signal; });
  await createManagementNumberedReadService({ supabase: wire.client }).readPage(req);
  caller.abort();
  assert.equal(sentSignal.aborted, true);
  assert.equal(deadline.signal.aborted, false);

  const req2 = request("students");
  const wire2 = transport(rpcArgs(req2), { data: { rows: [student], page: 11, pageSize: 10, totalCount: 101 }, error: null }, (signal) => { sentSignal = signal; });
  await createManagementNumberedReadService({ supabase: wire2.client }).readPage(req2);
  deadline.abort(new DOMException("Timed out", "TimeoutError"));
  assert.equal(sentSignal.reason.name, "TimeoutError");
});

test("an already cancelled request makes no RPC", async () => {
  const controller = new AbortController();
  controller.abort();
  const service = createManagementNumberedReadService({ supabase: { rpc: assert.fail } });
  await assert.rejects(service.readPage(request("students", { signal: controller.signal })), { name: "AbortError" });
});

test("invalid page, size, filters and sort are rejected before network access", async () => {
  const service = createManagementNumberedReadService({ supabase: { rpc: assert.fail } });
  const invalid = [
    { page: 0 }, { page: -1 }, { page: 1.2 }, { page: "11" }, { page: 2147483648 }, { page: NaN },
    { pageSize: 5 }, { pageSize: 30 }, { pageSize: "10" }, { kind: "other" },
    { filters: {} }, { filters: { ...filters.students, extra: null } }, { filters: { ...filters.students, search: null } },
    { filters: { ...filters.students, grade: 2 } }, { filters: filters.classes },
    { sort: null }, { sort: {} }, { sort: [{ id: "title", desc: "asc" }] },
    { sort: [{ id: "title", desc: false, extra: 1 }] }, { sort: [{ id: "teacher", desc: false }] },
    { sort: [{ id: "title", desc: false }, { id: "title", desc: true }] },
    { sort: [{ id: "title", desc: false }, { id: "school", desc: true }, { id: "grade", desc: false }] },
  ];
  for (const overrides of invalid) await assert.rejects(service.readPage(request("students", overrides)), { code: "management_numbered_request_invalid" });
  for (const id of ["enrollmentStatus", "weeklyHours", "select", "action", "metaSummary"]) {
    await assert.rejects(service.readPage(request("classes", { sort: [{ id, desc: false }] })), { code: "management_numbered_request_invalid" });
  }
});

test("all supported actionable headers can request global server sorting", async () => {
  for (const [kind, columns] of [
    ["students", ["title", "status", "school", "grade", "contact", "parentContact"]],
    ["classes", ["title", "status", "subject", "grade", "schedule", "teacher", "classroom", "capacity", "tuition"]],
    ["textbooks", ["title", "status", "subject", "publisher", "price", "updatedAt"]],
  ]) {
    for (const id of columns) {
      const req = request(kind, { sort: [{ id, desc: true }], page: 1 });
      const wire = transport(rpcArgs(req), { data: { rows: [], page: 1, pageSize: 10, totalCount: 0 }, error: null });
      assert.equal((await createManagementNumberedReadService({ supabase: wire.client }).readPage(req)).totalCount, 0);
    }
  }
});

test("malformed or scope-mismatched responses fail instead of returning empty success", async () => {
  const valid = { rows: [student], page: 11, pageSize: 10, totalCount: 101 };
  const malformed = [null, [], {}, { ...valid, rows: null }, { ...valid, page: 10 }, { ...valid, pageSize: 15 },
    { ...valid, totalCount: "101" }, { ...valid, totalCount: -1 }, { ...valid, totalCount: 101.5 },
    { ...valid, totalCount: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, rows: [] },
    { ...valid, rows: [classRow] }, { ...valid, rows: [{ ...student, id: "" }] },
    { ...valid, rows: [{ ...student, contact: 123 }] }, { ...valid, rows: [{ ...student, name: undefined }] },
    { ...valid, rows: [{ ...student, sortKey: undefined }] },
    { ...valid, rows: [student, student], totalCount: 102 },
    { ...valid, rows: Array(11).fill(student), totalCount: 111 },
  ];
  for (const data of malformed) {
    const req = request();
    const wire = transport(rpcArgs(req), { data, error: null });
    await assert.rejects(createManagementNumberedReadService({ supabase: wire.client }).readPage(req), { code: "management_numbered_response_invalid" });
  }
  for (const row of [{ ...classRow, studentCount: -1 }, { ...classRow, capacity: "12" }, { ...textbook, price: "15000" }, { ...textbook, activeClassCount: null }]) {
    const req = request(row.kind);
    const wire = transport(rpcArgs(req), { data: { ...valid, rows: [row] }, error: null });
    await assert.rejects(createManagementNumberedReadService({ supabase: wire.client }).readPage(req), { code: "management_numbered_response_invalid" });
  }
});

test("missing numbered RPC is explicit and never falls back to cursor reads", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const req = request();
    const wire = transport(rpcArgs(req), { data: null, error: { code, message: "function missing" } });
    await assert.rejects(createManagementNumberedReadService({ supabase: wire.client }).readPage(req), { code: "management_numbered_rpc_unavailable" });
    wire.assertCalled();
  }
});

test("other database failures are propagated without retry or partial success", async () => {
  const failure = { code: "42501", message: "permission denied" };
  const req = request();
  const wire = transport(rpcArgs(req), { data: null, error: failure });
  await assert.rejects(createManagementNumberedReadService({ supabase: wire.client }).readPage(req), (error) => error === failure);
  wire.assertCalled();
});

test("persisted unsupported sorts normalize before request, retaining valid primary/secondary order", () => {
  assert.deepEqual(normalizeManagementNumberedSort("classes", [{ id: "enrollmentStatus", desc: true }, { id: "weeklyHours", desc: false }]), []);
  assert.deepEqual(normalizeManagementNumberedSort("students", [
    { id: "teacher", desc: false }, { id: "grade", desc: true }, { id: "grade", desc: false }, { id: "title", desc: false }, { id: "school", desc: true },
  ]), [{ id: "grade", desc: true }, { id: "title", desc: false }]);
  assert.deepEqual(normalizeManagementNumberedSort("textbooks", null), []);
  assert.deepEqual(normalizeManagementNumberedSort("textbooks", [{ id: "price", desc: "true" }]), []);
});
