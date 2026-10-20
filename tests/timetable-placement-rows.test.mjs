import test from 'node:test';
import assert from 'node:assert/strict';
import { placementRowsDefaults, buildPlacementRowsEdit } from '../src/features/academic/timetable-plan-interaction.ts';

const item = { id: 'i', planId: 'p', name: '수업', subject: '영어', subjectAreaKey: null, grade: '중1', capacity: 17, tuition: 325000, durationMinutes: 90, defaultTeacherId: 'default-t', defaultClassroomId: 'default-r', pendingSlots: [] };
const slots = [
  { id: 's1', itemId: 'i', planId: 'p', sourceSlotId: 'origin1', weekday: 1, startMinute: 1033, endMinute: 1123, teacherId: 't1', classroomId: 'r1' },
  { id: 's2', itemId: 'i', planId: 'p', sourceSlotId: 'origin2', weekday: 3, startMinute: 1147, endMinute: 1237, teacherId: 't2', classroomId: 'r2' },
  { id: 's3', itemId: 'i', planId: 'p', sourceSlotId: 'origin3', weekday: 5, startMinute: 1393, endMinute: 1440, teacherId: 't1', classroomId: 'r2' },
];
const draft = { item, slots, scope: 'item' };
test('metadata-only round trip preserves every slot identity, provenance, resource and exact amount/minutes', () => {
  const values = placementRowsDefaults(draft);
  assert.deepEqual(values.rows.map(row => [row.day,row.start,row.end,row.teacher,row.room]), [['월','17:13','18:43','t1','r1'],['수','19:07','20:37','t2','r2'],['금','23:13','24:00','t1','r2']]);
  const edit = buildPlacementRowsEdit(draft, {...values,name:'새 이름'});
  assert.deepEqual(edit.slots, slots);
  assert.equal(edit.item.tuition, 325000);
  assert.equal(edit.item.defaultTeacherId, 'default-t');
});
test('middle edit and middle deletion preserve siblings rather than cloning first row', () => {
  const values = placementRowsDefaults(draft);
  values.rows[1] = {...values.rows[1],start:'19:13',teacher:'t3'};
  const edit = buildPlacementRowsEdit(draft,values);
  assert.deepEqual(edit.slots[0],slots[0]); assert.deepEqual(edit.slots[2],slots[2]);
  assert.deepEqual(edit.slots[1],{...slots[1],startMinute:1153,teacherId:'t3'});
  assert.deepEqual(buildPlacementRowsEdit(draft,{...values,rows:values.rows.filter((_,index)=>index!==1)}).slots,[slots[0],slots[2]]);
});
test('single-slot form only changes selected row and keeps full sibling set',()=>{
  const single={...draft,scope:'slot',slotId:'s2'},values=placementRowsDefaults(single);
  assert.equal(values.rows.length,1); values.rows[0].day='목';
  const edit=buildPlacementRowsEdit(single,values);
  assert.deepEqual(edit.slots.filter(slot=>slot.id!=='s2'),[slots[0],slots[2]]);
  assert.deepEqual(edit.slots.find(slot=>slot.id==='s2'),{...slots[1],weekday:4});
});
test('added row keeps existing slots, obtains its own ID and never inherits provenance',()=>{
  const add={...draft,scope:'add',target:{weekday:2,startMinute:600}},values=placementRowsDefaults(add);
  values.rows[0].teacher='t2'; values.rows[0].room='r1';
  const edit=buildPlacementRowsEdit(add,values);
  assert.deepEqual(edit.slots.slice(0,3),slots); assert.equal(edit.slots[3].id,values.rows[0].key); assert.equal(edit.slots[3].sourceSlotId,null);
});
test('0 and empty remain distinct; out-of-grid minute values round trip',()=>{
  const values=placementRowsDefaults({...draft,item:{...item,capacity:0,tuition:null}});
  assert.equal(values.capacity,'0'); assert.equal(values.tuition,'');
  values.rows[0].start='01:13';values.rows[0].end='02:14';
  const edit=buildPlacementRowsEdit(draft,values);
  assert.equal(edit.item.capacity,0);assert.equal(edit.item.tuition,null);assert.equal(edit.slots[0].startMinute,73);assert.equal(edit.slots[0].endMinute,134);
});
test('unplaced class retains newly selected defaults without manufacturing a placement',()=>{
  for (const defaultTeacherId of [null, 'old-teacher']) {
    const source={...draft,slots:[],item:{...item,defaultTeacherId}};
    const values=placementRowsDefaults(source);
    values.rows[0]={...values.rows[0],teacher:'new-teacher',room:'new-room'};
    const edit=buildPlacementRowsEdit(source,values);
    assert.equal(edit.slots.length,0);assert.equal(edit.item.defaultTeacherId,'new-teacher');assert.equal(edit.item.defaultClassroomId,'new-room');
  }
});
test('invalid day/time/resource and duplicate identity are rejected without dropping existing rows',()=>{
  for(const patch of [{day:''},{start:'24:00'},{end:'24:01'},{end:'17:13'},{teacher:''},{room:''}]) {
    const values=placementRowsDefaults(draft); values.rows[0]={...values.rows[0],...patch};
    assert.throws(()=>buildPlacementRowsEdit(draft,values));
  }
  const values=placementRowsDefaults(draft); values.rows.push(values.rows[0]);
  assert.throws(()=>buildPlacementRowsEdit(draft,values),/중복/);
});
test('same-day independent rows and missing UUIDs retain their distinct identities',()=>{
  const source={...draft,slots:[slots[0],{...slots[1],weekday:1,teacherId:'missing-teacher',classroomId:'hidden-room'}]};
  assert.deepEqual(buildPlacementRowsEdit(source,placementRowsDefaults(source)).slots,source.slots);
});
test('pending resolution requires a concrete row and removes only the selected pending item',()=>{
  const source={...draft,scope:'add',pendingResolutionId:'pending',item:{...item,pendingSlots:[{id:'pending'},{id:'keep'}]}};
  const values=placementRowsDefaults(source);
  assert.throws(()=>buildPlacementRowsEdit(source,values),/미배치/);
  values.rows[0]={...values.rows[0],day:'토',teacher:'t1',room:'r1'};
  const edit=buildPlacementRowsEdit(source,values); assert.deepEqual(edit.item.pendingSlots,[{id:'keep'}]);assert.deepEqual(edit.slots.slice(0,3),slots);
});
