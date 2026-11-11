import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { act, createElement, useEffect, useState } from "react"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const destinations = [
  ["레벨테스트", "level_test", "level_test_booking"],
  ["방문상담", "consultation", "visit_consultation_booking"],
  ["대기", "waiting", "waiting_notice"],
  ["청강", "observation", "observation_booking"],
  ["입학", "admission", "admission_application"],
]
let dom, createRoot, RegistrationCustomerMessageNavigation
const previousGlobals = new Map()

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
  const globals = {
    ...Object.fromEntries(["window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLDetailsElement", "SVGElement", "NodeFilter", "Event", "CustomEvent", "MutationObserver"].map(key => [key, dom.window[key]])),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.HTMLElement.prototype.scrollIntoView = function () {}
  ;({ createRoot } = await import("react-dom/client"))
  ;({ RegistrationCustomerMessageNavigation } = loadNotificationComponent("src/features/tasks/registration-customer-message-navigation.tsx"))
})

after(() => {
  dom?.window.close()
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

async function flush(action) {
  await act(async () => { action?.() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
}

async function mount(t, options = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const calls = { clicks: [], submits: 0, scrolls: [], mounts: 0 }
  t.mock.method(globalThis, "fetch", () => { assert.fail("Location navigation must never call an API") })
  t.mock.method(dom.window.HTMLElement.prototype, "scrollIntoView", function (args) { calls.scrolls.push({ owner: this.getAttribute("data-fixture-owner"), id: this.id, args }) })
  dom.window.matchMedia = () => ({ matches: Boolean(options.reducedMotion), addEventListener() {}, removeEventListener() {} })
  const root = createRoot(host)
  let unmounted = false
  function Draft() {
    const [value, setValue] = useState("저장하지 않은 합성 내용")
    useEffect(() => { calls.mounts++; return () => { calls.mounts-- } }, [])
    return createElement("input", { "aria-label": "합성 편집 중 입력", value, onChange: event => setValue(event.target.value) })
  }
  function section([label, key, kind], owner) {
    if (owner === "current" && options.missingSection === kind) return null
    const button = owner === "current" && options.missingButton === kind ? null
      : createElement("button", { type: "button", disabled: owner === "current" && options.disabledButton === kind,
        "data-registration-message-entry": kind, "data-fixture-owner": owner,
        onClick: () => calls.clicks.push({ owner, kind }) }, `${label} 합성 미리보기`)
    const contents = [createElement("h2", { key: "heading", tabIndex: -1, "data-registration-section-heading": "", "data-fixture-owner": owner }, `${label} 처리`),
      createElement("fieldset", { key: "fields", disabled: owner === "current" && options.disabledFieldset === kind }, button)]
    return createElement("section", { key, id: `registration-application-${key}`, "data-registration-application-section": key,
      "data-fixture-owner": owner }, ...contents)
  }
  await flush(() => root.render(createElement("div", null,
    // An earlier unrelated scope with identical section IDs must never win a
    // document-wide lookup. Actual navigation stays in the trigger's detail.
    createElement("div", { "data-registration-application-mode": "detail", "data-fixture-other": "" }, destinations.map(destination => section(destination, "other"))),
    createElement("form", { "data-registration-application-mode": "detail", "data-fixture-current": "", onSubmit: event => { event.preventDefault(); calls.submits++ } },
      createElement(RegistrationCustomerMessageNavigation, { includeObservation: options.includeObservation !== false }),
      createElement(Draft), destinations.map(destination => section(destination, "current"))),
  )))
  const scope = host.querySelector("[data-fixture-current]")
  const trigger = [...scope.querySelectorAll("button")].find(button => button.textContent.trim() === "알림톡 위치")
  t.after(async () => {
    assert.deepEqual(calls.clicks, [], "Navigation must not click a preview action")
    assert.equal(calls.submits, 0)
    if (!unmounted) await flush(() => root.unmount())
    host.remove()
  })
  assert.ok(trigger, "A named location menu must be visible in the detail header")
  return {
    calls, host, scope, trigger,
    async open(key = "Enter") {
      await flush(() => { trigger.focus(); trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true })) })
      return [...document.querySelectorAll('[role="menuitem"]')]
    },
    async choose(label, keyboard = false) {
      const items = await this.open()
      const item = items.find(node => node.textContent.startsWith(label))
      assert.ok(item, `${label} location is offered`)
      await flush(() => { item.focus(); if (keyboard) item.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); else item.click() })
    },
    async selectThenUnmount(label) {
      const items = await this.open()
      const item = items.find(node => node.textContent.startsWith(label))
      assert.ok(item)
      await flush(() => { item.click(); root.unmount(); unmounted = true })
    },
  }
}

test("message locations scroll and focus all five existing actions without preview, send, submit, or remount", async t => {
  const view = await mount(t)
  const input = view.scope.querySelector("input")
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set
  await flush(() => { setter.call(input, "보존할 편집 내용"); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })) })
  for (const [label, key, kind] of destinations) {
    await view.choose(label)
    const target = view.scope.querySelector(`[data-registration-message-entry="${kind}"]`)
    assert.equal(document.activeElement === target, true, `${label} focuses the existing local action`)
    assert.equal(view.calls.scrolls.at(-1).owner, "current")
    assert.equal(view.calls.scrolls.at(-1).id, `registration-application-${key}`)
    assert.equal(view.calls.scrolls.at(-1).args.behavior, "smooth")
    assert.equal(view.calls.scrolls.at(-1).args.block, "start")
    assert.equal(input.value, "보존할 편집 내용")
    assert.equal(view.calls.mounts, 1)
  }
})

for (const [name, option] of [["disabled action", "disabledButton"], ["disabled fieldset", "disabledFieldset"], ["missing action", "missingButton"]]) {
  test(`message location falls back to its section heading for a ${name}`, async t => {
    const view = await mount(t, { [option]: "waiting_notice", reducedMotion: true })
    await view.choose("대기", true)
    const section = view.scope.querySelector('[data-registration-application-section="waiting"]')
    assert.equal(document.activeElement === section.querySelector("[data-registration-section-heading]"), true)
    assert.equal(view.calls.scrolls.at(-1).args.behavior, "auto")
  })
}

test("message location menu omits unavailable observation and safely ignores a missing destination", async t => {
  const view = await mount(t, { includeObservation: false, missingSection: "admission_application" })
  const items = await view.open(" ")
  assert.equal(items.length, 4)
  assert.equal(items.some(item => item.textContent.startsWith("청강")), false)
  const admission = items.find(item => item.textContent.startsWith("입학"))
  assert.ok(admission)
  await flush(() => admission.click())
  assert.deepEqual(view.calls.scrolls, [])
  assert.equal(document.activeElement === view.trigger, true, "Missing destination returns normal menu focus")
})

test("keyboard Escape cancels location navigation and restores its trigger without action", async t => {
  const view = await mount(t)
  const items = await view.open()
  assert.equal(items.length, 5)
  await flush(() => items[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  assert.equal(document.querySelector('[role="menu"]'), null)
  assert.equal(document.activeElement === view.trigger, true)
  assert.deepEqual(view.calls.scrolls, [])
})


test("unmounting a selected location cancels its pending close transition", async t => {
  const view = await mount(t)
  await view.selectThenUnmount("대기")
  assert.deepEqual(view.calls.scrolls, [], "A removed detail must not move focus or scroll after menu close")
  assert.equal(document.querySelector('[role="menu"]'), null)
})
