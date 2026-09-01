import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, button, id, masterRow, masterSummary, purchaseRow, purchaseSummary, saleHistorySummary, saleRow, saleSummary } from './helpers/textbook-numbered-harness.mjs';

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
  const remove = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '교재 101 요청 건 삭제');
  assert.ok(remove, 'mounted request row must expose its deletion action');
  await h.act(() => remove.click());
  const detail = h.requests.filter(request => request.name === 'get_textbook_purchase_detail_v1');
  assert.equal(detail.length, 1, 'confirmation authority must be a fresh complete purchase detail');
  assert.deepEqual(detail[0].args, { p_anchor_line_id: purchaseRow('request').anchorLineId, p_mode: 'request' });
  assert.equal(document.body.textContent.includes('요청 묶음 삭제'), false, 'confirmation waits for complete detail');
  await h.resolve(detail[0], { row: purchaseRow('request') });
  assert.equal(document.body.textContent.includes('요청 묶음 삭제'), true, 'complete detail opens the original destructive confirmation');
});

test('purchase detail completion from a former actor opens no confirmation and starts no writer', async t => {
  const h = await setup(t, { search: '?textbookTab=requests' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('request'));
  const remove = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '교재 101 요청 건 삭제');
  await h.act(() => remove.click());
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
  const remove = () => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '교재 101 요청 건 삭제');
  await h.act(() => remove().click());
  const failed = h.requests.find(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.reject(failed, { message: '__purchase_context_failed__' });
  assert.equal(document.body.textContent.includes('__purchase_context_failed__'), true);
  assert.equal(h.requests.some(request => request.table), false);
  await h.act(() => remove().click());
  const late = h.requests.findLast(request => request.name === 'get_textbook_purchase_detail_v1');
  await h.unmount();
  await h.resolve(late, { row: purchaseRow('request') });
  assert.equal(h.requests.some(request => request.table), false, 'unmounted owner cannot publish confirmation or start a lifecycle writer');
});

