import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, id, masterRow, button } from './helpers/textbook-numbered-harness.mjs';

const retiredKeys = ['isbn13', 'barcode'];
const legacyCodes = { isbn13: '978-89-1234-567-8', barcode: 'LEGACY-CODE-001' };

for (const editing of [false, true]) {
  test(`textbook ${editing ? 'edit' : 'create'} omits retired codes from the real service write and preserves unrelated values`, async t => {
    const cacheCalls = [];
    const h = await setup(t, { overrides: {
      '@/lib/public-classes-cache-invalidation.js': {
        invalidatePublicClassesCacheAfterMutation: async (_client, reason) => {
          cacheCalls.push(reason);
          return { status: 'refreshed', reason, requestId: 'synthetic-cache-receipt' };
        },
      },
    } });
    const api = h.load('src/features/textbooks/textbook-service.ts');
    const input = { ...masterRow(151), ...legacyCodes, title: '수정한 합성 교재', sale_price: 14500, price: 14500 };
    if (!editing) delete input.id;
    let promise;
    await h.act(() => { promise = api.upsertTextbookMaster(input, h.supabase); });
    const writes = h.requests.filter(r => r.table === 'textbooks');
    assert.equal(writes.length, 1);
    const payload = writes[0].steps.find(step => step.method === 'upsert').args[0];
    for (const key of retiredKeys) assert.equal(Object.hasOwn(payload, key), false, `${key} must be absent, not null/empty`);
    assert.equal(payload.title, input.title);
    assert.equal(payload.sale_price, 14500);
    assert.equal(payload.subject, 'english');
    assert.equal(payload.id, editing ? id(151) : undefined);
    // A transport receipt is synthetic. This asserts the real service sends no
    // assignments for existing codes; it is not a live database preservation claim.
    const stored = editing ? { ...masterRow(151), ...legacyCodes, ...payload } : { ...payload, id: id(152), isbn13: null, barcode: null };
    await h.resolve(writes[0], stored);
    const result = await promise;
    assert.equal(result.title, input.title);
    for (const key of retiredKeys) assert.equal(result[key], editing ? legacyCodes[key] : null);
    assert.deepEqual(cacheCalls, ['textbook']);
    assert.deepEqual(retiredKeys.map(key => input[key]), retiredKeys.map(key => legacyCodes[key]), 'service does not mutate its input');
    assert.equal(h.requests.some(r => r.table && r.table !== 'textbooks'), false);
  });
}

test('legacy schema fallback also omits retired codes without discarding a failed edit', async t => {
  const h = await setup(t, { overrides: {
    '@/lib/public-classes-cache-invalidation.js': { invalidatePublicClassesCacheAfterMutation: async () => ({ status: 'refreshed' }) },
  } });
  const input = { ...masterRow(151), ...legacyCodes, title: '합성 fallback 교재' };
  const api = h.load('src/features/textbooks/textbook-service.ts');
  let promise;
  await h.act(() => { promise = api.upsertTextbookMaster(input, h.supabase); });
  const first = h.requests.find(r => r.table === 'textbooks');
  await h.reject(first, { code: 'PGRST204', message: "Could not find the 'subject_area_key' column of 'textbooks' in the schema cache" });
  const writes = h.requests.filter(r => r.table === 'textbooks');
  assert.equal(writes.length, 2);
  const payloads = writes.map(r => r.steps.find(step => step.method === 'upsert').args[0]);
  for (const payload of payloads) {
    for (const key of retiredKeys) assert.equal(Object.hasOwn(payload, key), false);
    assert.equal(payload.id, input.id);
    assert.equal(payload.title, input.title);
  }
  assert.equal(Object.hasOwn(payloads[1], 'subject_area_key'), false);
  const stored = { ...input, ...payloads[1] };
  await h.resolve(writes[1], stored);
  const result = await promise;
  assert.equal(result.isbn13, legacyCodes.isbn13);
  assert.equal(result.barcode, legacyCodes.barcode);
});


// These tests mount the real teacher form and its actual CommandInput handlers.
// Only the external Supabase transport is controlled by the shared harness.
const teacherOptions = (h, scope) => h.requests.filter(request =>
  request.name === 'read_operational_common_v1' && request.args.p_operation === 'book_request_options'
  && request.args.p_args.scope === scope);
