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
  function Harness({ subject }) { state = useStatisticsSnapshot({ tab: "students_classes", subject }); return null }
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
