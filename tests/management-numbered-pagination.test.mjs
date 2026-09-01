import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { act, createContext, createElement, StrictMode, Suspense, startTransition, useContext, useEffect, useState } from "react";
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
  function finish(index, totalCount = 260, rowOverrides = []) {
    const request = requests[index], { p_page: page, p_page_size: pageSize, p_kind: kind } = request.args;
    request.resolve({ error: null, data: { page, pageSize, totalCount, rows: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) => ({
      kind, id: `row-${page}-${i}`, name: `Row ${page}-${i}`, status: "재원", sortKey: `row-${page}-${i}`, updatedAt: "2026-08-31", grade: null, school: null, contact: null, parentContact: null,
      subject: "수학", title: `Book ${page}-${i}`, publisher: null, price: null, activeClassCount: 0,
      schedule: null, teacherName: null, classroom: null, capacity: null, weeklyMinutes: null, fee: null, studentCount: 0,
      ...rowOverrides[i],
    })) } });
  }
  return { supabase, requests, finish };
}
const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };

async function mountClassConsumer(t, { renderTable = false, deferDefault = false, ...initial } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid/classes?page=11" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ["HTMLElement", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  const io = transport(), defaults = [];
  let defaultPeriod = "period-A", state, query;
  const rpc = io.supabase.rpc;
  io.supabase.rpc = (name, args) => name === "get_management_default_class_period_v1" ? {
    signal: null,
    abortSignal(signal) { this.signal = signal; return this; },
    retry() {
      const pending = Promise.withResolvers();
      defaults.push({ ...pending, signal: this.signal });
      if (!deferDefault) pending.resolve({ data: { periodId: defaultPeriod }, error: null });
      return pending.promise;
    },
  } : rpc(name, args);
  const { useManagementRecords } = loadHook(io.supabase);
  const { ManagementDataTable } = renderTable ? loadHook(io.supabase, "src/features/management/management-data-table.tsx", {
    "next/navigation": { useRouter: () => ({ replace() {}, push() {} }), usePathname: () => "/classes", useSearchParams: () => new URLSearchParams("page=11") },
  }) : {};
  function Probe({ actor = "actor:admin", periodId = null, search = "", sort = [{ id: "title", desc: false }], enabled = true }) {
    const [page, setPage] = useState(11);
    const result = useManagementRecords("classes", { kind: "classes", periodId, search, status: "수강", subject: null, grade: null, teacher: null, classroom: null }, {
      pageSize: 10, enabled, authorizationScope: actor, page, sort, onQueryChange: ({ page }) => setPage(page),
    });
    useEffect(() => { state = result; query = page; }, [result, page]);
    return renderTable ? createElement(ManagementDataTable, { ...result, kind: "classes", displayedScope: result.scope,
      actions: {}, badgeLabel: "과목", statusLabel: "상태", emptyLabel: "수업", onPageChange: result.goToPage, onSortChange: result.setSort }) : null;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  let props = initial;
  const render = async (next = {}) => { props = { ...props, ...next }; await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, props)))); };
  await render();
  return { ...io, defaults, render, get state() { return state; }, get queryPage() { return query; }, setDefault(period) { defaultPeriod = period; } };
}

for (const fixture of [
  { label: "descending titles", sort: [{ id: "title", desc: true }], rows: [{ name: "Z class" }, { name: "A class" }], want: ["Z class", "A class"] },
  { label: "natural numeric titles", sort: [{ id: "title", desc: false }], rows: [{ name: "Class 2" }, { name: "Class 10" }], want: ["Class 2", "Class 10"] },
  { label: "primary teacher and secondary descending titles", sort: [{ id: "teacher", desc: false }, { id: "title", desc: true }],
    rows: [{ name: "Z class", teacherName: "A teacher" }, { name: "Y class", teacherName: "A teacher" }, { name: "A class", teacherName: "B teacher" }], want: ["Z class", "Y class", "A class"] },
]) {
  test(`RPC through real hook and table preserves ${fixture.label}`, async (t) => {
    const page = await mountClassConsumer(t, { renderTable: true, periodId: "period-A", sort: fixture.sort });
    assert.deepEqual(page.requests[0].args.p_sort, fixture.sort);
    await act(async () => page.finish(0, 100 + fixture.rows.length, fixture.rows.map((row) => ({ ...row, studentCount: 3, updatedAt: "2026-08-31T01:00:00Z" }))));
    assert.deepEqual(page.state.rows.map((row) => row.title), fixture.want);
    assert.equal(page.state.rows[0].metrics.studentCount, 3);
    assert.equal(page.state.rows[0].raw.updated_at, "2026-08-31T01:00:00Z");
    const rendered = [...document.querySelectorAll('tr[data-management-row="true"]')];
    assert.equal(rendered.length, fixture.want.length);
    fixture.want.forEach((title, index) => assert.ok(rendered[index].textContent.includes(title)));
    assert.deepEqual(page.state.sort, fixture.sort);
  });
}

