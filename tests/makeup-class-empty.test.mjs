import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { setup, id, button } from './helpers/makeup-numbered-harness.mjs';

const rows = {
  profiles: [{ id: id(804), name: '합성 관리자', role: 'admin' }],
  teacher_catalogs: [
    { id: id(701), name: '합성 수업 있음', subjects: '영어', is_visible: true },
    { id: id(702), name: '합성 수업 없음', subjects: '영어', is_visible: true },
  ],
  classes: [{ id: id(600), name: '합성 영어 수업', subject: '영어', teacher: '합성 수업 있음', status: '수강', schedule_storage_mode: 'legacy' }],
  class_lesson_sessions: [], classroom_catalogs: [], academic_events: [],
};
async function openSelect(selector) {
  const trigger = document.querySelector(selector);
  assert.ok(trigger && !trigger.disabled);
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  return document.querySelector('[role="listbox"]');
}
async function choose(selector, label) {
  const popup = await openSelect(selector);
  const option = [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent.trim() === label);
  assert.ok(option, label);
  await act(async () => {
    option.focus();
    option.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}
async function escape(popup) {
  await act(async () => popup.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
}
async function start(t) {
  const p = await setup(t, { search: '?view=approvalPending' });
  await act(async () => p.finish(p.numbered()[0], 0));
  await act(async () => { for (const r of p.requests.filter(r => r.table)) r.resolve({ data: rows[r.table] || [], error: null }); });
  const open = async () => {
    const before = p.requests.length;
    await act(async () => button('휴보강 신청').click());
    return p.requests.slice(before).filter(r => r.table);
  };
  const finish = async requests => act(async () => { for (const r of requests) r.resolve({ data: rows[r.table] || [], error: null }); });
  return { p, open, finish };
}

test('#261 selected teacher with zero classes shows non-selectable feedback and recovers on teacher change/reopen', async t => {
  const { p, open, finish } = await start(t);
  await finish(await open());
  assert.equal(document.querySelector('#makeup-class').disabled, true);
  await choose('#makeup-subject', '영어');
  await choose('#makeup-teacher', '합성 수업 없음');
  await act(async () => p.observed.patch(current => ({ ...current, reason: '보존할 합성 사유' })));
  let popup = await openSelect('#makeup-class');
  const status = popup.querySelector('[role="status"]');
  assert.equal(status?.textContent.trim(), '검색 결과 없음');
  assert.equal(popup.querySelectorAll('[role="option"]').length, 0);
  assert.equal(status.hasAttribute('tabindex'), false);
  await act(async () => status.click());
  assert.equal(p.observed.input.classId, '');
  assert.equal(button('상신').disabled, true);
  await escape(popup);
  assert.equal(document.activeElement.id, 'makeup-class');
  await choose('#makeup-teacher', '합성 수업 있음');
  await choose('#makeup-class', '합성 영어 수업');
  assert.equal(p.observed.input.classId, id(600));
  assert.equal(document.querySelector('#makeup-reason').value, '보존할 합성 사유');
  await choose('#makeup-teacher', '합성 수업 없음');
  assert.equal(p.observed.input.classId, '');
  popup = await openSelect('#makeup-class');
  assert.equal(popup.querySelector('[role="status"]')?.textContent.trim(), '검색 결과 없음');
  await escape(popup);
  await act(async () => button('저장하지 않고 닫기').click());
  await act(async () => button('변경사항 버리기').click());
  await finish(await open());
  assert.equal(document.querySelector('#makeup-class').disabled, true);
  await choose('#makeup-subject', '영어');
  await choose('#makeup-teacher', '합성 수업 없음');
  popup = await openSelect('#makeup-class');
  assert.equal(popup.querySelector('[role="status"]')?.textContent.trim(), '검색 결과 없음');
  assert.equal(p.requests.some(r => /^(create|transition|update|delete)_/.test(r.name || '')), false);
});

test('#261 pending or failed fresh catalogs are not presented as a confirmed empty class search', async t => {
  const { p, open, finish } = await start(t);
  // Load once so a later open can retain teacher labels while its fresh read is pending.
  await finish(await open());
  await act(async () => button('저장하지 않고 닫기').click());
  const pending = await open();
  await choose('#makeup-subject', '영어');
  await choose('#makeup-teacher', '합성 수업 없음');
  let popup = await openSelect('#makeup-class');
  assert.doesNotMatch(popup.textContent, /검색 결과 없음/);
  await escape(popup);
  await act(async () => { for (const r of pending) r.resolve({ data: null, error: { message: '합성 기준정보 조회 실패' } }); });
  popup = await openSelect('#makeup-class');
  assert.doesNotMatch(popup.textContent, /검색 결과 없음/);
  assert.match(document.body.textContent, /합성 기준정보 조회 실패/);
  assert.equal(button('상신').disabled, true);
  assert.equal(p.observed.input.classId, '');
});
