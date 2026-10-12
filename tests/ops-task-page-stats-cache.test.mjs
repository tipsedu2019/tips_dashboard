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

test("clear detaches old-role in-flight stats and prevents late cache restoration", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const old = Promise.withResolvers();
  const next = Promise.withResolvers();
  const oldRead = cache.load("same-user:filters", () => old.promise);
  cache.clear();
  let newLoads = 0;
  const newRead = cache.load("same-user:filters", () => { newLoads++; return next.promise; });
  assert.equal(newLoads, 1);
  next.resolve({ total: 2 }); await newRead;
  old.resolve({ total: 900 }); await oldRead;
  assert.deepEqual(await cache.load("same-user:filters", () => assert.fail("new-role value retained")), { total: 2 });
});

test("a replacement owner starts a fresh read before an aborted request settles", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const old = Promise.withResolvers();
  const next = Promise.withResolvers();
  const owner = new AbortController();
  let loads = 0;
  const oldRead = cache.load("general:inbox", () => { loads++; return old.promise; }, owner.signal);
  owner.abort();
  const newRead = cache.load("general:inbox", () => { loads++; return next.promise; }, new AbortController().signal);

  assert.equal(loads, 2);
  old.resolve(undefined);
  assert.equal(await oldRead, undefined);
  next.resolve({ total: 2 });
  assert.deepEqual(await newRead, { total: 2 });
  assert.deepEqual(await cache.load("general:inbox", () => assert.fail("replacement cached")), { total: 2 });
});

test("an aborted owner cannot cache a successful response that ignored cancellation", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const old = Promise.withResolvers();
  const owner = new AbortController();
  const oldRead = cache.load("general:inbox", () => old.promise, owner.signal);
  owner.abort();
  old.resolve({ total: 900 });
  await oldRead;

  let loads = 0;
  assert.deepEqual(await cache.load("general:inbox", async () => { loads++; return { total: 2 }; }), { total: 2 });
  assert.equal(loads, 1);
});

for (const oldFinishesFirst of [true, false]) {
  test(`late aborted success preserves the replacement when old finishes ${oldFinishesFirst ? "first" : "last"}`, async () => {
    const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
    const old = Promise.withResolvers();
    const next = Promise.withResolvers();
    const owner = new AbortController();
    const oldRead = cache.load("general:inbox", () => old.promise, owner.signal);
    owner.abort();
    let loads = 0;
    const replacementOwner = new AbortController();
    const loadNext = () => { loads++; return next.promise; };
    const newRead = cache.load("general:inbox", loadNext, replacementOwner.signal);
    assert.equal(loads, 1, "the replacement must start its own request");
    if (oldFinishesFirst) {
      old.resolve({ total: 900 });
      await oldRead;
      const sharedRead = cache.load("general:inbox", loadNext, replacementOwner.signal);
      assert.equal(loads, 1, "old completion must not remove the replacement's pending entry");
      next.resolve({ total: 2 });
      assert.deepEqual(await sharedRead, { total: 2 });
    } else {
      next.resolve({ total: 2 });
      await newRead;
      old.resolve({ total: 900 });
      await oldRead;
    }
    assert.deepEqual(await newRead, { total: 2 });
    assert.deepEqual(await cache.load("general:inbox", () => assert.fail("replacement retained")), { total: 2 });
  });
}

for (const withSignal of [true, false]) {
  test(`concurrent reads ${withSignal ? "with the same live owner" : "without a signal"} share one request`, async () => {
    const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
    const result = Promise.withResolvers();
    const signal = withSignal ? new AbortController().signal : undefined;
    let loads = 0;
    const reads = Array.from({ length: 5 }, () => cache.load("general:inbox", () => { loads++; return result.promise; }, signal));
    assert.equal(loads, 1);
    result.resolve({ total: 7 });
    assert.deepEqual(await Promise.all(reads), Array.from({ length: 5 }, () => ({ total: 7 })));
  });
}

