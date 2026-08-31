import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

const serviceUrl = new URL('../src/features/textbooks/textbook-read-service.ts', import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === serviceUrl.href && specifier === '@/lib/supabase') {
    return { url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";', shortCircuit: true };
  }
  return next(specifier, context);
} });
async function service() {
  assert.ok(existsSync(serviceUrl), 'production textbook read service exists');
  return import(serviceUrl.href);
}
const id = (n) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const filters = { search: '교재', subject: 'all', schoolLevel: 'all', gradeLevel: 'all', subSubject: 'all', quality: 'all', inventory: 'all' };
const master = () => ({
  id: id(101), title: '교재 101', name: '교재 101', subject: 'english', status: 'active',
  publisher: '출판사', category: '독해', isbn13: '978101', barcode: null, price: 10000,
  sale_price: 10000, list_price: 10000, salePrice: 10000, publisher_id: null, default_supplier_id: null,
  school_level: 'middle', grade_level: 'm2', school_levels: ['middle'], grade_levels: ['m2'], sub_subject: '독해',
  subject_area_key: null, is_returnable: false,
  locationQuantities: { [id(900)]: 12, unassigned: -2 }, studentLocationQuantities: { [id(900)]: 10, unassigned: -2 },
  teacherLocationQuantities: { [id(900)]: 2 }, totalQuantity: 10, studentQuantity: 8, teacherQuantity: 2, stockValue: 1000,
  locationSummary: [{ id: id(900), code: 'qa', name: '본관', sortOrder: 10, quantity: 12 }],
  qualityIssues: { duplicate: false, missingCode: false, missingPublisher: false, missingCategory: false, missingPrice: false, subjectMismatch: false, inactive: false }, qualityScore: 0,
});
const inventory = () => ({ source: master(), id: id(101), title: '교재 101', publisher: '출판사', locationId: id(900), locationName: '본관', currentQuantity: 12,
  latestCountAt: '', daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: 'recommended', reason: '실사 이력 없음', dueLabel: '실사 이력 없음' });
