import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { registerExistingPurchaseOrderQuantityTests } from './helpers/textbook-existing-order-quantity-cases.mjs';
const source = path.resolve(import.meta.dirname,'..');
const nativeRead = fs.readFileSync.bind(fs);
async function scenario(t,mode) {
const write = (name,value) => {
  if (process.env.PURCHASE_RETRY_EVIDENCE) fs.writeFileSync(path.join(process.env.PURCHASE_RETRY_EVIDENCE,`${mode}-${name}`),typeof value === 'string' ? value : JSON.stringify(value,null,2));
};
const cleanup = [];
let h;
const orders = [], lines = [], statements = [], readResponses = [], milestones = [];
let submitCount = 0, failedOnce = false;
const settled = new Set();
const title = '합성 재시도 확인 교재';
const location = { id: id(900), code: 'main', name: '합성 본관' };
const locationOption = { value: location.id, label: location.name, searchText: 'main' };
let textbook, bookOption, workflowBook;
const zeroQuantities = () => ({ requested: 0, ordered: 0, received: 0, student: { requested: 0, ordered: 0, received: 0 }, teacher: { requested: 0, ordered: 0, received: 0 } });
function quantities(items) {
  const value = zeroQuantities();
  for (const line of items) for (const kind of ['requested', 'ordered', 'received']) {
    value[kind] += line[`${kind}_quantity`];
    value[line.copy_scope][kind] += line[`${kind}_quantity`];
  }
  return value;
}
function committedState() {
  return { orderCount: orders.length, lineCount: lines.length,
    orderedQuantity: { student: quantities(lines).student.ordered, teacher: quantities(lines).teacher.ordered },
    orphanParentIds: orders.filter(order => !lines.some(line => line.purchase_order_id === order.id)).map(order => order.id),
    orders: structuredClone(orders), lines: structuredClone(lines) };
}
function projectRows(mode) {
  if (mode === 'request') return [];
  const parents = new Map(orders.map(order => [order.id, order]));
  const members = lines.map(line => ({ ...line, status: parents.get(line.purchase_order_id).status, order: parents.get(line.purchase_order_id) }));
  // The actual product grouping preserves repeated student members as separate rows.
  // No duplicate is inserted by this adapter; every member is one committed write.
  return h.load('src/features/textbooks/textbook-read-model.ts').buildPurchaseDisplayRows(members, parents, [textbook]).map(row => ({
    ...row, mode: 'order', status: row.line.status,
    eventAt: row.line.order.ordered_at || row.line.order.order_date || row.line.order.updated_at || row.line.updated_at || '',
    quantities: quantities(row.lines),
    references: { textbook: workflowBook, class: null, location, publisher: null, supplier: null, configuredSupplierId: '', unitCost: row.line.unit_cost },
  })).sort((left, right) => right.eventAt.localeCompare(left.eventAt) || left.anchorLineId.localeCompare(right.anchorLineId));
}
function summary(mode) {
  const rows = projectRows(mode), members = rows.flatMap(row => row.lines), q = quantities(members);
  return { mode, totalCount: rows.length, rawLineCount: members.length, quantities: q,
    groups: rows.length ? [{ status: 'ordered', totalCount: rows.length, rawLineCount: members.length, quantities: q }] : [],
    requestCounts: { all: 0, unregistered: 0, orderable: 0 },
    orderCounts: { all: rows.length, waiting: rows.length, partial: 0, returnable: 0, returned: 0 },
    boardScopeCounts: { all: rows.length, active: rows.length, recent: 0 } };
}
const readNames = new Set(['list_textbook_purchase_page_v1', 'get_textbook_purchase_summary_v1', 'get_textbook_operations_summary_v1',
  'list_textbook_reference_page_v1', 'list_textbook_class_reference_page_v1', 'list_textbook_teacher_reference_page_v1',
  'list_textbook_location_reference_page_v1', 'get_textbook_location_reference_v1', 'resolve_textbook_reference_v1', 'get_textbook_inventory_balance_v1']);
function readResponse(request) {
  assert.ok(readNames.has(request.name), `Unmodeled RPC denied: ${request.name}`);
  const a = request.args || {}, page = { page: a.p_page || 1, pageSize: a.p_page_size || 20 };
  switch (request.name) {
    case 'list_textbook_purchase_page_v1': {
      assert.ok(['', title].includes(a.p_filters.search), 'only actual diagnostic search is modeled');
      const rows = projectRows(a.p_filters.mode);
      return { rows: rows.slice((page.page - 1) * page.pageSize, page.page * page.pageSize), ...page, totalCount: rows.length };
    }
    case 'get_textbook_purchase_summary_v1': return summary(a.p_filters.mode);
    case 'get_textbook_operations_summary_v1': return { requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: projectRows('order').length, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0 };
    case 'list_textbook_reference_page_v1': return { rows: [bookOption], ...page, totalCount: 1, baseFilterGroups: [], visibleFilterGroups: [], activeFilterCount: 0 };
    case 'list_textbook_class_reference_page_v1': return { rows: [], ...page, totalCount: 0, baseFilterGroups: [], visibleFilterGroups: [], activeFilterCount: 0 };
    case 'list_textbook_teacher_reference_page_v1': return { rows: [], ...page, totalCount: 0 };
    case 'list_textbook_location_reference_page_v1': return { rows: [locationOption], ...page, totalCount: 1, defaultLocation: location };
    case 'get_textbook_location_reference_v1': assert.equal(a.p_location_id, location.id); return { row: { ...location, option: locationOption } };
    case 'resolve_textbook_reference_v1': assert.equal(a.p_reference, textbook.id); return { row: { textbook, option: bookOption, configuredSupplierId: '', supplier: null } };
    case 'get_textbook_inventory_balance_v1':
      assert.deepEqual(a.p_input, { textbookIds: [textbook.id], locationId: location.id });
      return { locationId: location.id, rows: [{ textbookId: textbook.id, currentQuantity: 10,
        locationQuantities: { [location.id]: 10 }, studentLocationQuantities: { [location.id]: 10 }, teacherLocationQuantities: {},
        totalQuantity: 10, studentQuantity: 10, teacherQuantity: 0, stockValue: 100000 }] };
  }
  assert.fail('no RPC fallback');
}
async function settleRead(request) {
  const result = readResponse(request);
  readResponses.push({ sequence: request.sequence, name: request.name, args: request.args, data: structuredClone(result) });
  settled.add(request);
  await h.resolve(request, result);
}
async function drainReads() {
  for (let round = 0; round < 30; round++) {
    const pending = h.requests.filter(request => !settled.has(request));
    if (!pending.length) return;
    for (const request of pending) {
      if (!request.table) { await settleRead(request); continue; }
      if (request.steps[0].method === 'insert') return;
      assert.deepEqual(request.steps.map(step => step.method), ['select','eq','maybeSingle']);
      const selectedId = request.steps[1].args[1];
      settled.add(request);
      await h.resolve(request, [...orders,...lines].find(row=>row.id===selectedId) || null);
    }
  }
  assert.fail('read loop did not quiesce');
}
async function nextWrite(table, scope, shouldFail = false) {
  const pending = h.requests.filter(request => !settled.has(request));
  assert.equal(pending.length, 1, 'one serial production statement is pending');
  const request = pending[0];
  assert.equal(request.table, table);
  assert.deepEqual(request.steps.map(step => step.method), ['insert', 'select', 'single']);
  const payload = structuredClone(request.steps[0].args[0]);
  if (scope) assert.equal(payload.copy_scope, scope);
  const index = statements.length + 1;
  const record = { index, submit: submitCount, table, payload, committed: !shouldFail };
  statements.push(record);
  settled.add(request);
  if (shouldFail) {
    assert.equal(failedOnce, false);
    failedOnce = true;
    record.error = mode !== 'unknown' ? { code: '23514', message: 'synthetic constraint failure', details: null, hint: null } : { message: 'synthetic teacher line write failure' };
    await h.act(() => request.resolve({ data: null, error: record.error, status: mode !== 'unknown' ? 400 : 0 }));
    return;
  }
  assert.ok(['textbook_purchase_orders', 'textbook_purchase_order_lines'].includes(table), 'other writes denied');
  const now = new Date().toISOString();
  const row = table === 'textbook_purchase_orders'
    ? { id: id(1000 + index), expected_date: null, created_at: now, updated_at: now, ...payload }
    : { id: id(2000 + index), teacher_ordered_quantity: 0, teacher_received_quantity: 0, created_at: now, updated_at: now, ...payload };
  if (table === 'textbook_purchase_orders') orders.push(row);
  else { assert.ok(orders.some(order => order.id === row.purchase_order_id), 'synthetic FK'); lines.push(row); }
  record.row = structuredClone(row);
  await h.act(() => request.resolve({ data: row, error: null, status: 201 }));
}
function snapshot(name) {
  const dialog = document.querySelector('[role="dialog"]');
  const form = dialog?.querySelector('form');
  const value = { name, dialogOpen: Boolean(dialog), title: dialog?.querySelector('[data-slot="dialog-title"]')?.textContent || '',
    studentInput: dialog?.querySelector('[aria-label="학생용 주문 수량"]')?.value ?? null,
    teacherInput: dialog?.querySelector('[aria-label="교사용 주문 수량"]')?.value ?? null,
    memo: dialog?.querySelector('[aria-label="요청 메모"]')?.value ?? null,
    saveDisabled: form?.querySelector('button[type="submit"]')?.disabled ?? null,
    formBusy: form?.getAttribute('aria-busy') ?? null,
    error: dialog?.querySelector('[role="alert"]')?.textContent || '',
    state: committedState() };
  milestones.push(value);
  write(`${name}.html`, '<!doctype html>\n' + document.documentElement.outerHTML);
  write(`${name}.json`, value);
  return value;
}
async function change(label, value) {
  const input = document.querySelector(`[aria-label="${label}"]`);
  assert.ok(input, `real input ${label}`);
  const props = input[Object.keys(input).find(key => key.startsWith('__reactProps$'))];
  // Existing repository harness dispatches the actual React input callback.
  await h.act(() => props.onChange({ target: { value } }));
}
async function submit() {
  const save = document.querySelector('[role="dialog"] form button[type="submit"]');
  assert.ok(save && !save.disabled, 'current real form is ready');
  submitCount++;
  await h.act(() => save.click());
}
try {
  h = await setup({ after: callback => cleanup.push(callback) }, { search: '?textbookTab=purchase&textbookPage=1&textbookPageSize=10' });
  const denyWindowNetwork = operation => () => { throw new Error(`test denies ${operation}`); };
  window.fetch = globalThis.fetch;
  window.XMLHttpRequest.prototype.open = denyWindowNetwork('window.XMLHttpRequest.open');
  window.WebSocket = denyWindowNetwork('window.WebSocket');
  if (window.navigator.sendBeacon) window.navigator.sendBeacon = denyWindowNetwork('navigator.sendBeacon');
  const fixtureText = nativeRead(`${source}/tests/textbook-work-context.test.mjs`, 'utf8');
  const literal = fixtureText.match(/const finalTask5b2WirePayload = (".*");/)?.[1];
  assert.ok(literal);
  const baseBook = JSON.parse(JSON.parse(literal)).data.textbook;
  textbook = { ...baseBook, id: id(101), name: title, title, category: null, school_level: 'middle', grade_level: '2',
    school_levels: ['middle'], grade_levels: ['2'], sub_subject: '문법', subject_area_key: null };
  workflowBook = Object.fromEntries(['id','title','name','status','subject','publisher','publisher_id','default_supplier_id','price','sale_price','list_price','isbn13','barcode','is_returnable'].map(key => [key, textbook[key]]));
  bookOption = h.load('src/features/textbooks/textbook-reference-model.ts').buildTextbookReferenceOptions([textbook])[0];
  await drainReads();
  await h.act(() => button('교재 주문 추가').click());
  await drainReads();
  await h.act(() => document.querySelector('[aria-label="교재 선택"]').click());
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes(title)).click());
  await drainReads();
  await change('학생용 주문 수량', '2');
  await change('교사용 주문 수량', '1');
  await change('요청 메모', '격리 합성 주문 재시도');
  const before = snapshot('01-before-submit');
  assert.deepEqual([before.studentInput, before.teacherInput, before.saveDisabled], ['2','1',false]);
  await submit();
  snapshot('02-first-save-pending');
  await nextWrite('textbook_purchase_orders');
  await nextWrite('textbook_purchase_order_lines', 'student');
  await nextWrite('textbook_purchase_orders');
  await nextWrite('textbook_purchase_order_lines', 'teacher', true);
  const failed = snapshot('03-after-teacher-line-failure');
  assert.deepEqual([failed.studentInput, failed.teacherInput, failed.memo, failed.saveDisabled, failed.formBusy], ['2','1','격리 합성 주문 재시도',false,'false']);
  assert.ok(failed.error.trim());
  assert.equal(failed.error.includes('synthetic teacher line write failure'), false);
  assert.deepEqual(failed.state.orderedQuantity, { student: 2, teacher: 0 });
  assert.equal(failed.state.orphanParentIds.length, 1);
  assert.equal(h.requests.filter(request => !settled.has(request)).length, 0, 'failed action did not refresh or retry itself');
  const retry = h.load('src/features/textbooks/textbook-purchase-retry.ts');
  const frozen = retry.readPurchaseAttempt(id(804), window.sessionStorage);
  assert.ok(frozen && frozen.steps.slice(0,3).every(step=>step.state==='confirmed'));
  assert.equal(document.querySelector('[aria-label="학생용 주문 수량"]').matches(':disabled'),true);
  // Directly invoking the real callback must also respect the frozen attempt.
  await change('학생용 주문 수량','9');
  assert.equal(document.querySelector('[aria-label="학생용 주문 수량"]').value,'2');
  if(mode==='lost-checkpoint') {
    window.sessionStorage.clear();
    await submit();
    assert.match(document.querySelector('[role="dialog"] [role="alert"]').textContent,/보관할 수 없습니다/);
    assert.equal(statements.length,4);
    await h.act(()=>button('교재 요청·주문 창 닫기').click());
    await h.act(()=>new Promise(resolve=>setTimeout(resolve,10)));
    await h.act(()=>button('교재 주문 추가').click());
    assert.equal(document.querySelector('[role="dialog"]'),null);
    assert.equal(statements.length,4);
    return;
  }
  await h.act(()=>button('교재 요청·주문 창 닫기').click());
  await h.act(()=>new Promise(resolve=>setTimeout(resolve,10)));
  assert.equal(document.querySelector('[role="dialog"]'),null);
  await h.navigate('?textbookTab=purchase&textbookPage=2&textbookPageSize=10');
  await drainReads();
  if(mode==='actor') {
    await h.auth({user:{id:id(805),email:'other@test.invalid'}});
    await drainReads();
    await h.act(()=>button('교재 주문 추가').click());
    await drainReads();
    assert.equal(document.querySelector('[aria-label="학생용 주문 수량"]').matches(':disabled'),false);
    assert.notEqual(document.querySelector('[aria-label="요청 메모"]').value,'격리 합성 주문 재시도');
    assert.equal(retry.readPurchaseAttempt(id(805),window.sessionStorage),null);
    await h.auth({user:{id:id(804),email:'admin@test.invalid'}});
    await drainReads();
  }
  await h.act(()=>button('교재 주문 추가').click());
  await drainReads();
  assert.equal(document.querySelector('[aria-label="학생용 주문 수량"]').value,'2');
  assert.equal(document.querySelector('[aria-label="요청 메모"]').value,'격리 합성 주문 재시도');
  assert.equal(document.querySelector('[role="dialog"] button[type="submit"]').textContent,'이어서 저장');
  assert.deepEqual(retry.readPurchaseAttempt(id(804),window.sessionStorage),frozen);
  await submit();
  snapshot('04-manual-retry-pending');
  await drainReads();
  if(mode==='unknown') {
    const blocked=snapshot('05-unknown-absent-halted');
    assert.equal(blocked.dialogOpen,true);assert.match(blocked.error,/저장 결과를 확인할 수 없습니다/);
    assert.equal(statements.length,4);assert.equal(orders.length,2);assert.equal(lines.length,1);
    assert.equal(retry.readPurchaseAttempt(id(804),window.sessionStorage).id,frozen.id);
    return;
  }
  await nextWrite('textbook_purchase_order_lines', 'teacher');
  let restoreStorage;
  if(mode==='cleanup') {
    const prototype=Object.getPrototypeOf(window.sessionStorage), get=prototype.getItem, remove=prototype.removeItem;
    let removed=false;
    prototype.removeItem=function(key){remove.call(this,key);removed=true};
    prototype.getItem=function(key){if(removed){removed=false;throw new Error('synthetic read failure after removal')}return get.call(this,key)};
    restoreStorage=()=>{prototype.getItem=get;prototype.removeItem=remove};
  }
  await drainReads();
  if(mode==='cleanup') {
    restoreStorage();
    const failedCleanup=snapshot('06-cleanup-failure');
    assert.equal(failedCleanup.dialogOpen,true);assert.match(failedCleanup.error,/보관할 수 없습니다/);
    assert.equal(retry.readPurchaseAttempt(id(804),window.sessionStorage),null);
    await submit();
    assert.equal(statements.length,5);
    assert.match(document.querySelector('[role="dialog"] [role="alert"]').textContent,/보관할 수 없습니다/);
    return;
  }
  await h.act(() => new Promise(resolve => setTimeout(resolve, 350)));
  await drainReads();
  const final = snapshot('05-after-manual-retry-success');
  assert.equal(final.dialogOpen, false);
  assert.equal(final.state.orderCount, 2);
  assert.equal(final.state.lineCount, 2);
  assert.deepEqual(final.state.orderedQuantity, { student: 2, teacher: 1 });
  assert.equal(final.state.orphanParentIds.length, 0);
  const renderedOrderTotals = [...document.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).filter(label => /(?:학생용|교사용) 주문 합계/.test(label));
  assert.ok(renderedOrderTotals.includes('학생용 주문 합계 2권'), JSON.stringify(renderedOrderTotals));
  assert.ok(renderedOrderTotals.includes('교사용 주문 합계 1권'), JSON.stringify(renderedOrderTotals));
  const projectedRows = projectRows('order');
  assert.equal(projectedRows.length, 1);
  assert.deepEqual(projectedRows.flatMap(row => row.memberLineIds).sort(), lines.map(line => line.id).sort());
  assert.equal(retry.readPurchaseAttempt(id(804),window.sessionStorage),null);
  await h.act(()=>button('교재 주문 추가').click());
  await drainReads();
  assert.equal(document.querySelector('[aria-label="학생용 주문 수량"]').matches(':disabled'),false);
  assert.notEqual(document.querySelector('[role="dialog"] button[type="submit"]').textContent,'이어서 저장');
} finally { for (const callback of cleanup.reverse()) await callback(); }
}
for(const mode of ['rollback','unknown','lost-checkpoint','cleanup','actor']) test(`actual new-order form: ${mode} partial failure / close / navigation / reopen / retry`, async t => scenario(t,mode));
registerExistingPurchaseOrderQuantityTests();
