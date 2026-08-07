import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationCustomerMessageCatalog,
} from "../src/features/tasks/server/registration-customer-message-catalog.ts"
import {
  createRegistrationCustomerMessageSourceResolver,
  readRegistrationCustomerMessagePrivateSource,
} from "../src/features/tasks/server/registration-customer-message-source.ts"

const IDS = Object.freeze({
  actor: "00000000-0000-4000-8000-000000000001",
  task: "00000000-0000-4000-8000-000000000002",
  appointment: "00000000-0000-4000-8000-000000000003",
  mathTrack: "00000000-0000-4000-8000-000000000004",
  englishTrack: "00000000-0000-4000-8000-000000000005",
  class: "00000000-0000-4000-8000-000000000006",
})

const FIXED_NOW = new Date("2026-08-05T00:00:00.000Z")
const PEPPER = "test-pepper"

function createCatalog(overrides = {}) {
  return createRegistrationCustomerMessageCatalog({
    SOLAPI_API_KEY: "api-key",
    SOLAPI_API_SECRET: "api-secret",
    SOLAPI_KAKAO_PF_ID: "pf-id",
    SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "template-level",
    SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "template-visit",
    SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "template-reminder",
    SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "template-waiting",
    SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: "template-admission",
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: PEPPER,
    ...overrides,
  })
}

function appointmentSource(overrides = {}) {
  return {
    messageKind: "level_test_booking",
    sourceId: IDS.appointment,
    taskId: IDS.task,
    trackId: null,
    appointmentId: IDS.appointment,
    sourceRevision: 7,
    studentName: "  김팁스 학생  ",
    parentPhoneDigits: "01012345678",
    subjects: ["과학", "영어", "수학", "영어"],
    appointmentKind: "level_test",
    scheduledAt: "2026-08-05T15:30:00+09:00",
    place: "  팁스학원 3층  ",
    ...overrides,
  }
}

function waitingSource(overrides = {}) {
  return {
    messageKind: "waiting_notice",
    sourceId: IDS.mathTrack,
    taskId: IDS.task,
    trackId: IDS.mathTrack,
    appointmentId: null,
    sourceRevision: 4,
    studentName: "김팁스",
    parentPhoneDigits: "01012345678",
    subjects: ["수학"],
    workflowStatus: "waiting_current_class",
    waitingKind: "current_class",
    waitingClassId: IDS.class,
    waitingClassName: "  중2 수학 A  ",
    ...overrides,
  }
}

function admissionSource(overrides = {}) {
  return {
    messageKind: "admission_application",
    sourceId: IDS.task,
    taskId: IDS.task,
    trackId: null,
    appointmentId: null,
    sourceRevision: 9,
    studentName: "김팁스",
    parentPhoneDigits: "01012345678",
    subjects: ["수학", "영어"],
    tracks: [
      {
        trackId: IDS.mathTrack,
        subject: "수학",
        workflowStatus: "planned_enrollment",
        workflowRevision: 4,
        pipelineStatus: "confirmed",
      },
      {
        trackId: IDS.englishTrack,
        subject: "영어",
        workflowStatus: "planned_enrollment",
        workflowRevision: 3,
        pipelineStatus: "confirmed",
      },
    ],
    ...overrides,
  }
}

function createResolver(source, options = {}) {
  let calls = 0
  const resolver = createRegistrationCustomerMessageSourceResolver({
    catalog: options.catalog ?? createCatalog(),
    recipientHashPepper: options.recipientHashPepper ?? PEPPER,
    now: () => new Date(FIXED_NOW),
    async resolveSource(input) {
      calls += 1
      assert.equal(input.actorProfileId, IDS.actor)
      assert.equal(input.messageKind, source.messageKind)
      assert.equal(input.sourceId, source.sourceId)
      return structuredClone(source)
    },
  })
  return { resolver, calls: () => calls }
}

async function resolveSource(source, options = {}) {
  const { resolver } = createResolver(source, options)
  return resolver.resolve({
    actorProfileId: IDS.actor,
    messageKind: source.messageKind,
    sourceId: source.sourceId,
  })
}

