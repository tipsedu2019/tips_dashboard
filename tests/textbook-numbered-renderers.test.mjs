import assert from "node:assert/strict"
import test from "node:test"

import {
  parseTextbookNavigation,
  serializeTextbookNavigation,
} from "../src/features/textbooks/textbook-navigation.ts"
import {
  button, closingDetailEnvelope, closingMovementRow, closingRow, id, inventoryHistoryRow, masterRow, masterSummary, purchaseRow, purchaseSummary, saleHistoryRow, saleHistorySummary, saleRow, saleSummary, setup,
} from "./helpers/textbook-numbered-harness.mjs"

const preparedRowIds = (surface) => [...document.querySelectorAll(`[data-prepared-surface="${surface}"]`)]
  .map((node) => node.getAttribute("data-prepared-row-id"))

const masterFilters = {
  search: "grammar",
  subject: "english",
  schoolLevel: "middle",
  gradeLevel: "m2",
  subSubject: "문법",
  quality: "attention",
  inventory: "shortage",
}

test("textbook navigation restores a valid direct primary page and preserves unrelated query keys", () => {
  const params = new URLSearchParams({
    textbookTab: "master",
    textbookPage: "11",
    textbookPageSize: "10",
    textbookFilters: JSON.stringify(masterFilters),
    unrelated: "keep",
  })

  const parsed = parseTextbookNavigation(params)
  assert.deepEqual(parsed.primary, { page: 11, pageSize: 10, filters: masterFilters })
  assert.equal(parsed.tab, "master")

  const serialized = serializeTextbookNavigation(params, parsed)
  assert.equal(serialized.get("unrelated"), "keep")
  assert.equal(serialized.get("textbookPage"), "11")
  assert.deepEqual(JSON.parse(serialized.get("textbookFilters")), masterFilters)
})

test("textbook navigation rejects invalid primary, secondary and detail state without leaking private UI state", () => {
  const params = new URLSearchParams({
    textbookTab: "unknown",
    textbookPage: "0",
    textbookPageSize: "30",
    textbookFilters: JSON.stringify({ ...masterFilters, surprise: true }),
    textbookHistoryPage: "-2",
    textbookHistoryPageSize: "5",
    textbookHistoryFilters: JSON.stringify({ search: "not-literal-empty", year: "2026", month: "all", classId: "all" }),
    textbookMovementPage: "NaN",
    textbookMovementPageSize: "20",
    textbookMovementSearch: "  확인  ",
    textbookDetailKind: "sale",
    textbookDetail: "not-a-uuid",
    selectedIds: "private",
    memo: "private",
  })

  const parsed = parseTextbookNavigation(params)
  assert.equal(parsed.tab, "master")
  assert.equal(parsed.primary.page, 1)
  assert.equal(parsed.primary.pageSize, 10)
  assert.deepEqual(parsed.primary.filters, {
    search: "",
    subject: "all",
    schoolLevel: "all",
    gradeLevel: "all",
    subSubject: "all",
    quality: "all",
    inventory: "all",
  })
  assert.deepEqual(parsed.history, {
    page: 1,
    pageSize: 10,
    filters: { search: "", year: "all", month: "all", classId: "all" },
  })
  assert.deepEqual(parsed.movements, { page: 1, pageSize: 20, search: "확인" })
  assert.equal(parsed.detail, null)

  const serialized = serializeTextbookNavigation(params, parsed)
  assert.equal(serialized.has("selectedIds"), false)
  assert.equal(serialized.has("memo"), false)
})

test("textbook navigation validates fixed filter values and normalizes only bounded dynamic sub-subject text", () => {
  const invalid = new URLSearchParams({
    textbookTab: "master",
    textbookPage: "01",
    textbookPageSize: "015",
    textbookFilters: JSON.stringify({ search: "", subject: "history", schoolLevel: "college", gradeLevel: "99", subSubject: "문법", quality: "all", inventory: "all" }),
    textbookHistoryFilters: JSON.stringify({ search: "", year: "20x6", month: "2026-13", classId: "not-a-uuid" }),
  })
  const parsedInvalid = parseTextbookNavigation(invalid)
  assert.equal(parsedInvalid.primary.page, 1)
  assert.equal(parsedInvalid.primary.pageSize, 10)
  assert.deepEqual(parsedInvalid.primary.filters, { search: "", subject: "all", schoolLevel: "all", gradeLevel: "all", subSubject: "all", quality: "all", inventory: "all" })
  assert.deepEqual(parsedInvalid.history.filters, { search: "", year: "all", month: "all", classId: "all" })

  const valid = new URLSearchParams({
    textbookTab: "master",
    textbookPage: "2",
    textbookPageSize: "15",
    textbookFilters: JSON.stringify({ search: "", subject: "english", schoolLevel: "middle", gradeLevel: "m2", subSubject: "  문법  ", quality: "attention", inventory: "shortage" }),
  })
  assert.deepEqual(parseTextbookNavigation(valid).primary.filters, {
    search: "", subject: "english", schoolLevel: "middle", gradeLevel: "m2", subSubject: "문법", quality: "attention", inventory: "shortage",
  })
})

