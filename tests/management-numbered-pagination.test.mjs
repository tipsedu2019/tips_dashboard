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
import { normalizeStudentManagementRecord } from "../src/features/management/records.js";
import { normalizeStudentStatusFilter } from "../src/features/management/student-enrollment-status.js";

import { createManagementReadService, getAssignedClassTextbookIds } from "../src/features/management/management-service.js";

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
  const requests = [], allCalls = [];
  let detail = null;
  const supabase = { rpc(name, args) {
    allCalls.push({ name, args });
    let signal;
    return { abortSignal(value) { signal = value; return this; }, retry() {
      if (name === "get_management_stats_v1") return Promise.resolve({ data: { total: 260 }, error: null });
      if (name === "list_management_filter_options_v1") return Promise.resolve({ data: {}, error: null });
      if (name === "get_management_detail_v1") return Promise.resolve({ data: detail ?? { kind: args.p_kind, record: { id: args.p_id, name: "Independent detail", status: "재원", storedStatus: "재원", registeredCount: 1, waitlistCount: 0 } }, error: null });
      if (name === "get_management_default_class_period_v1") return Promise.resolve({ data: { periodId: "period-default" }, error: null });
      return new Promise((resolve, reject) => requests.push({ name, args, signal, resolve, reject }));
    } };
  } };
  function finish(index, totalCount = 260, rowOverrides = []) {
    const request = requests[index], { p_page: page, p_page_size: pageSize, p_kind: kind } = request.args;
    request.resolve({ error: null, data: { page, pageSize, totalCount, rows: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) => ({
      kind, id: `row-${page}-${i}`, name: `Row ${page}-${i}`, status: "재원", storedStatus: "재원", registeredCount: 1, waitlistCount: 0, sortKey: `row-${page}-${i}`, updatedAt: "2026-08-31", grade: null, school: null, contact: null, parentContact: null,
      subject: "수학", title: `Book ${page}-${i}`, publisher: null, price: null, activeClassCount: 0,
      schedule: null, teacherName: null, classroom: null, capacity: null, weeklyMinutes: null, fee: null, studentCount: 0,
      ...rowOverrides[i],
    })) } });
  }
  return { supabase, requests, finish, allCalls, setDetail(value) { detail = value; } };
}
const filters = { kind: "students", search: "", status: null, schoolCategory: null, school: null, grade: null };

test("student classification uses full server counts and preserves legacy write status", () => {
  for (const [registeredCount, waitlistCount, expected] of [[1,0,"재원"],[0,1,"대기"],[0,0,"퇴원"],[35,4,"재원"]]) {
    const row = normalizeStudentManagementRecord({ id: "student", name: "합성 학생", storedStatus: "퇴원", status: expected,
      registeredCount, waitlistCount, class_ids: [], waitlist_class_ids: [] });
    assert.equal(row.status, expected);
    assert.equal(row.raw.status, "퇴원");
    assert.equal(row.metrics.classCount, registeredCount);
    assert.equal(row.metrics.waitlistCount, waitlistCount);
  }
  for (const value of [null, undefined, "", "all", "전체 상태", "등록 진행"]) assert.equal(normalizeStudentStatusFilter(value), "재원");
});

test("student page defaults to enrolled, offers exactly three statuses, and resets to enrolled", async (t) => {
  const page = await mountManagementPage(t, { renderTable: true, initialQuery: "status=all" });
  assert.equal(page.requests[0].args.p_filters.status, "재원");
  await act(async () => page.finish(0, 1, [{ name: "합성 학생", registeredCount: 2, waitlistCount: 1 }]));
  assert.match(document.querySelector('tr[data-management-row="true"]').textContent, /합성 학생/);
  assert.ok(document.querySelector('[aria-label="합성 학생 등록 수업 2개 보기"]'));
  assert.ok(document.querySelector('[aria-label="합성 학생 대기 수업 1개 보기"]'));
  const status = document.querySelector('#student-status-filter');
  await act(async () => status.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  assert.deepEqual([...document.querySelectorAll('[role="option"]')].map((el) => el.textContent), ["재원","대기","퇴원"]);
  await act(async () => document.querySelector('[role="listbox"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => page.navigate("?status=대기&page=1"));
  assert.equal(page.requests.at(-1).args.p_filters.status, "대기");
  await act(async () => page.finish(page.requests.length - 1, 1, [{ status: "대기", registeredCount: 0, waitlistCount: 2 }]));
  const reset = [...document.querySelectorAll("button")].find((el) => el.textContent === "조건 초기화");
  assert.ok(reset);
  await act(async () => reset.click());
  assert.equal(page.requests.at(-1).args.p_filters.status, "재원");
  assert.equal(page.requests.at(-1).args.p_page, 1);
});

test("student enrollment popover loads on demand, retries and reaches the next relation page", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ["HTMLElement", "Element", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const { StudentEnrollmentStatusCell } = loadHook({}, "src/features/management/student-enrollment-status-cell.tsx");
  const row = normalizeStudentManagementRecord({ id: "student", name: "합성 학생", registeredCount: 30, waitlistCount: 1 });
  const requests = [];
  const onLoad = (id, cursor) => { const pending = Promise.withResolvers(); requests.push({ id, cursor, ...pending }); return pending.promise; };
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(createElement(StudentEnrollmentStatusCell, { row, onLoad })));
  assert.equal(requests.length, 0);
  await act(async () => document.querySelector('[aria-label="합성 학생 대기 수업 1개 보기"]').click());
  assert.equal(requests.length, 1); assert.equal(requests[0].cursor, null);
  await act(async () => requests[0].reject(new Error("offline")));
  assert.match(document.querySelector('[role="alert"]').textContent, /불러오지 못했습니다/);
  await act(async () => [...document.querySelectorAll("button")].find((el) => el.textContent === "다시 시도").click());
  await act(async () => requests[1].resolve({ rows: Array.from({ length: 30 }, (_, i) => ({ classId: `class-${i}`, status: "enrolled", className: `등록 ${i}` })), nextCursor: "opaque-next", hasMore: true }));
  await act(async () => [...document.querySelectorAll("button")].find((el) => el.textContent === "수업 더 불러오기").click());
  assert.equal(requests[2].cursor, "opaque-next");
  await act(async () => requests[2].resolve({ rows: [{ classId: "waiting", status: "waitlisted", className: "마지막 대기 수업" }], nextCursor: null, hasMore: false }));
  assert.match(document.querySelector('[role="dialog"]').textContent, /마지막 대기 수업/);
  assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /등록 0/);
});

async function mountClassConsumer(t, { renderTable = false, deferDefault = false, ...initial } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid/classes?page=11" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ["HTMLElement", "Element", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.matchMedia = (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
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
      actions: { onLoadClassRoster: result.loadClassRosterPreview }, badgeLabel: "과목", statusLabel: "상태", emptyLabel: "수업", onPageChange: result.goToPage, onSortChange: result.setSort }) : null;
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

