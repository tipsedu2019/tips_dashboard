import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/task-notification-presentation.ts",
  import.meta.url,
)
const adapterUrl = new URL(
  "../src/features/notifications/server/adapters/tasks-notification-adapter.ts",
  import.meta.url,
)

const UUID = "71000000-0000-4000-8000-000000000001"
const OCCURRED_AT = "2026-08-03T01:00:00.000Z"

const EVENT_KEYS = [
  "task.created",
  "task.assignee_changed",
  "task.due_changed",
  "task.status_changed",
  "task.completed",
  "task.canceled",
  "task.reopened",
  "task.comment_added",
]

function input(eventKey, payload, requestedContextKeys) {
  return {
    workflowKey: "tasks",
    eventKey,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 1,
    payload: {
      task_id: UUID,
      event_key: eventKey,
      task_title: "2학기 수학 교재 주문",
      task_status: "requested",
      current_assignee_name: "김철수",
      current_assignee_team: "관리팀",
      before_assignee_name: null,
      after_assignee_name: null,
      before_due_at: null,
      after_due_at: null,
      before_status: null,
      after_status: null,
      actor_name: "박지영",
      comment_author_name: null,
      comment_body: null,
      attachment_count: 0,
      attachment_types: [],
      occurred_at: OCCURRED_AT,
      ...payload,
    },
    audienceKey: "management_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "tasks",
      eventKey,
      audienceKey: "management_team",
      channelKey: "google_chat",
      ruleVariantKey: "immediate",
    },
    requestedContextKeys,
    connectionKey: "google_chat.management",
    destinationTeam: "management",
    scheduledFor: OCCURRED_AT,
  }
}

function exactMessage(eventKey, context) {
  const titleByEvent = {
    "task.created": `📥 [할 일] 새 할 일이 등록됐어요 · ${context.task_title}`,
    "task.assignee_changed": `🔄 [할 일] 담당자가 바뀌었어요 · ${context.task_title}`,
    "task.due_changed": `🔄 [할 일] 일정이 바뀌었어요 · ${context.task_title}`,
    "task.status_changed": `🔄 [할 일] 상태가 바뀌었어요 · ${context.task_title}`,
    "task.completed": `✅ [할 일] 할 일이 완료됐어요 · ${context.task_title}`,
    "task.canceled": `⛔ [할 일] 할 일이 취소됐어요 · ${context.task_title}`,
    "task.reopened": `🔄 [할 일] 할 일이 다시 열렸어요 · ${context.task_title}`,
    "task.comment_added": `💬 [할 일] 댓글이 등록됐어요 · ${context.task_title}`,
  }
  const lines = [`[업무] ${context.task_title}`]
  if (eventKey === "task.created") lines.push(`[상태] ${context.current_status} · 담당 ${context.current_assignee}`)
  if (eventKey === "task.assignee_changed") lines.push(`[변경] ${context.before_assignee} → ${context.after_assignee}`)
  if (eventKey === "task.due_changed") lines.push(`[변경] ${context.before_schedule} → ${context.after_schedule}`)
  if (eventKey === "task.status_changed" || eventKey === "task.reopened") {
    lines.push(`[변경] ${context.before_status} → ${context.after_status}`)
  }
  if (eventKey === "task.completed") lines.push(`[상태] ${context.completion_status}`)
  if (eventKey === "task.canceled") lines.push(`[상태] ${context.cancellation_status}`)
  if (eventKey === "task.comment_added") lines.push(`[댓글] ${context.comment_author} · ${context.comment_preview}`)
  for (const key of ["student_line", "class_line", "reason_line", "memo_line", "attachment_line", "progress_line"]) {
    if (context[key]) lines.push(context[key])
  }
  return `${titleByEvent[eventKey]}\n\n${lines.join("\n")}`
}

