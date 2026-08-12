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
const SECOND_JOB_ID = "00000000-0000-4000-8000-000000000111"
const LEGACY_JOB_ID = "00000000-0000-4000-8000-000000000112"
const SECOND_CLAIM_TOKEN = "00000000-0000-4000-8000-000000000113"
const LEGACY_CLAIM_TOKEN = "00000000-0000-4000-8000-000000000114"

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

const LEGACY_SOURCE = Object.freeze({
  messageKind: "appointment_reminder",
  sourceId: APPOINTMENT_ID,
  taskId: "00000000-0000-4000-8000-000000000108",
  trackId: null,
  appointmentId: APPOINTMENT_ID,
  sourceRevision: 4,
  studentName: "김팁스",
  parentPhoneDigits: "01012345678",
  subjects: ["수학"],
  participants: [Object.freeze({
    trackId: "00000000-0000-4000-8000-000000000109",
    subject: "수학",
    workflowStatus: "level_test_requested",
    workflowRevision: 4,
    activityId: "00000000-0000-4000-8000-000000000110",
    activityStatus: "scheduled",
  })],
  appointmentKind: "level_test",
  scheduledAt: "2099-08-17T09:00:00Z",
  place: "본관",
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

function statefulJob({
  jobId = JOB_ID,
  messageKind = "observation_reminder",
  claimToken = CLAIM_TOKEN,
  scheduledFor = "2026-08-12T03:00:00.000Z",
  dueAt = "2026-08-12T00:00:00.000Z",
  availableAt = dueAt,
  existingStatus = null,
} = {}) {
  return {
    jobId,
    messageKind,
    appointmentId: APPOINTMENT_ID,
    observationId: messageKind === "observation_reminder" ? OBSERVATION_ID : null,
    claimToken,
    sourceRevision: 4,
    scheduledFor,
    dueAt,
    availableAt,
    status: "pending",
    sourceRevisionAtRead: 7,
    lastReadRevision: 7,
    sourceRefreshCount: 0,
    existingStatus,
    lastErrorCode: null,
  }
}

function createStatefulReminderService({
  jobs = [statefulJob()],
  now = "2026-08-12T00:00:00.000Z",
  leadHours = 3,
  runtimeVersion = 1,
  activationMode = "live",
  receiptSendable = true,
  afterClaim,
  afterRead,
} = {}) {
  const calls = {
    rpc: [],
    release: [],
    finalize: [],
    provider: 0,
    providerPayloads: [],
    failures: [],
  }
  const state = {
    jobs,
    now: new Date(now),
    settings: { enabled: true, leadHours },
    runtimeVersion,
    activation: { mode: activationMode },
    receipt: { sendable: receiptSendable },
    transitions: [],
  }
  const date = (value) => new Date(value).getTime()
  const sourceFor = (job) => job.messageKind === "appointment_reminder"
    ? LEGACY_SOURCE
    : Object.freeze({
      ...OBSERVATION_SOURCE,
      sessionSourceRevision: Object.freeze({
        authority: "normalized",
        sessionId: "00000000-0000-4000-8000-000000000110",
        revision: job.sourceRevisionAtRead,
      }),
      teacherName: `담당 ${job.sourceRevisionAtRead}`,
    })
  const rawClaim = (job) => job.messageKind === "appointment_reminder"
    ? Object.freeze({
      jobId: job.jobId,
      appointmentId: job.appointmentId,
      claimToken: job.claimToken,
      sourceRevision: job.sourceRevision,
      scheduledFor: job.scheduledFor,
      requestKey: job.jobId,
    })
    : Object.freeze({
      jobId: job.jobId,
      messageKind: "observation_reminder",
      appointmentId: job.appointmentId,
      observationId: job.observationId,
      claimToken: job.claimToken,
      sourceRevision: job.sourceRevision,
      scheduledFor: job.scheduledFor,
      requestKey: job.jobId,
    })
  const jobFor = (args) => state.jobs.find((job) => (
    job.jobId === args.p_job_id && job.claimToken === args.p_claim_token
  ))
  const expectedDue = (job) => new Date(
    date(job.scheduledFor) - state.settings.leadHours * 60 * 60 * 1000,
  ).toISOString()
  const client = {
    rpc(name, args = {}) {
      calls.rpc.push({ name, args })
      if (name === "claim_registration_customer_reminder_job_v1") {
        const job = state.jobs.find((candidate) => (
          candidate.status === "pending"
          && date(candidate.dueAt) <= state.now.getTime()
          && date(candidate.availableAt) <= state.now.getTime()
          && (candidate.messageKind !== "observation_reminder" || state.runtimeVersion === 1)
        ))
        if (!job) return rpcResponse(null)
        job.status = "claimed"
        job.availableAt = null
        state.transitions.push(`claim:${job.jobId}`)
        afterClaim?.({ state, job })
        return rpcResponse(rawClaim(job))
      }
      if (name === "read_registration_customer_reminder_source_v1") {
        const job = jobFor(args)
        if (!job || job.status !== "claimed") {
          calls.failures.push("read:claim_invalid")
          return rpcResponse(null, { message: "registration_customer_reminder_claim_invalid" })
        }
        if (job.messageKind === "observation_reminder" && state.runtimeVersion !== 1) {
          calls.failures.push("read:runtime_inactive")
          return rpcResponse(null, { message: "registration_observation_runtime_inactive" })
        }
        if (job.bookingFactChanged) {
          calls.failures.push("read:booking_fact_changed")
          return rpcResponse(null, { message: "registration_customer_reminder_booking_fact_changed" })
        }
        const source = sourceFor(job)
        state.transitions.push(`read:${job.jobId}:${job.sourceRevisionAtRead}`)
        afterRead?.({ state, job, source })
        return rpcResponse(source)
      }
      if (name === "begin_registration_customer_reminder_dispatch_v1") {
        const job = jobFor(args)
        if (!job || job.status !== "claimed") {
          calls.failures.push("begin:claim_invalid")
          return rpcResponse(null, { message: "registration_customer_reminder_claim_invalid" })
        }
        state.transitions.push(`begin:${job.jobId}`)
        if (job.existingStatus) {
          return rpcResponse({
            allowed: false,
            messageId: MESSAGE_ID,
            dispatchToken: DISPATCH_TOKEN,
            currentStatus: job.existingStatus,
          })
        }
        if (job.messageKind === "observation_reminder" && state.runtimeVersion !== 1) {
          job.status = "canceled"
          job.lastErrorCode = "runtime_inactive"
          return rpcResponse({
            allowed: false,
            messageId: null,
            dispatchToken: null,
            currentStatus: "runtime_inactive",
          })
        }
        if (job.messageKind === "observation_reminder" && state.activation.mode === "off") {
          job.status = "canceled"
          job.lastErrorCode = "activation_off"
          calls.failures.push("begin:activation_off")
          return rpcResponse(null, { message: "registration_customer_reminder_claim_invalid" })
        }
        if (job.messageKind === "observation_reminder" && !state.receipt.sendable) {
          calls.failures.push("begin:receipt_drift")
          return rpcResponse(null, { message: "registration_customer_reminder_not_ready" })
        }
        if (job.dueAt !== expectedDue(job)) {
          job.dueAt = expectedDue(job)
          job.availableAt = job.dueAt
          job.status = "pending"
          job.lastErrorCode = "settings_changed"
          return rpcResponse({
            allowed: false,
            messageId: null,
            dispatchToken: null,
            currentStatus: "settings_refresh_required",
          })
        }
        if (job.messageKind === "observation_reminder" && job.lastReadRevision !== job.sourceRevisionAtRead) {
          job.lastReadRevision = job.sourceRevisionAtRead
          if (job.sourceRefreshCount === 0) {
            job.sourceRefreshCount = 1
            return rpcResponse({
              allowed: false,
              messageId: null,
              dispatchToken: null,
              currentStatus: "refresh_required",
            })
          }
          job.status = "source_dirty"
          job.lastErrorCode = "source_revision_unstable"
          return rpcResponse({
            allowed: false,
            messageId: null,
            dispatchToken: null,
            currentStatus: "source_dirty",
          })
        }
        return rpcResponse({
          allowed: true,
          messageId: MESSAGE_ID,
          dispatchToken: DISPATCH_TOKEN,
          currentStatus: "pending",
        })
      }
      if (name === "release_registration_customer_reminder_job_v1") {
        calls.release.push(args)
        return rpcResponse({ released: true })
      }
      if (name === "finalize_registration_customer_reminder_dispatch_v1") {
        calls.finalize.push(args)
        const job = state.jobs.find((candidate) => candidate.status === "claimed")
        if (job) job.status = "delivery_unknown"
        return rpcResponse({ ok: true })
      }
      throw new Error(`unexpected rpc: ${name}`)
    },
  }
  const handlers = reminderRoute.createProductionRegistrationCustomerReminderRouteHandlers({
    client,
    environment: productionEnvironment(),
    async providerFetch(_url, init) {
      calls.provider += 1
      calls.providerPayloads.push(JSON.parse(init.body))
      throw new Error("test provider boundary")
    },
  })
  const run = () => handlers.worker(new Request("http://localhost/worker", {
    method: "POST",
    headers: { authorization: "Bearer worker-secret" },
  }))
  return {
    calls,
    state,
    run,
    advanceTo(value) {
      state.now = new Date(value)
      state.transitions.push(`clock:${state.now.toISOString()}`)
    },
  }
}

function rpcNames(calls) {
  return calls.rpc.map(({ name }) => name)
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

test("begin parser accepts every Task 3 discriminated result shape and rejects cross-shape markers", () => {
  const parse = reminderRoute.parseRegistrationCustomerReminderBegin
  const terminal = [
    "canceled",
    "refresh_required",
    "settings_refresh_required",
    "runtime_inactive",
    "source_dirty",
  ]
  for (const currentStatus of terminal) {
    assert.deepEqual(parse({
      allowed: false,
      messageId: null,
      dispatchToken: null,
      currentStatus,
    }), {
      allowed: false,
      messageId: null,
      dispatchToken: null,
      currentStatus,
    })
  }
  for (const currentStatus of ["pending", "accepted", "unknown", "failed_hold", "duplicate_locked"]) {
    assert.deepEqual(parse({
      allowed: false,
      messageId: MESSAGE_ID,
      dispatchToken: DISPATCH_TOKEN,
      currentStatus,
    }), {
      allowed: false,
      messageId: MESSAGE_ID,
      dispatchToken: DISPATCH_TOKEN,
      currentStatus,
    })
  }
  assert.deepEqual(parse({
    allowed: true,
    messageId: MESSAGE_ID,
    dispatchToken: DISPATCH_TOKEN,
    currentStatus: "pending",
  }), {
    allowed: true,
    messageId: MESSAGE_ID,
    dispatchToken: DISPATCH_TOKEN,
    currentStatus: "pending",
  })
  for (const malformed of [
    { allowed: true, messageId: MESSAGE_ID, dispatchToken: DISPATCH_TOKEN, currentStatus: "accepted" },
    { allowed: false, messageId: MESSAGE_ID, dispatchToken: DISPATCH_TOKEN, currentStatus: "refresh_required" },
    { allowed: false, messageId: null, dispatchToken: null, currentStatus: "duplicate_locked" },
    { allowed: true, messageId: null, dispatchToken: null, currentStatus: "pending" },
  ]) {
    assert.throws(() => parse(malformed))
  }
})

test("RPC failure normalization accepts only exact terminal literals in their expected boundary", () => {
  const normalize = reminderRoute.normalizeRegistrationCustomerReminderRpcFailure
  assert.throws(
    () => normalize({ message: "registration_customer_message_source_ineligible" }, {
      sourceIneligibleIsTerminal: true,
    }),
    { name: "RegistrationCustomerReminderSourceIneligibleError" },
  )
  assert.throws(
    () => normalize({ message: "registration_customer_message_source_ineligible_suffix" }, {
      sourceIneligibleIsTerminal: true,
    }),
    /registration_customer_reminder_runtime_unavailable/,
  )
  for (const [message, name] of [
    ["registration_customer_reminder_booking_fact_changed", "RegistrationCustomerReminderBookingFactChangedError"],
    ["registration_observation_runtime_inactive", "RegistrationObservationRuntimeInactiveError"],
  ]) {
    assert.throws(
      () => normalize({ message }, { observationSourceRead: true }),
      { name },
    )
    assert.throws(
      () => normalize({ message: `${message}_suffix` }, { observationSourceRead: true }),
      /registration_customer_reminder_runtime_unavailable/,
    )
    assert.throws(
      () => normalize({ message }, { observationSourceRead: false }),
      /registration_customer_reminder_runtime_unavailable/,
    )
  }
  for (const [message, status] of [
    ["registration_customer_reminder_not_ready", 409],
    ["registration_customer_reminder_settings_conflict", 409],
    ["registration_customer_reminder_settings_invalid", 400],
  ]) {
    assert.throws(
      () => normalize({ message }, { settingsMutation: true }),
      (error) => error.status === status,
    )
    assert.throws(
      () => normalize({ message: `${message}_suffix` }, { settingsMutation: true }),
      (error) => error.status === 503,
    )
  }
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

test("production refresh re-reads once, mutates between begin attempts, and sends only the second payload", async () => {
  const scenario = createStatefulReminderService({
    afterRead({ state, job }) {
      if (job.jobId === JOB_ID && job.sourceRevisionAtRead === 7) {
        job.sourceRevisionAtRead = 8
        state.transitions.push("source:after_read:8")
      }
    },
  })

  const response = await scenario.run()

  assert.equal((await response.json()).outcome, "unknown")
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "finalize_registration_customer_reminder_dispatch_v1",
  ])
  assert.deepEqual(
    scenario.calls.rpc.filter(({ name }) => name === "read_registration_customer_reminder_source_v1")
      .map(({ args }) => args),
    [
      { p_job_id: JOB_ID, p_claim_token: CLAIM_TOKEN },
      { p_job_id: JOB_ID, p_claim_token: CLAIM_TOKEN },
    ],
  )
  assert.deepEqual(
    scenario.calls.rpc.filter(({ name }) => name === "begin_registration_customer_reminder_dispatch_v1")
      .map(({ args }) => ({
        jobId: args.p_job_id,
        claimToken: args.p_claim_token,
        keys: Object.keys(args).sort(),
      })),
    [
      { jobId: JOB_ID, claimToken: CLAIM_TOKEN, keys: ["p_claim_token", "p_contract", "p_job_id", "p_readiness_contract"] },
      { jobId: JOB_ID, claimToken: CLAIM_TOKEN, keys: ["p_claim_token", "p_contract", "p_job_id", "p_readiness_contract"] },
    ],
  )
  assert.equal(scenario.calls.provider, 1)
  assert.equal(scenario.calls.finalize.length, 1)
  assert.equal(JSON.stringify(scenario.calls.providerPayloads[0]).includes("담당 8"), true)
  assert.equal(JSON.stringify(scenario.calls.providerPayloads[0]).includes("담당 7"), false)
  assert.deepEqual(scenario.state.transitions, [
    `claim:${JOB_ID}`,
    `read:${JOB_ID}:7`,
    "source:after_read:8",
    `begin:${JOB_ID}`,
    `read:${JOB_ID}:8`,
    `begin:${JOB_ID}`,
  ])
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

test("production second drift stops after two reads and two begin attempts without a third read or provider", async () => {
  const scenario = createStatefulReminderService({
    afterRead({ state, job }) {
      job.sourceRevisionAtRead += 1
      state.transitions.push(`source:after_read:${job.sourceRevisionAtRead}`)
    },
  })

  const response = await scenario.run()

  assert.deepEqual(await response.json(), {
    ok: true,
    processed: true,
    providerAttempted: false,
    outcome: "skipped",
  })
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
  ])
  assert.equal(scenario.calls.provider, 0)
  assert.equal(scenario.calls.finalize.length, 0)
  assert.deepEqual(scenario.state.transitions, [
    `claim:${JOB_ID}`,
    `read:${JOB_ID}:7`,
    "source:after_read:8",
    `begin:${JOB_ID}`,
    `read:${JOB_ID}:8`,
    "source:after_read:9",
    `begin:${JOB_ID}`,
  ])
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
    "canceled",
    "runtime_inactive",
    "settings_refresh_required",
    "source_dirty",
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

test("production consumer treats DB claim:null as idle without a source read, marker, or provider", async () => {
  const scenario = createStatefulReminderService({ jobs: [] })
  const response = await scenario.run()

  assert.deepEqual(await response.json(), {
    ok: true,
    processed: false,
    providerAttempted: false,
    outcome: "idle",
  })
  assert.deepEqual(rpcNames(scenario.calls), ["claim_registration_customer_reminder_job_v1"])
  assert.equal(scenario.calls.provider, 0)
  assert.equal(scenario.calls.finalize.length, 0)
})

test("stateful production RPC boundary preserves legacy delivery while runtime flips at observation claim, read, and begin", async () => {
  const afterReadJob = statefulJob({
    jobId: SECOND_JOB_ID,
    claimToken: SECOND_CLAIM_TOKEN,
  })
  const legacyJob = statefulJob({
    jobId: LEGACY_JOB_ID,
    messageKind: "appointment_reminder",
    claimToken: LEGACY_CLAIM_TOKEN,
  })
  const scenario = createStatefulReminderService({
    jobs: [statefulJob(), afterReadJob, legacyJob],
    runtimeVersion: 0,
    afterClaim({ state, job }) {
      if (job.jobId === JOB_ID) {
        state.runtimeVersion = 0
        state.transitions.push("runtime:after_claim:0")
      }
    },
    afterRead({ state, job }) {
      if (job.jobId === SECOND_JOB_ID) {
        state.runtimeVersion = 0
        state.transitions.push("runtime:after_read:0")
      }
    },
  })

  const legacy = await scenario.run()
  scenario.state.runtimeVersion = 1
  scenario.state.transitions.push("runtime:before_observation_claim:1")
  const afterClaim = await scenario.run()
  scenario.state.runtimeVersion = 1
  scenario.state.transitions.push("runtime:before_observation_read:1")
  const afterRead = await scenario.run()

  assert.equal((await legacy.json()).outcome, "unknown")
  assert.equal((await afterClaim.json()).outcome, "skipped")
  assert.equal((await afterRead.json()).outcome, "skipped")
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "finalize_registration_customer_reminder_dispatch_v1",
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "release_registration_customer_reminder_job_v1",
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
  ])
  assert.deepEqual(
    scenario.calls.rpc.filter(({ name }) => name === "read_registration_customer_reminder_source_v1")
      .map(({ args }) => args),
    [
      { p_job_id: LEGACY_JOB_ID, p_claim_token: LEGACY_CLAIM_TOKEN },
      { p_job_id: JOB_ID, p_claim_token: CLAIM_TOKEN },
      { p_job_id: SECOND_JOB_ID, p_claim_token: SECOND_CLAIM_TOKEN },
    ],
  )
  assert.deepEqual(scenario.calls.release, [{
    p_job_id: JOB_ID,
    p_claim_token: CLAIM_TOKEN,
    p_error_code: "runtime_inactive",
  }])
  assert.equal(scenario.calls.provider, 1)
  assert.equal(scenario.calls.finalize.length, 1)
  assert.deepEqual(scenario.state.transitions, [
    `claim:${LEGACY_JOB_ID}`,
    `read:${LEGACY_JOB_ID}:7`,
    `begin:${LEGACY_JOB_ID}`,
    "runtime:before_observation_claim:1",
    `claim:${JOB_ID}`,
    "runtime:after_claim:0",
    "runtime:before_observation_read:1",
    `claim:${SECOND_JOB_ID}`,
    `read:${SECOND_JOB_ID}:7`,
    "runtime:after_read:0",
    `begin:${SECOND_JOB_ID}`,
  ])
})

test("deferred booking-fact change at the production read boundary releases terminally provider-zero", async () => {
  const scenario = createStatefulReminderService({
    afterClaim({ state, job }) {
      job.bookingFactChanged = true
      state.transitions.push("booking:after_claim:changed")
    },
  })
  const response = await scenario.run()

  assert.equal((await response.json()).outcome, "skipped")
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "release_registration_customer_reminder_job_v1",
  ])
  assert.deepEqual(scenario.calls.release, [{
    p_job_id: JOB_ID,
    p_claim_token: CLAIM_TOKEN,
    p_error_code: "booking_fact_changed",
  }])
  assert.deepEqual(scenario.calls.failures, ["read:booking_fact_changed"])
  assert.equal(scenario.calls.provider, 0)
  assert.equal(scenario.calls.finalize.length, 0)
})

test("activation OFF after read cancels the claimed observation at begin without provider evidence", async () => {
  const scenario = createStatefulReminderService({
    afterRead({ state, job }) {
      state.activation.mode = "off"
      job.status = "canceled"
      job.lastErrorCode = "activation_off"
      state.transitions.push("activation:after_read:off")
    },
  })
  const response = await scenario.run()

  assert.equal((await response.json()).outcome, "held")
  assert.equal(scenario.state.activation.mode, "off")
  assert.deepEqual(scenario.calls.failures, ["begin:claim_invalid"])
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "release_registration_customer_reminder_job_v1",
  ])
  assert.equal(scenario.calls.provider, 0)
  assert.equal(scenario.calls.finalize.length, 0)
})

