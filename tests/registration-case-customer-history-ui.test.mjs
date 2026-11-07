import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
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
const source = await readFile(new URL("../src/features/tasks/registration-customer-message-case-history.tsx", import.meta.url), "utf8")
const compiled = ts.transpileModule(`${source}\nexports.TestHistoryPage = CaseHistoryPage;`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const sandboxModule = { exports: {} }
const wrapper = ({ children }) => createElement("div", null, children)
const local = {
  "lucide-react": { MessageSquare: () => null, RefreshCw: () => null },
  "@/components/ui/button": { Button: ({ children, ...props }) => {
    delete props.variant; delete props.size
    return createElement("button", props, children)
  } },
  "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogTrigger"].map((key) => [key, wrapper])),
  "@/components/data-table/data-table-pagination": { DataTablePagination: ({ page, loading }) => createElement("nav", { "data-page": page, "aria-busy": loading }, `page ${page}`) },
  "./registration-customer-message-labels": { formatRegistrationMessageTimestamp: (value) => value, REGISTRATION_CUSTOMER_MESSAGE_LABELS: { visit_consultation_booking: "방문상담 예약 안내" }, registrationCustomerMessageStatusLabel: (value) => value },
}
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)((specifier) => {
  if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
  if (local[specifier]) return local[specifier]
  throw new Error(`Unexpected module ${specifier}`)
}, sandboxModule, sandboxModule.exports)
const HistoryPage = sandboxModule.exports.TestHistoryPage
const messageA = "96100000-0000-4000-8000-000000000001"
const messageB = "96100000-0000-4000-8000-000000000002"
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function row(messageId, status = "unknown") {
  return { messageId, messageKind: "visit_consultation_booking", currentStatus: status,
    confirmedByName: messageId === messageA ? "이전 등록 담당자" : "다른 등록 담당자",
    confirmedAt: "2026-09-01T03:00:00.000Z", updatedAt: "2026-09-01T03:00:00.000Z",
    recipientLast4: "1234", canCheck: ["pending", "unknown"].includes(status), canCheckDelivery: status === "accepted" }
}
async function mount(t, client) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(dom.window.document.getElementById("root"))
  let refreshes = 0
  let props = { taskId: "old", page: 2, pageSize: 10, client, viewer: "first" }
  function draw() {
    root.render(createElement(HistoryPage, { ...props, key: props.viewer, refreshKey: String(refreshes),
      onRefresh: () => { refreshes++; draw() }, onPageChange: () => {}, onPageSizeChange: () => {} }))
  }
  await act(async () => { draw() })
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
  })
  return { document: dom.window.document, get refreshes() { return refreshes },
    button(label) { return [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === label) },
    async render(next) { props = { ...props, ...next }; await act(async () => { draw() }) },
  }
}

test("old receipt confirmation checks once and reloads the selected history page into accepted delivery lookup", async (t) => {
  const pending = deferred()
  const calls = []
  let status = "unknown"
  const client = {
    async listCaseHistory(input) { calls.push(["history", input]); return { ok: true, ...input, totalCount: 12, history: [row(messageA, status)] } },
    async check(input) { calls.push(["check", input]); await pending.promise; status = "accepted"; return { messageId: messageA, currentStatus: "accepted" } },
    async checkDelivery(input) { calls.push(["delivery", input]); return { ok: true, deliveryStatus: "delivered", checkedAt: "2026-09-08T03:00:00Z" } },
    send() { throw new Error("send forbidden") }, preview() { throw new Error("current source forbidden") },
    releasePreSend() { throw new Error("release forbidden") }, reconcile() { throw new Error("manual resolution forbidden") },
  }
  const view = await mount(t, client)
  const button = view.button("발송 결과 확인")
  assert.ok(button)
  await act(async () => { button.click(); button.click() })
  assert.equal(calls.filter(([name]) => name === "check").length, 1)
  assert.deepEqual(calls.find(([name]) => name === "check")[1], { messageId: messageA })
  await act(async () => pending.resolve())
  assert.equal(view.refreshes, 1)
  assert.deepEqual(calls.filter(([name]) => name === "history").map(([, input]) => input.page), [2, 2])
  assert.equal(view.document.querySelector("nav").dataset.page, "2")
  assert.equal(view.button("발송 결과 확인"), undefined)
  assert.ok(view.button("도착 여부 확인"))
  await act(async () => view.button("도착 여부 확인").click())
  assert.match(view.document.body.textContent, /도착 확인/u)
  assert.equal(calls.filter(([name]) => name === "delivery").length, 1)
})

