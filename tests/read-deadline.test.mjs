import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { withReadDeadline } from "../src/lib/read-deadline.ts";
import { createManagementReadService } from "../src/features/management/management-service.js";
import { createManagementNumberedReadService } from "../src/features/management/management-numbered-service.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const expired = () => new DOMException("Synthetic deadline", "TimeoutError");
function deadline(t) {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", ms => { assert.equal(ms, 8000); return controller.signal; });
  return controller;
}

test("whole read settles at its deadline even if token provider never resolves", async () => {
  let calls = 0;
  const client = createClient("https://fixture.invalid", "fixture-only", {
    accessToken: () => new Promise(() => {}),
    global: { fetch: async () => { calls++; assert.fail("token acquisition must still be pending"); } },
  });
  const started = performance.now();
  // Keep this synthetic test process alive; AbortSignal.timeout timers are unref'ed in Node.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(withReadDeadline(signal => client.from("teacher_catalogs").select("id").limit(30)
      .abortSignal(signal).retry(false), { timeoutMs: 25 }), { code: "read_operation_timeout" });
    assert.ok(performance.now() - started < 800);
    assert.equal(calls, 0);
  } finally { clearTimeout(keepAlive); }
});

test("caller cancellation settles an auth-blocked read without waiting for its deadline", async () => {
  const caller = new AbortController();
  let readSignal;
  const pending = withReadDeadline(signal => { readSignal = signal; return new Promise(() => {}); }, { signal: caller.signal });
  await tick();
  const rejection = assert.rejects(pending, { name: "AbortError" });
  caller.abort();
  await rejection;
  assert.equal(readSignal.aborted, true);
  await assert.rejects(withReadDeadline(() => assert.fail("must not start"), { signal: caller.signal }), { name: "AbortError" });
});

test("errors abort sibling reads and a late rejection is handled without retry", async () => {
  let signal, calls = 0;
  const late = Promise.withResolvers();
  const failure = new Error("synthetic unavailable");
  await assert.rejects(withReadDeadline(value => {
    signal = value; calls++;
    return Promise.all([Promise.reject(failure), late.promise]);
  }), error => error === failure);
  assert.equal(signal.aborted, true);
  late.reject(new Error("late failure"));
  await tick();
  assert.equal(calls, 1);
});

for (const operation of ["catalogs", "numbered", "detail", "relations", "textbook candidates", "legacy page"]) {
  test(`${operation}: actual SDK token wait times out, then expired requests do no transport work`, async t => {
    const timer = deadline(t), token = Promise.withResolvers();
    let attempts = 0, transportWork = 0;
    const client = createClient("https://fixture.invalid", "fixture-only", {
      accessToken: () => token.promise,
      global: { fetch: async (_url, init) => {
        attempts++;
        init.signal.throwIfAborted(); // Native fetch also rejects before dispatch for an aborted signal.
        transportWork++;
        return new Response("[]", { headers: { "content-type": "application/json" } });
      } },
    });
    const service = createManagementReadService({ supabase: client });
    const filters = { kind: "classes", search: "", status: "수강", periodId: "period", subject: null, grade: null, teacher: null, classroom: null };
    const pending = operation === "catalogs" ? service.loadClassFormReferences()
      : operation === "numbered" ? createManagementNumberedReadService({ supabase: client }).readPage({ kind: "classes", filters, page: 1, pageSize: 10, sort: [] })
      : operation === "detail" ? service.loadDetail({ kind: "classes", id: "class" })
      : operation === "relations" ? service.loadRelationPage({ kind: "classes", id: "class", relationKind: "registered_students" })
      : operation === "textbook candidates" ? service.searchClassTextbookCandidates({ classId: "class" })
      : service.loadPage({ kind: "classes", filters, limit: 10 });
    await tick();
    // Digest-based cursor checks finish before triggering the synthetic eight-second deadline.
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(attempts, 0);
    const rejection = assert.rejects(pending, { code: "read_operation_timeout" });
    timer.abort(expired());
    await rejection;
    token.resolve("fixture-token");
    await tick(); await tick();
    assert.equal(transportWork, 0, "late auth completion must never reach network work");
    assert.equal(attempts, ["catalogs", "legacy page"].includes(operation) ? 3 : 1, "initial reads only; no retry or extra catalog pages");
  });
}

test("late non-cooperative catalog response cannot paginate or replace a fresh result", async t => {
  const timer = deadline(t), late = Promise.withResolvers();
  let calls = 0;
  const client = {
    from() {
      calls++;
      const query = { select() { return this; }, eq() { return this; }, range() { return this; }, limit() { return this; }, order() { return this; }, abortSignal() { return this; }, retry() { return this; }, then(resolve, reject) { return late.promise.then(resolve, reject); } };
      return query;
    },
    rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: [] }); } }; },
  };
  const pending = createManagementReadService({ supabase: client }).loadClassFormReferences();
  await tick();
  const rejection = assert.rejects(pending, { code: "read_operation_timeout" });
  timer.abort(expired()); await rejection;
  late.resolve({ data: Array.from({ length: 30 }, (_, i) => ({ id: `late-${i}` })) });
  await tick();
  assert.equal(calls, 2, "no follow-up pages after timeout even if transport ignores abort");
});


test("a deadline that expires before read startup yields the same safe error and starts no read", async () => {
  const timer = new AbortController(); timer.abort(expired());
  await assert.rejects(withReadDeadline(() => assert.fail("must not start"), { deadline: timer.signal }), { code: "read_operation_timeout" });
});

test("synchronous read failure is preserved without an unhandled cancellation rejection", async () => {
  const error = new Error("synchronous validation failure");
  await assert.rejects(withReadDeadline(() => { throw error; }), value => value === error);
  await tick();
});
