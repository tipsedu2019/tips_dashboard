import assert from "node:assert/strict"
import test from "node:test"
import { createRegistrationCustomerMessageRouteHandlers } from "../src/features/tasks/server/registration-customer-message-route.ts"
import { createRegistrationCustomerReminderWorker } from "../src/features/tasks/server/registration-customer-reminder-worker.ts"
import { createRegistrationCustomerMessageBundleWorker } from "../src/features/tasks/server/registration-customer-message-bundle-worker.ts"
import {
  parseRegistrationCustomerMessageContactFence,
  registrationCustomerMessageMinimalProviderEvidence,
} from "../src/features/tasks/server/registration-customer-message-contact-fence.ts"

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ids = { actor: id(1), task: id(2), source: id(3), preview: id(4), message: id(5), request: id(6), claim: id(7), dispatch: id(8), job: id(9) }
const digest = { version: 1, digest: "a".repeat(64) }
const fence = (overrides = {}) => ({ version: 1, taskId: ids.task, sourceId: ids.source,
  messageKind: "level_test_booking", contactPhase: "open", contactGeneration: "1",
  allPhasesClosed: false, sourcePhaseOpen: true, canonicalAppointmentKind: "level_test", ...overrides })
const grant = (contactFence = fence()) => ({ version: 1, action: "attempt",
  linearization: "registration_contact_case_lock_v1", messageId: ids.message,
  dispatchToken: ids.dispatch, contactFence })
const result = (overrides = {}) => ({ ok: false, messageId: ids.message, messageKind: "level_test_booking",
  currentStatus: "pending", recipientLast4: "0001", confirmedByName: "합성 담당자",
  confirmedAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
  canCheck: false, idempotent: false, ...overrides })
const privateSource = {
  parentPhoneDigits: "01000000001", sourceFingerprint: "b".repeat(64), recipientHash: "c".repeat(64),
  rendered: { variables: { 학생명: "합성 학생" }, buttons: [] },
  previewContract: { parentPhoneDigits: "01000000001", sourceFingerprint: "b".repeat(64), recipientHash: "c".repeat(64),
    templateKey: "level_test_booking", templateRevision: 1, templateChecksum: "d".repeat(64),
    renderedVariablesChecksum: "e".repeat(64), renderedBodyChecksum: "f".repeat(64), renderedButtonsChecksum: "a".repeat(64) },
  readinessContract: { credentialsConfigured: true, templateId: "synthetic-template", pfId: "synthetic-pf",
    catalogChecksum: "d".repeat(64), recipientHash: "c".repeat(64), sourceFingerprint: "b".repeat(64), sourceFactsChecksum: "e".repeat(64) },
}

