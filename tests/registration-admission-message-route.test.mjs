import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const routeUrl = new URL("../src/app/api/solapi/registration/route.ts", import.meta.url)
const legacyUrl = new URL("../src/app/api/solapi/registration/legacy.ts", import.meta.url)
const coreUrl = new URL("../src/app/api/solapi/registration/core.js", import.meta.url)

test("registration admission route gates every branch by readiness and isolates exact legacy DML", async () => {
  const [route, legacy, core] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(legacyUrl, "utf8"),
    readFile(coreUrl, "utf8"),
  ])
  const ready = `${route}\n${core}`

  assert.match(route, /createRegistrationRuntimeProbe/)
  assert.match(ready, /runtime\.mode === "maintenance"[\s\S]*?REGISTRATION_MIGRATION_IN_PROGRESS/)
  assert.match(ready, /runtime\.mode === "legacy"[\s\S]*?handleLegacyRegistrationGet/)
  assert.match(ready, /runtime\.mode === "legacy"[\s\S]*?handleLegacyRegistrationPost/)
  assert.match(route, /getRegistrationAdmissionApplicationState/)
  assert.match(route, /from "@\/features\/tasks\/registration-track-model"/)
  assert.match(route, /recipient_last4/)
  assert.match(route, /currentRecipient\.endsWith\(frozenRecipientLast4\)/)
  assert.match(route, /loadLegacyHandlers:\s*\(\)\s*=>\s*import\("\.\/legacy"\)/)
  assert.doesNotMatch(route, /^import .*legacy/m)
  assert.doesNotMatch(route, /canSendRegistrationAdmissionMessage/)
  assert.doesNotMatch(ready, /ops_registration_messages[\s\S]{0,180}\.(?:insert|update|delete)\(/)
  assert.doesNotMatch(ready, /ops_registration_details[\s\S]{0,180}\.update\(/)
  assert.doesNotMatch(ready, /ops_task_events[\s\S]{0,180}\.insert\(/)
  assert.match(legacy, /canSendRegistrationAdmissionMessage/)
  assert.match(legacy, /ops_registration_messages/)
  assert.match(legacy, /ops_registration_details/)
  assert.match(legacy, /ops_task_events/)
})

test("ready admission route is claim-first and owns provider finalization and recovery branches", async () => {
  const [route, core] = await Promise.all([readFile(routeUrl, "utf8"), readFile(coreUrl, "utf8")])
  const ready = `${route}\n${core}`

  const claimIndex = ready.indexOf("claim_registration_admission_message")
  const sendIndex = ready.indexOf("SOLAPI_SEND_URL")
  assert.ok(claimIndex !== -1 && sendIndex !== -1 && claimIndex < sendIndex)
  assert.match(ready, /finalize_registration_admission_message/)
  assert.match(ready, /serviceClient\.rpc\([\s\S]*?finalize_registration_admission_message/)
  assert.match(ready, /showMessageList:\s*true/)
  assert.match(ready, /customFields:\s*\{\s*registrationRequestKey:/)
  assert.match(ready, /SOLAPI_LIST_URL/)
  assert.match(ready, /action === "check"/)
  assert.match(ready, /15 \* 60 \* 1000/)
  assert.match(ready, /customFields[\s\S]*?registrationRequestKey/)
  assert.match(ready, /action === "reconcile"/)
  assert.match(ready, /reconcile_registration_admission_message/)
  assert.match(ready, /action === "release"/)
  assert.match(ready, /release_registration_admission_message_retry/)
  assert.match(ready, /mark_registration_admission_notice_sent/)
})

function readyCase(overrides = {}) {
  return {
    task: { id: "task-1", type: "registration", student_name: "김다미" },
    detail: { admission_notice_sent: false, parent_phone: "010-1234-5678" },
    tracks: [{ id: "track-1", status: "enrollment_decided" }],
    enrollments: [],
    activeMessage: null,
    frozenRecipient: "01012345678",
    ...overrides,
  }
}

function makeDependencies(overrides = {}) {
  const calls = []
  return {
    calls,
    authenticate: async () => ({ userId: "admin-1", role: "admin", client: {}, serviceClient: {} }),
    probeRuntime: async () => ({ mode: "ready", version: 1 }),
    loadLegacyHandlers: async () => {
      calls.push("load-legacy")
      return {
        handleLegacyRegistrationGet: async () => { calls.push("legacy-get"); return Response.json({ legacy: true }) },
        handleLegacyRegistrationPost: async () => { calls.push("legacy-post"); return Response.json({ legacy: true }) },
      }
    },
    loadReadyCase: async () => readyCase(),
    getAdmissionState: () => ({ eligible: true, delivered: false, syncNeeded: false, blocked: false, canSend: true }),
    claim: async () => { calls.push("claim"); return {} },
    finalize: async (_serviceClient, input) => {
      calls.push(`finalize:${input.result}`)
      return {
        taskId: "task-1", messageId: "message-1", messageRequestKey: "request-key-1234",
        applied: true, currentStatus: input.result, claimActive: input.result !== "failed",
        requiresAdmissionMark: input.result === "accepted", retryRequiresNewMessageKey: input.result === "failed",
      }
    },
    mark: async () => { calls.push("mark"); return { admissionNoticeSent: true, applied: true } },
    reconcile: async () => { calls.push("reconcile"); return { taskId: "task-1", messageId: "message-1", messageRequestKey: "request-key-1234", nextStatus: "accepted", claimActive: true, requiresAdmissionMark: true } },
    release: async () => { calls.push("release"); return { taskId: "task-1", messageId: "message-1", status: "failed", claimActive: false, retryRequiresNewMessageKey: true } },
    fetch: async () => { calls.push("fetch"); return Response.json({}) },
    getConfiguration: () => ({ configured: true, missing: [], apiKey: "api", apiSecret: "secret", pfId: "pf", templateId: "template" }),
    createAuthorization: () => "HMAC test",
    now: () => new Date("2026-07-13T03:00:00.000Z"),
    ...overrides,
  }
}

function postRequest(body) {
  return new Request("http://localhost/api/solapi/registration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

test("maintenance stops GET and POST before legacy, claim, or provider work", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({ probeRuntime: async () => ({ mode: "maintenance", version: 0 }) })
  const handlers = createRegistrationAdmissionRouteHandlers(deps)

  const getResponse = await handlers.get(new Request("http://localhost/api/solapi/registration?taskId=task-1"))
  const postResponse = await handlers.post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))
  assert.equal(getResponse.status, 503)
  assert.equal(postResponse.status, 503)
  assert.equal((await getResponse.json()).code, "REGISTRATION_MIGRATION_IN_PROGRESS")
  assert.deepEqual(deps.calls, [])
})

test("exact legacy mode delegates while ready GET uses child state without provider secrets", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const legacyDeps = makeDependencies({ probeRuntime: async () => ({ mode: "legacy", version: 0 }) })
  const legacyHandlers = createRegistrationAdmissionRouteHandlers(legacyDeps)
  assert.equal((await (await legacyHandlers.get(new Request("http://localhost/?taskId=task-1"))).json()).legacy, true)
  assert.equal((await (await legacyHandlers.post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))).json()).legacy, true)
  assert.deepEqual(legacyDeps.calls, ["load-legacy", "legacy-get", "load-legacy", "legacy-post"])

  const readyDeps = makeDependencies({
    loadReadyCase: async () => readyCase({
      activeMessage: { id: "message-1", status: "failed", claim_active: true, updated_at: "2026-07-13T02:00:00.000Z", provider_message_id: "secret" },
    }),
    getAdmissionState: (input) => ({ eligible: input.tracks.length === 1, delivered: false, syncNeeded: false, blocked: true, canSend: false }),
  })
  const response = await createRegistrationAdmissionRouteHandlers(readyDeps)
    .get(new Request("http://localhost/?taskId=task-1"))
  const payload = await response.json()
  assert.equal(payload.admissionEligible, true)
  assert.equal(payload.admissionApplicationMessageStatus, "failed_hold")
  assert.equal(payload.admissionApplicationMessageClaimActive, true)
  assert.equal("providerMessageId" in payload, false)
  assert.equal("recipient" in payload, false)
  assert.deepEqual(readyDeps.calls, [])
})

