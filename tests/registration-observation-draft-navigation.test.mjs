import assert from "node:assert/strict"
import test from "node:test"

import { JSDOM } from "jsdom"
import { act, createElement, useState } from "react"

import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const session = {
  sessionAuthority: "normalized", classLessonSessionId: "session-a",
  startsAt: "2026-09-20T09:00:00Z", endsAt: "2026-09-20T10:00:00Z",
  teacherName: "합성 교사", teacherProfileId: "teacher", classroomCatalogId: "room",
  classroomName: "합성 강의실", campus: "합성 캠퍼스", textbooks: [], progress: "",
}

async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/registration" })
  const globalKeys = [
    "window", "document", "HTMLElement", "Element", "DocumentFragment", "MutationObserver",
    "CustomEvent", "Event", "Node", "NodeFilter", "HTMLInputElement", "getComputedStyle",
    "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame",
  ]
  const previousGlobals = new Map(globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const key of globalKeys.slice(2, 12)) globalThis[key] = dom.window[key]
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout
  window.HTMLElement.prototype.scrollIntoView = () => {}
  window.HTMLElement.prototype.getClientRects = () => [{ width: 30, height: 30 }]
  window.navigation = Object.assign(new window.EventTarget(), {
    traverseTo: () => ({ committed: Promise.resolve(), finished: Promise.resolve() }),
  })
  const routes = []
  const writes = []
  const router = { push: (href) => routes.push(href) }
  const overrides = new Map([["next/navigation", { useRouter: () => router }]])
  const { useDraftNavigation } = loadNotificationComponent("src/hooks/use-draft-navigation.tsx", overrides)
  const { RegistrationObservationEditor } = loadNotificationComponent("src/features/tasks/registration-observation-editor.tsx", overrides)
  const { requestAppNavigation } = loadNotificationComponent("src/lib/guarded-navigation.ts")
  const actions = {
    loadRegistrationObservationSessions: async () => [session],
    saveRegistrationObservationBooking: () => {
      const request = Promise.withResolvers()
      writes.push(request)
      return request.promise
    },
    cancelRegistrationObservation: () => { throw new Error("unexpected cancel") },
  }
  let currentProps = {}
  let mountKey = 0
  function Host() {
    const [dirty, setDirty] = useState(false)
    const guard = useDraftNavigation({ dirty })
    return createElement("div", { "data-dirty": String(dirty) }, guard.confirmation, createElement(RegistrationObservationEditor, {
      key: mountKey, trackId: "track-a", workflowRevision: 1,
      observationRevision: null, appointmentNotificationRevision: null,
      detail: { currentObservation: null, attempts: [], classes: [{ id: "class-a", name: "합성 수업" }] },
      actions, onSaved: async () => {}, onDirtyChange: setDirty, ...currentProps,
    }))
  }
  const { createRoot } = await import("react-dom/client")
  const root = createRoot(document.getElementById("root"))
  const flush = async (fn) => act(async () => { fn?.(); await new Promise((resolve) => setTimeout(resolve, 25)) })
  t.after(async () => {
    await flush(() => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  await flush(() => root.render(createElement(Host)))
  function selectProps(label) {
    const container = document.getElementById("root")
    const fiber = container[Object.keys(container).find((key) => key.startsWith("__reactContainer"))].stateNode.current
    function find(node) {
      if (!node) return null
      if (node.type?.name === "RegistrationSelect" && node.memoizedProps["aria-label"] === label) return node.memoizedProps
      return find(node.child) || find(node.sibling)
    }
    const props = find(fiber)
    assert.ok(props, `missing select ${label}`)
    return props
  }
  const ui = {
    writes, routes, flush, selectProps, actions,
    change: (value, label) => flush(() => selectProps(label).onValueChange(value)),
    app: () => flush(() => requestAppNavigation(() => routes.push("/admin/dashboard"))),
    dirty: () => document.querySelector("[data-dirty]").dataset.dirty,
    confirmation: () => document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'),
    button: (label, last = false) => {
      const buttons = [...document.querySelectorAll("button")].filter((button) => button.textContent === label)
      const button = last ? buttons.at(-1) : buttons[0]
      assert.ok(button, `missing button ${label}`)
      return button
    },
    render: async (props = {}, remount = false) => {
      currentProps = props
      if (remount) mountKey += 1
      await flush(() => root.render(createElement(Host)))
    },
  }
  ui.submit = async () => {
    await flush(() => ui.button("청강 예약 저장").click())
    await flush(() => ui.button("청강 예약 저장", true).click())
  }
  return ui
}

test("booking: actual child reports its draft and cancelled navigation preserves the selected class", async (t) => {
  const ui = await mount(t)
  assert.equal(ui.dirty(), "false")
  await ui.change("class-a", "청강 반")
  assert.equal(ui.dirty(), "true")
  await ui.app()
  assert.ok(ui.confirmation())
  assert.equal(ui.routes.length, 0)
  await ui.flush(() => ui.button("계속 편집").click())
  assert.equal(ui.selectProps("청강 반").value, "class-a")
  assert.equal(ui.dirty(), "true")
  await ui.change("", "청강 반")
  assert.equal(ui.dirty(), "false")
})

test("booking: failed save retains class and session, accepted retry clears only its draft ownership", async (t) => {
  const ui = await mount(t)
  await ui.change("class-a", "청강 반")
  await ui.change("normalized:session-a", "청강 회차")
  await ui.submit()
  assert.equal(ui.writes.length, 1)
  assert.equal(ui.dirty(), "true")
  await ui.flush(() => ui.writes[0].reject(new Error("synthetic failed write")))
  const failureAlert = document.querySelector('[role="dialog"] [role="alert"]')
  assert.ok(failureAlert, "a booking failure must be visible inside the still-open confirmation")
  assert.equal(failureAlert.closest('[aria-hidden="true"]'), null, "the failure must be exposed to assistive technology")
  assert.match(failureAlert.textContent, /청강 정보를 저장하지 못했습니다/)
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1, "failure feedback has one visible owner")
  assert.equal(ui.selectProps("청강 반").value, "class-a")
  assert.equal(ui.selectProps("청강 회차").value, "normalized:session-a")
  assert.equal(ui.dirty(), "true")
  await ui.app()
  assert.ok(ui.confirmation())
  await ui.flush(() => ui.button("계속 편집").click())
  await ui.flush(() => ui.button("청강 예약 저장", true).click())
  assert.equal(ui.writes.length, 2)
  await ui.flush(() => ui.writes[1].resolve({ changed: true, observation: null, appointment: null }))
  assert.equal(ui.dirty(), "false")
  await ui.app()
  assert.deepEqual(ui.routes, ["/admin/dashboard"])
})

test("booking: a former child's response cannot clear the next child's draft", async (t) => {
  const ui = await mount(t)
  await ui.change("class-a", "청강 반")
  await ui.change("normalized:session-a", "청강 회차")
  await ui.submit()
  assert.equal(ui.writes.length, 1)
  await ui.render({}, true)
  assert.equal(ui.dirty(), "false")
  await ui.change("class-a", "청강 반")
  assert.equal(ui.dirty(), "true")
  await ui.flush(() => ui.writes[0].resolve({ changed: true, observation: null, appointment: null }))
  assert.equal(ui.dirty(), "true")
  assert.equal(ui.selectProps("청강 반").value, "class-a")
  await ui.app()
  assert.ok(ui.confirmation())
})

test("booking: two immediate confirmation clicks submit one booking write", async (t) => {
  const ui = await mount(t)
  await ui.change("class-a", "청강 반")
  await ui.change("normalized:session-a", "청강 회차")
  await ui.flush(() => ui.button("청강 예약 저장").click())
  const confirm = ui.button("청강 예약 저장", true)
  await ui.flush(() => {
    confirm.click()
    confirm.click()
  })
  assert.equal(ui.writes.length, 1, "both clicks use the same mounted handler before a React rerender")
  assert.equal(ui.dirty(), "true")
  await ui.flush(() => ui.writes[0].resolve({ changed: true, observation: null, appointment: null }))
  assert.equal(ui.dirty(), "false")
})

test("booking: repeated missing-session submissions expose an input error, preserve the class, and write nothing", async (t) => {
  const ui = await mount(t)
  await ui.change("class-a", "청강 반")
  assert.equal(ui.selectProps("청강 회차").value, "")
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ui.flush(() => ui.button("청강 예약 저장").click())
    assert.equal(ui.writes.length, 0)
    assert.match(document.body.textContent, /회차[^.\n]*선택/)
    const invalidSession = document.querySelector('[aria-label="청강 회차"][aria-invalid="true"]')
    const fieldAlert = [...document.querySelectorAll('[role="alert"]')].find((node) => /회차[^.\n]*선택/.test(node.textContent))
    assert.ok(invalidSession || fieldAlert, "the missing session error must be attached to the control or announced")
    assert.equal(ui.selectProps("청강 반").value, "class-a")
    assert.equal(ui.selectProps("청강 회차").value, "")
    assert.equal(ui.dirty(), "true")
  }
  await ui.app()
  assert.ok(ui.confirmation())
  assert.equal(ui.routes.length, 0)
  await ui.flush(() => ui.button("계속 편집").click())
  assert.equal(ui.selectProps("청강 반").value, "class-a")
  await ui.change("normalized:session-a", "청강 회차")
  await ui.submit()
  assert.equal(ui.writes.length, 1, "correcting the field permits one booking write")
  await ui.flush(() => ui.writes[0].resolve({ changed: true, observation: null, appointment: null }))
  assert.equal(ui.dirty(), "false")
})