test("mounted textbook workspace starts the strict direct master page independently of its action-only legacy loader", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=11&textbookPageSize=10&unrelated=keep" })
  const pages = h.requests.filter((request) => request.name === "list_textbook_master_page_v1")
  assert.equal(pages.length, 1)
  assert.equal(pages[0].args.p_page, 11)
  assert.equal(pages[0].args.p_page_size, 10)
  assert.deepEqual(pages[0].args.p_filters, {
    search: "",
    subject: "all",
    schoolLevel: "all",
    gradeLevel: "all",
    subSubject: "all",
    quality: "all",
    inventory: "all",
  })
  assert.ok(h.requests.some((request) => request.table), "intermediate action-only loader remains until Task5d")
})

test("direct and external URL restoration use the requested size on the first actual page RPC", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=3&textbookPageSize=15" })
  const direct = h.requests.filter((request) => request.name === "list_textbook_master_page_v1")
  assert.equal(direct.length, 1)
  assert.deepEqual({ page: direct[0].args.p_page, size: direct[0].args.p_page_size }, { page: 3, size: 15 })

  await h.navigate("?textbookTab=master&textbookPage=2&textbookPageSize=20")
  const restored = h.requests.filter((request) => request.name === "list_textbook_master_page_v1")
  assert.equal(restored.length, 2)
  assert.deepEqual({ page: restored[1].args.p_page, size: restored[1].args.p_page_size }, { page: 2, size: 20 })
})

test("mounted master renderer keeps strict server order on desktop and mobile and renders the 11-20 pager block", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=10&textbookPageSize=10" })
  const page = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 10)
  const summary = h.requests.find((request) => request.name === "get_textbook_master_summary_v1")
  assert.ok(page)
  assert.ok(summary)
  await h.resolve(page, { rows: Array.from({ length: 10 }, (_, index) => masterRow(100 + index)), page: 10, pageSize: 10, totalCount: 200 })
  await h.resolve(summary, masterSummary(200))
  await h.settleLegacy()
  await h.act(() => document.querySelector('[aria-label="교재 목록 페이지 탐색"] [aria-label="다음 페이지"]').click())
  const nextPage = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 11)
  assert.ok(nextPage)
  const rows = Array.from({ length: 10 }, (_, index) => masterRow(110 + index))
  await h.resolve(nextPage, { rows, page: 11, pageSize: 10, totalCount: 200 })
  await h.settleLegacy()

  const expectedIds = rows.map((row) => row.id)
  const mobileIds = [...document.querySelectorAll('[data-testid^="textbook-master-mobile-card-"]')]
    .map((node) => node.getAttribute("data-testid").replace("textbook-master-mobile-card-", ""))
  const desktopIds = [...document.querySelectorAll('[data-testid^="textbook-master-desktop-row-"]')]
    .map((node) => node.getAttribute("data-testid").replace("textbook-master-desktop-row-", ""))
  assert.deepEqual(mobileIds, expectedIds)
  assert.deepEqual(desktopIds, expectedIds)
  assert.deepEqual(preparedRowIds("master-mobile"), expectedIds)
  assert.deepEqual(preparedRowIds("master-desktop"), expectedIds)
  assert.deepEqual(
    [...document.querySelectorAll('[data-slot="pagination-number-group"] button')].map((node) => Number(node.textContent)),
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  )
  assert.equal(document.querySelector(`[data-testid="textbook-master-mobile-card-${id(110)}"]`)?.textContent.includes("교재 110"), true)
})