test("ready send claims first, freezes the request key in SOLAPI, finalizes, then marks", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  let sentBody = null
  const deps = makeDependencies({
    claim: async () => {
      deps.calls.push("claim")
      return {
        taskId: "task-1", messageId: "message-1", messageRequestKey: "request-key-1234",
        claimStatus: "pending", claimActive: true, shouldSend: true,
        retryRequiresNewMessageKey: false, studentName: "김다미", parentPhone: "01012345678", commonRevision: 1,
      }
    },
    fetch: async (_url, init) => {
      deps.calls.push("fetch")
      sentBody = JSON.parse(init.body)
      return Response.json({ groupInfo: { groupId: "group-1" }, messageList: { one: { messageId: "provider-1", statusCode: "2000" } } })
    },
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.currentStatus, "accepted")
  assert.deepEqual(deps.calls, ["claim", "fetch", "finalize:accepted", "mark"])
  assert.equal(sentBody.showMessageList, true)
  assert.deepEqual(sentBody.messages[0].customFields, { registrationRequestKey: "request-key-1234" })
})

test("accepted claim replay repairs the mark without a second provider call", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({
    claim: async () => {
      deps.calls.push("claim")
      return {
        taskId: "task-1", messageId: "message-1", messageRequestKey: "request-key-1234",
        claimStatus: "accepted", claimActive: true, shouldSend: false, retryRequiresNewMessageKey: false,
      }
    },
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))
  assert.equal(response.status, 200)
  assert.deepEqual(deps.calls, ["claim", "mark"])
})

