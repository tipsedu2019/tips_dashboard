import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { JSDOM } from "jsdom"
import { act, createContext, createElement, forwardRef, useContext, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"

const require = createRequire(import.meta.url)
const componentUrl = new URL("../src/components/data-table/data-table-pagination.tsx", import.meta.url)
const hookUrl = new URL("../src/hooks/use-data-table-page-size.ts", import.meta.url)

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function passthrough(tag) {
  return forwardRef(function Passthrough({ children, ...props }, ref) {
    return createElement(tag, { ...props, ref }, children)
  })
}

async function loadTypeScript(url, localModules = new Map()) {
  const source = await readFile(url, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText
  const runtimeModule = { exports: {} }
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    if (localModules.has(specifier)) return localModules.get(specifier)
    return require(specifier)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename: url.pathname })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test" })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.localStorage = dom.window.localStorage
  return dom
}

function createPagerUi() {
  return {
    Pagination: passthrough("nav"),
    PaginationContent: passthrough("ul"),
    PaginationItem: passthrough("li"),
  }
}

function createSelectUi() {
  const SelectContext = createContext(null)
  function Select({ children, value, onValueChange }) {
    return createElement(SelectContext.Provider, { value: { value, onValueChange } }, children)
  }
  const SelectContent = passthrough("div")
  const SelectGroup = passthrough("div")
  const SelectTrigger = passthrough("button")
  const SelectValue = passthrough("span")
  function SelectItem({ children, value }) {
    const select = useContext(SelectContext)
    return createElement("button", {
      type: "button",
      "data-page-size-value": value,
      "aria-pressed": select?.value === value,
      onClick: () => select?.onValueChange(value),
    }, children)
  }
  return { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue }
}

test("pager renders every current block number with semantic buttons and boundary states", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const events = []
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { DataTablePagination } = await loadTypeScript(componentUrl, new Map([
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/pagination", createPagerUi()],
    ["@/components/ui/select", {
      Select: passthrough("div"), SelectContent: passthrough("div"), SelectGroup: passthrough("div"),
      SelectItem: passthrough("button"), SelectTrigger: passthrough("button"), SelectValue: passthrough("span"),
    }],
    ["@/lib/numbered-pagination", numbered],
    ["lucide-react", {
      ChevronsLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, ChevronsRight: () => null,
    }],
  ]))
  function PagerHarness() {
    const [currentPage, setCurrentPage] = useState(10)
    return createElement(DataTablePagination, {
      page: currentPage, pageSize: 10, totalCount: 260,
      onPageChange: (nextPage) => { events.push(nextPage); setCurrentPage(nextPage) },
    })
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PagerHarness))
  })
  const labels = [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))
  assert.equal(container.querySelector("input"), null)
  assert.ok([...container.querySelectorAll("button")].every((button) => button.tagName === "BUTTON" && button.type === "button"))
  assert.equal(container.querySelector("button[aria-current=page]")?.textContent, "10")
  assert.ok(container.querySelector("[data-slot=pagination-number-group]"))
  assert.equal(container.querySelectorAll("[data-slot=pagination-number-group] button").length, 10)
  assert.equal(container.querySelector("button[aria-label='첫 페이지']")?.disabled, false)
  assert.equal(container.querySelector("button[aria-label='이전 페이지']")?.disabled, false)
  assert.equal(container.querySelector("button[aria-label='다음 페이지']")?.disabled, false)
  assert.equal(container.querySelector("button[aria-label='마지막 페이지']")?.disabled, false)
  assert.ok(labels.every(Boolean))
  await act(async () => container.querySelector("button[aria-label='다음 페이지']").click())
  await act(async () => container.querySelector("button[aria-label='이전 페이지']").click())
  await act(async () => container.querySelector("button[aria-label='첫 페이지']").click())
  await act(async () => container.querySelector("button[aria-label='마지막 페이지']").click())
  assert.deepEqual(events, [11, 10, 1, 26])
  await act(async () => root.unmount())
})

