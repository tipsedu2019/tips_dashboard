import assert from 'node:assert/strict';
import test from 'node:test';
import { id, masterRow, masterSummary, purchaseRow, purchaseSummary, saleRow, saleSummary, setup } from './helpers/textbook-numbered-harness.mjs';

const locations = [{ id: id(900), code: 'main', name: '본관', sortOrder: 1 }, { id: id(901), code: 'annex', name: '별관', sortOrder: 2 }];
test('inventory shows both zero locations with neutral stock and explicit units', async t => {
  const h = await setup(t);
  await h.resolve(h.requests.find(r => r.name === 'list_textbook_master_page_v1'), { rows: [masterRow(1)], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(r => r.name === 'get_textbook_master_summary_v1'), masterSummary(1, { locations }));
  const card = document.querySelector('[data-prepared-surface="master-mobile"]');
  assert.ok(card.textContent.includes('본관0권'));
  assert.ok(card.textContent.includes('별관0권'));
  assert.equal(Boolean(card.querySelector('.text-destructive')), false);
  assert.ok(card.textContent.includes('합계0권'));
});

for (const mode of ['request', 'order']) test(`${mode} quantities preserve copy scopes and receipt remainder uses accepted ordered minus received`, async t => {
  const h = await setup(t, { search: `?textbookTab=${mode === 'request' ? 'requests' : 'purchase'}` });
  const row = purchaseRow(mode);
  if (mode === 'order') {
    row.status = 'partially_received'; row.eventAt = ''; row.id = row.id.replace('requested||', 'partially_received||');
    row.lines.forEach(line => { line.status = 'partially_received'; line.order.status = 'partially_received'; line.ordered_quantity = 5; line.received_quantity = 2; });
    row.line = { ...row.lines[0], purchaseScopeLines: row.lines };
    row.quantities.ordered = 10; row.quantities.received = 4;
    for (const scope of ['student', 'teacher']) { row.quantities[scope].ordered = 5; row.quantities[scope].received = 2; }
  }
  const summary = purchaseSummary(mode);
  summary.groups[0].status = row.status;
  summary.groups[0].quantities = row.quantities;
  summary.quantities = row.quantities;
  await h.resolve(h.requests.find(r => r.name === 'list_textbook_purchase_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(r => r.name === 'get_textbook_purchase_summary_v1'), summary);
  for (const viewport of ['mobile', 'desktop']) {
    const rendered = document.querySelector(`[data-prepared-surface="${mode === 'request' ? 'requests' : 'purchase'}-${viewport}"]`);
    assert.ok(rendered, document.body.textContent.slice(-1000));
    assert.ok(rendered.querySelector('[data-copy-scope="student"]').textContent.includes('권'));
    assert.ok(rendered.querySelector('[data-copy-scope="teacher"]').textContent.includes('권'));
    if (mode === 'order') assert.equal(rendered.querySelector('[data-quantity-remaining]').textContent, '남음 6권');
  }
});

test('returned sales label the actual returned quantity and retain return eligibility', async t => {
  const h = await setup(t, { search: '?textbookTab=sales&textbookFilters=' + encodeURIComponent(JSON.stringify({ status: 'returned', search: '' })) });
  const row = saleRow(); row.status = 'returned'; row.groupStatus = 'returned'; row.line.status = 'returned'; row.sale.status = 'charged';
  const summary = saleSummary(); summary.groups[0].status = 'returned'; summary.statusCounts = { all: 1, waiting: 0, issued: 0, returned: 1, cancelled: 0 };
  await h.resolve(h.requests.find(r => r.name === 'list_textbook_sale_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(r => r.name === 'get_textbook_sale_summary_v1'), summary);
  assert.ok(document.querySelector('[data-prepared-surface="sales-process-mobile"]').textContent.includes('반품 2권'));
  assert.equal(document.querySelector('[aria-label$="출고 완료 처리"]'), null);
  assert.ok([...document.querySelectorAll('th')].some(node => node.textContent === '반품권'));
});

test('count view distinguishes accepted ledger from unsaved count and signed difference', async t => {
  const h = await setup(t, { search: '?textbookTab=inventory' });
  await h.resolve(h.requests.find(r => r.name === 'list_textbook_location_reference_page_v1'), { rows: [{ value: id(900), label: '본관', searchText: '본관 main' }], page: 1, pageSize: 20, totalCount: 1, defaultLocation: { id: id(900), code: 'main', name: '본관' } });
  const source = masterRow(1);
  const row = { source, id: source.id, title: source.title, publisher: '출판사', locationId: id(900), locationName: '본관', currentQuantity: 7, latestCountAt: '', daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: 'recommended', reason: '실사 필요', dueLabel: '지금' };
  await h.resolve(h.requests.find(r => r.name === 'list_textbook_inventory_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 });
  await h.resolve(h.requests.find(r => r.name === 'get_textbook_inventory_summary_v1'), masterSummary(1, { locations, auditCounts: { all: 1, recommended: 1, pending: 0, done: 0 } }));
  const card = document.querySelector('[data-prepared-surface="inventory-mobile"]');
  assert.ok(card.textContent.includes('장부 7권 · 차이 —'));
  const input = card.querySelector('[aria-label$="실사 수량"]');
  const props = input[Object.keys(input).find(key => key.startsWith('__reactProps$'))];
  await h.act(() => props.onChange({ target: { value: '5' } }));
  assert.ok(card.textContent.includes('장부 7권 · 차이 -2권'));
  assert.equal(h.requests.some(r => r.name === 'create_textbook_stock_count_v1'), false, 'editing a count is not a write');
});