test("retired class periods stay ignored across refresh, mutation retry and shrink clamp", async (t) => {
  const page = await mountClassConsumer(t);
  await act(async () => page.finish(0, 102));
  await page.render({ periodId: "period-A" });
  assert.equal(page.requests.length, 1, "retired period URL rerender must not refetch");
  page.setDefault("period-B");
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.requests[1].args.p_filters.periodId, null);
  await act(async () => page.finish(1, 102));
  assert.equal(JSON.parse(page.state.scope).filters.periodId, null);
  await act(async () => { void page.state.reloadRow("outside-page"); });
  assert.equal(page.requests[2].args.p_filters.periodId, null);
  await act(async () => page.finish(2, 102));
  await act(async () => page.state.removeRows(["deleted-row"]));
  assert.equal(page.requests[3].args.p_filters.periodId, null);
  await act(async () => page.finish(3, 100));
  assert.equal(page.requests[4].args.p_filters.periodId, null);
  assert.equal(page.requests[4].args.p_page, 10);
  await act(async () => page.finish(4, 100));
  assert.equal(page.state.page, 10); assert.equal(page.queryPage, 10);
  assert.equal(page.requests.length, 5); assert.equal(page.defaults.length, 0);
});

test("class page failure is retryable without resolving a default period", async (t) => {
  const page = await mountClassConsumer(t);
  await act(async () => page.requests[0].reject(new Error("page unavailable")));
  assert.equal(page.state.error, "page unavailable");
  await page.render({ periodId: "period-A" });
  page.setDefault("period-B");
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.requests[1].args.p_filters.periodId, null);
  assert.equal(page.requests[1].args.p_page, 11);
  await act(async () => page.finish(1, 102));
  assert.equal(page.defaults.length, 0);
  assert.equal(JSON.parse(page.state.scope).filters.periodId, null);
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

test("class pages load even when no default period is available", async (t) => {
  const page = await mountClassConsumer(t, { deferDefault: true, periodId: "retired-period" });
  assert.equal(page.defaults.length, 0);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].args.p_filters.periodId, null);
  await act(async () => page.finish(0, 102));
  assert.equal(page.state.error, null);
  assert.equal(page.state.rows.length, 2);
});

for (const transition of [
  { label: "filter", props: { search: "changed" } },
  { label: "actor", props: { actor: "other:admin" } },
  { label: "role", props: { actor: "actor:teacher" } },
  { label: "disabled list", props: { enabled: false } },
]) {
  test(`late class results after ${transition.label} changes cannot overwrite the current scope`, async (t) => {
    const page = await mountClassConsumer(t, { deferDefault: true, periodId: "retired-period" });
    await page.render(transition.props);
    assert.equal(page.requests[0].signal.aborted, true);
    await act(async () => page.finish(0, 102, [{ name: "Abandoned class" }]));
    assert.equal(page.state.rows.length, 0);
    if (transition.props.enabled === false) await page.render({ enabled: true });
    assert.equal(page.requests[1].args.p_filters.periodId, null);
    await act(async () => page.finish(1, 102, [{ name: "Current class" }]));
    assert.equal(page.state.rows[0].title, "Current class");
    await page.render({ periodId: "another-retired-period" });
    assert.equal(page.requests.length, 2);
    assert.equal(page.defaults.length, 0);
    assert.equal(JSON.parse(page.state.scope).filters.periodId, null);
  });
}

