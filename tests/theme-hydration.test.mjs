import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { renderToString } from "react-dom/server"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

async function setup(t, { saved = "dark", systemDark = false, storageBlocked = false, defaultTheme = "light" } = {}) {
  delete globalThis.window
  delete globalThis.document
  const ThemeProviderContext = React.createContext({ theme: "system", setTheme() {} })
  const overrides = new Map([["@/contexts/theme-context", { ThemeProviderContext }], ["./mode-toggle-transition.css", {}]])
  const { ThemeProvider } = loadNotificationComponent("src/components/theme-provider.tsx", overrides)
  const { ModeToggle } = loadNotificationComponent("src/components/mode-toggle.tsx", overrides)
  const h = React.createElement
  const app = h(ThemeProvider, { defaultTheme, storageKey: "test-theme" }, h(ModeToggle))
  const markup = renderToString(app)
  const dom = new JSDOM(`<div id="root">${markup}</div>`, { url: "https://test.invalid" })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => window.localStorage })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  for (const key of ["HTMLElement", "Element", "MutationObserver", "Node"]) globalThis[key] = dom.window[key]
  const listeners = new Set()
  const media = { matches: systemDark, addEventListener: (_, cb) => listeners.add(cb), removeEventListener: (_, cb) => listeners.delete(cb) }
  window.matchMedia = query => query.includes("reduced-motion") ? { matches: true } : media
  let transitions = 0
  document.startViewTransition = () => { transitions++; throw new Error("reduced motion must not animate") }
  if (storageBlocked) Object.defineProperty(window, "localStorage", { get() { throw new Error("SecurityError") } })
  else if (saved) window.localStorage.setItem("test-theme", saved)
  const errors = []
  const { hydrateRoot } = await import("react-dom/client")
  let root
  await React.act(async () => { root = hydrateRoot(document.getElementById("root"), app, { onRecoverableError: error => errors.push(error.message) }) })
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  return {
    errors, button: () => document.querySelector('[data-testid="admin-theme-toggle"]'),
    async toggle() { await React.act(async () => document.querySelector("button").click()) },
    async setSystemDark(value) { await React.act(async () => { media.matches = value; for (const cb of listeners) cb() }) },
    transitions: () => transitions,
  }
}

for (const options of [
  { saved: "dark", systemDark: false, expected: "dark" },
  { saved: "light", systemDark: true, expected: "light" },
  { saved: "system", systemDark: true, expected: "dark", defaultTheme: "system" },
]) test(`hydration preserves saved ${options.saved} theme and accessible next action`, async t => {
  const p = await setup(t, options)
  assert.deepEqual(p.errors, [])
  assert.ok(document.documentElement.classList.contains(options.expected))
  assert.equal(p.button().dataset.themeTarget, options.expected === "dark" ? "light" : "dark")
  await p.toggle()
  assert.ok(document.documentElement.classList.contains(options.expected === "dark" ? "light" : "dark"))
  assert.equal(p.transitions(), 0)
})

test("system preference changes update both the surface and next action", async t => {
  const p = await setup(t, { saved: "system", systemDark: false })
  await p.setSystemDark(true)
  assert.ok(document.documentElement.classList.contains("dark"))
  assert.equal(p.button().dataset.themeTarget, "light")
  await p.toggle()
  assert.ok(document.documentElement.classList.contains("light"))
  await p.setSystemDark(false); await p.setSystemDark(true)
  assert.ok(document.documentElement.classList.contains("light"), "explicit theme stays fixed")
  assert.deepEqual(p.errors, [])
})

for (const storageBlocked of [false, true]) test(`invalid or blocked theme storage does not break the UI (${storageBlocked})`, async t => {
  const p = await setup(t, { saved: "unexpected-theme", storageBlocked })
  assert.ok(document.documentElement.classList.contains("light"))
  await p.toggle()
  assert.ok(document.documentElement.classList.contains("dark"))
  assert.deepEqual(p.errors, [])
})
