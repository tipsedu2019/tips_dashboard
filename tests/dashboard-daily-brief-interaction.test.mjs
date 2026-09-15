import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { JSDOM } from "jsdom"
import { act, createElement, forwardRef, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"

const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function load(url, mocks = new Map()) {
  const output = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: url.pathname,
  }).outputText
  const runtimeModule = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: url.pathname })(
    (name) => mocks.has(name) ? mocks.get(name)
      : name.startsWith(".") ? load(new URL(name, url), mocks)
      : name.startsWith("@/") ? load(new URL(`src/${name.slice(2)}.${existsSync(new URL(`src/${name.slice(2)}.tsx`, root)) ? "tsx" : "ts"}`, root), mocks)
      : require(name), runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function installDom(t) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/admin/dashboard" })
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] })
  }
  t.after(() => dom.window.close())
  const container = document.createElement("div")
  document.body.append(container)
  const reactRoot = createRoot(container)
  t.after(async () => { await act(async () => reactRoot.unmount()) })
  return { dom, container, reactRoot }
}

function fixture(localDate = "2026-09-12", count = 2) {
  return { localDate, generatedAt: `${localDate}T05:30:00Z`, counts: { levelTests: count, visitConsultations: 1, observationClasses: 0, openTasks: 99 }, upcoming: [] }
}

