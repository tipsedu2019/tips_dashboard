import assert from 'node:assert/strict';
import test from 'node:test';
import { setup, button, id } from './helpers/textbook-numbered-harness.mjs';
import { teacherAuth } from './helpers/teacher-own-request-fixtures.mjs';
import { subjectCatalog, subjectScopeResponse } from './helpers/teacher-subject-fixtures.mjs';

const list = 'get_operations_class_schedule_numbered_page_v1';
const readNames = new Set([list, 'get_my_makeup_director_subjects_v1', 'list_operations_catalogs_v1', 'get_academic_curriculum_numbered_page_v2', 'get_operations_class_lesson_design_detail_v1', 'get_teacher_request_references_v1']);
const latest = (h, name = list) => h.requests.filter(r => r.name === name).at(-1);
const classRow = { id: id(20), name: '합성 영어 수업', subject: '영어', grade: '중2', schedule: '월수', status: '수강', teacherName: '가상 교사', termId: null, termName: null, syncGroupId: null, syncGroupName: null, updatedAt: null };
const page = (request, rows = []) => ({ page: request.args.p_page, pageSize: 15, totalCount: rows.length, rows, stats: { total: rows.length, active: rows.length, draft: 0 }, filterOptions: { terms: [], subjects: ['영어', '수학'], grades: ['중2'], teachers: ['가상 교사', '가상 복수 교사'], syncGroups: [] }, syncGroupCounts: [] });
async function click(h, label) {
  const node = button(label);
  assert.ok(node, label);
  await h.act(() => node.click());
}
async function change(h, node, value) {
  assert.ok(node);
  await h.act(() => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))].onChange({ target: { value } }));
}
async function open(h, field = 'class') {
  const trigger = document.getElementById(`makeup-${field}`);
  assert.ok(trigger && !trigger.disabled);
  await h.act(() => {
    trigger.focus();
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  const popup = document.querySelector('[role="listbox"]');
  assert.ok(popup);
  return popup;
}
async function escape(h, popup) {
  await h.act(() => popup.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
}
async function choose(h, field, label) {
  const popup = await open(h, field);
  const option = [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent.trim() === label);
  assert.ok(option, label);
  await h.act(() => {
    option.focus();
    option.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}
async function metadata(h) {
  h.metadataFinished ||= new Set();
  for (const r of h.requests.filter(r => ['list_operations_catalogs_v1', 'get_academic_curriculum_numbered_page_v2'].includes(r.name) && !h.metadataFinished.has(r))) {
    h.metadataFinished.add(r);
    await h.resolve(r, r.name === 'list_operations_catalogs_v1' ? subjectCatalog : subjectScopeResponse(r));
  }
}
async function assertNoEmpty(h, stage = 'pending or failed read') {
  const popup = await open(h);
  assert.equal(Boolean(popup.querySelector('[role="status"]')), false, `${stage}: no confirmed empty status`);
  assert.doesNotMatch(popup.textContent, /검색 결과 없음/);
  await escape(h, popup);
}
async function start(t) {
  const external = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { external.push(String(args[0])); throw new Error('Unexpected external request'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const props = { domain: 'makeup', onChanged() { throw new Error('Unexpected committed request'); } };
  const h = await setup(t, { auth: teacherAuth, component: { file: 'src/features/teacher-requests/teacher-request-actions.tsx', name: 'TeacherRequestActions' }, props });
  window.fetch = globalThis.fetch;
  window.XMLHttpRequest.prototype.send = function () { external.push('XMLHttpRequest'); throw new Error('Unexpected external request'); };
  t.after(() => {
    assert.deepEqual(external, [], 'no external fetch/XHR');
    assert.equal(h.requests.some(r => r.table), false, 'no table reads or writes');
    assert.deepEqual(h.requests.filter(r => !readNames.has(r.name)), [], 'only the expected read RPCs; no write RPC');
  });
  props.Fields = h.load('src/features/makeup-requests/makeup-request-workspace.tsx').TeacherMakeupRequestFields;
  await h.render();
  await h.resolve(latest(h, 'get_my_makeup_director_subjects_v1'), []);
  await click(h, '추가');
  await h.resolve(latest(h), page(latest(h)));
  await choose(h, 'subject', '영어');
  await h.resolve(latest(h), page(latest(h)));
  await metadata(h);
  await choose(h, 'teacher', '가상 교사');
  await change(h, document.getElementById('makeup-reason'), '보존할 합성 사유');
  return h;
}

test('#261 teacher empty class feedback appears only after a successful read and cannot select a class', async t => {
  const h = await start(t), pending = latest(h);
  assert.equal(pending.args.p_filters.teacher, '가상 교사');
  await assertNoEmpty(h);
  await h.resolve(pending, page(pending));
  const popup = await open(h), status = popup.querySelector('[role="status"]');
  assert.equal(status?.textContent.trim(), '검색 결과 없음');
  assert.equal(popup.querySelectorAll('[role="option"]').length, 0);
  assert.equal(status.hasAttribute('tabindex'), false);
  const before = h.requests.length;
  await h.act(() => status.click());
  assert.equal(h.requests.length, before);
  assert.equal(document.getElementById('makeup-class').textContent.trim(), '수업 선택');
  await escape(h, popup);
  assert.equal(document.activeElement.id, 'makeup-class');
  assert.equal(document.getElementById('makeup-reason').value, '보존할 합성 사유');
});

test('#261 teacher changes discard previous empty evidence and a late empty response; real options recover', async t => {
  const h = await start(t);
  await h.resolve(latest(h), page(latest(h)));
  let popup = await open(h);
  assert.equal(popup.querySelector('[role="status"]')?.textContent.trim(), '검색 결과 없음');
  await escape(h, popup);
  await choose(h, 'teacher', '가상 복수 교사');
  const stale = latest(h);
  await assertNoEmpty(h);
  await choose(h, 'teacher', '가상 교사');
  const current = latest(h);
  assert.notEqual(current, stale);
  assert.equal(stale.signal.aborted, true);
  await h.resolve(stale, page(stale));
  await assertNoEmpty(h, 'late empty response while current teacher query is pending');
  await h.resolve(current, page(current, [classRow]));
  popup = await open(h);
  assert.equal(Boolean(popup.querySelector('[role="status"]')), false);
  assert.equal(popup.querySelectorAll('[role="option"]').length, 1);
  await escape(h, popup);
  await choose(h, 'class', '합성 영어 수업');
  assert.equal(document.getElementById('makeup-class').textContent.trim(), '합성 영어 수업');
  assert.equal(latest(h, 'get_operations_class_lesson_design_detail_v1').args.p_class_id, id(20));
  assert.equal(document.getElementById('makeup-reason').value, '보존할 합성 사유');
});

test('#261 teacher committed search failure and pending retry never reuse a prior empty result', async t => {
  const h = await start(t);
  await h.resolve(latest(h), page(latest(h)));
  let popup = await open(h);
  assert.equal(popup.querySelector('[role="status"]')?.textContent.trim(), '검색 결과 없음');
  await escape(h, popup);
  const search = document.querySelector('input[aria-label="수업 전체 검색"]');
  await change(h, search, '합성 검색');
  await h.act(() => {
    search.focus();
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  const failed = latest(h);
  assert.equal(failed.args.p_filters.search, '합성 검색');
  await assertNoEmpty(h);
  await h.reject(failed, { code: '57014', message: 'Synthetic read failure' });
  await assertNoEmpty(h);
  assert.match(document.body.textContent, /수업·일정을 불러오지 못했습니다/);
  assert.equal(document.getElementById('makeup-reason').value, '보존할 합성 사유');
  await click(h, '다시 조회');
  const retry = latest(h);
  assert.notEqual(retry, failed);
  assert.equal(retry.args.p_filters.search, '합성 검색');
  await h.resolve(retry, page(retry));
  await assertNoEmpty(h); // Class page alone is insufficient while teacher metadata is pending.
  await metadata(h);
  popup = await open(h);
  assert.equal(popup.querySelector('[role="status"]')?.textContent.trim(), '검색 결과 없음');
  await escape(h, popup);
  await change(h, search, '');
  const recovered = latest(h);
  assert.equal(recovered.args.p_filters.search, '');
  await assertNoEmpty(h);
  await h.resolve(recovered, page(recovered, [classRow]));
  await choose(h, 'class', '합성 영어 수업');
  assert.equal(document.getElementById('makeup-class').textContent.trim(), '합성 영어 수업');
  assert.equal(document.getElementById('makeup-reason').value, '보존할 합성 사유');
});
