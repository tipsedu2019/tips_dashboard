import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { act } from "react"

import { modules, setup, button, row, id, stamp } from "./makeup-numbered-harness.mjs"
import { buildNotificationAppLink } from "../../src/features/notifications/server/notification-app-deep-link.ts"
import { createGoogleChatProvider } from "../../src/features/notifications/server/providers/google-chat-provider.ts"
import { requireRegisteredNotificationExternalAttempt } from "../../src/features/notifications/server/external-attempt-gate.js"
import { renderLegacyMakeupSnapshot } from "../../src/features/notifications/server/legacy-makeup-render-snapshot.ts"
import { fixture as canonicalFixture, want as canonicalWant } from "./makeup-canonical-render-fixture.mjs"
import { recordLegacyNotificationDeliveryIntent } from "../../src/features/notifications/server/legacy-delivery-intent.js"

const require = createRequire(import.meta.url)
const WEBHOOK = "https://chat.googleapis.com/v1/spaces/TESTMAKEUPSPACE/messages?key=test-only&token=test-only"
const WARNING = "알림 후처리를 완료하지 못했습니다. 저장은 완료되어 다시 저장할 필요가 없습니다."
const createInput = { requestKind: "cancel_only", classId: id(600), reason: "휴강 사유", cancelDate: "2026-09-01", originalLessonSessionId: id(601), makeupSlots: [], makeupClassroom: "", approverTeacherCatalogId: id(702) }

// Resolve the final definition from the ordered migration chain. This fixture
// evaluates its literal href expression only; it never runs SQL or a database.
function finalSqlHref(requestId) {
  let definition, migration
  for (const name of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    const source = readFileSync(`supabase/migrations/${name}`, "utf8")
    const marker = /create\s+or\s+replace\s+function\s+public\.get_makeup_legacy_dispatch_plan_v1\s*\(/giu
    for (const match of source.matchAll(marker)) {
      const end = source.indexOf("$$;", match.index)
      assert.notEqual(end, -1)
      definition = source.slice(match.index, end + 3)
      migration = name
    }
  }
  assert.equal(migration, "20260716192000_notification_makeup_adapter.sql")
  assert.match(definition, /event_row\.workflow_key = 'makeup_requests'/u)
  const expression = /'href',\s*'([^']+)'\s*\|\|\s*request_row\.id::text/u.exec(definition)
  assert.ok(expression, "the representative href must come from the final SQL producer")
  return `${expression[1]}${requestId}`
}

function item(patch = {}) {
  return { eventId: id(1), eventKey: "makeup.submitted", occurrenceKey: id(2), ruleId: id(3), ruleRevision: "1", templateId: id(4), templateChecksum: "a".repeat(64), channelKey: "google_chat", audienceKey: "management_team", targetGeneration: "0", targetKind: "connection", targetKey: "connection:google_chat.management", targetProfileId: null, connectionKey: "google_chat.management", targetSnapshot: { connection_key: "google_chat.management" }, renderedTitle: "휴보강 신청", renderedBody: "고1 영어 휴강 신청", href: finalSqlHref(id(900)), scheduledFor: stamp, ...patch }
}

