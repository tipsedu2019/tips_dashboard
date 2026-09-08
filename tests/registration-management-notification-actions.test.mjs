import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"
import * as timeout from "../src/lib/promise-timeout.ts"
import * as observationService from "../src/features/tasks/registration-observation-chat-service.ts"
import * as cancellationService from "../src/features/tasks/registration-visit-cancellation-service.ts"

const require = createRequire(import.meta.url)

async function loadActions(kind = "management") {
  const DialogContext = React.createContext(null)
  const dialog = {
    Dialog: ({ children, ...value }) => React.createElement(DialogContext.Provider, { value }, children),
    DialogTrigger: ({ children }) => {
      const value = React.useContext(DialogContext)
      return React.cloneElement(children, { onClick: () => value.onOpenChange(true) })
    },
    DialogContent: ({ children }) => React.useContext(DialogContext).open ? React.createElement("section", null, children) : null,
    DialogTitle: ({ children }) => React.createElement("h2", null, children),
    DialogDescription: ({ children }) => React.createElement("p", null, children),
    DialogHeader: ({ children }) => React.createElement("header", null, children),
    DialogFooter: ({ children }) => React.createElement("footer", null, children),
  }
  const modules = {
    "next/link": ({ children, href }) => React.createElement("a", { href }, children),
    "@/components/ui/button": { Button: ({ children, ...props }) => {
      delete props.variant
      return React.createElement("button", props, children)
    } },
    "@/components/ui/dialog": dialog,
    "@/features/notifications/notification-delivery-control": { GoogleChatDeliveryControl: () => null },
    "@/lib/supabase": { supabase: null },
    "@/lib/promise-timeout": timeout,
    "@/hooks/use-data-table-page-size": { useDataTablePageSize: () => ({ pageSize: 10, ready: true, setPreference: () => {} }) },
    "@/components/data-table/data-table-pagination": { DataTablePagination: () => null },
    "./registration-observation-chat-service": observationService,
    "./registration-visit-cancellation-service": cancellationService,
    "./registration-consultation-notification.js": { dispatchRegistrationManagementNotificationSources: () => { throw new Error("Unexpected real dispatcher") } },
    "./registration-management-notification-preview-service": { createRegistrationManagementPreviewService: () => null },
  }
  const file = kind === "observation" ? "registration-observation-chat-actions" : kind === "cancellation" ? "registration-visit-cancellation-actions" : "registration-management-notification-actions"
  const source = await readFile(new URL(`../src/features/tasks/${file}.tsx`, import.meta.url), "utf8")
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", compiled)((name) => modules[name] ?? require(name), loadedModule, loadedModule.exports)
  return loadedModule.exports[kind === "observation" ? "RegistrationObservationChatActions" : kind === "cancellation" ? "RegistrationVisitCancellationActions" : "RegistrationManagementNotificationActions"]
}

async function withDom(run) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>")
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  const root = createRoot(dom.window.document.getElementById("root"))
  try {
    const button = (text) => [...dom.window.document.querySelectorAll("button")].find((node) => node.textContent.includes(text))
    const click = async (text, waitMs = 0) => {
      const target = button(text)
      assert.ok(target, `button ${text} exists`)
      assert.equal(target.disabled, false)
      await React.act(async () => {
        target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      })
    }
    await run({ root, dom, button, click })
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

test("a reviewed timeout retry clears its warning before confirmation and reuses the same key", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>")
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  const root = createRoot(dom.window.document.getElementById("root"))
  try {
    const Actions = await loadActions()
    const keys = [], warnings = []
    let dispatches = 0, resolveRetry
    const preview = { trackId: "10000000-0000-4000-8000-000000000001", workflowRevision: 1, previewChecksum: "a".repeat(64), eventKey: "registration.case_created", stepLabel: "상담 신청", status: "ready", canSend: true, recoveryAvailable: true, recoverySourceEventId: "20000000-0000-4000-8000-000000000001", targetLabel: "합성 관리팀", mentionLabel: "멘션 없음", renderedTitle: "상담 신청", renderedBody: "가상 학생", reason: "" }
    await React.act(async () => root.render(React.createElement(Actions, {
      trackId: preview.trackId, workflowRevision: 1, viewerId: "fixture-viewer", sessionToken: "fixture-only", disabled: false,
      hasUnsavedChanges: () => false, onWarning: (message) => warnings.push(message), renderDeliveryStatus: () => null,
      previewService: { preview: async () => preview, confirm: async (_preview, key) => {
        keys.push(key)
        if (keys.length === 1) throw new Error("응답 시간이 초과되었습니다.")
        return new Promise((resolve) => { resolveRetry = resolve })
      } },
      dispatch: async () => { dispatches += 1; return { failedSourceEventIds: [], googleChatEventIds: ["30000000-0000-4000-8000-000000000001"] } },
    })))
    const click = async (text) => {
      const button = [...dom.window.document.querySelectorAll("button")].find((node) => node.textContent === text)
      assert.ok(button, `button ${text} exists`)
      assert.equal(button.disabled, false)
      await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })))
    }
    await click("관리팀 알림 미리보기")
    assert.equal(keys.length, 0)
    await click("이 내용으로 관리팀에 전달")
    assert.match(warnings.at(-1), /응답 시간이 초과/)
    assert.equal(dispatches, 0)
    await click("미리보기 다시 확인")
    assert.equal(keys.length, 1)
    await click("이 내용으로 관리팀에 전달")
    assert.equal(warnings.at(-1), "", "the old warning clears as the new explicit attempt starts")
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1])
    assert.equal(dispatches, 0, "clearing a warning does not dispatch while confirmation is pending")
    await React.act(async () => resolveRetry({ sourceEventIds: ["20000000-0000-4000-8000-000000000002"], recovered: true, previousSourceEventId: preview.recoverySourceEventId }))
    assert.equal(dispatches, 1)
    assert.equal(warnings.at(-1), "")
    assert.equal(dom.window.document.querySelector("section"), null, "successful retry closes the preview")
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test("observation timeout unlocks the dialog, blocks resends, and reuses its key only after reviewed refresh", async () => withDom(async ({ root, dom, button, click }) => {
  const Actions = await loadActions("observation")
  const id = "10000000-0000-4000-8000-000000000001"
  const keys = []; let lateReply
  const preview = { observationId: id, intent: "handoff", status: "ready", canSend: true, targetLabel: "합성 선생님", renderedTitle: "청강 담당 전달", renderedBody: "가상 학생", previewChecksum: "a".repeat(64) }
  const service = observationService.createRegistrationObservationChatService(async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ ok: true, preview })
    keys.push(JSON.parse(init.body).requestId)
    return keys.length === 1 ? new Promise((resolve) => { lateReply = resolve }) : Response.json({ ok: true, status: "unknown" })
  }, 5)
  await React.act(async () => root.render(React.createElement(Actions, { observationId: id, service, getAccessToken: async () => "synthetic-token" })))
  await click("청강 담당 전달")
  await click("확인하고 전달", 15)
  assert.equal(keys.length, 1)
  assert.equal(button("확인하고 전달").disabled, true)
  assert.equal(button("닫기").disabled, false)
  await React.act(async () => lateReply(Response.json({ ok: true, status: "sent" })))
  assert.match(dom.window.document.body.textContent, /전달 결과를 확인할 수 없습니다/)
  assert.equal(button("확인하고 전달").disabled, true)
  await click("전달 상태 다시 확인")
  assert.equal(keys.length, 1, "refresh is a read, not another send")
  await click("확인하고 전달")
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal(button("확인하고 전달").disabled, true)
}))

