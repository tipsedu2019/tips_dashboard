import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLegacyMakeupApprovalPlan as build } from '../src/features/makeup-requests/makeup-approval-plan.js';
import { applyMakeupRequestToSchedulePlan } from '../src/features/makeup-requests/makeup-request-model.js';
import { buildSchedulePlanForSave, normalizeSchedulePlan } from '../src/lib/class-schedule-planner.js';

const id = n => `aa041004-0000-4000-8000-${String(n).padStart(12,'0')}`;
const teacher = { id:id(1), name:'Requested teacher' };
const room = { id:id(2), name:'Requested room' };
const resources = { teacher, classrooms:[room] };
const request = { id:id(3),request_kind:'cancel_makeup',cancel_date:'2050-10-07',teacher_catalog_id:teacher.id,
  makeup_start_at:'2050-10-06T06:00:00Z',makeup_end_at:'2050-10-06T08:00:00Z',makeup_classroom:room.name };
const original = {id:'original',sessionKey:'original',date:request.cancel_date,scheduleState:'active',state:'active',isForced:false,
  originalDate:'',makeupDate:'',billingId:'oct',billingLabel:'10월',billingColor:'blue',sessionNumber:1,
  startTime:'18:00',endTime:'20:00',teacherCatalogId:id(9),classroomCatalogId:id(8),teacherNote:'Retain original exception',
  textbookEntries:[{textbookId:'book',actual:{start:8,end:10}}],progressStatus:'done'};
const history = {id:'old',date:'2020-01-01',scheduleState:'active',teacherNote:'unknown historical occupancy',extra:'retained'};
const plan = {subject:'영어',className:'Synthetic',selectedDays:[5],billingPeriods:[{id:'oct',month:10,label:'10월',startDate:'2050-10-01',endDate:'2050-10-31'}],sessions:[history,original],sessionStates:{},extension:{keep:true}};

test('baseline producer omits occupancy; fixed producer keeps all originals and uses request resources', () => {
  const old = applyMakeupRequestToSchedulePlan(plan,{subject:'영어',name:'Synthetic',schedule:'금 18:00-20:00'},request);
  const oldMakeup = old.sessions.find(s=>s.scheduleState==='makeup');
  assert.ok(oldMakeup); assert.equal(oldMakeup.startTime,undefined);
  const before=structuredClone(plan), result=build(plan,request,resources);
  assert.deepEqual(plan,before); assert.deepEqual(result.sessions[0],history);
  assert.equal(result.sessions[1].id,original.id); assert.deepEqual(result.sessions[1].textbookEntries,original.textbookEntries);
  assert.equal(result.sessions[1].teacherCatalogId,id(9)); assert.equal(result.sessions[1].teacherNote,original.teacherNote);
  const created=result.sessions[2]; assert.equal(created.teacherCatalogId,teacher.id); assert.equal(created.classroomCatalogId,room.id);
  assert.equal(created.startTime,'15:00'); assert.equal(created.endTime,'17:00'); assert.deepEqual(created.textbookEntries,[]);
  assert.equal(created.billingId,original.billingId); assert.equal(created.progressStatus,'pending');
  assert.deepEqual(result.extension,plan.extension);
});

test('multiple same-day and different-day makeups survive normalize, another-date edit, and save', () => {
  const multi={...request,makeup_slots:[
    {startAt:'2050-10-06T10:00:00+09:00',endAt:'2050-10-06T11:00:00+09:00',classroom:room.name},
    {startAt:'2050-10-06T12:00:00+09:00',endAt:'2050-10-06T13:00:00+09:00',classroom:room.name},
    {startAt:'2050-10-08T12:00:00+09:00',endAt:'2050-10-08T13:00:00+09:00',classroom:room.name},
  ]};
  const next=build(plan,multi,resources), owned=next.sessions.filter(s=>s.makeupRequestId);
  assert.equal(owned[0].makeupRequestRole,'cancel');
  assert.equal(owned.length,4); assert.equal(new Set(owned.map(s=>s.id)).size,4);
  const normalized=normalizeSchedulePlan(next);
  normalized.sessionStates['2050-10-14']={state:'skipped',memo:'another edit'};
  const saved=buildSchedulePlanForSave(normalized);
  assert.deepEqual(saved.sessions.filter(s=>s.makeupRequestId).sort((a,b)=>a.id.localeCompare(b.id)),[...owned].sort((a,b)=>a.id.localeCompare(b.id)));
  const reloaded=buildSchedulePlanForSave(saved);
  assert.deepEqual(reloaded.billingPeriods,saved.billingPeriods);
  assert.equal(saved.billingPeriods[0].totalSessions,saved.sessions.filter(s=>s.billingId==='oct' && ['active','makeup'].includes(s.scheduleState)).length);
  const second=build(next,{...request,id:id(4),request_kind:'makeup_only',makeup_start_at:'2050-10-20T06:00:00Z',makeup_end_at:'2050-10-20T08:00:00Z'},resources);
  assert.deepEqual(second.sessions.slice(0,next.sessions.length),next.sessions);
  assert.deepEqual(buildSchedulePlanForSave(second).sessions.filter(s=>s.makeupRequestId===request.id).sort((a,b)=>a.id.localeCompare(b.id)),[...owned].sort((a,b)=>a.id.localeCompare(b.id)));
});