test("pending check enforces fifteen minutes and accepts only the exact custom request key", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const tooEarly = makeDependencies({
    loadReadyCase: async () => readyCase({ activeMessage: { id: "message-1", status: "pending", claim_active: true, request_key: "request-key-1234", updated_at: "2026-07-13T02:50:00.000Z" } }),
  })
  const earlyResponse = await createRegistrationAdmissionRouteHandlers(tooEarly)
    .post(postRequest({ action: "check", taskId: "task-1", messageId: "message-1" }))
  assert.equal(earlyResponse.status, 409)
  assert.deepEqual(tooEarly.calls, [])

  let lookupUrl = null
  let providerResult = null
  const mature = makeDependencies({
    loadReadyCase: async () => readyCase({ activeMessage: {
      id: "message-1", status: "pending", claim_active: true,
      request_key: "request-key-1234", updated_at: "2026-07-13T02:30:00.000Z",
      provider_message_id: "provider-1", provider_group_id: "group-1",
    } }),
    fetch: async (url) => {
      mature.calls.push("fetch")
      lookupUrl = new URL(url)
      return Response.json({ messageList: {
        wrong: { messageId: "wrong", customFields: { registrationRequestKey: "another-key" } },
        exact: { messageId: "provider-1", groupId: "group-1", statusCode: "2000", reason: "접수", customFields: { registrationRequestKey: "request-key-1234" } },
      } })
    },
    finalize: async (_serviceClient, input) => {
      mature.calls.push(`finalize:${input.result}`)
      providerResult = input.providerResult
      return {
        taskId: "task-1", messageId: "message-1", messageRequestKey: "request-key-1234",
        currentStatus: input.result, claimActive: true, retryRequiresNewMessageKey: false,
      }
    },
  })
  const matureResponse = await createRegistrationAdmissionRouteHandlers(mature)
    .post(postRequest({ action: "check", taskId: "task-1", messageId: "message-1" }))
  assert.equal(matureResponse.status, 200)
  assert.deepEqual(mature.calls, ["fetch", "finalize:accepted", "mark"])
  assert.equal(lookupUrl.searchParams.get("criteria"), "messageId,groupId")
  assert.equal(lookupUrl.searchParams.get("cond"), "eq,eq")
  assert.equal(lookupUrl.searchParams.get("value"), "provider-1,group-1")
  assert.equal(lookupUrl.searchParams.has("to"), false)
  assert.equal(providerResult.providerStatusMessage, "접수")
})

test("pending check fallback uses the active claim's frozen recipient and tight request window", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  let lookupUrl = null
  const deps = makeDependencies({
    loadReadyCase: async () => readyCase({
      detail: { admission_notice_sent: false, parent_phone: "010-9999-9999" },
      frozenRecipient: "01012345678",
      activeMessage: {
        id: "message-1", status: "pending", claim_active: true,
        request_key: "request-key-1234", created_at: "2026-07-13T02:20:00.000Z",
        updated_at: "2026-07-13T02:30:00.000Z",
      },
    }),
    fetch: async (url) => {
      deps.calls.push("fetch")
      lookupUrl = new URL(url)
      return Response.json({ messageList: {} })
    },
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ action: "check", taskId: "task-1", messageId: "message-1" }))
  assert.equal(response.status, 200)
  assert.equal(lookupUrl.searchParams.get("to"), "01012345678")
  assert.equal(lookupUrl.searchParams.get("startDate"), "2026-07-13T02:15:00.000Z")
  assert.equal(lookupUrl.searchParams.get("endDate"), "2026-07-13T02:35:00.000Z")
  assert.equal(lookupUrl.searchParams.get("dateType"), "CREATED")
  assert.deepEqual(deps.calls, ["fetch", "finalize:unknown"])
})

