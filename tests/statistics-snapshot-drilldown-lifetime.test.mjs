import assert from "node:assert/strict"
import test from "node:test"

import { JSDOM } from "jsdom"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"

import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCHOOL_KEY = "synthetic-school"
const SCHOOL_LABEL = "합성 학교"
const GRADE_KEY = "synthetic-grade"
const GRADE_LABEL = "합성 고1"
const GENERATED_AT = "2026-09-15T00:00:00.000Z"

function student(id, name = id) { return { id, name } }

function aggregate(count, { nested = false, generatedAt = GENERATED_AT } = {}) {
  const school = {
    key: SCHOOL_KEY, label: SCHOOL_LABEL, studentCount: count, enrollmentCount: count,
    ...(nested ? { children: [{ key: GRADE_KEY, label: GRADE_LABEL, studentCount: count }] } : {}),
  }
  const group = (key, label) => ({ key, label, classCount: 2, studentCount: 2, weeklyHoursLabel: "2시간" })
  return {
    ok: true,
    contractVersion: "dashboard-statistics-v1",
    tab: "students_classes",
    generatedAt,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    cacheStatus: "refreshed",
    data: {
      summary: {
        uniqueRegisteredStudentCount: count, uniqueWaitlistStudentCount: 0,
        registeredEnrollmentCount: count, activeClassesCount: nested ? 2 : 1,
        weeklyHoursLabel: "2시간",
      },
      studentBreakdowns: {
        byGrade: nested ? [{
          key: GRADE_KEY, label: GRADE_LABEL, studentCount: count, enrollmentCount: count,
          children: [{ key: SCHOOL_KEY, label: SCHOOL_LABEL, studentCount: count }],
        }] : [],
        bySchool: nested ? [school, ...Array.from({ length: 8 }, (_, index) => ({
          key: `synthetic-extra-school-${index}`, label: `합성 추가 학교 ${index}`,
          studentCount: 0, enrollmentCount: 0,
        }))] : [school],
      },
      classGroups: nested ? {
        byGrade: [group(GRADE_KEY, GRADE_LABEL)],
        byTeacher: [group("synthetic-teacher", "합성 선생님")],
        byClassroom: [group("synthetic-classroom", "합성 강의실")],
      } : { byGrade: [], byTeacher: [], byClassroom: [] },
    },
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function button(container, text) {
  const found = [...container.querySelectorAll("button")].find(node => node.textContent.trim() === text)
  assert.ok(found, `Missing real button: ${text}`)
  return found
}

function labeledButton(container, label) {
  const found = [...container.querySelectorAll("button[aria-label]")].find(node => node.getAttribute("aria-label") === label)
  assert.ok(found, `Missing real button: ${label}`)
  return found
}

function schoolTrigger(container, count) {
  return labeledButton(container, `${SCHOOL_LABEL} ${count}명 · 학생 명단 보기`)
}

function panelFor(trigger) {
  const panel = document.getElementById(trigger.getAttribute("aria-controls"))
  assert.ok(panel, "Real drilldown trigger controls its panel")
  return panel
}

function nativeDetailsFor(trigger) {
  const details = trigger.parentElement.parentElement.querySelector("details")
  assert.ok(details, "Real distribution row has native nested details")
  return details
}

async function click(target) {
  assert.ok(target?.isConnected, "Real UI action target is connected")
  await act(async () => { target.click(); await Promise.resolve() })
}

function assertFirstPage(request, expected = {}) {
  assert.equal(request.input.cursorName, null, "A new accepted generation starts from page one")
  assert.equal(request.input.cursorId, null, "An old generation cursor must never be reused")
  for (const [key, value] of Object.entries(expected)) assert.equal(request.input[key], value)
}

async function mountWorkspace(t) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://synthetic.invalid/admin/statistics?tab=students_classes",
    pretendToBeVisual: true,
  })
  const descriptors = new Map()
  const setGlobal = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "NodeFilter", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
    setGlobal(key, key === "window" ? dom.window : key === "document" ? dom.window.document : dom.window[key])
  }
  setGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window))
  setGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window))
  setGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })

  const aggregates = []
  const drilldowns = []
  const unexpected = []
  // No native fetch is retained or called. The POST boundary is the existing
  // read-only drilldown transport; no API route, DB, auth provider or mutation runs.
  setGlobal("fetch", (url, options = {}) => {
    try {
      assert.equal(typeof url, "string")
      assert.ok(url.startsWith("/api/dashboard/statistics"), "Only relative synthetic statistics reads are allowed")
      const parsed = new URL(url, "https://synthetic.invalid")
      assert.equal(options.headers?.Authorization, "Bearer synthetic-inert-placeholder")
      assert.ok(options.signal instanceof AbortSignal)
      let queue
      let input
      if (parsed.pathname === "/api/dashboard/statistics") {
        assert.equal(options.method, "GET")
        assert.deepEqual([...parsed.searchParams.keys()].sort(), parsed.searchParams.has("refresh")
          ? ["division", "refresh", "subject", "tab"] : ["division", "subject", "tab"])
        assert.equal(parsed.searchParams.get("tab"), "students_classes")
        assert.equal(parsed.searchParams.get("subject"), "all")
        assert.equal(parsed.searchParams.get("division"), "all")
        if (parsed.searchParams.has("refresh")) assert.equal(parsed.searchParams.get("refresh"), "1")
        queue = aggregates
      } else {
        assert.equal(parsed.pathname, "/api/dashboard/statistics/drilldown")
        assert.equal(parsed.search, "")
        assert.equal(options.method, "POST")
        input = JSON.parse(options.body)
        assert.ok(["student-roster", "class-group", "class-roster"].includes(input.kind))
        queue = drilldowns
      }
      return new Promise(resolve => queue.push({ input, url, signal: options.signal, resolve }))
    } catch (error) {
      unexpected.push(error.message)
      throw error
    }
  })

  // All local imports below remain real, including the snapshot hook, memory
  // cache/fetch service, drilldowns and shared UI. These are the only overrides.
  const { StatisticsWorkspace } = loadNotificationComponent("src/features/dashboard/statistics-workspace.tsx", new Map([
    ["@/providers/auth-provider", { useAuth: () => ({
      user: { id: "synthetic-statistics-viewer" }, role: "admin",
      session: { access_token: "synthetic-inert-placeholder" },
    }) }],
    ["next/navigation", { useSearchParams: () => new URLSearchParams(window.location.search) }],
    ["@/app/admin/dashboard/components/section-cards", { ConflictWarning: () => null }],
  ]))
  const container = document.getElementById("root")
  const reactRoot = createRoot(container)
  t.after(async () => {
    try {
      await act(async () => reactRoot.unmount())
      assert.deepEqual(unexpected, [], "All reads stayed inside the exact in-memory transport boundary")
    } finally {
      dom.window.close()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    }
  })
  await act(async () => { reactRoot.render(createElement(StatisticsWorkspace)); await Promise.resolve() })
  assert.equal(aggregates.length, 1, "The actual hook requested only the active tab")
  assert.equal(drilldowns.length, 0, "Roster reads remain action-only")

  return {
    container, aggregates, drilldowns,
    async acceptAggregate(index, body, status = 200) {
      assert.ok(aggregates[index], `Missing aggregate request ${index}`)
      await act(async () => { aggregates[index].resolve(json(body, status)); await Promise.resolve() })
    },
    async acceptPage(index, rows, { nextCursor = null, hasMore = false } = {}) {
      assert.ok(drilldowns[index], `Missing drilldown request ${index}`)
      await act(async () => {
        drilldowns[index].resolve(json({ ok: true, data: { rows, nextCursor, hasMore } }))
        await Promise.resolve()
      })
    },
    async refresh() {
      const before = aggregates.length
      await click(button(container, "새로고침"))
      assert.equal(aggregates.length, before + 1)
      assert.equal(new URL(aggregates.at(-1).url, "https://synthetic.invalid").searchParams.get("refresh"), "1", "Real forced-refresh service path ran")
    },
    async openAndAccept(trigger, expected, rows) {
      const before = drilldowns.length
      await click(trigger)
      assert.equal(drilldowns.length, before + 1, "A single UI expansion requested one page")
      assertFirstPage(drilldowns[before], expected)
      await this.acceptPage(before, rows)
      return panelFor(trigger)
    },
  }
}

