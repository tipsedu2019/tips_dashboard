import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createManagementReadService,
  getAssignedClassTextbookIds,
} from "../src/features/management/management-service.js";

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

function makeRpcBuilder(result, calls) {
  return {
    abortSignal(signal) {
      calls.push(["abortSignal", signal]);
      return this;
    },
    retry(value) {
      calls.push(["retry", value]);
      return Promise.resolve(result);
    },
  };
}

function makeDeferredRpcBuilder(result, calls) {
  return {
    abortSignal(signal) {
      calls.push(["abortSignal", signal]);
      return this;
    },
    retry(value) {
      calls.push(["retry", value]);
      return result;
    },
  };
}

test("management list callers can request 10, 15, or 20 rows while 30 remains relation-only", async () => {
  const calls = [];
  const studentId = "10000000-0000-4000-8000-000000000001";
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "list_management_page_v1") {
        return makeRpcBuilder({
          data: Array.from({ length: 21 }, (_, index) => ({
            id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            sort_key: `김학생 ${index + 1}`,
            row_data: { kind: "students", id: `student-${index + 1}`, name: `김학생 ${index + 1}`, status: "재원" },
          })),
          error: null,
        }, calls);
      }
      if (name === "list_management_detail_relation_page_v1") {
        return makeRpcBuilder({ data: { page: { rows: [], hasMore: false, nextCursor: null } }, error: null }, calls);
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };

  for (const limit of [10, 15, 20]) {
    const result = await service.loadNextPage({ kind: "students", filters, cursor: null, limit });
    assert.equal(calls.findLast(([name]) => name === "list_management_page_v1")[1].p_limit, limit);
    assert.ok(result.rows.length <= limit);
  }

  await assert.rejects(
    service.loadNextPage({ kind: "students", filters, cursor: null, limit: 30 }),
    (error) => error?.code === "management_page_limit_invalid",
  );
  await service.loadRelationPage({
    kind: "students", id: studentId, relationKind: "lifecycle_history", cursor: null, limit: 30,
  });
  assert.equal(calls.findLast(([name]) => name === "list_management_detail_relation_page_v1")[1].p_limit, 30);
});

test("management initial reads return rows before metadata and cancel every query with the caller", async () => {
  const calls = [];
  const statsGate = deferred();
  const filterOptionsGate = deferred();
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "list_management_page_v1") {
        return makeRpcBuilder({ data: [{ id: "student-1", sort_key: "김학생", row_data: { id: "student-1" } }], error: null }, calls);
      }
      if (name === "get_management_stats_v1") return makeDeferredRpcBuilder(statsGate.promise, calls);
      if (name === "list_management_filter_options_v1") return makeDeferredRpcBuilder(filterOptionsGate.promise, calls);
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };
  const controller = new AbortController();

  const result = await service.loadInitialPage({ kind: "students", filters, cursor: null, limit: 10, signal: controller.signal });
  let metadataSettled = false;
  void result.metadata.then(() => { metadataSettled = true; });
  await Promise.resolve();

  assert.deepEqual(result.page.rows, [{ id: "student-1" }]);
  assert.equal(metadataSettled, false);
  assert.equal(calls.filter(([name]) => name === "abortSignal").length, 3);
  assert.deepEqual(calls.filter(([name]) => name === "retry").map(([, value]) => value), [false, false, false]);

  controller.abort();
  assert.ok(calls.filter(([name]) => name === "abortSignal").every(([, signal]) => signal.aborted));
  statsGate.resolve({ data: { total: 37, byStatus: { "재원": 37 } }, error: null });
  filterOptionsGate.resolve({ data: { school: ["팁스중"] }, error: null });
  assert.deepEqual(await result.metadata, {
    ok: true,
    stats: { total: 37, byStatus: { "재원": 37 } },
    filterOptions: { school: ["팁스중"] },
  });
});

