import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/makeup-notification-presentation.ts",
  import.meta.url,
)

const EVENT_STATE = Object.freeze({
  "makeup.submitted": "approval_pending",
  "makeup.refund_requested": "refund_pending",
  "makeup.approved": "makeup_pending",
  "makeup.refund_completed": "completed",
  "makeup.approval_canceled": "canceled",
  "makeup.revision_requested": "revision_requested",
  "makeup.rejected": "rejected",
})

function input(eventKey, requestedContextKeys, payload = {}, overrides = {}) {
  return {
    workflowKey: "makeup_requests",
    eventKey,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 1,
    payload: {
      makeup_request_id: "86000000-0000-4000-8000-000000000001",
      request_kind: "cancel_makeup",
      class_name: "대기고1A",
      subject: "영어",
      approval_group: "english",
      teacher_name: "강부희",
      status: EVENT_STATE[eventKey],
      workflow_status: EVENT_STATE[eventKey],
      cancel_date: "2026-08-05",
      makeup_schedule: [{
        start_at: "2026-08-07T01:00:00.000Z",
        end_at: "2026-08-07T03:00:00.000Z",
        place: "별관 3강",
      }],
      requester_name: "박지영",
      approver_name: "김철수",
      actor_name: "이관리",
      reason: "개인 일정",
      memo: "학생 안내 완료",
      event_note: "승인 메모",
      status_changed_at: "2026-08-04T06:30:00.000Z",
      attachment_count: 0,
      attachment_types: [],
      occurred_at: "2026-08-04T01:00:00.000Z",
      ...payload,
    },
    audienceKey: "subject_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "makeup_requests",
      eventKey,
      audienceKey: "subject_team",
      channelKey: "google_chat",
      ruleVariantKey: "immediate",
    },
    requestedContextKeys,
    connectionKey: "google_chat.english",
    destinationTeam: "english",
    scheduledFor: "2026-08-04T01:00:00.000Z",
    ...overrides,
  }
}

function render(template, context) {
  return template.replace(/\{([a-z][a-z0-9_]*)\}/gu, (_, key) => context[key] ?? "")
}

const GOLDENS = [
  {
    eventKey: "makeup.submitted",
    keys: [
      "class_name", "subjects", "teacher_name", "cancellation_date", "makeup_schedule",
      "place", "reason_line", "progress_actor",
    ],
    payload: {},
    template: "📥 [휴보강] {class_name} {subjects} 휴보강 신청이 들어왔어요\n\n[수업] {subjects} · {teacher_name} 선생님 담당\n[일정] 휴강 {cancellation_date} → 보강 {makeup_schedule}\n[장소] {place}\n{reason_line}\n[진행] {progress_actor}의 결재를 기다리고 있어요.",
    want: "📥 [휴보강] 대기고1A 영어 휴보강 신청이 들어왔어요\n\n[수업] 영어 · 강부희 선생님 담당\n[일정] 휴강 8월 5일(수) → 보강 8월 7일(금) 10:00~12:00\n[장소] 별관 3강\n[사유] 개인 일정\n[진행] 김철수님의 결재를 기다리고 있어요.",
  },
  {
    eventKey: "makeup.refund_requested",
    keys: ["class_name", "subjects", "target_schedule", "current_status", "reason_line", "progress_line"],
    payload: { event_note: "보강 일정 취소" },
    template: "💳 [휴보강] {class_name} {subjects} 휴보강 환불 신청이 들어왔어요\n\n[수업] {subjects} · {class_name}\n[대상] {target_schedule}\n[상태] {current_status}\n{reason_line}\n{progress_line}",
    want: "💳 [휴보강] 대기고1A 영어 휴보강 환불 신청이 들어왔어요\n\n[수업] 영어 · 대기고1A\n[대상] 8월 7일(금) 10:00~12:00\n[상태] 환불대기\n[사유] 보강 일정 취소\n[진행] 관리팀의 환불 확인을 기다리고 있어요.",
  },
  {
    eventKey: "makeup.approved",
    keys: [
      "class_name", "subjects", "cancellation_date", "makeup_schedule", "place",
      "approval_actor", "memo_line",
    ],
    payload: { event_note: "보강 일정 확정" },
    template: "✅ [휴보강] {class_name} {subjects} 휴보강 신청이 승인됐어요\n\n[수업] {subjects} · {class_name}\n[일정] 휴강 {cancellation_date} → 보강 {makeup_schedule}\n[장소] {place}\n[승인] {approval_actor}\n{memo_line}",
    want: "✅ [휴보강] 대기고1A 영어 휴보강 신청이 승인됐어요\n\n[수업] 영어 · 대기고1A\n[일정] 휴강 8월 5일(수) → 보강 8월 7일(금) 10:00~12:00\n[장소] 별관 3강\n[승인] 이관리님\n[메모] 보강 일정 확정",
  },
  {
    eventKey: "makeup.refund_completed",
    keys: ["class_name", "subjects", "current_status", "processed_at", "processing_actor", "memo_line"],
    payload: { event_note: "환불 접수 완료" },
    template: "✅ [휴보강] {class_name} {subjects} 휴보강 환불 처리가 끝났어요\n\n[수업] {subjects} · {class_name}\n[상태] {current_status}\n[처리] {processed_at} · {processing_actor}\n{memo_line}",
    want: "✅ [휴보강] 대기고1A 영어 휴보강 환불 처리가 끝났어요\n\n[수업] 영어 · 대기고1A\n[상태] 완료\n[처리] 8월 4일(화) 15:30 · 이관리님\n[메모] 환불 접수 완료",
  },
  {
    eventKey: "makeup.approval_canceled",
    keys: [
      "class_name", "subjects", "current_status", "processed_at", "processing_actor",
      "reason_line", "memo_line",
    ],
    payload: { event_note: "학원 일정 변경", memo: "수업 일정 재협의" },
    template: "↩️ [휴보강] {class_name} {subjects} 휴보강 승인이 취소됐어요\n\n[수업] {subjects} · {class_name}\n[상태] {current_status}\n[처리] {processed_at} · {processing_actor}\n{reason_line}\n{memo_line}",
    want: "↩️ [휴보강] 대기고1A 영어 휴보강 승인이 취소됐어요\n\n[수업] 영어 · 대기고1A\n[상태] 승인 취소\n[처리] 8월 4일(화) 15:30 · 이관리님\n[사유] 학원 일정 변경\n[메모] 수업 일정 재협의",
  },
  {
    eventKey: "makeup.revision_requested",
    keys: ["class_name", "subjects", "return_actor", "current_status", "reason_line"],
    payload: { event_note: "보강 강의실 정보 부족" },
    template: "📝 [휴보강] {class_name} {subjects} 휴보강 보완 요청이 등록됐어요\n\n[수업] {subjects} · {class_name}\n[상태] {current_status}\n[요청] {return_actor}\n{reason_line}",
    want: "📝 [휴보강] 대기고1A 영어 휴보강 보완 요청이 등록됐어요\n\n[수업] 영어 · 대기고1A\n[상태] 보완 요청\n[요청] 이관리님\n[사유] 보강 강의실 정보 부족",
  },
  {
    eventKey: "makeup.rejected",
    keys: ["class_name", "subjects", "return_actor", "current_status", "reason_line", "memo_line"],
    payload: { event_note: "일정 중복", memo: "다른 일정 검토" },
    template: "⛔ [휴보강] {class_name} {subjects} 휴보강 신청이 반려됐어요\n\n[수업] {subjects} · {class_name}\n[상태] {current_status}\n[반려] {return_actor}\n{reason_line}\n{memo_line}",
    want: "⛔ [휴보강] 대기고1A 영어 휴보강 신청이 반려됐어요\n\n[수업] 영어 · 대기고1A\n[상태] 반려\n[반려] 이관리님\n[사유] 일정 중복\n[메모] 다른 일정 검토",
  },
]

