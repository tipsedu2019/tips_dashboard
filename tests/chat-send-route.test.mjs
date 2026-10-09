import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSendHandler } from '../src/features/chat/server/chat-send-route.ts';
import { createChatOutboxHandler } from '../src/features/chat/server/chat-outbox.ts';
const id='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222',token='tips_agent_'+'a'.repeat(64);
function request(body={space:'space_1',thread:'spaces/SYNTHETIC/threads/human',text:'답변'},headers={}){return new Request('https://caller.test/api/chat/send',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':key,'x-chat-intent-id':id,...headers},body:JSON.stringify(body)});}
test('missing module RED becomes strict authenticated handler with protected envelope',async()=>{
 let rpc=0,fetches=0;const handler=createChatSendHandler({rpc:async()=>{rpc++;return {data:null,error:{message:'ai_agent_grant_forbidden'}};},resolveSlot:()=>null,bridgeSourceId:async()=>id,fetch:async()=>{fetches++;throw Error('never');}});
 const r=await handler(request());assert.equal(r.status,403);assert.deepEqual(await r.json(),{data:null,error:{code:'ai_agent_grant_forbidden'}});assert.equal(fetches,0);assert.equal(rpc,1);assert.equal(r.headers.get('cache-control'),'no-store, private');assert.equal(r.headers.get('vary'),'Authorization');
});
test('employees, malformed tokens, raw URL/query, extra origin, missing key and oversized bodies make zero RPC/fetch',async()=>{
 let rpc=0;const handler=createChatSendHandler({rpc:async()=>{rpc++;throw Error('never');},resolveSlot:()=>null,bridgeSourceId:async()=>id,fetch:async()=>{throw Error('never');}});
 const cases=[request(undefined,{authorization:'Bearer employee-jwt'}),request(undefined,{authorization:'Bearer tips_agent_BAD'}),request({space:'https://evil.test',text:'x'}),request({space:'space_1',text:'x',url:'https://evil.test'}),request(undefined,{'x-bridge-event-id':'spaces/SYNTHETIC/messages/a.b'}),request(undefined,{'idempotency-key':''}),request({space:'space_1',text:'x'.repeat(140000)})];
 for(const req of cases){const r=await handler(req);assert.ok(r.status>=400);assert.equal(rpc,0);}
 const q=request();const query=new Request(q.url+'?url=https://evil.test',q);assert.equal((await handler(query)).status,400);assert.equal(rpc,0);
});
const stamp='2026-10-03T12:00:00+00:00',attemptId='33333333-3333-4333-8333-333333333333',credentialId='44444444-4444-4444-8444-444444444444';
const initial={id,requestId:null,completionEventId:null,bridgeSourceId:key,sourceEventId:'spaces/SYNTHETIC/messages/a.b',purpose:'bridge_reply',spaceKey:'space_1',expectedSpace:'spaces/SYNTHETIC',threadName:'spaces/SYNTHETIC/threads/human',payload:{text:'답변',thread:{name:'spaces/SYNTHETIC/threads/human'}},payloadHash:'c'.repeat(64),upstreamRequestId:id,state:'pending',revision:'9007199254740993',reason:null,attemptCount:0,activeAttemptId:null,leaseExpiresAt:null,readyAt:stamp,createdAt:stamp,updatedAt:stamp};
const slot={spaceKey:'space_1',resourceName:'spaces/SYNTHETIC',webhookUrl:'https://chat.googleapis.com/v1/spaces/SYNTHETIC/messages?key=synthetic-key&token=synthetic-token'};
test('client message identity is sent to SQL, bound to payload and never becomes a new-thread request',async()=>{
 const clientMessageId='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',row={...initial,clientMessageId:clientMessageId.toLowerCase()};
 const inputs=[];let fetches=0;
 const handler=createChatSendHandler({rpc:async(_name,args)=>{inputs.push(args.p_input);return {data:{outbox:row,created:false},error:null};},resolveSlot:()=>slot,bridgeSourceId:async()=>key,fetch:async()=>{fetches++;throw Error('must not send');}});
 const req=(client=clientMessageId,extra={})=>{const r=request({space:'space_1',thread:initial.threadName,text:'답변',clientMessageId:client,...extra});r.headers.delete('x-chat-intent-id');r.headers.set('x-bridge-event-id',initial.sourceEventId);return r;};
 assert.equal((await handler(req())).status,200);assert.equal(inputs[0].clientMessageId,row.clientMessageId);assert.equal(inputs[0].sourceEventId,initial.sourceEventId);
 assert.equal((await handler(req(key))).status,409);assert.equal(fetches,0);
 const count=inputs.length;
 for(const r of [req(null),req(clientMessageId,{thread:undefined}),req(clientMessageId,{mode:'new_thread'})])assert.ok((await handler(r)).status>=400);
 assert.equal(inputs.length,count);assert.equal(fetches,0);
});
test('exact receipt lookup supports outbox and stable client IDs, preserves unknown and projects provider evidence only',async()=>{
 const clientMessageId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',row={...initial,clientMessageId,state:'sent',activeAttemptId:attemptId};
 const attempt={id:attemptId,attemptId,outboxId:id,credentialId,seq:'2',kind:'result',outcome:'sent',code:'200',messageName:'spaces/SYNTHETIC/messages/result',threadName:initial.threadName,createdAt:stamp};
 let state='sent',calls=0,malformed=false;
 const handler=createChatOutboxHandler({rpc:async(_name,args)=>{calls++;assert.equal(args.p_action,'get');assert.ok(args.p_input.id===id||args.p_input.clientMessageId===clientMessageId);return {data:{outbox:{...row,state},attempts:[{...attempt,threadName:malformed?'spaces/OTHER/threads/wrong':attempt.threadName}]},error:null};}});
 const req=q=>new Request('https://caller.test/api/chat/outbox?'+q,{headers:{authorization:`Bearer ${token}`}});
 for(const q of ['id='+id,'clientMessageId='+clientMessageId.toUpperCase()]){const r=await handler(req(q));assert.equal(r.status,200);const result=await r.json();assert.deepEqual(result.data.delivery,{messageName:attempt.messageName,threadName:attempt.threadName});assert.equal('attempts' in result.data,false);assert.equal(JSON.stringify(result).includes(credentialId),false);}
 state='delivery_unknown';const unknown=await handler(req('clientMessageId='+clientMessageId));assert.equal((await unknown.json()).data.delivery,null);
 const before=calls;for(const q of ['id='+id+'&clientMessageId='+clientMessageId,'clientMessageId='+clientMessageId+'&status=sent','id=null'])assert.equal((await handler(req(q))).status,400);assert.equal(calls,before);
 state='sent';malformed=true;assert.equal((await handler(req('id='+id))).status,503);
});
function durable(options={}){
 let row=structuredClone(options.row??initial),fetches=0,committed=false,created=false;const keys=new Map(),actions=[];
 const event={id:attemptId,attemptId,outboxId:id,credentialId,seq:'1',kind:'started',outcome:null,code:null,messageName:null,threadName:null,createdAt:stamp};
 const rpc=async(name,args)=>{
  assert.equal(name,'ai_agent_chat_api_v1');assert.match(args.p_token_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(args).includes(token));const action=args.p_action,input=args.p_input;actions.push(action);
  if(options.error===action)return {data:null,error:{message:options.errorCode??'ai_agent_api_unavailable',code:'XX000',details:'secret'}};
  if(action==='list')return {data:{items:['pending','retry_wait'].includes(row.state)?[structuredClone(row)]:[],nextCursor:null},error:null};
  if(action==='get')return {data:{outbox:structuredClone(row),attempts:[]},error:null};
  if(action==='chat_outbox'){assert.equal(input.bridgeSourceId,key);const wasCreated=created;created=true;return {data:{outbox:structuredClone(row),created:options.originCreated??!wasCreated},error:null};}
  if(action==='prepare_attempt'){
   if(keys.has(input.idempotencyKey))return keys.get(input.idempotencyKey)===input.revision?{data:{outbox:structuredClone(row),attempt:null},error:null}:{data:null,error:{message:'ai_agent_idempotency_conflict',code:'23514'}};
   if(input.revision!==row.revision || !['pending','retry_wait'].includes(row.state) || row.attemptCount>=5)return {data:null,error:{message:'ai_agent_conflict',code:'55000'}};
   keys.set(input.idempotencyKey,input.revision);row={...row,state:'sending',revision:String(BigInt(row.revision)+1n),attemptCount:row.attemptCount+1,activeAttemptId:attemptId,leaseExpiresAt:stamp};committed=true;
   if(options.uncertainPrepare)return {data:null,error:{message:'connection lost secret',code:'XX000'}};
   return {data:{outbox:structuredClone(row),attempt:options.nullAttempt?null:{...event,...options.attempt}},error:null};
  }
  if(action==='record_attempt'){
   assert.equal(input.attemptId,attemptId);row={...row,state:input.outcome==='sent'?'sent':input.outcome==='rejected_retryable'?(row.attemptCount>=5?'failed':'retry_wait'):input.outcome==='rejected_permanent'?'failed':'delivery_unknown',reason:input.outcome==='sent'?null:input.code,revision:String(BigInt(row.revision)+1n)};
   return {data:{outbox:structuredClone(row),attempt:{...event,seq:'2',kind:'result',outcome:input.outcome,code:input.code,messageName:input.messageName??null,threadName:input.threadName??null}},error:null};
  }
  throw Error('unexpected');
 };
 const handler=createChatSendHandler({rpc,resolveSlot:()=>options.unconfigured?null:slot,bridgeSourceId:async()=>key,completionOrigin:options.completionOrigin,fetch:async(...args)=>{assert.ok(committed,'DB commit completed before fetch');fetches++;return options.fetch?options.fetch(...args):Response.json({name:'spaces/SYNTHETIC/messages/a.b',thread:{name:initial.threadName}});}});
 return {handler,rpc,get row(){return row;},get fetches(){return fetches;},actions};
}
test('new committed attempt sends once; same key and sent replay fetch zero more',async()=>{
 const d=durable();assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,1);assert.equal(d.row.state,'sent');assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,1);assert.deepEqual(d.actions,['get','prepare_attempt','record_attempt','get']);
});
test('concurrent same intent prepares one attempt and dispatches once',async()=>{
 const d=durable();const result=await Promise.all([d.handler(request()),d.handler(request(undefined,{'idempotency-key':credentialId}))]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.equal(d.fetches,1);assert.equal(d.row.attemptCount,1);
});
test('sanitized provider rejection is recorded as failed and replay cannot dispatch again',async()=>{
 const marker='synthetic-private-response-canary';
 const d=durable({fetch:async()=>Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:marker,details:[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'message.thread.name',description:marker}]}]}},{status:400})});
 const first=await d.handler(request());assert.equal(first.status,200);const result=await first.json();
 assert.equal(result.error,null);assert.equal(result.data.outbox.state,'failed');assert.equal(result.data.outbox.reason,'400.INVALID_ARGUMENT.field_thread_name');
 assert.equal(d.row.attemptCount,1);assert.equal(d.fetches,1);assert.equal(JSON.stringify(result).includes(marker),false);
 assert.match(d.row.reason,/^[A-Za-z0-9_.-]{1,100}$/);
 assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,1);
 assert.deepEqual(d.actions,['get','prepare_attempt','record_attempt','get']);
 const get=createChatOutboxHandler({rpc:d.rpc});const response=await get(new Request('https://caller.test/api/chat/outbox?id='+id,{headers:{authorization:`Bearer ${token}`}}));
 assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.data.outbox.state,'failed');assert.equal(receipt.data.delivery,null);
});
test('repeated bridge source including rotated credential/new HTTP key never prepares',async()=>{
 const d=durable();
 const first=request();first.headers.delete('x-chat-intent-id');first.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await d.handler(first)).status,200);
 const replay=request(undefined,{'idempotency-key':credentialId,authorization:'Bearer tips_agent_'+'b'.repeat(64)});replay.headers.delete('x-chat-intent-id');replay.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await d.handler(replay)).status,200);assert.equal(d.fetches,1);assert.equal(d.actions.filter(a=>a==='prepare_attempt').length,1);
 const pendingReplay=durable({originCreated:false});const repeated=request();repeated.headers.delete('x-chat-intent-id');repeated.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await pendingReplay.handler(repeated)).status,200);assert.equal(pendingReplay.fetches,0);assert.deepEqual(pendingReplay.actions,['chat_outbox']);
});
test('semantic mismatch, unconfigured, save/prepare failure and invalid attempt produce zero fetch',async()=>{
 for(const options of [{unconfigured:true},{error:'get'},{error:'prepare_attempt'},{nullAttempt:true},{attempt:{outboxId:key}},{attempt:{kind:'result'}},{attempt:{outcome:'sent'}}]){const d=durable(options);const r=await d.handler(request());assert.ok(r.status>=400 || options.nullAttempt);assert.equal(d.fetches,0);assert.ok(!(await r.text()).includes('secret'));}
 for(const body of [{space:'space_2',thread:initial.threadName,text:'답변'},{space:'space_1',text:'답변'},{space:'space_1',thread:'spaces/OTHER/threads/human',text:'답변'},{space:'space_1',thread:initial.threadName,text:'changed'}]){const d=durable();assert.equal((await d.handler(request(body))).status,409);assert.equal(d.fetches,0);}
 const bridge=durable({error:'chat_outbox'});const req=request();req.headers.delete('x-chat-intent-id');req.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await bridge.handler(req)).status,503);assert.equal(bridge.fetches,0);
});
test('current grant/config/rate/stale recheck denial after read always precedes fetch',async()=>{
 for(const [errorCode,status] of [['ai_agent_grant_forbidden',403],['ai_agent_space_forbidden',403],['ai_agent_scope_forbidden',403],['chat_rate_limited',429],['ai_agent_conflict',409],['ai_agent_stale_version',409]]){const d=durable({error:'prepare_attempt',errorCode});const r=await d.handler(request());assert.equal(r.status,status);assert.deepEqual(await r.json(),{data:null,error:{code:errorCode}});assert.equal(d.fetches,0);assert.deepEqual(d.actions,['get','prepare_attempt']);}
});
test('unknown/incident and timeout replay never prepare another attempt',async()=>{
 for(const state of ['delivery_unknown','incident','failed','cancelled']){const d=durable({row:{...initial,state}});assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,0);assert.deepEqual(d.actions,['get']);}
 const d=durable({fetch:async()=>{throw Error('timeout secret');}});assert.equal((await d.handler(request())).status,200);assert.equal(d.row.state,'delivery_unknown');assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,1);assert.equal(d.actions.filter(a=>a==='prepare_attempt').length,1);
 const drain=createChatOutboxHandler({rpc:d.rpc});const next=await drain(new Request('https://caller.test/api/chat/outbox?status=pending',{headers:{authorization:`Bearer ${token}`}}));assert.equal(next.status,200);assert.deepEqual((await next.json()).data.items,[]);assert.equal(d.fetches,1);
});
test('append failure after fetch stays started; current sending state never prepares/fetches again',async()=>{
 const d=durable({error:'record_attempt'});assert.equal((await d.handler(request())).status,503);assert.equal(d.row.state,'sending');assert.equal(d.fetches,1);assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,1);assert.deepEqual(d.actions,['get','prepare_attempt','record_attempt','get']);
});
test('uncertain prepare commit response never authorizes fetch or fresh prepare',async()=>{
 const d=durable({uncertainPrepare:true});assert.equal((await d.handler(request())).status,503);assert.equal(d.row.state,'sending');assert.equal(d.fetches,0);assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,0);assert.deepEqual(d.actions,['get','prepare_attempt','get']);
});
test('definite 429 retry uses existing intent and new logical key; five attempt ceiling',async()=>{
 const d=durable({fetch:async()=>new Response('',{status:429})});for(let n=0;n<5;n++){const logical=`${String(n+1).padStart(8,'0')}-1111-4111-8111-111111111111`;assert.equal((await d.handler(request(undefined,{'idempotency-key':logical}))).status,200);if(n===0){const replay=await d.handler(request(undefined,{'idempotency-key':logical}));assert.equal(replay.status,409);assert.deepEqual(await replay.json(),{data:null,error:{code:'ai_agent_idempotency_conflict'}});assert.equal(d.fetches,1);}}
 assert.equal(d.fetches,5);assert.equal(d.row.state,'failed');assert.equal((await d.handler(request())).status,200);assert.equal(d.fetches,5);
});
test('completion rejects relative/body/result/link payload until approved absolute immutable text',async()=>{
 const completion={...initial,requestId:id,completionEventId:key,bridgeSourceId:null,sourceEventId:null,purpose:'ai_completion',threadName:null,payload:{text:`제목 · 완료\n/admin/ai-agent/${id}`}};
 const body=o=>({space:o.spaceKey,text:o.payload.text});
 for(const [text,origin] of [[completion.payload.text,undefined],[completion.payload.text,'https://dashboard.synthetic.invalid'],[`제목\n개인 결과 · 완료\nhttps://dashboard.synthetic.invalid/admin/ai-agent/${id}`,'https://dashboard.synthetic.invalid'],[`제목 · 완료\nhttps://evil.test/admin/ai-agent/${id}`,'https://dashboard.synthetic.invalid']]){const d=durable({row:{...completion,payload:{text}},completionOrigin:origin});assert.ok((await d.handler(request(body(d.row)))).status>=400);assert.equal(d.fetches,0);}
 const valid={...completion,payload:{text:`제목 · 완료\nhttps://dashboard.synthetic.invalid/admin/ai-agent/${id}`}};const d=durable({row:valid,completionOrigin:'https://dashboard.synthetic.invalid',fetch:async(url,options)=>{assert.equal(new URL(url).searchParams.has('messageReplyOption'),false);assert.equal(JSON.parse(options.body).thread,undefined);return Response.json({name:'spaces/SYNTHETIC/messages/client-custom-name',thread:{name:'spaces/SYNTHETIC/threads/new'}});}});assert.equal((await d.handler(request(body(valid)))).status,200);assert.equal(d.row.state,'sent');assert.equal(d.fetches,1);
});