test("master selection is pruned when the accepted page changes", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const firstRows = Array.from({ length: 10 }, (_, index) => masterRow(index + 1))
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), { rows: firstRows, page: 1, pageSize: 10, totalCount: 11 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(11))
  await h.settleLegacy()
  const firstCard = document.querySelector(`[data-testid="textbook-master-mobile-card-${id(1)}"]`)
  await h.act(() => firstCard.querySelector('[aria-label$="선택"]').click())
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]'))
  await h.act(() => document.querySelector('[aria-label="교재 목록 페이지 탐색"] [aria-label="2 페이지"]').click())
  const second = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 2)
  assert.ok(second, JSON.stringify(h.requests.filter((request) => request.name).map((request) => [request.name, request.args?.p_page])))
  await h.resolve(second, { rows: [masterRow(11)], page: 2, pageSize: 10, totalCount: 11 })
  assert.equal(document.querySelector('[aria-label="선택한 교재 일괄 작업"]'), null)
})

test("external query navigation aborts obsolete page work and restores the requested page", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const obsolete = h.requests.find((request) => request.name === "list_textbook_master_page_v1")
  await h.navigate("?textbookTab=master&textbookPage=11&textbookPageSize=10&unrelated=keep")
  const restored = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 11)
  assert.ok(restored)
  await h.resolve(obsolete, { rows: Array.from({ length: 10 }, (_, index) => masterRow(index + 1)), page: 1, pageSize: 10, totalCount: 200 })
  const rows = Array.from({ length: 10 }, (_, index) => masterRow(110 + index))
  await h.resolve(restored, { rows, page: 11, pageSize: 10, totalCount: 200 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(200))
  await h.settleLegacy()
  assert.ok(document.querySelector(`[data-testid="textbook-master-desktop-row-${id(110)}"]`))
  assert.equal(new URLSearchParams(window.location.search).get("unrelated"), "keep")
})

test("auth boundary issues no reads before identity and remounts on a same-user role change", async (t) => {
  const h = await setup(t, { auth: { user: null, role: null, loading: true, isAdmin: false, canManageAll: false } })
  assert.equal(h.requests.length, 0)
  await h.auth({ user: { id: id(804), email: "admin@test.invalid" }, role: "admin", loading: false, isAdmin: true, canManageAll: true })
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_master_page_v1").length, 1)
  await h.auth({ role: "staff", isAdmin: false, isStaff: true, canManageAll: false })
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_master_page_v1").length, 2)
})

test("a strict page API failure stays visible and retryable without fabricated totals", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const page = h.requests.find((request) => request.name === "list_textbook_master_page_v1")
  await h.reject(page, { code: "PGRST202", message: "missing" })
  await h.settleLegacy()
  assert.ok(document.querySelector('[role="alert"]'))
  assert.equal(document.querySelector('[aria-label="교재 목록 페이지 탐색"]').parentElement.parentElement.textContent.includes("건수 확인 중"), true)
  await h.act(() => button("다시 시도").click())
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_master_page_v1").length, 2)
})

test("a summary failure stays explicit and retryable without rendering current-page totals as authoritative", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), {
    rows: [masterRow(91, { totalQuantity: 7 })], page: 1, pageSize: 10, totalCount: 1,
  })
  await h.reject(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), { code: "PGRST202", message: "missing summary" })
  await h.settleLegacy()

  assert.equal(document.body.textContent.includes("집계 정보를 불러오지 못했습니다"), true)
  assert.equal(document.body.textContent.includes("집계 확인 필요"), true)
  await h.act(() => document.querySelector('[aria-label="교재 집계 다시 시도"]').click())
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_master_summary_v1").length, 2)
})

