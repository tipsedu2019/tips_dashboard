import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const paths = {
  service: "../src/features/tasks/ops-task-service.ts",
  workspace: "../src/features/tasks/ops-task-workspace.tsx",
}
const parsed = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [
  key, ts.createSourceFile(path, await readFile(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
])))

function load(file, names, mocks = {}) {
  const snippets = new Map()
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) snippets.set(node.name.text, node.getText(parsed[file]))
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
      snippets.set(node.name.text, `const ${node.getText(parsed[file])}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed[file])
  const selected = names.map((name) => {
    assert.ok(snippets.has(name), `actual ${file} implementation: ${name}`)
    return snippets.get(name)
  })
  const sandboxModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`${selected.join("\n")}\nmodule.exports = { ${names.join(", ")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, { module: sandboxModule, exports: sandboxModule.exports, React, ...mocks })
  return sandboxModule.exports
}

const student = { id: "synthetic-student", name: "동명이인", classIds: [], waitlistClassIds: [] }
const classItem = { id: "synthetic-class", studentIds: [], waitlistIds: [] }
const input = {
  type: "withdrawal", status: "done", studentId: student.id, classId: classItem.id,
  withdrawal: { withdrawalDate: "2099-10-07", makeeduWithdrawalDone: true, feeProcessed: false, textbookFeeProcessed: false },
}
const text = (value) => String(value ?? "").trim()

test("actual UI and service allow all four fee combinations but retain MakeEdu confirmation", () => {
  for (const file of ["service", "workspace"]) {
    const { getMissingWithdrawalCheckLabels: check } = load(file, ["getMissingWithdrawalCheckLabels"])
    for (const feeProcessed of [false, true]) for (const textbookFeeProcessed of [false, true]) {
      assert.equal(check({ ...input.withdrawal, feeProcessed, textbookFeeProcessed }).length, 0)
      assert.deepEqual(Array.from(check({ makeeduWithdrawalDone: false, feeProcessed, textbookFeeProcessed })), ["메이크에듀 퇴원처리"])
    }
  }
})

test("UI completion allows both absent rosters with unpaid checks, retaining exact identity/date gates", () => {
  const { getOperationCompletionBlockers: blockers } = load("workspace", [
    "getMissingWithdrawalCheckLabels", "getRosterCompletionBlockers", "getOperationCompletionBlockers",
  ], {
    EMPTY_OPS_TASK_OPTION_INDEXES: {}, EMPTY_STUDENT_OPTIONS: [], EMPTY_CLASS_OPTIONS: [],
    EMPTY_TEXTBOOK_OPTIONS: [], EMPTY_TEACHER_OPTIONS: [], hasLinkedRecord: (value) => Boolean(text(value)),
    findStudentOption: (options, id) => options.find((item) => item.id === id),
    findClassOption: (options, id) => options.find((item) => item.id === id),
    prioritizeCompletionBlockers: (values) => [...new Set(values)],
  })
  assert.equal(blockers(input, [student], [classItem]).length, 0)
  assert.deepEqual(Array.from(blockers({ ...input, studentId: "missing", studentName: student.name }, [student], [classItem])), ["학생"])
  assert.deepEqual(Array.from(blockers({ ...input, classId: "missing" }, [student], [classItem])), ["수업"])
  assert.deepEqual(Array.from(blockers({ ...input, withdrawal: { ...input.withdrawal, withdrawalDate: "" } }, [student], [classItem])), ["퇴원일"])
})

test("service validates exact IDs without requiring roster membership or resolving the same name", async () => {
  const calls = []
  const { assertManagementSyncRecordsReady: ready } = load("service", ["assertManagementSyncRecordsReady", "assertResolvedManagementRecord"], {
    selectOpsRowById: async (table, id) => {
      calls.push([table, id])
      return table === "students" ? (id === student.id ? student : null) : classItem
    },
  })
  await ready(input)
  assert.deepEqual(calls, [["students", student.id], ["classes", classItem.id]])
  await assert.rejects(ready({ ...input, studentId: "", studentName: student.name }), /기존 학생을 다시 선택/)
})

test("pre-excluded transfer is allowed while word-retest still requires current source roster", () => {
  const { getRosterCompletionBlockers: blockers } = load("workspace", ["getRosterCompletionBlockers", "hasRosterLink"], {
    EMPTY_OPS_TASK_OPTION_INDEXES: {}, hasLinkedRecord: (value) => Boolean(text(value)),
    findStudentOptionByReference: () => student, findClassOptionByReference: () => classItem,
  })
  assert.deepEqual(Array.from(blockers({ ...input, type: "transfer", transfer: { fromClassId: classItem.id } }, [student], [classItem])), [])
  assert.deepEqual(Array.from(blockers({ ...input, type: "word_retest" }, [student], [classItem])), ["수업 명단"])
})

test("settlement service submits only one check plus expected state and fails closed on old runtime", async () => {
  for (const ready of [true, false]) {
    const calls = []
    const { updateWithdrawalSettlementCheck: update } = load("service", ["updateWithdrawalSettlementCheck"], {
      text,
      assertWithdrawalLastLessonRuntimeReady: async () => { if (!ready) throw new Error("old-runtime") },
      runIdempotentOpsTaskProducerRpc: async (name, parameters) => calls.push([name, parameters]),
      clearOpsTaskWorkspaceDataCache: () => calls.push(["clear-cache"]),
    })
    if (ready) {
      await update("task-synthetic", "textbookFeeProcessed", true, false)
      assert.equal(calls[0][0], "update_ops_withdrawal_settlement_check_v1")
      assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { p_task_id: "task-synthetic", p_field: "textbookFeeProcessed", p_checked: true, p_expected_checked: false })
      assert.equal(calls[1][0], "clear-cache")
    } else {
      await assert.rejects(update("task-synthetic", "textbookFeeProcessed", true, false), /old-runtime/)
      assert.equal(calls.length, 0)
    }
    await assert.rejects(update("task-synthetic", "makeeduWithdrawalDone", true, false), /비용 처리 확인/)
    await assert.rejects(update("task-synthetic", "feeProcessed", "true", false), /비용 처리 확인/)
  }
})

