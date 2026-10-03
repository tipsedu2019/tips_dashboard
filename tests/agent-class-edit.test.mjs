import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { classEditRequest } from '../src/features/agent-api/server/class-edit-contract.ts';
import { classWorkspace, compileClassEdit } from '../src/features/agent-api/server/class-edit-compiler.mjs';
import { normalizeSchedulePlan } from '../src/lib/class-schedule-planner.js';
import { createAgentEditApiHandler } from '../src/features/agent-api/server/http-v2.ts';
import { id, window, timing, monday, target, fixture, makeSqlFixture } from './fixtures/agent-class-edit-fixture.mjs';
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
 assert.throws(()=>compileClassEdit(c,request(c,{lessons:[{date:monday[0],lessonId:c.plan.sessions[0].id,state:'skipped'}]})),/agent_ambiguous_lesson/);
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
 const sql=readFileSync(new URL('../supabase/tests/agent_api_class_changes_test.sql',import.meta.url),'utf8');
 const payload=sql.match(/insert into compiler_fixture values \('(.+)'::jsonb\);/)[1].replaceAll("''", "'");
 assert.deepEqual(JSON.parse(payload),makeSqlFixture(compileClassEdit));
});

const correctionDate = '2001-01-04';
const correctionHash = 'd'.repeat(64);
function correctionContext() {
 const context=fixture();
 context.schedule='목 16:00-18:00';
 context.weeklySlots=[{...context.weeklySlots[0],weekday:4,startMinute:960,endMinute:1080}];
 context.plan={...context.plan,selectedDays:[4],billingPeriods:[{id:'past-january',month:1,label:'1월',startDate:'2001-01-01',endDate:'2001-01-31'}],
  sessionStates:{[correctionDate]:{state:'skipped',memo:'SECRET_STATE_NOTE'}},
  sessionSchedules:{[correctionDate]:{startTime:'10:00',endTime:'11:00',teacherCatalogId:id(1),classroomCatalogId:id(2)}},
  sessions:[{id:'stored:2001-01-04:skipped',sessionKey:'stored:2001-01-04:skipped',date:correctionDate,billingId:'past-january',
   state:'skipped',scheduleState:'skipped',isForced:false,originalDate:'',makeupDate:'',startTime:'10:00',endTime:'11:00',teacherCatalogId:id(1),classroomCatalogId:id(2),teacherNote:'SECRET_LESSON_NOTE',customField:'KEEP'},
   {id:'stored:2001-01-11:active',sessionKey:'stored:2001-01-11:active',date:'2001-01-11',billingId:'past-january',state:'active',scheduleState:'active',isForced:false,teacherNote:'SECRET_OTHER_NOTE'}]};
 return context;
}
const correctionInput = context => ({expectedVersion:context.version,lessonId:context.plan.sessions[0].id,date:correctionDate,expectedState:'skipped',nextState:'scheduled',reason:'synthetic approved state correction'});
function correctionHarness(context=correctionContext(), previewError=null, transformPreview=value=>value) {
 const calls=[],after=structuredClone(context), receipts=new Map();
 // A real acknowledged preview hashes the temporarily corrected raw plan.
 // The version is opaque; this synthetic value only models its changed identity.
 after.version='b'.repeat(64);
 if(after.plan.sessions[0]){after.plan.sessions[0].state='active';after.plan.sessions[0].scheduleState='active';}
 after.plan.sessionStates[correctionDate].state='active';
 const run=createAgentEditApiHandler({enabled:()=>true,rpc:async(_name,args)=>{
  calls.push(args);
  if(args.p_action==='context')return {error:null,data:{data:context}};
  if(args.p_action==='preview') {
   if(previewError)return {error:previewError,data:null};
   const command=args.p_input.command;
   const shared={kind:command.kind,classId:context.id,lessonId:command.lessonId,date:command.date,expectedState:command.expectedState,state:command.state,planHash:'e'.repeat(64),unknownOccupancyReviewHash:correctionHash,unknownOccupancyCount:23,warnings:[{code:'unknown_occupancy',count:23}],beforeContext:context,window:command.window,otherClassDetails:'SECRET_OTHER_CLASS',privateUnexpected:'SECRET_REVIEW'};
   if(!command.acknowledgeUnknownOccupancy)return {error:null,data:{data:transformPreview({...shared,reviewOnly:true,reviewRequired:true,previewToken:null,afterContext:context,notifications:{state:'not_requested'}})}};
   return {error:null,data:{data:transformPreview({...shared,reviewOnly:false,reviewRequired:false,previewToken:id(20),expiresAt:'2099-01-01T00:00:00Z',afterContext:after,notifications:{state:'not_requested'}})}};
  }
  const key=args.p_input.requestKey;
  if(args.p_action==='commit') {
   if(!receipts.has(key)) receipts.set(key,{operationId:key,state:'applied',kind:'past_lesson_state_correction',classContext:after,window:{from:correctionDate,to:correctionDate}});
   return {error:null,data:{data:receipts.get(key)}};
  }
  if(args.p_action==='operation')return {error:null,data:{data:receipts.get(key)||{operationId:key,state:'unknown',retryWithNewKey:false}}};
  throw Error('unexpected synthetic RPC');
 }});
 const parts=['classes',context.id,'lesson-state-corrections','preview'];
 return {context,after,calls,receipts,run,parts,preview:body=>run(req(parts.join('/'),body),parts)};
}

