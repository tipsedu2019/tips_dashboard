import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { setup, purchaseRow, id } from './textbook-numbered-harness.mjs';

const source = path.resolve(import.meta.dirname, '../..');
const nativeRead = fs.readFileSync.bind(fs);
const labels = { student: '학생용 주문 수량', teacher: '교사용 주문 수량' };
const errors = {
  student: '기존 학생용 주문 수량은 1권 이상 입력하세요.',
  teacher: '기존 교사용 주문 수량은 1권 이상 입력하세요.',
};

// The actual Workspace, read parsers, grouping and lifecycle service run unchanged.
// Only the external Supabase transport contains synthetic data; no SQL is executed.
async function scenario(t, { mode = 'order', teacher = true, failFirstWrite = false } = {}) {
  const tab = mode === 'request' ? 'requests' : 'purchase';
  const h = await setup(t, { search: `?textbookTab=${tab}&textbookDetailKind=purchase&textbookDetail=${id(300)}` });
  const deny = operation => () => { throw new Error(`isolated quantity test denies ${operation}`); };
  window.fetch = deny('fetch');
  window.XMLHttpRequest.prototype.open = deny('XHR');
  window.WebSocket = deny('WebSocket');
  if (window.navigator.sendBeacon) window.navigator.sendBeacon = deny('sendBeacon');

  const literal = nativeRead(path.join(source, 'tests/textbook-work-context.test.mjs'), 'utf8')
    .match(/const finalTask5b2WirePayload = (".*");/)?.[1];
  assert.ok(literal, 'reuse the maintained strict synthetic textbook fixture');
  const title = '합성 기존 주문 수량 확인 교재';
  const textbook = {
    ...JSON.parse(JSON.parse(literal)).data.textbook,
    id: id(101), title, name: title, category: null, school_level: 'middle', grade_level: '2',
    school_levels: ['middle'], grade_levels: ['2'], sub_subject: '문법', subject_area_key: null,
  };
  const workflowBook = Object.fromEntries([
    'id', 'title', 'name', 'status', 'subject', 'publisher', 'publisher_id', 'default_supplier_id',
    'price', 'sale_price', 'list_price', 'isbn13', 'barcode', 'is_returnable',
  ].map(key => [key, textbook[key]]));
  const bookOption = h.load('src/features/textbooks/textbook-reference-model.ts').buildTextbookReferenceOptions([textbook])[0];
  const fixture = purchaseRow(mode);
  const order = {
    ...fixture.lines[0].order, status: mode === 'request' ? 'requested' : 'ordered',
    requested_by: '합성 요청자', ordered_at: mode === 'request' ? null : '2026-10-19T00:00:00Z',
    order_date: '2026-10-19',
  };
  const lines = fixture.lines.filter(line => teacher || line.copy_scope === 'student').map(line => ({
    ...line, status: order.status, class_id: null,
    requested_quantity: mode === 'request' ? (line.copy_scope === 'student' ? 2 : 1) : 0,
    ordered_quantity: mode === 'request' ? 0 : (line.copy_scope === 'student' ? 2 : 1),
    received_quantity: 0, order, unit_cost: line.copy_scope === 'student' ? 9000 : 0,
  }));
  const location = { id: id(900), code: 'main', name: '합성 위치' };
  const locationOption = { value: location.id, label: location.name, searchText: 'main' };
  const settled = new Set();
  const writes = [];
  let submits = 0;
  let successObserved = false;

  function quantities(items = lines) {
    const q = { requested: 0, ordered: 0, received: 0, student: { requested: 0, ordered: 0, received: 0 }, teacher: { requested: 0, ordered: 0, received: 0 } };
    for (const line of items) for (const kind of ['requested', 'ordered', 'received']) {
      q[kind] += line[`${kind}_quantity`];
      q[line.copy_scope][kind] += line[`${kind}_quantity`];
    }
    return q;
  }
  function project(requestMode = mode) {
    if (requestMode !== mode) return [];
    return h.load('src/features/textbooks/textbook-read-model.ts').buildPurchaseDisplayRows(
      lines.map(line => ({ ...line, order, status: order.status })), new Map([[order.id, order]]), [textbook],
    ).map(row => ({
      ...row, mode, status: row.line.status,
      eventAt: order.ordered_at || order.created_at,
      quantities: quantities(row.lines),
      references: { textbook: workflowBook, class: null, location, publisher: null, supplier: null, configuredSupplierId: '', unitCost: 9000 },
    }));
  }
  function summary(requestMode) {
    const rows = project(requestMode);
    const members = rows.flatMap(row => row.lines);
    const q = quantities(members);
    return {
      mode: requestMode, totalCount: rows.length, rawLineCount: members.length, quantities: q,
      groups: rows.length ? [{ status: order.status, totalCount: rows.length, rawLineCount: members.length, quantities: q }] : [],
      requestCounts: { all: mode === 'request' ? rows.length : 0, unregistered: 0, orderable: mode === 'request' ? rows.length : 0 },
      orderCounts: { all: rows.length, waiting: rows.length, partial: 0, returnable: 0, returned: 0 },
      boardScopeCounts: { all: rows.length, active: rows.length, recent: 0 },
    };
  }
  function readResponse(request) {
    const a = request.args || {};
    const page = { page: a.p_page || 1, pageSize: a.p_page_size || 20 };
    switch (request.name) {
      case 'list_textbook_purchase_page_v1': {
        assert.ok(['', title].includes(a.p_filters.search), 'only the synthetic title is modeled');
        const rows = project(a.p_filters.mode);
        return { rows: rows.slice((page.page - 1) * page.pageSize, page.page * page.pageSize), ...page, totalCount: rows.length };
      }
      case 'get_textbook_purchase_summary_v1': return summary(a.p_filters.mode);
      case 'get_textbook_purchase_detail_v1':
        assert.equal(a.p_anchor_line_id, id(300));
        assert.equal(a.p_mode, mode);
        return { row: project()[0] };
      case 'get_textbook_operations_summary_v1': return {
        requestCount: mode === 'request' ? 1 : 0, unregisteredRequestCount: 0, orderNeededCount: mode === 'request' ? 1 : 0,
        receivingBacklogCount: mode === 'order' ? 1 : 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0,
      };
      case 'list_textbook_reference_page_v1': return { rows: [bookOption], ...page, totalCount: 1, baseFilterGroups: [], visibleFilterGroups: [], activeFilterCount: 0 };
      case 'list_textbook_class_reference_page_v1': return { rows: [], ...page, totalCount: 0, baseFilterGroups: [], visibleFilterGroups: [], activeFilterCount: 0 };
      case 'list_textbook_teacher_reference_page_v1': return { rows: [], ...page, totalCount: 0 };
      case 'list_textbook_location_reference_page_v1': return { rows: [locationOption], ...page, totalCount: 1, defaultLocation: location };
      case 'get_textbook_location_reference_v1':
        assert.equal(a.p_location_id, location.id);
        return { row: { ...location, option: locationOption } };
      case 'resolve_textbook_reference_v1':
        assert.equal(a.p_reference, textbook.id);
        return { row: { textbook, option: bookOption, configuredSupplierId: '', supplier: null } };
      case 'get_textbook_inventory_balance_v1':
        assert.deepEqual(a.p_input, { textbookIds: [textbook.id], locationId: location.id });
        return { locationId: location.id, rows: [{ textbookId: textbook.id, currentQuantity: 10,
          locationQuantities: { [location.id]: 10 }, studentLocationQuantities: { [location.id]: 10 }, teacherLocationQuantities: {},
          totalQuantity: 10, studentQuantity: 10, teacherQuantity: 0, stockValue: 90000 }] };
      default: assert.fail(`unmodeled external RPC denied: ${request.name}`);
    }
  }
  async function settleWrite(request) {
    const a = request.args;
    assert.ok(submits > 0, 'writes must follow an actual submit');
    assert.equal(a.p_stage, mode);
    assert.equal(a.p_order_id, order.id);
    assert.equal(a.p_line.received_quantity, 0, 'these order/request edits never receive stock');
    if (mode === 'order') assert.ok(a.p_line.ordered_quantity > 0, 'the real order RPC requires a positive quantity');
    const line = lines.find(candidate => candidate.id === a.p_line_id);
    assert.ok(line, 'only an existing synthetic member may be updated');
    assert.equal(a.p_line.copy_scope, line.copy_scope);
    const record = { submit: submits, scope: line.copy_scope, payload: structuredClone(a.p_line), committed: false };
    writes.push(record);
    if (failFirstWrite && writes.length === 1) {
      await h.reject(request, { code: '23514', message: 'textbook_purchase_state_conflict' });
      return;
    }
    Object.assign(order, a.p_order, { status: mode === 'request' ? 'requested' : 'ordered' });
    Object.assign(line, a.p_line);
    record.committed = true;
    await h.resolve(request, { order: { ...order }, line: { ...line, order: undefined, status: undefined } });
  }
  async function drain() {
    for (let round = 0; round < 30; round++) {
      const pending = h.requests.filter(request => !settled.has(request));
      if (!pending.length) return;
      for (const request of pending) {
        assert.equal(request.table, undefined, 'direct table reads, writes and fallbacks are not modeled');
        settled.add(request);
        if (request.name === 'update_textbook_purchase_lifecycle_v1') await settleWrite(request);
        else await h.resolve(request, structuredClone(readResponse(request)));
        successObserved ||= document.body.textContent.includes('업데이트했습니다');
      }
    }
    assert.fail('synthetic transport did not settle');
  }
  function input(label) {
    const node = document.querySelector(`[role="dialog"] [aria-label="${label}"]`);
    assert.ok(node, `actual form input exists: ${label}`);
    return node;
  }
  async function change(label, value) {
    const node = input(label);
    const props = node[Object.keys(node).find(key => key.startsWith('__reactProps$'))];
    // Match the maintained JSDOM harness: invoke the rendered input's real callback.
    await h.act(() => props.onChange({ target: { value } }));
  }
  async function submit() {
    const save = document.querySelector('[role="dialog"] form button[type="submit"]');
    assert.ok(save && !save.disabled, 'the actual form permits submission and can explain invalid input');
    submits++;
    await h.act(() => save.click());
    await drain();
  }
  function assertBlocked(expectedValues, invalidScopes) {
    assert.equal(writes.length, 0, 'all existing scopes are validated before the first write');
    assert.deepEqual([quantities().student.ordered, quantities().teacher.ordered], [2, teacher ? 1 : 0]);
    for (const scope of ['student', 'teacher']) {
      const node = input(labels[scope]);
      assert.equal(node.value, expectedValues[scope], 'rejected input remains editable');
      if (!invalidScopes.includes(scope)) {
        assert.notEqual(node.getAttribute('aria-invalid'), 'true', 'valid input is not marked invalid');
        continue;
      }
      assert.equal(node.getAttribute('aria-invalid'), 'true');
      const descriptions = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
        .map(identifier => document.getElementById(identifier));
      assert.ok(descriptions.length && descriptions.every(Boolean), 'invalid input references rendered feedback');
      assert.ok(descriptions.some(description => description.textContent.includes(errors[scope])), 'feedback identifies the invalid scope and correction');
    }
    assert.equal(document.activeElement, input(labels[invalidScopes[0]]), 'first invalid scope receives focus');
    assert.equal(successObserved, false, 'rejected input must not be reported as saved');
  }
  function assertSaved(expected) {
    assert.deepEqual(writes.map(write => ({ scope: write.scope, quantity: write.payload.ordered_quantity, committed: write.committed })),
      Object.entries(expected).map(([scope, quantity]) => ({ scope, quantity, committed: true })));
    assert.deepEqual(Object.fromEntries(lines.map(line => [line.copy_scope, line.ordered_quantity])), expected);
    for (const viewport of ['desktop', 'mobile']) {
      const rows = document.querySelectorAll(`[data-prepared-surface="purchase-${viewport}"]`);
      assert.equal(rows.length, 1, 'the refreshed renderer contains the one synthetic order');
      const orderedCells = rows[0].querySelectorAll('[data-quantity-stage="ordered"]');
      assert.equal(orderedCells.length, 1, 'select the order quantity cell, not request, receipt or group totals');
      for (const [scope, scopeLabel] of [['student', '학생용'], ['teacher', '교사용']]) {
        const quantity = expected[scope] ?? 0;
        const pair = orderedCells[0].querySelector(`[data-copy-scope="${scope}"]`);
        assert.ok(pair, `the order cell exposes its ${scope} quantity`);
        assert.equal(pair.getAttribute('aria-label'), `${scopeLabel} 주문 ${quantity}권`);
        assert.deepEqual([...pair.children].map(node => node.textContent), [scopeLabel, `${quantity}권`],
          'visible scope and quantity agree with the accepted write, including an absent scope as zero');
      }
    }
  }

  await drain();
  return { h, input, change, submit, assertBlocked, assertSaved, writes, quantities, get successObserved() { return successObserved; } };
}

