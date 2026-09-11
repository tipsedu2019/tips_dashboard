import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id, inventoryHistoryRow, masterRow, masterSummary, purchaseRow, purchaseSummary, saleHistorySummary, saleRow, saleSummary } from './helpers/textbook-numbered-harness.mjs';

async function selectPurchaseDelete(h) {
  await h.act(() => document.querySelector('[aria-label="교재 101 요청 더보기"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const item = document.querySelector('[role="menuitem"][aria-label="교재 101 요청 건 삭제"]');
  assert.ok(item, 'the row menu exposes the original guarded delete action');
  await h.act(() => item.click());
}

async function acceptInventoryHistory(h) {
  const locationId = id(900);
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_location_reference_page_v1'), {
    rows: [{ value: locationId, label: '본관', searchText: '본관 main' }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: 'main', name: '본관' },
  });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_inventory_page_v1'), { rows: [], page: 1, pageSize: 10, totalCount: 0 });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_inventory_history_page_v1'), { rows: [inventoryHistoryRow(0)], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_inventory_summary_v1'), masterSummary(0, {
    locations: [{ id: locationId, code: 'main', name: '본관', sortOrder: 1 }], auditCounts: { all: 0, recommended: 0, pending: 0, done: 0 },
  }));
}

function purchaseLifecycleRow(status, offset = 0) {
  const base = purchaseRow('order', offset);
  const orderedQuantity = ['ordered', 'received', 'returned'].includes(status) ? 2 : 0;
  const receivedQuantity = ['received', 'returned'].includes(status) ? 2 : 0;
  const lines = base.lines.map(line => {
    const order = {
      ...line.order,
      status,
      ordered_at: orderedQuantity ? '2026-08-02T00:00:00+00:00' : null,
      received_at: receivedQuantity ? '2026-08-03T00:00:00+00:00' : null,
    };
    return { ...line, status, ordered_quantity: orderedQuantity, received_quantity: receivedQuantity, order };
  });
  const quantities = {
    requested: 4,
    ordered: orderedQuantity * 2,
    received: receivedQuantity * 2,
    student: { requested: 2, ordered: orderedQuantity, received: receivedQuantity },
    teacher: { requested: 2, ordered: orderedQuantity, received: receivedQuantity },
  };
  const primary = lines[0];
  const eventAt = status === 'ordered' ? primary.order.ordered_at
    : status === 'received' ? primary.order.received_at
      : primary.order.created_at;
  return {
    ...base,
    id: [status, primary.textbook_id, primary.class_id, primary.location_id, primary.order.requested_by, '', primary.order.order_date, ''].join('||'),
    line: { ...primary, purchaseScopeLines: lines },
    lines,
    status,
    eventAt,
    quantities,
  };
}

function purchaseLifecycleSummary(rows) {
  const sum = (scope, kind) => rows.reduce((total, row) => total + (scope ? row.quantities[scope][kind] : row.quantities[kind]), 0);
  return {
    mode: 'order', totalCount: rows.length, rawLineCount: rows.length * 2,
    quantities: {
      requested: sum('', 'requested'), ordered: sum('', 'ordered'), received: sum('', 'received'),
      student: { requested: sum('student', 'requested'), ordered: sum('student', 'ordered'), received: sum('student', 'received') },
      teacher: { requested: sum('teacher', 'requested'), ordered: sum('teacher', 'ordered'), received: sum('teacher', 'received') },
    },
    groups: rows.map(row => ({ status: row.status, totalCount: 1, rawLineCount: 2, quantities: row.quantities })),
    requestCounts: { all: rows.length, unregistered: 0, orderable: 0 },
    orderCounts: { all: rows.length, waiting: rows.filter(row => ['requested', 'ordered'].includes(row.status)).length, partial: rows.filter(row => row.status === 'partially_received').length, returnable: rows.filter(row => ['partially_received', 'received'].includes(row.status)).length, returned: rows.filter(row => row.status === 'returned').length },
    boardScopeCounts: { all: rows.length, active: rows.filter(row => ['requested', 'ordered', 'partially_received'].includes(row.status)).length, recent: rows.filter(row => row.status === 'received').length },
  };
}

test('actual textbook consumer restores direct master page 11 without starting the full operations bundle', async t => {
  const h = await setup(t, { search: '?textbookTab=master&textbookPage=11&textbookPageSize=10&unrelated=keep' });
  assert.deepEqual(h.requests.filter(request => request.table).map(request => request.table), [], 'ordinary startup must not read the legacy seventeen-table bundle');
  const pages = h.requests.filter(request => request.name === 'list_textbook_master_page_v1');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].args.p_page, 11);
  assert.equal(pages[0].args.p_page_size, 10);
});

