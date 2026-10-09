import assert from "node:assert/strict"
import test from "node:test"
import { createProductionRegistrationCustomerMessageBundlePreviewHandler } from "../src/features/tasks/server/registration-customer-message-bundle-preview-route.ts"
import { RegistrationCustomerMessageHttpError } from "../src/features/tasks/server/registration-customer-message-auth.ts"

const ACTOR = "16000000-0000-4000-8000-000000000001"
const TASK = "16000000-0000-4000-8000-000000000002"
const TRACK = "16000000-0000-4000-8000-000000000003"
const SOURCE = "16000000-0000-4000-8000-000000000004"
const BUNDLE = "16000000-0000-4000-8000-000000000005"
const OTHER = "16000000-0000-4000-8000-000000000006"
const ACTIVITY = "16000000-0000-4000-8000-000000000007"
const PHONE = "01000000000" // Synthetic only; no database, provider or credential access.
const TARGET = { messageKind: "level_test_booking_bundle", sourceId: TASK }
const FENCE_RPC = "read_registration_contact_message_fence_v1"
const SOURCE_RPC = "read_registration_contact_bundle_preview_v1"
function fence(patch = {}) {
  return { version: 1, taskId: TASK, sourceId: TASK, messageKind: TARGET.messageKind, contactPhase: "open", contactGeneration: "2",
    allPhasesClosed: false, sourcePhaseOpen: true, canonicalAppointmentKind: "level_test", ...patch }
}
function source() {
  return { messageKind: TARGET.messageKind, sourceId: TASK, taskId: TASK, bundleId: BUNDLE, bundleRevision: 1,
    reservationKind: "level_test", deliveryKind: "booking", serviceDate: null, recipientRevision: 1,
    sourceFingerprint: "a".repeat(64), studentName: "합성 학생",
    items: [{ sourceKind: "level_test", sourceId: SOURCE, sourceRevision: { appointmentNotificationRevision: 1 },
      trackId: TRACK, activityId: ACTIVITY, subject: "수학", scheduledAt: "2026-10-10T05:00:00.000Z", serviceDate: "2026-10-10",
      place: "본관", className: null, teacherName: null, sourceFactHash: "b".repeat(64) }] }
}
function harness(options = {}) {
  const calls = { auth: 0, authorization: [], rpc: [], controls: [] }
  const auth = {
    async authenticate() {
      calls.auth++
      if (options.authError) throw options.authError
      return { actorProfileId: options.actor ?? ACTOR, role: options.role ?? "staff", actorClient: {}, serviceClient: {
        from() { throw new Error("unexpected_private_table_fallback") },
        rpc(name, args) {
          assert.ok([FENCE_RPC, SOURCE_RPC].includes(name))
          calls.rpc.push({ name, args })
          return { abortSignal(signal) {
            assert.ok(signal instanceof AbortSignal)
            calls.controls.push({ name, signal, retry: null })
            return { retry(enabled) {
              assert.equal(enabled, false)
              calls.controls.at(-1).retry = enabled
              const producer = name === FENCE_RPC ? options.readFence : options.readSource
              return producer ? producer(signal, args) : Promise.resolve({ data: name === FENCE_RPC ? fence() : source(), error: null })
            } }
          } }
        },
      } }
    },
    async authorizeTask(_context, taskId) { calls.authorization.push(taskId); return options.visible ?? true },
  }
  const handler = createProductionRegistrationCustomerMessageBundlePreviewHandler({}, { auth })
  return { calls, run: (target = TARGET) => handler(new Request("https://synthetic.invalid/preview", { method: "POST",
    headers: { authorization: "Bearer synthetic", "content-type": "application/json" }, body: JSON.stringify(target) })) }
}
const unavailable = { ok: false, code: "registration_customer_message_runtime_unavailable" }

test("production bundle preview checks authorized task and fence before its bounded source RPC", async (context) => {
  const deadlines = []
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  context.mock.method(AbortSignal, "timeout", duration => { deadlines.push(duration); return timeout(duration) })
  const fixture = harness()
  const response = await fixture.run()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(fixture.calls.authorization, [TASK])
  assert.deepEqual(fixture.calls.rpc, [
    { name: FENCE_RPC, args: { p_actor_profile_id: ACTOR, p_message_kind: TARGET.messageKind, p_source_id: TASK } },
    { name: SOURCE_RPC, args: { p_message_kind: TARGET.messageKind, p_task_id: TASK, p_service_date: null } },
  ])
  assert.deepEqual(deadlines, [8000, 8000])
  assert.deepEqual(fixture.calls.controls.map(value => value.retry), [false, false])
  const body = await response.json()
  assert.equal(body.readiness.sendAllowed, false)
  assert.equal(body.readiness.activationMode, "off")
  const serialized = JSON.stringify(body)
  for (const value of [PHONE, BUNDLE, TRACK, SOURCE, ACTIVITY, "a".repeat(64)]) assert.equal(serialized.includes(value), false)
})