test("mounted inventory waits for the real default location and renders prepared count and independent history pages", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  assert.equal(h.requests.some((request) => request.name === "list_textbook_inventory_page_v1"), false)
  const locationId = id(900)
  const locations = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  assert.ok(locations)
  await h.resolve(locations, {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const page = h.requests.find((request) => request.name === "list_textbook_inventory_page_v1")
  const history = h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1")
  const summary = h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1")
  assert.ok(page)
  assert.ok(history)
  assert.ok(summary)
  assert.equal(page.args.p_filters.locationId, locationId)
  const source = masterRow(301, {
    locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: {}, totalQuantity: 3, studentQuantity: 3,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }], stockValue: 30000,
  })
  const secondSource = masterRow(303, source)
  secondSource.id = id(303)
  secondSource.title = "교재 303"
  secondSource.name = "교재 303"
  const inventoryRows = [secondSource, source].map((row) => ({ source: row, id: row.id, title: row.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }))
  const historyRows = [inventoryHistoryRow(1), inventoryHistoryRow(0)]
  await h.resolve(page, { rows: inventoryRows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(history, { rows: historyRows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(summary, masterSummary(2, {
    totalQuantity: 3, studentQuantity: 3, stockValue: 30000, locationQuantities: { [locationId]: 3 },
    subjectTotals: [{ subject: "english", totalCount: 2, totalQuantity: 3, salePriceTotal: 0, stockValue: 30000 }],
    locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }],
    auditCounts: { all: 2, recommended: 2, pending: 0, done: 0 },
  }))
  await h.settleLegacy()
  assert.equal(document.body.textContent.includes("교재 301"), true)
  assert.deepEqual(preparedRowIds("inventory-mobile"), inventoryRows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("inventory-desktop"), inventoryRows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("inventory-history-mobile"), historyRows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("inventory-history-desktop"), historyRows.map((row) => row.id))
  assert.equal(document.querySelector('[aria-label="재고 실사 페이지 탐색"]') !== null, true)
  assert.equal(document.querySelector('[aria-label="재고 이력 페이지 탐색"]') !== null, true)
})

test("inventory keeps prepared reads paused when the default-location reference fails and exposes retry", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const location = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  assert.ok(location)
  await h.reject(location, { code: "PGRST202", message: "missing location rpc" })
  await h.settleLegacy()

  assert.equal(h.requests.some((request) => request.name === "list_textbook_inventory_page_v1"), false)
  assert.ok(document.querySelector('[role="alert"]'))
  await h.act(() => document.querySelector('[aria-label="재고 위치 다시 시도"]').click())
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_location_reference_page_v1").length, 2)
  assert.equal(h.requests.some((request) => request.name === "list_textbook_inventory_page_v1"), false)
})

test("inventory keeps prepared reads paused when the location catalog has no real default", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const location = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  await h.resolve(location, {
    rows: [], page: 1, pageSize: 20, totalCount: 0,
    defaultLocation: null,
  })
  await h.settleLegacy()

  assert.equal(h.requests.some((request) => request.name === "list_textbook_inventory_page_v1"), false)
  assert.equal(h.requests.some((request) => request.name === "list_textbook_inventory_history_page_v1"), false)
  assert.equal(document.body.textContent.includes("기본 재고 위치"), true)
  assert.ok(document.querySelector('[aria-label="재고 위치 다시 시도"]'))
})

test("inventory page changes clear current-page selection while retaining page-one drafts", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const source = masterRow(311, {
    locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: {}, totalQuantity: 3, studentQuantity: 3,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }], stockValue: 30000,
  })
  const firstRows = Array.from({ length: 10 }, (_, index) => {
    const rowSource = index === 0 ? source : masterRow(312 + index)
    return { source: rowSource, id: rowSource.id, title: rowSource.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: index === 0 ? 3 : 0, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  })
  const firstPage = h.requests.find((request) => request.name === "list_textbook_inventory_page_v1")
  await h.resolve(firstPage, { rows: firstRows, page: 1, pageSize: 10, totalCount: 11 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(11, {
    totalQuantity: 3, studentQuantity: 3, stockValue: 30000, locationQuantities: { [locationId]: 3 },
    subjectTotals: [{ subject: "english", totalCount: 11, totalQuantity: 3, salePriceTotal: 0, stockValue: 30000 }],
    auditCounts: { all: 11, recommended: 11, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }],
  }))
  await h.settleLegacy()

  const checkbox = document.querySelector('[aria-label$="본관 재고 선택"]')
  const input = document.querySelector('[aria-label$="본관 실사 수량"]')
  assert.ok(checkbox)
  assert.ok(input)
  await h.act(() => checkbox.click())
  await h.act(() => {
    const reactProps = input[Object.keys(input).find((key) => key.startsWith("__reactProps$"))]
    reactProps.onChange({ target: { value: "7" } })
  })
  assert.ok(document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]'))
  assert.equal(input.value, "7")

  await h.act(() => button("2").click())
  assert.equal(document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]'), null)
  const secondPage = h.requests.find((request) => request.name === "list_textbook_inventory_page_v1" && request.args.p_page === 2)
  assert.ok(secondPage)
  const secondSource = masterRow(312, {
    locationQuantities: { [locationId]: 2 }, studentLocationQuantities: { [locationId]: 2 }, teacherLocationQuantities: {}, totalQuantity: 2, studentQuantity: 2,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 2 }], stockValue: 20000,
  })
  await h.resolve(secondPage, { rows: [{ source: secondSource, id: secondSource.id, title: secondSource.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 2, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }], page: 2, pageSize: 10, totalCount: 11 })

  await h.act(() => button("1").click())
  const firstPageReload = h.requests.findLast((request) => request.name === "list_textbook_inventory_page_v1" && request.args.p_page === 1)
  if (firstPageReload !== firstPage) await h.resolve(firstPageReload, { rows: firstRows, page: 1, pageSize: 10, totalCount: 11 })
  assert.equal(document.querySelector(`[aria-label="교재 311 본관 실사 수량"]`)?.value, "7")
})

