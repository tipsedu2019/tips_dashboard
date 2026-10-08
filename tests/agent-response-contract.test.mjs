import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { createAgentResponseContract } from '../src/features/agent-api/server/response-contract.ts';
import { createAgentApiHandler } from '../src/features/agent-api/server/http.ts';
import { createAgentEditApiHandler } from '../src/features/agent-api/server/http-v2.ts';
import { createAgentCalendarHandler } from '../src/features/agent-api/server/http-calendar.ts';
import { createPersonalDashboardReadHandler } from '../src/features/agent-api/server/personal-dashboard-read.ts';
import { createAiAgentRouteHandler } from '../src/features/ai-agent/server/ai-agent-routes.ts';
import { createAiAgentSpacePolicyHandler } from '../src/features/ai-agent/server/ai-agent-space-policy-route.ts';
import { agentOpenApi } from '../src/features/agent-api/server/openapi.ts';
import { agentEditOpenApi } from '../src/features/agent-api/server/openapi-v2.ts';

const id='b5100000-0000-4000-8000-000000000001', key='b5100000-0000-4000-8000-000000000002';
const token='tips_agent_'+'a'.repeat(64), personal='tips_dashboard_personal_'+'b'.repeat(64);
const at='2099-10-01T00:00:00Z';
const req=(method='GET',body,extra={})=>new Request('https://synthetic.invalid/not-used-for-links?private=synthetic',{
  method,headers:{authorization:`Bearer ${token}`,'X-Request-Id':'caller-secret-marker',...(body?{'content-type':'application/json'}:{}),...extra},
  ...(body?{body:JSON.stringify(body)}:{}),
});
const cleanReq=(method='GET',body,extra={})=>new Request('https://synthetic.invalid/api/v2/operations',req(method,body,extra));
const header=(r,name)=>r.headers.get('X-Agent-'+name);
function assertPrivateHeaders(res) {
  assert.match(res.headers.get('X-Request-Id'),/^[0-9a-f-]{36}$/);
  const text=JSON.stringify([...res.headers]);
  for(const secret of [token,personal,createHash('sha256').update(token).digest('hex'),'caller-secret-marker','synthetic.invalid','private=']) assert.ok(!text.includes(secret));
}
const businessHandlers=[['v1',createAgentApiHandler,'/api/v1/operations/'],['v2',createAgentEditApiHandler,'/api/v2/operations/'],['calendar',createAgentCalendarHandler,'/api/v2/calendar/operations/']];

for(const [family,create,path] of businessHandlers) {
  const parts=family==='calendar'?['calendar','operations']:['operations'];
  test(`${family}: uncertain commit retains error and links only the same receipt, without retrying`,async()=>{
    let calls=0;const logs=[];
    const run=create({enabled:()=>true,rpc:async()=>{calls++;throw new Error(token)},logError:x=>logs.push(x)});
    const res=await run(cleanReq('POST',{previewToken:id},{'Idempotency-Key':key}),parts);
    assert.equal(res.status,503);assert.equal(calls,1);assert.equal(header(res,'Retryable'),'false');assert.equal(header(res,'Recovery'),'lookup-receipt');
    assert.equal(header(res,'Result-Path'),path+key);assert.equal(header(res,'Result-Kind'),'receipt');assert.equal(header(res,'Credential-Kind'),null);
    const body=await res.json();assert.equal(body.data,null);assert.equal(body.error.code,'agent_api_unavailable');
    if(family==='v2'){assert.equal(body.error.requestId,res.headers.get('X-Request-Id'));assert.equal(logs[0].requestId,body.error.requestId);}
    assert.ok(!JSON.stringify({body,logs}).includes(token));assertPrivateHeaders(res);
  });
  test(`${family}: failed/unknown receipts are never relabeled; reads and writes get distinct recovery`,async()=>{
    for(const state of ['failed','unknown']) {
      const receipt={operationId:key,state,...(state==='failed'?{error:{code:'agent_stale',sqlstate:'P0001'}}:{retryWithNewKey:false})};
      let calls=0;const run=create({enabled:()=>true,rpc:async()=>{calls++;return {data:{data:receipt},error:null}}});
      const res=await run(cleanReq(),[...parts,key]);assert.equal(res.status,200);assert.equal(calls,1);
      assert.deepEqual((await res.json()).data,receipt);
      assert.equal(header(res,'Retryable'),state==='unknown'?'true':'false');assert.equal(header(res,'Recovery'),state==='unknown'?'lookup-receipt':'stop');
      assert.equal(header(res,'Result-Path'),path+key);assert.equal(header(res,'Credential-Kind'),'business_connection');assertPrivateHeaders(res);
    }
  });
  test(`${family}: denied/malformed calls disclose no accepted identity or result link`,async()=>{
    let calls=0;const run=create({enabled:()=>true,rpc:async()=>{calls++;return {data:null,error:{message:'agent_scope_forbidden',code:'42501'}}}});
    const denied=await run(cleanReq('POST',{previewToken:id},{'Idempotency-Key':key}),parts);
    assert.equal(denied.status,403);assert.equal(calls,1);assert.equal(header(denied,'Credential-Kind'),null);assert.equal(header(denied,'Result-Path'),null);assert.equal(header(denied,'Recovery'),'stop');
    const invalid=await run(cleanReq('POST',{previewToken:id},{'Idempotency-Key':token}),parts);
    assert.equal(invalid.status,400);assert.equal(calls,1);assert.equal(header(invalid,'Result-Path'),null);assertPrivateHeaders(invalid);
  });
}

