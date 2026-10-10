import assert from "node:assert/strict"
import test from "node:test"
import { createRegistrationContactCommandRoute, registrationContactCommandHmac } from "../src/features/tasks/server/registration-contact-command-route.ts"
import { RegistrationCustomerMessageHttpError } from "../src/features/tasks/server/registration-customer-message-auth.ts"

const ACTOR = "00000000-0000-4000-8000-000000000001"
const TASK = "00000000-0000-4000-8000-000000000002"
const TRACK = "00000000-0000-4000-8000-000000000003"
const KEY = "00000000-0000-4000-8000-000000000004"
const OTHER = "00000000-0000-4000-8000-000000000005"
const PHONE = "010-0000-0000" // synthetic fixture, no provider or database
function command(overrides = {}) {
  return { command: "set_workflow_status", taskId: TASK, requestKey: KEY, expectedGeneration: "2", expectedRevision: "8",
    payload: { trackId: TRACK, workflowStatus: "registered", expectedWorkflowRevision: 3 }, ...overrides }
}
function receipt(input = command(), overrides = {}) {
  return { version: 1, taskId: TASK, requestKey: KEY, command: input.command, replayed: false, result: {
    trackId: TRACK, workflowStatus: "registered", workflowRevision: 4,
    workflowStatusEnteredAt: "2026-10-09T09:00:00.000Z", enrollmentFinalization: null,
    contactState: { version: 1, taskId: TASK, revision: "9", generation: "2", phase: "closed", closureReason: "all_current_tracks_terminal",
      closedAt: "2026-10-09T09:00:00.000Z", commonRevision: 3, allPhasesClosed: true, currentTrackIds: [TRACK], studentId: null, parentPhone: null },
  }, ...overrides }
}
function harness(options = {}) {
  const calls = { auth: 0, authorize: 0, rpc: [], signals: [] }
  const auth = {
    async authenticate() {
      calls.auth++
      if (options.authError) throw options.authError
      return { actorProfileId: options.actorId ?? ACTOR, role: options.role ?? "staff", actorClient: {}, serviceClient: {
        rpc(name, args) {
          calls.rpc.push({ name, args })
          return { abortSignal(signal) { calls.signals.push(signal); return { retry(enabled) { assert.equal(enabled, false); return options.pending ?? Promise.resolve({ data: options.response ?? receipt(options.command), error: options.error ?? null }) } } } }
        },
      } }
    },
    async authorizeTask() { calls.authorize++; return options.visible ?? true },
  }
  const handler = createRegistrationContactCommandRoute({ auth, pepper: () => options.pepper ?? "synthetic-test-pepper", timeoutMs: 10 })
  const request = value => new Request("https://synthetic.invalid/api/registration/contact", { method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: typeof value === "string" ? value : JSON.stringify(value) })
  return { calls, handler, run: value => handler(request(value ?? options.command ?? command())) }
}

test("verified actor and complete command are the only RPC authority; receipt contains metadata", async () => {
  const { calls, run } = harness()
  const response = await run()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(calls.rpc.length, 1)
  assert.deepEqual(calls.rpc[0], { name: "mutate_registration_contact_v1", args: {
    p_actor_id: ACTOR, p_command: "set_workflow_status", p_task_id: TASK, p_request_key: KEY,
    p_expected_generation: "2", p_expected_revision: "8", p_payload: command().payload,
    p_request_hmac: registrationContactCommandHmac(ACTOR, command(), "synthetic-test-pepper"),
  } })
  const body = await response.json()
  assert.equal(body.result.contactState.parentPhone, null)
  assert.equal(JSON.stringify(calls.rpc[0]).includes("synthetic-test-pepper"), false)
})

