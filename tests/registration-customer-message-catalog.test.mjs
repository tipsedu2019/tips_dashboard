import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION,
  REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS,
  REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS,
  checksumRegistrationCustomerMessageTemplate,
  createRegistrationCustomerMessageCatalog,
  formatRegistrationCustomerMessageAdmissionPlans,
  formatRegistrationCustomerMessageSchedule,
  formatRegistrationCustomerMessageSubjects,
  renderRegistrationCustomerMessage,
  resolveRegistrationCustomerMessageWaitingLabels,
} from "../src/features/tasks/server/registration-customer-message-catalog.ts"
import { createRegistrationSubjectTrackFixtureCustomerMessageClient } from "../src/features/tasks/registration-track-fixtures.ts"

const LEVEL_TEST_BODY = `[팁스영어수학학원] 레벨테스트 예약 안내

안녕하세요. #{학생명} 학생의 레벨테스트 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`

const VISIT_BODY = `[팁스영어수학학원] 방문상담 예약 안내

안녕하세요. #{학생명} 학생의 방문상담 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`

const REMINDER_BODY = `[팁스영어수학학원] 예약 리마인드

안녕하세요. #{학생명} 학생의 #{예약종류} 일정을 다시 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`

const WAITING_BODY = `[팁스영어수학학원] 대기 신청 접수 안내

안녕하세요. #{학생명} 학생의 #{과목} #{대기종류} 요청이 접수되었습니다.

대기 내용: #{대기내용}

변동 사항이 확인되는 대로 다시 안내드리겠습니다.

변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`

const ADMISSION_BODY = `[팁스영어수학학원] 입학신청서 작성 안내

안녕하세요. #{학생명} 학생의 입학 절차를 안내드립니다.

[등록 수업 정보]
#{등록수업안내}

자세한 수업 일정은 학원 홈페이지에서 확인해 주세요.

최종 원생 등록 및 교육비 납부 안내를 위해 입학신청서를 제출해 주세요.

입학신청서에는 원내 수강 규정, 원생의 건강·정서 상태 고지 의무, CCTV 활용 등 학원 생활에 필요한 중요 약관이 포함되어 있습니다. 내용을 확인하신 후 서명을 완료해 주세요.

아래 버튼에서 입학신청서를 작성할 수 있습니다.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`

const CONTACT_BUTTON = Object.freeze({
  name: "문의하기",
  type: "WL",
  linkMobile: "https://tipsedu.channel.io",
  linkPc: "https://tipsedu.channel.io",
})

const ADMISSION_FORM_BUTTON = Object.freeze({
  name: "입학신청서 작성",
  type: "WL",
  linkMobile: "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
  linkPc: "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
})

const ENGLISH_PLAN = Object.freeze({
  enrollmentId: "00000000-0000-4000-8000-000000000101",
  subject: "영어",
  sortOrder: 0,
  className: "중2 영어 A반",
  textbookName: "능률 VOCA",
  slots: Object.freeze([
    Object.freeze({
      weekday: 1,
      startTime: "18:00",
      endTime: "20:00",
      teacherName: "홍길동",
      classroomName: "본관 301호",
    }),
    Object.freeze({
      weekday: 3,
      startTime: "18:00",
      endTime: "20:00",
      teacherName: "홍길동",
      classroomName: "본관 301호",
    }),
  ]),
  firstLesson: Object.freeze({
    sessionDate: "2026-08-17",
    startTime: "18:00",
    endTime: "20:00",
  }),
})

const ENGLISH_PLAN_VARIABLE = `과목/수업: [영어] 중2 영어 A반
교재: 능률 VOCA
요일/시간: 월·수 오후 6:00–8:00
선생님: 홍길동
강의실: 본관 301호

첫 수업일: 8월 17일 월요일 오후 6:00–8:00`

const MATH_PLAN = Object.freeze({
  enrollmentId: "00000000-0000-4000-8000-000000000102",
  subject: "수학",
  sortOrder: 1,
  className: "중2 수학 B반",
  textbookName: null,
  slots: Object.freeze([
    Object.freeze({
      weekday: 2,
      startTime: "16:00",
      endTime: "18:00",
      teacherName: "김길동",
      classroomName: "별관 201호",
    }),
    Object.freeze({
      weekday: 4,
      startTime: "16:00",
      endTime: "18:00",
      teacherName: "이길동",
      classroomName: "별관 202호",
    }),
  ]),
  firstLesson: Object.freeze({
    sessionDate: "2026-08-18",
    startTime: "16:00",
    endTime: "18:00",
  }),
})

