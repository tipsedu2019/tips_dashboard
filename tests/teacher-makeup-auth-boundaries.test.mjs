import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { setup, id, row } from './helpers/makeup-numbered-harness.mjs';
globalThis.fetch=async()=>{throw Error('external network forbidden by independent audit')};
const dialog=()=>document.querySelector('[role="dialog"]');
function noRawOrWrites(p){assert.equal(p.requests.some(r=>r.table),false);assert.equal(p.requests.some(r=>!/^(list_makeup_numbered_page_v1|get_makeup_detail_v1)$/.test(r.name)),false);}
async function pendingPageAndDetail(t){
 const p=await setup(t,{auth:{role:'teacher'},search:`?view=approvalPending&requestId=${id(999)}`});
 const first=p.numbered()[0],detail=p.requests.find(r=>r.name==='get_makeup_detail_v1');
 assert.ok(first);assert.ok(detail);
 await act(async()=>p.finish(first,12));
 const next=document.querySelector('[aria-label="2 페이지"]');assert.equal(Boolean(next),true);
 await act(async()=>next.click());
 const pending=p.numbered().at(-1);assert.notEqual(pending,first);
 return {p,detail,pending};
}
test('teacher makeup page permission denial clears an already accepted detail',async t=>{
 const {p,detail,pending}=await pendingPageAndDetail(t);
 await act(async()=>detail.resolve({data:row(999,{className:'ACCEPTED_MAKEUP_DETAIL_TO_REVOKE'}),error:null}));
 assert.equal(Boolean(dialog()),true);assert.equal(document.body.textContent.includes('ACCEPTED_MAKEUP_DETAIL_TO_REVOKE'),true);
 await act(async()=>pending.resolve({data:null,error:{code:'42501',message:'SYNTHETIC_DENIED'}}));
 console.log('MAKEUP_ACCEPTED_AFTER_DENIAL',JSON.stringify({dialog:Boolean(dialog()),hasOldDetail:document.body.textContent.includes('ACCEPTED_MAKEUP_DETAIL_TO_REVOKE')}));
 assert.equal(Boolean(dialog()),false,'page permission denial must revoke the accepted makeup detail');
 assert.equal(document.body.textContent.includes('ACCEPTED_MAKEUP_DETAIL_TO_REVOKE'),false);noRawOrWrites(p);
});
test('teacher makeup page permission denial invalidates a pending detail completion',async t=>{
 const {p,detail,pending}=await pendingPageAndDetail(t);
 await act(async()=>pending.resolve({data:null,error:{code:'42501',message:'SYNTHETIC_DENIED'}}));
 await act(async()=>detail.resolve({data:row(999,{className:'LATE_MAKEUP_DETAIL_AFTER_DENIAL'}),error:null}));
 console.log('MAKEUP_PENDING_AFTER_DENIAL',JSON.stringify({dialog:Boolean(dialog()),hasLateDetail:document.body.textContent.includes('LATE_MAKEUP_DETAIL_AFTER_DENIAL')}));
 assert.equal(Boolean(dialog()),false,'a pending makeup detail must not appear after page permission denial');
 assert.equal(document.body.textContent.includes('LATE_MAKEUP_DETAIL_AFTER_DENIAL'),false);noRawOrWrites(p);
});
