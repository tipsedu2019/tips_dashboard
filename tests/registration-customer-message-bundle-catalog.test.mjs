import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_TEMPLATE_ENV_KEYS,
  createRegistrationCustomerMessageBundleCatalog,
  renderRegistrationCustomerMessageBundle,
} from "../src/features/tasks/server/registration-customer-message-bundle-catalog.ts"

const TEMPLATE_IDS = Object.freeze({
  level_test_booking_bundle: "bundle-level-booking",
  visit_consultation_booking_bundle: "bundle-visit-booking",
  observation_booking_bundle: "bundle-observation-booking",
  level_test_reminder_bundle: "bundle-level-reminder",
  visit_consultation_reminder_bundle: "bundle-visit-reminder",
  observation_reminder_bundle: "bundle-observation-reminder",
})

const ENV = Object.freeze({
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_BUNDLE_TEMPLATE_ID: TEMPLATE_IDS.level_test_booking_bundle,
  SOLAPI_REGISTRATION_VISIT_BOOKING_BUNDLE_TEMPLATE_ID: TEMPLATE_IDS.visit_consultation_booking_bundle,
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_BUNDLE_TEMPLATE_ID: TEMPLATE_IDS.observation_booking_bundle,
  SOLAPI_REGISTRATION_LEVEL_TEST_REMINDER_BUNDLE_TEMPLATE_ID: TEMPLATE_IDS.level_test_reminder_bundle,
  SOLAPI_REGISTRATION_VISIT_REMINDER_BUNDLE_TEMPLATE_ID: TEMPLATE_IDS.visit_consultation_reminder_bundle,
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_BUNDLE_TEMPLATE_ID: TEMPLATE_IDS.observation_reminder_bundle,
})

const FROZEN_CHECKSUMS = JSON.parse(readFileSync(
  new URL("./fixtures/registration-customer-message-checksums.json", import.meta.url),
  "utf8",
)).bundles

const ITEMS = Object.freeze([
  Object.freeze({
    subject: "수학",
    scheduledAt: "2026-08-23T07:00:00.000Z",
    place: "별관",
    className: "중2 수학 B반",
    teacherName: "김길동",
  }),
  Object.freeze({
    subject: "영어",
    scheduledAt: "2026-08-21T05:00:00.000Z",
    place: "본관",
    className: "중2 영어 A반",
    teacherName: "홍길동",
  }),
])

test("bundle catalog maps only six server-side template environment keys", () => {
  assert.deepEqual(REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_TEMPLATE_ENV_KEYS, {
    level_test_booking_bundle: "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_BUNDLE_TEMPLATE_ID",
    visit_consultation_booking_bundle: "SOLAPI_REGISTRATION_VISIT_BOOKING_BUNDLE_TEMPLATE_ID",
    observation_booking_bundle: "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_BUNDLE_TEMPLATE_ID",
    level_test_reminder_bundle: "SOLAPI_REGISTRATION_LEVEL_TEST_REMINDER_BUNDLE_TEMPLATE_ID",
    visit_consultation_reminder_bundle: "SOLAPI_REGISTRATION_VISIT_REMINDER_BUNDLE_TEMPLATE_ID",
    observation_reminder_bundle: "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_BUNDLE_TEMPLATE_ID",
  })

  const catalog = createRegistrationCustomerMessageBundleCatalog(ENV)
  assert.deepEqual(Object.keys(catalog.templates), Object.keys(TEMPLATE_IDS))
  for (const [kind, template] of Object.entries(catalog.templates)) {
    assert.equal(template.templateId, TEMPLATE_IDS[kind])
    assert.deepEqual(template.variables, ["학생명", "예약목록"])
    assert.equal(template.disableSms, true)
    assert.equal(template.checksum, FROZEN_CHECKSUMS[kind])
    assert.deepEqual(template.buttons.map((button) => button.name), ["본관 위치", "별관 위치", "문의하기"])
  }
})

test("bundle renderer sorts multi-subject reservations by KST schedule and includes observation class facts", () => {
  const rendered = renderRegistrationCustomerMessageBundle({
    kind: "observation_booking_bundle",
    studentName: "김팁스",
    items: ITEMS,
  })

  assert.match(rendered.variables.예약목록, /^1\. 영어 · 2026년 8월 21일 금요일 오후 2:00 · 본관\n수업: 중2 영어 A반 · 담당: 홍길동 선생님\n2\. 수학 · 2026년 8월 23일 일요일 오후 4:00 · 별관\n수업: 중2 수학 B반 · 담당: 김길동 선생님$/u)
  assert.match(rendered.body, /청강 예약 안내/u)
  assert.match(rendered.body, /김팁스 학생의 청강 예약을 안내드립니다\./u)
  assert.match(rendered.body, /1\. 영어 · 2026년 8월 21일 금요일 오후 2:00 · 본관/u)
  assert.equal(rendered.body.includes("#{학생명}"), false)
  assert.equal(rendered.body.includes("#{예약목록}"), false)
})

test("bundle renderer rejects unsafe or non-canonical reservation lists", () => {
  const valid = { kind: "level_test_booking_bundle", studentName: "김팁스", items: ITEMS }
  for (const items of [
    [],
    [...ITEMS, ITEMS[0], ITEMS[1]],
    [ITEMS[0], { ...ITEMS[1], subject: "수학" }],
    [{ ...ITEMS[0], place: "제3관" }],
    [{ ...ITEMS[0], scheduledAt: "2026-08-23T07:00:00" }],
    [{ ...ITEMS[0], subject: "국어" }],
  ]) {
    assert.throws(() => renderRegistrationCustomerMessageBundle({ ...valid, items }))
  }
})
