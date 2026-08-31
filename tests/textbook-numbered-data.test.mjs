import test from 'node:test';
import assert from 'node:assert/strict';
import { id, setupHook } from './helpers/textbook-numbered-harness.mjs';

const masterFilters = { search: '', subject: 'all', schoolLevel: 'all', gradeLevel: 'all', subSubject: 'all', quality: 'all', inventory: 'all' };
const purchaseFilters = { search: '', boardScope: 'all', requestFilter: 'all', orderFilter: 'all' };
const inputs = () => ({
  viewerId: id(804), viewerRole: 'admin', authReady: true, operationsEnabled: false,
  master: { enabled: false, filters: { ...masterFilters } },
  requests: { enabled: false, filters: { ...purchaseFilters } },
  purchase: { enabled: false, filters: { ...purchaseFilters } },
  sales: { enabled: false, filters: { search: '', status: 'all' } },
  saleHistory: { enabled: false, filters: { search: '', year: 'all', month: 'all', classId: 'all' } },
  inventory: { enabled: false, filters: { ...masterFilters, locationId: '', audit: 'all' } },
  inventoryHistory: { enabled: false, filters: { textbookId: null, locationId: null } },
  closing: { enabled: false, filters: { month: 'all', subject: 'all', status: 'all' } },
  closingMovements: { enabled: false, filters: { closingMonth: '2026-08', subject: 'all', search: '' } },
});
const onlyMaster = (patch = {}) => { const input = inputs(); input.master = { ...input.master, enabled: true, ...patch }; return input; };
const masterRow = (n = 101) => ({
  id: id(n), title: `교재 ${n}`, name: `교재 ${n}`, subject: 'english', status: 'active',
  publisher: '출판사', category: '독해', isbn13: '978101', barcode: null, price: 10000,
  sale_price: 10000, list_price: 10000, salePrice: 10000, publisher_id: null, default_supplier_id: null,
  school_level: 'middle', grade_level: 'm2', school_levels: ['middle'], grade_levels: ['m2'], sub_subject: '독해',
  subject_area_key: null, is_returnable: false,
  locationQuantities: {}, studentLocationQuantities: {}, teacherLocationQuantities: {},
  totalQuantity: 0, studentQuantity: 0, teacherQuantity: 0, stockValue: 0, locationSummary: [],
  qualityIssues: { duplicate: false, missingCode: false, missingPublisher: false, missingCategory: false, missingPrice: false, subjectMismatch: false, inactive: false }, qualityScore: 0,
});
const pages = h => h.requests.filter(r => r.name?.startsWith('list_'));
const summaries = h => h.requests.filter(r => r.name === 'get_textbook_master_summary_v1');
const pageData = (request, totalCount = 0, rows = []) => ({ rows, page: request.args.p_page, pageSize: request.args.p_page_size, totalCount });
const masterSummary = () => ({ totalCount: 0, totalQuantity: 0, studentQuantity: 0, teacherQuantity: 0, stockValue: 0,
  salePriceTotal: 0, locationQuantities: {}, subjectTotals: [],
  qualityCounts: { all: 0, attention: 0, duplicate: 0, missingCode: 0, missingPublisher: 0, missingCategory: 0, missingPrice: 0, subjectMismatch: 0, inactive: 0 },
  inventoryCounts: { all: 0, shortage: 0, surplus: 0, unused: 0, negative: 0 }, subSubjectOptions: [], locations: [] });
const purchaseSummary = mode => ({ mode, totalCount: 0, rawLineCount: 0,
  quantities: { requested: 0, ordered: 0, received: 0, student: { requested: 0, ordered: 0, received: 0 }, teacher: { requested: 0, ordered: 0, received: 0 } },
  groups: [], requestCounts: { all: 0, unregistered: 0, orderable: 0 }, orderCounts: { all: 0, waiting: 0, partial: 0, returnable: 0, returned: 0 }, boardScopeCounts: { active: 0, recent: 0, all: 0 } });