test("pending check fails closed when the active claim recipient cannot be verified", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({
    loadReadyCase: async () => readyCase({
      frozenRecipient: "",
      activeMessage: {
        id: "message-1", status: "pending", claim_active: true,
        request_key: "request-key-1234", created_at: "2026-07-13T02:20:00.000Z",
        updated_at: "2026-07-13T02:30:00.000Z",
      },
    }),
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ action: "check", taskId: "task-1", messageId: "message-1" }))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, "SOLAPI_FROZEN_RECIPIENT_UNAVAILABLE")
  assert.deepEqual(deps.calls, [])
})

test("reconcile and release never claim, send, or perform provider lookup", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const reconcileDeps = makeDependencies()
  const reconcileResponse = await createRegistrationAdmissionRouteHandlers(reconcileDeps).post(postRequest({
    action: "reconcile", taskId: "task-1", messageId: "message-1", resolution: "accepted",
    providerEvidence: { providerMessageId: "provider-1", observedState: "accepted" },
    reason: "SOLAPI 접수 확인", requestKey: "reconcile-key-1234",
  }))
  assert.equal(reconcileResponse.status, 200)
  assert.deepEqual(reconcileDeps.calls, ["reconcile", "mark"])

  const releaseDeps = makeDependencies()
  const releaseResponse = await createRegistrationAdmissionRouteHandlers(releaseDeps).post(postRequest({
    action: "release", taskId: "task-1", messageId: "message-1",
    providerEvidence: { providerMessageId: "provider-1", observedState: "failed" },
    reason: "미접수 확인 후 재발송", requestKey: "release-key-1234",
  }))
  assert.equal(releaseResponse.status, 200)
  assert.deepEqual(releaseDeps.calls, ["release"])
})

test("unexpected readiness errors fail closed before legacy or provider work", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({ probeRuntime: async () => { throw new Error("schema cache timeout") } })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, "REGISTRATION_RUNTIME_UNAVAILABLE")
  assert.deepEqual(deps.calls, [])
})

test("a provider 5xx is ambiguous and finalizes unknown instead of failed", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({
    claim: async () => {
      deps.calls.push("claim")
      return {
        taskId: "task-1", messageId: "message-1", messageRequestKey: "request-key-1234",
        claimStatus: "pending", claimActive: true, shouldSend: true,
        retryRequiresNewMessageKey: false, studentName: "김다미", parentPhone: "01012345678", commonRevision: 1,
      }
    },
    fetch: async () => {
      deps.calls.push("fetch")
      return Response.json({ errorMessage: "provider unavailable" }, { status: 503 })
    },
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))
  assert.equal(response.status, 502)
  assert.equal((await response.json()).currentStatus, "unknown")
  assert.deepEqual(deps.calls, ["claim", "fetch", "finalize:unknown"])
})

test("successful lookup without an exact request-key match finalizes unknown", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({
    loadReadyCase: async () => readyCase({
      activeMessage: {
        id: "message-1", status: "pending", claim_active: true,
        request_key: "request-key-1234", updated_at: "2026-07-13T02:30:00.000Z",
      },
    }),
    fetch: async () => {
      deps.calls.push("fetch")
      return Response.json({ messageList: {
        other: { messageId: "provider-2", customFields: { registrationRequestKey: "other-key-1234" } },
      } })
    },
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ action: "check", taskId: "task-1", messageId: "message-1" }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).currentStatus, "unknown")
  assert.deepEqual(deps.calls, ["fetch", "finalize:unknown"])
})

test("malformed reconciliation evidence is rejected without any mutation or fetch", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies()
  const response = await createRegistrationAdmissionRouteHandlers(deps).post(postRequest({
    action: "reconcile", messageId: "message-1", resolution: "accepted",
    providerEvidence: { providerMessageId: "provider-1", observedState: "accepted", unexpected: "field" },
    reason: "SOLAPI 접수 확인", requestKey: "reconcile-key-1234",
  }))
  assert.equal(response.status, 400)
  assert.deepEqual(deps.calls, [])
})

test("new-send eligibility remains authoritative in claim and rejects before fetch", async () => {
  const { createRegistrationAdmissionRouteHandlers } = await import(coreUrl)
  const deps = makeDependencies({
    claim: async () => {
      deps.calls.push("claim")
      throw new Error("registration_admission_not_eligible")
    },
  })
  const response = await createRegistrationAdmissionRouteHandlers(deps)
    .post(postRequest({ taskId: "task-1", requestKey: "request-key-1234" }))
  assert.equal(response.status, 409)
  assert.deepEqual(deps.calls, ["claim"])
})
