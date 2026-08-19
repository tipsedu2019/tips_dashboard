import assert from "node:assert/strict"
import test from "node:test"

import * as contract from "../src/features/tasks/registration-customer-message-contract.ts"

const TASK_ID = "96000000-0000-4000-8000-000000000005"

test("bundle contract exposes only the approved message kinds and states", () => {
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_KINDS, [
    "level_test_booking_bundle",
    "visit_consultation_booking_bundle",
    "observation_booking_bundle",
    "level_test_reminder_bundle",
    "visit_consultation_reminder_bundle",
    "observation_reminder_bundle",
  ])
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_STATES, [
    "scheduled",
    "processing",
    "sent",
    "unknown",
    "failed_hold",
    "not_sent",
    "canceled",
  ])
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS, [
    "level_test_booking",
    "visit_consultation_booking",
    "appointment_reminder",
    "waiting_notice",
    "admission_application",
    "observation_booking",
    "observation_reminder",
  ])
})

test("bundle target keeps the task ID in the existing browser-safe target envelope", () => {
  assert.deepEqual(
    contract.parseRegistrationCustomerMessageTarget({
      messageKind: "level_test_booking_bundle",
      sourceId: TASK_ID,
    }),
    { messageKind: "level_test_booking_bundle", sourceId: TASK_ID },
  )
})

test("public bundle reservation facts allow only display-safe exact keys", () => {
  const safe = {
    facts: {
      subjectLabel: "영어 · 수학",
      reservations: [{
        subjectLabel: "영어",
        scheduleLabel: "2026년 8월 21일 금요일 오후 2:00",
        placeLabel: "본관",
        className: null,
        teacherLabel: null,
      }],
    },
  }
  assert.equal(contract.assertRegistrationCustomerMessagePublicPayload(safe), safe)

  for (const forbidden of ["sourceId", "revision", "recipientHash", "phone"]) {
    assert.throws(
      () => contract.assertRegistrationCustomerMessagePublicPayload({
        facts: {
          ...safe.facts,
          reservations: [{ ...safe.facts.reservations[0], [forbidden]: "forbidden" }],
        },
      }),
      /registration_customer_message_public_payload_forbidden_field/u,
    )
  }
})
