import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url), rootPath = path.resolve(import.meta.dirname, '../..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Radix chooses its layout-effect implementation on first module import.
// The actual display-helper module also imports Radix, so establish DOM first.
const bootstrapDom = new JSDOM('', { url: 'https://test.invalid' });
globalThis.window = bootstrapDom.window; globalThis.document = bootstrapDom.window.document;
function modules(supabase, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    let input = readFileSync(file, 'utf8');
    if (file.endsWith('/makeup-request-workspace.tsx')) input += '\nexport { getMakeupRequestTableValue, getRequestEvent };';
    if (file.endsWith('/makeup-request-workspace.tsx') && overrides['@test/observer']) input = input.replace('  const selectedClassIdRef = useRef', '  require("@test/observer").observe({ input, editingRequest, editingRequestId, changeFilters, patch: setInput, patchActionNote: setActionNote, catalogs: catalogData });\n  const selectedClassIdRef = useRef');
    if (/\/makeup-request-(workspace\.tsx|service\.ts|model\.js)$/.test(file) && overrides['@test/date']) input = 'const Date = require("@test/date");\n' + input;
    const source = ts.transpileModule(input, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const resolve = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === '@/lib/supabase') return { supabase };
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const base = specifier.startsWith('@/') ? path.join(rootPath, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync);
      assert.ok(target, `production module required: ${specifier}`); return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return (entry) => load(path.join(rootPath, entry));
}
const id = (n) => `ad000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-08-31T00:00:00+00:00';
const filters = { view: 'approvalPending', subject: 'all', teacher: 'all', period: 'all', dateFrom: '', dateTo: '', filterColumn: 'className', search: '', sortColumn: null, sortDirection: null };
const row = (n, patch = {}) => ({ id: id(n), status: 'approval_pending', subject: '영어', approvalGroup: 'english', requesterId: id(801), requesterLabel: '신청자', teacherCatalogId: '', teacherProfileId: id(801), teacherLabel: '교사', classId: '', className: `수업 ${n}`, requestKind: 'makeup_only', reason: '사유', cancelDate: '', makeupStartAt: stamp, makeupEndAt: '2026-08-31T01:00:00+00:00', makeupClassroom: 'A', makeupSlots: [], approverTeacherCatalogId: '', approverProfileId: id(804), approverLabel: '결재자', returnedReason: '', rejectedReason: '', finalNote: '', approvedBy: '', approvedByLabel: '', approvedAt: '', completedBy: '', completedByLabel: '', completedAt: '', canceledBy: '', canceledByLabel: '', canceledAt: '', schedulePlanBefore: {}, schedulePlanAfter: {}, cancelAcademicEventId: '', makeupAcademicEventId: '', makeupAcademicEventIds: [], createdAt: stamp, updatedAt: stamp, events: [], ...patch });
const counts = { mine: 1, approvalPending: 112, makeupPending: 2, refundPending: 1, closed: 3 };
const facets = { subjectOptions: ['영어', '수학', '과학'].map((value, i) => ({ value, label: value, count: i ? 0 : 112 })), teacherOptions: [{ value: 'name:교사', label: '교사', count: 112 }] };
function response(request, totalCount = 112, patch = {}) {
  const { p_page: page, p_page_size: pageSize } = request.args;
  return { page, pageSize, totalCount, viewCounts: counts, ...facets,
    rows: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) => row((page - 1) * pageSize + i + 1)), ...patch };
}
function transport() {
  const requests = [], arrivals = new Set();
  const supabase = { auth: { async getUser() { return { data: { user: { id: id(804) } }, error: null }; }, async getSession() { return { data: { session: null }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
    rpc(name, args) { return pending({ name, args }); }, from(table) { return pending({ table, steps: [] }); } };
  function pending(metadata) {
    const deferred = Promise.withResolvers(), request = { ...metadata, ...deferred }; requests.push(request); for (const notify of arrivals) notify();
    const chain = { then: deferred.promise.then.bind(deferred.promise), abortSignal(signal) { request.signal = signal; return this; }, retry(value) { request.retry = value; return this; } };
    for (const name of ['select', 'order', 'eq', 'in', 'single', 'maybeSingle']) chain[name] = (...args) => { request.steps.push({ name, args }); return chain; };
    return chain;
  }
  return { supabase, requests, waitFor(name, ordinal = 1) {
    const match = () => requests.filter((r) => r.name === name || r.table === name)[ordinal-1];
    if (match()) return Promise.resolve(match());
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { arrivals.delete(notify); reject(new Error(`Missing request ${name}`)); }, 2000); const notify = () => { if (match()) { clearTimeout(timer); arrivals.delete(notify); resolve(match()); } }; arrivals.add(notify); });
  } };
}
const servicePath = 'src/features/makeup-requests/makeup-numbered-service.ts';
async function setup(t, initial = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid/admin/makeup-requests${initial.search || ''}` });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0); window.cancelAnimationFrame = window.clearTimeout; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {}; window.HTMLElement.prototype.attachEvent = () => {}; window.HTMLElement.prototype.detachEvent = () => {};
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify({ 'makeup:requests': { mode: 'manual', pageSize: 10 } }));
  const root = createRoot(document.getElementById('root')), io = transport();
  let auth = { user: { id: id(804), name: '관리자' }, role: 'admin', loading: false, ...initial.auth }, search, params, observed;
  const RealDate = Date;
  const clock = initial.clock ? { '@test/date': class extends RealDate { constructor(...args) { super(...(args.length ? args : [initial.clock])); } static now() { return RealDate.parse(initial.clock); } } } : {};
  const load = modules(io.supabase, { ...clock, '@test/observer': { observe(value) { observed = value; } }, '@/providers/auth-provider': { useAuth: () => auth }, 'next/navigation': { useSearchParams() {
    if (search !== window.location.search) { search = window.location.search; params = new URLSearchParams(search); } return params;
  } } });
  const Workspace = load('src/features/makeup-requests/makeup-request-workspace.tsx').MakeupRequestWorkspace;
  const render = async () => act(async () => root.render(initial.strict ? createElement(StrictMode,null,createElement(Workspace)) : createElement(Workspace)));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await render();
  return { ...io, load, render, get observed() { return observed; }, numbered: () => io.requests.filter((r) => r.name === 'list_makeup_numbered_page_v1'), context: () => io.requests.filter((r) => r.name === 'get_makeup_reservation_context_v1'),
    finish: (request, total, patch) => request.resolve({ error: null, data: response(request, total, patch) }),
    auth: async (patch) => { auth = { ...auth, ...patch }; await render(); },
    catalogs: async () => act(async () => { for (const r of io.requests.filter((r) => r.table)) r.resolve({ error: null, data: r.table === 'classroom_catalogs' ? [{ name: 'A' }, { name: 'B' }] : [] }); }),
  };
}
const button = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label);
const tab = (label) => [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent.trim().startsWith(label));

export { modules, id, stamp, filters, row, counts, facets, response, transport, servicePath, setup, button, tab };
