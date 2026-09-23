import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimetableOperationalMutation } from '../src/features/academic/timetable-operational-service.ts';
import { mapContinuousScheduleRpcError } from '../src/features/academic/continuous-class-schedule-service.ts';

test('operating retry retains request key and payload; refresh failure is committed', async () => {
  const calls=[];let attempts=0;
  const action=createTimetableOperationalMutation({requestKey:'fixed-key',rpc:async(name,args)=>{calls.push([name,structuredClone(args)]);if(++attempts===1)throw new Error('network');return {data:{id:'class'},error:null};},refresh:async()=>{throw new Error('cache');}});
  const input={classId:'class',patch:{schedule_plan:{sessions:[]}},expectedSchedulePlan:{sessions:[{id:'old'}]}};
  await assert.rejects(action.save(input),/network/);
  assert.deepEqual(await action.save(input),{data:{id:'class'},refreshStatus:'pending'});
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[0][1].p_request_key,'fixed-key');
  assert.deepEqual(input.patch,{schedule_plan:{sessions:[]}});
});
test('operating conflict preserves inputs and separates true serialization failure',async()=>{
  assert.equal(mapContinuousScheduleRpcError({code:'23P01',message:'timetable_resource_conflict'}).kind,'conflict');
  assert.equal(mapContinuousScheduleRpcError({code:'40001',message:'serialization_failure'}).kind,'unknown');
  const error={code:'23P01',message:'timetable_resource_conflict'};let refreshed=false;
  const action=createTimetableOperationalMutation({requestKey:'fixed',rpc:async()=>({data:null,error}),refresh:async()=>{refreshed=true;}});
  const input={classId:'class',patch:{schedule:'월 09:00-10:00'}};
  await assert.rejects(action.save(input),value=>value===error);
  assert.equal(refreshed,false);assert.equal(input.patch.schedule,'월 09:00-10:00');
});

import { createManagementService } from '../src/features/management/management-service.js';
import { effectiveOperatingSlots, findOperatingConflicts, suggestPlacements, operatingReferenceComplete } from '../src/features/academic/timetable-conflicts.ts';
const weekly={id:'live:class:source',classId:'class',sourceSlotId:'source',weekday:1,startMinute:540,endMinute:600,teacherId:'teacher',classroomId:'room',classRevision:1};
const candidate={id:'candidate',itemId:'item',planId:'plan',weekday:1,startMinute:550,endMinute:570,teacherId:'teacher',classroomId:'other-room',sourceSlotId:null};
const reference={asOfDate:'2026-09-23',shadowSlots:[weekly],shadowClasses:[],catalogs:{teachers:[],classrooms:[]},unresolvedOccupancies:[],shadowFingerprint:'x',complete:true,datedSessions:[{id:'session:one',classId:'class',sourceSlotId:'source',date:'2026-10-05',state:'skipped',startMinute:null,endMinute:null,teacherId:null,classroomId:null,revision:2}],datedUnresolvedOccupancies:[],datedFingerprint:'d',datedComplete:true};
const period={startDate:'2026-10-05',endDate:'2026-10-05'};
test('date authority frees actual date but recurring plan still reserves weekly shadow',()=>{
 assert.deepEqual(effectiveOperatingSlots(reference,'2026-10-05'),[]);
 assert.deepEqual(effectiveOperatingSlots(reference,'2026-09-21'),[]);
 assert.equal(findOperatingConflicts([candidate],reference,period)[0].otherSlotId,weekly.id);
});
test('dated exception and source-less legacy occupancy are additive and identify exact date',()=>{
 const moved={...reference,datedSessions:[{...reference.datedSessions[0],state:'exception',startMinute:480,endMinute:530,teacherId:'teacher',classroomId:'room'}]};
 assert.equal(findOperatingConflicts([{...candidate,startMinute:500,endMinute:520}],moved,period)[0].date,'2026-10-05');
 const sourceLess={...moved,datedSessions:[{...moved.datedSessions[0],sourceSlotId:null,startMinute:540,endMinute:600}]};
 assert.equal(effectiveOperatingSlots(sourceLess,'2026-10-05').length,2);
 assert.equal(findOperatingConflicts([candidate],sourceLess,period).length,2);
});
test('period suggestions include dated reservations and never offer incomplete range',()=>{
 const dated={...reference,shadowSlots:[],datedSessions:[{...reference.datedSessions[0],state:'makeup',startMinute:540,endMinute:570,teacherId:'teacher',classroomId:'room'}]};
 const input={slots:[],shadows:[],itemId:'new',planId:'plan',teacherId:'teacher',classroomId:'room',durationMinutes:30,weekdays:[1],fromMinute:540,toMinute:600,operatingReference:dated,period};
 assert.equal(suggestPlacements(input)[0].startMinute,570);
 const unresolved={...dated,datedUnresolvedOccupancies:[{classId:'unknown',label:'unknown',scope:'all',resourceId:null,reason:'incomplete_read',date:null}],datedComplete:false};
 assert.equal(operatingReferenceComplete(unresolved,period),false);
 assert.equal(operatingReferenceComplete(unresolved,null),true);
 assert.deepEqual(suggestPlacements({...input,operatingReference:unresolved}),[]);
});
test('actual management consumer uses atomic gateway and keeps retry key after lost response',async()=>{
 let calls=[];let attempts=0;let generated=0;
 const service=createManagementService({supabase:{rpc:async(name,args)=>{calls.push([name,structuredClone(args)]);if(++attempts===1)throw new Error('lost');return {data:{classRow:{id:'class',name:'saved'},closeResult:null},error:null};}},generateId:()=>`request-${++generated}`,probeRegistrationRuntime:async()=>({mode:'ready'}),refreshPublicClassesCache:async()=>{throw new Error('cache');}});
 const record={id:'class',name:'safe',subject:'영어',status:'수강',teacher:'A',room:'1',schedule:'월 09:00-10:00'};
 await assert.rejects(service.updateClass(record),/lost/);
 const result=await service.updateClass(record);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][0],'update_class_operational_v1');
 assert.equal('student_ids' in calls[0][1].p_patch,false);
 assert.equal(result.publicClassesCacheRefresh.status,'pending');
});

test('metadata-only UPDATE does not claim success for zero affected rows', async()=>{
 const calls=[];
 const service=createManagementService({supabase:{from(table){assert.equal(table,'classes');return {update(patch){calls.push(patch);return {eq(){return this;},async select(){return {data:[],error:null};}};}};}},probeRegistrationRuntime:async()=>({mode:'ready'}),refreshPublicClassesCache:async()=>{throw new Error('must not refresh');}});
 await assert.rejects(service.updateClass({id:'missing',name:'metadata'}),error=>error.code==='P0002');
 for(const key of ['status','teacher','room','schedule'])assert.equal(key in calls[0],false);
});

test('committed defaults and initialization retain a pending cache refresh receipt', async()=>{
 const service=createManagementService({supabase:{rpc:async()=>({data:{scheduleRevision:2,slots:[]},error:null})},probeRegistrationRuntime:async()=>({mode:'ready'}),refreshPublicClassesCache:async()=>{throw new Error('cache');}});
 for(const method of ['saveClassScheduleDefaults','initializeClassSchedule']) {
  const result=await service[method]({classId:'class',requestKey:'fixed',expectedScheduleRevision:1,slots:[]});
  assert.equal(result.scheduleRevision,2);
  assert.equal(result.publicClassesCacheRefresh.status,'pending');
 }
});
