import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

async function setup(t, { contentProps = {}, nested = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/registration" })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const key of ["HTMLElement", "Element", "MutationObserver", "CustomEvent", "Event", "Node", "NodeFilter", "HTMLInputElement", "KeyboardEvent"])
    globalThis[key] = dom.window[key]
  globalThis.getComputedStyle = window.getComputedStyle
  window.HTMLElement.prototype.getClientRects = function () {
    return this.hidden || this.style.display === "none" ? [] : [{ width: 32, height: 32 }]
  }
  const { createRoot } = await import("react-dom/client")
  const { Dialog, DialogContent, DialogTitle, DialogDescription } = loadNotificationComponent("src/components/ui/dialog.tsx")
  const h = React.createElement
  let setReady
  function Fixture() {
    const [open, setOpen] = React.useState(false)
    const [childOpen, setChildOpen] = React.useState(false)
    const [ready, updateReady] = React.useState(false)
    React.useEffect(() => { setReady = updateReady }, [])
    const opener = id => h("article", {
      id, role: "listitem", tabIndex: 0,
      onKeyDown: event => { if (event.key === "Enter") setOpen(true) },
      onClick: () => setOpen(true),
    }, id)
    return h(React.Fragment, null,
      h("div", null, opener("first"), opener("second")), h("h1", { tabIndex: -1 }, "다음 화면"),
      h(Dialog, { open, onOpenChange: setOpen },
        h(DialogContent, { restoreFocusToOpener: true, ...contentProps },
          h(DialogTitle, null, "등록 신청서"), h(DialogDescription, null, "조회"),
          h("p", null, ready ? "상세 내용" : "불러오는 중"),
          nested ? h("button", { id: "nested-opener", onClick: () => setChildOpen(true) }, "이력 보기") : null,
          h("button", { id: "route", onClick: () => {
            window.history.pushState({}, "", "/admin/tasks")
            setOpen(false)
          } }, "다음 화면"),
          h(Dialog, { open: childOpen, onOpenChange: setChildOpen },
            h(DialogContent, { restoreFocusToOpener: true, layer: "nested" },
              h(DialogTitle, null, "이력"), h(DialogDescription, null, "조회 이력"))))))
  }
  const root = createRoot(document.getElementById("root"))
  await React.act(async () => root.render(h(Fixture)))
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  const open = async (id = "first") => {
    const opener = document.getElementById(id)
    await React.act(async () => {
      opener.focus()
      opener.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })
    await settle()
    assert.ok(document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    return opener
  }
  const escape = async () => {
    await React.act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    await settle()
  }
  return { open, escape, settle, ready: () => React.act(async () => setReady(true)) }
}

test("controlled dialog returns to its keyboard row after loading and recaptures the next opener", async t => {
  const p = await setup(t)
  const first = await p.open()
  await p.ready()
  await p.escape()
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.ok(document.activeElement === first, "first opener regains focus")
  const second = await p.open("second")
  await p.escape()
  assert.ok(document.activeElement === second, "second opener regains focus")
})

test("nested dialog returns to its parent control before the parent returns to the row", async t => {
  const p = await setup(t, { nested: true })
  const row = await p.open()
  const nestedOpener = document.getElementById("nested-opener")
  await React.act(async () => { nestedOpener.focus(); nestedOpener.click() })
  await p.settle()
  await p.escape()
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1)
  assert.ok(document.activeElement === nestedOpener, "nested opener regains focus")
  await p.escape()
  assert.ok(document.activeElement === row, "parent opener regains focus")
})

for (const unavailable of ["hidden", "disabled", "detached"]) {
  test(`does not restore focus to a ${unavailable} opener`, async t => {
    const p = await setup(t)
    const opener = await p.open()
    let attempts = 0
    opener.focus = () => { attempts++ }
    if (unavailable === "hidden") opener.hidden = true
    else if (unavailable === "disabled") opener.setAttribute("aria-disabled", "true")
    else opener.remove()
    await p.escape()
    assert.equal(attempts, 0)
  })
}

test("closing during route navigation does not focus the previous route opener", async t => {
  const p = await setup(t)
  const opener = await p.open()
  let attempts = 0
  opener.focus = () => { attempts++ }
  await React.act(async () => document.getElementById("route").click())
  await p.settle()
  assert.equal(attempts, 0)
})

test("caller close autofocus takes precedence", async t => {
  let called = 0
  const p = await setup(t, { contentProps: { onCloseAutoFocus: event => {
    called++
    event.preventDefault()
    document.querySelector("h1").focus()
  } } })
  await p.open()
  await p.escape()
  assert.equal(called, 1)
  assert.ok(document.activeElement === document.querySelector("h1"))
})