test("visit cancellation timeout preserves unknown until a fresh read and retains the explicit request key", async () => withDom(async ({ root, dom, button, click }) => {
  const Actions = await loadActions("cancellation")
  const id = "10000000-0000-4000-8000-000000000001"
  const keys = []; let lateReply, status = "ready"
  const item = { appointmentId: id, notificationRevision: 1, status: "ready", reason: "취소 전달 필요", canSend: true, scheduledAt: "2026-09-08T00:00:00Z", sourceDeliveryId: "20000000-0000-4000-8000-000000000001", renderedTitle: "방문 취소", renderedBody: "가상 학생", previewChecksum: "a".repeat(64) }
  const service = cancellationService.createRegistrationVisitCancellationService(async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ ok: true, items: [{ ...item, status, canSend: status === "ready" }], page: 1, pageSize: 10, totalCount: 1 })
    keys.push(JSON.parse(init.body).requestKey)
    if (keys.length === 1) return new Promise((resolve) => { lateReply = resolve })
    status = "sent"
    return Response.json({ ok: true, sent: 1 })
  }, 5)
  await React.act(async () => root.render(React.createElement(Actions, { taskId: id, service, sessionToken: "synthetic-token" })))
  await click("방문 취소 전달")
  await click("취소 전달 필요")
  await click("관리팀에 취소 전달", 15)
  assert.equal(keys.length, 1)
  assert.equal(button("관리팀에 취소 전달"), undefined)
  assert.equal(button("목록 새로 확인").disabled, false)
  await React.act(async () => lateReply(Response.json({ ok: true, sent: 1 })))
  assert.match(dom.window.document.body.textContent, /전달 결과 확인 필요/)
  await click("목록 새로 확인")
  assert.equal(keys.length, 1)
  await click("관리팀에 취소 전달")
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.match(dom.window.document.body.textContent, /취소 전달 완료/)
}))

test("observation identity changes while reading a token never confirm for the next reservation", async () => withDom(async ({ root, click }) => {
  const Actions = await loadActions("observation")
  const one = "10000000-0000-4000-8000-000000000001", two = "10000000-0000-4000-8000-000000000002"
  let tokenCalls = 0, sends = 0, resolveToken
  const service = { preview: async (observationId, intent) => ({ observationId, intent, status: "ready", canSend: true, targetLabel: "합성 선생님", renderedTitle: "청강 전달", renderedBody: "가상 학생", previewChecksum: "a".repeat(64) }), send: async () => { sends += 1; return "sent" } }
  const getAccessToken = async () => ++tokenCalls === 1 ? "first-token" : new Promise((resolve) => { resolveToken = resolve })
  await React.act(async () => root.render(React.createElement(Actions, { observationId: one, service, getAccessToken })))
  await click("청강 담당 전달")
  await click("확인하고 전달")
  await React.act(async () => root.render(React.createElement(Actions, { observationId: two, service, getAccessToken })))
  await React.act(async () => resolveToken("later-token"))
  assert.equal(sends, 0)
}))