const elementProps = element => element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
const settleTeacherSearch = h => h.act(() => new Promise(resolve => setTimeout(resolve, 300)));
const teacherPage = (rows, totalCount, page = 1) => ({ rows, totalCount, page, pageSize: 15 });
async function teacherForm(t) {
  const h = await setup(t, { mode: 'requests', auth: {
    user: { id: id(1804), email: 'teacher-fixture@example.invalid' }, role: 'teacher',
    isTeacher: true, isAdmin: false, isStaff: false, canManageAll: false,
  } });
  await h.resolve(h.requests.find(request => request.name === 'read_operational_common_v1'), teacherPage([], 0));
  await h.act(() => button('요청 추가').click());
  return h;
}
async function teacherInput(h, label, value) {
  const input = document.querySelector(`[aria-label="${label}"]`);
  assert.ok(input, label);
  await h.act(() => elementProps(input).onChange({ target: { value } }));
  return input;
}
function assertTeacherNoWrites(h) {
  assert.equal(h.requests.some(request => request.table || request.name !== 'read_operational_common_v1'), false);
}

test('teacher picker waits for Korean composition to finish before committing its bounded search', async t => {
  const h = await teacherForm(t);
  await h.act(() => document.querySelector('[aria-label="등록 교재 선택"]').click());
  const first = teacherOptions(h, 'textbooks')[0];
  assert.deepEqual(first.args.p_args, { scope: 'textbooks', search: '', page: 1, pageSize: 15 });
  await h.resolve(first, teacherPage([{ id: id(101), label: '합성 교재' }], 1));
  const input = document.querySelector('[aria-label="등록 교재 선택 검색"]');
  assert.ok(input);
  await h.act(() => elementProps(input).onCompositionStart());
  await teacherInput(h, '등록 교재 선택 검색', 'ㅎ');
  await settleTeacherSearch(h);
  assert.equal(teacherOptions(h, 'textbooks').length, 1, 'an incomplete syllable must stay local past the debounce interval');
  await teacherInput(h, '등록 교재 선택 검색', '한글 교재');
  await settleTeacherSearch(h);
  assert.equal(teacherOptions(h, 'textbooks').length, 1, 'composition updates do not issue partial server searches');
  assert.equal(document.querySelector('[aria-label="등록 교재 선택 다음 페이지"]').disabled, true);
  await h.act(() => elementProps(input).onCompositionEnd({ currentTarget: input }));
  assert.equal(teacherOptions(h, 'textbooks').length, 1, 'composition end preserves the normal commit interval');
  await settleTeacherSearch(h);
  const reads = teacherOptions(h, 'textbooks');
  assert.equal(reads.length, 2);
  assert.deepEqual(reads[1].args.p_args, { scope: 'textbooks', search: '한글 교재', page: 1, pageSize: 15 });
  assert.equal(reads[0].signal.aborted, true);
  await h.resolve(reads[1], teacherPage([], 0));
  assert.equal(input.value, '한글 교재');
  assertTeacherNoWrites(h);
});