const history = () => ({ id: `count-${id(101)}`, kind: 'count', sourceId: id(101), linkedMoveId: id(102), at: '2026-08-31', textbookTitle: '교재 101', locationName: '본관', change: '-2권', action: '실사 12→10', actor: id(901), actorId: id(901), actorLabel: '', memo: '확인' });
const domains = [
  ['listTextbookMasterPage', 'list_textbook_master_page_v1', filters, 'quality-title', master],
  ['listTextbookInventoryPage', 'list_textbook_inventory_page_v1', { ...filters, locationId: id(900), audit: 'all' }, 'audit-priority', inventory],
  ['listTextbookInventoryHistoryPage', 'list_textbook_inventory_history_page_v1', { textbookId: null, locationId: null }, 'event-desc', history],
];
function wire(data, error = null, onCall) {
  const calls = [];
  return { calls, client: {
    from() { throw new Error('forbidden full catalog hydration'); },
    rpc(name, args) {
      const call = { name, args }; calls.push(call);
      return { abortSignal(signal) { call.signal = signal; return this; }, retry(retry) { call.retry = retry; onCall?.(call); return Promise.resolve({ data, error }); } };
    },
  } };
}
const request = (domain, patch = {}) => ({ page: 11, pageSize: 10, filters: domain[2], sort: domain[3], ...patch });
const envelope = (domain, patch = {}) => ({ rows: [domain[4]()], page: 11, pageSize: 10, totalCount: 101, ...patch });
for (const domain of domains) {
  test(`${domain[0]} directly loads page 11 with exact transport and full count`, async () => {
    const api = await service(); const transport = wire(envelope(domain)); const caller = new AbortController();
    const result = await api[domain[0]](request(domain), { client: transport.client, signal: caller.signal });
    assert.equal(result.totalCount, 101); assert.equal(result.page, 11); assert.equal(result.rows.length, 1);
    assert.equal(transport.calls.length, 1); const [call] = transport.calls;
    assert.equal(call.name, domain[1]); assert.deepEqual(call.args, { p_filters: domain[2], p_sort: domain[3], p_page: 11, p_page_size: 10 });
    assert.equal(call.retry, false); assert.ok(call.signal instanceof AbortSignal);
    caller.abort(); assert.equal(call.signal.aborted, true);
  });
  test(`${domain[0]} preserves empty/out-of-range and all strict sizes`, async () => {
    const api = await service();
    for (const pageSize of [10, 15, 20]) {
      const data = envelope(domain, { page: 2147483647, pageSize, rows: [] });
      assert.deepEqual(await api[domain[0]](request(domain, { page: 2147483647, pageSize }), { client: wire(data).client }), data);
    }
  });
  for (const patch of [{ page: 0 }, { page: 1.5 }, { page: 2147483648 }, { pageSize: 25 }, { pageSize: '10' }, { sort: 'unknown' }, { filters: {} }, { filters: { ...domain[2], surprise: true } }]) {
    test(`${domain[0]} rejects input ${JSON.stringify(patch)} before RPC`, async () => {
      const api = await service(); const transport = wire(envelope(domain));
      await assert.rejects(() => api[domain[0]](request(domain, patch), { client: transport.client }), /invalid/i);
      assert.equal(transport.calls.length, 0);
    });
  }
  for (const patch of [null, {}, { totalCount: '101' }, { totalCount: -1 }, { page: 10 }, { pageSize: 15 }, { rows: [] }, { rows: [{ id: id(1) }] }, { rows: Array.from({ length: 11 }, () => domain[4]()) }, { extra: true }]) {
    test(`${domain[0]} rejects malformed or inconsistent envelope ${JSON.stringify(patch)?.slice(0, 70)}`, async () => {
      const api = await service(); const data = patch === null ? null : patch.rows?.length === 11 ? envelope(domain, patch) : { ...envelope(domain), ...patch };
      if (patch && Object.keys(patch).length === 0) delete data.totalCount;
      await assert.rejects(() => api[domain[0]](request(domain), { client: wire(data).client }), /response_invalid/);
    });
  }
  for (const code of ['PGRST202', '42883', '42501', '22023']) test(`${domain[0]} ${code} fails once without fallback`, async () => {
    const api = await service(); const error = { code, message: 'failed' }; const transport = wire(null, error);
    await assert.rejects(() => api[domain[0]](request(domain), { client: transport.client }), (actual) => ['PGRST202', '42883'].includes(code) ? actual.code === 'textbook_read_rpc_unavailable' : actual === error);
    assert.equal(transport.calls.length, 1);
  });
}
test('caller cancellation and eight-second deadline reject even a resolved transport response', async (t) => {
  const api = await service(); const domain = domains[0];
  for (const cause of ['caller', 'timeout']) {
    const caller = new AbortController(); const timeout = new AbortController(); const reason = new Error(cause);
    t.mock.method(AbortSignal, 'timeout', (ms) => { assert.equal(ms, 8000); return timeout.signal; });
    const transport = wire(envelope(domain), null, () => (cause === 'caller' ? caller : timeout).abort(reason));
    await assert.rejects(() => api.listTextbookMasterPage(request(domain), { client: transport.client, signal: caller.signal }), (error) => error === reason);
    assert.equal(transport.calls.length, 1); t.mock.restoreAll();
  }
  const caller = new AbortController(); caller.abort(new Error('cancelled')); const transport = wire(envelope(domain));
  await assert.rejects(() => api.listTextbookMasterPage(request(domain), { client: transport.client, signal: caller.signal }), /cancelled/);
  assert.equal(transport.calls.length, 0);
});
test('inventory wire null roundtrips to Infinity, while date-only and finite signed elapsed days survive', async () => {
  const api = await service();
  for (const [latestCountAt, daysSinceLatestCount, want] of [['', null, Infinity], ['2026-08-31', 0, 0], ['2026-09-01', -1, -1]]) {
    const row = { ...inventory(), latestCountAt, daysSinceLatestCount };
    const result = await api.listTextbookInventoryPage(request(domains[1]), { client: wire(envelope(domains[1], { rows: [row] })).client });
    assert.equal(result.rows[0].daysSinceLatestCount, want); assert.equal(result.rows[0].latestCountAt, latestCountAt);
  }
});
test('strict stock quantities reject fractional/non-safe values and quality fields reject malformed flags', async () => {
  const api = await service();
  for (const patch of [{ totalQuantity: 1.5 }, { studentQuantity: Number.MAX_SAFE_INTEGER + 1 }, { locationQuantities: { [id(900)]: 1.5 } },
    { qualityIssues: { ...master().qualityIssues, duplicate: 'false' } }, { qualityIssues: { ...master().qualityIssues, extra: false } }]) {
    await assert.rejects(() => api.listTextbookMasterPage(request(domains[0]), { client: wire(envelope(domains[0], { rows: [{ ...master(), ...patch }] })).client }), /response_invalid/);
  }
});
test('legacy invalid count date restores Infinity without changing its recommended status or invalid-date labels', async () => {
  const api = await service(); const row = { ...inventory(), latestCountAt: 'infinity', reason: '실사일 확인 필요', dueLabel: '실사일 확인 필요' };
  const result = await api.listTextbookInventoryPage(request(domains[1]), { client: wire(envelope(domains[1], { rows: [row] })).client });
  assert.equal(result.rows[0].daysSinceLatestCount, Infinity); assert.equal(result.rows[0].isRecommended, true);
  assert.equal(result.rows[0].status, 'recommended'); assert.equal(result.rows[0].reason, '실사일 확인 필요');
});
for (const field of ['locationQuantities', 'studentLocationQuantities', 'teacherLocationQuantities', 'totalQuantity', 'studentQuantity', 'teacherQuantity', 'stockValue', 'qualityIssues', 'qualityScore', 'locationSummary']) {
  test(`strict master validates required ${field}, including nested inventory source`, async () => {
    const api = await service();
    for (const d of domains.slice(0, 2)) for (const value of [undefined, '12', null]) {
      const row = d[4](); const target = d === domains[0] ? row : row.source;
      if (value === undefined) delete target[field]; else target[field] = value;
      await assert.rejects(() => api[d[0]](request(d), { client: wire(envelope(d, { rows: [row] })).client }), /response_invalid/);
    }
  });
}
for (const patch of [{ daysSinceLatestCount: 'Infinity' }, { daysSinceLatestCount: Infinity }, { daysSinceLatestCount: 1.5 }, { latestCountAt: '2026-02-30' }, { status: 'all' }, { isRecommended: 1 }]) test(`inventory rejects malformed fields ${JSON.stringify(patch)}`, async () => {
  const api = await service(); await assert.rejects(() => api.listTextbookInventoryPage(request(domains[1]), { client: wire(envelope(domains[1], { rows: [{ ...inventory(), ...patch }] })).client }), /response_invalid/);
});
test('history retains count and adjustment identities plus raw actor presentation seam', async () => {
  const api = await service(); const result = await api.listTextbookInventoryHistoryPage(request(domains[2]), { client: wire(envelope(domains[2])).client });
  assert.deepEqual(result.rows[0], history());
  for (const patch of [{ id: id(101) }, { kind: 'other' }, { actorId: 1 }, { actorLabel: null }, { linkedMoveId: 'not-uuid' }]) {
    await assert.rejects(() => api.listTextbookInventoryHistoryPage(request(domains[2]), { client: wire(envelope(domains[2], { rows: [{ ...history(), ...patch }] })).client }), /response_invalid/);
  }
});