test("appointment source is normalized, stably sorted, and rendered in KST", async () => {
  const { resolver, calls } = createResolver(appointmentSource())
  const resolved = await resolver.resolve({
    actorProfileId: IDS.actor,
    messageKind: "level_test_booking",
    sourceId: IDS.appointment,
  })

  assert.equal(calls(), 1)
  assert.deepEqual({ ...resolved, body: undefined }, {
    messageKind: "level_test_booking",
    sourceId: IDS.appointment,
    taskId: IDS.task,
    sourceRevision: 7,
    studentName: "김팁스 학생",
    recipientLast4: "5678",
    facts: {
      subjectLabel: "영어 · 수학 · 과학",
      scheduleLabel: "2026년 8월 5일 수요일 오후 3:30",
      placeLabel: "팁스학원 3층",
    },
    body: undefined,
    buttons: [{
      name: "학원 위치 보기",
      type: "WL",
      host: "map.naver.com",
    }],
  })
  assert.match(resolved.body, /김팁스 학생의 레벨테스트 예약/u)
  assert.match(resolved.body, /일시: 2026년 8월 5일 수요일 오후 3:30/u)
  assert.match(resolved.body, /과목: 영어 · 수학 · 과학/u)
})

test("waiting and admission variants normalize their canonical facts", async () => {
  const waiting = await resolveSource(waitingSource())
  assert.deepEqual(waiting.facts, {
    subjectLabel: "수학",
    waitingKindLabel: "현재반 대기",
    waitingDetailLabel: "중2 수학 A",
  })
  assert.match(waiting.body, /수학 현재반 대기 요청/u)
  assert.match(waiting.body, /대기 내용: 중2 수학 A/u)

  const admission = await resolveSource(admissionSource({
    tracks: admissionSource().tracks.toReversed(),
    subjects: ["수학", "영어", "수학"],
  }))
  assert.equal(admission.facts.subjectLabel, "영어 · 수학")
  assert.deepEqual(admission.buttons, [{
    name: "입학신청서 작성",
    type: "WL",
    host: "bit.ly",
  }])
  const privateSource = readRegistrationCustomerMessagePrivateSource(admission)
  assert.deepEqual(
    privateSource.source.tracks.map(({ trackId }) => trackId),
    [IDS.englishTrack, IDS.mathTrack],
  )
})

test("visit booking, both reminder kinds, and every waiting kind render valid facts", async () => {
  const visit = await resolveSource(appointmentSource({
    messageKind: "visit_consultation_booking",
    appointmentKind: "visit_consultation",
  }))
  assert.match(visit.body, /방문상담 예약을 안내/u)

  for (const appointmentKind of ["level_test", "visit_consultation"]) {
    const reminder = await resolveSource(appointmentSource({
      messageKind: "appointment_reminder",
      appointmentKind,
    }))
    assert.match(
      reminder.body,
      appointmentKind === "level_test" ? /레벨테스트 일정을 다시/u : /방문상담 일정을 다시/u,
    )
  }

  for (const [workflowStatus, waitingKind, waitingClassId, waitingClassName, label] of [
    ["waiting_new_class", "current_term_opening", null, null, "신규반 대기"],
    ["waiting_next_opening", "next_term_opening", null, null, "다음 개강 알림"],
  ]) {
    const waiting = await resolveSource(waitingSource({
      workflowStatus,
      waitingKind,
      waitingClassId,
      waitingClassName,
    }))
    assert.equal(waiting.facts.waitingKindLabel, label)
  }
})

test("invalid source variants fail closed with stable source codes", async () => {
  const invalidSources = [
    [appointmentSource({ parentPhoneDigits: "0212345678" }), "registration_customer_message_phone_invalid"],
    [appointmentSource({ studentName: "   " }), "registration_customer_message_student_name_invalid"],
    [appointmentSource({ scheduledAt: "2026-08-04T09:00:00+09:00" }), "registration_customer_message_schedule_not_future"],
    [appointmentSource({ appointmentId: IDS.mathTrack }), "registration_customer_message_source_mismatch"],
    [appointmentSource({ appointmentKind: "visit_consultation" }), "registration_customer_message_appointment_kind_mismatch"],
    [waitingSource({ waitingClassName: "" }), "registration_customer_message_waiting_class_invalid"],
    [waitingSource({ workflowStatus: "waiting_next_term" }), "registration_customer_message_waiting_kind_mismatch"],
    [admissionSource({ tracks: [] }), "registration_customer_message_admission_tracks_invalid"],
  ]

  for (const [source, code] of invalidSources) {
    await assert.rejects(() => resolveSource(source), { message: code })
  }
})