function routeHarness(options = {}) {
  const rpcCalls = [], requests = [], providerContexts = [], warnings = [], pushContexts = []
  const parentBodies = new Map()
  const materialized = { deliveryId: id(5), acquired: true, recoveredUnknown: false, claimId: id(6), ownerGeneration: "0", dispatchToken: id(7), replayOutcome: "", ...options.materialized }
  const actorClient = {
    auth: { async getUser() { return { data: { user: options.unauthorized ? null : { id: id(804) } }, error: null } } },
    from(table) {
      assert.equal(table, "profiles")
      return { select() { return this }, eq() { return this }, async single() { return { data: { role: options.role || "admin" }, error: null } } }
    },
  }
  const serverClient = {
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      if (name === "get_makeup_legacy_dispatch_plan_v1") return { data: { items: options.items || [item(options.item)] }, error: options.planError || null }
      if (name === "get_notification_render_snapshot_v1") {
        const planItem = (options.items || [item(options.item)]).find(value => value.ruleId === args.p_rule_id)
        const canonical = canonicalFixture(planItem.eventKey)
        const snapshot = { ...canonical.snapshot,
          event_id: planItem.eventId, event_key: planItem.eventKey, occurrence_key: planItem.occurrenceKey,
          source_id: id(2), rule_id: planItem.ruleId, rule_revision: planItem.ruleRevision,
          template_id: planItem.templateId, channel_key: planItem.channelKey, audience_key: planItem.audienceKey,
          occurred_at: planItem.scheduledFor,
          ...(options.canonical ? {} : {allowed_variables: [{key:"class_name",token:"수업",piiClass:"class_name"}]}),
          ...options.snapshot,
        }
        return { data: snapshot, error: options.snapshotError || null }
      }
      if (["materialize_makeup_legacy_google_chat_v1", "materialize_makeup_legacy_google_chat_v2"].includes(name)) return { data: materialized, error: options.materializeError || null }
      if (name === "materialize_makeup_legacy_in_app_v1") {
        const deliveryId = id(50 + parentBodies.size)
        const frozen = options.items.find(value => value.targetProfileId === args.p_profile_id)
        parentBodies.set(deliveryId, {title:frozen.renderedTitle,body:frozen.renderedBody})
        return {data:{deliveryId,acquired:true,projectionCommitted:true},error:null}
      }
      if (name === "prepare_makeup_legacy_web_push_v1") {
        const parent = parentBodies.get(args.p_parent_delivery_id)
        assert.ok(parent, "push must start from a committed parent")
        return {data:{items:[{deliveryId:id(80+parentBodies.size),acquired:true,recoveredUnknown:false,replayOutcome:"",claimId:id(81),ownerGeneration:"0",dispatchToken:id(82),templateChecksum:"a".repeat(64),subscription:{endpoint:"https://fcm.googleapis.com/fcm/send/synthetic-only",keys:{p256dh:"synthetic-only",auth:"synthetic-only"}},renderedTitle:parent.title,renderedBody:parent.body,href:finalSqlHref(id(900))}]},error:null}
      }
      if (name === "finalize_makeup_legacy_web_push_v1") return {data:{outcome:args.p_outcome},error:null}
      if (name === "record_legacy_notification_delivery_intent_v1") return { data: { recorded: true }, error: null }
      if (name === "register_notification_external_attempt_v1") return { data: options.deniedAttempt ? { allowed: false } : { allowed: true, attempt_id: id(8) }, error: null }
      if (name === "finalize_makeup_legacy_google_chat_v1") return { data: { outcome: args.p_outcome }, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
  const mocks = {
    "node:crypto": require("node:crypto"),
    "@supabase/supabase-js": { createClient(_url, key) { return key === "test-anon" ? actorClient : serverClient } },
    "@/features/notifications/server/legacy-google-chat-connection": { async readLegacyGoogleChatWebhookUrl() { if (options.connectionError) throw new Error("mock connection unavailable"); return WEBHOOK } },
    "@/features/notifications/server/external-attempt-gate": { requireRegisteredNotificationExternalAttempt },
    "@/features/notifications/server/legacy-makeup-render-snapshot": { renderLegacyMakeupSnapshot },
    "@/features/notifications/server/legacy-delivery-intent": { recordLegacyNotificationDeliveryIntent },
    "@/features/notifications/server/providers/google-chat-provider": { createGoogleChatProvider(input) { const provider = createGoogleChatProvider(input); return { send(context) { providerContexts.push(context); return provider.send(context) } } } },
    "@/features/notifications/server/providers/web-push-provider": { createWebPushProvider() { assert.equal(options.inApp,true); return {async send(context){pushContexts.push(context); return {status:"sent",providerResponseCode:"201"}}} } },
    "web-push": {default:{setVapidDetails(){assert.equal(options.inApp,true)},sendNotification(){throw Error("Network transport is forbidden in this fixture")}}},
  }
  const source = ts.transpileModule(readFileSync("src/app/api/notifications/legacy/makeup/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const runtime = { exports: {} }
  vm.runInNewContext(source, {
    module: runtime, exports: runtime.exports,
    require(specifier) { assert.ok(specifier in mocks, `Unexpected module: ${specifier}`); return mocks[specifier] },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", ...(options.inApp ? {NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY:"synthetic-only",WEB_PUSH_PRIVATE_KEY:"synthetic-only",WEB_PUSH_CONTACT:"mailto:fixture@example.invalid"} : {}) } },
    Response, AbortSignal, Buffer,
    console: { warn(...args) { warnings.push(args) } },
    async fetch(url, init) {
      assert.equal(url, WEBHOOK, "only the synthetic allowlisted provider transport is permitted")
      assert.equal(init.method, "POST")
      assert.ok(init.signal)
      requests.push({ url, payload: JSON.parse(init.body) })
      return new Response(JSON.stringify({ name: "spaces/TESTMAKEUPSPACE/messages/mock-message" }), { status: options.providerStatus || 200 })
    },
  }, { filename: "actual-legacy-makeup-route.ts" })
  return { rpcCalls, requests, providerContexts, warnings, pushContexts, parentBodies, post(body = { sourceEventId: id(2) }) { return runtime.exports.POST(new Request("https://test.invalid/api/notifications/legacy/makeup", { method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify(body) })) } }
}

test("final SQL legacy href reaches the actual POST route and actual card provider with its workflow", async () => {
  const harness = routeHarness()
  const response = await harness.post()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, sent: 1, deduped: 0, failed: 0 })
  assert.equal(harness.providerContexts[0].workflow_key, "makeup_requests")
  assert.equal(harness.providerContexts[0].href, finalSqlHref(id(900)), "durable legacy intent retains the original producer href")
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].payload.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].onClick.openLink.url, `https://tipsedu.co.kr/admin/makeup-requests?request=${id(900)}`)
  assert.deepEqual(harness.rpcCalls.map((call) => call.name), ["get_makeup_legacy_dispatch_plan_v1", "get_notification_render_snapshot_v1", "materialize_makeup_legacy_google_chat_v1", "record_legacy_notification_delivery_intent_v1", "register_notification_external_attempt_v1", "finalize_makeup_legacy_google_chat_v1"])
  const intent = harness.rpcCalls.find((call) => call.name === "record_legacy_notification_delivery_intent_v1")
  const expectedHash = createHash("sha256").update(JSON.stringify({ title: "휴보강 신청", body: "고1 영어 휴강 신청", href: finalSqlHref(id(900)) })).digest("hex")
  assert.equal(intent.args.p_normalized_rendered_hash, expectedHash)
  assert.equal(harness.rpcCalls.at(-1).args.p_outcome, "sent")
})

