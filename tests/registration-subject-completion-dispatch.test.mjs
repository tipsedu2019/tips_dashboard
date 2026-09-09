import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const sources = {
  list: await readFile(new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url), "utf8"),
  detail: await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
}

function harness(kind, { currentStatus = "payment_in_progress", allowed = true, sourceEventIds = ["event-registration"], saveError = false, dispatchFailed = false } = {}) {
  const calls = []
  const track = { trackId: "track-math", id: "track-math", workflowStatus: currentStatus, workflowRevision: 7 }
  const context = {
    calls, track,
    canManageRegistrationWorkflow: allowed, canManageCase: allowed, saving: false, workflowStatusSaving: false,
    activeGenericTrack: track, notificationSessionToken: "session-token", notificationToken: "session-token",
    workflowStatusOptions: ["registered", "consultation_completed"].map(value => ({ value })),
    useCallback: fn => fn,
    crypto: { randomUUID: () => "request-id" },
    createRegistrationMutationRequestKey: () => "request-id",
    isRegistrationObservationWorkflowStatus: value => value.startsWith("observation_"),
    async setRegistrationWorkflowStatus(input) {
      calls.push({ kind: "save", input })
      if (saveError) throw new Error("save-denied")
      return { workflowStatus: input.workflowStatus, sourceEventIds }
    },
    async dispatchRegistrationSubjectNotificationSources(ids, token) {
      calls.push({ kind: "dispatch", ids, token })
      return { googleChatEventIds: ["delivery-id"], failedSourceEventIds: dispatchFailed ? ids : [] }
    },
    reload: async () => { calls.push({ kind: "reload" }) },
    onReload: async () => { calls.push({ kind: "reload" }) },
    setLatestGoogleChatEventId: () => {}, setSaving: () => {}, setWorkflowStatusSaving: () => {},
    setMessage: message => { if (message) calls.push({ kind: "warning", message }) },
    onWarning: message => { calls.push({ kind: "warning", message }) },
    errorMessage: error => error.message, getOpsTaskActionErrorMessage: error => error.message,
  }
  const source = sources[kind]
  const start = kind === "list" ? "const handleRegistrationWorkflowStatusChange" : "async function changeWorkflowStatus"
  const end = kind === "list" ? "const closeRegistrationApplicationHost" : "const subjectPanelIdsByTrackId"
  const body = source.slice(source.indexOf(start), source.indexOf(end))
  const invocation = kind === "list" ? "(status) => handleRegistrationWorkflowStatusChange(track, status)" : "changeWorkflowStatus"
  const compiled = ts.transpileModule(`${body}\nthis.run = ${invocation}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(compiled, context)
  return { calls, run: context.run }
}

for (const kind of ["list", "detail"]) {
  test(`${kind}: registered status dispatches only source IDs from the successful revisioned receipt`, async () => {
    const run = harness(kind)
    await run.run("registered")
    assert.deepEqual(run.calls.map(call => call.kind), ["save", "dispatch", "reload"])
    assert.equal(run.calls[0].input.trackId, "track-math")
    assert.equal(run.calls[0].input.expectedWorkflowRevision, 7)
    assert.deepEqual(run.calls[1], { kind: "dispatch", ids: ["event-registration"], token: "session-token" })
  })

  test(`${kind}: other status changes never request a completion delivery`, async () => {
    const run = harness(kind)
    await run.run("consultation_completed")
    assert.deepEqual(run.calls.map(call => call.kind), ["save", "reload"])
  })

  test(`${kind}: a receipt with no new sources performs no delivery request`, async () => {
    const run = harness(kind, { sourceEventIds: [] })
    await run.run("registered")
    assert.deepEqual(run.calls.map(call => call.kind), ["save", "reload"])
  })

  test(`${kind}: unchanged or unauthorized status performs no mutation or delivery`, async () => {
    for (const options of [{ currentStatus: "registered" }, { allowed: false }]) {
      const run = harness(kind, options)
      await run.run("registered")
      assert.deepEqual(run.calls, [])
    }
  })

  test(`${kind}: rejected status save never dispatches`, async () => {
    const run = harness(kind, { saveError: true })
    await run.run("registered")
    assert.equal(run.calls.some(call => call.kind === "dispatch"), false)
    assert.equal(run.calls.filter(call => call.kind === "save").length, 1)
  })

  test(`${kind}: delivery failure preserves saved state and refreshes without retrying`, async () => {
    const run = harness(kind, { dispatchFailed: true })
    await run.run("registered")
    assert.deepEqual(run.calls.map(call => call.kind), ["save", "dispatch", "warning", "reload"])
    assert.match(run.calls[2].message, /등록 상태를 저장했습니다/)
  })
}