test("receipt drift after read reaches the distinct readiness failure without provider evidence", async () => {
  const scenario = createStatefulReminderService({
    afterRead({ state }) {
      state.receipt.sendable = false
      state.transitions.push("receipt:after_read:not_sendable")
    },
  })
  const response = await scenario.run()

  assert.equal((await response.json()).outcome, "held")
  assert.equal(scenario.state.receipt.sendable, false)
  assert.deepEqual(scenario.calls.failures, ["begin:receipt_drift"])
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "release_registration_customer_reminder_job_v1",
  ])
  assert.equal(scenario.calls.provider, 0)
  assert.equal(scenario.calls.finalize.length, 0)
})

test("lead-hours change after claim recomputes due, defers the next claim, and processes once at the new clock", async () => {
  const job = statefulJob({
    scheduledFor: "2026-08-13T12:00:00.000Z",
    dueAt: "2026-08-12T00:00:00.000Z",
  })
  const scenario = createStatefulReminderService({
    jobs: [job],
    leadHours: 36,
    afterClaim({ state }) {
      if (state.settings.leadHours === 36) {
        state.settings.leadHours = 3
        state.transitions.push("settings:after_claim:lead_hours_3")
      }
    },
  })

  const first = await scenario.run()
  const immediate = await scenario.run()
  scenario.advanceTo("2026-08-13T09:00:00.000Z")
  const recomputedDue = await scenario.run()

  assert.equal((await first.json()).outcome, "skipped")
  assert.equal((await immediate.json()).outcome, "idle")
  assert.equal((await recomputedDue.json()).outcome, "unknown")
  assert.deepEqual({
    dueAt: job.dueAt,
    availableAt: job.availableAt,
    status: job.status,
    lastErrorCode: job.lastErrorCode,
  }, {
    dueAt: "2026-08-13T09:00:00.000Z",
    availableAt: null,
    status: "delivery_unknown",
    lastErrorCode: "settings_changed",
  })
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "claim_registration_customer_reminder_job_v1",
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "finalize_registration_customer_reminder_dispatch_v1",
  ])
  assert.equal(scenario.calls.provider, 1)
  assert.equal(scenario.calls.finalize.length, 1)
})

