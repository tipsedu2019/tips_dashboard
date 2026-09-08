import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import test from "node:test";

// Next installs this global before loading its App Router storage modules.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { workAsyncStorage } = await import(
  "next/dist/server/app-render/work-async-storage.external.js"
);
const {
  createPublicClassDetailLoader,
  createPublicClassDetailResponder,
  normalizePublicClassDetail,
  PublicClassNotFoundError,
  PublicClassUnavailableError,
} = await import("../src/server/public-class-detail.ts");
const {
  PUBLIC_CLASSES_FULL_CACHE_TAG,
  PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS,
  PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS,
} = await import("../src/server/public-classes-cache.js");

const CLASS_ID = "b6b5da5a-b000-4b46-bc7a-dabea5b53e12";
const OTHER_CLASS_ID = "c6b5da5a-b000-4b46-bc7a-dabea5b53e13";
const TTL_MS = PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS * 1_000;

function payload(now, id = CLASS_ID) {
  return {
    generatedAt: new Date(now).toISOString(),
    source: "supabase",
    classes: [{ id, name: "공개 수업", status: "수강", schedule: "월 17:00-19:00" }],
    textbooks: [],
    progressLogs: [],
  };
}

// Only storage and time are synthetic: the wrapper, key generation input,
// App Router SWR branch, background error handling and serialization are Next's.
function nextCacheHarness() {
  let time = Date.parse("2026-09-07T00:00:00.000Z");
  const entries = new Map();
  const writes = [];
  const incrementalCache = {
    async generateCacheKey(key) { return key; },
    async get(key, options) {
      const entry = entries.get(key);
      if (!entry) return null;
      return {
        value: entry.value,
        isStale: entry.tagStale || time - entry.writtenAt > options.revalidate * 1_000,
      };
    },
    async set(key, value, options) {
      entries.set(key, { value, options, writtenAt: time });
      writes.push({ key, value, options });
    },
  };
  return {
    now: () => time,
    advance(ms) { time += ms; },
    writes,
    evictAll() { entries.clear(); },
    invalidateTag(tag) {
      // Model revalidateTag(tag, "max"): existing entries become stale.
      for (const entry of entries.values()) {
        if (entry.options.tags.includes(tag)) entry.tagStale = true;
      }
    },
    async request(respond, id = CLASS_ID) {
      const store = {
        route: "/api/public-classes/[classId]",
        isStaticGeneration: false,
        incrementalCache,
        nextFetchId: 1,
      };
      const response = await workAsyncStorage.run(store, () => respond(id));
      await Promise.all(Object.values(store.pendingRevalidates || {}));
      return response;
    },
  };
}

test("real Next stale detail is replaced by authoritative absence and cannot resurrect during a later outage", async (t) => {
  const cache = nextCacheHarness();
  let state = "public";
  let attempts = 0;
  const snapshotRead = t.mock.method(fs, "readFile", async () =>
    JSON.stringify(payload(cache.now())));
  const respond = createPublicClassDetailResponder(createPublicClassDetailLoader({
    now: cache.now,
    loadLive: async (id) => {
      attempts += 1;
      if (state === "missing") throw new PublicClassNotFoundError();
      if (state === "outage") throw new PublicClassUnavailableError();
      return normalizePublicClassDetail(payload(cache.now(), id), id, "live");
    },
  }));

  assert.equal((await cache.request(respond)).status, 200);
  state = "missing";
  cache.advance(11 * 60 * 1_000);
  const revalidating = await cache.request(respond);
  assert.equal(revalidating.status, 200);
  assert.equal(JSON.parse(revalidating.body).availability, "snapshot");
  assert.equal(revalidating.headers["Cache-Control"], "no-store");
  assert.equal(attempts, 2);

  const afterAbsence = await cache.request(respond);
  assert.equal(afterAbsence.status, 404);
  assert.equal(afterAbsence.headers["Cache-Control"], "no-store");
  assert.equal(snapshotRead.mock.callCount(), 0);
  assert.equal(cache.writes.length, 2);

  state = "outage";
  // Absence survives a new loader instance as persisted data, not a process map.
  const afterRestart = createPublicClassDetailResponder(createPublicClassDetailLoader({
    now: cache.now,
    loadLive: async (id) => {
      attempts += 1;
      if (state === "outage") throw new PublicClassUnavailableError();
      return normalizePublicClassDetail(payload(cache.now(), id), id, "live");
    },
  }));
  // The cache key includes the wrapper source, not this injected live reader.
  assert.equal((await cache.request(afterRestart)).status, 404);
  assert.equal(attempts, 2);

  cache.advance(TTL_MS + 1);
  const errors = t.mock.method(console, "error", () => {});
  for (let index = 0; index < 2; index += 1) {
    const response = await cache.request(afterRestart);
    assert.equal(response.status, 404);
    assert.equal(response.headers["Cache-Control"], "no-store");
  }
  assert.equal(attempts, 4);
  assert.equal(errors.mock.callCount(), 2);
  assert.equal(cache.writes.length, 2, "transient failures must not replace absence");
  assert.equal(snapshotRead.mock.callCount(), 0);

  // A successful later lookup republishes the class through the same SWR cache.
  state = "public";
  assert.equal((await cache.request(afterRestart)).status, 404);
  const republished = await cache.request(afterRestart);
  assert.equal(republished.status, 200);
  assert.equal(JSON.parse(republished.body).availability, "live");
  assert.equal(cache.writes.length, 3);

  // Once a subsequent absence replaces success, hard eviction cannot reopen
  // the static-snapshot fallback even when that file contains a matching class.
  state = "missing";
  cache.advance(TTL_MS + 1);
  await cache.request(respond);
  assert.equal((await cache.request(respond)).status, 404);
  cache.evictAll();
  state = "outage";
  const writesBeforeOutage = cache.writes.length;
  for (let index = 0; index < 2; index += 1) {
    const unavailable = await cache.request(afterRestart);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers["Cache-Control"], "no-store");
  }
  assert.equal(cache.writes.length, writesBeforeOutage);
  assert.equal(snapshotRead.mock.callCount(), 0);
});

