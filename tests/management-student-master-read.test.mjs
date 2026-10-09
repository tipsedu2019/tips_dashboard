import assert from "node:assert/strict";
import test from "node:test";

import { readStudentMasterRows } from "../src/features/management/management-service.js";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const SAFE_COLUMNS = [
  "id", "name", "uid", "school", "grade", "enroll_date", "status",
  "class_ids", "waitlist_class_ids", "created_at", "updated_at",
];
const uuid = (value) => `00000000-0000-0000-0000-${value.toString(16).padStart(12, "0")}`;
const student = (value) => ({
  id: uuid(value), name: `합성학생 ${value}`, uid: `S-${value}`,
  school: "합성학교", grade: "중1", enroll_date: "2026-09-01", status: "재원",
  class_ids: [], waitlist_class_ids: [], created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  contact: "synthetic-contact-canary", parent_contact: "synthetic-parent-canary",
  guardianPhone: "synthetic-guardian-canary", makeeduDetailId: "unexpected-detail-id",
});
const catalog = (count, start = 0) => Array.from({ length: count }, (_, index) => student(start + index));
const safeRecord = (row) => Object.fromEntries(SAFE_COLUMNS.map((key) => [key, row[key]]));

// Only the lazy transport is doubled. The real helper chooses each projection,
// cursor, bound, retry policy and publication result. No provider is contacted.
function transport({ rows = [], providerCap = 30, respond, beforeRead } = {}) {
  let currentRows = rows;
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        const call = { table, index: calls.length, executions: 0 };
        calls.push(call);
        const builder = {
          select(columns) { call.columns = columns; return builder; },
          filter(column, operator, value) { call.filter = { column, operator, value }; return builder; },
          order(column, options) { call.order = { column, options }; return builder; },
          limit(value) { call.limit = value; return builder; },
          abortSignal(signal) { call.signal = signal; return builder; },
          retry(value) { call.retry = value; return builder; },
          then(resolve, reject) {
            return Promise.resolve().then(async () => {
              assert.equal(++call.executions, 1, "one execution per page");
              assert.equal(call.table, "students");
              assert.equal(call.columns, SAFE_COLUMNS.join(","), "only contact-free fields are requested");
              assert.deepEqual(call.order, { column: "id", options: { ascending: true } });
              assert.equal(call.limit, 30, "each request stays bounded even if the provider caps it further");
              assert.equal(call.retry, false);
              assert.ok(call.signal instanceof AbortSignal);
              assert.equal(call.signal.aborted, false);
              assert.equal(call.filter?.column, "id");
              assert.equal(call.filter?.operator, call.index === 0 ? "gte" : "gt");
              if (call.index === 0) assert.equal(call.filter.value, ZERO_UUID);
              beforeRead?.(call, { replaceRows(value) { currentRows = value; }, rows: currentRows });
              if (respond) return respond(call);
              return {
                data: currentRows.filter((row) => call.filter.operator === "gte"
                  ? row.id >= call.filter.value : row.id > call.filter.value)
                  .slice(0, Math.min(call.limit, providerCap)),
                error: null,
              };
            }).then(resolve, reject);
          },
        };
        return builder;
      },
    },
  };
}

async function rejectsWithoutPublishing(promise, expected) {
  const published = [];
  await assert.rejects(promise.then((result) => { published.push(result); return result; }), expected);
  assert.deepEqual(published, [], "a rejected multi-page read never publishes an earlier partial catalog");
}

test("reads all 61 students, includes the zero UUID and publishes only contact-free projections", async (t) => {
  const deadline = new AbortController();
  const timeoutCalls = [];
  t.mock.method(AbortSignal, "timeout", (ms) => { timeoutCalls.push(ms); return deadline.signal; });
  const rows = catalog(61);
  const wire = transport({ rows });

  assert.deepEqual(await readStudentMasterRows(wire.client), rows.map(safeRecord));
  assert.deepEqual(timeoutCalls, [8_000], "all pages share one whole-read deadline");
  assert.deepEqual(wire.calls.map((call) => call.filter), [
    { column: "id", operator: "gte", value: ZERO_UUID },
    { column: "id", operator: "gt", value: uuid(29) },
    { column: "id", operator: "gt", value: uuid(59) },
    { column: "id", operator: "gt", value: uuid(60) },
  ]);
  assert.ok(wire.calls.every((call) => call.signal === wire.calls[0].signal));
  assert.equal(wire.calls[0].signal.aborted, false);
});

test("an empty catalog is accepted after one bounded request", async () => {
  const wire = transport();
  assert.deepEqual(await readStudentMasterRows(wire.client), []);
  assert.equal(wire.calls.length, 1);
});

