import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"
import * as eventUtils from "../src/features/operations/academic-event-utils.js"
import { buildSevenDayRangeKeys } from "../src/features/operations/operations-read-service.js"

const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
async function load(path, mocks) {
  const source = await readFile(new URL(path, root), "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText
  const runtimeModule = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: path })(
    (key) => mocks.has(key) ? mocks.get(key) : require(key), runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function box(tag) { return function TestBox({ children, ...props }) { return createElement(tag, props, children) } }

test("accepted calendar range survives failure, ignores reverse responses, and retries the failed range after seven-day recovery", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/academic-calendar" })
  for (const key of ["window", "document", "HTMLElement", "Event", "Node"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] })
  }
  const loads = []
  const service = { load: (request) => { const task = deferred(); loads.push({ request, ...task }); return task.promise }, loadCatalogs: async () => ({ academicSchools: [] }) }
  const searchParams = new URLSearchParams("date=2026-09-15")
  let calendarProps
  const mocks = new Map([
    ["@/lib/supabase", { supabase: { rpc: () => ({ limit: () => ({ abortSignal: () => ({ retry: async () => ({ data: [], error: null }) }) }) }) } }],
    ["@/providers/auth-provider", { useAuth: () => ({ user: { id: "fixture-admin" }, role: "admin", loading: false, canManageAll: true }) }],
    ["@/lib/error-message", { getErrorMessage: (error) => error.message }],
    ["@/lib/numbered-page-controller", { createNumberedPageController: () => ({ dispose() {} }) }],
    ["@/lib/numbered-pagination", { normalizePage: () => 1 }],
    ["@/hooks/use-data-table-page-size", { useDataTablePageSize: () => ({ ready: true, pageSize: 10 }) }],
    ["./operations-read-service.js", { createOperationsReadService: () => service, invalidateOperationsCatalogCache() {}, buildSevenDayRangeKeys }],
    ["next/navigation", { useSearchParams: () => searchParams }],
    ["sonner", { toast: { error() {}, success() {}, info() {} } }],
    ["@/components/ui/alert", { Alert: ({ children }) => createElement("div", { role: "alert" }, children), AlertDescription: box("div") }],
    ["@/components/ui/badge", { Badge: box("span") }],
    ["@/components/ui/button", { Button: ({ children, type, disabled, onClick }) => createElement("button", { type, disabled, onClick }, children) }],
    ["./academic-event-utils.js", eventUtils],
    ["@/app/admin/calendar/components/calendar", { Calendar: (props) => { calendarProps = props; return createElement("div", { "data-testid": "calendar" }, props.events.map(e => e.title).join(",")) } }],
  ])
  const hook = await load("src/features/operations/use-operations-workspace-data.ts", mocks)
  mocks.set("./use-operations-workspace-data", hook)
  const { AcademicCalendarWorkspace } = await load("src/features/operations/academic-calendar-workspace.tsx", mocks)
  const container = document.getElementById("root"), renderer = createRoot(container)
  const latest = () => loads.at(-1)
  const succeed = async (task, title) => act(async () => task.resolve({ ok: true, range: task.request, rows: title ? [{ id: title, title, startsAt: `${task.request.dateFrom}T12:00:00` }] : [] }))
  const move = async (month) => act(async () => calendarProps.navigation.onDateChange(new Date(2026, month - 1, 15, 12)))
  const click = async (name) => { const button = [...container.querySelectorAll("button")].find(e => e.textContent === name); assert.ok(button, name); await act(async () => button.click()) }
  const month = () => calendarProps.navigation.displayedDate.getMonth() + 1
  try {
    await act(async () => renderer.render(createElement(AcademicCalendarWorkspace)))
    await succeed(latest(), "September")
    assert.equal(month(), 9)
    await move(10)
    const october = latest()
    assert.equal(month(), 9)
    assert.deepEqual(calendarProps.events.map(e => e.title), ["September"])
    assert.match(container.querySelector('[role="status"]').textContent, /2026-09-27 ~ 2026-10-31/)
    await act(async () => october.reject(new Error("internal failure must stay private")))
    assert.equal(month(), 9)
    assert.match(container.querySelector('[role="alert"]').textContent, /2026-09-27 ~ 2026-10-31/)
    assert.doesNotMatch(container.textContent, /internal failure/)
    await click("다시 불러오기")
    assert.deepEqual(latest().request, october.request)
    await succeed(latest(), "October")
    assert.equal(month(), 10)
    await move(11); const november = latest()
    await move(12); const december = latest()
    await succeed(december, "December")
    await succeed(november, "STALE November")
    assert.equal(month(), 12)
    assert.deepEqual(calendarProps.events.map(e => e.title), ["December"])
    await move(1); const denseMonth = latest()
    await act(async () => denseMonth.resolve({ ok: false, code: "visible_range_too_dense", range: denseMonth.request, rows: [], observedRowsAtLeast: 2001, suggestedDays: 7 }))
    assert.equal(month(), 12)
    await click("한 주 보기"); const week = latest()
    assert.deepEqual(buildSevenDayRangeKeys(week.request.dateFrom).at(-1), week.request.dateTo)
    await succeed(week, "Week event")
    assert.equal(container.querySelectorAll('[data-testid="operations-seven-day-agenda"] article').length, 7)
    assert.match(container.textContent, /Week event/)
    await click("월간 보기"); const back = latest()
    assert.deepEqual(back.request, denseMonth.request)
    assert.equal(container.querySelectorAll('[data-testid="operations-seven-day-agenda"] article').length, 7)
    await act(async () => back.reject(new Error("month failed again")))
    assert.match(container.textContent, /Week event/)
    await click("다시 불러오기")
    assert.deepEqual(latest().request, back.request)
    await succeed(latest(), "January")
    assert.equal(month(), 1)
    assert.equal(container.querySelector('[data-testid="operations-seven-day-agenda"]'), null)
    assert.deepEqual(calendarProps.events.map(e => e.title), ["January"])
  } finally { await act(async () => renderer.unmount()); dom.window.close() }
})

