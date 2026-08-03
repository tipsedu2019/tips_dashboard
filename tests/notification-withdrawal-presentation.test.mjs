import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/withdrawal-notification-presentation.ts",
  import.meta.url,
)

function input(eventKey, payload = {}, requestedContextKeys = [], overrides = {}) {
  return {
    workflowKey: "withdrawal",
    eventKey,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 1,
    payload: {
      task_id: "85000000-0000-4000-8000-000000000001",
      student_name: "김민서",
      task_status: eventKey === "withdrawal.completed" ? "done" : "requested",
      selected_subject: "수학",
      selected_class: "중2 수학 A반",
      requested_withdrawal_date: "2026-08-31",
      requested_withdrawal_round: "8회차",
      applied_withdrawal_date: "2026-08-31",
      applied_withdrawal_round: "8회차",
      requester_name: "박지영",
      actor_name: "이관리",
      other_active_subjects: ["영어"],
      reason: "학습 일정 조정",
      memo: "8회차부터 제외",
      occurred_at: "2026-08-04T01:00:00.000Z",
      ...payload,
    },
    audienceKey: "management_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "withdrawal",
      eventKey,
      audienceKey: "management_team",
      channelKey: "google_chat",
      ruleVariantKey: "immediate",
    },
    requestedContextKeys,
    connectionKey: "google_chat.management",
    destinationTeam: "management",
    scheduledFor: "2026-08-04T01:00:00.000Z",
    ...overrides,
  }
}

test("수강 제외 제출은 선택 과목·반·요청 일정·신청자를 한 메시지에 표시한다", async () => {
  const { buildWithdrawalNotificationPresentation } = await import(presentationUrl)
  const context = buildWithdrawalNotificationPresentation(input(
    "withdrawal.submitted",
    {},
    [
      "student_name", "subjects", "class_name", "withdrawal_date", "withdrawal_round",
      "requester_name", "reason_line", "memo_line", "progress_line",
    ],
  ))

  assert.deepEqual(context, {
    student_name: "김민서 학생",
    subjects: "수학",
    class_name: "중2 수학 A반",
    withdrawal_date: "8월 31일(월)",
    withdrawal_round: "8회차",
    requester_name: "박지영님",
    reason_line: "[사유] 학습 일정 조정",
    memo_line: "[메모] 8회차부터 제외",
    progress_line: "[진행] 관리팀의 수강 제외 일정 확인을 기다리고 있어요.",
  })

  const message = `📥 [수강 제외] ${context.student_name}의 ${context.subjects} 수강 제외 신청이 들어왔어요\n\n`
    + `[수업] ${context.class_name}\n`
    + `[일정] ${context.withdrawal_date} · ${context.withdrawal_round}부터 제외 예정이에요.\n`
    + `[신청] ${context.requester_name}\n`
    + `${context.reason_line}\n${context.memo_line}\n${context.progress_line}`
  assert.equal(message, "📥 [수강 제외] 김민서 학생의 수학 수강 제외 신청이 들어왔어요\n\n[수업] 중2 수학 A반\n[일정] 8월 31일(월) · 8회차부터 제외 예정이에요.\n[신청] 박지영님\n[사유] 학습 일정 조정\n[메모] 8회차부터 제외\n[진행] 관리팀의 수강 제외 일정 확인을 기다리고 있어요.")
  assert.doesNotMatch(message, /퇴원/)
})

test("수강 제외 완료는 다른 활성 과목이 증명될 때만 보존 상태를 표시한다", async () => {
  const { buildWithdrawalNotificationPresentation } = await import(presentationUrl)
  const context = buildWithdrawalNotificationPresentation(input(
    "withdrawal.completed",
    {
      requested_withdrawal_date: "2026-08-24",
      requested_withdrawal_round: "7회차",
      other_active_subjects: ["과학", "영어"],
    },
    ["student_name", "subjects", "class_name", "withdrawal_date", "withdrawal_round", "progress_line"],
  ))

  assert.deepEqual(context, {
    student_name: "김민서 학생",
    subjects: "수학",
    class_name: "중2 수학 A반",
    withdrawal_date: "8월 31일(월)",
    withdrawal_round: "8회차",
    progress_line: "[상태] 다른 과목 수강은 그대로 유지돼요.",
  })

  const message = `✅ [수강 제외] ${context.student_name}의 ${context.subjects} 수강 제외 처리가 끝났어요\n\n`
    + `[수업] ${context.class_name}\n`
    + `[일정] ${context.withdrawal_date} · ${context.withdrawal_round}부터 제외\n`
    + context.progress_line
  assert.equal(message, "✅ [수강 제외] 김민서 학생의 수학 수강 제외 처리가 끝났어요\n\n[수업] 중2 수학 A반\n[일정] 8월 31일(월) · 8회차부터 제외\n[상태] 다른 과목 수강은 그대로 유지돼요.")
  assert.doesNotMatch(message, /퇴원/)
})

test("다른 활성 과목 빈 배열은 보존을 주장하지 않고 key 누락은 실패한다", async () => {
  const { buildWithdrawalNotificationPresentation } = await import(presentationUrl)
  const empty = buildWithdrawalNotificationPresentation(input(
    "withdrawal.completed",
    { other_active_subjects: [] },
    ["student_name", "progress_line"],
  ))
  assert.deepEqual(empty, {
    student_name: "김민서 학생",
    progress_line: "",
  })
  assert.doesNotMatch(empty.progress_line, /다른 과목 수강은 그대로 유지/)

  assert.throws(
    () => buildWithdrawalNotificationPresentation(input(
      "withdrawal.completed",
      { other_active_subjects: undefined },
      ["student_name"],
    )),
    /notification_presentation_required_field_missing/,
  )
})

test("수강 제외 presentation은 선택 과목과 관리팀 Chat 목적지를 실패 폐쇄한다", async () => {
  const { buildWithdrawalNotificationPresentation } = await import(presentationUrl)
  assert.throws(
    () => buildWithdrawalNotificationPresentation(input(
      "withdrawal.submitted",
      { selected_subject: "국어" },
      ["subjects"],
    )),
    /notification_withdrawal_subject_unsupported/,
  )
  assert.throws(
    () => buildWithdrawalNotificationPresentation(input(
      "withdrawal.completed",
      {},
      ["subjects"],
      { connectionKey: "google_chat.english", destinationTeam: "english" },
    )),
    /notification_withdrawal_destination_unsupported/,
  )
  assert.deepEqual(buildWithdrawalNotificationPresentation(input(
    "withdrawal.submitted",
    { student_name: undefined },
    [],
  )), {})
})