test("pager disables navigation at empty and known boundaries", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { DataTablePagination } = await loadTypeScript(componentUrl, new Map([
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/pagination", createPagerUi()],
    ["@/components/ui/select", { Select: passthrough("div"), SelectContent: passthrough("div"), SelectGroup: passthrough("div"), SelectItem: passthrough("button"), SelectTrigger: passthrough("button"), SelectValue: passthrough("span") }],
    ["@/lib/numbered-pagination", numbered],
    ["lucide-react", { ChevronsLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, ChevronsRight: () => null }],
  ]))
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => root.render(createElement(DataTablePagination, { page: 1, pageSize: 10, totalCount: 0, onPageChange: () => undefined })))
  assert.equal(container.querySelectorAll("button").length, 4)
  assert.ok([...container.querySelectorAll("button")].every((button) => button.disabled))
  await act(async () => root.unmount())
})

test("pager exposes only 10, 15, and 20 row choices with loading safety and a per-list navigation label", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const preferences = []
  const { DataTablePagination } = await loadTypeScript(componentUrl, new Map([
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/pagination", createPagerUi()],
    ["@/components/ui/select", createSelectUi()],
    ["@/lib/numbered-pagination", numbered],
    ["lucide-react", { ChevronsLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, ChevronsRight: () => null }],
  ]))
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => root.render(createElement(DataTablePagination, {
    page: 11, pageSize: 15, totalCount: 390, loading: true,
    ariaLabel: "학생 목록 페이지 탐색", onPageChange: () => assert.fail("loading navigation must be disabled"),
    onPageSizeChange: (preference) => preferences.push(preference),
  })))
  assert.equal(container.querySelector("nav")?.getAttribute("aria-label"), "학생 목록 페이지 탐색")
  assert.equal(container.querySelector("button[data-page-size-value='15']")?.getAttribute("aria-pressed"), "true")
  assert.deepEqual(
    [...container.querySelectorAll("button[data-page-size-value]")].map((button) => button.getAttribute("data-page-size-value")),
    ["10", "15", "20"],
  )
  assert.equal(container.querySelector("button[data-page-size-value='auto']"), null)
  assert.ok([...container.querySelectorAll("[data-slot=pagination-number-group] button")].every((button) => button.disabled))
  assert.deepEqual([...container.querySelectorAll("[data-slot=pagination-number-group] button")].map((button) => button.textContent), ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20"])
  await act(async () => container.querySelector("button[data-page-size-value='20']").click())
  assert.deepEqual(preferences, [20])
  await act(async () => root.unmount())
})

test("pager renders the partial final block without removing later page buttons", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { DataTablePagination } = await loadTypeScript(componentUrl, new Map([
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/pagination", createPagerUi()],
    ["@/components/ui/select", createSelectUi()],
    ["@/lib/numbered-pagination", numbered],
    ["lucide-react", { ChevronsLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, ChevronsRight: () => null }],
  ]))
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => root.render(createElement(DataTablePagination, { page: 26, pageSize: 10, totalCount: 260, onPageChange: () => undefined })))
  assert.deepEqual([...container.querySelectorAll("[data-slot=pagination-number-group] button")].map((button) => button.textContent), ["21", "22", "23", "24", "25", "26"])
  await act(async () => root.unmount())
})

test("page-size preference defaults to fixed 10 rows and rejects the removed automatic mode", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { useDataTablePageSize } = await loadTypeScript(hookUrl, new Map([["@/lib/numbered-pagination", numbered]]))
  localStorage.setItem("tips.data-table-page-size.v1", "not-json")
  const seen = []
  function Probe() {
    const state = useDataTablePageSize("students")
    useEffect(() => { seen.push(state) }, [state])
    return null
  }
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => root.render(createElement(Probe)))
  assert.equal(seen[0].ready, false)
  assert.equal(seen.at(-1).ready, true)
  assert.equal(seen.at(-1).pageSize, 10)
  assert.equal("mode" in seen.at(-1), false)
  assert.equal("setAutoPageSize" in seen.at(-1), false)
  await act(async () => seen.at(-1).setPreference(15))
  assert.equal(seen.at(-1).pageSize, 15)
  assert.deepEqual(JSON.parse(localStorage.getItem("tips.data-table-page-size.v1") ?? "{}"), {
    students: { mode: "manual", pageSize: 15 },
  })
  assert.throws(() => seen.at(-1).setPreference(5), /page size/i)
  assert.throws(() => seen.at(-1).setPreference("auto"), /page size/i)
  await act(async () => root.unmount())
})

