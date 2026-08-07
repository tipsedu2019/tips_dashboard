import assert from "node:assert/strict"
import test from "node:test"

import {
  runRegistrationCustomerMessageRolloutAction,
} from "../src/features/tasks/registration-customer-message-rollout.ts"

const TASK_ID = "96000000-0000-4000-8000-000000000001"
const MESSAGE_ID = "96000000-0000-4000-8000-000000000002"
const REQUEST_KEYS = [
  "96000000-0000-4000-8000-000000000003",
  "96000000-0000-4000-8000-000000000004",
]

function clientWithCalls() {
  const calls = []
  return {
    calls,
    client: {
      async preflightTemplate(messageKind) {
        calls.push({ action: "preflight", messageKind })
        return { templateVerified: true }
      },
      async setActivation(input) {
        calls.push({ action: "activation", ...input })
        return { activationMode: input.mode }
      },
      async recordLiveTestReceipt(input) {
        calls.push({ action: "receipt", ...input })
        return { updatedAt: input.receivedAt }
      },
    },
  }
}

test("verification preparation preflights before scoping the synthetic registration", async () => {
  const { client, calls } = clientWithCalls()
  const requestKeys = [...REQUEST_KEYS]

  const result = await runRegistrationCustomerMessageRolloutAction(client, {
    action: "prepare_verification",
    messageKind: "visit_consultation_booking",
    verificationTaskId: TASK_ID,
  }, () => requestKeys.shift())

  assert.deepEqual(result, { activationMode: "verification" })
  assert.deepEqual(calls, [
    { action: "preflight", messageKind: "visit_consultation_booking" },
    {
      action: "activation",
      messageKind: "visit_consultation_booking",
      mode: "verification",
      verificationTaskId: TASK_ID,
      requestKey: REQUEST_KEYS[0],
    },
  ])
})

test("live transition records the user-confirmed receipt before activation", async () => {
  const { client, calls } = clientWithCalls()
  const requestKeys = [...REQUEST_KEYS]
  const receivedAt = "2026-08-07T00:02:00.000Z"

  const result = await runRegistrationCustomerMessageRolloutAction(client, {
    action: "record_receipt_and_live",
    messageKind: "admission_application",
    messageId: MESSAGE_ID,
    receivedAt,
  }, () => requestKeys.shift())

  assert.deepEqual(result, { activationMode: "live" })
  assert.deepEqual(calls, [
    {
      action: "receipt",
      messageKind: "admission_application",
      messageId: MESSAGE_ID,
      receivedAt,
      requestKey: REQUEST_KEYS[0],
    },
    {
      action: "activation",
      messageKind: "admission_application",
      mode: "live",
      requestKey: REQUEST_KEYS[1],
    },
  ])
})

test("turning a kind off performs no provider preflight or receipt mutation", async () => {
  const { client, calls } = clientWithCalls()

  const result = await runRegistrationCustomerMessageRolloutAction(client, {
    action: "set_off",
    messageKind: "waiting_notice",
  }, () => REQUEST_KEYS[0])

  assert.deepEqual(result, { activationMode: "off" })
  assert.deepEqual(calls, [{
    action: "activation",
    messageKind: "waiting_notice",
    mode: "off",
    requestKey: REQUEST_KEYS[0],
  }])
})
