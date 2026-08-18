import assert from "node:assert/strict";
import test from "node:test";

const supplementModule = await import("../src/features/tasks/ops-task-page-supplement.ts")
  .catch(() => ({}));

test("registration runtime supplement settles without waiting for slow stats", async () => {
  assert.equal(typeof supplementModule.startOpsTaskPageSupplementLoad, "function");

  const pendingStats = new Promise(() => {});
  const loads = supplementModule.startOpsTaskPageSupplementLoad({
    loadStats: () => pendingStats,
    loadRegistrationRuntime: async () => ({ mode: "ready" }),
  });

  const runtime = await Promise.race([
    loads.registrationRuntime,
    new Promise((resolve) => setTimeout(() => resolve("runtime-blocked-by-stats"), 25)),
  ]);

  assert.deepEqual(runtime, { mode: "ready" });
});

test("optional supplement failures normalize independently", async () => {
  assert.equal(typeof supplementModule.startOpsTaskPageSupplementLoad, "function");

  const loads = supplementModule.startOpsTaskPageSupplementLoad({
    loadStats: async () => { throw new Error("stats unavailable"); },
    loadRegistrationRuntime: async () => { throw new Error("runtime unavailable"); },
  });

  assert.equal(await loads.stats, undefined);
  assert.equal(await loads.registrationRuntime, null);
});

test("late supplements merge one field without discarding the rendered page", () => {
  assert.equal(typeof supplementModule.mergeOpsTaskPageSupplement, "function");

  const rendered = {
    tasks: [{ id: "task-a" }],
    stats: undefined,
    registrationRuntime: null,
  };
  const withStats = supplementModule.mergeOpsTaskPageSupplement(rendered, {
    stats: { total: 1 },
  });
  const withRuntime = supplementModule.mergeOpsTaskPageSupplement(withStats, {
    registrationRuntime: { mode: "ready", version: 1 },
  });

  assert.deepEqual(withRuntime, {
    tasks: [{ id: "task-a" }],
    stats: { total: 1 },
    registrationRuntime: { mode: "ready", version: 1 },
  });
});
