import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLegacyMakeupApprovalPlan as build } from '../src/features/makeup-requests/makeup-approval-plan.js';
import { buildRoomAvailability } from '../src/features/makeup-requests/makeup-request-model.js';
import { buildSchedulePlanForSave } from '../src/lib/class-schedule-planner.js';
import { effectiveInputForLesson, resolveEffectiveSchedule } from '../src/features/operations/legacy-effective-schedule.js';

export const id=n=>`af061100-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const teacher={id:id(1),name:'Synthetic teacher'},room={id:id(2),name:'Synthetic room'};
export const request={id:id(3),class_id:id(4),class_name:'Synthetic class',subject:'영어',status:'approval_pending',request_kind:'cancel_makeup',cancel_date:'2050-10-20',teacher_catalog_id:teacher.id,updated_at:'2050-09-30T00:00:00.123456+00:00',makeup_start_at:'2050-10-06T09:00:00Z',makeup_end_at:'2050-10-06T11:00:00Z',makeup_classroom:room.name};
export const original={id:'legacy-original-alpha',sessionKey:'legacy-original-alpha',date:request.cancel_date,state:'exception',scheduleState:'exception',makeupDate:'2050-10-06',teacherNote:'Synthetic original note',billingId:'synthetic-billing',textbookEntries:[{textbookId:'synthetic-book',actual:{start:2,end:4}}]};
export const makeup={id:'legacy-makeup-alpha',sessionKey:'legacy-makeup-alpha',date:'2050-10-06',state:'makeup',scheduleState:'makeup',originalDate:request.cancel_date,originalSessionId:original.id,memo:'Synthetic existing note',teacherNote:'Retained learning note',progressStatus:'done',billingId:'synthetic-billing',textbookEntries:[{textbookId:'synthetic-other-book',actual:{start:5,end:6}}]};
export const plan={sessions:[original,makeup],sessionStates:{[request.cancel_date]:{state:'exception',makeupDate:makeup.date}},extension:{keep:true}};
export const occupancy={id:`legacy-session:${request.class_id}:${makeup.id}`,classId:request.class_id,className:request.class_name,date:makeup.date,startMinute:1170,endMinute:1290,classroom:room.name,uncertain:false,allRooms:false};
export const binding={version:1,mode:'reuse',requestId:request.id,classId:request.class_id,requestUpdatedAt:request.updated_at,cancelDate:request.cancel_date,originalId:original.id,makeupId:makeup.id,startAt:'2050-10-06T09:00:00.000Z',endAt:'2050-10-06T11:00:00.000Z',classroom:room.name,occupancy};
const resources={teacher,classrooms:[room],legacyBinding:binding};
const slots=[{startAt:request.makeup_start_at,endAt:request.makeup_end_at,classroom:room.name}];

test('verified unique legacy pair is reused without duplicate rows or loss of content',()=>{
 const before=structuredClone(plan),after=build(plan,request,resources);
 assert.deepEqual(plan,before);assert.equal(after.sessions.length,2);
 assert.equal(after.sessions[0].id,original.id);assert.equal(after.sessions[1].id,makeup.id);
 for(const key of ['memo','teacherNote','progressStatus','billingId','textbookEntries'])assert.deepEqual(after.sessions[1][key],makeup[key]);
 assert.deepEqual(after.sessions[0].textbookEntries,original.textbookEntries);assert.deepEqual(after.sessionStates,plan.sessionStates);assert.deepEqual(after.extension,plan.extension);
 assert.equal(after.sessions[1].startTime,'18:00');assert.equal(after.sessions[1].endTime,'20:00');
 assert.deepEqual(after.sessions[1].makeupAdoption,{version:1,requestUpdatedAt:request.updated_at,originalId:original.id,makeupId:makeup.id});
});
test('shared collision model excludes only the proven existing occupancy',()=>{
 const other={...occupancy,id:'other-lesson',classId:id(9)};
 const sameClass={...occupancy,id:'same-class-another-lesson'};
 const check=rows=>buildRoomAvailability({classrooms:[room],requests:[request],slots,currentRequestId:request.id,currentRequest:request,legacyBindings:[binding],effectiveSchedule:{version:1,occupancies:rows}})[0];
 assert.equal(check([occupancy]).available,true);
 assert.deepEqual(check([occupancy,other,sameClass]).collisions.map(x=>x.id),[other.id,sameClass.id]);
});
test('adopted generic row survives the existing schedule normalizer and repeated save',()=>{
 const after=build(plan,request,resources),saved=buildSchedulePlanForSave(after);
 assert.deepEqual(saved.sessions.find(s=>s.id===makeup.id),after.sessions[1]);
 assert.equal(saved.sessions.filter(s=>s.makeupRequestId===request.id).length,2);
 assert.deepEqual(buildSchedulePlanForSave(saved).sessions.find(s=>s.id===makeup.id),after.sessions[1]);
});

for (const [name, mutate] of [
 ['missing proof',c=>{c.resources.legacyBinding=null}],
 ['stale microsecond generation',c=>{c.resources.legacyBinding.requestUpdatedAt='2050-09-30T00:00:00.123457+00:00'}],
 ['wrong request',c=>{c.resources.legacyBinding.requestId=id(50)}],
 ['wrong class',c=>{c.resources.legacyBinding.classId=id(50)}],
 ['wrong original ID',c=>{c.resources.legacyBinding.originalId='other-original'}],
 ['wrong original date',c=>{c.plan.sessions[1].originalDate='2050-10-21'}],
 ['wrong original linkage',c=>{c.plan.sessions[1].originalSessionId='other-original'}],
 ['wrong makeup date',c=>{c.plan.sessions[0].makeupDate='2050-10-07'}],
 ['duplicate original date',c=>{c.plan.sessions.push({...c.plan.sessions[0],id:'another-original',sessionKey:'another-original'})}],
 ['duplicate makeup date',c=>{c.plan.sessions.push({...c.plan.sessions[1],id:'another-makeup',sessionKey:'another-makeup'})}],
 ['duplicate identity on another date',c=>{c.plan.sessions.push({...c.plan.sessions[1],date:'2050-10-07'})}],
 ['foreign owner',c=>{c.plan.sessions[1].makeupRequestId=id(51)}],
 ['forged null adoption marker',c=>{c.plan.sessions[1].makeupAdoption=null}],
 ['contradictory states',c=>{c.plan.sessions[0].state='active'}],
 ['contradictory state map',c=>{c.plan.sessionStates[request.cancel_date].state='active'}],
 ['contradictory schedule map',c=>{c.plan.sessionSchedules={[makeup.date]:{originalSessionId:'wrong'}}}],
 ['malformed schedule map',c=>{c.plan.sessionSchedules=[]}],
 ['normalized original session',c=>{c.request.original_lesson_session_id=id(53)}],
 ['multiple makeup slots',c=>{c.request.makeup_slots=[slots[0],{...slots[0],startAt:'2050-10-07T09:00:00Z',endAt:'2050-10-07T11:00:00Z'}]}],
 ['slot edited after proof',c=>{c.request.makeup_start_at='2050-10-06T08:00:00Z'}],
 ['opposite original link',c=>{c.plan.sessions[0].originalDate='2050-09-01'}],
 ['opposite original session link',c=>{c.plan.sessions[0].originalSessionId='other-original'}],
 ['malformed raw slot',c=>{c.request.makeup_slots=[{startAt:request.makeup_start_at}]}],
 ['opposite makeup link',c=>{c.plan.sessions[1].makeupDate='2050-11-01'}],
 ['non-trimmed row identity',c=>{c.plan.sessions[1].id+=' '}],
 ['session key mismatch',c=>{c.plan.sessions[1].sessionKey='wrong'}],
]) test(`reuse fails closed: ${name}`,()=>{
 const c=structuredClone({plan,request,resources});mutate(c);
 assert.throws(()=>build(c.plan,c.request,c.resources),/makeup_approval_schedule_incomplete/);
});

test('proof is exact, stale/ambiguous/uncertain occupancy is never excluded',()=>{
 const check=(row,bindings=[binding],r=request)=>buildRoomAvailability({classrooms:[room],slots,currentRequestId:r.id,currentRequest:r,legacyBindings:bindings,effectiveSchedule:{version:1,occupancies:[row]}})[0];
 for(const delta of [{id:'another-row'},{classId:id(50)},{startMinute:1171},{endMinute:1291},{uncertain:true},{allRooms:true}]) assert.equal(check({...occupancy,...delta}).available,false,JSON.stringify(delta));
 for(const values of [[],[binding,binding],[{...binding,requestUpdatedAt:'2050-09-30T00:00:00.123457+00:00'}],[{...binding,mode:'bound'}],
  [{...binding,startAt:'2050-10-06T09:00:00.000001Z'}],[{...binding,endAt:'2050-10-06T11:00:00.000001Z'}]])assert.equal(check(occupancy,values).available,false);
 assert.equal(check(occupancy,[binding],{...request,makeup_slots:[slots[0],slots[0]]}).available,false);
});

test('completed proof excludes its current exact row but never reuses an old inherited interval',()=>{
 const current={...occupancy,startMinute:1080,endMinute:1200};
 const b={...binding,mode:'bound',occupancy:current};
 const r={...request,status:'completed'};
 const check=proof=>buildRoomAvailability({classrooms:[room],slots,currentRequestId:r.id,currentRequest:r,legacyBindings:[proof],effectiveSchedule:{version:1,occupancies:[current]}})[0];
 assert.equal(check(b).available,true);
 assert.equal(check({...b,occupancy}).available,false);
 assert.equal(check({...b,requestUpdatedAt:'2050-09-30T00:00:00.123000+00:00'}).available,false);
});

test('equivalent UTC and Seoul instants produce the same reused plan',()=>{
 const seoul={...request,makeup_start_at:'2050-10-06T18:00:00+09:00',makeup_end_at:'2050-10-06T20:00:00+09:00'};
 assert.deepEqual(build(plan,seoul,resources),build(plan,request,resources));
});

test('a normal active cancellation still uses the existing canonical append path',()=>{
 const before={sessions:[{...original,state:'active',scheduleState:'active',makeupDate:''}]};
 const after=build(before,request,{teacher,classrooms:[room]});
 assert.equal(after.sessions.length,2);assert.equal(after.sessions[1].id,`makeup-request:${request.id}:0`);
 assert.equal(after.sessions[1].makeupAdoption,undefined);
});

test('adoption projection requires trusted provenance and exact nested binding, preserving content edits',()=>{
 const after=build(plan,request,resources),lesson=after.sessions[1];
 const bindingFields=['id','date','scheduleState','state','originalDate','makeupDate','isForced','sourceSlotId','makeupRequestId','makeupRequestRole','originalSessionId','makeupAdoption'];
 const rowBinding=Object.fromEntries(bindingFields.filter(key=>Object.hasOwn(lesson,key)).map(key=>[key,lesson[key]]));
 // PostgreSQL jsonb object order differs from the JS marker construction.
 rowBinding.makeupAdoption=Object.fromEntries(Object.entries(rowBinding.makeupAdoption).reverse());
 const ctx={approvedByIdentity:{[lesson.id]:{binding:rowBinding,approvedOverrideVerified:true,legacyAdoptionVerified:true,approvedOverride:{startTime:'18:00',endTime:'20:00'}}}};
 const input=effectiveInputForLesson(after,lesson,ctx);
 assert.equal(input.legacyAdoptionVerified,true);
 assert.equal(effectiveInputForLesson(after,{...lesson,memo:'new content'},ctx).legacyAdoptionVerified,true);
 assert.equal(effectiveInputForLesson(after,{...lesson,originalSessionId:'changed'},ctx).legacyAdoptionVerified,undefined);
 assert.equal(effectiveInputForLesson(after,{...lesson,makeupAdoption:{...lesson.makeupAdoption,requestUpdatedAt:'2050-01-01T00:00:00Z'}},ctx).legacyAdoptionVerified,undefined);
 // Name-only rows demonstrate that raw metadata alone cannot bypass a map.
 const nameOnly={...lesson};delete nameOnly.teacherCatalogId;delete nameOnly.classroomCatalogId;
 const resolve=flags=>resolveEffectiveSchedule({...flags,session:nameOnly,dateOverride:{teacherName:'Other teacher',classroomName:'Other room'},catalogs:{teachers:[teacher,{id:id(71),name:'Other teacher'}],rooms:[room,{id:id(72),name:'Other room'}]}});
 assert.equal(resolve({legacyAdoptionVerified:true,approvedOverrideVerified:true}).values.classroomCatalogId,room.id);
 assert.equal(resolve({legacyAdoptionVerified:true}).values.classroomCatalogId,id(72));
 assert.equal(resolve({approvedOverrideVerified:true}).values.classroomCatalogId,id(72));
});

for(const variant of ['date map','weekly date']) test(`save does not regenerate an adopted date from ${variant}`,()=>{
 const input={...structuredClone(plan),billingPeriods:[{id:'synthetic-billing',month:10,startDate:makeup.date,endDate:request.cancel_date}],selectedDays:variant==='weekly date'?[new Date(`${makeup.date}T00:00:00Z`).getUTCDay()]:[]};
 if(variant==='date map')input.sessionStates[makeup.date]={state:'makeup',originalDate:request.cancel_date,originalSessionId:original.id};
 const after=build(input,request,resources),saved=buildSchedulePlanForSave(after);
 assert.deepEqual(saved.sessions.filter(s=>s.date===makeup.date),[after.sessions[1]]);
 assert.deepEqual(buildSchedulePlanForSave(saved).sessions.filter(s=>s.date===makeup.date),[after.sessions[1]]);
 assert.equal(saved.sessions.filter(s=>s.date===request.cancel_date).length,1);
});

test('save preserves a separate existing ordinary lesson on an adopted date',()=>{
 const input={...structuredClone(plan),billingPeriods:[{id:'synthetic-billing',month:10,startDate:makeup.date,endDate:makeup.date}],selectedDays:[new Date(`${makeup.date}T00:00:00Z`).getUTCDay()]};
 const after=build(input,request,resources);
 after.sessions.push({id:'separate-ordinary',sessionKey:'separate-ordinary',date:makeup.date,state:'active',scheduleState:'active',billingId:'synthetic-billing',teacherNote:'Separate content',startTime:'21:00',endTime:'22:00',teacherCatalogId:teacher.id,classroomCatalogId:room.id});
 const saved=buildSchedulePlanForSave(after),onDate=saved.sessions.filter(s=>s.date===makeup.date);
 assert.equal(onDate.length,2);assert.ok(onDate.some(s=>s.id==='separate-ordinary'&&s.teacherNote==='Separate content'));
 assert.deepEqual(onDate.find(s=>s.id===makeup.id),after.sessions[1]);
});

test('later canonical makeup retains its separate slot without regenerating the adopted date',()=>{
 const input={...structuredClone(plan),billingPeriods:[{id:'synthetic-billing',month:10,startDate:makeup.date,endDate:makeup.date}],selectedDays:[new Date(`${makeup.date}T00:00:00Z`).getUTCDay()]};
 const after=build(input,request,resources),other={...after.sessions[1],id:`makeup-request:${id(76)}:0`,sessionKey:`makeup-request:${id(76)}:0`,makeupRequestId:id(76),startTime:'21:00',endTime:'22:00'};
 delete other.makeupAdoption;delete other.makeupRequestRole;after.sessions.push(other);
 const saved=buildSchedulePlanForSave(after);
 assert.deepEqual(saved.sessions.filter(s=>s.date===makeup.date),[after.sessions[1],other]);
});
