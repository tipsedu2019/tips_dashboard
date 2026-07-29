import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTINUOUS_CLASS_SCHEDULE_RPC,
  createBoundedContinuousScheduleReader,
  createContinuousScheduleMutationAction,
  mapContinuousScheduleRpcError,
} from "../src/features/academic/continuous-class-schedule-service.ts";

const CLASS_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "30000000-0000-4000-8000-000000000001";

test("a retry reuses the action request key and its canonical defaults payload", async () => {
  const calls = [];
  let attempts = 0;
  const action = createContinuousScheduleMutationAction({
    createRequestKey: () => REQUEST_KEY,
    async rpc(name, parameters) {
      calls.push({ name, parameters: structuredClone(parameters) });
      attempts += 1;
      if (attempts === 1) throw new TypeError("network disconnected");
      return { data: { changed: true }, error: null };
    },
  });
  const input = {
    classId: CLASS_ID,
    expectedScheduleRevision: 4,
    slots: [{
      id: null,
      weekday: 2,
      startTime: "14:00",
      endTime: "15:30",
      teacherCatalogId: null,
      classroomCatalogId: null,
      sortOrder: 0,
    }],
    reason: null,
  };

  await assert.rejects(action.saveDefaults(input), /network disconnected/);
  assert.deepEqual(await action.saveDefaults(input), { changed: true });
  assert.equal(action.requestKey, REQUEST_KEY);
  assert.deepEqual(calls, [
    {
      name: CONTINUOUS_CLASS_SCHEDULE_RPC.saveDefaults,
      parameters: {
        p_class_id: CLASS_ID,
        p_expected_schedule_revision: 4,
        p_slots: input.slots,
        p_request_key: REQUEST_KEY,
        p_reason: null,
      },
    },
    {
      name: CONTINUOUS_CLASS_SCHEDULE_RPC.saveDefaults,
      parameters: {
        p_class_id: CLASS_ID,
        p_expected_schedule_revision: 4,
        p_slots: input.slots,
        p_request_key: REQUEST_KEY,
        p_reason: null,
      },
    },
  ]);
});

test("RPC errors are mapped to safe schedule action states", () => {
  for (const [error, expected] of [
    [{ code: "40001", message: "class_schedule_stale" }, "stale"],
    [{ code: "42501", message: "class_schedule_forbidden" }, "forbidden"],
    [{ code: "P0001", message: "continuous_class_schedule_runtime_not_ready" }, "not_ready"],
    [{ code: "22023", message: "idempotency_key_reused" }, "idempotency"],
    [{ code: "23514", message: "slot_invalid" }, "validation"],
  ]) {
    assert.equal(mapContinuousScheduleRpcError(error).kind, expected);
  }
});

test("generation preview sends only the bounded range and revision", async () => {
  const calls = [];
  const action = createContinuousScheduleMutationAction({
    createRequestKey: () => "70000000-0000-4000-8000-000000000003",
    async rpc(name, args) { calls.push([name, args]); return { data: { creatableCount: 2 }, error: null }; },
  });
  assert.deepEqual(await action.previewGeneration({
    classId: CLASS_ID, expectedScheduleRevision: 4, dateFrom: "2026-08-01", dateTo: "2026-08-31",
  }), { creatableCount: 2 });
  assert.deepEqual(calls, [["preview_class_lesson_session_generation_v1", {
    p_class_id: CLASS_ID, p_expected_schedule_revision: 4, p_date_from: "2026-08-01", p_date_to: "2026-08-31",
  }]]);
});

test("bounded reader deduplicates one range, aborts a prior class, and trusts the RPC authority result", async () => {
  const calls = [];
  let firstSignal;
  let resolveFirst;
  const firstRead = new Promise((resolve) => { resolveFirst = resolve; });
  const reader = createBoundedContinuousScheduleReader({
    runtimeProbe: { async probe() { return { mode: "ready", version: 1 }; }, reset() {} },
    async readSchedule(input, signal) {
      calls.push({ input, signal });
      if (input.classId === CLASS_ID) {
        firstSignal = signal;
        return firstRead;
      }
      return { authoritativeSource: "legacy", runtimeVersion: 0 };
    },
    async loadLegacy(input) {
      return { source: "legacy", classId: input.classId, sessions: [] };
    },
  });

  const first = reader.load({ classId: CLASS_ID, dateFrom: "2026-04-01", dateTo: "2026-04-30" });
  assert.strictEqual(first, reader.load({ classId: CLASS_ID, dateFrom: "2026-04-01", dateTo: "2026-04-30" }));
  await new Promise((resolve) => queueMicrotask(resolve));
  const second = reader.load({
    classId: "10000000-0000-4000-8000-000000000002",
    dateFrom: "2026-04-01",
    dateTo: "2026-04-30",
  });
  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(await second, {
    source: "legacy",
    classId: "10000000-0000-4000-8000-000000000002",
    sessions: [],
  });

  resolveFirst({ authoritativeSource: "normalized", runtimeVersion: 1, sessions: [{ id: "session-1" }] });
  assert.deepEqual(await first, {
    source: "normalized",
    data: { authoritativeSource: "normalized", runtimeVersion: 1, sessions: [{ id: "session-1" }] },
  });
  assert.equal(calls.length, 2);
});

test("runtime-not-ready reloads legacy while other normalized read failures stay explicit", async () => {
  let resets = 0;
  const legacy = async (input) => ({ source: "legacy", classId: input.classId, sessions: [] });
  const notReady = createBoundedContinuousScheduleReader({
    runtimeProbe: { async probe() { return { mode: "ready", version: 1 }; }, reset() { resets += 1; } },
    async readSchedule() { throw { code: "P0001", message: "continuous_class_schedule_runtime_not_ready" }; },
    loadLegacy: legacy,
  });
  assert.deepEqual(await notReady.load({ classId: CLASS_ID, dateFrom: "2026-04-01", dateTo: "2026-04-30" }), {
    source: "legacy", classId: CLASS_ID, sessions: [],
  });
  assert.equal(resets, 1);

  const failed = createBoundedContinuousScheduleReader({
    runtimeProbe: { async probe() { return { mode: "ready", version: 1 }; }, reset() {} },
    async readSchedule() { throw { code: "XX000", message: "database failed" }; },
    loadLegacy: legacy,
  });
  const result = await failed.load({ classId: CLASS_ID, dateFrom: "2026-04-01", dateTo: "2026-04-30" });
  assert.deepEqual(result, { source: "error", error: { code: "XX000", message: "database failed" } });

  await assert.rejects(
    failed.load({ classId: "not-a-uuid", dateFrom: "2026-04-01", dateTo: "2027-05-01" }),
    /class id and a date range/i,
  );
});
