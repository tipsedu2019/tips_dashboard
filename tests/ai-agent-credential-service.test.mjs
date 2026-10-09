import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const {createAiAgentCredentialService,credentialIssueSchema,credentialListSchema}=loadNotificationComponent('src/features/ai-agent/ai-agent-credential-service.ts');
const actor={userId:'10000000-0000-4000-8000-000000000001',role:'admin'},key='20000000-0000-4000-8000-000000000001';
const issued={id:key,label:'synthetic',scopes:['ai-agent:requests:read'],grant:{queues:['employee_requests'],actions:['read']},expiresAt:'2026-10-04T00:00:00Z',token:'tips_agent_'+'a'.repeat(64)};
test('strict issue accepts first and metadata-only replay, rejects hashes/provider values',()=>{
 assert.equal(credentialIssueSchema.parse(issued).token,issued.token);assert.equal(credentialIssueSchema.parse({...issued,token:null}).token,null);
 assert.equal(credentialIssueSchema.safeParse({...issued,tokenHash:'a'.repeat(64)}).success,false);
});
test('credential RPC writes use exact UUID key and no legacy issuer',async()=>{
 const calls=[];const s=createAiAgentCredentialService({actor,getCurrentActor:()=>actor,rpc:async(name,args)=>{calls.push({name,args});return {data:issued,error:null};}});
 await s.create({label:'synthetic',scopes:issued.scopes,grant:issued.grant,expiresAt:null},key);
 assert.equal(calls[0].name,'ai_agent_credential_api_v1');assert.equal(calls[0].args.p_input.idempotencyKey,key);
});
test('late raw secret denied after account or verified-role boundary',async()=>{
 for(const next of [{...actor,userId:key},{...actor,role:'teacher'}]){
  let current=actor;const pending=Promise.withResolvers();const s=createAiAgentCredentialService({actor,getCurrentActor:()=>current,rpc:()=>pending.promise});
  const write=s.create({label:'synthetic',scopes:issued.scopes,grant:issued.grant,expiresAt:null},key);current=next;pending.resolve({data:issued,error:null});await assert.rejects(write,/actor/);
 }
});
test('list remains available with support off and actor denial makes zero RPC calls',async()=>{
 let calls=0,current=actor;const s=createAiAgentCredentialService({actor,getCurrentActor:()=>current,rpc:async()=>{calls++;return {data:{items:[],total:0,supportEnabled:false},error:null};}});
 assert.equal((await s.list(1,10)).supportEnabled,false);current={...actor,role:'viewer'};await assert.rejects(s.list(1,10),/actor/);assert.equal(calls,1);
});
const indefinite={...issued,scopes:['chat:outbox:read','chat:send'],grant:{spaceKeys:Array.from({length:7},(_,i)=>`space_${i+1}`),purposes:['bridge_reply'],bridgeSourceId:key},expiresAt:null};
test('non-expiring Chat metadata passes the real strict issue, replay and list contracts',()=>{
 assert.equal(credentialIssueSchema.parse(indefinite).expiresAt,null);
 assert.equal(credentialIssueSchema.parse({...indefinite,token:null}).token,null);
 const {token,...metadata}=indefinite;
 assert.equal(credentialListSchema.parse({supportEnabled:false,total:1,items:[{...metadata,createdAt:issued.expiresAt,revokedAt:null,lastUsedAt:null}]}).items[0].expiresAt,null);
});
test('nullable expiry cannot widen request, completion or ambiguous Chat metadata',()=>{
 for(const value of [{...issued,expiresAt:null},{...indefinite,scopes:['chat:send']},
  {...indefinite,grant:{...indefinite.grant,purposes:['ai_completion']}},
  {...indefinite,grant:{...indefinite.grant,actions:['read']}},
  {...indefinite,grant:{...indefinite.grant,bridgeSourceId:undefined}},
  {...indefinite,grant:{...indefinite.grant,spaceKeys:[]}},
  {...indefinite,grant:{...indefinite.grant,spaceKeys:['space_1','space_1']}}]) {
  assert.equal(credentialIssueSchema.safeParse(value).success,false);
 }
 assert.equal(credentialIssueSchema.safeParse(issued).success,true);
});
test('non-expiring intent is explicit and survives immutable recovery input',async()=>{
 const calls=[];const s=createAiAgentCredentialService({actor,getCurrentActor:()=>actor,rpc:async(name,args)=>{calls.push(args);return {data:{...indefinite,token:null},error:null};}});
 const payload={label:'synthetic',scopes:indefinite.scopes,grant:indefinite.grant,expiresAt:null,nonExpiring:true};
 await s.create(payload,key);await s.create(payload,key);
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0].p_input,{...payload,idempotencyKey:key});
});
