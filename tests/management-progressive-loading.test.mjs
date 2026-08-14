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

test("management list uses bounded page, authoritative stats, and filter options without detail enrichment", async () => {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === "list_management_page_v1") {
        return makeRpcBuilder({
          data: [
            { id: "10000000-0000-4000-8000-000000000001", sort_key: "김학생", row_data: { kind: "students", id: "10000000-0000-4000-8000-000000000001", name: "김학생", status: "재원" } },
          ],
          error: null,
        }, calls);
      }
      if (name === "get_management_stats_v1") {
        return makeRpcBuilder({ data: { total: 37, byStatus: { "재원": 35, "퇴원": 2 } }, error: null }, calls);
      }
      if (name === "list_management_filter_options_v1") {
        return makeRpcBuilder({ data: { school: ["팁스중"], grade: ["중2"] }, error: null }, calls);
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const service = createManagementReadService({ supabase: client });
  const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };

  const result = await service.loadPage({ kind: "students", filters, cursor: null, limit: 30 });

  assert.equal(result.page.rows.length, 1);
  assert.equal(result.stats.total, 37);
  assert.deepEqual(result.filterOptions.school, ["팁스중"]);
  assert.deepEqual(calls.filter(([name]) => name === "get_management_detail_v1"), []);
  assert.deepEqual(calls.filter(([name]) => name === "list_management_detail_relation_page_v1"), []);
  assert.equal(calls.filter(([name]) => name === "abortSignal").length, 3);
  assert.deepEqual(calls.filter(([name]) => name === "retry").map(([, value]) => value), [false, false, false]);
  assert.equal(calls.find(([name]) => name === "list_management_page_v1")[1].p_limit, 30);
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
    service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 30 }),
    service.loadInitialPage({ kind: "classes", filters, cursor: null, limit: 30 }),
  ]);
  const canonicalReplay = await service.loadInitialPage({
    kind: "classes",
    filters: { ...filters, periodId: defaultPeriodId },
    cursor: null,
    limit: 30,
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
  assert.equal(canonicalReplay.stats.total, 1);
  assert.equal(canonicalReplay.canonicalReplayToken, null);

  const refreshed = await service.loadInitialPage({
    kind: "classes",
    filters: { ...filters, periodId: defaultPeriodId },
    cursor: null,
    limit: 30,
  });
  assert.equal(refreshed.stats.total, 2);
  for (const name of ["list_management_page_v1", "get_management_stats_v1", "list_management_filter_options_v1"]) {
    assert.equal(calls.filter(([calledName]) => calledName === name).length, 2);
  }
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
            rows: [],
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
  assert.match(activeHook, /readService\.loadInitialPage\(\{[\s\S]*?kind,[\s\S]*?filters,[\s\S]*?cursor: null,[\s\S]*?limit: 30,[\s\S]*?canonicalReplayToken,/);
  assert.match(activeHook, /void load\(\{ allowCanonicalReplay: true \}\)/);
  assert.match(activeHook, /const refresh = useCallback\(\(\) => load\(\{ allowCanonicalReplay: false \}\)/);
  assert.match(activeHook, /readService\.loadNextPage\(\{ kind, filters: effectiveFiltersRef\.current, cursor: nextCursor, limit: 30 \}\)/);
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

  assert.match(serviceSource, /\.select\("id,name,subject,grade,status,teacher,classroom"\)/);
  assert.match(serviceSource, /\.select\("id,name,school,grade,status,recent_issue"\)/);
  assert.match(serviceSource, /\.limit\(30\)[\s\S]*?\.abortSignal\(AbortSignal\.timeout\(8_000\)\)[\s\S]*?\.retry\(false\)/);
});
