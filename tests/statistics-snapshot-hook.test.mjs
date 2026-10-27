import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { JSDOM } from "jsdom"
import { act, createElement, useEffect } from "react"
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

test("snapshot hook retains same-key refresh errors and isolates query and role changes", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const cache = await import("../src/features/dashboard/statistics-cache.ts")
  const contract = await import("../src/features/dashboard/statistics-contract.ts")
  let auth = { user: { id: "hook-test-user" }, role: "admin", session: { access_token: "test-token" } }
  let resolveRequest
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => new Promise(resolve => { resolveRequest = resolve })
  t.after(() => { globalThis.fetch = originalFetch })
  const { useStatisticsSnapshot } = await loadTypeScript(new URL("src/features/dashboard/use-statistics-snapshot.ts", root), new Map([
    ["./statistics-contract.ts", contract], ["./statistics-cache.ts", cache],
    ["@/providers/auth-provider", { useAuth: () => auth }],
  ]))
  let state
  function Harness({ subject }) {
    const snapshot = useStatisticsSnapshot({ tab: "students_classes", subject })
    useEffect(() => { state = snapshot }, [snapshot])
    return null
  }
  const container = document.createElement("div")
  const reactRoot = createRoot(container)
  const render = subject => act(async () => { reactRoot.render(createElement(Harness, { subject })); await new Promise(resolve => setTimeout(resolve, 0)) })
  await render("english")
  assert.equal(state.loading, true)
  assert.equal(state.snapshot, null)
  await act(async () => resolveRequest(new Response(JSON.stringify({ ok: true, tab: "students_classes", contractVersion: "dashboard-statistics-v1", data: { count: 42 }, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), cacheStatus: "miss" }))))
  assert.deepEqual(state.data, { count: 42 })
  await act(async () => { state.refresh(); await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.equal(state.loading, true)
  assert.deepEqual(state.data, { count: 42 })
  await act(async () => resolveRequest(new Response("{}", { status: 500 })))
  assert.deepEqual(state.data, { count: 42 })
  assert.ok(state.error)
  await render("math")
  assert.equal(state.snapshot, null)
  assert.equal(state.data, null)
  auth = { ...auth, role: "staff" }
  await render("english")
  assert.equal(state.snapshot, null)
  auth = { user: null, role: null, session: null }
  await render("english")
  assert.equal(state.snapshot, null)
  assert.match(state.error, /로그인/)
  await act(async () => reactRoot.unmount())
})

async function relativeRangeHarness(t, initialInput, initialTime) {
  const dom = installDom()
  const RealDate = globalThis.Date
  const originalFetch = globalThis.fetch
  let clock = RealDate.parse(initialTime)
  class VirtualDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])) }
    static now() { return clock }
  }
  globalThis.Date = VirtualDate
  const contract = await import("../src/features/dashboard/statistics-contract.ts")
  const actualCache = await import("../src/features/dashboard/statistics-cache.ts")
  const cache = actualCache.createDashboardStatisticsMemoryCache({ now: () => clock })
  const requests = []
  let auth = { user: { id: "range-fixture-user" }, role: "admin", session: { access_token: "synthetic-value" } }
  let state
  let input = initialInput
  globalThis.fetch = (url, options) => {
    assert.match(url, /^\/api\/dashboard\/statistics\?/)
    assert.equal(options.method, "GET")
    const query = contract.parseDashboardStatisticsRequest(new URL(url, "https://synthetic.invalid").searchParams)
    assert.ok(query)
    return new Promise(resolve => requests.push({ ...query, signal: options.signal, resolve }))
  }
  const { useStatisticsSnapshot } = await loadTypeScript(new URL("src/features/dashboard/use-statistics-snapshot.ts", root), new Map([
    ["./statistics-contract.ts", contract],
    ["./statistics-cache.ts", { ...actualCache, dashboardStatisticsMemoryCache: cache }],
    ["@/providers/auth-provider", { useAuth: () => auth }],
  ]))
  function Harness() {
    const value = useStatisticsSnapshot(input)
    useEffect(() => { state = value }, [value])
    return null
  }
  const container = document.createElement("div")
  const reactRoot = createRoot(container)
  t.after(async () => {
    await act(async () => reactRoot.unmount())
    dom.window.close()
    globalThis.Date = RealDate
    globalThis.fetch = originalFetch
  })
  const flush = async (action) => act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const render = (nextInput = input) => flush(() => { input = nextInput; reactRoot.render(createElement(Harness)) })
  await render()
  return {
    requests,
    state: () => state,
    render,
    clock: time => { clock = RealDate.parse(time) },
    auth: value => { auth = value },
    refresh: () => flush(() => state.refresh()),
    settle: (index, data, status = 200) => flush(() => requests[index].resolve(new Response(JSON.stringify(status === 200 ? {
      ok: true, tab: requests[index].request.tab, contractVersion: "dashboard-statistics-v1", data,
      generatedAt: new RealDate(clock).toISOString(), expiresAt: new RealDate(clock + 600_000).toISOString(), cacheStatus: "refreshed",
    } : {}), { status }))),
  }
}

