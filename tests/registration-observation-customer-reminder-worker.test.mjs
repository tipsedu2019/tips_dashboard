import assert from "node:assert/strict"
import test from "node:test"

import * as reminderRoute from "../src/features/tasks/server/registration-customer-reminder-route.ts"
import * as reminderWorker from "../src/features/tasks/server/registration-customer-reminder-worker.ts"

const JOB_ID = "00000000-0000-4000-8000-000000000101"
const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000102"
const OBSERVATION_ID = "00000000-0000-4000-8000-000000000103"
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000000104"
const REQUEST_KEY = "00000000-0000-4000-8000-000000000105"
const MESSAGE_ID = "00000000-0000-4000-8000-000000000106"
const DISPATCH_TOKEN = "00000000-0000-4000-8000-000000000107"

const OBSERVATION_CLAIM = Object.freeze({
  jobId: JOB_ID,
  messageKind: "observation_reminder",
  appointmentId: APPOINTMENT_ID,
  observationId: OBSERVATION_ID,
  claimToken: CLAIM_TOKEN,
  sourceRevision: 4,
  scheduledFor: "2026-08-17T09:00:00Z",
  requestKey: REQUEST_KEY,
})

const LEGACY_CLAIM = Object.freeze({
  jobId: JOB_ID,
  appointmentId: APPOINTMENT_ID,
  claimToken: CLAIM_TOKEN,
  sourceRevision: 4,
  scheduledFor: "2026-08-17T09:00:00Z",
  requestKey: REQUEST_KEY,
})

const OBSERVATION_SOURCE = Object.freeze({
  messageKind: "observation_reminder",
  sourceId: OBSERVATION_ID,
  taskId: "00000000-0000-4000-8000-000000000108",
  trackId: "00000000-0000-4000-8000-000000000109",
  observationId: OBSERVATION_ID,
  appointmentId: APPOINTMENT_ID,
  sourceRevision: 4,
  sessionSourceRevision: Object.freeze({
    authority: "normalized",
    sessionId: "00000000-0000-4000-8000-000000000110",
    revision: 7,
  }),
  bookingFactHash: "b".repeat(64),
  studentName: "김팁스",
  parentPhoneDigits: "01012345678",
  subject: "수학",
  className: "중등 수학 A",
  scheduledAt: "2026-08-17T09:00:00Z",
  place: "201호",
  campus: "본관",
  teacherName: "팁스 선생님",
})

const PREPARED = Object.freeze({
  to: "01012345678",
  templateId: "template-observation-reminder",
  variables: Object.freeze({ "#{학생명}": "김팁스" }),
  buttons: Object.freeze([]),
  contract: Object.freeze({ sourceFingerprint: "f".repeat(64) }),
  readinessContract: Object.freeze({ catalogChecksum: "a".repeat(64) }),
})

function providerResult(outcome = "accepted") {
  return Object.freeze({
    outcome,
    evidence: Object.freeze({
      statusCode: outcome === "accepted" ? "2000" : "provider_dispatch_uncertain",
      statusMessage: "test provider",
      observedAt: "2026-08-12T00:00:00.000Z",
      requestKeyMatched: true,
    }),
  })
}

function workerFixture(overrides = {}) {
  const calls = { claim: 0, prepare: 0, begin: 0, release: [], send: 0, finalize: [] }
  const worker = reminderWorker.createRegistrationCustomerReminderWorker({
    async claim() {
      calls.claim += 1
      return OBSERVATION_CLAIM
    },
    async prepare() {
      calls.prepare += 1
      return PREPARED
    },
    async begin() {
      calls.begin += 1
      return { allowed: true, messageId: MESSAGE_ID, dispatchToken: DISPATCH_TOKEN, currentStatus: "pending" }
    },
    async release(input) {
      calls.release.push(input)
    },
    async send() {
      calls.send += 1
      return providerResult()
    },
    async finalize(input) {
      calls.finalize.push(input)
    },
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    ...overrides,
  })
  return { calls, worker }
}

function rpcResponse(data, error = null) {
  return {
    abortSignal() { return this },
    retry() { return Promise.resolve({ data, error }) },
  }
}