test("actual route reports HTTP 200 failed count after definite provider rejection without resending", async () => {
  const harness = routeHarness({ providerStatus: 400 })
  const response = await harness.post()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, sent: 0, deduped: 0, failed: 1 })
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.rpcCalls.at(-1).args.p_outcome, "failed")
})

for (const scenario of [
  { name: "denied external attempt", deniedAttempt: true, expected: "delivery_unknown" },
  { name: "unknown dispatch recovery", materialized: { acquired: false, recoveredUnknown: true }, expected: "delivery_unknown" },
  { name: "failed dispatch replay", materialized: { acquired: false, replayOutcome: "failed" }, expected: null },
  { name: "missing connection", connectionError: true, expected: "failed" },
]) test(`actual route preserves no-send for ${scenario.name}`, async () => {
  const harness = routeHarness(scenario)
  const response = await harness.post()
  assert.deepEqual(await response.json(), { ok: true, sent: 0, deduped: 0, failed: 1 })
  assert.equal(harness.requests.length, 0)
  const finalization = harness.rpcCalls.find((call) => call.name === "finalize_makeup_legacy_google_chat_v1")
  assert.equal(finalization?.args.p_outcome || null, scenario.expected)
})

test("actual route deduped replay and disabled plan never create an external attempt", async () => {
  for (const options of [{ materialized: { acquired: false } }, { items: [] }]) {
    const harness = routeHarness(options)
    const response = await harness.post()
    assert.equal(response.status, options.items ? 200 : 202)
    const outcome = await response.json()
    assert.equal(outcome.failed, 0)
    assert.equal(harness.requests.length, 0)
    assert.equal(harness.rpcCalls.some((call) => call.name === "register_notification_external_attempt_v1"), false)
  }
})