test("management metadata failures settle without discarding a loaded page", async () => {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "list_management_page_v1") {
        return makeRpcBuilder({ data: [{ id: "student-1", sort_key: "김학생", row_data: { id: "student-1" } }], error: null }, calls);
      }
      if (name === "get_management_stats_v1") return makeRpcBuilder({ data: null, error: new Error("stats unavailable") }, calls);
      if (name === "list_management_filter_options_v1") return makeRpcBuilder({ data: { school: [] }, error: null }, calls);
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };

  const result = await service.loadInitialPage({ kind: "students", filters, cursor: null, limit: 10 });

  assert.deepEqual(result.page.rows, [{ id: "student-1" }]);
  const metadata = await result.metadata;
  assert.equal(metadata.ok, false);
  assert.equal(metadata.error.message, "stats unavailable");
});

test("same-scope class reads with different caller signals keep independent in-flight transports", async () => {
  const calls = [];
  const requestSignals = [];
  const listGates = [deferred(), deferred()];
  let listCallCount = 0;
  const defaultPeriodId = "30000000-0000-4000-8000-000000000003";
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      const result = name === "get_management_default_class_period_v1"
        ? { data: { periodId: defaultPeriodId }, error: null }
        : name === "list_management_page_v1"
          ? { data: [{ id: `class-${listCallCount + 1}`, sort_key: "수학", row_data: { id: `class-${listCallCount + 1}` } }], error: null }
          : name === "get_management_stats_v1"
            ? { data: { total: 1, byStatus: {} }, error: null }
            : name === "list_management_filter_options_v1"
              ? { data: { periods: [] }, error: null }
              : null;
      if (!result) throw new Error(`unexpected rpc ${name}`);
      const pending = name === "list_management_page_v1" ? listGates[listCallCount++] : null;
      return {
        abortSignal(signal) {
          requestSignals.push({ name, signal });
          return this;
        },
        retry(value) {
          calls.push(["retry", value]);
          return pending ? pending.promise.then(() => result) : Promise.resolve(result);
        },
      };
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = {
    kind: "classes", search: "", periodId: null, status: "수강",
    subject: null, grade: null, teacher: null, classroom: null,
  };
  const firstController = new AbortController();
  const secondController = new AbortController();

  const first = service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 10, signal: firstController.signal });
  const second = service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 10, signal: secondController.signal });
  for (let attempt = 0; attempt < 20 && calls.filter(([name]) => name === "list_management_page_v1").length !== 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(calls.filter(([name]) => name === "list_management_page_v1").length, 2);
  const primarySignals = requestSignals.filter(({ name }) => [
    "list_management_page_v1", "get_management_stats_v1", "list_management_filter_options_v1",
  ].includes(name));
  assert.equal(primarySignals.length, 6);

  firstController.abort();
  assert.equal(primarySignals.filter(({ signal }) => signal.aborted).length, 3);
  assert.equal(primarySignals.filter(({ signal }) => !signal.aborted).length, 3);
  secondController.abort();
  assert.ok(primarySignals.every(({ signal }) => signal.aborted));

  for (const gate of listGates) gate.resolve();
  await Promise.all([first, second]);
});

