import assert from 'node:assert/strict'
import test from 'node:test'
import { createRegistrationManagementPreviewService, parseRegistrationManagementPreview } from '../src/features/tasks/registration-management-notification-preview-service.ts'
const preview = {
 trackId:'10000000-0000-4000-8000-000000000001',workflowRevision:7,previewChecksum:'a'.repeat(64),
 eventKey:'registration.case_created',stepLabel:'상담 신청',canSend:true,status:'ready',reason:'',
 targetLabel:'관리팀 Google Chat 채팅방',mentionLabel:'담당자 멘션 없음',renderedTitle:'상담 신청',renderedBody:'[학생] 가상 학생',
 recoveryAvailable:false,recoverySourceEventId:null,
}
const oldSourceId='20000000-0000-4000-8000-000000000001'
const newSourceId='20000000-0000-4000-8000-000000000002'
const oldEventId='40000000-0000-4000-8000-000000000001'
const recoveryPreview={...preview,recoveryAvailable:true,recoverySourceEventId:oldSourceId,existingEventId:oldEventId,existingRuleEnabled:false}
test('preview whitelist removes server metadata and rejects invalid operation identities',()=>{
 assert.deepEqual(parseRegistrationManagementPreview({...preview,privateSecret:'must-not-propagate'}),preview)
 for (const override of [{trackId:'bad'},{workflowRevision:0},{workflowRevision:1.1},{status:'unknown'},{canSend:false},{eventKey:'registration.observation_scheduled'},{stepLabel:3},{renderedBody:''}]) {
  assert.throws(()=>parseRegistrationManagementPreview({...preview,...override}))
 }
})
test('read-only preview never ensures an intent; confirm uses exactly the shown checksum',async()=>{
 const calls=[]
 const service=createRegistrationManagementPreviewService({async rpc(name,args){calls.push({name,args});return {data:name.startsWith('get_')?preview:{sourceEventIds:[newSourceId],recovered:false},error:null}}})
 const loaded=await service.preview(preview.trackId,7)
 assert.deepEqual(calls.map(c=>c.name),['get_registration_management_notification_preview_v1'])
 assert.deepEqual(await service.confirm(loaded,'30000000-0000-4000-8000-000000000001'),{sourceEventIds:[newSourceId],recovered:false})
 assert.equal(calls[1].name,'ensure_registration_workflow_notification_v4')
 assert.equal(calls[1].args.p_expected_preview_checksum,preview.previewChecksum)
 assert.equal(calls[1].args.p_intent,'send_registration_management_notification')
 assert.equal(calls[1].args.p_expected_recovery_source_event_id,null)
})
test('stale track response and domain conflict cannot become source IDs',async()=>{
 const stale=createRegistrationManagementPreviewService({async rpc(){return {data:{...preview,workflowRevision:8},error:null}}})
 await assert.rejects(stale.preview(preview.trackId,7),/현재 등록건/)
 const conflict=createRegistrationManagementPreviewService({async rpc(){return {data:null,error:{message:'registration_management_notification_preview_changed'}}}})
 await assert.rejects(conflict.confirm(preview,'request'),/미리보기를 다시/)
 await assert.rejects(createRegistrationManagementPreviewService(null).preview(preview.trackId,7),/연결/)
})

test('old source blockage carries a bounded receipt reference before confirm',()=>{
 const value=parseRegistrationManagementPreview({...preview,status:'existing_source_changed',canSend:false,existingEventId:'20000000-0000-4000-8000-000000000001',existingRequestedAt:'2026-09-08T00:00:00Z',existingRuleEnabled:false})
 assert.equal(value.canSend,false)
 assert.equal(value.existingRuleEnabled,false)
 assert.throws(()=>parseRegistrationManagementPreview({...preview,existingEventId:'wrong-event'}))
})

test('hanging preview and confirmation leave the caller lock through a bounded timeout',async()=>{
 const calls=[]
 const service=createRegistrationManagementPreviewService({rpc(name){calls.push(name);return new Promise(()=>{})}},5)
 await assert.rejects(service.preview(preview.trackId,7),/응답 시간이 초과/)
 await assert.rejects(service.confirm(preview,'retained-request-id'),/응답 시간이 초과/)
 assert.deepEqual(calls,['get_registration_management_notification_preview_v1','ensure_registration_workflow_notification_v4'])
})

test('only ready previews with a valid old request may expose recovery',()=>{
 assert.deepEqual(parseRegistrationManagementPreview(recoveryPreview),recoveryPreview)
 for(const override of [
  {recoveryAvailable:undefined},{recoveryAvailable:'true'},{recoverySourceEventId:null},
  {recoverySourceEventId:'not-a-request'},{recoveryAvailable:false},
  {status:'already_sent',canSend:false},{status:'delivery_unknown',canSend:false},
  {status:'rule_disabled',canSend:false},{status:'existing_source_changed',canSend:false},
 ])assert.throws(()=>parseRegistrationManagementPreview({...recoveryPreview,...override}))
})

