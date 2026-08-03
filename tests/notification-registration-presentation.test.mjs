import assert from "node:assert/strict"
import test from "node:test"

const presentationUrl = new URL(
  "../src/features/notifications/server/presentation/registration-notification-presentation.ts",
  import.meta.url,
)

const EVENT_ID = "73000000-0000-4000-8000-000000000001"
const OCCURRED_AT = "2026-08-04T01:00:00.000Z"

const EVENT_KEYS = [
  "registration.case_created",
  "registration.registration_completed",
  "registration.case_closed",
  "registration.appointment_reminder_due",
  "registration.phone_consultation_ready",
  "registration.visit_scheduled",
  "registration.visit_rescheduled",
  "registration.visit_replaced",
  "registration.visit_subject_deselected",
  "registration.visit_canceled",
]

function input(eventKey, payload, requestedContextKeys, overrides = {}) {
  const schemaVersion = [
    "registration.case_created",
    "registration.registration_completed",
    "registration.case_closed",
  ].includes(eventKey) ? 1 : 2
  return {
    workflowKey: "registration",
    eventKey,
    ruleVariantKey: eventKey === "registration.appointment_reminder_due" ? "same_day_at" : "immediate",
    payloadSchemaVersion: schemaVersion,
    payload: {
      task_id: EVENT_ID,
      student_name: "김민서",
      grade: "중2",
      subjects: ["영어", "수학"],
      registered_subjects: ["영어", "수학"],
      registered_classes: ["중2 영어 A반", "중2 수학 B반"],
      inquiry_at: "2026-08-04T01:00:00.000Z",
      scheduled_at: "2026-08-07T08:00:00.000Z",
      place: "본관 상담실",
      before_scheduled_at: "2026-08-06T07:00:00.000Z",
      after_scheduled_at: "2026-08-07T08:00:00.000Z",
      before_place: "별관 상담실",
      after_place: "본관 상담실",
      deselected_subjects: ["수학"],
      remaining_subjects: ["영어"],
      progress_actor: "영어팀과 수학팀 담당 원장님",
      actor_name: "박지영",
      actor_team: "관리팀",
      appointment_kind: "visit_consultation",
      status: "registered",
      reason: null,
      memo: null,
      occurred_at: OCCURRED_AT,
      ...payload,
    },
    audienceKey: "management_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "registration",
      eventKey,
      audienceKey: "management_team",
      channelKey: "google_chat",
      ruleVariantKey: eventKey === "registration.appointment_reminder_due" ? "same_day_at" : "immediate",
    },
    requestedContextKeys,
    connectionKey: "google_chat.management",
    destinationTeam: "management",
    scheduledFor: OCCURRED_AT,
    ...overrides,
  }
}

function exactMessage(eventKey, context) {
  const titleByEvent = {
    "registration.case_created": `📥 [등록] ${context.student_name}의 등록 문의가 들어왔어요`,
    "registration.registration_completed": `✅ [등록] ${context.student_name}의 등록 처리가 완료됐어요`,
    "registration.case_closed": `⛔ [등록] ${context.student_name}의 등록 문의가 종료됐어요`,
    "registration.appointment_reminder_due": `⏰ [등록] ${context.student_name}의 상담 일정이 예정되어 있어요`,
    "registration.phone_consultation_ready": `☎️ [등록] ${context.student_name}의 전화상담을 기다리고 있어요`,
    "registration.visit_scheduled": `📅 [등록] ${context.student_name}의 방문상담이 예약됐어요`,
    "registration.visit_rescheduled": `🔄 [등록] ${context.student_name}의 방문상담 일정이 바뀌었어요`,
    "registration.visit_replaced": `🔄 [등록] ${context.student_name}의 방문상담 예약이 교체됐어요`,
    "registration.visit_subject_deselected": `➖ [등록] ${context.student_name}의 방문상담 과목이 제외됐어요`,
    "registration.visit_canceled": `⛔ [등록] ${context.student_name}의 방문상담이 취소됐어요`,
  }
  const lines = []
  if (eventKey === "registration.case_created") {
    lines.push(`[학생] ${context.student_name} · ${context.grade}`, `[과목] ${context.subjects}`, `[문의] ${context.inquiry_at}`)
  }
  if (eventKey === "registration.registration_completed") {
    lines.push(`[과목] ${context.registered_subjects}`, `[수업] ${context.registered_classes}`, `[상태] ${context.completion_status}`)
  }
  if (eventKey === "registration.case_closed") {
    lines.push(`[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[상태] ${context.close_status}`)
  }
  if (eventKey === "registration.appointment_reminder_due") {
    lines.push(`[상담] ${context.appointment_kind}`, `[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[일정] ${context.scheduled_at}`, `[장소] ${context.place}`)
  }
  if (eventKey === "registration.phone_consultation_ready") {
    lines.push(`[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[진행] ${context.progress_actor}의 전화상담 확인을 기다리고 있어요.`)
  }
  if (eventKey === "registration.visit_scheduled") {
    lines.push(`[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[일정] ${context.after_schedule}`, `[장소] ${context.after_place}`)
  }
  if (eventKey === "registration.visit_rescheduled") {
    lines.push(`[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[변경] ${context.before_schedule} → ${context.after_schedule}`, `[장소] ${context.after_place}`)
  }
  if (eventKey === "registration.visit_replaced") {
    lines.push(`[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[변경] ${context.before_appointment} → ${context.after_appointment}`, `[장소] ${context.after_place}`)
  }
  if (eventKey === "registration.visit_subject_deselected") {
    lines.push(`[학생] ${context.student_name}`, `[제외] ${context.deselected_subjects}`, `[남은 과목] ${context.other_active_subjects}`, `[일정] ${context.retained_schedule}`, `[장소] ${context.retained_place}`)
  }
  if (eventKey === "registration.visit_canceled") {
    lines.push(`[학생] ${context.student_name}`, `[과목] ${context.subjects}`, `[일정] ${context.canceled_schedule}`, `[장소] ${context.canceled_place}`)
  }
  for (const key of ["reason_line", "memo_line", "progress_line"]) {
    if (context[key]) lines.push(context[key])
  }
  return `${titleByEvent[eventKey]}\n\n${lines.join("\n")}`
}

