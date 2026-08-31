import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";

const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const rootPath = path.resolve(import.meta.dirname, "..");
function loadHook(supabase, entry = "src/features/management/use-management-records.ts", overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: file }).outputText;
    const runtimeModule = { exports: {} }; cache.set(file, runtimeModule);
    const resolve = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === "@/lib/supabase") return { supabase };
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return require(specifier);
      const base = specifier.startsWith("@/") ? path.join(rootPath, "src", specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find((candidate) => existsSync(candidate));
      return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(resolve, runtimeModule, runtimeModule.exports);
    return runtimeModule.exports;
  }
  return load(path.join(rootPath, entry));
}
function transport() {
  const requests = [];
  const supabase = { rpc(name, args) {
    let signal;
    return { abortSignal(value) { signal = value; return this; }, retry() {
      if (name === "get_management_stats_v1") return Promise.resolve({ data: { total: 260 }, error: null });
      if (name === "list_management_filter_options_v1") return Promise.resolve({ data: {}, error: null });
      if (name === "get_management_detail_v1") return Promise.resolve({ data: { kind: args.p_kind, record: { id: args.p_id, name: "Independent detail", status: "재원" } }, error: null });
      if (name === "get_management_default_class_period_v1") return Promise.resolve({ data: { periodId: "period-default" }, error: null });
      return new Promise((resolve, reject) => requests.push({ name, args, signal, resolve, reject }));
    } };
  } };
  function finish(index, totalCount = 260) {
    const request = requests[index], { p_page: page, p_page_size: pageSize, p_kind: kind } = request.args;
    request.resolve({ error: null, data: { page, pageSize, totalCount, rows: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) => ({
      kind, id: `row-${page}-${i}`, name: `Row ${page}-${i}`, status: "재원", sortKey: `row-${page}-${i}`, updatedAt: "2026-08-31", grade: null, school: null, contact: null, parentContact: null,
      subject: "수학", schedule: null, teacherName: null, classroom: null, capacity: null, weeklyMinutes: null, fee: null, studentCount: 0,
    })) } });
  }
  return { supabase, requests, finish };
}
const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };

test("management hook uses direct server pages, sort resets, refresh and independent detail under StrictMode", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const { supabase, requests, finish } = transport();
  const { useManagementRecords } = loadHook(supabase);
  let state, change, rendered, queryPage;
  function Probe({ authorizationScope = "actor:admin", enabled = true }) {
    const [query, setQuery] = useState({ page: 11, sort: [{ id: "title", desc: false }], filters });
    const result = useManagementRecords("students", query.filters, { pageSize: 10, enabled, authorizationScope, page: query.page, sort: query.sort, onQueryChange: (next) => setQuery((current) => ({ ...current, ...next })) });
    useEffect(() => { change = setQuery; state = result; queryPage = query.page; rendered = { page: result.page, rows: result.rows }; }, [query.page, result]);
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { enabled: false }))));
  assert.equal(requests.length, 0);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  assert.equal(requests[0].name, "list_management_numbered_page_v1");
  assert.equal(requests[0].args.p_page, 11, "hydration must preserve restored page 11");
  await act(async () => finish(0));
  assert.equal(state.page, 11); assert.equal(state.rows.length, 10);
  let detail;
  await act(async () => { detail = await state.loadDetail("outside-current-page"); });
  assert.equal(detail.id, "outside-current-page"); assert.equal(state.rows.length, 10);
  await act(async () => state.setSort([{ id: "school", desc: true }]));
  assert.equal(requests[1].args.p_page, 1);
  assert.deepEqual(requests[1].args.p_sort, [{ id: "school", desc: true }]);
  assert.equal(state.page, 11); assert.equal(state.rows[0].id, "row-11-0");
  await act(async () => finish(1));
  await act(async () => change((current) => ({ ...current, filters: { ...filters, search: "new" }, page: 1 })));
  assert.equal(requests[2].args.p_filters.search, "new"); assert.equal(requests[2].args.p_page, 1);
  await act(async () => finish(2));
  await act(async () => state.goToPage(11));
  await act(async () => finish(3, 101));
  let refresh;
  await act(async () => { refresh = state.refresh(); });
  assert.equal(requests[4].args.p_page, 11);
  await act(async () => finish(4, 100));
  assert.equal(requests[5].args.p_page, 10);
  await act(async () => { finish(5, 100); await refresh; });
  assert.equal(state.page, 10); assert.equal(state.totalCount, 100);
  assert.equal(queryPage, 10, "a clamped page must be reflected in URL-owned query state");
  assert.equal(requests.length, 6, "clamp must not trigger a duplicate page fetch");
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { authorizationScope: "actor:teacher" }))));
  assert.equal(rendered.rows.length, 0, "role change must clear old actor rows before response");
  await act(async () => root.unmount());
});

