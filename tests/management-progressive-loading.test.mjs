import test from "node:test";
import assert from "node:assert/strict";

const loaderModule = await import(
  new URL("../src/features/management/management-progressive-loader.js", import.meta.url)
).catch(() => ({}));
const cacheModule = await import(
  new URL("../src/features/management/management-primary-cache.js", import.meta.url)
).catch(() => ({}));

const loadManagementRowsProgressively =
  loaderModule.loadManagementRowsProgressively ||
  (async () => ({ enrichment: Promise.resolve() }));
const createManagementPrimaryRowsCache =
  cacheModule.createManagementPrimaryRowsCache;

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("management list publishes primary rows before optional enrichment finishes", async () => {
  const enrichmentGate = deferred();
  const published = [];

  const load = await loadManagementRowsProgressively({
    loadPrimaryRows: async () => [{ id: "student-1", name: "기본 학생" }],
    enrichRows: async () => enrichmentGate.promise,
    onPrimaryRows: (rows) => published.push({ phase: "primary", rows }),
    onEnrichedRows: (rows) => published.push({ phase: "enriched", rows }),
  });

  assert.deepEqual(published, [
    {
      phase: "primary",
      rows: [{ id: "student-1", name: "기본 학생" }],
    },
  ]);

  enrichmentGate.resolve([
    { id: "student-1", name: "기본 학생", classHistory: [{ id: "history-1" }] },
  ]);
  await load.enrichment;

  assert.deepEqual(published, [
    {
      phase: "primary",
      rows: [{ id: "student-1", name: "기본 학생" }],
    },
    {
      phase: "enriched",
      rows: [
        { id: "student-1", name: "기본 학생", classHistory: [{ id: "history-1" }] },
      ],
    },
  ]);
});

test("management list publishes a recent memory cache before the fresh query finishes", async () => {
  const primaryGate = deferred();
  const published = [];
  const cached = [];

  const loadPromise = loadManagementRowsProgressively({
    cachedPrimaryRows: [{ id: "student-cached", name: "캐시 학생" }],
    loadPrimaryRows: async () => primaryGate.promise,
    cachePrimaryRows: (rows) => cached.push(rows),
    onPrimaryRows: (rows) => published.push(rows),
  });

  assert.deepEqual(published, [
    [{ id: "student-cached", name: "캐시 학생" }],
  ]);

  primaryGate.resolve([{ id: "student-fresh", name: "최신 학생" }]);
  await loadPromise;

  assert.deepEqual(published, [
    [{ id: "student-cached", name: "캐시 학생" }],
    [{ id: "student-fresh", name: "최신 학생" }],
  ]);
  assert.deepEqual(cached, [
    [{ id: "student-fresh", name: "최신 학생" }],
  ]);
});

test("management primary-row cache expires from module memory", () => {
  assert.equal(typeof createManagementPrimaryRowsCache, "function");

  let now = 1_000;
  const cache = createManagementPrimaryRowsCache({
    ttlMs: 60_000,
    now: () => now,
  });
  const rows = [{ id: "class-1", name: "수학 A" }];

  cache.write("classes", rows);
  assert.deepEqual(cache.read("classes"), rows);

  now += 60_001;
  assert.equal(cache.read("classes"), null);
});

test("stale enrichment cannot replace rows from a newer management load", async () => {
  const enrichmentGate = deferred();
  const published = [];
  let current = true;

  const load = await loadManagementRowsProgressively({
    loadPrimaryRows: async () => [{ id: "class-1", name: "기본 수업" }],
    enrichRows: async () => enrichmentGate.promise,
    onPrimaryRows: (rows) => published.push({ phase: "primary", rows }),
    onEnrichedRows: (rows) => published.push({ phase: "enriched", rows }),
    isCurrent: () => current,
  });

  current = false;
  enrichmentGate.resolve([{ id: "class-1", name: "오래된 보강 결과" }]);
  await load.enrichment;

  assert.deepEqual(published, [
    {
      phase: "primary",
      rows: [{ id: "class-1", name: "기본 수업" }],
    },
  ]);
});
