import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { loadNotificationComponent as load } from "./helpers/notification-component-loader.mjs"

// Preserve the existing CI entry point when replacing the workload widget.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const expected = [
  ["등록", "/admin/registration"], ["전반", "/admin/transfer"],
  ["퇴원", "/admin/withdrawal"], ["휴보강", "/admin/makeup-requests"],
  ["수업관리", "/admin/classes"], ["교재관리", "/admin/textbooks"],
  ["학사일정", "/admin/academic-calendar"], ["통계", "/admin/statistics"],
]
async function fixture(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://example.test/admin/dashboard", pretendToBeVisual: true,
  })
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"])
    Object.defineProperty(globalThis, key, {
      configurable: true, value: key === "window" ? dom.window : dom.window[key],
    })
  const root = createRoot(document.getElementById("root"))
  const calls = []
  const deny = (name) => (...args) => { calls.push([name, ...args]); throw new Error(`unexpected ${name}`) }
  t.mock.method(globalThis, "fetch", deny("fetch"))
  t.mock.method(window, "setInterval", deny("interval"))
  let role = "admin"
  const { getRoleCapabilities } = load("src/lib/auth-utils.ts")
  const { default: Page } = load("src/app/admin/dashboard/page.tsx", new Map([
    ["@/providers/auth-provider", { useAuth: () => ({
      ...getRoleCapabilities(role), role, loading: false, isAdmin: role === "admin",
      user: { id: "synthetic-user" }, session: { user: { id: "synthetic-user" }, access_token: "synthetic" },
    }) }],
    ["@/lib/supabase", { supabase: { rpc: deny("rpc"), from: deny("from") } }],
    ["next/link", { __esModule: true, default: ({ prefetch, children, ...props }) =>
      createElement("a", { ...props, "data-prefetch": String(prefetch) }, children) }],
  ]))
  t.after(async () => { await act(async () => root.unmount()); dom.window.close() })
  const render = async (nextRole = role) => { role = nextRole; await act(async () => root.render(createElement(Page))) }
  const links = () => [...document.querySelectorAll('nav[aria-label="업무 바로가기"] a')]
  return { render, links, calls }
}
test("static dashboard renders eight real manager destinations without fetching", async (t) => {
  const f = await fixture(t)
  await f.render()
  assert.deepEqual(f.links().map((a) => [a.textContent, a.getAttribute("href")]), expected)
  assert.ok(f.links().every((a) => a.dataset.prefetch === "false" && a.tabIndex === 0))
  assert.equal(document.querySelectorAll("button").length, 0)
  assert.deepEqual(f.calls, [])
})
test("static dashboard follows existing roles and removes stale privileged links", async (t) => {
  const f = await fixture(t)
  const { getRoleCapabilities } = load("src/lib/auth-utils.ts")
  const { buildAdminNavGroups } = load("src/lib/navigation.ts")
  for (const role of ["admin", "teacher", "staff", "viewer", "assistant", "admin"]) {
    await f.render(role)
    const allowed = new Set(buildAdminNavGroups({ ...getRoleCapabilities(role), isAdmin: role === "admin" })
      .flatMap((g) => g.items.map((item) => item.url)))
    assert.deepEqual(f.links().map((a) => a.getAttribute("href")), expected.map(([, href]) => href).filter((href) => allowed.has(href)), role)
  }
  assert.deepEqual(f.calls, [])
})
test("static hub focus, visibility and rerenders do not start reads or polling", async (t) => {
  const f = await fixture(t)
  await f.render()
  for (const a of f.links()) {
    await act(async () => { a.focus(); a.dispatchEvent(new Event("pointerenter")) })
    assert.equal(document.activeElement, a)
  }
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("resize"))
  })
  await f.render()
  assert.deepEqual(f.calls, [])
})
