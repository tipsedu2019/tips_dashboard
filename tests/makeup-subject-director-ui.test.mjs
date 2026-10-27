import test from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {setup,button,row,id} from './helpers/makeup-numbered-harness.mjs';

for(const role of ['admin','staff','teacher','viewer','assistant'])test(`${role} without server subject capability has no decision controls despite displayed assignment`,async t=>{
 const p=await setup(t,{auth:{role},search:`?view=approvalPending&requestId=${id(999)}`});
 if(role==='assistant'){assert.equal(p.numbered().length,0);assert.equal(button('승인'),undefined);return;}
 const entry=row(999,{requesterId:id(804),approverProfileId:id(804),canDecideSubject:false});
 await act(()=>p.finish(p.numbered()[0],1,{rows:[entry]}));
 const detail=p.requests.find(r=>r.name==='get_makeup_detail_v1');
 await act(()=>detail.resolve({data:entry,error:null}));
 for(const label of ['승인','보완 요청','반려','승인 취소'])assert.equal(button(label),undefined,label);
});

test('science teacher director reaches actual approval service without bulk catalogs, double send, or losing failed note',async t=>{
 const p=await setup(t,{auth:{role:'teacher'},search:`?view=approvalPending&requestId=${id(999)}`});
 const entry=row(999,{subject:'과학',canDecideSubject:true,approverProfileId:id(805),reason:'가상 과학 검토 사유'});
 await act(()=>p.finish(p.numbered()[0],1,{rows:[entry]}));
 await act(()=>p.requests.find(r=>r.name==='get_makeup_detail_v1').resolve({data:entry,error:null}));
 assert.match(document.body.textContent,/가상 과학 검토 사유/);
 assert.equal(button('승인').disabled,false);
 assert.equal(p.requests.some(r=>r.table||r.name==='get_makeup_reservation_context_v1'),false);
 await act(()=>button('승인').click());
 const note=document.querySelector('#makeup-approval-note');assert.ok(note);
 await act(()=>note[Object.keys(note).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:'가상 원장 결정'}}));
 const submit=button('승인 처리');assert.equal(submit.disabled,false);
 const fetches=[], original=globalThis.fetch, response=Promise.withResolvers();
 globalThis.fetch=(url,options)=>{assert.equal(url,'/api/makeup-requests/approve');fetches.push({url,body:JSON.parse(options.body)});return response.promise;};
 t.after(()=>{globalThis.fetch=original});
 p.supabase.auth.getSession=async()=>({data:{session:{access_token:'synthetic-not-a-credential'}},error:null});
 const before=p.requests.filter(r=>r.name==='get_makeup_detail_v1').length;
 await act(()=>{submit.click();submit.click()});
 const reads=p.requests.filter(r=>r.name==='get_makeup_detail_v1');assert.equal(reads.length,before+1);
 await act(()=>reads.at(-1).resolve({data:entry,error:null}));
 assert.equal(fetches.length,1);assert.equal(fetches[0].body.note,'가상 원장 결정');
 assert.equal(submit.disabled,true);
 await act(()=>response.resolve(new Response(JSON.stringify({error:'가상 서버 검증 실패'}),{status:409,headers:{'Content-Type':'application/json'}})));
 assert.match(document.body.textContent,/가상 서버 검증 실패/);assert.equal(document.querySelector('#makeup-approval-note').value,'가상 원장 결정');
 assert.equal(p.requests.some(r=>r.table),false);
});

for(const status of ['completed','makeup_pending'])test(`subject director can start cancel decision for ${status}`,async t=>{
 const p=await setup(t,{auth:{role:'teacher'},search:`?view=closed&requestId=${id(999)}`});
 const entry=row(999,{subject:'과학',status,canDecideSubject:true,approverProfileId:id(805)});
 await act(()=>p.finish(p.numbered()[0],1,{rows:[entry]}));
 await act(()=>p.requests.find(r=>r.name==='get_makeup_detail_v1').resolve({data:entry,error:null}));
 assert.ok(button('승인 취소'));await act(()=>button('승인 취소').click());assert.ok(document.querySelector('#makeup-final-cancel-note'));
 assert.equal(p.requests.some(r=>r.name==='transition_makeup_request_v2'),false,'opening never decides');
});