test("accepted changed-count snapshot discards a completed roster and the next expansion reads page one", async t => {
  const h = await mountWorkspace(t)
  await h.acceptAggregate(0, aggregate(1))
  const oldTrigger = schoolTrigger(h.container, 1)
  await h.openAndAccept(oldTrigger, { kind: "student-roster", axis: "school", key: SCHOOL_KEY }, [student("synthetic-old", "합성 이전 학생")])
  assert.match(panelFor(oldTrigger).textContent, /총 1명 · 모두 표시했습니다/)
  await click(oldTrigger)
  assert.equal(oldTrigger.getAttribute("aria-expanded"), "false")

  await h.refresh()
  assert.match(h.container.textContent, /합성 이전 학생/, "Pending refresh retains the accepted roster")
  await h.acceptAggregate(1, aggregate(2))
  const current = schoolTrigger(h.container, 2)
  assert.equal(current.getAttribute("aria-expanded"), "false")
  assert.doesNotMatch(h.container.textContent, /합성 이전 학생|총 1명 · 모두 표시했습니다/)
  assert.equal(h.drilldowns.length, 1, "Accepted aggregate does not eagerly fetch rosters")
  await h.openAndAccept(current, { kind: "student-roster", axis: "school", key: SCHOOL_KEY }, [
    student("synthetic-new-a", "합성 새 학생 A"), student("synthetic-new-b", "합성 새 학생 B"),
  ])
  assert.match(panelFor(current).textContent, /합성 새 학생 A.*합성 새 학생 B.*총 2명 · 모두 표시했습니다/s)
})

