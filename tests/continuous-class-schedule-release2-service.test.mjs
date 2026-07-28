import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTINUOUS_CLASS_SCHEDULE_RPC,
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
