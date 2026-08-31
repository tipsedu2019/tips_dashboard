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
export const masterRow = (n, patch = {}) => ({
  id: id(n), title: `교재 ${n}`, name: `교재 ${n}`, status: 'active', subject: 'english', publisher: '출판사', category: '문법',
  isbn13: null, barcode: null, subject_area_key: null, school_level: 'middle', grade_level: '2', sub_subject: '문법',
  price: 10000, sale_price: 12000, list_price: 12000, salePrice: 12000, publisher_id: null, default_supplier_id: null,
  school_levels: ['middle'], grade_levels: ['2'], is_returnable: true,
  locationQuantities: {}, studentLocationQuantities: {}, teacherLocationQuantities: {}, totalQuantity: 0, studentQuantity: 0, teacherQuantity: 0, stockValue: 0,
  locationSummary: [], qualityIssues: { duplicate: false, missingCode: false, missingPublisher: false, missingCategory: false, missingPrice: false, subjectMismatch: false, inactive: false }, qualityScore: 0,
  ...patch,
});
export const masterSummary = (totalCount = 0, patch = {}) => ({
  totalCount, totalQuantity: 0, studentQuantity: 0, teacherQuantity: 0, stockValue: 0, salePriceTotal: 0, locationQuantities: {},
  subjectTotals: totalCount ? [{ subject: 'english', totalCount, totalQuantity: 0, salePriceTotal: 0, stockValue: 0 }] : [],
  qualityCounts: { all: totalCount, attention: 0, duplicate: 0, missingCode: 0, missingPublisher: 0, missingCategory: 0, missingPrice: 0, subjectMismatch: 0, inactive: 0 },
  inventoryCounts: { all: totalCount, shortage: 0, surplus: 0, unused: totalCount, negative: 0 }, subSubjectOptions: ['문법'], locations: [], ...patch,
});
const workflowBook = (n = 101) => ({ id: id(n), title: `교재 ${n}`, name: `교재 ${n}`, status: 'active', subject: 'english', publisher: '출판사', publisher_id: null, default_supplier_id: null, price: 10000, sale_price: 10000, list_price: 0, isbn13: null, barcode: null, is_returnable: true });
const purchaseOrder = (status = 'requested') => ({ id: id(200), supplier_id: null, requested_by: '선생님', requested_date: '2026-08-01', order_date: '2026-08-01', expected_date: null, ordered_at: null, received_at: null, status, statement_number: '', memo: '', created_by: id(901), created_at: '2026-08-01T00:00:00+00:00', updated_at: null });
const purchaseMember = (n = 300, copyScope = 'student', status = 'requested') => ({ id: id(n), purchase_order_id: id(200), textbook_id: id(101), requested_textbook_title: '', class_id: id(800), location_id: id(900), requested_quantity: 2, ordered_quantity: 0, received_quantity: 0, teacher_ordered_quantity: 0, teacher_received_quantity: 0, unit_cost: 0, copy_scope: copyScope, memo: '', created_at: '2026-08-01T00:00:00+00:00', updated_at: null, status, order: purchaseOrder(status) });
export const purchaseRow = (mode = 'request') => {
  const lines = [purchaseMember(), purchaseMember(301, 'teacher')];
  const quantities = { requested: 4, ordered: 0, received: 0, student: { requested: 2, ordered: 0, received: 0 }, teacher: { requested: 2, ordered: 0, received: 0 } };
  return { id: `requested||${id(101)}||${id(800)}||${id(900)}||선생님||||2026-08-01||`, anchorLineId: id(300), memberLineIds: [id(300), id(301)], line: { ...lines[0], purchaseScopeLines: lines }, lines, mode, status: 'requested', eventAt: '2026-08-01T00:00:00+00:00', quantities,
    references: { textbook: workflowBook(), class: { id: id(800), name: '중2반', studentCount: 3 }, location: { id: id(900), code: 'main', name: '본관' }, publisher: null, supplier: null, configuredSupplierId: '', unitCost: 9000 } };
};
export const purchaseSummary = (mode = 'request') => {
  const quantities = { requested: 4, ordered: 0, received: 0, student: { requested: 2, ordered: 0, received: 0 }, teacher: { requested: 2, ordered: 0, received: 0 } };
  return { mode, totalCount: 1, rawLineCount: 2, quantities, groups: [{ status: 'requested', totalCount: 1, rawLineCount: 2, quantities }], requestCounts: { all: 1, unregistered: 0, orderable: 1 }, orderCounts: { all: 1, waiting: 1, partial: 0, returnable: 0, returned: 0 }, boardScopeCounts: { all: 1, active: 1, recent: 1 } };
};
export const saleRow = () => {
  const line = { id: id(400), sale_id: id(500), student_id: null, class_id: id(800), textbook_id: id(101), charge_month: '2026-08', quantity: 2, unit_price: 10000, location_id: id(900), status: 'charged', exclusion_reason: '', memo: '', created_at: '2026-08-01T00:00:00+00:00', updated_at: null, copy_scope: 'teacher', teacher_id: null, teacher_name: '김선생' };
  const sale = { id: id(500), class_id: id(800), charge_month: '2026-08', sale_date: '2026-08-01', status: 'charged', memo: '', created_by: id(901), created_at: '2026-08-01T00:00:00+00:00', updated_at: null };
  return { id: id(400), line, sale, textbook: workflowBook(), class: { id: id(800), name: '중2반', studentCount: 3 }, student: null, location: { id: id(900), code: 'main', name: '본관' }, status: 'charged', groupStatus: 'charged', eventAt: '2026-08-01T00:00:00+00:00', quantity: 2, amount: 20000, recipientName: '김선생' };
};
export const saleSummary = () => ({ totalCount: 1, totalQuantity: 2, studentCount: 0, classCount: 1, totalAmount: 20000, groups: [{ status: 'charged', totalCount: 1, totalQuantity: 2 }], statusCounts: { all: 1, waiting: 1, issued: 0, returned: 0, cancelled: 0 } });
export const saleHistoryRow = () => ({ id: `2026-08:${id(800)}:${id(101)}`, year: '2026', month: '2026-08', classId: id(800), className: '중2반', textbookId: id(101), textbookTitle: '교재 101', waitingQuantity: 2, issuedQuantity: 3, totalQuantity: 5, latestAt: '2026-08-31T00:00:00+00:00' });
export const saleHistorySummary = () => ({ totalCount: 1, totalWaitingQuantity: 2, totalIssuedQuantity: 3, sourceTotalCount: 1, yearOptions: ['2026'], monthOptions: ['2026-08'], classOptions: [[id(800), '중2반']], effectiveMonth: 'all' });
export const closingRow = () => ({ id: id(700), closing_month: '2026-08', subject: 'all', opening_quantity: 1, opening_amount: 0, purchase_quantity: 0, purchase_amount: 0, sale_quantity: 0, sale_amount: 0, adjustment_quantity: 0, adjustment_amount: 0, ending_quantity: 1, ending_amount: 0, received_amount: 0, supplier_payment_amount: 0, settlement_difference: 0, status: 'draft', memo: '', created_by: null, created_at: null, updated_at: null });
export const closingMovementRow = () => ({ id: id(701), at: '2026-08-01T00:00:00+00:00', typeLabel: '출고', textbookTitle: '교재 101', locationName: '본관', quantity: -2, amount: -20000, marginAmount: 2000 });
const zeroClosingCalculation = () => ({ openingQuantity: 1, openingAmount: 0, purchaseQuantity: 0, purchaseAmount: 0, saleQuantity: 0, saleAmount: 0, adjustmentQuantity: 0, adjustmentAmount: 0, endingQuantity: 1, endingAmount: 0, receivedAmount: 0, supplierPaymentAmount: 0, paymentDifference: 0, textbookMarginAmount: 0, settlementDifference: 0, needsReview: false, teamMargins: ['english', 'math', 'science', 'other'].map(team => ({ team, saleQuantity: 0, saleAmount: 0, purchaseCostAmount: 0, marginAmount: 0 })) });
export const closingDetailEnvelope = () => ({ row: closingRow(), preview: { closingMonth: '2026-08', subject: 'all', sourceLineCount: 0, closing: zeroClosingCalculation() } });
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
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
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
    act: callback => act(async () => { await callback(); }),
    resolve: (request, data) => act(async () => { request.resolve({ data, error: null }); }),
    reject: (request, error) => act(async () => { request.resolve({ data: null, error }); }),
    settleLegacy: () => act(async () => {
      for (const request of io.requests.filter(request => request.table)) request.resolve({ data: [], error: null });
      for (const request of io.requests.filter(request => request.name === 'list_active_science_subject_areas_v1')) request.resolve({ data: [], error: null });
    }),
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
