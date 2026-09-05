import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { JSDOM } from "jsdom"
import { act, createElement, forwardRef, useState } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"

const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: url.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://example.test/admin/statistics",
  })
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  return dom
}

async function loadUiModules() {
  const utils = await loadTypeScript(new URL("src/lib/utils.ts", root))
  const common = new Map([["@/lib/utils", utils]])
  const [button, card, tabs] = await Promise.all([
    loadTypeScript(new URL("src/components/ui/button.tsx", root), common),
    loadTypeScript(new URL("src/components/ui/card.tsx", root), common),
    loadTypeScript(new URL("src/components/ui/tabs.tsx", root), common),
  ])
  return { button, card, tabs }
}

function summary(count) {
  return {
    uniqueRegisteredStudentCount: count,
    uniqueWaitlistStudentCount: 0,
    registeredEnrollmentCount: count,
    activeClassesCount: 1,
    weeklyHoursLabel: "1시간",
  }
}

function studentsData(count) {
  return {
    summary: summary(count),
    studentBreakdowns: { byGrade: [], bySchool: [] },
    classGroups: { byGrade: [], byTeacher: [], byClassroom: [] },
  }
}

function createSnapshotHook() {
  const calls = []
  const responses = new Map([
    ["overview", { data: { summary: summary(4) } }],
    ["students_classes:all:all", { loading: true, data: studentsData(99) }],
    ["students_classes:english:all", { loading: true, data: studentsData(98) }],
    ["students_classes:english:high", { error: "학생 통계를 불러오지 못했습니다.", data: studentsData(97) }],
    ["schedule_conflicts:90", { loading: true, data: { teacherConflicts: [{ id: "stale" }] } }],
    ["schedule_conflicts:180", { error: "일정 통계를 불러오지 못했습니다." }],
    ["textbooks:90", { data: { activeTitles: 9, progressSessions: {} } }],
    ["textbooks:30", { loading: true, data: { activeTitles: 96, progressSessions: {} } }],
  ])

  function useStatisticsSnapshot(input) {
    const [range, setRange] = useState(90)
    const key = input.tab === "students_classes"
      ? `${input.tab}:${input.subject}:${input.division}`
      : input.tab === "schedule_conflicts" || input.tab === "textbooks"
        ? `${input.tab}:${range}`
        : input.tab
    calls.push({ ...input, range })
    const response = responses.get(key) ?? { data: {} }
    return {
      snapshot: null,
      data: response.data ?? null,
      loading: response.loading ?? false,
      error: response.error ?? null,
      generatedAt: null,
      expiresAt: null,
      cacheStatus: null,
      range,
      setRange,
      refresh: () => undefined,
    }
  }

  return { calls, responses, useStatisticsSnapshot }
}

async function loadWorkspace(snapshotHook) {
  const { button, card, tabs } = await loadUiModules()
  const statisticsContract = await import("../src/features/dashboard/statistics-contract.ts")
  const conflict = {
    ConflictWarning({ metrics }) {
      const source = metrics.conflictSources.schedule
      return source.status === "error"
        ? createElement("div", { role: "alert" }, source.error)
        : createElement("div", { "data-conflict-status": source.status })
    },
  }
  const drilldown = { StatisticsDrilldown: () => null }
  return loadTypeScript(
    new URL("src/features/dashboard/statistics-workspace.tsx", root),
    new Map([
      ["@/components/ui/button", button],
      ["@/components/ui/card", card],
      ["@/components/ui/tabs", tabs],
      ["@/app/admin/dashboard/components/section-cards", conflict],
      ["@/features/dashboard/statistics-contract", statisticsContract],
      ["@/features/dashboard/statistics-drilldown", drilldown],
      ["@/features/dashboard/use-statistics-snapshot", { useStatisticsSnapshot: snapshotHook }],
    ]),
  )
}

function tab(container, name) {
  return [...container.querySelectorAll("[role=tab]")].find((item) => item.textContent === name)
}

async function press(target, key) {
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function click(target) {
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    target.focus()
    target.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, button: 0 }))
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }))
  })
}

async function focus(target) {
  await act(async () => target.focus())
}

function assertActivePanelLinkage(container, activeTab) {
  const panelId = activeTab.getAttribute("aria-controls")
  assert.ok(panelId)
  const panel = document.getElementById(panelId)
  assert.ok(panel)
  assert.equal(panel.getAttribute("role"), "tabpanel")
  assert.equal(panel.getAttribute("aria-labelledby"), activeTab.id)
}

