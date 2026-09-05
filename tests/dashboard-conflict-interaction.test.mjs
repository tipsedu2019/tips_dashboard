import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"

const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function loadTypeScript(url, localModules = new Map()) {
  const source = await readFile(url, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText
  const runtimeModule = { exports: {} }
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    if (localModules.has(specifier)) return localModules.get(specifier)
    return require(specifier)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: url.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://example.test/admin/statistics",
  })
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  return dom
}

const conflict = {
  key: "weekly:v1:teacher:월:09:00-10:00:a:b", type: "teacher", occurrenceKind: "weekly",
  title: "선생님 일정 충돌", nextOccurrenceAt: "", recurrenceDay: "월", problem: "두 수업이 겹칩니다.",
  ownerLabel: "관리팀", resolution: "수업 시간 변경", classIds: ["a", "b"], classNames: ["수업 A", "수업 B"],
  affectedStudentIds: ["student"], subject: "영어", campus: "", primaryAssigneeProfileId: "",
  secondaryAssigneeProfileId: "", assigneeTeam: "관리팀",
  source: { classIds: ["a", "b"], studentIds: [], examEventIds: [], examDetailIds: [], teacherCatalogIds: [],
    classroomCatalogIds: [], weekday: "월", overlapStart: "09:00", overlapEnd: "10:00", examDate: "", examRule: "" },
}
const unlinked = { conflictKey: conflict.key, linked: false, taskId: "", canOpen: false, alreadyExists: false }
const linked = { conflictKey: conflict.key, linked: true, taskId: "task-1", canOpen: true, alreadyExists: false }

async function mountConflict(t, service, role = "admin") {
  const dom = installDom()
  const utils = await loadTypeScript(new URL("src/lib/utils.ts", root))
  const modules = new Map([["@/lib/utils", utils]])
  for (const name of ["alert", "badge", "button", "card", "popover"]) {
    modules.set(`@/components/ui/${name}`, await loadTypeScript(new URL(`src/components/ui/${name}.tsx`, root), modules))
  }
  modules.set("@/features/dashboard/conflict-contract", await loadTypeScript(new URL("src/features/dashboard/conflict-contract.ts", root)))
  modules.set("@/features/dashboard/snapshot-sources.js", await import("../src/features/dashboard/snapshot-sources.js"))
  modules.set("@/features/tasks/ops-task-service", service)
  modules.set("@/providers/auth-provider", { useAuth: () => ({ role }) })
  modules.set("next/link", { default: ({ children, ...props }) => createElement("a", props, children), __esModule: true })
  modules.set("sonner", { toast: { error() {} } })
  const { ConflictWarning } = await loadTypeScript(new URL("src/app/admin/dashboard/components/section-cards.tsx", root), modules)
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  t.after(async () => { await act(async () => reactRoot.unmount()); dom.window.close() })
  await act(async () => reactRoot.render(createElement(ConflictWarning, { metrics: {
    conflictRows: [conflict], conflictSources: { schedule: { status: "ready", error: "" }, exam: { status: "ready", error: "" } },
    retryConflictSources() {},
  } })))
  return container
}

function button(container, label) {
  return [...container.querySelectorAll("button")].find(element => element.textContent === label)
}
async function click(element) {
  assert.ok(element, "expected action is available")
  await act(async () => element.click())
}

test("failed task-link lookup retries the read without creating a task or exposing the database error", async (t) => {
  let reads = 0
  let writes = 0
  let resolveRetry
  const container = await mountConflict(t, {
    async listDashboardConflictTaskLinks(inputs) {
      assert.equal(inputs[0].studentIds.length, 0)
      reads++
      if (reads === 1) throw { code: "22023", message: "dashboard_conflict_input_invalid" }
      return new Promise(resolve => { resolveRetry = resolve })
    },
    async createDashboardConflictTask() { writes++; return linked },
  })
  assert.equal(container.textContent.includes("등록 실패"), false, "a read failure must not claim that registration failed")
  assert.equal(container.textContent.includes("dashboard_conflict_input_invalid"), false)
  await click(button(container, "상태 확인 다시 시도"))
  assert.equal(reads, 2)
  assert.equal(writes, 0, "retry must never promote a read into a write")
  assert.ok(button(container, "확인 중")?.disabled)
  assert.equal(button(container, "할 일 등록"), undefined)
  await act(async () => resolveRetry([unlinked]))
  assert.ok(button(container, "할 일 등록"))
  assert.equal(writes, 0)
})

test("read-only viewer can retry a failed status lookup but never receives a registration action", async (t) => {
  let reads = 0
  let writes = 0
  const container = await mountConflict(t, {
    async listDashboardConflictTaskLinks() {
      if (++reads === 1) throw new Error("network failed")
      return [unlinked]
    },
    async createDashboardConflictTask() { writes++; return linked },
  }, "viewer")
  await click(button(container, "상태 확인 다시 시도"))
  assert.equal(reads, 2)
  assert.equal(writes, 0)
  assert.equal(button(container, "할 일 등록"), undefined)
  assert.ok(container.textContent.includes("관리팀 등록 필요"))
})

test("explicit registration failure retains the registration retry and opens the created task", async (t) => {
  let writes = 0
  let reads = 0
  const container = await mountConflict(t, {
    async listDashboardConflictTaskLinks() { reads++; return [unlinked] },
    async createDashboardConflictTask() {
      if (++writes === 1) throw new Error("write failed")
      return linked
    },
  })
  await click(button(container, "할 일 등록"))
  await click(button(container, "등록 실패 · 다시 시도"))
  assert.equal(writes, 2)
  assert.equal(reads, 1)
  assert.equal(container.querySelector("a")?.getAttribute("href"), "/admin/tasks?taskId=task-1")
})

test("legacy statistics rows keep affected students for display but omit them from resource identity", async () => {
  const { projectDashboardConflictRpcInput } = await loadTypeScript(new URL("src/features/dashboard/conflict-contract.ts", root))
  for (const type of ["teacher", "classroom"]) {
    const row = { ...conflict, type, source: { ...conflict.source, studentIds: ["student"] } }
    assert.deepEqual(projectDashboardConflictRpcInput(row).studentIds, [])
    assert.deepEqual(row.source.studentIds, ["student"], "projection must not mutate cached data")
    assert.deepEqual(row.affectedStudentIds, ["student"])
  }
  for (const type of ["student", "exam"]) {
    const row = { ...conflict, type, source: { ...conflict.source, studentIds: ["student"] } }
    assert.deepEqual(projectDashboardConflictRpcInput(row).studentIds, ["student"])
  }
})