test("canonical class replay gives a new caller independently cancellable metadata", async () => {
  const calls = [];
  const requestSignals = [];
  const statsGates = [deferred(), deferred()];
  const filterOptionsGates = [deferred(), deferred()];
  let statsCallCount = 0;
  let filterOptionsCallCount = 0;
  const defaultPeriodId = "30000000-0000-4000-8000-000000000004";
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      const result = name === "get_management_default_class_period_v1"
        ? { data: { periodId: defaultPeriodId }, error: null }
        : name === "list_management_page_v1"
          ? { data: [{ id: "class-1", sort_key: "수학", row_data: { id: "class-1" } }], error: null }
          : name === "get_management_stats_v1"
            ? { data: { total: statsCallCount + 1, byStatus: {} }, error: null }
            : name === "list_management_filter_options_v1"
              ? { data: { periods: [] }, error: null }
              : null;
      if (!result) throw new Error(`unexpected rpc ${name}`);
      const pending = name === "get_management_stats_v1"
        ? statsGates[statsCallCount++]
        : name === "list_management_filter_options_v1"
          ? filterOptionsGates[filterOptionsCallCount++]
          : null;
      return {
        abortSignal(signal) {
          requestSignals.push({ name, signal });
          return this;
        },
        retry(value) {
          calls.push(["retry", value]);
          return pending ? pending.promise.then(() => result) : Promise.resolve(result);
        },
      };
    },
  };
  const service = createManagementReadService({ supabase: client });
  const emptyPeriodFilters = {
    kind: "classes", search: "", periodId: null, status: "수강",
    subject: null, grade: null, teacher: null, classroom: null,
  };
  const firstController = new AbortController();
  const replayController = new AbortController();

  const initial = await service.loadInitialPage({
    kind: "classes", filters: emptyPeriodFilters, cursor: null, limit: 10, signal: firstController.signal,
  });
  const replay = await service.loadInitialPage({
    kind: "classes",
    filters: { ...emptyPeriodFilters, periodId: defaultPeriodId },
    cursor: null,
    limit: 10,
    canonicalReplayToken: initial.canonicalReplayToken,
    signal: replayController.signal,
  });

  assert.deepEqual(replay.page, initial.page);
  assert.notEqual(replay.metadata, initial.metadata);
  assert.equal(calls.filter(([name]) => name === "list_management_page_v1").length, 1);
  assert.equal(calls.filter(([name]) => name === "get_management_stats_v1").length, 2);
  assert.equal(calls.filter(([name]) => name === "list_management_filter_options_v1").length, 2);
  const metadataSignals = requestSignals.filter(({ name }) => [
    "get_management_stats_v1", "list_management_filter_options_v1",
  ].includes(name));
  const originalMetadataSignals = metadataSignals.slice(0, 2);
  const replayMetadataSignals = metadataSignals.slice(2, 4);
  assert.equal(originalMetadataSignals.length, 2);
  assert.equal(replayMetadataSignals.length, 2);

  firstController.abort();
  assert.ok(originalMetadataSignals.every(({ signal }) => signal.aborted));
  assert.ok(replayMetadataSignals.every(({ signal }) => !signal.aborted));
  replayController.abort();
  assert.ok(replayMetadataSignals.every(({ signal }) => signal.aborted));

  for (const gate of statsGates) gate.resolve();
  for (const gate of filterOptionsGates) gate.resolve();
  await Promise.all([initial.metadata, replay.metadata]);
});

test("the first class management bundle resolves and applies the default period before list stats or options", async () => {
  const calls = [];
  const defaultPeriodId = "30000000-0000-4000-8000-000000000001";
  let statsRevision = 0;
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "get_management_default_class_period_v1") {
        return makeRpcBuilder({ data: { periodId: defaultPeriodId }, error: null }, calls);
      }
      if (name === "list_management_page_v1") return makeRpcBuilder({ data: [], error: null }, calls);
      if (name === "get_management_stats_v1") {
        statsRevision += 1;
        return makeRpcBuilder({ data: { total: statsRevision, byStatus: {} }, error: null }, calls);
      }
      if (name === "list_management_filter_options_v1") return makeRpcBuilder({ data: { periods: [] }, error: null }, calls);
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = {
    kind: "classes", search: "", periodId: null, status: "수강",
    subject: null, grade: null, teacher: null, classroom: null,
  };

  const [result, concurrentResult] = await Promise.all([
    service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 10 }),
    service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 10 }),
  ]);
  const canonicalReplay = await service.loadInitialPage({
    kind: "classes",
    filters: { ...filters, periodId: defaultPeriodId },
    cursor: null,
    limit: 10,
    canonicalReplayToken: result.canonicalReplayToken,
  });

  assert.equal(calls[0][0], "get_management_default_class_period_v1");
  for (const name of ["list_management_page_v1", "get_management_stats_v1", "list_management_filter_options_v1"]) {
    const matchingCalls = calls.filter(([calledName]) => calledName === name);
    assert.equal(matchingCalls.length, 1);
    const call = matchingCalls[0];
    assert.equal(call[1].p_filters.periodId, defaultPeriodId);
  }
  assert.equal(result.effectiveFilters.periodId, defaultPeriodId);
  assert.equal(concurrentResult, result);
  assert.equal((await canonicalReplay.metadata).stats.total, 1);
  assert.equal(canonicalReplay.canonicalReplayToken, null);

  const refreshed = await service.loadInitialPage({
    kind: "classes",
    filters: { ...filters, periodId: defaultPeriodId },
    cursor: null,
    limit: 10,
  });
  assert.equal((await refreshed.metadata).stats.total, 2);
  for (const name of ["list_management_page_v1", "get_management_stats_v1", "list_management_filter_options_v1"]) {
    assert.equal(calls.filter(([calledName]) => calledName === name).length, 2);
  }
});

