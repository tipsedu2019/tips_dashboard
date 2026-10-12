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
    }, undefined, async () => ({ data: { entity: { id, status } }, error: null }));
    const draft = structuredClone(record);
    await assert.rejects(f.service.updateClass(draft));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(draft, record);
    // Re-query through the actual read service. The draft and the transport
    // failure cannot establish whether the synthetic server committed.
    const readService = createManagementReadService({ supabase: f.client });
    const current = await readService.loadDetail({ kind: "classes", id });
    assert.equal(current.entity.status, committed ? "종강" : "수강");
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
