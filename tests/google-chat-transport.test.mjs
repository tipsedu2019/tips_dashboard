import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGoogleChat } from '../src/features/chat/server/google-chat-transport.ts';
import { CHAT_SPACE_CATALOG } from '../src/features/chat/server/chat-space-catalog.ts';
const privateCanary='synthetic-private-canary-must-not-leave-response';
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
test('definite rejection keeps only constant diagnostics from both documented Google envelopes',async(t)=>{
 for(const wrapped of [false,true])await t.test(wrapped?'HTTP error envelope':'webhook Status',async()=>{
  const error={code:400,status:'INVALID_ARGUMENT',message:privateCanary,details:[
   {'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'message.thread.name',description:privateCanary}]},
   {'@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:'googleapis.com',reason:'API_KEY_INVALID',metadata:{url:slot.webhookUrl,token:privateCanary}},
  ]};
  let calls=0;
  const result=await dispatchGoogleChat(intent,{slot,fetch:async()=>{calls++;return Response.json(wrapped?{error}:error,{status:400});}});
  assert.deepEqual(result,{outcome:'rejected_permanent',code:'400.INVALID_ARGUMENT.API_KEY_INVALID.field_thread_name'});
  assert.equal(calls,1);assert.match(result.code,/^[A-Za-z0-9_.-]{1,100}$/);
  for(const secret of [privateCanary,slot.webhookUrl,'synthetic-token'])assert.ok(!JSON.stringify(result).includes(secret));
 });
});
test('arbitrary strings, mismatched codes and unsupported shapes never become stored diagnostics',async(t)=>{
 const cases=[null,[],{}, {error:null}, {error:{code:'400',status:'INVALID_ARGUMENT'}}, {error:{code:401,status:'UNAUTHENTICATED'}},
  {code:400,status:privateCanary,message:privateCanary},
  {code:400,status:'INVALID_ARGUMENT '+privateCanary},
  {code:400,details:[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:privateCanary},{field:'message.thread.name.'+privateCanary},{field:'toString'}]}]},
  {code:400,details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:'googleapis.com',reason:privateCanary}]},
  {code:400,details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:privateCanary,reason:'API_KEY_INVALID'}]},
  {code:400,details:[{'@type':privateCanary,fieldViolations:[{field:'message.thread.name'}]}]},
  {nested:{error:{code:400,status:'INVALID_ARGUMENT'}}},
 ];
 for(const [i,payload] of cases.entries())await t.test(String(i),async()=>{
  const result=await dispatchGoogleChat(intent,{slot,fetch:async()=>Response.json(payload,{status:400})});
  assert.deepEqual(result,{outcome:'rejected_permanent',code:'400'});
 });
});
test('known status alone survives while secret descriptions and unsupported details are discarded',async()=>{
 const result=await dispatchGoogleChat(intent,{slot,fetch:async()=>Response.json({error:{code:403,status:'PERMISSION_DENIED',message:privateCanary,details:[{reason:privateCanary,description:privateCanary,field:privateCanary}]}},{status:403})});
 assert.deepEqual(result,{outcome:'rejected_permanent',code:'403.PERMISSION_DENIED'});
});
test('damaged, oversized and stalled error bodies retain definite rejection and release the stream',async(t)=>{
 const bodies=[['invalid JSON',()=>new Response(privateCanary,{status:400})],
  ['invalid UTF-8',()=>new Response(new Uint8Array([0xc3,0x28]),{status:400})],
  ['missing body',()=>new Response(null,{status:400})],
  ['oversized bytes',()=>new Response(JSON.stringify({code:400,status:'INVALID_ARGUMENT',message:'가'.repeat(6000)}),{status:400})],
  ['stream error',()=>new Response(new ReadableStream({start(controller){controller.error(new Error(privateCanary));}}),{status:400})]];
 for(const [name,create] of bodies)await t.test(name,async()=>{
  const result=await dispatchGoogleChat(intent,{slot,fetch:async()=>create()});
  assert.deepEqual(result,{outcome:'rejected_permanent',code:'400'});
 });
 await t.test('deadline after headers',{timeout:5000},async()=>{
  let cancelled=false,signal,calls=0;
  const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{status:400});
  const result=await dispatchGoogleChat(intent,{slot,deadlineMs:10,fetch:async(_url,options)=>{calls++;signal=options.signal;return response;}});
  assert.deepEqual(result,{outcome:'rejected_permanent',code:'400'});
  assert.equal(calls,1);assert.equal(cancelled,true);assert.equal(signal.aborted,true);assert.equal(response.body.locked,false);
 });
});
test('429 remains the exact retry code and ambiguous failures never read diagnostics',async()=>{
 for(const [status,outcome,code] of [[429,'rejected_retryable','429'],[503,'unknown','provider_ambiguous'],[302,'unknown','provider_redirect']]){
  const response=new Response(null,{status});Object.defineProperty(response,'body',{get(){throw Error('must not inspect this body');}});
  const result=await dispatchGoogleChat(intent,{slot,fetch:async()=>response});assert.deepEqual(result,{outcome,code});
 }
});