test('past correction HTTP reviews unknown counts without a token, then previews only the acknowledged exact stored state',async()=>{
 const h=correctionHarness(),original=structuredClone(h.context),input=correctionInput(h.context);
 const review=await h.preview(input);assert.equal(review.status,200);
 const first=await review.json();
 assert.equal(first.data.reviewOnly,true);assert.equal(first.data.unknownOccupancyCount,23);assert.equal(first.data.blockerReviewHash,correctionHash);
 assert.equal(first.data.previewToken,null);assert.equal(first.data.reviewRequired,true);assert.ok(!Object.hasOwn(first.data,'after'));
 assert.equal(first.data.before.version,input.expectedVersion,'review-only preview retains the unchanged baseline version');
 assert.deepEqual(first.data.before,classWorkspace(original,{from:correctionDate,to:correctionDate}));
 assert.equal(first.data.before.capabilities.pastChanges,false);
 assert.deepEqual([first.data.before.lessons[0].startMinute,first.data.before.lessons[0].endMinute],[600,660],'raw historical times take precedence over current weekly defaults');
 const acknowledged={...input,blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:true};
 const preview=await h.preview(acknowledged);assert.equal(preview.status,200);
 const second=await preview.json();assert.equal(second.data.reviewOnly,false);assert.equal(second.data.previewToken,id(20));
 assert.equal(second.data.after.lessons[0].state,'scheduled');assert.equal(second.data.before.lessons[0].id,second.data.after.lessons[0].id);
 assert.deepEqual(second.data.before,first.data.before,'acknowledgment does not change the before projection');
 assert.equal(second.data.after.version,h.after.version);assert.notEqual(second.data.after.version,second.data.before.version);
 const expectedLessons=second.data.before.lessons.map(row=>row.id===input.lessonId&&row.date===input.date?{...row,state:input.nextState}:row);
 const expectedHash=createHash('sha256').update(JSON.stringify({basic:second.data.before.basic,weeklySlots:second.data.before.weeklySlots,lessons:expectedLessons}),'utf8').digest('hex');
 assert.notEqual(expectedHash,second.data.before.verificationHash);
 assert.deepEqual(second.data.after,{...second.data.before,version:h.after.version,verificationHash:expectedHash,lessons:expectedLessons},
  'only the opaque version, derived hash and selected lesson state differ');
 assert.deepEqual(Object.keys(second.data.after).filter(key=>JSON.stringify(second.data.after[key])!==JSON.stringify(second.data.before[key])),
  ['version','lessons','verificationHash']);
 assert.deepEqual(Object.keys(second.data.after.lessons[0]).filter(key=>second.data.after.lessons[0][key]!==second.data.before.lessons[0][key]),['state']);
 assert.deepEqual(h.calls.map(call=>call.p_action),['context','preview','context','preview']);
 const command=h.calls[3].p_input.command;
 assert.deepEqual(command,{kind:'past_lesson_state_correction',lessonId:input.lessonId,date:correctionDate,expectedState:'skipped',state:'active',reason:input.reason,window:{from:correctionDate,to:correctionDate},unknownOccupancyReviewHash:correctionHash,acknowledgeUnknownOccupancy:true});
 assert.ok(!JSON.stringify([first,second]).includes('SECRET'));
 assert.deepEqual(h.context,original,'the compiler and projections never mutate the raw baseline');
});

