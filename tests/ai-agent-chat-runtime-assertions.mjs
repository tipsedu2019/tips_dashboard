import assert from 'node:assert/strict';
import {chatOutboxSchema,chatPreparedSchema,validateChatCompletion} from '../src/features/chat/server/chat-contract.ts';
import {createChatSendHandler} from '../src/features/chat/server/chat-send-route.ts';
import {resolveBridgeSource} from '../src/features/chat/server/chat-runtime-configuration.ts';
import {loadNotificationComponent} from './helpers/notification-component-loader.mjs';
const {credentialIssueSchema}=loadNotificationComponent('src/features/ai-agent/ai-agent-credential-service.ts');
export async function assertChatProducerParity(data) {
 assert.deepEqual(data.provenance,{kind:'actual_disposable_db_gateway',synthetic:true,providerCalls:0});
 assert.deepEqual(credentialIssueSchema.parse(data.first),data.first);assert.deepEqual(credentialIssueSchema.parse(data.replay),data.replay);assert.equal(data.replay.token,null);
 for(const key of ['hostile','safeEmpty','unconfigured'])assert.deepEqual(chatOutboxSchema.parse(data[key]),data[key]);
 for(const key of ['prepared','recorded'])assert.deepEqual(chatPreparedSchema.parse(data[key]),data[key]);
 for(const key of ['hostile','safeEmpty'])validateChatCompletion(data[key],'https://dashboard.test.invalid');
 assert.ok(!data.hostile.payload.text.includes('evil.invalid'));assert.ok(!data.hostile.payload.text.includes('\u202e'));assert.ok(data.safeEmpty.payload.text.startsWith('요청 · 완료\n'));assert.equal(data.unconfigured.expectedSpace,null);assert.equal(data.unconfigured.state,'cancelled');
 assert.equal(await resolveBridgeSource(async()=>({data:data.bridge,error:null}),'a'.repeat(64)),data.bridge.bridgeSourceId);await assert.rejects(resolveBridgeSource(async()=>({data:null,error:data.bridgeGrantLoss}),'a'.repeat(64)),/forbidden/);
 let fetchCalls=0;const operations=[];const slot={spaceKey:data.safeEmpty.spaceKey,resourceName:data.safeEmpty.expectedSpace,webhookUrl:`https://chat.googleapis.com/v1/${data.safeEmpty.expectedSpace}/messages?key=synthetic&token=synthetic`};
 const handler=createChatSendHandler({rpc:async(name,args)=>{operations.push(args.p_action);return {data:args.p_action==='get'?{outbox:data.safeEmpty,attempts:[]}:args.p_action==='prepare_attempt'?data.prepared:data.recorded,error:null};},resolveSlot:()=>slot,completionOrigin:'https://dashboard.test.invalid',bridgeSourceId:async()=>data.bridge.bridgeSourceId,fetch:async()=>{fetchCalls++;throw new Error('synthetic_timeout');}});
 const response=await handler(new Request('https://test.invalid/api/chat/send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.first.token}`,'Idempotency-Key':'10000000-0000-4000-8000-000000000001','X-Chat-Intent-ID':data.safeEmpty.id},body:JSON.stringify({space:data.safeEmpty.spaceKey,text:data.safeEmpty.payload.text})}));assert.equal(response.status,200);assert.equal((await response.json()).data.outbox.state,'delivery_unknown');assert.equal(fetchCalls,1);assert.deepEqual(operations,['get','prepare_attempt','record_attempt']);
}
