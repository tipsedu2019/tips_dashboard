import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const require = createRequire(import.meta.url);
const rootPath = path.resolve(import.meta.dirname, "../..");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const id = (value) => `7a000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const revision = (value) => String(value).repeat(64);

export function publisherRow(value, patch = {}) {
  return {
    id: id(value),
    name: `출판사 ${value}`,
    subjects: ["english"],
    suppliers: [],
    textbookCount: value,
    isNew: false,
    ...patch,
  };
}

export function supplierRow(value, patch = {}) {
  return {
    id: id(value),
    name: `총판 ${value}`,
    contact: `02-${String(value).padStart(4, "0")}`,
    memo: `메모 ${value}`,
    linkedPublisherCount: 0,
    linkedPublisherNames: [],
    isNew: false,
    ...patch,
  };
}

export function subSubjectRow(value, patch = {}) {
  return {
    id: id(1000 + value),
    subject: "english",
    name: `세부과목 ${value}`,
    sortOrder: value * 10,
    isVisible: true,
    kind: "persisted",
    canMoveUp: value > 1,
    canMoveDown: true,
    ...patch,
  };
}

function modules(supabase, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} };
    cache.set(file, runtime);
    const input = readFileSync(file, "utf8");
    const source = ts.transpileModule(input, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const resolve = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === "@/lib/supabase") return { supabase, supabaseConfigError: null };
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return require(specifier);
      const base = specifier.startsWith("@/")
        ? path.join(rootPath, "src", specifier.slice(2))
        : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync);
      assert.ok(target, `production module required: ${specifier}`);
      return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return (entry) => load(path.join(rootPath, entry));
}

function transport() {
  const requests = [];
  const arrivals = new Set();
  const supabase = {
    rpc(name, args) {
      const deferred = Promise.withResolvers();
      const request = { name, args, ...deferred };
      requests.push(request);
      for (const notify of arrivals) notify();
      const chain = {
        then: deferred.promise.then.bind(deferred.promise),
        abortSignal(signal) {
          request.signal = signal;
          return this;
        },
        retry(value) {
          request.retry = value;
          return this;
        },
      };
      return chain;
    },
    from(table) {
      throw new Error(`legacy full-table read attempted: ${table}`);
    },
  };
  function waitForRequest(name, ordinal = 1) {
    const find = () => requests.filter((request) => request.name === name)[ordinal - 1];
    if (find()) return Promise.resolve(find());
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        arrivals.delete(notify);
        reject(new Error(`Timed out waiting for ${name} #${ordinal}; received ${requests.map((request) => request.name).join(", ")}`));
      }, 2500);
      const notify = () => {
        const request = find();
        if (!request) return;
        clearTimeout(timeout);
        arrivals.delete(notify);
        resolve(request);
      };
      arrivals.add(notify);
    });
  }
  return { supabase, requests, waitForRequest };
}

function installDom() {
  const dom = new JSDOM("<div id=\"root\"></div>", { url: "https://test.invalid/admin/textbooks" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.self = dom.window;
  for (const key of [
    "HTMLElement", "HTMLInputElement", "Element", "DocumentFragment", "MutationObserver", "CustomEvent",
    "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "DOMRect", "getComputedStyle",
  ]) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.PointerEvent = dom.window.PointerEvent || dom.window.MouseEvent;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  window.scrollTo = () => {};
  window.matchMedia = (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  return dom;
}

export async function setupTextbookSettings(t, options = {}) {
  const dom = installDom();
  if (options.preferences) window.localStorage.setItem("tips.data-table-page-size.v1", JSON.stringify(options.preferences));
  const io = transport();
  const root = createRoot(document.getElementById("root"));
  let auth = {
    user: { id: id(900), name: "관리자" },
    role: "admin",
    loading: false,
    ...options.auth,
  };
  const load = modules(io.supabase, {
    "@/providers/auth-provider": { useAuth: () => auth },
  });
  const Workspace = load("src/features/textbooks/textbook-supplier-settings-workspace.tsx").TextbookSupplierSettingsWorkspace;
  const render = async () => act(async () => root.render(createElement(Workspace)));
  await render();
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });

  return {
    ...io,
    render,
    async setAuth(patch) {
      auth = { ...auth, ...patch };
      await render();
    },
    async resolve(request, data) {
      await act(async () => request.resolve({ data, error: null }));
    },
    async databaseError(request, error) {
      await act(async () => request.resolve({ data: null, error }));
    },
    async reject(request, error) {
      await act(async () => request.reject(error));
    },
  };
}

export function ownerPage(request, rows, totalCount, patch = {}) {
  return {
    rows,
    page: request.args.p_page,
    pageSize: request.args.p_page_size,
    totalCount,
    baseRevision: revision("a"),
    ownerCounts: { publishers: Math.max(totalCount, 250), suppliers: 150 },
    ...patch,
  };
}

export function subSubjectPage(request, rows, totalCount, patch = {}) {
  return {
    rows,
    page: request.args.p_page,
    pageSize: request.args.p_page_size,
    totalCount,
    baseRevision: revision("b"),
    visibleCount: 250,
    subjectCounts: { english: totalCount, math: 20, science: 20, other: 20 },
    ...patch,
  };
}

export function button(label, scope = document) {
  return [...scope.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label);
}

export function tab(label) {
  return [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(label));
}

export async function click(node) {
  assert.ok(node, "click target must exist");
  await act(async () => node.click());
}

export async function changeInput(input, value) {
  assert.ok(input, "input must exist");
  const key = Object.keys(input).find((candidate) => candidate.startsWith("__reactProps"));
  assert.ok(key, "React input props must exist");
  await act(async () => input[key].onChange({ target: { value } }));
}

export function pageRows(kind, mode) {
  return [...document.querySelectorAll(`[data-testid^="textbook-${kind}-${mode}-"]`)].map((node) => node.getAttribute("data-testid"));
}