test('unresolved authentication does not start textbook reads', async t => {
  const h = await setup(t, { auth: { user: null, role: null, loading: true } });
  assert.equal(h.requests.length, 0);
});

test('purchase deletion reads the complete actual member before opening confirmation', async t => {
  const h = await setup(t, { search: '?textbookTab=requests' });
  const page = h.requests.find(request => request.name === 'list_textbook_purchase_page_v1');
  const summary = h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1');
  await h.resolve(page, { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(summary, purchaseSummary('request'));
  await selectPurchaseDelete(h);
  const detail = h.requests.filter(request => request.name === 'get_textbook_purchase_detail_v1');
  assert.equal(detail.length, 1, 'confirmation authority must be a fresh complete purchase detail');
  assert.deepEqual(detail[0].args, { p_anchor_line_id: purchaseRow('request').anchorLineId, p_mode: 'request' });
  assert.equal(document.body.textContent.includes('요청 묶음 삭제'), false, 'confirmation waits for complete detail');
  await h.resolve(detail[0], { row: purchaseRow('request') });
  assert.equal(document.body.textContent.includes('요청 묶음 삭제'), true, 'complete detail opens the original destructive confirmation');
  assert.equal(document.querySelector('[role="alertdialog"]')?.textContent.includes('교재 101'), true);
  assert.equal(h.requests.some(request => request.table), false, 'opening confirmation starts zero writers');
  await h.act(() => button('요청 묶음 삭제 취소').click());
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.equal(h.requests.some(request => request.table), false, 'cancelling confirmation starts zero writers');
});

test('master cleanup confirmation keeps the complete long title and selection when cancelled without writing', async t => {
  const longTitle = '전체 교재명이 줄임 없이 표시되는 선택 교재 '.repeat(4).trim();
  const h = await setup(t, { search: '?textbookTab=master&textbookPage=1&textbookPageSize=10' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_master_page_v1'), { rows: [masterRow(1, { title: longTitle, name: longTitle })], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_master_summary_v1'), masterSummary(1));
  await h.act(() => document.querySelector('[data-prepared-surface="master-desktop"] [role="checkbox"]').click());
  await h.act(() => button('선택 교재 작업').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await h.act(() => document.querySelector('[role="menuitem"][aria-label="선택 교재 삭제"]').click());

  const dialog = document.querySelector('[role="alertdialog"]');
  assert.ok(dialog);
  assert.equal(dialog.querySelector('[aria-label="정리 대상 교재"] p')?.textContent, longTitle);
  assert.ok(button('선택 교재 정리 정리 실행'));
  assert.equal(h.requests.some(request => request.table), false);
  await h.act(() => button('선택 교재 정리 취소').click());
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]')?.textContent.includes('1개 선택'));
  assert.equal(h.requests.some(request => request.table), false);
});

test('inventory history confirmation blocks duplicate execution, preserves its target after failure, and closes after retry', async t => {
  const h = await setup(t, { search: '?textbookTab=inventory&textbookPage=1&textbookPageSize=10' });
  await acceptInventoryHistory(h);
  await h.act(() => document.querySelector('[aria-label="교재 301 재고 이력 삭제"]').click());
  assert.ok(document.querySelector('[role="alertdialog"]')?.textContent.includes('교재 301'));
  assert.equal(h.requests.filter(request => request.name === 'delete_textbook_inventory_history_v1').length, 0);

  const confirm = button('재고 이력 삭제 이력 삭제');
  await h.act(() => { confirm.click(); confirm.click(); });
  let writers = h.requests.filter(request => request.name === 'delete_textbook_inventory_history_v1');
  assert.equal(writers.length, 1, 'rapid repeated confirmation starts one mutation');
  assert.ok(document.querySelector('[role="alertdialog"]'), 'pending confirmation stays open');
  assert.equal(button('재고 이력 삭제 취소').disabled, true);
  assert.equal(button('재고 이력 삭제 이력 삭제').disabled, true);

  await h.reject(writers[0], { message: '합성 재고 이력 삭제 실패' });
  assert.ok(document.querySelector('[role="alertdialog"] [role="alert"]'));
  assert.ok(document.querySelector('[role="alertdialog"]')?.textContent.includes('교재 301'), 'failed confirmation retains its target');
  assert.equal(button('재고 이력 삭제 이력 삭제').disabled, false);

  await h.act(() => button('재고 이력 삭제 이력 삭제').click());
  writers = h.requests.filter(request => request.name === 'delete_textbook_inventory_history_v1');
  assert.equal(writers.length, 2);
  await h.resolve(writers[1], { kind: 'count', id: id(600), deleted: true });
  await h.act(() => Promise.resolve());

  const refreshes = h.requests.filter(request => request.sequence > writers[1].sequence && request.name);
  const operationsSummary = { requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0 };
  for (const request of refreshes) {
    if (request.name === 'list_textbook_inventory_page_v1') await h.resolve(request, { rows: [], page: 1, pageSize: 10, totalCount: 0 });
    else if (request.name === 'list_textbook_inventory_history_page_v1') await h.resolve(request, { rows: [], page: 1, pageSize: 10, totalCount: 0 });
    else if (request.name === 'get_textbook_inventory_summary_v1') await h.resolve(request, masterSummary(0, { locations: [{ id: id(900), code: 'main', name: '본관', sortOrder: 1 }], auditCounts: { all: 0, recommended: 0, pending: 0, done: 0 } }));
    else if (request.name === 'get_textbook_operations_summary_v1') await h.resolve(request, operationsSummary);
  }
  await h.act(() => Promise.resolve());
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.ok(document.body.textContent.includes('재고 이력을 삭제했습니다.'));
});

test('sale cancellation preview uses the fresh teacher recipient and rechecks before writing', async t => {
  const h = await setup(t, { search: '?textbookTab=sales&textbookPage=1&textbookPageSize=10' });
  const row = saleRow(0);
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_sale_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_sale_summary_v1'), saleSummary(1));
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_sale_history_page_v1'), { rows: [], page: 1, pageSize: 10, totalCount: 0 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_sale_history_summary_v1'), saleHistorySummary(0));

  await h.act(() => button(`김선생 교재 101 출고 더보기`).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await h.act(() => document.querySelector('[role="menuitem"][aria-label="김선생 교재 101 출고 전 취소"]').click());
  const firstDetail = h.requests.find(request => request.name === 'get_textbook_sale_detail_v1');
  assert.ok(firstDetail);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  await h.resolve(firstDetail, { row: { ...row, recipientName: '김선생' } });

  const dialog = document.querySelector('[role="alertdialog"]');
  assert.ok(dialog);
  assert.equal(dialog.textContent.includes('김선생'), true);
  assert.equal(dialog.textContent.includes('교사용'), true);
  assert.equal(dialog.textContent.includes('학생 미지정'), false);
  assert.equal(dialog.textContent.includes('대상 미지정'), false);

  await h.act(() => button('출고 대기 취소 취소 삭제').click());
  const details = h.requests.filter(request => request.name === 'get_textbook_sale_detail_v1');
  assert.equal(details.length, 2, 'confirmed cancellation rechecks the fresh sale member');
  assert.equal(h.requests.some(request => request.table || request.name === 'delete_textbook_sale_line_lifecycle_v1'), false, 'writer waits for the confirmation recheck');
});

test('purchase detail completion from a former actor opens no confirmation and starts no writer', async t => {
  const h = await setup(t, { search: '?textbookTab=requests' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('request'));
  await selectPurchaseDelete(h);
  const detail = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.auth({ role: 'staff', isAdmin: false, isStaff: true });
  await h.resolve(detail, { row: purchaseRow('request') });
  assert.equal(document.body.textContent.includes('요청 묶음 삭제'), false);
  assert.equal(h.requests.some(request => request.table), false, 'former actor completion starts zero lifecycle writers');
});

test('purchase context error and owner unmount each keep the writer boundary closed', async t => {
  const h = await setup(t, { search: '?textbookTab=requests' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('request'));
  await selectPurchaseDelete(h);
  const failed = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.reject(failed, { message: '__purchase_context_failed__' });
  assert.equal(document.body.textContent.includes('__purchase_context_failed__'), false);
  assert.equal(document.body.textContent.includes('처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.'), true);
  assert.equal(h.requests.some(request => request.table), false);
  await selectPurchaseDelete(h);
  const late = h.requests.findLast(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.unmount();
  await h.resolve(late, { row: purchaseRow('request') });
  assert.equal(h.requests.some(request => request.table), false, 'unmounted owner cannot publish confirmation or start a lifecycle writer');
});

test('actor change after the first purchase writer lets the lifecycle finish but suppresses stale success and invalidation', async t => {
  const h = await setup(t, { search: '?textbookTab=requests' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('request'));
  await selectPurchaseDelete(h);
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1'), { row: purchaseRow('request') });
  await h.act(() => button('삭제').click());
  await h.resolve(h.requests.findLast(request => request.name === 'get_textbook_purchase_detail_v1'), { row: purchaseRow('request') });
  assert.equal(h.requests.filter(request => request.table).length, 1, 'the first unchanged lifecycle writer has started');
  await h.auth({ role: 'staff', isAdmin: false, isStaff: true });
  const actorRefreshCount = h.requests.filter(request => request.name).length;
  for (const expectedTable of ['textbook_stock_moves', 'textbook_purchase_order_lines', 'textbook_purchase_order_lines', 'textbook_purchase_orders', 'textbook_stock_moves', 'textbook_purchase_order_lines', 'textbook_purchase_order_lines', 'textbook_purchase_orders']) {
    const request = h.requests.filter(item => item.table).at(-1);
    assert.equal(request.table, expectedTable);
    const isRemainingSelect = request.table === 'textbook_purchase_order_lines' && request.steps.some(step => step.method === 'select');
    await h.resolve(request, isRemainingSelect ? [] : null);
  }
  assert.equal(h.requests.filter(request => request.name).length, actorRefreshCount, 'former actor completion starts no targeted invalidation');
  assert.equal(document.body.textContent.includes('요청 묶음을 삭제했습니다.'), false, 'former actor completion publishes no stale success');
});

test('bulk order quantity changes before writing and purchase selection changes after writing respect one frozen lifetime', async t => {
  const h = await setup(t, { search: '?textbookTab=purchase&textbookPage=1&textbookPageSize=10' });
  const row = purchaseRow('order');
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('order'));
  const selector = document.querySelector('[aria-label="교재 101 일괄 처리 선택"]');
  await h.act(() => selector.click());
  await h.act(() => document.querySelector('[aria-label="선택 요청 일괄 주문"]').click());
  const studentQuantity = document.querySelector('[aria-label="교재 101 학생용 주문 수량"]');
  await h.act(() => button('일괄 주문').click());
  const firstDetail = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.act(() => studentQuantity[Object.keys(studentQuantity).find(key => key.startsWith('__reactProps$'))].onChange({ target: { value: '9' } }));
  const requestDetailRow = { ...row, mode: 'request' };
  await h.resolve(firstDetail, { row: requestDetailRow });
  await h.act(() => Promise.resolve());
  assert.equal(h.requests.some(request => request.table), false, 'bulk quantity change while detail is pending starts zero writers');

  await h.act(() => button('일괄 주문').click());
  const retryDetail = h.requests.findLast(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.resolve(retryDetail, { row: requestDetailRow });
  await h.act(() => Promise.resolve());
  assert.equal(h.requests.filter(request => request.table).length, 1, 'unchanged retry starts its first lifecycle writer');
  const rpcCountAtWriter = h.requests.filter(request => request.name).length;
  await h.act(() => selector.click());
  for (let index = 0; index < row.lines.length * 3; index += 1) {
    const request = h.requests.filter(item => item.table)[index];
    assert.ok(request, `purchase lifecycle writer ${index + 1}`);
    if (request.table === 'textbook_purchase_orders') await h.resolve(request, { id: row.lines[Math.floor(index / 3)]?.purchase_order_id || id(200) });
    else if (request.table === 'textbook_purchase_order_lines') await h.resolve(request, { id: row.lines[Math.floor(index / 3)]?.id || id(300) });
    else await h.resolve(request, []);
  }
  assert.equal(h.requests.filter(request => request.name).length, rpcCountAtWriter, 'changed purchase selection suppresses stale targeted invalidation');
  assert.equal(document.body.textContent.includes('건을 주문으로 전환했습니다.'), false, 'changed purchase selection suppresses stale success');
});

test('bulk order grouped selectors include both scopes and preserve their exact quantities after cancel and reopen', async t => {
  const h = await setup(t, { search: '?textbookTab=purchase&textbookPage=1&textbookPageSize=10' });
  const row = purchaseRow('order');
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('order'));

  const assertTwoSelected = () => assert.ok(document.body.textContent.includes('2개 선택'));
  const clearSelection = () => h.act(() => button('주문·입고 선택 해제').click());
  const mobileSelector = document.querySelector('[data-prepared-surface="purchase-mobile"] [aria-label="교재 101 일괄 처리 선택"]');
  await h.act(() => mobileSelector.click());
  assertTwoSelected();
  await clearSelection();
  const desktopSelector = document.querySelector('[data-prepared-surface="purchase-desktop"] [aria-label="교재 101 일괄 처리 선택"]');
  await h.act(() => desktopSelector.click());
  assertTwoSelected();
  await clearSelection();
  await h.act(() => document.querySelector('[aria-label="일괄 처리 가능한 행 전체 선택"]').click());
  assertTwoSelected();

  await h.act(() => button('선택 요청 일괄 주문').click());
  let studentQuantity = document.querySelector('[aria-label="교재 101 학생용 주문 수량"]');
  let teacherQuantity = document.querySelector('[aria-label="교재 101 교사용 주문 수량"]');
  assert.equal(studentQuantity.value, '2');
  assert.equal(teacherQuantity.value, '2');
  const change = (input, value) => h.act(() => input[Object.keys(input).find(key => key.startsWith('__reactProps$'))].onChange({ target: { value } }));
  await change(studentQuantity, '9');
  await change(teacherQuantity, '4');
  await h.act(() => button('선택 요청 일괄 주문 창 닫기').click());
  if (document.querySelector('[data-testid="draft-navigation-confirm-dialog"]')) {
    await h.act(() => button("변경사항 버리기").click());
    await h.act(() => new Promise(resolve => setTimeout(resolve, 30)));
  }
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assertTwoSelected();
  assert.equal(h.requests.some(request => request.table || request.name === 'get_textbook_purchase_detail_v1'), false, 'cancel starts zero reads and writes');

  await h.act(() => button('선택 요청 일괄 주문').click());
  studentQuantity = document.querySelector('[aria-label="교재 101 학생용 주문 수량"]');
  teacherQuantity = document.querySelector('[aria-label="교재 101 교사용 주문 수량"]');
  assert.equal(studentQuantity.value, '2', 'cancelled student draft resets to its request quantity');
  assert.equal(teacherQuantity.value, '2', 'cancelled teacher draft resets to its request quantity');
  await change(studentQuantity, '9');
  await change(teacherQuantity, '4');
  await h.act(() => button('일괄 주문').click());
  const detail = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.resolve(detail, { row: { ...row, mode: 'request' } });
  await h.act(() => Promise.resolve());

  const payloads = [];
  for (const line of row.lines) {
    const orderWrite = h.requests.filter(request => request.table === 'textbook_purchase_orders').at(-1);
    assert.ok(orderWrite);
    await h.resolve(orderWrite, { id: line.purchase_order_id });
    const lineWrite = h.requests.filter(request => request.table === 'textbook_purchase_order_lines').at(-1);
    assert.deepEqual(lineWrite.steps.find(step => step.method === 'eq').args, ['id', line.id]);
    payloads.push(lineWrite.steps.find(step => step.method === 'update').args[0]);
    await h.resolve(lineWrite, { id: line.id });
    const stockRead = h.requests.filter(request => request.table === 'textbook_stock_moves').at(-1);
    await h.resolve(stockRead, []);
  }

  assert.deepEqual(payloads, [
    { textbook_id: id(101), requested_textbook_title: '', class_id: id(800), location_id: id(900), requested_quantity: 2, ordered_quantity: 9, received_quantity: 0, copy_scope: 'student', unit_cost: 9000, memo: '' },
    { textbook_id: id(101), requested_textbook_title: '', class_id: id(800), location_id: id(900), requested_quantity: 2, ordered_quantity: 4, received_quantity: 0, copy_scope: 'teacher', unit_cost: 0, memo: '' },
  ]);
});

test('grouped purchase checkboxes pass both scopes to receive and return while terminal rows stay unselectable', async t => {
  const rows = [
    purchaseLifecycleRow('ordered', 0),
    purchaseLifecycleRow('received', 1),
    purchaseLifecycleRow('returned', 2),
    purchaseLifecycleRow('cancelled', 3),
  ];
  const summary = purchaseLifecycleSummary(rows);
  const h = await setup(t, { search: '?textbookTab=purchase&textbookPage=1&textbookPageSize=10' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows, page: 1, pageSize: 10, totalCount: rows.length });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), summary);

  const desktopRow = row => [...document.querySelectorAll('[data-prepared-surface="purchase-desktop"]')]
    .find(node => node.getAttribute('data-prepared-row-id') === row.id);
  for (const row of rows.filter(item => item.status === 'returned' || item.status === 'cancelled')) {
    const checkbox = desktopRow(row)?.querySelector(`[aria-label="교재 ${101 + rows.indexOf(row)} 일괄 처리 선택"]`);
    assert.ok(checkbox, `${row.status} row keeps its visible selection control`);
    assert.equal(checkbox.disabled, true, `${row.status} row cannot enter a bulk action`);
  }

  const received = rows[1];
  const receivedSection = [...document.querySelectorAll('section')]
    .find(section => section.querySelector('[aria-label^="입고완료 그룹"]'));
  const receivedHeaderCheckbox = receivedSection?.querySelector('[aria-label="일괄 처리 가능한 행 전체 선택"]');
  assert.ok(receivedHeaderCheckbox);
  await h.act(() => receivedHeaderCheckbox.click());
  assert.ok(document.body.textContent.includes('2개 선택'), 'received group header selects student and teacher members');
  await h.act(() => button('선택 주문·입고 작업').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await h.act(() => document.querySelector('[role="menuitem"][aria-label="선택 입고 건 공급처 반품"]').click());
  const returnDetail = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  assert.deepEqual(returnDetail.args, { p_anchor_line_id: received.anchorLineId, p_mode: 'order' });
  await h.resolve(returnDetail, { row: received });
  const returnDialog = document.querySelector('[role="alertdialog"]');
  assert.ok(returnDialog?.textContent.includes('학생용'));
  assert.ok(returnDialog?.textContent.includes('교사용'), 'bulk return callback retains the teacher member');
  await h.act(() => button('공급처 반품 취소').click());
  await h.act(() => button('주문·입고 선택 해제').click());

  const ordered = rows[0];
  const orderedCheckbox = desktopRow(ordered)?.querySelector('[aria-label="교재 101 일괄 처리 선택"]');
  assert.ok(orderedCheckbox);
  await h.act(() => orderedCheckbox.click());
  assert.ok(document.body.textContent.includes('2개 선택'), 'ordered display row selects student and teacher members');
  await h.act(() => button('선택 주문 일괄 입고').click());
  const receiveDetail = h.requests.findLast(request => request.name === 'get_textbook_purchase_detail_v1');
  assert.deepEqual(receiveDetail.args, { p_anchor_line_id: ordered.anchorLineId, p_mode: 'order' });
  await h.resolve(receiveDetail, { row: ordered });
  await h.act(() => Promise.resolve());
  const receivedLineIds = [];
  for (const line of ordered.lines) {
    const orderWrite = h.requests.filter(request => request.table === 'textbook_purchase_orders').at(-1);
    assert.deepEqual(orderWrite.steps.find(step => step.method === 'eq').args, ['id', line.purchase_order_id]);
    await h.resolve(orderWrite, { id: line.purchase_order_id });
    const lineWrite = h.requests.filter(request => request.table === 'textbook_purchase_order_lines').at(-1);
    assert.deepEqual(lineWrite.steps.find(step => step.method === 'eq').args, ['id', line.id]);
    receivedLineIds.push(line.id);
    await h.resolve(lineWrite, { id: line.id });
    const stockRead = h.requests.filter(request => request.table === 'textbook_stock_moves').at(-1);
    assert.deepEqual(stockRead.steps.find(step => step.method === 'eq' && step.args[0] === 'purchase_order_line_id').args, ['purchase_order_line_id', line.id]);
    await h.resolve(stockRead, []);
    const stockInsert = h.requests.filter(request => request.table === 'textbook_stock_moves').at(-1);
    assert.equal(stockInsert.steps.find(step => step.method === 'insert').args[0].purchase_order_line_id, line.id);
    await h.resolve(stockInsert, null);
  }
  assert.deepEqual(receivedLineIds, ordered.memberLineIds, 'bulk receive writes student and teacher member IDs');
});

test('bulk receive synchronously blocks duplicate reads and keeps a dismissible failure with its selection', async t => {
  const row = purchaseLifecycleRow('ordered');
  const h = await setup(t, { search: '?textbookTab=purchase&textbookPage=1&textbookPageSize=10' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseLifecycleSummary([row]));
  await h.act(() => document.querySelector('[data-prepared-surface="purchase-desktop"] [aria-label="교재 101 일괄 처리 선택"]').click());
  assert.ok(document.body.textContent.includes('2개 선택'));

  const receive = button('선택 주문 일괄 입고');
  const reactProps = receive[Object.keys(receive).find(key => key.startsWith('__reactProps$'))];
  await h.act(() => {
    reactProps.onClick();
    reactProps.onClick();
  });
  const detailReads = () => h.requests.filter(request => request.name === 'get_textbook_purchase_detail_v1');
  assert.equal(detailReads().length, 1, 'the action lock blocks a raw duplicate handler before disabled state renders');
  assert.equal(button('선택 주문 일괄 입고').disabled, true);
  assert.equal(button('선택 주문 일괄 입고').getAttribute('aria-busy'), 'true');
  assert.equal(button('주문·입고 선택 해제').disabled, true);
  assert.ok(document.body.textContent.includes('선택한 교재 처리 중…'));
  assert.equal(document.querySelector('[data-slot="action-feedback"]'), null, 'pending work publishes no premature feedback');

  await h.reject(detailReads()[0], { message: '합성 일괄 입고 조회 실패' });
  const feedback = document.querySelector('[data-slot="action-feedback"]');
  assert.ok(feedback);
  assert.ok(feedback.querySelector('[role="alert"]'));
  assert.ok(feedback.querySelector('[aria-label="처리 결과"]'));
  assert.equal(feedback.textContent.includes('합성 일괄 입고 조회 실패'), false);
  assert.ok(feedback.textContent.includes('처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.'));
  assert.ok(document.body.textContent.includes('2개 선택'), 'failed receive preserves both selected members');
  assert.equal(h.requests.some(request => request.table), false, 'failed fresh read starts zero writers');
  await h.act(() => Promise.resolve());
  assert.ok(document.querySelector('[data-slot="action-feedback"]'), 'feedback persists without a timeout');

  await h.act(() => button('처리 결과 닫기').click());
  assert.equal(document.querySelector('[data-slot="action-feedback"]'), null);
  assert.equal(h.requests.some(request => request.table), false, 'dismissing feedback starts zero writers');
  await h.act(() => button('선택 주문 일괄 입고').click());
  assert.equal(detailReads().length, 2, 'failure releases the action lock for retry');
  await h.reject(detailReads()[1], { message: '합성 일괄 입고 재시도 실패' });
});

test('bulk sale selection change after the first writer lets writers finish but suppresses stale completion work', async t => {
  const h = await setup(t, { search: '?textbookTab=sales&textbookPage=1&textbookPageSize=10' });
  const rows = [saleRow(10), saleRow(11)];
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_sale_page_v1'), { rows, page: 1, pageSize: 10, totalCount: 2 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_sale_summary_v1'), saleSummary(2));
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_sale_history_page_v1'), { rows: [], page: 1, pageSize: 10, totalCount: 0 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_sale_history_summary_v1'), saleHistorySummary(0));
  for (const row of rows) await h.act(() => document.querySelector(`[aria-label="${row.recipientName} ${row.textbook.title} 출고 선택"]`).click());
  await h.act(() => document.querySelector('[aria-label="선택 출고 일괄 완료"]').click());
  const details = h.requests.filter(request => request.name === 'get_textbook_sale_detail_v1');
  assert.equal(details.length, 2);
  for (const [index, request] of details.entries()) await h.resolve(request, { row: rows[index] });
  const balance = h.requests.find(request => request.name === 'get_textbook_inventory_balance_v1');
  await h.resolve(balance, { locationId: id(900), rows: rows.map((row, index) => ({ textbookId: row.textbook.id, currentQuantity: 20 + index, locationQuantities: { [id(900)]: 20 + index }, studentLocationQuantities: {}, teacherLocationQuantities: { [id(900)]: 20 + index }, totalQuantity: 20 + index, studentQuantity: 0, teacherQuantity: 20 + index, stockValue: (20 + index) * 10000 })) });
  const transitions = () => h.requests.filter(request => request.name === 'transition_textbook_sale_line_v1');
  const reads = () => h.requests.filter(request => request.name && request.name !== 'transition_textbook_sale_line_v1');
  assert.equal(transitions().length, 1, 'the first frozen sale starts one atomic transition');
  assert.equal(h.requests.some(request => request.table), false);
  const readCountAtWriter = reads().length;
  await h.act(() => document.querySelector(`[aria-label="${rows[1].recipientName} ${rows[1].textbook.title} 출고 선택"]`).click());
  for (const [index, row] of rows.entries()) {
    const request = transitions()[index];
    assert.ok(request, `atomic sale transition ${index + 1}`);
    assert.deepEqual(request.args, { p_sale_line_id: row.id, p_target_status: 'issued' });
    await h.resolve(request, { ...row.line, status: 'issued' });
  }
  assert.equal(transitions().length, 2, 'the original frozen batch finishes after selection changes');
  assert.equal(h.requests.some(request => request.table), false, 'sale transitions never fall back to separate table writes');
  assert.equal(reads().length, readCountAtWriter, 'changed sale selection suppresses stale targeted invalidation');
  assert.equal(document.body.textContent.includes('건을 출고 완료했습니다.'), false);
});