for (const [tab, pageRpc, summaryRpc, mode, pagerLabel] of [
  ["requests", "list_textbook_purchase_page_v1", "get_textbook_purchase_summary_v1", "request", "교재 요청 페이지 탐색"],
  ["purchase", "list_textbook_purchase_page_v1", "get_textbook_purchase_summary_v1", "order", "주문 입고 페이지 탐색"],
]) {
  test(`mounted ${tab} renderer consumes its prepared purchase page and summary`, async (t) => {
    const h = await setup(t, { search: `?textbookTab=${tab}&textbookPage=1&textbookPageSize=10` })
    const page = h.requests.find((request) => request.name === pageRpc)
    const summary = h.requests.find((request) => request.name === summaryRpc)
    assert.ok(page)
    assert.ok(summary)
    assert.equal(page.args.p_filters.mode, mode)
    const rows = [purchaseRow(mode, 1), purchaseRow(mode, 0)]
    await h.resolve(page, { rows, page: 1, pageSize: 10, totalCount: 2 })
    await h.resolve(summary, purchaseSummary(mode, 2))
    await h.settleLegacy()
    assert.equal(document.body.textContent.includes("교재 101"), true)
    assert.deepEqual(preparedRowIds(`${tab}-mobile`), rows.map((row) => row.id))
    assert.deepEqual(preparedRowIds(`${tab}-desktop`), rows.map((row) => row.id))
    assert.ok(document.querySelector(`[aria-label="${pagerLabel}"]`))
    if (tab === "purchase") {
      await h.act(() => button("공급처별 주문 전달 열기").click())
      const handoff = h.requests.find((request) => request.name === "get_textbook_purchase_handoff_context_v1")
      assert.ok(handoff)
      assert.equal(handoff.args.p_kind, "order")
      assert.deepEqual(handoff.args.p_filters, page.args.p_filters)
    }
  })
}

test("purchase aggregate badges use only authoritative summary quantities", async (t) => {
  const h = await setup(t, { search: "?textbookTab=purchase&textbookPage=1&textbookPageSize=10" })
  const page = h.requests.find((request) => request.name === "list_textbook_purchase_page_v1")
  const summaryRequest = h.requests.find((request) => request.name === "get_textbook_purchase_summary_v1")
  await h.resolve(page, { rows: [purchaseRow("order")], page: 1, pageSize: 10, totalCount: 1 })
  const quantities = { requested: 99, ordered: 20, received: 10, student: { requested: 50, ordered: 10, received: 5 }, teacher: { requested: 49, ordered: 10, received: 5 } }
  const summary = purchaseSummary("order")
  await h.resolve(summaryRequest, {
    ...summary,
    quantities,
    groups: summary.groups.map((group) => ({ ...group, totalCount: 31, rawLineCount: 62, quantities })),
    totalCount: 31,
    rawLineCount: 62,
    requestCounts: { all: 77, unregistered: 23, orderable: 54 },
    orderCounts: { all: 66, waiting: 55, partial: 44, returnable: 33, returned: 22 },
    boardScopeCounts: { active: 71, recent: 72, all: 73 },
  })
  await h.settleLegacy()

  assert.equal(document.body.textContent.includes("요청 99"), true)
  assert.equal(document.body.textContent.includes("주문 20"), true)
  assert.equal(document.body.textContent.includes("입고 10"), true)
  assert.equal(document.querySelector('[aria-label^="주문 필요 그룹"]').getAttribute('aria-label').includes('31건'), true)
  assert.equal(document.querySelector('[aria-label^="주문 필요 그룹"]').getAttribute('aria-label').includes('요청 99'), true)
  await h.act(() => document.querySelector('[aria-label="주문·입고 보기 필터"]').click())
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('전체') && node.textContent.includes('73')), true)
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('부분입고') && node.textContent.includes('44')), true)
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('미등록 요청') && node.textContent.includes('23')), true)
})

