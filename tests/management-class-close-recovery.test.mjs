import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createManagementService, createManagementReadService } from "../src/features/management/management-service.js";
import { timetableOperationalErrorMessage } from "../src/features/academic/timetable-operational-service.ts";

const id = "10000000-0000-4000-8000-000000000201";
const record = { id, name: "합성 종강 수업", subject: "수학", status: "종강" };
const receipt = { classRow: { id, status: "종강" }, closeResult: { id, classId: id, status: "종강" } };
const uncertain = "저장 결과를 확인하지 못했습니다. 입력은 유지되었으니 다시 저장해 주세요.";
function fixture(run, refresh = async () => ({ status: "ready" }), read) {
  const calls = [];
  const reads = [];
  let generated = 0;
  const client = { rpc(name, args) {
      const isRead = name === "get_management_detail_v1";
      (isRead ? reads : calls).push({ name, args: structuredClone(args) });
      return {
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
        retry(enabled) { assert.equal(enabled, false); return this; },
        then(resolve, reject) { return Promise.resolve().then(() => isRead ? read(args) : run(args)).then(resolve, reject); },
      };
    } };
  const service = createManagementService({
    supabase: client,
    generateId: () => `20000000-0000-4000-8000-${String(++generated).padStart(12, "0")}`,
    probeRegistrationRuntime: async () => ({ mode: "ready" }),
    refreshPublicClassesCache: refresh,
  });
  return { service, client, calls, reads, generated: () => generated };
}

test("종강 rejects missing or mismatched receipts and retains the original retry key", async () => {
  for (const bad of [null, {}, [], { classRow: { id, status: "종강" } },
    { ...receipt, closeResult: { ...receipt.closeResult, id: "other" } },
    { ...receipt, closeResult: { ...receipt.closeResult, classId: "other" } },
    { ...receipt, closeResult: { ...receipt.closeResult, status: "수강" } },
    { ...receipt, classRow: { ...receipt.classRow, id: "other" } },
    { ...receipt, classRow: { ...receipt.classRow, status: "수강" } }]) {
    let first = true;
    let refreshed = 0;
    const f = fixture(() => ({ data: first ? (first = false, bad) : receipt, error: null }),
      async () => { refreshed++; });
    await assert.rejects(f.service.updateClass(record), error => {
      assert.equal(timetableOperationalErrorMessage(error, "fallback"), uncertain);
      return error.code === "CLASS_OPERATIONAL_RECEIPT_INVALID";
    });
    assert.equal(refreshed, 0);
    await f.service.updateClass(record);
    assert.equal(f.generated(), 1);
    assert.deepEqual(f.calls[0], f.calls[1]);
  }
});

test("종강 distinguishes committed response loss from database failure using a read, with no automatic write retry", async () => {
  for (const committed of [false, true]) {
    let status = "수강";
    let first = true;
    const f = fixture(() => {
      if (first) {
        first = false;
        if (committed) status = "종강";
        return { data: null, error: { name: "TimeoutError", message: "TimeoutError: response lost" } };
      }
      status = "종강";
      return { data: receipt, error: null };
    }, undefined, async () => ({ data: { kind: "classes", record: { id, status } }, error: null }));
    const draft = structuredClone(record);
    await assert.rejects(f.service.updateClass(draft));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(draft, record);
    // Re-query through the actual read service. The draft and the transport
    // failure cannot establish whether the synthetic server committed.
    const readService = createManagementReadService({ supabase: f.client });
    const current = await readService.loadDetail({ kind: "classes", id });
    assert.equal(current.record.status, committed ? "종강" : "수강");
    assert.deepEqual(f.reads, [{ name: "get_management_detail_v1", args: { p_kind: "classes", p_id: id } }]);
    assert.equal(f.calls.length, 1);
    await f.service.updateClass(draft);
    assert.deepEqual(f.calls[0], f.calls[1]);
    assert.equal(f.generated(), 1);
  }
});