function routeHarness(options = {}) {
  const calls = []
  let fenceReads = 0
  const kind = options.kind ?? "level_test_booking"
  const sourceId = kind === "admission_application" ? ids.task : ids.source
  const defaultFence = fence({ messageKind: kind, sourceId,
    canonicalAppointmentKind: kind === "admission_application" ? null : "level_test" })
  const scopedPrivateSource = { ...privateSource,
    previewContract: { ...privateSource.previewContract, templateKey: kind } }
  const source = { taskId: ids.task, sourceId, messageKind: kind, sourceRevision: 1,
    studentName: "합성 학생", recipientLast4: "0001", facts: {}, body: "합성 레벨테스트 안내", buttons: [] }
  const deps = {
    now: () => new Date("2026-10-09T00:00:00.000Z"),
    authenticate: async () => ({ actorProfileId: ids.actor, role: "staff", actorClient: {} }),
    authorizeTask: async () => true,
    readContactFence: async () => {
      calls.push("fence")
      const current = options.fences?.[fenceReads++] ?? options.fence ?? defaultFence
      return { ...current, messageKind: kind }
    },
    createRequestDigest: () => digest,
    readRequestReplay: async () => { calls.push("replay"); return options.replay ?? null },
    resolveTaskId: async () => ids.task,
    resolveSource: async () => { calls.push("source"); return source },
    readPrivateSource: () => scopedPrivateSource,
    getReadiness: async () => ({ runtimeReady: true, activationMode: "live", activationEligible: true,
      credentialsConfigured: true, pfConfigured: true, templateConfigured: true, templateVerified: true,
      verifiedAt: "2026-10-09T00:00:00.000Z", sourceValid: true, sendAllowed: true, blockers: [] }),
    listHistory: async () => [],
    createPreview: async ({ contract }) => { calls.push("preview"); assertNoRawContract(contract)
      return { previewId: ids.preview, expiresAt: "2026-10-09T00:10:00.000Z", messageKind: kind, recipientLast4: "0001" } },
    readPreviewTarget: async () => ({ taskId: ids.task, sourceId, messageKind: kind, contactGeneration: "1" }),
    claimMessage: async ({ contract }) => { calls.push("claim"); assertNoRawContract(contract)
      return result({ messageKind: kind, owner: true, claimToken: ids.claim, dispatchToken: ids.dispatch }) },
    releasePreSendClaim: async () => { calls.push("release"); if (options.releaseFails) throw new Error("synthetic uncertainty") },
    markAttemptStarted: async ({ contract }) => { calls.push("marker"); assertNoRawContract(contract)
      return { allowed: true, messageId: ids.message, currentStatus: "pending", dispatchToken: ids.dispatch,
        ...(options.omitGrant ? {} : { contactGrant: options.grant ?? grant(defaultFence) }) } },
    sendProvider: async () => { calls.push("provider"); if (options.providerFails) throw new Error("synthetic transport failure")
      return { outcome: "accepted", providerPayloadChecksum: "a".repeat(64), evidence: {
        providerMessageId: "synthetic-provider-id", statusCode: "2000",
        statusMessage: "raw synthetic contact 01000000001", requestKeyMatched: true, observedAt: "2026-10-09T00:00:00.000Z" } } },
    finalizeMessage: async ({ outcome, evidence }) => { calls.push("finalize")
      assert.doesNotMatch(JSON.stringify(evidence), /01000000001|raw synthetic/u)
      if (options.finalizeFails) throw new Error("synthetic save uncertainty")
      return result({ messageKind: kind, ok: outcome === "accepted", currentStatus: outcome }) },
  }
  return { handlers: createRegistrationCustomerMessageRouteHandlers(deps), calls }
}
function assertNoRawContract(contract) {
  assert.equal("parentPhoneDigits" in contract, false)
  assert.equal("studentName" in contract, false)
  assert.equal(contract.contactGeneration, "1")
  assert.deepEqual(contract.requestDigest, digest)
  assert.doesNotMatch(JSON.stringify(contract), /01000000001/u)
}
async function invoke(handler, body) {
  const response = await handler(new Request("http://synthetic.invalid/registration", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() }
}
const send = (harness) => invoke(harness.handlers.send, { previewId: ids.preview, requestKey: ids.request })

test("actual single route requires scoped locked grant and sends once with minimized persisted evidence", async () => {
  const harness = routeHarness()
  assert.equal((await send(harness)).body.currentStatus, "accepted")
  assert.deepEqual(harness.calls, ["replay", "fence", "source", "claim", "fence", "source", "marker", "provider", "finalize"])
})
test("closed and all-terminal cases reject before private source, preview or provider", async () => {
  for (const overrides of [{ contactPhase: "closed" }, { allPhasesClosed: true }, { sourcePhaseOpen: false }]) {
    const harness = routeHarness({ fence: fence(overrides) })
    const response = await invoke(harness.handlers.preview, { messageKind: "level_test_booking", sourceId: ids.source })
    assert.equal(response.status, 409)
    assert.deepEqual(harness.calls, ["fence"])
  }
})
test("outside-purpose notices cannot create previews or call private source", async () => {
  for (const kind of ["waiting_notice", "visit_consultation_booking"]) {
    const harness = routeHarness({ kind })
    assert.equal((await invoke(harness.handlers.preview, { messageKind: kind, sourceId: ids.source })).status, 409)
    assert.deepEqual(harness.calls, ["fence"])
  }
})
test("registration guidance uses the case UUID and reaches provider only with a current locked grant", async () => {
  const harness = routeHarness({ kind: "admission_application" })
  const preview = await invoke(harness.handlers.preview, { messageKind: "admission_application", sourceId: ids.task })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.messageKind, "admission_application")
  assert.deepEqual(harness.calls, ["fence", "source", "preview"])
  assert.equal((await send(harness)).body.currentStatus, "accepted")
  assert.equal(harness.calls.filter((item) => item === "provider").length, 1)
  assert.equal(harness.calls.filter((item) => item === "marker").length, 1)
  assert.doesNotMatch(JSON.stringify(preview.body), /01000000001|parentPhoneDigits|requestDigest/u)
})
test("registration guidance rejects closed purpose and a generation changed after claim", async () => {
  const admissionFence = (changes = {}) => fence({ messageKind: "admission_application", sourceId: ids.task,
    canonicalAppointmentKind: null, ...changes })
  for (const changes of [{ contactPhase: "closed" }, { allPhasesClosed: true }, { sourcePhaseOpen: false }]) {
    const harness = routeHarness({ kind: "admission_application", fence: admissionFence(changes) })
    assert.equal((await invoke(harness.handlers.preview, { messageKind: "admission_application", sourceId: ids.task })).status, 409)
    assert.deepEqual(harness.calls, ["fence"])
  }
  const stale = routeHarness({ kind: "admission_application", fences: [admissionFence(), admissionFence({ contactGeneration: "2" })] })
  assert.equal((await send(stale)).status, 503)
  assert.equal(stale.calls.includes("marker"), false)
  assert.equal(stale.calls.includes("provider"), false)
  assert.equal(stale.calls.at(-1), "release")
})
test("registration guidance never treats an allowed boolean or another case's grant as permission to send", async () => {
  const admissionFence = fence({ messageKind: "admission_application", sourceId: ids.task, canonicalAppointmentKind: null })
  for (const options of [{ omitGrant: true }, { grant: grant({ ...admissionFence, taskId: id(20) }) },
    { grant: grant({ ...admissionFence, contactGeneration: "2" }) }]) {
    const harness = routeHarness({ kind: "admission_application", releaseFails: true, ...options })
    assert.equal((await send(harness)).body.currentStatus, "unknown")
    assert.equal(harness.calls.includes("provider"), false)
  }
})
test("appointment reminder requires canonical level test and cannot use a consultation phone", async () => {
  const harness = routeHarness({ kind: "appointment_reminder", fence: fence({ canonicalAppointmentKind: "visit_consultation" }) })
  assert.equal((await send(harness)).status, 409)
  assert.equal(harness.calls.includes("source"), false)
})
test("generation changes or closure after claim stop the marker and release only the pre-start claim", async () => {
  for (const next of [{ contactGeneration: "2" }, { contactPhase: "closed" }, { allPhasesClosed: true }]) {
    const harness = routeHarness({ fences: [fence(), fence(next)] })
    const response = await send(harness)
    assert.equal(response.status, 503)
    assert.equal(harness.calls.filter((item) => item === "source").length, 1)
    assert.equal(harness.calls.includes("marker"), false)
    assert.equal(harness.calls.includes("provider"), false)
    assert.equal(harness.calls.at(-1), "release")
  }
})
test("an allowed boolean without the contract grant never crosses the provider boundary", async () => {
  const harness = routeHarness({ omitGrant: true, releaseFails: true })
  const response = await send(harness)
  assert.equal(response.status, 502)
  assert.equal(response.body.currentStatus, "unknown")
  assert.equal(harness.calls.includes("provider"), false)
})
test("locked grant identity, generation and closed-source drift all fail closed", async () => {
  for (const invalid of [grant(fence({ contactGeneration: "2" })), grant(fence({ taskId: id(20) })),
    grant(fence({ sourcePhaseOpen: false })), { ...grant(), dispatchToken: id(21) },
    { ...grant(), linearization: "browser_checked" }, { ...grant(), rawPhone: "01000000001" }]) {
    const harness = routeHarness({ grant: invalid, releaseFails: true })
    assert.equal((await send(harness)).body.currentStatus, "unknown")
    assert.equal(harness.calls.includes("provider"), false)
  }
})
test("actor/key/preview saved result replay occurs before raw source and does not resave after closure", async () => {
  for (const currentStatus of ["pending", "accepted", "unknown", "failed_hold"]) {
    const harness = routeHarness({ fence: fence({ contactPhase: "closed", contactGeneration: "2" }),
      replay: result({ currentStatus, owner: false, idempotent: true, ok: currentStatus === "accepted" }) })
    const response = await send(harness)
    assert.equal(response.body.currentStatus, currentStatus)
    assert.deepEqual(harness.calls, ["replay"])
  }
})
test("invalid replay cannot become a new provider attempt", async () => {
  for (const replay of [result({ owner: true, idempotent: true }), result({ owner: false, idempotent: false }),
    result({ owner: false, idempotent: true, messageKind: "waiting_notice" })]) {
    const harness = routeHarness({ replay })
    assert.equal((await send(harness)).status, 503)
    assert.deepEqual(harness.calls, ["replay"])
  }
})
test("post-marker provider or finalize uncertainty returns unknown with no retry", async () => {
  for (const options of [{ providerFails: true }, { finalizeFails: true }]) {
    const harness = routeHarness(options)
    assert.equal((await send(harness)).body.currentStatus, "unknown")
    assert.equal(harness.calls.filter((item) => item === "provider").length, 1)
  }
})
test("fence parser rejects missing provenance, unsafe extra keys and precision-losing generations", () => {
  for (const value of [null, { ...fence(), contactGeneration: 1 }, { ...fence(), contactGeneration: "9223372036854775808" },
    { ...fence(), contactGeneration: "01" }, { ...fence(), phone: "01000000001" }, { ...fence(), taskId: id(33) }]) {
    assert.throws(() => parseRegistrationCustomerMessageContactFence(value, fence()), /contact_fence_invalid/u)
  }
  assert.equal(parseRegistrationCustomerMessageContactFence(fence({ contactGeneration: "9223372036854775807" }), fence()).contactGeneration,
    "9223372036854775807")
})
test("minimal provider evidence drops arbitrary body and free text after a send or result check", () => {
  const evidence = registrationCustomerMessageMinimalProviderEvidence("unknown", { statusCode: "01000000001",
    statusMessage: "raw 01000000001", body: "raw phone", requestKeyMatched: true }, new Date("2026-10-09T00:00:00Z"))
  assert.equal(evidence.statusCode, "provider_status_unavailable")
  assert.doesNotMatch(JSON.stringify(evidence), /01000000001|raw phone/u)
})