test("master and inventory controls use only their matching authoritative summary facets and options", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(41, {
    inventoryCounts: { all: 41, shortage: 37, surplus: 3, unused: 1, negative: 9 },
    subSubjectOptions: ["서버 세부과목"],
    auditCounts: { all: 41, recommended: 31, pending: 7, done: 3 },
  }))
  await h.settleLegacy()

  await h.act(() => document.querySelector('[aria-label="교재 상태 필터 열기"]').click())
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('부족') && node.textContent.includes('37')), true)
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('대기') && node.textContent.includes('7')), true)
  await h.act(() => document.querySelector('[aria-label="교재 세부과목 필터"]').click())
  assert.equal(document.body.textContent.includes("서버 세부과목"), true)
})

test("filtered-zero sales history and process retain their recovery controls", async (t) => {
  const params = new URLSearchParams({
    textbookTab: "sales",
    textbookPage: "1",
    textbookPageSize: "10",
    textbookFilters: JSON.stringify({ search: "", status: "returned" }),
    textbookHistoryPage: "1",
    textbookHistoryPageSize: "10",
    textbookHistoryFilters: JSON.stringify({ search: "", year: "2025", month: "all", classId: "all" }),
  })
  const h = await setup(t, { search: `?${params}` })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_summary_v1"), {
    totalCount: 0, totalQuantity: 0, studentCount: 0, classCount: 0, totalAmount: 0, groups: [],
    statusCounts: { all: 4, waiting: 2, issued: 2, returned: 0, cancelled: 0 },
  })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1"), {
    totalCount: 0, totalWaitingQuantity: 0, totalIssuedQuantity: 0, sourceTotalCount: 4,
    yearOptions: ["2026"], monthOptions: ["2026-08"], classOptions: [[id(800), "중2반"]], effectiveMonth: "all",
  })
  await h.settleLegacy()

  assert.ok(document.querySelector('[aria-label="교재 출고 이력"]'))
  assert.ok(document.querySelector('[aria-label="출고 이력 연도"]'))
  assert.ok(document.querySelector('[aria-label="교재 출고 목록"]'))
  assert.ok([...document.querySelectorAll('button[aria-pressed="true"]')].find((node) => node.textContent.includes("반품")))
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('전체 출고') && node.textContent.includes('4')), true)
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('출고 대기') && node.textContent.includes('2')), true)
})