test("student binding acknowledges only the requested UUID and required metadata without roster fields", async () => {
  const input = command({ command: "bind_student", payload: { studentId: OTHER } })
  const responseFor = changed => receipt(input, { result: {
    taskId: TASK, studentId: OTHER, changed,
    contactState: { ...receipt().result.contactState, studentId: OTHER },
  } })
  for (const changed of [true, false]) {
    const fixture = harness({ command: input, response: responseFor(changed) })
    const response = await fixture.run()
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(Object.keys(body.result).sort(), ["changed", "contactState", "studentId", "taskId"])
    assert.equal(body.result.studentId, OTHER)
    assert.equal(body.result.contactState.studentId, OTHER)
    assert.equal(body.result.contactState.phase, "closed")
    assert.equal(body.result.contactState.parentPhone, null)
    assert.equal(JSON.stringify(body).includes(PHONE), false)
    assert.equal(fixture.calls.rpc[0].args.p_payload.studentId, OTHER)
  }
  const invalid = []
  for (const key of ["taskId", "studentId", "changed"]) {
    const value = responseFor(true); delete value.result[key]; invalid.push(value)
  }
  for (const patch of [{ taskId: ACTOR }, { studentId: ACTOR }, { studentId: null }, { changed: "true" }]) {
    const value = responseFor(true); Object.assign(value.result, patch); invalid.push(value)
  }
  for (const patch of [{ studentId: ACTOR }, { studentId: null }, { generation: "3" }, { revision: "8" }, { parentPhone: PHONE }]) {
    const value = responseFor(true); Object.assign(value.result.contactState, patch); invalid.push(value)
  }
  for (const patch of [{ rawSnapshot: PHONE }, { enrollmentFinalization: { privateUnexpected: PHONE } }]) {
    const value = responseFor(true); Object.assign(value.result, patch); invalid.push(value)
  }
  for (const value of invalid) {
    const fixture = harness({ command: input, response: value })
    assert.equal((await fixture.run()).status, 503)
    assert.equal(fixture.calls.rpc.length, 1)
  }
})

test("full-command HMAC binds actor, recipient, generation, action, request and every business field", () => {
  const input = command({ command: "update_common", payload: { parentPhone: PHONE, studentName: "합성", requestNote: "합성 메모" } })
  const hash = registrationContactCommandHmac(ACTOR, input, "synthetic-test-pepper")
  assert.equal(hash.length, 64)
  const variants = [
    [OTHER, input], [ACTOR, { ...input, expectedGeneration: "3" }],
    [ACTOR, { ...input, requestKey: OTHER }], [ACTOR, { ...input, command: "save_inquiry" }],
    [ACTOR, { ...input, payload: { ...input.payload, parentPhone: "010-0000-0001" } }],
    [ACTOR, { ...input, payload: { ...input.payload, requestNote: "다른 합성 메모" } }],
  ]
  for (const [actor, value] of variants) assert.notEqual(registrationContactCommandHmac(actor, value, "synthetic-test-pepper"), hash)
  assert.equal(registrationContactCommandHmac(ACTOR, { ...input, payload: { requestNote: "합성 메모", studentName: "합성", parentPhone: PHONE } }, "synthetic-test-pepper"), hash)
})

test("authentication and existing task visibility fail before RPC", async () => {
  for (const options of [{ authError: new RegistrationCustomerMessageHttpError(401, "registration_contact_unauthorized") }, { role: "teacher" }, { visible: false }, { actorId: "display-uid" }]) {
    const fixture = harness(options)
    assert.ok([401, 403].includes((await fixture.run()).status))
    assert.equal(fixture.calls.rpc.length, 0)
  }
})

test("missing server key fails closed without fallback or key provisioning", async () => {
  const fixture = harness({ pepper: "" })
  assert.equal((await fixture.run()).status, 503)
  assert.equal(fixture.calls.rpc.length, 0)
})

test("client actor, digest, student phone and unknown payload fields cannot cross trusted boundary", async () => {
  const invalid = [command({ actorId: OTHER }), command({ digest: "a".repeat(64) }), command({ p_request_hmac: "a".repeat(64) }),
    command({ payload: { ...command().payload, studentPhone: PHONE } }), command({ payload: { ...command().payload, parentPhone: PHONE } }),
    command({ command: "toString" }), command({ command: "constructor" }), command({ command: "__proto__" })]
  for (const input of invalid) {
    const fixture = harness()
    assert.equal((await fixture.run(input)).status, 400)
    assert.equal(fixture.calls.rpc.length, 0)
  }
})

test("historical observation states remain readable metadata but cannot request a final setter mutation", async () => {
  for (const workflowStatus of ["observation_feedback_pending", "observation_completed"]) {
    const fixture = harness()
    const response = await fixture.run(command({ payload: { ...command().payload, workflowStatus } }))
    assert.equal(response.status, 400)
    assert.equal(fixture.calls.rpc.length, 0)
  }
})

test("stale generation remains exact bigint metadata; malformed counters never reach RPC", async () => {
  for (const value of [1, "0", "01", "1\n", "9223372036854775808", null]) {
    const fixture = harness()
    assert.equal((await fixture.run(command({ expectedGeneration: value }))).status, 400)
    assert.equal(fixture.calls.rpc.length, 0)
  }
  const fixture = harness()
  assert.equal((await fixture.run(command({ expectedGeneration: "9223372036854775807" }))).status, 200)
  assert.equal(fixture.calls.rpc[0].args.p_expected_generation, "9223372036854775807")
})

