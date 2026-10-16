import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"
import * as timeout from "../src/lib/promise-timeout.ts"
import * as cancellationService from "../src/features/tasks/registration-visit-cancellation-service.ts"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const require = createRequire(import.meta.url)

async function loadActions(kind = "management", deliveryService = null) {
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
    "./registration-visit-cancellation-service": cancellationService,
    "./registration-consultation-notification.js": { dispatchRegistrationManagementNotificationSources: () => { throw new Error("Unexpected real dispatcher") } },
    "./registration-management-notification-preview-service": { createRegistrationManagementPreviewService: () => null },
  }
  if (deliveryService) {
    modules["@/features/notifications/notification-delivery-control"] = loadNotificationComponent(
      "src/features/notifications/notification-delivery-control.tsx",
      new Map([["./notification-delivery-service", deliveryService]]),
    )
  }
  const file = kind === "cancellation" ? "registration-visit-cancellation-actions" : "registration-management-notification-actions"
  const source = await readFile(new URL(`../src/features/tasks/${file}.tsx`, import.meta.url), "utf8")
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", compiled)((name) => modules[name] ?? require(name), loadedModule, loadedModule.exports)
  return loadedModule.exports[kind === "cancellation" ? "RegistrationVisitCancellationActions" : "RegistrationManagementNotificationActions"]
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

test("management delivery history stays read-only and only confirmed preview dispatches the latest canonical event", async () => withDom(async ({ root, dom, button, click }) => {
  const archivedId = "30000000-0000-4000-8000-000000000001"
  const existingId = "30000000-0000-4000-8000-000000000002"
  const latestId = "30000000-0000-4000-8000-000000000003"
  const earlierId = "30000000-0000-4000-8000-000000000004"
  const sourceId = "20000000-0000-4000-8000-000000000001"
  const reads = [], confirmations = [], dispatches = [], retries = [], warnings = []
  const Actions = await loadActions("management", {
    readGoogleChatDeliveryStatus: async (eventId) => {
      reads.push(eventId)
      return { eventId, status: eventId === latestId ? "unknown" : "failed", retryAllowed: true, confirmationRequired: eventId === latestId }
    },
    retryGoogleChatDelivery: async (...args) => { retries.push(args); throw new Error("Unexpected generic retry") },
  })
  let preview = {
    trackId: "10000000-0000-4000-8000-000000000001", workflowRevision: 1,
    previewChecksum: "a".repeat(64), eventKey: "registration.case_created", stepLabel: "상담 신청",
    status: "existing_source_changed", canSend: false, recoveryAvailable: false, recoverySourceEventId: null,
    recoveredFromEventId: archivedId, existingEventId: existingId,
    targetLabel: "합성 관리팀", mentionLabel: "멘션 없음", renderedTitle: "상담 신청", renderedBody: "가상 학생",
    reason: "기존 알림의 내용과 현재 설정이 다릅니다.",
  }
  await React.act(async () => root.render(React.createElement(Actions, {
    trackId: preview.trackId, workflowRevision: 1, viewerId: "fixture-viewer", sessionToken: "fixture-only",
    disabled: false, hasUnsavedChanges: () => false, onWarning: (message) => warnings.push(message),
    previewService: {
      preview: async () => preview,
      confirm: async (checked, requestKey) => {
        confirmations.push({ checked, requestKey })
        return { sourceEventIds: [sourceId], recovered: true, previousEventId: existingId }
      },
    },
    dispatch: async (...args) => {
      dispatches.push(args)
      return { failedSourceEventIds: [], googleChatEventIds: [earlierId, latestId] }
    },
  })))
  assert.deepEqual(reads, [])
  assert.deepEqual(dispatches, [])
  await click("관리팀 알림 미리보기")
  assert.deepEqual(new Set(reads), new Set([archivedId, existingId]))
  assert.equal(button("이 내용으로 관리팀에 전달").disabled, true)
  assert.equal(Boolean(button("Google Chat 재발송")), false, "archived and existing records cannot bypass preview confirmation")
  assert.deepEqual(confirmations, [])
  assert.deepEqual(dispatches, [])

  await click("취소")
  preview = { ...preview, status: "ready", canSend: true, recoveryAvailable: true,
    recoverySourceEventId: sourceId, recoveredFromEventId: undefined, reason: "" }
  await click("관리팀 알림 미리보기")
  assert.deepEqual(confirmations, [])
  assert.deepEqual(dispatches, [], "reading the ready preview is still read-only")
  await click("이 내용으로 관리팀에 전달")
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0].checked, preview)
  assert.match(confirmations[0].requestKey, /^[0-9a-f-]{36}$/)
  assert.deepEqual(dispatches, [[[sourceId], "fixture-only"]])
  assert.equal(reads.includes(latestId), true)
  assert.equal(reads.includes(earlierId), false, "the latest returned canonical event drives delivery status")
  assert.match(dom.window.document.body.textContent, /새 안내 전달 상태/)
  assert.match(dom.window.document.body.textContent, /Google Chat 결과 확인 필요/)
  assert.doesNotMatch(dom.window.document.body.textContent, /Google Chat 방에 메시지가 없음을 확인했습니다/)
  assert.equal(Boolean(button("Google Chat 재발송")), false, "recovered and current records also keep generic retry disabled")
  assert.deepEqual(retries, [])
  assert.deepEqual(warnings.filter(Boolean), [])
}))

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