test("sale-history summary failure is visible and retryable independently of the sales summary", async (t) => {
  const h = await setup(t, { search: "?textbookTab=sales&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_summary_v1"), saleSummary(0))
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1"), { rows: [saleHistoryRow()], page: 1, pageSize: 10, totalCount: 1 })
  await h.reject(h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1"), { message: "history summary failed" })
  await h.settleLegacy()

  assert.equal(document.body.textContent.includes("출고 이력 집계 정보를 불러오지 못했습니다"), true)
  await h.act(() => document.querySelector('[aria-label="출고 이력 집계 다시 시도"]').click())
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_sale_history_summary_v1").length, 2)
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_sale_summary_v1").length, 1)
})

test("mounted sales renderers consume independent prepared history and process pages", async (t) => {
  const h = await setup(t, { search: "?textbookTab=sales&textbookPage=1&textbookPageSize=10" })
  const page = h.requests.find((request) => request.name === "list_textbook_sale_page_v1")
  const summary = h.requests.find((request) => request.name === "get_textbook_sale_summary_v1")
  const history = h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1")
  const historySummary = h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1")
  for (const request of [page, summary, history, historySummary]) assert.ok(request)
  const rows = [saleRow(1), saleRow(0)]
  const historyRows = [saleHistoryRow(1), saleHistoryRow(0)]
  await h.resolve(page, { rows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(summary, saleSummary(2))
  await h.resolve(history, { rows: historyRows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(historySummary, saleHistorySummary(2))
  await h.settleLegacy()
  assert.equal(document.body.textContent.includes("교재 101"), true)
  assert.equal(document.body.textContent.includes("김선생"), true)
  assert.deepEqual(preparedRowIds("sales-process-mobile"), rows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("sales-process-desktop"), rows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("sales-history"), historyRows.map((row) => row.id))
  assert.ok(document.querySelector('[aria-label="출고 이력 페이지 탐색"]'))
  assert.ok(document.querySelector('[aria-label="교재 출고 페이지 탐색"]'))
  await h.act(() => button("메이크에듀 청구 준비 열기").click())
  const billing = h.requests.find((request) => request.name === "get_textbook_billing_handoff_context_v1")
  assert.ok(billing)
  assert.deepEqual(billing.args.p_filters, page.args.p_filters)
})

test("mounted closing uses its prepared page, direct detail, independent movement page and complete-copy export", async (t) => {
  const h = await setup(t, { search: "?textbookTab=closing&textbookPage=1&textbookPageSize=10" })
  const page = h.requests.find((request) => request.name === "list_textbook_closing_page_v1")
  assert.ok(page)
  const closingRows = [closingRow({ id: id(702), closing_month: "2026-09" }), closingRow()]
  await h.resolve(page, { rows: closingRows, page: 1, pageSize: 10, totalCount: 2 })
  await h.settleLegacy()
  assert.equal(document.body.textContent.includes("2026-08"), true)
  assert.deepEqual(preparedRowIds("closing-mobile"), closingRows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("closing-desktop"), closingRows.map((row) => row.id))
  assert.ok(document.querySelector('[aria-label="월마감 페이지 탐색"]'))

  await h.act(() => button("2026-08 전체 정산 상세 열기").click())
  const detail = h.requests.find((request) => request.name === "get_textbook_closing_detail_v1")
  assert.ok(detail)
  assert.equal(h.requests.some((request) => request.name === "list_textbook_closing_movement_page_v1"), false)
  await h.resolve(detail, closingDetailEnvelope({ closing_month: "2026-09", subject: "science" }))
  const movementRequests = h.requests.filter((request) => request.name === "list_textbook_closing_movement_page_v1")
  assert.equal(movementRequests.length, 1, JSON.stringify(movementRequests.map((request) => request.args)))
  const [movements] = movementRequests
  assert.ok(movements)
  assert.deepEqual(movements.args.p_filters, { closingMonth: "2026-09", subject: "science", search: "" })
  assert.equal(movements.signal.aborted, false)
  const movementRows = [closingMovementRow(1), closingMovementRow(0)].map((row) => ({ ...row, at: "2026-09-01T00:00:00+00:00" }))
  await h.resolve(movements, { rows: movementRows, page: 1, pageSize: movements.args.p_page_size, totalCount: 2 })
  assert.equal(movements.signal.aborted, false)
  assert.equal(document.body.textContent.includes("교재 101"), true)
  assert.deepEqual(preparedRowIds("closing-movement"), movementRows.map((row) => row.id))
  assert.ok(document.querySelector('[aria-label="월마감 상세 이동 페이지 탐색"]'))

  await h.act(() => button("복사").click())
  const exported = h.requests.find((request) => request.name === "get_textbook_closing_movement_export_v1")
  assert.ok(exported)
  assert.deepEqual(exported.args.p_filters, { closingMonth: "2026-09", subject: "science", search: "" })
})

test("external and popstate navigation restore or clear off-page closing detail identity and movement search", async (t) => {
  const a = id(791), b = id(792)
  const h = await setup(t, { search: "?textbookTab=closing&textbookPage=1&textbookPageSize=10" })
  await h.navigate(`?textbookTab=closing&textbookPage=4&textbookPageSize=10&textbookDetailKind=closing&textbookDetail=${a}&textbookMovementSearch=alpha`)
  const detailA = h.requests.find((request) => request.name === "get_textbook_closing_detail_v1" && request.args.p_id === a)
  assert.ok(detailA)
  await h.resolve(detailA, closingDetailEnvelope({ id: a, closing_month: "2026-08", subject: "english" }))
  const movementA = h.requests.find((request) => request.name === "list_textbook_closing_movement_page_v1" && request.args.p_filters.search === "alpha")
  assert.ok(movementA)

  await h.popstate(`?textbookTab=closing&textbookPage=8&textbookPageSize=10&textbookDetailKind=closing&textbookDetail=${b}&textbookMovementSearch=beta`)
  const detailB = h.requests.find((request) => request.name === "get_textbook_closing_detail_v1" && request.args.p_id === b)
  assert.ok(detailB)
  assert.equal(movementA.signal.aborted, true)
  assert.equal(h.requests.some((request) => request.name === "list_textbook_closing_movement_page_v1" && request.args.p_filters.search === "beta"), false)
  await h.resolve(detailB, closingDetailEnvelope({ id: b, closing_month: "2026-09", subject: "science" }))
  assert.deepEqual(h.requests.find((request) => request.name === "list_textbook_closing_movement_page_v1" && request.args.p_filters.search === "beta").args.p_filters,
    { closingMonth: "2026-09", subject: "science", search: "beta" })

  await h.popstate("?textbookTab=closing&textbookPage=1&textbookPageSize=10")
  assert.equal(document.querySelector('[aria-label="월마감 상세 이동 페이지 탐색"]'), null)
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_closing_detail_v1").length, 2)
})

test("a closing detail URL loads an off-page detail before starting its scoped movement page", async (t) => {
  const detailId = id(799)
  const h = await setup(t, { search: `?textbookTab=closing&textbookPage=4&textbookPageSize=10&textbookDetailKind=closing&textbookDetail=${detailId}` })
  const detail = h.requests.find((request) => request.name === "get_textbook_closing_detail_v1")
  assert.ok(detail)
  assert.equal(detail.args.p_id, detailId)
  assert.equal(h.requests.some((request) => request.name === "list_textbook_closing_movement_page_v1"), false)

  await h.resolve(detail, closingDetailEnvelope({ id: detailId }))
  const movements = h.requests.find((request) => request.name === "list_textbook_closing_movement_page_v1")
  assert.ok(movements)
  assert.deepEqual(movements.args.p_filters, { closingMonth: "2026-08", subject: "all", search: "" })
})

test("a slow closing export cannot reach the clipboard or stale UI after a same-user role change", async (t) => {
  const h = await setup(t, { search: "?textbookTab=closing&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_closing_page_v1"), { rows: [closingRow()], page: 1, pageSize: 10, totalCount: 1 })
  await h.settleLegacy()
  await h.act(() => button("2026-08 전체 정산 상세 열기").click())
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_closing_detail_v1"), closingDetailEnvelope())
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_closing_movement_page_v1"), { rows: [closingMovementRow()], page: 1, pageSize: 10, totalCount: 1 })
  await h.act(() => button("복사").click())
  const exported = h.requests.find((request) => request.name === "get_textbook_closing_movement_export_v1")
  assert.ok(exported)

  await h.auth({ role: "staff", isAdmin: false, isStaff: true, canManageAll: false })
  await h.resolve(exported, { rows: [closingMovementRow()], totalCount: 1 })

  assert.equal(exported.signal?.aborted, true)
  assert.deepEqual(h.clipboardWrites, [])
  assert.equal(document.body.textContent.includes("복사됨"), false)
})

for (const [boundary, leaveActor] of [
  ["logout", (h) => h.auth({ user: null, role: null, isAdmin: false, isStaff: false, canManageAll: false })],
  ["unmount", (h) => h.unmount()],
]) {
  test(`a slow closing export cannot invoke the clipboard after ${boundary}`, async (t) => {
    const h = await setup(t, { search: "?textbookTab=closing&textbookPage=1&textbookPageSize=10" })
    await h.resolve(h.requests.find((request) => request.name === "list_textbook_closing_page_v1"), { rows: [closingRow()], page: 1, pageSize: 10, totalCount: 1 })
    await h.settleLegacy()
    await h.act(() => button("2026-08 전체 정산 상세 열기").click())
    await h.resolve(h.requests.find((request) => request.name === "get_textbook_closing_detail_v1"), closingDetailEnvelope())
    await h.resolve(h.requests.find((request) => request.name === "list_textbook_closing_movement_page_v1"), { rows: [closingMovementRow()], page: 1, pageSize: 10, totalCount: 1 })
    await h.act(() => button("복사").click())
    const exported = h.requests.find((request) => request.name === "get_textbook_closing_movement_export_v1")
    assert.ok(exported)

    await leaveActor(h)
    await h.resolve(exported, { rows: [closingMovementRow()], totalCount: 1 })

    assert.equal(exported.signal?.aborted, true)
    assert.deepEqual(h.clipboardWrites, [])
    if (boundary === "logout") assert.equal(document.body.textContent.includes("복사됨"), false)
  })
}