for (const scenario of [
  { name: "KST midnight", tab: "schedule_conflicts", range: "90", before: "2026-10-26T14:59:00Z", after: "2026-10-26T15:01:00Z", from: "2026-10-27", to: "2027-01-25" },
  { name: "KST month boundary", tab: "schedule_conflicts", range: "180", before: "2026-10-31T14:59:00Z", after: "2026-10-31T15:01:00Z", from: "2026-11-01", to: "2027-04-30" },
  { name: "KST year boundary", tab: "textbooks", range: "30", before: "2026-12-31T14:59:00Z", after: "2026-12-31T15:01:00Z", from: "2026-12-03", to: "2027-01-01" },
]) {
  test(`explicit statistics refresh recomputes relative dates at ${scenario.name}`, async (t) => {
    const h = await relativeRangeHarness(t, { tab: scenario.tab, rangeQuery: scenario.range }, scenario.before)
    await h.settle(0, { marker: "previous-day" })
    h.clock(scenario.after)
    await h.render()
    assert.equal(h.requests.length, 1, "clock movement/unrelated render alone does not poll")
    await h.refresh()
    assert.equal(h.requests.length, 2, "one explicit refresh produces one request")
    assert.equal(h.requests[1].refresh, true)
    assert.equal(h.requests[1].request.dateFrom, scenario.from)
    assert.equal(h.requests[1].request.dateTo, scenario.to)
    assert.equal(h.state().range, Number(scenario.range))
    assert.equal(h.state().snapshot, null, "old date result is hidden for new key before response")
    await h.settle(1, null, 500)
    assert.equal(h.state().data, null, "new-date failure cannot revive yesterday's result")
    assert.ok(h.state().error)
    await h.refresh()
    assert.equal(h.requests.length, 3)
    assert.equal(h.requests[2].refresh, true)
    assert.deepEqual(h.requests[2].request, h.requests[1].request)
    await h.settle(2, { marker: "current-day" })
    assert.deepEqual(h.state().data, { marker: "current-day" })
    assert.equal(h.state().error, null)
  })
}

test("same-day relative refresh preserves accepted data and ignores a superseded day response", async (t) => {
  const h = await relativeRangeHarness(t, { tab: "textbooks", rangeQuery: "30" }, "2026-10-26T14:58:00Z")
  await h.settle(0, { marker: "accepted" })
  const acceptedTime = h.state().generatedAt
  h.clock("2026-10-26T14:59:00Z")
  await h.refresh()
  assert.deepEqual(h.state().data, { marker: "accepted" })
  assert.equal(h.state().generatedAt, acceptedTime)
  assert.deepEqual(h.requests[1].request, h.requests[0].request)
  await h.settle(1, null, 500)
  assert.deepEqual(h.state().data, { marker: "accepted" })
  assert.equal(h.state().generatedAt, acceptedTime)
  await h.refresh() // still old day; deliberately hold this read
  h.clock("2026-10-26T15:01:00Z")
  await h.refresh()
  assert.equal(h.requests.length, 4)
  assert.equal(h.requests[2].signal.aborted, true)
  assert.equal(h.requests[3].refresh, true)
  assert.equal(h.state().data, null)
  await h.settle(3, { marker: "new-day" })
  await h.settle(2, { marker: "late-old-day" })
  assert.deepEqual(h.state().data, { marker: "new-day" })
  assert.equal(h.state().error, null)
  assert.equal(h.requests.length, 4)
})