test('past correction HTTP rejects arbitrary fields and incomplete acknowledgment before any RPC',async()=>{
 const input=correctionInput(correctionContext());
 for(const changes of [{timing},{makeup:null},{basic:{name:'x'}},{lessons:[]},{classId:id(3)},{expectedState:'active'},{nextState:'skipped'},
  {expectedState:'undecided'},{blockerReviewHash:correctionHash},{acknowledgeUnknownOccupancy:true},{blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:false},{blockerReviewHash:'bad',acknowledgeUnknownOccupancy:true}]) {
  const h=correctionHarness();assert.equal((await h.preview({...input,...changes})).status,400,JSON.stringify(changes));assert.equal(h.calls.length,0);
 }
});

test('past correction HTTP uses raw stored occupancy and refuses virtual, ambiguous, linked, current and stale rows',async()=>{
 const cases=[
  ['raw missing occupancy',c=>{for(const field of ['startTime','endTime','teacherCatalogId','classroomCatalogId'])delete c.plan.sessions[0][field];delete c.plan.sessionSchedules[correctionDate];},null,'agent_timing_required'],
  ['raw names alone do not assign occupancy',c=>{delete c.plan.sessions[0].teacherCatalogId;c.plan.sessions[0].teacherName='T';},null,'agent_timing_required'],
  ['invalid exact catalog',c=>{c.plan.sessions[0].teacherCatalogId=id(99);c.plan.sessionSchedules[correctionDate].teacherCatalogId=id(99);},null,'agent_invalid_catalog'],
  ['duplicate date',c=>c.plan.sessions.push({...c.plan.sessions[0],id:'duplicate',sessionKey:'duplicate'}),null,'agent_ambiguous_lesson'],
  ['duplicate identity',c=>{c.plan.sessions[1].id=c.plan.sessions[0].id;},null,'agent_ambiguous_lesson'],
  ['forced row',c=>{c.plan.sessions[0].isForced=true;},null,'agent_edit_makeup_source'],
  ['malformed forced flag',c=>{c.plan.sessions[0].isForced='false';},null,'agent_edit_makeup_source'],
  ['identity fallback cannot replace raw ID',c=>{delete c.plan.sessions[0].id;},null,'agent_stale'],
  ['makeup source',c=>{c.plan.sessions[0].makeupDate='2001-01-05';},null,'agent_edit_makeup_source'],
  ['linked row',c=>{c.plan.sessions[0].originalDate='2001-01-01';},null,'agent_edit_makeup_source'],
  ['linked child',c=>{c.plan.sessions[1].originalDate=correctionDate;},null,'agent_edit_makeup_source'],
  ['contradictory date map',c=>{c.plan.sessionSchedules[correctionDate].startTime='11:00';},null,'agent_timing_required'],
  ['contradictory state map',c=>{c.plan.sessionStates[correctionDate].state='active';},null,'agent_edit_makeup_source'],
  ['normalized storage',c=>{c.storageMode='normalized';},null,'agent_invalid'],
  ['virtual row',c=>{c.plan.sessions=[];},null,'agent_stale'],
  ['stale version',()=>{},{expectedVersion:'f'.repeat(64)},'agent_stale'],
  ['stale state',()=>{},{expectedState:'scheduled'},'agent_stale'],
  ['no change',c=>{c.plan.sessions[0].state='active';c.plan.sessions[0].scheduleState='active';c.plan.sessionStates[correctionDate].state='active';},{expectedState:'scheduled',nextState:'scheduled'},'agent_no_change'],
  ['cancel skipped state',()=>{},{expectedState:'skipped',nextState:'cancelled'},null],
 ];
 for(const [label,mutate,patch,code]of cases) {
  const context=correctionContext(),input=correctionInput(context);mutate(context);const h=correctionHarness(context),res=await h.preview({...input,...patch});
  if(code){assert.equal(res.status,code==='agent_stale'?409:422,label);assert.equal((await res.json()).error.code,code,label);assert.deepEqual(h.calls.map(call=>call.p_action),['context'],label)}
  else {assert.equal(res.status,200,label)}
 }
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 for(const date of [today,'2099-01-01']) {
  const h=correctionHarness();h.context.plan.sessions[0].date=date;
  const res=await h.preview({...correctionInput(h.context),date});assert.equal(res.status,422);assert.equal((await res.json()).error.code,'agent_invalid_range');assert.equal(h.calls.length,1);
 }
});