test("stored fixed page-size preference is the only value restored", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { useDataTablePageSize } = await loadTypeScript(hookUrl, new Map([["@/lib/numbered-pagination", numbered]]))
  localStorage.setItem("tips.data-table-page-size.v1", JSON.stringify({ classes: { mode: "manual", pageSize: 15 } }))
  const seen = []
  function Probe() {
    const state = useDataTablePageSize("classes")
    useEffect(() => { seen.push(state) }, [state])
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Probe)))
  assert.equal(seen.at(-1).pageSize, 15)
  assert.equal("mode" in seen.at(-1), false)
  assert.equal("setAutoPageSize" in seen.at(-1), false)
  assert.deepEqual(JSON.parse(localStorage.getItem("tips.data-table-page-size.v1") ?? "{}"), {
    classes: { mode: "manual", pageSize: 15 },
  })
  await act(async () => root.unmount())
})

test("management migrates legacy manual size once without overriding shared preference", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { useDataTablePageSize } = await loadTypeScript(hookUrl, new Map([["@/lib/numbered-pagination", numbered]]))
  localStorage.setItem("tips:management-page-size:classes:v1", JSON.stringify({ version: 1, size: 20 }))
  let state
  function Probe() {
    const result = useDataTablePageSize("management:classes")
    useEffect(() => { state = result }, [result])
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Probe)))
  assert.equal(state.pageSize, 20)
  await act(async () => state.setPreference(15))
  await act(async () => root.unmount())
  const second = createRoot(document.createElement("div"))
  await act(async () => second.render(createElement(Probe)))
  assert.equal(state.pageSize, 15)
  assert.throws(() => state.setPreference("auto"), /page size/i)
  await act(async () => second.unmount())
})

test("page-size preference tolerates malformed and unavailable browser storage", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { useDataTablePageSize } = await loadTypeScript(hookUrl, new Map([["@/lib/numbered-pagination", numbered]]))
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem() { throw new Error("blocked") }, setItem() { throw new Error("blocked") } } })
  const seen = []
  function Probe() {
    const state = useDataTablePageSize("classes")
    useEffect(() => { seen.push(state) }, [state])
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Probe)))
  assert.equal(seen.at(-1).ready, true)
  let storageFailure
  await act(async () => {
    try {
      seen.at(-1).setPreference(10)
    } catch (error) {
      storageFailure = error
    }
  })
  assert.equal(storageFailure, undefined)
  await act(async () => root.unmount())
})

test("legacy preference remains recoverable when writing the shared migration fails", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const numbered = await import("../src/lib/numbered-pagination.ts")
  const { useDataTablePageSize } = await loadTypeScript(hookUrl, new Map([["@/lib/numbered-pagination", numbered]]))
  localStorage.setItem("tips:management-page-size:classes:v1", JSON.stringify({ version: 1, size: 15 }))
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key) => localStorage.getItem(key), removeItem: (key) => localStorage.removeItem(key),
    setItem() { throw new Error("quota exceeded") },
  } })
  let state
  function Probe() {
    const result = useDataTablePageSize("management:classes")
    useEffect(() => { state = result }, [result])
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Probe)))
  assert.equal(state.pageSize, 15)
  assert.notEqual(localStorage.getItem("tips:management-page-size:classes:v1"), null)
  await act(async () => root.unmount())
})