const operationsSummary = () => ({ requestCount: 3, unregisteredRequestCount: 1, orderNeededCount: 2, receivingBacklogCount: 4, partialReceiptCount: 1, issueWaitingCount: 2, stockRiskCount: 1 });
const cases = [
  ['master', 'master', 'quality-title', { ...masterFilters, search: '교재', subject: 'english', quality: 'attention' }, masterSummary],
  ['requests', 'purchase', 'status-event', { ...purchaseFilters, search: '요청', requestFilter: 'unregistered' }, () => purchaseSummary('request')],
  ['purchase', 'purchase', 'status-event', { ...purchaseFilters, search: '주문', boardScope: 'recent', orderFilter: 'partial' }, () => purchaseSummary('order')],
  ['sales', 'sale', 'status-event', { search: '판매', status: 'issued' }, () => ({ totalCount: 0, totalQuantity: 0, studentCount: 0, classCount: 0, totalAmount: 0, groups: [], statusCounts: { all: 0, waiting: 0, issued: 0, returned: 0, cancelled: 0 } })],
  ['saleHistory', 'sale_history', 'month-class-title', { search: '', year: '2026', month: '2026-08', classId: id(800) }, () => ({ totalCount: 0, totalWaitingQuantity: 0, totalIssuedQuantity: 0, sourceTotalCount: 0, yearOptions: [], monthOptions: [], classOptions: [], effectiveMonth: 'all' })],
  ['inventory', 'inventory', 'audit-priority', { ...masterFilters, locationId: id(900), audit: 'pending' }, () => ({ ...masterSummary(), auditCounts: { recommended: 0, pending: 0, done: 0, all: 0 } })],
  ['inventoryHistory', 'inventory_history', 'event-desc', { textbookId: id(101), locationId: id(900) }],
  ['closing', 'closing', 'month-desc', { month: '2026-08', subject: 'english', status: 'locked' }],
  ['closingMovements', 'closing_movement', 'event-desc', { closingMonth: '2026-08', subject: 'english', search: '출고' }],
];

test('actual hook restores page 11 directly with strict service rows and no full-load transport', async t => {
  const h = await setupHook(t, onlyMaster({ restoredPage: 11, restorationKey: 'direct-11' }));
  const request = pages(h)[0];
  assert.equal(request.name, 'list_textbook_master_page_v1');
  assert.equal(request.args.p_page, 11);
  assert.equal(request.args.p_page_size, 10);
  const rows = [masterRow(102), masterRow(101)];
  await h.resolve(request, pageData(request, 102, rows));
  assert.equal(h.current.master.page, 11);
  assert.equal(h.current.master.totalCount, 102);
  assert.deepEqual(h.current.master.rows.map(row => row.id), rows.map(row => row.id));
  assert.deepEqual(h.current.master.acceptedFilters, masterFilters);
  assert.equal(h.current.master.loading, false, 'page publication does not wait for summary');
  assert.deepEqual(h.requests.filter(item => item.table), []);
});

test('URL-restored size owns the first request and Back-size restoration reuses the matching summary', async t => {
  let input = onlyMaster({ restoredPage: 3, restoredPageSize: 15, restorationKey: 'direct-15' });
  const h = await setupHook(t, input);
  assert.deepEqual(pages(h).map(request => [request.args.p_page, request.args.p_page_size]), [[3, 15]]);
  await h.resolve(pages(h)[0], pageData(pages(h)[0], 40, [masterRow()]));
  await h.resolve(summaries(h)[0], masterSummary());

  input = onlyMaster({ restoredPage: 2, restoredPageSize: 20, restorationKey: 'back-20' });
  await h.rerender(input);
  assert.deepEqual(pages(h).map(request => [request.args.p_page, request.args.p_page_size]), [[3, 15], [2, 20]]);
  assert.equal(summaries(h).length, 1);
});

