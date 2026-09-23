import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPanels, placementEdit, parsePlanTime, formatPlanTime, layoutOverlapLanes, createPointerSession, finishPointerSession } from '../src/features/academic/timetable-plan-interaction.ts';
const views=['teacher-weekly','classroom-weekly','daily-teacher','daily-classroom'];
const item={id:'i',planId:'p',revision:1,name:'새 수업',subject:'영어',subjectAreaKey:null,grade:'',capacity:null,tuition:null,defaultTeacherId:'t',defaultClassroomId:'r',durationMinutes:60,pendingSlots:[],state:'draft'};
const mon={id:'mon',itemId:'i',planId:'p',weekday:1,startMinute:1033,endMinute:1093,teacherId:'t',classroomId:'r',sourceSlotId:null};
const wed={...mon,id:'wed',weekday:3};
const shadow={...mon,id:'shadow',classId:'c',weekday:2,classRevision:1};
const snapshot={plan:{id:'p',state:'draft'},items:[item],slots:[mon,wed],shadowSlots:[shadow],shadowClasses:[{id:'c',name:'기존',subject:'영어'}],catalogs:{teachers:[{id:'t',name:'김',isVisible:true},{id:'t2',name:'김',isVisible:true}],classrooms:[{id:'r',name:'본1',isVisible:true},{id:'r2',name:'본2',isVisible:true}]}};
const target=(view,other=false)=>({view,panelKey:view.endsWith('weekly')?(view.startsWith('teacher')?(other?'t2':'t'):(other?'r2':'r')):'1',columnKey:view.endsWith('weekly')?'1':view==='daily-teacher'?(other?'t2':'t'):(other?'r2':'r'),visibleStartMinute:540,rowPosition:(1033-540)/30,slotMinutes:30});
for(const view of views){
 test(`${view}: move Monday alone across resource panel/column at identical time, preserve offset and all projections`,()=>{const edit=placementEdit(snapshot,{kind:'move',slotId:'mon',origin:target(view),target:target(view,true)});assert.equal(edit.operation,'save');assert.equal(edit.slots[0].startMinute,1033);assert.equal(edit.slots[0].endMinute,1093);assert.deepEqual(edit.slots[1],wed);assert.equal(edit.slots[0][view.includes('teacher')?'teacherId':'classroomId'],view.includes('teacher')?'t2':'r2');for(const v of views){const panels=buildPlanPanels({...snapshot,slots:edit.slots},v);assert.deepEqual(panels.flatMap(p=>p.blocks.map(b=>b.id)).sort(),['mon','shadow','wed']);}});
 test(`${view}: unplaced item drop creates one stable slot with target resource`,()=>{const edit=placementEdit({...snapshot,slots:[]},{kind:'drop',itemId:'i',target:target(view),slotId:'new'});assert.equal(edit.slots.length,1);assert.equal(edit.slots[0].id,'new');assert.equal(edit.slots[0].startMinute,1035);assert.equal(edit.slots[0].endMinute,1095);});
}
test('shadow never produces move, resize or unplace commands',()=>{for(const kind of ['move','resize','unplace'])assert.throws(()=>placementEdit(snapshot,{kind,slotId:'shadow',origin:target(views[0]),target:target(views[0]),endMinute:1100}),/기존 수업/);});
test('exact typed minutes and midnight preserved, invalid overflow rejected',()=>{assert.equal(parsePlanTime('17:13'),1033);assert.equal(parsePlanTime('24:00',true),1440);assert.equal(formatPlanTime(1440),'24:00');assert.throws(()=>parsePlanTime('24:00'));assert.throws(()=>parsePlanTime('24:01',true));assert.equal(placementEdit(snapshot,{kind:'resize',slotId:'mon',endMinute:1103}).slots[0].endMinute,1103);});
test('empty presets build panels from IDs, duplicate names do not merge; overlap lanes retain every slot',()=>{assert.equal(buildPlanPanels({...snapshot,slots:[],shadowSlots:[]},views[0]).length,2);const lanes=layoutOverlapLanes([{id:'a',startMinute:550,endMinute:600},{id:'b',startMinute:550,endMinute:620},{id:'c',startMinute:600,endMinute:650}]);assert.equal(lanes.length,3);assert.notEqual(lanes[0].lane,lanes[1].lane);assert.equal(lanes[0].lane,lanes[2].lane);});
test('pointer cancel, Escape and capture-loss cannot commit; source/target panel identity counts as a move',()=>{for(const reason of ['pointercancel','Escape','lostpointercapture']){const session=createPointerSession('mon',target(views[0]));session.target=target(views[0],true);assert.equal(finishPointerSession(session,reason),null);}assert.ok(finishPointerSession({...createPointerSession('mon',target(views[0])),target:target(views[0],true)},'pointerup'));assert.equal(finishPointerSession(createPointerSession('mon',target(views[0])),'pointerup'),null);});