test('parsed HTTP JSON order, outer whitespace and escaped characters are equivalent; text is exact',async()=>{
 const d=durable({originCreated:false});
 const body={space:'space_1',thread:initial.threadName,text:'답변'};
 const forms=[JSON.stringify(body),' \n'+JSON.stringify({text:body.text,thread:body.thread,space:body.space})+'\t ',`{"text":"\\ub2f5\\ubcc0","space":"space_1","thread":"${body.thread}"}`];
 for(const raw of forms){const base=request(body);base.headers.delete('x-chat-intent-id');base.headers.set('x-bridge-event-id',initial.sourceEventId);const req=new Request(base.url,{method:'POST',headers:base.headers,body:raw});assert.equal((await d.handler(req)).status,200);}
 assert.deepEqual(d.actions,['chat_outbox','chat_outbox','chat_outbox']);assert.equal(d.fetches,0);
 for(const text of [' 답변','답변 ','답변\n','답변\r\n','답변'.normalize('NFD')]){const other=durable({originCreated:false});const req=request({...body,text});req.headers.delete('x-chat-intent-id');req.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await other.handler(req)).status,409);assert.equal(other.fetches,0);}
 const lineRow={...initial,payload:{...initial.payload,text:'답변\n두번째 줄'}};const lines=durable({originCreated:false,row:lineRow});const lf=request({...body,text:lineRow.payload.text});lf.headers.delete('x-chat-intent-id');lf.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await lines.handler(lf)).status,200);const crlf=request({...body,text:lineRow.payload.text.replace('\n','\r\n')});crlf.headers.delete('x-chat-intent-id');crlf.headers.set('x-bridge-event-id',initial.sourceEventId);assert.equal((await lines.handler(crlf)).status,409);assert.equal(lines.fetches,0);
 for(const extra of [{extra:true},{thread:null}]){const other=durable();assert.equal((await other.handler(request({...body,...extra}))).status,400);assert.deepEqual(other.actions,[]);assert.equal(other.fetches,0);}
});

test('real HTTP prepares with latest get revision and server readyAt passes unchanged',async()=>{
 const readyAt='2026-10-05T12:34:56.789+00:00',revision='9007199254741007';let input;
 const row={...initial,state:'retry_wait',revision,readyAt};
 const handler=createChatSendHandler({rpc:async(name,args)=>{if(args.p_action==='get')return {data:{outbox:row,attempts:[]},error:null};assert.equal(args.p_action,'prepare_attempt');input=args.p_input;return {data:{outbox:row,attempt:null},error:null};},resolveSlot:()=>slot,bridgeSourceId:async()=>key,fetch:async()=>{throw Error('no dispatch authorization');}});
 const response=await handler(request());assert.equal(response.status,200);assert.deepEqual(input,{id,revision,idempotencyKey:key});assert.equal((await response.json()).data.outbox.readyAt,readyAt);
});