test("short server pages are not mistaken for completion, including a provider cap of one", async () => {
  const rows = catalog(61);
  const wire = transport({ rows, providerCap: 1 });
  assert.deepEqual(await readStudentMasterRows(wire.client), rows.map(safeRecord));
  assert.equal(wire.calls.length, 62, "the read ends only after an empty response");
  assert.deepEqual(wire.calls.slice(1).map((call) => call.filter.value), rows.map((row) => row.id));
  assert.ok(wire.calls.every((call) => call.signal === wire.calls[0].signal));
});

test("deleting the previously read boundary does not skip the following students", async () => {
  const rows = catalog(61);
  const wire = transport({
    rows,
    beforeRead(call, state) {
      if (call.index === 1) state.replaceRows(state.rows.filter((row) => row.id !== call.filter.value));
    },
  });
  // The deleted row was observed on page one; this is a keyset scan, not a
  // transactional point-in-time snapshot. Every later observed row is retained.
  assert.deepEqual(await readStudentMasterRows(wire.client), rows.map(safeRecord));
  assert.equal(wire.calls[1].filter.value, uuid(29));
  assert.equal(wire.calls[2].filter.value, uuid(59));
});

for (const [name, secondPage] of [
  ["repeated boundary", [student(29), student(30)]],
  ["duplicate within a later page", [student(30), student(30)]],
  ["out-of-order later rows", [student(31), student(30)]],
  ["regression behind the boundary", [student(28), student(30)]],
]) {
  test(`${name} rejects the whole read instead of returning the first page`, async () => {
    const wire = transport({ respond: (call) => ({ data: call.index === 0 ? catalog(30) : secondPage, error: null }) });
    await rejectsWithoutPublishing(readStudentMasterRows(wire.client), { code: "student_master_page_changed" });
    assert.equal(wire.calls.length, 2);
    assert.ok(wire.calls.every((call) => call.signal.aborted), "failed reads cancel their shared transport signal");
  });
}

for (const id of ["not-a-uuid", 1, null, undefined, ` ${uuid(1)}`, `${uuid(1)}\n`, `${uuid(1)}\r`, uuid(10).toUpperCase()]) {
  test(`noncanonical or invalid UUID ${JSON.stringify(id)} fails closed before publication`, async () => {
    const wire = transport({ respond: () => ({ data: [{ ...student(1), id }], error: null }) });
    await rejectsWithoutPublishing(readStudentMasterRows(wire.client), { code: "student_master_page_invalid" });
    assert.equal(wire.calls.length, 1);
  });
}

for (const data of [null, {}, catalog(31)]) {
  test(`invalid response ${Array.isArray(data) ? "over the 30-row cap" : JSON.stringify(data)} rejects without publication`, async () => {
    const wire = transport({ respond: () => ({ data, error: null }) });
    await rejectsWithoutPublishing(readStudentMasterRows(wire.client), { code: "student_master_page_invalid" });
  });
}

test("a later provider failure rejects the read and preserves the original error", async () => {
  const failure = Object.assign(new Error("synthetic later-page failure"), { code: "synthetic_provider_failure" });
  const wire = transport({ respond: (call) => call.index === 0
    ? { data: catalog(30), error: null } : { data: null, error: failure } });
  await rejectsWithoutPublishing(readStudentMasterRows(wire.client), (error) => error === failure);
  assert.equal(wire.calls.length, 2);
  assert.ok(wire.calls.every((call) => call.signal.aborted));
});

test("the shared eight-second deadline settles a later lazy transport that never responds", async (t) => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 8_000); return deadline.signal; });
  const secondPageStarted = Promise.withResolvers();
  const wire = transport({ respond: (call) => {
    if (call.index === 0) return { data: catalog(30), error: null };
    secondPageStarted.resolve();
    return new Promise(() => {});
  } });
  const reading = readStudentMasterRows(wire.client);
  await secondPageStarted.promise;
  deadline.abort(new DOMException("synthetic deadline", "TimeoutError"));
  await rejectsWithoutPublishing(reading, { code: "read_operation_timeout" });
  assert.equal(wire.calls.length, 2);
  assert.ok(wire.calls.every((call) => call.signal.aborted));
});

test("an already expired deadline starts no transport", async (t) => {
  const deadline = new AbortController();
  deadline.abort(new DOMException("synthetic expired deadline", "TimeoutError"));
  t.mock.method(AbortSignal, "timeout", () => deadline.signal);
  const wire = transport();
  await rejectsWithoutPublishing(readStudentMasterRows(wire.client), { code: "read_operation_timeout" });
  assert.equal(wire.calls.length, 0);
});

test("deadline cancellation wins over a final empty page before publishing the completed catalog", async (t) => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => deadline.signal);
  const wire = transport({ respond: (call) => {
    if (call.index === 0) return { data: [student(0)], error: null };
    deadline.abort(new DOMException("synthetic final-page deadline", "TimeoutError"));
    return { data: [], error: null };
  } });
  await rejectsWithoutPublishing(readStudentMasterRows(wire.client), { code: "read_operation_timeout" });
  assert.equal(wire.calls.length, 2);
});