test('past correction keeps known collisions, authorization and changed blocker review as typed failures',async()=>{
 for(const [message,code,status,publicCode]of [['timetable_resource_conflict','23P01',409,'timetable_resource_conflict'],['agent_review_stale','P0001',409,'agent_review_stale'],['agent_forbidden','42501',403,'agent_forbidden'],['agent_scope_forbidden','42501',403,'agent_scope_forbidden']]) {
  const h=correctionHarness(undefined,{message,code,details:'SECRET_SQL'});
  const res=await h.preview({...correctionInput(h.context),blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:true});
  assert.equal(res.status,status);const body=await res.json();assert.equal(body.error.code,publicCode);assert.equal(body.data,null);
  assert.deepEqual(h.calls.map(call=>call.p_action),['context','preview']);assert.ok(!JSON.stringify(body).includes('SECRET'));
 }
});

test('past correction preview uses existing operation keys and receipt recovery without another preview',async()=>{
 const h=correctionHarness();const preview=await h.preview({...correctionInput(h.context),blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:true});
 assert.equal(preview.status,200);const expected=await preview.json(),key=id(21);
 const body={previewToken:expected.data.previewToken};
 for(let i=0;i<2;i++) {
  const res=await h.run(req('operations',body,{'Idempotency-Key':key}),['operations']);assert.equal(res.status,200);
  const receipt=await res.json();assert.equal(receipt.data.operationId,key);assert.equal(receipt.data.state,'applied');
  assert.equal(receipt.data.class.id,expected.data.before.id);assert.equal(receipt.data.class.verificationHash,expected.data.after.verificationHash);
  assert.equal(receipt.data.class.version,expected.data.after.version,'synthetic applied receipt uses the corrected context');
 }
 const read=await h.run(req('operations/'+key),['operations',key]);assert.equal(read.status,200);
 assert.equal((await read.json()).data.state,'applied');assert.equal(h.receipts.size,1);
 assert.deepEqual(h.calls.map(call=>call.p_action),['context','preview','commit','commit','operation']);
 const ordinary=await h.run(req('classes/'+h.context.id+'/changes/preview',{expectedVersion:h.context.version,window:{from:correctionDate,to:correctionDate},reason:'ordinary past still forbidden',lessons:[{date:correctionDate,state:'scheduled'}]}),['classes',h.context.id,'changes','preview']);
 assert.equal(ordinary.status,422);assert.equal((await ordinary.json()).error.code,'agent_past_change');
});

test('past correction projects accepted single-digit historical hours without inheriting current weekly times',async()=>{
 const context=correctionContext();context.plan.sessions[0].startTime='9:00';context.plan.sessions[0].endTime='10:00';
 Object.assign(context.plan.sessionSchedules[correctionDate],{startTime:'9:00',endTime:'10:00'});
 context.catalogs.teachers[0].isVisible=false;context.catalogs.classrooms[0].isVisible=false;
 const original=structuredClone(context),h=correctionHarness(context),res=await h.preview(correctionInput(context));
 assert.equal(res.status,200);const body=await res.json();assert.deepEqual([body.data.before.lessons[0].startMinute,body.data.before.lessons[0].endMinute],[540,600]);assert.deepEqual(context,original);
});