test("canonical class period survives default changes, refresh, mutation retry and shrink clamp", async (t) => {
  const page = await mountClassConsumer(t);
  await act(async () => page.finish(0, 102));
  await page.render({ periodId: "period-A" });
  assert.equal(page.requests.length, 1, "canonical URL rerender must not refetch");
  page.setDefault("period-B");
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.requests[1].args.p_filters.periodId, "period-A");
  await act(async () => page.finish(1, 102));
  assert.equal(JSON.parse(page.state.scope).filters.periodId, "period-A");
  await act(async () => { void page.state.reloadRow("outside-page"); });
  assert.equal(page.requests[2].args.p_filters.periodId, "period-A");
  await act(async () => page.finish(2, 102));
  await act(async () => page.state.removeRows(["deleted-row"]));
  assert.equal(page.requests[3].args.p_filters.periodId, "period-A");
  await act(async () => page.finish(3, 100));
  assert.equal(page.requests[4].args.p_filters.periodId, "period-A");
  assert.equal(page.requests[4].args.p_page, 10);
  await act(async () => page.finish(4, 100));
  assert.equal(page.state.page, 10); assert.equal(page.queryPage, 10);
  assert.equal(page.requests.length, 5); assert.equal(page.defaults.length, 1);
});

test("canonical class period is retained even when its first numbered read fails", async (t) => {
  const page = await mountClassConsumer(t);
  await act(async () => page.requests[0].reject(new Error("page unavailable")));
  assert.equal(page.state.error, "page unavailable");
  await page.render({ periodId: "period-A" });
  page.setDefault("period-B");
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.requests[1].args.p_filters.periodId, "period-A");
  assert.equal(page.requests[1].args.p_page, 11);
  await act(async () => page.finish(1, 102));
  assert.equal(page.defaults.length, 1);
  assert.equal(JSON.parse(page.state.scope).filters.periodId, "period-A");
});

test("initial failed class load keeps visible caption and pager unknown, but true zero stays empty", async (t) => {
  const page = await mountClassConsumer(t, { renderTable: true, periodId: "period-A" });
  await act(async () => page.requests[0].reject(new Error("page unavailable")));
  assert.equal(page.state.totalCount, null);
  assert.match(document.querySelector("caption").textContent, /건수 확인 중/);
  assert.doesNotMatch(document.body.textContent, /전체 수업 0개|서버 집계|0건 ·/);
  assert.equal(document.querySelectorAll('button[aria-current="page"]').length, 0);
  for (const label of ["첫 페이지", "이전 페이지", "다음 페이지", "마지막 페이지"]) assert.equal(document.querySelector(`button[aria-label="${label}"]`).disabled, true);
  await act(async () => { void page.state.refresh(); });
  await act(async () => page.finish(1, 0));
  await act(async () => page.finish(2, 0));
  assert.equal(page.state.totalCount, 0);
  assert.match(document.querySelector("caption").textContent, /전체 수업 0개 · 서버 집계/);
  assert.match(document.body.textContent, /0건 · 0–0번째/);
  assert.equal(document.querySelectorAll('button[aria-current="page"]').length, 0);
});

test("default resolution failure is retryable and never pins a missing period", async (t) => {
  const page = await mountClassConsumer(t, { deferDefault: true });
  await act(async () => page.defaults[0].resolve({ data: null, error: new Error("resolver unavailable") }));
  assert.equal(page.state.error, "resolver unavailable");
  assert.equal(page.state.effectiveClassPeriodId, "");
  assert.equal(page.requests.length, 0);
  await act(async () => { void page.state.refresh(); });
  await act(async () => page.defaults[1].resolve({ data: { periodId: "period-B" }, error: null }));
  assert.equal(page.requests[0].args.p_filters.periodId, "period-B");
  await act(async () => page.finish(0, 102));
  assert.equal(JSON.parse(page.state.scope).filters.periodId, "period-B");
});

