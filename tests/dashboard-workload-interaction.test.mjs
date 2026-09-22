import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import { loadNotificationComponent as load } from "./helpers/notification-component-loader.mjs"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
function dom(t) {
  const instance = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://example.test/admin/dashboard", pretendToBeVisual: true },
  )
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? instance.window : instance.window[key],
    })
  const root = createRoot(document.getElementById("root"))
  t.after(async () => {
    await act(async () => root.unmount())
    instance.window.close()
  })
  return { root, window: instance.window }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const auth = (id = "a", role = "admin") => ({
  user: { id },
  session: { user: { id }, access_token: `token-${id}` },
  role,
  loading: false,
  canAccessDashboard: true,
})
const summary = { generatedAt: "2026-09-22T01:00:00Z", groups: [] }
test("workload refresh retains accepted data on error, isolates identity/filter and ignores old requests", async (t) => {
  const { root } = dom(t)
  let identity = auth(),
    request,
    state
  const reads = []
  const enqueue = () => {
    const value = deferred()
    reads.push(value)
    return value.promise
  }
  const { useDashboardWorkload } = load(
    "src/features/dashboard/use-dashboard-workload.ts",
    new Map([
      ["@/lib/supabase", { supabase: {} }],
      ["@/providers/auth-provider", { useAuth: () => identity }],
      [
        "./workload-service.ts",
        { readWorkloadSummary: enqueue, readWorkloadPage: enqueue },
      ],
    ]),
  )
  function Probe() {
    const value = useDashboardWorkload(request)
    useLayoutEffect(() => {
      state = value
    })
    return null
  }
  const render = () => act(async () => root.render(createElement(Probe)))
  await render()
  assert.equal(state.loading, true)
  await act(async () => reads[0].resolve(summary))
  assert.equal(state.data, summary)
  await act(async () => state.refresh())
  await act(async () => reads[1].reject(new Error("offline")))
  assert.equal(state.data, summary)
  assert.match(state.error, /불러오지/)
  await act(async () => state.refresh())
  identity = auth("b")
  await render()
  assert.equal(state.data, null)
  await act(async () => reads[2].resolve(summary))
  assert.equal(state.data, null)
  await act(async () => reads[3].resolve(summary))
  assert.equal(state.data, summary)
  request = { filter: { team: "영어팀" }, page: 1, pageSize: 10 }
  await render()
  assert.equal(state.data, null)
  identity = auth("b", "teacher")
  await render()
  assert.equal(state.data, null)
  await act(async () => reads[4].resolve({ rows: [{ title: "stale" }] }))
  assert.equal(state.data, null)
})
test("automatic reads are throttled, paused in background and never overlap", async (t) => {
  const { root, window } = dom(t)
  let tick, state
  let now = 100000
  const originalNow = Date.now
  Date.now = () => now
  t.after(() => {
    Date.now = originalNow
  })
  window.setInterval = (callback) => {
    tick = callback
    return 1
  }
  window.clearInterval = () => {}
  let visible = "visible"
  Object.defineProperty(document, "visibilityState", {
    get: () => visible,
    configurable: true,
  })
  const reads = []
  const { useDashboardWorkload } = load(
    "src/features/dashboard/use-dashboard-workload.ts",
    new Map([
      ["@/lib/supabase", { supabase: {} }],
      ["@/providers/auth-provider", { useAuth: () => auth() }],
      [
        "./workload-service.ts",
        {
          readWorkloadSummary: () => {
            const r = deferred()
            reads.push(r)
            return r.promise
          },
        },
      ],
    ]),
  )
  function Probe() {
    const value = useDashboardWorkload()
    useLayoutEffect(() => {
      state = value
    })
    return null
  }
  await act(async () => root.render(createElement(Probe)))
  assert.equal(reads.length, 1)
  now += 60000
  await act(async () => tick())
  assert.equal(reads.length, 1)
  await act(async () => reads[0].resolve(summary))
  visible = "hidden"
  now += 60000
  await act(async () => tick())
  assert.equal(reads.length, 1)
  visible = "visible"
  await act(async () => window.dispatchEvent(new Event("focus")))
  assert.equal(reads.length, 2)
  await act(async () => reads[1].resolve(summary))
  await act(async () => window.dispatchEvent(new Event("focus")))
  assert.equal(reads.length, 2)
  assert.equal(state.loading, false)
})
