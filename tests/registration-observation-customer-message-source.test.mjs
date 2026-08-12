import assert from "node:assert/strict"
import test from "node:test"

import {
  OBSERVATION_LOCATION_URLS,
  createRegistrationCustomerMessageCatalog,
} from "../src/features/tasks/server/registration-customer-message-catalog.ts"
import {
  createRegistrationCustomerMessageSourceResolver,
  readRegistrationCustomerMessagePrivateSource,
} from "../src/features/tasks/server/registration-customer-message-source.ts"

const IDS = Object.freeze({
  actor: "d6200000-0000-4000-8000-000000000001",
  task: "d6200000-0000-4000-8000-000000000010",
  track: "d6200000-0000-4000-8000-000000000011",
  appointment: "d6200000-0000-4000-8000-000000000012",
  observation: "d6200000-0000-4000-8000-000000000013",
  session: "d6200000-0000-4000-8000-000000000014",
})

const PEPPER = "observation-source-test-pepper"
const RAW = Object.freeze({
  messageKind: "observation_booking",
  sourceId: IDS.observation,
  taskId: IDS.task,
  trackId: IDS.track,
  observationId: IDS.observation,
  appointmentId: IDS.appointment,
  sourceRevision: 4,
  sessionSourceRevision: Object.freeze({
    authority: "normalized",
    sessionId: IDS.session,
    revision: 7,
  }),
  bookingFactHash: "a".repeat(64),
  studentName: "SOLAPI 테스트",
  parentPhoneDigits: "01012345678",
  subject: "영어",
  className: "중2 영어 A반",
  scheduledAt: "2026-08-17T09:00:00Z",
  place: "본관 301호",
  campus: "본관",
  teacherName: "홍길동",
})

function createCatalog() {
  return createRegistrationCustomerMessageCatalog({
    SOLAPI_API_KEY: "api-key",
    SOLAPI_API_SECRET: "api-secret",
    SOLAPI_KAKAO_PF_ID: "pf-id",
    SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "template-observation-booking",
    SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "template-observation-reminder",
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: PEPPER,
  })
}

function createResolver(raw) {
  return createRegistrationCustomerMessageSourceResolver({
    catalog: createCatalog(),
    recipientHashPepper: PEPPER,
    now: () => new Date("2026-08-12T00:00:00Z"),
    async resolveSource(input) {
      assert.equal(input.actorProfileId, IDS.actor)
      assert.equal(input.messageKind, raw.messageKind)
      assert.equal(input.sourceId, raw.sourceId)
      return structuredClone(raw)
    },
  })
}

async function resolveRaw(raw) {
  return createResolver(raw).resolve({
    actorProfileId: IDS.actor,
    messageKind: raw.messageKind,
    sourceId: raw.sourceId,
  })
}