test("same count and identical generatedAt still invalidate old membership when a fresh snapshot is accepted", async t => {
  const h = await mountWorkspace(t)
  const identicalAggregate = aggregate(1)
  await h.acceptAggregate(0, identicalAggregate)
  await h.openAndAccept(schoolTrigger(h.container, 1), { kind: "student-roster", key: SCHOOL_KEY }, [student("synthetic-replaced", "합성 교체 전 학생")])
  const updatedText = [...h.container.querySelectorAll("span")].find(node => node.textContent.startsWith("마지막 갱신 ")).textContent
  await h.refresh()
  // JSON, including the timestamp and counts, is identical. The real fetch/cache
  // service nevertheless accepts a new response object; timestamp is not identity.
  await h.acceptAggregate(1, identicalAggregate)
  assert.equal([...h.container.querySelectorAll("span")].find(node => node.textContent.startsWith("마지막 갱신 ")).textContent, updatedText)
  assert.doesNotMatch(h.container.textContent, /합성 교체 전 학생/)
  const current = schoolTrigger(h.container, 1)
  assert.equal(current.getAttribute("aria-expanded"), "false")
  await h.openAndAccept(current, { kind: "student-roster", key: SCHOOL_KEY }, [student("synthetic-replacement", "합성 교체 후 학생")])
  assert.match(panelFor(current).textContent, /합성 교체 후 학생/)
  assert.doesNotMatch(panelFor(current).textContent, /합성 교체 전 학생/)
})

