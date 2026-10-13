import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import * as recovery from '../src/features/academic/timetable-plan-recovery.ts';
const require = createRequire(import.meta.url);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const h = React.createElement;
const source = await readFile(process.env.TIMETABLE_PICKER_SOURCE || new URL('../src/features/academic/timetable-plan-picker.tsx',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:'picker.tsx'}).outputText;
const realDb = process.env.TIMETABLE_PICKER_FIXTURE_DB === '1';
const rpc = async (name, args) => {
 const response = await fetch(`http://127.0.0.1:3262/rest/v1/rpc/${name}`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});
 const result = await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
};
async function harness({plans=[],archivedPages=[],initialPlan=null,committed=false}={}) {
 const dom = new JSDOM('<div id="root"></div>', {url:'http://127.0.0.1/'});
 const old = {sessionStorage:globalThis.sessionStorage,window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{sessionStorage:dom.window.sessionStorage,window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let actor='A'; const pending=[], reads=[], calls=[], changes=[],listCalls=[];
 const services = Object.fromEntries(['A','B'].map(id=>[id,{listPlans:async(archived=false,page=1)=>{listCalls.push({actor:id,archived,page});return archived && archivedPages.length ? archivedPages[page-1] ?? {plans:[],total:0,canManage:true} : {plans,total:plans.length,canManage:true};},shareCandidates:()=>{const d=deferred();reads.push({actor:id,...d});return d.promise;},mutatePlan:command=>{const d=deferred();calls.push(structuredClone(command));pending.push({actor:id,...d});return d.promise;}}]));
 const box=({children})=>h('div',null,children);
 const selectContext=React.createContext(null);
 const mocks={
 '@/providers/auth-provider':{useAuth:()=>({user:{id:actor},role:'admin',loading:false})},'@/lib/supabase':{supabase:{}},
 './timetable-plan-service':{createTimetablePlanService:({actorScope})=>services[actorScope.split(':')[0]]},
 './timetable-plan-recovery.ts':recovery,
 './timetable-plan-import-dialog':{TimetablePlanImportDialog:()=>null},
 './timetable-plan-interaction':{planErrorLabel:e=>e.message||'실패'},
 '@/components/ui/button':{Button:({children,...props})=>{delete props.variant;return h('button',props,children);}},
 '@/components/ui/input':{Input:({onChange,...props})=>{delete props.autoFocus;return h('input',{...props,onInput:onChange});}},
 '@/components/ui/label':{Label:props=>h('label',props)},
 '@/components/ui/checkbox':{Checkbox:({checked,onCheckedChange})=>h('input',{type:'checkbox',checked,readOnly:true,onClick:()=>onCheckedChange(!checked)})},
 '@/components/ui/select':{
  Select:({value,onValueChange,children})=>h(selectContext.Provider,{value:{onValueChange}},h('div',{'data-select':true,'data-value':value},children)),
  SelectContent:box,SelectValue:box,SelectTrigger:({id,children})=>h('div',{id},children),
  SelectItem:({value,children})=>{const context=React.useContext(selectContext);return h('button',{type:'button',onClick:()=>context.onValueChange(value)},children);},
 },
 '@/components/ui/dialog':{Dialog:({open,children})=>open?h('section',{'data-dialog':true},children):null,...Object.fromEntries(['DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogFooter'].map(k=>[k,box]))},
 '@/components/ui/form-dialog':{ConfirmationDialogContent:({title,description,items=[],confirmLabel,onConfirm,onCancel,busy,error})=>h('div',{role:'alertdialog'},h('h2',null,title),h('p',null,description),...items.map(item=>h('p',{key:item.id,'data-confirm-target':item.id},item.title)),error?h('p',{role:'alert'},error):null,h('button',{disabled:busy,onClick:onCancel},'취소'),h('button',{'data-confirm':true,disabled:busy,onClick:onConfirm},confirmLabel))},
 '@/components/ui/dropdown-menu':{DropdownMenu:box,DropdownMenuContent:box,DropdownMenuTrigger:box,DropdownMenuItem:({children,onSelect})=>h('button',{onClick:onSelect},children)},
 };
 const runtime={exports:{}};vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(key=>mocks[key]||require(key),runtime,runtime.exports);
 let root=createRoot(document.getElementById('root'));
 let snapshot=realDb ? await rpc('get_timetable_plan_v1',{p_plan_id:'ae260000-0000-4000-8000-000000000001'}) : {plan:initialPlan??{id:'source',name:'원본',state:'draft',metaRevision:1,targetStartDate:null,targetEndDate:null},members:[],permissions:{canManage:true}};
 const render=()=>act(async()=>root.render(h(runtime.exports.TimetablePlanPicker,{planId:snapshot?.plan.id??null,snapshot,onChange:id=>changes.push(id),...(committed?{onCommitted:id=>changes.push(id)}:{}),onRefresh:async()=>{},requestAction:action=>action()})));
 await render();
 const click=async text=>act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);button.click();});
 const input=async value=>act(async()=>{const el=document.getElementById('plan-name');el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 const submit=()=>act(async()=>{const form=document.querySelector('form');if(form)form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));else document.querySelector('[data-confirm]').click();});
 const chooseMember=(userId,label)=>act(async()=>{const control=document.getElementById(`member-${userId}`).closest('[data-select]');const option=[...control.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(option);option.click();});
 return {services,listCalls,remount:async()=>{await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();},storage:dom.window.sessionStorage,pending,reads,calls,changes,click,input,submit,render,chooseMember,setSnapshot:async value=>{snapshot=value;await render();},actor:async id=>{actor=id;await render();},resolve:async(index,result)=>act(async()=>pending[index].resolve(result)),reject:async(index,error=Error('response lost'))=>act(async()=>pending[index].reject(error)),close:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close();}};
}
for(const mode of ['create','clone'])for(const reopen of [false,true])test(`${mode}: unknown receipt survives changed name${reopen?' and dialog reopen':''}`,async t=>{
 const f=await harness();const persistedIds=new Set();try {
 await f.click(mode==='create'?'프리셋 만들기':'복제');await f.input('원래 요청');await f.submit();const original=structuredClone(f.calls[0]);
 // The server has committed this intent; only its response is lost.
 const receipt=realDb ? await rpc('mutate_timetable_plan_v1',{p_command:original}) : {plan:{id:original.planId,name:original.name,metaRevision:1}};
 persistedIds.add(original.planId);
 const persisted=new Map([[original.planId,receipt.plan]]);
 await f.reject(0);await f.input('후속 입력');
 if(reopen){await f.click('취소');await f.click(mode==='create'?'프리셋 만들기':'복제');await f.input('후속 입력');}
 await f.submit();
 if(realDb){await rpc('mutate_timetable_plan_v1',{p_command:f.calls[1]});persistedIds.add(f.calls[1].planId);for(const id of persistedIds)assert.equal((await rpc('get_timetable_plan_v1',{p_plan_id:id})).plan.id,id);t.diagnostic(JSON.stringify({mode,reopen,persistedIds:[...persistedIds],persistedCount:persistedIds.size}));}
 assert.deepEqual(f.calls[1],original);assert.equal(persistedIds.size,1);assert.equal(persisted.size,1);
 await f.resolve(1,{plan:persisted.get(original.planId)});
 assert.equal(document.getElementById('plan-name')?.value,'후속 입력','later input retained for a separate rename');
 await f.submit();assert.equal(f.calls[2].operation,'rename');assert.equal(f.calls[2].planId,original.planId);assert.equal(f.calls[2].name,'후속 입력');assert.notEqual(f.calls[2].requestKey,original.requestKey);
 }finally{await f.close();if(realDb)for(const id of persistedIds){const current=await rpc('get_timetable_plan_v1',{p_plan_id:id});await rpc('mutate_timetable_plan_v1',{p_command:{operation:'archive',planId:id,expectedMetaRevision:current.plan.metaRevision,requestKey:crypto.randomUUID()}});}}
});
for(const rejected of [false,true])test(`late create ${rejected?'failure':'success'} cannot change another actor's selection/dialog`,async()=>{
 const f=await harness();try{await f.click('프리셋 만들기');await f.input('A plan');await f.submit();await f.actor('B');await f.click('프리셋 만들기');await f.input('B plan');if(rejected)await f.reject(0);else await f.resolve(0,{plan:{id:'A-result',name:'A plan',metaRevision:1}});assert.ok(document.querySelector('[data-dialog]'));assert.equal(document.getElementById('plan-name').value,'B plan');assert.deepEqual(f.changes,[]);assert.doesNotMatch(document.body.textContent,/response lost/);await f.submit();assert.equal(f.pending[1]?.actor,'B','retired busy flag cannot block new actor');}finally{await f.close();}
});
test('conclusive picker validation rejection permits corrected intent; unrelated code/message remains immutable',async()=>{
 for(const failure of [{code:'22023',message:'timetable_invalid'},{code:'22023',message:'unrelated_error'}]){
  const f=await harness();try{
   await f.click('프리셋 만들기');await f.input('처음 입력');await f.submit();const original=structuredClone(f.calls[0]);
   await f.reject(0,failure);await f.input('수정 입력');await f.submit();
   if(failure.message==='timetable_invalid'){assert.notEqual(f.calls[1].requestKey,original.requestKey);assert.equal(f.calls[1].name,'수정 입력');}
   else assert.deepEqual(f.calls[1],original);
  }finally{await f.close();}
 }
});

