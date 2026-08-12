import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  createProductionRegistrationCustomerReminderRouteHandlers,
} from "../src/features/tasks/server/registration-customer-reminder-route.ts"
import { SOLAPI_SEND_MANY_URL } from "../src/features/tasks/server/registration-customer-message-solapi.ts"

const PACKAGE_URL = new URL("../package.json", import.meta.url)
const JOB_ID = "90000000-0000-4000-8000-000000000101"
const APPOINTMENT_ID = "90000000-0000-4000-8000-000000000102"
const OBSERVATION_ID = "90000000-0000-4000-8000-000000000103"
const CLAIM_TOKEN = "90000000-0000-4000-8000-000000000104"
const REQUEST_KEY = "90000000-0000-4000-8000-000000000105"
const MESSAGE_ID = "90000000-0000-4000-8000-000000000106"
const DISPATCH_TOKEN = "90000000-0000-4000-8000-000000000107"
const SOURCE_TASK_ID = "90000000-0000-4000-8000-000000000108"
const SOURCE_TRACK_ID = "90000000-0000-4000-8000-000000000109"
const SOURCE_SESSION_ID = "90000000-0000-4000-8000-000000000110"
const FIXED_OFF_ENV = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "https://provider-zero.example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "provider-zero-service-role-key",
  REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET: "provider-zero-worker-secret",
  SOLAPI_API_KEY: "provider-zero-api-key",
  SOLAPI_API_SECRET: "provider-zero-api-secret",
  SOLAPI_KAKAO_PF_ID: "provider-zero-pf-id",
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "provider-zero-appointment-template",
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "provider-zero-observation-reminder-template",
  REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "provider-zero-recipient-pepper",
})

function rpcResult(data, error = null) {
  return { data, error }
}

function exactRpcResult(result, calls, name, args) {
  return Object.freeze({
    abortSignal(signal) {
      calls.rpcChains.push({ name, args, stage: "abortSignal", signal })
      return this
    },
    retry(value) {
      calls.rpcChains.push({ name, args, stage: "retry", value })
      return Promise.resolve(result)
    },
  })
}

function sourceFor(state) {
  return Object.freeze({
    messageKind: "observation_reminder",
    sourceId: OBSERVATION_ID,
    taskId: SOURCE_TASK_ID,
    trackId: SOURCE_TRACK_ID,
    observationId: OBSERVATION_ID,
    appointmentId: APPOINTMENT_ID,
    sourceRevision: 4,
    sessionSourceRevision: Object.freeze({
      authority: "normalized",
      sessionId: SOURCE_SESSION_ID,
      revision: state.currentRevision,
    }),
    bookingFactHash: state.bookingHash,
    studentName: "김팁스",
    parentPhoneDigits: state.currentPhone,
    subject: "수학",
    className: "중등 수학 A",
    scheduledAt: "2026-08-12T03:00:00.000Z",
    place: "201호",
    campus: "본관",
    teacherName: `담당 ${state.currentRevision}`,
  })
}

function expectedDueAt(leadHours) {
  return new Date(
    Date.parse("2026-08-12T03:00:00.000Z") - leadHours * 60 * 60 * 1_000,
  ).toISOString()
}

function acceptedProviderResponse() {
  return Response.json({
    groupInfo: { groupId: "provider-zero-group" },
    messageList: [{
      messageId: "provider-zero-message",
      statusCode: "2000",
      statusMessage: "synthetic accepted",
    }],
    failedMessageList: [],
  })
}

/**
 * This fake represents only DB-owned RPC lifecycle decisions. The production
 * route, worker, catalog, source resolver, and SOLAPI adapter remain real.
 */