function productionEnvironment() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET: "worker-secret",
    SOLAPI_API_KEY: "api-key",
    SOLAPI_API_SECRET: "api-secret",
    SOLAPI_KAKAO_PF_ID: "pf-id",
    SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "template-appointment",
    SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "template-observation",
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "server-only-recipient-pepper",
  }
}

function productionWorkerScenario({
  claim = OBSERVATION_CLAIM,
  read = OBSERVATION_SOURCE,
  begin = { allowed: true, messageId: MESSAGE_ID, dispatchToken: DISPATCH_TOKEN, currentStatus: "pending" },
} = {}) {
  const calls = { claim: 0, read: 0, begin: 0, release: [], finalize: [], provider: 0 }
  const value = (input) => typeof input === "function" ? input() : input
  const client = {
    rpc(name, args = {}) {
      if (name === "claim_registration_customer_reminder_job_v1") {
        calls.claim += 1
        return rpcResponse(value(claim))
      }
      if (name === "read_registration_customer_reminder_source_v1") {
        calls.read += 1
        const result = value(read)
        return result instanceof Error
          ? rpcResponse(null, { message: result.message })
          : rpcResponse(result)
      }
      if (name === "begin_registration_customer_reminder_dispatch_v1") {
        calls.begin += 1
        const result = value(begin)
        return result instanceof Error
          ? rpcResponse(null, { message: result.message })
          : rpcResponse(result)
      }
      if (name === "release_registration_customer_reminder_job_v1") {
        calls.release.push(args)
        return rpcResponse({ released: true })
      }
      if (name === "finalize_registration_customer_reminder_dispatch_v1") {
        calls.finalize.push(args)
        return rpcResponse({ ok: true })
      }
      throw new Error(`unexpected rpc: ${name}`)
    },
  }
  const handlers = reminderRoute.createProductionRegistrationCustomerReminderRouteHandlers({
    client,
    environment: productionEnvironment(),
    async providerFetch() {
      calls.provider += 1
      throw new Error("test provider boundary")
    },
  })
  const run = () => handlers.worker(new Request("http://localhost/worker", {
    method: "POST",
    headers: { authorization: "Bearer worker-secret" },
  }))
  return { calls, run }
}

test("claim parser normalizes the exact legacy shape only after preserving its raw six-key contract", () => {
  const parse = reminderRoute.parseRegistrationCustomerReminderClaim
  assert.deepEqual(LEGACY_CLAIM, {
    jobId: JOB_ID,
    appointmentId: APPOINTMENT_ID,
    claimToken: CLAIM_TOKEN,
    sourceRevision: 4,
    scheduledFor: "2026-08-17T09:00:00Z",
    requestKey: REQUEST_KEY,
  })
  assert.deepEqual(parse(LEGACY_CLAIM), {
    ...LEGACY_CLAIM,
    messageKind: "appointment_reminder",
    observationId: null,
  })
  assert.throws(() => parse({ ...LEGACY_CLAIM, observationId: OBSERVATION_ID }))
})

test("claim parser preserves the job-locked observation identity and rejects extra keys", () => {
  const parse = reminderRoute.parseRegistrationCustomerReminderClaim
  assert.deepEqual(parse(OBSERVATION_CLAIM), OBSERVATION_CLAIM)
  assert.throws(() => parse({ ...OBSERVATION_CLAIM, unexpected: true }))
})

test("worker refreshes exactly once and sends only the refreshed observation payload", async () => {
  const prepared = []
  const { calls, worker } = workerFixture({
    async prepare() {
      calls.prepare += 1
      const value = Object.freeze({ ...PREPARED, contract: Object.freeze({ sourceFingerprint: `f${calls.prepare}` }) })
      prepared.push(value)
      return value
    },
    async begin() {
      calls.begin += 1
      return calls.begin === 1
        ? { allowed: false, messageId: null, dispatchToken: null, currentStatus: "refresh_required" }
        : { allowed: true, messageId: MESSAGE_ID, dispatchToken: DISPATCH_TOKEN, currentStatus: "pending" }
    },
    async send(input) {
      calls.send += 1
      assert.equal(input.prepared, prepared[1])
      return providerResult()
    },
  })

  const result = await worker.runOnce()

  assert.deepEqual(result, { ok: true, processed: true, providerAttempted: true, outcome: "accepted" })
  assert.equal(calls.prepare, 2)
  assert.equal(calls.begin, 2)
  assert.equal(calls.send, 1)
  assert.equal(calls.finalize.length, 1)
})

