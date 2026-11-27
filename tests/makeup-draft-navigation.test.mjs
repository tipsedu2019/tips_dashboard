import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { requestAppNavigation } from '../src/lib/guarded-navigation.ts';
import { setup, button, row } from './helpers/makeup-numbered-harness.mjs';
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
async function ready(t, refund = false) {
  const p = await setup(t, refund ? { search:'?view=refundPending' } : {});
  window.navigation = Object.assign(new window.EventTarget(), { traverseTo() {} });
  window.HTMLElement.prototype.getClientRects = () => [{width:20,height:20}];
  await act(async () => p.finish(p.numbered()[0], 1, {rows:[row(1, refund ? {status:'refund_pending'} : {})]}));
  await p.catalogs();return p;
}
const confirm = () => document.querySelector('[data-testid="draft-navigation-confirm-dialog"]');
const click = async label => { await act(async () => button(label).click()); await settle(); };

test('untouched new makeup request closes without confirmation', async t => {
  await ready(t);await click('휴보강 신청');await click('저장하지 않고 닫기');
  assert.equal(confirm(),null);assert.equal(document.querySelector('#makeup-reason'),null);
});

test('request close keeps draft on cancel and discards only after confirmation', async t => {
  const p=await ready(t);await click('휴보강 신청');
  await act(async()=>p.observed.patch(value=>({...value,reason:'작성 중인 휴강 사유'})));
  document.querySelector('#makeup-reason').focus();
  await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));await settle();
  assert.ok(confirm());await click('계속 편집');
  assert.equal(p.observed.input.reason,'작성 중인 휴강 사유');assert.equal(document.activeElement.id,'makeup-reason');
  await click('저장하지 않고 닫기');assert.ok(confirm());await click('변경사항 버리기');
  assert.equal(document.querySelector('#makeup-reason'),null);assert.equal(p.observed.input.reason,'');
  assert.equal(p.requests.some(r=>/create_makeup|transition_makeup/.test(r.name||'')),false);
});

const offerListRetry = '현재 목록의 예약 정보를 다시 확인할 수 있습니다.';
const availableReservations = { data: { reservations: [], activeEventRequestIds: [] }, error: null };

async function discardFailedReservationDraft(t) {
  const p = await ready(t);
  const initialList = p.context().at(-1);
  assert.equal(initialList.args.p_slots.length, 1);
  await act(async () => initialList.resolve(availableReservations));
  await click('휴보강 신청');
  await p.catalogs();
  const emptyDraft = structuredClone(p.observed.input);
  const slot = { id: 'discard-slot', date: '2026-09-03', startTime: '09:00', endTime: '10:00', classroom: 'B' };
  await act(async () => p.observed.patch(input => ({ ...input, reason: '버릴 합성 초안', makeupSlots: [slot] })));
  const failed = p.context().at(-1);
  assert.equal(failed.args.p_slots.length, 2, 'the open draft has an additional reservation target');
  await act(async () => failed.reject(new Error('synthetic draft reservation failure')));
  assert.ok(document.querySelector('[role="dialog"]').contains(button('예약 다시 확인')));
  await click('저장하지 않고 닫기');
  assert.ok(confirm());
  await click('변경사항 버리기');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(p.observed.input, emptyDraft);
  assert.equal(document.body.textContent.includes(offerListRetry), false, 'the pending list lookup takes precedence');
  const currentList = p.context().at(-1);
  assert.notEqual(currentList, initialList);
  assert.deepEqual(currentList.args, initialList.args, 'discarding the draft removes its slot from the lookup');
  return { p, currentList };
}

async function recoverListError(p, failedList) {
  assert.match(document.body.textContent, /예약 충돌 정보를 불러오지 못했습니다/);
  assert.equal(document.body.textContent.includes(offerListRetry), false);
  assert.ok(button('예약 다시 확인').closest('[role="alert"]'));
  await click('예약 다시 확인');
  await p.catalogs();
  const retry = p.context().at(-1);
  assert.notEqual(retry, failedList);
  assert.deepEqual(retry.args, failedList.args);
  await act(async () => retry.resolve(availableReservations));
  assert.equal(button('예약 다시 확인'), undefined);
  assert.equal(document.body.textContent.includes(offerListRetry), false, 'a successful ordinary retry does not revive the one-time action');
  assert.equal(p.observed.input.reason, '');
  assert.equal(p.requests.some(request => /create_makeup|resubmit_makeup/.test(request.name || '')), false);
}