test("pending and failed refresh preserve 30-row pagination, accepted rows and nested expansion without refetch on reopen", async t => {
  const h = await mountWorkspace(t)
  await h.acceptAggregate(0, aggregate(61, { nested: true }))
  const trigger = schoolTrigger(h.container, 61)
  const page = start => Array.from({ length: 30 }, (_, index) => student(`synthetic-${start + index}`, `합성 학생 ${String(start + index).padStart(2, "0")}`))
  const first = page(1)
  const firstCursor = { sortValue: first.at(-1).name, id: first.at(-1).id }
  await click(trigger)
  assertFirstPage(h.drilldowns[0], { axis: "school" })
  await h.acceptPage(0, first, { nextCursor: firstCursor, hasMore: true })
  assert.equal(panelFor(trigger).querySelectorAll("[role=listitem]").length, 30)
  const details = nativeDetailsFor(trigger)
  await click(details.querySelector("summary"))
  assert.equal(details.open, true)
  const nested = labeledButton(details, "학생 명단 보기")
  await h.openAndAccept(nested, { axis: "school_grade", key: GRADE_KEY, parentKey: SCHOOL_KEY }, [student("synthetic-nested", "합성 중첩 학생")])

  await h.refresh()
  assert.equal(schoolTrigger(h.container, 61), trigger, "Pending refresh kept the actual component instance")
  assert.equal(details.open, true)
  assert.equal(nested.getAttribute("aria-expanded"), "true")
  assert.match(panelFor(nested).textContent, /합성 중첩 학생/)
  await click(button(panelFor(trigger), "다음 30명 더 보기"))
  assert.equal(h.drilldowns[2].input.cursorName, firstCursor.sortValue)
  assert.equal(h.drilldowns[2].input.cursorId, firstCursor.id, "Pending refresh preserved the accepted page cursor")
  const second = page(31)
  const secondCursor = { sortValue: second.at(-1).name, id: second.at(-1).id }
  await h.acceptPage(2, second, { nextCursor: secondCursor, hasMore: true })
  assert.equal(panelFor(trigger).querySelectorAll("[role=listitem]").length, 60)
  await click(trigger)
  await click(trigger)
  await click(nested)
  await click(nested)
  assert.equal(h.drilldowns.length, 3, "Normal reopen uses accepted pages at both levels")

  await h.acceptAggregate(1, { error: "synthetic_refresh_failure" }, 503)
  assert.match(h.container.querySelector("[role=alert]").textContent, /갱신 실패.*이전 통계/)
  assert.equal(schoolTrigger(h.container, 61), trigger)
  assert.equal(details.open, true)
  assert.equal(nested.getAttribute("aria-expanded"), "true")
  assert.match(panelFor(nested).textContent, /합성 중첩 학생/)
  assert.equal(panelFor(trigger).querySelectorAll("[role=listitem]").length, 60)
  await click(button(panelFor(trigger), "다음 30명 더 보기"))
  assert.equal(h.drilldowns[3].input.cursorName, secondCursor.sortValue)
  assert.equal(h.drilldowns[3].input.cursorId, secondCursor.id, "Failed refresh preserved the latest accepted page cursor")
  await h.acceptPage(3, [student("synthetic-61", "합성 학생 61")])
  assert.equal(panelFor(trigger).querySelectorAll("[role=listitem]").length, 61)
  assert.match(panelFor(trigger).textContent, /총 61명 · 모두 표시했습니다/)
  assert.equal(h.aggregates.length, 2)
})