test("worker stops after the second observation revision drift without a marker or provider call", async () => {
  const { calls, worker } = workerFixture({
    async begin() {
      calls.begin += 1
      return calls.begin === 1
        ? { allowed: false, messageId: null, dispatchToken: null, currentStatus: "refresh_required" }
        : { allowed: false, messageId: null, dispatchToken: null, currentStatus: "source_dirty" }
    },
  })

  const result = await worker.runOnce()

  assert.deepEqual(result, { ok: true, processed: true, providerAttempted: false, outcome: "skipped" })
  assert.equal(calls.prepare, 2)
  assert.equal(calls.begin, 2)
  assert.equal(calls.send, 0)
  assert.equal(calls.finalize.length, 0)
})

test("worker maps booking fact and runtime gate failures to terminal provider-zero releases", async () => {
  const cases = [
    ["RegistrationCustomerReminderBookingFactChangedError", "booking_fact_changed"],
    ["RegistrationObservationRuntimeInactiveError", "runtime_inactive"],
  ]
  for (const [errorName, releaseCode] of cases) {
    const Failure = reminderWorker[errorName]
    const { calls, worker } = workerFixture({
      async prepare() {
        calls.prepare += 1
        throw new Failure()
      },
    })
    const result = await worker.runOnce()
    assert.deepEqual(result, { ok: true, processed: true, providerAttempted: false, outcome: "skipped" })
    assert.deepEqual(calls.release.map(({ errorCode }) => errorCode), [releaseCode])
    assert.equal(calls.send, 0)
    assert.equal(calls.finalize.length, 0)
  }
})

test("terminal begin states never cross the observation provider marker boundary", async () => {
  for (const currentStatus of [
    "runtime_inactive",
    "settings_refresh_required",
    "source_dirty",
    "duplicate_locked",
    "accepted",
  ]) {
    const { calls, worker } = workerFixture({
      async begin() {
        calls.begin += 1
        return { allowed: false, messageId: null, dispatchToken: null, currentStatus }
      },
    })
    const result = await worker.runOnce()
    assert.equal(result.providerAttempted, false, currentStatus)
    assert.equal(calls.send, 0, currentStatus)
    assert.equal(calls.finalize.length, 0, currentStatus)
  }
})

test("ineligible observation jobs stay provider-zero before claim, including runtime off and verification fences", async () => {
  for (const cause of [
    "canceled",
    "completed",
    "no_show",
    "runtime_off_at_claim",
    "booking_hash_dirty_at_claim",
    "appointment_verification",
    "observation_receipt_drift",
    "pre_cutoff_backlog",
  ]) {
    const { calls, run } = productionWorkerScenario({ claim: null })
    const response = await run()
    assert.deepEqual(await response.json(), {
      ok: true,
      processed: false,
      providerAttempted: false,
      outcome: "idle",
    }, cause)
    assert.equal(calls.begin, 0, cause)
    assert.equal(calls.provider, 0, cause)
    assert.equal(calls.finalize.length, 0, cause)
  }
})

test("runtime and booking gates fail provider-zero both before source preparation and before the marker", async () => {
  const beforeRead = productionWorkerScenario({
    read: new Error("registration_observation_runtime_inactive"),
  })
  const beforeReadResponse = await beforeRead.run()
  assert.equal((await beforeReadResponse.json()).outcome, "skipped")
  assert.deepEqual(beforeRead.calls.release.map(({ p_error_code }) => p_error_code), ["runtime_inactive"])
  assert.equal(beforeRead.calls.begin, 0)
  assert.equal(beforeRead.calls.provider, 0)
  assert.equal(beforeRead.calls.finalize.length, 0)

  const beforeMarker = productionWorkerScenario({
    begin: { allowed: false, messageId: null, dispatchToken: null, currentStatus: "runtime_inactive" },
  })
  const beforeMarkerResponse = await beforeMarker.run()
  assert.equal((await beforeMarkerResponse.json()).outcome, "skipped")
  assert.equal(beforeMarker.calls.read, 1)
  assert.equal(beforeMarker.calls.begin, 1)
  assert.equal(beforeMarker.calls.provider, 0)
  assert.equal(beforeMarker.calls.finalize.length, 0)

  const bookingChanged = productionWorkerScenario({
    read: new Error("registration_customer_reminder_booking_fact_changed"),
  })
  const bookingChangedResponse = await bookingChanged.run()
  assert.equal((await bookingChangedResponse.json()).outcome, "skipped")
  assert.deepEqual(bookingChanged.calls.release.map(({ p_error_code }) => p_error_code), ["booking_fact_changed"])
  assert.equal(bookingChanged.calls.begin, 0)
  assert.equal(bookingChanged.calls.provider, 0)
  assert.equal(bookingChanged.calls.finalize.length, 0)

  const sourceDirty = productionWorkerScenario({
    begin: { allowed: false, messageId: null, dispatchToken: null, currentStatus: "source_dirty" },
  })
  const sourceDirtyResponse = await sourceDirty.run()
  assert.equal((await sourceDirtyResponse.json()).outcome, "skipped")
  assert.equal(sourceDirty.calls.provider, 0)
  assert.equal(sourceDirty.calls.finalize.length, 0)
})

