import assert from 'node:assert/strict'
import test from 'node:test'
import { createRegistrationObservationChatHandlers } from '../src/features/tasks/server/registration-observation-chat-route.ts'
import { createRegistrationObservationChatService } from '../src/features/tasks/registration-observation-chat-service.ts'
import { fluentRpcClient, assertSingleNonRetryingRpc } from './helpers/notification-fluent-rpc.mjs'
const id = '99480000-0000-4000-8000-000000000101'
const requestId = '99480000-0000-4000-8000-000000000102'
const checksum = 'a'.repeat(64)
const context = { observationId: id, intent: 'handoff', previewChecksum: checksum, renderedTitle: '청강 담당 전달',
  renderedBody: '[학생] 예시\n[담당] 예시 선생님\n수업 후 이 채팅방에 회신해 주세요.', targetLabel: '영어팀 · 예시 선생님',
  connectionKey: 'google_chat.english', connectionRevision: '1', teacherMention: 'users/12345',
  href: `/admin/registration?taskId=${id}`, teacherInternal: 'must-not-escape-preview' }
const body = { observationId: id, intent: 'handoff', previewChecksum: checksum, requestId, confirmed: true }
function harness(options={}) {
 const calls=[]; const external=[];const rpcTrace=[]
 const client = fluentRpcClient({ async rpc(name, parameters) {
   assertSingleNonRetryingRpc(rpcTrace.at(-1))
   calls.push({name,parameters})
   if(options.rpc) { const override=await options.rpc(name,parameters); if(override) return override }
   if(name==='get_registration_observation_explicit_chat_preview_v1') return {data:{...context,canSend:true,status:'ready'},error:null}
   if(name==='begin_registration_observation_explicit_chat_v1') return {data: options.begun || {acquired:true,attemptId:id,claimToken:requestId,context},error:null}
   if(name==='register_registration_observation_explicit_chat_attempt_v1') return {data:true,error:null}
   if(name==='finish_registration_observation_explicit_chat_v1') return {data:null,error:null}
   throw new Error(`unexpected RPC ${name}`)
 } },rpcTrace)
 const handlers=createRegistrationObservationChatHandlers({
   authenticate:async()=>({actorProfileId:id,role:options.role||'admin',actorClient:client,serviceClient:client}),
   readWebhook:async()=> 'https://chat.googleapis.com/v1/spaces/test/messages?key=fixture&token=fixture',
   fetch:async(url,init)=> {external.push({url,init}); if(options.transportError) throw new Error('connection lost');
     return new Response(JSON.stringify({name:'spaces/test/messages/sent'}),{status:options.httpStatus || 200})},
 })
 return {calls,external,rpcTrace,handlers, post:(payload=body)=>handlers.POST(new Request('http://localhost/api/registration/observation-chat',{method:'POST',body:JSON.stringify(payload)}))}
}
test('observation read and send lifecycle use a single non-retrying 8s RPC at each boundary',async(t)=>{
 const deadlines=[]
 t.mock.method(AbortSignal,'timeout',(ms)=>{deadlines.push(ms);return new AbortController().signal})
 const h=harness()
 assert.equal((await h.handlers.GET(new Request(`http://localhost/api/registration/observation-chat?observationId=${id}&intent=handoff`))).status,200)
 assert.equal((await h.post()).status,200)
 assert.equal(h.rpcTrace.length,4)
 h.rpcTrace.forEach(assertSingleNonRetryingRpc)
 assert.deepEqual(deadlines.filter(ms=>ms===8000),[8000,8000,8000,8000])
 assert.equal(h.external.length,1)
})
test('preview performs one read RPC and returns only the reviewable DTO',async()=>{
 const h=harness(); const response=await h.handlers.GET(new Request(`http://localhost/api/registration/observation-chat?observationId=${id}&intent=handoff`))
 assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store')
 const payload=await response.json();assert.equal(payload.preview.targetLabel,context.targetLabel)
 assert.doesNotMatch(JSON.stringify(payload),/teacherInternal|teacherMention|connectionRevision|must-not-escape/)
 assert.equal(h.calls.length,1);assert.equal(h.external.length,0)
})
test('confirmation gates admin/staff and strict target/checksum payloads before creating a claim',async()=>{
 for(const [options,payload,status] of [[{role:'teacher'},body,403],[{}, {...body,confirmed:false},400],[{}, {...body,room:'arbitrary'},400],[{}, {...body,includeAppLink:true},400]]){
  const h=harness(options);assert.equal((await h.post(payload)).status,status);assert.equal(h.calls.length,0);assert.equal(h.external.length,0)
 }
})
test('explicit send registers the final source check before exactly one provider request and finalizes it',async()=>{
 const h=harness();assert.equal((await (await h.post()).json()).status,'sent')
 assert.deepEqual(h.calls.map(c=>c.name),['begin_registration_observation_explicit_chat_v1','register_registration_observation_explicit_chat_attempt_v1','finish_registration_observation_explicit_chat_v1'])
 assert.equal(h.external.length,1);assert.equal(h.calls.at(-1).parameters.p_status,'sent')
 const message=JSON.parse(h.external[0].init.body);assert.match(message.text,/<users\/12345>/)
 assert.doesNotMatch(JSON.stringify(message),/buttonList|openLink|https:\/\/tipsedu\.co\.kr|\/admin\/registration/)
 assert.match(message.cardsV2[0].card.sections[0].widgets[0].textParagraph.text,/이 채팅방에 회신/)
 assert.equal(message.cardsV2[0].card.sections[0].widgets.length,1)
})
test('an untrusted outbound link fails rendering before external-attempt registration',async()=>{
 const h=harness({begun:{acquired:true,attemptId:id,claimToken:requestId,context:{...context,href:'https://attacker.invalid/student'}}})
 assert.equal((await h.post()).status,503);assert.equal(h.external.length,0)
 assert.equal(h.calls.some(c=>c.name==='register_registration_observation_explicit_chat_attempt_v1'),false)
})
test('sent and unknown replay receipts cannot start a new provider attempt',async()=>{
 for(const status of ['sent','unknown']){const h=harness({begun:{acquired:false,status}});assert.equal((await(await h.post()).json()).status,status)
 assert.equal(h.calls.length,1);assert.equal(h.external.length,0)}
})
test('late source change rejects sending after reservation and before HTTP',async()=>{
 const h=harness({rpc:async(name)=>name==='register_registration_observation_explicit_chat_attempt_v1'?{data:null,error:{code:'23514',message:'registration_observation_chat_source_changed'}}:null})
 assert.equal((await h.post()).status,409);assert.equal(h.external.length,0);assert.equal(h.calls.at(-1).parameters.p_status,'failed')
})
test('ambiguous registration receipt and provider response preserve unknown with no automated retry',async()=>{
 const registration=harness({rpc:async(name)=>{if(name==='register_registration_observation_explicit_chat_attempt_v1') throw new Error('lost receipt')}})
 assert.equal((await(await registration.post()).json()).status,'unknown');assert.equal(registration.external.length,0)
 const transport=harness({transportError:true});assert.equal((await(await transport.post()).json()).status,'unknown');assert.equal(transport.external.length,1)
 assert.equal(transport.calls.at(-1).parameters.p_status,'unknown')
})
test('HTTP 408 remains unknown and its stored receipt blocks another provider request',async()=>{
 const options={httpStatus:408};const h=harness(options)
 assert.equal((await(await h.post()).json()).status,'unknown');assert.equal(h.calls.at(-1).parameters.p_status,'unknown')
 options.begun={acquired:false,status:'unknown'}
 assert.equal((await(await h.post()).json()).status,'unknown');assert.equal(h.external.length,1)
})
test('browser service binds confirmation to the loaded preview and refuses terminal re-sends',async()=>{
 const h=harness(); const service=createRegistrationObservationChatService((url,init)=>init?.method==='POST'
  ?h.handlers.POST(new Request(`http://localhost${url}`,init)):h.handlers.GET(new Request(`http://localhost${url}`,init)))
 const preview=await service.preview(id,'handoff','token');assert.equal(await service.send(preview,'token',requestId),'sent')
 await assert.rejects(service.send({...preview,canSend:false,status:'unknown'},'token',requestId));assert.equal(h.external.length,1)
})

test('observation requests time out, abort transport, and ignore late send results without retrying',async()=>{
 const calls=[];let resolveSend
 const service=createRegistrationObservationChatService((url,init)=>{
  calls.push({url,init})
  return new Promise(resolve=>{resolveSend=resolve})
 },5)
 await assert.rejects(service.preview(id,'handoff','token'),e=>e.code==='registration_observation_chat_preview_timeout')
 assert.equal(calls[0].init.signal.aborted,true)
 const pending=service.send({...context,canSend:true,status:'ready'},'token',requestId)
 await assert.rejects(pending,e=>e.code==='registration_observation_chat_send_timeout')
 assert.equal(calls[1].init.signal.aborted,true)
 resolveSend(Response.json({ok:true,status:'sent'}))
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal(calls.length,2)
})

test('observation external cancellation settles even when the transport ignores abort',async()=>{
 const controller=new AbortController();let signal
 const service=createRegistrationObservationChatService((_url,init)=>{signal=init.signal;return new Promise(()=>{})},1000)
 const pending=service.preview(id,'handoff','token',controller.signal)
 controller.abort()
 await assert.rejects(pending,e=>e.name==='AbortError')
 assert.equal(signal.aborted,true)
})
