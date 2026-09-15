import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { JSDOM } from "jsdom"
import { act, createElement, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"

const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function load(url, mocks = new Map()) {
  const output = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: url.pathname,
  }).outputText
  const runtimeModule = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: url.pathname })(
    (name) => mocks.has(name) ? mocks.get(name)
      : name.startsWith(".") ? load(new URL(name, url), mocks)
      : name.startsWith("@/") ? load(new URL(`src/${name.slice(2)}.tsx`, root), mocks)
      : require(name), runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function installDom(t) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/admin/dashboard" })
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] })
  }
  t.after(() => dom.window.close())
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  t.after(async () => { await act(async () => reactRoot.unmount()) })
  return { dom, container, reactRoot }
}

function fixture(localDate = "2026-09-12", count = 2) {
  return { localDate, generatedAt: `${localDate}T05:30:00Z`, counts: { levelTests: count, visitConsultations: 1, observationClasses: 0, openTasks: 99 }, upcoming: [] }
}

function auth(id = "user-a", role = "admin") {
  return { user: { id }, session: { user: { id }, access_token: `token-${id}` }, role, loading: false, canAccessDashboard: true }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test("daily brief keeps same-key data on refresh failure and isolates identity, role, late responses and KST midnight", async (t) => {
  const { dom, reactRoot } = installDom(t)
  const RealDate = Date
  let now = RealDate.parse("2026-09-12T14:59:00Z")
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  t.after(() => { globalThis.Date = RealDate })
  let authState = auth()
  let state
  const requests = []
  const { useDashboardDailyBrief } = load(new URL("src/features/dashboard/use-dashboard-daily-brief.ts", root), new Map([
    ["@/lib/supabase", { supabase: {} }],
    ["@/providers/auth-provider", { useAuth: () => authState }],
    ["./daily-brief-service.ts", { readDashboardDailyBrief: () => { const request = deferred(); requests.push(request); return request.promise } }],
  ]))
  const renders = []
  function Probe() {
    const value = useDashboardDailyBrief()
    useLayoutEffect(() => { state = value; renders.push(value) })
    return null
  }
  const render = () => act(async () => reactRoot.render(createElement(Probe)))
  await render()
  assert.equal(state.loading, true)
  assert.equal(state.brief, null)
  await act(async () => requests[0].reject(new Error("first failure")))
  assert.equal(state.loading, false)
  assert.match(state.error, /불러오지/)
  await act(async () => state.retry())
  const a = fixture()
  await act(async () => requests[1].resolve(a))
  assert.equal(state.brief, a)
  await act(async () => state.retry())
  assert.equal(state.brief, a)
  assert.equal(state.loading, true)
  await act(async () => requests[2].reject(new Error("refresh failure")))
  assert.equal(state.brief, a)
  assert.equal(state.brief.generatedAt, a.generatedAt)
  assert.match(state.error, /불러오지/)
  await act(async () => state.retry())
  const refreshed = fixture("2026-09-12", 4)
  await act(async () => requests[3].resolve(refreshed))
  assert.equal(state.brief, refreshed)
  assert.equal(state.error, null)

  await act(async () => state.retry())
  const oldRequest = requests[4]
  authState = auth("user-b")
  const boundary = renders.length
  await render()
  assert.ok(renders.slice(boundary).every((rendered) => rendered.brief === null))
  const b = fixture("2026-09-12", 7)
  await act(async () => requests[5].resolve(b))
  await act(async () => oldRequest.resolve(a))
  assert.equal(state.brief, b)
  authState = auth("user-b", "teacher")
  await render()
  assert.equal(state.brief, null)
  await act(async () => requests[6].resolve(b))
  assert.equal(state.brief, b)

  now = RealDate.parse("2026-09-12T15:00:00Z")
  await act(async () => dom.window.dispatchEvent(new dom.window.Event("focus")))
  assert.equal(state.localDate, "2026-09-13")
  assert.equal(state.brief, null)
  await act(async () => requests[7].resolve(fixture("2026-09-12")))
  assert.equal(state.brief, null)
  assert.match(state.error, /불러오지/)
  await act(async () => state.retry())
  await act(async () => requests[8].resolve(fixture("2026-09-13")))
  assert.equal(state.brief.localDate, "2026-09-13")
  await act(async () => state.retry())
  authState = { ...authState, session: null, user: null, canAccessDashboard: false }
  await render()
  assert.equal(state.brief, null)
  assert.equal(requests.length, 10)
  await act(async () => requests[9].resolve(b))
  assert.equal(state.brief, null)
  assert.match(state.error, /로그인/)
})

test("calendar boundary uses Seoul midnight independently of UTC date", () => {
  const { dashboardLocalDate, nextDashboardMidnight } = load(new URL("src/features/dashboard/daily-brief-date.ts", root))
  assert.equal(dashboardLocalDate(new Date("2026-09-12T14:59:59Z")), "2026-09-12")
  assert.equal(dashboardLocalDate(new Date("2026-09-12T15:00:00Z")), "2026-09-13")
  assert.equal(nextDashboardMidnight("2026-09-12"), Date.parse("2026-09-12T15:00:00Z"))
})