test('past correction rejects malformed or mismatched producer target, acknowledgment and token shapes',async()=>{
 const variants=[
  ['wrong kind',data=>({...data,kind:'ordinary'})],['wrong class',data=>({...data,classId:id(99)})],['wrong ID',data=>({...data,lessonId:'wrong'})],
  ['wrong date',data=>({...data,date:'2001-01-05'})],['wrong expected state',data=>({...data,expectedState:'active'})],['wrong next state',data=>({...data,state:'exception'})],
  ['wrong window',data=>({...data,window:{from:correctionDate,to:'2001-01-11'}})],['missing token',data=>({...data,previewToken:undefined})],
  ['bad token',data=>({...data,previewToken:'bad'})],['bad expiry',data=>({...data,expiresAt:'not-a-date'})],['wrong ack hash',data=>({...data,unknownOccupancyReviewHash:'f'.repeat(64)})],
  ['wrong phase',data=>({...data,reviewOnly:true,reviewRequired:true,previewToken:null})],['wrong phase flag',data=>({...data,reviewRequired:true})],
  ['no after',data=>({...data,afterContext:undefined})],['unchanged after',data=>({...data,afterContext:data.beforeContext})],
  ['changed occupancy',data=>{const next=structuredClone(data);next.afterContext.plan.sessions[0].startTime='10:30';return next;}],
  ['changed teacher',data=>{const next=structuredClone(data);next.afterContext.plan.sessions[0].teacherCatalogId=id(99);return next;}],
  ['changed room',data=>{const next=structuredClone(data);next.afterContext.plan.sessions[0].classroomCatalogId=id(99);return next;}],
  ['changed lesson identity',data=>{const next=structuredClone(data);next.afterContext.plan.sessions[0].id='different-lesson';return next;}],
  ['added lesson',data=>{const next=structuredClone(data);next.afterContext.plan.sessions.push({...next.afterContext.plan.sessions[0],id:'extra-lesson'});return next;}],
  ['changed basic fields',data=>{const next=structuredClone(data);next.afterContext.basic.name='Unrequested';return next;}],
  ['changed weekly slot',data=>{const next=structuredClone(data);next.afterContext.weeklySlots[0].startMinute=900;return next;}],
  ['changed weekly completeness',data=>{const next=structuredClone(data);next.afterContext.weeklyScheduleComplete=false;return next;}],
  ['changed class identity',data=>{const next=structuredClone(data);next.afterContext.id=id(99);return next;}],
  ['changed before',data=>{const next=structuredClone(data);next.beforeContext.plan.sessions[0].startTime='10:30';return next;}],
  ['missing notifications',data=>({...data,notifications:undefined})],['notification requested',data=>({...data,notifications:{state:'sent'}})],
  ['negative warning count',data=>({...data,unknownOccupancyCount:-1})],
 ];
 for(const [label,change]of variants) {
  const h=correctionHarness(undefined,null,change),res=await h.preview({...correctionInput(h.context),blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:true});
  assert.equal(res.status,503,label);const body=await res.json();assert.equal(body.data,null,label);assert.equal(body.error.code,'agent_api_unavailable',label);assert.ok(!JSON.stringify(body).includes('SECRET'));
 }
 const h=correctionHarness(undefined,null,data=>({...data,reviewOnly:false,reviewRequired:false,previewToken:id(20),expiresAt:'2099-01-01T00:00:00Z'}));
 assert.equal((await h.preview(correctionInput(h.context))).status,503,'unacknowledged request can never expose a committable token');
 const zero=correctionHarness(undefined,null,data=>({...data,unknownOccupancyCount:0,warnings:[]}));
 const review=await zero.preview(correctionInput(zero.context));assert.equal(review.status,200);const body=await review.json();assert.equal(body.data.reviewRequired,true);assert.equal(body.data.previewToken,null);assert.deepEqual(body.data.warnings,[]);
});

