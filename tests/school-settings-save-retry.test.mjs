import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const initialRows = [
  { id: 'school-a', name: '합성 학교 A', category: 'elementary', color: null, sort_order: 0 },
  { id: 'school-b', name: '합성 학교 B', category: 'middle', color: null, sort_order: 1 },
];

async function mount(t, { deleteFailure = null, onlyA = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/settings/schools' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of ['HTMLElement', 'HTMLInputElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'NodeFilter', 'DOMRect', 'getComputedStyle']) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.attachEvent = () => {}; window.HTMLElement.prototype.detachEvent = () => {};
  const reads = [], deletes = [], upserts = [];
  const stored = new Map((onlyA ? initialRows.slice(0, 1) : initialRows).map(row => [row.id, row]));
  const synthetic = { from(table) {
    assert.equal(table, 'academic_schools');
    const query = { select() {
      const pending = Promise.withResolvers(); reads.push(pending);
      const chain = { then: pending.promise.then.bind(pending.promise) };
      for (const method of ['order', 'or', 'range', 'limit', 'abortSignal', 'retry']) chain[method] = () => chain;
      return chain;
    }, delete() { return { in(column, ids) {
      assert.equal(column, 'id'); deletes.push([...ids]);
      return { async select(columns) {
        assert.equal(columns, 'id');
        if (deleteFailure && deletes.length === 1) return deleteFailure;
        const deleted = ids.filter(id => stored.has(id));
        for (const id of deleted) stored.delete(id);
        return { data: deleted.map(id => ({ id })), error: null };
      } };
    } }; }, upsert(payload) {
      const pending = Promise.withResolvers(); upserts.push({ ...pending, payload });
      return { select: () => pending.promise };
    } };
    return query;
  } };
  // Keep the production deletion receipt/count validation and payload mapping.
  const service = loadNotificationComponent('src/features/management/management-service.js', new Map([
    ['../../lib/supabase.ts', { supabase: null, supabaseConfigError: null }],
    ['@/lib/supabase', { supabase: null, supabaseConfigError: null }],
  ])).createManagementService({ supabase: synthetic });
  const { SchoolMasterWorkspace } = loadNotificationComponent('src/features/management/school-master-workspace.tsx', new Map([
    ['@/lib/supabase', { supabase: synthetic }],
    ['./management-service.js', { managementService: service, createId: () => 'synthetic-new-school' }],
    ['./settings-table-columns', { useSettingsTableColumns: () => ({ isColumnVisible: () => true, visibleColumnCount: 4, columnSettingsControl: null }) }],
    ['@/hooks/use-draft-navigation', { useDraftNavigation: () => ({ confirmation: null, requestNavigation: intent => intent() }) }],
  ]));
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(createElement(SchoolMasterWorkspace)));
  const flush = async callback => act(async () => { callback(); await Promise.resolve(); });
  await flush(() => reads[0].resolve({ data: [...stored.values()], error: null }));
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
  const remove = id => flush(() => document.querySelector(`[data-testid="school-settings-mobile-card-${id}"] button[aria-label$=" 삭제"]`).click());
  const inputB = () => document.querySelector('input[data-school-row-name="school-b"]');
  const editB = () => flush(() => {
    const input = inputB();
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '합성 학교 B 수정');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  return { reads, deletes, upserts, stored, flush, button, remove, inputB, editB,
    save: () => flush(() => button('변경 저장').click()),
    failUpsert: index => flush(() => upserts[index].resolve({ data: null, error: { message: 'SYNTHETIC PRIVATE UPSERT ERROR' } })),
  };
}

test('school save retry skips an acknowledged deletion after the remaining upsert fails', async t => {
  const ui = await mount(t);
  await ui.remove('school-a'); await ui.editB(); await ui.save();
  assert.deepEqual(ui.deletes, [['school-a']]);
  await ui.failUpsert(0);
  assert.equal(ui.inputB().value, '합성 학교 B 수정');
  assert.ok(document.body.textContent.includes('다시 시도해 주세요.'));
  assert.equal(document.body.textContent.includes('SYNTHETIC PRIVATE UPSERT ERROR'), false);
  await ui.save();
  const metric = { deleteCalls: ui.deletes.length, upsertCalls: ui.upserts.length, draftRetained: ui.inputB().value === '합성 학교 B 수정' };
  t.diagnostic(JSON.stringify({ metric: 'school-partial-save-retry', ...metric }));
  assert.deepEqual(metric, { deleteCalls: 1, upsertCalls: 2, draftRetained: true });
  assert.deepEqual(ui.upserts[1].payload.map(row => [row.id, row.name]), [['school-b', '합성 학교 B 수정']]);
  await ui.flush(() => ui.upserts[1].resolve({ data: ui.upserts[1].payload, error: null }));
  await ui.flush(() => ui.reads[1].resolve({ data: [{ ...initialRows[1], name: '합성 학교 B 수정' }], error: null }));
  assert.equal(ui.button('변경 저장').disabled, true);
  assert.ok(document.body.textContent.includes('학교 변경 사항을 저장했습니다.'));
});

test('school save keeps a failed deletion pending and retries it before the remaining upsert', async t => {
  const ui = await mount(t, { deleteFailure: { data: null, error: { message: 'SYNTHETIC DELETE ERROR' } } });
  await ui.remove('school-a'); await ui.editB(); await ui.save();
  assert.equal(ui.upserts.length, 0);
  assert.ok(document.body.textContent.includes('삭제 대기 1'));
  await ui.save();
  assert.deepEqual(ui.deletes, [['school-a'], ['school-a']]);
  assert.equal(ui.upserts.length, 1);
  assert.equal(ui.inputB().value, '합성 학교 B 수정');
});

test('school save does not acknowledge a mismatched deletion receipt', async t => {
  const ui = await mount(t, { deleteFailure: { data: [], error: null } });
  await ui.remove('school-a'); await ui.editB(); await ui.save();
  assert.equal(ui.upserts.length, 0, 'real deleteRows must reject a count mismatch');
  assert.ok(document.body.textContent.includes('삭제 대기 1'));
  await ui.save();
  assert.deepEqual(ui.deletes, [['school-a'], ['school-a']]);
  assert.equal(ui.upserts.length, 1);
});

test('school delete-only save never repeats writes after a post-save read failure', async t => {
  const ui = await mount(t, { onlyA: true });
  await ui.remove('school-a'); await ui.save();
  assert.equal(ui.upserts.length, 0);
  await ui.flush(() => ui.reads[1].resolve({ data: null, error: new Error('synthetic reread offline') }));
  assert.equal(ui.button('변경 저장').disabled, true);
  await ui.flush(() => ui.button('다시 불러오기').click());
  await ui.flush(() => ui.reads[2].resolve({ data: [], error: null }));
  assert.deepEqual(ui.deletes, [['school-a']]);
  assert.equal(ui.upserts.length, 0);
});