async function mountManagementPage(t, { kind = "students", preference = 10, holdNavigation = false, mutationError = null, renderTable = false, initialQuery = "page=11", columnPreferences = null } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: `https://test.invalid/admin/${kind}?${initialQuery}` });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ["HTMLElement", "Element", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  if (Number.isInteger(preference)) window.localStorage.setItem("tips.data-table-page-size.v1", JSON.stringify({ [`management:${kind}`]: { mode: "manual", pageSize: preference } }));
  if (columnPreferences) window.localStorage.setItem(`tips-management-table:${kind}:v14`, JSON.stringify(columnPreferences));
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
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.matchMedia = (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const navigationModule = {
    usePathname: () => `/admin/${kind}`,
    useSearchParams: () => new URLSearchParams(useContext(navigation)),
    useRouter: () => ({ replace: (url) => window.history.replaceState(null, "", url), push: (url) => window.history.replaceState(null, "", url) }),
  };
  const RealTable = renderTable ? loadHook(supabase, "src/features/management/management-data-table.tsx", { "next/navigation": navigationModule }).ManagementDataTable : null;
  const { ManagementPage } = loadHook(supabase, "src/features/management/management-page.tsx", {
    "@/providers/auth-provider": { useAuth: () => ({ user: { id: "actor" }, role: "admin", loading: false, canManageAll: true }) },
    "next/navigation": {
      usePathname: () => `/admin/${kind}`,
      useSearchParams: () => new URLSearchParams(useContext(navigation)),
      useRouter: () => ({ replace: (url) => window.history.replaceState(null, "", url), push: (url) => window.history.replaceState(null, "", url) }),
    },
    "./management-data-table": { ManagementDataTable(props) { useEffect(() => { table = props; }, [props]); return renderTable ? createElement(RealTable, props) : null; } },
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

test("filter changes reset page atomically, while retired period parameters preserve restore", async () => {
  const exports = await import("../src/features/management/management-numbered-state.ts");
  assert.equal(typeof exports.resetManagementPageForFilters, "function");
  const changed = new URLSearchParams("q=new&page=11&studentId=detail&sort=%5B%5D");
  exports.resetManagementPageForFilters("students", "q=old&page=11&studentId=detail&sort=%5B%5D", changed);
  assert.equal(changed.get("page"), null); assert.equal(changed.get("studentId"), "detail");
  const unchanged = new URLSearchParams("q=old&page=11");
  exports.resetManagementPageForFilters("students", "q=old&page=11", unchanged);
  assert.equal(unchanged.get("page"), "11");
  const canonical = new URLSearchParams("page=11&period=default&q=math");
  exports.resetManagementPageForFilters("classes", "page=11&q=math", canonical);
  assert.equal(canonical.get("page"), "11");
  const explicit = new URLSearchParams("page=11&period=next&q=math");
  exports.resetManagementPageForFilters("classes", "page=11&period=old&q=math", explicit);
  assert.equal(explicit.get("page"), "11");
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

test("retired period URL cleanup issues only one numbered page request", async (t) => {
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
  assert.equal(requests[0].args.p_filters.periodId, null);
  assert.equal(requests[0].args.p_page, 11);
  await act(async () => finish(0));
  assert.equal(JSON.parse(state.scope).filters.periodId, null);
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

test("form catalogs load independently and ignore closed, old-role and late detail responses", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const { supabase } = transport();
  const rpc = supabase.rpc, details = [], catalogs = [];
  supabase.rpc = (name, args) => name === "get_management_stats_v1" ? {
    abortSignal() { return this; }, retry: () => Promise.resolve({ data: null, error: new Error("stats unavailable") }),
  } : name === "get_management_detail_v1" ? {
    abortSignal() { return this; }, retry: () => new Promise((resolve) => details.push({ args, resolve })),
  } : rpc(name, args);
  const { useManagementRecords } = loadHook(supabase, undefined, {
    "./management-service.js": { getAssignedClassTextbookIds, createManagementReadService: options => ({
      ...createManagementReadService(options),
      loadClassFormReferences: ({ signal }) => new Promise((resolve, reject) => catalogs.push({ signal, resolve, reject })),
    }) },
  });
  let state;
  const classFilters = { kind: "classes", search: "", periodId: null, status: "수강", subject: null, grade: null, teacher: null, classroom: null };
  function Probe({ actor = "A", role = "admin", open = true, page = 1 }) {
    const result = useManagementRecords("classes", classFilters, { pageSize: 10, enabled: Boolean(actor), classFormOpen: open, page, authorizationScope: JSON.stringify([actor, role]) });
    useEffect(() => { state = result; }, [result]);
    return null;
  }
  const refs = name => ({ teacherCatalogs: [{ id: name, name }], classroomCatalogs: [{ id: "room", name: "room" }], scienceSubjectAreas: [] });
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  const render = props => act(async () => root.render(createElement(StrictMode, null, createElement(Probe, props))));
  await render({ open: false });
  assert.equal(catalogs.length, 0, "listing does not fetch form catalogs");
  await render({});
  assert.equal(state.classFormReferencesStatus, "loading");
  await act(async () => catalogs.at(-1).resolve(refs("active-with-no-class")));
  assert.equal(state.classFormReferencesStatus, "ready");
  assert.equal(state.classFormReferences.teacherCatalogs[0].name, "active-with-no-class");
  assert.equal(state.error, "stats unavailable");
  const count = catalogs.length;
  await render({ page: 2 });
  assert.equal(catalogs.length, count, "pagination does not change form catalogs");
  const oldLoadDetail = state.loadDetail;
  let detail;
  await act(async () => { detail = state.loadDetail("outside-page"); });
  await act(async () => {
    details[0].resolve({ data: { kind: "classes", record: { id: "outside-page", name: "Class", subject: "수학" }, formReferences: refs("stale-detail") } });
    await detail;
  });
  assert.equal(state.classFormReferences.teacherCatalogs[0].name, "active-with-no-class");
  await render({ role: "teacher" });
  assert.equal(state.classFormReferences.teacherCatalogs.length, 0);
  const oldRole = catalogs.at(-1);
  await render({ role: "staff" });
  assert.equal(oldRole.signal.aborted, true);
  await act(async () => catalogs.at(-1).resolve(refs("staff-catalog")));
  await act(async () => oldRole.resolve(refs("late-teacher-catalog")));
  assert.equal(state.classFormReferences.teacherCatalogs[0].name, "staff-catalog");
  await act(async () => { await oldLoadDetail("old-callback"); });
  assert.equal(details.length, 1, "old-role detail callback issues no request");
  await render({ role: "staff", open: false });
  assert.equal(state.classFormReferences.teacherCatalogs[0].name, "staff-catalog", "closing preserves the last complete context for existing bulk edits");
  await render({ role: "staff" });
  const closed = catalogs.at(-1);
  await render({ role: "staff", open: false });
  assert.equal(closed.signal.aborted, true);
  await render({ role: "staff" });
  await act(async () => catalogs.at(-1).reject(new Error("offline")));
  assert.equal(state.classFormReferencesStatus, "error");
  await act(async () => state.retryClassFormReferences());
  assert.equal(state.classFormReferencesStatus, "loading");
  await act(async () => catalogs.at(-1).resolve(refs("manual-retry")));
  await act(async () => closed.resolve(refs("closed-form-response")));
  assert.equal(state.classFormReferences.teacherCatalogs[0].name, "manual-retry");
  await render({ actor: null, role: "viewer" });
  assert.equal(state.classFormReferences.teacherCatalogs.length, 0);
});

test("the real table renders server page rows unchanged, routes sort headers and disables derived sorts", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid/?page=11" });
  // Weekly hours is optional in the recommended layout. Make it visible to
  // exercise both derived columns without changing the production defaults.
  dom.window.localStorage.setItem("tips-management-table:classes:v14", JSON.stringify({ columnVisibility: { weeklyHours: true } }));
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  for (const key of ["DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.matchMedia = (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
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

test("new student enrollment column preserves saved visibility, size and order", async (t) => {
  const page = await mountManagementPage(t, { renderTable: true, initialQuery: "", columnPreferences: {
    version: 14, columnOrder: ["select","title","school","grade","contact","parentContact","status","action"],
    columnSizing: { title: 240, status: 88 }, columnVisibility: { school: false }, sorting: [], grouping: [],
  } });
  await act(async () => page.finish(0, 1));
  const headers = [...document.querySelectorAll("thead th")];
  assert.deepEqual(headers.slice(-3).map(el => el.textContent), ["재원 상태","수강 현황","작업"]);
  assert.equal(headers[1].style.width, "240px");
  assert.equal(headers.at(-3).style.width, "88px");
  assert.ok(!headers.some(el => el.textContent === "학교"));
});

test("class detail totals remain exact beyond the 30-row relation page and missing totals stay unknown", async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/admin/classes'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  const io=transport(), rpc=io.supabase.rpc;
  let total, state;
  io.supabase.rpc=(name,args)=> name==='get_management_detail_v1'?{abortSignal(){return this},retry:async()=>({error:null,data:{kind:'classes',record:{id:args.p_id,name:'합성 수업',subject:'영어',status:'수강'},registeredCount:total,waitlistCount:total,registeredStudents:{page:{rows:Array.from({length:Math.min(total??30,30)},(_,i)=>({id:`student-${i}`,name:`학생 ${i}`})),hasMore:(total??31)>30}},waitlistedStudents:{page:{rows:[],hasMore:false}}}})}:rpc(name,args);
  const {useManagementRecords}=loadHook(io.supabase);
  function Probe(){const value=useManagementRecords('classes',{kind:'classes',search:'',periodId:'period',status:'수강',subject:null,grade:null,teacher:null,classroom:null},{pageSize:10,authorizationScope:'synthetic:admin'});useEffect(()=>{state=value},[value]);return null}
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close()});
  await act(async()=>root.render(createElement(Probe)));
  for(total of [0,30,31,65,undefined]) {
    let detail;
    await act(async()=>{detail=await state.loadDetail('class')});
    assert.equal(detail.raw.registered_count,total);
    assert.equal(detail.raw.waitlist_count,total);
    assert.ok(detail.raw.student_ids.length<=30,'detail must not replace paging with an unbounded roster');
  }
});


test("public memo detail hydration preserves explicit empty values and supports legacy DTOs", async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/classes' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const io = transport(), rpc = io.supabase.rpc;
  let record, state;
  io.supabase.rpc = (name, args) => name === 'get_management_detail_v1' ? {
    abortSignal() { return this; }, retry: async () => ({ error: null, data: { kind: 'classes', record: { id: args.p_id, name: '합성 수업', status: '수강', ...record }, registeredStudents: { rows: [] }, waitlistedStudents: { rows: [] } } }),
  } : rpc(name, args);
  const { useManagementRecords } = loadHook(io.supabase);
  function Probe() {
    const value = useManagementRecords('classes', { kind: 'classes', search: '', periodId: 'period', status: '수강', subject: null, grade: null, teacher: null, classroom: null }, { pageSize: 10, authorizationScope: 'synthetic:memo' });
    useEffect(() => { state = value; }, [value]); return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(createElement(Probe)));
  for (const [fields, expected] of [[{ publicMemo: '공개 안내 ✨' }, '공개 안내 ✨'], [{ public_memo: '', publicMemo: 'stale' }, ''], [{ memo: 'PRIVATE' }, '']]) {
    record = fields;
    let detail;
    await act(async () => { detail = await state.loadDetail('class'); });
    assert.equal(detail.raw.public_memo, expected);
  }
});

test("metadata survives paging cancellation, expires and invalidates on filter, refresh and actor changes", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const io = transport(), rpc = io.supabase.rpc, metadata = [];
  io.supabase.rpc = (name, args) => {
    if (!['get_management_stats_v1', 'list_management_filter_options_v1'].includes(name)) return rpc(name, args);
    const pending = Promise.withResolvers();
    const request = { name, args, ...pending }; metadata.push(request);
    return { abortSignal(signal) { request.signal = signal; return this; }, retry() { return pending.promise; } };
  };
  const { useManagementRecords } = loadHook(io.supabase);
  let state, now = 1000;
  const originalNow = Date.now; Date.now = () => now;
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { Date.now = originalNow; await act(async () => root.unmount()); dom.window.close(); });
  function Probe({ page = 1, search = '', actor = 'A', pageSize = 10, sort }) {
    const result = useManagementRecords('students', { ...filters, search }, { page, pageSize, sort, authorizationScope: actor, enabled: true });
    useEffect(() => { state = result; }); return null;
  }
  const render = (props = {}) => act(async () => root.render(createElement(Probe, props)));
  await render();
  for (let page = 2; page <= 5; page++) await render({ page });
  assert.equal(metadata.length, 2, 'five pages need five page reads and one metadata pair');
  assert.equal(io.requests.length, 5);
  assert.equal(io.requests[0].signal.aborted, true);
  assert.equal(metadata[0].signal.aborted, false, 'metadata is independent from page cancellation');
  await act(async () => {
    metadata[0].resolve({ data: { total: 260 }, error: null });
    metadata[1].resolve({ data: { schools: ['합성 학교'] }, error: null });
    io.finish(4);
  });
  assert.deepEqual(state.filterOptions.schools, ['합성 학교']);
  await render({ pageSize: 15, sort: [{ id: 'school', desc: true }] });
  assert.equal(metadata.length, 2);
  now += 30_001;
  await render({ page: 2 });
  assert.equal(metadata.length, 4, 'expired metadata revalidates');
  await render({ search: 'new' });
  assert.equal(metadata[2].signal.aborted, true, 'obsolete filters are canceled');
  assert.equal(metadata.length, 6);
  await act(async () => { state.refresh(); });
  assert.equal(metadata[4].signal.aborted, true);
  assert.equal(metadata.length, 8, 'explicit refresh invalidates metadata');
  await render({ actor: 'B' });
  assert.equal(metadata[6].signal.aborted, true);
  assert.deepEqual(state.filterOptions, {}, 'old actor metadata never leaks');
  await act(async () => metadata[6].resolve({ data: { total: 999 }, error: null }));
  await act(async () => metadata[7].resolve({ data: { secret: true }, error: null }));
  assert.deepEqual(state.filterOptions, {});
});

test("auth-blocked metadata and catalogs leave loading, require explicit retry and reject late values", async t => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://test.invalid" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const deadlines = [];
  t.mock.method(AbortSignal, "timeout", ms => {
    assert.equal(ms, 8000);
    const controller = new AbortController(); deadlines.push(controller); return controller.signal;
  });
  const io = transport(), rpc = io.supabase.rpc, held = [], catalogCalls = [];
  let fresh = false;
  const refs = [{ id: "fresh", name: "새 후보", subjects: ["영어팀"], is_visible: true, sort_order: 0 }];
  function query(name) {
    const pending = Promise.withResolvers(), request = { name, ...pending };
    held.push(request);
    return { abortSignal(signal) { request.signal = signal; return this; }, retry() { return fresh ? Promise.resolve({ data: name === "get_management_stats_v1" ? { total: 1 } : name === "list_management_filter_options_v1" ? { schools: ["새 학교"] } : [] }) : pending.promise; } };
  }
  io.supabase.rpc = (name, args) => name === "list_management_numbered_page_v1" ? rpc(name, args) : query(name);
  io.supabase.from = name => {
    catalogCalls.push(name);
    const pending = Promise.withResolvers(), request = { name, ...pending }; held.push(request);
    return { select() { return this; }, eq() { return this; }, range() { return this; }, limit() { return this; }, order() { return this; }, abortSignal(signal) { request.signal = signal; return this; }, retry() { return fresh ? Promise.resolve({ data: refs }) : pending.promise; } };
  };
  const { useManagementRecords } = loadHook(io.supabase, undefined, { "./management-service.js": {
    getAssignedClassTextbookIds, createManagementReadService: () => createManagementReadService({ supabase: io.supabase }),
  } });
  let state;
  function Probe({ tick = 0 }) {
    const result = useManagementRecords("classes", { kind: "classes", search: "", periodId: null, status: "수강", subject: null, grade: null, teacher: null, classroom: null }, {
      enabled: true, pageSize: 10, page: 1, authorizationScope: "fixture:admin", classFormOpen: true,
    });
    useEffect(() => { state = result; }); return createElement("span", null, tick);
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(createElement(Probe)));
  await act(async () => io.finish(0, 1));
  const initialCalls = held.length;
  await act(async () => { for (const timer of deadlines) timer.abort(new DOMException("timeout", "TimeoutError")); });
  assert.equal(state.loading, false);
  assert.equal(state.rows.length, 1, "successful rows survive metadata timeout");
  assert.equal(state.classFormReferencesStatus, "error");
  assert.match(state.error, /서버 연결이 지연/);
  for (let tick = 1; tick <= 25; tick++) await act(async () => root.render(createElement(Probe, { tick })));
  assert.equal(held.length, initialCalls, "error re-renders never retry automatically");
  const old = held.slice(); fresh = true;
  await act(async () => { state.retryClassFormReferences(); void state.refresh(); });
  await act(async () => io.finish(1, 1));
  assert.equal(state.classFormReferencesStatus, "ready");
  assert.equal(state.classFormReferences.teacherCatalogs[0].id, "fresh");
  assert.deepEqual(state.filterOptions, { schools: ["새 학교"] });
  assert.equal(state.error, null);
  await act(async () => { for (const request of old) request.resolve({ data: request.name === "get_management_stats_v1" ? { total: 999 } : request.name === "list_management_filter_options_v1" ? { schools: ["오래된 학교"] } : [{ id: "late", name: "늦은 후보" }] }); });
  assert.equal(state.classFormReferences.teacherCatalogs[0].id, "fresh");
  assert.deepEqual(state.filterOptions, { schools: ["새 학교"] });
  assert.equal(catalogCalls.length, 4, "one initial pair plus one manual retry pair");
});


test("class roster preview producer preserves page continuation through the real hook and read service", async t => {
  const page = await mountClassConsumer(t);
  await act(async () => page.finish(0, 1));
  const relationCalls = [], existingRpc = page.supabase.rpc;
  const registered = Array.from({ length: 35 }, (_, index) => ({ id: `synthetic-registered-${index + 1}`, name: `합성 등록 ${String(index + 1).padStart(3, "0")}` }));
  const waitlisted = Array.from({ length: 7 }, (_, index) => ({ id: `synthetic-waiting-${index + 1}`, name: `합성 대기 ${String(index + 1).padStart(3, "0")}` }));
  page.supabase.rpc = (name, args) => {
    if (name !== "list_management_detail_relation_page_v1") return existingRpc(name, args);
    relationCalls.push({ name, args });
    const waiting = args.p_relation_kind === "waitlisted_students";
    const more = args.p_cursor_id !== null;
    const rows = waiting ? waitlisted : more ? registered.slice(30) : registered.slice(0, 30);
    return { abortSignal() { return this; }, retry() { return Promise.resolve({ error: null, data: { page: {
      rows, hasMore: !waiting && !more,
      nextCursor: !waiting && !more ? { sortValue: registered[29].name, id: registered[29].id } : null,
    } } }); } };
  };
  const first = await page.state.loadClassRosterPreview({ classId: "synthetic-class", mode: "registered", cursor: null });
  assert.equal(first?.hasMore, true, "the hook must retain the continuation instead of returning only the first 30 rows");
  assert.equal(first.rows.length, 30);
  assert.equal(typeof first.nextCursor, "string");
  const next = await page.state.loadClassRosterPreview({ classId: "synthetic-class", mode: "registered", cursor: first.nextCursor });
  assert.deepEqual(next.rows, registered.slice(30));
  assert.equal(next.hasMore, false);
  assert.equal(next.nextCursor, null);
  const waiting = await page.state.loadClassRosterPreview({ classId: "synthetic-class", mode: "waitlist", cursor: null });
  assert.deepEqual(waiting.rows, waitlisted);
  assert.equal(waiting.hasMore, false);
  assert.deepEqual(relationCalls.map(call => call.name), Array(3).fill("list_management_detail_relation_page_v1"));
  assert.deepEqual(relationCalls.map(({ args }) => args.p_limit), [30, 30, 30]);
  assert.deepEqual(relationCalls.map(({ args }) => args.p_relation_kind), ["registered_students", "registered_students", "waitlisted_students"]);
  assert.deepEqual(relationCalls.map(({ args }) => args.p_cursor_id), [null, registered[29].id, null]);
  assert.deepEqual(relationCalls.map(({ args }) => args.p_cursor_sort_key), [null, registered[29].name, null]);
  assert.ok(relationCalls.every(({ args }) => args.p_kind === "classes" && args.p_id === "synthetic-class"));
});

// Real hook + real table. Only readonly transport/auth-independent navigation are synthetic.
async function mountManagementReadFeedback(t, { kind = "students", initialQuery = "", metadataError = null } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: `https://test.invalid/admin/${kind}?${initialQuery}` });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ["HTMLElement", "Element", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "HTMLInputElement", "HTMLSelectElement"]) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.matchMedia = (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // react-dom was imported before JSDOM; its legacy input-event probe uses these in focus tests.
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const io = transport(), rpc = io.supabase.rpc;
  io.supabase.rpc = (name, args) => name === "get_management_stats_v1" ? {
    abortSignal() { return this; }, retry() { return Promise.resolve({ data: metadataError ? null : { total: 2 }, error: metadataError }); },
  } : rpc(name, args);
  const { useManagementRecords } = loadHook(io.supabase);
  const navigation = createContext("");
  let updateQuery, state, created = 0, writes = 0;
  const originalReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data, unused, url) => { originalReplace(data, unused, url); updateQuery?.(window.location.search); };
  const { ManagementDataTable } = loadHook(io.supabase, "src/features/management/management-data-table.tsx", {
    "next/navigation": {
      usePathname: () => `/admin/${kind}`,
      useSearchParams: () => new URLSearchParams(useContext(navigation)),
      useRouter: () => ({ replace: (url) => window.history.replaceState(null, "", url), push: (url) => window.history.replaceState(null, "", url) }),
    },
  });
  const actions = { onCreate: () => { created += 1; }, onBulkUpdateRows: () => { writes += 1; throw new Error("unexpected synthetic write"); } };
  function Probe() {
    const params = new URLSearchParams(useContext(navigation)), search = params.get("q") || "";
    const [page, setPage] = useState(1);
    const listFilters = kind === "students" ? { ...filters, search, status: "재원" } : { kind, search, periodId: null, status: "수강", subject: null, grade: null, teacher: null, classroom: null };
    const result = useManagementRecords(kind, listFilters, { pageSize: 10, page, enabled: true, authorizationScope: "synthetic:admin", onQueryChange: ({ page }) => setPage(page) });
    useEffect(() => { state = result; }, [result]);
    return createElement(ManagementDataTable, { ...result, kind, displayedScope: result.scope,
      actions, badgeLabel: "과목", statusLabel: "상태", emptyLabel: kind === "students" ? "학생" : "수업",
      onPageChange: result.goToPage, onSortChange: result.setSort, onPageSizePreferenceChange() {},
      readError: result.error, readErrorSource: result.errorSource, onRetryRead: () => { void result.refresh(); } });
  }
  function Wrapper() {
    const [query, setQuery] = useState(window.location.search);
    useEffect(() => { updateQuery = setQuery; }, []);
    return createElement(navigation.Provider, { value: query }, createElement(Probe));
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(createElement(Wrapper)));
  return { ...io, get state() { return state; }, get created() { return created; }, get writes() { return writes; },
    finish(index, totalCount = 2, rowOverrides = []) {
      // The shared pagination fixture defaults to student DTOs; classes have their own valid status.
      const validRows = Array.from({ length: Math.min(10, totalCount) }, (_, index) => ({
        ...(kind === "classes" ? { status: "수강", storedStatus: "수강" } : {}), ...rowOverrides[index],
      }));
      io.finish(index, totalCount, validRows);
    },
    setMetadataError(value) { metadataError = value; },
    navigate(query) { window.history.replaceState(null, "", `/admin/${kind}${query}`); } };
}