function assertSafeMessage(message) {
  assert.doesNotMatch(message, /71000000-0000-4000-8000-000000000001/i)
  assert.doesNotMatch(message, /\b(?:requested|confirmed|in_progress|review_requested|done|on_hold|canceled)\b/)
  assert.doesNotMatch(message, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  assert.doesNotMatch(message, /\/admin\//)
  assert.doesNotMatch(message, /https?:\/\//)
}

test("할 일 8개 event는 링크 없이도 대상·발생 사실·상태를 정확히 읽을 수 있다", async () => {
  const { buildTaskNotificationPresentation } = await import(presentationUrl)
  const cases = [
    {
      eventKey: "task.created",
      payload: {},
      requested: ["task_title", "current_status", "current_assignee", "progress_line"],
      expected: "📥 [할 일] 새 할 일이 등록됐어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[상태] 요청됐어요. · 담당 김철수님\n[진행] 김철수님의 확인을 기다리고 있어요.",
    },
    {
      eventKey: "task.assignee_changed",
      payload: { current_assignee_name: "김철수", before_assignee_name: null, after_assignee_name: "김철수" },
      requested: ["task_title", "before_assignee", "after_assignee", "progress_line"],
      expected: "🔄 [할 일] 담당자가 바뀌었어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[변경] 미배정 → 김철수님\n[진행] 김철수님의 확인을 기다리고 있어요.",
    },
    {
      eventKey: "task.due_changed",
      payload: { current_assignee_name: null, before_due_at: null, after_due_at: "2026-08-07T08:00:00.000Z" },
      requested: ["task_title", "before_schedule", "after_schedule", "progress_line"],
      expected: "🔄 [할 일] 일정이 바뀌었어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[변경] 일정 없음 → 8월 7일(금)\n[진행] 관리팀의 변경 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "task.status_changed",
      payload: { task_status: "in_progress", before_status: "requested", after_status: "in_progress" },
      requested: ["task_title", "before_status", "after_status", "progress_line"],
      expected: "🔄 [할 일] 상태가 바뀌었어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[변경] 요청 → 진행 중\n[진행] 김철수님이 업무를 진행하고 있어요.",
    },
    {
      eventKey: "task.completed",
      payload: { task_status: "done", before_status: "in_progress", after_status: "done" },
      requested: ["task_title", "completion_status"],
      expected: "✅ [할 일] 할 일이 완료됐어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[상태] 처리가 완료됐어요.",
    },
    {
      eventKey: "task.canceled",
      payload: { task_status: "canceled", before_status: "requested", after_status: "canceled", reason: "보호자 요청" },
      requested: ["task_title", "cancellation_status", "reason_line"],
      expected: "⛔ [할 일] 할 일이 취소됐어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[상태] 처리가 취소됐어요.\n[사유] 보호자 요청",
    },
    {
      eventKey: "task.reopened",
      payload: { task_status: "requested", current_assignee_name: null, before_status: "done", after_status: "requested" },
      requested: ["task_title", "before_status", "after_status", "progress_line"],
      expected: "🔄 [할 일] 할 일이 다시 열렸어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[변경] 완료 → 요청\n[진행] 관리팀의 확인을 기다리고 있어요.",
    },
    {
      eventKey: "task.comment_added",
      payload: {
        comment_author_name: "김철수",
        comment_body: "확인했습니다.\n[상태] 완료 처리해 주세요 https://example.com/private",
        attachment_count: 2,
        attachment_types: ["document", "image"],
        current_assignee_name: null,
      },
      requested: ["task_title", "comment_author", "comment_preview", "attachment_line", "progress_line"],
      expected: "💬 [할 일] 댓글이 등록됐어요 · 2학기 수학 교재 주문\n\n[업무] 2학기 수학 교재 주문\n[댓글] 김철수님 · 확인했습니다. [상태] 완료 처리해 주세요 [링크 포함]\n[첨부] 2개 · 문서, 이미지\n[진행] 관리팀의 확인을 기다리고 있어요.",
    },
  ]

  assert.deepEqual(cases.map(({ eventKey }) => eventKey), EVENT_KEYS)
  for (const fixture of cases) {
    const context = buildTaskNotificationPresentation(input(fixture.eventKey, fixture.payload, fixture.requested))
    const message = exactMessage(fixture.eventKey, context)
    assert.equal(message, fixture.expected, fixture.eventKey)
    assertSafeMessage(message)
  }
})

test("담당 해제도 김철수님에서 미배정으로 정확히 표시한다", async () => {
  const { buildTaskNotificationPresentation } = await import(presentationUrl)
  const context = buildTaskNotificationPresentation(input(
    "task.assignee_changed",
    { current_assignee_name: null, current_assignee_team: null, before_assignee_name: "김철수", after_assignee_name: null },
    ["task_title", "before_assignee", "after_assignee", "progress_line"],
  ))

  assert.equal(context.before_assignee, "김철수님")
  assert.equal(context.after_assignee, "미배정")
  assert.equal(context.progress_line, "[진행] 담당자 배정을 기다리고 있어요.")
})

test("필수 표시 snapshot 누락과 알 수 없는 raw 상태는 추측하지 않고 거절한다", async () => {
  const { buildTaskNotificationPresentation } = await import(presentationUrl)

  assert.throws(
    () => buildTaskNotificationPresentation(input("task.created", { task_title: undefined }, ["task_title"])),
    /notification_presentation_required_field_missing/,
  )
  assert.throws(
    () => buildTaskNotificationPresentation(input("task.status_changed", { before_status: "requested", after_status: "mystery" }, ["before_status", "after_status"])),
    /notification_task_status_unsupported/,
  )
  assert.throws(
    () => buildTaskNotificationPresentation(input("task.completed", { task_status: "requested" }, ["completion_status"])),
    /notification_task_event_state_mismatch/,
  )
})

test("기존 template이 새 변수를 요청하지 않으면 additive snapshot 없이도 렌더 호환된다", async () => {
  const { buildTaskNotificationPresentation } = await import(presentationUrl)
  const legacyPayload = {
    task_id: UUID,
    event_key: "task.created",
    task_title: "교재 확인",
    task_status: "requested",
    occurred_at: OCCURRED_AT,
  }

  assert.deepEqual(
    buildTaskNotificationPresentation(input("task.created", legacyPayload, [])),
    {},
  )
})

test("tasks adapter는 확정된 단체방 목적지에서 presentation context를 실제로 합친다", async () => {
  const { tasksNotificationAdapter } = await import(adapterUrl)
  const eventKey = "task.due_changed"
  const payload = input(eventKey, {
    current_assignee_name: null,
    before_due_at: null,
    after_due_at: "2026-08-07T08:00:00.000Z",
  }, []).payload
  const context = await tasksNotificationAdapter.buildRenderContext({
    eventId: UUID,
    workflowKey: "tasks",
    eventKey,
    sourceType: "ops_task_event",
    sourceId: UUID,
    sourceRevision: null,
    payloadSchemaVersion: 1,
    payload,
    rule: {
      ruleId: UUID,
      ruleRevision: "1",
      templateId: UUID,
      audienceKey: "management_team",
      channelKey: "google_chat",
      connectionKey: "google_chat.management",
      ruleVariantKey: "immediate",
    },
    scheduledFor: OCCURRED_AT,
    targetGeneration: "0",
    target: {
      targetKind: "connection",
      targetKey: "connection:google_chat.management",
      targetProfileId: null,
      connectionKey: "google_chat.management",
      targetSnapshot: { connection_key: "google_chat.management" },
    },
    requestedContextKeys: ["task_title", "before_schedule", "after_schedule", "progress_line"],
  })

  assert.equal(context.task_title, "2학기 수학 교재 주문")
  assert.equal(context.before_schedule, "일정 없음")
  assert.equal(context.after_schedule, "8월 7일(금)")
  assert.equal(context.progress_line, "[진행] 관리팀의 변경 일정 확인을 기다리고 있어요.")
})
