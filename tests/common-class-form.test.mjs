import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function loadNotificationComponent(path){
 const base=new URL(process.env.TASK_COMMON_FORM_SOURCE?`file://${process.env.TASK_COMMON_FORM_SOURCE.replace(/\/$/,'')}/`: '../',import.meta.url);const cache=new Map();
 function load(url){if(cache.has(url.href))return cache.get(url.href).exports;const runtime={exports:{}};cache.set(url.href,runtime);const code=ts.transpileModule(readFileSync(url,'utf8'),{fileName:url.pathname,compilerOptions:{esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const resolve=key=>{if(key==='@/lib/supabase')return {supabase:null};if(!key.startsWith('@/')&&!key.startsWith('.'))return require(key);const stem=key.startsWith('@/')?new URL(`src/${key.slice(2)}`,base):new URL(key,url);const target=[stem,...['.ts','.tsx','.js'].map(suffix=>new URL(stem.href+suffix))].find(existsSync);assert.ok(target,key);return load(target);};vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:url.pathname})(resolve,runtime,runtime.exports);return runtime.exports;}return load(new URL(path,base));
}
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://test.invalid',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Element','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent','KeyboardEvent','Node','NodeFilter','DOMRect','getComputedStyle'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);window.HTMLElement.prototype.scrollIntoView=()=>{};
const {createRoot}=await import('react-dom/client');
const item={id:'10000000-0000-4000-8000-000000000001',planId:'20000000-0000-4000-8000-000000000001',revision:1,name:'합성 수업',subject:'영어',subjectAreaKey:null,grade:'고2',capacity:0,tuition:325000,defaultTeacherId:'teacher-a',defaultClassroomId:'room-a',durationMinutes:60,pendingSlots:[],state:'draft'};
const slot=(id,weekday,startMinute,endMinute,teacherId='teacher-a',classroomId='room-a')=>({id,itemId:item.id,planId:item.planId,weekday,startMinute,endMinute,teacherId,classroomId,sourceSlotId:'source-'+id});
const slots=[slot('mon',1,1033,1093),slot('wed',3,1103,1193,'teacher-b','room-b'),slot('wed-late',3,1380,1440)];
const snapshot={plan:{id:item.planId,state:'draft'},items:[item],slots,appliedSnapshots:[],shadowSlots:[],catalogs:{teachers:[{id:'teacher-a',name:'동명이인',isVisible:true,subjects:['영어팀']},{id:'teacher-b',name:'동명이인',isVisible:true,subjects:['영어팀']}],classrooms:[{id:'room-a',name:'1강',isVisible:true},{id:'room-b',name:'2강',isVisible:true}]}};
async function mount(t,options={}){
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const calls=[];let closes=0;
 const {TimetablePlacementEditor}=loadNotificationComponent('src/features/academic/timetable-placement-editor.tsx');
 const draft=options.draft||{item,slots,scope:'item'};
 const props={draft,snapshot:options.snapshot||snapshot,canEdit:true,localDraft:true,failureKind:null,serverSummary:'',onDirty:options.onDirty||(()=>{}),onClose(){closes++;},onSave:async edit=>{calls.push(structuredClone(edit));if(options.fail)throw Error('synthetic save failed');await options.onSave?.(edit);},onRetry:options.onRetry||(async()=>{}),onDiscard:async()=>{},onAcceptServer:async()=>{}};
 await act(async()=>root.render(createElement(TimetablePlacementEditor,props)));
 t.after(async()=>{await act(async()=>{root.unmount();await new Promise(r=>setTimeout(r,30));});container.remove();});
 const flush=async fn=>act(async()=>{fn?.();await new Promise(r=>setTimeout(r,5));});
 return {container:document.querySelector('[role="dialog"]'),calls,input:label=>document.querySelector(`input[aria-label="${label}"]`),edit:async(label,value)=>{const el=document.querySelector(`input[aria-label="${label}"]`);assert.ok(el,`missing independent row input ${label}`);await flush(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));el.dispatchEvent(new window.Event('change',{bubbles:true}));});},save:()=>flush(()=>document.querySelector('[role="dialog"] form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))),rerender:patch=>flush(()=>{Object.assign(props,patch);root.render(createElement(TimetablePlacementEditor,props));}),flush,get closes(){return closes;}};
}
test('preset whole editor exposes all differing rows and one save changes only the intended interval',async t=>{
 const ui=await mount(t);assert.equal(ui.container.querySelectorAll('[data-testid="class-schedule-slot-row"]').length,3);
 assert.equal(ui.input('수업시간 1 시작시각').value,'17:13');assert.equal(ui.input('수업시간 3 종료시각').value,'24:00');
 await ui.edit('수업시간 2 종료시각','20:13');await ui.save();assert.equal(ui.calls.length,1);const edit=ui.calls[0];assert.deepEqual(edit.slots[0],slots[0]);assert.deepEqual(edit.slots[2],slots[2]);assert.equal(edit.slots[1].endMinute,1213);assert.equal(edit.slots[1].id,'wed');assert.equal(edit.slots[1].sourceSlotId,'source-wed');assert.equal(edit.item.tuition,325000);assert.equal(edit.item.capacity,0);
});
test('preset middle-row deletion preserves sibling IDs, same-weekday row and local retry draft',async t=>{
 const ui=await mount(t,{fail:true});const rows=ui.container.querySelectorAll('[data-testid="class-schedule-slot-row"]');assert.equal(rows.length,3);await ui.flush(()=>rows[1].querySelector('button[aria-label="시간표 행 삭제"]').click());await ui.edit('수업시간 2 시작시각','23:13');await ui.save();assert.equal(ui.calls.length,1);assert.equal(ui.closes,0);assert.deepEqual(ui.calls[0].slots.map(s=>s.id),['mon','wed-late']);assert.equal(ui.input('수업시간 2 시작시각').value,'23:13');assert.equal(ui.calls[0].slots[1].sourceSlotId,'source-wed-late');
});
test.after(async()=>{await new Promise(r=>setTimeout(r,30));dom.window.close();});

// Adapter contracts exercise the same builder used by the rendered editor.
import {placementScheduleRows,placementClassFormDefaults,buildPlacementRowsEdit} from '../src/features/academic/timetable-class-form.ts';
import {placementFormDefaults,pendingPlacementDraft,blankPlanItem,placementEdit} from '../src/features/academic/timetable-plan-interaction.ts';
function draftFor(scope='item',extra={}){return {item:structuredClone(item),slots:structuredClone(slots),scope,...extra};}
test('row adapter keeps default resources when editing one differing sibling slot',()=>{
 const draft=draftFor('slot',{slotId:'wed'});const values=placementFormDefaults(draft);const rows=placementScheduleRows(draft);rows[0].endTime='20:13';
 const edit=buildPlacementRowsEdit(draft,values,rows);
 assert.equal(edit.item.defaultTeacherId,item.defaultTeacherId);assert.equal(edit.item.defaultClassroomId,item.defaultClassroomId);assert.deepEqual(edit.slots[0],slots[0]);assert.deepEqual(edit.slots[2],slots[2]);assert.equal(edit.slots[1].sourceSlotId,slots[1].sourceSlotId);
});
test('row adapter adds a target placement without rewriting existing default resources or siblings',()=>{
 const draft=draftFor('add',{target:{weekday:5,startMinute:1033,teacherId:'teacher-b',classroomId:'room-b'}});const rows=placementScheduleRows(draft);rows[0].endTime='24:00';const edit=buildPlacementRowsEdit(draft,placementFormDefaults(draft),rows);
 assert.equal(edit.item.defaultTeacherId,item.defaultTeacherId);assert.equal(edit.item.defaultClassroomId,item.defaultClassroomId);assert.deepEqual(edit.slots.slice(0,3),slots);assert.equal(edit.slots[3].teacherId,'teacher-b');assert.equal(edit.slots[3].endMinute,1440);assert.equal(edit.slots[3].sourceSlotId,null);
});
for(const [capacity,tuition] of [[null,null],[0,0],[17,325000]])test(`unplaced metadata preserves explicit resources, capacity ${capacity}, tuition ${tuition}`,()=>{
 const draft=draftFor('item',{item:{...item,capacity,tuition,defaultTeacherId:'teacher-b',defaultClassroomId:'room-b'},slots:[]});const edit=buildPlacementRowsEdit(draft,placementFormDefaults(draft),[]);assert.equal(edit.item.capacity,capacity);assert.equal(edit.item.tuition,tuition);assert.equal(edit.item.defaultTeacherId,'teacher-b');assert.equal(edit.item.defaultClassroomId,'room-b');assert.deepEqual(edit.slots,[]);
});
test('pending resolution consumes only its exact pending identity after a valid addition',()=>{
 const first={id:'pending-a',sourceText:'합성',reason:'invalid_time',weekday:5,startMinute:1033,endMinute:1093,teacherId:'teacher-b',classroomId:'room-b'};const other={...first,id:'pending-b'};const original={...item,pendingSlots:[first,other]};const draft=pendingPlacementDraft(original,slots,'pending-a');const rows=placementScheduleRows(draft);const edit=buildPlacementRowsEdit(draft,placementFormDefaults(draft),rows);assert.deepEqual(edit.item.pendingSlots,[other]);assert.deepEqual(edit.slots.slice(0,3),slots);assert.deepEqual(original.pendingSlots,[first,other]);
 assert.throws(()=>buildPlacementRowsEdit(draft,placementFormDefaults(draft),[]),/미배치/);
});
test('row adapter preserves empty defaults and source labels on unchanged rows, updates only an explicit resource ID',()=>{
 const draft=draftFor('item',{item:{...item,defaultTeacherId:null,defaultClassroomId:null},slots:slots.map(slot=>({...slot,teacherName:'동명이인',classroomName:'기존 방'}))});const before=structuredClone(draft);const rows=placementScheduleRows(draft);rows[1].teacher='teacher-a';const edit=buildPlacementRowsEdit(draft,placementFormDefaults(draft),rows);assert.equal(edit.item.defaultTeacherId,null);assert.equal(edit.item.defaultClassroomId,null);assert.deepEqual(edit.slots[0],draft.slots[0]);assert.equal(edit.slots[1].teacherId,'teacher-a');assert.equal(edit.slots[1].teacherName,undefined);assert.equal(edit.slots[1].classroomName,'기존 방');assert.deepEqual(draft,before);
});
test('invalid times, duplicate identities and borrowed sibling IDs are rejected before an edit can replace original data',()=>{
 const draft=draftFor();const values=placementFormDefaults(draft);const before=structuredClone(draft);for(const patch of [{startTime:'24:00'},{endTime:'24:01'},{day:''},{teacher:''}]){const rows=placementScheduleRows(draft);Object.assign(rows[0],patch);assert.throws(()=>buildPlacementRowsEdit(draft,values,rows));assert.deepEqual(draft,before);}
 const rows=placementScheduleRows(draft);rows[1].key=rows[0].key;assert.throws(()=>buildPlacementRowsEdit(draft,values,rows),/식별|시간표 행/);
 const single=draftFor('slot',{slotId:'mon'});const selected=placementScheduleRows(single);selected[0].key='wed';assert.throws(()=>buildPlacementRowsEdit(single,placementFormDefaults(single),selected),/식별/);
});
test('one whole editor applies independent changes to two differing rows in a single local command',async t=>{
 const ui=await mount(t);await ui.edit('수업시간 1 시작시각','17:17');await ui.edit('수업시간 2 종료시각','20:13');await ui.save();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].slots[0].startMinute,1037);assert.equal(ui.calls[0].slots[1].endMinute,1213);assert.deepEqual(ui.calls[0].slots[2],slots[2]);
});