async function waitForManagementFocus(element) {
  if (document.activeElement === element) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); document.removeEventListener("focusin", onFocus); };
    const onFocus = () => { if (document.activeElement === element) { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error("dialog did not return focus to its trigger")); }, 1000);
    document.addEventListener("focusin", onFocus);
    onFocus();
  });
}

function installManagementDebounceClock(t) {
  const clockWindow = window;
  const originalSetTimeout = clockWindow.setTimeout.bind(clockWindow);
  const originalClearTimeout = clockWindow.clearTimeout.bind(clockWindow);
  const pending = new Map();
  let now = 0;
  // Reuse the academic test clock pattern, but management owns a 300ms window timer.
  // Leave React/Radix scheduling and read deadlines on their normal clocks.
  clockWindow.setTimeout = (callback, delay, ...args) => {
    if (delay !== 300 || typeof callback !== "function") return originalSetTimeout(callback, delay, ...args);
    const timer = {};
    pending.set(timer, { at: now + delay, callback, args });
    return timer;
  };
  clockWindow.clearTimeout = (timer) => {
    if (!pending.delete(timer)) originalClearTimeout(timer);
  };
  t.after(() => {
    clockWindow.setTimeout = originalSetTimeout;
    clockWindow.clearTimeout = originalClearTimeout;
    pending.clear();
  });
  return {
    get pendingCount() { return pending.size; },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...pending].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [timer, task] = next;
        now = task.at;
        pending.delete(timer);
        task.callback(...task.args);
      }
      now = target;
    },
  };
}