test("bundle authorization failures never read a fence or contact-bearing source", async () => {
  for (const [options, status] of [
    [{ authError: new RegistrationCustomerMessageHttpError(401, "registration_customer_message_unauthorized") }, 401],
    [{ role: "teacher" }, 404], [{ visible: false }, 404],
  ]) {
    const fixture = harness(options)
    assert.equal((await fixture.run()).status, status)
    assert.equal(fixture.calls.rpc.length, 0)
  }
  const fixture = harness({ actor: "display-uid" })
  assert.equal((await fixture.run()).status, 503)
  assert.equal(fixture.calls.rpc.length, 0)
})

test("closed, terminal or wrong-purpose bundle fence stops before raw source lookup", async () => {
  for (const patch of [{ contactPhase: "closed" }, { allPhasesClosed: true }, { sourcePhaseOpen: false }, { canonicalAppointmentKind: "visit_consultation" }]) {
    const fixture = harness({ readFence: () => Promise.resolve({ data: fence(patch), error: null }) })
    assert.equal((await fixture.run()).status, 409)
    assert.deepEqual(fixture.calls.rpc.map(value => value.name), [FENCE_RPC])
  }
})

test("unknown or mis-scoped bundle fence cannot authorize source access", async () => {
  for (const patch of [{ taskId: OTHER }, { sourceId: OTHER }, { messageKind: "observation_booking_bundle" }, { parentPhone: PHONE }, { contactGeneration: "9223372036854775808" }]) {
    const fixture = harness({ readFence: () => Promise.resolve({ data: fence(patch), error: null }) })
    const response = await fixture.run()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), unavailable)
    assert.deepEqual(fixture.calls.rpc.map(value => value.name), [FENCE_RPC])
  }
})

test("both bundle RPC errors preserve no fallback and safe error output", async () => {
  for (const rpc of [FENCE_RPC, SOURCE_RPC]) for (const code of ["42501", "PGRST202", "57014"]) {
    const fixture = harness({ [rpc === FENCE_RPC ? "readFence" : "readSource"]: () => Promise.resolve({ data: null, error: { code, message: PHONE } }) })
    const response = await fixture.run()
    assert.equal(response.status, rpc === FENCE_RPC ? 503 : 422)
    assert.equal((await response.text()).includes(PHONE), false)
    assert.equal(fixture.calls.rpc.length, rpc === FENCE_RPC ? 1 : 2)
  }
})

test("bundle source cardinality, identity and private extra keys fail closed before rendering", async () => {
  const mutations = [
    value => { value.items = [] }, value => { value.items = Array(4).fill(value.items[0]) },
    value => { value.items = [value.items[0], value.items[0]] }, value => { value.taskId = OTHER },
    value => { value.sourceId = OTHER }, value => { value.items[0].sourceRevision.rawSnapshot = PHONE },
    value => { value.studentName = "x".repeat(501) }, value => { value.rawSnapshot = PHONE },
    value => { value.parentPhoneDigits = PHONE },
    value => { value.items[0].activityId = null },
  ]
  for (const mutate of mutations) {
    const data = source(); mutate(data)
    const fixture = harness({ readSource: () => Promise.resolve({ data, error: null }) })
    const response = await fixture.run()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), unavailable)
    assert.equal(fixture.calls.rpc.length, 2)
  }
})

test("both bundle RPC transport rejections remain safe and never retry", async () => {
  for (const rpc of [FENCE_RPC, SOURCE_RPC]) {
    const fixture = harness({ [rpc === FENCE_RPC ? "readFence" : "readSource"]: () => Promise.reject(new Error(PHONE)) })
    const response = await fixture.run()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), unavailable)
    assert.deepEqual(fixture.calls.controls.map(value => value.retry), rpc === FENCE_RPC ? [false] : [false, false])
  }
})

test("bundle RPC deadline cancellation reaches the active transport without a second attempt", async (context) => {
  for (const rpc of [FENCE_RPC, SOURCE_RPC]) {
    const deadline = new AbortController()
    const deadlines = []
    const mock = context.mock.method(AbortSignal, "timeout", duration => { deadlines.push(duration); return deadline.signal })
    let started
    const inFlight = new Promise(resolve => { started = resolve })
    const fixture = harness({ [rpc === FENCE_RPC ? "readFence" : "readSource"]: signal => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }); started()
    }) })
    const pending = fixture.run()
    await inFlight
    deadline.abort(new DOMException("synthetic_deadline", "TimeoutError"))
    const response = await pending
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), unavailable)
    assert.equal(fixture.calls.rpc.length, rpc === FENCE_RPC ? 1 : 2)
    assert.deepEqual(deadlines, rpc === FENCE_RPC ? [8000] : [8000, 8000])
    mock.mock.restore()
  }
})
