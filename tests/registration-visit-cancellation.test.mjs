import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { createRegistrationVisitCancellationService, parseRegistrationVisitCancellationPage } from "../src/features/tasks/registration-visit-cancellation-service.ts"
import { createRegistrationVisitCancellationGet } from "../src/features/tasks/server/registration-visit-cancellation-route.ts"
import { buildGoogleChatCardPayload, createGoogleChatProvider } from "../src/features/notifications/server/providers/google-chat-provider.ts"
import { requireRegisteredNotificationExternalAttempt } from "../src/features/notifications/server/external-attempt-gate.js"
import { recordLegacyNotificationDeliveryIntent } from "../src/features/notifications/server/legacy-delivery-intent.js"

const taskId = "9ac10000-0000-4000-8000-000000000001"
const sourceId = "9ac10000-0000-4000-8000-000000000002"
const requestId = "9ac10000-0000-4000-8000-000000000003"
const item = {
  appointmentId: taskId, notificationRevision: 2, sourceDeliveryId: sourceId,
  previewChecksum: "a".repeat(64), status: "ready", canSend: true,
  reason: "취소 전달 필요", scheduledAt: "2026-09-10T01:00:00Z",
  renderedTitle: "방문상담 취소", renderedBody: "이전에 안내한 영어 방문상담이 취소됐습니다.",
}

test("cancellation list is authenticated, bounded, read-only, and never cached", async () => {
  const calls = []
  const handler = createRegistrationVisitCancellationGet({ authenticate: async () => ({
    role: "staff", actorClient: { rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: { items: [item], page: 2, pageSize: 10, totalCount: 11 }, error: null }
    } },
  }) })
  const response = await handler(new Request(`https://local.invalid/?taskId=${taskId}&page=2`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json()).items[0].sourceDeliveryId, sourceId)
  assert.deepEqual(calls, [{ name: "list_registration_visit_cancellations_v1", args: { p_task_id: taskId, p_page: 2, p_page_size: 10 } }])
})

test("non-managers and malformed/duplicate selectors cannot reach the read RPC", async () => {
  for (const [role, query, expected] of [
    ["teacher", `taskId=${taskId}`, 403],
    ["admin", `taskId=${taskId}&taskId=${taskId}`, 400],
    ["admin", `taskId=${taskId}&page=0`, 400],
    ["admin", `taskId=${taskId}&pageSize=100`, 400],
    ["admin", `taskId=${taskId}&page=1e2`, 400],
    ["admin", `taskId=${taskId}&send=true`, 400],
  ]) {
    let calls = 0
    const handler = createRegistrationVisitCancellationGet({ authenticate: async () => ({ role,
      actorClient: { rpc: async () => { calls++; return { data: null, error: null } } },
    }) })
    assert.equal((await handler(new Request(`https://local.invalid/?${query}`))).status, expected)
    assert.equal(calls, 0)
  }
})

test("cancellation response contract rejects provider/private fields and inconsistent state", () => {
  const page = { items: [item], page: 1, pageSize: 10, totalCount: 1 }
  assert.equal(parseRegistrationVisitCancellationPage(page, 1, 10).items.length, 1)
  for (const invalid of [
    { ...page, providerToken: "secret" }, { ...page, page: 2 }, { ...page, totalCount: 0 },
    { ...page, items: [{ ...item, targetSnapshot: { connection_key: "private" } }] },
    { ...page, items: [{ ...item, status: "unknown", canSend: true }] },
    { ...page, items: [{ ...item, previewChecksum: "invalid" }] },
    { ...page, items: [{ ...item, renderedBody: { malicious: true } }] },
  ]) assert.throws(() => parseRegistrationVisitCancellationPage(invalid, 1, 10), /목록을 확인/)
})

test("read failures do not become an empty successful cancellation list", async () => {
  const handler = createRegistrationVisitCancellationGet({ authenticate: async () => ({
    role: "admin", actorClient: { rpc: async () => ({ data: null, error: new Error("database_offline") }) },
  }) })
  const response = await handler(new Request(`https://local.invalid/?taskId=${taskId}`))
  assert.equal(response.status, 503)
  assert.doesNotMatch(JSON.stringify(await response.json()), /database_offline/)
})

test("client sends only reviewed identity/checksum and never editable message or recipients", async () => {
  const calls = []
  const service = createRegistrationVisitCancellationService(async (url, init) => {
    calls.push({ url, init })
    return Response.json({ ok: true, sent: 1 })
  })
  await service.send(item, "token", requestId)
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    appointmentId: taskId, notificationRevision: 2, sourceDeliveryId: sourceId,
    previewChecksum: "a".repeat(64), requestKey: requestId, intent: "send_registration_visit_cancellation",
  })
  assert.equal(calls[0].url, "/api/registration/consultation-cancellation-notification")
  for (const status of ["unknown", "sent", "not_needed", "blocked"]) {
    await assert.rejects(service.send({ ...item, status }, "token", requestId), /현재 상태/)
  }
  assert.equal(calls.length, 1)
})

test("stale preview is surfaced as refresh-required instead of a transport retry", async () => {
  let calls = 0
  const service = createRegistrationVisitCancellationService(async () => {
    calls++
    return Response.json({ ok: false }, { status: 409 })
  })
  await assert.rejects(service.send(item, "token", requestId), /새로 확인/)
  assert.equal(calls, 1)
})

