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
