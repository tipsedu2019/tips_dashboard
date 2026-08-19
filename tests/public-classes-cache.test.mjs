import assert from "node:assert/strict";
import test from "node:test";

import * as publicClassesCache from "../src/server/public-classes-cache.js";
import {
  PUBLIC_CLASSES_SUMMARY_CACHE_TAG,
  PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS,
  createPublicClassesSummaryCache,
} from "../src/server/public-classes-cache.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createNextDataCacheHarness({ now = () => Date.now() } = {}) {
  const entries = new Map();
  const generations = new Map();
  const calls = [];

  function generation(key) {
    return generations.get(key) || 0;
  }

  function factory(loader, keys, options) {
    const key = keys.join(":");
    calls.push({ keys, options });
    return async (...args) => {
      const currentGeneration = generation(key);
      const current = entries.get(key);
      if (current?.value && current.generation === currentGeneration) {
        if (current.expiresAt > now()) return current.value;
        if (!current.revalidating) {
          const revalidating = Promise.resolve(loader(...args))
            .then((value) => {
              if (generation(key) === currentGeneration && entries.get(key)?.revalidating === revalidating) {
                entries.set(key, { generation: currentGeneration, value, expiresAt: now() + options.revalidate * 1_000 });
              }
            })
            .catch(() => undefined)
            .finally(() => {
              if (entries.get(key)?.revalidating === revalidating) {
                entries.set(key, { ...entries.get(key), revalidating: null });
              }
            });
          entries.set(key, { ...current, revalidating });
        }
        return current.value;
      }
      if (current?.inFlight && current.generation === currentGeneration) return current.inFlight;

      const inFlight = Promise.resolve(loader(...args)).then((value) => {
        if (generation(key) === currentGeneration && entries.get(key)?.inFlight === inFlight) {
          entries.set(key, { generation: currentGeneration, value, expiresAt: now() + options.revalidate * 1_000 });
        }
        return value;
      }).catch((error) => {
        if (entries.get(key)?.inFlight === inFlight) entries.delete(key);
        throw error;
      });
      entries.set(key, { generation: currentGeneration, inFlight });
      return inFlight;
    };
  }

  return {
    factory,
    calls,
    invalidate() {
      const key = PUBLIC_CLASSES_SUMMARY_CACHE_TAG;
      generations.set(key, generation(key) + 1);
      entries.delete(key);
    },
  };
}

function livePayload(call) {
  return {
    generatedAt: `2026-08-14T00:00:0${call}.000Z`,
    source: "supabase",
    classes: [{ id: `class-${call}`, name: "중등 영어" }],
    textbooks: [],
    progressLogs: [],
  };
}

function fullPayload(call) {
  return {
    generatedAt: `2026-08-14T00:01:0${call}.000Z`,
    source: "supabase",
    classes: [
      {
        id: `class-${call}`,
        name: "중등 영어",
        schedulePlan: { sessions: [{ id: `session-${call}` }] },
        schedule_plan: { sessions: [{ id: `session-${call}` }] },
      },
    ],
    textbooks: [{ id: `book-${call}`, title: "교재" }],
    progressLogs: [{ id: `progress-${call}`, classId: `class-${call}` }],
  };
}

test("public class summary cache uses the 600-second tagged Next Data Cache contract and deduplicates concurrent cold loads", async () => {
  const pending = deferred();
  let calls = 0;
  const harness = createNextDataCacheHarness();
  const cache = createPublicClassesSummaryCache({
    cache: harness.factory,
    loadSummary: async () => {
      calls += 1;
      return pending.promise;
    },
  });

  const first = cache.load();
  const second = cache.load();
  assert.equal(calls, 1);
  pending.resolve(livePayload(1));
  assert.deepEqual(await first, livePayload(1));
  assert.deepEqual(await second, livePayload(1));
  assert.deepEqual(harness.calls, [{
    keys: [PUBLIC_CLASSES_SUMMARY_CACHE_TAG],
    options: {
      revalidate: PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS,
      tags: [PUBLIC_CLASSES_SUMMARY_CACHE_TAG],
    },
  }]);
});

