import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { REGISTRATION_CUSTOMER_MESSAGE_KINDS } from "../src/features/tasks/registration-customer-message-contract.ts"
import {
  OBSERVATION_LOCATION_URLS,
  REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION,
  REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS,
  REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS,
  createRegistrationCustomerMessageCatalog,
  renderRegistrationCustomerMessage,
} from "../src/features/tasks/server/registration-customer-message-catalog.ts"

const frozenChecksums = JSON.parse(readFileSync(
  new URL("./fixtures/registration-customer-message-checksums.json", import.meta.url),
  "utf8",
))

const MAIN_LOCATION_URL = "https://map.naver.com/p/entry/place/1218797840?placePath=%3Fentry%3Dpll%26from%3Dnx%26fromNxList%3Dtrue&placeSearchOption=entry%3Dpll%26fromNxList%3Dtrue&searchType=place&c=15.00,0,0,0,dh"
const ANNEX_LOCATION_URL = "https://map.naver.com/p/search/%EC%A0%9C%EC%A3%BC%EC%88%98%ED%95%99%ED%95%99%EC%9B%90/place/1962638110?c=10.00,0,0,0,dh&placePath=%3Fentry%253Dbmp"
const CONTACT_URL = "https://tipsedu.channel.io"
const OBSERVATION_BOOKING_BODY = `[팁스영어수학학원] 청강 예약 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 예약을 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

수업 준비를 위해 예약 시간에 맞춰 방문해 주세요.
일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`
const OBSERVATION_REMINDER_BODY = `[팁스영어수학학원] 청강 일정 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 일정을 다시 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

예약 시간에 맞춰 방문해 주세요.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`
const OBSERVATION_VARIABLES = ["학생명", "과목", "수업명", "예약일시", "장소", "담당선생님"]
const OBSERVATION_TEMPLATE_BUTTONS = [{
  name: "학원 위치 보기",
  type: "WL",
  linkMobile: "https://#{학원위치URL}",
  linkPc: "https://#{학원위치URL}",
}, {
  name: "문의하기",
  type: "WL",
  linkMobile: CONTACT_URL,
  linkPc: CONTACT_URL,
}]
const OBSERVATION_CHECKSUMS = {
  observation_booking: {
    template: "459e5ef5c9544d2c2f57f7d2d9313d6e1b99dca651a4e3e5191bcef0b92c3bba",
    content: "0561bc1f68d1227ccd7b4f7cc326e46fab499ac1237c22b33b298bec1bf7b627",
    variables: "88cf2df2671accb00ab91958db121800a6717fcb68fafe158949a2d23df0858a",
    buttons: "ba19d26190401fc63f86d5b8c06e58a37b752c01789a22c7284a256a0a8375ee",
  },
  observation_reminder: {
    template: "3e5543bb5bfec79738d4be467aa97a0ac739614466f26fbb92b917e738e587b6",
    content: "fd2eac68d81cad4c5614916160cc1194c2cdacf4254a5b56df29df92e5f37117",
    variables: "88cf2df2671accb00ab91958db121800a6717fcb68fafe158949a2d23df0858a",
    buttons: "ba19d26190401fc63f86d5b8c06e58a37b752c01789a22c7284a256a0a8375ee",
  },
}

const ENV = Object.freeze({
  SOLAPI_API_KEY: "local-test-key",
  SOLAPI_API_SECRET: "local-test-secret",
  SOLAPI_KAKAO_PF_ID: "pf-local",
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "template-level",
  SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "template-visit",
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "template-reminder",
  SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "template-waiting",
  SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: "template-admission",
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "template-observation-booking",
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "template-observation-reminder",
})

test("catalog maps all seven kinds and preserves every legacy checksum receipt", () => {
  assert.equal(REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION, 6)
  assert.deepEqual(Object.keys(REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS), REGISTRATION_CUSTOMER_MESSAGE_KINDS)
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

  const catalog = createRegistrationCustomerMessageCatalog(ENV)
  assert.deepEqual(Object.keys(catalog.templates), REGISTRATION_CUSTOMER_MESSAGE_KINDS)
  for (const [kind, checksums] of Object.entries(frozenChecksums)) {
    assert.deepEqual(catalog.templates[kind].checksums, checksums, `${kind} checksum drift`)
    assert.equal("transportVariables" in catalog.templates[kind], false)
  }
})