for (const [key, rpc, sort, filters, summary] of cases) test(`${key} owns exact RPC/filter/sort/mode and all three persisted sizes`, async t => {
  const input = inputs(); input[key] = { enabled: true, filters };
  const h = await setupHook(t, input);
  const expectedFilters = key === 'requests' || key === 'purchase' ? { ...filters, mode: key === 'requests' ? 'request' : 'order' } : filters;
  for (const pageSize of [10, 15, 20]) {
    if (pageSize !== 10) await h.act(() => h.current[key].setPageSizePreference(pageSize));
    const request = pages(h).at(-1);
    assert.equal(request.name, `list_textbook_${rpc}_page_v1`);
    assert.deepEqual(request.args, { p_page: 1, p_page_size: pageSize, p_sort: sort, p_filters: expectedFilters });
    assert.equal(request.retry, false);
    assert.ok(request.signal instanceof AbortSignal);
    await h.resolve(request, pageData(request));
    assert.equal(h.current[key].pageSize, pageSize);
    assert.equal(h.current[key].totalCount, 0);
    assert.deepEqual(h.current[key].acceptedFilters, expectedFilters);
    if (summary) {
      const requestSummary = h.requests.filter(r => r.name === `get_textbook_${rpc}_summary_v1`).at(-1);
      assert.deepEqual(requestSummary.args, { p_filters: expectedFilters });
      if (pageSize === 10) await h.resolve(requestSummary, summary());
      assert.deepEqual(h.current[key].summary.value, summary());
      assert.deepEqual(JSON.parse(h.current[key].summary.scope).filters, h.current[key].acceptedFilters);
      assert.equal(h.requests.filter(r => r.name === `get_textbook_${rpc}_summary_v1`).length, 1);
    } else assert.equal('summary' in h.current[key], false);
  }
  const scopeNames = { saleHistory: 'sales-history', inventoryHistory: 'inventory-history', closingMovements: 'closing-movements' };
  const stored = JSON.parse(window.localStorage.getItem('tips.data-table-page-size.v1'));
  assert.deepEqual(stored[`textbooks:${scopeNames[key] || key}`], { mode: 'manual', pageSize: 20 });
  assert.equal(h.current[key].pageSizeMode, 'manual');
  assert.deepEqual(h.requests.filter(r => r.table), []);
});

test('direct 10 to 11 retains page/count during pending failure and retries exactly the failed target', async t => {
  const commits = [];
  const h = await setupHook(t, onlyMaster({ restoredPage: 10, restorationKey: 'ten', onPageCommit: value => commits.push(value) }));
  const first = pages(h)[0]; const rows = Array.from({ length: 10 }, (_, i) => masterRow(110 - i));
  await h.resolve(first, pageData(first, 111, rows));
  await h.act(() => h.current.master.goToPage(11));
  assert.deepEqual(pages(h).map(r => r.args.p_page), [10, 11]);
  assert.equal(h.current.master.page, 10); assert.equal(h.current.master.requestedPage, 11);
  assert.deepEqual(h.current.master.rows, rows); assert.equal(h.current.master.totalCount, 111);
  const failure = { code: '42501', message: 'denied' };
  await h.reject(pages(h)[1], failure);
  assert.equal(h.current.master.error, failure); assert.equal(h.current.master.page, 10);
  await h.act(() => h.current.master.retry());
  assert.equal(pages(h).at(-1).args.p_page, 11);
  await h.resolve(pages(h).at(-1), pageData(pages(h).at(-1), 101, [masterRow()]));
  assert.equal(h.current.master.page, 11); assert.equal(h.current.master.error, null);
  assert.deepEqual(commits.map(c => c.page), [10, 11]);
});

test('empty out-of-range count uses the shared single clamp and retains accepted data if count changes again', async t => {
  const h = await setupHook(t, onlyMaster({ restoredPage: 11, restorationKey: 'eleven' }));
  await h.resolve(pages(h)[0], pageData(pages(h)[0], 15));
  assert.deepEqual(pages(h).map(r => r.args.p_page), [11, 2]);
  const rows = Array.from({ length: 5 }, (_, i) => masterRow(i + 1));
  await h.resolve(pages(h)[1], pageData(pages(h)[1], 15, rows));
  assert.equal(h.current.master.page, 2); assert.equal(h.current.master.totalCount, 15);
  await h.act(() => h.current.master.goToPage(11));
  await h.resolve(pages(h)[2], pageData(pages(h)[2], 15));
  await h.resolve(pages(h)[3], pageData(pages(h)[3], 0));
  assert.equal(pages(h).length, 4); assert.match(h.current.master.error.message, /Page range changed again/);
  assert.equal(h.current.master.page, 2); assert.deepEqual(h.current.master.rows, rows);
  await h.act(() => h.current.master.retry());
  await h.resolve(pages(h)[4], pageData(pages(h)[4], 0));
  await h.resolve(pages(h)[5], pageData(pages(h)[5], 0));
  assert.equal(h.current.master.page, 1); assert.equal(h.current.master.totalCount, 0);
});

