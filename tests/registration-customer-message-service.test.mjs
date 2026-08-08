import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationCustomerMessageClient,
  createRegistrationCustomerMessageAdminClient,
} from "../src/features/tasks/registration-customer-message-service.ts"
import { getRegistrationCustomerMessageErrorMessage } from "../src/features/tasks/registration-customer-message-errors.ts"

const TASK_ID = "96000000-0000-4000-8000-000000000001"
const MESSAGE_ID = "96000000-0000-4000-8000-000000000002"
const REQUEST_KEY = "96000000-0000-4000-8000-000000000003"

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function withinTestDeadline(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("test_deadline_exceeded")), 100)
    }),
  ])
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

test("admin client stops waiting for stalled auth and provider preparation", async () => {
  let authFetchCalls = 0
  const stalledAuthClient = createRegistrationCustomerMessageAdminClient({
    adminTimeoutMs: 5,
    getAccessToken: async () => new Promise(() => {}),
    fetch: async () => {
      authFetchCalls += 1
      throw new Error("must_not_call")
    },
  })

  await assert.rejects(
    withinTestDeadline(stalledAuthClient.preflightTemplate("waiting_notice")),
    /registration_customer_message_admin_timeout/,
  )
  assert.equal(authFetchCalls, 0)

  let requestAborted = false
  const stalledRequestClient = createRegistrationCustomerMessageAdminClient({
    adminTimeoutMs: 5,
    getAccessToken: async () => "test-session-token",
    fetch: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        requestAborted = true
        reject(init.signal.reason)
      }, { once: true })
    }),
  })

  await assert.rejects(
    withinTestDeadline(stalledRequestClient.preflightTemplate("waiting_notice")),
    /registration_customer_message_admin_timeout/,
  )
  assert.equal(requestAborted, true)
})

test("customer message client preserves the server error code", async () => {
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "test-session-token",
    fetch: async () => new Response(JSON.stringify({
      ok: false,
      code: "registration_customer_message_confirmation_conflict",
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  })

  await assert.rejects(
    client.send({ previewId: MESSAGE_ID, requestKey: REQUEST_KEY }),
    /registration_customer_message_confirmation_conflict/,
  )
})

test("customer message errors use stable operator-facing Korean guidance", () => {
  const cases = [
    [
      "registration_customer_message_source_ineligible",
      "현재 이 예약을 진행하는 과목이 없습니다. 과목별 진행상태를 확인해 주세요.",
    ],
    [
      "registration_customer_message_admission_schedule_incomplete",
      "수업의 요일·시간, 선생님, 강의실, 첫 수업일을 모두 저장한 뒤 다시 시도해 주세요.",
    ],
    [
      "registration_customer_message_confirmation_conflict",
      "등록 수업 정보가 변경되었습니다. 새 미리보기를 확인해 주세요.",
    ],
    [
      "registration_customer_message_template_drift",
      "새 알림톡 템플릿 승인 후 발송할 수 있습니다.",
    ],
    [
      "registration_customer_message_body_too_long",
      "등록 수업 정보가 길어 알림톡을 만들 수 없습니다. 수업 정보를 확인해 주세요.",
    ],
  ]

  for (const [code, expected] of cases) {
    assert.equal(
      getRegistrationCustomerMessageErrorMessage(new Error(code), "fallback"),
      expected,
    )
    assert.equal(
      getRegistrationCustomerMessageErrorMessage(new Error(`request failed: ${code}`), "fallback"),
      expected,
    )
  }
  assert.equal(getRegistrationCustomerMessageErrorMessage({ message: cases[0][0] }, "fallback"), "fallback")
  assert.equal(getRegistrationCustomerMessageErrorMessage(new Error("raw provider detail"), "fallback"), "fallback")
})

test("customer message client never exposes non-code server errors", async () => {
  const responses = [
    new Response(JSON.stringify({ ok: false, error: "raw database detail" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
    new Response("upstream HTML error", {
      status: 502,
      headers: { "content-type": "text/html" },
    }),
  ]
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "test-session-token",
    fetch: async () => responses.shift(),
  })

  await assert.rejects(
    client.send({ previewId: MESSAGE_ID, requestKey: REQUEST_KEY }),
    /^Error: registration_customer_message_request_failed$/,
  )
  await assert.rejects(
    client.send({ previewId: MESSAGE_ID, requestKey: REQUEST_KEY }),
    /^Error: registration_customer_message_request_failed$/,
  )
})
