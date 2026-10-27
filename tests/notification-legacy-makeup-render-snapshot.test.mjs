import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, want } from './helpers/makeup-canonical-render-fixture.mjs'
import { renderLegacyMakeupSnapshot } from '../src/features/notifications/server/legacy-makeup-render-snapshot.ts'
import { sanitizeNotificationFreeText } from '../src/features/notifications/server/presentation/notification-presentation-formatters.ts'

for (const event of Object.keys(want)) test(`${event}: actual template/contract produces exact canonical title and body`, () => {
 const {item, snapshot, sourceEventId} = fixture(event)
 assert.deepEqual(renderLegacyMakeupSnapshot(item, sourceEventId, snapshot), {renderedTitle:want[event][0],renderedBody:want[event][1]})
})
test('legacy snapshot retains the original DB-rendered semantics', () => {
 const {item,snapshot,sourceEventId} = fixture()
 snapshot.allowed_variables = [{key:'cancel_date',token:'휴강일',piiClass:'none'}]
 snapshot.body_template = '{휴강일}'
 assert.equal(renderLegacyMakeupSnapshot(item, sourceEventId, snapshot), null)
})
test('snapshot event/source/rule/template/audience/channel/occurrence boundaries fail closed', () => {
 for(const key of ['event_id','workflow_key','event_key','source_type','source_id','rule_id','rule_revision','template_id','channel_key','audience_key','occurrence_key','occurred_at']) {
  const {item,snapshot,sourceEventId} = fixture()
  assert.throws(()=>renderLegacyMakeupSnapshot(item,sourceEventId,{...snapshot,[key]:'mismatch'}),/makeup_legacy_render_snapshot_invalid/,key)
 }
})
test('unknown/malformed tokens and missing required display data fail before materialization', () => {
 const {item,snapshot,sourceEventId} = fixture()
 for(const body_template of ['{알수없음}', '{미완료', '<b>unsafe</b>', 'https://example.invalid']) assert.throws(()=>renderLegacyMakeupSnapshot(item,sourceEventId,{...snapshot,body_template}))
 assert.throws(()=>renderLegacyMakeupSnapshot(item,sourceEventId,{...snapshot,payload:{...snapshot.payload,teacher_name:null}}))
})
test('free text uses the actual privacy sanitizer and complete graphemes', () => {
 const reason = '가족👨‍👩‍👧‍👦🇰🇷e\u0301'.repeat(90)+' https://example.invalid 010-1234-5678 @all'
 const {item,snapshot,sourceEventId}=fixture('makeup.submitted',{reason,memo:'010-1234-5678 user@example.invalid @all https://example.invalid'})
 const result=renderLegacyMakeupSnapshot(item,sourceEventId,snapshot)
 assert.ok(result.renderedBody.includes('[사유] '+sanitizeNotificationFreeText(reason)))
 assert.ok(result.renderedBody.includes('[메모] [연락처 숨김] [연락처 숨김] [전체 호출 숨김] [링크 포함]'))
 assert.doesNotMatch(result.renderedBody,/010-1234-5678|user@example|https?:|@all/)
})
test('literal braces in user text are not interpreted as a second template', () => {
 const {item,snapshot,sourceEventId}=fixture('makeup.submitted',{reason:'가상 {담당선생님}',memo:null})
 assert.ok(renderLegacyMakeupSnapshot(item,sourceEventId,snapshot).renderedBody.includes('[사유] 가상 {담당선생님}'))
})
test('cancel-only, makeup-only, multiple dates and year boundaries use canonical rules', () => {
 for(const [patch,expected] of [
  [{request_kind:'cancel_only',makeup_schedule:[]},'해당 없음 (휴강만 신청)'],
  [{request_kind:'makeup_only',cancel_date:null},'해당 없음 (보강만 신청)'],
  [{makeup_schedule:[{start_at:'2026-12-31T14:00:00Z',end_at:'2026-12-31T16:00:00Z',place:'가상강의실'}]},'12월 31일(목) 23:00~2027년 1월 1일(금) 01:00'],
 ]) {
  const {item,snapshot,sourceEventId}=fixture('makeup.submitted',patch)
  assert.ok(renderLegacyMakeupSnapshot(item,sourceEventId,snapshot).renderedBody.includes(expected))
 }
 const {item,snapshot,sourceEventId}=fixture()
 snapshot.payload.makeup_schedule.push({start_at:'2026-11-16T01:00:00Z',end_at:'2026-11-16T03:00:00Z',place:'두번째 가상강의실'})
 const result=renderLegacyMakeupSnapshot(item,sourceEventId,snapshot)
 assert.match(result.renderedBody,/11월 14일\(토\) 10:00~12:00 · 11월 16일\(월\) 10:00~12:00/)
 assert.match(result.renderedBody,/가상강의실, 두번째 가상강의실/)
})
test('retired in-app channel is outside the Google Chat renderer bridge',()=>{
 const {item,snapshot,sourceEventId}=fixture()
 assert.throws(()=>renderLegacyMakeupSnapshot({...item,channelKey:'in_app',connectionKey:null},sourceEventId,snapshot),/makeup_legacy_render_snapshot_invalid/)
})
test('a legacy key with a newer token cannot fall back to the old SQL token list', () => {
 const {item,snapshot,sourceEventId}=fixture()
 snapshot.allowed_variables=[{key:'teacher_name',token:'담당선생님',piiClass:'staff_name'}]
 snapshot.title_template='가상 제목'
 snapshot.body_template='{담당선생님}'
 assert.deepEqual(renderLegacyMakeupSnapshot(item,sourceEventId,snapshot),{renderedTitle:'가상 제목',renderedBody:'가상교사'})
})