test('one simultaneous filter/size reset leaves the accepted old filters intact until a successful new page', async t => {
  let input = onlyMaster({ restoredPage: 11, restorationKey: 'start' });
  const h = await setupHook(t, input);
  await h.resolve(pages(h)[0], pageData(pages(h)[0], 101, [masterRow()]));
  input = { ...input, master: { ...input.master, filters: { ...masterFilters, search: '새 검색' } } };
  await h.act(() => { h.current.master.setPageSizePreference(15); void h.rerender(input); });
  assert.equal(pages(h).length, 2);
  assert.equal(pages(h)[1].args.p_page, 1); assert.equal(pages(h)[1].args.p_page_size, 15);
  assert.deepEqual(h.current.master.acceptedFilters, masterFilters);
  await h.reject(pages(h)[1], { message: 'temporary' });
  await h.act(() => h.current.master.refresh());
  assert.equal(pages(h)[2].args.p_page, 1); assert.equal(pages(h)[2].args.p_filters.search, '새 검색');
  await h.resolve(pages(h)[2], pageData(pages(h)[2], 1, [masterRow(202)]));
  assert.equal(h.current.master.acceptedFilters.search, '새 검색');
});

test('request/order and secondary scopes navigate and pause independently', async t => {
  let input = inputs();
  for (const key of ['requests', 'purchase', 'saleHistory', 'inventoryHistory', 'closing', 'closingMovements']) input[key].enabled = true;
  const h = await setupHook(t, input);
  for (const request of pages(h)) await h.resolve(request, pageData(request));
  await h.act(() => h.current.requests.goToPage(11));
  assert.equal(pages(h).length, 7); assert.equal(pages(h).at(-1).args.p_filters.mode, 'request');
  input = { ...input, requests: { ...input.requests, enabled: false } };
  await h.rerender(input);
  assert.equal(pages(h).at(-1).signal.aborted, true);
  for (const key of ['purchase', 'saleHistory', 'inventoryHistory', 'closing', 'closingMovements']) assert.equal(h.current[key].loading, false);
});

test('pause aborts page and summary; same-filter resume preserves interrupted target and restoration takes precedence', async t => {
  let input = onlyMaster({ restoredPage: 10, restorationKey: 'ten' }); const h = await setupHook(t, input);
  const first = pages(h)[0]; const rows = Array.from({ length: 10 }, (_, i) => masterRow(i + 1));
  await h.resolve(first, pageData(first, 111, rows));
  await h.act(() => h.current.master.goToPage(11)); const interrupted = pages(h).at(-1); const summary = summaries(h)[0];
  input = { ...input, master: { ...input.master, enabled: false } }; await h.rerender(input);
  assert.equal(interrupted.signal.aborted, true); assert.equal(summary.signal.aborted, true);
  assert.equal(h.current.master.page, 10); assert.equal(h.current.master.loading, false);
  await h.resolve(interrupted, pageData(interrupted, 101, [masterRow(200)]));
  await h.resolve(summary, masterSummary());
  assert.deepEqual(h.current.master.rows, rows); assert.equal(h.current.master.summary.value, null);
  input = { ...input, master: { ...input.master, enabled: true } }; await h.rerender(input);
  assert.equal(pages(h).at(-1).args.p_page, 11);
  await h.resolve(pages(h).at(-1), pageData(pages(h).at(-1), 101, [masterRow(200)]));
  input = { ...input, master: { ...input.master, enabled: false } }; await h.rerender(input);
  input = { ...input, master: { ...input.master, enabled: true, restorationKey: 'new-entry', restoredPage: 3 } }; await h.rerender(input);
  assert.equal(pages(h).at(-1).args.p_page, 3);
});