test("dashboard renders the statistics shortcut to its statistics route", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const { button } = await loadUiModules()
  const Link = forwardRef(function Link({ href, children, ...props }, ref) {
    return createElement("a", { ...props, href, ref }, children)
  })
  const { DashboardDailyBrief } = await loadTypeScript(
    new URL("src/features/dashboard/dashboard-daily-brief.tsx", root),
    new Map([
      ["next/link", Link],
      ["@/components/ui/button", button],
      ["./use-dashboard-daily-brief", {
        useDashboardDailyBrief: () => ({ brief: null, error: null, retry: () => undefined }),
      }],
    ]),
  )
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  await act(async () => reactRoot.render(createElement(DashboardDailyBrief)))

  const shortcut = [...container.querySelectorAll("nav[aria-label='바로가기'] a")]
    .find((link) => link.textContent === "통계")
  assert.equal(shortcut?.getAttribute("href"), "/admin/statistics")

  await act(async () => reactRoot.unmount())
})

test("Radix tabs use manual keyboard activation, linked panels, and mount only the active request", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const snapshot = createSnapshotHook()
  const { StatisticsWorkspace } = await loadWorkspace(snapshot.useStatisticsSnapshot)
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  await act(async () => reactRoot.render(createElement(StatisticsWorkspace)))

  const overview = tab(container, "운영 요약")
  const students = tab(container, "학생·수업")
  const schedule = tab(container, "일정 충돌")
  const textbooks = tab(container, "교재")
  assert.equal(container.querySelectorAll("[role=tab]").length, 4)
  assert.equal(overview.getAttribute("aria-selected"), "true")
  await focus(overview)
  assert.equal(overview.tabIndex, 0)
  assert.ok([students, schedule, textbooks].every((item) => item.tabIndex === -1))
  assertActivePanelLinkage(container, overview)
  assert.deepEqual(new Set(snapshot.calls.map((call) => call.tab)), new Set(["overview"]))

  await press(overview, "ArrowRight")
  assert.equal(document.activeElement, students)
  assert.equal(students.tabIndex, 0)
  assert.equal(overview.tabIndex, -1)
  await press(students, "End")
  assert.equal(document.activeElement, textbooks)
  await press(textbooks, "Home")
  assert.equal(document.activeElement, overview)
  await press(overview, "ArrowLeft")
  assert.equal(document.activeElement, textbooks)
  assert.equal(overview.getAttribute("aria-selected"), "true")
  assert.deepEqual(new Set(snapshot.calls.map((call) => call.tab)), new Set(["overview"]))

  await press(textbooks, "Enter")
  assert.equal(textbooks.getAttribute("aria-selected"), "true")
  assertActivePanelLinkage(container, textbooks)
  assert.deepEqual(new Set(snapshot.calls.map((call) => call.tab)), new Set(["overview", "textbooks"]))

  await focus(schedule)
  await press(schedule, " ")
  assert.equal(schedule.getAttribute("aria-selected"), "true")
  assertActivePanelLinkage(container, schedule)
  assert.deepEqual(new Set(snapshot.calls.map((call) => call.tab)), new Set(["overview", "textbooks", "schedule_conflicts"]))

  await click(students)
  assert.equal(students.getAttribute("aria-selected"), "true")
  assertActivePanelLinkage(container, students)
  assert.deepEqual(
    new Set(snapshot.calls.map((call) => call.tab)),
    new Set(["overview", "textbooks", "schedule_conflicts", "students_classes"]),
  )

  await act(async () => reactRoot.unmount())
})

