import assert from "node:assert/strict"
import test from "node:test"
import { act, createElement } from "react"
import { JSDOM } from "jsdom"
import { normalizeRegistrationCaseContact } from "../src/features/tasks/registration-contact-client.ts"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const TASK = "91000000-0000-4000-8000-000000000001"
const TRACK = "91000000-0000-4000-8000-000000000002"
const REQUEST = "91000000-0000-4000-8000-000000000003"
const PARENT = "010-0000-0000" // synthetic canaries only
const LEGACY = "010-0000-0001"
const DRAFT = "010-0000-0002"
const FRESH = "010-0000-0003"
const STUDENT = "010-0000-0004"
const UNSAVED = "미저장 업무 메모"
const state = (overrides = {}) => normalizeRegistrationCaseContact({
  version: 1, taskId: TASK, revision: "1", generation: "1", phase: "open",
  closureReason: null, closedAt: null, parentPhone: PARENT, studentId: null,
  commonRevision: 1, allPhasesClosed: false, currentTrackIds: [TRACK], ...overrides,
}, TASK)
const closedState = () => state({ revision: "2", phase: "closed", parentPhone: null,
  closureReason: "all_current_tracks_terminal", closedAt: "2026-10-09T09:00:00Z", allPhasesClosed: true })
const reopenedState = () => state({ revision: "3", generation: "2", parentPhone: null })
const detail = (contactState = state()) => ({
  commonRevision: 1, contactState,
  task: { id: TASK, type: "registration", studentName: "합성 학생", campus: "본관", priority: "normal",
    registration: { schoolName: "합성 학교", schoolGrade: "중2", inquiryAt: "2026-10-09T09:00:00Z",
      requestNote: "서버 업무 메모", parentPhone: LEGACY, studentPhone: STUDENT } },
  tracks: [{ id: TRACK, subject: "영어", workflowStatus: "inquiry" }],
})

