import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarChange } from '../src/features/agent-api/server/calendar-contract.ts';
import { compileCalendarChange,calendarWorkspace } from '../src/features/agent-api/server/calendar-compiler.mjs';
import { createAgentCalendarHandler } from '../src/features/agent-api/server/http-calendar.ts';
import { agentEditOpenApi } from '../src/features/agent-api/server/openapi-v2.ts';
const id=n=>`ac300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source={url:'https://school.example/calendar',title:'공식 학사일정',authority:'official_school',checkedAt:'2026-09-30T09:00:00Z',publishedOn:'2026-09-29',schoolIdentityEvidence:'학교 이름과 고등학교를 공식 페이지에서 확인'};
const now=Date.parse('2026-09-30T10:00:00Z');
const ctx=()=>({school:{id:id(1),name:'가상고',category:'high'},schoolYear:2026,version:'a'.repeat(64),scienceAreas:['physics'],events:[{id:id(2),title:'중간고사',type:'시험기간',date:'2026-10-01',grade:'고1',content:'SECRET_CONTENT',note:'SECRET_NOTE\n\n[[TIPS_META]] {"rangeEnd":"2026-10-03","textbookScope":"SECRET_SCOPE","custom":"KEEP"}'}]});
const item=extra=>({id:id(2),title:'중간고사',type:'시험기간',start:'2026-10-01',end:'2026-10-05',grade:'고1',source,...extra});
const input=events=>calendarChange.parse({schoolId:id(1),schoolYear:2026,expectedVersion:'a'.repeat(64),reason:'공식 일정 최신화',events});
const compile=(c,i)=>compileCalendarChange(c,i,{now,newId:()=>id(3)});
test('calendar schema bounds and rejects arbitrary patch/deletion/credentials',()=>{
 for(const events of [[],[item({patch:{content:'x'}})],[item({end:'2026-09-01'})],[item({source:{...source,url:'https://user:pass@school.example'}})],[item({source:{...source,url:'file:///etc/passwd'}})],[item({grade:'1'})]]) assert.throws(()=>input(events));
});
test('compiler preserves notes, exam scopes, content and unmentioned events',()=>{
 const c=ctx(),before=structuredClone(c),cmd=compile(c,input([item()]));
 assert.deepEqual(c,before);assert.equal(cmd.events.length,1);assert.equal(cmd.events[0].patch.date,'2026-10-01');
 assert.match(cmd.events[0].patch.note,/SECRET_NOTE/);assert.match(cmd.events[0].patch.note,/SECRET_SCOPE/);assert.match(cmd.events[0].patch.note,/KEEP/);assert.ok(!Object.hasOwn(cmd.events[0].patch,'content'));
 assert.doesNotMatch(JSON.stringify(cmd.diff),/SECRET_/);assert.equal(cmd.diff.changed.length,1);
 const view=calendarWorkspace(c);assert.doesNotMatch(JSON.stringify(view),/SECRET_|note|content|textbookScope/);assert.equal(view.events[0].end,'2026-10-03');
});
test('March-February scope, school identity, grades and sources are validated',()=>{
 for(const event of [item({start:'2026-02-28'}),item({end:'2027-03-01'}),item({grade:'중1'}),item({type:'과학시험일',scienceAreaKey:'unknown'}),item({source:{...source,checkedAt:'2026-10-01T00:00:00Z'}}),item({source:{...source,checkedAt:'2026-01-01T00:00:00Z'}})]) assert.throws(()=>compile(ctx(),input([event])));
 assert.throws(()=>compile(ctx(),{...input([item()]),schoolId:id(9)}),/agent_invalid/);
 assert.throws(()=>compile(ctx(),{...input([item()]),expectedVersion:'b'.repeat(64)}),/agent_stale/);
 assert.equal(compile(ctx(),input([item({id:undefined,title:'종업식',start:'2027-02-20',end:'2027-02-20'})])).events[0].id,id(3));
});
test('duplicates, ambiguous moved events and approval-owned rows never silently overwrite',()=>{
 assert.throws(()=>compile(ctx(),input([item(),item()])),/agent_calendar_duplicate/);
 assert.throws(()=>compile(ctx(),input([item({id:undefined,start:'2026-10-02'})])),/agent_calendar_match_required/);
 assert.equal(compile(ctx(),input([item({id:undefined})])).events[0].id,id(2),'exact duplicate is an update');
 const c=ctx();c.events[0].note+=' [[TIPS_MAKEUP]]';assert.throws(()=>compile(c,input([item()])),/agent_approval_workflow_required/);
});
test('older or lower-authority provenance requires an explicit resolution',()=>{
 const c=ctx();c.events[0].source={...source,publishedOn:'2026-09-30'};
 assert.throws(()=>compile(c,input([item()])),/agent_calendar_source_conflict/);
 assert.equal(compile(c,input([item({conflictResolution:'학교가 정정 공지를 확인하도록 안내함'})])).events[0].source.conflictResolution,'학교가 정정 공지를 확인하도록 안내함');
});
test('malformed legacy metadata is preserved by refusing a destructive rewrite',()=>{
 const c=ctx();c.events[0].note='KEEP [[TIPS_META]] {broken';
 assert.throws(()=>compile(c,input([item()])),/agent_calendar_metadata_invalid/);
 assert.equal(c.events[0].note,'KEEP [[TIPS_META]] {broken');
});
test('stable public hashes match repeated context and exclude private-only changes',()=>{
 const c=ctx(),v=calendarWorkspace(c);c.events[0].content='PRIVATE_CHANGED';
 assert.equal(v.verificationHash,calendarWorkspace(c).verificationHash);c.events[0].date='2026-10-02';assert.notEqual(v.verificationHash,calendarWorkspace(c).verificationHash);
});
const token='tips_agent_'+'e'.repeat(64);
const req=(path,body,extra={})=>new Request('https://tips.test/api/v2/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
test('HTTP scopes, strict queries, private projection and calendar receipt recovery',async()=>{
 const calls=[];const handler=createAgentCalendarHandler({enabled:()=>true,rpc:async(name,args)=>{calls.push([name,args]);return {error:null,data:{data:args.p_action==='context'?ctx():{operationId:id(8),kind:'calendar',state:'applied',calendarContext:ctx(),privateUnexpected:'SECRET'}}};}});
 const get=await handler(req(`calendar/schools/${id(1)}?schoolYear=2026`),['calendar','schools',id(1)]);assert.equal(get.status,200);assert.doesNotMatch(await get.text(),/SECRET/);
 const receipt=await handler(req(`calendar/operations/${id(8)}`),['calendar','operations',id(8)]);assert.equal(receipt.status,200);const data=(await receipt.json()).data;assert.equal(data.calendar.verificationHash,calendarWorkspace(ctx()).verificationHash);assert.ok(!data.privateUnexpected);assert.equal(calls.at(-1)[1].p_action,'operation');
 assert.equal(calls[0][0],'agent_calendar_api_v1');assert.ok(!JSON.stringify(calls).includes(token));
 assert.equal((await handler(req('calendar/schools?page=1&page=2'),['calendar','schools'])).status,400);
 assert.equal((await handler(req('calendar/operations',{previewToken:id(8)}),['calendar','operations'])).status,400);
});
test('HTTP auth/failure contracts and documented input are consistent',async()=>{
 const h=createAgentCalendarHandler({enabled:()=>true,rpc:async()=>({error:{message:'agent_scope_forbidden',code:'42501'},data:null})});
 assert.equal((await h(new Request('https://tips.test'),['calendar','schools'])).status,401);
 assert.equal((await h(req('calendar/schools'),['calendar','schools'])).status,403);
 const f=createAgentCalendarHandler({enabled:()=>true,rpc:async()=>({error:null,data:{data:{operationId:id(8),kind:'calendar',state:'failed',error:{code:'agent_stale',sqlstate:'P0001'}}}})});
 assert.equal((await f(req('calendar/operations',{previewToken:id(9)},{'idempotency-key':id(8)}),['calendar','operations'])).status,409);
 assert.equal((await f(req(`calendar/operations/${id(8)}`),['calendar','operations',id(8)])).status,200);
 assert.ok(agentEditOpenApi.paths['/calendar/changes/preview']);assert.equal(agentEditOpenApi.components.schemas.CalendarChange.properties.events.maxItems,100);
});