for (const transition of [
  { label: "filter", props: { search: "changed" } },
  { label: "actor", props: { actor: "other:admin" } },
  { label: "role", props: { actor: "actor:teacher" } },
]) {
  test(`default resolution cannot reuse an old period across a ${transition.label} change`, async (t) => {
    const page = await mountClassConsumer(t, { deferDefault: true });
    await act(async () => page.defaults[0].resolve({ data: { periodId: "period-A" }, error: null }));
    await act(async () => page.finish(0, 102));
    assert.equal(page.state.effectiveClassPeriodId, "period-A");
    await page.render(transition.props);
    assert.equal(page.state.effectiveClassPeriodId, "", "do not canonicalize a new scope using the old resolver result");
    await act(async () => page.defaults[1].resolve({ data: null, error: new Error("new resolver unavailable") }));
    assert.equal(page.state.effectiveClassPeriodId, "");
    await act(async () => { void page.state.refresh(); });
    await act(async () => page.defaults[2].resolve({ data: { periodId: "period-B" }, error: null }));
    assert.equal(page.requests[1].args.p_filters.periodId, "period-B");
    await act(async () => page.finish(1, 102));
    assert.equal(JSON.parse(page.state.scope).filters.periodId, "period-B");
  });
}

for (const transition of [
  { label: "filter", props: { search: "changed" } },
  { label: "actor", props: { actor: "other:admin" } },
  { label: "role", props: { actor: "actor:teacher" } },
  { label: "disabled list", props: { enabled: false } },
]) {
  test(`late default resolver after ${transition.label} change cannot pin or fetch the abandoned period`, async (t) => {
    const page = await mountClassConsumer(t, { deferDefault: true });
    await page.render(transition.props);
    assert.equal(page.defaults[0].signal.aborted, true);
    await act(async () => page.defaults[0].resolve({ data: { periodId: "abandoned-period" }, error: null }));
    assert.equal(page.requests.length, 0);
    assert.equal(page.state.effectiveClassPeriodId, "");
    if (transition.props.enabled === false) await page.render({ enabled: true });
    await act(async () => page.defaults[1].resolve({ data: { periodId: "period-B" }, error: null }));
    assert.equal(page.requests[0].args.p_filters.periodId, "period-B");
    await act(async () => page.finish(0, 102));
    await page.render({ periodId: "period-B" });
    assert.equal(page.requests.length, 1);
    assert.equal(JSON.parse(page.state.scope).filters.periodId, "period-B");
  });
}

