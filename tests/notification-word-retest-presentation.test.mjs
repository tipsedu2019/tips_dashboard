import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/word-retest-notification-presentation.ts",
  import.meta.url,
)
const adapterUrl = new URL(
  "../src/features/notifications/server/adapters/word-retests-notification-adapter.ts",
  import.meta.url,
)

const UUID = "72000000-0000-4000-8000-000000000001"
const PREVIOUS_UUID = "72000000-0000-4000-8000-000000000002"
const OCCURRED_AT = "2026-08-03T01:00:00.000Z"

const EVENT_KEYS = [
  "word_retest.created",
  "word_retest.assigned",
  "word_retest.schedule_changed",
  "word_retest.started",
  "word_retest.result_reported",
  "word_retest.absent_reported",
  "word_retest.revision_requested",
  "word_retest.retry_created",
  "word_retest.completed",
  "word_retest.canceled",
]

function input(eventKey, payload, requestedContextKeys) {
  return {
    workflowKey: "word_retests",
    eventKey,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 1,
    payload: {
      task_id: UUID,
      event_key: eventKey,
      task_status: "requested",
      student_name: "이서연",
      class_name: "중2 영어 A반",
      unit: "Lesson 12",
      assigned_assistant_name: "김철수",
      assigned_assistant_team: "조교팀",
      before_assistant_name: null,
      after_assistant_name: null,
      test_at: "2026-08-07T08:00:00.000Z",
      before_test_at: null,
      after_test_at: null,
      total_question_count: 50,
      cutoff_question_count: 45,
      first_score: 46,
      second_score: null,
      third_score: null,
      score_out_of_100: 92,
      result_summary: "passed",
      retest_status: "not_started",
      actor_name: "박지영",
      reason: null,
      memo: null,
      previous_task_id: null,
      retry_task_id: null,
      previous_result_summary: null,
      previous_total_question_count: null,
      previous_cutoff_question_count: null,
      previous_first_score: null,
      previous_second_score: null,
      previous_third_score: null,
      occurred_at: OCCURRED_AT,
      ...payload,
    },
    audienceKey: "management_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "word_retests",
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
    "word_retest.created": `📥 [단어 재시험] ${context.student_name}의 재시험이 등록됐어요`,
    "word_retest.assigned": `🔄 [단어 재시험] ${context.student_name}의 담당자가 바뀌었어요`,
    "word_retest.schedule_changed": `🔄 [단어 재시험] ${context.student_name}의 시험 일정이 바뀌었어요`,
    "word_retest.started": `▶️ [단어 재시험] ${context.student_name}의 재시험 처리가 시작됐어요`,
    "word_retest.result_reported": `📝 [단어 재시험] ${context.student_name}의 재시험 결과가 기록됐어요`,
    "word_retest.absent_reported": `⛔ [단어 재시험] ${context.student_name}이 미응시로 기록됐어요`,
    "word_retest.revision_requested": `↩️ [단어 재시험] ${context.student_name}의 결과 보완 요청이 등록됐어요`,
    "word_retest.retry_created": `📥 [단어 재시험] ${context.student_name}의 후속 재시험이 등록됐어요`,
    "word_retest.completed": `✅ [단어 재시험] ${context.student_name}의 재시험 업무가 완료됐어요`,
    "word_retest.canceled": `⛔ [단어 재시험] ${context.student_name}의 재시험이 취소됐어요`,
  }
  const lines = [`[학생] ${context.student_name}`]
  if (eventKey === "word_retest.created") {
    lines.push(`[수업] ${context.class_name}`, `[시험] ${context.test_scope}`, `[일정] ${context.test_date}`)
  }
  if (eventKey === "word_retest.assigned") lines.push(`[변경] ${context.before_assignee} → ${context.after_assignee}`)
  if (eventKey === "word_retest.schedule_changed") lines.push(`[변경] ${context.before_test_date} → ${context.after_test_date}`)
  if (eventKey === "word_retest.started") {
    lines.push(`[수업] ${context.class_name}`, `[시험] ${context.test_scope}`, `[상태] ${context.start_status}`)
  }
  if (eventKey === "word_retest.result_reported") {
    lines.push(`[결과] ${context.score} / 통과 기준 ${context.pass_threshold} · ${context.result}`)
  }
  if (eventKey === "word_retest.absent_reported") {
    lines.push(`[일정] ${context.test_date}`, `[결과] ${context.result}`)
  }
  if (eventKey === "word_retest.revision_requested") {
    lines.push(`[결과] ${context.current_result}`, `[상태] ${context.request_actor}의 결과 보완 요청이 등록됐어요.`)
  }
  if (eventKey === "word_retest.retry_created") {
    lines.push(`[결과] 이전 재시험 ${context.previous_result}`, `[일정] 후속 재시험 ${context.followup_schedule}`)
  }
  if (eventKey === "word_retest.completed") lines.push(`[결과] ${context.final_result}`)
  if (eventKey === "word_retest.canceled") lines.push(`[상태] ${context.cancellation_status}`)
  for (const key of ["reason_line", "memo_line", "progress_line"]) {
    if (context[key]) lines.push(context[key])
  }
  return `${titleByEvent[eventKey]}\n\n${lines.join("\n")}`
}