test("date-refresh result cannot cross preset, role or logout boundaries", async (t) => {
  const h = await relativeRangeHarness(t, { tab: "schedule_conflicts", rangeQuery: "90" }, "2026-10-26T14:59:00Z")
  await h.settle(0, { marker: "first" })
  h.clock("2026-10-26T15:01:00Z")
  await h.refresh()
  await h.render({ tab: "schedule_conflicts", rangeQuery: "180" })
  assert.equal(h.requests[1].signal.aborted, true)
  assert.equal(h.requests[2].request.dateFrom, "2026-10-27")
  assert.equal(h.requests[2].request.dateTo, "2027-04-25")
  assert.equal(h.requests[2].refresh, true, "outstanding force intent follows the new preset")
  await h.settle(2, { marker: "180-days" })
  await h.settle(1, { marker: "late-90-days" })
  assert.deepEqual(h.state().data, { marker: "180-days" })
  h.auth({ user: { id: "range-fixture-user" }, role: "staff", session: { access_token: "synthetic-new" } })
  await h.render()
  assert.equal(h.state().data, null)
  assert.equal(h.requests[3].refresh, false)
  h.auth({ user: null, role: null, session: null })
  await h.render()
  await h.settle(3, { marker: "late-staff" })
  assert.equal(h.state().data, null)
  assert.match(h.state().error, /로그인/)
  assert.equal(h.requests.length, 4)
})

test("explicit refresh keeps date-free statistics filters and requests date-free", async (t) => {
  const h = await relativeRangeHarness(t, { tab: "students_classes", subject: "english", division: "high" }, "2026-10-26T14:59:00Z")
  await h.settle(0, { marker: "students" })
  h.clock("2026-10-26T15:01:00Z")
  await h.refresh()
  assert.deepEqual(h.requests[1].request, { tab: "students_classes", subject: "english", division: "high", dateFrom: "", dateTo: "" })
  assert.equal(h.requests[1].refresh, true)
  assert.deepEqual(h.state().data, { marker: "students" })
  await h.settle(1, { marker: "updated" })
  await h.render({ tab: "overview" })
  assert.deepEqual(h.requests[2].request, { tab: "overview", subject: "all", division: "all", dateFrom: "", dateTo: "" })
  assert.equal(h.requests[2].refresh, false)
  assert.equal(h.requests.length, 3)
})

async function authLifecycleHarness(t, { ignoreAbort = false, consumers = 1 } = {}) {
  const dom = installDom()
  const originalFetch = globalThis.fetch
  const contract = await import("../src/features/dashboard/statistics-contract.ts")
  const actualCache = await import("../src/features/dashboard/statistics-cache.ts")
  const cache = actualCache.createDashboardStatisticsMemoryCache()
  let auth = { user: { id: "synthetic-auth-user" }, role: "admin", session: { access_token: "synthetic-A" } }
  const requests = []
  const states = new Map()
  globalThis.fetch = (url, options) => {
    const parsed = contract.parseDashboardStatisticsRequest(new URL(url, "https://synthetic.invalid").searchParams)
    assert.deepEqual(parsed.request, { tab: "students_classes", subject: "english", division: "all", dateFrom: "", dateTo: "" })
    assert.equal(options.method, "GET")
    return new Promise((resolve, reject) => {
      requests.push({ signal: options.signal, authorization: options.headers.Authorization, resolve })
      const abort = () => { if (!ignoreAbort) reject(new DOMException("Synthetic abort", "AbortError")) }
      if (options.signal.aborted) abort()
      else options.signal.addEventListener("abort", abort, { once: true })
    })
  }
  const { useStatisticsSnapshot } = await loadTypeScript(new URL("src/features/dashboard/use-statistics-snapshot.ts", root), new Map([
    ["./statistics-contract.ts", contract],
    ["./statistics-cache.ts", { ...actualCache, dashboardStatisticsMemoryCache: cache }],
    ["@/providers/auth-provider", { useAuth: () => auth }],
  ]))
  function Harness({ id }) {
    const value = useStatisticsSnapshot({ tab: "students_classes", subject: "english" })
    useEffect(() => { states.set(id, value) }, [id, value])
    return null
  }
  const reactRoot = createRoot(document.createElement("div"))
  const flush = action => act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const render = () => flush(() => reactRoot.render(Array.from({ length: consumers }, (_, id) => createElement(Harness, { key: id, id }))))
  t.after(async () => {
    await act(async () => reactRoot.unmount())
    globalThis.fetch = originalFetch
    dom.window.close()
  })
  await render()
  return {
    requests,
    state: (id = 0) => states.get(id),
    rotate: () => { auth = { ...auth, session: { access_token: auth.session.access_token === "synthetic-A" ? "synthetic-B" : "synthetic-C" } }; return render() },
    auth: value => { auth = value; return render() },
    refresh: () => flush(() => states.get(0).refresh()),
    settle: (index, count, status = 200) => flush(() => requests[index].resolve(new Response(JSON.stringify(status === 200 ? {
      ok: true, tab: "students_classes", contractVersion: "dashboard-statistics-v1", data: { count },
      generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), cacheStatus: "miss",
    } : {}), { status }))),
  }
}