for (const kind of ["students", "classes"]) {
  test(`management search integration: ${kind} keeps 300ms, IME, Enter, clear and settled history policy`, async t => {
    const page = await mountManagementReadFeedback(t, { kind });
    await act(async () => page.finish(0, 2));
    const clock = installManagementDebounceClock(t);
    const label = kind === "students" ? "학생" : "수업";
    const input = document.querySelector(`input[aria-label="${label} 검색"]`);
    assert.ok(input);
    // Invoke the actual rendered common input handlers, as the existing academic integration fixture does.
    const handlers = () => input[Object.keys(input).find(key => key.startsWith("__reactProps"))];
    const urlSearch = () => new URLSearchParams(window.location.search).get("q") || "";
    for (const value of ["a", "ab", "합성검색"]) {
      await act(async () => handlers().onChange({ target: { value }, nativeEvent: {} }));
    }
    assert.equal(clock.pendingCount, 1, "rapid input keeps only its latest 300ms timer");
    assert.equal(page.requests.length, 1);
    let enterPrevented = 0;
    await act(async () => handlers().onKeyDown({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault() { enterPrevented += 1; } }));
    assert.equal(enterPrevented, kind === "classes" ? 1 : 0, "management preserves the existing class no-submit Enter/default student Enter contract");
    assert.equal(page.requests.length, 1, "Enter must not add immediate management search submission");
    assert.equal(urlSearch(), "");
    await act(async () => clock.advance(299));
    assert.equal(page.requests.length, 1);
    assert.equal(urlSearch(), "");
    await act(async () => clock.advance(1));
    assert.equal(page.requests.length, 2);
    assert.equal(page.requests[1].args.p_filters.search, "합성검색");
    assert.equal(urlSearch(), "합성검색");
    await act(async () => page.finish(1, 2));

    await act(async () => handlers().onCompositionStart());
    await act(async () => handlers().onChange({ target: { value: "ㅎ" }, nativeEvent: { isComposing: true } }));
    await act(async () => handlers().onKeyDown({ key: "Enter", nativeEvent: { isComposing: true, keyCode: 229 }, preventDefault() { throw new Error("IME Enter must not submit"); } }));
    await act(async () => clock.advance(300));
    assert.equal(page.requests.length, 2, "composition start plus native composing input cannot commit a read");
    assert.equal(urlSearch(), "합성검색", "composing text cannot replace the accepted URL search");
    await act(async () => handlers().onCompositionEnd({ currentTarget: { value: "한글" } }));
    await act(async () => clock.advance(299));
    assert.equal(page.requests.length, 2);
    assert.equal(urlSearch(), "합성검색");
    await act(async () => clock.advance(1));
    assert.equal(page.requests.length, 3);
    assert.equal(page.requests[2].args.p_filters.search, "한글");
    assert.equal(urlSearch(), "한글");
    await act(async () => page.finish(2, 2));

    const clear = document.querySelector(`button[aria-label="${kind === "students" ? "학생 검색어 지우기" : "수업 검색 지우기"}"]`);
    assert.ok(clear && !clear.disabled);
    await act(async () => { clear.focus(); clear.click(); });
    assert.equal(input.value, "");
    assert.ok(document.activeElement === input, "clear returns focus to the same search input");
    assert.equal(page.requests.length, 3, "clear preserves management's delayed empty-query commit");
    assert.equal(urlSearch(), "한글");
    await act(async () => clock.advance(299));
    assert.equal(page.requests.length, 3);
    await act(async () => clock.advance(1));
    assert.equal(page.requests.length, 4);
    assert.equal(page.requests[3].args.p_filters.search, "");
    assert.equal(urlSearch(), "");
    await act(async () => page.finish(3, 2));

    // URL catch-up has released pending input ownership. Existing policy restores history only in this state.
    await act(async () => page.navigate("?q=복원검색&keep=1"));
    assert.equal(input.value, "복원검색");
    assert.equal(page.requests.length, 5);
    assert.equal(page.requests[4].args.p_filters.search, "복원검색");
    await act(async () => clock.advance(300));
    assert.equal(page.requests.length, 5, "the URL-owned restored input must not echo an extra read");
    assert.equal(urlSearch(), "복원검색");
    assert.equal(new URLSearchParams(window.location.search).get("keep"), "1");
    await act(async () => page.finish(4, 2));
    assert.deepEqual(page.requests.map(request => request.args.p_filters.search), ["", "합성검색", "한글", "", "복원검색"]);
    assert.equal(page.created, 0);
    assert.equal(page.writes, 0);
  });
}

