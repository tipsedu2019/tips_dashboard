import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimetablePlanService } from '../src/features/academic/timetable-plan-service.ts';
const request={source:{kind:'plan',planId:'source'},target:{kind:'plan',planId:'target'},mode:'copy',itemIds:['one'],onConflict:'reject'};
const valid={request,fingerprint:'server',shadowFingerprint:'shadow',mappings:[{sourceId:'one',action:'create_plan_item'}],blockers:[],warnings:[]};
test('preview sends exact canonical request with selected item IDs',async()=>{let called;const service=createTimetablePlanService({actorScope:'actor',client:{rpc:(...args)=>{called=args;return Promise.resolve({data:valid,error:null});}}});assert.deepEqual(await service.previewTransfer(request),valid);assert.deepEqual(called,['preview_timetable_plan_transfer_v1',{p_request:request}]);});
for(const malformed of [{...valid,request:{...request,itemIds:['other']}},{...valid,mappings:[{sourceId:'other',action:'create_plan_item'}]},{...valid,blockers:[{sourceId:'one',code:'bad'}]}])test('malformed or mismatched preview is never commit-ready',async()=>{const service=createTimetablePlanService({actorScope:'actor',client:{rpc:()=>Promise.resolve({data:malformed,error:null})}});await assert.rejects(service.previewTransfer(request),/response_invalid/);});

if(process.env.TIMETABLE_TRANSFER_FIXTURE_DB==='1')test('actual plan-copy receipt replay at equal source sequence preserves newer operating reference',async()=>{
 const {planFixtureRpc}=await import('../scripts/qa/timetable-plan-rpc-bridge.mjs');
 const {createTimetablePlanController}=await import('../src/features/academic/timetable-plan-model.ts');
 const {spawnSync}=await import('node:child_process');
 const id=()=>crypto.randomUUID(),source=id(),target=id(),teacher=id(),room=id(),itemId=id();
 const sql=body=>{const r=spawnSync('/Users/hyunjun/.local/bin/docker',['exec','-i','tips_timetable_20260923','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 const service=createTimetablePlanService({actorScope:'fixture-admin',client:{rpc:(name,args)=>planFixtureRpc(name,args)}});
 let controller;
 try{
  sql(`insert into public.teacher_catalogs(id,name,subjects) values('${teacher}','receipt-${teacher}',array['영어']);insert into public.classroom_catalogs(id,name,subjects) values('${room}','receipt-${room}',array['영어']);`);
  for(const planId of [source,target])await service.mutatePlan({operation:'create',planId,name:`receipt QA ${planId}`,requestKey:id()});
  const before=await service.readPlan(source);
  await service.saveItem({operation:'save',planId:source,expectedMetaRevision:0,expectedShadowFingerprint:before.shadowFingerprint,expectedItemRevision:null,requestKey:id(),item:{id:itemId,planId:source,name:'receipt QA item',subject:'영어',subjectAreaKey:null,grade:'중2',capacity:12,tuition:100000,defaultTeacherId:teacher,defaultClassroomId:room,durationMinutes:30,pendingSlots:[]},slots:[{id:id(),itemId,planId:source,weekday:0,startMinute:600,endMinute:630,teacherId:teacher,classroomId:room,sourceSlotId:null}]});
  const request={source:{kind:'plan',planId:source},target:{kind:'plan',planId:target},mode:'copy',itemIds:[itemId],onConflict:'reject'};
  const preview=await service.previewTransfer(request),command={request,previewFingerprint:preview.fingerprint,requestKey:id()};
  const receipt=await service.commitTransfer(command);
  controller=createTimetablePlanController({service,actorScope:'fixture-admin',planId:source,storage:null});await controller.load();
  sql(`update public.teacher_catalogs set is_visible=false where id='${teacher}';`);
  await controller.refresh();const newer=controller.snapshot().snapshot;
  assert.equal(newer.plan.changeSequence,receipt.snapshot.plan.changeSequence);assert.notEqual(newer.shadowFingerprint,receipt.shadowFingerprint);
  const replay=await service.commitTransfer(command);assert.deepEqual(replay,receipt);
  controller.applyTransfer(replay);assert.equal(controller.snapshot().snapshot.shadowFingerprint,newer.shadowFingerprint);assert.notEqual(controller.snapshot().referenceStatus,'verified');
  await controller.refresh();assert.equal(controller.snapshot().referenceStatus,'verified');assert.equal((await service.readPlan(target)).items.length,1);
 }finally{controller?.destroy();for(const planId of [source,target]){const snap=await service.readPlan(planId);await service.mutatePlan({operation:'archive',planId,expectedMetaRevision:snap.plan.metaRevision,requestKey:id()});}sql(`delete from public.teacher_catalogs where id='${teacher}';delete from public.classroom_catalogs where id='${room}';`);}
});