const TEMPLATE_IDS = {
  level_test_booking: "template-level",
  visit_consultation_booking: "template-visit",
  appointment_reminder: "template-reminder",
  waiting_notice: "template-waiting",
  admission_application: "template-admission",
  observation_booking: "template-observation-booking",
  observation_reminder: "template-observation-reminder",
}

const FULL_ENV = {
  SOLAPI_API_KEY: "api-key-secret-value",
  SOLAPI_API_SECRET: "api-secret-value",
  SOLAPI_KAKAO_PF_ID: "pf-tipsedu",
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: TEMPLATE_IDS.level_test_booking,
  SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: TEMPLATE_IDS.visit_consultation_booking,
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: TEMPLATE_IDS.appointment_reminder,
  SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: TEMPLATE_IDS.waiting_notice,
  SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: TEMPLATE_IDS.admission_application,
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: TEMPLATE_IDS.observation_booking,
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: TEMPLATE_IDS.observation_reminder,
  REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "recipient-pepper-secret-value",
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

test("catalog maps exactly seven kinds to the approved server-only environment keys", () => {
  assert.equal(REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION, 6)
  assert.deepEqual(REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS, {
    level_test_booking: "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID",
    visit_consultation_booking: "SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID",
    appointment_reminder: "SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID",
    waiting_notice: "SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID",
    admission_application: "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID",
    observation_booking: "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID",
    observation_reminder: "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID",
  })
  assert.deepEqual(REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS, {
    level_test_booking: 3,
    visit_consultation_booking: 3,
    appointment_reminder: 3,
    waiting_notice: 2,
    admission_application: 3,
    observation_booking: 2,
    observation_reminder: 2,
  })
  assert.equal(Object.isFrozen(REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS), true)
  assert.throws(() => {
    REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS.level_test_booking = 2
  }, TypeError)

  const catalog = createRegistrationCustomerMessageCatalog(FULL_ENV)
  assert.deepEqual(Object.keys(catalog.templates), [
    "level_test_booking",
    "visit_consultation_booking",
    "appointment_reminder",
    "waiting_notice",
    "admission_application",
    "observation_booking",
    "observation_reminder",
  ])
  assert.equal(catalog.credentialsConfigured, true)
  assert.equal(catalog.pfId, "pf-tipsedu")
  assert.equal(catalog.pfConfigured, true)
  assert.equal(catalog.recipientHashPepperConfigured, true)

  for (const [kind, entry] of Object.entries(catalog.templates)) {
    assert.equal(entry.kind, kind)
    assert.equal(entry.revision, REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS[kind])
    assert.equal(entry.envKey, REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS[kind])
    assert.equal(entry.templateId, TEMPLATE_IDS[kind])
    assert.equal(entry.templateConfigured, true)
    assert.deepEqual(entry.buttons.at(-1), CONTACT_BUTTON)
  }

  const serialized = JSON.stringify(catalog)
  assert.doesNotMatch(serialized, /api-key-secret-value|api-secret-value|recipient-pepper-secret-value/)
})

test("catalog never falls back to process.env at import or factory time", () => {
  const modulePath = fileURLToPath(new URL(
    "../src/features/tasks/server/registration-customer-message-catalog.ts",
    import.meta.url,
  ))
  const script = `
    const module = await import(${JSON.stringify(new URL(`file://${modulePath}`).href)});
    const catalog = module.createRegistrationCustomerMessageCatalog({});
    process.stdout.write(JSON.stringify({
      credentialsConfigured: catalog.credentialsConfigured,
      pfId: catalog.pfId,
      recipientHashPepperConfigured: catalog.recipientHashPepperConfigured,
      templateIds: Object.values(catalog.templates).map((entry) => entry.templateId),
    }));
  `
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    script,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      SOLAPI_API_KEY: "must-not-be-read",
      SOLAPI_API_SECRET: "must-not-be-read",
      SOLAPI_KAKAO_PF_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "must-not-be-read",
      SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "must-not-be-read",
      REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "must-not-be-read",
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    credentialsConfigured: false,
    pfId: null,
    recipientHashPepperConfigured: false,
    templateIds: [null, null, null, null, null, null, null],
  })
})

test("catalog pins exact approved copy and place-aware Naver buttons", () => {
  const catalog = createRegistrationCustomerMessageCatalog(FULL_ENV)
  const placeButton = [{
    name: "학원 위치 보기",
    type: "WL",
    linkMobile: "https://map.naver.com/p/entry/place/#{장소ID}",
    linkPc: "https://map.naver.com/p/entry/place/#{장소ID}",
  }]
  const expected = {
    level_test_booking: {
      content: LEVEL_TEST_BODY,
      variables: ["학생명", "예약일시", "장소", "과목", "장소ID"],
      buttons: [...placeButton, CONTACT_BUTTON],
    },
    visit_consultation_booking: {
      content: VISIT_BODY,
      variables: ["학생명", "예약일시", "장소", "과목", "장소ID"],
      buttons: [...placeButton, CONTACT_BUTTON],
    },
    appointment_reminder: {
      content: REMINDER_BODY,
      variables: ["학생명", "예약종류", "예약일시", "장소", "과목", "장소ID"],
      buttons: [...placeButton, CONTACT_BUTTON],
    },
    waiting_notice: {
      content: WAITING_BODY,
      variables: ["학생명", "과목", "대기종류", "대기내용"],
      buttons: [CONTACT_BUTTON],
    },
    admission_application: {
      content: ADMISSION_BODY,
      variables: ["학생명", "등록수업안내"],
      buttons: [ADMISSION_FORM_BUTTON, CONTACT_BUTTON],
    },
  }

  for (const [kind, pinned] of Object.entries(expected)) {
    const entry = catalog.templates[kind]
    assert.equal(entry.content, pinned.content)
    assert.deepEqual(entry.variables, pinned.variables)
    assert.deepEqual(entry.buttons, pinned.buttons)
    assert.deepEqual(entry.send, { type: "ATA", disableSms: true })
    assert.equal(Object.isFrozen(entry.send), true)
    assert.throws(() => {
      entry.send.disableSms = false
    }, TypeError)
  }
})

test("fixture observation kinds stay unsupported until their dedicated UI fixture task", async () => {
  const client = createRegistrationSubjectTrackFixtureCustomerMessageClient()
  for (const messageKind of ["observation_booking", "observation_reminder"]) {
    await assert.rejects(
      client.preview({ messageKind, sourceId: "97000000-0000-4000-8000-000000000001" }),
      /registration_customer_message_source_not_found/,
    )
  }
})

test("KST formatter and subject ordering are exact and deterministic", () => {
  assert.equal(
    formatRegistrationCustomerMessageSchedule("2026-08-08T05:00:00.000Z"),
    "2026년 8월 8일 토요일 오후 2:00",
  )
  assert.equal(
    formatRegistrationCustomerMessageSchedule("2026-08-07T15:05:00.000Z"),
    "2026년 8월 8일 토요일 오전 12:05",
  )
  assert.equal(
    formatRegistrationCustomerMessageSchedule("2026-08-08T14:00:00.123456+09:00"),
    "2026년 8월 8일 토요일 오후 2:00",
  )
  assert.equal(
    formatRegistrationCustomerMessageSubjects(["과학", "영어", "수학", "영어"]),
    "영어 · 수학 · 과학",
  )
  assert.throws(
    () => formatRegistrationCustomerMessageSubjects(["영어", "국어"]),
    /registration_customer_message_subject_invalid/,
  )
  assert.throws(
    () => formatRegistrationCustomerMessageSchedule("not-a-date"),
    /registration_customer_message_schedule_invalid/,
  )
  assert.throws(
    () => formatRegistrationCustomerMessageSchedule("2026-08-08T14:00:00"),
    /registration_customer_message_schedule_invalid/,
  )
  assert.throws(
    () => formatRegistrationCustomerMessageSchedule("2026-02-29T05:00:00.000Z"),
    /registration_customer_message_schedule_invalid/,
  )
})

test("waiting labels are strict and current-class waiting requires a saved class name", () => {
  assert.deepEqual(resolveRegistrationCustomerMessageWaitingLabels("current_class", " 영어 A "), {
    waitingKindLabel: "현재반 대기",
    waitingDetailLabel: "영어 A",
  })
  assert.deepEqual(resolveRegistrationCustomerMessageWaitingLabels("current_term_opening"), {
    waitingKindLabel: "신규반 대기",
    waitingDetailLabel: "신규반 개설 대기",
  })
  assert.deepEqual(resolveRegistrationCustomerMessageWaitingLabels("next_term_opening"), {
    waitingKindLabel: "다음 개강 알림",
    waitingDetailLabel: "다음 개강 일정 알림 요청",
  })
  assert.throws(
    () => resolveRegistrationCustomerMessageWaitingLabels("current_class", " "),
    /registration_customer_message_waiting_class_required/,
  )
  assert.throws(
    () => resolveRegistrationCustomerMessageWaitingLabels("unknown"),
    /registration_customer_message_waiting_kind_invalid/,
  )
})

test("renderer uses only each template allowlist and produces the exact approved copy", () => {
  const appointmentFacts = {
    studentName: "김팁스 학생",
    subjects: ["과학", "영어", "수학"],
    scheduledAt: "2026-08-08T05:00:00.000Z",
    place: "본관",
    appointmentKind: "level_test",
  }
  const level = renderRegistrationCustomerMessage({
    kind: "level_test_booking",
    facts: appointmentFacts,
  })
  assert.deepEqual(level.variables, {
    "#{학생명}": "김팁스",
    "#{예약일시}": "2026년 8월 8일 토요일 오후 2:00",
    "#{장소}": "본관",
    "#{과목}": "영어 · 수학 · 과학",
    "#{장소ID}": "1218797840",
  })
  assert.deepEqual(level.buttons, [{
    name: "학원 위치 보기",
    type: "WL",
    linkMobile: "https://map.naver.com/p/entry/place/#{장소ID}",
    linkPc: "https://map.naver.com/p/entry/place/#{장소ID}",
  }, CONTACT_BUTTON])
  assert.equal(level.body, LEVEL_TEST_BODY
    .replace("#{학생명}", "김팁스")
    .replace("#{예약일시}", "2026년 8월 8일 토요일 오후 2:00")
    .replace("#{장소}", "본관")
    .replace("#{과목}", "영어 · 수학 · 과학"))
  assert.deepEqual(level.facts, {
    subjectLabel: "영어 · 수학 · 과학",
    scheduleLabel: "2026년 8월 8일 토요일 오후 2:00",
    placeLabel: "본관",
  })

  const visit = renderRegistrationCustomerMessage({
    kind: "visit_consultation_booking",
    facts: { ...appointmentFacts, place: "별관", appointmentKind: "visit_consultation" },
  })
  assert.match(visit.body, /방문상담 예약을 안내드립니다/)
  assert.deepEqual(Object.keys(visit.variables), ["#{학생명}", "#{예약일시}", "#{장소}", "#{과목}", "#{장소ID}"])
  assert.equal(visit.variables["#{장소ID}"], "1962638110")

  const reminder = renderRegistrationCustomerMessage({
    kind: "appointment_reminder",
    facts: appointmentFacts,
  })
  assert.equal(reminder.variables["#{예약종류}"], "레벨테스트")
  assert.match(reminder.body, /김팁스 학생의 레벨테스트 일정을 다시 안내드립니다/)

  assert.throws(() => renderRegistrationCustomerMessage({
    kind: "appointment_reminder",
    facts: { ...appointmentFacts, place: "임의 장소" },
  }), /registration_customer_message_place_invalid/)

  const waiting = renderRegistrationCustomerMessage({
    kind: "waiting_notice",
    facts: {
      studentName: "김팁스",
      subjects: ["수학"],
      waitingKind: "current_term_opening",
      internalOnlyValue: "must-not-render",
    },
  })
  assert.deepEqual(waiting.variables, {
    "#{학생명}": "김팁스",
    "#{과목}": "수학",
    "#{대기종류}": "신규반 대기",
    "#{대기내용}": "신규반 개설 대기",
  })
  assert.doesNotMatch(JSON.stringify(waiting), /must-not-render/)

  const admission = renderRegistrationCustomerMessage({
    kind: "admission_application",
    facts: {
      studentName: "김팁스",
      subjects: ["영어"],
      enrollmentPlans: [ENGLISH_PLAN],
    },
  })
  assert.deepEqual(admission.variables, {
    "#{학생명}": "김팁스",
    "#{등록수업안내}": ENGLISH_PLAN_VARIABLE,
  })
  assert.equal(
    admission.body,
    ADMISSION_BODY
      .replace("#{학생명}", "김팁스")
      .replace("#{등록수업안내}", ENGLISH_PLAN_VARIABLE),
  )
  assert.deepEqual(admission.buttons, [ADMISSION_FORM_BUTTON, CONTACT_BUTTON])
  assert.deepEqual(admission.facts.admissionPlans, [{
    subjectLabel: "영어",
    className: "중2 영어 A반",
    textbookLabel: "능률 VOCA",
    scheduleLabel: "월·수 오후 6:00–8:00",
    teacherLabel: "홍길동",
    classroomLabel: "본관 301호",
    firstLessonLabel: "8월 17일 월요일 오후 6:00–8:00",
  }])
})

test("admission plans sort deterministically and preserve weekday-specific assignments", () => {
  const formatted = formatRegistrationCustomerMessageAdmissionPlans([MATH_PLAN, ENGLISH_PLAN])

  assert.equal(formatted.variable, `과목/수업: [영어] 중2 영어 A반
교재: 능률 VOCA
요일/시간: 월·수 오후 6:00–8:00
선생님: 홍길동
강의실: 본관 301호

첫 수업일: 8월 17일 월요일 오후 6:00–8:00

과목/수업: [수학] 중2 수학 B반
교재: 선택 안 함(이미 보유)
요일/시간: 화·목 오후 4:00–6:00
선생님: 화 김길동 · 목 이길동
강의실: 화 별관 201호 · 목 별관 202호

첫 수업일: 8월 18일 화요일 오후 4:00–6:00`)
  assert.deepEqual(formatted.plans.map((plan) => plan.subjectLabel), ["영어", "수학"])
})

test("renderer blocks completed AlimTalk bodies over 1,000 Unicode code points", () => {
  assert.throws(
    () => renderRegistrationCustomerMessage({
      kind: "admission_application",
      facts: {
        studentName: "김팁스",
        subjects: ["영어"],
        enrollmentPlans: [{ ...ENGLISH_PLAN, className: "가".repeat(1001) }],
      },
    }),
    { message: "registration_customer_message_body_too_long" },
  )
})

test("renderer replaces template tokens once without reinterpreting variable values", () => {
  const rendered = renderRegistrationCustomerMessage({
    kind: "level_test_booking",
    facts: {
      studentName: "김#{장소}",
      subjects: ["영어"],
      scheduledAt: "2026-08-08T05:00:00.000Z",
      place: "본관",
      appointmentKind: "level_test",
    },
  })

  assert.equal(rendered.variables["#{학생명}"], "김#{장소}")
  assert.match(rendered.body, /김#\{장소\} 학생의 레벨테스트 예약을 안내드립니다/u)
  assert.match(rendered.body, /장소: 본관/u)
})

test("template and rendered checksums use canonical UTF-8 SHA-256", () => {
  const catalog = createRegistrationCustomerMessageCatalog(FULL_ENV)
  const template = catalog.templates.admission_application
  const canonical = `{"buttons":[{"linkMobile":"https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8","linkPc":"https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8","name":"입학신청서 작성","type":"WL"},{"linkMobile":"https://tipsedu.channel.io","linkPc":"https://tipsedu.channel.io","name":"문의하기","type":"WL"}],"content":${JSON.stringify(ADMISSION_BODY)},"variables":["학생명","등록수업안내"]}`

  assert.equal(checksumRegistrationCustomerMessageTemplate(template), sha256(canonical))
  assert.equal(template.checksums.template, sha256(canonical))
  assert.equal(template.checksums.content, sha256(ADMISSION_BODY))
  assert.equal(template.checksums.variables, sha256('["학생명","등록수업안내"]'))
  assert.equal(
    template.checksums.buttons,
    sha256('[{"linkMobile":"https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8","linkPc":"https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8","name":"입학신청서 작성","type":"WL"},{"linkMobile":"https://tipsedu.channel.io","linkPc":"https://tipsedu.channel.io","name":"문의하기","type":"WL"}]'),
  )

  const providerNormalizedTemplate = {
    variables: [...template.variables],
    content: template.content,
    buttons: template.buttons.map((button) => ({
      type: button.type,
      name: button.name,
      linkPc: button.linkPc,
      linkMobile: button.linkMobile,
    })),
  }
  assert.equal(
    checksumRegistrationCustomerMessageTemplate(providerNormalizedTemplate),
    template.checksums.template,
  )
  assert.notEqual(
    checksumRegistrationCustomerMessageTemplate({ ...providerNormalizedTemplate, content: `${template.content}!` }),
    template.checksums.template,
  )

  const rendered = renderRegistrationCustomerMessage({
    kind: "admission_application",
    facts: { studentName: "김팁스", subjects: ["영어"], enrollmentPlans: [ENGLISH_PLAN] },
  })
  assert.equal(rendered.checksums.body, sha256(rendered.body))
  assert.equal(rendered.checksums.buttons, template.checksums.buttons)
  assert.equal(
    rendered.checksums.variables,
    sha256(`{"#{등록수업안내}":${JSON.stringify(ENGLISH_PLAN_VARIABLE)},"#{학생명}":"김팁스"}`),
  )
})
