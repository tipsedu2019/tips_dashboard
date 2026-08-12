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
  textbook: "00000000-0000-4000-8000-000000000007",
  session: "00000000-0000-4000-8000-000000000008",
  slot: "00000000-0000-4000-8000-000000000009",
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
  const appointmentKind = overrides.appointmentKind ?? "level_test"
  const workflowStatus = appointmentKind === "level_test"
    ? "level_test_requested"
    : "consultation_requested"
  return {
    messageKind: "level_test_booking",
    sourceId: IDS.appointment,
    taskId: IDS.task,
    trackId: null,
    appointmentId: IDS.appointment,
    sourceRevision: 7,
    studentName: "  김팁스 학생  ",
    parentPhoneDigits: "01012345678",
    subjects: ["수학", "영어", "영어"],
    participants: [
      {
        trackId: IDS.englishTrack,
        subject: "영어",
        workflowStatus,
        workflowRevision: 7,
        activityId: "00000000-0000-4000-8000-000000000110",
        activityStatus: "scheduled",
      },
      {
        trackId: IDS.mathTrack,
        subject: "수학",
        workflowStatus,
        workflowRevision: 8,
        activityId: "00000000-0000-4000-8000-000000000111",
        activityStatus: appointmentKind === "level_test" ? "in_progress" : "scheduled",
      },
    ],
    appointmentKind,
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
    subjects: ["영어"],
    tracks: [
      {
        trackId: IDS.englishTrack,
        subject: "영어",
        workflowStatus: "enrollment_requested",
        workflowRevision: 3,
        pipelineStatus: "enrollment_decided",
      },
    ],
    enrollmentPlans: [{
      enrollmentId: "00000000-0000-4000-8000-000000000120",
      trackId: IDS.englishTrack,
      subject: "영어",
      sortOrder: 0,
      workflowStatus: "enrollment_requested",
      workflowRevision: 3,
      enrollmentUpdatedAt: "2026-08-08T00:00:00.000000Z",
      classId: IDS.class,
      classSubject: "영어",
      className: "중2 영어 A반",
      classUpdatedAt: "2026-08-08T00:00:01.000000Z",
      textbookId: null,
      textbookName: null,
      textbookUpdatedAt: null,
      runtimeVersion: 0,
      storageMode: "legacy",
      authority: "legacy",
      scheduleRevision: 4,
      scheduleHash: "a".repeat(64),
      slots: [
        {
          slotId: null,
          weekday: 1,
          startTime: "18:00",
          endTime: "20:00",
          teacherName: "홍길동",
          classroomName: "본관 301호",
          sortOrder: 0,
          updatedAt: null,
        },
        {
          slotId: null,
          weekday: 3,
          startTime: "18:00",
          endTime: "20:00",
          teacherName: "홍길동",
          classroomName: "본관 301호",
          sortOrder: 1,
          updatedAt: null,
        },
      ],
      firstLesson: {
        sessionId: null,
        sessionKey: "2026-08-17:1",
        sessionDate: "2026-08-17",
        scheduleState: "active",
        startTime: "18:00",
        endTime: "20:00",
        revision: null,
        updatedAt: null,
      },
    }],
    ...overrides,
  }
}