test('inactive cleanup confirms five previews but rechecks and writes the complete frozen ID set', async t => {
  const h = await setup(t, { search: '?textbookTab=master&textbookPage=1&textbookPageSize=10' });
  const summaryPayload = masterSummary(12, { qualityCounts: { all: 12, attention: 12, duplicate: 0, missingCode: 0, missingPublisher: 0, missingCategory: 0, missingPrice: 0, subjectMismatch: 0, inactive: 12 } });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_master_page_v1'), { rows: Array.from({ length: 10 }, (_, index) => masterRow(index + 1)), page: 1, pageSize: 10, totalCount: 12 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_master_summary_v1'), summaryPayload);
  await h.act(() => document.querySelector('[aria-label="미사용 교재 보기"]').click());
  const inactiveRows = Array.from({ length: 10 }, (_, index) => masterRow(index + 20, { status: 'inactive', qualityIssues: { duplicate: false, missingCode: false, missingPublisher: false, missingCategory: false, missingPrice: false, subjectMismatch: false, inactive: true }, qualityScore: 1 }));
  await h.resolve(h.requests.findLast(request => request.name === 'list_textbook_master_page_v1'), { rows: inactiveRows, page: 1, pageSize: 10, totalCount: 12 });
  const inactiveSummary = h.requests.findLast(request => request.name === 'get_textbook_master_summary_v1');
  await h.resolve(inactiveSummary, summaryPayload);
  const emptyTrash = button('비우기');
  assert.ok(emptyTrash, JSON.stringify([...document.querySelectorAll('button')].map(node => node.textContent.trim()).filter(Boolean)));
  await h.act(() => emptyTrash.click());
  const targetIds = Array.from({ length: 12 }, (_, index) => id(1000 + index));
  const cleanup = { targetIds, totalCount: 12, previewRows: targetIds.slice(0, 5).map((value, index) => ({ id: value, title: `__cleanup_${index}__`, detail: '미사용' })), complete: true };
  const first = h.requests.find(request => request.name === 'get_textbook_inactive_cleanup_context_v1');
  assert.ok(first);
  await h.resolve(first, cleanup);
  assert.equal(document.body.textContent.includes('__cleanup_4__'), true);
  assert.equal(document.body.textContent.includes('__cleanup_5__'), false, 'preview stays capped at five rows');
  assert.equal(document.body.textContent.includes('외 7건 더'), true, 'complete off-page cleanup count remains visible');
  await h.act(() => button('영구 삭제').click());
  const second = h.requests.findLast(request => request.name === 'get_textbook_inactive_cleanup_context_v1');
  assert.notEqual(second, first, 'confirmation rechecks the complete cleanup authority');
  assert.equal(h.requests.some(request => request.table), false, 'cleanup starts zero writers before the recheck completes');
  await h.resolve(second, cleanup);
  const firstWriter = h.requests.find(request => request.table);
  assert.equal(firstWriter.table, 'textbook_stock_counts');
  assert.deepEqual(firstWriter.steps.find(step => step.method === 'in').args, ['textbook_id', targetIds], 'writer retains all off-page cleanup IDs');
});

