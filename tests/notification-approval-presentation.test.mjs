import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/approval-notification-presentation.ts",
  import.meta.url,
)

const EVENT_STATUS = Object.freeze({
  "approval.created": "draft",
  "approval.submitted": "submitted",
  "approval.review_started": "reviewing",
  "approval.approver_changed": "submitted",
  "approval.approved": "approved",
  "approval.returned": "returned",
  "approval.canceled": "canceled",
  "approval.resubmitted": "submitted",
  "approval.comment_added": "reviewing",
})

function input(eventKey, requestedContextKeys, payload = {}, overrides = {}) {
  return {
    workflowKey: "approvals",
    eventKey,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 1,
    payload: {
      approval_id: "87000000-0000-4000-8000-000000000001",
      title: "7월 교재비 정산서",
      status: EVENT_STATUS[eventKey],
      author_name: "박지영",
      current_approver_name: "김철수",
      before_approver_name: "이영희",
      after_approver_name: "김철수",
      actor_name: "김철수",
      target_period: "2026년 7월",
      memo: "검토용 메모",
      status_changed_at: "2026-08-04T06:30:00.000Z",
      attachment_count: 2,
      attachment_types: ["pdf", "spreadsheet"],
      comment_author_name: "박지영",
      comment_body: "확인 부탁드립니다.",
      occurred_at: "2026-08-04T06:30:00.000Z",
      ...payload,
    },
    audienceKey: "management_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "approvals",
      eventKey,
      audienceKey: "management_team",
      channelKey: "google_chat",
      ruleVariantKey: "immediate",
    },
    requestedContextKeys,
    connectionKey: "google_chat.management",
    destinationTeam: "management",
    scheduledFor: "2026-08-04T06:30:00.000Z",
    ...overrides,
  }
}

function render(template, context) {
  return template.replace(/\{([a-z][a-z0-9_]*)\}/gu, (_, key) => context[key] ?? "")
}