function auth(id = "user-a", role = "admin") {
  return { user: { id }, session: { user: { id }, access_token: `token-${id}` }, role, loading: false, canAccessDashboard: true }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test("daily brief keeps same-key data on refresh failure and isolates identity, role, late responses and KST midnight", async (t) => {
  const { dom, reactRoot } = installDom(t)
  const RealDate = Date
  let now = RealDate.parse("2026-09-12T14:59:00Z")
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  t.after(() => { globalThis.Date = RealDate })
  let authState = auth()
  let state
  const requests = []
  const { useDashboardDailyBrief } = load(new URL("src/features/dashboard/use-dashboard-daily-brief.ts", root), new Map([
    ["@/lib/supabase", { supabase: {} }],
    ["@/providers/auth-provider", { useAuth: () => authState }],
    ["./daily-brief-service.ts", { readDashboardDailyBrief: () => { const request = deferred(); requests.push(request); return request.promise } }],
  ]))
  const renders = []
  function Probe() {
    const value = useDashboardDailyBrief()
    useLayoutEffect(() => { state = value; renders.push(value) })
    return null
  }
  const render = () => act(async () => reactRoot.render(createElement(Probe)))
  await render()
  assert.equal(state.loading, true)
  assert.equal(state.brief, null)
  await act(async () => requests[0].reject(new Error("first failure")))
  assert.equal(state.loading, false)
  assert.match(state.error, /불러오지/)
  await act(async () => state.retry())
  const a = fixture()
  await act(async () => requests[1].resolve(a))
  assert.equal(state.brief, a)
  await act(async () => state.retry())
  assert.equal(state.brief, a)
  assert.equal(state.loading, true)
  await act(async () => requests[2].reject(new Error("refresh failure")))
  assert.equal(state.brief, a)
  assert.equal(state.brief.generatedAt, a.generatedAt)
  assert.match(state.error, /불러오지/)
  await act(async () => state.retry())
  const refreshed = fixture("2026-09-12", 4)
  await act(async () => requests[3].resolve(refreshed))
  assert.equal(state.brief, refreshed)
  assert.equal(state.error, null)

  await act(async () => state.retry())
  const oldRequest = requests[4]
  authState = auth("user-b")
  const boundary = renders.length
  await render()
  assert.ok(renders.slice(boundary).every((rendered) => rendered.brief === null))
  const b = fixture("2026-09-12", 7)
  await act(async () => requests[5].resolve(b))
  await act(async () => oldRequest.resolve(a))
  assert.equal(state.brief, b)
  authState = auth("user-b", "teacher")
  await render()
  assert.equal(state.brief, null)
  await act(async () => requests[6].resolve(b))
  assert.equal(state.brief, b)

  now = RealDate.parse("2026-09-12T15:00:00Z")
  await act(async () => dom.window.dispatchEvent(new dom.window.Event("focus")))
  assert.equal(state.localDate, "2026-09-13")
  assert.equal(state.brief, null)
  await act(async () => requests[7].resolve(fixture("2026-09-12")))
  assert.equal(state.brief, null)
  assert.match(state.error, /불러오지/)
  await act(async () => state.retry())
  await act(async () => requests[8].resolve(fixture("2026-09-13")))
  assert.equal(state.brief.localDate, "2026-09-13")
  await act(async () => state.retry())
  authState = { ...authState, session: null, user: null, canAccessDashboard: false }
  await render()
  assert.equal(state.brief, null)
  assert.equal(requests.length, 10)
  await act(async () => requests[9].resolve(b))
  assert.equal(state.brief, null)
  assert.match(state.error, /로그인/)
})

test("calendar boundary uses Seoul midnight independently of UTC date", () => {
  const { dashboardLocalDate, nextDashboardMidnight } = load(new URL("src/features/dashboard/daily-brief-date.ts", root))
  assert.equal(dashboardLocalDate(new Date("2026-09-12T14:59:59Z")), "2026-09-12")
  assert.equal(dashboardLocalDate(new Date("2026-09-12T15:00:00Z")), "2026-09-13")
  assert.equal(nextDashboardMidnight("2026-09-12"), Date.parse("2026-09-12T15:00:00Z"))
})

test("daily brief renders dated counts, real timestamps, full source links, empty/loading/error and refresh states", async (t) => {
  const { dom, container, reactRoot } = installDom(t)
  let retries = 0
  let state = { brief: null, localDate: "2026-09-12", loading: true, error: null, retry: () => { retries += 1 } }
  const Link = forwardRef(function Link({ href, children, ...props }, ref) { return createElement("a", { ...props, href, ref }, children) })
  const { DashboardDailyBrief } = load(new URL("src/features/dashboard/dashboard-daily-brief.tsx", root), new Map([
    ["next/link", Link],
    ["./use-dashboard-daily-brief", { useDashboardDailyBrief: () => state }],
  ]))
  const render = () => act(async () => reactRoot.render(createElement(DashboardDailyBrief)))
  await render()
  assert.equal(container.querySelector("h1"), null)
  assert.equal(container.querySelector("h2").textContent, "오늘의 일정")
  assert.match(container.textContent, /9월 12일 토요일/)
  assert.equal(container.querySelector("dl").getAttribute("aria-busy"), "true")
  assert.equal(container.querySelectorAll("[aria-label='오늘 일정을 불러오는 중'] [aria-hidden='true']").length, 3)
  assert.doesNotMatch(container.textContent, /예정된.*없습니다/)
  state = { ...state, loading: false, error: "일정을 불러오지 못했습니다." }
  await render()
  assert.match(container.textContent, /불러오지 못했습니다/)
  assert.equal(container.querySelectorAll("dd").length, 3)
  assert.ok([...container.querySelectorAll("dd")].every((item) => item.textContent.includes("미조회")))
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "다시 시도").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })))
  assert.equal(retries, 1)

  const empty = { ...fixture(), counts: { levelTests: 0, visitConsultations: 0, observationClasses: 0, openTasks: 99 } }
  state = { ...state, brief: empty, error: null }
  await render()
  assert.deepEqual([...container.querySelectorAll("dd")].map((item) => item.textContent), ["0건", "0건", "0건"])
  assert.match(container.textContent, /오늘 예정된 레벨테스트·방문상담·청강이 없습니다\./)
  assert.equal([...container.querySelectorAll("a")].filter((link) => link.textContent === "등록 일정 보기").length, 1)
  assert.match(container.textContent, /14:30 기준/)
  assert.doesNotMatch(container.textContent, /99/)

  const full = fixture("2026-09-12", 5)
  full.upcoming = Array.from({ length: 5 }, (_, index) => ({
    sourceKind: "level_test", sourceId: `source-${index}`, scheduledAt: `2026-09-12T0${index}:00:00Z`,
    title: `긴 학생 이름 ${index} 및 원본 제목 끝까지 표시`, subjectLabels: ["영어", "수학"], placeLabel: "본관 아주 긴 교실 이름",
    href: `/admin/registration?taskId=task-${index}&appointmentId=source-${index}`,
  }))
  state = { ...state, brief: full }
  await render()
  const links = [...container.querySelectorAll("ul[aria-label='오늘 일정'] a")]
  assert.equal(links.length, 5)
  assert.deepEqual(links.map((link) => link.getAttribute("href")), full.upcoming.map((item) => item.href))
  for (const [index, link] of links.entries()) {
    assert.ok(link.textContent.includes(full.upcoming[index].title))
    assert.ok(link.textContent.includes("영어 · 수학 · 본관 아주 긴 교실 이름"))
  }
  assert.equal(links[0].querySelector("time").textContent, "09:00") // Past scheduled rows remain present.
  assert.ok([...container.querySelectorAll("a")].some((link) => link.textContent === "등록 일정 보기"))
  state = { ...state, loading: true }
  await render()
  assert.equal(container.querySelectorAll("ul li").length, 5)
  assert.match(container.textContent, /새로고침하는 중/)
  state = { ...state, loading: false, error: "일정을 불러오지 못했습니다." }
  await render()
  assert.equal(container.querySelectorAll("ul li").length, 5)
  assert.match(container.textContent, /이전 조회 일정을 표시/)
  assert.match(container.textContent, /14:30 기준/)
  assert.deepEqual([...container.querySelectorAll("nav a")].map((link) => link.getAttribute("href")), ["/admin/registration", "/admin/academic-calendar", "/admin/statistics"])
  await act(async () => container.querySelector("button[aria-label='일정 새로고침']").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })))
  assert.equal(retries, 2)
})