test("the installed Supabase transport turns the unchanged 8-second abort into an uncertain save", async () => {
  const originalTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  const deadlines = [];
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  let requests = 0;
  AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds); return controller.signal; };
  try {
    const client = createClient("https://synthetic.invalid", "synthetic-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (_url, { signal }) => {
        requests++;
        started();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      } },
    });
    const service = createManagementService({ supabase: client,
      probeRegistrationRuntime: async () => ({ mode: "ready" }),
      refreshPublicClassesCache: async () => { assert.fail("unverified close refreshed"); } });
    const saving = service.updateClass(record);
    const rejected = assert.rejects(saving, error => {
      assert.equal(timetableOperationalErrorMessage(error, "fallback"), uncertain);
      return /^TimeoutError:/.test(error.message);
    });
    await requestStarted;
    controller.abort(new DOMException("response deadline expired", "TimeoutError"));
    await rejected;
    assert.deepEqual(deadlines, [8000]);
    assert.equal(requests, 1);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test("종강 SQLSTATE 57014 and transport cancellation preserve input and never refresh or retry automatically", async () => {
  for (const error of [{ code: "57014", message: "canceling statement due to statement timeout" },
    { code: "57014", message: "canceling statement due to user request" },
    { name: "AbortError", message: "AbortError: transport cancelled" }]) {
    const f = fixture(() => ({ data: null, error }), async () => { assert.fail("failed save refreshed"); });
    const draft = structuredClone(record);
    await assert.rejects(f.service.updateClass(draft), value => value === error);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(draft, record);
  }
});

test("a verified close receipt survives post-commit refresh failure", async () => {
  const f = fixture(() => ({ data: receipt, error: null }), async () => { throw new Error("refresh lost"); });
  const result = await f.service.updateClass(record);
  assert.equal(result.status, "종강");
  assert.equal(result.publicClassesCacheRefresh.status, "pending");
  assert.equal(f.calls.length, 1);
});

// Mirror the actual get_management_detail_v1 producer (record, camelCase fields,
// top-level visible roster counts/pages), including non-empty metadata.
const fullRecord = { id, name: "확인 합성 수업", classType: "정규", subject: "수학", grade: "고3",
  teacher: "합성 교사", schedule: "금 17:00-19:00", classroom: "본관 2강", capacity: 12, fee: 100,
  status: "종강", textbook_ids: ["book-1"], textbook_usage: { "book-1": { startDate: "2026-10-01", endDate: "2026-10-31", title: "합성 교재" } } };
const emptyPage = () => ({ rows: [], hasMore: false, nextCursor: null });
const closedDetail = () => ({ kind: "classes", record: {
  id, name: "확인 합성 수업", classType: "정규", subject: "수학", subjectAreaKey: null, grade: "고3",
  teacher: "합성 교사", schedule: "금 17:00-19:00", classroom: "본관 2강", capacity: 12, fee: 100,
  status: "종강", textbookIds: ["book-1"], textbookUsage: { "book-1": { startDate: "2026-10-01", endDate: "2026-10-31", title: "합성 교재" } },
}, registeredCount: 0, waitlistCount: 0, registeredStudents: emptyPage(), waitlistedStudents: emptyPage() });
const confirmOptions = () => ({ confirmCloseResult: { isCurrent: () => true } });
const lostResponse = { code: "", message: "TimeoutError: response lost" };

import { matchesClosedClassDetail, isUncertainClassWrite } from "../src/features/management/class-close-confirmation.ts";