test('sale status reads the actual sale member and its exact balance before the first writer', async t => {
  const h = await setup(t, { search: '?textbookTab=sales&textbookPage=1&textbookPageSize=10' });
  const row = saleRow(7);
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_sale_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_sale_summary_v1'), saleSummary(1));
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_sale_history_page_v1'), { rows: [], page: 1, pageSize: 10, totalCount: 0 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_sale_history_summary_v1'), saleHistorySummary(0));

  await h.act(() => document.querySelector(`[aria-label="${row.recipientName} ${row.textbook.title} 출고 완료 처리"]`).click());
  const detail = h.requests.find(request => request.name === 'get_textbook_sale_detail_v1');
  assert.deepEqual(detail.args, { p_id: row.id });
  assert.equal(h.requests.some(request => request.name === 'transition_textbook_sale_line_v1'), false, 'atomic transition waits for the fresh actual member');
  assert.equal(h.requests.some(request => request.table), false, 'sale writer waits for the fresh actual member');
  await h.resolve(detail, { row });

  const balance = h.requests.find(request => request.name === 'get_textbook_inventory_balance_v1');
  assert.deepEqual(balance.args.p_input, { textbookIds: [row.textbook.id], locationId: row.location.id });
  assert.equal(h.requests.some(request => request.name === 'transition_textbook_sale_line_v1'), false, 'atomic transition waits for the exact member balance');
  assert.equal(h.requests.some(request => request.table), false, 'sale writer waits for the exact member balance');
  await h.resolve(balance, {
    locationId: row.location.id,
    rows: [{ textbookId: row.textbook.id, currentQuantity: 9, locationQuantities: { [row.location.id]: 9 }, studentLocationQuantities: {}, teacherLocationQuantities: { [row.location.id]: 9 }, totalQuantity: 9, studentQuantity: 0, teacherQuantity: 9, stockValue: 90000 }],
  });

  const transitions = h.requests.filter(request => request.name === 'transition_textbook_sale_line_v1');
  assert.equal(transitions.length, 1);
  assert.deepEqual(transitions[0].args, { p_sale_line_id: row.id, p_target_status: 'issued' });
  assert.equal(document.body.textContent.includes('출고가 반영되었습니다.'), false, 'success waits for the atomic commit');
  await h.resolve(transitions[0], { ...row.line, status: 'issued' });
  assert.equal(h.requests.some(request => request.table), false, 'stock movement and line status are committed together by the database');
  assert.equal(h.requests.filter(request => request.name === 'list_textbook_sale_page_v1').length, 2, 'the completed transition refreshes the sale page');
});