for (const first of ['summary', 'page']) test(`${first}-first arrival never lets a summary overwrite rows/page/full count`, async t => {
  const h = await setupHook(t, onlyMaster({ restoredPage: 11, restorationKey: '11' }));
  const request = pages(h)[0], summary = summaries(h)[0];
  const resolvePage = () => h.resolve(request, pageData(request, 101, [masterRow()]));
  const resolveSummary = () => h.resolve(summary, masterSummary());
  if (first === 'summary') { await resolveSummary(); assert.equal(h.current.master.scope, null); assert.equal(h.current.master.acceptedFilters, null); assert.equal(h.current.master.summary.value, null); await resolvePage(); }
  else { await resolvePage(); assert.equal(h.current.master.loading, false); await resolveSummary(); }
  assert.equal(h.current.master.page, 11); assert.equal(h.current.master.totalCount, 101); assert.equal(h.current.master.rows.length, 1);
  assert.equal(h.current.master.summary.value.totalCount, 0);
});

test('summary failure/retry is independent and obsolete filter completion cannot contaminate accepted page', async t => {
  let input = onlyMaster(); const h = await setupHook(t, input);
  await h.resolve(pages(h)[0], pageData(pages(h)[0], 1, [masterRow()]));
  const oldScope = h.current.master.scope; const oldSummary = summaries(h)[0];
  input = { ...input, master: { ...input.master, filters: { ...masterFilters, search: 'new' } } }; await h.rerender(input);
  assert.equal(oldSummary.signal.aborted, true);
  await h.resolve(oldSummary, masterSummary()); assert.equal(h.current.master.summary.value, null);
  const failure = { message: 'summary failed' }; await h.reject(summaries(h)[1], failure);
  assert.equal(h.current.master.summary.error, failure); assert.equal(h.current.master.scope, oldScope);
  assert.deepEqual(h.current.master.acceptedFilters, masterFilters);
  await h.act(() => h.current.master.summary.retry());
  assert.equal(pages(h).length, 2); assert.equal(summaries(h)[2].args.p_filters.search, 'new');
  await h.resolve(summaries(h)[2], masterSummary());
  assert.equal(h.current.master.summary.value, null, 'new-filter summary is not attached to old-filter rows');
  assert.equal(h.current.master.scope, oldScope); assert.deepEqual(h.current.master.acceptedFilters, masterFilters);
  assert.notEqual(h.current.master.summary.scope, oldScope);
  await h.resolve(pages(h)[1], pageData(pages(h)[1]));
  assert.deepEqual(JSON.parse(h.current.master.summary.scope).filters, h.current.master.acceptedFilters);
});

test('page-only and size-only navigation reuse a matching full-filter summary, including one still pending', async t => {
  const h = await setupHook(t, onlyMaster()); const originalSummary = summaries(h)[0];
  await h.resolve(pages(h)[0], pageData(pages(h)[0]));
  await h.act(() => h.current.master.goToPage(11));
  await h.act(() => h.current.master.setPageSizePreference(15));
  assert.equal(summaries(h).length, 1); assert.equal(originalSummary.signal.aborted, false);
  await h.resolve(originalSummary, masterSummary());
  const scope = h.current.master.summary.scope;
  await h.act(() => h.current.master.setPageSizePreference(20));
  assert.equal(summaries(h).length, 1); assert.equal(h.current.master.summary.scope, scope);
  assert.deepEqual(h.current.master.summary.value, masterSummary());
  await h.act(() => h.current.master.summary.retry()); assert.equal(summaries(h).length, 2);
});

test('auth readiness and actor/role gate all resources, including operations', async t => {
  let input = inputs(); for (const [key] of cases) input[key].enabled = true; input.operationsEnabled = true; input.authReady = false;
  const h = await setupHook(t, input); assert.equal(h.requests.length, 0);
  for (const patch of [{ authReady: true, viewerId: '' }, { viewerId: id(804), viewerRole: '' }, { viewerRole: 'student' }]) {
    input = { ...input, ...patch }; await h.rerender(input); assert.equal(h.requests.length, 0);
  }
  input = { ...input, viewerRole: 'teacher' }; await h.rerender(input);
  assert.deepEqual(h.requests.map(r => r.name).sort(), ['get_textbook_purchase_summary_v1', 'list_textbook_purchase_page_v1']);
  assert.equal(h.requests[0].args.p_filters.mode, 'request');
  assert.equal(h.current.operations.value, null); assert.equal(h.current.master.loading, false);
});