test("calendar form sessions retain only their own usable opener and invalidate pending detail on navigation", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/academic-calendar" })
  for (const key of ["window", "document", "HTMLElement", "Event", "Node"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] })
  }
  let main, sidebar, form, requestedDate
  const september = new Date(2026, 8, 15, 12), october = new Date(2026, 9, 15, 12)
  const detailLoads = []
  const event = { id: "event-1", title: "Synthetic event", date: september }
  const mocks = new Map([
    ["@/components/ui/alert", { Alert: box("div"), AlertDescription: box("div") }],
    ["@/components/ui/button", { Button: box("button") }],
    ["@/components/ui/sheet", { Sheet: () => null, SheetContent: box("div"), SheetHeader: box("div"), SheetTitle: box("h2") }],
    ["@/features/operations/academic-event-utils.js", eventUtils],
    ["./calendar-main", { CalendarMain: (props) => { main = props; return createElement("div", null,
      createElement("button", { "data-action": "detail", onClick: () => props.onEventClick(event) }, "detail"),
      createElement("button", { "data-action": "new", onClick: () => props.onEmptySlotClick(september) }, "new"),
      createElement("button", { "data-action": "range", onClick: () => props.onRangeSelect({ start: september, end: october }) }, "range")) } }],
    ["./calendar-sidebar", { CalendarSidebar: (props) => { sidebar = props; return null } }],
    ["./event-form", { EventForm: (props) => { form = props; return null } }],
  ])
  const { Calendar } = await load("src/app/admin/calendar/components/calendar.tsx", mocks)
  const container = document.getElementById("root"), renderer = createRoot(container)
  const onDateChange = (date) => { requestedDate = date }
  const onLoadEventDetail = () => { const task = deferred(); detailLoads.push(task); return task.promise }
  const render = async (displayedDate, pendingDate = displayedDate) => act(async () => renderer.render(createElement(Calendar, {
    events: [event], eventDates: [{ date: september, count: 1 }], initialDate: september,
    navigation: { displayedDate, requestedDate: pendingDate, onDateChange }, onLoadEventDetail,
  })))
  try {
    await render(september)
    const button = container.querySelector("button")
    Object.defineProperty(button, "getClientRects", { configurable: true, value: () => [{ width: 100, height: 36 }] })
    button.focus()
    await act(async () => button.click())
    await act(async () => main.navigation.onDateChange(october))
    assert.equal(requestedDate, october)
    await render(september, october)
    assert.equal(sidebar.selectedDate.getTime(), september.getTime())
    await act(async () => detailLoads[0].resolve(event))
    assert.equal(form.open, false, "a detail started before navigation must not reopen")
    await render(october)
    assert.equal(main.selectedDate.getTime(), october.getTime())
    assert.equal(sidebar.selectedDate.getTime(), october.getTime())
    // CalendarMain's Today button calls onDateSelect; the parent owns navigation.
    await act(async () => main.onDateSelect(september))
    assert.equal(requestedDate, september)
    await render(october)
    button.focus()
    await act(async () => button.click())
    await act(async () => detailLoads[1].resolve(event))
    assert.equal(form.open, true)
    button.blur()
    const close = new Event("closeAutoFocus", { cancelable: true })
    form.onCloseAutoFocus(close)
    assert.equal(close.defaultPrevented, true)
    assert.equal(document.activeElement, button)
    await act(async () => form.onOpenChange(false))

    const press = async (action) => {
      const opener = container.querySelector(`[data-action="${action}"]`)
      Object.defineProperty(opener, "getClientRects", { configurable: true, value: () => [{ width: 100, height: 36 }] })
      opener.focus()
      await act(async () => opener.click())
      return opener
    }
    const focusSink = document.createElement("button")
    document.body.append(focusSink)
    const dismiss = async () => {
      await act(async () => form.onOpenChange(false))
      focusSink.focus()
      const closeEvent = new Event("closeAutoFocus", { cancelable: true })
      form.onCloseAutoFocus(closeEvent)
      return closeEvent
    }
    for (const failure of [true, false]) {
      for (const action of ["new", "range"]) {
        await press("detail")
        const detail = detailLoads.at(-1)
        if (failure) await act(async () => detail.reject(new Error("synthetic detail failure")))
        const opener = await press(action)
        assert.equal(form.open, true)
        assert.equal(form.event, null)
        if (!failure) await act(async () => detail.resolve(event))
        assert.equal(form.event, null, "a late detail must not replace the new form")
        await dismiss()
        assert.equal(document.activeElement === opener, true, `${failure ? "failed" : "pending"} detail then ${action} must restore its own opener`)
      }
    }

    const detailOpener = await press("detail")
    await act(async () => detailLoads.at(-1).reject(new Error("synthetic detail failure")))
    const retry = [...container.querySelectorAll("button")].find(item => item.textContent === "상세 다시 불러오기")
    retry.focus()
    await act(async () => retry.click())
    await act(async () => detailLoads.at(-1).resolve(event))
    assert.equal(form.open, true)
    await dismiss()
    assert.equal(document.activeElement === detailOpener, true, "retry success retains the original detail opener")

    for (const guard of ["hidden", "css-hidden", "no-layout", "inert", "disabled", "aria-disabled", "route", "detached"]) {
      const opener = await press("new")
      const openerParent = opener.parentNode
      if (guard === "hidden") opener.hidden = true
      if (guard === "css-hidden") opener.style.visibility = "hidden"
      if (guard === "no-layout") Object.defineProperty(opener, "getClientRects", { configurable: true, value: () => [] })
      if (guard === "inert") opener.setAttribute("inert", "")
      if (guard === "disabled") opener.disabled = true
      if (guard === "aria-disabled") opener.setAttribute("aria-disabled", "true")
      if (guard === "route") dom.window.history.pushState({}, "", "/admin/academic-calendar?date=2026-11-01")
      if (guard === "detached") opener.remove()
      const closeEvent = await dismiss()
      assert.equal(closeEvent.defaultPrevented, false, `${guard} opener must leave default restoration intact`)
      assert.equal(document.activeElement === opener, false)
      if (guard === "hidden") opener.hidden = false
      if (guard === "css-hidden") opener.style.visibility = ""
      if (guard === "inert") opener.removeAttribute("inert")
      if (guard === "disabled") opener.disabled = false
      if (guard === "aria-disabled") opener.removeAttribute("aria-disabled")
      if (guard === "route") dom.window.history.replaceState({}, "", "/admin/academic-calendar")
      if (guard === "detached") openerParent.append(opener)
    }
  } finally { await act(async () => renderer.unmount()); dom.window.close() }
})