function normalizedAdmissionSource() {
  const source = admissionSource()
  const plan = source.enrollmentPlans[0]
  plan.textbookId = IDS.textbook
  plan.textbookName = "능률 VOCA"
  plan.textbookUpdatedAt = "2026-08-08T00:00:02.000000Z"
  plan.runtimeVersion = 1
  plan.storageMode = "normalized"
  plan.authority = "normalized"
  plan.slots[0].slotId = IDS.slot
  plan.slots[0].updatedAt = "2026-08-08T00:00:03.000000Z"
  plan.slots[1].slotId = "00000000-0000-4000-8000-000000000010"
  plan.slots[1].updatedAt = "2026-08-08T00:00:04.000000Z"
  plan.firstLesson.sessionId = IDS.session
  plan.firstLesson.revision = 1
  plan.firstLesson.updatedAt = "2026-08-08T00:00:05.000000Z"
  return source
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
      subjectLabel: "영어 · 수학",
      scheduleLabel: "2026년 8월 5일 수요일 오후 3:30",
      placeLabel: "팁스학원 3층",
    },
    body: undefined,
    buttons: [{
      name: "학원 위치 보기",
      type: "WL",
      host: "map.naver.com",
    }, {
      name: "문의하기",
      type: "WL",
      host: "tipsedu.channel.io",
    }],
  })
  assert.match(resolved.body, /김팁스 학생의 레벨테스트 예약/u)
  assert.match(resolved.body, /일시: 2026년 8월 5일 수요일 오후 3:30/u)
  assert.match(resolved.body, /과목: 영어 · 수학/u)

  const privateSource = readRegistrationCustomerMessagePrivateSource(resolved)
  assert.equal(
    privateSource.sourceFingerprint,
    "42f8d43b4d855e5b60e5511b40d2099184548f6478d0a337eca3dea81f829f51",
  )
  assert.equal(
    privateSource.sourceFactsChecksum,
    "68583e2955b18f4fa649daadf1e39f7a96d538bf4e26bf98e05f2186d89a101a",
  )
  assert.equal(Object.hasOwn(privateSource, "transportVariables"), false)
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

  const admission = await resolveSource(admissionSource())
  assert.equal(admission.facts.subjectLabel, "영어")
  assert.deepEqual(admission.facts.admissionPlans, [{
    subjectLabel: "영어",
    className: "중2 영어 A반",
    textbookLabel: "선택 안 함(이미 보유)",
    scheduleLabel: "월·수 오후 6:00–8:00",
    teacherLabel: "홍길동",
    classroomLabel: "본관 301호",
    firstLessonLabel: "8월 17일 월요일 오후 6:00–8:00",
  }])
  assert.deepEqual(admission.buttons, [{
    name: "입학신청서 작성",
    type: "WL",
    host: "pay.makeedu.co.kr",
  }, {
    name: "문의하기",
    type: "WL",
    host: "tipsedu.channel.io",
  }])
  const privateSource = readRegistrationCustomerMessagePrivateSource(admission)
  assert.deepEqual(
    privateSource.source.tracks.map(({ trackId }) => trackId),
    [IDS.englishTrack],
  )
  assert.equal(privateSource.source.enrollmentPlans[0].classId, IDS.class)
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
  const appointmentSubjectMismatch = appointmentSource({ subjects: ["영어", "수학", "과학"] })
  const appointmentParticipantExtraKey = appointmentSource()
  appointmentParticipantExtraKey.participants[0].internalOnly = true
  const admissionPlanExtraKey = admissionSource()
  admissionPlanExtraKey.enrollmentPlans[0].internalOnly = true
  const admissionTrackExtraKey = admissionSource()
  admissionTrackExtraKey.tracks[0].internalOnly = true
  const admissionSlotExtraKey = admissionSource()
  admissionSlotExtraKey.enrollmentPlans[0].slots[0].internalOnly = true
  const admissionFirstLessonExtraKey = admissionSource()
  admissionFirstLessonExtraKey.enrollmentPlans[0].firstLesson.internalOnly = true
  const admissionTrackMismatch = admissionSource()
  admissionTrackMismatch.enrollmentPlans[0].trackId = IDS.mathTrack
  const admissionClassSubjectMismatch = admissionSource()
  admissionClassSubjectMismatch.enrollmentPlans[0].classSubject = "수학"
  const invalidNormalizedAuthority = admissionSource()
  invalidNormalizedAuthority.enrollmentPlans[0].authority = "normalized"
  const invalidSources = [
    [appointmentSource({ parentPhoneDigits: "0212345678" }), "registration_customer_message_phone_invalid"],
    [appointmentSource({ studentName: "   " }), "registration_customer_message_student_name_invalid"],
    [appointmentSource({ scheduledAt: "2026-08-04T09:00:00+09:00" }), "registration_customer_message_schedule_not_future"],
    [appointmentSource({ appointmentId: IDS.mathTrack }), "registration_customer_message_source_mismatch"],
    [appointmentSource({ appointmentKind: "visit_consultation" }), "registration_customer_message_appointment_kind_mismatch"],
    [appointmentSubjectMismatch, "registration_customer_message_subject_invalid"],
    [appointmentParticipantExtraKey, "registration_customer_message_appointment_participants_invalid"],
    [waitingSource({ waitingClassName: "" }), "registration_customer_message_waiting_class_invalid"],
    [waitingSource({ workflowStatus: "waiting_next_term" }), "registration_customer_message_waiting_kind_mismatch"],
    [admissionSource({ tracks: [] }), "registration_customer_message_admission_tracks_invalid"],
    [admissionSource({ enrollmentPlans: [] }), "registration_customer_message_admission_schedule_incomplete"],
    [admissionSource({ subjects: ["영어", "수학"] }), "registration_customer_message_subject_invalid"],
    [admissionPlanExtraKey, "registration_customer_message_admission_plan_invalid"],
    [admissionTrackExtraKey, "registration_customer_message_admission_tracks_invalid"],
    [admissionSlotExtraKey, "registration_customer_message_admission_schedule_incomplete"],
    [admissionFirstLessonExtraKey, "registration_customer_message_admission_schedule_incomplete"],
    [admissionTrackMismatch, "registration_customer_message_admission_plan_invalid"],
    [admissionClassSubjectMismatch, "registration_customer_message_admission_plan_invalid"],
    [invalidNormalizedAuthority, "registration_customer_message_admission_plan_invalid"],
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

  const participantRevision = appointmentSource()
  participantRevision.participants[0].workflowRevision += 1
  const variants = [
    ["student name", appointmentSource({ studentName: "다른 학생" })],
    ["recipient", appointmentSource({ parentPhoneDigits: "01087654321" })],
    ["source revision", appointmentSource({ sourceRevision: 8 })],
    ["appointment time", appointmentSource({ scheduledAt: "2026-08-05T16:30:00+09:00" })],
    ["place", appointmentSource({ place: "팁스학원 2층" })],
    ["participant workflow revision", participantRevision],
  ]
  for (const [label, variant] of variants) {
    const changed = readRegistrationCustomerMessagePrivateSource(await resolveSource(variant))
    assert.notEqual(changed.sourceFingerprint, privateSource.sourceFingerprint, label)
    if (label !== "recipient") {
      assert.notEqual(changed.sourceFactsChecksum, privateSource.sourceFactsChecksum, label)
    } else {
      assert.equal(changed.sourceFactsChecksum, privateSource.sourceFactsChecksum, label)
    }
  }

  const baseCatalog = createCatalog()
  const changedCatalog = {
    ...baseCatalog,
    templates: {
      ...baseCatalog.templates,
      level_test_booking: {
        ...baseCatalog.templates.level_test_booking,
        revision: 4,
      },
    },
  }
  const catalogChange = readRegistrationCustomerMessagePrivateSource(
    await resolveSource(base, { catalog: changedCatalog }),
  )
  assert.notEqual(catalogChange.sourceFingerprint, privateSource.sourceFingerprint)

  const admissionBase = admissionSource()
  const admissionPrivate = readRegistrationCustomerMessagePrivateSource(await resolveSource(admissionBase))
  const variant = (mutate) => {
    const source = structuredClone(admissionBase)
    mutate(source.enrollmentPlans[0], source)
    return source
  }
  const admissionVariants = [
    ["workflow revision", variant((plan, source) => {
      plan.workflowRevision += 1
      source.tracks[0].workflowRevision += 1
    })],
    ["enrollment sort order", variant((plan) => { plan.sortOrder += 1 })],
    ["class name", variant((plan) => { plan.className = "중2 영어 B반" })],
    ["textbook name and null state", variant((plan) => {
      plan.textbookId = IDS.textbook
      plan.textbookName = "능률 VOCA"
      plan.textbookUpdatedAt = "2026-08-08T00:00:02.000000Z"
    })],
    ["runtime version", variant((plan) => { plan.runtimeVersion = 1 })],
    ["storage mode", variant((plan) => { plan.storageMode = "shadow" })],
    ["schedule revision", variant((plan) => { plan.scheduleRevision += 1 })],
    ["schedule hash", variant((plan) => { plan.scheduleHash = "b".repeat(64) })],
    ["slot weekday", variant((plan) => { plan.slots[0].weekday = 2 })],
    ["slot time", variant((plan) => { plan.slots[0].startTime = "17:00" })],
    ["slot teacher", variant((plan) => { plan.slots[0].teacherName = "김길동" })],
    ["slot classroom", variant((plan) => { plan.slots[0].classroomName = "별관 201호" })],
    ["first lesson date", variant((plan) => {
      plan.firstLesson.sessionDate = "2026-08-18"
      plan.firstLesson.sessionKey = "2026-08-18:2"
    })],
    ["first lesson time", variant((plan) => { plan.firstLesson.startTime = "17:00" })],
  ]
  for (const [label, source] of admissionVariants) {
    const changed = readRegistrationCustomerMessagePrivateSource(await resolveSource(source))
    assert.notEqual(changed.sourceFingerprint, admissionPrivate.sourceFingerprint, label)
    assert.notEqual(changed.sourceFactsChecksum, admissionPrivate.sourceFactsChecksum, label)
  }

  const normalized = normalizedAdmissionSource()
  const normalizedPrivate = readRegistrationCustomerMessagePrivateSource(await resolveSource(normalized))
  assert.notEqual(normalizedPrivate.sourceFingerprint, admissionPrivate.sourceFingerprint, "authority")
  assert.notEqual(normalizedPrivate.sourceFactsChecksum, admissionPrivate.sourceFactsChecksum, "authority")
  const changedFirstLessonRevision = structuredClone(normalized)
  changedFirstLessonRevision.enrollmentPlans[0].firstLesson.revision = 2
  const changedRevisionPrivate = readRegistrationCustomerMessagePrivateSource(
    await resolveSource(changedFirstLessonRevision),
  )
  assert.notEqual(
    changedRevisionPrivate.sourceFingerprint,
    normalizedPrivate.sourceFingerprint,
    "first lesson revision",
  )
  assert.notEqual(
    changedRevisionPrivate.sourceFactsChecksum,
    normalizedPrivate.sourceFactsChecksum,
    "first lesson revision",
  )
})

