import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationCustomerMessageAdminClient,
} from "../src/features/tasks/registration-customer-message-service.ts"

const TASK_ID = "96000000-0000-4000-8000-000000000001"
const MESSAGE_ID = "96000000-0000-4000-8000-000000000002"
const REQUEST_KEY = "96000000-0000-4000-8000-000000000003"

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

test("admin client authenticates and sends the exact SOLAPI rollout actions", async () => {
  const requests = []
  const client = createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => "test-session-token",
    fetch: async (url, init) => {
      requests.push({ url, init })
      const action = JSON.parse(init.body)
      if (action.action === "preflight_template") {
        return response({
          messageKind: action.messageKind,
          templateVerified: true,
          verifiedAt: "2026-08-07T00:00:00.000Z",
        })
      }
      if (action.action === "set_activation") {
        return response({
          ok: true,
          messageKind: action.messageKind,
          activationMode: action.mode,
          updatedAt: "2026-08-07T00:01:00.000Z",
        })
      }
      return response({
        ok: true,
        messageKind: action.messageKind,
        updatedAt: action.receivedAt,
      })
    },
  })

  await client.preflightTemplate("level_test_booking")
  await client.setActivation({
    messageKind: "level_test_booking",
    mode: "verification",
    verificationTaskId: TASK_ID,
    requestKey: REQUEST_KEY,
  })
  await client.recordLiveTestReceipt({
    messageKind: "level_test_booking",
    messageId: MESSAGE_ID,
    receivedAt: "2026-08-07T00:02:00.000Z",
    requestKey: REQUEST_KEY,
  })

  assert.deepEqual(
    requests.map(({ url, init }) => ({
      url,
      method: init.method,
      authorization: init.headers.Authorization,
      contentType: init.headers["Content-Type"],
      body: JSON.parse(init.body),
    })),
    [
      {
        url: "/api/solapi/registration/admin",
        method: "POST",
        authorization: "Bearer test-session-token",
        contentType: "application/json",
        body: { action: "preflight_template", messageKind: "level_test_booking" },
      },
      {
        url: "/api/solapi/registration/admin",
        method: "POST",
        authorization: "Bearer test-session-token",
        contentType: "application/json",
        body: {
          action: "set_activation",
          messageKind: "level_test_booking",
          mode: "verification",
          verificationTaskId: TASK_ID,
          requestKey: REQUEST_KEY,
        },
      },
      {
        url: "/api/solapi/registration/admin",
        method: "POST",
        authorization: "Bearer test-session-token",
        contentType: "application/json",
        body: {
          action: "record_live_test_receipt",
          messageKind: "level_test_booking",
          messageId: MESSAGE_ID,
          receivedAt: "2026-08-07T00:02:00.000Z",
          requestKey: REQUEST_KEY,
        },
      },
    ],
  )
})

test("admin client refuses to call the rollout endpoint without a session", async () => {
  let calls = 0
  const client = createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => null,
    fetch: async () => {
      calls += 1
      throw new Error("must_not_call")
    },
  })

  await assert.rejects(
    client.preflightTemplate("waiting_notice"),
    /registration_customer_message_auth_required/,
  )
  assert.equal(calls, 0)
})