test("student filters remain selected and focused through initial loading, refresh, and error", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const snapshot = createSnapshotHook()
  const { StatisticsWorkspace } = await loadWorkspace(snapshot.useStatisticsSnapshot)
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  await act(async () => reactRoot.render(createElement(StatisticsWorkspace)))
  await click(tab(container, "학생·수업"))

  const subjectControls = container.querySelector("[role=group][aria-label='과목']")
  const divisionControls = container.querySelector("[role=group][aria-label='부서']")
  assert.ok(subjectControls)
  assert.ok(divisionControls)
  assert.equal(subjectControls.querySelector("button[aria-pressed=true]")?.textContent, "전체")
  assert.match(container.querySelector("[role=status]")?.textContent ?? "", /통계를 불러오는 중/)
  assert.equal(container.querySelector("[role=region][aria-label='통계 결과']")?.getAttribute("aria-busy"), "true")
  assert.doesNotMatch(container.textContent, /99명/)

  snapshot.responses.set("students_classes:all:all", { data: studentsData(11) })
  await act(async () => reactRoot.render(createElement(StatisticsWorkspace)))
  assert.match(container.textContent, /11명/)
  assert.equal(container.querySelector("[role=region][aria-label='통계 결과']")?.getAttribute("aria-busy"), "false")

  const english = [...subjectControls.querySelectorAll("button")].find((button) => button.textContent === "영어")
  await focus(english)
  await click(english)
  assert.equal(document.activeElement, english)
  assert.equal(english.getAttribute("aria-pressed"), "true")
  assert.match(container.querySelector("[role=status]")?.textContent ?? "", /통계를 불러오는 중/)
  assert.equal(container.querySelector("[role=region][aria-label='통계 결과']")?.getAttribute("aria-busy"), "true")
  assert.doesNotMatch(container.textContent, /(?:11|98)명/)

  snapshot.responses.set("students_classes:english:all", { data: studentsData(7) })
  await act(async () => reactRoot.render(createElement(StatisticsWorkspace)))
  assert.equal(document.activeElement, english)
  assert.match(container.textContent, /7명/)

  const high = [...divisionControls.querySelectorAll("button")].find((button) => button.textContent === "고등부")
  await focus(high)
  await click(high)
  assert.equal(document.activeElement, high)
  assert.equal(high.getAttribute("aria-pressed"), "true")
  assert.equal(english.getAttribute("aria-pressed"), "true")
  assert.match(container.querySelector("[role=alert]")?.textContent ?? "", /학생 통계를 불러오지 못했습니다/)
  assert.equal(container.querySelector("[role=region][aria-label='통계 결과']")?.getAttribute("aria-busy"), "false")
  assert.doesNotMatch(container.textContent, /(?:7|97)명/)

  await click(tab(container, "운영 요약"))
  await click(tab(container, "학생·수업"))
  assert.equal(
    container.querySelector("[role=group][aria-label='과목'] button[aria-pressed=true]")?.textContent,
    "전체",
  )

  await act(async () => reactRoot.unmount())
})

test("schedule and textbook ranges remain operable and focused while their result state changes", async (t) => {
  const dom = installDom()
  t.after(() => dom.window.close())
  const snapshot = createSnapshotHook()
  const { StatisticsWorkspace } = await loadWorkspace(snapshot.useStatisticsSnapshot)
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  await act(async () => reactRoot.render(createElement(StatisticsWorkspace)))

  await click(tab(container, "일정 충돌"))
  const scheduleControls = container.querySelector("[role=group][aria-label='일정 기간']")
  assert.ok(scheduleControls)
  assert.equal(scheduleControls.querySelector("button[aria-pressed=true]")?.textContent, "앞으로 90일")
  assert.equal(container.querySelector("[data-conflict-status]"), null)
  const schedule180 = [...scheduleControls.querySelectorAll("button")]
    .find((button) => button.textContent === "앞으로 180일")
  await focus(schedule180)
  await click(schedule180)
  assert.equal(document.activeElement, schedule180)
  assert.equal(schedule180.getAttribute("aria-pressed"), "true")
  assert.match(container.querySelector("[role=alert]")?.textContent ?? "", /일정 통계를 불러오지 못했습니다/)

  await click(tab(container, "교재"))
  const textbookControls = container.querySelector("[role=group][aria-label='교재 기간']")
  assert.ok(textbookControls)
  const textbook30 = [...textbookControls.querySelectorAll("button")]
    .find((button) => button.textContent === "30일")
  await focus(textbook30)
  await click(textbook30)
  assert.equal(document.activeElement, textbook30)
  assert.equal(textbook30.getAttribute("aria-pressed"), "true")
  assert.match(container.querySelector("[role=status]")?.textContent ?? "", /통계를 불러오는 중/)
  assert.doesNotMatch(container.textContent, /(?:9|96)건/)

  snapshot.responses.set("textbooks:30", {
    error: "교재 통계를 불러오지 못했습니다.",
    data: { activeTitles: 95, progressSessions: {} },
  })
  await act(async () => reactRoot.render(createElement(StatisticsWorkspace)))
  assert.equal(document.activeElement, textbook30)
  assert.equal(textbook30.getAttribute("aria-pressed"), "true")
  assert.match(container.querySelector("[role=alert]")?.textContent ?? "", /교재 통계를 불러오지 못했습니다/)
  assert.doesNotMatch(container.textContent, /95건/)

  await act(async () => reactRoot.unmount())
})