test('unknown v2 RPC failures correlate safe diagnostics by processing phase without exposing errors or request content',async()=>{
 const context=correctionContext(),input=correctionInput(context),parts=['classes',context.id,'lesson-state-corrections','preview'];
 for(const [phase,path,route,body,headers]of [
  ['context',parts.join('/'),parts,input,{}],['preview',parts.join('/'),parts,input,{}],
  ['commit','operations',['operations'],{previewToken:id(20)},{'Idempotency-Key':id(21)}],
  ['operation','operations/'+id(21),['operations',id(21)],undefined,{}],['health','health',['health'],undefined,{}],
 ]) {
  const logs=[],actions=[];
  const run=createAgentEditApiHandler({enabled:()=>true,logError:entry=>logs.push(entry),rpc:async(_name,args)=>{
   actions.push(args.p_action);
   if(args.p_action!==phase)return {error:null,data:{data:context}};
   return {data:null,error:{message:'SECRET_SQL_MESSAGE '+token,details:'SECRET_STUDENT',hint:'https://SECRET_HOST/',code:'XX000'}};
  }});
  const res=await run(req(path,body,{...headers,'X-Request-Id':'SECRET_CLIENT_REQUEST'}),route),result=await res.json();
  assert.equal(res.status,503);assert.equal(result.data,null);assert.equal(result.error.code,'agent_api_unavailable');
  assert.match(result.error.requestId,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);assert.equal(result.error.phase,phase);assert.equal(result.error.sqlstate,'XX000');
  assert.equal(res.headers.get('x-request-id'),result.error.requestId);assert.deepEqual(logs,[result.error]);
  assert.ok(!JSON.stringify([result,logs]).includes('SECRET'));assert.ok(!JSON.stringify([result,logs]).includes(token));
  assert.deepEqual(actions,phase==='preview'?['context','preview']:[phase]);
 }
});

test('unknown v2 diagnostics reject malformed SQLSTATEs and safely classify rejected transport, compile and projection failures',async()=>{
 const context=correctionContext(),input=correctionInput(context),parts=['classes',context.id,'lesson-state-corrections','preview'];
 for(const code of [undefined,'xx000',' XX000','XX000\n','SECRET_CODE','https://SECRET_HOST/',503]) {
  const logs=[];const run=createAgentEditApiHandler({enabled:()=>true,logError:entry=>logs.push(entry),rpc:async()=>({data:null,error:{code,message:'SECRET_SQL'}})});
  const res=await run(req('health'),['health']),body=await res.json();
  assert.equal(res.status,503);assert.ok(!Object.hasOwn(body.error,'sqlstate'),String(code));assert.equal(body.error.phase,'health');assert.deepEqual(logs,[body.error]);assert.ok(!JSON.stringify([body,logs]).includes('SECRET'));
 }
 for(const [phase,rpc]of [
  ['context',async()=>{throw Object.assign(Error('SECRET_FETCH '+token),{code:'ECONNRESET',stack:'SECRET_STACK'});}],
  ['compile',async()=>({error:null,data:{data:{version:context.version,storageMode:'legacy',get plan(){throw Error('SECRET_COMPILE');}}}})],
  ['projection',async(_name,args)=>({error:null,data:{data:args.p_action==='context'?context:{kind:'past_lesson_state_correction',reviewOnly:true,unknownOccupancyReviewHash:'bad',unknownOccupancyCount:23}}})],
 ]) {
  const logs=[];const run=createAgentEditApiHandler({enabled:()=>true,rpc,logError:entry=>logs.push(entry)});
  const res=await run(req(parts.join('/'),input),parts),body=await res.json();
  assert.equal(res.status,503);assert.equal(body.error.phase,phase);assert.ok(!Object.hasOwn(body.error,'sqlstate'));assert.deepEqual(logs,[body.error]);assert.ok(!JSON.stringify([body,logs]).includes('SECRET'));
 }
});

test('known v2 failures preserve their existing typed envelopes without diagnostic logs',async()=>{
 for(const [code,sqlstate,status]of [['agent_stale','P0001',409],['agent_forbidden','42501',403],['agent_invalid','22023',422],['agent_write_failed','XX000',503]]) {
  const logs=[];const run=createAgentEditApiHandler({enabled:()=>true,logError:entry=>logs.push(entry),rpc:async()=>({data:null,error:{message:code,code:sqlstate,details:'SECRET'}})});
  const res=await run(req('health'),['health']);assert.equal(res.status,status);assert.deepEqual(await res.json(),{data:null,error:{code}});assert.deepEqual(logs,[]);
 }
});