test('removing all rows preserves null default resources until the user explicitly changes unplaced defaults',()=>{
 const draft=draftFor('item',{item:{...item,defaultTeacherId:null,defaultClassroomId:null}});const values=placementClassFormDefaults(draft);assert.equal(values.teacher,'');const edit=buildPlacementRowsEdit(draft,values,[]);assert.equal(edit.item.defaultTeacherId,null);assert.equal(edit.item.defaultClassroomId,null);assert.deepEqual(edit.slots,[]);const changed=buildPlacementRowsEdit(draft,{...values,teacher:'teacher-b',room:'room-b'},[]);assert.equal(changed.item.defaultTeacherId,'teacher-b');assert.equal(changed.item.defaultClassroomId,'room-b');
});

async function choose(ui,trigger,label,index=0){await ui.flush(()=>trigger.click());const matches=[...document.querySelectorAll('[role="option"]')].filter(option=>option.textContent===label);assert.ok(matches[index],label);await ui.flush(()=>matches[index].click());}
test('actual rows preserve opaque same-name resource identities and deletion restores focus',async t=>{
 const ui=await mount(t);await choose(ui,ui.container.querySelector('[aria-label="수업시간 1 선생님"]'),'동명이인',1);await ui.save();assert.equal(ui.calls[0].slots[0].teacherId,'teacher-b');assert.equal(ui.calls[0].slots[1].teacherId,'teacher-b');
 const rows=ui.container.querySelectorAll('[data-testid="class-schedule-slot-row"]');await ui.flush(()=>rows[1].querySelector('button[aria-label="시간표 행 삭제"]').click());await ui.flush(()=>{});await new Promise(r=>setTimeout(r,20));assert.equal(document.activeElement.getAttribute('aria-label'),'수업시간 2 요일');assert.equal(ui.input('수업시간 2 종료시각').value,'24:00');
});
test('a retry response never erases later per-row draft edits',async t=>{
 let retried=0;const dirty=[];const ui=await mount(t,{fail:true,onDirty:value=>dirty.push(value),onRetry:async()=>{retried++;}});await ui.edit('수업시간 2 종료시각','20:13');assert.equal(dirty.at(-1),true);await ui.save();await ui.rerender({failureKind:'uncertain'});await ui.edit('수업시간 1 시작시각','17:17');const retry=[...ui.container.querySelectorAll('button')].find(button=>button.textContent==='원래 요청 재시도');await ui.flush(()=>retry.click());assert.equal(retried,1);assert.equal(ui.closes,0);assert.equal(ui.input('수업시간 1 시작시각').value,'17:17');assert.equal(ui.input('수업시간 2 종료시각').value,'20:13');assert.equal(dirty.at(-1),true);
});
test('recommendation never substitutes a hidden default for an explicitly cleared row resource',async t=>{
 const ui=await mount(t,{draft:draftFor('slot',{slotId:'wed'})});await choose(ui,ui.container.querySelector('[aria-label="수업시간 1 선생님"]'),'선택 안 함');await ui.flush(()=>[...ui.container.querySelectorAll('button')].find(button=>button.textContent==='빈 시간 추천').click());const suggestions=[...ui.container.querySelectorAll('[role="status"] button')];assert.equal(suggestions.length,0,'no recommendation may use the hidden default resource');assert.equal(ui.calls.length,0);assert.equal(ui.container.querySelector('[aria-label="수업시간 1 선생님"]').textContent,'선택 안 함');
});
test('unplaced actual form preserves hidden defaults, exact zero, blank null and explicit clearing',async t=>{
 const draft=draftFor('item',{item:{...item,capacity:0,tuition:null,defaultTeacherId:'retired-teacher',defaultClassroomId:null},slots:[]});const ui=await mount(t,{draft});const teacherLabel=[...ui.container.querySelectorAll('label')].find(label=>label.textContent==='기본 선생님');const trigger=document.getElementById(teacherLabel.htmlFor);assert.match(trigger.textContent,/기존 기본 선생님/);const feeLabel=[...ui.container.querySelectorAll('label')].find(label=>label.textContent==='수업료');assert.equal(document.getElementById(feeLabel.htmlFor).value,'');await choose(ui,trigger,'미정');await ui.save();assert.equal(ui.calls[0].item.defaultTeacherId,null);assert.equal(ui.calls[0].item.defaultClassroomId,null);assert.equal(ui.calls[0].item.capacity,0);assert.equal(ui.calls[0].item.tuition,null);
});
import {createTimetablePlanController} from '../src/features/academic/timetable-plan-model.ts';
test('actual UI rows stage without a write then use one immutable versioned manual batch',async t=>{
 const ids=Array.from({length:8},(_,i)=>`14000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);const planItem={...item,id:ids[0],planId:ids[1],defaultTeacherId:ids[5],defaultClassroomId:ids[6],sourceClassId:null,appliedClassId:null,appliedAt:null,appliedTransferId:null};const actualSlots=slots.map((row,i)=>({...row,id:ids[i+2],planId:ids[1],itemId:ids[0],teacherId:ids[5],classroomId:ids[6],sourceSlotId:i===1?ids[7]:null}));
 const actual={...snapshot,plan:{id:ids[1],name:'合成',state:'draft',metaRevision:3,changeSequence:7,targetStartDate:null,targetEndDate:null},items:[planItem],slots:actualSlots,catalogs:{teachers:[{id:ids[5],name:'동명이인',isVisible:true,subjects:['영어팀']}],classrooms:[{id:ids[6],name:'1강',isVisible:true,subjects:[]}]},permissions:{canManage:true,canEdit:true,canTransfer:true},capacity:{itemCount:1,slotCount:3,maxItems:500,maxSlots:2000,exceeded:false},members:[],complete:true,shadowFingerprint:'synthetic',shadowClasses:[],unresolvedOccupancies:[],asOfDate:'2026-10-22',datedSessions:[],datedUnresolvedOccupancies:[],datedFingerprint:'synthetic-dated',datedComplete:true,occupancyValidationVersion:2};const batches=[];let resolve;const service={readPlan:async()=>structuredClone(actual),saveBatch:command=>{batches.push(structuredClone(command));return new Promise(done=>{resolve=done;});}};const values=new Map();const controller=createTimetablePlanController({service,actorScope:'synthetic-014',planId:ids[1],autoSave:false,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});t.after(()=>controller.destroy());await controller.load();
 const ui=await mount(t,{draft:{item:planItem,slots:actualSlots,scope:'item'},snapshot:actual,onSave:edit=>controller.dispatch(edit)});await ui.edit('수업시간 2 종료시각','20:13');await ui.save();assert.equal(batches.length,0);assert.equal(controller.snapshot().dirty,true);const saving=controller.saveDraft();assert.equal(controller.saveDraft(),saving);await new Promise(r=>setImmediate(r));assert.equal(batches.length,1);const command=batches[0];assert.equal(command.expectedMetaRevision,3);assert.equal(command.expectedChangeSequence,7);assert.equal(command.edits[0].expectedItemRevision,1);assert.deepEqual(command.edits[0].slots.map(row=>row.id),actualSlots.map(row=>row.id));assert.equal(command.edits[0].slots[1].sourceSlotId,ids[7]);assert.equal(command.edits[0].slots[1].endMinute,1213);assert.equal(command.edits[0].item.tuition,325000);const next=structuredClone(actual);next.plan.changeSequence=8;next.items=[{...planItem,...command.edits[0].item,revision:2}];next.slots=command.edits[0].slots;resolve({planId:ids[1],requestKey:command.requestKey,committedMetaRevision:3,committedChangeSequence:8,acknowledgements:[{itemId:ids[0],operation:'save',itemRevision:2}],snapshot:next});await saving;assert.equal(controller.snapshot().dirty,false);assert.equal(controller.snapshot().snapshot.slots[1].endMinute,1213);
});

test('new grid-created item seeds its first selected resources for the next drag without changing existing defaults',async t=>{
 const fresh={...blankPlanItem(item.planId,'10000000-0000-4000-8000-000000000099'),name:'새 합성 수업'};const draft={item:fresh,slots:[],target:{weekday:1,startMinute:1033,teacherId:'teacher-a'}};const ui=await mount(t,{draft,snapshot:{...snapshot,items:[],slots:[]}});await choose(ui,ui.container.querySelector('[aria-label="수업시간 1 강의실"]'),'2강');await ui.save();assert.equal(ui.calls.length,1);const got=ui.calls[0];assert.equal(got.item.defaultTeacherId,'teacher-a');assert.equal(got.item.defaultClassroomId,'room-b');assert.equal(got.slots[0].teacherId,'teacher-a');assert.equal(got.slots[0].classroomId,'room-b');const next=placementEdit({items:[{...got.item,state:'draft'}],slots:got.slots},{kind:'drop',itemId:got.item.id,slotId:'second-slot',target:{view:'teacher-weekly',panelKey:'teacher-a',columnKey:'2',visibleStartMinute:540,rowPosition:16,slotMinutes:30}});assert.equal(next.slots.length,2);assert.equal(next.slots[1].classroomId,'room-b');
});
