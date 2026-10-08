import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { JSDOM } = require("jsdom")
const source = await readFile(new URL("../src/components/errors/page-recovery.tsx", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText
const compiledModule = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)((specifier) => {
  assert.ok(["react", "react/jsx-runtime"].includes(specifier), "recovery must not depend on failed provider/UI chunks")
  return require(specifier)
}, compiledModule, compiledModule.exports)

test("recovery opens the full current URL in a separate tab and does not navigate or mutate a draft outside the failed subtree", async () => {
  const url = "https://fixture.invalid/admin/registration?taskPage=2&taskPageType=registration#detail"
  const dom = new JSDOM('<input id="draft" value="합성 미저장 입력"><aside id="tips-script-recovery">초기 오류</aside><div id="root"></div>', { url })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById("root"))
  try {
    const historyLength = window.history.length
    await act(async () => root.render(createElement(compiledModule.exports.PageRecovery)))
    assert.equal(document.getElementById("tips-script-recovery"), null, "mounted error boundary replaces the bootstrap notice")
    const anchor = document.querySelector("a")
    assert.match(document.querySelector("h1").textContent, /불러오지 못했습니다/)
    assert.equal(anchor.target, "_blank")
    assert.match(anchor.rel, /noopener/)
    assert.match(anchor.rel, /noreferrer/)
    assert.match(anchor.href, /_tips_recovery=/, "the actual href supports middle-click/context menu too")
    document.addEventListener("click", event => event.preventDefault(), { once: true })
    await act(async () => anchor.click())
    const reopened = new URL(anchor.href)
    assert.ok(Number(reopened.searchParams.get("_tips_recovery")) > 0)
    reopened.searchParams.delete("_tips_recovery")
    assert.equal(reopened.href, url)
    assert.equal(window.location.href, url)
    assert.equal(window.history.length, historyLength)
    assert.equal(document.getElementById("draft").value, "합성 미저장 입력")
    assert.doesNotMatch(source, /location\.(reload|replace|assign)|setTimeout|setInterval|\breset\s*\(/)
  } finally {
    await act(async () => root.unmount())
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
    dom.window.close()
  }
})

test("admin document policy stays in a server layout while existing auth shell remains mounted", async () => {
  const layout = await readFile(new URL("../src/app/admin/layout.tsx", import.meta.url), "utf8")
  const client = await readFile(new URL("../src/components/admin-dashboard-layout.tsx", import.meta.url), "utf8")
  assert.match(layout, /export const dynamic = "force-dynamic"/)
  assert.doesNotMatch(layout, /use client/)
  assert.match(layout, /<DashboardLayout>\{children\}<\/DashboardLayout>/)
  assert.match(client, /<AuthGuard>/)
  assert.match(client, /<DashboardMain>\{children\}<\/DashboardMain>/)
})