test("successful refresh preserves all-schools, native details and class axis while renewing every nested roster", async t => {
  const h = await mountWorkspace(t)
  const snapshot = aggregate(2, { nested: true })
  await h.acceptAggregate(0, snapshot)
  await click(button(h.container, "모두 보기 (9개 학교)"))
  assert.ok(labeledButton(h.container, "합성 추가 학교 7 0명 · 학생 명단 보기"))
  const schoolDetails = nativeDetailsFor(schoolTrigger(h.container, 2))
  const gradeTrigger = () => labeledButton(h.container, `${GRADE_LABEL} 2명 · 학생 명단 보기`)
  const gradeDetails = nativeDetailsFor(gradeTrigger())
  await click(schoolDetails.querySelector("summary"))
  await click(gradeDetails.querySelector("summary"))
  const groupControls = h.container.querySelector('[role="group"][aria-label="그룹"]')
  const teacher = button(groupControls, "선생님")
  await click(teacher)
  const studentPaths = [
    { trigger: () => schoolTrigger(h.container, 2), expected: { kind: "student-roster", axis: "school", key: SCHOOL_KEY, parentKey: "" } },
    { trigger: gradeTrigger, expected: { kind: "student-roster", axis: "grade", key: GRADE_KEY, parentKey: "" } },
    { trigger: () => labeledButton(schoolDetails, "학생 명단 보기"), expected: { kind: "student-roster", axis: "school_grade", key: GRADE_KEY, parentKey: SCHOOL_KEY } },
    { trigger: () => labeledButton(gradeDetails, "학생 명단 보기"), expected: { kind: "student-roster", axis: "grade_school", key: SCHOOL_KEY, parentKey: GRADE_KEY } },
  ]
  const classes = [{ id: "synthetic-class-a", title: "합성 수업 A" }, { id: "synthetic-class-b", title: "합성 수업 B" }]
  const groupTrigger = () => labeledButton(h.container, "합성 선생님 2개 · 수업 목록 보기")
  for (const generation of ["이전", "새"]) {
    for (const path of studentPaths) {
      const panel = await h.openAndAccept(path.trigger(), path.expected, [student(`synthetic-${generation}-${path.expected.axis}`, `합성 ${generation} ${path.expected.axis} 학생`)])
      assert.match(panel.textContent, new RegExp(`합성 ${generation} ${path.expected.axis} 학생`))
    }
    const groupPanel = await h.openAndAccept(groupTrigger(), { kind: "class-group", axis: "teacher", key: "synthetic-teacher" }, classes)
    for (const classRow of classes) {
      const row = [...groupPanel.querySelector('[role="list"]').children].find(node => node.textContent.includes(classRow.title))
      assert.ok(row)
      const classRoster = labeledButton(row, "학생 명단 보기")
      const panel = await h.openAndAccept(classRoster, { kind: "class-roster", classId: classRow.id }, [student(`synthetic-${generation}-${classRow.id}`, `합성 ${generation} ${classRow.title} 학생`)])
      assert.match(panel.textContent, new RegExp(`합성 ${generation} ${classRow.title} 학생`))
    }
    if (generation === "새") break
    const readsBeforeRefresh = h.drilldowns.length
    await h.refresh()
    assert.equal(teacher.getAttribute("aria-pressed"), "true")
    assert.equal(schoolDetails.open, true)
    assert.equal(gradeDetails.open, true)
    await h.acceptAggregate(1, snapshot)
    assert.equal(button(h.container, "상위 8개 보기").getAttribute("aria-expanded"), "true")
    assert.ok(labeledButton(h.container, "합성 추가 학교 7 0명 · 학생 명단 보기"), "Show-all state survived acceptance")
    assert.equal(nativeDetailsFor(schoolTrigger(h.container, 2)), schoolDetails)
    assert.equal(nativeDetailsFor(gradeTrigger()), gradeDetails)
    assert.equal(schoolDetails.open, true)
    assert.equal(gradeDetails.open, true)
    assert.equal(button(h.container.querySelector('[role="group"][aria-label="그룹"]'), "선생님"), teacher)
    assert.equal(teacher.getAttribute("aria-pressed"), "true", "Class axis survived acceptance")
    for (const path of studentPaths) assert.equal(path.trigger().getAttribute("aria-expanded"), "false")
    assert.equal(groupTrigger().getAttribute("aria-expanded"), "false")
    assert.doesNotMatch(h.container.textContent, /합성 이전 .*학생/)
    assert.equal(h.drilldowns.length, readsBeforeRefresh, "Renewing accepted generation stays action-only")
  }
  assert.equal(h.drilldowns.length, 14, "Four student axes, one class group and both class rosters each read once per accepted generation")
  assert.doesNotMatch(h.container.textContent, /합성 이전 .*학생/)
})

test("acceptance aborts the previous in-flight detail and its late response cannot pollute the new roster or cursor", async t => {
  const h = await mountWorkspace(t)
  await h.acceptAggregate(0, aggregate(1))
  const oldTrigger = schoolTrigger(h.container, 1)
  await click(oldTrigger)
  const obsolete = h.drilldowns[0]
  assertFirstPage(obsolete, { kind: "student-roster", key: SCHOOL_KEY })
  await h.refresh()
  assert.equal(obsolete.signal.aborted, false, "Pending aggregate alone must not cancel accepted-generation detail")
  assert.equal(oldTrigger.getAttribute("aria-expanded"), "true")
  await h.acceptAggregate(1, aggregate(1))
  assert.equal(obsolete.signal.aborted, true, "Accepted replacement aborts the obsolete detail request")
  assert.equal(oldTrigger.isConnected, false)
  const current = schoolTrigger(h.container, 1)
  await h.openAndAccept(current, { kind: "student-roster", key: SCHOOL_KEY }, [student("synthetic-current", "합성 현재 학생")])
  // Deliberately ignore the abort at the transport boundary. The real component
  // must reject a response that arrives after cancellation, even if it has a cursor.
  await h.acceptPage(0, [student("synthetic-obsolete", "합성 뒤늦은 이전 학생")], {
    nextCursor: { sortValue: "합성 뒤늦은 이전 학생", id: "synthetic-obsolete" }, hasMore: true,
  })
  assert.match(panelFor(current).textContent, /합성 현재 학생.*총 1명 · 모두 표시했습니다/s)
  assert.doesNotMatch(h.container.textContent, /합성 뒤늦은 이전 학생|다음 30명 더 보기/)
  await click(current)
  await click(current)
  assert.equal(h.drilldowns.length, 2, "A late old page did not reopen pagination or trigger another read")
})
