import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNonExpiringCredentialCapture} from './ai-agent-chat-runtime-assertions.mjs';
const id='af090000-0000-4000-8000-000000000001',source='af090000-0000-4000-8000-000000000002';
const first={id,label:'Synthetic non-expiring capture',scopes:['chat:outbox:read','chat:send'],grant:{spaceKeys:Array.from({length:7},(_,i)=>`space_${i+1}`),purposes:['bridge_reply'],bridgeSourceId:source},expiresAt:null,token:'tips_agent_'+'a'.repeat(64)};
const {token:ignoredToken,...metadata}=first;void ignoredToken;
const capture={bridge:{bridgeSourceId:source},nonExpiringFirst:first,nonExpiringReplay:{...first,token:null},nonExpiringList:{supportEnabled:false,total:1,items:[{...metadata,createdAt:'2026-10-09T00:00:00Z',revokedAt:null,lastUsedAt:null}]}};
test('NULL-expiry producer consumer binds full replay and list to exact seven-room source grant',()=>assertNonExpiringCredentialCapture(capture));
test('valid-looking altered scope/source/space and replay/list drift fail consumer parity',()=>{
 for(const mutate of [
  v=>v.nonExpiringFirst.scopes.push('ai-agent:requests:read'),
  v=>v.nonExpiringFirst.grant.bridgeSourceId=id,
  v=>v.nonExpiringFirst.grant.spaceKeys[6]='space_1',
  v=>v.nonExpiringFirst.grant.spaceKeys.pop(),
  v=>v.nonExpiringReplay.expiresAt='2026-10-10T00:00:00Z',
  v=>v.nonExpiringReplay.token=first.token,
  v=>v.nonExpiringList.items[0].label='Changed',
 ]){const changed=structuredClone(capture);mutate(changed);assert.throws(()=>assertNonExpiringCredentialCapture(changed));}
});
