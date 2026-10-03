import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createAiAgentRouteHandler} from '../src/features/ai-agent/server/ai-agent-routes.ts';
import {createAiAgentSpacePolicyHandler} from '../src/features/ai-agent/server/ai-agent-space-policy-route.ts';
import {parseAiAgentOutput} from '../src/features/ai-agent/server/ai-agent-repository.ts';
import {aiSpaceCatalogSchema,aiSpacePermissionSchema} from '../src/features/ai-agent/ai-agent-request-contract.ts';
const fixture=process.env.TASK_AI_HTTP_CAPTURE;
const key='aa030000-0000-4000-8000-000000000002';
const nonce='a'.repeat(64),bot='tips_agent_'+'b'.repeat(64);
function wire(row,rows) {
 const {operation:op,data,name}=row;const request=data.request??data;const id=request.id??data.action?.requestId??data.items?.[0]?.requestId;const before=value=>(BigInt(value)-BigInt(1)).toString();
 const headers={'Idempotency-Key':key,Authorization:row.kind==='bot'?`Bearer ${bot}`:'Bearer synthetic-user'};
 let route={kind:'request',id};let method='GET',body,query='';
 if(op==='list'){route={kind:'requests'};query=row.kind==='bot'?'?status=pending&limit=50':'?page=1&pageSize=10&scope=own';}
 if(op==='create'){route={kind:'requests'};method='POST';body={title:data.title,body:data.body,notifyOnDone:false};}
 if(op==='activity'){query=name==='historyLast'?'?afterMessageSeq=50&limit=50':'';}
 if(op==='actions'){route={kind:'actions',id:data.items[0].requestId};query=name==='actionsLast'?'?limit=50&cursor='+encodeURIComponent(rows.find(row=>row.name==='actions').data.nextCursor):'?limit=50';}
 if(op==='action_events'){route={kind:'action',id:data.action.requestId,actionId:data.action.id};query=name==='actionEventsLast'?'?limit=50&cursor='+encodeURIComponent(rows.find(row=>row.name==='actionEvents').data.nextCursor):'?limit=50';}
 if(['claim','renew','progress','question','done'].includes(op)){
  method='PATCH';headers['X-Claim-Token']=nonce;headers['If-Match']=`"r${op==='renew'?request.version:before(request.version)}"`;
  if(op!=='claim')headers['X-Claim-Generation']=op==='renew'?data.claim.generation:'1';
  body=op==='done'?{status:'done',result:request.result??'synthetic completed'}:op==='question'?{status:'question',message:data.message.text}:op==='progress'?{status:'processing',message:data.message.text}:{status:'processing'};
 }
 if(op==='append_message'){route={kind:'messages',id:data.request.id};method='POST';headers['If-Match']=`"r${before(data.request.version)}"`;body={kind:data.message.kind,text:data.message.text,questionId:data.message.questionId};}
 if(op==='cancel'){method='PATCH';headers['If-Match']=`"r${before(data.version)}"`;body={status:'cancelled'};}
 if(op==='resume'){route={kind:'resume',id:data.id};method='POST';headers['If-Match']=`"r${before(data.version)}"`;body={reason:'synthetic expired review',confirmed:true};}
 if(op==='register_action'){route={kind:'actions',id:data.requestId};method='POST';headers['X-Claim-Token']=nonce;headers['X-Claim-Generation']=data.generation;body={actionKey:data.actionKey,stepKey:data.stepKey,kind:data.kind,target:data.target,payload:data.payload,payloadHash:data.payloadHash};}
 if(op==='start_action'||op==='record_action'){route={kind:'action',id:data.requestId,actionId:data.id};method='PATCH';body={state:op==='start_action'?'started':name==='incident'?'failed':'succeeded',revision:before(data.revision),target:data.target,payloadHash:data.payloadHash};if(op==='start_action'){headers['X-Claim-Token']=nonce;headers['X-Claim-Generation']=data.generation;}else body.evidence=name==='incident'?{code:'synthetic_contradiction'}:{resourceName:'synthetic/item'};}
 if(op==='reconcile_action'){route={kind:'reconcile',id:data.requestId,actionId:data.id};method='POST';body={revision:before(data.revision),outcome:data.state,reason:'synthetic concrete inspection',confirmed:true,evidence:{type:'manual_observation',target:data.target,payloadHash:data.payloadHash,resourceName:'synthetic/item',observedAt:data.updatedAt,observation:'synthetic observed value'}};}
 if(row.kind==='policy'){route=op==='catalog'?{kind:'spaces'}:{kind:'space-permissions',userId:data.userId};if(op==='set'){method='PATCH';headers['If-Match']='"r0"';body={spaceKeys:data.spaceKeys};}}
 return {request:new Request('https://synthetic.invalid/api'+query,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),route};
}
test('actual disposable DB producers pass real strict parsers and HTTP handlers',{skip:!fixture},async()=>{
 const captured=JSON.parse(await readFile(fixture,'utf8'));
 assert.deepEqual(captured.provenance,{kind:'actual_disposable_db_gateway',synthetic:true,providerCalls:0,rolledBack:true});
 assert.equal(captured.captures.length,34);
 for(const row of captured.captures){
  const parsed=row.kind==='policy'?(row.operation==='catalog'?aiSpaceCatalogSchema:aiSpacePermissionSchema).parse(row.data):parseAiAgentOutput(row.operation,row.kind,row.data);
  assert.deepEqual(parsed,row.data,row.name+' strict parser');
  const administrator=captured.captures.find(row=>row.name==='actionEventsLast').data.events[0].actorId;
  const owner=captured.captures.find(row=>row.name==='created').data.requesterId;
  const adminNames=['resumed','reconciled','actions','actionsLast','actionEvents','actionEventsLast','catalogAdmin','policyMissing','policySet','policyGet'];
  const role=adminNames.includes(row.name)?'admin':'staff';
  const calls=[];const rpc=async(name,input)=>{calls.push({name,input});return {data:row.data,error:null}};
  const dependencies={employeeClient:()=>({auth:{getUser:async()=>({data:{user:{id:role==='admin'?administrator:owner}},error:null})},rpc:async(name,input)=>name==='current_dashboard_role'?{data:role,error:null}:rpc(name,input)}),botRpc:rpc};
  const handler=row.kind==='policy'?createAiAgentSpacePolicyHandler(dependencies):createAiAgentRouteHandler(dependencies);
  const {request,route}=wire(row,captured.captures);const response=await handler(request,route);
  assert.equal(response.status,200,row.name+' HTTP');assert.deepEqual(await response.json(),{data:row.data,error:null},row.name+' envelope');
  assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal(calls.length,1,row.name+' single scoped call');assert.equal(calls[0].input.p_action,row.operation,row.name+' operation');
  assert.equal(calls[0].name,row.kind==='policy'?'ai_agent_space_policy_api_v1':row.kind==='bot'?'ai_agent_bot_api_v1':'ai_agent_user_api_v1');
 }
 const get=name=>captured.captures.find(row=>row.name===name).data;
 assert.equal(get('renewed').request.version,get('claimed').request.version);assert.equal(get('renewed').request.updatedAt,get('claimed').request.updatedAt);
 assert.equal(get('historyFirst').messages.length,50);assert.equal(get('historyLast').messages.at(-1).seq,'56');assert.equal(get('historyLast').messages.at(-1).questionId,get('question').message.id);
 assert.equal(new Set([...get('actions').items,...get('actionsLast').items].map(row=>row.id)).size,60);
 assert.equal(get('actionEvents').events.length+get('actionEventsLast').events.length,56);
 assert.equal(get('actionEventsLast').events.at(-1).kind,'reconciled_manual_observation');
 assert.deepEqual(Object.keys(get('minimalEndedDoneReplay').request).sort(),['id','status','version']);
 assert.equal(get('notification').request.status,'done');assert.equal(get('notification').notification.reason,'space_permission_revoked');
 assert.equal(get('policyMissing').revision,'0');assert.equal(get('policySet').revision,'1');
});
