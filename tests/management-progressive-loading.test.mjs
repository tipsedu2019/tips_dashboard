import test from "node:test";
import assert from "node:assert/strict";

const loaderModule = await import(
  new URL("../src/features/management/management-progressive-loader.js", import.meta.url)
).catch(() => ({}));

const loadManagementRowsProgressively =
  loaderModule.loadManagementRowsProgressively ||
  (async () => ({ enrichment: Promise.resolve() }));

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
