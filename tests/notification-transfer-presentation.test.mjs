import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/transfer-notification-presentation.ts",
  import.meta.url,
)

function input(eventKey, payload = {}, requestedContextKeys = [], overrides = {}) {
  return {
    workflowKey: "transfer",
    eventKey,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 1,
    payload: {
      task_id: "84000000-0000-4000-8000-000000000001",
      student_name: "김도윤",
      task_status: eventKey === "transfer.completed" ? "done" : "requested",
      requester_name: "박지영",
      teacher_name: "김수학",
      before_class: "중2 수학 A반",
      after_class: "중2 수학 B반",
      requested_effective_date: "2026-08-31",
      before_class_end_date: "2026-08-28",
      after_class_start_date: "2026-08-31",
      actor_name: "이관리",
      reason: "학생 일정 조정",
      memo: "월요일부터 이동",
      occurred_at: "2026-08-04T01:00:00.000Z",
      ...payload,
    },
    audienceKey: "management_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "transfer",
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

test("전반 제출은 신청자와 현재 반 선생님을 구분하고 요청 적용일을 표시한다", async () => {
  const { buildTransferNotificationPresentation } = await import(presentationUrl)
  const context = buildTransferNotificationPresentation(input(
    "transfer.submitted",
    {},
    [
      "student_name",
      "before_class",
      "after_class",
      "effective_date",
      "requester_name",
      "teacher_name",
      "reason_line",
      "memo_line",
      "progress_line",
    ],
  ))

  assert.deepEqual(context, {
    student_name: "김도윤 학생",
    before_class: "중2 수학 A반",
    after_class: "중2 수학 B반",
    effective_date: "8월 31일(월)",
    requester_name: "박지영님",
    teacher_name: "김수학님",
    reason_line: "[사유] 학생 일정 조정",
    memo_line: "[메모] 월요일부터 이동",
    progress_line: "[진행] 관리팀의 반 이동 일정 확인을 기다리고 있어요.",
  })
  assert.notEqual(context.requester_name, context.teacher_name)

  const message = `📥 [전반] ${context.student_name}의 반 이동 신청이 들어왔어요\n\n`
    + `[변경] ${context.before_class} → ${context.after_class}\n`
    + `[일정] ${context.effective_date}부터 이동 예정이에요.\n`
    + `[신청] ${context.requester_name}\n`
    + `${context.reason_line}\n${context.memo_line}\n${context.progress_line}`
  assert.equal(message, "📥 [전반] 김도윤 학생의 반 이동 신청이 들어왔어요\n\n[변경] 중2 수학 A반 → 중2 수학 B반\n[일정] 8월 31일(월)부터 이동 예정이에요.\n[신청] 박지영님\n[사유] 학생 일정 조정\n[메모] 월요일부터 이동\n[진행] 관리팀의 반 이동 일정 확인을 기다리고 있어요.")
})

test("전반 완료는 기존 반 종료일과 새 반 시작일을 각각 정확한 의미로 표시한다", async () => {
  const { buildTransferNotificationPresentation } = await import(presentationUrl)
  const context = buildTransferNotificationPresentation(input(
    "transfer.completed",
    {},
    [
      "student_name",
      "before_class",
      "after_class",
      "before_class_end_date",
      "after_class_start_date",
      "completion_status",
      "progress_line",
    ],
  ))

  assert.deepEqual(context, {
    student_name: "김도윤 학생",
    before_class: "중2 수학 A반",
    after_class: "중2 수학 B반",
    before_class_end_date: "8월 28일(금)",
    after_class_start_date: "8월 31일(월)",
    completion_status: "새 반으로 수강 정보가 반영됐어요.",
    progress_line: "[진행] 이관리님이 반 이동 처리를 완료했어요.",
  })

  const message = `✅ [전반] ${context.student_name}의 반 이동이 완료됐어요\n\n`
    + `[변경] ${context.before_class} → ${context.after_class}\n`
    + `[일정] 기존 반 ${context.before_class_end_date}까지 · 새 반 ${context.after_class_start_date}부터\n`
    + `[상태] ${context.completion_status}\n${context.progress_line}`
  assert.equal(message, "✅ [전반] 김도윤 학생의 반 이동이 완료됐어요\n\n[변경] 중2 수학 A반 → 중2 수학 B반\n[일정] 기존 반 8월 28일(금)까지 · 새 반 8월 31일(월)부터\n[상태] 새 반으로 수강 정보가 반영됐어요.\n[진행] 이관리님이 반 이동 처리를 완료했어요.")
})

test("전반 presentation은 날짜 의미 누락과 관리팀 외 목적지를 실패 폐쇄한다", async () => {
  const { buildTransferNotificationPresentation } = await import(presentationUrl)
  assert.throws(
    () => buildTransferNotificationPresentation(input(
      "transfer.submitted",
      { requested_effective_date: undefined },
      ["effective_date"],
    )),
    /notification_presentation_required_field_missing/,
  )
  assert.throws(
    () => buildTransferNotificationPresentation(input(
      "transfer.completed",
      {},
      ["completion_status"],
      {
        connectionKey: "google_chat.math",
        destinationTeam: "math",
      },
    )),
    /notification_transfer_destination_unsupported/,
  )
  assert.deepEqual(buildTransferNotificationPresentation(input(
    "transfer.submitted",
    { student_name: undefined },
    [],
  )), {})
})

test("전반 presentation은 폐기 전 seed의 신청자 inbox 토큰만 격리해 호환한다", async () => {
  const { buildTransferNotificationPresentation } = await import(presentationUrl)
  const context = buildTransferNotificationPresentation(input(
    "transfer.submitted",
    {},
    ["student_name", "teacher_name", "before_class", "after_class"],
    {
      audienceKey: "requester_profile",
      channelKey: "in_app",
      contractIdentity: {
        workflowKey: "transfer",
        eventKey: "transfer.submitted",
        audienceKey: "requester_profile",
        channelKey: "in_app",
        ruleVariantKey: "immediate",
      },
      connectionKey: null,
      destinationTeam: null,
    },
  ))

  assert.deepEqual(context, {
    student_name: "김도윤",
    teacher_name: "박지영",
    before_class: "중2 수학 A반",
    after_class: "중2 수학 B반",
  })
})
