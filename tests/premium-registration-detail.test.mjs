import assert from "node:assert/strict"
import test from "node:test"
import { act, createElement, useEffect } from "react"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const { RegistrationApplicationShell } = loadNotificationComponent("src/features/tasks/registration-application-shell.tsx")
const { RegistrationApplicationProgressStepper } = loadNotificationComponent("src/features/tasks/registration-application-progress-stepper.tsx")
const { getRegistrationApplicationProgress } = loadNotificationComponent("src/features/tasks/registration-application-model.ts")
const { RegistrationSaveButton } = loadNotificationComponent("src/features/tasks/registration-save-button.tsx")

test("section navigation focuses mounted headings while drafts and errors remain reachable", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" })
  const savedGlobals = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDetailsElement: dom.window.HTMLDetailsElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const { createRoot } = await import("react-dom/client")
  window.matchMedia = () => ({ matches: true })
  const scrolls = []
  window.HTMLElement.prototype.scrollIntoView = function(options) { scrolls.push({ id: this.id, options }) }
  let mounts = 0
  let unmounts = 0
  function Draft() {
    useEffect(() => { mounts += 1; return () => { unmounts += 1 } }, [])
    return createElement("input", { "aria-label": "문의 초안", defaultValue: "보존할 입력" })
  }
  const state = { editable: true, current: false, lockReason: "", upcoming: false }
  const sectionStates = Object.fromEntries(["inquiry", "level_test", "consultation", "placement", "observation", "admission"].map((key) => [key, state]))
  const root = createRoot(document.getElementById("root"))
  try {
    const render = (status, saving = false) => createElement(RegistrationApplicationShell, {
      mode: "detail", studentName: "긴 학생 이름도 전체 표시", sectionStates,
      closeAction: createElement("button", null, "닫기"),
      subjectNavigation: createElement("span", null, "영어"),
      progress: createElement(RegistrationApplicationProgressStepper, { steps: getRegistrationApplicationProgress(status) }),
      inquiry: createElement(Draft), levelTest: "레벨테스트", consultation: createElement("div", null,
        createElement("input", { "aria-label": "상담 필수값", "aria-invalid": true, "aria-describedby": "consult-error" }),
        createElement("p", { id: "consult-error", role: "alert" }, "필수값을 입력하세요")),
      waiting: "대기", observation: "청강", registration: "등록",
      admission: createElement(RegistrationSaveButton, { dirty: true, saving, actionLabel: "변경사항 저장", onClick: () => {} }),
    })
    await act(async () => root.render(render("consultation_waiting")))
    assert.equal(document.querySelectorAll('[data-registration-application-section]').length, 7)
    const draft = document.querySelector('[aria-label="문의 초안"]')
    draft.value = "변경한 미저장 초안"
    for (const key of ["admission", "inquiry", "consultation"]) {
      const button = document.querySelector(`[aria-controls="registration-application-${key}"]`)
      await act(async () => button.click())
      assert.equal(document.activeElement, document.querySelector(`#registration-application-${key} [data-registration-section-heading]`))
      assert.equal(scrolls.at(-1).id, `registration-application-${key}`)
      assert.equal(scrolls.at(-1).options.behavior, "auto")
      assert.equal(document.querySelector('[aria-label="문의 초안"]'), draft)
      assert.equal(draft.value, "변경한 미저장 초안")
    }
    document.querySelector('[aria-invalid="true"]').focus()
    assert.equal(document.activeElement.getAttribute("aria-describedby"), "consult-error")
    await act(async () => root.render(render("enrollment_processing", true)))
    assert.equal(document.querySelector('[aria-label="문의 초안"]'), draft)
    assert.equal(draft.value, "변경한 미저장 초안")
    assert.equal(mounts, 1)
    assert.equal(unmounts, 0)
    assert.equal(document.querySelector('li[aria-current="step"] button').getAttribute('aria-controls'), 'registration-application-admission')
    const save = document.querySelector('#registration-application-admission button')
    assert.equal(save.disabled, true)
    assert.equal(save.getAttribute("aria-busy"), "true")
    Object.defineProperty(window, "innerHeight", { value: 520, configurable: true })
    await act(async () => window.dispatchEvent(new window.Event("resize")))
    const shell = document.querySelector('[data-registration-application-mode="detail"]')
    assert.equal(shell.dataset.registrationCompactViewport, "true")
    assert.equal(shell.style.getPropertyValue("--registration-section-scroll-margin"), "16px")
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true })
    await act(async () => window.dispatchEvent(new window.Event("resize")))
    assert.equal(shell.dataset.registrationCompactViewport, "false")
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
