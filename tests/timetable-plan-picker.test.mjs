import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
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
 const dom = new JSDOM('<div id="root"></div>');
 const old = {window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let actor='A'; const pending=[], reads=[], calls=[], changes=[];
 const services = Object.fromEntries(['A','B'].map(id=>[id,{listPlans:async()=>({plans:[],total:0,canManage:true}),shareCandidates:()=>{const d=deferred();reads.push({actor:id,...d});return d.promise;},mutatePlan:command=>{const d=deferred();calls.push(structuredClone(command));pending.push({actor:id,...d});return d.promise;}}]));
 const box=({children})=>h('div',null,children);
 const mocks={
 '@/providers/auth-provider':{useAuth:()=>({user:{id:actor},role:'admin',loading:false})},'@/lib/supabase':{supabase:{}},
 './timetable-plan-service':{createTimetablePlanService:({actorScope})=>services[actorScope.split(':')[0]]},
 './timetable-plan-interaction':{planErrorLabel:e=>e.message||'실패'},
 '@/components/ui/button':{Button:({children,...props})=>{delete props.variant;return h('button',props,children);}},
 '@/components/ui/input':{Input:({onChange,...props})=>{delete props.autoFocus;return h('input',{...props,onInput:onChange});}},
 '@/components/ui/label':{Label:props=>h('label',props)},
 '@/components/ui/checkbox':{Checkbox:({checked,onCheckedChange})=>h('input',{type:'checkbox',checked,readOnly:true,onClick:()=>onCheckedChange(!checked)})},
 '@/components/ui/select':Object.fromEntries(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue'].map(k=>[k,box])),
 '@/components/ui/dialog':{Dialog:({open,children})=>open?h('section',{'data-dialog':true},children):null,...Object.fromEntries(['DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogFooter'].map(k=>[k,box]))},
 '@/components/ui/dropdown-menu':{DropdownMenu:box,DropdownMenuContent:box,DropdownMenuTrigger:box,DropdownMenuItem:({children,onSelect})=>h('button',{onClick:onSelect},children)},
 };
 const runtime={exports:{}};vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(key=>mocks[key]||require(key),runtime,runtime.exports);
 const root=createRoot(document.getElementById('root'));
 const snapshot=realDb ? await rpc('get_timetable_plan_v1',{p_plan_id:'ae260000-0000-4000-8000-000000000001'}) : {plan:{id:'source',name:'원본',state:'draft',metaRevision:1,targetStartDate:null,targetEndDate:null},members:[],permissions:{canManage:true}};
 const render=()=>act(async()=>root.render(h(runtime.exports.TimetablePlanPicker,{planId:'source',snapshot,onChange:id=>changes.push(id),onRefresh:async()=>{},requestAction:action=>action()})));
 await render();
 const click=async text=>act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);button.click();});
 const input=async value=>act(async()=>{const el=document.getElementById('plan-name');el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 return {pending,reads,calls,changes,click,input,submit,render,actor:async id=>{actor=id;await render();},resolve:async(index,result)=>act(async()=>pending[index].resolve(result)),reject:async(index,error=Error('response lost'))=>act(async()=>pending[index].reject(error)),close:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close();}};
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