test("recipient HMAC is domain separated and every material fact changes the fingerprint", async () => {
  const base = appointmentSource()
  const resolved = await resolveSource(base)
  const privateSource = readRegistrationCustomerMessagePrivateSource(resolved)

  assert.equal(
    privateSource.recipientHash,
    "de2ef70ef0f836bc0f3656b6107e658fbb1a5f7d893fddbe2436569ad83b1a42",
  )
  assert.equal(
    readRegistrationCustomerMessagePrivateSource(await resolveSource(base)).recipientHash,
    privateSource.recipientHash,
  )

  const variants = [
    appointmentSource({ studentName: "다른 학생" }),
    appointmentSource({ parentPhoneDigits: "01087654321" }),
    appointmentSource({ sourceRevision: 8 }),
    appointmentSource({ scheduledAt: "2026-08-05T16:30:00+09:00" }),
    appointmentSource({ place: "팁스학원 2층" }),
    appointmentSource({ subjects: ["영어"] }),
  ]
  for (const variant of variants) {
    const changed = readRegistrationCustomerMessagePrivateSource(await resolveSource(variant))
    assert.notEqual(changed.sourceFingerprint, privateSource.sourceFingerprint)
  }

  const baseCatalog = createCatalog()
  const changedCatalog = {
    ...baseCatalog,
    templates: {
      ...baseCatalog.templates,
      level_test_booking: {
        ...baseCatalog.templates.level_test_booking,
        revision: 3,
      },
    },
  }
  const catalogChange = readRegistrationCustomerMessagePrivateSource(
    await resolveSource(base, { catalog: changedCatalog }),
  )
  assert.notEqual(catalogChange.sourceFingerprint, privateSource.sourceFingerprint)

  const admissionBase = admissionSource()
  const admissionFingerprint = readRegistrationCustomerMessagePrivateSource(
    await resolveSource(admissionBase),
  ).sourceFingerprint
  const changedTrack = structuredClone(admissionBase)
  changedTrack.tracks[0].workflowStatus = "enrollment_requested"
  assert.notEqual(
    readRegistrationCustomerMessagePrivateSource(
      await resolveSource(changedTrack),
    ).sourceFingerprint,
    admissionFingerprint,
  )
})

test("source checksum preserves PostgreSQL timestamptz microseconds exactly", async () => {
  const source = appointmentSource({
    studentName: "김팁스",
    subjects: ["영어", "수학", "과학"],
    scheduledAt: "2026-08-05T15:30:00.123456+09:00",
    place: "팁스학원 3층",
  })
  const first = readRegistrationCustomerMessagePrivateSource(await resolveSource(source))
  const nextMicrosecond = readRegistrationCustomerMessagePrivateSource(await resolveSource({
    ...source,
    scheduledAt: "2026-08-05T15:30:00.123457+09:00",
  }))

  assert.equal(
    first.sourceFactsChecksum,
    "0ff88042062af775bd66b9621caa74ab9811787b1adbca2e79cbd335c9783fec",
  )
  assert.notEqual(nextMicrosecond.sourceFactsChecksum, first.sourceFactsChecksum)
  assert.notEqual(nextMicrosecond.sourceFingerprint, first.sourceFingerprint)
})

test("public source serialization never exposes full phone, hashes, provider identifiers, or checksums", async () => {
  const source = await resolveSource(admissionSource())
  const serialized = JSON.stringify(source)
  for (const forbidden of [
    "01012345678",
    "recipientHash",
    "parentPhoneDigits",
    "templateId",
    "template-admission",
    "pfId",
    "pf-id",
    "checksum",
    "linkMobile",
    "https://bit.ly/3rurm5t",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }

  const privateSource = readRegistrationCustomerMessagePrivateSource(source)
  assert.equal(privateSource.parentPhoneDigits, "01012345678")
  assert.equal(privateSource.previewContract.templateKey, "admission_application")
  assert.equal(privateSource.readinessContract.templateId, "template-admission")
  assert.equal(privateSource.readinessContract.pfId, "pf-id")
  assert.equal(privateSource.rendered.buttons[0].linkMobile, "https://bit.ly/3rurm5t")

  assert.throws(
    () => readRegistrationCustomerMessagePrivateSource(structuredClone(source)),
    { message: "registration_customer_message_private_source_unavailable" },
  )
})
