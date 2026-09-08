import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { requireRegisteredNotificationExternalAttempt } from "../src/features/notifications/server/external-attempt-gate.js"
import { normalizedNotificationRenderedHash } from "../src/features/notifications/server/legacy-delivery-intent.js"
import { legacyNotificationWorkflowKey } from "../src/features/notifications/server/legacy-notification-workflow.ts"
import { createGoogleChatProvider } from "../src/features/notifications/server/providers/google-chat-provider.ts"

// These tests execute the real HTTP route and provider boundary. RPC responses
// model the final database decision; the separate two-session DB probe proves
// advisory locking and supersession atomicity, which a mocked RPC cannot prove.
const source = await readFile(new URL("../src/app/api/notifications/legacy/ops-task/route.ts", import.meta.url), "utf8")
const start = source.indexOf('export const runtime = "nodejs"')
assert.ok(start > 0)
const compiled = ts.transpileModule(source.slice(start), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const ids = Object.fromEntries(["actor", "source", "event", "rule", "template", "claim", "token", "attempt"].map((key, index) =>
  [key, `99ca0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]))
const item = {
  eventId: ids.event, eventKey: "registration.case_created", occurrenceKey: ids.source,
  ruleId: ids.rule, ruleRevision: "1", templateId: ids.template, templateChecksum: "a".repeat(64),
  channelKey: "google_chat", audienceKey: "management_team", targetGeneration: "0",
  targetKind: "connection", targetKey: "connection:google_chat.management",
  connectionKey: "google_chat.management", targetSnapshot: {}, renderedTitle: "상담 신청",
  renderedBody: "이전 요청의 합성 학생 정보", href: `/admin/registration?taskId=${ids.source}`,
  scheduledFor: "2026-09-08T00:00:00Z",
}
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
function harness({ plan = { items: [item] }, begin, gate } = {}) {
  const calls = [], providerInputs = [], transport = [], warnings = []
  let terminal = null
  const client = { async rpc(name, args) {
    calls.push({ name, args })
    if (name === "authorize_registration_legacy_dispatch_v1") return { data: true, error: null }
    if (name === "get_ops_task_legacy_dispatch_plan_v1") return { data: null, error: { code: "P0002" } }
    if (name === "get_registration_core_legacy_dispatch_plan_v1") return typeof plan === "function" ? plan() : { data: plan, error: null }
    if (name === "validate_registration_management_notification_preview_v1") return { data: true, error: null }
    if (name === "record_legacy_notification_intent_v1") return { data: { recorded: false, shadow: false, reason: "shadow_inactive" }, error: null }
    if (name === "begin_legacy_notification_dispatch_v1") return { data: begin ? await begin() : terminal
      ? { acquired: false, claim_id: ids.claim, owner_generation: "0", status: terminal, reason: "idempotent_dispatch_replay" }
      : { acquired: true, claim_id: ids.claim, owner_generation: "0", dispatch_token: ids.token, status: "dispatch_started" }, error: null }
    if (name === "register_notification_external_attempt_v1") return gate ? gate() : { data: { allowed: true, attempt_id: ids.attempt }, error: null }
    if (name === "finalize_legacy_notification_dispatch_v1") {
      terminal = args.p_outcome
      return { data: { status: "closed" }, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  }, auth: { async getUser() { return { data: { user: { id: ids.actor } }, error: null } } } }
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: sandboxModule, exports: sandboxModule.exports, createHash, Response, Request, AbortSignal,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture" } },
    createClient: () => client,
    readLegacyGoogleChatWebhookUrl: async () => "https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture",
    requireRegisteredNotificationExternalAttempt, normalizedNotificationRenderedHash, legacyNotificationWorkflowKey,
    createGoogleChatProvider(options) {
      const provider = createGoogleChatProvider(options)
      return { send(input) { providerInputs.push(input); return provider.send(input) } }
    },
    fetch: async (...args) => { transport.push(args); throw new Error("network_call_forbidden") },
    console: { warn: (...args) => { warnings.push(args) } },
  })
  return { calls, providerInputs, transport, warnings, get terminal() { return terminal },
    async post() {
      const response = await sandboxModule.exports.POST(new Request("https://fixture.invalid/api/notifications/legacy/ops-task", {
        method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ sourceEventId: ids.source }),
      }))
      return { status: response.status, body: await response.json() }
    },
  }
}
function providerZero(value) {
  assert.equal(value.providerInputs.length, 0, "the real provider is never asked to send")
  assert.equal(value.transport.length, 0, "no HTTP request crosses the provider boundary")
}

test("superseded source with an empty final plan stops before intent, ownership, or provider", async () => {
  const run = harness({ plan: { items: [] } })
  const result = await run.post()
  assert.equal(result.status, 202)
  assert.deepEqual(result.body, { ok: true, sent: 0, deduped: 0, failed: 0, eventIds: [] })
  assert.deepEqual(run.calls.map(({ name }) => name), ["authorize_registration_legacy_dispatch_v1", "get_ops_task_legacy_dispatch_plan_v1", "get_registration_core_legacy_dispatch_plan_v1"])
  providerZero(run)
})

test("a 23514 final-plan refusal never falls back to an old plan or starts delivery", async () => {
  const run = harness({ plan: () => ({ data: null, error: { code: "23514", message: "registration_management_notification_source_superseded" } }) })
  const result = await run.post()
  assert.equal(result.body.ok, false)
  assert.equal(run.calls.length, 3)
  assert.doesNotMatch(JSON.stringify(result.body), /superseded|23514/)
  providerZero(run)
})

test("a plan read before recovery cannot send when begin refuses the obsolete source", async () => {
  const reached = deferred(), release = deferred()
  const run = harness({ begin: async () => { reached.resolve(); await release.promise; return { acquired: false, status: "legacy_deduped", reason: "registration_management_notification_snapshot_stale" } } })
  const response = run.post()
  await reached.promise
  providerZero(run)
  release.resolve()
  const result = await response
  assert.equal(result.body.deduped, 1)
  assert.equal(result.body.sent, 0)
  assert.equal(run.calls.filter(({ name }) => name.includes("external_attempt") || name.startsWith("finalize_")).length, 0)
  providerZero(run)
})

test("even after both preview checks a late final-gate refusal gives provider zero and terminal replay", async (t) => {
  for (const binding of [false, true]) for (const mode of ["denied", "23514"]) {
    await t.test(`${binding ? "bound" : "legacy unbound"} ${mode}`, async () => {
      const reached = deferred(), release = deferred()
      const run = harness({ plan: { items: [{ ...item, ...(binding ? { previewChecksum: "b".repeat(64), previewSourceEventId: ids.source, mentionUserNames: [] } : {}) }] },
        gate: async () => {
          reached.resolve()
          await release.promise
          return mode === "23514"
            ? { data: null, error: { code: "23514", message: "registration_management_notification_source_superseded" } }
            : { data: { allowed: false, reason: "registration_management_notification_snapshot_stale" }, error: null }
        },
      })
      const response = run.post()
      await reached.promise
      assert.equal(run.calls.filter(({ name }) => name === "validate_registration_management_notification_preview_v1").length, binding ? 2 : 0)
      providerZero(run)
      release.resolve()
      assert.equal((await response).body.sent, 0)
      assert.equal(run.terminal, "delivery_unknown", "a late claim is retained conservatively, never erased as unsent")
      assert.equal(run.calls.filter(({ name }) => name === "finalize_legacy_notification_dispatch_v1").length, 1)
      assert.equal((await run.post()).body.deduped, 1)
      assert.equal(run.calls.filter(({ name }) => name === "register_notification_external_attempt_v1").length, 1, "replay never rearms the final gate")
      const begins = run.calls.filter(({ name }) => name === "begin_legacy_notification_dispatch_v1")
      assert.equal(begins[0].args.p_request_id, begins[1].args.p_request_id, "old source retries keep their original request identity")
      providerZero(run)
    })
  }
})