test('published past-correction schemas accept real review, preview and typed failure envelopes',async()=>{
 const h=correctionHarness(),schemaPath='/classes/{classId}/lesson-state-corrections/preview';
 const openapi=await h.run(req('openapi'),['openapi']),spec=await openapi.json(),operation=spec.paths[schemaPath].post;
 const fromSchema=schema=>z.fromJSONSchema(JSON.parse(JSON.stringify({...schema,$defs:spec.components.schemas}).replaceAll('#/components/schemas/','#/$defs/')));
 const published=spec.components.schemas.PastLessonStateCorrection;
 assert.equal(operation.requestBody.content['application/json'].schema.$ref,'#/components/schemas/PastLessonStateCorrection');
 // Zod reads the published field schema; its reader lacks general JSON Schema
 // `not`, so independently evaluate the published acknowledgment composition.
 const requestSchema=fromSchema({...published,allOf:undefined}),input=correctionInput(h.context);
 const compositionMatches=(schema,value)=>(!schema.required || schema.required.every(key=>Object.hasOwn(value,key)))
  && (!schema.not || !compositionMatches(schema.not,value))
  && (!schema.anyOf || schema.anyOf.some(part=>compositionMatches(part,value)))
  && (!schema.oneOf || schema.oneOf.filter(part=>compositionMatches(part,value)).length===1)
  && (!schema.allOf || schema.allOf.every(part=>compositionMatches(part,value)));
 const validRequest=value=>requestSchema.safeParse(value).success && compositionMatches({allOf:published.allOf},value);
 assert.equal(validRequest(input),true);
 assert.equal(validRequest({...input,blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:true}),true);
 for(const extra of [{timing},{blockerReviewHash:correctionHash},{acknowledgeUnknownOccupancy:true},{acknowledgeUnknownOccupancy:false},{nextState:'skipped'}])assert.equal(validRequest({...input,...extra}),false,JSON.stringify(extra));
 const review=await (await h.preview(input)).json(),preview=await (await h.preview({...input,blockerReviewHash:correctionHash,acknowledgeUnknownOccupancy:true})).json();
 const success=fromSchema(operation.responses['200'].content['application/json'].schema);
 assert.equal(success.safeParse(review).success,true);assert.equal(success.safeParse(preview).success,true);
 for(const bad of [{...review,data:{...review.data,previewToken:id(20)}},{...preview,data:{...preview.data,previewToken:null}},{...preview,data:{...preview.data,after:undefined}}])assert.equal(success.safeParse(bad).success,false);
 const invalid=await h.preview({...input,timing}),invalidBody=await invalid.json();assert.equal(invalid.status,400);
 assert.equal(fromSchema(operation.responses['400'].content['application/json'].schema).safeParse(invalidBody).success,true);
 for(const [message,sqlstate,status]of [['agent_not_found','P0002',404],['agent_review_stale','P0001',409],['agent_unknown_occupancy_ack_required','22023',422],['SECRET_INTERNAL','XX000',503]]) {
  const failed=correctionHarness(undefined,{message,code:sqlstate}),res=await failed.preview(input),body=await res.json();assert.equal(res.status,status);
  assert.equal(fromSchema(operation.responses[status].content['application/json'].schema).safeParse(body).success,true,status);assert.ok(!JSON.stringify(body).includes('SECRET'));
 }
 for(const [body,type,status]of [['x'.repeat(8193),'application/json',413],['{}','text/plain',415]]) {
  const before=h.calls.length,request=new Request('https://tips.test/api/v2/'+h.parts.join('/'),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':type},body});
  const res=await h.run(request,h.parts),result=await res.json();assert.equal(res.status,status);assert.equal(h.calls.length,before);
  assert.equal(fromSchema(operation.responses[status].content['application/json'].schema).safeParse(result).success,true,status);
 }
});
