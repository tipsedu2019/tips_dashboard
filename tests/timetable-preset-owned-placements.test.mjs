import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPanels, validatePlacementEdit, placementEdit } from '../src/features/academic/timetable-plan-interaction.ts';
import { createTimetablePlanController } from '../src/features/academic/timetable-plan-model.ts';

const item = { id:'item', planId:'plan', revision:1, name:'초안', subject:'영어', subjectAreaKey:null, grade:'', capacity:null, tuition:null, defaultTeacherId:'teacher', defaultClassroomId:'room', durationMinutes:60, sourceClassId:null, state:'draft', appliedClassId:null, appliedTransferId:null, appliedAt:null, pendingSlots:[] };
const slot = { id:'slot', itemId:item.id, planId:item.planId, weekday:2, startMinute:600, endMinute:660, teacherId:'teacher', classroomId:'room', sourceSlotId:null };
const snapshot = { plan:{id:'plan',name:'편성안',state:'draft',metaRevision:0,changeSequence:0,targetStartDate:null,targetEndDate:null}, items:[item],slots:[],appliedSnapshots:[],members:[],permissions:{canManage:true,canEdit:true,canTransfer:true},capacity:{itemCount:1,slotCount:0,maxItems:500,maxSlots:2000,exceeded:false},catalogs:{teachers:[{id:'teacher',name:'강사',subjects:['영어'],isVisible:true}],classrooms:[{id:'room',name:'강의실',subjects:[],isVisible:true}]},occupancyValidationVersion:2,asOfDate:'2026-10-22',shadowSlots:[],shadowClasses:[],unresolvedOccupancies:[],shadowFingerprint:'catalog',datedSessions:[],datedUnresolvedOccupancies:[],datedFingerprint:'dated',datedComplete:true,complete:true };
const edit = {operation:'save',item,slots:[slot]};
const shadow = {id:'operating-slot',classId:'operating-class',sourceSlotId:null,weekday:2,startMinute:600,endMinute:660,teacherId:'teacher',classroomId:'room',classRevision:0};
const operating = {...snapshot, shadowSlots:[shadow],shadowClasses:[{id:shadow.classId,name:'운영 수업',subject:'영어'}]};
const appliedItem = {...item,id:'applied',name:'반영 기록',state:'applied',appliedClassId:'operating-class',appliedTransferId:'transfer',appliedAt:'2026-10-22T00:00:00Z'};
const appliedSlot = {...slot,id:'applied-slot',itemId:appliedItem.id};
const applied = {...snapshot,items:[item,appliedItem],appliedSnapshots:[{itemId:appliedItem.id,slots:[appliedSlot]}],capacity:{...snapshot.capacity,itemCount:2,slotCount:1}};

for (const [name, extra] of [
  ['teacher shadow',{shadowSlots:[{...shadow,classroomId:'other-room'}]}],
  ['room shadow',{shadowSlots:[{...shadow,teacherId:'other-teacher'}]}],
  ['unresolved operating row',{unresolvedOccupancies:[{classId:'operating-class',label:'미확정',scope:'all',resourceId:null,reason:'incomplete_read',weekday:2,startMinute:null,endMinute:null,teacherId:'teacher',classroomId:null,occupancyFingerprint:'unknown'}]}],
  ['dated operating occupancy',{plan:{...snapshot.plan,targetStartDate:'2026-10-01',targetEndDate:'2026-10-31'},datedSessions:[{...shadow,date:'2026-10-06',state:'active'}]}],
]) test(`preset placement ignores unrelated ${name}`,()=>assert.doesNotThrow(()=>validatePlacementEdit({...snapshot,...extra},edit)));

