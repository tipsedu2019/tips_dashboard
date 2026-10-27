import { readFileSync } from 'node:fs'
import { listNotificationContentContracts } from '../../src/features/notifications/notification-content-contract-registry.ts'
const source = readFileSync('supabase/migrations/20260803152000_notification_system_templates_vnext.sql', 'utf8')
const templates = JSON.parse(source.match(/\$notification_system_templates\$([\s\S]*?)\$notification_system_templates\$/u)[1]).filter(x => x.workflowKey === 'makeup_requests')
const states = { submitted:'approval_pending', refund_requested:'refund_pending', approved:'makeup_pending', refund_completed:'completed', approval_canceled:'canceled', revision_requested:'revision_requested', rejected:'rejected' }
export const id = n => `84000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export function fixture(eventKey='makeup.submitted', patch={}) {
  const t = templates.find(x => x.eventKey === eventKey)
  const entry = listNotificationContentContracts().find(x => x.eventKey === eventKey && x.channelKey === 'google_chat')
  const vars = entry.contract.availableVariables
  const tokens = new Map(vars.map(v => [v.key, v.token]))
  const translate = value => value.replace(/\{([^{}]+)\}/g, (_, key) => `{${tokens.get(key)}}`)
  const connectionKey = entry.audienceKey === 'subject_team' ? 'google_chat.math' : entry.audienceKey === 'executive_team' ? 'google_chat.executive' : 'google_chat.management'
  const item = { eventId:id(1), eventKey, occurrenceKey:id(2), ruleId:id(3), ruleRevision:'1', templateId:id(4), templateChecksum:'a'.repeat(64), channelKey:'google_chat', audienceKey:entry.audienceKey, connectionKey, href:`/admin/makeup-requests?requestId=${id(5)}`, scheduledFor:'2026-10-26T00:00:00+00:00' }
  const payload = { request_kind:'cancel_makeup', class_name:'가상반', subject:'수학', approval_group:'math_middle', teacher_name:'가상교사', cancel_date:'2026-11-13', makeup_schedule:[{start_at:'2026-11-14T01:00:00Z',end_at:'2026-11-14T03:00:00Z',place:'가상강의실'}], reason:'가상 사유', memo:'가상 메모', event_note:'가상 처리 메모', approver_name:'가상결재자', actor_name:'가상처리자', status_changed_at:'2026-10-26T01:00:00Z', occurred_at:'2026-10-26T00:00:00+00:00', attachment_count:0, attachment_types:[], workflow_status:states[eventKey.split('.')[1]], ...patch }
  const snapshot = { event_id:item.eventId, workflow_key:'makeup_requests', event_key:eventKey, occurrence_key:item.occurrenceKey, source_type:'makeup_request_event', source_id:id(2), rule_id:item.ruleId, rule_revision:item.ruleRevision, template_id:item.templateId, channel_key:item.channelKey, audience_key:item.audienceKey, occurred_at:item.scheduledFor, allowed_variables:vars, title_template:translate(t.titleTemplate), body_template:translate(t.bodyTemplate), rule_variant_key:entry.ruleVariantKey, payload_schema_version:1, template_payload_schema_version:1, payload }
  return { item, snapshot, sourceEventId:id(2) }
}
export const want = {
 'makeup.submitted':['📥 [휴보강] 가상반 수학 휴보강 신청이 들어왔어요','[수업] 수학 · 가상교사 선생님 담당\n[일정] 휴강 11월 13일(금) → 보강 11월 14일(토) 10:00~12:00\n[장소] 가상강의실\n[사유] 가상 사유\n[메모] 가상 메모\n[진행] 가상결재자님의 결재를 기다리고 있어요.'],
 'makeup.refund_requested':['💳 [휴보강] 가상반 수학 휴보강 환불 신청이 들어왔어요','[수업] 수학 · 가상반\n[대상] 11월 14일(토) 10:00~12:00\n[상태] 환불대기\n[사유] 가상 처리 메모\n[진행] 관리팀의 환불 확인을 기다리고 있어요.'],
 'makeup.approved':['✅ [휴보강] 가상반 수학 휴보강 신청이 승인됐어요','[수업] 수학 · 가상반\n[일정] 휴강 11월 13일(금) → 보강 11월 14일(토) 10:00~12:00\n[장소] 가상강의실\n[승인] 가상처리자님\n[메모] 가상 처리 메모'],
 'makeup.refund_completed':['✅ [휴보강] 가상반 수학 휴보강 환불 처리가 끝났어요','[수업] 수학 · 가상반\n[상태] 완료\n[처리] 10월 26일(월) 10:00\n[메모] 가상 처리 메모'],
 'makeup.approval_canceled':['↩️ [휴보강] 가상반 수학 휴보강 승인이 취소됐어요','[수업] 수학 · 가상반\n[상태] 승인 취소\n[처리] 10월 26일(월) 10:00 · 가상처리자님\n[사유] 가상 처리 메모\n[메모] 가상 메모'],
 'makeup.revision_requested':['📝 [휴보강] 가상반 수학 휴보강 보완 요청이 등록됐어요','[수업] 수학 · 가상반\n[상태] 보완 요청\n[요청] 가상처리자님\n[사유] 가상 처리 메모'],
 'makeup.rejected':['⛔ [휴보강] 가상반 수학 휴보강 신청이 반려됐어요','[수업] 수학 · 가상반\n[상태] 반려\n[반려] 가상처리자님\n[사유] 가상 처리 메모\n[메모] 가상 메모'],
}