test("case/page/client/viewer changes invalidate late checks without refreshing or unlocking the next scope", async (t) => {
  const pendingA = deferred(), pendingB = deferred()
  let checks = 0
  const client = {
    async listCaseHistory(input) { return { ok: true, ...input, totalCount: 22, history: [row(input.taskId === "old" ? messageA : messageB)] } },
    async check({ messageId }) { checks++; await (messageId === messageA ? pendingA.promise : pendingB.promise); return { messageId, currentStatus: "accepted" } },
  }
  const view = await mount(t, client)
  await act(async () => view.button("발송 결과 확인").click())
  await view.render({ taskId: "next", page: 1, client: { ...client }, viewer: "next-user" })
  assert.match(view.document.body.textContent, /다른 등록 담당자/u)
  await act(async () => view.button("발송 결과 확인").click())
  await act(async () => pendingA.resolve())
  assert.equal(view.refreshes, 0)
  assert.equal(view.button("확인 중…").disabled, true)
  assert.equal(checks, 2)
  await act(async () => pendingB.resolve())
  assert.equal(view.refreshes, 1)
  assert.equal(view.document.querySelector("nav").dataset.page, "1")
})

test("page change on a mounted history component ignores the old unresolved check", async (t) => {
  const pending = deferred()
  const client = {
    async listCaseHistory(input) { return { ok: true, ...input, totalCount: 22, history: [row(input.page === 2 ? messageA : messageB)] } },
    async check({ messageId }) { await pending.promise; return { messageId, currentStatus: "accepted" } },
  }
  const view = await mount(t, client)
  await act(async () => view.button("발송 결과 확인").click())
  await view.render({ page: 3 })
  await act(async () => pending.resolve())
  assert.equal(view.refreshes, 0)
  assert.equal(view.document.querySelector("nav").dataset.page, "3")
  assert.equal(view.button("발송 결과 확인").disabled, false)
})

test("unresolved provider lookup stays on the same receipt and permits only another explicit check", async (t) => {
  let checks = 0
  const client = {
    async listCaseHistory(input) { return { ok: true, ...input, totalCount: 12, history: [row(messageA, "pending")] } },
    async check() { checks++; throw new Error("provider result unresolved") },
  }
  const view = await mount(t, client)
  await act(async () => view.button("발송 결과 확인").click())
  assert.match(view.document.querySelector('[role="alert"]').textContent, /확인하지 못했습니다/u)
  assert.equal(view.refreshes, 0)
  assert.equal(checks, 1)
  assert.equal(view.button("발송 결과 확인").disabled, false)
})


// The workflow selects this existing suite explicitly. Keep the real Radix
// regressions in a separate process so their DOM globals cannot affect it.
test("message history entrypoint regressions run in an isolated CI subprocess", { timeout: 35_000 }, () => {
  const result = spawnSync(process.execPath, [
    "--test", "--experimental-strip-types", "--test-reporter=tap",
    fileURLToPath(new URL("./registration-message-history-entrypoints.test.mjs", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    // Do not inherit test-runner context, filters, preload options or credentials.
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", TZ: "UTC" },
  })
  const diagnostic = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n")
  assert.equal(result.error, undefined, diagnostic)
  assert.equal(result.signal, null, diagnostic)
  assert.equal(result.status, 0, diagnostic)
  assert.match(result.stdout, /^TAP version 13$/m)
  const summary = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const matches = [...result.stdout.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gm"))]
    assert.equal(matches.length, 1, `Missing or repeated ${key} summary\n${diagnostic}`)
    return [key, Number(matches[0][1])]
  }))
  assert.ok(summary.tests >= 12, diagnostic)
  assert.equal(summary.pass, summary.tests, diagnostic)
  for (const key of ["fail", "cancelled", "skipped", "todo"]) assert.equal(summary[key], 0, diagnostic)
})