test("same-actor credential renewal replaces an aborted statistics read exactly once", async t => {
  const h = await authLifecycleHarness(t, { consumers: 2 })
  assert.equal(h.requests.length, 1, "live consumers share one transport")
  await h.rotate()
  assert.equal(h.requests[0].signal.aborted, true)
  assert.equal(h.requests.length, 2, "renewed consumers share one replacement instead of the cancelled promise")
  assert.equal(h.requests[1].authorization, "Bearer synthetic-B")
  await h.settle(1, 2)
  for (const id of [0, 1]) {
    assert.deepEqual(h.state(id).data, { count: 2 })
    assert.equal(h.state(id).error, null)
    assert.equal(h.state(id).loading, false)
  }
})

test("late cancelled statistics response cannot overwrite or cache over the renewed read", async t => {
  const h = await authLifecycleHarness(t, { ignoreAbort: true })
  await h.rotate()
  assert.equal(h.requests.length, 2)
  await h.settle(1, 2)
  await h.settle(0, 1)
  assert.deepEqual(h.state().data, { count: 2 })
  await h.rotate()
  assert.equal(h.requests.length, 2, "settled cache is preserved after credential renewal")
  assert.deepEqual(h.state().data, { count: 2 })
})

test("auth renewal preserves accepted statistics and supports retry after a real failure", async t => {
  const h = await authLifecycleHarness(t)
  await h.settle(0, 1)
  await h.refresh()
  await h.rotate()
  assert.equal(h.requests.length, 3)
  assert.deepEqual(h.state().data, { count: 1 })
  await h.settle(2, null, 500)
  assert.deepEqual(h.state().data, { count: 1 })
  assert.match(h.state().error, /불러오지 못/)
  await h.refresh()
  assert.equal(h.requests.length, 4)
  await h.settle(3, 2)
  assert.deepEqual(h.state().data, { count: 2 })
  assert.equal(h.state().error, null)
})

test("credential renewal cannot carry late statistics across role, account or logout", async t => {
  const h = await authLifecycleHarness(t, { ignoreAbort: true })
  await h.rotate()
  await h.auth({ user: { id: "synthetic-auth-user" }, role: "staff", session: { access_token: "synthetic-staff" } })
  assert.equal(h.state().data, null)
  await h.settle(1, 2)
  assert.equal(h.state().data, null)
  await h.settle(2, 3)
  assert.deepEqual(h.state().data, { count: 3 })
  await h.auth({ user: { id: "synthetic-other" }, role: "staff", session: { access_token: "synthetic-other" } })
  assert.equal(h.state().data, null)
  await h.auth({ user: null, role: null, session: null })
  await h.settle(3, 4)
  await h.settle(0, 1)
  assert.equal(h.state().data, null)
  assert.match(h.state().error, /로그인/)
  assert.equal(h.requests.length, 4)
})