test("URL and saved sorts are sanitized with per-kind defaults and preserve unrelated parameters", async () => {
  const exports = await import("../src/features/management/management-numbered-state.ts").catch(() => ({}));
  assert.equal(typeof exports.readManagementNumberedQuery, "function");
  assert.deepEqual(exports.readManagementNumberedQuery("classes", "page=11", [{ id: "enrollmentStatus", desc: true }]), { page: 11, sort: [{ id: "title", desc: false }] });
  assert.deepEqual(exports.readManagementNumberedQuery("students", "sort=garbage&page=bad"), { page: 1, sort: [{ id: "status", desc: false }, { id: "title", desc: false }] });
  const params = new URLSearchParams(exports.updateManagementNumberedQuery("studentId=detail&q=math&page=11", { page: 1, sort: [{ id: "school", desc: true }] }));
  assert.equal(params.get("studentId"), "detail"); assert.equal(params.get("q"), "math");
  assert.equal(params.get("page"), null); assert.deepEqual(JSON.parse(params.get("sort")), [{ id: "school", desc: true }]);
});

test("filter changes reset page atomically, while default-period canonicalization preserves restore", async () => {
  const exports = await import("../src/features/management/management-numbered-state.ts");
  assert.equal(typeof exports.resetManagementPageForFilters, "function");
  const changed = new URLSearchParams("q=new&page=11&studentId=detail&sort=%5B%5D");
  exports.resetManagementPageForFilters("students", "q=old&page=11&studentId=detail&sort=%5B%5D", changed);
  assert.equal(changed.get("page"), null); assert.equal(changed.get("studentId"), "detail");
  const unchanged = new URLSearchParams("q=old&page=11");
  exports.resetManagementPageForFilters("students", "q=old&page=11", unchanged);
  assert.equal(unchanged.get("page"), "11");
  const canonical = new URLSearchParams("page=11&period=default&q=math");
  exports.resetManagementPageForFilters("classes", "page=11&q=math", canonical, "default");
  assert.equal(canonical.get("page"), "11");
  const explicit = new URLSearchParams("page=11&period=next&q=math");
  exports.resetManagementPageForFilters("classes", "page=11&period=old&q=math", explicit, "default");
  assert.equal(explicit.get("page"), null);
});

test("numbered navigation notifies Next history rather than copying its internal bypass marker", async () => {
  const exports = await import("../src/features/management/management-numbered-state.ts");
  assert.equal(typeof exports.replaceManagementNumberedQuery, "function");
  const updates = [];
  const target = { location: { search: "?q=math&studentId=detail&page=11" }, history: {
    state: { __NA: true },
    replaceState(data, unused, url) { if (!data?.__NA && !data?._N) updates.push({ data, unused, url }); },
  } };
  exports.replaceManagementNumberedQuery(target, "/admin/students", { page: 12, sort: [{ id: "title", desc: false }] });
  assert.equal(updates.length, 1, "Next must receive an external navigation so useSearchParams updates");
  assert.equal(updates[0].data, null);
  const params = new URL(updates[0].url, "https://test.invalid").searchParams;
  assert.equal(params.get("page"), "12"); assert.equal(params.get("studentId"), "detail"); assert.equal(params.get("q"), "math");
});

test("StrictMode mount replay creates a live controller and authorization aborts pending totals", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const { supabase, requests, finish } = transport();
  const { useManagementRecords } = loadHook(supabase);
  let state;
  function Probe({ actor = "A", enabled = true }) {
    const result = useManagementRecords("students", filters, { pageSize: 15, enabled, authorizationScope: actor, page: 11 });
    useEffect(() => { state = result; }, [result]);
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  assert.equal(requests.length, 1); assert.equal(requests[0].args.p_page, 11);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { actor: "B" }))));
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => finish(1, 170));
  await act(async () => finish(0, 500));
  assert.equal(state.totalCount, 170); assert.equal(state.rows.length, 15);
  await act(async () => { state.refresh(); });
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { actor: "B", enabled: false }))));
  assert.equal(requests[2].signal.aborted, true, "disabling list must cancel pending request");
  await act(async () => root.unmount());
});