test('actor change after the first purchase writer lets the lifecycle finish but suppresses stale success and invalidation', async t => {
  const h = await setup(t, { search: '?textbookTab=requests' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('request'));
  await h.act(() => document.querySelector('[aria-label="교재 101 요청 건 삭제"]').click());
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
  for (let index = 0; index < 3; index += 1) {
    const request = h.requests.filter(item => item.table)[index];
    assert.ok(request, `purchase lifecycle writer ${index + 1}`);
    if (request.table === 'textbook_purchase_orders') await h.resolve(request, { id: row.lines[Math.floor(index / 3)]?.purchase_order_id || id(200) });
    else if (request.table === 'textbook_purchase_order_lines') await h.resolve(request, { id: row.lines[Math.floor(index / 3)]?.id || id(300) });
    else await h.resolve(request, []);
  }
  assert.equal(h.requests.filter(request => request.name).length, rpcCountAtWriter, 'changed purchase selection suppresses stale targeted invalidation');
  assert.equal(document.body.textContent.includes('건을 주문으로 전환했습니다.'), false, 'changed purchase selection suppresses stale success');
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
  assert.equal(h.requests.filter(request => request.table).length, 1);
  const rpcCountAtWriter = h.requests.filter(request => request.name).length;
  await h.act(() => document.querySelector(`[aria-label="${rows[1].recipientName} ${rows[1].textbook.title} 출고 선택"]`).click());
  for (let index = 0; index < 6; index += 1) {
    const request = h.requests.filter(item => item.table)[index];
    assert.ok(request, `sale lifecycle writer ${index + 1}`);
    if (request.table === 'textbook_stock_moves' && request.steps.some(step => step.method === 'select')) await h.resolve(request, []);
    else await h.resolve(request, null);
  }
  assert.equal(h.requests.filter(request => request.name).length, rpcCountAtWriter, 'changed sale selection suppresses stale targeted invalidation');
  assert.equal(document.body.textContent.includes('건을 출고 완료했습니다.'), false);
});

test('inactive cleanup confirms five previews but rechecks and writes the complete frozen ID set', async t => {
  const h = await setup(t, { search: '?textbookTab=master&textbookPage=1&textbookPageSize=10' });
  const summaryPayload = masterSummary(12, { qualityCounts: { all: 12, attention: 12, duplicate: 0, missingCode: 0, missingPublisher: 0, missingCategory: 0, missingPrice: 0, subjectMismatch: 0, inactive: 12 } });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_master_page_v1'), { rows: Array.from({ length: 10 }, (_, index) => masterRow(index + 1)), page: 1, pageSize: 10, totalCount: 12 });
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_master_summary_v1'), summaryPayload);
  await h.act(() => document.querySelector('[aria-label="미사용 교재 보관함 열기"]').click());
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
  await h.act(() => button('영구 삭제').click());
  const second = h.requests.findLast(request => request.name === 'get_textbook_inactive_cleanup_context_v1');
  assert.notEqual(second, first, 'confirmation rechecks the complete cleanup authority');
  assert.equal(h.requests.some(request => request.table), false, 'cleanup starts zero writers before the recheck completes');
  await h.resolve(second, cleanup);
  const firstWriter = h.requests.find(request => request.table);
  assert.equal(firstWriter.table, 'textbook_stock_counts');
  assert.deepEqual(firstWriter.steps.find(step => step.method === 'in').args, ['textbook_id', targetIds], 'writer retains all off-page cleanup IDs');
});

test('all-subject closing completes all four save contexts before its first non-atomic writer', async t => {
  const h = await setup(t, { search: '?textbookTab=closing&textbookPage=1&textbookPageSize=10' });
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_closing_page_v1'), { rows: [], page: 1, pageSize: 10, totalCount: 0 });
  await h.act(() => button('월마감 추가').click());
  const preview = h.requests.find(request => request.name === 'get_textbook_closing_preview_v1');
  const closing = { openingQuantity: 0, openingAmount: 0, purchaseQuantity: 0, purchaseAmount: 0, saleQuantity: 0, saleAmount: 0, adjustmentQuantity: 0, adjustmentAmount: 0, endingQuantity: 0, endingAmount: 0, receivedAmount: 0, supplierPaymentAmount: 0, paymentDifference: 0, textbookMarginAmount: 0, settlementDifference: 0, needsReview: false, teamMargins: ['english', 'math', 'science', 'other'].map(team => ({ team, saleQuantity: 0, saleAmount: 0, purchaseCostAmount: 0, marginAmount: 0 })) };
  await h.resolve(preview, { closingMonth: preview.args.p_input.closingMonth, subject: 'all', sourceLineCount: 0, closing });
  await h.act(() => button('마감 저장').click());
  const contexts = h.requests.filter(request => request.name === 'get_textbook_closing_save_context_v1');
  assert.deepEqual(contexts.map(request => request.args.p_subject).sort(), ['all', 'english', 'math', 'science']);
  const payload = request => ({ closingMonth: request.args.p_closing_month, subject: request.args.p_subject, sourceLineCount: 0, sourceLineIds: [], stockMoves: [], textbooks: [], publishers: [], suppliers: [], publisherSupplierLinks: [], complete: true });
  for (const request of contexts.slice(0, 3)) await h.resolve(request, payload(request));
  assert.equal(h.requests.some(request => request.table), false, 'no closing writer starts while any original subject context is pending');
  await h.resolve(contexts[3], payload(contexts[3]));
  assert.equal(h.requests.find(request => request.table)?.table, 'textbook_monthly_closings', 'unchanged non-atomic writer begins only after all four reads');
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
  assert.equal(h.requests.some(request => request.table), false, 'sale writer waits for the fresh actual member');
  await h.resolve(detail, { row });

  const balance = h.requests.find(request => request.name === 'get_textbook_inventory_balance_v1');
  assert.deepEqual(balance.args.p_input, { textbookIds: [row.textbook.id], locationId: row.location.id });
  assert.equal(h.requests.some(request => request.table), false, 'sale writer waits for the exact member balance');
  await h.resolve(balance, {
    locationId: row.location.id,
    rows: [{ textbookId: row.textbook.id, currentQuantity: 9, locationQuantities: { [row.location.id]: 9 }, studentLocationQuantities: {}, teacherLocationQuantities: { [row.location.id]: 9 }, totalQuantity: 9, studentQuantity: 0, teacherQuantity: 9, stockValue: 90000 }],
  });

  const moveLookup = h.requests.find(request => request.table);
  assert.equal(moveLookup.table, 'textbook_stock_moves');
  assert.deepEqual(moveLookup.steps.find(step => step.method === 'eq').args, ['sale_line_id', row.id]);
  await h.resolve(moveLookup, []);
  const moveInsert = h.requests.findLast(request => request.table);
  assert.equal(moveInsert.table, 'textbook_stock_moves');
  assert.equal(moveInsert.steps.find(step => step.method === 'insert').args[0].sale_line_id, row.id);
  await h.resolve(moveInsert, null);
  const lineUpdate = h.requests.findLast(request => request.table);
  assert.equal(lineUpdate.table, 'textbook_sale_lines');
  assert.deepEqual(lineUpdate.steps.find(step => step.method === 'eq').args, ['id', row.id]);
});