async function mountManagementPage(t, { kind = "students", preference = 10, holdNavigation = false, mutationError = null } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: `https://test.invalid/admin/${kind}?page=11` });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ["HTMLElement", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  if (Number.isInteger(preference)) window.localStorage.setItem("tips.data-table-page-size.v1", JSON.stringify({ [`management:${kind}`]: { mode: "manual", pageSize: preference } }));
  const { supabase, requests, finish } = transport();
  const actualService = loadHook(supabase, "src/features/management/management-service.js");
  const mutations = [];
  const navigation = createContext(null);
  const navigationGate = Promise.withResolvers();
  let navigationHeld = holdNavigation;
  const initialSearch = window.location.search;
  let table, setSearch;
  const originalReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data, unused, url) => {
    originalReplace(data, unused, url);
    startTransition(() => setSearch(window.location.search));
  };
  const { ManagementPage } = loadHook(supabase, "src/features/management/management-page.tsx", {
    "@/providers/auth-provider": { useAuth: () => ({ user: { id: "actor" }, role: "admin", loading: false, canManageAll: true }) },
    "next/navigation": {
      usePathname: () => `/admin/${kind}`,
      useSearchParams: () => new URLSearchParams(useContext(navigation)),
      useRouter: () => ({ replace: (url) => window.history.replaceState(null, "", url), push: (url) => window.history.replaceState(null, "", url) }),
    },
    "./management-data-table": { ManagementDataTable(props) { useEffect(() => { table = props; }, [props]); return null; } },
    "./management-service.js": { ...actualService, managementService: {
      ...actualService.managementService,
      deleteTextbook: async (id) => { mutations.push(id); if (mutationError) throw mutationError; return {}; },
    } },
    "@/components/ui/dialog": {
      Dialog: ({ open, children }) => open ? createElement("section", null, children) : null,
      DialogContent: ({ children }) => createElement("div", null, children),
      DialogDescription: ({ children }) => createElement("p", null, children),
      DialogFooter: ({ children }) => createElement("footer", null, children),
      DialogHeader: ({ children }) => createElement("header", null, children),
      DialogTitle: ({ children }) => createElement("h2", null, children),
    },
  });
  function Probe() {
    const [search, updateSearch] = useState(window.location.search);
    useEffect(() => { setSearch = updateSearch; }, []);
    return createElement(Suspense, { fallback: null }, createElement(navigation.Provider, { value: search },
      createElement(NavigationDelay, { search }), createElement(ManagementPage, { kind })));
  }
  function NavigationDelay({ search }) {
    if (navigationHeld && search !== initialSearch) throw navigationGate.promise;
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  return { requests, finish, mutations, get table() { return table; },
    releaseNavigation() { navigationHeld = false; navigationGate.resolve(); },
    navigate: (search) => window.history.replaceState(null, "", `/admin/${kind}${search}`) };
}

test("actual manual size handler never requests old page with the new size during transition URL reset", async (t) => {
  const page = await mountManagementPage(t, { holdNavigation: true });
  await act(async () => page.finish(0));
  await act(async () => page.table.onPageSizePreferenceChange(15));
  assert.deepEqual(page.requests.map((request) => [request.args.p_page, request.args.p_page_size]), [[11, 10], [1, 15]]);
  assert.equal(page.requests[1].signal.aborted, false);
  await act(async () => page.releaseNavigation());
  assert.equal(page.requests.length, 2);
  await act(async () => page.finish(1));
  await act(async () => page.navigate("?page=11"));
  assert.deepEqual(page.requests.map((request) => [request.args.p_page, request.args.p_page_size]), [[11, 10], [1, 15], [11, 15]], "Back/navigation restores page 11 at the selected size");
});

test("management defaults to fixed 10 rows without an automatic measurement callback", async (t) => {
  const page = await mountManagementPage(t, { preference: null });
  assert.deepEqual(page.requests.map((request) => [request.args.p_page, request.args.p_page_size]), [[11, 10]]);
  assert.equal(page.table.pageSizeMode, undefined);
  assert.equal(page.table.onAutoPageSizeChange, undefined);
  await act(async () => page.finish(0));
  assert.equal(page.table.page, 11);
  assert.equal(page.table.rows.length, 10);
});

for (const totalAfter of [101, 100]) {
  test(`actual confirmed deletion has one reconciliation owner (remaining ${totalAfter})`, async (t) => {
    const page = await mountManagementPage(t, { kind: "textbooks" });
    await act(async () => page.finish(0, 102));
    await act(async () => page.table.actions.onDeleteRow(page.table.rows[0]));
    assert.equal(page.mutations.length, 0, "requesting deletion must retain confirmation");
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "삭제");
    assert.ok(confirm);
    await act(async () => confirm.click());
    assert.equal(page.mutations.length, 1);
    assert.equal(page.requests.length, 2, "the confirmed-delete chain must send exactly one refresh");
    assert.equal(page.requests[1].signal.aborted, false);
    assert.equal(page.table.rows.length, 2, "prior successful rows stay until reconciliation succeeds");
    await act(async () => page.finish(1, totalAfter));
    if (totalAfter === 100) {
      assert.equal(page.requests.length, 3); assert.equal(page.requests[2].args.p_page, 10);
      await act(async () => page.finish(2, 100));
      assert.equal(page.table.page, 10);
    } else {
      assert.equal(page.requests.length, 2); assert.equal(page.table.page, 11);
    }
    assert.equal(page.table.totalCount, totalAfter);
  });
}