test("actual route rejects assistant access and caller-controlled render or target fields before plan RPC", async () => {
  for (const scenario of [{ role: "assistant", status: 403 }, { unauthorized: true, status: 401 }, { body: { sourceEventId: id(2), href: "/admin/makeup-requests" }, status: 400 }, { body: { sourceEventId: "invalid" }, status: 400 }]) {
    const harness = routeHarness(scenario)
    assert.equal((await harness.post(scenario.body)).status, scenario.status)
    assert.equal(harness.rpcCalls.length, 0)
    assert.equal(harness.requests.length, 0)
  }
})

test("legacy requestId compatibility retains strict path, workflow, single identity and canonical UUID boundaries", async () => {
  const requestId = id(900)
  assert.equal(buildNotificationAppLink(finalSqlHref(requestId), "makeup_requests").relativeUrl, `/admin/makeup-requests?request=${requestId}`)
  assert.equal(buildNotificationAppLink(`/admin/makeup-requests?request=${requestId}`, "makeup_requests").relativeUrl, `/admin/makeup-requests?request=${requestId}`)
  assert.equal(buildNotificationAppLink("/admin/makeup-requests", "makeup_requests").relativeUrl, "/admin/makeup-requests")
  const invalid = [
    `/admin/makeup-requests?request=${requestId}&requestId=${requestId}`,
    `/admin/makeup-requests?requestId=${requestId}&requestId=${requestId}`,
    "/admin/makeup-requests?requestId=invalid", "/admin/makeup-requests?request=invalid",
    `/admin/makeup-requests?%72equestId=${requestId}`, `/admin/makeup-requests?requestId=%61${requestId.slice(1)}`,
    `/admin/makeup-requests?requestId=${requestId}&redirect=https://evil.invalid`,
    `/admin/tasks?requestId=${requestId}`, `/admin/makeup-requests/?requestId=${requestId}`,
    `//evil.invalid/admin/makeup-requests?requestId=${requestId}`,
    `/admin/makeup-requests?requestId=${requestId}#detail`, `/admin/../admin/makeup-requests?requestId=${requestId}`,
    `/admin/makeup-requests?requestId=${requestId}%0a`, `/admin/makeup-requests?requestId=${requestId}<`,
  ]
  for (const href of invalid) assert.throws(() => buildNotificationAppLink(href, "makeup_requests"), /notification_app_deep_link_invalid/u, href)
  assert.throws(() => buildNotificationAppLink(finalSqlHref(requestId), "registration"), /notification_app_deep_link_invalid/u)
  for (const href of invalid.filter((href) => href.startsWith("/admin/"))) {
    const harness = routeHarness({ item: { href } })
    const response = await harness.post()
    assert.equal((await response.json()).failed, 1)
    assert.equal(harness.requests.length, 0, href)
  }
})

function catalogRows() {
  return { profiles: [{ id: id(801), role: "admin", name: "담당" }, { id: id(804), role: "admin", name: "결재자" }], teacher_catalogs: [{ id: id(701), name: "담당", subjects: "영어", profile_id: id(801) }, { id: id(702), name: "강부희", subjects: "영어", profile_id: id(804) }], classes: [{ id: id(600), name: "고1 영어", subject: "영어", grade: "고1", teacher: "담당", schedule_storage_mode: "normalized" }], class_lesson_sessions: [{ id: id(601), class_id: id(600), session_date: "2026-09-01", schedule_state: "active" }] }
}

function serviceHarness(options = {}) {
  const rows = catalogRows(), rpcCalls = [], fromCalls = []
  const raw = { id: id(900), status: options.requestStatus || "approval_pending", request_kind: "cancel_only", requester_id: id(801), approver_profile_id: id(804), created_at: stamp, class_id: id(600) }
  const supabase = {
    auth: { async getSession() { return { data: { session: options.noSession ? null : { access_token: "test-only-session" } }, error: null } } },
    from(table) {
      fromCalls.push(table)
      let single = false
      const chain = { select() { return this }, eq() { return this }, order() { return this }, abortSignal() { return this }, retry() { return this }, single() { single = true; return this }, then(resolve, reject) { return Promise.resolve({ data: table === "makeup_requests" ? single ? raw : [raw] : rows[table] || [], error: null }).then(resolve, reject) } }
      return chain
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return { data: { request: { ...raw, ...args.p_input, ...args.p_patch }, sourceEventId: id(901) }, error: null }
    },
  }
  const service = modules(supabase, { "./makeup-numbered-service": { async readMakeupDetail() { return row(900, { status: raw.status, requestKind: "cancel_only", makeupSlots: [], makeupStartAt: "", makeupEndAt: "", classId: id(600) }) } } })("src/features/makeup-requests/makeup-request-service.ts")
  return { service, rpcCalls, fromCalls }
}