function createDbOwnedLifecycleScenario(options = {}) {
  const calls = {
    fetches: [],
    gates: [],
    markerCount: 0,
    providerFetchInjected: true,
    rpc: [],
    rpcChains: [],
  }
  const state = {
    activation: {
      activatedAt: "2026-08-11T00:00:00.000Z",
      mode: options.activationMode ?? "live",
      verificationTaskId: options.verificationTaskId ?? SOURCE_TASK_ID,
    },
    bookingHash: options.bookingHash ?? "b".repeat(64),
    claimedBookingHash: options.claimedBookingHash ?? "b".repeat(64),
    currentPhone: options.currentPhone ?? "01012345678",
    currentRevision: options.currentRevision ?? 7,
    dueAt: options.dueAt ?? expectedDueAt(options.leadHours ?? 3),
    job: {
      claimed: false,
      refreshCount: 0,
      status: "pending",
    },
    leadHours: options.leadHours ?? 3,
    operationalState: options.operationalState ?? "scheduled",
    receipt: {
      recipientHash: options.receiptRecipientHash ?? "recipient-hash-v1",
      recordedAt: options.receiptRecordedAt ?? "2026-08-11T01:00:00.000Z",
      sendable: options.receiptSendable ?? true,
      taskId: options.receiptTaskId ?? SOURCE_TASK_ID,
    },
    runtimeVersion: options.runtimeVersion ?? 1,
  }

  const claim = () => Object.freeze({
    jobId: JOB_ID,
    messageKind: "observation_reminder",
    appointmentId: APPOINTMENT_ID,
    observationId: OBSERVATION_ID,
    claimToken: CLAIM_TOKEN,
    sourceRevision: 4,
    scheduledFor: "2026-08-12T03:00:00.000Z",
    requestKey: REQUEST_KEY,
  })
  const result = (data, error = null) => rpcResult(data, error)
  const lifecycleGate = (name, condition) => {
    calls.gates.push(name)
    return condition
  }
  const client = Object.freeze({
    rpc(name, args = {}) {
      calls.rpc.push({ name, args })
      let response
      if (name === "claim_registration_customer_reminder_job_v1") {
        const schedulable = lifecycleGate(
          `claim:operational:${state.operationalState}`,
          state.operationalState === "scheduled",
        )
        const runtimeReady = lifecycleGate("claim:runtime", state.runtimeVersion === 1)
        const bookingCurrent = lifecycleGate(
          "claim:booking-hash",
          state.claimedBookingHash === state.bookingHash,
        )
        if (!schedulable || !runtimeReady || !bookingCurrent || state.job.status !== "pending") {
          response = result(null)
        } else {
          state.job.claimed = true
          state.job.status = "claimed"
          state.job.claimedBookingHash = state.bookingHash
          state.job.claimedDueAt = state.dueAt
          options.afterClaim?.({ state })
          response = result(claim())
        }
      } else if (name === "read_registration_customer_reminder_source_v1") {
        const exactClaim = args.p_job_id === JOB_ID && args.p_claim_token === CLAIM_TOKEN
        if (!exactClaim || !state.job.claimed || state.job.status !== "claimed") {
          response = result(null, { message: "registration_customer_reminder_claim_invalid" })
        } else if (!lifecycleGate("read:runtime", state.runtimeVersion === 1)) {
          response = result(null, { message: "registration_observation_runtime_inactive" })
        } else if (!lifecycleGate(
          "read:booking-hash",
          state.job.claimedBookingHash === state.bookingHash,
        )) {
          response = result(null, { message: "registration_customer_reminder_booking_fact_changed" })
        } else if (!lifecycleGate(
          `read:operational:${state.operationalState}`,
          state.operationalState === "scheduled",
        )) {
          response = result(null, { message: "registration_customer_message_source_ineligible" })
        } else {
          state.job.readBookingHash = state.bookingHash
          state.job.readPhone = state.currentPhone
          state.job.readRevision = state.currentRevision
          const source = sourceFor(state)
          options.afterRead?.({ state })
          response = result(source)
        }
      } else if (name === "begin_registration_customer_reminder_dispatch_v1") {
        const exactClaim = args.p_job_id === JOB_ID && args.p_claim_token === CLAIM_TOKEN
        const refresh = (currentStatus) => result({
          allowed: false,
          messageId: null,
          dispatchToken: null,
          currentStatus,
        })
        if (!exactClaim || !state.job.claimed || state.job.status !== "claimed") {
          response = result(null, { message: "registration_customer_reminder_claim_invalid" })
        } else if (!lifecycleGate("begin:runtime", state.runtimeVersion === 1)) {
          response = refresh("runtime_inactive")
        } else if (!lifecycleGate(
          `begin:activation:${state.activation.mode}`,
          state.activation.mode === "live",
        )) {
          response = refresh("canceled")
        } else if (!lifecycleGate("begin:receipt", state.receipt.sendable)) {
          response = refresh("canceled")
        } else if (!lifecycleGate(
          "begin:verification-after-activation",
          Date.parse(state.receipt.recordedAt) >= Date.parse(state.activation.activatedAt),
        )) {
          response = refresh("canceled")
        } else if (!lifecycleGate(
          "begin:verification-task",
          state.receipt.taskId === state.activation.verificationTaskId,
        )) {
          response = refresh("canceled")
        } else if (!lifecycleGate(
          "begin:receipt-recipient-hash",
          state.receipt.recipientHash === "recipient-hash-v1",
        )) {
          response = refresh("canceled")
        } else if (!lifecycleGate(
          "begin:lead-hours",
          state.job.claimedDueAt === expectedDueAt(state.leadHours),
        )) {
          state.job.status = "pending"
          state.dueAt = expectedDueAt(state.leadHours)
          response = refresh("settings_refresh_required")
        } else if (!lifecycleGate(
          "begin:booking-hash",
          state.job.readBookingHash === state.bookingHash,
        )) {
          response = refresh("source_dirty")
        } else if (!lifecycleGate(
          "begin:canonical-phone",
          state.job.readPhone === state.currentPhone,
        )) {
          response = refresh("source_dirty")
        } else if (!lifecycleGate(
          "begin:source-revision",
          state.job.readRevision === state.currentRevision,
        )) {
          state.job.refreshCount += 1
          response = refresh(state.job.refreshCount === 1 ? "refresh_required" : "source_dirty")
        } else {
          calls.markerCount += 1
          state.job.status = "dispatching"
          response = result({
            allowed: true,
            messageId: MESSAGE_ID,
            dispatchToken: DISPATCH_TOKEN,
            currentStatus: "pending",
          })
        }
      } else if (name === "release_registration_customer_reminder_job_v1") {
        state.job.status = "released"
        response = result({ released: true })
      } else if (name === "finalize_registration_customer_reminder_dispatch_v1") {
        state.job.status = args.p_result === "accepted" ? "accepted" : "delivery_unknown"
        response = result({ finalized: true })
      } else {
        throw new Error(`unexpected RPC:${name}`)
      }
      return exactRpcResult(response, calls, name, args)
    },
  })
  const providerFetch = async (url, init) => {
    calls.fetches.push({ body: String(init.body), url: String(url) })
    assert.equal(String(url), "https://api.solapi.com/messages/v4/send-many/detail")
    if (options.providerMode === "throw") throw new Error("synthetic_provider_transport_unknown")
    return acceptedProviderResponse()
  }
  const production = createProductionRegistrationCustomerReminderRouteHandlers({
    client,
    environment: FIXED_OFF_ENV,
    providerFetch,
  })
  return Object.freeze({
    calls,
    production,
    run: () => production.worker(new Request(
      "http://localhost/api/solapi/registration/reminders/worker",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${FIXED_OFF_ENV.REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET}` },
      },
    )),
    state,
  })
}

function assertExactRpcTransport(scenario) {
  assert.equal(scenario.calls.rpc.length > 0, true)
  assert.equal(scenario.calls.rpcChains.length, scenario.calls.rpc.length * 2)
  for (let index = 0; index < scenario.calls.rpcChains.length; index += 2) {
    const abort = scenario.calls.rpcChains[index]
    const retry = scenario.calls.rpcChains[index + 1]
    assert.equal(abort.stage, "abortSignal")
    assert.equal(abort.signal instanceof AbortSignal, true)
    assert.equal(retry.stage, "retry")
    assert.equal(retry.value, false)
    assert.equal(abort.name, retry.name)
  }
}

async function assertProviderZero(name, scenario, expectedGate) {
  const markerBefore = scenario.calls.markerCount
  const response = await scenario.run()
  const result = await response.json()
  assert.equal(response.status, 200, name)
  assert.equal(typeof scenario.production.worker, "function", name)
  assert.equal(scenario.calls.providerFetchInjected, true, name)
  assert.equal(scenario.calls.fetches.length, 0, name)
  assert.equal(scenario.calls.markerCount - markerBefore, 0, name)
  assert.equal(scenario.calls.gates.includes(expectedGate), true, name)
  assert.equal(result.providerAttempted, false, name)
  assertExactRpcTransport(scenario)
}

test("cumulative SOLAPI verification exposes the dry-run plan command", async () => {
  // Break caught: the cumulative SOLAPI plan cannot be run without writing to a DB.
  const packageJson = JSON.parse(await readFile(PACKAGE_URL, "utf8"))
  assert.equal(
    packageJson.scripts["verify:registration-observation:solapi:plan"],
    "node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --focus solapi",
  )
})

test("DB-owned terminal and runtime gates stay provider-zero through the production automatic assembly", async () => {
  // Break caught: allowing a terminal observation or inactive runtime past the real worker's begin gate sends a customer message.
  const cases = [
    ["OFF", { activationMode: "off" }, "begin:activation:off"],
    ["canceled", { operationalState: "canceled" }, "claim:operational:canceled"],
    ["no-show", { operationalState: "no_show" }, "claim:operational:no_show"],
    ["completed", { operationalState: "completed" }, "claim:operational:completed"],
    ["runtime zero at claim", { runtimeVersion: 0 }, "claim:runtime"],
    ["runtime Gate B-R flips after claim", {
      afterClaim({ state }) { state.runtimeVersion = 0 },
    }, "read:runtime"],
    ["runtime Gate B-R flips after read", {
      afterRead({ state }) { state.runtimeVersion = 0 },
    }, "begin:runtime"],
    ["appointment verification", { receiptSendable: false }, "begin:receipt"],
  ]
  for (const [name, options, expectedGate] of cases) {
    await assertProviderZero(name, createDbOwnedLifecycleScenario(options), expectedGate)
  }
})

test("DB-owned observation readiness, cutoff, and identity drifts stay provider-zero", async () => {
  // Break caught: a stale activation, receipt, cutoff, booking, revision, or canonical phone reaches send-many before begin rejects it.
  const cases = [
    ["receipt predates activation", {
      receiptRecordedAt: "2026-08-10T23:59:59.000Z",
    }, "begin:verification-after-activation"],
    ["verification task restart", {
      receiptTaskId: "90000000-0000-4000-8000-000000000199",
    }, "begin:verification-task"],
    ["verification recipient hash restart", {
      receiptRecipientHash: "recipient-hash-v2",
    }, "begin:receipt-recipient-hash"],
    ["booking hash drift at claim", {
      claimedBookingHash: "c".repeat(64),
    }, "claim:booking-hash"],
    ["booking hash drift after claim", {
      afterClaim({ state }) { state.bookingHash = "c".repeat(64) },
    }, "read:booking-hash"],
    ["booking hash drift after read", {
      afterRead({ state }) { state.bookingHash = "c".repeat(64) },
    }, "begin:booking-hash"],
    ["canonical phone changes after read", {
      afterRead({ state }) { state.currentPhone = "01098765432" },
    }, "begin:canonical-phone"],
    ["lead hours changes while claimed", {
      leadHours: 36,
      afterClaim({ state }) { state.leadHours = 3 },
    }, "begin:lead-hours"],
  ]
  for (const [name, options, expectedGate] of cases) {
    await assertProviderZero(name, createDbOwnedLifecycleScenario(options), expectedGate)
  }
})

test("double revision drift gets only two real source reads and remains provider-zero", async () => {
  // Break caught: a second stale source refresh is sent instead of being rejected as source_dirty.
  const scenario = createDbOwnedLifecycleScenario({
    afterRead({ state }) { state.currentRevision += 1 },
  })
  await assertProviderZero("double revision drift", scenario, "begin:source-revision")
  assert.deepEqual(
    scenario.calls.rpc.map(({ name }) => name),
    [
      "claim_registration_customer_reminder_job_v1",
      "read_registration_customer_reminder_source_v1",
      "begin_registration_customer_reminder_dispatch_v1",
      "read_registration_customer_reminder_source_v1",
      "begin_registration_customer_reminder_dispatch_v1",
    ],
  )
})

test("one refreshed observation payload crosses the real SOLAPI adapter exactly once with an injected fake provider", async () => {
  // Break caught: the worker sends the stale first source, skips the refresh, or bypasses the injected adapter transport.
  let changed = false
  const scenario = createDbOwnedLifecycleScenario({
    afterRead({ state }) {
      if (!changed) {
        changed = true
        state.currentRevision = 8
      }
    },
  })
  const markerBefore = scenario.calls.markerCount
  const response = await scenario.run()
  assert.deepEqual(await response.json(), {
    ok: true,
    processed: true,
    providerAttempted: true,
    outcome: "accepted",
  })
  assert.equal(SOLAPI_SEND_MANY_URL, "https://api.solapi.com/messages/v4/send-many/detail")
  assert.equal(scenario.calls.fetches.length, 1)
  assert.equal(scenario.calls.markerCount - markerBefore, 1)
  assert.equal(scenario.calls.fetches[0].url, SOLAPI_SEND_MANY_URL)
  assert.match(scenario.calls.fetches[0].body, /담당 8/)
  assert.doesNotMatch(scenario.calls.fetches[0].body, /담당 7/)
  assertExactRpcTransport(scenario)
})

test("unknown synthetic provider dispatch is finalized once and a second invocation adds no SOLAPI call", async () => {
  // Break caught: an unknown automatic result becomes an unbounded retry that creates a second customer send.
  const scenario = createDbOwnedLifecycleScenario({ providerMode: "throw" })
  const first = await scenario.run()
  const callsAfterFirst = scenario.calls.fetches.length
  const second = await scenario.run()
  assert.equal((await first.json()).outcome, "unknown")
  assert.equal((await second.json()).outcome, "idle")
  assert.equal(callsAfterFirst, 1)
  assert.equal(scenario.calls.fetches.length, 1)
  assert.equal(scenario.calls.markerCount, 1)
  assertExactRpcTransport(scenario)
})
