import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

async function setup(t, { dirty = true, detail = true, skipAutoFocusNotification = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/students?selected=student-1" })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const key of ["HTMLElement", "Element", "MutationObserver", "CustomEvent", "Event", "Node", "NodeFilter", "HTMLInputElement", "KeyboardEvent"])
    globalThis[key] = dom.window[key]
  globalThis.getComputedStyle = window.getComputedStyle
  globalThis.requestAnimationFrame = window.requestAnimationFrame = callback => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.HTMLElement.prototype.scrollIntoView = () => {}
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.style.display === "none" ? [] : [{ width: 32, height: 32 }] }
  window.navigation = Object.assign(new window.EventTarget(), { traverseTo: () => ({ committed: Promise.resolve(), finished: Promise.resolve() }) })
  if (skipAutoFocusNotification) {
    // Radix can skip this notification when an auto-focused child is already active.
    const dispatch = window.HTMLElement.prototype.dispatchEvent
    window.HTMLElement.prototype.dispatchEvent = function (event) {
      return event.type === "focusScope.autoFocusOnMount" ? true : dispatch.call(this, event)
    }
  }
  const { createRoot } = await import("react-dom/client")
  const calls = [], prefetches = [], confirmationOrigins = []
  const router = { push: path => calls.push(path), prefetch: path => prefetches.push(path) }
  const boundaries = new Map([
    ["next/navigation", { usePathname: () => "/admin/students", useRouter: () => router }],
    ["next/link", ({ children, ...props }) => React.createElement("a", props, children)],
    ["@/providers/auth-provider", { useAuth: () => ({ canManageAll: true, canEditCurriculumPlanning: true, canUseAssistantOperations: false }) }],
    ["@/components/mode-toggle", { ModeToggle: () => null }],
    ["@/hooks/use-mobile", { useIsMobile: () => false }],
  ])
  // Isolate the unrelated sidebar toggle; keep the real header/search/dialog/guard.
  boundaries.set("@/components/ui/sidebar", { SidebarTrigger: props => React.createElement("button", { ...props, type: "button" }, "메뉴") })
  const { SiteHeader: Header } = loadNotificationComponent("src/components/site-header.tsx", boundaries)
  const { Dialog, DialogContent, DialogTitle, DialogDescription } = loadNotificationComponent("src/components/ui/dialog.tsx", boundaries)
  const { useUnsavedNavigationGuard } = loadNotificationComponent("src/hooks/use-unsaved-navigation-guard.ts", boundaries)
  const h = React.createElement
  // The management confirmation explicitly restores its editor on close.
  function Harness() {
    const [confirmOpen, setConfirmOpen] = React.useState(false)
    const guard = useUnsavedNavigationGuard({ enabled: dirty, navigate: router.push, onConfirmRequest: () => {
      confirmationOrigins.push({ quickSearchExists: Boolean(document.querySelector('[data-testid="admin-quick-search-dialog"]')), active: document.activeElement?.getAttribute("aria-label") })
      setConfirmOpen(true)
    } })
    return h(React.Fragment, null,
      h(Header),
      detail ? h(Dialog, { open: true }, h(DialogContent, { "data-testid": "editor", className: "z-[80]" },
        h(DialogTitle, null, "학생 상세"), h(DialogDescription, null, "합성 편집기"),
        h("input", { "aria-label": "학생 초안", defaultValue: "미저장 초안" }))) : null,
      h(Dialog, { open: confirmOpen, onOpenChange: setConfirmOpen }, h(DialogContent, { layer: "nested", "data-testid": "confirm", onCloseAutoFocus: event => { event.preventDefault(); document.querySelector('[aria-label="학생 초안"]')?.focus() } },
        h(DialogTitle, null, "변경사항을 버릴까요?"), h(DialogDescription, null, "저장되지 않았습니다."),
        h("button", { onClick: () => { guard.cancelNavigation(); setConfirmOpen(false) } }, "계속 편집"),
        h("button", { onClick: () => { setConfirmOpen(false); guard.confirmNavigation() } }, "변경사항 버리기"))))
  }
  const root = createRoot(document.getElementById("root"))
  const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  await React.act(async () => root.render(h(Harness)))
  await settle()
  t.after(async () => { await React.act(async () => root.unmount()); await settle(); dom.window.close() })
  const key = async (value, extra = {}) => { await React.act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra }))); await settle() }
  const open = async () => { if (detail) document.querySelector('[aria-label="학생 초안"]').focus(); await key("k", { ctrlKey: true }); assert.ok(document.querySelector('[data-testid="admin-quick-search-dialog"]')); assert.ok(document.activeElement.matches('[cmdk-input]')) }
  const select = async (path, keyboard = false) => {
    const item = document.querySelector(`[data-testid="admin-quick-search-item-${path}"]`)
    assert.ok(item)
    if (keyboard) { await React.act(async () => item.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true }))); await key("Enter") }
    else { await React.act(async () => item.click()); await settle() }
  }
  const button = async name => { const el = [...document.querySelectorAll('[data-testid="confirm"] button')].find(b => b.textContent === name); assert.ok(el); await React.act(async () => el.click()); await settle() }
  return { open, key, select, button, calls, prefetches, confirmationOrigins, settle }
}