test("new case uses null expected state and omits retired student contact", async () => {
  const input = command({ command: "create", taskId: null, expectedGeneration: null, expectedRevision: null,
    payload: { studentName: "합성 학생", schoolName: "합성 학교", schoolGrade: "중2", parentPhone: PHONE, campus: "", inquiryAt: "2026-10-09T09:00:00Z", subjects: ["수학"], requestNote: "", priority: "normal" } })
  const saved = receipt(input)
  saved.result = { taskId: TASK, commonRevision: 1, subjects: ["수학"],
    tracks: [{ id: TRACK, taskId: TASK, subject: "수학", workflowStatus: "inquiry", workflowRevision: 1, status: "inquiry", archivedAt: null }],
    contactState: { ...saved.result.contactState, revision: "1", generation: "1", phase: "open", closureReason: null,
      closedAt: null, commonRevision: 1, allPhasesClosed: false } }
  const fixture = harness({ command: input, response: saved })
  assert.equal((await fixture.run()).status, 200)
  assert.equal(fixture.calls.authorize, 0)
  assert.equal(fixture.calls.rpc[0].args.p_task_id, null)
  assert.equal(Object.hasOwn(fixture.calls.rpc[0].args.p_payload, "studentPhone"), false)
  assert.equal((await fixture.run({ ...input, expectedGeneration: "1" })).status, 400)
})

test("unknown producer fields and nested contact snapshots fail closed before projection", async () => {
  const saved = receipt()
  saved.result.rawRequest = { parentPhone: PHONE }
  saved.result.studentName = "합성 비공개 이름"
  saved.result.contactState.studentPhone = PHONE
  saved.result.contactState.requestNote = PHONE
  saved.result.enrollmentFinalization = { trackId: TRACK, studentId: OTHER, batchId: null, enrollmentIds: [OTHER], changed: true, parentPhone: PHONE }
  const fixture = harness({ response: saved })
  const response = await fixture.run()
  assert.equal(response.status, 503)
  const text = await response.text()
  assert.equal(text.includes(PHONE), false)
  assert.equal(text.includes("합성 비공개 이름"), false)
  assert.equal(text.includes("rawRequest"), false)
  assert.equal(fixture.calls.rpc.length, 1)
})