for (const outcome of ['success', 'failure']) {
  test(`discarding a failed reservation draft leaves a one-time retry for the current list: ${outcome}`, async t => {
    const { p, currentList } = await discardFailedReservationDraft(t);
    await act(async () => currentList.resolve(availableReservations));
    assert.ok(document.body.textContent.includes(offerListRetry), 'the list offers to recheck its own reservations');
    const action = button('예약 다시 확인');
    assert.ok(action, 'the current list keeps an explicit retry after the failed draft was discarded');
    assert.doesNotMatch(document.body.textContent, /예약 충돌 정보를 불러오지 못했습니다/);
    await act(async () => action.click());
    assert.equal(document.body.textContent.includes(offerListRetry), false);
    await p.catalogs();
    const retry = p.context().at(-1);
    assert.notEqual(retry, currentList);
    assert.deepEqual(retry.args, currentList.args);

    if (outcome === 'success') {
      await act(async () => retry.resolve(availableReservations));
      assert.doesNotMatch(document.body.textContent, /예약 충돌 정보 확인 중|예약 충돌 정보를 불러오지 못했습니다/);
      assert.equal(document.body.textContent.includes(offerListRetry), false);
      assert.equal(button('예약 다시 확인'), undefined);
    } else {
      await act(async () => retry.reject(new Error('synthetic manual list reservation failure')));
      await recoverListError(p, retry);
    }
  });
}

test('a failed list reservation read immediately after discard uses the ordinary retry once', async t => {
  const { p, currentList } = await discardFailedReservationDraft(t);
  await act(async () => currentList.reject(new Error('synthetic initial list reservation failure')));
  await recoverListError(p, currentList);
});

test('quick search intent and unload protect a request until explicitly discarded', async t => {
  const p=await ready(t);await click('휴보강 신청');
  await act(async()=>p.observed.patch(value=>({...value,reason:'미저장 사유'})));
  const unload=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
  const calls=[];await act(async()=>requestAppNavigation(()=>calls.push('route')));assert.ok(confirm());
  await click('계속 편집');assert.deepEqual(calls,[]);assert.equal(p.observed.input.reason,'미저장 사유');
  await act(async()=>{requestAppNavigation(()=>calls.push('route'));requestAppNavigation(()=>calls.push('repeat'));});
  await click('변경사항 버리기');assert.deepEqual(calls,['route']);
});

test('refund completion note shares navigation protection without triggering its mutation', async t => {
  const p=await ready(t,true);await click('환불완료');await act(async()=>p.observed.patchActionNote('처리 의견 초안'));
  const calls=[];await act(async()=>requestAppNavigation(()=>calls.push('route')));assert.ok(confirm());
  await click('계속 편집');assert.deepEqual(calls,[]);assert.match(document.querySelector('textarea').value,/처리 의견 초안/);
  await act(async()=>requestAppNavigation(()=>calls.push('route')));await click('변경사항 버리기');assert.deepEqual(calls,['route']);
  assert.equal(p.requests.some(r=>/transition_makeup/.test(r.name||'')),false);
});

test('refund failure stays inside the open processing dialog with its note and retry', async t => {
  const p = await ready(t, true);
  await click('환불완료');
  await act(async () => p.observed.patchActionNote('환불 처리 의견'));
  const dialog = document.querySelector('[role="dialog"]');
  const submit = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '환불완료');
  assert.ok(submit);
  const before = p.requests.length;
  await act(async () => submit.click());
  const processingRead = p.requests.slice(before).find(r => r.table);
  assert.ok(processingRead, 'processing validates current data before mutation');
  await act(async () => processingRead.reject(new Error('temporary upstream failure')));
  assert.ok(dialog.querySelector('[role="alert"]'), 'failure belongs to the current dialog');
  assert.equal(dialog.querySelector('textarea').value, '환불 처리 의견');
  assert.equal(submit.disabled, false);
});

test('makeup first read failure preserves search and does not claim no applications', async t => {
  const p = await setup(t);
  await act(async () => p.numbered()[0].reject(new Error('private read timeout')));
  assert.equal(document.body.textContent.includes('표시할 신청서가 없습니다.'), false);
  assert.equal(document.body.textContent.includes('private read timeout'), false);
  assert.ok(document.querySelector('input[type="search"]'));
});


test('long makeup request keeps its title and actions outside the scrollable input body', async t => {
  const p = await ready(t);
  await click('휴보강 신청');
  const dialog = document.querySelector('[role="dialog"]');
  const body = dialog.querySelector('[data-slot="scrollable-dialog-body"]');
  const footer = dialog.querySelector('[data-slot="scrollable-dialog-footer"]');
  assert.ok(body && footer, 'long input uses a bounded body with a separate action area');
  assert.equal(body.parentElement, dialog);
  assert.equal(footer.parentElement, dialog);
  assert.ok(!body.contains(dialog.querySelector('[data-slot="dialog-title"]')));
  assert.ok(body.contains(document.querySelector('#makeup-reason')));
  assert.ok(footer.contains(button('상신')));
  assert.equal(dialog.querySelector('form'), null, 'the layout must not introduce implicit Enter submission');
  await act(async () => p.observed.patch(value => ({...value, reason: '가상 미저장 내용'})));
  const submit = button('상신');
  const handler = submit[Object.keys(submit).find(key => key.startsWith('__reactProps'))].onClick;
  await act(async () => handler());
  assert.ok(footer.querySelector('[role="alert"]'), 'validation feedback stays with the visible actions');
  assert.equal(document.querySelector('#makeup-reason').value, '가상 미저장 내용');
  assert.equal(p.requests.some(r => /create_makeup|transition_makeup/.test(r.name || '')), false);
});