// Real rendered grid interactions, with only the shared Button boundary simplified.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import * as interaction from '../src/features/academic/timetable-plan-interaction.ts';
const require=createRequire(import.meta.url);
const compiled=ts.transpileModule(await readFile(new URL('../src/features/academic/components/timetable-plan-grid.jsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:'grid.jsx'}).outputText;
const runtime={exports:{}};
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(key=>key==='../timetable-plan-interaction.ts'?interaction:key==='@/components/ui/button'?{Button:({children,...props})=>{delete props.variant;delete props.size;return createElement('button',props,children);}}:require(key),runtime,runtime.exports);
for(const view of views)test(`${view}: rendered empty-cell and drag-handle actions expose canonical coordinates, shadows have no handles`,async()=>{
 const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});const previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const container=document.getElementById('root'),root=createRoot(container);const panel=buildPlanPanels(snapshot,view).find(p=>p.blocks.some(b=>b.id==='mon'));const actions=[];
 try{await act(async()=>root.render(createElement(runtime.exports.TimetablePlanGrid,{panel,view,visibleStartMinute:540,visibleEndMinute:1440,layout:{slotHeight:32,timeColumnWidth:76,minColumnWidth:0,fitColumns:true,density:'compact'},editable:true,onCell:t=>actions.push(t),onOpen:()=>{},onPointerStart:(e,s)=>actions.push(s),BlockComponent:({block})=>createElement('button',{'data-title':block.title},block.title)})));
 const cell=container.querySelector('.timetable-cell');await act(async()=>cell.click());assert.equal(actions[0].view,view);assert.equal(actions[0].panelKey,panel.id);assert.equal(actions[0].visibleStartMinute,540);assert.equal(actions[0].slotMinutes,30);
 const mon=container.querySelector('[data-plan-slot="mon"]');assert.ok(mon);assert.equal(parseFloat(mon.style.top),(1033-540)/30*32);
 const move=mon.querySelector('[data-plan-handle]');assert.ok(move);await act(async()=>move.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true,button:0})));assert.equal(actions.at(-1).slotId,'mon');assert.equal(actions.at(-1).kind,'move');
 for(const shadow of container.querySelectorAll('[data-shadow]'))assert.equal(shadow.querySelectorAll('[data-plan-handle]').length,0);
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}
});
test('hidden operating subjects still block changed placements, while name-only edits preserve existing conflicts',()=>{const complete={...snapshot,complete:true,datedComplete:true,datedSessions:[],datedUnresolvedOccupancies:[],plan:{...snapshot.plan,targetStartDate:null,targetEndDate:null}};const overlap={...mon,weekday:2};assert.throws(()=>interaction.validatePlacementEdit(complete,{operation:'save',item,slots:[overlap,wed]}),/기존.*겹칩니다/);const existing={...complete,slots:[overlap,wed]};assert.doesNotThrow(()=>interaction.validatePlacementEdit(existing,{operation:'save',item:{...item,name:'새 이름'},slots:[overlap,wed]}));});

test('empty resource catalogs produce no misleading day grids in any view',()=>{for(const view of views)assert.deepEqual(buildPlanPanels({...snapshot,slots:[],shadowSlots:[],catalogs:{teachers:[],classrooms:[]}},view),[]);});