function assertSafeMessage(message) {
  assert.doesNotMatch(message, /72000000-0000-4000-8000-00000000000[12]/i)
  assert.doesNotMatch(message, /\b(?:not_started|in_progress|review_requested|done|absent|passed|failed|canceled)\b/)
  assert.doesNotMatch(message, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  assert.doesNotMatch(message, /\/admin\//)
  assert.doesNotMatch(message, /https?:\/\//)
}

test("단어 재시험 10개 event는 링크 없이 학생·시험·일정·판정을 정확히 읽을 수 있다", async () => {
  const { buildWordRetestNotificationPresentation } = await import(presentationUrl)
  const cases = [
    {
      eventKey: "word_retest.created",
      payload: {},
      requested: ["student_name", "class_name", "test_scope", "test_date", "progress_line"],
      expected: "📥 [단어 재시험] 이서연 학생의 재시험이 등록됐어요\n\n[학생] 이서연 학생\n[수업] 중2 영어 A반\n[시험] Lesson 12 · 50문항\n[일정] 8월 7일(금) 17:00\n[진행] 김철수님의 확인을 기다리고 있어요.",
    },
    {
      eventKey: "word_retest.assigned",
      payload: { before_assistant_name: null, after_assistant_name: "김철수" },
      requested: ["student_name", "before_assignee", "after_assignee", "progress_line"],
      expected: "🔄 [단어 재시험] 이서연 학생의 담당자가 바뀌었어요\n\n[학생] 이서연 학생\n[변경] 미배정 → 김철수님\n[진행] 김철수님의 확인을 기다리고 있어요.",
    },
    {
      eventKey: "word_retest.schedule_changed",
      payload: { before_test_at: null, after_test_at: "2026-08-07T08:00:00.000Z" },
      requested: ["student_name", "before_test_date", "after_test_date", "progress_line"],
      expected: "🔄 [단어 재시험] 이서연 학생의 시험 일정이 바뀌었어요\n\n[학생] 이서연 학생\n[변경] 일정 없음 → 8월 7일(금) 17:00\n[진행] 김철수님의 변경 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "word_retest.started",
      payload: { task_status: "in_progress", retest_status: "in_progress" },
      requested: ["student_name", "class_name", "test_scope", "start_status", "progress_line"],
      expected: "▶️ [단어 재시험] 이서연 학생의 재시험 처리가 시작됐어요\n\n[학생] 이서연 학생\n[수업] 중2 영어 A반\n[시험] Lesson 12 · 50문항\n[상태] 재시험 처리가 시작됐어요.\n[진행] 김철수님이 재시험 처리를 진행하고 있어요.",
    },
    {
      eventKey: "word_retest.result_reported",
      payload: { task_status: "review_requested", retest_status: "done", memo: "오답 4개를 다시 확인해 주세요." },
      requested: ["student_name", "score", "pass_threshold", "result", "memo_line"],
      expected: "📝 [단어 재시험] 이서연 학생의 재시험 결과가 기록됐어요\n\n[학생] 이서연 학생\n[결과] 46점 / 통과 기준 45점 · 통과\n[메모] 오답 4개를 다시 확인해 주세요.",
    },
    {
      eventKey: "word_retest.absent_reported",
      payload: {
        task_status: "review_requested",
        retest_status: "absent",
        first_score: null,
        score_out_of_100: null,
        result_summary: "absent",
        reason: "보호자 확인\n010-1234-5678 https://example.com/private",
        memo: "다음 일정 조율 필요",
      },
      requested: ["student_name", "test_date", "result", "reason_line", "memo_line"],
      expected: "⛔ [단어 재시험] 이서연 학생이 미응시로 기록됐어요\n\n[학생] 이서연 학생\n[일정] 8월 7일(금) 17:00\n[결과] 미응시\n[사유] 보호자 확인 [연락처 숨김] [링크 포함]\n[메모] 다음 일정 조율 필요",
    },
    {
      eventKey: "word_retest.revision_requested",
      payload: { task_status: "in_progress", retest_status: "in_progress", first_score: 40, score_out_of_100: 80, result_summary: "failed", reason: "채점표 재확인" },
      requested: ["student_name", "current_result", "request_actor", "reason_line", "progress_line"],
      expected: "↩️ [단어 재시험] 이서연 학생의 결과 보완 요청이 등록됐어요\n\n[학생] 이서연 학생\n[결과] 40점 / 통과 기준 45점 · 불통과\n[상태] 박지영님의 결과 보완 요청이 등록됐어요.\n[사유] 채점표 재확인\n[진행] 김철수님의 결과 보완을 기다리고 있어요.",
    },
    {
      eventKey: "word_retest.retry_created",
      payload: {
        previous_task_id: PREVIOUS_UUID,
        retry_task_id: UUID,
        previous_result_summary: "failed",
        previous_total_question_count: 50,
        previous_cutoff_question_count: 45,
        previous_first_score: 40,
      },
      requested: ["student_name", "previous_result", "followup_schedule", "progress_line"],
      expected: "📥 [단어 재시험] 이서연 학생의 후속 재시험이 등록됐어요\n\n[학생] 이서연 학생\n[결과] 이전 재시험 40점 / 통과 기준 45점 · 불통과\n[일정] 후속 재시험 8월 7일(금) 17:00\n[진행] 김철수님의 확인을 기다리고 있어요.",
    },
    {
      eventKey: "word_retest.completed",
      payload: { task_status: "done", retest_status: "done", memo: "최종 확인 완료" },
      requested: ["student_name", "final_result", "memo_line"],
      expected: "✅ [단어 재시험] 이서연 학생의 재시험 업무가 완료됐어요\n\n[학생] 이서연 학생\n[결과] 46점 / 통과 기준 45점 · 통과\n[메모] 최종 확인 완료",
    },
    {
      eventKey: "word_retest.canceled",
      payload: { task_status: "canceled", reason: "중복 요청" },
      requested: ["student_name", "cancellation_status", "reason_line"],
      expected: "⛔ [단어 재시험] 이서연 학생의 재시험이 취소됐어요\n\n[학생] 이서연 학생\n[상태] 재시험이 취소됐어요.\n[사유] 중복 요청",
    },
  ]

  assert.deepEqual(cases.map(({ eventKey }) => eventKey), EVENT_KEYS)
  for (const fixture of cases) {
    const context = buildWordRetestNotificationPresentation(input(fixture.eventKey, fixture.payload, fixture.requested))
    const message = exactMessage(fixture.eventKey, context)
    assert.equal(message, fixture.expected, fixture.eventKey)
    assertSafeMessage(message)
  }
})

test("불통과 판정과 담당 해제도 구조화 값으로 정확히 표시한다", async () => {
  const { buildWordRetestNotificationPresentation } = await import(presentationUrl)
  const failed = buildWordRetestNotificationPresentation(input(
    "word_retest.result_reported",
    { first_score: 40, score_out_of_100: 80, result_summary: "failed" },
    ["score", "pass_threshold", "result"],
  ))
  assert.deepEqual(failed, { score: "40점", pass_threshold: "45점", result: "불통과" })

  const unassigned = buildWordRetestNotificationPresentation(input(
    "word_retest.assigned",
    {
      assigned_assistant_name: null,
      assigned_assistant_team: null,
      before_assistant_name: "김철수",
      after_assistant_name: null,
    },
    ["before_assignee", "after_assignee", "progress_line"],
  ))
  assert.equal(unassigned.before_assignee, "김철수님")
  assert.equal(unassigned.after_assignee, "미배정")
  assert.equal(unassigned.progress_line, "[진행] 담당 조교 배정을 기다리고 있어요.")
})

test("표시 판정은 raw 문자열이나 점수 문구를 추측하지 않고 구조화 snapshot 불일치를 거절한다", async () => {
  const { buildWordRetestNotificationPresentation } = await import(presentationUrl)

  assert.throws(
    () => buildWordRetestNotificationPresentation(input("word_retest.result_reported", { result_summary: "mystery" }, ["result"])),
    /notification_word_retest_result_unsupported/,
  )
  assert.throws(
    () => buildWordRetestNotificationPresentation(input("word_retest.result_reported", { first_score: 46, cutoff_question_count: 45, result_summary: "failed" }, ["score", "pass_threshold", "result"])),
    /notification_word_retest_result_snapshot_inconsistent/,
  )
  assert.throws(
    () => buildWordRetestNotificationPresentation(input("word_retest.created", { student_name: undefined }, ["student_name"])),
    /notification_presentation_required_field_missing/,
  )
})

test("기존 template은 새 display snapshot이 없어도 그대로 렌더할 수 있다", async () => {
  const { buildWordRetestNotificationPresentation } = await import(presentationUrl)
  assert.deepEqual(buildWordRetestNotificationPresentation(input(
    "word_retest.created",
    { assigned_assistant_name: undefined, assigned_assistant_team: undefined },
    [],
  )), {})
})

test("word-retests adapter는 확정된 단체방 목적지에서 새 presentation context를 합친다", async () => {
  const { wordRetestsNotificationAdapter } = await import(adapterUrl)
  const eventKey = "word_retest.schedule_changed"
  const payload = input(eventKey, {
    before_test_at: null,
    after_test_at: "2026-08-07T08:00:00.000Z",
  }, []).payload
  const context = await wordRetestsNotificationAdapter.buildRenderContext({
    eventId: UUID,
    workflowKey: "word_retests",
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
    requestedContextKeys: ["student_name", "before_test_date", "after_test_date", "progress_line"],
  })

  assert.equal(context.student_name, "이서연 학생")
  assert.equal(context.before_test_date, "일정 없음")
  assert.equal(context.after_test_date, "8월 7일(금) 17:00")
  assert.equal(context.progress_line, "[진행] 김철수님의 변경 일정 확인을 기다리고 있어요.")
})
