import assert from "node:assert/strict";
import test from "node:test";

const statsCacheModule = await import("../src/features/tasks/ops-task-page-stats-cache.ts")
  .catch(() => ({}));

test("task-page stats cache reuses the same filter result for sixty seconds", async () => {
  assert.equal(typeof statsCacheModule.createOpsTaskPageStatsCache, "function");

  let now = 0;
  let loads = 0;
  const cache = statsCacheModule.createOpsTaskPageStatsCache({
    now: () => now,
    ttlMs: 60_000,
  });
  const loadStats = async () => {
    loads += 1;
    return { total: 7 };
  };

  assert.deepEqual(await cache.load("general:inbox", loadStats), { total: 7 });
  now = 59_999;
  assert.deepEqual(await cache.load("general:inbox", loadStats), { total: 7 });
  assert.equal(loads, 1);
});

test("task-page stats cache retries after an unavailable result", async () => {
  assert.equal(typeof statsCacheModule.createOpsTaskPageStatsCache, "function");

  let loads = 0;
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const loadStats = async () => {
    loads += 1;
    return loads === 1 ? undefined : { total: 3 };
  };

  assert.equal(await cache.load("general:inbox", loadStats), undefined);
  assert.deepEqual(await cache.load("general:inbox", loadStats), { total: 3 });
  assert.equal(loads, 2);
});