for (const scenario of [
  { name: "HTTP 200 failed target", outcome: { ok: true, sent: 0, deduped: 0, failed: 1 }, warning: true },
  { name: "partial delivery", outcome: { ok: true, sent: 1, deduped: 0, failed: 1 }, warning: true },
  { name: "HTTP 503", status: 503, outcome: { ok: false }, warning: true },
  { name: "malformed result", outcome: { ok: true, failed: 0 }, warning: true },
  { name: "negative count", outcome: { ok: true, sent: -1, deduped: 0, failed: 0 }, warning: true },
  { name: "string count", outcome: { ok: true, sent: "1", deduped: 0, failed: 0 }, warning: true },
  { name: "transport timeout", throws: true, warning: true },
  { name: "session expired after save", noSession: true, warning: true },
  { name: "successful delivery", outcome: { ok: true, sent: 1, deduped: 0, failed: 0 }, warning: false },
  { name: "HTTP 202 deduped", status: 202, outcome: { ok: true, sent: 0, deduped: 1, failed: 0 }, warning: false },
  { name: "no enabled targets", outcome: { ok: true, sent: 0, deduped: 0, failed: 0 }, warning: false },
]) test(`actual create preserves committed success and communicates ${scenario.name} without retry`, async (t) => {
  const harness = serviceHarness(scenario), requests = []
  t.mock.method(console, "warn", () => {})
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/notifications/legacy/makeup")
    requests.push(JSON.parse(init.body))
    if (scenario.throws) throw new Error("mock transport timeout")
    return new Response(JSON.stringify(scenario.outcome), { status: scenario.status || 200 })
  })
  const saved = await harness.service.createMakeupRequest(createInput, id(801))
  assert.equal(saved.id, id(900))
  assert.equal(saved.notificationWarning, scenario.warning ? WARNING : undefined)
  assert.equal(harness.rpcCalls.length, 1)
  assert.equal(harness.rpcCalls[0].name, "create_makeup_request_v2")
  assert.equal(requests.length, scenario.noSession ? 0 : 1)
  if (requests.length) assert.deepEqual(requests[0], { sourceEventId: id(901) })
})

for (const operation of ["resubmit", "transition", "approval"]) test(`actual ${operation} returns notification failure independently of committed mutation`, async (t) => {
  const harness = serviceHarness({ requestStatus: operation === "resubmit" ? "revision_requested" : "approval_pending" }), requests = []
  t.mock.method(console, "warn", () => {})
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    if (url === "/api/makeup-requests/approve") return new Response(JSON.stringify({ request: { id: id(900), status: "makeup_pending", requester_id: id(801), approver_profile_id: id(804) }, sourceEventId: id(901) }))
    assert.equal(url, "/api/notifications/legacy/makeup")
    return new Response(JSON.stringify({ ok: true, sent: 0, deduped: 0, failed: 1 }))
  })
  const saved = operation === "resubmit"
    ? await harness.service.resubmitMakeupRequest(id(900), createInput, id(801))
    : operation === "transition"
      ? await harness.service.requestMakeupRequestRevision(id(900), id(804), "보완 요청")
      : await harness.service.approveMakeupRequest(id(900), id(804))
  assert.equal(saved.id, id(900))
  assert.equal(saved.notificationWarning, WARNING)
  assert.equal(requests.filter((request) => request.url === "/api/notifications/legacy/makeup").length, 1)
  assert.equal(operation === "approval" ? requests.filter((request) => request.url === "/api/makeup-requests/approve").length : harness.rpcCalls.length, 1)
})

