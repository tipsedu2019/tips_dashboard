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