test('business health keeps the exact existing grant/expiry body and uses only the existing RPC',async()=>{
  const data={apiVersion:'1',credentialId:id,executor:'synthetic connection',scopes:['classes:read'],classIds:[],classAccess:{mode:'legacy_all_read',includesFutureClasses:false},expiresAt:at,timezone:'Asia/Seoul'};
  const calls=[];const run=createAgentApiHandler({enabled:()=>true,rpc:async(name,args)=>{calls.push({name,args});return {data:{data},error:null}}});
  const res=await run(cleanReq(),['health']);assert.deepEqual(await res.json(),{data,error:null});
  assert.equal(header(res,'Owner-Binding'),'issuing_admin');assert.equal(header(res,'Authorization-State'),'accepted-for-request');
  assert.equal(calls.length,1);assert.equal(calls[0].name,'agent_api_v1');assert.deepEqual(calls[0].args.p_input,{});assertPrivateHeaders(res);
});

test('personal proof uses the existing owner/grant callback without revealing either profile identity',async()=>{
  const owner='b5100000-0000-4000-8000-000000000098';let calls=0;
  const run=createPersonalDashboardReadHandler({enabled:()=>true,rpc:async()=>{calls++;return {error:null,data:{data:{authorization:{credentialId:id,credentialKind:'personal_dashboard_read',ownerProfileId:owner,ownerRole:'teacher',scope:'calendar:read'},resource:{kind:'schools'},context:{items:[],total:0,page:1,pageSize:20}}}}}});
  const res=await run(cleanReq('GET',undefined,{authorization:`Bearer ${personal}`}),['calendar','schools']);
  assert.equal(res.status,200);assert.equal(calls,1);assert.equal(header(res,'Credential-Kind'),'personal_dashboard_read');assert.equal(header(res,'Owner-Binding'),'stored_teacher_owner');
  const body=await res.text();assert.ok(!body.includes(owner));assert.ok(!JSON.stringify([...res.headers]).includes(owner));assertPrivateHeaders(res);
  const forbidden=await run(cleanReq('POST',{previewToken:id},{authorization:`Bearer ${personal}`}),['operations']);
  assert.equal(forbidden.status,403);assert.equal(calls,1);assert.equal(header(forbidden,'Authorization-State'),null);
});

