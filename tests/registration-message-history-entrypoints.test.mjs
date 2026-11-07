import assert from "node:assert/strict"
import { before, after, test } from "node:test"
import { act, createElement, useState } from "react"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"
import { createRegistrationCustomerMessageClient } from "../src/features/tasks/registration-customer-message-service.ts"

let dom, createRoot, History, Preview
const previousGlobals = new Map()
const TASK_A = "21500000-0000-4000-8000-000000000001"
const TASK_B = "21500000-0000-4000-8000-000000000002"
const MESSAGE = "21500000-0000-4000-8000-000000000010"

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://synthetic.invalid/admin/registration" })
  const globals = {
    ...Object.fromEntries(["window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
      "SVGElement", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver"].map(key => [key, dom.window[key]])),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  ;({ createRoot } = await import("react-dom/client"))
  ;({ RegistrationCustomerMessageCaseHistory: History } = loadNotificationComponent("src/features/tasks/registration-customer-message-case-history.tsx"))
  ;({ RegistrationAlimtalkPreviewDialog: Preview } = loadNotificationComponent("src/features/tasks/registration-alimtalk-preview-dialog.tsx"))
})

after(() => {
  dom?.window.close()
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

async function flush(action) {
  await act(async () => { action?.(); await new Promise(resolve => setTimeout(resolve, 0)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

function historyRow(messageKind = "admission_application", index = 0) {
  return { messageId: index ? `21500000-0000-4000-8000-${String(10 + index).padStart(12, "0")}` : MESSAGE,
    messageKind, currentStatus: "accepted", confirmedByName: "합성 담당자", confirmedAt: "2026-10-29T00:00:00Z",
    updatedAt: "2026-10-29T00:01:00Z", recipientLast4: "0000", canCheck: false, canCheckDelivery: false }
}

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { resolve, promise }
}

async function mount(t, { rows = [historyRow()], canOpen = true, historyResponse } = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const calls = { history: [], preview: [], send: 0, other: 0, callbacks: [], submissions: 0 }
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Real network is forbidden"))
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "synthetic-session",
    fetch: async (url, init) => {
      if (url.startsWith("/api/solapi/registration/case-history?")) {
        assert.equal(init.method, "GET")
        const query = new URL(`https://synthetic.invalid${url}`).searchParams
        const request = { taskId: query.get("taskId"), page: Number(query.get("page")), pageSize: Number(query.get("pageSize")), signal: init.signal }
        calls.history.push(request)
        const history = historyResponse ? await historyResponse(request) : rows
        return Response.json({ ok: true, page: request.page, pageSize: request.pageSize, totalCount: history.length, history })
      }
      if (url === "/api/solapi/registration/preview") {
        assert.equal(init.method, "POST")
        const target = JSON.parse(init.body)
        calls.preview.push(target)
        return Response.json({ ok: true, messageKind: "admission_application", previewId: "21500000-0000-4000-8000-000000000099",
          expiresAt: new Date(Date.now() + 60_000).toISOString(), studentName: "현재 합성 학생", recipientLast4: "0000",
          facts: { subjectLabel: "영어" }, body: "현재 저장된 등록 내용", buttons: [], latestMessage: null,
          readiness: { runtimeReady: true, activationMode: "live", activationEligible: true, credentialsConfigured: true,
            pfConfigured: true, templateConfigured: true, templateVerified: true, verifiedAt: "2026-10-29T00:00:00Z",
            sourceValid: true, sendAllowed: true, blockers: [] } })
      }
      if (url === "/api/solapi/registration/send") calls.send++
      else calls.other++
      throw new Error(`Forbidden synthetic action: ${url}`)
    },
  })
  let props = { taskId: TASK_A, viewerKey: "staff-a", canOpen }
  const preventSubmit = event => { event.preventDefault(); calls.submissions++ }
  const returnFocus = { current: null }
  const recordOpen = next => {
    const active = document.activeElement
    calls.callbacks.push({ target: next, activeText: active.textContent, activeConnected: active.isConnected,
      historyOpen: Boolean(document.querySelector('[role="dialog"][data-state="open"]')) })
    returnFocus.current = active
  }
  function Harness({ taskId, viewerKey, canOpen }) {
    const [target, setTarget] = useState(null)
    const selected = canOpen && target?.sourceId === taskId && target?.viewerKey === viewerKey ? target : null
    function onOpenPreview(next) {
      recordOpen(next)
      setTarget({ ...next, viewerKey })
    }
    return createElement("form", { onSubmit: preventSubmit },
      createElement(History, { taskId, viewerKey, client, onOpenPreview: canOpen ? onOpenPreview : undefined }),
      createElement(Preview, { open: Boolean(selected), target: selected, client, viewerRole: "staff", triggerRef: returnFocus,
        onOpenChange(next) { if (!next) setTarget(null) } }))
  }
  const draw = () => root.render(createElement(Harness, props))
  await flush(draw)
  const button = text => [...document.querySelectorAll("button")].find(node => node.textContent === text)
  t.after(async () => {
    await flush(() => root.unmount())
    host.remove()
    assert.equal(network.mock.callCount(), 0)
    assert.equal(calls.send, 0)
    assert.equal(calls.other, 0)
    assert.equal(calls.submissions, 0)
  })
  return { calls, button, host,
    async click(text, times = 1) { const node = button(text); assert.ok(node, `Expected button: ${text}`); await flush(() => { node.focus(); for (let i = 0; i < times; i++) node.click() }) },
    async render(next) { props = { ...props, ...next }; await flush(draw) },
    async chooseAndRender(next) { const node = button("현재 입학신청서 미리보기"); assert.ok(node); await flush(() => { node.click(); props = { ...props, ...next }; draw() }) },
    async resolve(pending, value) { await flush(() => pending.resolve(value)) },
    async unmountWhileChoosing() { const node = button("현재 입학신청서 미리보기"); assert.ok(node); await flush(() => { node.click(); root.render(null) }) },
  }
}

test("send history opens only a case read until explicit current-admission preview, then closes before preview and restores its stable trigger", async t => {
  const view = await mount(t)
  const trigger = view.button("발송 이력")
  assert.ok(trigger)
  assert.equal(trigger.type, "button")
  assert.equal(view.calls.history.length, 0)
  await view.click("발송 이력")
  assert.equal(view.calls.history.length, 1)
  assert.equal(view.calls.preview.length, 0)
  assert.equal(view.calls.callbacks.length, 0)
  assert.match(document.querySelector('[role="dialog"]').textContent, /현재.*저장|저장.*현재/)
  await view.click("현재 입학신청서 미리보기", 2)
  assert.equal(view.calls.callbacks.length, 1)
  assert.deepEqual(view.calls.callbacks[0].target, { messageKind: "admission_application", sourceId: TASK_A })
  assert.notEqual(view.calls.callbacks[0].target.sourceId, MESSAGE)
  assert.equal(view.calls.callbacks[0].activeText, "발송 이력")
  assert.equal(view.calls.callbacks[0].activeConnected, true)
  assert.equal(view.calls.callbacks[0].historyOpen, false, "History focus trap must close before another modal opens")
  assert.deepEqual(view.calls.preview, [{ messageKind: "admission_application", sourceId: TASK_A }])
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1)
  await view.click("돌아가기")
  assert.equal(document.activeElement === trigger, true, "Preview close returns focus to the persistent send-history trigger")
  assert.equal(view.calls.preview.length, 1)
})

test("unsupported historical kinds never synthesize a source ID or expose current-admission action", async t => {
  const kinds = ["level_test_booking", "visit_consultation_booking", "waiting_notice", "observation_booking", "level_test_booking_bundle", "observation_reminder_bundle"]
  const view = await mount(t, { rows: kinds.map((kind, index) => historyRow(kind, index)) })
  await view.click("발송 이력")
  assert.equal(view.button("현재 입학신청서 미리보기"), undefined)
  assert.match(document.querySelector('[role="dialog"]').textContent, /원본.*연결|연결.*원본/)
  assert.equal(view.calls.preview.length, 0)
  assert.equal(view.calls.callbacks.length, 0)
})

test("absence of the admission permission callback keeps history read-only", async t => {
  const view = await mount(t, { canOpen: false })
  await view.click("발송 이력")
  assert.equal(view.button("현재 입학신청서 미리보기"), undefined)
  assert.equal(view.calls.preview.length, 0)
  assert.equal(view.calls.callbacks.length, 0)
})

for (const [name, patch] of [
  ["case change", { taskId: TASK_B }],
  ["viewer change", { viewerKey: "staff-b" }],
  ["admission permission withdrawal", { canOpen: false }],
]) {
  test(`a pending history-to-preview transition is discarded on ${name}`, async t => {
    const view = await mount(t)
    await view.click("발송 이력")
    await view.chooseAndRender(patch)
    assert.equal(view.calls.callbacks.length, 0)
    assert.equal(view.calls.preview.length, 0)
    assert.equal(document.querySelectorAll('[role="dialog"]').length <= 1, true)
    await view.render({ taskId: TASK_A, viewerKey: "staff-a", canOpen: true })
    assert.equal(view.calls.callbacks.length, 0, "Restoring permission or scope must not resume an abandoned transition")
    assert.equal(view.calls.preview.length, 0)
  })
}

test("unmount cancels a pending history selection without opening any preview", async t => {
  const view = await mount(t)
  await view.click("발송 이력")
  await view.unmountWhileChoosing()
  assert.equal(view.calls.callbacks.length, 0)
  assert.equal(view.calls.preview.length, 0)
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0)
})

for (const close of ["Escape", "close button"]) {
  test(`${close} closes send history without selecting a preview and restores the history trigger`, async t => {
    const view = await mount(t)
    const trigger = view.button("발송 이력")
    await view.click("발송 이력")
    if (close === "Escape") {
      await flush(() => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    } else {
      const closeButton = document.querySelector('button[aria-label="발송 이력 닫기"]')
        || [...document.querySelectorAll("button")].find(node => node.textContent === "발송 이력 닫기")
      assert.ok(closeButton)
      await flush(() => closeButton.click())
    }
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 0)
    assert.equal(document.activeElement === trigger, true)
    assert.equal(view.calls.callbacks.length, 0)
    assert.equal(view.calls.preview.length, 0)
  })
}

test("Escape from current admission preview returns to the connected history trigger and reopening history does not auto-preview", async t => {
  const view = await mount(t)
  const trigger = view.button("발송 이력")
  await view.click("발송 이력")
  await view.click("현재 입학신청서 미리보기")
  assert.equal(view.calls.preview.length, 1)
  await flush(() => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0)
  assert.equal(document.activeElement === trigger, true)
  assert.equal(trigger.isConnected, true)
  await view.click("발송 이력")
  assert.equal(view.calls.history.length, 2)
  assert.equal(view.calls.callbacks.length, 1)
  assert.equal(view.calls.preview.length, 1)
})

test("a late previous-case history response cannot supply a current preview action for that old task", async t => {
  const old = deferred()
  const view = await mount(t, { historyResponse: request => request.taskId === TASK_A
    ? old.promise : [{ ...historyRow(), confirmedByName: "새 케이스 담당자" }] })
  await view.click("발송 이력")
  assert.equal(view.calls.history.length, 1)
  await view.render({ taskId: TASK_B })
  assert.equal(view.calls.history[0].signal.aborted, true)
  await view.click("발송 이력")
  await view.resolve(old, [{ ...historyRow(), confirmedByName: "지난 케이스 담당자" }])
  assert.match(document.querySelector('[role="dialog"]').textContent, /새 케이스 담당자/)
  assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /지난 케이스 담당자/)
  assert.equal(view.calls.preview.length, 0)
  await view.click("현재 입학신청서 미리보기")
  assert.deepEqual(view.calls.preview, [{ messageKind: "admission_application", sourceId: TASK_B }])
})

test("history load failure does not expose a current preview action from a receipt that was never loaded", async t => {
  const view = await mount(t, { historyResponse: async () => { throw new Error("synthetic history failure") } })
  await view.click("발송 이력")
  assert.match(document.querySelector('[role="alert"]').textContent, /발송 이력을 불러오지 못했습니다/)
  assert.equal(view.button("현재 입학신청서 미리보기"), undefined)
  assert.equal(view.calls.preview.length, 0)
  assert.equal(view.calls.callbacks.length, 0)
})