test("observation templates pin exact copy, body and transport variables, and button patterns", () => {
  assert.deepEqual(OBSERVATION_LOCATION_URLS, {
    본관: MAIN_LOCATION_URL,
    별관: ANNEX_LOCATION_URL,
  })

  const catalog = createRegistrationCustomerMessageCatalog(ENV)
  for (const [kind, content] of [
    ["observation_booking", OBSERVATION_BOOKING_BODY],
    ["observation_reminder", OBSERVATION_REMINDER_BODY],
  ]) {
    const entry = catalog.templates[kind]
    assert.equal(entry.content, content)
    assert.deepEqual(entry.variables, OBSERVATION_VARIABLES)
    assert.deepEqual(entry.transportVariables, ["학원위치URL"])
    assert.deepEqual(entry.buttons, OBSERVATION_TEMPLATE_BUTTONS)
    assert.deepEqual(entry.send, { type: "ATA", disableSms: true })
    assert.equal(entry.templateConfigured, true)
    assert.deepEqual(entry.checksums, OBSERVATION_CHECKSUMS[kind])
  }
})

test("observation renderer derives the transport URL only from canonical campus", () => {
  for (const [kind, content] of [
    ["observation_booking", OBSERVATION_BOOKING_BODY],
    ["observation_reminder", OBSERVATION_REMINDER_BODY],
  ]) {
    for (const [campus, locationUrl] of [["본관", MAIN_LOCATION_URL], ["별관", ANNEX_LOCATION_URL]]) {
      const rendered = renderRegistrationCustomerMessage({
        kind,
        facts: {
          studentName: "김팁스 학생",
          subjects: ["영어"],
          className: "중2 영어 A반",
          scheduledAt: "2026-08-17T09:00:00.000Z",
          place: `${campus} 301호`,
          campus,
          teacherName: "홍길동",
        },
      })
      assert.equal(rendered.body, content
        .replace("#{학생명}", "김팁스")
        .replace("#{과목}", "영어")
        .replace("#{수업명}", "중2 영어 A반")
        .replace("#{예약일시}", "2026년 8월 17일 월요일 오후 6:00")
        .replace("#{장소}", `${campus} 301호`)
        .replace("#{담당선생님}", "홍길동"))
      assert.deepEqual(rendered.variables, {
        "#{학생명}": "김팁스",
        "#{과목}": "영어",
        "#{수업명}": "중2 영어 A반",
        "#{예약일시}": "2026년 8월 17일 월요일 오후 6:00",
        "#{장소}": `${campus} 301호`,
        "#{담당선생님}": "홍길동",
        "#{학원위치URL}": locationUrl.slice("https://".length),
      })
      assert.deepEqual(rendered.buttons, [{
        name: "학원 위치 보기",
        type: "WL",
        linkMobile: locationUrl,
        linkPc: locationUrl,
      }, OBSERVATION_TEMPLATE_BUTTONS[1]])
      assert.deepEqual(rendered.facts, {
        subjectLabel: "영어",
        scheduleLabel: "2026년 8월 17일 월요일 오후 6:00",
        placeLabel: `${campus} 301호`,
      })
      assert.equal(JSON.stringify(rendered.facts).includes("campus"), false)
      assert.equal(JSON.stringify(rendered.facts).includes("학원위치URL"), false)
    }
  }

  assert.throws(() => renderRegistrationCustomerMessage({
    kind: "observation_booking",
    facts: {
      studentName: "김팁스",
      subjects: ["영어"],
      className: "중2 영어 A반",
      scheduledAt: "2026-08-17T09:00:00.000Z",
      place: "본관 301호",
      campus: "제3관",
      teacherName: "홍길동",
    },
  }), /registration_customer_message_campus_invalid/)
})
