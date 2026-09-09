import assert from "node:assert/strict"
import test from "node:test"
import { operationalSubjectConnections } from "../src/features/notifications/server/adapters/operational-subject-notification-routing.ts"
import { createRegistrationSubjectCompletionNotificationAdapter } from "../src/features/notifications/server/adapters/registration-subject-completion-notification-adapter.ts"
import { transferNotificationAdapter } from "../src/features/notifications/server/adapters/transfer-notification-adapter.ts"
import { withdrawalNotificationAdapter } from "../src/features/notifications/server/adapters/withdrawal-notification-adapter.ts"
import { getNotificationContentContract } from "../src/features/notifications/notification-content-contract-registry.ts"
import { isNotificationRuleCellAllowed } from "../src/features/notifications/notification-control-plane-types.ts"

const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const registration = createRegistrationSubjectCompletionNotificationAdapter({revalidateAuthoritativeSource: async()=>({ok:true})})
function input(workflowKey,eventKey,payload) {
  return {workflowKey,eventKey,eventId:uuid(1),sourceType:"ops_task_event",sourceId:uuid(2),sourceRevision:null,payloadSchemaVersion:1,payload,
    rule:{ruleId:uuid(3),ruleRevision:"1",templateId:uuid(4),audienceKey:"subject_team",channelKey:"google_chat",connectionKey:null,ruleVariantKey:"immediate"}}
}
function registrationInput(subject="영어") {
  return input("registration","registration.subject_registration_completed",{task_id:uuid(5),track_id:uuid(6),student_name:"테스트 학생",subject,notification_subjects:[subject],before_status:"admission_in_progress",after_status:"registered",status:"registered"})
}
const renderInput = (value,target) => ({...value,target,targetGeneration:"0",scheduledFor:"2026-09-09T00:00:00Z",requestedContextKeys:[]})

for(const [subject,team] of [["영어","english"],["수학","math"],["과학","science"]]) {
  test(`등록 완료는 ${subject} 팀 한 곳에만 표시되고 직접 등록 화면으로 연결된다`,async()=>{
    const value=registrationInput(subject)
    const resolved=await registration.resolveTargets(value)
    assert.deepEqual(resolved.targets.map(target=>target.connectionKey),[`google_chat.${team}`])
    const rendered=renderInput(value,resolved.targets[0])
    assert.deepEqual(await registration.buildRenderContext(rendered),{student_name:"테스트 학생",subjects:subject,current_status:"등록 완료"})
    assert.equal(await registration.buildDeepLink(rendered),`/admin/registration?taskId=${uuid(5)}&trackId=${uuid(6)}`)
    await assert.rejects(registration.buildRenderContext({...rendered,target:{...resolved.targets[0],connectionKey:"google_chat.management"}}),/notification_payload_schema_unsupported/)
  })
}
test("등록 체크 또는 미완료 상태, 다른 과목, 누락 이름은 완료 알림으로 해석하지 않는다",async()=>{
  for(const patch of [{after_status:"inquiry"},{before_status:"registered"},{status:"done"},{notification_subjects:["수학"]},{student_name:""},{subject:"unknown"}]) {
    const value=registrationInput()
    await assert.rejects(registration.resolveTargets({...value,payload:{...value.payload,...patch}}),/notification_payload_schema_unsupported/)
  }
})
for(const [workflowKey,adapter] of [["transfer",transferNotificationAdapter],["withdrawal",withdrawalNotificationAdapter]]) {
  test(`${workflowKey} 완료는 실제 과목만 중복 없이 선택하고 관리팀 규칙을 유지한다`,async()=>{
    const value=input(workflowKey,`${workflowKey}.completed`,{notification_subjects:["영어","수학","영어"]})
    const result=await adapter.resolveTargets(value)
    assert.deepEqual(result.targets.map(target=>target.connectionKey),["google_chat.english","google_chat.math"])
    const management=await adapter.resolveTargets({...value,rule:{...value.rule,audienceKey:"management_team",connectionKey:"google_chat.management"}})
    assert.deepEqual(management.targets.map(target=>target.connectionKey),["google_chat.management"])
    await assert.rejects(adapter.resolveTargets({...value,rule:{...value.rule,connectionKey:"google_chat.science"}}),/notification_payload_schema_unsupported/)
    await assert.rejects(adapter.resolveTargets({...value,eventKey:`${workflowKey}.submitted`}),/notification_payload_schema_unsupported/)
    await assert.rejects(adapter.resolveTargets({...value,payload:{notification_subjects:[]}}),/notification_payload_schema_unsupported/)
    await assert.rejects(adapter.resolveTargets({...value,rule:{...value.rule,channelKey:"in_app"}}),/notification_payload_schema_unsupported/)
  })
}
test("재시험 결과는 영어팀만 선택하며 다른 재시험 알림은 계속 차단한다",()=>{
  assert.deepEqual(operationalSubjectConnections("word_retest.result_reported",{notification_subjects:["영어"]}),["google_chat.english"])
  for(const [event,subjects] of [["word_retest.completed",["영어"]],["word_retest.result_reported",["수학"]]]) {
    assert.throws(()=>operationalSubjectConnections(event,{notification_subjects:subjects}),/notification_payload_schema_unsupported/)
  }
})
test("과목팀 완료 알림 네 가지는 기존 컨텐츠 검증과 즉시 알림 경로를 사용한다",()=>{
  for(const [workflowKey,eventKey] of [["registration","registration.subject_registration_completed"],["transfer","transfer.completed"],["withdrawal","withdrawal.completed"],["word_retests","word_retest.result_reported"]]) {
    const contract=getNotificationContentContract({workflowKey,eventKey,audienceKey:"subject_team",channelKey:"google_chat",ruleVariantKey:"immediate"})
    assert.ok(contract)
    assert.equal(isNotificationRuleCellAllowed({workflowKey,audienceKey:"subject_team",channelKey:"google_chat"}),true)
    assert.equal(contract.destinationPolicy.subjectScoped,true)
    assert.deepEqual(contract.supportedPayloadVersions,[1])
  }
})
