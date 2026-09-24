import { withRpcQueryControls } from './helpers/rpc-query-fixture.mjs';
import assert from 'node:assert/strict';
import test, {mock} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {isMakeupDomainConflict,makeupApprovalErrorStatus,makeupDomainErrorMessage} from '../src/features/makeup-requests/makeup-domain-errors.js';
import {validateLocalArguments,PsqlConnection} from '../scripts/verify-timetable-concurrency.mjs';
import {createTimetablePlanService as createService} from '../src/features/academic/timetable-plan-service.ts';
import {findOperatingConflicts} from '../src/features/academic/timetable-conflicts.ts';
for(const [code,message] of [['P0001','makeup_request_stale_status'],['P0001','makeup_request_source_changed'],['P0001','makeup_schedule_plan_stale'],['P0001','makeup_lesson_session_stale'],['23P01','makeup_room_collision'],['23P01','makeup_calendar_event_conflict'],['23P01','timetable_resource_conflict']])test(`actual makeup producer pair maps HTTP409 and actionable message: ${message}`,()=>{const e={code,message};assert.equal(isMakeupDomainConflict(e),true);assert.equal(makeupApprovalErrorStatus(e),409);assert.ok(makeupDomainErrorMessage(e));});
test('unknown P0001 is not silently conclusive; real40001 remains a database retry',()=>{assert.equal(isMakeupDomainConflict({code:'P0001',message:'unknown'}),false);assert.equal(makeupApprovalErrorStatus({code:'P0001',message:'unknown'}),503);assert.equal(isMakeupDomainConflict({code:'23P01',message:'unknown'}),false);assert.equal(makeupApprovalErrorStatus({code:'23P01',message:'unknown'}),503);assert.equal(isMakeupDomainConflict({code:'40001',message:'could not serialize access'}),false);assert.equal(makeupApprovalErrorStatus({code:'40001'}),409);});
test('concurrency runner requires explicit isolated local transport',()=>{assert.throws(()=>validateLocalArguments([]));assert.throws(()=>validateLocalArguments(['--local','postgres://production']));assert.throws(()=>validateLocalArguments(['--local','--container','other']));validateLocalArguments(['--local','--container','tips_timetable_20260923']);});
if(process.env.TIMETABLE_TASK8_LOCAL==='1'){
 test('actual service+DB copy/move observes provider fetch spy zero independently of populated queue JSON',async()=>{
  const db=new PsqlConnection(),fetchSpy=mock.method(globalThis,'fetch',()=>{throw Error('provider/network is forbidden');});const rows=[];
  try{
   const source=await readFile(new URL('../supabase/tests/timetable_plan_no_send_test.sql',import.meta.url),'utf8');await db.ok(source.slice(0,source.indexOf('create temp table history_before')).replace('select no_plan();',''));
   const id=n=>`a8240000-0000-4000-8000-${String(n).padStart(12,'0')}`,before=await db.value('select pg_temp.history_snapshot()::text;');
   const service=createTimetablePlanService({actorScope:id(1),client:{rpc:async(name,args)=>{assert.ok(['preview_timetable_plan_transfer_v1','commit_timetable_plan_transfer_v1'].includes(name));const [key,value]=Object.entries(args)[0];const result=await db.query(`select public.${name}(${key}=>'${JSON.stringify(value).replaceAll("'","''")}'::jsonb)::text;`);return result.code==='00000'?{data:JSON.parse(result.text),error:null}:{data:null,error:{code:result.code,message:result.text}};}}});
   for(const target of [{kind:'operational'},{kind:'plan',planId:id(31)}])for(const mode of ['copy','move']){
    await db.ok('savepoint service_transfer;');const request={source:{kind:'plan',planId:id(30)},target,mode,onConflict:'reject',itemIds:[id(32)]};const preview=await service.previewTransfer(request),command={request,previewFingerprint:preview.fingerprint,requestKey:crypto.randomUUID()};const receipt=await service.commitTransfer(command);assert.deepEqual(await service.commitTransfer(command),receipt);
    const after=await db.value('select pg_temp.history_snapshot()::text;');assert.deepEqual(after,before);assert.equal(fetchSpy.mock.callCount(),0);rows.push({target:target.kind,mode,realRpc:true,immutableReplay:true,queueRowsBefore:before['dashboard_private.notification_deliveries'].count,queueDelta:after['dashboard_private.notification_deliveries'].count-before['dashboard_private.notification_deliveries'].count,providerFetchCalls:fetchSpy.mock.callCount()});await db.ok('rollback to service_transfer;');
   }
   await writeFile('docs/qa/timetable-presets-20260923/provider-spy-results.json',JSON.stringify({boundary:'actual transfer service with socket DB RPC; global network/provider fetch spy',rows},null,2));
  }finally{await db.ok('rollback;');db.close();fetchSpy.mock.restore();}
 });
 test('actual post-race snapshot exposes conflict resolution in canonical consumer',async()=>{const report=JSON.parse(await readFile('docs/qa/timetable-presets-20260923/concurrency-results.json','utf8'));assert.equal(report.passed,true);const snapshot=report.conflictSnapshot;const conflict=findOperatingConflicts(snapshot.slots,snapshot,null);assert.ok(conflict.some(c=>c.slotId===report.ids.slot1));});
}

