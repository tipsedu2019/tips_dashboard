import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { act, createContext, createElement, useContext } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const repo = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function setup(t, kind = 'students') {
  const pathname = `/admin/${kind}`;
  const dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid${pathname}?fixture=normal` });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'HTMLInputElement']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout;
  window.scrollTo = () => {};
  window.matchMedia = media => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
  const Route = createContext(new URLSearchParams(window.location.search));
  const changes = [];
  const router = { replace: href => changes.push(href), push() {} };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const resolve = name => {
      if (name === 'next/navigation') return { useRouter: () => router, usePathname: () => pathname, useSearchParams: () => useContext(Route) };
      if (name === '@/lib/supabase') return { supabase: null };
      if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
      const base = name.startsWith('@/') ? path.join(repo, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
      return load([base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync));
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  const { ManagementDataTable } = load(path.join(repo, 'src/features/management/management-data-table.tsx'));
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const props = { kind, rows: [{ id: 'row-a', kind, title: '김학생', status: '재원', statusValue: '재원', badge: '중1', badgeValue: '중1', subtitle: '', searchText: '김학생', metrics: {}, raw: { id: 'row-a', name: '김학생', grade: '중1', status: '재원', class_ids: [], waitlist_class_ids: [] } }], stats: [], loading: false, page: 1, totalCount: 1, sort: [{ id: 'title', desc: false }], displayedScope: 'fixed-list', onPageChange() {}, onSortChange() {}, filterOptions: {}, badgeLabel: '학년', statusLabel: '상태', emptyLabel: '학생', actions: {}, pageSize: 10, onPageSizePreferenceChange() {} };
  const render = async (query, nextProps) => {
    if (nextProps) Object.assign(props, nextProps);
    window.history.replaceState(null, '', `${pathname}?${query}`);
    await act(async () => root.render(createElement(Route.Provider, { value: new URLSearchParams(query) }, createElement(ManagementDataTable, props))));
  };
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await render('fixture=normal');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  return { render, props, changes, input: () => document.querySelector('input[aria-label="학생 검색"]'), viewport: () => document.querySelector('[data-testid="management-table-viewport"]') };
}

test('detail-only route changes preserve list scroll, selection and the active search field', async t => {
  const ui = await setup(t);
  const input = ui.input(); input.focus();
  const checkbox = document.querySelector('[aria-label="학생 항목 선택"]');
  await act(async () => checkbox.click());
  const viewport = ui.viewport(); viewport.scrollTop = 146; viewport.scrollLeft = 62;
  await ui.render('fixture=normal&studentId=row-a&classId=class-a&tab=basic&section=members&sessionId=session-a&returnTo=%2Fadmin%2Fclasses');
  assert.equal(viewport.scrollTop, 146, 'opening detail must not reset the list scroll');
  assert.equal(viewport.scrollLeft, 62);
  assert.equal(checkbox.getAttribute('aria-checked'), 'true');
  assert.equal(ui.input(), input);
  assert.equal(document.activeElement, input);
  await ui.render('fixture=normal');
  assert.equal(viewport.scrollTop, 146, 'returning from detail keeps the same list position');
  assert.equal(checkbox.getAttribute('aria-checked'), 'true');
});

test('list query and page changes still update search and reset the list scroll', async t => {
  const ui = await setup(t);
  ui.viewport().scrollTop = 146;
  await ui.render('fixture=normal&q=김학생&studentId=row-a');
  assert.equal(ui.input().value, '김학생');
  assert.equal(ui.viewport().scrollTop, 0);
  ui.viewport().scrollTop = 146;
  await ui.render('fixture=normal&q=김학생&page=2&studentId=row-a', { page: 2 });
  assert.equal(ui.viewport().scrollTop, 0);
});

test('a search write preserves the latest detail and unrelated URL parameters', async t => {
  const ui = await setup(t);
  await ui.render('fixture=normal&studentId=row-a&unknown=keep&returnTo=%2Fadmin%2Fclasses');
  const input = ui.input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '변경 검색');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  const query = new URLSearchParams(window.location.search);
  assert.equal(query.get('q'), '변경 검색');
  assert.equal(query.get('studentId'), 'row-a');
  assert.equal(query.get('unknown'), 'keep');
  assert.equal(query.get('returnTo'), '/admin/classes');
});