test("mounted create closes saved draft, refreshes the list and visibly warns after HTTP 200 failed count", async (t) => {
  const p = await setup(t, { search: "?view=approvalPending", clock: "2026-08-31T00:00:00Z" }), requests = []
  t.mock.method(console, "warn", () => {})
  t.mock.method(p.supabase.auth, "getSession", async () => ({ data: { session: { access_token: "test-only-session" } }, error: null }))
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/notifications/legacy/makeup")
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ ok: true, sent: 0, deduped: 0, failed: 1 }))
  })
  await act(async () => p.finish(p.numbered()[0]))
  await p.catalogs()
  await act(async () => button("휴보강 신청").click())
  const rows = catalogRows()
  await act(async () => { for (const request of p.requests.filter((request) => request.table).slice(3)) request.resolve({ data: rows[request.table] || [], error: null }) })
  await act(async () => p.observed.patch(() => ({ ...createInput })))
  const before = p.requests.length, previousReads = p.numbered().length
  await act(async () => button("상신").click())
  await act(async () => { for (const request of p.requests.slice(before).filter((request) => request.table)) request.resolve({ data: rows[request.table] || [], error: null }) })
  const mutation = await p.waitFor("create_makeup_request_v2")
  await act(async () => mutation.resolve({ data: { request: { id: id(900), ...mutation.args.p_input }, sourceEventId: id(901) }, error: null }))
  const feedback = [...document.querySelectorAll('[role="alert"]')].find((element) => element.textContent.includes(WARNING))
  assert.ok(feedback)
  assert.match(feedback.textContent, /휴보강 신청서를 상신했습니다/u)
  assert.equal(document.querySelector('[role="dialog"]'), null, "committed draft must close to prevent resaving")
  assert.equal(p.observed.input.reason, "")
  assert.ok(p.numbered().length > previousReads, "the committed list must refresh")
  assert.equal(p.requests.filter((request) => request.name === "create_makeup_request_v2").length, 1)
  assert.equal(requests.length, 1)
  await act(async () => p.finish(p.numbered().at(-1)))
  assert.ok(document.body.textContent.includes(WARNING), "list refresh must retain notification failure feedback")
})

test("mounted transition closes completed action and shows saved result plus notification warning without retry", async (t) => {
  const p = await setup(t, { search: "?view=refundPending" }), requests = []
  t.mock.method(console, "warn", () => {})
  t.mock.method(p.supabase.auth, "getSession", async () => ({ data: { session: { access_token: "test-only-session" } }, error: null }))
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/notifications/legacy/makeup")
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ ok: true, sent: 0, deduped: 0, failed: 1 }))
  })
  await act(async () => p.finish(p.numbered()[0], 1, { rows: [row(111, { status: "refund_pending" })] }))
  await p.catalogs()
  await act(async () => button("환불완료").click())
  await act(async () => p.observed.patchActionNote("완료 메모"))
  const before = p.requests.length
  await act(async () => [...document.querySelectorAll('[role="dialog"] button')].find((element) => element.textContent.trim() === "환불완료").click())
  const raw = { id: id(111), status: "refund_pending", request_kind: "cancel_only", requester_id: id(801), approver_profile_id: id(804), class_name: "수업 111", created_at: stamp }
  await act(async () => { for (const request of p.requests.slice(before).filter((request) => request.table)) request.resolve({ data: request.table === "makeup_requests" ? [raw] : request.table === "profiles" ? [{ id: id(804), role: "admin" }] : [], error: null }) })
  await act(async () => (await p.waitFor("makeup_request_events")).resolve({ data: [], error: null }))
  await act(async () => (await p.waitFor("makeup_requests", 2)).resolve({ data: raw, error: null }))
  const mutation = await p.waitFor("transition_makeup_request_v2")
  await act(async () => mutation.resolve({ data: { request: { ...raw, status: "completed" }, sourceEventId: id(901) }, error: null }))
  await act(async () => p.finish(p.numbered().at(-1), 0))
  const feedback = [...document.querySelectorAll('[role="alert"]')].find((element) => element.textContent.includes(WARNING))
  assert.ok(feedback)
  assert.match(feedback.textContent, /환불완료 처리했습니다/u)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(p.requests.filter((request) => request.name === "transition_makeup_request_v2").length, 1)
  assert.equal(requests.length, 1)
})