test('reopened new requests retain a bounded reference to the preserved previous receipt',()=>{
 const value={...preview,status:'already_sent',canSend:false,recoveredFromEventId:oldEventId,existingEventId:'40000000-0000-4000-8000-000000000002'}
 assert.deepEqual(parseRegistrationManagementPreview(value),value)
 assert.throws(()=>parseRegistrationManagementPreview({...value,recoveredFromEventId:'private-id'}))
 assert.throws(()=>parseRegistrationManagementPreview({...value,recoveredFromEventId:value.existingEventId}))
})

test('recovery is read-only until explicit confirmation binds the shown old request and keeps its receipt',async()=>{
 const calls=[]
 const service=createRegistrationManagementPreviewService({async rpc(name,args){
  calls.push({name,args})
  return {data:name.startsWith('get_')?recoveryPreview:{sourceEventIds:[newSourceId],recovered:true,previousSourceEventId:oldSourceId,previousEventId:oldEventId,privateSecret:'removed'},error:null}
 }})
 const loaded=await service.preview(preview.trackId,7)
 assert.equal(calls.length,1)
 assert.equal(calls[0].name,'get_registration_management_notification_preview_v1')
 const confirmation=await service.confirm(loaded,'same-request-key')
 assert.deepEqual(confirmation,{sourceEventIds:[newSourceId],recovered:true,previousSourceEventId:oldSourceId,previousEventId:oldEventId})
 assert.equal(calls[1].args.p_expected_preview_checksum,loaded.previewChecksum)
 assert.equal(calls[1].args.p_expected_recovery_source_event_id,oldSourceId)
 assert.equal(calls[1].args.p_request_key,'same-request-key')
})

test('blocked previews never call confirm and inconsistent recovery receipts never become dispatch input',async()=>{
 let calls=0
 const never=createRegistrationManagementPreviewService({async rpc(){calls+=1;return {data:null,error:null}}})
 for(const status of ['already_sent','delivery_unknown','existing_source_changed','rule_disabled']){
  await assert.rejects(never.confirm({...preview,status,canSend:false},'unused'),/현재 알림을 보낼 수 없습니다/)
 }
 assert.equal(calls,0)
 for(const override of [
  {recovered:undefined},{recovered:false},{previousSourceEventId:undefined},
  {previousSourceEventId:newSourceId},{sourceEventIds:[oldSourceId]},
  {sourceEventIds:['-'.repeat(36)]},{previousEventId:'bad'},
 ]){
  const service=createRegistrationManagementPreviewService({async rpc(){return {data:{sourceEventIds:[newSourceId],recovered:true,previousSourceEventId:oldSourceId,...override},error:null}}})
  await assert.rejects(service.confirm(recoveryPreview,'key'),/요청을 확인할 수 없습니다/)
 }
 const unexpectedRecovery=createRegistrationManagementPreviewService({async rpc(){return {data:{sourceEventIds:[newSourceId],recovered:true,previousSourceEventId:oldSourceId},error:null}}})
 await assert.rejects(unexpectedRecovery.confirm(preview,'key'),/요청을 확인할 수 없습니다/)
})

test('recovery conflicts require reviewing current history and preview again',async()=>{
 for(const code of ['recovery_changed','recovery_not_allowed']){
  const service=createRegistrationManagementPreviewService({async rpc(){return {data:null,error:{message:`registration_management_notification_${code}`}}}})
  await assert.rejects(service.confirm(recoveryPreview,'key'),/이전 안내의 처리 상태가 변경.*미리보기를 다시/)
 }
})

test('timed-out recovery ignores a late result and retries the same explicit request identity',async()=>{
 const calls=[]
 let settleFirst
 const response={data:{sourceEventIds:[newSourceId],recovered:true,previousSourceEventId:oldSourceId,previousEventId:oldEventId},error:null}
 const service=createRegistrationManagementPreviewService({rpc(name,args){
  calls.push({name,args})
  return calls.length===1?new Promise(resolve=>{settleFirst=resolve}):Promise.resolve(response)
 }},5)
 let confirmResolved=false
 const pending=service.confirm(recoveryPreview,'retained-key').then(()=>{confirmResolved=true})
 await assert.rejects(pending,/응답 시간이 초과/)
 settleFirst(response)
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal(confirmResolved,false)
 const retry=await service.confirm(recoveryPreview,'retained-key')
 assert.equal(retry.recovered,true)
 assert.deepEqual(calls[0],calls[1])
})