test("an explicit refresh bypasses and revokes an overlapping passive default-period bundle", async () => {
  const defaultPeriodId = "30000000-0000-4000-8000-000000000002";
  const calls = [];
  const gates = new Map([
    ["list_management_page_v1", [deferred(), deferred()]],
    ["get_management_stats_v1", [deferred(), deferred()]],
    ["list_management_filter_options_v1", [deferred(), deferred()]],
  ]);
  const callCounts = new Map();
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "get_management_default_class_period_v1") {
        return makeRpcBuilder({ data: { periodId: defaultPeriodId }, error: null }, calls);
      }
      const revision = (callCounts.get(name) || 0) + 1;
      callCounts.set(name, revision);
      const gate = gates.get(name)?.[revision - 1];
      if (!gate) throw new Error(`unexpected rpc ${name} revision ${revision}`);
      const result = name === "list_management_page_v1"
        ? { data: [{ id: `60000000-0000-4000-8000-${String(revision).padStart(12, "0")}`, row_data: { revision } }], error: null }
        : name === "get_management_stats_v1"
          ? { data: { total: revision, byStatus: {} }, error: null }
          : { data: { revision }, error: null };
      return {
        abortSignal() { return this; },
        retry() { return gate.promise.then(() => result); },
      };
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = {
    kind: "classes", search: "", periodId: null, status: "수강",
    subject: null, grade: null, teacher: null, classroom: null,
  };

  const passive = service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 10 });
  for (let attempt = 0; attempt < 20 && callCounts.get("list_management_page_v1") !== 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(callCounts.get("list_management_page_v1"), 1);
  const refresh = service.loadInitialPage({
    kind: "classes", filters, cursor: null, limit: 10, coalesceInitialRequest: false,
  });
  for (let attempt = 0; attempt < 20 && callCounts.get("list_management_page_v1") !== 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  for (const name of ["list_management_page_v1", "get_management_stats_v1", "list_management_filter_options_v1"]) {
    assert.equal(callCounts.get(name), 2);
  }
  for (const entries of gates.values()) entries[1].resolve();
  const refreshed = await refresh;
  assert.equal((await refreshed.metadata).stats.total, 2);
  assert.equal(refreshed.page.rows[0].revision, 2);

  for (const entries of gates.values()) entries[0].resolve();
  const stalePassive = await passive;
  assert.equal((await stalePassive.metadata).stats.total, 1);
  assert.equal(stalePassive.canonicalReplayToken, null);
});

test("class textbook candidates use bounded query-scoped continuation and retain unmatched assigned IDs", async () => {
  const calls = [];
  const classId = "40000000-0000-4000-8000-000000000001";
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name !== "list_management_class_textbook_candidates_v1") throw new Error(`unexpected rpc ${name}`);
      return makeRpcBuilder({
        data: Array.from({ length: 31 }, (_, index) => ({
          id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          sort_key: `교재 ${index + 1}`,
          row_data: { id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, title: `교재 ${index + 1}` },
        })),
        error: null,
      }, calls);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = { subject: "math", schoolLevel: "middle", gradeLevel: "m2", subSubject: "" };
  const first = await service.searchClassTextbookCandidates({ classId, search: "수학", filters, cursor: null, limit: 30 });
  assert.equal(first.rows.length, 30);
  assert.equal(first.hasMore, true);
  assert.equal(calls[0][1].p_search, "수학");
  assert.deepEqual(calls[0][1].p_filters, filters);
  const second = await service.searchClassTextbookCandidates({ classId, search: "수학", filters, cursor: first.nextCursor, limit: 30 });
  assert.equal(second.rows.length, 30);
  const candidateCalls = calls.filter(([name]) => name === "list_management_class_textbook_candidates_v1");
  assert.equal(candidateCalls.length, 2);
  assert.equal(candidateCalls[1][1].p_cursor_sort_key, first.nextCursor.sortKey);
  assert.equal(candidateCalls[1][1].p_cursor_id, first.nextCursor.id);
  await assert.rejects(
    service.searchClassTextbookCandidates({ classId, search: "영어", filters, cursor: first.nextCursor, limit: 30 }),
    (error) => error?.code === "management_cursor_mismatch",
  );
  assert.equal(calls.filter(([name]) => name === "list_management_class_textbook_candidates_v1").length, 2);

  assert.deepEqual(
    getAssignedClassTextbookIds({
      record: { textbookIds: ["legacy-without-row", "matched-row"] },
      textbooks: [{ id: "matched-row", title: "현재 교재" }],
    }),
    ["legacy-without-row", "matched-row"],
  );
});