test('published personal read alternatives accept real HTTP projections, not write capabilities',async()=>{
  const school={id,name:'synthetic school',category:'middle'};
  const cases=[
    {path:['classes',id],schemaPath:'/classes/{classId}',query:'?from=2099-10-01&to=2099-10-07',scope:'class-details:read',resource:{kind:'class',id},context:{id,version:'d'.repeat(64),basic:{name:'synthetic class',classType:'regular',subject:'English',subjectAreaKey:null,grade:'1'},storageMode:'normalized',schedule:'',weeklySlots:[{id:key,weekday:1,startMinute:600,endMinute:660,teacherId:key,classroomId:null,sortOrder:0}],plan:{},sessions:[],catalogs:{teachers:[],classrooms:[]},weeklyScheduleComplete:true}},
    {path:['calendar','schools',id],schemaPath:'/calendar/schools/{schoolId}',query:'?schoolYear=2099',scope:'calendar:read',resource:{kind:'calendar',id,schoolYear:2099},context:{school,schoolYear:2099,version:'d'.repeat(64),scienceAreas:[],events:[{id:key,title:'synthetic event',type:'시험기간',date:'2099-10-04',grade:'all'}]}},
  ];
  for(const c of cases) {
    const run=createPersonalDashboardReadHandler({enabled:()=>true,rpc:async()=>({error:null,data:{data:{authorization:{credentialId:key,credentialKind:'personal_dashboard_read',ownerProfileId:key,ownerRole:'teacher',scope:c.scope},resource:c.resource,context:c.context}}})});
    const res=await run(new Request('https://synthetic.invalid/api/v2/'+c.path.join('/')+c.query,{headers:{authorization:`Bearer ${personal}`}}),c.path);
    assert.equal(res.status,200);const body=await res.json();
    const spec=agentEditOpenApi, schema=spec.paths[c.schemaPath].get.responses['200'].content['application/json'].schema;
    const published=z.fromJSONSchema(JSON.parse(JSON.stringify({...schema,$defs:spec.components.schemas}).replaceAll('#/components/schemas/','#/$defs/')));
    assert.equal(published.safeParse(body).success,true);
    const invalid=structuredClone(body);invalid.data.capabilities.readOnly=false;
    assert.equal(published.safeParse(invalid).success,false);
  }
});