test("cancellation requests time out and late replies cannot silently retry a send", async () => {
  const calls = []; let resolveSend
  const service = createRegistrationVisitCancellationService((url, init) => {
    calls.push({ url, init })
    return new Promise((resolve) => { resolveSend = resolve })
  }, 5)
  await assert.rejects(service.list(taskId, "token"), (error) => error.code === "registration_visit_cancellation_list_timeout")
  assert.equal(calls[0].init.signal.aborted, true)
  await assert.rejects(service.send(item, "token", requestId), (error) => error.code === "registration_visit_cancellation_send_timeout")
  assert.equal(calls[1].init.signal.aborted, true)
  resolveSend(Response.json({ ok: true, sent: 1 }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 2)
})

test("cancellation external abort releases its caller even if transport ignores it", async () => {
  const controller = new AbortController(); let signal
  const service = createRegistrationVisitCancellationService((_url, init) => { signal = init.signal; return new Promise(() => {}) }, 1000)
  const pending = service.list(taskId, "token", 1, 10, controller.signal)
  controller.abort()
  await assert.rejects(pending, (error) => error.name === "AbortError")
  assert.equal(signal.aborted, true)
})

test("visit route supplies the workflow needed by the real Google Chat card builder", async () => {
  const source = await readFile(new URL("../src/app/api/registration/consultation-notification/route.ts", import.meta.url), "utf8")
  const send = source.slice(source.indexOf("const result = await provider.send"))
  assert.match(send, /workflow_key: "registration"/)
  assert.equal(buildGoogleChatCardPayload({
    workflow_key: "registration", rendered_title: item.renderedTitle, rendered_body: item.renderedBody,
    href: `/admin/registration?taskId=${taskId}`,
  }).ok, true)
})

test("scheduled and canceled visit dispatches keep HTTP 408 unknown and never rearm its receipt", async () => {
  const source = await readFile(new URL("../src/app/api/registration/consultation-notification/route.ts", import.meta.url), "utf8")
  const start = source.indexOf("async function finalizeGoogleChat(")
  const end = source.indexOf("export async function POST(", start)
  assert.ok(start >= 0 && end > start)
  const compiled = ts.transpileModule(`${source.slice(start, end)}\nmodule.exports = dispatchGoogleChat;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const eventKey of ["registration.visit_scheduled", "registration.visit_canceled"]) {
    const order = []
    let terminalOutcome = null
    let external = 0
    const sandboxModule = { exports: null }
    const client = { async rpc(name, args) {
      order.push(name)
      if (name === "materialize_registration_visit_legacy_google_chat_v1") return { deliveryId: sourceId }
      if (name === "begin_registration_visit_legacy_google_chat_v1") return {
        acquired: terminalOutcome !== "delivery_unknown" && terminalOutcome !== "sent",
        claim_id: requestId, dispatch_token: requestId, owner_generation: "0",
      }
      if (name === "record_legacy_notification_delivery_intent_v1") return { recorded: true }
      if (name === "register_notification_external_attempt_v1") return { allowed: true, attempt_id: sourceId }
      if (name === "finalize_registration_visit_legacy_google_chat_v1") { terminalOutcome = args.p_outcome; return null }
      throw new Error(`Unexpected RPC ${name}`)
    } }
    vm.runInNewContext(compiled, {
      module: sandboxModule, createGoogleChatProvider, requireRegisteredNotificationExternalAttempt,
      recordLegacyNotificationDeliveryIntent, AbortSignal,
      UUID: /^[0-9a-f-]{36}$/i,
      text: (value) => typeof value === "string" ? value.trim() : "",
      isRecord: (value) => !!value && typeof value === "object" && !Array.isArray(value),
      rpc: (rpcClient, name, args) => rpcClient.rpc(name, args),
      deterministicRequestId: () => requestId,
      readAdminWebhook: async () => "https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture",
      fetch: async (_url, init) => {
        order.push("HTTP")
        external++
        const card = JSON.parse(init.body).cardsV2[0].card
        assert.match(card.header.title, /방문/)
        assert.equal(card.sections[0].widgets[1].buttonList.buttons[0].onClick.openLink.url,
          `https://tipsedu.co.kr/admin/registration?taskId=${taskId}`)
        return new Response("", { status: 408 })
      },
    })
    const dispatch = sandboxModule.exports
    const plan = { appointmentId: taskId, notificationRevision: 2 }
    const target = { eventKey, ruleId: sourceId, targetGeneration: "0", targetKey: "connection:google_chat.management",
      templateChecksum: "a".repeat(64), renderedTitle: item.renderedTitle, renderedBody: item.renderedBody,
      href: `/admin/registration?taskId=${taskId}` }
    assert.equal(await dispatch(client, taskId, plan, target), "delivery_unknown")
    assert.equal(terminalOutcome, "delivery_unknown")
    assert.ok(order.indexOf("register_notification_external_attempt_v1") < order.indexOf("HTTP"))
    assert.equal(await dispatch(client, taskId, plan, target), "deduped")
    assert.equal(external, 1, `${eventKey} must not retry an ambiguous receipt`)
  }
})