test("not-ready settings and a requested refresh stay provider-zero without a final marker", async () => {
  for (const cause of ["activation_off", "observation_receipt_drift"]) {
    const { calls, run } = productionWorkerScenario({
      begin: new Error("registration_customer_reminder_not_ready"),
    })
    const response = await run()
    assert.equal((await response.json()).outcome, "held", cause)
    assert.deepEqual(calls.release.map(({ p_error_code }) => p_error_code), ["pre_send_preparation_failed"], cause)
    assert.equal(calls.provider, 0, cause)
    assert.equal(calls.finalize.length, 0, cause)
  }

  const refreshRequired = productionWorkerScenario({
    begin: { allowed: false, messageId: null, dispatchToken: null, currentStatus: "settings_refresh_required" },
  })
  const response = await refreshRequired.run()
  assert.equal((await response.json()).outcome, "skipped")
  assert.equal(refreshRequired.calls.provider, 0)
  assert.equal(refreshRequired.calls.finalize.length, 0)
})

test("unknown observation dispatch is never retried by a second worker invocation", async () => {
  const claims = [OBSERVATION_CLAIM, null]
  const { calls, run } = productionWorkerScenario({ claim: () => claims.shift() })

  const first = await run()
  const second = await run()

  assert.equal((await first.json()).outcome, "unknown")
  assert.equal((await second.json()).outcome, "idle")
  assert.equal(calls.provider, 1)
  assert.equal(calls.finalize.length, 1)
})

test("production assembly keeps observation source job-locked and finalizes an ambiguous provider attempt once", async () => {
  const rpcCalls = []
  let providerCalls = 0
  const client = {
    rpc(name, args = {}) {
      rpcCalls.push({ name, args })
      if (name === "claim_registration_customer_reminder_job_v1") return rpcResponse(OBSERVATION_CLAIM)
      if (name === "read_registration_customer_reminder_source_v1") return rpcResponse(OBSERVATION_SOURCE)
      if (name === "begin_registration_customer_reminder_dispatch_v1") {
        return rpcResponse({ allowed: true, messageId: MESSAGE_ID, dispatchToken: DISPATCH_TOKEN, currentStatus: "pending" })
      }
      if (name === "finalize_registration_customer_reminder_dispatch_v1") return rpcResponse({ ok: true })
      throw new Error(`unexpected rpc: ${name}`)
    },
  }
  const handlers = reminderRoute.createProductionRegistrationCustomerReminderRouteHandlers({
    client,
    environment: productionEnvironment(),
    async providerFetch() {
      providerCalls += 1
      throw new Error("ambiguous network boundary")
    },
  })

  const response = await handlers.worker(new Request("http://localhost/worker", {
    method: "POST",
    headers: { authorization: "Bearer worker-secret" },
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    processed: true,
    providerAttempted: true,
    outcome: "unknown",
  })
  assert.equal(providerCalls, 1)
  assert.deepEqual(rpcCalls.filter(({ name }) => name === "read_registration_customer_reminder_source_v1")[0], {
    name: "read_registration_customer_reminder_source_v1",
    args: { p_job_id: JOB_ID, p_claim_token: CLAIM_TOKEN },
  })
  assert.equal(rpcCalls.filter(({ name }) => name === "finalize_registration_customer_reminder_dispatch_v1").length, 1)
})