const GOLDENS = [
  {
    eventKey: "approval.created",
    keys: ["document_title", "author_name", "target_period", "current_status", "attachment_line", "memo_line"],
    payload: { memo: "검토용 초안" },
    template: "📝 [전자결재] {document_title}가 작성됐어요\n\n[문서] {document_title} · 작성자 {author_name}\n[기간] {target_period}\n[상태] {current_status}\n{attachment_line}\n{memo_line}",
    want: "📝 [전자결재] 7월 교재비 정산서가 작성됐어요\n\n[문서] 7월 교재비 정산서 · 작성자 박지영\n[기간] 2026년 7월\n[상태] 초안\n[첨부] 파일 2개 · PDF, 스프레드시트\n[메모] 검토용 초안",
  },
  {
    eventKey: "approval.submitted",
    keys: ["document_title", "author_name", "target_period", "progress_actor", "attachment_line"],
    payload: {},
    template: "📥 [전자결재] {document_title}가 제출됐어요\n\n[문서] {document_title} · 작성자 {author_name}\n[기간] {target_period}\n[진행] {progress_actor}의 결재를 기다리고 있어요.\n{attachment_line}",
    want: "📥 [전자결재] 7월 교재비 정산서가 제출됐어요\n\n[문서] 7월 교재비 정산서 · 작성자 박지영\n[기간] 2026년 7월\n[진행] 김철수님의 결재를 기다리고 있어요.\n[첨부] 파일 2개 · PDF, 스프레드시트",
  },
  {
    eventKey: "approval.review_started",
    keys: ["document_title", "reviewer_name", "current_status", "memo_line"],
    payload: { memo: "검토를 시작했어요." },
    template: "👀 [전자결재] {document_title} 검토가 시작됐어요\n\n[문서] {document_title}\n[검토] {reviewer_name}\n[상태] {current_status}\n{memo_line}",
    want: "👀 [전자결재] 7월 교재비 정산서 검토가 시작됐어요\n\n[문서] 7월 교재비 정산서\n[검토] 김철수님\n[상태] 검토 중\n[메모] 검토를 시작했어요.",
  },
  {
    eventKey: "approval.approver_changed",
    keys: ["document_title", "before_approver", "after_approver", "progress_line"],
    payload: {},
    template: "🔄 [전자결재] {document_title} 결재자가 바뀌었어요\n\n[문서] {document_title}\n[변경] {before_approver} → {after_approver}\n{progress_line}",
    want: "🔄 [전자결재] 7월 교재비 정산서 결재자가 바뀌었어요\n\n[문서] 7월 교재비 정산서\n[변경] 이영희님 → 김철수님\n[진행] 김철수님의 결재를 기다리고 있어요.",
  },
  {
    eventKey: "approval.approved",
    keys: ["document_title", "approval_actor", "current_status", "processed_at", "memo_line"],
    payload: { memo: "이상 없음" },
    template: "✅ [전자결재] {document_title} 결재가 승인됐어요\n\n[문서] {document_title}\n[승인] {approval_actor}\n[상태] {current_status}\n[처리] {processed_at}\n{memo_line}",
    want: "✅ [전자결재] 7월 교재비 정산서 결재가 승인됐어요\n\n[문서] 7월 교재비 정산서\n[승인] 김철수님\n[상태] 승인 완료\n[처리] 8월 4일(화) 15:30\n[메모] 이상 없음",
  },
  {
    eventKey: "approval.returned",
    keys: ["document_title", "return_actor", "current_status", "reason_line", "memo_line"],
    payload: { reason: "증빙 자료 보완 필요", memo: "8월 내 재상신" },
    template: "↩️ [전자결재] {document_title} 결재가 반려됐어요\n\n[문서] {document_title}\n[반려] {return_actor}\n[상태] {current_status}\n{reason_line}\n{memo_line}",
    want: "↩️ [전자결재] 7월 교재비 정산서 결재가 반려됐어요\n\n[문서] 7월 교재비 정산서\n[반려] 김철수님\n[상태] 반려\n[사유] 증빙 자료 보완 필요\n[메모] 8월 내 재상신",
  },
  {
    eventKey: "approval.canceled",
    keys: ["document_title", "cancel_actor", "current_status", "reason_line", "memo_line"],
    payload: { reason: "제출 대상 변경", memo: "다음 달 양식 사용" },
    template: "🚫 [전자결재] {document_title} 결재가 취소됐어요\n\n[문서] {document_title}\n[취소] {cancel_actor}\n[상태] {current_status}\n{reason_line}\n{memo_line}",
    want: "🚫 [전자결재] 7월 교재비 정산서 결재가 취소됐어요\n\n[문서] 7월 교재비 정산서\n[취소] 김철수님\n[상태] 취소\n[사유] 제출 대상 변경\n[메모] 다음 달 양식 사용",
  },
  {
    eventKey: "approval.resubmitted",
    keys: ["document_title", "resubmitter_name", "progress_actor", "attachment_line"],
    payload: { actor_name: "박지영" },
    template: "🔁 [전자결재] {document_title}가 다시 제출됐어요\n\n[문서] {document_title}\n[재상신] {resubmitter_name}\n[진행] {progress_actor}의 결재를 기다리고 있어요.\n{attachment_line}",
    want: "🔁 [전자결재] 7월 교재비 정산서가 다시 제출됐어요\n\n[문서] 7월 교재비 정산서\n[재상신] 박지영님\n[진행] 김철수님의 결재를 기다리고 있어요.\n[첨부] 파일 2개 · PDF, 스프레드시트",
  },
  {
    eventKey: "approval.comment_added",
    keys: ["document_title", "comment_author", "comment_preview", "attachment_line", "progress_line"],
    payload: {},
    template: "💬 [전자결재] {document_title}에 댓글이 등록됐어요\n\n[문서] {document_title}\n[댓글] {comment_author} · {comment_preview}\n{attachment_line}\n{progress_line}",
    want: "💬 [전자결재] 7월 교재비 정산서에 댓글이 등록됐어요\n\n[문서] 7월 교재비 정산서\n[댓글] 박지영님 · 확인 부탁드립니다.\n[첨부] 파일 2개 · PDF, 스프레드시트\n[진행] 김철수님이 검토하고 있어요.",
  },
]

