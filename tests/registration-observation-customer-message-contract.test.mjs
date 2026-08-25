import assert from "node:assert/strict"
import test from "node:test"

import {
  REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS,
  assertRegistrationCustomerMessagePublicPayload,
  parseRegistrationCustomerMessageTarget,
} from "../src/features/tasks/registration-customer-message-contract.ts"

const SOURCE_ID = "97000000-0000-4000-8000-000000000001"

test("customer-message contract exposes both closed observation kinds", () => {
  assert.deepEqual(REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS, [
    "level_test_booking",
    "visit_consultation_booking",
    "appointment_reminder",
    "waiting_notice",
    "admission_application",
    "observation_booking",
    "observation_reminder",
  ])

  for (const messageKind of ["observation_booking", "observation_reminder"]) {
    assert.deepEqual(
      parseRegistrationCustomerMessageTarget({ messageKind, sourceId: SOURCE_ID }),
      { messageKind, sourceId: SOURCE_ID },
    )
  }
})

test("browser target parsing rejects canonical campus and transport location variables", () => {
  for (const forbidden of [
    { campus: "본관" },
    { 학원위치URL: "https://map.naver.com/forbidden-browser-input" },
  ]) {
    assert.equal(parseRegistrationCustomerMessageTarget({
      messageKind: "observation_booking",
      sourceId: SOURCE_ID,
      ...forbidden,
    }), null)
  }
})

test("public payloads expose only parsed button metadata", () => {
  const publicButtons = [{ name: "학원 위치 보기", type: "WL", host: "map.naver.com" }]
  assert.strictEqual(
    assertRegistrationCustomerMessagePublicPayload(publicButtons),
    publicButtons,
  )

  for (const forbidden of [
    { campus: "본관" },
    { 학원위치URL: "https://map.naver.com/private" },
    { linkMobile: "https://map.naver.com/private" },
    { linkPc: "https://map.naver.com/private" },
  ]) {
    assert.throws(
      () => assertRegistrationCustomerMessagePublicPayload([{ ...publicButtons[0], ...forbidden }]),
      /registration_customer_message_public_payload_forbidden_field/,
    )
  }
})