for (const firstHasSignal of [true, false]) {
  test(`a live signal owner and a signal-free owner are independent (${firstHasSignal ? "signal first" : "signal last"})`, async () => {
    const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    const signal = new AbortController().signal;
    let loads = 0;
    const firstRead = cache.load("general:inbox", () => { loads++; return first.promise; }, firstHasSignal ? signal : undefined);
    const secondRead = cache.load("general:inbox", () => { loads++; return second.promise; }, firstHasSignal ? undefined : signal);
    assert.equal(loads, 2);
    second.resolve({ total: 2 });
    assert.deepEqual(await secondRead, { total: 2 });
    first.resolve({ total: 900 });
    assert.deepEqual(await firstRead, { total: 900 });
    assert.deepEqual(await cache.load("general:inbox", () => assert.fail("latest result retained")), { total: 2 });
  });
}

test("different live owners use separate requests and reuse the latest owner's request", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const ownerA = new AbortController();
  const ownerB = new AbortController();
  let loads = 0;
  const firstRead = cache.load("general:inbox", () => { loads++; return first.promise; }, ownerA.signal);
  const loadSecond = () => { loads++; return second.promise; };
  const secondRead = cache.load("general:inbox", loadSecond, ownerB.signal);
  const sharedRead = cache.load("general:inbox", loadSecond, ownerB.signal);
  assert.equal(loads, 2);
  ownerA.abort();
  first.resolve(undefined);
  await firstRead;
  second.resolve({ total: 2 });
  assert.deepEqual(await Promise.all([secondRead, sharedRead]), [{ total: 2 }, { total: 2 }]);
});

test("completed results are shared across owners and expire at the original TTL boundary", async () => {
  let now = 0;
  let loads = 0;
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ now: () => now, ttlMs: 60_000 });
  const loadStats = async () => ({ total: ++loads });
  assert.deepEqual(await cache.load("general:inbox", loadStats, new AbortController().signal), { total: 1 });
  now = 59_999;
  assert.deepEqual(await cache.load("general:inbox", loadStats, new AbortController().signal), { total: 1 });
  assert.equal(loads, 1);
  now = 60_000;
  assert.deepEqual(await cache.load("general:inbox", loadStats, new AbortController().signal), { total: 2 });
  assert.equal(loads, 2);
});

test("a rejected owner request can be retried with the same live signal", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const signal = new AbortController().signal;
  await assert.rejects(cache.load("general:inbox", async () => { throw new Error("unavailable"); }, signal), /unavailable/);
  assert.deepEqual(await cache.load("general:inbox", async () => ({ total: 2 }), signal), { total: 2 });
});

test("different owners returning the same promise cannot cache under a canceled successor", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const result = Promise.withResolvers();
  const successor = new AbortController();
  const first = cache.load("general:inbox", () => result.promise, new AbortController().signal);
  const second = cache.load("general:inbox", () => result.promise, successor.signal);
  successor.abort();
  result.resolve({ total: 900 });
  await Promise.all([first, second]);
  let loads = 0;
  assert.deepEqual(await cache.load("general:inbox", async () => { loads++; return { total: 2 }; }), { total: 2 });
  assert.equal(loads, 1);
});

test("alternating live owners start three requests and retain only the latest result", async () => {
  const cache = statsCacheModule.createOpsTaskPageStatsCache({ ttlMs: 60_000 });
  const owners = [new AbortController().signal, new AbortController().signal];
  const responses = Array.from({ length: 3 }, () => Promise.withResolvers());
  let loads = 0;
  const reads = [owners[0], owners[1], owners[0]].map((signal) => cache.load("general:inbox", () => responses[loads++].promise, signal));
  assert.equal(loads, 3);
  responses[2].resolve({ total: 3 });
  assert.deepEqual(await reads[2], { total: 3 });
  responses[1].resolve({ total: 2 });
  responses[0].resolve({ total: 1 });
  await Promise.all(reads);
  assert.deepEqual(await cache.load("general:inbox", () => assert.fail("latest result retained")), { total: 3 });
});
