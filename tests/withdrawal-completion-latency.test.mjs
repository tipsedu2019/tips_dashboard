import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const service = await readFile(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
const workspace = await readFile(new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url), "utf8")
const operationalAccess = await readFile(new URL("../src/features/tasks/operational-task-access.ts", import.meta.url), "utf8")

function declarations(source, names) {
  const parsed = ts.createSourceFile("actual.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Map()
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.set(node.name.text, node.getText(parsed))
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(parsed))) {
      found.set(node.name.getText(parsed), `const ${node.getText(parsed)};`)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return names.map((name) => {
    assert.ok(found.has(name), `actual source contains ${name}`)
    return found.get(name)
  }).join("\n")
}

function load(source, names, mocks) {
  const sandboxModule = { exports: {} }
  const compiled = ts.transpileModule(`${declarations(source, names)}\nmodule.exports = { ${names.join(",")} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, AbortSignal, ...mocks })
  return sandboxModule.exports
}

// Use the real newly imported role guard; manager latency coverage stays on staff.
const { isTeacherReadOnlyTask } = load(operationalAccess, ["isTeacherReadOnlyTask"], {})

const readerNames = ["text", "numberText", "bool", "normalizeType", "normalizeStatus", "normalizePriority",
  "isMissingRelationError", "profileLabel", "buildProfileLookup", "byTaskId", "singleByTaskId", "mapWithdrawal",
  "mapComment", "mapAttachment", "mapEvent", "mapTask", "loadOpsTaskById", "loadOpsWithdrawalTaskForCompletion", "inputFromTask"]

function readerHarness({ type = "withdrawal", errorTable = "", feeProcessed = false } = {}) {
  const reads = []
  const rows = {
    ops_tasks: { id: "synthetic-task", type, status: "in_progress", requested_by: "synthetic-actor", updated_at: "2026-10-08T00:00:00Z" },
    ops_withdrawal_details: { task_id: "synthetic-task", withdrawal_date: "2026-10-09", withdrawal_session: "10월 2회차", fee_processed: feeProcessed, textbook_fee_processed: false },
    ops_task_comments: [{ id: "comment", task_id: "synthetic-task", author_id: "synthetic-actor", body: "synthetic" }],
    ops_task_attachments: [{ id: "attachment", task_id: "synthetic-task", uploaded_by: "synthetic-actor" }],
    ops_task_events: [{ id: "event", task_id: "synthetic-task", actor_id: "synthetic-actor" }],
    profiles: [{ id: "synthetic-actor", name: "Synthetic staff" }],
  }
  const supabase = { from(table) {
    const call = { table, filters: [], retry: undefined }
    const query = {
      select() { return query }, single() { return query }, order() { return query }, limit() { return query },
      eq(...args) { call.filters.push(args); return query }, in() { return query },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return query },
      retry(value) { call.retry = value; return query },
      then(resolve, reject) {
        reads.push(call)
        return Promise.resolve({ data: rows[table], error: errorTable === table ? { code: "42501", message: "synthetic denied" } : null }).then(resolve, reject)
      },
    }
    return query
  } }
  return { reads, ...load(service, readerNames, { supabase }) }
}

test("withdrawal completion preflight reads 2 resources instead of 6 with identical business input", async () => {
  for (const feeProcessed of [false, true]) {
    const full = readerHarness({ feeProcessed })
    const lean = readerHarness({ feeProcessed })
    const fullTask = await full.loadOpsTaskById("synthetic-task")
    const leanTask = await lean.loadOpsWithdrawalTaskForCompletion("synthetic-task")
    assert.deepEqual(JSON.parse(JSON.stringify(lean.inputFromTask(leanTask))), JSON.parse(JSON.stringify(full.inputFromTask(fullTask))))
    assert.equal(leanTask.updatedAt, fullTask.updatedAt)
    assert.equal(leanTask.withdrawal.feeProcessed, feeProcessed)
    assert.equal(leanTask.withdrawal.textbookFeeProcessed, false)
    assert.deepEqual(lean.reads.map((x) => x.table), ["ops_tasks", "ops_withdrawal_details"])
    assert.equal(full.reads.length, 6)
    assert.equal(fullTask.requestedByLabel, "Synthetic staff")
    assert.equal(fullTask.events.length, 1)
    assert.ok(lean.reads.every((x) => x.retry === false && x.filters[0][1] === "synthetic-task"))
  }
})

test("fresh non-withdrawal type retains full presentation despite a stale withdrawal caller", async () => {
  const h = readerHarness({ type: "general" })
  const result = await h.loadOpsWithdrawalTaskForCompletion("synthetic-task")
  assert.equal(result.type, "general")
  assert.equal(h.reads.length, 6)
  assert.equal(result.events.length, 1)
  assert.equal(result.requestedByLabel, "Synthetic staff")
})

test("fresh task and withdrawal detail failures remain fatal before completion writes", async () => {
  for (const errorTable of ["ops_tasks", "ops_withdrawal_details"]) {
    const h = readerHarness({ errorTable })
    await assert.rejects(h.loadOpsWithdrawalTaskForCompletion("synthetic-task"), (error) => error.code === "42501")
    assert.ok(h.reads.every((x) => ["ops_tasks", "ops_withdrawal_details"].includes(x.table)))
  }
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const turn = () => new Promise((resolve) => setImmediate(resolve))

test("both completion services stop on a fresh protected read failure without a producer call", async () => {
  for (const entry of ["updateOpsTask", "updateOpsTaskStatus"]) {
    for (const errorTable of ["ops_tasks", "ops_withdrawal_details"]) {
      const h = readerHarness({ errorTable })
      let producers = 0
      const fn = load(service, [entry], {
        supabase: {}, loadOpsTaskById: h.loadOpsTaskById, loadOpsWithdrawalTaskForCompletion: h.loadOpsWithdrawalTaskForCompletion,
        runIdempotentOpsTaskProducerRpc: () => { producers += 1 },
      })[entry]
      const running = entry === "updateOpsTask"
        ? fn("synthetic-task", { type: "withdrawal", status: "done" })
        : fn({ id: "synthetic-task", type: "withdrawal" }, "done")
      await assert.rejects(running, (error) => error.code === "42501")
      assert.equal(producers, 0)
    }
  }
})

function workspaceHarness(kind, { type = "withdrawal", status = "done" } = {}) {
  const calls = [], saving = [], messages = []
  const ownership = { current: true }
  const commit = deferred(), detail = deferred(), dispatch = deferred(), page = deferred()
  const task = { id: "synthetic-task", type, status: "in_progress", title: "Synthetic", withdrawal: { feeProcessed: false, textbookFeeProcessed: false } }
  const setters = Object.fromEntries(["setNotice", "setStatusUndo", "applyTaskPatch", "setFormOpen", "setFormCompletionBlockers", "setFormCompletionIntent", "setConfirmingFormClose", "setWordRetestStudentIds", "setQuery"].map((name) => [name, () => {}]))
  const mocks = {
    ...setters, setSaving: (value) => saving.push(value), setMessage: (value) => messages.push(value),
    updateOpsTaskStatus: () => { calls.push("commit"); return commit.promise },
    updateOpsTask: () => { calls.push("commit"); return commit.promise },
    loadOpsTaskById: (...args) => { calls.push(["detail", ...args]); return detail.promise },
    replaceTaskInState: () => calls.push("replace"),
    refreshFirstTaskPageAfterMutation: () => { calls.push("page"); return page.promise },
    dispatchLegacyOpsTaskSources: (ids, token) => { calls.push(["dispatch", ids, token]); return dispatch.promise },
    registrationNotificationSessionToken: "synthetic-token",
    getOpsTaskActionErrorMessage: (error) => error.message,
    form: { ...task, status }, editingTask: task, currentUserId: "synthetic-viewer",
    isTeacherReadOnlyTask, resolvedViewerRole: "staff",
    workspaceViewerGenerationRef: { current: 1 }, workspaceMountedRef: { current: true }, latestWorkspaceViewerIdRef: { current: "synthetic-viewer" },
    isRegistrationSubmissionOwnershipCurrent: () => ownership.current,
    getTransferRequiredInputBlockers: () => [], formCompletionIntent: null,
    applyFormCompletionIntent: (input) => input, getRegistrationPrefillPipelineStatus: () => "",
    normalizeFormForSubmit: (input) => input, getWordRetestRequiredInputBlockers: () => [], getOperationCompletionBlockers: () => [],
    prioritizeCompletionBlockers: (values) => values, data: {}, EMPTY_STUDENT_OPTIONS: [], EMPTY_CLASS_OPTIONS: [], EMPTY_TEXTBOOK_OPTIONS: [], EMPTY_TEACHER_OPTIONS: [], optionIndexes: {},
    buildLocalTaskFromInput: (_id, input) => input,
    registrationCreateAttemptRef: { current: null }, getTaskTypeLabel: () => "퇴원",
  }
  const fn = load(workspace, [kind], mocks)[kind]
  const run = () => kind === "changeStatus" ? fn(task, status) : fn({ preventDefault() {} })
  return { run, calls, saving, messages, commit, detail, dispatch, page, task, ownership }
}

test("a completed form dispatch cannot clear the saving state of a newer viewer", async () => {
  const h = workspaceHarness("submitForm")
  const running = h.run()
  h.commit.resolve({ sourceEventIds: ["synthetic-source"] })
  h.detail.resolve({ ...h.task, status: "done" })
  await turn()
  h.page.resolve()
  await turn()
  h.ownership.current = false
  h.dispatch.resolve([])
  await running
  assert.deepEqual(h.saving, [true])
})

for (const kind of ["changeStatus", "submitForm"]) {
  test(`${kind}: only committed withdrawal completion overlaps one dispatch with full refresh`, async () => {
    const h = workspaceHarness(kind)
    const running = h.run()
    await turn()
    assert.deepEqual(h.calls, ["commit"])
    h.commit.resolve({ sourceEventIds: ["synthetic-source"] })
    await turn()
    assert.equal(h.calls.filter((x) => x[0] === "dispatch").length, 1)
    assert.deepEqual(h.calls.find((x) => x[0] === "detail"), ["detail", "synthetic-task"])
    assert.equal(h.saving.at(-1), true)
    h.detail.resolve({ ...h.task, status: "done" })
    await turn()
    h.page.resolve()
    await turn()
    assert.equal(h.saving.at(-1), true, "the submit lock waits for dispatch")
    h.dispatch.resolve([])
    await running
    assert.equal(h.saving.at(-1), false)
    assert.equal(h.calls.filter((x) => x[0] === "dispatch").length, 1)
  })

  test(`${kind}: failed mutation never dispatches or refreshes`, async () => {
    const h = workspaceHarness(kind)
    const running = h.run()
    h.commit.reject(new Error("synthetic mutation failure"))
    await running
    assert.deepEqual(h.calls, ["commit"])
    assert.equal(h.saving.at(-1), false)
    assert.ok(h.messages.includes("synthetic mutation failure"))
  })

  test(`${kind}: failed page refresh still waits for the existing dispatch to settle`, async () => {
    const h = workspaceHarness(kind)
    const running = h.run()
    h.commit.resolve({ sourceEventIds: ["synthetic-source"] })
    h.detail.resolve({ ...h.task, status: "done" })
    await turn()
    h.page.reject(new Error("synthetic refresh failure"))
    await turn()
    assert.equal(h.saving.at(-1), true)
    h.dispatch.resolve([])
    await running
    assert.equal(h.saving.at(-1), false)
    assert.ok(h.messages.includes("synthetic refresh failure"))
  })

  test(`${kind}: early dispatch rejection is handled while the full refresh remains pending`, async () => {
    const h = workspaceHarness(kind)
    const running = h.run()
    h.commit.resolve({ sourceEventIds: ["synthetic-source"] })
    await turn()
    h.dispatch.reject(new Error("synthetic dispatch failure"))
    await turn()
    assert.equal(h.saving.at(-1), true)
    h.detail.resolve({ ...h.task, status: "done" })
    await turn()
    h.page.resolve()
    await running
    assert.equal(h.saving.at(-1), false)
    assert.ok(h.messages.includes("synthetic dispatch failure"))
  })

  test(`${kind}: ordinary withdrawal edits keep their original dispatch order`, async () => {
    const h = workspaceHarness(kind, { status: "in_progress" })
    const running = h.run()
    h.commit.resolve({ sourceEventIds: ["synthetic-source"] })
    await turn()
    assert.equal(h.calls.filter((x) => x[0] === "dispatch").length, 0)
    h.detail.resolve(h.task)
    await turn()
    assert.equal(h.calls.filter((x) => x[0] === "dispatch").length, 0)
    h.page.resolve()
    await turn()
    assert.equal(h.calls.filter((x) => x[0] === "dispatch").length, 1)
    h.dispatch.resolve([])
    await running
  })
}