test("real Next lookup cache is per class, uses 600 seconds and the full-public invalidation tag", async () => {
  const cache = nextCacheHarness();
  let state = "missing";
  let attempts = 0;
  const respond = createPublicClassDetailResponder(createPublicClassDetailLoader({
    now: cache.now,
    loadLive: async (id) => {
      attempts += 1;
      if (id === CLASS_ID && state === "missing") throw new PublicClassNotFoundError();
      return normalizePublicClassDetail(payload(cache.now(), id), id, "live");
    },
  }));
  assert.equal((await cache.request(respond)).status, 404);
  assert.equal((await cache.request(respond, OTHER_CLASS_ID)).status, 200);
  state = "public";
  cache.advance(TTL_MS - 1);
  assert.equal((await cache.request(respond)).status, 404);
  assert.equal((await cache.request(respond, OTHER_CLASS_ID)).status, 200);
  assert.equal(attempts, 2);
  for (const write of cache.writes) {
    assert.equal(write.value.revalidate, 600);
    assert.deepEqual(write.options.tags, [PUBLIC_CLASSES_FULL_CACHE_TAG]);
    assert.match(write.key, /public-class-detail-v2/);
  }
  cache.invalidateTag(PUBLIC_CLASSES_FULL_CACHE_TAG);
  assert.equal((await cache.request(respond)).status, 404);
  const republished = await cache.request(respond);
  assert.equal(republished.status, 200);
  assert.equal(republished.headers["Cache-Control"], "public, max-age=0, s-maxage=600");
  assert.equal((await cache.request(respond, OTHER_CLASS_ID)).status, 200);
  assert.equal(attempts, 4);
});

test("real Next provider outage keeps only bounded explicit snapshots and never caches failures", async (t) => {
  const cache = nextCacheHarness();
  let down = false;
  let attempts = 0;
  const snapshotRead = t.mock.method(fs, "readFile", async () =>
    JSON.stringify(payload(cache.now())));
  const respond = createPublicClassDetailResponder(createPublicClassDetailLoader({
    now: cache.now,
    loadLive: async (id) => {
      attempts += 1;
      if (down) throw new PublicClassUnavailableError();
      return normalizePublicClassDetail(payload(cache.now(), id), id, "live");
    },
  }));
  await cache.request(respond);
  down = true;
  cache.advance(TTL_MS + 1);
  t.mock.method(console, "error", () => {});
  const stale = await cache.request(respond);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(stale.body).availability, "snapshot");
  assert.equal(snapshotRead.mock.callCount(), 0);
  assert.equal(cache.writes.length, 1);

  cache.advance(PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS - TTL_MS - 1);
  const lastBoundedSnapshot = await cache.request(respond);
  assert.equal(lastBoundedSnapshot.status, 200);
  assert.equal(JSON.parse(lastBoundedSnapshot.body).availability, "snapshot");
  assert.equal(lastBoundedSnapshot.headers["Cache-Control"], "no-store");
  cache.advance(1);
  const expired = await cache.request(respond);
  assert.equal(expired.status, 503);
  assert.equal(expired.headers["Cache-Control"], "no-store");
  assert.equal(snapshotRead.mock.callCount(), 0);
  assert.equal(cache.writes.length, 1);
  assert.equal(attempts, 4);

  // Without a warmed success, provider errors remain unavailable even when a
  // matching, fresh static snapshot exists. Later requests still retry live.
  const coldCache = nextCacheHarness();
  let coldAttempts = 0;
  const coldRespond = createPublicClassDetailResponder(createPublicClassDetailLoader({
    now: coldCache.now,
    loadLive: async () => {
      coldAttempts += 1;
      throw new PublicClassUnavailableError();
    },
  }));
  for (let index = 0; index < 2; index += 1) {
    const unavailable = await coldCache.request(coldRespond);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers["Cache-Control"], "no-store");
  }
  assert.equal(coldCache.writes.length, 0);
  assert.equal(coldAttempts, 2);
  assert.equal(snapshotRead.mock.callCount(), 0);
});