test('outside-billing cancellation and makeup are retained without borrowing unrelated lesson content', () => {
  const next=build(plan,{...request,cancel_date:'2051-01-06',makeup_start_at:'2051-01-05T06:00:00Z',makeup_end_at:'2051-01-05T08:00:00Z'},resources);
  assert.deepEqual(next.sessions.slice(0,2),plan.sessions);
  const owned=next.sessions.filter(s=>s.makeupRequestId);
  assert.equal(owned.length,2);
  assert.equal(owned[1].billingId,undefined);
  assert.deepEqual(buildSchedulePlanForSave(next).sessions.filter(s=>s.makeupRequestId).sort((a,b)=>a.id.localeCompare(b.id)),[...owned].sort((a,b)=>a.id.localeCompare(b.id)));
});

test('cancel-only preserves existing content and needs no new resource lookup', () => {
  const result=build(plan,{...request,request_kind:'cancel_only'});
  assert.equal(result.sessions.length,2); assert.equal(result.sessions[1].scheduleState,'exception');
  assert.equal(result.sessions[1].classroomCatalogId,original.classroomCatalogId);
});

for (const [label, mutation, context] of [
  ['missing teacher',{},{}], ['wrong teacher',{}, {...resources,teacher:{...teacher,id:id(99)}}],
  ['missing room',{}, {...resources,classrooms:[]}], ['ambiguous room',{}, {...resources,classrooms:[room,{...room,id:id(10)}]}],
  ['partially malformed slots',{makeup_slots:[{startAt:request.makeup_start_at,endAt:request.makeup_end_at,classroom:room.name},{startAt:request.makeup_start_at}]},resources],
  ['seconds',{makeup_start_at:'2050-10-06T06:00:01Z'},resources],
  ['submillisecond precision',{makeup_start_at:'2050-10-06T06:00:00.000001Z'},resources],
  ['cross-day non-midnight',{makeup_end_at:'2050-10-07T08:00:00Z'},resources],
  ['same cancellation date',{makeup_start_at:'2050-10-07T06:00:00Z',makeup_end_at:'2050-10-07T08:00:00Z'},resources],
]) test(`fails closed for ${label}`,()=>assert.throws(()=>build(plan,{...request,...mutation},context),/makeup_approval_schedule_incomplete/));

test('ambiguous cancellation identity is rejected without changing either session',()=>{
  const input={...plan,sessions:[...plan.sessions,{...original,id:'second',sessionKey:'second'}]};
  assert.throws(()=>build(input,request,resources),/makeup_approval_schedule_incomplete/);
  assert.equal(input.sessions[1].scheduleState,'active');
});

test('next midnight is represented as 24:00 without changing the slot date',()=>{
  const result=build(plan,{...request,makeup_start_at:'2050-10-06T14:00:00Z',makeup_end_at:'2050-10-06T15:00:00Z'},resources);
  assert.equal(result.sessions.at(-1).endTime,'24:00'); assert.equal(result.sessions.at(-1).date,'2050-10-06');
});

test('unchanged history without identity does not block an otherwise unambiguous approval',()=>{
  const history={date:'2020-01-01',scheduleState:'active',teacherNote:'unchanged unknown'};
  const result=build({...plan,sessions:[history,original]},request,resources);
  assert.deepEqual(result.sessions[0],history);
});