test("전자결재 9개 event는 링크 없이 판단 가능한 정확한 기본 문구를 만든다", async () => {
  const { buildApprovalNotificationPresentation } = await import(presentationUrl)
  for (const golden of GOLDENS) {
    const context = buildApprovalNotificationPresentation(input(
      golden.eventKey,
      golden.keys,
      golden.payload,
    ))
    const message = render(golden.template, context)
    assert.equal(message, golden.want, golden.eventKey)
    assert.doesNotMatch(message, /\[다음\]|확인해\s*주세요|처리해\s*주세요|클릭해\s*주세요|\/admin\/|[0-9a-f]{8}-[0-9a-f-]{27,}/iu)
  }
})

test("결재자 null은 누락과 구분하고 이름이나 ID를 추측하지 않는다", async () => {
  const { buildApprovalNotificationPresentation } = await import(presentationUrl)
  assert.deepEqual(buildApprovalNotificationPresentation(input(
    "approval.approver_changed",
    ["before_approver", "after_approver", "progress_line"],
    { before_approver_name: null, after_approver_name: "김철수" },
  )), {
    before_approver: "결재자 지정 대기",
    after_approver: "김철수님",
    progress_line: "[진행] 김철수님의 결재를 기다리고 있어요.",
  })
  assert.deepEqual(buildApprovalNotificationPresentation(input(
    "approval.approver_changed",
    ["before_approver", "after_approver", "progress_line"],
    { before_approver_name: "김철수", after_approver_name: null },
  )), {
    before_approver: "김철수님",
    after_approver: "결재자 지정 대기",
    progress_line: "[진행] 결재자 지정을 기다리고 있어요.",
  })
  assert.equal(buildApprovalNotificationPresentation(input(
    "approval.submitted",
    ["progress_actor"],
    { current_approver_name: null },
  )).progress_actor, "담당 결재자")
  const missing = input("approval.submitted", ["progress_actor"])
  delete missing.payload.current_approver_name
  assert.throws(
    () => buildApprovalNotificationPresentation(missing),
    /notification_presentation_required_field_missing/,
  )
})

test("댓글·사유는 안전하게 줄이고 첨부는 파일명 없이 개수와 유형만 표시한다", async () => {
  const { buildApprovalNotificationPresentation } = await import(presentationUrl)
  const context = buildApprovalNotificationPresentation(input(
    "approval.comment_added",
    ["comment_preview", "attachment_line"],
    {
      comment_body: "확인 https://example.com @all 010-1234-5678 /admin/approvals",
      attachment_count: 3,
      attachment_types: ["image", "pdf", "spreadsheet"],
      attachment_filenames: ["학생명단.xlsx", "영수증.pdf"],
    },
  ))
  assert.deepEqual(context, {
    comment_preview: "확인 [링크 포함] [전체 호출 숨김] [연락처 숨김] [내부 경로 숨김]",
    attachment_line: "[첨부] 파일 3개 · 이미지, PDF, 스프레드시트",
  })
  assert.doesNotMatch(JSON.stringify(context), /학생명단|영수증|example\.com|010-1234-5678|@all|\/admin\//)
})

test("전자결재 presentation은 관리팀 외 Google Chat 목적지와 event 상태 불일치를 닫는다", async () => {
  const { buildApprovalNotificationPresentation } = await import(presentationUrl)
  assert.throws(
    () => buildApprovalNotificationPresentation(input(
      "approval.submitted",
      ["document_title"],
      {},
      { connectionKey: "google_chat.executive", destinationTeam: "executive" },
    )),
    /notification_approval_destination_unsupported/,
  )
  assert.throws(
    () => buildApprovalNotificationPresentation(input(
      "approval.approved",
      ["current_status"],
      { status: "reviewing" },
    )),
    /notification_approval_event_state_mismatch/,
  )
})