for (const mode of ['create','clone','rename','share','archive','restore']) test(`${mode}: submitted immutable receipt survives full remount`,async()=>{
 const f=await harness();try{
  const labels={create:'프리셋 만들기',clone:'복제',rename:'이름 변경',share:'공유',archive:'보관',restore:'복원'};
  if(['restore','archive','share'].includes(mode)) { // A saved restore command has the same recovery shape as other metadata.
   f.storage.setItem(recovery.timetableDraftStorageKey('A:admin','$metadata'),JSON.stringify({version:1,pending:{command:{operation:mode,planId:'source',expectedMetaRevision:1,requestKey:'restore-original'},fields:{name:'원본',start:'',end:'',members:{}}},followup:{name:'원본',start:'',end:'',members:{}}}));
   await f.remount();await f.click('원래 요청 확인');await f.submit();assert.equal(f.calls[0].requestKey,'restore-original');return;
  }
  await f.click(labels[mode]);if(['create','clone','rename'].includes(mode))await f.input('original');
  await f.submit();const original=structuredClone(f.calls[0]);await f.reject(0);
  if(['create','clone','rename'].includes(mode))await f.input('later');
  assert.ok(f.storage.getItem(recovery.timetableDraftStorageKey('A:admin','$metadata')));
  await f.remount();await f.click('원래 요청 확인');await f.submit();assert.deepEqual(f.calls[1],original);
  await f.resolve(1,{plan:{id:original.planId,name:original.name||'원본',metaRevision:2}});
  if(['create','clone','rename'].includes(mode))assert.equal(document.getElementById('plan-name').value,'later');
 }finally{await f.close();}
});
test('actor retirement purges pending metadata, picker list and recovery UI',async()=>{
 const f=await harness();try{await f.click('프리셋 만들기');await f.input('private');await f.submit();await f.reject(0);await act(async()=>recovery.clearTimetableActorRecovery('A:admin'));assert.equal(f.storage.length,0);assert.equal(document.querySelector('[data-dialog]'),null);assert.doesNotMatch(document.body.textContent,/원래 요청 확인|private/);}finally{await f.close();}
});