test("booking: a failed session refresh and explicit retry preserve the owned class and session draft", async (t) => {
  const ui = await mount(t)
  await ui.change("class-a", "청강 반")
  await ui.change("normalized:session-a", "청강 회차")
  let reads = 0
  await ui.render({
    actions: {
      ...ui.actions,
      loadRegistrationObservationSessions: async () => {
        reads += 1
        if (reads === 1) throw new Error("TypeError: Failed to fetch")
        return [session]
      },
    },
  })
  assert.equal(reads, 1)
  assert.equal(ui.selectProps("청강 반").value, "class-a")
  assert.equal(ui.selectProps("청강 회차").value, "normalized:session-a")
  assert.equal(ui.dirty(), "true")
  assert.equal(ui.writes.length, 0)
  const staleSelectionCopy = document.body.textContent
  await ui.flush(() => ui.button("청강 예약 저장").click())
  assert.equal(ui.writes.length, 0, "a failed schedule read cannot authorize a booking write")
  await ui.flush(() => ui.button("회차 다시 불러오기").click())
  assert.equal(reads, 2)
  assert.equal(ui.selectProps("청강 반").value, "class-a")
  assert.equal(ui.selectProps("청강 회차").value, "normalized:session-a")
  assert.equal(ui.dirty(), "true")
  assert.equal(ui.writes.length, 0, "retrying a read never writes the draft")
  assert.deepEqual({
    retainedSelectionCopy: /선택한 회차 확인 필요/.test(staleSelectionCopy),
    remainingAlert: document.querySelector('[role="alert"]')?.textContent ?? null,
  }, {
    retainedSelectionCopy: true,
    remainingAlert: null,
  }, "the retained selection stays readable on failure and successful retry clears the old error")
  await ui.submit()
  assert.equal(ui.writes.length, 1)
  await ui.flush(() => ui.writes[0].resolve({ changed: true, observation: null, appointment: null }))
  assert.equal(ui.dirty(), "false")
})