function assertSafeMessage(message) {
  assert.doesNotMatch(message, /73000000-0000-4000-8000-000000000001/i)
  assert.doesNotMatch(message, /\b(?:visit_consultation|level_test|registered|inquiry_closed)\b/)
  assert.doesNotMatch(message, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  assert.doesNotMatch(message, /\/admin\//)
  assert.doesNotMatch(message, /https?:\/\//)
}

test("등록 10개 event는 링크 없이 학생·과목·일정·장소·상태를 정확히 읽을 수 있다", async () => {
  const { buildRegistrationNotificationPresentation } = await import(presentationUrl)
  const cases = [
    {
      eventKey: "registration.case_created",
      requested: ["student_name", "grade", "subjects", "inquiry_at", "progress_line"],
      expected: "📥 [등록] 김민서 학생의 등록 문의가 들어왔어요\n\n[학생] 김민서 학생 · 중2\n[과목] 영어 · 수학\n[문의] 8월 4일(화) 10:00\n[진행] 관리팀의 등록 내용 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.registration_completed",
      requested: ["student_name", "registered_subjects", "registered_classes", "completion_status"],
      expected: "✅ [등록] 김민서 학생의 등록 처리가 완료됐어요\n\n[과목] 영어 · 수학\n[수업] 중2 영어 A반 · 중2 수학 B반\n[상태] 등록 처리가 완료됐어요.",
    },
    {
      eventKey: "registration.case_closed",
      payload: { status: "inquiry_closed", reason: "타 학원 등록 확정" },
      requested: ["student_name", "subjects", "close_status", "reason_line"],
      expected: "⛔ [등록] 김민서 학생의 등록 문의가 종료됐어요\n\n[학생] 김민서 학생\n[과목] 영어 · 수학\n[상태] 등록 문의가 종료됐어요.\n[사유] 타 학원 등록 확정",
    },
    {
      eventKey: "registration.appointment_reminder_due",
      requested: ["appointment_kind", "student_name", "subjects", "scheduled_at", "place", "progress_line"],
      expected: "⏰ [등록] 김민서 학생의 상담 일정이 예정되어 있어요\n\n[상담] 방문상담\n[학생] 김민서 학생\n[과목] 영어 · 수학\n[일정] 8월 7일(금) 17:00\n[장소] 본관 상담실\n[진행] 영어팀과 수학팀 담당 원장님의 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.phone_consultation_ready",
      payload: { subjects: ["영어"], progress_actor: "김철수" },
      requested: ["student_name", "subjects", "progress_actor"],
      overrides: {
        audienceKey: "track_director",
        channelKey: "in_app",
        contractIdentity: {
          workflowKey: "registration",
          eventKey: "registration.phone_consultation_ready",
          audienceKey: "track_director",
          channelKey: "in_app",
          ruleVariantKey: "immediate",
        },
        connectionKey: null,
        destinationTeam: null,
      },
      expected: "☎️ [등록] 김민서 학생의 전화상담을 기다리고 있어요\n\n[학생] 김민서 학생\n[과목] 영어\n[진행] 김철수님의 전화상담 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.visit_scheduled",
      requested: ["student_name", "subjects", "after_schedule", "after_place", "progress_line"],
      expected: "📅 [등록] 김민서 학생의 방문상담이 예약됐어요\n\n[학생] 김민서 학생\n[과목] 영어 · 수학\n[일정] 8월 7일(금) 17:00\n[장소] 본관 상담실\n[진행] 영어팀과 수학팀 담당 원장님의 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.visit_rescheduled",
      requested: ["student_name", "subjects", "before_schedule", "after_schedule", "after_place", "progress_line"],
      expected: "🔄 [등록] 김민서 학생의 방문상담 일정이 바뀌었어요\n\n[학생] 김민서 학생\n[과목] 영어 · 수학\n[변경] 8월 6일(목) 16:00 → 8월 7일(금) 17:00\n[장소] 본관 상담실\n[진행] 영어팀과 수학팀 담당 원장님의 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.visit_replaced",
      requested: ["student_name", "subjects", "before_appointment", "after_appointment", "after_place", "progress_line"],
      expected: "🔄 [등록] 김민서 학생의 방문상담 예약이 교체됐어요\n\n[학생] 김민서 학생\n[과목] 영어 · 수학\n[변경] 8월 6일(목) 16:00 · 별관 상담실 → 8월 7일(금) 17:00 · 본관 상담실\n[장소] 본관 상담실\n[진행] 영어팀과 수학팀 담당 원장님의 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.visit_subject_deselected",
      requested: ["student_name", "deselected_subjects", "other_active_subjects", "retained_schedule", "retained_place", "progress_line"],
      expected: "➖ [등록] 김민서 학생의 방문상담 과목이 제외됐어요\n\n[학생] 김민서 학생\n[제외] 수학\n[남은 과목] 영어\n[일정] 8월 7일(금) 17:00\n[장소] 본관 상담실\n[진행] 영어팀과 수학팀 담당 원장님의 일정 확인을 기다리고 있어요.",
    },
    {
      eventKey: "registration.visit_canceled",
      payload: { reason: "보호자 요청\n010-1234-5678 https://example.com/private" },
      requested: ["student_name", "subjects", "canceled_schedule", "canceled_place", "reason_line"],
      expected: "⛔ [등록] 김민서 학생의 방문상담이 취소됐어요\n\n[학생] 김민서 학생\n[과목] 영어 · 수학\n[일정] 8월 7일(금) 17:00\n[장소] 본관 상담실\n[사유] 보호자 요청 [연락처 숨김] [링크 포함]",
    },
  ]

  assert.deepEqual(cases.map(({ eventKey }) => eventKey), EVENT_KEYS)
  for (const fixture of cases) {
    const context = buildRegistrationNotificationPresentation(input(
      fixture.eventKey,
      fixture.payload ?? {},
      fixture.requested,
      fixture.overrides,
    ))
    const message = exactMessage(fixture.eventKey, context)
    assert.equal(message, fixture.expected, fixture.eventKey)
    assertSafeMessage(message)
  }
})

test("방문상담 과목 제외는 남은 과목 없음과 snapshot 누락을 구분한다", async () => {
  const { buildRegistrationNotificationPresentation } = await import(presentationUrl)
  const empty = buildRegistrationNotificationPresentation(input(
    "registration.visit_subject_deselected",
    { deselected_subjects: ["영어", "수학"], remaining_subjects: [] },
    ["deselected_subjects", "other_active_subjects"],
  ))
  assert.deepEqual(empty, {
    deselected_subjects: "영어 · 수학",
    other_active_subjects: "남은 과목 없음",
  })

  assert.throws(
    () => buildRegistrationNotificationPresentation(input(
      "registration.visit_subject_deselected",
      { remaining_subjects: undefined },
      ["other_active_subjects"],
    )),
    /notification_presentation_required_field_missing/,
  )
})

test("전화상담 담당 미정은 UUID를 추측하지 않고 안전한 역할로 표시한다", async () => {
  const { buildRegistrationNotificationPresentation } = await import(presentationUrl)
  const context = buildRegistrationNotificationPresentation(input(
    "registration.phone_consultation_ready",
    { subjects: ["과학"], progress_actor: null },
    ["progress_actor"],
    {
      audienceKey: "track_director",
      channelKey: "in_app",
      contractIdentity: {
        workflowKey: "registration",
        eventKey: "registration.phone_consultation_ready",
        audienceKey: "track_director",
        channelKey: "in_app",
        ruleVariantKey: "immediate",
      },
      connectionKey: null,
      destinationTeam: null,
    },
  ))
  assert.deepEqual(context, { progress_actor: "담당자 지정 대기" })
})

test("unknown 과목과 목적지는 실패 폐쇄하고 기존 template의 빈 요청은 호환한다", async () => {
  const { buildRegistrationNotificationPresentation } = await import(presentationUrl)
  assert.throws(
    () => buildRegistrationNotificationPresentation(input(
      "registration.visit_scheduled",
      { subjects: ["사회"] },
      ["subjects"],
    )),
    /notification_registration_subject_unsupported/,
  )
  assert.throws(
    () => buildRegistrationNotificationPresentation(input(
      "registration.visit_scheduled",
      {},
      ["subjects"],
      { connectionKey: "google_chat.english", destinationTeam: "english" },
    )),
    /notification_registration_destination_unsupported/,
  )
  assert.deepEqual(buildRegistrationNotificationPresentation(input(
    "registration.case_created",
    { subjects: undefined },
    [],
  )), {})
})
