import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import { act, createElement as h } from "react"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"
import { registrationClassOptions, registrationClassGradeOptions, registrationDefaultTextbookIds, UNASSIGNED_CLASS_GRADE } from "../src/features/tasks/registration-class-options.ts"
import { applyRegistrationEnrollmentClassSelection } from "../src/features/tasks/registration-track-model.js"

const classes = [
  { id: "a10", label: "영어 10반", grade: "중1", subject: "영어", textbookIds: ["a"] },
  { id: "a2", label: "영어 2반", grade: "중1, 중2", subject: "영어", textbookIds: ["a"] },
  { id: "b", label: "공통반", grade: "", subject: "영어", textbookIds: ["b"] },
  { id: "c", label: "초등반", grade: "초6", subject: "영어", textbookIds: [] },
]
const books = ["a", "b", "c", "expired", "future", "inactive"].map((id) => ({ id, label: id, status: id === "inactive" ? "inactive" : "active" }))
const detailA = { ...classes[0], textbookIds: ["a", "a", "c", "expired", "future", "inactive", "missing"], textbookUsage: { expired: { endDate: "2000-01-01" }, future: { startDate: "2099-01-01" } } }

test("grade options preserve multi-grade and missing-grade classes, with school and natural name order", () => {
  assert.deepEqual(registrationClassGradeOptions(classes), ["초6", "중1", "중2", UNASSIGNED_CLASS_GRADE])
  assert.deepEqual(registrationClassOptions(classes).map((item) => item.id), ["c", "a2", "a10", "b"])
  assert.deepEqual(registrationClassOptions(classes, "중1").map((item) => item.id), ["a2", "a10"])
  assert.deepEqual(registrationClassOptions(classes, "중2").map((item) => item.id), ["a2"])
  assert.deepEqual(registrationClassOptions(classes, UNASSIGNED_CLASS_GRADE).map((item) => item.id), ["b"])
  assert.deepEqual(registrationClassOptions(classes, "고3"), [])
  assert.deepEqual(registrationClassOptions([]), [])
  assert.equal(registrationClassOptions(classes, "중1 특강").length, 0)
  assert.equal(classes[0].id, "a10", "never mutate shared catalog order")
})

test("all current active textbooks default once each, with inclusive usage dates and no inferred books", () => {
  assert.deepEqual(registrationDefaultTextbookIds(detailA, books, "2026-10-07"), ["a", "c"])
  assert.deepEqual(registrationDefaultTextbookIds({ textbookIds: ["a", "b"], textbookUsage: { a: { startDate: "2026-10-07", endDate: "2026-10-07" } } }, books, "2026-10-07"), ["a", "b"])
  assert.deepEqual(registrationDefaultTextbookIds({ textbookIds: [] }, books), [])
  assert.deepEqual(applyRegistrationEnrollmentClassSelection({}, { classItem: detailA, availableTextbookIds: ["a", "c"] }).textbookIds, ["a", "c"])
})

