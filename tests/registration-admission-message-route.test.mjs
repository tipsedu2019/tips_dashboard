import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const routeUrl = new URL("../src/app/api/solapi/registration/route.ts", import.meta.url)
const legacyUrl = new URL("../src/app/api/solapi/registration/legacy.ts", import.meta.url)
const coreUrl = new URL("../src/app/api/solapi/registration/core.js", import.meta.url)

test("root compatibility route delegates masked admission GET and blocks POST before provider access", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const calls = []
  const envelope = {
    ok: true,
    messageKind: "admission_application",
    readiness: {
      runtimeReady: true,
      activationMode: "live",
      activationEligible: true,
      credentialsConfigured: true,
      pfConfigured: true,
      templateConfigured: true,
      templateVerified: true,
      verifiedAt: "2026-08-05T00:00:00.000Z",
      sourceValid: true,
      sendAllowed: false,
      blockers: ["duplicate_locked"],
    },
    history: [{
      messageId: "message-1",
      messageKind: "admission_application",
      recipientLast4: "5678",
      currentStatus: "accepted",
      confirmedAt: "2026-08-05T00:01:00.000Z",
      updatedAt: "2026-08-05T00:01:00.000Z",
      canCheck: false,
    }],
  }
  const handlers = createRegistrationAdmissionRouteHandlers({
    listAdmissionMessages: async (request) => {
      calls.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
      })
      return Response.json(envelope)
    },
  })

  const getResponse = await handlers.get(new Request("http://localhost/api/solapi/registration?taskId=task-1", {
    headers: { Authorization: "Bearer fixture" },
  }))
  assert.equal(getResponse.status, 200)
  assert.deepEqual(await getResponse.json(), envelope)
  assert.equal(calls.length, 1)
  const projectionUrl = new URL(calls[0].url)
  assert.equal(projectionUrl.pathname, "/api/solapi/registration/messages")
  assert.equal(projectionUrl.searchParams.get("messageKind"), "admission_application")
  assert.equal(projectionUrl.searchParams.get("sourceId"), "task-1")
  assert.equal(calls[0].authorization, "Bearer fixture")

  const missingTaskResponse = await handlers.get(new Request("http://localhost/api/solapi/registration"))
  assert.equal(missingTaskResponse.status, 400)
  assert.equal(calls.length, 1)

  const postResponse = await handlers.post(new Request("http://localhost/api/solapi/registration", {
    method: "POST",
    body: JSON.stringify({ taskId: "task-1", requestKey: "request-key-1234" }),
  }))
  assert.equal(postResponse.status, 409)
  assert.deepEqual(await postResponse.json(), {
    ok: false,
    code: "REGISTRATION_CUSTOMER_MESSAGE_PREVIEW_REQUIRED",
    error: "알림톡 미리보기에서 내용을 확인한 뒤 발송해 주세요.",
  })
  assert.equal(calls.length, 1, "POST must not reach the read projection or any provider")
})

test("legacy compatibility modules contain no provider reachability", async () => {
  const [route, legacy, core] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(legacyUrl, "utf8"),
    readFile(coreUrl, "utf8"),
  ])

  assert.match(route, /createProductionRegistrationCustomerMessageRouteHandlers/)
  assert.match(route, /listAdmissionMessages/)
  assert.match(legacy, /messageKind: "admission_application"/)
  assert.match(legacy, /sourceId: taskId/)
  assert.match(legacy, /REGISTRATION_CUSTOMER_MESSAGE_PREVIEW_REQUIRED/)
  assert.match(core, /handleLegacyRegistrationGet/)
  assert.match(core, /handleLegacyRegistrationPost/)
  assert.doesNotMatch(`${core}\n${legacy}`, /send-many\/detail|api\.solapi\.com|\bfetch\s*\(|createHmac|SOLAPI_API_/)
  assert.doesNotMatch(`${route}\n${core}\n${legacy}`, /claim_registration_admission_message|finalize_registration_admission_message|reconcile_registration_admission_message|release_registration_admission_message_retry/)
})