test("metadata receipt enforces transport cardinality without truncating successful history", async () => {
  const ids = Array.from({ length: 51 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`)
  for (const field of ["sourceEventIds", "enrollmentIds"]) {
    for (const [values, status] of [[ids.slice(0, 50), 200], [ids, 503], [[OTHER, OTHER], 503]]) {
      const saved = receipt()
      if (field === "sourceEventIds") saved.result.sourceEventIds = values
      else saved.result.enrollmentFinalization = { trackId: TRACK, studentId: OTHER, batchId: null, enrollmentIds: values, changed: true }
      const fixture = harness({ response: saved })
      const response = await fixture.run()
      assert.equal(response.status, status)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(fixture.calls.rpc.length, 1)
      const body = await response.json()
      if (status === 200) assert.deepEqual(field === "sourceEventIds" ? body.result.sourceEventIds : body.result.enrollmentFinalization.enrollmentIds, values)
      else assert.deepEqual(body, { error: "registration_contact_runtime_unavailable" })
    }
  }
})

test("duplicate, foreign task and overlong track metadata cannot become a successful receipt", async () => {
  const track = { id: TRACK, taskId: TASK, subject: "수학", workflowStatus: "registered", workflowRevision: 4, status: "registered", archivedAt: null }
  for (const tracks of [[track, track], [{ ...track, taskId: OTHER }], [{ ...track, directorAssignmentRuleKey: "x".repeat(201) }], Array(51).fill(track)]) {
    const saved = receipt(); saved.result.tracks = tracks
    const fixture = harness({ response: saved })
    const response = await fixture.run()
    assert.equal(response.status, 503)
    assert.equal(fixture.calls.rpc.length, 1)
    assert.deepEqual(await response.json(), { error: "registration_contact_runtime_unavailable" })
  }
})

test("a workflow acknowledgement must contain its actual producer fields and requested track/status", async () => {
  const invalid = []
  for (const field of ["trackId", "workflowStatus", "workflowRevision", "workflowStatusEnteredAt", "enrollmentFinalization"]) {
    const saved = receipt(); delete saved.result[field]; invalid.push(saved)
  }
  for (const patch of [{ trackId: OTHER }, { workflowStatus: "not_registered" }]) {
    const saved = receipt(); Object.assign(saved.result, patch); invalid.push(saved)
  }
  for (const saved of invalid) {
    const fixture = harness({ response: saved })
    const response = await fixture.run()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: "registration_contact_runtime_unavailable" })
    assert.equal(fixture.calls.rpc.length, 1)
  }
})

test("raw parent contact in mutation receipt or forged receipt identity fails closed", async () => {
  for (const mutate of [row => { row.result.contactState.parentPhone = PHONE }, row => { row.taskId = OTHER }, row => { row.requestKey = OTHER }, row => { row.result.trackId = PHONE }]) {
    const saved = receipt(); mutate(saved)
    const fixture = harness({ response: saved })
    const response = await fixture.run()
    assert.equal(response.status, 503)
    assert.equal((await response.text()).includes(PHONE), false)
  }
})

test("inferred legacy closure preserves an unknown timestamp without authorizing contact", async () => {
  for (const reason of ["all_current_tracks_terminal", "whole_case_cancelled"]) {
    const saved = receipt()
    saved.result.contactState.closedAt = null
    saved.result.contactState.closureReason = reason
    if (reason === "whole_case_cancelled") saved.result.contactState.allPhasesClosed = false
    const fixture = harness({ response: saved })
    const response = await fixture.run()
    assert.equal(response.status, 200)
    const state = (await response.json()).result.contactState
    assert.equal(state.closedAt, null)
    assert.equal(state.parentPhone, null)
    assert.equal(state.phase, "closed")
  }
})

test("real PR96 waiting enums and nullable optional facts cross the metadata contract", async () => {
  for (const waitingKind of [null, "current_class", "current_term_opening", "next_term_opening"]) {
    const input = command({ command: "waiting_details", payload: { trackId: TRACK, waitingKind, classId: null, retakeDecision: null } })
    const saved = receipt(input)
    saved.result.waitingKind = waitingKind; saved.result.classId = null; saved.result.retakeDecision = null
    const fixture = harness({ command: input, response: saved })
    const response = await fixture.run()
    assert.equal(response.status, 200)
    assert.equal((await response.json()).result.waitingKind, waitingKind)
  }
})

test("exact saved replay returns metadata without another call or current contact lookup", async () => {
  const fixture = harness({ response: receipt(command(), { replayed: true }) })
  const response = await fixture.run()
  assert.equal((await response.json()).replayed, true)
  assert.equal(fixture.calls.rpc.length, 1)
})

test("SQL errors and thrown RPC exceptions never expose provider prose or raw arguments", async () => {
  for (const [code, status] of [["23514", 409], ["22023", 400], ["42501", 403], ["P0002", 404], ["40001", 503], ["XX000", 503]]) {
    const fixture = harness({ error: { code, message: PHONE } })
    const response = await fixture.run()
    assert.equal(response.status, status)
    assert.equal((await response.text()).includes(PHONE), false)
    assert.equal(fixture.calls.rpc.length, 1)
  }
})

test("timeout aborts the mutation and never retries an uncertain write", async () => {
  const fixture = harness({ pending: new Promise(() => {}) })
  const response = await fixture.run()
  assert.equal(response.status, 503)
  assert.equal(fixture.calls.rpc.length, 1)
  assert.equal(fixture.calls.signals[0].aborted, true)
  assert.deepEqual(await response.json(), { error: "registration_contact_mutation_timeout" })
})

test("malformed JSON and oversized input fail before RPC", async () => {
  for (const input of ["{", "[]", "null", " ".repeat(128_001)]) {
    const fixture = harness()
    assert.ok([400, 413].includes((await fixture.run(input)).status))
    assert.equal(fixture.calls.rpc.length, 0)
  }
})

test("oversized streamed body is rejected even if cancellation rejects or stays pending", async () => {
  for (const cancel of [() => Promise.reject(new Error("synthetic cancellation rejection")), () => new Promise(() => {})]) {
    const fixture = harness()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128_001)) }, cancel })
    const request = new Request("https://synthetic.invalid/api/registration/contact", { method: "POST", body, duplex: "half" })
    const response = await fixture.handler(request)
    assert.equal(response.status, 413)
    assert.equal(fixture.calls.rpc.length, 0)
  }
})