test("management detail and relation cursors are selection driven and scope bound before the DB call", async () => {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      return makeRpcBuilder({
        data: {
          kind: "students",
          relationKind: "lifecycle_history",
          page: {
            rows: [{
              id: "history-1",
              teacher: "fallback teacher",
              teacher_name: "legacy teacher",
              room: "fallback room",
              classroom: "legacy room",
            }],
            hasMore: true,
            nextCursor: { sortValue: "2026-08-13T00:00:00Z", id: "20000000-0000-4000-8000-000000000002" },
          },
        },
        error: null,
      }, calls);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const cursor = service.encodeRelationCursor({
    kind: "students",
    entityId: "10000000-0000-4000-8000-000000000001",
    relationKind: "lifecycle_history",
    sortValue: "2026-08-14T00:00:00Z",
    id: "20000000-0000-4000-8000-000000000001",
  });

  await assert.rejects(
    service.loadRelationPage({
      kind: "classes",
      id: "30000000-0000-4000-8000-000000000001",
      relationKind: "registered_students",
      cursor,
    }),
    (error) => error?.code === "relation_cursor_mismatch",
  );
  assert.equal(calls.length, 0);

  const firstPage = await service.loadRelationPage({
    kind: "students",
    id: "10000000-0000-4000-8000-000000000001",
    relationKind: "lifecycle_history",
  });
  assert.equal(typeof firstPage.page.nextCursor, "string");
  assert.equal(firstPage.page.rows[0].teacher, "legacy teacher");
  assert.equal(firstPage.page.rows[0].classroom, "legacy room");
  await service.loadRelationPage({
    kind: "students",
    id: "10000000-0000-4000-8000-000000000001",
    relationKind: "lifecycle_history",
    cursor: firstPage.page.nextCursor,
  });
  const relationCalls = calls.filter(([name]) => name === "list_management_detail_relation_page_v1");
  assert.equal(relationCalls.length, 2);
  assert.equal(relationCalls[1][1].p_cursor_sort_key, "2026-08-13T00:00:00Z");
  assert.equal(relationCalls[1][1].p_cursor_id, "20000000-0000-4000-8000-000000000002");
});

