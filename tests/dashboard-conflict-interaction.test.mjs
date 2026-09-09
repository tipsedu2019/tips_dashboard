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
async function mountConflict(t, { rows = [conflict], status = "ready", role = "admin", retry = () => {} } = {}) {
  const dom = installDom()
  const calls = []
  const forbiddenCall = (kind) => () => { calls.push(kind); throw new Error("Conflict monitoring must not access tasks") }
  const utils = await loadTypeScript(new URL("src/lib/utils.ts", root))
  const modules = new Map([["@/lib/utils", utils]])
  for (const name of ["alert", "badge", "button", "card", "popover"]) {
    modules.set(`@/components/ui/${name}`, await loadTypeScript(new URL(`src/components/ui/${name}.tsx`, root), modules))
  }
  modules.set("@/features/tasks/ops-task-service", {
    listDashboardConflictTaskLinks: forbiddenCall("read"),
    createDashboardConflictTask: forbiddenCall("write"),
  })
  modules.set("@/providers/auth-provider", { useAuth: () => ({ role }) })
  const { ConflictWarning } = await loadTypeScript(new URL("src/app/admin/dashboard/components/section-cards.tsx", root), modules)
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  t.after(async () => { await act(async () => reactRoot.unmount()); dom.window.close() })
  await act(async () => reactRoot.render(createElement(ConflictWarning, { metrics: {
    conflictRows: rows,
    conflictSources: { schedule: { status, error: "" }, exam: { status, error: "" } },
    retryConflictSources: retry,
  } })))
  return { container, calls }
}

function button(container, label) {
  return [...container.querySelectorAll("button")].find(element => element.textContent === label)
}
async function click(element) {
  assert.ok(element, "expected action is available")
  await act(async () => element.click())
}

for (const role of ["admin", "staff", "teacher", "viewer"]) {
  test(`${role} sees a populated conflict with no task creation, task link, or task lookup`, async (t) => {
    const { container, calls } = await mountConflict(t, { role })
    assert.match(container.textContent, /일정 충돌 1건/)
    for (const value of [conflict.problem, conflict.ownerLabel, conflict.resolution, "월요일 09:00"]) {
      assert.ok(container.textContent.includes(value), value)
    }
    assert.equal(container.querySelectorAll("button, a").length, 0)
    assert.doesNotMatch(container.textContent, /할 일|등록됨|관리팀 등록 필요|확인 중/)
    assert.deepEqual(calls, [])
  })
}

test("monitoring expands all conflict types and collapses without any task RPC", async (t) => {
  const rows = ["teacher", "classroom", "student", "exam"].map((type, index) => ({
    ...conflict, key: `conflict-${index}`, type, problem: `문제 ${index}`,
  }))
  const { container, calls } = await mountConflict(t, { rows })
  assert.equal(container.querySelector("#dashboard-conflict-rows").children.length, 3)
  const expand = button(container, "전체 보기")
  assert.equal(expand.getAttribute("aria-expanded"), "false")
  await click(expand)
  assert.equal(container.querySelector("#dashboard-conflict-rows").children.length, 4)
  assert.equal(button(container, "접기").getAttribute("aria-expanded"), "true")
  await click(button(container, "접기"))
  assert.equal(container.querySelector("#dashboard-conflict-rows").children.length, 3)
  assert.deepEqual(calls, [])
})

test("source retry keeps known conflicts visible and only refreshes monitoring sources", async (t) => {
  let retries = 0
  const { container, calls } = await mountConflict(t, { status: "error", retry: () => { retries++ } })
  assert.match(container.textContent, /일정 충돌을 확인하지 못했습니다/)
  assert.ok(container.textContent.includes(conflict.problem))
  await click(button(container, "다시 시도"))
  assert.equal(retries, 1)
  assert.equal(container.querySelectorAll("button").length, 1)
  assert.deepEqual(calls, [])
})

test("empty successful monitoring has no warning or background task access", async (t) => {
  const { container, calls } = await mountConflict(t, { rows: [] })
  assert.equal(container.textContent, "")
  assert.deepEqual(calls, [])
})

test("loading monitoring retains its own status without showing task-registration state", async (t) => {
  const { container, calls } = await mountConflict(t, { rows: [], status: "loading" })
  assert.match(container.textContent, /일정 충돌을 확인하고 있습니다/)
  assert.equal(container.querySelectorAll("button, a").length, 0)
  assert.deepEqual(calls, [])
})