test('rendered class-list selection uses item IDs, preserves hidden selections and excludes applied/shadows',async()=>{
 const dom=new JSDOM('<div id="root"></div>');const previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const source=await readFile(new URL('../src/features/academic/timetable-plan-class-list.tsx',import.meta.url),'utf8');const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:'list.tsx'}).outputText;const listModule={exports:{}};
 const box=({children})=>createElement('div',null,children);const mocks={'./timetable-plan-interaction':interaction,'@/components/ui/button':{Button:({children,onClick,...props})=>createElement('button',{onClick,'aria-label':props['aria-label']},children)},'@/components/ui/input':{Input:props=>createElement('input',props)},'@/components/ui/checkbox':{Checkbox:({checked,onCheckedChange,...props})=>createElement('input',{type:'checkbox',checked,'aria-label':props['aria-label'],readOnly:true,onClick:()=>onCheckedChange(!checked)})},'@/components/ui/select':Object.fromEntries(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue'].map(name=>[name,box]))};vm.runInThisContext(`(function(require,module,exports){${output}\n})`)(key=>mocks[key]||require(key),listModule,listModule.exports);
 let selected=['hidden'];const base={...snapshot,items:[item,{...item,id:'hidden',name:'숨긴 수학'},{...item,id:'applied',name:'반영 이력',state:'applied'}],appliedSnapshots:[]};const root=createRoot(document.getElementById('root'));const render=async(filter='all')=>act(async()=>root.render(createElement(listModule.exports.TimetablePlanClassList,{snapshot:base,search:filter==='all'?'새':'',setSearch(){},listFilter:filter,setListFilter(){},selectedItemIds:selected,setSelectedItemIds:update=>{selected=update(selected);},activeItemId:null,canEdit:true,onActivate(){},onEdit(){},onDelete(){},onDrag(){},suppressClick:()=>false})));
 try{await render();const checks=document.querySelectorAll('input[type=checkbox]');assert.equal(checks.length,2,'one class item with two slots has one selectable identity plus scope control');await act(async()=>checks[0].click());assert.deepEqual(selected,['hidden','i']);await render();await act(async()=>document.querySelector('input[type=checkbox]').click());assert.deepEqual(selected,['hidden']);await render('applied');assert.equal(document.querySelectorAll('input[type=checkbox]').length,1,'applied rows and shadows have no item-selection control');}finally{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}
});

const variedWed = { ...wed, teacherId: 't2', classroomId: 'r2', startMinute: 1103, endMinute: 1193 };
const wholeDraft = { item, slots: [mon, variedWed], scope: 'item' };
test('whole-item weekdays replace Mon/Wed with Tue/Thu in one command while preserving per-slot differences and pending draft', () => {
 const draft = { ...wholeDraft, item: { ...item, pendingSlots: [{id:'pending',sourceText:'기존 초안',reason:'invalid_time'}] } };
 const values = interaction.placementFormDefaults(draft);
 assert.deepEqual(values.weekdays, [1,3]);
 const edit = interaction.buildPlacementFormEdit(draft, {...values, weekdays:[2,4], applyWeekdays:true});
 assert.equal(edit.operation,'save');assert.equal(edit.slots.length,2);
 assert.deepEqual(edit.slots,[{...mon,weekday:2},{...variedWed,weekday:4}]);
 assert.deepEqual(edit.item.pendingSlots,draft.item.pendingSlots);
});
test('whole teacher change is explicit and preserves differing slot times, lengths, rooms and IDs', () => {
 const values = interaction.placementFormDefaults(wholeDraft);
 assert.deepEqual(interaction.buildPlacementFormEdit(wholeDraft,{...values,name:'이름만'}).slots,wholeDraft.slots);
 const edit = interaction.buildPlacementFormEdit(wholeDraft,{...values,teacher:'t',applyTeacher:true});
 assert.deepEqual(edit.slots,[mon,{...variedWed,teacherId:'t'}]);assert.equal(edit.item.defaultTeacherId,'t');
 const removed = interaction.buildPlacementFormEdit(wholeDraft,{...values,weekdays:[],applyWeekdays:true});assert.deepEqual(removed.slots,[]);
});
test('single-slot form edit and add-placement preserve the complete differing Wednesday sibling', () => {
 const single = {...wholeDraft,scope:'slot',slotId:'mon'};
 const edit = interaction.buildPlacementFormEdit(single,{...interaction.placementFormDefaults(single),teacher:'t2',start:'09:10',end:'10:10'});
 assert.deepEqual(edit.slots.find(s=>s.id==='wed'),variedWed);assert.equal(edit.slots.find(s=>s.id==='mon').startMinute,550);
 const add = {...wholeDraft,scope:'add',target:{weekday:5,startMinute:1410,teacherId:'t',classroomId:'r'}};
 const placed = interaction.buildPlacementFormEdit(add,{...interaction.placementFormDefaults(add),end:'24:00'});
 assert.equal(placed.slots.length,3);assert.deepEqual(placed.slots.slice(0,2),wholeDraft.slots);assert.equal(placed.slots[2].endMinute,1440);
});
