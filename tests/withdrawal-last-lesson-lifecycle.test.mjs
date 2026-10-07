import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

const source = await readFile(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
const parsed = ts.createSourceFile("ops-task-service.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const functions = new Map(parsed.statements.filter(ts.isFunctionDeclaration).map((item) => [item.name?.text, item.getText(parsed)]))
const runtimeVersion = "withdrawal_completion_without_settlement_v2"
const unavailableMessage = "퇴원 기준일을 포함하는 명단 처리 기능이 준비되지 않았습니다. 관리자에게 문의하세요."

function load(names, mocks) {
  const snippets = names.map((name) => {
    const value = functions.get(name)
    assert.ok(value, `actual service function exists: ${name}`)
    return value
  })
  const sandboxModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`${snippets.join("\n")}\nmodule.exports = { ${names.join(", ")} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: sandboxModule, exports: sandboxModule.exports, ...mocks })
  return sandboxModule.exports
}

function harness(options = {}) {
  const calls = []
  const response = { sourceEventIds: ["synthetic-completion-source"], task: { id: "task-1", status: "done" } }
  const mocks = {
    text: (value) => String(value ?? "").trim(),
    probeRegistrationSubjectTrackRuntime: async () => ({ mode: options.mode || "ready" }),
    resetRegistrationSubjectTrackRuntimeProbe: () => calls.push(["reset-runtime"]),
    invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure: () => calls.push(["invalidate-runtime"]),
    producerSourceEventIds: (value) => value.sourceEventIds || [],
    clearOpsTaskWorkspaceDataCache: () => calls.push(["clear-cache"]),
    invalidatePublicClassesCacheAfterMutation: async () => {
      calls.push(["public-cache"])
      return { status: "refreshed" }
    },
    supabase: {
      rpc: async (name, parameters) => {
        calls.push(["rpc", name, parameters])
        if (name === "withdrawal_last_lesson_release_runtime_version") return { data: options.version ?? runtimeVersion, error: options.capabilityError || null }
        return { data: response, error: options.completionError || null }
      },
      from: (name) => {
        calls.push(["direct-write", name])
        throw new Error(`Unexpected legacy table access: ${name}`)
      },
    },
    runIdempotentOpsTaskProducerRpc: async (name, parameters) => {
      calls.push(["producer", name, parameters])
      if (options.producerError) throw options.producerError
      if (options.completionError) throw options.completionError
      return response
    },
  }
  return { calls, mocks }
}

function loadCompletion(mocks) {
  return load([
    "isMissingOpsRosterRpc", "getOpsRosterRuntimeState", "assertWithdrawalLastLessonRuntimeReady", "completeReadyOpsRosterTransition",
  ], mocks).completeReadyOpsRosterTransition
}

test("withdrawal completion uses only the date-inclusive V3 RPC in ready and legacy runtimes", async () => {
  for (const mode of ["ready", "legacy"]) {
    const { calls, mocks } = harness({ mode })
    const complete = loadCompletion(mocks)
    const receipt = await complete("task-1", "withdrawal")
    assert.equal(receipt.sourceEventIds[0], "synthetic-completion-source")
    assert.ok(calls.some(([, name]) => name === "withdrawal_last_lesson_release_runtime_version"))
    assert.ok(calls.some(([, name]) => name === "complete_ops_withdrawal_roster_transition_v3"))
    assert.ok(calls.filter(([kind]) => kind === "rpc" || kind === "producer").every(([, name]) => !["complete_ops_withdrawal_roster_transition_v2", "complete_ops_withdrawal_roster_transition"].includes(name)))
    assert.ok(!calls.some(([kind]) => kind === "direct-write"))
  }
})

test("missing or incompatible date-boundary capability rejects before completion or any legacy write", async () => {
  for (const options of [
    { capabilityError: { code: "PGRST202", message: "function missing" } },
    { capabilityError: { code: "42883", message: "function does not exist" } },
    { version: "withdrawal_last_lesson_release_v0" },
    { version: "withdrawal_last_lesson_release_v1" },
    { version: "" },
  ]) {
    const { calls, mocks } = harness(options)
    await assert.rejects(loadCompletion(mocks)("task-1", "withdrawal"), { message: unavailableMessage })
    assert.ok(!calls.some(([, name]) => name?.startsWith?.("complete_ops_")))
    assert.ok(!calls.some(([kind]) => ["direct-write", "public-cache"].includes(kind)))
  }
})

test("the existing maintenance guard blocks withdrawal completion, creation, and completed updates", async () => {
  for (const method of ["completeReadyOpsRosterTransition", "createOpsTransitionTask", "createOpsTask", "updateOpsTask"]) {
    const { calls, mocks } = harness({ mode: "maintenance" })
    const action = load(["isMissingOpsRosterRpc", "getOpsRosterRuntimeState", "assertWithdrawalLastLessonRuntimeReady", method], {
      ...mocks,
      loadOpsTaskById: async () => ({ id: "task-1", type: "withdrawal", status: "in_progress" }),
      getWordRetestScoreSavePlan: (_task, input) => ({ input, requiresStartTransition: false }),
      assertCompletedOperationStatusTransition: () => {},
      assertCompletedOperationEditable: () => {},
    })[method]
    const input = { type: "withdrawal", status: "done" }
    const invocation = method === "completeReadyOpsRosterTransition" ? action("task-1", "withdrawal")
      : method === "updateOpsTask" ? action("task-1", input) : action(input, { skipTransitionProducer: true })
    await assert.rejects(invocation, /데이터 전환 중에는 학생 명단을 변경할 수 없습니다/)
    assert.equal(calls.filter(([kind]) => kind === "rpc").length, 1, "only the read-only capability RPC may run")
    assert.ok(!calls.some(([kind]) => ["producer", "direct-write", "public-cache"].includes(kind)))
  }
})

test("a missing V3 completion never retries the old immediate-exclusion RPC", async () => {
  const expected = { code: "PGRST202", message: "missing V3" }
  const { calls, mocks } = harness({ completionError: expected })
  await assert.rejects(loadCompletion(mocks)("task-1", "withdrawal"), (error) => error === expected)
  const completions = calls.filter(([kind, name]) => ["rpc", "producer"].includes(kind) && name.startsWith("complete_ops_"))
  assert.equal(completions.length, 1)
  assert.equal(completions[0][1], "complete_ops_withdrawal_roster_transition_v3")
  assert.ok(!calls.some(([kind]) => ["direct-write", "public-cache"].includes(kind)))
})

test("capability connection errors and completion domain errors remain errors without fallback", async () => {
  for (const options of [
    { capabilityError: { code: "57014", message: "synthetic query timeout" } },
    { completionError: { code: "23514", message: "synthetic source roster conflict" } },
  ]) {
    const { calls, mocks } = harness(options)
    const expected = options.capabilityError || options.completionError
    await assert.rejects(loadCompletion(mocks)("task-1", "withdrawal"), (error) => error === expected)
    assert.ok(!calls.some(([kind]) => ["direct-write", "public-cache"].includes(kind)))
  }
})

test("transfer completion keeps its existing ready and legacy RPC routes", async () => {
  for (const [mode, rpc] of [["ready", "complete_ops_transfer_roster_transition_v2"], ["legacy", "complete_ops_transfer_roster_transition"]]) {
    const { calls, mocks } = harness({ mode })
    await loadCompletion(mocks)("task-1", "transfer")
    assert.ok(calls.some(([, name]) => name === rpc))
    assert.ok(!calls.some(([, name]) => name === "withdrawal_last_lesson_release_runtime_version"))
  }
})

test("the manual withdrawal sync refuses completed input before management writes", async () => {
  const { calls, mocks } = harness()
  const sync = load(["syncWithdrawalManagementLinks"], {
    ...mocks,
    resolveOpsStudent: async () => { calls.push(["read-student"]); return { id: "student-1" } },
    resolveOpsClass: async () => { calls.push(["read-class"]); return { id: "class-1" } },
    updateOpsTaskLinkFields: async () => calls.push(["write-links"]),
    removeOpsStudentFromClass: async () => calls.push(["remove-roster"]),
    setOpsStudentStatus: async () => calls.push(["write-status"]),
    markWithdrawalRosterUpdated: async () => calls.push(["write-detail"]),
  }).syncWithdrawalManagementLinks
  await assert.rejects(sync("task-1", { type: "withdrawal", status: "done" }), /퇴원 완료는 기준일을 포함하는 명단 처리 경로에서 진행하세요/)
  assert.ok(!calls.some(([kind]) => ["write-links", "remove-roster", "write-status", "write-detail"].includes(kind)))
})

test("nonterminal withdrawal sync retains its existing link updates without roster mutations", async () => {
  const { calls, mocks } = harness()
  const sync = load(["syncWithdrawalManagementLinks"], {
    ...mocks,
    resolveOpsStudent: async () => ({ id: "student-1", name: "synthetic student" }),
    resolveOpsClass: async () => ({ id: "class-1", name: "synthetic class", subject: "영어" }),
    updateOpsTaskLinkFields: async (taskId, links) => calls.push(["write-links", taskId, links]),
    removeOpsStudentFromClass: async () => { throw new Error("unexpected removal") },
  }).syncWithdrawalManagementLinks
  assert.equal(await sync("task-1", { type: "withdrawal", status: "in_progress" }), false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "write-links")
  assert.equal(calls[0][2].student_id, "student-1")
  assert.equal(calls[0][2].class_id, "class-1")
})

test("completed withdrawal status changes never fall through to direct task writes", async () => {
  const { calls, mocks } = harness()
  const expected = new Error(unavailableMessage)
  const update = load(["updateOpsTaskStatus"], {
    ...mocks,
    loadOpsTaskById: async () => ({ id: "task-1", type: "withdrawal", status: "in_progress" }),
    assertCompletedOperationStatusTransition: () => {},
    completeReadyOpsRosterTransition: async () => { calls.push(["complete-v3"]); throw expected },
  }).updateOpsTaskStatus
  await assert.rejects(update({ id: "task-1" }, "done"), (error) => error === expected)
  assert.deepEqual(calls, [["complete-v3"]])
})

test("withdrawal cancellation and canceled-task reopening keep their existing status producer routes", async () => {
  for (const [previous, next] of [["in_progress", "canceled"], ["canceled", "in_progress"]]) {
    const { calls, mocks } = harness()
    const update = load(["updateOpsTaskStatus"], {
      ...mocks,
      loadOpsTaskById: async () => ({ id: "task-1", type: "withdrawal", status: previous, updatedAt: "synthetic-version" }),
      assertCompletedOperationStatusTransition: () => {},
    }).updateOpsTaskStatus
    await update({ id: "task-1" }, next)
    const producer = calls.find(([kind]) => kind === "producer")
    assert.equal(producer[1], "transition_ops_task_status_v2")
    assert.equal(producer[2].p_status, next)
    assert.equal(producer[2].p_expected_updated_at, "synthetic-version")
    assert.ok(!calls.some(([kind]) => ["rpc", "direct-write"].includes(kind)))
  }
})

test("withdrawal creation and completed detail updates preflight the date-boundary capability before mutations", async () => {
  for (const method of ["createOpsTransitionTask", "createOpsTask", "updateOpsTask"]) {
    const { calls, mocks } = harness()
    const input = { type: "withdrawal", status: "done", withdrawal: { withdrawalDate: "2099-10-06" } }
    const expected = new Error(unavailableMessage)
    const action = load([method], {
      ...mocks,
      assertRegistrationInquiryBaseReady: () => {},
      assertManagementSyncReady: () => {},
      assertManagementSyncRecordsReady: async () => {},
      assertWithdrawalLastLessonRuntimeReady: async () => { calls.push(["capability"]); throw expected },
      loadOpsTaskById: async () => ({ id: "task-1", type: "withdrawal", status: "in_progress", updatedAt: "synthetic-version" }),
      getWordRetestScoreSavePlan: (_task, value) => ({ input: value, requiresStartTransition: false }),
      assertCompletedOperationStatusTransition: () => {},
      assertCompletedOperationEditable: () => {},
    })[method]
    const invocation = method === "updateOpsTask" ? action("task-1", input) : action(input, { skipTransitionProducer: true })
    await assert.rejects(invocation, (error) => error === expected)
    assert.deepEqual(calls, [["capability"]], `${method}: capability failure must precede mutations`)
  }
})

test("a missing producer on a completed withdrawal update cannot reach its legacy mutation branch", async () => {
  const expected = { code: "PGRST202", message: "synthetic old database" }
  const { calls, mocks } = harness({ producerError: expected })
  const update = load(["isMissingOpsRosterRpc", "updateOpsTask"], {
    ...mocks,
    assertRegistrationInquiryBaseReady: () => {},
    assertManagementSyncReady: () => {},
    assertManagementSyncRecordsReady: async () => {},
    assertWithdrawalLastLessonRuntimeReady: async () => {},
    loadOpsTaskById: async () => ({ id: "task-1", type: "withdrawal", status: "in_progress", updatedAt: "synthetic-version" }),
    getWordRetestScoreSavePlan: (_task, value) => ({ input: value, requiresStartTransition: false }),
    assertCompletedOperationStatusTransition: () => {},
    assertCompletedOperationEditable: () => {},
    getReadyOpsCompletionInput: (value) => value,
    buildOpsTaskProducerInput: (value) => ({ task: value }),
  }).updateOpsTask
  await assert.rejects(update("task-1", { type: "withdrawal", status: "done" }), (error) => error === expected)
  assert.equal(calls.filter(([kind]) => kind === "producer").length, 1)
  assert.ok(!calls.some(([kind]) => kind === "direct-write"))
})