test("management migration defines Korean numeric keyset list, separate aggregates, and exact detail RPCs", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260814011752_management_page_reads.sql", import.meta.url), "utf8");

  assert.match(migration, /create function public\.list_management_page_v1\s*\(/i);
  assert.match(migration, /create function public\.get_management_stats_v1\s*\(/i);
  assert.match(migration, /create function public\.list_management_filter_options_v1\s*\(/i);
  assert.match(migration, /create function public\.get_management_detail_v1\s*\(/i);
  assert.match(migration, /create function public\.list_management_detail_relation_page_v1\s*\(/i);
  assert.match(migration, /collate dashboard_private\.ko_numeric/i);
  assert.match(migration, /regexp_replace\([\s\S]*?\[\[:space:\]\]\+[\s\S]*?collate dashboard_private\.ko_numeric/i);
  assert.match(migration, /'nextCursor',case when v_count > p_limit then pg_catalog\.jsonb_build_object\('sortValue',v_next_sort_key,'id',v_next_id\)/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function[\s\S]*?from public/i);
  assert.match(migration, /grant execute on function[\s\S]*?to authenticated/i);
  assert.doesNotMatch(migration, /\boffset\b/i);
});

test("management hook and UI keep list reads bounded while details and relation pickers are selection driven", async () => {
  const hookSource = await readFile(new URL("../src/features/management/use-management-records.ts", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../src/features/management/management-page.tsx", import.meta.url), "utf8");
  const serviceSource = await readFile(new URL("../src/features/management/management-service.js", import.meta.url), "utf8");
  const tableSource = await readFile(new URL("../src/features/management/management-data-table.tsx", import.meta.url), "utf8");

  const activeHook = hookSource.slice(hookSource.indexOf("export function useManagementRecords"));
  assert.match(hookSource, /executeManagementInitialRequest/);
  assert.match(hookSource, /executeManagementContinuationRequest/);
  assert.match(activeHook, /\{ pageSize, enabled \}: UseManagementRecordsOptions/);
  assert.match(activeHook, /if \(!enabled\)[\s\S]*?return/);
  assert.match(activeHook, /executeManagementInitialRequest\(\{[\s\S]*?load: \(signal\) => readService\.loadInitialPage\(\{[\s\S]*?limit: pageSize,[\s\S]*?signal/);
  assert.match(activeHook, /continuationRequestGateRef\.current\.abort\(\)[\s\S]*?setNextCursor\(null\)[\s\S]*?setHasMore\(false\)/);
  assert.doesNotMatch(activeHook, /setRows\(\[\]\)/);
  assert.match(activeHook, /void load\(\{ allowCanonicalReplay: true \}\)/);
  assert.match(activeHook, /const refresh = useCallback\(\(\) => load\(\{ allowCanonicalReplay: false \}\)/);
  assert.match(activeHook, /const loadMore = useCallback\(async \(\) => \{[\s\S]*?if \(!enabled \|\|/);
  assert.match(activeHook, /executeManagementContinuationRequest\(\{[\s\S]*?load: \(signal\) => readService\.loadNextPage\(\{[\s\S]*?limit: pageSize,[\s\S]*?signal/);
  assert.match(activeHook, /readService\.searchClassTextbookCandidates\(\{ classId, search, filters, cursor, limit: 30 \}\)/);
  assert.match(activeHook, /const byId = new Map\(current\.map/);
  assert.match(activeHook, /readService\.loadDetail\(\{ kind, id \}\)/);
  assert.doesNotMatch(activeHook, /readOptionalTable|enrichManagementRows|\.select\("\*"\)/);

  assert.match(pageSource, /const detailRow = options\.detailLoaded \? row : await loadDetail\(row\.id\)/);
  assert.match(pageSource, /loadDetail\(requestedClassId\)/);
  assert.match(pageSource, /loadDetail\(requestedStudentId\)/);
  assert.match(pageSource, /service\.searchRelationPicker\(\{ kind, search: relationQuery \}\)/);
  assert.match(pageSource, /다음 30건/);
  assert.match(pageSource, /const reconcileManagementPage = useCallback\(async[\s\S]*?await refresh\(\)/);

  assert.match(tableSource, /const periodOptions = useMemo\([\s\S]*?getServerPeriodOptions\(filterOptions\.periods\)/);
  assert.match(tableSource, /manualFiltering: true/);
  assert.match(tableSource, /const tableSourceRows = rows/);
  assert.match(tableSource, /function buildTextbookListHref/);
  assert.match(tableSource, /syncTextbookListQueryState\(\{ q: debouncedGlobalFilter \}\)/);
  assert.match(tableSource, /syncTextbookListQueryState\(\{ publisher: nextValue \}\)/);
  assert.match(tableSource, /syncTextbookListQueryState\(\{ status: nextValue \}\)/);

  assert.match(serviceSource, /\.select\("id,name,subject,grade,status,schedule,teacher,room"\)/);
  assert.match(serviceSource, /\.select\("id,name,school,grade,status,recent_issue"\)/);
  assert.match(serviceSource, /\.limit\(30\)[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)[\s\S]*?\.retry\(false\)/);
});