test("canonical existing-message accepted and duplicate locks are parsed before provider-zero exit", async () => {
  for (const existingStatus of ["accepted", "duplicate_locked"]) {
    const scenario = createStatefulReminderService({
      jobs: [statefulJob({ existingStatus })],
    })
    const response = await scenario.run()

    assert.equal((await response.json()).outcome, "skipped", existingStatus)
    const begin = scenario.calls.rpc.find(({ name }) => (
      name === "begin_registration_customer_reminder_dispatch_v1"
    ))
    assert.deepEqual(
      {
        jobId: begin.args.p_job_id,
        claimToken: begin.args.p_claim_token,
        keys: Object.keys(begin.args).sort(),
      },
      {
        jobId: JOB_ID,
        claimToken: CLAIM_TOKEN,
        keys: ["p_claim_token", "p_contract", "p_job_id", "p_readiness_contract"],
      },
      existingStatus,
    )
    assert.equal(scenario.calls.provider, 0, existingStatus)
    assert.equal(scenario.calls.finalize.length, 0, existingStatus)
  }
})

test("unknown observation dispatch is never retried by a second worker invocation", async () => {
  const scenario = createStatefulReminderService()
  const first = await scenario.run()
  const second = await scenario.run()

  assert.equal((await first.json()).outcome, "unknown")
  assert.equal((await second.json()).outcome, "idle")
  assert.deepEqual(rpcNames(scenario.calls), [
    "claim_registration_customer_reminder_job_v1",
    "read_registration_customer_reminder_source_v1",
    "begin_registration_customer_reminder_dispatch_v1",
    "finalize_registration_customer_reminder_dispatch_v1",
    "claim_registration_customer_reminder_job_v1",
  ])
  assert.equal(scenario.calls.provider, 1)
  assert.equal(scenario.calls.finalize.length, 1)
})