test('Storage SecurityError keeps the submitted immutable request in memory and warns before reload',async()=>{
 const f=await harness();try{
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{throw new DOMException('denied','SecurityError');},removeItem:()=>{throw new DOMException('denied','SecurityError');}};
  await f.click('프리셋 만들기');await f.input('storage failure');await f.submit();const original=structuredClone(f.calls[0]);await f.reject(0);
  assert.match(document.body.textContent,/복구 정보를 저장할 수 없습니다/);await f.submit();assert.deepEqual(f.calls[1],original);
 }finally{await f.close();}
});

for (const related of [false,true]) test(`plan revocation ${related?'purges related':'preserves unrelated'} submitted metadata`,async()=>{
 const f=await harness();try {
  await f.click(related?'이름 변경':'프리셋 만들기');await f.input('pending');await f.submit();await f.reject(0);
  const key=recovery.timetableDraftStorageKey('A:admin','$metadata'),raw=f.storage.getItem(key);
  await act(async()=>recovery.clearTimetablePlanRecovery('A:admin','source'));
  if(related){assert.equal(f.storage.getItem(key),null);assert.equal(document.querySelector('[data-dialog]'),null);}
  else {assert.equal(f.storage.getItem(key),raw);await f.submit();assert.deepEqual(f.calls[1],f.calls[0]);}
 }finally{await f.close();}
});

