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
async function harness() {
 const dom = new JSDOM('<div id="root"></div>', {url:'http://127.0.0.1/'});
 const old = {sessionStorage:globalThis.sessionStorage,window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{sessionStorage:dom.window.sessionStorage,window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let actor='A'; const pending=[], reads=[], calls=[], changes=[];
 const services = Object.fromEntries(['A','B'].map(id=>[id,{listPlans:async()=>({plans:[],total:0,canManage:true}),shareCandidates:()=>{const d=deferred();reads.push({actor:id,...d});return d.promise;},mutatePlan:command=>{const d=deferred();calls.push(structuredClone(command));pending.push({actor:id,...d});return d.promise;}}]));
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
 '@/components/ui/dropdown-menu':{DropdownMenu:box,DropdownMenuContent:box,DropdownMenuTrigger:box,DropdownMenuItem:({children,onSelect})=>h('button',{onClick:onSelect},children)},
 };
 const runtime={exports:{}};vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(key=>mocks[key]||require(key),runtime,runtime.exports);
 let root=createRoot(document.getElementById('root'));
 const snapshot=realDb ? await rpc('get_timetable_plan_v1',{p_plan_id:'ae260000-0000-4000-8000-000000000001'}) : {plan:{id:'source',name:'원본',state:'draft',metaRevision:1,targetStartDate:null,targetEndDate:null},members:[],permissions:{canManage:true}};
 const render=()=>act(async()=>root.render(h(runtime.exports.TimetablePlanPicker,{planId:'source',snapshot,onChange:id=>changes.push(id),onRefresh:async()=>{},requestAction:action=>action()})));
 await render();
 const click=async text=>act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);button.click();});
 const input=async value=>act(async()=>{const el=document.getElementById('plan-name');el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 const chooseMember=(userId,label)=>act(async()=>{const control=document.getElementById(`member-${userId}`).closest('[data-select]');const option=[...control.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(option);option.click();});
 return {remount:async()=>{await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();},storage:dom.window.sessionStorage,pending,reads,calls,changes,click,input,submit,render,chooseMember,actor:async id=>{actor=id;await render();},resolve:async(index,result)=>act(async()=>pending[index].resolve(result)),reject:async(index,error=Error('response lost'))=>act(async()=>pending[index].reject(error)),close:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close();}};
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
for(const rejected of [false,true])test(`late share ${rejected?'failure':'success'} cannot populate another actor/dialog`,async()=>{
 const f=await harness();try{await f.click('공유');await f.actor('B');await f.click('공유');await act(async()=>rejected?f.reads[0].reject(Error('A private error')):f.reads[0].resolve([{userId:'secret-A',name:'A private candidate'}]));assert.ok(document.querySelector('[data-dialog]'));assert.doesNotMatch(document.body.textContent,/A private/);await act(async()=>f.reads[1].resolve([{userId:'B',name:'B candidate'}]));assert.match(document.body.textContent,/B candidate/);}finally{await f.close();}
});
for(const rejected of [false,true])test(`late create ${rejected?'failure':'success'} cannot change another actor's selection/dialog`,async()=>{
 const f=await harness();try{await f.click('프리셋 만들기');await f.input('A plan');await f.submit();await f.actor('B');await f.click('프리셋 만들기');await f.input('B plan');if(rejected)await f.reject(0);else await f.resolve(0,{plan:{id:'A-result',name:'A plan',metaRevision:1}});assert.ok(document.querySelector('[data-dialog]'));assert.equal(document.getElementById('plan-name').value,'B plan');assert.deepEqual(f.changes,[]);assert.doesNotMatch(document.body.textContent,/response lost/);await f.submit();assert.equal(f.pending[1]?.actor,'B','retired busy flag cannot block new actor');}finally{await f.close();}
});
test('late share response cannot fill a newer dialog in the same actor scope',async()=>{const f=await harness();try{await f.click('공유');await f.click('취소');await f.click('공유');await act(async()=>f.reads[0].resolve([{userId:'old',name:'retired dialog candidate'}]));assert.doesNotMatch(document.body.textContent,/retired dialog candidate/);await act(async()=>f.reads[1].resolve([{userId:'new',name:'current candidate'}]));assert.match(document.body.textContent,/current candidate/);}finally{await f.close();}});

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

for(const access of ['editor','none'])test(`share receipt preserves later ${access==='editor'?'viewer-to-editor change':'revocation'} for a separate confirmed-revision command`,async()=>{
 const f=await harness();try{
  await f.click('공유');
  await act(async()=>f.reads[0].resolve([{userId:'teacher',name:'담당 선생님'},{userId:'other',name:'다른 선생님'}]));
  await f.chooseMember('teacher','보기');await f.chooseMember('other','편집');await f.submit();
  const original=structuredClone(f.calls[0]);assert.equal(original.operation,'share');
  assert.deepEqual(original.members,[{userId:'teacher',access:'viewer'},{userId:'other',access:'editor'}]);
  await f.reject(0);await f.chooseMember('teacher',access==='editor'?'편집':'공유 안 함');await f.submit();
  assert.deepEqual(f.calls[1],original,'receipt retry must preserve exact original body/key');
  await f.resolve(1,{plan:{id:'source',name:'원본',state:'draft',metaRevision:7,targetStartDate:null,targetEndDate:null}});
  assert.ok(document.querySelector('[data-dialog]'),'later member input remains in the open dialog');
  assert.equal(document.getElementById('member-teacher').closest('[data-select]').dataset.value,access);
  assert.equal(f.calls.length,2,'later permission change requires a separate explicit save');
  await f.submit();const follow=f.calls[2];
  assert.equal(follow.operation,'share');assert.equal(follow.planId,original.planId);assert.equal(follow.expectedMetaRevision,7);
  assert.notEqual(follow.requestKey,original.requestKey);
  assert.deepEqual(follow.members,access==='editor'?[{userId:'teacher',access:'editor'},{userId:'other',access:'editor'}]:[{userId:'other',access:'editor'}]);
  await f.resolve(2,{plan:{id:'source',name:'원본',state:'draft',metaRevision:8,targetStartDate:null,targetEndDate:null}});
  assert.equal(document.querySelector('[data-dialog]'),null);assert.deepEqual(f.changes,[]);
 }finally{await f.close();}
});

for (const mode of ['create','clone','rename','share','archive','restore']) test(`${mode}: submitted immutable receipt survives full remount`,async()=>{
 const f=await harness();try{
  const labels={create:'프리셋 만들기',clone:'복제',rename:'이름·기준 기간 변경',share:'공유',archive:'보관',restore:'복원'};
  if(mode==='restore') { // A saved restore command has the same recovery shape as other metadata.
   f.storage.setItem(recovery.timetableDraftStorageKey('A:admin','$metadata'),JSON.stringify({version:1,pending:{command:{operation:'restore',planId:'source',expectedMetaRevision:1,requestKey:'restore-original'},fields:{name:'원본',start:'',end:'',members:{}}},followup:{name:'원본',start:'',end:'',members:{}}}));
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
  await f.click(related?'이름·기준 기간 변경':'프리셋 만들기');await f.input('pending');await f.submit();await f.reject(0);
  const key=recovery.timetableDraftStorageKey('A:admin','$metadata'),raw=f.storage.getItem(key);
  await act(async()=>recovery.clearTimetablePlanRecovery('A:admin','source'));
  if(related){assert.equal(f.storage.getItem(key),null);assert.equal(document.querySelector('[data-dialog]'),null);}
  else {assert.equal(f.storage.getItem(key),raw);await f.submit();assert.deepEqual(f.calls[1],f.calls[0]);}
 }finally{await f.close();}
});