test("completed row checklist makes only the two fee checks actionable, preserving pending values", () => {
  const { WithdrawalOperationsChecklistChips: Chips } = load("workspace", ["getWithdrawalOperationsChecklist", "WithdrawalOperationsChecklistChips"], { Check: () => null })
  const calls = []
  const props = { withdrawal: input.withdrawal, editable: true, editableFields: ["feeProcessed", "textbookFeeProcessed"], onChange: (...args) => calls.push(args) }
  const tree = Chips(props)
  const buttons = tree.props.children.filter((item) => item.type === "button")
  assert.equal(buttons.length, 2)
  assert.ok(buttons.every((item) => item.props["aria-pressed"] === false))
  buttons[0].props.onClick()
  assert.deepEqual(calls, [["feeProcessed", true]])
  const markup = renderToStaticMarkup(React.createElement(Chips, props))
  assert.match(markup, /수업료 처리 완료 체크/)
  assert.doesNotMatch(markup, /aria-label="메이크에듀/)
  assert.equal(Chips({ ...props, editable: false }).props.children.filter((item) => item.type === "button").length, 0)
  assert.ok(Chips({ ...props, disabled: true }).props.children.filter((item) => item.type === "button").every((item) => item.props.disabled))
})

test("completed fee handler saves through the narrow endpoint and never repeats completion or dispatch", async () => {
  for (const manager of [true, false]) for (const field of ["feeProcessed", "textbookFeeProcessed", "makeeduWithdrawalDone"]) {
    const calls = []
    const task = { id: "synthetic-task", ...input }
    const { updateWithdrawalChecklist: update } = load("workspace", ["updateWithdrawalChecklist"], {
      canManageWithdrawalWorkflow: manager, canEditTaskDetails: () => false,
      setSaving: (value) => calls.push(["saving", value]), setMessage: () => {}, setNotice: () => {}, setStatusUndo: () => {},
      updateWithdrawalSettlementCheck: async (...args) => calls.push(["check", ...args]),
      loadOpsTaskById: async () => task, replaceTaskInState: () => {}, refreshFirstTaskPageAfterMutation: async () => {},
      getOpsTaskActionErrorMessage: (error) => { throw error },
      updateOpsTask: () => { throw new Error("general completion mutation forbidden") },
      dispatchLegacyOpsTaskSources: () => { throw new Error("notification dispatch forbidden") },
    })
    await update(task, field, true)
    if (manager && field !== "makeeduWithdrawalDone") {
      assert.deepEqual(calls.find(([kind]) => kind === "check"), ["check", task.id, field, true, false])
      assert.deepEqual(calls.at(-1), ["saving", false])
    } else assert.equal(calls.length, 0)
  }
})


test("settlement and re-entry conflicts explain the next action without exposing SQL codes", () => {
  const { getOpsTaskActionErrorMessage: message } = load("workspace", ["getUnknownErrorMessage", "getOpsTaskActionErrorMessage"])
  assert.equal(message({ message: "withdrawal_settlement_check_conflict" }, "fallback"), "다른 관리자가 비용 확인을 변경했습니다. 새로고침 후 다시 확인해 주세요.")
  assert.equal(message({ message: "ops_withdrawal_registration_changed" }, "fallback"), "신청 이후 학생의 수업 등록이 바뀌었습니다. 명단을 확인하고 퇴원 신청을 다시 검토해 주세요.")
  assert.equal(message({ message: "unrelated-error" }, "fallback"), "unrelated-error")
})
