import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const sourceUrl = (path) => pathToFileURL(resolve(root, path)).href
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`

const supabaseStubUrl = moduleUrl(`
  export function createClient(...args) {
    return globalThis.__notificationLegacyRouteCreateClient(...args)
  }
`)
const connectionStubUrl = moduleUrl(`
  export async function readLegacyGoogleChatWebhookUrl() {
    return "https://chat.googleapis.com/v1/spaces/test/messages?key=test&token=test"
  }
`)
const providerStubUrl = moduleUrl(`
  export function createGoogleChatProvider() {
    return {
      send(input) {
        return globalThis.__notificationLegacyRouteProviderSend(input)
      },
    }
  }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    const aliases = new Map([
      ["@supabase/supabase-js", supabaseStubUrl],
      [
        "@/features/notifications/server/legacy-google-chat-connection",
        connectionStubUrl,
      ],
      [
        "@/features/notifications/server/external-attempt-gate",
        sourceUrl("src/features/notifications/server/external-attempt-gate.js"),
      ],
      [
        "@/features/notifications/server/legacy-delivery-intent",
        sourceUrl("src/features/notifications/server/legacy-delivery-intent.js"),
      ],
      [
        "@/features/notifications/server/legacy-notification-workflow",
        sourceUrl("src/features/notifications/server/legacy-notification-workflow.ts"),
      ],
      [
        "@/features/notifications/server/providers/google-chat-provider",
        providerStubUrl,
      ],
    ])
    const url = aliases.get(specifier)
    if (url) return { url, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const routePromise = import(
  "../src/app/api/notifications/legacy/ops-task/route.ts?notification-retry-storm-test=1"
)

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  source: "20000000-0000-4000-8000-000000000001",
  event: "30000000-0000-4000-8000-000000000001",
  rule: "40000000-0000-4000-8000-000000000001",
  template: "50000000-0000-4000-8000-000000000001",
  claim: "60000000-0000-4000-8000-000000000001",
  token: "70000000-0000-4000-8000-000000000001",
  attempt: "80000000-0000-4000-8000-000000000001",
})

function planItem(eventKey) {
  return {
    eventId: IDS.event,
    eventKey,
    occurrenceKey: `fixture:${eventKey}`,
    ruleId: IDS.rule,
    ruleRevision: "1",
    templateId: IDS.template,
    templateChecksum: "a".repeat(64),
    channelKey: "google_chat",
    audienceKey: "management_team",
    targetGeneration: "0",
    targetKind: "connection",
    targetKey: "connection:google_chat.management",
    connectionKey: "google_chat.management",
    targetSnapshot: {},
    renderedTitle: "테스트 제목",
    renderedBody: "테스트 본문",
    href: "/admin/ops-tasks",
    scheduledFor: "2026-08-24T08:10:00.000Z",
  }
}

function actorClient({
  registrationScope = true,
  authorizationError = null,
} = {}) {
  const calls = []
  return {
    calls,
    auth: {
      async getUser() {
        return { data: { user: { id: IDS.actor } }, error: null }
      },
    },
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      if (name !== "authorize_registration_legacy_dispatch_v1") {
        throw new Error(`unexpected_actor_rpc:${name}`)
      }
      return authorizationError
        ? { data: null, error: authorizationError }
        : { data: registrationScope, error: null }
    },
  }
}

function serviceHarness({
  eventKey,
  begun,
  registerResult = { allowed: true, attempt_id: IDS.attempt },
  finalizeError = null,
}) {
  const calls = []
  return {
    calls,
    client: {
      async rpc(name, parameters) {
        calls.push({ name, parameters })
        if (name === "get_ops_task_legacy_dispatch_plan_v1") {
          return { data: { items: [planItem(eventKey)] }, error: null }
        }
        if (name === "record_legacy_notification_intent_v1") {
          return { data: { recorded: true }, error: null }
        }
        if (name === "begin_legacy_notification_dispatch_v1") {
          return { data: begun, error: null }
        }
        if (name === "register_notification_external_attempt_v1") {
          return { data: registerResult, error: null }
        }
        if (name === "finalize_legacy_notification_dispatch_v1") {
          return finalizeError
            ? { data: null, error: finalizeError }
            : { data: { status: "closed" }, error: null }
        }
        throw new Error(`unexpected_rpc:${name}`)
      },
    },
  }
}