test("a failed warm revalidation keeps the prior successful summary", async () => {
  let now = 0;
  let calls = 0;
  const harness = createNextDataCacheHarness({ now: () => now });
  const cache = createPublicClassesSummaryCache({
    cache: harness.factory,
    loadSummary: async () => {
      calls += 1;
      if (calls === 1) return livePayload(1);
      throw new Error("upstream unavailable");
    },
  });

  assert.deepEqual(await cache.load(), livePayload(1));
  now += 600_001;
  assert.deepEqual(await cache.load(), livePayload(1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("a cold failure falls back to a normalized static summary and never caches fallback-empty", async () => {
  let shouldFail = true;
  let calls = 0;
  const cache = createPublicClassesSummaryCache({
    cache: createNextDataCacheHarness().factory,
    loadSummary: async () => {
      calls += 1;
      if (shouldFail) {
        return { source: "fallback-empty", classes: [], textbooks: [], progressLogs: [] };
      }
      return livePayload(calls);
    },
    readSnapshot: async () => ({
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "supabase",
      classes: [{ id: "class-static", name: "정적 수업", status: "수강", schedule_plan: { sessions: [{ id: "s-1" }] } }],
      textbooks: [{ id: "book-1" }],
      progressLogs: [{ id: "progress-1" }],
    }),
  });

  const fallback = await cache.load();
  assert.equal(fallback.source, "supabase");
  assert.deepEqual(fallback.classes, [{
    id: "class-static",
    name: "정적 수업",
    className: "정적 수업",
    subject: "",
    grade: "",
    teacher: "",
    room: "",
    classroom: "",
    schedule: "",
    status: "수강",
    fee: 0,
    tuition: 0,
    capacity: 0,
    studentIds: [],
    waitlistIds: [],
  }]);
  assert.equal(JSON.stringify(fallback).includes("schedule_plan"), false);

  shouldFail = false;
  assert.deepEqual(await cache.load(), livePayload(2));
  assert.equal(calls, 2);
});

test("an invalidated older refresh cannot replace its newer generation", async () => {
  const oldRequest = deferred();
  let useOldRequest = true;
  const harness = createNextDataCacheHarness();
  const cache = createPublicClassesSummaryCache({
    cache: harness.factory,
    loadSummary: async () => useOldRequest ? oldRequest.promise : livePayload(2),
  });

  const oldConsumer = cache.load();
  harness.invalidate();
  useOldRequest = false;
  assert.deepEqual(await cache.load(), livePayload(2));
  oldRequest.resolve(livePayload(1));
  assert.deepEqual(await oldConsumer, livePayload(1));
  assert.deepEqual(await cache.load(), livePayload(2));
});

test("the full public API bypasses Next Data Cache payload storage", async () => {
  let calls = 0;
  const harness = createNextDataCacheHarness();
  const cache = publicClassesCache.createPublicClassesFullCache({
    cache: harness.factory,
    loadFull: async () => {
      calls += 1;
      return fullPayload(calls);
    },
  });

  assert.deepEqual(await cache.load(), fullPayload(1));
  assert.deepEqual(await cache.load(), fullPayload(2));
  assert.equal(calls, 2);
  assert.deepEqual(harness.calls, []);
});

test("a cold full failure returns a valid static snapshot without caching a fallback", async () => {
  let shouldFail = true;
  let calls = 0;
  const cache = publicClassesCache.createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => {
      calls += 1;
      if (shouldFail) {
        return {
          source: "fallback-empty",
          classes: [],
          textbooks: [],
          progressLogs: [],
        };
      }
      return fullPayload(2);
    },
    readSnapshot: async () => fullPayload(1),
    now: () => Date.parse("2026-08-14T01:00:00.000Z"),
  });

  assert.deepEqual(await cache.load(), fullPayload(1));
  shouldFail = false;
  assert.deepEqual(await cache.load(), fullPayload(2));
  assert.equal(calls, 2);
});

test("an invalid full snapshot does not turn an upstream failure into a success", async () => {
  const cache = publicClassesCache.createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => ({
      source: "fallback-empty",
      classes: [],
      textbooks: [],
      progressLogs: [],
    }),
    readSnapshot: async () => ({ source: "supabase", classes: [] }),
  });

  const payload = await cache.load();
  assert.equal(payload.source, "fallback-empty");
});

test("a full snapshot older than 24 hours does not turn an upstream failure into a success", async () => {
  const cache = publicClassesCache.createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => ({
      source: "fallback-empty",
      classes: [],
      textbooks: [],
      progressLogs: [],
    }),
    readSnapshot: async () => fullPayload(1),
    now: () => Date.parse("2026-08-15T01:02:00.000Z"),
  });

  const payload = await cache.load();
  assert.equal(payload.source, "fallback-empty");
});

test("a full snapshot without its original generation time does not become fresh during normalization", async () => {
  const cache = publicClassesCache.createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => ({
      source: "fallback-empty",
      classes: [],
      textbooks: [],
      progressLogs: [],
    }),
    readSnapshot: async () => ({
      source: "supabase",
      classes: [],
      textbooks: [],
      progressLogs: [],
    }),
    now: () => Date.now() + 3_600_000,
  });

  const payload = await cache.load();
  assert.equal(payload.source, "fallback-empty");
});