function aiDeps(result,error=null) {
  const calls=[];const rpc=async(name,input)=>{calls.push({name,input});return {data:result,error}};
  return {calls,deps:{botRpc:rpc,employeeClient:()=>({auth:{getUser:async()=>({data:{user:{id}},error:null})},rpc:async(name,input)=>name==='current_dashboard_role'?{data:'teacher',error:null}:rpc(name,input)})}};
}
test('AI writes expose current-state recovery, not a fabricated durable receipt or central/personal subtype',async()=>{
  const h=aiDeps(null,{message:'private detail',code:'XX000'});const run=createAiAgentRouteHandler(h.deps);
  const res=await run(cleanReq('PATCH',{status:'processing'},{'Idempotency-Key':key,'If-Match':'"r1"','X-Claim-Token':'c'.repeat(64)}),{kind:'request',id});
  assert.equal(res.status,503);assert.equal(h.calls.length,1);assert.equal(header(res,'Retryable'),'false');assert.equal(header(res,'Recovery'),'inspect-state');
  assert.equal(header(res,'Result-Kind'),'state');assert.equal(header(res,'Result-Path'),`/api/ai-agent/requests/${id}`);assert.equal(header(res,'Credential-Kind'),null);assertPrivateHeaders(res);
  const accepted=aiDeps({request:{id,status:'processing',version:'2'},claim:{generation:'1',leaseExpiresAt:at}});
  const result=await createAiAgentRouteHandler(accepted.deps)(cleanReq('PATCH',{status:'processing'},{'Idempotency-Key':key,'If-Match':'"r1"','X-Claim-Token':'c'.repeat(64)}),{kind:'request',id});
  assert.equal(header(result,'Credential-Kind'),'ai_request');assert.equal(header(result,'Owner-Binding'),'stored_credential_policy');
});
test('AI creation succeeds with existing body and a state link; unknown creation never invents an ID',async()=>{
  const data={id,requesterId:id,requesterName:null,title:'x',body:'y',status:'pending',version:'1',createdAt:at,updatedAt:at,readyAt:at,openQuestionId:null,result:null,notifyOnDone:false,notificationSpace:null};
  for(const success of [true,false]) {
    const h=aiDeps(success?data:null,success?null:{message:'unknown',code:'XX000'});
    const res=await createAiAgentRouteHandler(h.deps)(cleanReq('POST',{title:'x',body:'y'},{authorization:'Bearer synthetic-user','Idempotency-Key':key}),{kind:'requests'});
    assert.equal(h.calls.length,1);assert.equal(header(res,'Retryable'),'false');assert.equal(header(res,'Result-Path'),success?`/api/ai-agent/requests/${id}`:null);
    if(success) assert.deepEqual(await res.json(),{data,error:null});else assert.equal(header(res,'Recovery'),'stop');
  }
});
test('policy authentication failures keep their envelope and expose no other user path',async()=>{
  const h=aiDeps(null);const res=await createAiAgentSpacePolicyHandler(h.deps)(cleanReq('GET',undefined,{authorization:'Bearer synthetic-user'}),{kind:'space-permissions',userId:key});
  assert.equal(res.status,403);assert.deepEqual(await res.json(),{data:null,error:{code:'ai_agent_forbidden'}});assert.equal(h.calls.length,0);assert.equal(header(res,'Result-Path'),null);assertPrivateHeaders(res);
});
test('result locations cannot echo arbitrary URLs, queries, credentials or another API family',()=>{
  for(const path of ['https://evil.invalid/'+key,`/api/v2/operations/${key}?token=${token}`,`/api/v2/students/${id}`,`/api/v2/operations/${token}`]) {
    const c=createAgentResponseContract(req('POST'));c.result('receipt',path);const res=c.finish(Response.json({data:null,error:{code:'agent_api_unavailable'}},{status:503}));
    assert.equal(header(res,'Result-Path'),null);assertPrivateHeaders(res);
  }
});
test('an accepted AI unknown action still requires state inspection and never invites a write retry',()=>{
  const c=createAgentResponseContract(cleanReq('PATCH'));
  c.result('state',`/api/ai-agent/requests/${id}/actions/${key}`);c.accepted('ai_request');
  const body={data:{id:key,state:'unknown'},error:null};const res=c.finish(Response.json(body),body);
  assert.equal(header(res,'Recovery'),'inspect-state');assert.equal(header(res,'Retryable'),'false');assert.equal(header(res,'Result-Kind'),'state');
});
test('disabled is not a retry hint; read rate limits retain Retry-After and never certify ownership',async()=>{
  for(const [enabled,error,retry] of [[false,null,'false'],[true,{message:'agent_rate_limited',code:'54000'},'true']]) {
    const run=createAgentApiHandler({enabled:()=>enabled,rpc:async()=>({data:null,error})});const res=await run(cleanReq(),['health']);
    assert.equal(header(res,'Retryable'),retry);assert.equal(header(res,'Credential-Kind'),null);if(enabled)assert.equal(res.headers.get('Retry-After'),'60');
  }
});
test('public schemas disclose rules, not caller acceptance; all documented responses include common headers',async()=>{
  for(const [spec,create] of [[agentOpenApi,createAgentApiHandler],[agentEditOpenApi,createAgentEditApiHandler]]) {
    for(const item of Object.values(spec.paths))for(const operation of Object.values(item))for(const response of Object.values(operation.responses))assert.ok(response.headers['X-Request-Id']);
    assert.equal(spec['x-tips-credential-contracts'].personal_dashboard_read.ownerBinding,'stored_teacher_owner');
    let calls=0;const run=create({enabled:()=>false,rpc:async()=>{calls++;throw new Error('unexpected')}});
    const res=await run(cleanReq(),['openapi']);assert.equal(res.status,200);assert.equal(calls,0);assert.equal(header(res,'Credential-Kind'),null);assertPrivateHeaders(res);
  }
  for(const [path,definition] of Object.entries(agentEditOpenApi.paths))for(const [method,operation] of Object.entries(definition)) {
    const personal=operation.security.some(item=>'personalReadBearer' in item);
    assert.equal(personal,method==='get'&&['/classes/{classId}','/calendar/schools','/calendar/schools/{schoolId}'].includes(path));
  }
});
