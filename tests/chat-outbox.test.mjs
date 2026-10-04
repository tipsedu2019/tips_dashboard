import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatOutboxHandler } from '../src/features/chat/server/chat-outbox.ts';
test('pending maps to due pending/retry_wait filter with opaque cursor',async()=>{
 let input;const handler=createChatOutboxHandler({rpc:async(name,args)=>{assert.equal(name,'ai_agent_chat_api_v1');input=args.p_input;return {data:{items:[],nextCursor:null},error:null};}});
 const r=await handler(new Request('https://caller.test/api/chat/outbox?status=pending&limit=10&cursor=opaque',{headers:{authorization:'Bearer tips_agent_'+'a'.repeat(64)}}));assert.equal(r.status,200);assert.deepEqual(input,{limit:10,cursor:'opaque'});assert.deepEqual(await r.json(),{data:{items:[],nextCursor:null},error:null});
});
test('duplicate/extra query and malformed DTO never return sensitive DB payload',async()=>{
 let calls=0;const handler=createChatOutboxHandler({rpc:async()=>{calls++;return {data:{items:[],nextCursor:null,secret:'sensitive'},error:null};}});
 for(const q of ['?status=pending&status=pending','?url=https://evil.test','?cursor='+'x'.repeat(2049)]){const r=await handler(new Request('https://caller.test/api/chat/outbox'+q,{headers:{authorization:'Bearer tips_agent_'+'a'.repeat(64)}}));assert.ok(r.status>=400);assert.equal(calls,0);}
 const r=await handler(new Request('https://caller.test/api/chat/outbox',{headers:{authorization:'Bearer tips_agent_'+'a'.repeat(64)}}));assert.equal(r.status,503);assert.ok(!(await r.text()).includes('sensitive'));
});

test('HTTP parses query before SQL auth and preserves effective pending/limit binding inputs',async()=>{
 const cursor='actual-current-cursor-is-an-opaque-SQL-contract';
 for(const [message,code,status]of [['ai_agent_unauthorized','28000',401],['ai_agent_grant_forbidden','42501',403],['ai_agent_cursor_invalid','22023',422]]){
  const inputs=[];const handler=createChatOutboxHandler({rpc:async(name,args)=>{inputs.push(args.p_input);return {data:null,error:{message,code}};}});
  const request=q=>new Request('https://caller.test/api/chat/outbox'+q,{headers:{authorization:'Bearer tips_agent_'+'a'.repeat(64)}});
  assert.equal((await handler(request('?cursor='+cursor+'&limit=51'))).status,400);assert.equal(inputs.length,0);
  const denied=await handler(request('?cursor='+cursor));assert.equal(denied.status,status);assert.deepEqual((await denied.json()).error,{code:message});assert.deepEqual(inputs,[{cursor}]);
 }
 const inputs=[];const handler=createChatOutboxHandler({rpc:async(name,args)=>{inputs.push(args.p_input);return {data:{items:[],nextCursor:null},error:null};}});
 for(const query of ['?cursor='+cursor,'?status=pending&cursor='+cursor,'?status=pending&limit=50&cursor='+cursor])assert.equal((await handler(new Request('https://caller.test/api/chat/outbox'+query,{headers:{authorization:'Bearer tips_agent_'+'a'.repeat(64)}}))).status,200);
 assert.deepEqual(inputs,[{cursor},{cursor},{limit:50,cursor}]);
});