test("default-period resolution and canonical URL restore issue only one numbered page request", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid/?page=11" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const { supabase, requests, finish } = transport();
  const { useManagementRecords } = loadHook(supabase);
  let state;
  const classFilters = { kind: "classes", search: "math", periodId: null, status: "수강", subject: null, grade: null, teacher: null, classroom: null };
  function Probe({ periodId = null }) {
    const result = useManagementRecords("classes", { ...classFilters, periodId }, { pageSize: 10, enabled: true, authorizationScope: "A", page: 11 });
    useEffect(() => { state = result; }, [result]);
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args.p_filters.periodId, "period-default");
  assert.equal(requests[0].args.p_page, 11);
  await act(async () => finish(0));
  assert.equal(state.effectiveClassPeriodId, "period-default");
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { periodId: "period-default" }))));
  assert.equal(requests.length, 1);
  assert.equal(state.page, 11);
  await act(async () => root.unmount());
});

test("metadata failure stays visible without discarding a successful numbered page", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const { supabase, requests, finish } = transport();
  const rpc = supabase.rpc;
  supabase.rpc = (name, args) => name === "get_management_stats_v1" ? {
    abortSignal() { return this; }, retry: () => Promise.resolve({ data: null, error: new Error("metadata unavailable") }),
  } : rpc(name, args);
  const { useManagementRecords } = loadHook(supabase);
  let state;
  function Probe() {
    const result = useManagementRecords("students", filters, { pageSize: 10, enabled: true, authorizationScope: "A" });
    useEffect(() => { state = result; }, [result]);
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(Probe)));
  assert.equal(requests.length, 1);
  await act(async () => finish(0));
  assert.equal(state.rows.length, 10);
  assert.equal(state.error, "metadata unavailable");
  await act(async () => root.unmount());
});

test("the real table renders server page rows unchanged, routes sort headers and disables derived sorts", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid/?page=11" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  for (const key of ["DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  const router = { replace() {}, push() {} };
  t.after(() => dom.window.close());
  const { ManagementDataTable } = loadHook(null, "src/features/management/management-data-table.tsx", {
    "next/navigation": { useRouter: () => router, usePathname: () => "/classes", useSearchParams: () => new URLSearchParams("page=11") },
  });
  const { normalizeClassManagementRecord } = await import("../src/features/management/records.js");
  const rows = [normalizeClassManagementRecord({ id: "z", name: "Z class", subject: "수학", status: "수강" }), normalizeClassManagementRecord({ id: "a", name: "A class", subject: "수학", status: "수강" })];
  const sorts = [], pages = [], measurements = [];
  const root = createRoot(document.getElementById("root"));
  const props = { kind: "classes", rows, stats: [], loading: false, page: 11, pageSize: 10, totalCount: 102,
    sort: [{ id: "title", desc: false }], displayedScope: "scope", pageSizeMode: "auto", filterOptions: {}, actions: {}, badgeLabel: "과목", statusLabel: "상태", emptyLabel: "수업",
    onPageChange: (page) => pages.push(page), onSortChange: (sort) => sorts.push(sort), onAutoPageSizeChange: (size) => measurements.push(size), onPageSizePreferenceChange() {} };
  await act(async () => root.render(createElement(ManagementDataTable, props)));
  const renderedRows = [...document.querySelectorAll('tr[data-management-row="true"]')];
  assert.equal(renderedRows.length, 2, "server page 11 must not be sliced locally again");
  assert.ok(renderedRows[0].textContent.includes("Z class"), "manualSorting must preserve server order");
  const titleHeader = [...document.querySelectorAll("th")].find((header) => header.textContent.includes("수업명"));
  await act(async () => titleHeader.querySelector("button").click());
  assert.deepEqual(sorts, [[{ id: "title", desc: true }]]);
  const derived = [...document.querySelectorAll("th")].filter((header) => /수강 현황|주간 수업시간/.test(header.textContent));
  assert.equal(derived.length, 2);
  for (const header of derived) assert.equal(header.querySelector('button[aria-label$="정렬"]'), null);
  assert.equal(document.querySelector('button[aria-current="page"]').textContent, "11");
  assert.ok(document.body.textContent.includes("102건 · 101–102번째"));
  assert.ok(document.body.textContent.includes("전체 수업 102개 · 서버 집계"));
  await act(async () => document.querySelector('button[aria-label="이전 페이지"]').click());
  assert.deepEqual(pages, [10]);
  assert.ok(measurements.length > 0, "hidden desktop scrollport must settle auto sizing for mobile cards");
  await act(async () => root.unmount());
});