test("actual confirmed deletion retains rows and does not refresh when the mutation fails", async (t) => {
  const page = await mountManagementPage(t, { kind: "textbooks", mutationError: new Error("delete unavailable") });
  await act(async () => page.finish(0, 102));
  await act(async () => page.table.actions.onDeleteRow(page.table.rows[0]));
  const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "삭제");
  await act(async () => confirm.click());
  assert.equal(page.mutations.length, 1);
  assert.equal(page.requests.length, 1);
  assert.equal(page.table.rows.length, 2);
});

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

test("authorized detail catalogs remain available through metadata failure and clear on role or logout", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const { supabase } = transport();
  const rpc = supabase.rpc, details = [];
  supabase.rpc = (name, args) => name === "get_management_stats_v1" ? {
    abortSignal() { return this; }, retry: () => Promise.resolve({ data: null, error: new Error("stats unavailable") }),
  } : name === "get_management_detail_v1" ? {
    abortSignal() { return this; }, retry: () => new Promise((resolve) => details.push({ args, resolve })),
  } : rpc(name, args);
  const { useManagementRecords } = loadHook(supabase);
  let state;
  const classFilters = { kind: "classes", search: "", periodId: "period", status: "수강", subject: null, grade: null, teacher: null, classroom: null };
  function Probe({ actor = "A", role = "admin" }) {
    const result = useManagementRecords("classes", classFilters, { pageSize: 10, enabled: Boolean(actor), authorizationScope: JSON.stringify([actor, role]) });
    useEffect(() => { state = result; }, [result]);
    return null;
  }
  function resolveDetail(index, teacher) {
    details[index].resolve({ error: null, data: { kind: "classes", record: { id: details[index].args.p_id, name: "Class", subject: "수학", status: "수강" },
      formReferences: { teacherCatalogs: [{ id: teacher, name: teacher }], classroomCatalogs: [{ id: "room", name: "room" }], scienceSubjectAreas: [{ key: "physics", label: "물리" }] } } });
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); });
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  let detail;
  await act(async () => { detail = state.loadDetail("outside-page"); });
  await act(async () => { resolveDetail(0, "teacher-A"); await detail; });
  assert.equal(state.classFormReferences.teacherCatalogs.length, 1);
  assert.equal(state.classFormReferences.classroomCatalogs.length, 1);
  assert.equal(state.classFormReferences.scienceSubjectAreas.length, 1);
  assert.equal(state.error, "stats unavailable");
  const oldLoadDetail = state.loadDetail;
  let staleDetail;
  await act(async () => { staleDetail = state.loadDetail("stale-A"); });
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { role: "teacher" }))));
  assert.equal(state.classFormReferences.teacherCatalogs.length, 0);
  await act(async () => { detail = state.loadDetail("current-role"); });
  await act(async () => { resolveDetail(2, "teacher-current-role"); await detail; });
  assert.equal(state.classFormReferences.teacherCatalogs[0].id, "teacher-current-role");
  await act(async () => { resolveDetail(1, "stale-teacher-A"); await staleDetail; });
  assert.equal(state.classFormReferences.teacherCatalogs[0].id, "teacher-current-role", "late old-role detail must not erase the current catalogs");
  await act(async () => { void oldLoadDetail("old-callback"); });
  assert.equal(details.length, 3, "old-role detail callback must not issue a request in the new authorization scope");
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { actor: null, role: "viewer" }))));
  assert.equal(state.classFormReferences.teacherCatalogs.length, 0);
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
  const sorts = [], pages = [];
  const root = createRoot(document.getElementById("root"));
  const props = { kind: "classes", rows, stats: [], loading: false, page: 11, pageSize: 10, totalCount: 102,
    sort: [{ id: "title", desc: false }], displayedScope: "scope", filterOptions: {}, actions: {}, badgeLabel: "과목", statusLabel: "상태", emptyLabel: "수업",
    onPageChange: (page) => pages.push(page), onSortChange: (sort) => sorts.push(sort), onPageSizePreferenceChange() {} };
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
  await act(async () => root.render(createElement(ManagementDataTable, { ...props, loading: true })));
  assert.equal(document.querySelectorAll('tr[data-management-row="true"]').length, 2, "page navigation must retain the previous rows while loading");
  assert.doesNotMatch(document.body.textContent, /수업 불러오는 중|수업 데이터를 불러오는 중/);
  await act(async () => root.unmount());
});