test('same-ID role change and logout/relogin clear all resources and reject stale callbacks/completions', async t => {
  let input = inputs(); for (const [key] of cases) input[key].enabled = true; input.operationsEnabled = true;
  const h = await setupHook(t, input); const oldRequests = [...h.requests]; const old = h.current;
  await h.resolve(pages(h).find(r => r.name === 'list_textbook_master_page_v1'), pageData(pages(h)[0], 1, [masterRow()]));
  await h.resolve(summaries(h)[0], masterSummary());
  await h.resolve(h.requests.find(r => r.name === 'get_textbook_operations_summary_v1'), operationsSummary());
  input = { ...input, viewerRole: 'staff' }; await h.rerender(input);
  for (const [key] of cases) { assert.deepEqual(h.current[key].rows, []); assert.equal(h.current[key].acceptedFilters, null); if (h.current[key].summary) assert.equal(h.current[key].summary.value, null); }
  assert.equal(h.current.operations.value, null); assert.ok(oldRequests.every(r => r.signal.aborted));
  const length = h.requests.length;
  await h.act(() => { old.master.goToPage(9); old.master.retry(); old.master.refresh(); old.master.summary.retry(); old.operations.retry(); old.refreshVisible(); old.master.setPageSizePreference(20); });
  assert.equal(h.requests.length, length); assert.equal(h.current.master.pageSizeMode, 'manual');
  const staffRequests = h.requests.slice(oldRequests.length);
  input = { ...input, viewerId: '', viewerRole: '', authReady: false }; await h.rerender(input);
  for (const request of staffRequests) await h.resolve(request, request.name.startsWith('list_') ? pageData(request) : request.name === 'get_textbook_operations_summary_v1' ? operationsSummary() : null);
  assert.deepEqual(h.current.master.rows, []); assert.equal(h.current.master.loading, false); assert.equal(h.current.operations.value, null);
  input = { ...input, viewerId: id(804), viewerRole: 'admin', authReady: true }; await h.rerender(input);
  assert.deepEqual(h.current.master.rows, []); assert.equal(h.current.master.summary.value, null);
  const before = h.requests.length; await h.act(() => old.refreshVisible()); assert.equal(h.requests.length, before);
});

test('late page/summary/operations from the prior role cannot publish into the new role', async t => {
  const commits = []; let input = onlyMaster({ onPageCommit: value => commits.push(value) }); input.operationsEnabled = true;
  const h = await setupHook(t, input); const old = [...h.requests];
  input = { ...input, viewerRole: 'staff' }; await h.rerender(input);
  const fresh = h.requests.slice(old.length);
  await h.resolve(old.find(r => r.name.startsWith('list_')), pageData(old.find(r => r.name.startsWith('list_')), 1, [masterRow()]));
  await h.resolve(old.find(r => r.name === 'get_textbook_master_summary_v1'), masterSummary());
  await h.resolve(old.find(r => r.name === 'get_textbook_operations_summary_v1'), operationsSummary());
  assert.equal(commits.length, 0); assert.deepEqual(h.current.master.rows, []);
  assert.equal(h.current.master.summary.value, null); assert.equal(h.current.operations.value, null);
  await h.resolve(fresh.find(r => r.name.startsWith('list_')), pageData(fresh.find(r => r.name.startsWith('list_')), 1, [masterRow(202)]));
  await h.resolve(fresh.find(r => r.name === 'get_textbook_master_summary_v1'), masterSummary());
  await h.resolve(fresh.find(r => r.name === 'get_textbook_operations_summary_v1'), operationsSummary());
  assert.equal(commits.length, 1); assert.equal(h.current.master.rows[0].id, id(202));
  assert.deepEqual(h.current.master.summary.value, masterSummary()); assert.deepEqual(h.current.operations.value, operationsSummary());
});

test('refreshVisible waits for enabled pages and summaries without starting disabled reads', async t => {
  const input = onlyMaster(); input.operationsEnabled = true; const h = await setupHook(t, input);
  await h.resolve(pages(h)[0], pageData(pages(h)[0])); await h.resolve(summaries(h)[0], masterSummary());
  await h.resolve(h.requests.find(r => r.name === 'get_textbook_operations_summary_v1'), operationsSummary());
  let settled = false; let promise;
  await h.act(() => { promise = h.current.refreshVisible().then(() => { settled = true; }); });
  const fresh = h.requests.slice(3); assert.equal(fresh.length, 3); assert.equal(settled, false);
  await h.resolve(fresh.find(r => r.name.startsWith('list_')), pageData(fresh.find(r => r.name.startsWith('list_'))));
  await h.resolve(fresh.find(r => r.name === 'get_textbook_master_summary_v1'), masterSummary()); assert.equal(settled, false);
  await h.resolve(fresh.find(r => r.name === 'get_textbook_operations_summary_v1'), operationsSummary()); await promise;
  assert.equal(settled, true); assert.equal(h.current.operations.value.requestCount, 3);
});