test("committed close with lost response confirms actual producer state without a second write or invented receipt", async () => {
  let checking = 0;
  let cacheRefreshes = 0;
  const f = fixture(() => ({ error: lostResponse }), async () => { cacheRefreshes++; },
    () => ({ data: closedDetail() }));
  const result = await f.service.updateClass(fullRecord, { confirmCloseResult: { isCurrent: () => true, onChecking: () => checking++ } });
  assert.deepEqual(result, { id, status: "종강", closeConfirmation: "current-state", publicClassesCacheRefresh: { status: "complete" } });
  assert.equal(cacheRefreshes, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(checking, 1);
  assert.equal(Object.hasOwn(result, "closeResult"), false);
  assert.equal(Object.hasOwn(result, "removedStudentCount"), false);
});

test("confirmation strictly compares every transmitted patch field and the visible roster producer contract", async () => {
  const f = fixture(() => ({ error: lostResponse }), undefined, () => ({ data: closedDetail() }));
  await f.service.updateClass(fullRecord, confirmOptions());
  const patch = f.calls[0].args.p_patch;
  const mapping = { name: "name", class_type: "classType", subject: "subject", subject_area_key: "subjectAreaKey",
    grade: "grade", teacher: "teacher", schedule: "schedule", room: "classroom", capacity: "capacity", fee: "fee",
    status: "status", textbook_ids: "textbookIds", textbook_usage: "textbookUsage" };
  assert.deepEqual(Object.keys(patch).sort(), Object.keys(mapping).sort());
  for (const field of Object.values(mapping)) {
    const missing = closedDetail();
    delete missing.record[field];
    assert.equal(matchesClosedClassDetail(missing, id, patch), false, `${field} missing`);
    for (const wrong of [null, "different", 999, [], {}]) {
      if (JSON.stringify(wrong) === JSON.stringify(closedDetail().record[field])) continue;
      const detail = closedDetail(); detail.record[field] = wrong;
      assert.equal(matchesClosedClassDetail(detail, id, patch), false, `${field} mismatch`);
    }
  }
  for (const change of [d => { d.record.id = "other"; }, d => { delete d.kind; },
    d => { d.entity = d.record; delete d.record; }, d => { delete d.registeredCount; },
    d => { d.registeredCount = 1; }, d => { d.waitlistCount = 1; },
    d => { d.registeredStudents.rows = [{ id: "visible-student" }]; },
    d => { d.waitlistedStudents.hasMore = true; }, d => { delete d.waitlistedStudents.nextCursor; }]) {
    const detail = closedDetail(); change(detail);
    assert.equal(matchesClosedClassDetail(detail, id, patch), false);
  }
  assert.equal(matchesClosedClassDetail(closedDetail(), id, { ...patch, unrecognized: 1 }), false);
  const typed = closedDetail(); typed.record.capacity = "12";
  assert.equal(matchesClosedClassDetail(typed, id, patch), false);
});

test("an uncertain close can be checked repeatedly after delayed commit with zero write resubmissions", async () => {
  let current = closedDetail(); current.record.status = "수강";
  let readFails = false;
  const f = fixture(() => ({ error: lostResponse }), undefined, () => {
    if (readFails) throw new Error("read unavailable");
    return { data: current };
  });
  let pending;
  await assert.rejects(f.service.updateClass(fullRecord, confirmOptions()), error => {
    pending = error; return error.code === "CLASS_CLOSE_RESULT_UNCERTAIN";
  });
  readFails = true;
  await assert.rejects(pending.confirm(), { code: "CLASS_CLOSE_RESULT_UNCERTAIN" });
  readFails = false;
  current = closedDetail();
  assert.equal((await pending.confirm()).closeConfirmation, "current-state");
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 3);
  assert.deepEqual(fullRecord.textbook_ids, ["book-1"]);
});

test("receipt uncertainty confirms current state but explicit DB and preflight failures never start confirmation", async () => {
  const f = fixture(() => ({ data: null }), undefined, () => ({ data: closedDetail() }));
  assert.equal((await f.service.updateClass(fullRecord, confirmOptions())).closeConfirmation, "current-state");
  for (const code of ["57014", "23P01", "42501", "PGRST301"]) {
    const error = { code, name: "TimeoutError", message: "rejected" };
    const failed = fixture(() => ({ error }), undefined, () => assert.fail("explicit rejection read"));
    await assert.rejects(failed.service.updateClass(fullRecord, confirmOptions()), value => value === error);
    assert.equal(failed.reads.length, 0);
  }
  const preflight = fixture(() => ({ error: lostResponse }), undefined, () => assert.fail("preflight read"));
  await assert.rejects(preflight.service.updateClass(fullRecord, { ...confirmOptions(), resolveScheduleOwnership: true }), value => value === lostResponse);
  assert.deepEqual(preflight.calls.map(call => call.name), ["get_class_schedule_defaults_v1"]);
  assert.equal(preflight.reads.length, 0);
  for (const error of [{ message: "TypeError: Failed to fetch", code: "" }, { name: "AbortError" }, { message: "TypeError: Load failed" }]) {
    assert.equal(isUncertainClassWrite(error), true);
  }
});

test("confirmation obeys the original owner before and after its bounded fresh read", async () => {
  for (const invalidateBefore of [true, false]) {
    let active = true;
    let resolveRead;
    const f = fixture(() => { if (invalidateBefore) active = false; return { error: lostResponse }; }, undefined,
      () => new Promise(resolve => { resolveRead = resolve; }));
    const saving = f.service.updateClass(fullRecord, { confirmCloseResult: { isCurrent: () => active } });
    const rejected = assert.rejects(saving, { code: "CLASS_CLOSE_RESULT_UNCERTAIN" });
    if (!invalidateBefore) {
      while (!resolveRead) await new Promise(resolve => setImmediate(resolve));
      active = false;
      resolveRead({ data: closedDetail() });
    }
    await rejected;
    assert.equal(f.reads.length, invalidateBefore ? 0 : 1);
    assert.equal(f.calls.length, 1);
  }
});

