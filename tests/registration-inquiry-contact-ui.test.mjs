import assert from "node:assert/strict"
import test from "node:test"
import { act, createElement } from "react"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"
import {
  canUseRegistrationParentContact,
  getRegistrationContactScopeKey,
  normalizeRegistrationCaseContact,
  reconcileRegistrationInquiryContactDraft,
} from "../src/features/tasks/registration-contact-client.ts"

const TASK = "00000000-0000-4000-8000-000000000001"
const TRACK = "00000000-0000-4000-8000-000000000002"
const PARENT_PHONE = "010-0000-0000" // synthetic canaries only
const STUDENT_PHONE = "010-0000-0001"
const values = (overrides = {}) => ({
  studentName: "합성 학생", schoolGrade: "중2", schoolName: "합성 학교",
  parentPhone: PARENT_PHONE, studentPhone: STUDENT_PHONE, student_phone: STUDENT_PHONE,
  parent_phone: PARENT_PHONE, inquiryAt: "2026-10-09T09:00:00Z", requestNote: "미저장 업무 메모",
  ...overrides,
})
const contact = (overrides = {}) => normalizeRegistrationCaseContact({
  version: 1, taskId: TASK, revision: "1", generation: "1", phase: "open",
  closureReason: null, closedAt: null, parentPhone: PARENT_PHONE, studentId: null,
  commonRevision: 1, allPhasesClosed: false, currentTrackIds: [TRACK], ...overrides,
}, TASK)

async function fixture(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, DocumentFragment: dom.window.DocumentFragment,
    CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const { createRoot } = await import("react-dom/client")
  const root = createRoot(document.getElementById("root"))
  const { RegistrationInquiryCommonFields } = loadNotificationComponent("src/features/tasks/registration-application-inquiry-fields.tsx")
  const render = async (props) => act(async () => root.render(createElement(RegistrationInquiryCommonFields, {
    values: values(), onChange() {}, ...props,
  })))
  try {
    await run({ document: dom.window.document, render })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

function assertNoStudentContact(document) {
  assert.equal(document.querySelector('[data-common-field="student-phone"]'), null)
  assert.equal(document.body.textContent.includes("학생 전화"), false)
  assert.equal(document.body.innerHTML.includes(STUDENT_PHONE), false)
  assert.equal([...document.querySelectorAll("input, textarea")].some((input) => input.value.includes(STUDENT_PHONE)), false)
}

function assertNoParentContact(document) {
  assert.equal(document.querySelector('[data-common-field="parent-phone"]'), null)
  assert.equal(document.querySelector('[data-registration-focus="parentPhone"]'), null)
  assert.equal(document.body.textContent.includes("학부모 전화"), false)
  assert.equal(document.body.innerHTML.includes(PARENT_PHONE), false)
  assert.equal([...document.querySelectorAll("input, textarea")].some((input) => input.value.includes(PARENT_PHONE)), false)
}

test("the actual common-fields renderer has one parent input and no student-contact DOM", async () => {
  await fixture(async ({ document, render }) => {
    await render({ showParentContact: true })
    assertNoStudentContact(document)
    const parent = document.querySelector('[data-common-field="parent-phone"]')
    assert.ok(parent)
    assert.equal(parent.value, PARENT_PHONE)
    assert.equal(parent.getAttribute("inputmode"), "tel")
    assert.equal(parent.getAttribute("autocomplete"), "off")
    assert.equal(document.querySelectorAll('input[inputmode="tel"]').length, 1)
  })
})

test("closed/unavailable contact visibility removes the real input without remounting other draft controls", async () => {
  await fixture(async ({ document, render }) => {
    const current = values()
    await render({ values: current, showParentContact: true })
    const name = document.querySelector('[data-common-field="student-name"]')
    const school = document.querySelector('[data-common-field="school-name"]')
    const note = document.querySelector("textarea")
    name.focus()
    await render({ values: current, showParentContact: false })
    assertNoStudentContact(document)
    assertNoParentContact(document)
    assert.equal(document.querySelector('[data-common-field="student-name"]'), name)
    assert.equal(document.querySelector('[data-common-field="school-name"]'), school)
    assert.equal(document.querySelector("textarea"), note)
    assert.equal(document.activeElement, name)
    assert.equal(name.value, current.studentName)
    assert.equal(school.value, current.schoolName)
    assert.equal(note.value, current.requestNote)
  })
})

test("close and reopen through real contact helpers cannot restore an earlier-generation phone in the renderer", async () => {
  await fixture(async ({ document, render }) => {
    const open = contact()
    const done = contact({ revision: "2", phase: "closed", allPhasesClosed: true,
      closureReason: "all_current_tracks_terminal", closedAt: "2026-10-09T09:00:00Z", parentPhone: null })
    const reopened = contact({ revision: "3", generation: "2", parentPhone: null })
    let current = values()
    await render({ values: current, showParentContact: canUseRegistrationParentContact(open) })
    current = reconcileRegistrationInquiryContactDraft(current, values({ parentPhone: "" }),
      getRegistrationContactScopeKey(open), getRegistrationContactScopeKey(done), canUseRegistrationParentContact(done))
    await render({ values: current, showParentContact: canUseRegistrationParentContact(done) })
    assertNoStudentContact(document)
    assertNoParentContact(document)
    current = reconcileRegistrationInquiryContactDraft(current, values({ parentPhone: "" }),
      getRegistrationContactScopeKey(done), getRegistrationContactScopeKey(reopened), canUseRegistrationParentContact(reopened))
    await render({ values: current, showParentContact: canUseRegistrationParentContact(reopened) })
    assertNoStudentContact(document)
    assert.equal(document.querySelector('[data-common-field="parent-phone"]').value, "")
    assert.equal(document.body.innerHTML.includes(PARENT_PHONE), false)
    assert.equal(document.querySelector("textarea").value, "미저장 업무 메모")
    assert.equal(current.parentPhone, "")
  })
})

test("case-level zero-active and unavailable metadata hide parent contact in the actual renderer", async () => {
  await fixture(async ({ document, render }) => {
    for (const state of [null, contact({ currentTrackIds: [] }), contact({ allPhasesClosed: true, parentPhone: null })]) {
      await render({ showParentContact: canUseRegistrationParentContact(state) })
      assertNoStudentContact(document)
      assertNoParentContact(document)
      assert.equal(document.querySelector('[data-common-field="student-name"]').value, "합성 학생")
    }
  })
})