test("source checksum preserves PostgreSQL timestamptz microseconds exactly", async () => {
  const source = appointmentSource({
    studentName: "김팁스",
    subjects: ["영어", "수학"],
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
    "739d17a0f6588923311e8882fbd263e8a28974e3da3f743acc64d18edd381fa8",
  )
  assert.notEqual(nextMicrosecond.sourceFactsChecksum, first.sourceFactsChecksum)
  assert.notEqual(nextMicrosecond.sourceFingerprint, first.sourceFingerprint)
})

test("public source serialization never exposes full phone, hashes, provider identifiers, or checksums", async () => {
  const source = await resolveSource(normalizedAdmissionSource())
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
    "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
    "00000000-0000-4000-8000-000000000120",
    IDS.englishTrack,
    IDS.class,
    IDS.textbook,
    IDS.session,
    IDS.slot,
    "scheduleHash",
    "workflowRevision",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }

  const privateSource = readRegistrationCustomerMessagePrivateSource(source)
  assert.equal(privateSource.parentPhoneDigits, "01012345678")
  assert.equal(privateSource.previewContract.templateKey, "admission_application")
  assert.equal(privateSource.readinessContract.templateId, "template-admission")
  assert.equal(privateSource.readinessContract.pfId, "pf-id")
  assert.equal(
    privateSource.rendered.buttons[0].linkMobile,
    "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
  )

  assert.throws(
    () => readRegistrationCustomerMessagePrivateSource(structuredClone(source)),
    { message: "registration_customer_message_private_source_unavailable" },
  )
})