test('empty preset stays empty even on the old server contract with operating shadows',()=>{
  for(const view of ['teacher-weekly','classroom-weekly','daily-teacher','daily-classroom'])
    assert.deepEqual(buildPlanPanels(operating,view).flatMap(p=>p.blocks),[]);
});
test('all views project draft and applied IDs once, ignoring even linked operating changes',()=>{
  const source={...applied,slots:[{...slot,weekday:3}],shadowSlots:[{...shadow,startMinute:700,endMinute:800}],shadowClasses:operating.shadowClasses};
  const before=JSON.stringify(source);
  for(const view of ['teacher-weekly','classroom-weekly','daily-teacher','daily-classroom']) {
    const blocks=buildPlanPanels(source,view).flatMap(p=>p.blocks);
    assert.deepEqual(blocks.map(b=>b.id).sort(),['applied-slot','slot']);
    assert.equal(blocks.find(b=>b.id==='applied-slot').applied,true);
    assert.equal(blocks.find(b=>b.id==='applied-slot').startMinute,600);
    assert.equal(blocks.find(b=>b.id==='applied-slot').itemId,'applied');
    assert.equal(blocks.find(b=>b.id==='slot').applied,false);
  }
  assert.equal(JSON.stringify(source),before);
  assert.throws(()=>placementEdit(source,{kind:'resize',slotId:'applied-slot',endMinute:700}));
});
test('own applied and draft collisions remain blocked; adjacency and unchanged repair remain valid',()=>{
  assert.throws(()=>validatePlacementEdit(applied,edit),/반영 기록/);
  assert.throws(()=>validatePlacementEdit({...snapshot,items:[item,{...item,id:'other',name:'다른 초안'}],slots:[{...slot,id:'other-slot',itemId:'other'}]},edit),/다른 초안/);
  assert.doesNotThrow(()=>validatePlacementEdit(applied,{...edit,slots:[{...slot,startMinute:660,endMinute:720}]}));
  assert.doesNotThrow(()=>validatePlacementEdit({...applied,slots:[slot]},{...edit,item:{...item,name:'이름 보완'}}));
});
test('manual local draft compares applied records while remaining independent of operating completeness',async()=>{
  const controller=createTimetablePlanController({actorScope:'synthetic',planId:'plan',autoSave:false,storage:null,service:{readPlan:async()=>structuredClone({...applied,...operating,items:applied.items,appliedSnapshots:applied.appliedSnapshots,complete:false}),saveItem:async()=>{throw Error('unexpected write');}}});
  try {await controller.load();await controller.dispatch(edit);assert.equal(controller.snapshot().dirty,true);assert.ok(controller.snapshot().conflicts.some(c=>c.otherSlotId==='applied-slot'||c.slotId==='applied-slot'));assert.equal(controller.snapshot().saveState,'draft');}
  finally {controller.destroy();}
});

test('placement editor recommends against own applied and sibling placements, never operating shadows',async()=>{
  const {JSDOM}=await import('jsdom');
  const {createElement,act}=await import('react');
  const {createRoot}=await import('react-dom/client');
  const {loadNotificationComponent}=await import('./helpers/notification-component-loader.mjs');
  const dom=new JSDOM('<div id="root"></div>');
  const previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const values={name:item.name,subject:'영어',grade:'',teacher:'teacher',room:'room',duration:'60',start:'10:00',end:'12:00',weekdays:[2],capacity:'',tuition:''};
  const form={getValues:key=>key?values[key]:values,watch:key=>values[key],formState:{isDirty:false},control:{},reset(){},handleSubmit:fn=>()=>fn(values)};
  const box=({children})=>createElement('div',null,children);
  const button=({children,onClick,type,disabled})=>createElement('button',{onClick,type,disabled},children);
  const mocks=new Map([
    ['react-hook-form',{useForm:()=>form}],
    ['@/components/ui/button',{Button:button}],
    ['@/components/ui/input',{Input:()=>null}],['@/components/ui/label',{Label:box}],['@/components/ui/checkbox',{Checkbox:()=>null}],
    ['@/components/ui/form',Object.fromEntries(['Form','FormControl','FormField','FormItem','FormLabel','FormMessage'].map(k=>[k,k==='FormField'?()=>null:box]))],
    ['@/components/ui/select',Object.fromEntries(['Select','SelectContent','SelectItem','SelectTrigger','SelectValue'].map(k=>[k,box]))],
    ['@/components/ui/dialog',Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogFooter'].map(k=>[k,box]))],
  ]);
  const {TimetablePlacementEditor}=loadNotificationComponent('src/features/academic/timetable-placement-editor.tsx',mocks);
  const root=createRoot(document.getElementById('root'));
  try{
    for(const withSibling of [false,true]){
      const source={...applied,shadowSlots:[{...shadow,startMinute:660,endMinute:720}],slots:withSibling?[{...slot,id:'sibling',startMinute:660,endMinute:720}]:[]};
      await act(async()=>root.render(createElement(TimetablePlacementEditor,{key:String(withSibling),draft:{item,slots:source.slots,scope:'add'},snapshot:source,canEdit:true,failureKind:null,serverSummary:'',onDirty(){},onClose(){},onSave:async()=>{throw Error('unexpected save');}})));
      const recommend=[...document.querySelectorAll('button')].find(b=>b.textContent==='빈 시간 추천');
      assert.ok(recommend);await act(async()=>recommend.click());
      const status=document.querySelector('[role="status"]');assert.ok(status);
      if(withSibling)assert.match(status.textContent,/조건에 맞는 빈 시간이 없습니다/);
      else assert.equal(status.textContent,'화 11:00–12:00');
    }
  }finally{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}
});
