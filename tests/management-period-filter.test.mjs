import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";

const require = createRequire(import.meta.url);
const rootPath = path.resolve(import.meta.dirname, "..");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function loadTable() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: file,
    }).outputText;
    const runtimeModule = { exports: {} };
    cache.set(file, runtimeModule);
    const resolve = (specifier) => {
      if (specifier === "next/navigation") return {
        useRouter: () => ({ replace() { assert.fail("class filters must keep native history"); }, push() {} }),
        usePathname: () => "/admin/classes",
        useSearchParams: () => new URLSearchParams(window.location.search),
      };
      if (specifier === "@/lib/supabase") return { supabase: null };
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return require(specifier);
      const base = specifier.startsWith("@/")
        ? path.join(rootPath, "src", specifier.slice(2))
        : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find((candidate) => existsSync(candidate));
      return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(resolve, runtimeModule, runtimeModule.exports);
    return runtimeModule.exports;
  }
  return load(path.join(rootPath, "src/features/management/management-data-table.tsx"));
}

async function mountTable(t, query = "", { delayHistoryPatch = false } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: `https://test.invalid/admin/classes${query}` });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const key of ["Element", "HTMLElement", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "NodeFilter", "HTMLInputElement", "HTMLButtonElement"]) {
    globalThis[key] = dom.window[key];
  }
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.matchMedia = (media) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
  const replacements = [];
  const replaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data, unused, url) => {
    replacements.push({ data, url });
    replaceState(data, unused, url);
  };
  const { ManagementDataTable } = loadTable();
  const { normalizeClassManagementRecord } = await import("../src/features/management/records.js");
  const rows = [
    normalizeClassManagementRecord({ id: "class-Z", name: "Z 수업", subject: "수학", status: "종강" }),
    normalizeClassManagementRecord({ id: "class-A", name: "A 수업", subject: "수학", status: "종강" }),
  ];
  const props = {
    kind: "classes", rows, stats: [], loading: false, page: 11, pageSize: 10, totalCount: 102,
    sort: [{ id: "title", desc: true }], displayedScope: "same-class-list", actions: {},
    badgeLabel: "과목", statusLabel: "상태", emptyLabel: "수업",
    filterOptions: {
      subject: ["수학", "영어"], grade: ["고1"], teacher: ["이선생"], classroom: ["A실"],
      periods: [{ value: "period-default", label: "2026 2학기", isDefault: true }],
    },
    onPageChange() {}, onSortChange() {}, onPageSizePreferenceChange() {},
  };
  let canonicalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  function RouterHistory({ children }) {
    useEffect(() => {
      let active = true;
      const original = window.history.replaceState;
      // Next installs this parent passive effect after the table's mount effect.
      window.history.replaceState = (data, unused, url) => {
        if (!data?.__NA) canonicalUrl = String(url);
        original(data, unused, url);
      };
      queueMicrotask(() => {
        if (active) window.history.replaceState({ __NA: true }, "", canonicalUrl);
      });
      return () => { active = false; window.history.replaceState = original; };
    }, []);
    return children;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  const render = async () => {
    const boundary = delayHistoryPatch ? RouterHistory : StrictMode;
    await act(async () => root.render(createElement(boundary, null, createElement(ManagementDataTable, props))));
  };
  await render();
  return { render, replacements, replaceState };
}

test("legacy class period links remove only period and retain search, filters, page, sort and detail", async (t) => {
  const query = new URLSearchParams({
    period: "legacy-period", q: "수학 심화", status: "종강", subject: "수학", grade: "고1",
    teacher: "이선생", classroom: "A실", page: "11", sort: JSON.stringify([{ id: "title", desc: true }]),
    classId: "class-Z", source: "bookmark",
  });
  const expected = new URLSearchParams(query);
  expected.delete("period");
  const page = await mountTable(t, `?${query}#class-detail`);

  assert.equal(window.location.search, `?${expected}`);
  assert.equal(window.location.hash, "#class-detail");
  assert.equal(page.replacements.length, 1, "StrictMode cleanup must not loop or rewrite other query state");
  assert.equal(page.replacements[0].data, null, "Next must receive an external history update");
  assert.equal(document.querySelector('input[aria-label="수업 검색"]').value, "수학 심화");
  assert.equal(document.querySelector('button[aria-current="page"]').textContent, "11");
  const renderedRows = [...document.querySelectorAll('tr[data-management-row="true"]')];
  assert.equal(renderedRows.length, 2, "the server page must not be filtered or sliced again");
  assert.ok(renderedRows[0].textContent.includes("Z 수업"), "server sort order is retained");

  await page.render();
  assert.equal(page.replacements.length, 1, "cleaned URL must stay stable after hydration");
  assert.equal(document.querySelector('button[aria-label="필터"]'), null);
  assert.equal(document.querySelector('[aria-label="기간"]'), null);
  assert.equal(document.querySelector('#period-filter'), null);
  assert.doesNotMatch(document.body.textContent, /2026 2학기|기간 없음/);
  assert.equal(document.querySelector('#status-filter').textContent, "종강");
  for (const id of ["subject", "grade", "teacher", "classroom"]) {
    assert.ok(document.querySelector(`#class-${id}-filter`), `${id} filter stays available`);
  }
});

test("initial class period cleanup waits for the router history patch before canonical URL restoration", async (t) => {
  const page = await mountTable(t, "?period=retired-period&classId=class-Z&tab=basic&page=11#details", { delayHistoryPatch: true });
  assert.equal(window.location.search, "?classId=class-Z&tab=basic&page=11");
  assert.equal(window.location.hash, "#details");
  assert.ok(page.replacements.some(({ data }) => data?.__NA), "fixture must exercise the later framework URL restoration");
  assert.equal(document.querySelector('button[aria-current="page"]').textContent, "11");
});

test("period URL cleanup preserves selected rows and never restores a configured default period", async (t) => {
  const page = await mountTable(t, "?page=11&classId=class-Z");
  assert.equal(page.replacements.length, 0, "opening all continuous classes must not inject a default period");
  const rowCheckbox = () => document.querySelector('tr[data-management-row="true"] [role="checkbox"]');
  await act(async () => rowCheckbox().click());
  assert.equal(rowCheckbox().getAttribute("aria-checked"), "true");
  page.replaceState(null, "", "/admin/classes?page=11&classId=class-Z&period=old");
  await page.render();
  assert.equal(window.location.search, "?page=11&classId=class-Z");
  assert.equal(rowCheckbox().getAttribute("aria-checked"), "true", "retiring an ignored filter must not clear selection");
  assert.equal(page.replacements.length, 1);
  await page.render();
  assert.equal(page.replacements.length, 1);
});

test("resetting active class filters clears the page while keeping the detail link without a period", async (t) => {
  const page = await mountTable(t, "?period=old&page=11&q=math&status=종강&classId=class-Z&sort=%5B%5D");
  await page.render();
  assert.equal(document.querySelector('button[aria-label="필터"]'), null);
  const reset = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === "조건 초기화");
  assert.ok(reset);
  await act(async () => reset.click());
  const params = new URLSearchParams(window.location.search);
  for (const key of ["period", "page", "q", "status"]) assert.equal(params.get(key), null, key);
  assert.equal(params.get("classId"), "class-Z");
  assert.equal(params.get("sort"), "[]");
});