async function fixture(run, initialDetail = detail()) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/admin/registration" })
  const saved = new Map()
  const globals = {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    ...Object.fromEntries(["HTMLElement", "Element", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "Node", "NodeFilter", "HTMLInputElement", "HTMLTextAreaElement"]
      .map((key) => [key, dom.window[key]])),
    getComputedStyle: dom.window.getComputedStyle,
  }
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0)
  dom.window.cancelAnimationFrame = dom.window.clearTimeout
  const { createRoot } = await import("react-dom/client")
  const { RegistrationInquiryEditor } = loadNotificationComponent("src/features/tasks/registration-application-inquiry-section.tsx", new Map([
    ["./registration-track-service", { createRegistrationMutationRequestKey: () => REQUEST }],
  ]))
  const root = createRoot(dom.window.document.getElementById("root"))
  const writes = []
  const warnings = []
  const dirty = []
  const props = { detail: initialDetail, canEdit: true,
    onSave: async (draft, requestKey) => { writes.push({ draft, requestKey }); return "partial" },
    onReload: async () => {}, onWarning: (message) => warnings.push(message), onDirtyChange: (value) => dirty.push(value),
  }
  const render = async (patch = {}) => {
    Object.assign(props, patch)
    await act(async () => root.render(createElement(RegistrationInquiryEditor, props)))
  }
  const change = async (element, value) => {
    assert.ok(element, "real input exists")
    const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value)
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })
    assert.equal(element.value, value)
  }
  const click = async (element) => {
    assert.ok(element, "real action exists")
    assert.equal(element.disabled, false)
    await act(async () => element.click())
  }
  const button = (name) => [...dom.window.document.querySelectorAll("button")].find((element) => element.textContent === name)
  const parent = () => dom.window.document.querySelector('[data-common-field="parent-phone"]')
  const note = () => dom.window.document.querySelector("textarea")
  const save = () => dom.window.document.querySelector('[aria-label="문의 정보 저장"]')
  try {
    await render()
    await run({ document: dom.window.document, props, writes, warnings, dirty, render, change, click, button, parent, note, save })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

function absent(document, phones = [PARENT, LEGACY, DRAFT, STUDENT]) {
  for (const phone of phones) {
    assert.equal(document.body.innerHTML.includes(phone), false, `no serialized DOM canary ${phone}`)
    assert.equal([...document.querySelectorAll("input,textarea")].some((element) => element.value.includes(phone)), false)
  }
  assert.equal(document.querySelector('[data-common-field="student-phone"]'), null)
}

test("open to closed at the same common revision strips parent DOM and save draft while preserving unsaved note", async () => {
  await fixture(async (ui) => {
    assert.equal(ui.parent().value, PARENT)
    await ui.change(ui.parent(), DRAFT)
    await ui.change(ui.note(), UNSAVED)
    const note = ui.note()
    await ui.render({ detail: detail(closedState()) })
    assert.equal(ui.parent(), null)
    absent(ui.document)
    assert.equal(ui.note(), note)
    assert.equal(ui.note().value, UNSAVED)
    await ui.click(ui.save())
    assert.equal(ui.writes.length, 1)
    assert.equal(ui.writes[0].draft.parentPhone, "")
    assert.equal(ui.writes[0].draft.requestNote, UNSAVED)
    assert.equal(Object.hasOwn(ui.writes[0].draft, "studentPhone"), false)
  })
})

test("closed to a new open generation ignores old task contacts and starts with a blank parent field", async () => {
  await fixture(async (ui) => {
    await ui.change(ui.note(), UNSAVED)
    await ui.render({ detail: detail(reopenedState()) })
    assert.ok(ui.parent())
    assert.equal(ui.parent().value, "")
    absent(ui.document)
    assert.equal(ui.note().value, UNSAVED)
    await ui.click(ui.save())
    assert.equal(ui.writes[0].draft.parentPhone, "")
    assert.equal(ui.writes[0].draft.requestNote, UNSAVED)
  }, detail(closedState()))
})

test("an explicit new subject on a closed case offers blank fresh contact and saves it in the same inquiry request", async () => {
  await fixture(async (ui) => {
    assert.equal(ui.parent(), null)
    await ui.change(ui.note(), UNSAVED)
    await ui.click(ui.document.querySelector('[aria-label="수학 문의 과목 선택 안 됨"]'))
    assert.ok(ui.parent())
    assert.equal(ui.parent().value, "")
    absent(ui.document)
    await ui.change(ui.parent(), FRESH)
    await ui.click(ui.save())
    assert.equal(ui.writes.length, 1)
    assert.equal(ui.writes[0].draft.parentPhone, FRESH)
    assert.deepEqual(ui.writes[0].draft.subjects, ["영어", "수학"])
    assert.equal(ui.writes[0].draft.requestNote, UNSAVED)
    assert.equal(ui.writes[0].requestKey, REQUEST)
    assert.equal(JSON.stringify(ui.writes[0]).includes(LEGACY), false)
    assert.equal(JSON.stringify(ui.writes[0]).includes(STUDENT), false)
  }, detail(closedState()))
})

test("removing and adding a closed-case new subject never revives the discarded contact purpose draft", async () => {
  await fixture(async (ui) => {
    await ui.change(ui.note(), UNSAVED)
    await ui.click(ui.document.querySelector('[aria-label="수학 문의 과목 선택 안 됨"]'))
    await ui.change(ui.parent(), FRESH)
    await ui.click(ui.document.querySelector('[aria-label="수학 문의 과목 선택됨"]'))
    assert.equal(ui.parent(), null)
    absent(ui.document, [PARENT, LEGACY, DRAFT, FRESH, STUDENT])
    await ui.click(ui.document.querySelector('[aria-label="수학 문의 과목 선택 안 됨"]'))
    assert.equal(ui.parent().value, "")
    assert.equal(ui.note().value, UNSAVED)
    absent(ui.document, [PARENT, LEGACY, DRAFT, FRESH, STUDENT])
  }, detail(closedState()))
})

test("async conflict, failed reload and a new generation comparison/reapply cannot restore the prior phone", async () => {
  await fixture(async (ui) => {
    const pending = Promise.withResolvers()
    let attempts = 0
    await ui.render({ onSave: async (draft, requestKey) => {
      ui.writes.push({ draft, requestKey })
      attempts += 1
      return attempts === 1 ? pending.promise : "partial"
    }, onReload: async () => { throw new Error("synthetic reload failure") } })
    await ui.change(ui.parent(), DRAFT)
    await ui.change(ui.note(), UNSAVED)
    await ui.click(ui.save())
    assert.equal(ui.writes[0].draft.parentPhone, DRAFT)
    await ui.render({ detail: detail(closedState()) })
    await act(async () => pending.resolve("conflict"))
    assert.ok(ui.button("최신 정보 다시 불러오기"))
    assert.equal(ui.button("내 입력 다시 적용"), undefined)
    assert.equal(ui.parent(), null)
    absent(ui.document)
    assert.equal(ui.note().value, UNSAVED)
    await ui.render({ onReload: async () => {
      ui.props.detail = detail(reopenedState())
      await ui.render()
    } })
    await ui.click(ui.button("최신 정보 다시 불러오기"))
    assert.ok(ui.button("내 입력 다시 적용"))
    absent(ui.document)
    await ui.click(ui.button("내 입력 다시 적용"))
    assert.equal(ui.parent().value, "")
    assert.equal(ui.note().value, UNSAVED)
    absent(ui.document)
    await ui.click(ui.save())
    assert.equal(ui.writes.length, 2)
    assert.equal(ui.writes[1].draft.parentPhone, "")
    assert.equal(ui.writes[1].draft.requestNote, UNSAVED)
  })
})

test("unavailable contact state hides legacy task contacts and clears an already open draft", async () => {
  await fixture(async (ui) => {
    await ui.change(ui.parent(), DRAFT)
    await ui.change(ui.note(), UNSAVED)
    await ui.render({ detail: detail(null) })
    assert.equal(ui.parent(), null)
    absent(ui.document)
    assert.equal(ui.note().value, UNSAVED)
    await ui.click(ui.save())
    assert.equal(ui.writes[0].draft.parentPhone, "")
  })
})