const summary = () => ({ totalCount: 1, totalQuantity: 10, studentQuantity: 8, teacherQuantity: 2, stockValue: 1000,
  salePriceTotal: 10000, locationQuantities: { [id(900)]: 12, unassigned: -2 },
  subjectTotals: [{ subject: 'english', totalCount: 1, totalQuantity: 10, salePriceTotal: 10000, stockValue: 1000 }],
  qualityCounts: { all: 118, attention: 1, duplicate: 1, missingCode: 0, missingPublisher: 0, missingCategory: 0, missingPrice: 0, subjectMismatch: 0, inactive: 1 },
  inventoryCounts: { all: 7, shortage: 4, surplus: 1, unused: 1, negative: 1 },
  subSubjectOptions: ['독해'], locations: [{ id: id(900), code: 'qa', name: '본관', sortOrder: 10 }] });
const balance = () => ({ locationId: id(900), rows: [{ textbookId: id(101), currentQuantity: 12,
  ...Object.fromEntries(['locationQuantities', 'studentLocationQuantities', 'teacherLocationQuantities', 'totalQuantity', 'studentQuantity', 'teacherQuantity', 'stockValue'].map((key) => [key, master()[key]])) }] });
const contexts = [
  ['getTextbookMasterSummary','get_textbook_master_summary_v1',filters,{ p_filters: filters },summary],
  ['getTextbookInventorySummary','get_textbook_inventory_summary_v1',domains[1][2],{ p_filters: domains[1][2] },() => ({ ...summary(), auditCounts: { all: 7, recommended: 6, pending: 0, done: 1 } })],
  ['getTextbookMasterDetail','get_textbook_master_detail_v1',id(101),{ p_id: id(101) },() => ({ row: master() })],
  ['getTextbookInventoryBalance','get_textbook_inventory_balance_v1',{ textbookIds: [id(101)], locationId: id(900) },{ p_input: { textbookIds: [id(101)], locationId: id(900) } },balance],
  ['checkTextbookMasterDuplicate','check_textbook_master_duplicate_v1',{ excludeId: null, title: '교재', subject: 'english', publisher: '', category: '' },{ p_input: { excludeId: null, title: '교재', subject: 'english', publisher: '', category: '' } },() => ({ totalCount: 1, previewRows: [master()] })],
];
for (const [method, rpc, input, args, fixture] of contexts) {
  test(`${method} uses a separate purpose-specific complete contract`, async () => {
    const api = await service(); const transport = wire(fixture());
    assert.deepEqual(await api[method](input, { client: transport.client }), fixture());
    assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].name, rpc); assert.deepEqual(transport.calls[0].args, args); assert.equal(transport.calls[0].retry, false);
  });
  test(`${method} rejects absent, partial and fake page envelopes`, async () => {
    const api = await service();
    for (const data of [null, {}, { rows: [], page: 1, pageSize: 10, totalCount: 0 }]) await assert.rejects(() => api[method](input, { client: wire(data).client }), /response_invalid/);
  });
}
test('balance rejects partial, duplicate, unknown-ID and wrong-location coverage', async () => {
  const api = await service(); const input = contexts[3][2];
  for (const data of [{ ...balance(), rows: [] }, { ...balance(), rows: [...balance().rows, ...balance().rows] }, { ...balance(), rows: [{ ...balance().rows[0], textbookId: id(102) }] }, { ...balance(), locationId: null }]) {
    await assert.rejects(() => api.getTextbookInventoryBalance(input, { client: wire(data).client }), /response_invalid/);
  }
  await assert.rejects(() => api.getTextbookInventoryBalance({ ...input, textbookIds: [id(101),id(101)] }, { client: wire(balance()).client }), /invalid/);
  assert.deepEqual(await api.getTextbookInventoryBalance({ textbookIds: [], locationId: null }, { client: wire({ locationId: null, rows: [] }).client }), { locationId: null, rows: [] });
});
test('duplicate preview has max10 with full count, and null detail is explicit', async () => {
  const api = await service();
  assert.deepEqual(await api.getTextbookMasterDetail(id(101), { client: wire({ row: null }).client }), { row: null });
  const previewRows = Array.from({ length: 10 }, (_, n) => ({ ...master(), id: id(n+1) }));
  assert.equal((await api.checkTextbookMasterDuplicate(contexts[4][2], { client: wire({ totalCount: 111, previewRows }).client })).totalCount,111);
  for (const data of [{ totalCount: 111, previewRows: [] }, { totalCount: 111, previewRows: [...previewRows,master()] }, { totalCount: 0, previewRows: [master()] }]) {
    await assert.rejects(() => api.checkTextbookMasterDuplicate(contexts[4][2], { client: wire(data).client }), /response_invalid/);
  }
});
test('UUID context coverage compares canonical identities without rejecting uppercase input or allowing case-duplicate IDs', async () => {
  const api = await service();
  assert.equal((await api.getTextbookMasterDetail(id(101).toUpperCase(), { client: wire({ row: master() }).client })).row.id,id(101));
  const input={textbookIds:[id(101).toUpperCase()],locationId:id(900).toUpperCase()};
  assert.equal((await api.getTextbookInventoryBalance(input,{client:wire(balance()).client})).rows[0].textbookId,id(101));
  await assert.rejects(() => api.getTextbookInventoryBalance({...input,textbookIds:[id(101),id(101).toUpperCase()]},{client:wire(balance()).client}),/invalid/);
});
test('summary retains full-filter price/location/subject totals and rejects incomplete or conflicting aggregates', async () => {
  const api = await service();
  assert.deepEqual(await api.getTextbookMasterSummary(filters,{client:wire(summary()).client}),summary());
  for (const patch of [{ salePriceTotal: undefined }, { salePriceTotal: '10000' }, { locationQuantities: {} }, { subjectTotals: [] },
    { subjectTotals: [{ ...summary().subjectTotals[0], totalCount: 2 }] }, { subjectTotals: [{ ...summary().subjectTotals[0], subject: 'invalid' }] }]) {
    await assert.rejects(() => api.getTextbookMasterSummary(filters,{client:wire({...summary(),...patch}).client}),/response_invalid/);
  }
});