test('real approval POST maps final producer errors through actual replay and response',async()=>{
 const {createRequire}=await import('node:module'),vm=await import('node:vm'),ts=createRequire(import.meta.url)('typescript');
 const domain=await import('../src/features/makeup-requests/makeup-domain-errors.js'),replay=await import('../src/features/makeup-requests/makeup-approval-replay.js');
 const source=await readFile(new URL('../src/app/api/makeup-requests/approve/route.ts',import.meta.url),'utf8');const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const id='a8230000-0000-4000-8000-000000000001';let current;
 const actor={auth:{getUser:async()=>({data:{user:{id}},error:null})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:'admin'},error:null})})})})};
 const server={rpc:async()=>({data:null,error:current})},routeModule={exports:{}};
 const imports={'@supabase/supabase-js':{createClient:(_url,key)=>key==='synthetic-service'?server:actor},'@/features/makeup-requests/makeup-domain-errors.js':domain,'@/features/makeup-requests/makeup-approval-replay.js':replay,'@/features/makeup-requests/makeup-request-model.js':{},'@/features/operations/academic-event-utils.js':{}};
 vm.runInNewContext(output,{require:key=>{assert.ok(key in imports,key);return imports[key];},module:routeModule,exports:routeModule.exports,Response,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3262',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'}}});
 for(const [code,message,status] of [['P0001','makeup_request_stale_status',409],['P0001','makeup_request_source_changed',409],['P0001','makeup_schedule_plan_stale',409],['P0001','makeup_lesson_session_stale',409],['23P01','makeup_room_collision',409],['23P01','makeup_calendar_event_conflict',409],['23P01','timetable_resource_conflict',409],['23P01','unknown',503],['P0001','unknown',503],['40001','could not serialize access',409]]){
  current={code,message};const response=await routeModule.exports.POST(new Request('http://127.0.0.1/api/makeup-requests/approve',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify({requestId:id,mutationRequestId:id,expectedStatus:'approval_pending',note:''})}));assert.equal(response.status,status,`${code}/${message}`);assert.equal((await response.json()).ok,false);
 }
});

import {findConflicts} from '../src/features/academic/timetable-conflicts.ts';
import {timetablePerformanceFixture} from '../scripts/qa/timetable-performance-fixture.mjs';
test('changed occupancy preserves exact ordered full-scope conflict results, including siblings and shadows',()=>{
 const s=timetablePerformanceFixture(200,600);
 const shadows=s.slots.slice(0,50).map(x=>({...x,id:'shadow-'+x.id,classId:x.itemId}));
 for(const indexes of [[],[0],[599],[1,9,50],[0,1,2,30,200,599]]){
  const changed=new Set(indexes.map(i=>s.slots[i].id));
  const expected=findConflicts(s.slots,shadows).filter(c=>changed.has(c.slotId)||changed.has(c.otherSlotId));
  assert.deepEqual(findConflicts(s.slots,shadows,changed),expected);
 }
});

function createTimetablePlanService(options) { return createService({ ...options, client: withRpcQueryControls(options.client) }); }
