import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classEditRequest } from '../src/features/agent-api/server/class-edit-contract.ts';
import { classWorkspace, compileClassEdit } from '../src/features/agent-api/server/class-edit-compiler.mjs';
import { normalizeSchedulePlan } from '../src/lib/class-schedule-planner.js';
import { createAgentEditApiHandler } from '../src/features/agent-api/server/http-v2.ts';
import { id, window, timing, monday, target, fixture } from './fixtures/agent-class-edit-fixture.mjs';
const request=(context,extra)=>classEditRequest.parse({expectedVersion:context.version,window,reason:'synthetic test',...extra});
test('contract rejects empty, arbitrary, reversed and ambiguous edits',()=>{
 const c=fixture(); for(const extra of [{},{basic:{student_ids:[]}},{lessons:[{date:monday[0],state:'scheduled',makeup:{date:target,...timing}}]},{lessons:[{date:monday[0],state:'skipped'},{date:monday[0],state:'cancelled'}]},{lessons:[{date:monday[0],state:'scheduled',timing:{...timing,endMinute:500}}]}]) assert.throws(()=>request(c,extra));
});
test('legacy cancellation/makeup uses real planner and preserves private/history/content by identity',()=>{
 const c=fixture();const before=structuredClone(c.plan);
 const cmd=compileClassEdit(c,request(c,{basic:{name:'New name'},lessons:[{date:monday[0],state:'cancelled',makeup:{date:target,...timing}}]}));
 assert.equal(cmd.patch.name,'New name');const plan=cmd.patch.schedule_plan;
 assert.deepEqual(plan.history,before.history);assert.equal(plan.privateNote,'SECRET_ROOT');
 for(const row of before.sessions.filter(x=>x.date!==monday[0])) assert.deepEqual(plan.sessions.find(x=>x.id===row.id),row);
 const source=plan.sessions.find(x=>x.date===monday[0]);assert.equal(source.teacherNote,before.sessions.find(x=>x.date===monday[0]).teacherNote);assert.equal(source.state,'exception');
 const makeup=plan.sessions.find(x=>x.date===target);assert.equal(makeup.originalDate,monday[0]);assert.equal(makeup.state,'makeup');assert.equal(makeup.teacherCatalogId,id(1));assert.ok(!makeup.teacherNote);assert.ok(!makeup.textbookEntries);
 const consumer=normalizeSchedulePlan(plan,{subject:'영어',schedule:c.schedule});assert.equal(consumer.sessions.find(x=>x.date===target).scheduleState,'makeup');assert.equal(consumer.sessions.find(x=>x.date===monday[0]).makeupDate,target);
 assert.deepEqual(c.plan,before,'compiler never mutates its baseline');
});
test('normal extra lesson and exclusion do not acquire makeup links in real consumer',()=>{
 const c=fixture();const cmd=compileClassEdit(c,request(c,{lessons:[{date:monday[0],state:'skipped'},{date:target,state:'scheduled',timing}]}));
 const consumer=normalizeSchedulePlan(cmd.patch.schedule_plan,{schedule:c.schedule});
 assert.equal(consumer.sessions.find(x=>x.date===target).scheduleState,'active');assert.equal(consumer.sessions.find(x=>x.date===target).originalDate,'');
 assert.equal(consumer.sessions.find(x=>x.date===monday[0]).scheduleState,'skipped');
});
test('dated change is bounded and does not silently change weekly template',()=>{
 const c=fixture();const cmd=compileClassEdit(c,request(c,{lessons:monday.map(date=>({date,state:'scheduled',timing:{...timing,startMinute:620}}))}));
 assert.ok(!cmd.slots && !cmd.patch.schedule);assert.deepEqual(cmd.patch.schedule_plan.selectedDays,c.plan.selectedDays);
 assert.equal(cmd.patch.schedule_plan.sessions.find(x=>x.date===monday[0]).startTime,'10:20');
});
test('normalized virtual cancellation and linked makeup have stable IDs before preview',()=>{
 const c=fixture('normalized');const cmd=compileClassEdit(c,request(c,{lessons:[{date:monday[0],state:'cancelled',makeup:{date:target,...timing}}]}));
 assert.equal(cmd.sessions.length,2);assert.equal(cmd.sessions[0].sourceSlotId,id(4));assert.equal(cmd.sessions[0].state,'skipped');assert.equal(cmd.sessions[1].makeupOf,cmd.sessions[0].id);assert.equal(cmd.sessions[1].state,'makeup');
});
test('cannot guess ambiguous dates, existing makeup sources, past edits, periods or catalogs',()=>{
 const c=fixture(); c.plan.sessions.push({...c.plan.sessions[0],id:id(999)});
 assert.throws(()=>compileClassEdit(c,request(c,{lessons:[{date:monday[0],state:'skipped'}]})),/agent_ambiguous_lesson/);
 const empty=fixture();empty.plan={};assert.throws(()=>compileClassEdit(empty,request(empty,{lessons:[{date:monday[0],state:'skipped'}]})),/agent_missing_billing_period/);
 const valid=fixture();assert.throws(()=>compileClassEdit(valid,request(valid,{lessons:[{date:monday[0],state:'scheduled',timing:{...timing,teacherId:id(99)}}]})),/agent_invalid_catalog/);
 assert.throws(()=>compileClassEdit(valid,request(valid,{lessons:[{date:monday[0],state:'skipped'}]}),{today:'2100-01-01'}),/agent_past_change/);
});
test('weekly changes retain unrequested slots and require existing IDs',()=>{
 const c=fixture('normalized');c.weeklySlots.push({...c.weeklySlots[0],id:id(5),weekday:3});
 const cmd=compileClassEdit(c,request(c,{weeklySlots:[{...c.weeklySlots[0],startMinute:620}]}));assert.equal(cmd.slots.length,2);assert.equal(cmd.slots[1].startTime,'10:00');
 assert.throws(()=>compileClassEdit(c,request(c,{weeklySlots:[{...c.weeklySlots[0],id:id(99)}]})),/agent_stale/);
});
test('workspace hides all private/learning/student data and hash is deterministic',()=>{
 const c=fixture();c.student_ids=['SECRET_STUDENT'];
 const result=classWorkspace(c,window);assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(!('plan' in result));
 assert.equal(result.verificationHash,classWorkspace({...c,version:'b'.repeat(64)},window).verificationHash);
 const virtual=fixture();virtual.plan.sessions=[];assert.equal(classWorkspace(virtual,window).verificationHash,classWorkspace(virtual,window).verificationHash);
});
const token='tips_agent_'+'c'.repeat(64);
function req(path,body,headers={}) {return new Request('https://tips.test/api/v2/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});}
test('HTTP never exposes server context from workspace, preview or applied receipt',async()=>{
 const c=fixture();const run=createAgentEditApiHandler({enabled:()=>true,rpc:async(_name,input)=>({error:null,data:{data:input.p_action==='context'?c:input.p_action==='preview'?{previewToken:id(10),expiresAt:'2099-10-01',beforeContext:c,afterContext:c,window}:{operationId:id(11),state:'applied',classContext:c,window,privateUnexpected:'SECRET'}}})});
 for(const [path,parts,body,headers] of [
  [`classes/${c.id}?from=${window.from}&to=${window.to}`,['classes',c.id]],
  [`classes/${c.id}/changes/preview`,['classes',c.id,'changes','preview'],request(c,{basic:{name:'Changed'}})],
  ['operations',['operations'],{previewToken:id(10)},{'Idempotency-Key':id(11)}],
 ]) {const res=await run(req(path,body,headers),parts);assert.equal(res.status,200);const text=await res.text();assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('Context'));assert.ok(text.includes('verificationHash'));}
});
test('HTTP recovery never mutates again and reports independent cache state',async()=>{
 const c=fixture();const actions=[];const run=createAgentEditApiHandler({enabled:()=>true,rpc:async(_n,input)=>{actions.push(input.p_action);return {error:null,data:{data:{operationId:id(10),state:'applied',classContext:c,window}}}},refreshPublicCache:()=>{throw Error('cache')}});
 const res=await run(req('operations/'+id(10)),['operations',id(10)]);const body=await res.json();assert.equal(body.data.state,'applied');assert.equal(body.data.publicCache.state,'pending');assert.deepEqual(actions,['operation']);
});
test('HTTP rejects raw compiler payload and bounds queries before RPC',async()=>{
 let count=0;const run=createAgentEditApiHandler({enabled:()=>true,rpc:async()=>{count++;throw Error('unexpected')}});
 const c=fixture();assert.equal((await run(req('classes/'+c.id+'/changes/preview',{...request(c,{basic:{name:'x'}}),command:{patch:{student_ids:[]}}}),['classes',c.id,'changes','preview'])).status,400);
 assert.equal((await run(req('classes/'+c.id+'?from=2099-01-01&to=2099-12-31'),['classes',c.id])).status,400);assert.equal(count,0);
});

test('SQL integration fixture is exact real compiler output',()=>{
 const c=fixture();let n=800;const command=compileClassEdit(c,{expectedVersion:c.version,window,reason:'synthetic test',basic:{name:'Changed by agent'},lessons:[{date:monday[0],state:'cancelled',makeup:{date:target,...timing}}]},{uuid:()=>id(n++)});
 const sql=readFileSync(new URL('../supabase/tests/agent_api_class_changes_test.sql',import.meta.url),'utf8');
 const payload=sql.match(/insert into compiler_fixture values \('(.+)'::jsonb\);/)[1].replaceAll("''", "'");
 assert.deepEqual(JSON.parse(payload),{plan:c.plan,command,source:monday[0],target});
});