test("observation booking resolves the exact 17-key DB source without public privacy leakage", async () => {
  assert.equal(Object.keys(RAW).length, 17)

  const source = await resolveRaw(RAW)
  assert.deepEqual(source.facts, {
    subjectLabel: "영어",
    className: "중2 영어 A반",
    scheduleLabel: "2026년 8월 17일 월요일 오후 6:00",
    placeLabel: "본관 301호",
    teacherLabel: "홍길동",
  })
  assert.deepEqual(source.buttons, [{
    name: "학원 위치 보기",
    type: "WL",
    host: "map.naver.com",
  }, {
    name: "문의하기",
    type: "WL",
    host: "tipsedu.channel.io",
  }])
  assert.equal(source.recipientLast4, "5678")

  const serialized = JSON.stringify(source)
  for (const forbidden of [
    "01012345678",
    IDS.track,
    IDS.appointment,
    IDS.session,
    "bookingFactHash",
    "sessionSourceRevision",
    "recipientHash",
    "sourceFingerprint",
    "sourceFactsChecksum",
    "template-observation-booking",
    "linkMobile",
    "linkPc",
    "학원위치URL",
    OBSERVATION_LOCATION_URLS.본관,
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
})

test("both observation kinds build the same canonical facts and server-derived transport variable", async () => {
  const booking = await resolveRaw(RAW)
  const reminder = await resolveRaw({
    ...RAW,
    messageKind: "observation_reminder",
  })
  const bookingPrivate = readRegistrationCustomerMessagePrivateSource(booking)
  const reminderPrivate = readRegistrationCustomerMessagePrivateSource(reminder)

  assert.deepEqual(booking.facts, reminder.facts)
  assert.deepEqual(bookingPrivate.transportVariables, {
    학원위치URL: OBSERVATION_LOCATION_URLS.본관.slice("https://".length),
  })
  assert.deepEqual(reminderPrivate.transportVariables, bookingPrivate.transportVariables)
  assert.equal(
    bookingPrivate.rendered.variables["#{학원위치URL}"],
    OBSERVATION_LOCATION_URLS.본관.slice("https://".length),
  )
  assert.equal(bookingPrivate.rendered.buttons[0].linkMobile, OBSERVATION_LOCATION_URLS.본관)
  assert.equal(bookingPrivate.rendered.buttons[0].linkPc, OBSERVATION_LOCATION_URLS.본관)
  assert.notEqual(bookingPrivate.sourceFingerprint, reminderPrivate.sourceFingerprint)
})

test("observation source fingerprints cover canonical source, rendering, revision, hash, recipient, and campus", async () => {
  const base = readRegistrationCustomerMessagePrivateSource(await resolveRaw(RAW))
  assert.equal(
    base.sourceFingerprint,
    "e07d1f18847f5cf7dd49ef7d58bc5f3c7e1074d095722edb0303e7480b50e402",
  )
  assert.equal(
    base.sourceFactsChecksum,
    "93d179c29c6652a53651c97f0ccc318b2c57954761d589d4d7ecb2cecb5a3fb9",
  )
  assert.equal(
    base.recipientHash,
    "0b4b59b98aad32df072b7a94c59f2f9c6263feee32aef119d841c10b75440299",
  )
  assert.equal(base.previewContract.sourceFingerprint, base.sourceFingerprint)
  assert.equal(base.readinessContract.sourceFingerprint, base.sourceFingerprint)
  assert.equal(base.readinessContract.sourceFactsChecksum, base.sourceFactsChecksum)
  assert.equal(base.previewContract.renderedBodyChecksum, base.rendered.checksums.body)
  assert.equal(base.previewContract.renderedVariablesChecksum, base.rendered.checksums.variables)
  assert.equal(base.previewContract.renderedButtonsChecksum, base.rendered.checksums.buttons)

  const variants = [
    ["task identity", { taskId: "d6200000-0000-4000-8000-000000000020" }],
    ["track identity", { trackId: "d6200000-0000-4000-8000-000000000021" }],
    ["appointment identity", { appointmentId: "d6200000-0000-4000-8000-000000000022" }],
    ["student", { studentName: "다른 학생" }],
    ["recipient", { parentPhoneDigits: "01087654321" }],
    ["appointment notification revision", { sourceRevision: 5 }],
    ["session revision", {
      sessionSourceRevision: { ...RAW.sessionSourceRevision, revision: 8 },
    }],
    ["booking hash", { bookingFactHash: "b".repeat(64) }],
    ["subject/body variable", { subject: "수학" }],
    ["class/body variable", { className: "중2 영어 B반" }],
    ["schedule/body variable", { scheduledAt: "2026-08-17T10:00:00Z" }],
    ["place/body variable", { place: "본관 302호" }],
    ["teacher/body variable", { teacherName: "김길동" }],
    ["campus/transport and final button", { campus: "별관", place: "별관 201호" }],
  ]
  for (const [label, change] of variants) {
    const changed = readRegistrationCustomerMessagePrivateSource(
      await resolveRaw({ ...RAW, ...change }),
    )
    assert.notEqual(changed.sourceFingerprint, base.sourceFingerprint, label)
    if (label === "recipient") {
      assert.equal(changed.sourceFactsChecksum, base.sourceFactsChecksum, label)
    } else {
      assert.notEqual(changed.sourceFactsChecksum, base.sourceFactsChecksum, label)
    }
  }
})

test("observation source rejects extra, missing, browser-supplied, and malformed raw facts", async () => {
  const without = (key) => Object.fromEntries(Object.entries(RAW).filter(([name]) => name !== key))
  const invalid = [
    { ...RAW, school: "학교" },
    { ...RAW, subjects: ["영어", "수학"] },
    { ...RAW, status: "scheduled" },
    { ...RAW, 학원위치URL: OBSERVATION_LOCATION_URLS.본관 },
    { ...RAW, campus: "제3관" },
    { ...RAW, sourceId: IDS.track },
    { ...RAW, observationId: IDS.track },
    { ...RAW, taskId: "not-a-uuid" },
    { ...RAW, trackId: "not-a-uuid" },
    { ...RAW, appointmentId: "not-a-uuid" },
    { ...RAW, sourceRevision: 0 },
    { ...RAW, sourceRevision: 1.5 },
    { ...RAW, bookingFactHash: "a".repeat(63) },
    { ...RAW, scheduledAt: "2026-02-30T09:00:00Z" },
    { ...RAW, subject: ["영어"] },
    { ...RAW, subject: "국어" },
    { ...RAW, sessionSourceRevision: {
      ...RAW.sessionSourceRevision,
      extra: true,
    } },
    { ...RAW, sessionSourceRevision: {
      authority: "normalized",
      sessionId: "not-a-uuid",
      revision: 7,
    } },
    { ...RAW, sessionSourceRevision: {
      authority: "normalized",
      sessionId: IDS.session,
      revision: -1,
    } },
    without("teacherName"),
  ]

  for (const raw of invalid) {
    await assert.rejects(() => resolveRaw(raw), /registration_customer_message_source_invalid/u)
  }
})

test("legacy session source revision accepts only its exact tagged-union shape", async () => {
  const legacy = {
    authority: "legacy",
    sessionKey: "2026-08-17:legacy",
    contentHash: "legacy-content-hash",
  }
  const source = await resolveRaw({ ...RAW, sessionSourceRevision: legacy })
  assert.deepEqual(
    readRegistrationCustomerMessagePrivateSource(source).source.sessionSourceRevision,
    legacy,
  )

  for (const sessionSourceRevision of [
    { ...legacy, extra: true },
    { ...legacy, sessionKey: " " },
    { ...legacy, contentHash: " " },
    { authority: "other", sessionKey: "key", contentHash: "hash" },
  ]) {
    await assert.rejects(
      () => resolveRaw({ ...RAW, sessionSourceRevision }),
      /registration_customer_message_source_invalid/u,
    )
  }
})