async function postWithHarness(t, harness, providerSend, actorOptions = {}) {
  const actor = actorClient(actorOptions)
  const clients = [actor, harness.client]
  let fetchCalls = 0
  const originalFetch = globalThis.fetch
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-anon"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role"
  globalThis.__notificationLegacyRouteCreateClient = () => {
    const client = clients.shift()
    if (!client) throw new Error("unexpected_create_client")
    return client
  }
  globalThis.__notificationLegacyRouteProviderSend = providerSend
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error("network_call_forbidden")
  }

  t.after(() => {
    globalThis.fetch = originalFetch
    delete globalThis.__notificationLegacyRouteCreateClient
    delete globalThis.__notificationLegacyRouteProviderSend
    for (const [key, value] of [
      ["NEXT_PUBLIC_SUPABASE_URL", previousUrl],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", previousAnon],
      ["SUPABASE_SERVICE_ROLE_KEY", previousService],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const { POST } = await routePromise
  const result = await POST(new Request("http://localhost/api/notifications/legacy/ops-task", {
    method: "POST",
    headers: { authorization: "Bearer fixture-token" },
    body: JSON.stringify({ sourceEventId: IDS.source }),
  }))
  return {
    actorCalls: actor.calls,
    body: await result.json(),
    fetchCalls,
    status: result.status,
  }
}

test("교사·정지 계정의 등록 알림 재시도는 plan과 provider 전에 403으로 끝난다", async (t) => {
  for (const actorState of ["teacher", "banned"]) {
    await t.test(actorState, async (subtest) => {
      const harness = serviceHarness({
        eventKey: "registration.case_created",
        begun: {
          acquired: true,
          claim_id: IDS.claim,
          owner_generation: "0",
          dispatch_token: IDS.token,
          status: "dispatch_started",
        },
      })
      let providerCalls = 0
      const result = await postWithHarness(
        subtest,
        harness,
        async () => {
          providerCalls += 1
          return { status: "sent" }
        },
        {
          authorizationError: {
            code: "42501",
            message: "registration_legacy_dispatch_access_denied",
          },
        },
      )

      assert.equal(result.status, 403)
      assert.deepEqual(result.body, {
        ok: false,
        error: "등록·전반·퇴원 알림 후처리를 완료하지 못했습니다.",
      })
      assert.deepEqual(result.actorCalls, [{
        name: "authorize_registration_legacy_dispatch_v1",
        parameters: { p_source_event_id: IDS.source },
      }])
      assert.equal(
        harness.calls.filter(({ name }) => name.includes("legacy_dispatch_plan_v1")).length,
        0,
      )
      assert.equal(providerCalls, 0)
      assert.equal(result.fetchCalls, 0)
    })
  }
})

test("closed begin replay는 provider, external attempt, finalize를 모두 0회로 유지한다", async (t) => {
  const harness = serviceHarness({
    eventKey: "registration.case_created",
    begun: {
      acquired: false,
      claim_id: IDS.claim,
      owner_generation: "0",
      status: "failed",
      reason: "idempotent_dispatch_replay",
    },
  })
  let providerCalls = 0
  const result = await postWithHarness(t, harness, async () => {
    providerCalls += 1
    return { status: "sent" }
  })

  assert.equal(result.status, 202)
  assert.deepEqual(result.body, {
    ok: true,
    sent: 0,
    deduped: 1,
    failed: 0,
    eventIds: [IDS.event],
  })
  assert.equal(providerCalls, 0)
  assert.equal(result.fetchCalls, 0)
  assert.equal(
    harness.calls.filter(({ name }) => name === "register_notification_external_attempt_v1").length,
    0,
  )
  assert.equal(
    harness.calls.filter(({ name }) => name === "finalize_legacy_notification_dispatch_v1").length,
    0,
  )
})

test("external attempt 거부 종결이 실패해도 finalize를 두 번 호출하지 않는다", async (t) => {
  const harness = serviceHarness({
    eventKey: "task.created",
    begun: {
      acquired: true,
      claim_id: IDS.claim,
      owner_generation: "0",
      dispatch_token: IDS.token,
      status: "dispatch_started",
    },
    registerResult: { allowed: false },
    finalizeError: {
      code: "23514",
      message: "notification_legacy_finalize_replay_mismatch",
    },
  })
  let providerCalls = 0
  const originalWarn = console.warn
  console.warn = () => {}
  t.after(() => { console.warn = originalWarn })

  const result = await postWithHarness(t, harness, async () => {
    providerCalls += 1
    return { status: "sent" }
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.failed, 1)
  assert.equal(providerCalls, 0)
  assert.equal(result.fetchCalls, 0)
  assert.equal(
    harness.calls.filter(({ name }) => name === "finalize_legacy_notification_dispatch_v1").length,
    1,
  )
})

test("정상 legacy provider 호출은 업무별 canonical workflow를 정확히 한 번 전달한다", async (t) => {
  const cases = [
    ["task.created", "tasks"],
    ["word_retest.completed", "word_retests"],
    ["registration.case_created", "registration"],
    ["transfer.completed", "transfer"],
    ["withdrawal.completed", "withdrawal"],
  ]

  for (const [eventKey, workflowKey] of cases) {
    await t.test(eventKey, async (subtest) => {
      const harness = serviceHarness({
        eventKey,
        begun: {
          acquired: true,
          claim_id: IDS.claim,
          owner_generation: "0",
          dispatch_token: IDS.token,
          status: "dispatch_started",
        },
      })
      const providerInputs = []
      const result = await postWithHarness(subtest, harness, async (input) => {
        providerInputs.push(input)
        return { status: "sent", providerMessageId: "fixture-provider-message" }
      })

      assert.equal(result.status, 200)
      assert.equal(result.body.sent, 1)
      assert.equal(result.fetchCalls, 0)
      assert.equal(providerInputs.length, 1)
      assert.equal(providerInputs[0].workflow_key, workflowKey)
      assert.equal(
        harness.calls.filter(({ name }) => name === "finalize_legacy_notification_dispatch_v1").length,
        1,
      )
    })
  }
})
