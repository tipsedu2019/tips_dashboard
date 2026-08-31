import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const rootPath = path.resolve(import.meta.dirname, '../..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bootstrapDom = new JSDOM('', { url: 'https://test.invalid' });
globalThis.window = bootstrapDom.window;
globalThis.document = bootstrapDom.window.document;

export const id = n => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function transport() {
  const requests = [];
  function pending(metadata) {
    const deferred = Promise.withResolvers();
    const request = { ...metadata, ...deferred, steps: [] };
    requests.push(request);
    const chain = {
      then: deferred.promise.then.bind(deferred.promise),
      abortSignal(signal) { request.signal = signal; return chain; },
      retry(value) { request.retry = value; return chain; },
    };
    for (const method of ['select', 'order', 'eq', 'in', 'range', 'limit', 'single', 'maybeSingle', 'insert', 'update', 'delete']) {
      chain[method] = (...args) => { request.steps.push({ method, args }); return chain; };
    }
    return chain;
  }
  return { requests, supabase: { rpc(name, args) { return pending({ name, args }); }, from(table) { return pending({ table }); } } };
}

// Production services/controllers/components are evaluated unchanged. Only auth,
// Next's query source and the external Supabase transport are controlled here.
function modules(supabase, overrides) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const evaluated = { exports: {} };
    cache.set(file, evaluated);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    function resolve(specifier) {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === '@/lib/supabase') return { supabase, supabaseConfigError: '' };
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const base = specifier.startsWith('@/') ? path.join(rootPath, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync);
      assert.ok(target, `production module required: ${specifier}`);
      return load(target);
    }
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, evaluated, evaluated.exports);
    return evaluated.exports;
  }
  return entry => load(path.join(rootPath, entry));
}

export async function setup(t, initial = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid/admin/textbooks${initial.search || ''}` });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.self = dom.window;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify(Object.fromEntries(
    ['master', 'requests', 'purchase', 'sales', 'sales-history', 'inventory', 'inventory-history', 'closing', 'closing-movements']
      .map(scope => [`textbooks:${scope}`, { mode: 'manual', pageSize: 10 }]),
  )));
  const root = createRoot(document.getElementById('root'));
  const io = transport();
  let auth = { user: { id: id(804), email: 'admin@test.invalid' }, role: 'admin', loading: false, isAdmin: true, isStaff: false, isTeacher: false, canManageAll: true, ...initial.auth };
  let search, params;
  const load = modules(io.supabase, {
    '@/providers/auth-provider': { useAuth: () => auth },
    'next/navigation': { useSearchParams() {
      if (search !== window.location.search) { search = window.location.search; params = new URLSearchParams(search); }
      return params;
    } },
  });
  const Workspace = load('src/features/textbooks/textbook-operations-workspace.tsx').TextbookOperationsWorkspace;
  const render = () => act(async () => root.render(createElement(Workspace)));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await render();
  return { ...io, load, render,
    auth: async patch => { auth = { ...auth, ...patch }; await render(); },
    navigate: async query => { window.history.replaceState(null, '', `/admin/textbooks${query}`); await render(); },
  };
}

export const button = label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label || node.getAttribute('aria-label') === label);

// A rendering probe for the typed state capability, not a substitute controller.
export async function setupHook(t, initial, { strictMode = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/textbooks' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify(Object.fromEntries(
    ['master', 'requests', 'purchase', 'sales', 'sales-history', 'inventory', 'inventory-history', 'closing', 'closing-movements']
      .map(scope => [`textbooks:${scope}`, { mode: 'manual', pageSize: 10 }]),
  )));
  const root = createRoot(document.getElementById('root'));
  let rootMounted = true;
  const unmount = async () => {
    if (!rootMounted) return;
    await act(async () => root.unmount());
    rootMounted = false;
  };
  t.after(async () => { await unmount(); dom.window.close(); });
  const io = transport();
  const load = modules(io.supabase, {});
  const { useTextbookNumberedData } = load('src/features/textbooks/use-textbook-numbered-data.ts');
  assert.equal(typeof useTextbookNumberedData, 'function', 'real typed textbook hook must exist');
  let input = initial;
  let current;
  let ownerPresent = true;
  function Probe() {
    const state = useTextbookNumberedData(input);
    useLayoutEffect(() => { current = state; });
    return null;
  }
  // Models an outer auth boundary removing the owner without one final auth prop render.
  function Boundary() { return ownerPresent ? createElement(Probe) : null; }
  const render = () => act(async () => root.render(strictMode
    ? createElement(StrictMode, null, createElement(Boundary)) : createElement(Boundary)));
  await render();
  return { ...io, get current() { return current; }, unmount,
    setOwnerPresent: async present => { ownerPresent = present; await render(); },
    rerender: async next => { input = next; await render(); },
    act: callback => act(async () => { callback(); }),
    resolve: (request, data) => act(async () => { request.resolve({ data, error: null }); }),
    reject: (request, error) => act(async () => { request.resolve({ data: null, error }); }),
  };
}