test("installed transport uses separate bounded 8-second write and confirmation reads without retry", async () => {
  const originalTimeout = AbortSignal.timeout;
  const writeController = new AbortController();
  const readController = new AbortController();
  const deadlines = [];
  const requests = [];
  const started = Promise.withResolvers();
  AbortSignal.timeout = milliseconds => {
    deadlines.push(milliseconds);
    return deadlines.length === 1 ? writeController.signal : readController.signal;
  };
  try {
    const client = createClient("https://synthetic.invalid", "synthetic-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (url, { signal }) => {
        requests.push(new URL(url).pathname);
        if (requests.length === 1) {
          started.resolve();
          return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
        }
        return new Response(JSON.stringify(closedDetail()), { status: 200, headers: { "content-type": "application/json" } });
      } },
    });
    const service = createManagementService({ supabase: client,
      probeRegistrationRuntime: async () => ({ mode: "ready" }),
      refreshPublicClassesCache: async () => ({ status: "refreshed" }) });
    const saving = service.updateClass(fullRecord, confirmOptions());
    await started.promise;
    writeController.abort(new DOMException("response lost", "TimeoutError"));
    assert.equal((await saving).closeConfirmation, "current-state");
    assert.deepEqual(requests, ["/rest/v1/rpc/update_class_operational_v1", "/rest/v1/rpc/get_management_detail_v1"]);
    assert.deepEqual(deadlines, [8000, 8000]);
  } finally { AbortSignal.timeout = originalTimeout; }
});

test("normalized ownership compares exactly the transmitted metadata, without inventing legacy schedule changes", async () => {
  const detail = closedDetail();
  detail.record.teacher = "projection"; detail.record.schedule = "projection"; detail.record.classroom = "projection";
  const f = fixture(() => ({ error: lostResponse }), undefined, () => ({ data: detail }));
  assert.equal((await f.service.updateClass(fullRecord, { ...confirmOptions(), scheduleOwnership: "normalized" })).closeConfirmation, "current-state");
  for (const key of ["teacher", "schedule", "room"]) assert.equal(Object.hasOwn(f.calls[0].args.p_patch, key), false);
});

test("both automatic and manual confirmation retire only their successful intent key", async () => {
  for (const manual of [false, true]) {
    let matches = !manual;
    const f = fixture(() => ({ error: lostResponse }), undefined, () => {
      const detail = closedDetail(); if (!matches) detail.record.status = "수강";
      return { data: detail };
    });
    if (manual) {
      let pending;
      await assert.rejects(f.service.updateClass(fullRecord, confirmOptions()), error => { pending = error; return true; });
      await assert.rejects(pending.confirm(), { code: "CLASS_CLOSE_RESULT_UNCERTAIN" });
      assert.equal(f.generated(), 1);
      assert.equal(f.calls.length, 1);
      matches = true;
      await pending.confirm();
    } else await f.service.updateClass(fullRecord, confirmOptions());
    await f.service.updateClass(fullRecord, confirmOptions());
    assert.equal(f.calls.length, 2);
    assert.notEqual(f.calls[0].args.p_request_key, f.calls[1].args.p_request_key);
  }
});

test("only confirmed state invalidates the public cache, and cache failure preserves confirmation", async () => {
  for (const mode of ["complete", "pending", "throws"]) {
    let closed = false;
    let invalidations = 0;
    const f = fixture(() => ({ error: lostResponse }), async () => {
      invalidations++;
      if (mode === "throws") throw new Error("cache unavailable");
      return { status: mode };
    }, () => { const detail = closedDetail(); if (!closed) detail.record.status = "수강"; return { data: detail }; });
    let pending;
    await assert.rejects(f.service.updateClass(fullRecord, confirmOptions()), error => { pending = error; return true; });
    assert.equal(invalidations, 0);
    await assert.rejects(pending.confirm(), { code: "CLASS_CLOSE_RESULT_UNCERTAIN" });
    assert.equal(invalidations, 0);
    closed = true;
    const result = await pending.confirm();
    assert.equal(result.closeConfirmation, "current-state");
    assert.equal(result.publicClassesCacheRefresh.status, mode === "complete" ? "complete" : "pending");
    assert.equal(invalidations, 1);
    assert.equal(f.calls.length, 1);
  }
});
