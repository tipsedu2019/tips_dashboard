import assert from "node:assert/strict"
import test from "node:test"
import { act, createElement } from "react"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const { RegistrationListToolbar } = loadNotificationComponent("src/features/tasks/registration-list-toolbar.tsx")

test("zero-count owner scope stays usable without remounting the active search field", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const { createRoot } = await import("react-dom/client")
  const root = createRoot(document.getElementById("root"))
  let selected = "mine"
  const render = (withScope = true) => root.render(createElement(RegistrationListToolbar, {
    search: createElement("input", { type: "search", "aria-label": "등록 검색", defaultValue: "김학생" }),
    actions: createElement("button", null, "등록 추가"),
    consultationScope: withScope ? { value: selected, counts: { mine: 0, all: 3 }, onChange: (value) => { selected = value; render() } } : undefined,
  }))
  try {
    await act(async () => render())
    const input = document.querySelector('input[type="search"]')
    const all = document.querySelector('[aria-label="전체 담당 3건"]')
    assert.equal(document.querySelector('[aria-label="내 담당 0건"]').disabled, false)
    assert.equal(document.querySelector('[aria-label="내 담당 0건"]').getAttribute("aria-pressed"), "true")
    await act(async () => all.click())
    assert.equal(selected, "all")
    assert.equal(all.getAttribute("aria-pressed"), "true")
    assert.equal(document.querySelector('input[type="search"]'), input)
    assert.equal(input.value, "김학생")
    await act(async () => render(false))
    assert.equal(document.querySelector('input[type="search"]'), input)
    assert.equal(input.value, "김학생")
    assert.equal(document.querySelectorAll('[aria-label="상담 목록 범위"]').length, 0)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