test("휴보강 7개 event는 링크 없이 판단 가능한 정확한 기본 문구를 만든다", async () => {
  const { buildMakeupNotificationPresentation } = await import(presentationUrl)
  for (const golden of GOLDENS) {
    const context = buildMakeupNotificationPresentation(input(
      golden.eventKey,
      golden.keys,
      golden.payload,
    ))
    const message = render(golden.template, context)
    assert.equal(message, golden.want, golden.eventKey)
    assert.doesNotMatch(message, /\[다음\]|확인해\s*주세요|처리해\s*주세요|클릭해\s*주세요|\/admin\/|[0-9a-f]{8}-[0-9a-f-]{27,}/iu)
  }
})

test("휴보강 자유 입력은 event 우선순위에서 최대 두 줄만 안전하게 표시한다", async () => {
  const { buildMakeupNotificationPresentation } = await import(presentationUrl)
  const context = buildMakeupNotificationPresentation(input(
    "makeup.submitted",
    ["reason_line", "memo_line", "attachment_line"],
    {
      reason: "개인 일정 https://example.com @all",
      memo: "연락처 010-1234-5678",
      event_note: "세 번째 자유 입력",
      attachment_count: 2,
      attachment_types: ["pdf", "image"],
    },
  ))
  assert.deepEqual(context, {
    reason_line: "[사유] 개인 일정 [링크 포함] [전체 호출 숨김]",
    memo_line: "[메모] 연락처 [연락처 숨김]",
    attachment_line: "[첨부] 파일 2개 · 이미지, PDF",
  })
  assert.doesNotMatch(Object.values(context).join("\n"), /세 번째 자유 입력|example\.com|010-1234-5678|@all/)
})

test("휴보강 presentation은 과목팀 목적지 불일치와 불완전 일정을 실패 폐쇄한다", async () => {
  const { buildMakeupNotificationPresentation } = await import(presentationUrl)
  assert.throws(
    () => buildMakeupNotificationPresentation(input(
      "makeup.submitted",
      ["subjects"],
      {},
      { connectionKey: "google_chat.math", destinationTeam: "math" },
    )),
    /notification_makeup_destination_unsupported/,
  )
  assert.throws(
    () => buildMakeupNotificationPresentation(input(
      "makeup.approved",
      ["makeup_schedule"],
      { makeup_schedule: [{ start_at: "2026-08-07T01:00:00.000Z", place: "별관 3강" }] },
    )),
    /notification_makeup_schedule_invalid/,
  )
  assert.deepEqual(buildMakeupNotificationPresentation(input(
    "makeup.submitted",
    [],
    { class_name: undefined },
  )), {})
})

test("휴강만·보강만 신청은 없는 일정을 숨기지 않고 명시한다", async () => {
  const { buildMakeupNotificationPresentation } = await import(presentationUrl)
  assert.deepEqual(buildMakeupNotificationPresentation(input(
    "makeup.submitted",
    ["cancellation_date", "makeup_schedule", "place"],
    { request_kind: "cancel_only", makeup_schedule: [] },
  )), {
    cancellation_date: "8월 5일(수)",
    makeup_schedule: "해당 없음 (휴강만 신청)",
    place: "해당 없음 (휴강만 신청)",
  })
  assert.deepEqual(buildMakeupNotificationPresentation(input(
    "makeup.submitted",
    ["cancellation_date", "makeup_schedule", "place"],
    { request_kind: "makeup_only", cancel_date: null },
  )), {
    cancellation_date: "해당 없음 (보강만 신청)",
    makeup_schedule: "8월 7일(금) 10:00~12:00",
    place: "별관 3강",
  })
})