async function mount(t, persistedRows = []) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://fixture.invalid" })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  for (const name of ["HTMLElement", "Element", "MutationObserver", "Event", "Node", "CustomEvent", "getComputedStyle"]) globalThis[name] = dom.window[name]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const pending = []; const warnings = []
  const Select = ({ value, options, onValueChange, ...props }) => h("select", { value, onChange: (event) => onValueChange(event.target.value), "aria-label": props["aria-label"], disabled: props.disabled }, options.map((option) => h("option", { key: option.value, value: option.value }, option.label)))
  const Textbooks = ({ values, onValuesChange, options }) => h("div", { "data-selected-books": values.join(",") }, options.map((book) => h("input", { key: book.id, type: "checkbox", "aria-label": book.label, checked: values.includes(book.id), onChange: () => onValuesChange(values.includes(book.id) ? values.filter((id) => id !== book.id) : [...values, book.id]) })))
  const overrides = new Map([
    ["./registration-select", { RegistrationSelect: Select }],
    ["./registration-textbook-select", { RegistrationTextbookSelect: Textbooks }],
    ["./ops-task-service", { loadOpsRegistrationClassDetails: (ids) => { const job = Promise.withResolvers(); pending.push({ ids, ...job }); return job.promise } }],
    ["./registration-track-service", { loadRegistrationEnrollmentStartObservation: async () => null, createRegistrationMutationRequestKey: () => "fixture", saveRegistrationEnrollmentDetails: () => { throw Error("Unexpected write") } }],
  ])
  const { RegistrationEnrollmentEditor } = loadNotificationComponent("src/features/tasks/registration-enrollment-editor.tsx", overrides)
  const { createRoot } = await import("react-dom/client")
  let root = createRoot(document.getElementById("root"))
  let props = { taskId: "fixture-task", viewerId: "fixture-viewer", track: { id: "fixture-track", subject: "영어", status: "enrollment_decided", enrollmentDetailRows: persistedRows }, enrollments: [], admissionBatches: [], classes, textbooks: books, permissions: { canManage: true }, onReload: async () => {}, onWarning: (value) => warnings.push(value) }
  const flush = async (fn) => { await act(async () => { await fn(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  const render = async (patch = {}) => { props = { ...props, ...patch }; await flush(() => root.render(h(RegistrationEnrollmentEditor, props))) }
  await render()
  t.after(async () => { await act(() => root.unmount()); dom.window.close() })
  const changeClass = (value) => flush(() => { const select = document.querySelector('select[aria-label="영어 수업 1 선택"]'); select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })) })
  return { pending, flush, render, changeClass, remount: async () => { await act(() => root.unmount()); root = createRoot(document.getElementById("root")); await render(); }, selected: () => document.querySelector("[data-selected-books]").dataset.selectedBooks, clickBook: (id) => flush(() => document.querySelector(`input[aria-label="${id}"]`).click()) }
}

test("late class response cannot overwrite a newer class; authoritative detail selects all current books", async (t) => {
  const ui = await mount(t)
  await ui.changeClass("a10")
  assert.equal(ui.selected(), "", "compact catalog must not provisionally choose only its first textbook")
  await ui.changeClass("b")
  await ui.flush(() => ui.pending[1].resolve({ b: { ...classes[2], textbookIds: ["b", "c"] } }))
  assert.equal(ui.selected(), "b,c")
  await ui.flush(() => ui.pending[0].resolve({ a10: detailA }))
  assert.equal(ui.selected(), "b,c")
  await ui.changeClass("a10")
  await ui.flush(() => ui.pending[2].resolve({ a10: detailA }))
  assert.equal(ui.selected(), "a,c")
})

test("manual subset and explicit clear survive later catalog updates and cached class return", async (t) => {
  const ui = await mount(t)
  await ui.changeClass("a10")
  await ui.flush(() => ui.pending[0].resolve({ a10: detailA }))
  await ui.clickBook("c")
  await ui.render({ textbooks: [...books] })
  assert.equal(ui.selected(), "a")
  await ui.clickBook("a")
  await ui.render({ textbooks: [...books] })
  assert.equal(ui.selected(), "")
  await ui.changeClass("b")
  await ui.flush(() => ui.pending[1].resolve({ b: classes[2] }))
  await ui.changeClass("a10")
  assert.equal(ui.selected(), "a,c", "an explicit new class selection may acquire defaults again")
})

for (const ids of [["c"], []]) test(`persisted ${JSON.stringify(ids)} remains untouched by class detail`, async (t) => {
  const ui = await mount(t, [{ clientKey: "saved-row", classId: "a10", textbookIds: ids }])
  await ui.flush(() => ui.pending[0].resolve({ a10: detailA }))
  assert.equal(ui.selected(), ids.join(","))
})

test("manual choice while detail is loading owns the draft", async (t) => {
  const ui = await mount(t)
  await ui.changeClass("a10")
  await ui.clickBook("a")
  await ui.flush(() => ui.pending[0].resolve({ a10: detailA }))
  assert.equal(ui.selected(), "a")
})


test("pending default ownership survives an unsaved editor remount", async (t) => {
  const ui = await mount(t)
  await ui.changeClass("a10")
  await ui.remount()
  await ui.flush(() => ui.pending[0].resolve({ a10: detailA }))
  assert.equal(ui.selected(), "", "released request cannot write the remounted editor")
  await ui.flush(() => ui.pending[1].resolve({ a10: detailA }))
  assert.equal(ui.selected(), "a,c")
  await ui.clickBook("c")
  await ui.remount()
  await ui.flush(() => ui.pending[2].resolve({ a10: detailA }))
  assert.equal(ui.selected(), "a", "manual ownership survives remount too")
})