// Exact original bounded payloads from authenticated final-only SQL execution.
// Request: textbook-task2-final; actor a2000000-0000-4000-8000-000000000901 / authenticated.
// SQL f4ba6fc76223af13704a1187ff45db5f187b1633392b2516714c9a1e2522dcb5
// pgTAP ce8d2b839927932a873b6cb510fcd60328260935f6e29dec09ef30a4f76dcb34
// Manifest at capture 3e4cc286f08ba0860ab03c4575e1802b0635da31f37d1971ac7bc807c997f06a
// Raw sanitized log 8466e6e14e8dd971f714a59e5697633cad317f2c895e21aa61cdb047133d0ff1
// Only '# TB2_WIRE ' was removed; original JSON bytes are retained below.
const finalSqlWirePayloads = [
  String.raw`{"data": {"page": 1, "rows": [{"id": "a2000000-0000-4000-8000-000000000203", "name": "Parity 203", "price": 10000, "title": "Parity 203", "isbn13": "tb2-203", "status": "active", "barcode": null, "subject": "english", "category": "독해", "publisher": "출판사", "salePrice": 10000, "list_price": 0, "sale_price": 10000, "stockValue": 0, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": null, "qualityScore": 0, "school_level": "middle", "is_returnable": false, "qualityIssues": {"inactive": false, "duplicate": false, "missingCode": false, "missingPrice": false, "missingCategory": false, "subjectMismatch": false, "missingPublisher": false}, "school_levels": ["middle"], "totalQuantity": 0, "locationSummary": [], "studentQuantity": 0, "teacherQuantity": 0, "subject_area_key": null, "locationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}, "default_supplier_id": null, "studentLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}}], "pageSize": 10, "totalCount": 1}, "input": {"page": 1, "sort": "quality-title", "filters": {"search": "Parity 203", "quality": "all", "subject": "english", "inventory": "all", "gradeLevel": "all", "subSubject": "all", "schoolLevel": "all"}, "pageSize": 10}, "method": "listTextbookMasterPage"}`,
  String.raw`{"data": {"page": 1, "rows": [{"id": "a2000000-0000-4000-8000-000000000203", "title": "Parity 203", "reason": "재고 부족", "source": {"id": "a2000000-0000-4000-8000-000000000203", "name": "Parity 203", "price": 10000, "title": "Parity 203", "isbn13": "tb2-203", "status": "active", "barcode": null, "subject": "english", "category": "독해", "publisher": "출판사", "salePrice": 10000, "list_price": 0, "sale_price": 10000, "stockValue": 0, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": null, "qualityScore": 0, "school_level": "middle", "is_returnable": false, "qualityIssues": {"inactive": false, "duplicate": false, "missingCode": false, "missingPrice": false, "missingCategory": false, "subjectMismatch": false, "missingPublisher": false}, "school_levels": ["middle"], "totalQuantity": 0, "locationSummary": [], "studentQuantity": 0, "teacherQuantity": 0, "subject_area_key": null, "locationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}, "default_supplier_id": null, "studentLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}}, "status": "recommended", "dueLabel": "실사 이력 없음", "publisher": "출판사", "locationId": "a2000000-0000-4000-8000-000000000900", "locationName": "본관", "isRecommended": true, "latestCountAt": "", "currentQuantity": 0, "isCountedThisCycle": false, "daysSinceLatestCount": null}], "pageSize": 10, "totalCount": 1}, "input": {"page": 1, "sort": "audit-priority", "filters": {"audit": "all", "search": "Parity 203", "quality": "all", "subject": "english", "inventory": "all", "gradeLevel": "all", "locationId": "a2000000-0000-4000-8000-000000000900", "subSubject": "all", "schoolLevel": "all"}, "pageSize": 10}, "method": "listTextbookInventoryPage"}`,
  String.raw`{"data": {"page": 1, "rows": [{"id": "a2000000-0000-4000-8000-000000000201", "title": "Parity 201", "reason": "29일 남음", "source": {"id": "a2000000-0000-4000-8000-000000000201", "name": "Parity 201", "price": 10000, "title": "Parity 201", "isbn13": "tb2-201", "status": "active", "barcode": null, "subject": "english", "category": "독해", "publisher": "출판사", "salePrice": 10000, "list_price": 0, "sale_price": 10000, "stockValue": 977, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": null, "qualityScore": 8, "school_level": "middle", "is_returnable": false, "qualityIssues": {"inactive": false, "duplicate": true, "missingCode": false, "missingPrice": false, "missingCategory": false, "subjectMismatch": false, "missingPublisher": false}, "school_levels": ["middle"], "totalQuantity": 10, "locationSummary": [{"id": "a2000000-0000-4000-8000-000000000900", "code": "__tb2_main__", "name": "본관", "quantity": 12, "sortOrder": 10}], "studentQuantity": 9, "teacherQuantity": 1, "subject_area_key": null, "locationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 12, "a2000000-0000-4000-8000-000000000910": 0}, "default_supplier_id": null, "studentLocationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 11, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 1, "a2000000-0000-4000-8000-000000000910": 0}}, "status": "done", "dueLabel": "29일 남음", "publisher": "출판사", "locationId": "a2000000-0000-4000-8000-000000000900", "locationName": "본관", "isRecommended": false, "latestCountAt": "2026-08-30", "currentQuantity": 12, "isCountedThisCycle": true, "daysSinceLatestCount": 1}], "pageSize": 10, "totalCount": 1}, "input": {"page": 1, "sort": "audit-priority", "filters": {"audit": "all", "search": "Parity 201", "quality": "all", "subject": "english", "inventory": "all", "gradeLevel": "all", "locationId": "a2000000-0000-4000-8000-000000000900", "subSubject": "all", "schoolLevel": "all"}, "pageSize": 10}, "method": "listTextbookInventoryPage"}`,
  String.raw`{"data": {"page": 1, "rows": [{"at": "2026-08-31", "id": "count-a2000000-0000-4000-8000-000000002003", "kind": "count", "memo": "", "actor": "-", "action": "실사 0→-2", "change": "-2권", "actorId": "", "sourceId": "a2000000-0000-4000-8000-000000002003", "actorLabel": "", "linkedMoveId": "a2000000-0000-4000-8000-000000001006", "locationName": "본관", "textbookTitle": "Parity 202"}, {"at": "2026-08-31T09:00:00+09:00", "id": "move-a2000000-0000-4000-8000-000000001006", "kind": "move", "memo": "", "actor": "-", "action": "실사 조정", "change": "-2권", "actorId": "", "sourceId": "a2000000-0000-4000-8000-000000001006", "actorLabel": "", "linkedMoveId": "", "locationName": "본관", "textbookTitle": "Parity 202"}], "pageSize": 10, "totalCount": 2}, "input": {"page": 1, "sort": "event-desc", "filters": {"locationId": null, "textbookId": "a2000000-0000-4000-8000-000000000202"}, "pageSize": 10}, "method": "listTextbookInventoryHistoryPage"}`,
  String.raw`{"data": {"locations": [{"id": "a2000000-0000-4000-8000-000000000900", "code": "__tb2_main__", "name": "본관", "sortOrder": 10}, {"id": "a2000000-0000-4000-8000-000000000910", "code": "__tb2_annex__", "name": "별관", "sortOrder": 20}], "stockValue": 0, "totalCount": 1, "qualityCounts": {"all": 118, "inactive": 1, "attention": 1, "duplicate": 1, "missingCode": 0, "missingPrice": 0, "missingCategory": 0, "subjectMismatch": 0, "missingPublisher": 0}, "subjectTotals": [{"subject": "english", "stockValue": 0, "totalCount": 1, "totalQuantity": 0, "salePriceTotal": 10000}], "totalQuantity": 0, "salePriceTotal": 10000, "inventoryCounts": {"all": 1, "unused": 1, "surplus": 0, "negative": 0, "shortage": 0}, "studentQuantity": 0, "teacherQuantity": 0, "subSubjectOptions": ["내신", "단어", "독해", "듣기", "모고", "문법"], "locationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}}, "input": {"search": "Parity 203", "quality": "all", "subject": "english", "inventory": "all", "gradeLevel": "all", "subSubject": "all", "schoolLevel": "all"}, "method": "getTextbookMasterSummary"}`,
  String.raw`{"data": {"locations": [{"id": "a2000000-0000-4000-8000-000000000900", "code": "__tb2_main__", "name": "본관", "sortOrder": 10}, {"id": "a2000000-0000-4000-8000-000000000910", "code": "__tb2_annex__", "name": "별관", "sortOrder": 20}], "stockValue": 0, "totalCount": 1, "auditCounts": {"all": 1, "done": 0, "pending": 0, "recommended": 1}, "qualityCounts": {"all": 118, "inactive": 1, "attention": 1, "duplicate": 1, "missingCode": 0, "missingPrice": 0, "missingCategory": 0, "subjectMismatch": 0, "missingPublisher": 0}, "subjectTotals": [{"subject": "english", "stockValue": 0, "totalCount": 1, "totalQuantity": 0, "salePriceTotal": 10000}], "totalQuantity": 0, "salePriceTotal": 10000, "inventoryCounts": {"all": 1, "unused": 1, "surplus": 0, "negative": 0, "shortage": 0}, "studentQuantity": 0, "teacherQuantity": 0, "subSubjectOptions": ["내신", "단어", "독해", "듣기", "모고", "문법"], "locationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}}, "input": {"audit": "all", "search": "Parity 203", "quality": "all", "subject": "english", "inventory": "all", "gradeLevel": "all", "locationId": "a2000000-0000-4000-8000-000000000900", "subSubject": "all", "schoolLevel": "all"}, "method": "getTextbookInventorySummary"}`,
  String.raw`{"data": {"row": {"id": "a2000000-0000-4000-8000-000000000201", "name": "Parity 201", "price": 10000, "title": "Parity 201", "isbn13": "tb2-201", "status": "active", "barcode": null, "subject": "english", "category": "독해", "publisher": "출판사", "salePrice": 10000, "list_price": 0, "sale_price": 10000, "stockValue": 977, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": null, "qualityScore": 8, "school_level": "middle", "is_returnable": false, "qualityIssues": {"inactive": false, "duplicate": true, "missingCode": false, "missingPrice": false, "missingCategory": false, "subjectMismatch": false, "missingPublisher": false}, "school_levels": ["middle"], "totalQuantity": 10, "locationSummary": [{"id": "a2000000-0000-4000-8000-000000000900", "code": "__tb2_main__", "name": "본관", "quantity": 12, "sortOrder": 10}], "studentQuantity": 9, "teacherQuantity": 1, "subject_area_key": null, "locationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 12, "a2000000-0000-4000-8000-000000000910": 0}, "default_supplier_id": null, "studentLocationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 11, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 1, "a2000000-0000-4000-8000-000000000910": 0}}}, "input": "a2000000-0000-4000-8000-000000000201", "method": "getTextbookMasterDetail"}`,
  String.raw`{"data": {"rows": [{"stockValue": 977, "textbookId": "a2000000-0000-4000-8000-000000000201", "totalQuantity": 10, "currentQuantity": 12, "studentQuantity": 9, "teacherQuantity": 1, "locationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 12, "a2000000-0000-4000-8000-000000000910": 0}, "studentLocationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 11, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 1, "a2000000-0000-4000-8000-000000000910": 0}}, {"stockValue": 0, "textbookId": "a2000000-0000-4000-8000-000000000204", "totalQuantity": 2, "currentQuantity": 2, "studentQuantity": 0, "teacherQuantity": 2, "locationQuantities": {"a2000000-0000-4000-8000-000000000900": 2, "a2000000-0000-4000-8000-000000000910": 0}, "studentLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 0, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 2, "a2000000-0000-4000-8000-000000000910": 0}}], "locationId": "a2000000-0000-4000-8000-000000000900"}, "input": {"locationId": "a2000000-0000-4000-8000-000000000900", "textbookIds": ["a2000000-0000-4000-8000-000000000201", "a2000000-0000-4000-8000-000000000204"]}, "method": "getTextbookInventoryBalance"}`,
  String.raw`{"data": {"totalCount": 1, "previewRows": [{"id": "a2000000-0000-4000-8000-000000000201", "name": "Parity 201", "price": 10000, "title": "Parity 201", "isbn13": "tb2-201", "status": "active", "barcode": null, "subject": "english", "category": "독해", "publisher": "출판사", "salePrice": 10000, "list_price": 0, "sale_price": 10000, "stockValue": 977, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": null, "qualityScore": 8, "school_level": "middle", "is_returnable": false, "qualityIssues": {"inactive": false, "duplicate": true, "missingCode": false, "missingPrice": false, "missingCategory": false, "subjectMismatch": false, "missingPublisher": false}, "school_levels": ["middle"], "totalQuantity": 10, "locationSummary": [{"id": "a2000000-0000-4000-8000-000000000900", "code": "__tb2_main__", "name": "본관", "quantity": 12, "sortOrder": 10}], "studentQuantity": 9, "teacherQuantity": 1, "subject_area_key": null, "locationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 12, "a2000000-0000-4000-8000-000000000910": 0}, "default_supplier_id": null, "studentLocationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 11, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 1, "a2000000-0000-4000-8000-000000000910": 0}}]}, "input": {"title": "Parity 201", "subject": "english", "category": "", "excludeId": null, "publisher": ""}, "method": "checkTextbookMasterDuplicate"}`,
  String.raw`{"data": {"page": 1, "rows": [{"id": "a2000000-0000-4000-8000-000000000201", "title": "Parity 201", "reason": "실사일 확인 필요", "source": {"id": "a2000000-0000-4000-8000-000000000201", "name": "Parity 201", "price": 10000, "title": "Parity 201", "isbn13": "tb2-201", "status": "active", "barcode": null, "subject": "english", "category": "독해", "publisher": "출판사", "salePrice": 10000, "list_price": 0, "sale_price": 10000, "stockValue": 977, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": null, "qualityScore": 8, "school_level": "middle", "is_returnable": false, "qualityIssues": {"inactive": false, "duplicate": true, "missingCode": false, "missingPrice": false, "missingCategory": false, "subjectMismatch": false, "missingPublisher": false}, "school_levels": ["middle"], "totalQuantity": 10, "locationSummary": [{"id": "a2000000-0000-4000-8000-000000000900", "code": "__tb2_main__", "name": "본관", "quantity": 12, "sortOrder": 10}], "studentQuantity": 9, "teacherQuantity": 1, "subject_area_key": null, "locationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 12, "a2000000-0000-4000-8000-000000000910": 0}, "default_supplier_id": null, "studentLocationQuantities": {"unassigned": -2, "a2000000-0000-4000-8000-000000000900": 11, "a2000000-0000-4000-8000-000000000910": 0}, "teacherLocationQuantities": {"a2000000-0000-4000-8000-000000000900": 1, "a2000000-0000-4000-8000-000000000910": 0}}, "status": "recommended", "dueLabel": "실사일 확인 필요", "publisher": "출판사", "locationId": "a2000000-0000-4000-8000-000000000900", "locationName": "본관", "isRecommended": true, "latestCountAt": "infinity", "currentQuantity": 12, "isCountedThisCycle": false, "daysSinceLatestCount": null}], "pageSize": 10, "totalCount": 1}, "input": {"page": 1, "sort": "audit-priority", "filters": {"audit": "all", "search": "Parity 201", "quality": "all", "subject": "english", "inventory": "all", "gradeLevel": "all", "locationId": "a2000000-0000-4000-8000-000000000900", "subSubject": "all", "schoolLevel": "all"}, "pageSize": 10}, "method": "listTextbookInventoryPage"}`,
];
test('final SQL wire provenance binds immutable migration, pgTAP and all eight methods', () => {
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const migration = '20260831123610_textbook_inventory_numbered_reads.sql';
  assert.equal(digest(readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url))), 'f4ba6fc76223af13704a1187ff45db5f187b1633392b2516714c9a1e2522dcb5');
  assert.equal(digest(readFileSync(new URL('../supabase/tests/textbook_inventory_numbered_reads_test.sql', import.meta.url))), 'ce8d2b839927932a873b6cb510fcd60328260935f6e29dec09ef30a4f76dcb34');
  const manifest = JSON.parse(readFileSync(new URL('../supabase/test-baselines/dashboard-free-tier-v1.manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.orderedNewMigrations.find((entry) => entry.fileName === migration), {
    fileName: migration, status: 'final', sha256: 'f4ba6fc76223af13704a1187ff45db5f187b1633392b2516714c9a1e2522dcb5',
  });
  assert.equal(finalSqlWirePayloads.length, 10);
  assert.equal(digest(finalSqlWirePayloads.join('\n')), '471bd0872879ec431b7253003bb74370ed43c761ad8eeec05c0673e866d193c2');
  assert.deepEqual([...new Set(finalSqlWirePayloads.map((payload) => JSON.parse(payload).method))].sort(), [...domains, ...contexts].map((entry) => entry[0]).sort());
});
for (const [index, payload] of finalSqlWirePayloads.entries()) {
  const capture = JSON.parse(payload);
  test('final authenticated SQL DTO ' + (index + 1) + ' replays verbatim through ' + capture.method, async () => {
    const api = await service();
    const original = structuredClone(capture.data);
    const transport = wire(capture.data);
    const result = await api[capture.method](capture.input, { client: transport.client });
    assert.deepEqual(capture.data, original, 'production parser must not mutate the captured wire DTO');
    // Expected model-only conversion occurs AFTER the untouched wire reached the actual parser.
    if (capture.method === 'listTextbookInventoryPage') {
      for (const row of original.rows) if (row.daysSinceLatestCount === null) row.daysSinceLatestCount = Infinity;
    }
    assert.deepEqual(result, original);
    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0].retry, false);
  });
}