for (const boundary of ['normal', 'auth']) test(`${boundary} unmount invalidates retained summary/operations/refresh callbacks`, async t => {
  const input = onlyMaster(); input.operationsEnabled = true;
  const h = await setupHook(t, input); const retained = h.current;
  const original = [...h.requests];
  assert.equal(original.length, 3);
  if (boundary === 'normal') await h.unmount();
  else await h.setOwnerPresent(false);
  assert.ok(original.every(request => request.signal.aborted));
  const pending = [];
  await h.act(() => { pending.push(retained.master.summary.retry(), retained.operations.retry(), retained.refreshVisible()); });
  const unexpected = h.requests.slice(original.length).map(request => request.name);
  // Settle even a broken implementation's new transports so RED leaves no pending work.
  for (const request of h.requests) await h.reject(request, { message: 'post-unmount settlement' });
  await Promise.all(pending);
  assert.deepEqual(unexpected, [], 'unmounted owner must not restart summary RPCs');
});

test('auth-boundary remount creates a working lifetime without reviving the disposed owner callbacks', async t => {
  const input = onlyMaster(); input.operationsEnabled = true;
  const h = await setupHook(t, input); const retained = h.current; const original = [...h.requests];
  await h.setOwnerPresent(false);
  await h.setOwnerPresent(true);
  const fresh = h.requests.slice(original.length);
  assert.equal(fresh.length, 3); assert.ok(fresh.every(request => !request.signal.aborted));
  const before = h.requests.length; const pending = [];
  await h.act(() => { pending.push(retained.master.summary.retry(), retained.operations.retry(), retained.refreshVisible()); });
  const unexpected = h.requests.slice(before).map(request => request.name);
  for (const request of h.requests.slice(before)) await h.reject(request, { message: 'disposed owner settlement' });
  await Promise.all(pending);
  assert.deepEqual(unexpected, [], 'remount must not reactivate the old lifetime');
  for (const request of original) await h.reject(request, { message: 'old completion' });
  assert.deepEqual(h.current.master.rows, []); assert.equal(h.current.operations.value, null);
  const page = fresh.find(request => request.name.startsWith('list_'));
  await h.resolve(page, pageData(page, 1, [masterRow(202)]));
  await h.resolve(fresh.find(request => request.name === 'get_textbook_master_summary_v1'), masterSummary());
  await h.resolve(fresh.find(request => request.name === 'get_textbook_operations_summary_v1'), operationsSummary());
  assert.equal(h.current.master.rows[0].id, id(202));
  assert.deepEqual(h.current.master.summary.value, masterSummary()); assert.deepEqual(h.current.operations.value, operationsSummary());
  await h.act(() => { h.current.master.summary.retry(); h.current.operations.retry(); });
  assert.equal(h.requests.length, before + 2, 'current owner callbacks remain eligible');
});

test('StrictMode lifetime cleanup/setup replay keeps current summary callbacks working', async t => {
  const input = onlyMaster(); input.operationsEnabled = true;
  const h = await setupHook(t, input, { strictMode: true });
  const live = h.requests.filter(request => !request.signal.aborted);
  assert.equal(live.length, 3);
  const page = live.find(request => request.name.startsWith('list_'));
  await h.resolve(page, pageData(page, 1, [masterRow()]));
  await h.resolve(live.find(request => request.name === 'get_textbook_master_summary_v1'), masterSummary());
  await h.resolve(live.find(request => request.name === 'get_textbook_operations_summary_v1'), operationsSummary());
  assert.deepEqual(h.current.master.summary.value, masterSummary()); assert.deepEqual(h.current.operations.value, operationsSummary());
  const before = h.requests.length;
  await h.act(() => { h.current.master.summary.retry(); h.current.operations.retry(); });
  assert.equal(h.requests.length, before + 2);
});