test("quick search is above an existing management detail", async t => {
  const p = await setup(t); await p.open()
  assert.ok(document.querySelector('[data-testid="admin-quick-search-dialog"]').classList.contains("z-[90]"))
})

for (const keyboard of [false, true]) test(`quick search ${keyboard ? "keyboard" : "pointer"} intent closes its scope before dirty confirmation`, async t => {
  const p = await setup(t); await p.open(); await p.select("admin-classes", keyboard)
  assert.deepEqual(p.calls, [])
  assert.deepEqual(p.confirmationOrigins, [{ quickSearchExists: false, active: "학생 초안" }])
  assert.ok(document.querySelector('[data-testid="confirm"]').contains(document.activeElement))
  await p.button("계속 편집")
  assert.equal(document.querySelector('[aria-label="학생 초안"]').value, "미저장 초안")
  assert.ok(document.activeElement.matches('[aria-label="학생 초안"]'))
  await p.open(); await p.select("admin-classes", keyboard); await p.button("변경사항 버리기")
  assert.deepEqual(p.calls, ["/admin/classes"])
})

test("current quick search path only closes and restores the editor", async t => {
  const p = await setup(t); await p.open(); await p.select("admin-students")
  assert.deepEqual(p.calls, []); assert.deepEqual(p.confirmationOrigins, [])
  assert.ok(document.activeElement.matches('[aria-label="학생 초안"]'))
  assert.equal(window.location.search, "?selected=student-1")
})

test("clean quick search navigates once after closing and preserves selective prefetch", async t => {
  const p = await setup(t, { dirty: false }); await p.open()
  const item = document.querySelector('[data-testid="admin-quick-search-item-admin-classes"]')
  await React.act(async () => item.dispatchEvent(new window.MouseEvent("pointerover", { bubbles: true })))
  await React.act(async () => item.dispatchEvent(new window.MouseEvent("pointerover", { bubbles: true })))
  await p.select("admin-classes")
  assert.deepEqual(p.calls, ["/admin/classes"]); assert.deepEqual(p.confirmationOrigins, [])
  assert.deepEqual(p.prefetches, ["/admin/classes"])
  assert.equal(document.querySelector('[data-testid="admin-quick-search-dialog"]'), null)
})

test("quick search Escape and shortcut toggle restore the real opening control", async t => {
  const p = await setup(t, { dirty: false, detail: false })
  const trigger = document.querySelector('[data-testid="admin-quick-search-trigger"]')
  await React.act(async () => { trigger.focus(); trigger.click() }); await p.settle()
  await p.key("Escape"); assert.ok(document.activeElement === trigger)
  await p.open(); await p.key("k", { ctrlKey: true }); assert.ok(document.activeElement === trigger)
  assert.deepEqual(p.calls, [])
})

test("reopening quick search resets selection even without the optional auto-focus notification", async t => {
  const p = await setup(t, { dirty: false, skipAutoFocusNotification: true })
  for (let index = 0; index < 3; index += 1) { await p.open(); await p.select("admin-classes") }
  assert.deepEqual(p.calls, ["/admin/classes", "/admin/classes", "/admin/classes"])
})