test("mounted resubmit closes the committed revision and exposes notification warning without a second mutation", async (t) => {
  const p = await setup(t, { search: "?view=mine", clock: "2026-08-31T00:00:00Z", auth: { user: { id: id(801), name: "담당" } } }), requests = []
  const detail = row(900, { status: "revision_requested", classId: id(600), requestKind: "cancel_only", cancelDate: "2026-09-01", makeupSlots: [], makeupStartAt: "", makeupEndAt: "", makeupClassroom: "" })
  t.mock.method(console, "warn", () => {})
  t.mock.method(p.supabase.auth, "getSession", async () => ({ data: { session: { access_token: "test-only-session" } }, error: null }))
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/notifications/legacy/makeup")
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ ok: true, sent: 0, deduped: 0, failed: 1 }))
  })
  await act(async () => p.finish(p.numbered()[0], 1, { rows: [detail] }))
  await p.catalogs()
  await act(async () => button("보완").click())
  await act(async () => p.finish(p.numbered().at(-1), 1, { rows: [detail] }))
  const rows = catalogRows()
  await act(async () => { for (const request of p.requests.filter((request) => request.table).slice(3)) request.resolve({ data: rows[request.table] || [], error: null }) })
  await act(async () => p.observed.patch(() => ({ ...createInput })))
  const before = p.requests.length
  assert.equal(button("재상신").disabled, false, document.body.textContent)
  await act(async () => button("재상신").click())
  const raw = { id: id(900), status: "revision_requested", request_kind: "cancel_only", requester_id: id(801), approver_profile_id: id(804), created_at: stamp, class_id: id(600) }
  await act(async () => { for (const request of p.requests.slice(before).filter((request) => request.table)) request.resolve({ data: request.table === "makeup_requests" ? [raw] : rows[request.table] || [], error: null }) })
  const detailRead = await p.waitFor("get_makeup_detail_v1")
  assert.equal(detailRead.args.p_id, id(900))
  await act(async () => detailRead.resolve({ data: detail, error: null }))
  const mutation = await p.waitFor("transition_makeup_request_v2")
  assert.equal(mutation.args.p_command, "resubmit")
  assert.equal(mutation.args.p_expected_status, "revision_requested")
  await act(async () => mutation.resolve({ data: { request: { ...raw, ...mutation.args.p_patch, status: "approval_pending" }, sourceEventId: id(901) }, error: null }))
  const feedback = [...document.querySelectorAll('[role="alert"]')].find((element) => element.textContent.includes(WARNING))
  assert.ok(feedback)
  assert.match(feedback.textContent, /휴보강 신청서를 재상신했습니다/u)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(p.observed.input.reason, "")
  assert.equal(p.requests.filter((request) => request.name === "transition_makeup_request_v2").length, 1)
  assert.equal(requests.length, 1)
})

test("mounted approval closes the committed approval and shows notification warning without resaving or resending", async (t) => {
  const p = await setup(t, { search: "?view=approvalPending" }), requests = []
  const detail = row(900, { classId: id(600), requestKind: "cancel_only", cancelDate: "2026-09-01", makeupSlots: [], makeupStartAt: "", makeupEndAt: "", makeupClassroom: "" })
  t.mock.method(console, "warn", () => {})
  t.mock.method(p.supabase.auth, "getSession", async () => ({ data: { session: { access_token: "test-only-session" } }, error: null }))
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    if (url === "/api/makeup-requests/approve") return new Response(JSON.stringify({ request: { id: id(900), status: "makeup_pending", requester_id: id(801), approver_profile_id: id(804), request_kind: "cancel_only" }, sourceEventId: id(901) }))
    assert.equal(url, "/api/notifications/legacy/makeup")
    return new Response(JSON.stringify({ ok: true, sent: 0, deduped: 0, failed: 1 }))
  })
  await act(async () => p.finish(p.numbered()[0], 1, { rows: [detail] }))
  await p.catalogs()
  await act(async () => (await p.waitFor("get_makeup_reservation_context_v1")).resolve({ data: { reservations: [], activeEventRequestIds: [] }, error: null }))
  assert.equal(button("승인").disabled, false)
  await act(async () => button("승인").click())
  const note = document.getElementById("makeup-approval-note")
  await act(async () => note[Object.keys(note).find((key) => key.startsWith("__reactProps"))].onChange({ target: { value: "승인 의견" } }))
  await act(async () => button("승인 처리").click())
  const detailRead = await p.waitFor("get_makeup_detail_v1")
  await act(async () => detailRead.resolve({ data: detail, error: null }))
  await act(async () => p.finish(p.numbered().at(-1), 0))
  const feedback = [...document.querySelectorAll('[role="alert"]')].find((element) => element.textContent.includes(WARNING))
  assert.ok(feedback)
  assert.match(feedback.textContent, /결재 승인 후 보강대기로 이동했습니다/u)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(requests.filter((request) => request.url === "/api/makeup-requests/approve").length, 1)
  assert.equal(requests.filter((request) => request.url === "/api/notifications/legacy/makeup").length, 1)
  assert.equal(p.requests.some((request) => request.name === "transition_makeup_request_v2"), false)
})


