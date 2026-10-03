import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGoogleChat } from '../src/features/chat/server/google-chat-transport.ts';
import { CHAT_SPACE_CATALOG } from '../src/features/chat/server/chat-space-catalog.ts';
const id='11111111-1111-4111-8111-111111111111';
const intent={purpose:'bridge_reply',spaceKey:'space_1',expectedSpace:'spaces/SYNTHETIC',threadName:'spaces/SYNTHETIC/threads/human',payload:{text:'답변',thread:{name:'spaces/SYNTHETIC/threads/human'}},upstreamRequestId:id};
const slot={spaceKey:'space_1',resourceName:'spaces/SYNTHETIC',webhookUrl:'https://chat.googleapis.com/v1/spaces/SYNTHETIC/messages?key=synthetic-key&token=synthetic-token'};
test('all seven production slots stay unconfigured',()=>{assert.equal(CHAT_SPACE_CATALOG.length,7);assert.ok(CHAT_SPACE_CATALOG.every(x=>x.resourceName===null && /^TIPS_AI_CHAT_SPACE_[1-7]_WEBHOOK_URL$/.test(x.webhookEnv)));});
test('fixed target, original thread, stable requestId, deadline and no redirects',async()=>{
 let called=0;const result=await dispatchGoogleChat(intent,{slot,fetch:async(url,options)=>{called++;const u=new URL(url);assert.equal(u.origin,'https://chat.googleapis.com');assert.equal(u.pathname,'/v1/spaces/SYNTHETIC/messages');assert.equal(u.searchParams.get('requestId'),id);assert.equal(u.searchParams.get('messageReplyOption'),'REPLY_MESSAGE_OR_FAIL');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.deepEqual(JSON.parse(options.body),intent.payload);return Response.json({name:'spaces/SYNTHETIC/messages/a.b',thread:{name:intent.threadName}});}});
 assert.equal(called,1);assert.equal(result.outcome,'sent');assert.ok(!JSON.stringify(result).includes('synthetic-token'));
});
test('unsafe destination, DM, cross space, unknown fields and multibyte bytes prevent fetch',async()=>{
 for(const [row,config] of [[intent,{...slot,webhookUrl:'https://evil.test/x'}],[intent,{...slot,webhookUrl:slot.webhookUrl+'&threadKey=oops'}],[intent,{...slot,webhookUrl:slot.webhookUrl+'&requestId=oops'}],[{...intent,expectedSpace:'users/DM'},slot],[{...intent,threadName:'spaces/OTHER/threads/human'},slot],[{...intent,payload:{...intent.payload,url:'https://evil.test'}},slot],[{...intent,payload:{...intent.payload,text:'가'.repeat(11000)}},slot]]){
  let calls=0;await assert.rejects(()=>dispatchGoogleChat(row,{slot:config,fetch:async()=>{calls++;throw Error('secret');}}));assert.equal(calls,0);
 }
});
test('only definite 429 retries; timeout, reset, 5xx, malformed/missing/mismatch success stay unknown',async()=>{
 for(const [fetcher,outcome] of [[async()=>new Response('secret',{status:429}),'rejected_retryable'],[async()=>new Response('secret',{status:400}),'rejected_permanent'],[async()=>new Response('secret',{status:503}),'unknown'],[async()=>{throw Error('secret token');},'unknown'],[async()=>new Response('broken',{status:200}),'unknown'],[async()=>Response.json({}),'unknown'],[async()=>Response.json({name:'spaces/OTHER/messages/a',thread:{name:intent.threadName}}),'unknown'],[async()=>Response.json({name:'spaces/SYNTHETIC/messages/a',thread:{name:'spaces/SYNTHETIC/threads/other'}}),'unknown']]){
  const r=await dispatchGoogleChat(intent,{slot,fetch:fetcher});assert.equal(r.outcome,outcome);assert.ok(!JSON.stringify(r).includes('secret'));
 }
 const r=await dispatchGoogleChat(intent,{slot,deadlineMs:5,fetch:()=>new Promise(()=>{})});assert.equal(r.outcome,'unknown');
});