function workerHarness(mode, overrides = {}) {
  const calls = []
  const messageKind = mode === "bundle" ? "level_test_reminder_bundle" : "appointment_reminder"
  const contactFence = fence({ messageKind })
  const claim = mode === "bundle"
    ? { bundleId: ids.job, claimToken: ids.claim, contactFence, requestKey: ids.request, requestDigest: digest }
    : { jobId: ids.job, messageKind, appointmentId: ids.source, observationId: null, claimToken: ids.claim,
      sourceRevision: 1, scheduledFor: "2026-10-10T00:00:00Z", requestKey: ids.request, contactFence }
  const prepared = { to: "01000000001", templateId: "synthetic", variables: {}, buttons: [], contract: {},
    readinessContract: {}, contactFence, requestDigest: digest }
  const deps = {
    claim: async () => { calls.push("claim"); return { ...claim, ...overrides.claim } },
    prepare: async () => { calls.push("prepare"); return { ...prepared, ...overrides.prepared } },
    begin: async () => { calls.push("begin"); return { allowed: true, messageId: ids.message, dispatchToken: ids.dispatch,
      currentStatus: "pending", contactGrant: grant(contactFence), ...overrides.begin } },
    release: async () => { calls.push("release") },
    send: async () => { calls.push("provider"); return { outcome: "accepted", evidence: {}, providerPayloadChecksum: "a".repeat(64) } },
    finalize: async () => { calls.push("finalize") },
  }
  return { worker: mode === "bundle" ? createRegistrationCustomerMessageBundleWorker(deps)
    : createRegistrationCustomerReminderWorker(deps), calls }
}
for (const mode of ["reminder", "bundle"]) {
  test(`${mode} actual worker accepts one scoped grant and preserves one-attempt sequence`, async () => {
    const harness = workerHarness(mode)
    assert.equal((await harness.worker.runOnce()).providerAttempted, true)
    assert.deepEqual(harness.calls, ["claim", "prepare", "begin", "provider", "finalize"])
  })
  test(`${mode} worker denies persisted closed phase before raw preparation`, async () => {
    const harness = workerHarness(mode, { claim: { contactFence: fence({
      messageKind: mode === "bundle" ? "level_test_reminder_bundle" : "appointment_reminder", contactPhase: "closed" }) } })
    assert.equal((await harness.worker.runOnce()).providerAttempted, false)
    assert.equal(harness.calls.includes("prepare"), false)
  })
  test(`${mode} worker refuses unfenced allowed response rather than dispatching`, async () => {
    const harness = workerHarness(mode, { begin: { contactGrant: undefined } })
    assert.equal((await harness.worker.runOnce()).providerAttempted, false)
    assert.equal(harness.calls.includes("provider"), false)
  })
}
test("reminder refresh cannot rebind its claim to a new contact generation", async () => {
  const harness = workerHarness("reminder", { prepared: { contactFence: fence({ messageKind: "appointment_reminder", contactGeneration: "2" }) } })
  assert.equal((await harness.worker.runOnce()).providerAttempted, false)
  assert.equal(harness.calls.includes("begin"), false)
})
