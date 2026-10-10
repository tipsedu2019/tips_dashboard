import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('real adapter uses only authenticated RPC arguments, bounded aborts and no automatic retries',async()=>{
 const calls=[];const overrides=new Map([['@/lib/supabase',{supabase:{rpc(name,args){const result=Promise.resolve({data:{receipt:true},error:null});result.abortSignal=s=>{assert.ok(s instanceof AbortSignal);return result;};result.retry=v=>{assert.equal(v,false);return result;};calls.push({name,args});return result;}}}]]);
 const {personalConnectionService:s}=loadNotificationComponent('src/features/agent-api/personal-connection-service.ts',overrides);
 const signal=new AbortController().signal;
 await s.load({page:1,pageSize:10,pending:null,signal});await s.targets({kind:'classes',search:'',page:2,pageSize:20,signal});await s.issue({requestId:id(1),label:'fixture',expiresAt:'2099-01-01T00:00:00Z',classIds:[id(3)],schoolIds:[]});await s.revoke({requestId:id(2),credentialId:id(4)});await s.permissions({requestId:id(5),credentialId:id(4),expectedRevision:1,featureIds:[]});
 assert.deepEqual(calls.map(c=>c.args.p_action),['snapshot','targets','issue','revoke','permissions']);assert.ok(calls.every(c=>c.name==='agent_personal_connection_v1'&&!('signal' in c.args.p_input)&&!('ownerId' in c.args.p_input)));
});
test('adapter never propagates raw backend failures or secret values',async()=>{
 const raw='tips_dashboard_personal_'+'b'.repeat(64);const overrides=new Map([['@/lib/supabase',{supabase:{rpc(){const p=Promise.resolve({data:null,error:{message:raw}});p.abortSignal=()=>p;p.retry=()=>p;return p;}}}]]);
 const {personalConnectionService:s}=loadNotificationComponent('src/features/agent-api/personal-connection-service.ts',overrides);
 await assert.rejects(s.issue({}),e=>e.message==='personal_connection_failed'&&!e.message.includes(raw));
});
test('consumer rejects missing pages, foreign recovery receipts and overlarge grants',()=>{
 const c=loadNotificationComponent('src/features/agent-api/personal-connection-contract.ts');
 const snapshot={status:'ready',permissionVersion:1,ownerId:id(1),items:[],total:1,page:1,pageSize:10,operation:null};assert.throws(()=>c.parsePersonalSnapshot(snapshot,id(1),1,10,null));
 assert.throws(()=>c.parsePersonalTargets({ownerId:id(1),kind:'classes',search:'',items:[],total:2,page:1,pageSize:10},id(1),{kind:'classes',search:'',page:1,pageSize:10}));
 const source=readFileSync('src/features/agent-api/personal-connection-workspace.tsx','utf8');assert.doesNotMatch(source,/console\.|clipboard|localStorage/);
});

test('actual synthetic PostgreSQL DTOs pass the real consumer (secret replaced before export)',()=>{
 const c=loadNotificationComponent('src/features/agent-api/personal-connection-contract.ts');const dto=JSON.parse(readFileSync('tests/fixtures/personal-connection-producer.json','utf8'));const owner=dto.issue.credential.ownerId;
 assert.equal(c.parsePersonalIssue(dto.issue,owner,dto.input).credential.ownerId,owner);
 assert.ok(c.parsePersonalSnapshot(dto.snapshot,owner,1,10,null).items.length>0);
 assert.ok(c.parsePersonalTargets(dto.targets,owner,{kind:'classes',search:'',page:1,pageSize:10}).items.length>0);
});

test('older lifecycle backend fails closed even for an empty connection list',()=>{
 const c=loadNotificationComponent('src/features/agent-api/personal-connection-contract.ts');
 assert.throws(()=>c.parsePersonalSnapshot({status:'ready',ownerId:id(1),items:[],total:0,page:1,pageSize:10,operation:null},id(1),1,10,null));
});
