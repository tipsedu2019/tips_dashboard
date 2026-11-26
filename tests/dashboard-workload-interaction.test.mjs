import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { loadNotificationComponent as load } from "./helpers/notification-component-loader.mjs"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { getRoleCapabilities } = load("src/lib/auth-utils.ts")
const { buildAdminNavGroups } = load("src/lib/navigation.ts")

function fixture(t, role) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test/admin" })
  const { window } = dom
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"]) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : window[name] })
  }
  const root = createRoot(document.getElementById("root"))
  t.after(async () => { await act(async () => root.unmount()); window.close() })
  const destinations = []
  const redirect = (destination) => { destinations.push(destination); return null }
  const auth = {
    ...getRoleCapabilities(role), role, loading: false, isAdmin: role === "admin",
    isTeacher: role === "teacher", user: role ? { id: "synthetic", role } : null,
  }
  const router = { replace: redirect }
  const boundaries = new Map([
    ["next/navigation", { redirect, useRouter: () => router, usePathname: () => window.location.pathname,
      useSearchParams: () => new URLSearchParams(window.location.search) }],
    ["@/providers/auth-provider", { useAuth: () => auth }],
    ["@/features/operations/academic-calendar-workspace", { AcademicCalendarWorkspace: () =>
      createElement("main", { "data-workspace": "academic-calendar" }) }],
    ["@/features/tasks/ops-task-workspace", { OpsTaskWorkspace: ({ workspace }) =>
      createElement("main", { "data-workspace": workspace }) }],
  ])
  const { AuthGuard } = load("src/components/auth/auth-guard.tsx", boundaries)
  async function visit(path) {
    destinations.length = 0
    window.history.replaceState(null, "", path)
    const { default: Page } = load(`src/app${window.location.pathname}/page.tsx`, boundaries)
    await act(async () => root.render(createElement(AuthGuard, null, createElement(Page))))
    return [...destinations]
  }
  return { visit, workspace: () => document.querySelector("main[data-workspace]")?.dataset.workspace }
}

const homes = [
  ["admin", "/admin/registration", "registration"],
  ["staff", "/admin/registration", "registration"],
  ["assistant", "/admin/word-retests", "word_retest"],
  ["teacher", "/admin/academic-calendar", "academic-calendar"],
  ["viewer", "/admin/academic-calendar", "academic-calendar"],
  ["unknown", "/admin/academic-calendar", "academic-calendar"],
]
for (const [role, target, workspace] of homes) {
  test(`${role} enters its permitted workspace through the guarded admin index`, async (t) => {
    const f = fixture(t, role)
    assert.deepEqual(await f.visit("/admin"), [target])
    assert.deepEqual(await f.visit(target), [])
    assert.equal(f.workspace(), workspace)
    const items = buildAdminNavGroups({ ...getRoleCapabilities(role), isAdmin: role === "admin" }).flatMap(group => group.items)
    assert.ok(items.some(item => item.url === target))
    if (role === "admin" || role === "staff") assert.equal(items[0].url, target)
    assert.ok(items.every(item => item.url !== "/admin/dashboard" && item.title !== "대시보드"))
  })
}
test("a registration bookmark cannot grant assistants registration access", async (t) => {
  const f = fixture(t, "assistant")
  assert.deepEqual(await f.visit("/admin/registration?flow=completed"), ["/admin/word-retests"])
  assert.equal(f.workspace(), undefined)
})
test("an anonymous registration bookmark returns through sign-in with the original query", async (t) => {
  const f = fixture(t, null)
  const path = "/admin/registration?flow=completed"
  assert.deepEqual(await f.visit(path), [`/sign-in?next=${encodeURIComponent(path)}`])
  assert.equal(f.workspace(), undefined)
})
test("the former dashboard bookmark reaches the permitted home without rendering a link hub", async (t) => {
  const f = fixture(t, "admin")
  assert.deepEqual(await f.visit("/admin/dashboard"), ["/admin"])
  assert.equal(document.querySelector('nav[aria-label="업무 바로가기"]'), null)
  assert.deepEqual(await f.visit("/admin"), ["/admin/registration"])
  assert.deepEqual(await f.visit("/admin/registration"), [])
  assert.equal(f.workspace(), "registration")
})