test("canonical makeup body is identical in v2 materialization, intent and actual card candidate; no real network", async () => {
  const harness = routeHarness({ canonical: true })
  const response = await harness.post()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, sent: 1, deduped: 0, failed: 0 })
  const call = harness.rpcCalls.find(call => call.name === "materialize_makeup_legacy_google_chat_v2")
  assert.ok(call)
  assert.equal(call.args.p_rendered_title, canonicalWant["makeup.submitted"][0])
  assert.equal(call.args.p_rendered_body, canonicalWant["makeup.submitted"][1])
  assert.equal(harness.providerContexts[0].rendered_body, call.args.p_rendered_body)
  assert.equal(harness.providerContexts[0].rendered_title, call.args.p_rendered_title)
  assert.equal(call.args.p_template_id, item().templateId)
  assert.equal(call.args.p_template_checksum, item().templateChecksum)
  const intent = harness.rpcCalls.find(call => call.name === "record_legacy_notification_delivery_intent_v1")
  assert.ok(intent)
  assert.equal(intent.args.p_normalized_rendered_hash, createHash("sha256").update(JSON.stringify({
    title: call.args.p_rendered_title, body: call.args.p_rendered_body, href: finalSqlHref(id(900)),
  })).digest("hex"))
  assert.equal(harness.requests.length, 1)
})

test("invalid/mismatched canonical snapshot is rejected before any materialize, claim or transport", async () => {
  for (const options of [{snapshot:{template_id:id(777)}}, {snapshot:{source_id:id(777)}}, {snapshotError:{code:"P0002"}}]) {
    const harness = routeHarness({canonical:true,...options})
    const response = await harness.post()
    assert.equal((await response.json()).failed, 1)
    assert.equal(harness.requests.length, 0)
    assert.equal(harness.rpcCalls.some(call => call.name.startsWith("materialize_")), false)
  }
})

test("v2 replay mismatch and already sent/unknown ownership cannot produce another transport", async () => {
  for (const options of [
    {materializeError:{code:"22023",message:"notification_delivery_replay_mismatch"}},
    {materialized:{acquired:false,replayOutcome:"sent"}},
    {materialized:{acquired:false,replayOutcome:"delivery_unknown"}},
    {materialized:{acquired:false,recoveredUnknown:true}},
  ]) {
    const harness=routeHarness({canonical:true,...options})
    await harness.post()
    assert.equal(harness.requests.length,0)
    assert.equal(harness.rpcCalls.some(call=>call.name === "register_notification_external_attempt_v1"),false)
  }
})


test("existing in-app POST and push retain v1 semantics without canonical snapshot reads", async () => {
  const items = [804,805].map(profile=>item({channelKey:"in_app",targetKind:"profile",targetKey:`profile:${id(profile)}`,targetProfileId:id(profile),connectionKey:null,targetSnapshot:{profile_id:id(profile)}}))
  const harness=routeHarness({canonical:true,inApp:true,items})
  const response=await harness.post()
  assert.deepEqual(await response.json(),{ok:true,sent:4,deduped:0,failed:0})
  assert.equal(harness.rpcCalls.filter(call=>call.name==="get_notification_render_snapshot_v1").length,0)
  const writes=harness.rpcCalls.filter(call=>call.name==="materialize_makeup_legacy_in_app_v1")
  assert.deepEqual(writes.map(call=>call.args.p_profile_id),[id(804),id(805)])
  assert.equal(new Set(writes.map(call=>call.args.p_request_id)).size,2)
  assert.equal(harness.pushContexts.length,2)
  for(const context of harness.pushContexts){
    assert.equal(context.rendered_title,items[0].renderedTitle)
    assert.equal(context.rendered_body,items[0].renderedBody)
  }
  assert.equal(harness.requests.length,0,"in-app/push fixture cannot call Google Chat")
})