export function registerExistingPurchaseOrderQuantityTests() {
test('existing order quantity: student zero is explained without saving either scope', async t => {
  const s = await scenario(t);
  await s.change(labels.student, '0');
  await s.submit();
  s.assertBlocked({ student: '0', teacher: '1' }, ['student']);
});

test('existing order quantity: teacher zero also blocks a valid changed student quantity', async t => {
  const s = await scenario(t);
  await s.change(labels.student, '3');
  await s.change(labels.teacher, '0');
  await s.submit();
  s.assertBlocked({ student: '3', teacher: '0' }, ['teacher']);
});

test('existing order quantity: two zero quantities preserve both values and focus the first error', async t => {
  const s = await scenario(t);
  await s.change(labels.student, '0');
  await s.change(labels.teacher, '0');
  await s.submit();
  s.assertBlocked({ student: '0', teacher: '0' }, ['student', 'teacher']);
});

test('existing order quantity: correcting a blocked zero saves both scopes exactly once', async t => {
  const s = await scenario(t);
  await s.change(labels.student, '3');
  await s.change(labels.teacher, '0');
  await s.submit();
  s.assertBlocked({ student: '3', teacher: '0' }, ['teacher']);
  await s.change(labels.teacher, '2');
  assert.notEqual(s.input(labels.teacher).getAttribute('aria-invalid'), 'true', 'corrected quantity clears its field error');
  await s.submit();
  s.assertSaved({ student: 3, teacher: 2 });
  assert.ok(s.writes.every(write => write.submit === 2), 'the rejected first submit made no write');
});

test('existing order quantity: positive edits retain the normal two-scope save path', async t => {
  const s = await scenario(t);
  await s.change(labels.student, '4');
  await s.change(labels.teacher, '2');
  await s.submit();
  s.assertSaved({ student: 4, teacher: 2 });
});

test('existing order quantity: absent teacher zero does not block an existing student update', async t => {
  const s = await scenario(t, { teacher: false });
  await s.change(labels.student, '3');
  await s.change(labels.teacher, '0');
  await s.submit();
  s.assertSaved({ student: 3 });
});

test('existing order quantity: request-stage zero retains its accepted save contract', async t => {
  const s = await scenario(t, { mode: 'request' });
  await s.change('학생용 요청 수량', '0');
  await s.change('교사용 요청 수량', '0');
  await s.submit();
  assert.deepEqual(s.writes.map(write => ({ scope: write.scope, requested: write.payload.requested_quantity, ordered: write.payload.ordered_quantity, committed: write.committed })), [
    { scope: 'student', requested: 0, ordered: 0, committed: true },
    { scope: 'teacher', requested: 0, ordered: 0, committed: true },
  ]);
  assert.equal(s.quantities().requested, 0);
});

test('existing order quantity: first lifecycle failure preserves both inputs and stops saving', async t => {
  const s = await scenario(t, { failFirstWrite: true });
  await s.change(labels.student, '3');
  await s.change(labels.teacher, '2');
  await s.submit();
  assert.deepEqual([s.input(labels.student).value, s.input(labels.teacher).value], ['3', '2']);
  assert.equal(s.writes.length, 1, 'a failed first write does not continue to the other scope');
  assert.equal(s.writes[0].committed, false);
  assert.deepEqual([s.quantities().student.ordered, s.quantities().teacher.ordered], [2, 1]);
  assert.match(document.querySelector('[role="dialog"] [role="alert"]').textContent, /새로고침/);
  assert.equal(s.successObserved, false);
  assert.equal(document.querySelector('[role="dialog"] button[type="submit"]').disabled, false);
});
}