test('preset controls require only a name and omit retired archive, sharing and import flows',async()=>{
 const f=await harness();try{
  assert.doesNotMatch(document.body.textContent,/보관함|기존 초안 가져오기|공유|기준 기간/);
  await f.click('프리셋 만들기');assert.equal(document.querySelectorAll('input').length,1);
  await f.input('2027 여름');await f.submit();assert.equal(f.calls[0].targetStartDate,null);assert.equal(f.calls[0].targetEndDate,null);
 }finally{await f.close();}
});

const metadata=(id,name,state='draft',metaRevision=1)=>({id,name,state,metaRevision,changeSequence:metaRevision,targetStartDate:null,targetEndDate:null});
test('preset delete confirms the fixed target and cancellation sends no mutation',async()=>{
 const f=await harness();try{
  await f.click('삭제');assert.equal(document.querySelector('[data-confirm-target]').textContent,'원본');
  await f.setSnapshot({plan:metadata('other','다른 프리셋'),permissions:{canManage:true}});
  assert.equal(document.querySelector('[data-confirm-target]').dataset.confirmTarget,'source');
  await f.click('취소');assert.equal(f.calls.length,0);assert.equal(f.changes.length,0);
 }finally{await f.close();}
});
test('confirmed last preset deletion archives once and selects operational through the committed callback',async()=>{
 const original=metadata('source','마지막 프리셋');const f=await harness({plans:[original],initialPlan:original,committed:true});try{
  await f.click('삭제');await f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].operation,'archive');assert.equal(f.calls[0].expectedMetaRevision,1);
  await f.resolve(0,{plan:metadata('source','마지막 프리셋','archived',2)});assert.deepEqual(f.changes,[null]);assert.equal(document.querySelector('[data-dialog]'),null);
 }finally{await f.close();}
});
test('unknown deletion preserves selection, name and immutable receipt across reload',async()=>{
 const f=await harness();try{
  await f.click('삭제');await f.submit();const original=structuredClone(f.calls[0]);await f.reject(0);
  assert.deepEqual(f.changes,[]);assert.equal(document.querySelector('[data-confirm-target]').textContent,'원본');
  await f.setSnapshot({plan:metadata('other','다른 프리셋'),permissions:{canManage:true}});await f.remount();await f.click('원래 요청 확인');
  assert.equal(document.querySelector('[data-confirm-target]').textContent,'원본');await f.submit();assert.deepEqual(f.calls[1],original);
 }finally{await f.close();}
});
test('delete synchronously blocks same-tick duplicate confirmation',async()=>{
 const f=await harness();try{
  await f.click('삭제');await act(async()=>{const button=document.querySelector('[data-confirm]');button.click();button.click();});assert.equal(f.calls.length,1);
 }finally{await f.close();}
});
test('restore lists archived-only across pages on explicit entry and fixes the selected target',async()=>{
 const active=metadata('active','활성 프리셋'),deleted=metadata('deleted','삭제한 프리셋','archived',8);
 const f=await harness({archivedPages:[{plans:[active],total:2,canManage:true},{plans:[deleted],total:2,canManage:true}]});try{
  assert.equal(f.listCalls.some(call=>call.archived),false);await f.click('삭제한 프리셋 복구');
  assert.deepEqual(f.listCalls.filter(call=>call.archived).map(call=>call.page),[1,2]);
  assert.doesNotMatch(document.querySelector('[data-dialog]').textContent,/활성 프리셋/);await f.click('삭제한 프리셋');
  await f.setSnapshot({plan:metadata('other','다른 프리셋'),permissions:{canManage:true}});await f.submit();
  assert.deepEqual({...f.calls[0],requestKey:'fixed'},{operation:'restore',planId:'deleted',expectedMetaRevision:8,requestKey:'fixed'});
  await f.resolve(0,{plan:metadata('deleted','삭제한 프리셋','draft',9)});assert.deepEqual(f.changes,['deleted']);
 }finally{await f.close();}
});
test('stale deletion refreshes metadata and requires a new explicit confirmation',async()=>{
 const f=await harness({plans:[metadata('source','최신 이름','draft',2)]});try{
  await f.click('삭제');await f.submit();const original=f.calls[0];await f.reject(0,{code:'P0001',message:'timetable_stale'});
  assert.equal(f.calls.length,1);assert.deepEqual(f.changes,[]);
  assert.match(document.querySelector('[data-dialog]').textContent,/최신 이름/);
  await f.submit();assert.equal(f.calls[1].expectedMetaRevision,2);assert.notEqual(f.calls[1].requestKey,original.requestKey);
 }finally{await f.close();}
});
test('restore list read failure is recoverable and cannot masquerade as empty success',async()=>{
 const f=await harness();try{
  f.services.A.listPlans=async archived=>{if(archived)throw Error('restore list unavailable');return {plans:[],total:0,canManage:true};};
  await f.click('삭제한 프리셋 복구');assert.match(document.querySelector('[data-dialog]').textContent,/restore list unavailable/);assert.doesNotMatch(document.querySelector('[data-dialog]').textContent,/삭제한 프리셋이 없습니다/);
 }finally{await f.close();}
});
test('delete command remains tied to the confirmed metadata after selection changes',async()=>{
 const original=metadata('source','삭제 대상','draft',4);const f=await harness({initialPlan:original});try{
  await f.click('삭제');await f.setSnapshot({plan:metadata('other','다른 프리셋','draft',99),permissions:{canManage:true}});await f.submit();
  assert.equal(f.calls[0].planId,'source');assert.equal(f.calls[0].expectedMetaRevision,4);assert.equal(document.querySelector('[data-confirm-target]').textContent,'삭제 대상');
 }finally{await f.close();}
});
test('stale restore preserves the target and needs another confirmation with refreshed metadata',async()=>{
 const deleted=metadata('deleted','이전 이름','archived',3),latest=metadata('deleted','바뀐 이름','archived',4);
 const f=await harness({archivedPages:[{plans:[deleted],total:1,canManage:true}]});try{
  await f.click('삭제한 프리셋 복구');await f.click('이전 이름');await f.submit();const original=f.calls[0];
  f.services.A.listPlans=async()=>({plans:[latest],total:1,canManage:true});await f.reject(0,{code:'P0001',message:'timetable_stale'});
  assert.equal(f.calls.length,1);assert.deepEqual(f.changes,[]);assert.equal(document.querySelector('[data-confirm-target]').textContent,'바뀐 이름');
  await f.submit();assert.equal(f.calls[1].planId,'deleted');assert.equal(f.calls[1].expectedMetaRevision,4);assert.notEqual(f.calls[1].requestKey,original.requestKey);
 }finally{await f.close();}
});
test('an already archived concurrent target cannot submit another delete after stale',async()=>{
 const f=await harness();try{
  await f.click('삭제');await f.submit();f.services.A.listPlans=async()=>({plans:[metadata('source','원본','archived',2)],total:1,canManage:true});
  await f.reject(0,{code:'P0001',message:'timetable_stale'});assert.match(document.querySelector('[data-dialog]').textContent,/이미 삭제된/);assert.equal(document.querySelector('[data-confirm]'),null);assert.equal(f.calls.length,1);
 }finally{await f.close();}
});
test('confirmed stale clears uncertain recovery even when refreshing its metadata fails',async()=>{
 const f=await harness();try{
  await f.click('삭제');await f.submit();await f.reject(0);await f.submit();
  f.services.A.listPlans=async()=>{throw Error('metadata unavailable');};await f.reject(1,{code:'P0001',message:'timetable_stale'});
  assert.match(document.querySelector('[data-dialog]').textContent,/metadata unavailable/);assert.match(document.querySelector('[data-dialog]').textContent,/원본/);assert.equal(document.querySelector('[data-confirm]'),null);assert.deepEqual(f.changes,[]);await f.click('취소');
  assert.doesNotMatch(document.body.textContent,/원래 요청 확인/);assert.equal(f.storage.getItem(recovery.timetableDraftStorageKey('A:admin','$metadata')),null);
 }finally{await f.close();}
});
test('late delete success cannot switch a new actor to the operational timetable',async()=>{
 const f=await harness();try{
  await f.click('삭제');await f.submit();await f.actor('B');await f.click('프리셋 만들기');await f.input('B 입력');
  await f.resolve(0,{plan:metadata('source','원본','archived',2)});assert.deepEqual(f.changes,[]);assert.equal(document.getElementById('plan-name').value,'B 입력');await f.submit();assert.equal(f.pending[1].actor,'B');
 }finally{await f.close();}
});
test('invalid archive success payload retains the original request and selection',async()=>{
 const f=await harness();try{
  await f.click('삭제');await f.submit();const original=structuredClone(f.calls[0]);await f.resolve(0,{plan:metadata('other','다른 대상','archived',2)});
  assert.deepEqual(f.changes,[]);await f.submit();assert.deepEqual(f.calls[1],original);
 }finally{await f.close();}
});
test('empty early archive page reports incomplete read instead of an empty restore list',async()=>{
 const f=await harness({archivedPages:[{plans:[metadata('active','활성')],total:2,canManage:true},{plans:[],total:2,canManage:true}]});try{
  await f.click('삭제한 프리셋 복구');assert.match(document.querySelector('[data-dialog]').textContent,/timetable_plan_response_invalid/);assert.doesNotMatch(document.querySelector('[data-dialog]').textContent,/삭제한 프리셋이 없습니다/);
 }finally{await f.close();}
});
test('selected archived preset offers restore without invalid rename or delete actions',async()=>{
 const f=await harness({initialPlan:metadata('source','삭제된 선택','archived',2)});try{
  assert.doesNotMatch(document.body.textContent,/이름 변경|복제|보관됨/);await f.click('복구');await f.submit();assert.equal(f.calls[0].operation,'restore');assert.equal(f.calls[0].planId,'source');
 }finally{await f.close();}
});
test('revocation retires an in-flight restore list and prevents late private rows from reappearing',async()=>{
 const f=await harness();const read=deferred();try{
  f.services.A.listPlans=archived=>archived?read.promise:Promise.resolve({plans:[],total:0,canManage:true});
  await f.click('삭제한 프리셋 복구');await act(async()=>recovery.clearTimetablePlanRecovery('A:admin','deleted'));
  assert.ok(document.querySelector('[data-dialog]')===null,'revoked in-flight list must close');await act(async()=>read.resolve({plans:[metadata('deleted','revoked private','archived',2)],total:1,canManage:true}));assert.doesNotMatch(document.body.textContent,/revoked private/);
 }finally{await f.close();}
});