test('teacher picker distinguishes empty catalogs, search misses, and read failure while retry preserves the query', async t => {
  const h = await teacherForm(t);
  await h.act(() => document.querySelector('[aria-label="등록 교재 선택"]').click());
  await h.resolve(teacherOptions(h, 'textbooks')[0], teacherPage([], 0));
  assert.ok(document.body.textContent.includes('선택할 항목이 없습니다.'));
  const input = await teacherInput(h, '등록 교재 선택 검색', '검색어 보존');
  await settleTeacherSearch(h);
  const failed = teacherOptions(h, 'textbooks').at(-1);
  assert.equal(failed.args.p_args.search, '검색어 보존');
  await h.reject(failed, { code: '57014', message: 'PRIVATE_OPTION_FAILURE_CANARY' });
  const alert = document.querySelector('[data-slot="popover-content"] [role="alert"]');
  assert.ok(alert?.textContent.includes('목록을 불러오지 못했습니다.'));
  assert.equal(document.body.textContent.includes('PRIVATE_OPTION_FAILURE_CANARY'), false);
  assert.equal(document.body.textContent.includes('검색 결과가 없습니다.'), false);
  assert.equal(input.value, '검색어 보존');
  await h.act(() => button('다시 시도').click());
  const retry = teacherOptions(h, 'textbooks').at(-1);
  assert.notEqual(retry, failed);
  assert.deepEqual(retry.args, failed.args, 'retry repeats the exact failed read, not an empty search');
  assert.equal(input.value, '검색어 보존');
  await h.resolve(retry, teacherPage([], 0));
  assert.ok(document.body.textContent.includes('검색 결과가 없습니다.'));
  assert.equal(document.querySelector('[data-slot="popover-content"] [role="alert"]'), null);
  assert.equal(document.querySelector('[aria-label="등록 교재 선택 다음 페이지"]').disabled, true);
  await teacherInput(h, '등록 교재 선택 검색', '');
  const cleared = teacherOptions(h, 'textbooks').at(-1);
  assert.equal(cleared.args.p_args.search, '');
  await h.resolve(cleared, teacherPage([], 0));
  assert.ok(document.body.textContent.includes('선택할 항목이 없습니다.'));
  assert.equal(document.body.textContent.includes('검색 결과가 없습니다.'), false);
  assertTeacherNoWrites(h);
});

test('teacher picker preserves the selected UUID and complete long label across server pages', async t => {
  const h = await teacherForm(t);
  const longLabel = '긴 합성 수업명과 담당 구분을 끝까지 확인하는 수업 '.repeat(6).trim();
  const firstRows = Array.from({ length: 15 }, (_, index) => ({ id: id(801 + index), label: index === 0 ? longLabel : `합성 수업 ${index + 1}` }));
  const lastRows = [{ id: id(816), label: '다음 페이지 합성 수업' }];
  const trigger = document.querySelector('[aria-label="요청 수업 선택"]');
  await h.act(() => trigger.click());
  await h.resolve(teacherOptions(h, 'classes').at(-1), teacherPage(firstRows, 16));
  const selected = [...document.querySelectorAll('[cmdk-item]')].find(option => option.textContent === longLabel);
  assert.ok(selected, 'the full long label is rendered in the real option');
  await h.act(() => selected.click());
  assert.equal(trigger.textContent.includes(longLabel), true);
  assert.equal(trigger.textContent.includes(firstRows[0].id), false);
  await h.act(() => trigger.click());
  await h.resolve(teacherOptions(h, 'classes').at(-1), teacherPage(firstRows, 16));
  await h.act(() => document.querySelector('[aria-label="요청 수업 선택 다음 페이지"]').click());
  const secondPage = teacherOptions(h, 'classes').at(-1);
  assert.equal(secondPage.args.p_args.page, 2);
  await h.resolve(secondPage, teacherPage(lastRows, 16, 2));
  assert.equal(trigger.textContent.includes(longLabel), true, 'an off-page selection remains visible');
  assert.equal(document.querySelector('[aria-label="요청 수업 선택 다음 페이지"]').disabled, true);
  await h.act(() => document.querySelector('[aria-label="요청 수업 선택 이전 페이지"]').click());
  await h.resolve(teacherOptions(h, 'classes').at(-1), teacherPage(firstRows, 16));
  const selectedAgain = [...document.querySelectorAll('[cmdk-item]')].find(option => option.textContent.includes(longLabel));
  assert.ok(selectedAgain?.textContent.includes('선택됨'), 'returning to the page restores the selected indicator');
  await h.act(() => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await teacherInput(h, '요청 교재명', '직접 입력한 합성 교재');
  await teacherInput(h, '학생용 요청 수량', '1');
  const form = document.querySelector('form');
  await h.act(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  const writes = h.requests.filter(request => request.name === 'submit_teacher_textbook_request_v1');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args.p_input.classId, firstRows[0].id, 'the original selected identity, not the visible page or label, reaches the actual service');
  assert.equal(writes[0].args.p_input.textbookId, null);
  assert.deepEqual(teacherOptions(h, 'classes').map(request => request.args.p_args.page), [1, 1, 2, 1]);
  assert.equal(h.requests.some(request => request.table), false);
  await h.resolve(writes[0], { orderId: id(1999) });
});