for (const kind of ["students", "classes"]) {
  test(`management read feedback: initial ${kind} failure is unknown, never an empty registration prompt`, async t => {
    const page = await mountManagementReadFeedback(t, { kind });
    const label = kind === "students" ? "학생" : "수업";
    const search = document.querySelector(`input[aria-label="${label} 검색"]`);
    await act(async () => page.requests[0].reject(new Error("synthetic main read unavailable")));
    assert.equal(page.state.totalCount, null);
    assert.equal(page.state.rows.length, 0);
    assert.doesNotMatch(document.body.textContent, new RegExp(`${label} (?:결과 )?없음`), "an unaccepted read must not become a successful empty state");
    assert.equal(document.querySelectorAll('tbody button').length, 0, "failed empty table has no registration/reset CTA");
    const mobile = document.querySelector(`[aria-label="${label} 모바일 ${kind === "students" ? "학생 " : ""}목록"]`);
    assert.equal(mobile?.querySelectorAll('button').length, 0, "failed empty mobile list has no registration/reset CTA");
    assert.equal(page.state.errorSource, "list");
    const alert = document.querySelector('[role="alert"]');
    assert.match(alert?.textContent || "", /synthetic main read unavailable/);
    const retry = alert.querySelector("button");
    await act(async () => { retry.focus(); retry.click(); });
    assert.ok(document.activeElement === search, "retry returns focus to the same stable search input");
    assert.ok(document.querySelector(`input[aria-label="${label} 검색"]`) === search, "retry preserves the search input owner");
    assert.equal(document.querySelector('[role="alert"] button'), null, "pending retry cannot be submitted again");
    assert.ok(document.querySelector('[role="status"]'), "pending retry has a status announcement");
    await act(async () => page.finish(1, 2));
    assert.equal(page.state.error, null);
    assert.equal(page.state.errorSource, null);
    assert.equal(document.querySelectorAll('tr[data-management-row="true"]').length, 2);
    assert.equal(page.created, 0);
    assert.equal(page.writes, 0);
  });

  test(`management read feedback: ${kind} successful zero and search zero keep different next actions`, async t => {
    const page = await mountManagementReadFeedback(t, { kind });
    const label = kind === "students" ? "학생" : "수업";
    await act(async () => page.finish(0, 0));
    assert.equal(page.state.totalCount, 0);
    assert.equal(page.state.errorSource, null);
    assert.match(document.querySelector("tbody").textContent, new RegExp(`${label} 없음`));
    assert.ok([...document.querySelectorAll("tbody button")].some(button => button.textContent.includes(`${label} 등록`)), "true empty data keeps the authorized registration action");
    await act(async () => page.navigate("?q=없는합성검색"));
    assert.equal(page.requests.at(-1).args.p_filters.search, "없는합성검색");
    await act(async () => page.finish(page.requests.length - 1, 0));
    assert.match(document.querySelector("tbody").textContent, new RegExp(`${label} 결과 없음`));
    assert.equal([...document.querySelectorAll("tbody button")].some(button => button.textContent.includes(`${label} 등록`)), false);
    const reset = [...document.querySelectorAll("tbody button")].find(button => button.textContent.includes("조건 초기화"));
    assert.ok(reset, "search zero offers a filter reset rather than another registration prompt");
    await act(async () => reset.click());
    assert.equal(page.requests.at(-1).args.p_filters.search, "");
    await act(async () => page.finish(page.requests.length - 1, 2));
    assert.equal(document.querySelectorAll('tr[data-management-row="true"]').length, 2);
    assert.equal(page.created, 0);
    assert.equal(page.writes, 0);
  });

  for (const total of [0, 2]) {
    test(`management read feedback: ${kind} metadata-only failure keeps accepted ${total ? "rows" : "empty results"}`, async t => {
      const page = await mountManagementReadFeedback(t, { kind, metadataError: new Error("synthetic metadata unavailable") });
      const label = kind === "students" ? "학생" : "수업";
      await act(async () => page.finish(0, total));
      assert.equal(page.state.errorSource, "metadata");
      assert.equal(page.state.error, "synthetic metadata unavailable");
      assert.equal(page.state.totalCount, total);
      assert.equal(page.state.rows.length, total);
      assert.equal(document.querySelectorAll('tr[data-management-row="true"]').length, total);
      const alert = document.querySelector('[role="alert"]');
      assert.match(alert?.textContent || "", /부가 정보 조회 실패/);
      if (total === 0) {
        assert.match(document.querySelector("tbody").textContent, new RegExp(`${label} 없음`));
        assert.ok([...document.querySelectorAll("tbody button")].some(button => button.textContent.includes(`${label} 등록`)), "successful empty data remains trustworthy when only metadata fails");
      } else assert.doesNotMatch(document.querySelector("tbody").textContent, new RegExp(`${label} (?:결과 )?없음`));
      page.setMetadataError(null);
      await act(async () => alert.querySelector("button").click());
      assert.equal(document.querySelector('[role="alert"] button'), null);
      await act(async () => page.finish(1, total));
      assert.equal(page.state.error, null);
      assert.equal(page.state.errorSource, null);
      assert.equal(page.state.rows.length, total);
      assert.equal(page.created, 0);
      assert.equal(page.writes, 0);
    });
  }

  test(`management read feedback: ${kind} retained rows preserve settings, selection and bulk draft owners`, async t => {
    const page = await mountManagementReadFeedback(t, { kind });
    const label = kind === "students" ? "학생" : "수업";
    await act(async () => page.finish(0, 2));
    const search = document.querySelector(`input[aria-label="${label} 검색"]`);
    const settingsTrigger = document.querySelector('button[aria-label="표 설정"]');
    await act(async () => settingsTrigger.click());
    const settings = document.querySelector('[role="dialog"]');
    assert.match(settings?.textContent || "", new RegExp(`${label} 표 설정`));
    const settingsSearch = settings.querySelector('input[aria-label="컬럼 검색"]');
    await act(async () => { void page.state.refresh(); });
    assert.ok(document.querySelector('[role="dialog"]') === settings, "read loading does not unmount an open settings owner");
    await act(async () => page.requests[1].reject(new Error("synthetic retained read unavailable")));
    assert.equal(page.state.errorSource, "list");
    assert.equal(page.state.totalCount, 2);
    assert.ok(document.querySelector('[role="dialog"]') === settings, "read failure preserves the settings dialog owner");
    assert.ok(settings.querySelector('input[aria-label="컬럼 검색"]') === settingsSearch, "read failure preserves the settings search input owner");
    assert.equal(document.querySelectorAll('tr[data-management-row="true"]').length, 2);
    await act(async () => document.querySelector('button[aria-label="표 설정 닫기"]').click());
    assert.ok(document.querySelector('button[aria-label="표 설정"]') === settingsTrigger, "closing settings preserves its trigger owner");
    const checkbox = document.querySelector(`tbody button[role="checkbox"][aria-label="${label} 항목 선택"]`);
    await act(async () => checkbox.click());
    const edit = document.querySelector('button[aria-label="선택 항목 일괄 수정"]');
    assert.ok(edit);
    await act(async () => { edit.focus(); edit.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    assert.match(dialog?.textContent || "", /선택 1건 수정/);
    const value = document.getElementById("management-bulk-value");
    await act(async () => value.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const chosen = [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.trim() === (kind === "students" ? "고등" : "수강"));
    assert.ok(chosen);
    await act(async () => chosen.click());
    const draft = value.textContent;
    assert.match(draft, kind === "students" ? /고등/ : /수강/);
    await act(async () => { void page.state.refresh(); });
    assert.ok(document.querySelector('[role="dialog"]') === dialog, "read loading preserves the bulk editor owner");
    await act(async () => page.requests[2].reject(new Error("synthetic retained read unavailable again")));
    assert.ok(document.querySelector('[role="dialog"]') === dialog, "feedback is a stable sibling of the bulk editor owner");
    assert.ok(document.getElementById("management-bulk-value") === value, "read failure preserves the bulk draft input owner");
    assert.equal(value.textContent, draft);
    assert.equal(checkbox.getAttribute("aria-checked"), "true");
    assert.equal(page.state.rows.length, 2);
    const cancel = dialog.querySelector('button[aria-label="일괄 수정 취소"]');
    assert.ok(cancel);
    await act(async () => cancel.click());
    assert.ok(document.querySelector('[role="dialog"]') === null, "cancel closes the bulk editor");
    assert.ok(document.querySelector('button[aria-label="선택 항목 일괄 수정"]') === edit, "cancel preserves the bulk edit trigger owner");
    // Radix schedules close autofocus for the next turn. Wait for the observable focus return before the next user action.
    await act(async () => waitForManagementFocus(edit));
    assert.ok(document.activeElement === edit, "cancel returns focus to the preserved bulk edit trigger");
    const retry = document.querySelector('[role="alert"] button');
    await act(async () => { retry.focus(); retry.click(); });
    assert.ok(document.activeElement === search, "retry after cancel returns focus to the preserved search input");
    assert.equal(document.querySelector('[role="alert"] button'), null);
    await act(async () => page.finish(3, 2));
    assert.equal(checkbox.getAttribute("aria-checked"), "true");
    assert.ok(document.querySelector(`input[aria-label="${label} 검색"]`) === search, "accepted retry preserves the search input owner");
    assert.equal(page.state.error, null);
    assert.equal(page.created, 0);
    assert.equal(page.writes, 0);
  });
}

// Producer-shaped fixtures from the final SQL projection, never a database call.
const listClass = {kind:'classes',id:'90000000-0000-4000-8000-000000000233',name:'합성 대기반',subject:'영어',grade:'중1',
  schedule:'월 16:00-18:00',teacherName:'합성 교사',classroom:'합성 강의실',capacity:40,weeklyMinutes:null,fee:100,
  status:'수강',studentCount:0,sortKey:'합성 대기반',updatedAt:'2099-01-01T00:00:00Z'};
const students = count => Array.from({length:count},(_,i)=>({id:`synthetic-student-${i}`,name:`합성 대기 ${String(i).padStart(3,'0')}`,grade:'중1',school:'합성중',status:'퇴원'}));
const detailFor = (total=35) => ({kind:'classes',record:{...listClass,classType:'정규',teacher:'합성 교사',textbookIds:[]},
  registeredCount:0,waitlistCount:total,registeredStudents:{rows:[],hasMore:false,nextCursor:null},
  waitlistedStudents:{rows:students(30),hasMore:true,nextCursor:'opaque-next'}});
const finishCurrentList = (page, patch={}) => act(async()=>page.requests[0].resolve({error:null,data:{
  rows:[{...listClass,...patch}],page:11,pageSize:10,totalCount:101}}));

test('#233: old producer omission is unknown without extra reads; detail total35 differs from30loaded',async t=>{
  const page=await mountClassConsumer(t,{renderTable:true});
  assert.equal(Object.hasOwn(listClass,'waitlistCount'),false);
  await finishCurrentList(page);
  assert.equal(page.state.rows[0].metrics.waitlistCount,undefined);
  assert.match(document.body.textContent,/대기 인원 확인 불가/);
  assert.equal(document.querySelector('[aria-label="대기 학생 0명 보기"]'),null);
  assert.equal(page.allCalls.filter(x=>x.name==='list_management_detail_relation_page_v1').length,0,'unknown is display-only');
  page.setDetail(detailFor());
  let detail;await act(async()=>{detail=await page.state.loadDetail(listClass.id);});
  assert.equal(detail.metrics.waitlistCount,35);
  assert.equal(detail.raw.waitlist_ids.length,30);
  assert.equal(detail.raw.waitlisted_students_relation_page.hasMore,true);
  assert.equal(page.state.totalCount,101,'class count is unrelated to student total');
  assert.equal(page.state.page,11);
});

test('#233: absent class list total must remain unknown instead of actual zero',async t=>{
  const page=await mountClassConsumer(t);
  await finishCurrentList(page);
  assert.equal(page.state.rows[0].metrics.waitlistCount,undefined);
});

test('#233: explicit numeric0 and35 are preserved separately from class page size',async t=>{
  const page=await mountClassConsumer(t);
  await finishCurrentList(page,{waitlistCount:0});
  assert.equal(page.state.rows[0].metrics.waitlistCount,0);
  await act(async()=>{void page.state.refresh();});
  await act(async()=>page.requests[1].resolve({error:null,data:{rows:[{...listClass,waitlistCount:35}],page:11,pageSize:10,totalCount:101}}));
  assert.equal(page.state.rows[0].metrics.waitlistCount,35);
  assert.equal(page.state.rows.length,1);
  assert.equal(page.state.totalCount,101);
});

test('#233: detail missingtotal stays unknown despite30loaded rows in normalization and cell',async t=>{
  const page=await mountClassConsumer(t);
  await finishCurrentList(page);
  const payload=detailFor();delete payload.waitlistCount;page.setDetail(payload);
  let detail;await act(async()=>{detail=await page.state.loadDetail(listClass.id);});
  assert.equal(detail.metrics.waitlistCount,undefined,'paged detail does not infer total from30rows');
  const {ClassEnrollmentStatusCell}=loadHook(page.supabase,'src/features/management/class-enrollment-status-cell.tsx');
  const holder=document.createElement('div');document.body.append(holder);const root=createRoot(holder);
  t.after(async()=>{await act(async()=>root.unmount());holder.remove();});
  await act(async()=>root.render(createElement(ClassEnrollmentStatusCell,{row:detail,onLoadRoster:page.state.loadClassRosterPreview})));
  assert.match(holder.textContent,/대기 인원 확인 불가/);
  assert.equal(holder.querySelector('[aria-label="대기 학생 0명 보기"]'),null);
});

test('#233: complete legacy arrays retain counts; missing or malformed totals never become zero',async()=>{
  const {normalizeClassManagementRecord:normalize}=await import('../src/features/management/records.js');
  for(const [input,expected] of [
    [{},undefined],[{waitlist_ids:[]},0],[{waitlist_ids:['a','b']},2],
    [{waitlistCount:0},0],[{waitlistCount:35},35],[{waitlistCount:'0'},0],[{waitlistCount:'35'},35],
    ...[null,'', ' ', -1,1.5,NaN,Infinity,'bad',false,{}].map(waitlistCount=>[{waitlistCount},undefined]),
    [{waitlist_ids:['a','b'],waitlisted_students_relation_page:{},waitlistCount:35},35],
    [{waitlist_ids:['a','b'],waitlisted_students_relation_page:{}},undefined],
  ]) assert.equal(normalize({id:'synthetic',...input}).metrics.waitlistCount,expected,JSON.stringify(input));
});
