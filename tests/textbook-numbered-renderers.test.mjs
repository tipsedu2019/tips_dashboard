import assert from "node:assert/strict"
import test from "node:test"
import { openFilter, closeFilter } from "./helpers/textbook-filter-actions.mjs"

import {
  parseTextbookNavigation,
  serializeTextbookNavigation,
} from "../src/features/textbooks/textbook-navigation.ts"
import {
  button, id, inventoryHistoryRow, masterRow, masterSummary, purchaseRow, purchaseSummary, saleHistoryRow, saleHistorySummary, saleRow, saleSummary, setup,
} from "./helpers/textbook-numbered-harness.mjs"

const stockCountResult = (request) => ({
  id: request.args.p_request_id, textbook_id: request.args.p_textbook_id, location_id: request.args.p_location_id,
  expected_quantity: request.args.p_expected_quantity, counted_quantity: request.args.p_counted_quantity,
  adjustment_move_id: request.args.p_expected_quantity === request.args.p_counted_quantity ? null : id(2999),
  counted_at: request.args.p_counted_at, memo: request.args.p_memo,
})

const preparedRowIds = (surface) => [...document.querySelectorAll(`[data-prepared-surface="${surface}"]`)]
  .map((node) => node.getAttribute("data-prepared-row-id"))

const renderedColumnCount = (row) => [...row.children]
  .reduce((count, cell) => count + Number(cell.getAttribute("colspan") || 1), 0)

const masterFilters = {
  search: "grammar",
  subject: "english",
  schoolLevel: "middle",
  gradeLevel: "m2",
  subSubject: "문법",
  quality: "all",
  inventory: "all",
}

const completePurchaseHandoffWire = (count = 12) => {
  const prepared = Array.from({ length: count }, (_, index) => purchaseRow("order", index))
  const lines = prepared.map((row) => ({
    ...row.lines[0],
    status: "ordered",
    ordered_quantity: 1,
    order: { ...row.lines[0].order, status: "ordered", ordered_at: "2026-08-02T00:00:00+00:00" },
  }))
  return {
    kind: "order", sourceLineCount: count, sourceLineIds: lines.map((line) => line.id), resolvedTextbookIds: lines.map((line) => line.textbook_id), lines,
    textbooks: prepared.map((row) => row.references.textbook), publishers: [], suppliers: [], publisherSupplierLinks: [],
    locations: [prepared[0].references.location], classes: [prepared[0].references.class], complete: true,
  }
}

const completeBillingHandoffWire = (count = 12) => {
  const prepared = Array.from({ length: count }, (_, index) => saleRow(index + 20))
  const students = prepared.map((_, index) => ({ id: id(2000 + index), name: `원생 ${index + 1}`, grade: null }))
  const metadata = { makeedu_card_company: null, makeedu_charge_amount: 0, makeedu_charge_month: null, makeedu_discount_amount: 0, makeedu_import_key: null,
    makeedu_item_name: null, makeedu_memo: null, makeedu_paid_amount: 0, makeedu_paid_at: null, makeedu_payment_method: null, makeedu_payment_method_detail: null,
    makeedu_payment_status: null, makeedu_saved_point_amount: 0, makeedu_student_no: null, makeedu_synced_at: null, makeedu_unpaid_amount: 0 }
  const lines = prepared.map((row, index) => ({ ...metadata, ...row.line, copy_scope: "student", teacher_name: "", student_id: students[index].id }))
  return {
    sourceLineCount: count, sourceLineIds: lines.map((line) => line.id), lines,
    sales: prepared.map((row) => row.sale), textbooks: prepared.map((row) => row.textbook), classes: [prepared[0].class], students, complete: true,
  }
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

test("catalog bookmark migration removes every retired filter without losing independent navigation", () => {
  for (const tab of ['master', 'inventory']) {
    for (const quality of ['all', 'attention', 'duplicate', 'missingCode', 'missingPublisher', 'missingCategory', 'missingPrice', 'subjectMismatch', 'inactive']) {
      for (const inventory of ['all', 'shortage', 'surplus', 'unused', 'negative']) {
        const filters = { ...masterFilters, quality, inventory }
        const params = new URLSearchParams({ textbookTab: tab, textbookPage: '7', textbookPageSize: '15', textbookFilters: JSON.stringify(filters), textbookHistoryPage: '3', textbookMovementPage: '4', textbookDetailKind: 'master', textbookDetail: id(1), unrelated: 'keep' })
        const parsed = parseTextbookNavigation(params)
        const expectedQuality = tab === 'master' && quality === 'inactive' ? 'inactive' : 'all'
        const changed = expectedQuality !== quality || inventory !== 'all'
        assert.equal(parsed.primary.page, changed ? 1 : 7)
        assert.equal(parsed.primary.pageSize, 15)
        assert.deepEqual(parsed.primary.filters, { ...masterFilters, quality: expectedQuality })
        assert.equal(parsed.history.page, 3)
        assert.equal(parsed.movements, undefined)
        assert.deepEqual(parsed.detail, { kind: 'master', id: id(1) })
        const serialized = serializeTextbookNavigation(params, { ...parsed, primary: { page: 7, pageSize: 15, filters } })
        assert.equal(serialized.get('unrelated'), 'keep')
        assert.deepEqual(parseTextbookNavigation(serialized), parsed)
      }
    }
  }
})

test("inventory URL commits keep catalog filters while omitting local count context", () => {
  const state = parseTextbookNavigation(new URLSearchParams({ textbookTab: 'inventory' }))
  state.primary = { page: 3, pageSize: 20, filters: { ...masterFilters, locationId: id(900), audit: 'done' } }
  const url = serializeTextbookNavigation(new URLSearchParams(), state)
  const restored = parseTextbookNavigation(url)
  assert.equal(restored.primary.page, 3)
  assert.equal(restored.primary.pageSize, 20)
  assert.deepEqual(restored.primary.filters, masterFilters)
  assert.equal(JSON.parse(url.get('textbookFilters')).locationId, undefined)
  assert.equal(JSON.parse(url.get('textbookFilters')).audit, undefined)
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
  assert.equal(parsed.movements, undefined)
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
    textbookFilters: JSON.stringify({ search: "", subject: "english", schoolLevel: "middle", gradeLevel: "m2", subSubject: "  문법  ", quality: "all", inventory: "all" }),
  })
  assert.deepEqual(parseTextbookNavigation(valid).primary.filters, {
    search: "", subject: "english", schoolLevel: "middle", gradeLevel: "m2", subSubject: "문법", quality: "all", inventory: "all",
  })
})

test("mounted textbook workspace starts the strict direct master page with no legacy loader", async (t) => {
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
  assert.deepEqual(h.requests.filter((request) => request.table), [])
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
  const retiredPreferences = { classification: false, amount: false }
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=10&textbookPageSize=10", localStorage: { "textbook-master-columns-v1": retiredPreferences } })
  const page = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 10)
  const summary = h.requests.find((request) => request.name === "get_textbook_master_summary_v1")
  assert.ok(page)
  assert.ok(summary)
  await h.resolve(page, { rows: Array.from({ length: 10 }, (_, index) => masterRow(100 + index)), page: 10, pageSize: 10, totalCount: 200 })
  await h.resolve(summary, masterSummary(200))
  await h.assertNoLegacyReads()
  await h.act(() => document.querySelector('[aria-label="교재 재고 페이지 탐색"] [aria-label="다음 페이지"]').click())
  const nextPage = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 11)
  assert.ok(nextPage)
  const rows = Array.from({ length: 10 }, (_, index) => masterRow(110 + index))
  await h.resolve(nextPage, { rows, page: 11, pageSize: 10, totalCount: 200 })
  await h.assertNoLegacyReads()

  const expectedIds = rows.map((row) => row.id)
  const mobileIds = [...document.querySelectorAll('[data-testid^="textbook-master-mobile-card-"]')]
    .map((node) => node.getAttribute("data-testid").replace("textbook-master-mobile-card-", ""))
  const desktopIds = [...document.querySelectorAll('[data-testid^="textbook-master-desktop-row-"]')]
    .map((node) => node.getAttribute("data-testid").replace("textbook-master-desktop-row-", ""))
  assert.deepEqual(mobileIds, expectedIds)
  assert.deepEqual(desktopIds, expectedIds)
  assert.deepEqual(preparedRowIds("master-mobile"), expectedIds)
  assert.deepEqual(preparedRowIds("master-desktop"), expectedIds)
  const table = document.querySelector('[data-prepared-surface="master-desktop"]').closest("table")
  assert.deepEqual([...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim()), ["", "교재", "분류", "합계", "판매가", "관리"])
  assert.equal(renderedColumnCount(table.querySelector('[data-prepared-surface="master-desktop"]')), 6)
  assert.equal(renderedColumnCount(table.querySelector("tbody tr:last-child")), 6)
  assert.deepEqual(JSON.parse(window.localStorage.getItem("textbook-master-columns-v1")), retiredPreferences)
  assert.equal(button("컬럼 구성"), undefined)
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
  await h.assertNoLegacyReads()
  const firstCard = document.querySelector(`[data-testid="textbook-master-mobile-card-${id(1)}"]`)
  await h.act(() => firstCard.querySelector('[aria-label$="선택"]').click())
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]'))
  await h.act(() => document.querySelector('[aria-label="교재 재고 페이지 탐색"] [aria-label="2 페이지"]').click())
  const second = h.requests.find((request) => request.name === "list_textbook_master_page_v1" && request.args.p_page === 2)
  assert.ok(second, JSON.stringify(h.requests.filter((request) => request.name).map((request) => [request.name, request.args?.p_page])))
  await h.resolve(second, { rows: [masterRow(11)], page: 2, pageSize: 10, totalCount: 11 })
  assert.equal(document.querySelector('[aria-label="선택한 교재 일괄 작업"]'), null)
})

test("master bulk edit preserves a newer selection and patch after its first writer starts", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const rows = [masterRow(21), masterRow(22)]
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), { rows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(2))
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_options_v1"), {
    publisherOptions: [], subSubjectOptions: ["문법"], categoryOptions: ["문법"], bulkCategoryOptions: ["문법"], scienceSubjectAreas: [],
    counts: { publisherOptions: 0, subSubjectOptions: 1, categoryOptions: 1, bulkCategoryOptions: 1, scienceSubjectAreas: 0 }, complete: true,
  })
  await h.act(() => document.querySelector(`[data-testid="textbook-master-mobile-card-${rows[0].id}"] [aria-label$="선택"]`).click())
  await h.act(() => button("속성 변경").click())
  const publisher = document.querySelector('[aria-label="일괄 출판사"]')
  const publisherProps = publisher[Object.keys(publisher).find((key) => key.startsWith("__reactProps$"))]
  await h.act(() => publisherProps.onChange({ target: { value: "기존 작업 출판사" } }))
  await h.act(() => button("선택 교재 변경 저장").click())
  const writer = h.requests.find((request) => request.table === "textbooks")
  assert.ok(writer)
  assert.equal(writer.steps.find((step) => step.method === "upsert").args[0].publisher, "기존 작업 출판사")

  await h.act(() => document.querySelector(`[data-testid="textbook-master-mobile-card-${rows[1].id}"] [aria-label$="선택"]`).click())
  await h.act(() => publisherProps.onChange({ target: { value: "새 작업 출판사" } }))
  const rpcCountAtWriter = h.requests.filter((request) => request.name).length
  await h.resolve(writer, rows[0])
  await h.act(() => Promise.resolve())

  assert.equal(h.requests.filter((request) => request.name).length, rpcCountAtWriter, "obsolete master action dispatches no stale invalidation")
  assert.equal(document.querySelector('[aria-label="선택한 교재 일괄 작업"]').textContent.includes("2개 선택"), true, "new B selection remains")
  assert.equal(document.querySelector('[aria-label="일괄 출판사"]').value, "새 작업 출판사", "new patch remains")
  assert.equal(document.body.textContent.includes("개 교재를 수정했습니다."), false, "obsolete action publishes no stale success")
})

test("master bulk edit preserves a same-book deselect and reselect intent after its writer starts", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const row = masterRow(23)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), { rows: [row], page: 1, pageSize: 10, totalCount: 1 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(1))
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_options_v1"), {
    publisherOptions: [], subSubjectOptions: ["문법"], categoryOptions: ["문법"], bulkCategoryOptions: ["문법"], scienceSubjectAreas: [],
    counts: { publisherOptions: 0, subSubjectOptions: 1, categoryOptions: 1, bulkCategoryOptions: 1, scienceSubjectAreas: 0 }, complete: true,
  })
  const selection = document.querySelector(`[data-testid="textbook-master-mobile-card-${row.id}"] [aria-label$="선택"]`)
  await h.act(() => selection.click())
  await h.act(() => button("속성 변경").click())
  const publisher = document.querySelector('[aria-label="일괄 출판사"]')
  const publisherProps = publisher[Object.keys(publisher).find((key) => key.startsWith("__reactProps$"))]
  await h.act(() => publisherProps.onChange({ target: { value: "동일 작업 출판사" } }))
  await h.act(() => button("선택 교재 변경 저장").click())
  const writer = h.requests.find((request) => request.table === "textbooks")
  assert.ok(writer)
  assert.equal(writer.steps.find((step) => step.method === "upsert").args[0].publisher, "동일 작업 출판사")

  await h.act(() => selection.click())
  await h.act(() => selection.click())
  const rpcCountAtReselection = h.requests.filter((request) => request.name).length
  await h.resolve(writer, row)
  await h.act(() => Promise.resolve())

  assert.equal(h.requests.filter((request) => request.table === "textbooks").length, 1, "the started writer is neither cancelled nor retried")
  assert.equal(h.requests.filter((request) => request.name).length, rpcCountAtReselection, "the obsolete completion dispatches no stale invalidation")
  assert.equal(document.querySelector('[aria-label="선택한 교재 일괄 작업"]')?.textContent.includes("1개 선택"), true, "the reselected A remains selected")
  await h.act(() => button("속성 변경").click())
  assert.equal(document.querySelector('[aria-label="일괄 출판사"]')?.value, "동일 작업 출판사", "the unchanged patch remains owned by the new intent")
  assert.equal(document.body.textContent.includes("개 교재를 수정했습니다."), false, "the obsolete completion publishes no stale success")
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
  await h.assertNoLegacyReads()
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
  await h.assertNoLegacyReads()
  assert.ok(document.querySelector('[role="alert"]'))
  assert.equal(document.querySelector('[aria-label="교재 재고 페이지 탐색"]').parentElement.parentElement.textContent.includes("건수 확인 중"), true)
  const list = document.querySelector('div[aria-label="교재 재고"]')
  assert.equal(list.textContent.includes("교재 재고를 불러오지 못했습니다."), true)
  assert.equal(list.textContent.includes("교재가 없습니다"), false)
  assert.equal(list.textContent.includes("신규 등록"), false)
  await h.act(() => button("다시 시도").click())
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_master_page_v1").length, 2)
})

test("primary request read failure stays in its toolbar and retry restores controls without an empty-state lie", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests&textbookPage=1&textbookPageSize=10" })
  const page = h.requests.find((request) => request.name === "list_textbook_purchase_page_v1")
  const summary = h.requests.find((request) => request.name === "get_textbook_purchase_summary_v1")
  await h.resolve(summary, purchaseSummary("request"))
  await h.reject(page, { message: "__request_primary_read_failed__" })

  const workspace = document.querySelector('[data-slot="textbook-workspace"]')
  const tablist = workspace.querySelector('[role="tablist"]')
  const requestList = document.querySelector('[aria-label="교재 요청 목록"]')
  const toolbar = requestList.querySelector('[data-slot="data-table-toolbar"]')
  const alert = toolbar.querySelector('[role="alert"]')
  assert.ok(alert, "the primary read error replaces toolbar actions")
  assert.equal(Boolean(alert.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING), false, "no read alert is inserted before the tabs")
  assert.ok(alert.textContent.includes("목록 조회 실패"))
  assert.ok(alert.textContent.includes("처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요."))
  assert.ok(toolbar.querySelector('[aria-label="교재 목록 다시 시도"]'))
  assert.ok(requestList.textContent.includes("교재 목록을 불러오지 못했습니다"))
  assert.equal(requestList.textContent.includes("대기 중인 요청이 없습니다"), false, "a failed read is not announced as a valid zero-result page")

  const search = document.querySelector('[aria-label="요청 검색"][type="search"]')
  await h.act(() => toolbar.querySelector('[aria-label="교재 목록 다시 시도"]').click())
  assert.equal(document.activeElement, search, "retry keeps focus on the stable list search while feedback disappears")
  const retry = h.requests.filter((request) => request.name === "list_textbook_purchase_page_v1").at(-1)
  assert.notEqual(retry, page)
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_purchase_page_v1").length, 2)
  await h.resolve(retry, { rows: [purchaseRow("request")], page: 1, pageSize: 10, totalCount: 1 })

  assert.equal(toolbar.querySelector('[role="alert"]'), null)
  assert.equal(document.querySelector('[aria-label="요청 검색"][type="search"]'), search)
  assert.equal(document.activeElement, search)
  assert.ok(document.querySelector('[data-prepared-surface="requests-desktop"]'))
  assert.ok(document.querySelector('[aria-label="교재 요청 추가"]'))
  assert.equal(requestList.textContent.includes("교재 목록을 불러오지 못했습니다"), false)
  await h.assertNoLegacyReads()
})

test("a summary failure stays explicit and retryable without rendering current-page totals as authoritative", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), {
    rows: [masterRow(91, { totalQuantity: 7 })], page: 1, pageSize: 10, totalCount: 1,
  })
  await h.reject(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), { message: "missing summary" })
  await h.assertNoLegacyReads()

  assert.equal(document.body.textContent.includes("집계 조회 실패"), true)
  assert.equal(document.body.textContent.includes("집계 확인 필요"), true)
  assert.equal(document.body.textContent.includes("missing summary"), false)
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
  assert.equal(page.args.p_filters.quality, "all")
  assert.equal(page.args.p_filters.inventory, "all")
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
  await h.assertNoLegacyReads()
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
  await h.assertNoLegacyReads()

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
  await h.assertNoLegacyReads()

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
  const inventorySummaryPayload = masterSummary(11, {
    totalQuantity: 3, studentQuantity: 3, stockValue: 30000, locationQuantities: { [locationId]: 3 },
    subjectTotals: [{ subject: "english", totalCount: 11, totalQuantity: 3, salePriceTotal: 0, stockValue: 30000 }],
    auditCounts: { all: 11, recommended: 11, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }],
  })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), inventorySummaryPayload)
  await h.assertNoLegacyReads()

  const checkbox = document.querySelector('[aria-label$="본관 재고 선택"]')
  const input = document.querySelector('[aria-label$="본관 실사 수량"]')
  assert.ok(checkbox)
  assert.ok(input)
  await h.act(() => checkbox.click())
  await h.act(() => {
    const reactProps = input[Object.keys(input).find((key) => key.startsWith("__reactProps$"))]
    reactProps.onChange({ target: { value: "7" } })
  })
  const memoInput = document.querySelector('[aria-label="교재 311 본관 실사 메모"]')
  await h.act(() => {
    const reactProps = memoInput[Object.keys(memoInput).find((key) => key.startsWith("__reactProps$"))]
    reactProps.onChange({ target: { value: "먼저 쓴 메모" } })
  })
  assert.ok(document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]'))
  assert.equal(input.value, "7")

  await h.act(() => button("2").click())
  assert.equal(document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]')?.disabled, true)
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

  const restoredCheckbox = document.querySelector('[aria-label="교재 311 본관 재고 선택"]')
  await h.act(() => restoredCheckbox.click())
  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  const balance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1")
  assert.ok(balance, "bulk count freezes selected displayed rows and reads their actual location balance")
  assert.deepEqual(balance.args.p_input, { textbookIds: [source.id], locationId })
  assert.equal(h.requests.some((request) => request.table || request.name === "create_textbook_stock_count_v1"), false, "no writer starts before every balance is complete")
  await h.resolve(balance, { locationId, rows: [{ textbookId: source.id, currentQuantity: 9,
    locationQuantities: { [locationId]: 9 }, studentLocationQuantities: { [locationId]: 9 }, teacherLocationQuantities: {},
    totalQuantity: 9, studentQuantity: 9, teacherQuantity: 0, stockValue: 90000 }] })
  const countWrite = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  assert.equal(countWrite.args.p_expected_quantity, 9, "fresh balance owns expectedQuantity")
  const restoredInput = document.querySelector('[aria-label="교재 311 본관 실사 수량"]')
  await h.act(() => {
    const reactProps = restoredInput[Object.keys(restoredInput).find((key) => key.startsWith("__reactProps$"))]
    reactProps.onChange({ target: { value: "8" } })
  })
  const restoredMemoInput = document.querySelector('[aria-label="교재 311 본관 실사 메모"]')
  await h.act(() => {
    const reactProps = restoredMemoInput[Object.keys(restoredMemoInput).find((key) => key.startsWith("__reactProps$"))]
    reactProps.onChange({ target: { value: "나중에 고친 메모" } })
  })
  await h.resolve(countWrite, stockCountResult(countWrite))
  const refreshRequests = h.requests.slice(h.requests.indexOf(countWrite) + 1).filter((request) => request.name)
  assert.deepEqual(refreshRequests, [], "a newer post-writer draft suppresses stale invalidation for the obsolete action")
  assert.equal(document.querySelector('[aria-label="교재 311 본관 실사 수량"]')?.value, "8", "newer quantity revision survives an older completed action")
  assert.equal(document.querySelector('[aria-label="교재 311 본관 실사 메모"]')?.value, "나중에 고친 메모", "newer memo revision survives an older completed action")
  assert.deepEqual([...new Set(h.requests.filter((request) => request.table).map((request) => request.table))].sort(), [], "action completion performs no direct table writes or legacy reads")
})

test("inventory bulk freezes selected displayed IDs and completes every actual-location balance batch before writing", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const mainId = id(900)
  const annexId = id(910)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: mainId, label: "본관", searchText: "본관 main" }, { value: annexId, label: "별관", searchText: "별관 annex" }], page: 1, pageSize: 20, totalCount: 2,
    defaultLocation: { id: mainId, code: "main", name: "본관" },
  })
  const inventoryRow = (n, locationId, locationName, currentQuantity) => {
    const source = masterRow(n, { locationQuantities: { [locationId]: currentQuantity }, studentLocationQuantities: { [locationId]: currentQuantity }, teacherLocationQuantities: {}, totalQuantity: currentQuantity, studentQuantity: currentQuantity, stockValue: currentQuantity * 10000,
      locationSummary: [{ id: locationId, code: locationName, name: locationName, sortOrder: 1, quantity: currentQuantity }] })
    return { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName, currentQuantity, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  }
  const rows = [inventoryRow(321, mainId, "본관", 3), inventoryRow(322, annexId, "별관", 4), inventoryRow(323, mainId, "본관", 5)]
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows, page: 1, pageSize: 10, totalCount: 3 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(3, { auditCounts: { all: 3, recommended: 3, pending: 0, done: 0 }, locations: [{ id: mainId, code: "main", name: "본관", sortOrder: 1 }, { id: annexId, code: "annex", name: "별관", sortOrder: 2 }] }))
  for (const [title, location, value, selected] of [["교재 321", "본관", "7", true], ["교재 322", "별관", "8", true], ["교재 323", "본관", "9", false]]) {
    const input = document.querySelector(`[aria-label="${title} ${location} 실사 수량"]`)
    await h.act(() => input[Object.keys(input).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value } }))
    if (selected) await h.act(() => document.querySelector(`[aria-label="${title} ${location} 재고 선택"]`).click())
  }
  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  let balances = h.requests.filter((request) => request.name === "get_textbook_inventory_balance_v1")
  assert.deepEqual(balances.map((request) => request.args.p_input).sort((a, b) => a.locationId.localeCompare(b.locationId)), [
    { textbookIds: [rows[0].id], locationId: mainId }, { textbookIds: [rows[1].id], locationId: annexId },
  ].sort((a, b) => a.locationId.localeCompare(b.locationId)), "unselected displayed draft is excluded and both actual locations are batched")
  const changedDraft = document.querySelector('[aria-label="교재 321 본관 실사 수량"]')
  await h.act(() => changedDraft[Object.keys(changedDraft).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: "70" } }))
  await h.act(() => document.querySelector('[aria-label="교재 322 별관 재고 선택"]').click())
  await h.resolve(balances[0], { locationId: balances[0].args.p_input.locationId, rows: [{ textbookId: balances[0].args.p_input.textbookIds[0], currentQuantity: 11, locationQuantities: { [balances[0].args.p_input.locationId]: 11 }, studentLocationQuantities: { [balances[0].args.p_input.locationId]: 11 }, teacherLocationQuantities: { [balances[0].args.p_input.locationId]: 0 }, totalQuantity: 11, studentQuantity: 11, teacherQuantity: 0, stockValue: 110000 }] })
  assert.equal(h.requests.some((request) => request.table || request.name === "create_textbook_stock_count_v1"), false)
  await h.resolve(balances[1], { locationId: balances[1].args.p_input.locationId, rows: [{ textbookId: balances[1].args.p_input.textbookIds[0], currentQuantity: 12, locationQuantities: { [balances[1].args.p_input.locationId]: 12 }, studentLocationQuantities: { [balances[1].args.p_input.locationId]: 12 }, teacherLocationQuantities: { [balances[1].args.p_input.locationId]: 0 }, totalQuantity: 12, studentQuantity: 12, teacherQuantity: 0, stockValue: 120000 }] })
  assert.equal(h.requests.some((request) => request.table || request.name === "create_textbook_stock_count_v1"), false, "bulk draft or selection changes while balances are pending keep every writer closed")

  await h.act(() => changedDraft[Object.keys(changedDraft).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: "7" } }))
  await h.act(() => document.querySelector('[aria-label="교재 322 별관 재고 선택"]').click())

  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  balances = h.requests.filter((request) => request.name === "get_textbook_inventory_balance_v1").slice(-2)
  for (const [index, request] of balances.entries()) {
    const textbookId = request.args.p_input.textbookIds[0]
    await h.resolve(request, { locationId: request.args.p_input.locationId, rows: [{ textbookId, currentQuantity: 20 + index, locationQuantities: { [request.args.p_input.locationId]: 20 + index }, studentLocationQuantities: { [request.args.p_input.locationId]: 20 + index }, teacherLocationQuantities: { [request.args.p_input.locationId]: 0 }, totalQuantity: 20 + index, studentQuantity: 20 + index, teacherQuantity: 0, stockValue: (20 + index) * 10000 }] })
  }
  const firstWriter = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  const firstPayload = firstWriter.args
  assert.equal(firstPayload.p_textbook_id, balances[0].args.p_input.textbookIds[0])
  assert.equal(firstPayload.p_expected_quantity, 20, "the changed fresh balance owns the first grouped writer expectation")
})

test("bulk inventory acknowledges each completed row before a later row fails and retries only retained work", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const makeRow = (n) => {
    const source = masterRow(n, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
      locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
    return { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  }
  const rows = [makeRow(341), makeRow(342)]
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(2, { auditCounts: { all: 2, recommended: 2, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] }))
  for (const [row, quantity, memo] of [[rows[0], "7", "A 메모"], [rows[1], "8", "B 메모"]]) {
    const quantityInput = document.querySelector(`[aria-label="${row.title} 본관 실사 수량"]`)
    const memoInput = document.querySelector(`[aria-label="${row.title} 본관 실사 메모"]`)
    await h.act(() => quantityInput[Object.keys(quantityInput).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: quantity } }))
    await h.act(() => memoInput[Object.keys(memoInput).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: memo } }))
    await h.act(() => document.querySelector(`[aria-label="${row.title} 본관 재고 선택"]`).click())
  }
  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  const balance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1")
  await h.resolve(balance, { locationId, rows: rows.map((row, index) => ({ textbookId: row.id, currentQuantity: 10 + index, locationQuantities: { [locationId]: 10 + index }, studentLocationQuantities: { [locationId]: 10 + index }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 10 + index, studentQuantity: 10 + index, teacherQuantity: 0, stockValue: (10 + index) * 10000 })) })

  const firstCount = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  await h.resolve(firstCount, stockCountResult(firstCount))
  const secondCount = h.requests.findLast((request) => request.name === "create_textbook_stock_count_v1")
  assert.notEqual(secondCount, firstCount)
  await h.reject(secondCount, { code: "23514", message: "__second_count_failed__" })

  assert.equal(document.querySelector('[aria-label="교재 341 본관 실사 수량"]')?.value, "", "completed unchanged A quantity is acknowledged")
  assert.equal(document.querySelector('[aria-label="교재 341 본관 실사 메모"]')?.value, "", "completed unchanged A memo is acknowledged")
  assert.equal(document.querySelector('[aria-label="교재 341 본관 재고 선택"]').getAttribute("data-state"), "unchecked")
  assert.equal(document.querySelector('[aria-label="교재 342 본관 실사 수량"]')?.value, "8")
  assert.equal(document.querySelector('[aria-label="교재 342 본관 실사 메모"]')?.value, "B 메모")
  assert.equal(document.querySelector('[aria-label="교재 342 본관 재고 선택"]').getAttribute("data-state"), "checked")

  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  const retryBalance = h.requests.findLast((request) => request.name === "get_textbook_inventory_balance_v1")
  assert.deepEqual(retryBalance.args.p_input, { textbookIds: [rows[1].id], locationId }, "retry excludes already committed A")
  await h.resolve(retryBalance, { locationId, rows: [{ textbookId: rows[1].id, currentQuantity: 8, locationQuantities: { [locationId]: 8 }, studentLocationQuantities: { [locationId]: 8 }, teacherLocationQuantities: {}, totalQuantity: 8, studentQuantity: 8, teacherQuantity: 0, stockValue: 80000 }] })
  const retriedCount = h.requests.findLast((request) => request.name === "create_textbook_stock_count_v1")
  assert.equal(retriedCount.args.p_request_id, secondCount.args.p_request_id, "the failed row keeps its request identity across refreshed balances")
  assert.equal(retriedCount.args.p_counted_at, secondCount.args.p_counted_at)
  assert.notEqual(retriedCount.args.p_request_id, firstCount.args.p_request_id, "each bulk row owns its own transaction identity")
})

test("bulk inventory preserves a newer A draft made after A writer starts even when B later fails", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const rows = [361, 362].map((n) => {
    const source = masterRow(n, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
      locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
    return { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(2, { auditCounts: { all: 2, recommended: 2, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] }))
  const edit = async (label, value) => {
    const input = document.querySelector(`[aria-label="${label}"]`)
    await h.act(() => input[Object.keys(input).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value } }))
  }
  for (const [row, quantity] of [[rows[0], "7"], [rows[1], "8"]]) {
    await edit(`${row.title} 본관 실사 수량`, quantity)
    await edit(`${row.title} 본관 실사 메모`, `${row.title} 원본`)
    await h.act(() => document.querySelector(`[aria-label="${row.title} 본관 재고 선택"]`).click())
  }
  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1"), { locationId, rows: rows.map((row) => ({ textbookId: row.id, currentQuantity: 10, locationQuantities: { [locationId]: 10 }, studentLocationQuantities: { [locationId]: 10 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 10, studentQuantity: 10, teacherQuantity: 0, stockValue: 100000 })) })
  const firstCount = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  await edit("교재 361 본관 실사 수량", "9")
  await edit("교재 361 본관 실사 메모", "A 신규 의도")
  await h.resolve(firstCount, stockCountResult(firstCount))
  await h.reject(h.requests.findLast((request) => request.name === "create_textbook_stock_count_v1"), { code: "23514", message: "__later_B_failed__" })
  assert.equal(document.querySelector('[aria-label="교재 361 본관 실사 수량"]')?.value, "9")
  assert.equal(document.querySelector('[aria-label="교재 361 본관 실사 메모"]')?.value, "A 신규 의도")
  assert.equal(document.querySelector('[aria-label="교재 361 본관 재고 선택"]').getAttribute("data-state"), "checked")
})

test("bulk inventory preserves a deselected and reselected A intent after A completes and B fails", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const rows = [371, 372].map((n) => {
    const source = masterRow(n, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
      locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
    return { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(2, { auditCounts: { all: 2, recommended: 2, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] }))
  for (const [row, quantity, memo] of [[rows[0], "7", "A 선택 의도"], [rows[1], "8", "B 유지"]]) {
    const quantityInput = document.querySelector(`[aria-label="${row.title} 본관 실사 수량"]`)
    const memoInput = document.querySelector(`[aria-label="${row.title} 본관 실사 메모"]`)
    await h.act(() => quantityInput[Object.keys(quantityInput).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: quantity } }))
    await h.act(() => memoInput[Object.keys(memoInput).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: memo } }))
    await h.act(() => document.querySelector(`[aria-label="${row.title} 본관 재고 선택"]`).click())
  }
  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1"), { locationId, rows: rows.map((row) => ({ textbookId: row.id, currentQuantity: 10, locationQuantities: { [locationId]: 10 }, studentLocationQuantities: { [locationId]: 10 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 10, studentQuantity: 10, teacherQuantity: 0, stockValue: 100000 })) })
  const firstCount = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  await h.resolve(firstCount, stockCountResult(firstCount))
  const aSelection = document.querySelector('[aria-label="교재 371 본관 재고 선택"]')
  await h.act(() => aSelection.click())
  await h.act(() => aSelection.click())
  const rpcCountAfterA = h.requests.filter((request) => request.name).length
  await h.reject(h.requests.findLast((request) => request.name === "create_textbook_stock_count_v1"), { code: "23514", message: "__selection_only_B_failed__" })

  assert.equal(document.querySelector('[aria-label="교재 371 본관 실사 수량"]')?.value, "7", "A draft remains for the newer selection-only intent")
  assert.equal(document.querySelector('[aria-label="교재 371 본관 실사 메모"]')?.value, "A 선택 의도")
  assert.equal(document.querySelector('[aria-label="교재 371 본관 재고 선택"]').getAttribute("data-state"), "checked", "reselected A remains selected")
  assert.equal(document.querySelector('[aria-label="교재 372 본관 재고 선택"]').getAttribute("data-state"), "checked", "failed B remains selected")
  assert.equal(h.requests.filter((request) => request.name).length, rpcCountAfterA, "obsolete partial action dispatches no invalidation")
  assert.equal(document.body.textContent.includes("__selection_only_B_failed__"), false, "obsolete action publishes no stale failure presentation")
})

test("prepared schema errors disable actionable inventory writes and expose the owner retry", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const source = masterRow(351, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
  const row = { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows: [row], page: 1, pageSize: 10, totalCount: 1 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  const summary = h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1")
  await h.reject(summary, { code: "PGRST202", message: "__prepared_inventory_summary_rpc_missing__" })
  const quantity = document.querySelector('[aria-label="교재 351 본관 실사 수량"]')
  await h.act(() => quantity[Object.keys(quantity).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: "7" } }))
  const submit = document.querySelector('[aria-label="실사 반영 불가"]')
  assert.ok(submit)
  assert.equal(submit.disabled, true)
  const mobileQuantity = document.querySelector('[data-prepared-surface="inventory-mobile"] input[aria-label$="실사 수량"]')
  await h.act(() => mobileQuantity[Object.keys(mobileQuantity).find(key => key.startsWith('__reactProps$'))].onKeyDown({key:'Enter',preventDefault(){}}))

  const schemaFeedback = document.querySelector('[data-slot="data-table-toolbar"] [role="alert"]')
  assert.ok(schemaFeedback)
  assert.ok(schemaFeedback.textContent.includes("운영 정보 확인 필요"))
  assert.ok(schemaFeedback.textContent.includes("교재 관리 기능을 불러오지 못했습니다."))
  const retry = document.querySelector('[aria-label="교재 운영 API 다시 시도"]')
  assert.ok(retry)
  await h.act(() => retry.click())
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_inventory_summary_v1").length, 2)
  assert.equal(h.requests.some((request) => request.table || request.name === "create_textbook_stock_count_v1"), false)
  assert.equal(h.requests.some((request) => request.name === "get_textbook_inventory_balance_v1"), false)
})

test("a prepared summary becoming PGRST205 while balance is pending closes the first writer and stays retryable", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const source = masterRow(381, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
  const row = { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows: [row], page: 1, pageSize: 10, totalCount: 1 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(1, { auditCounts: { all: 1, recommended: 1, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] }))
  const quantity = document.querySelector('[aria-label="교재 381 본관 실사 수량"]')
  await h.act(() => quantity[Object.keys(quantity).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: "7" } }))
  await h.act(() => document.querySelector('[aria-label="교재 381 본관 7권 반영"]').click())
  const balance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1")
  assert.ok(balance)
  await h.act(() => document.querySelector('[aria-label="교재관리 새로고침"]').click())
  const failedSummary = h.requests.findLast((request) => request.name === "get_textbook_inventory_summary_v1")
  await h.reject(failedSummary, { code: "PGRST205", message: "__prepared_inventory_table_missing__" })
  await h.resolve(balance, { locationId, rows: [{ textbookId: source.id, currentQuantity: 9, locationQuantities: { [locationId]: 9 }, studentLocationQuantities: { [locationId]: 9 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 9, studentQuantity: 9, teacherQuantity: 0, stockValue: 90000 }] })

  assert.equal(h.requests.some((request) => request.table || request.name === "create_textbook_stock_count_v1"), false, "newly accepted schema owner closes the pending action before its first writer")
  const retry = document.querySelector('[aria-label="교재 운영 API 다시 시도"]')
  assert.ok(retry, document.body.textContent)
  await h.act(() => retry.click())
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_inventory_summary_v1").length, 3)
  assert.equal(document.body.textContent.includes("실사 수량이 반영되었습니다."), false)
})

test("inventory single count preserves newer quantity and memo through an older completed action", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const source = masterRow(331, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
  const row = { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  const pagePayload = { rows: [row], page: 1, pageSize: 10, totalCount: 1 }
  const summaryPayload = masterSummary(1, { auditCounts: { all: 1, recommended: 1, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), pagePayload)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), summaryPayload)
  const edit = async (label, value) => {
    const input = document.querySelector(`[aria-label="${label}"]`)
    await h.act(() => input[Object.keys(input).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value } }))
  }
  await edit("교재 331 본관 실사 수량", "7")
  await edit("교재 331 본관 실사 메모", "먼저 쓴 메모")
  await h.act(() => document.querySelector('[aria-label="교재 331 본관 7권 반영"]').click())
  const balance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1")
  await edit("교재 331 본관 실사 메모", "컨텍스트 대기 중 변경")
  await h.resolve(balance, { locationId, rows: [{ textbookId: source.id, currentQuantity: 9, locationQuantities: { [locationId]: 9 }, studentLocationQuantities: { [locationId]: 9 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 9, studentQuantity: 9, teacherQuantity: 0, stockValue: 90000 }] })
  assert.equal(h.requests.some((request) => request.table || request.name === "create_textbook_stock_count_v1"), false, "editing a single count while its balance is pending starts zero writers")

  await h.act(() => document.querySelector('[aria-label="교재 331 본관 7권 반영"]').click())
  const retryBalance = h.requests.findLast((request) => request.name === "get_textbook_inventory_balance_v1")
  await h.resolve(retryBalance, { locationId, rows: [{ textbookId: source.id, currentQuantity: 9, locationQuantities: { [locationId]: 9 }, studentLocationQuantities: { [locationId]: 9 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 9, studentQuantity: 9, teacherQuantity: 0, stockValue: 90000 }] })
  const countWrite = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  assert.equal(countWrite.args.p_expected_quantity, 9)
  await edit("교재 331 본관 실사 수량", "8")
  await edit("교재 331 본관 실사 메모", "나중에 고친 메모")
  await h.resolve(countWrite, stockCountResult(countWrite))
  const refreshRequests = h.requests.slice(h.requests.indexOf(countWrite) + 1).filter((request) => request.name)
  for (const request of refreshRequests) {
    if (request.name === "list_textbook_inventory_page_v1") await h.resolve(request, pagePayload)
    else if (request.name === "list_textbook_inventory_history_page_v1") await h.resolve(request, { rows: [], page: 1, pageSize: 10, totalCount: 0 })
    else if (request.name === "get_textbook_inventory_summary_v1") await h.resolve(request, summaryPayload)
    else await h.resolve(request, { requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0 })
  }
  assert.equal(document.querySelector('[aria-label="교재 331 본관 실사 수량"]')?.value, "8")
  assert.equal(document.querySelector('[aria-label="교재 331 본관 실사 메모"]')?.value, "나중에 고친 메모")

  await h.act(() => document.querySelector('[aria-label="교재 331 본관 8권 반영"]').click())
  const nextBalance = h.requests.findLast((request) => request.name === "get_textbook_inventory_balance_v1")
  await h.resolve(nextBalance, { locationId, rows: [{ textbookId: source.id, currentQuantity: 10, locationQuantities: { [locationId]: 10 }, studentLocationQuantities: { [locationId]: 10 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 10, studentQuantity: 10, teacherQuantity: 0, stockValue: 100000 }] })
  const nextCountWrite = h.requests.findLast((request) => request.name === "create_textbook_stock_count_v1")
  assert.notEqual(nextCountWrite.args.p_request_id, countWrite.args.p_request_id, "a changed quantity or memo starts a new count intent")
  await h.resolve(nextCountWrite, stockCountResult(nextCountWrite))
  const nextRefreshes = h.requests.slice(h.requests.indexOf(nextCountWrite) + 1).filter((request) => request.name)
  for (const request of nextRefreshes) {
    if (request.name === "list_textbook_inventory_page_v1") await h.resolve(request, pagePayload)
    else if (request.name === "list_textbook_inventory_history_page_v1") await h.resolve(request, { rows: [], page: 1, pageSize: 10, totalCount: 0 })
    else if (request.name === "get_textbook_inventory_summary_v1") await h.resolve(request, summaryPayload)
    else await h.resolve(request, { requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0 })
  }
  const postSuccessRequests = h.requests.slice(h.requests.indexOf(nextRefreshes.at(-1)) + 1).filter((request) => request.name)
  for (const request of postSuccessRequests) {
    if (request.name === "list_textbook_inventory_page_v1") await h.resolve(request, pagePayload)
    else if (request.name === "get_textbook_inventory_summary_v1") await h.resolve(request, summaryPayload)
  }
  assert.equal(document.querySelector('[aria-label="교재 331 본관 실사 수량"]')?.value, "", "an unchanged successful quantity draft clears")
  assert.equal(document.querySelector('[aria-label="교재 331 본관 실사 메모"]')?.value, "", "the same unchanged successful memo draft clears")
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
    await h.assertNoLegacyReads()
    assert.equal(document.body.textContent.includes("교재 101"), true)
    assert.deepEqual(preparedRowIds(`${tab}-mobile`), rows.map((row) => row.id))
    assert.deepEqual(preparedRowIds(`${tab}-desktop`), rows.map((row) => row.id))
    assert.ok(document.querySelector(`[aria-label="${pagerLabel}"]`))
    if (tab === "purchase") {
      await h.act(() => button("주문 문서 메뉴").dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      await h.act(() => document.querySelector('[role="menuitem"][aria-label="공급처별 주문 전달 열기"]').click())
      const handoff = h.requests.find((request) => request.name === "get_textbook_purchase_handoff_context_v1")
      assert.ok(handoff)
      assert.equal(handoff.args.p_kind, "order")
      assert.deepEqual(handoff.args.p_filters, page.args.p_filters)
      await h.resolve(handoff, completePurchaseHandoffWire(12))
      assert.equal(document.body.textContent.includes("12건"), true, "purchase document exposes its complete filtered source count, not the two visible rows")
    }
  })
}

test("paired purchase columns preserve all six quantities, authoritative totals and next actions", async (t) => {
  const retiredPreferences = { textbook: false, status: false, requested: false, ordered: false, received: false, supplier: false, classLocation: false }
  const h = await setup(t, { search: "?textbookTab=purchase", localStorage: { "textbook-purchase-process-order": retiredPreferences } })
  const row = purchaseRow('order')
  const amounts = { student: { requested: 17, ordered: 13, received: 5 }, teacher: { requested: 3, ordered: 2, received: 1 } }
  row.lines = row.lines.map(line => ({ ...line, requested_quantity: amounts[line.copy_scope].requested, ordered_quantity: amounts[line.copy_scope].ordered, received_quantity: amounts[line.copy_scope].received }))
  row.line = { ...row.lines[0], purchaseScopeLines: row.lines }
  row.quantities = { requested: 20, ordered: 15, received: 6, ...amounts }
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [row], page: 1, pageSize: 10, totalCount: 1 })
  for (const surface of ['purchase-desktop', 'purchase-mobile']) {
    const rendered = document.querySelector(`[data-prepared-surface="${surface}"]`)
    assert.equal(rendered.querySelectorAll('[data-quantity-stage]').length, 3)
    for (const [stage, label] of [['requested', '요청'], ['ordered', '주문'], ['received', '입고']]) {
      const cell = rendered.querySelector(`[data-quantity-stage="${stage}"]`)
      for (const [scope, scopeLabel] of [['student', '학생용'], ['teacher', '교사용']]) {
        assert.equal(cell.querySelector(`[data-copy-scope="${scope}"]`).getAttribute('aria-label'), `${scopeLabel} ${label} ${amounts[scope][stage]}`)
      }
    }
    assert.ok(rendered.querySelector('[aria-label="교재 101 주문"]'))
    assert.equal(rendered.textContent.includes('14권 여유'), false, 'roster-based quantity judgments are retired')
    assert.equal(rendered.textContent.includes('수업 미선택'), false)
    assert.equal(rendered.querySelector('[aria-label="교재 101 주문·입고 건 삭제"]'), null, 'destructive action is behind the menu')
    assert.ok(rendered.querySelector('[aria-label="교재 101 주문·입고 더보기"]'))
  }
  const table = document.querySelector('[data-prepared-surface="purchase-desktop"]').closest('table')
  assert.deepEqual([...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim()), ["", "교재", "진행상태", "요청", "주문", "입고", "총판 · 단가", "수업 · 위치", "작업"])
  assert.equal(Number(table.getAttribute('aria-colcount')), table.querySelectorAll('thead th').length)
  assert.equal(renderedColumnCount(table.querySelector('[data-prepared-surface="purchase-desktop"]')), 9)
  assert.deepEqual(JSON.parse(window.localStorage.getItem("textbook-purchase-process-order")), retiredPreferences)
  assert.equal(button("컬럼 구성"), undefined)
  assert.equal(table.querySelector('tbody tr:last-child [aria-label="학생용 요청 합계 집계 확인 필요"]') !== null, true, 'unavailable aggregate is not fabricated from the visible row')
  const totals = { requested: 107, ordered: 94, received: 61, student: { requested: 100, ordered: 90, received: 60 }, teacher: { requested: 7, ordered: 4, received: 1 } }
  const summary = purchaseSummary('order', 9)
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), { ...summary, quantities: totals, groups: [{ ...summary.groups[0], quantities: totals }] })
  assert.ok(table.querySelector('[aria-label="학생용 요청 합계 100"]'))
  assert.ok(table.querySelector('[aria-label="교사용 입고 합계 1"]'))
  assert.equal(renderedColumnCount(table.querySelector('tbody tr:last-child')), Number(table.getAttribute('aria-colcount')))
  await h.assertNoLegacyReads()
})

test("teachers retain request creation without purchase row management menus", async (t) => {
  const h = await setup(t, { search: '?textbookTab=requests', auth: { role: 'teacher', isTeacher: true, isAdmin: false, isStaff: false, canManageAll: false } })
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_purchase_page_v1'), { rows: [purchaseRow('request')], page: 1, pageSize: 10, totalCount: 1 })
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_purchase_summary_v1'), purchaseSummary('request'))
  assert.ok(document.querySelector('[aria-label="교재 요청 추가"]'))
  assert.equal(document.querySelector('[aria-label="교재 101 요청 더보기"]'), null)
  assert.equal(document.querySelector('[aria-label="교재 101 요청 수정"]'), null)
  assert.equal(document.querySelector('[aria-label="주문 문서 메뉴"]'), null)
  await h.assertNoLegacyReads()
})

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
  await h.assertNoLegacyReads()

  assert.equal(document.body.textContent.includes("요청 99"), true)
  assert.equal(document.body.textContent.includes("주문 20"), true)
  assert.equal(document.body.textContent.includes("입고 10"), true)
  assert.equal(document.querySelector('[aria-label^="주문 필요 그룹"]').getAttribute('aria-label').includes('31건'), true)
  assert.equal(document.querySelector('[aria-label^="주문 필요 그룹"]').getAttribute('aria-label').includes('요청 99'), true)
  for (const [label, expected] of [['주문·입고 범위', '전체73'], ['주문·입고 단계', '부분입고44'], ['주문·입고 교재 등록', '미등록 요청23']]) {
    const options = await openFilter(h, label)
    assert.ok(options.some(node => node.textContent === expected))
    await closeFilter(h)
  }
})

test("master and inventory controls use summary counts plus authoritative reference options", async (t) => {
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
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_options_v1"), {
    publisherOptions: [], subSubjectOptions: [], categoryOptions: ["서비스 목록 분류"], bulkCategoryOptions: [], scienceSubjectAreas: [],
    counts: { publisherOptions: 0, subSubjectOptions: 0, categoryOptions: 1, bulkCategoryOptions: 0, scienceSubjectAreas: 0 }, complete: true,
  })
  await h.assertNoLegacyReads()

  assert.equal(document.querySelector('[aria-label="교재 재고 상태"]'), null)
  assert.equal(document.querySelector('[aria-label="교재 정리 상태"]'), null)
  assert.equal(document.querySelector('[aria-label="교재관리 할 일 보기"]'), null)
  assert.equal([...document.querySelectorAll('button')].some((node) => node.textContent.includes('대기') && node.textContent.includes('7')), false)
  await h.act(() => document.querySelector('[aria-label="교재 세부과목 필터"]').click())
  assert.equal(document.body.textContent.includes("서비스 목록 분류"), true)
  assert.equal(document.body.textContent.includes("서버 세부과목"), false)
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
  await h.assertNoLegacyReads()

  assert.ok(document.querySelector('[aria-label="교재 출고 이력"]'))
  assert.ok(document.querySelector('[aria-label="출고 이력 연도"]'))
  assert.ok(document.querySelector('[aria-label="교재 출고 목록"]'))
  assert.equal(document.querySelector('[aria-label="출고 상태"]').textContent, "반품")
  await openFilter(h, "출고 상태")
  assert.equal([...document.querySelectorAll('[role=option]')].some((node) => node.textContent.includes('전체 출고') && node.textContent.includes('4')), true)
  assert.equal([...document.querySelectorAll('[role=option]')].some((node) => node.textContent.includes('출고 대기') && node.textContent.includes('2')), true)
  await closeFilter(h)
})

test("sale-history summary failure is visible and retryable independently of the sales summary", async (t) => {
  const h = await setup(t, { search: "?textbookTab=sales&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_summary_v1"), saleSummary(0))
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1"), { rows: [saleHistoryRow()], page: 1, pageSize: 10, totalCount: 1 })
  await h.reject(h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1"), { message: "history summary failed" })
  await h.assertNoLegacyReads()

  const historyFeedback = document.querySelector('[aria-label="교재 출고 이력"] [role="alert"]')
  assert.ok(historyFeedback)
  assert.equal(historyFeedback.textContent.includes("출고 이력 조회 실패"), true)
  assert.equal(historyFeedback.textContent.includes("처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요."), true)
  assert.equal(historyFeedback.textContent.includes("history summary failed"), false)
  await h.act(() => document.querySelector('[aria-label="출고 이력 다시 시도"]').click())
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
  await h.assertNoLegacyReads()
  assert.equal(document.body.textContent.includes("교재 101"), true)
  assert.equal(document.body.textContent.includes("김선생"), true)
  assert.deepEqual(preparedRowIds("sales-process-mobile"), rows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("sales-process-desktop"), rows.map((row) => row.id))
  assert.deepEqual(preparedRowIds("sales-history"), historyRows.map((row) => row.id))
  const processTable = document.querySelector('[data-prepared-surface="sales-process-desktop"]').closest("table")
  assert.deepEqual([...processTable.querySelectorAll("thead th")].map((cell) => cell.textContent.trim()), ["", "교재", "대상", "진행상태", "수량", "수업 · 위치", "작업"])
  assert.equal(renderedColumnCount(processTable.querySelector('[data-prepared-surface="sales-process-desktop"]')), 7)
  assert.equal(renderedColumnCount(processTable.querySelector("tbody tr:last-child")), 7)
  assert.ok(document.querySelector('[aria-label="출고 이력 페이지 탐색"]'))
  assert.ok(document.querySelector('[aria-label="교재 출고 페이지 탐색"]'))
  await h.act(() => button("메이크에듀 청구 준비 열기").click())
  const billing = h.requests.find((request) => request.name === "get_textbook_billing_handoff_context_v1")
  assert.ok(billing)
  assert.deepEqual(billing.args.p_filters, page.args.p_filters)
  await h.resolve(billing, completeBillingHandoffWire(12))
  assert.equal(document.body.textContent.includes("12건"), true, "billing document exposes its complete filtered source count, not the two visible rows")
})

test("single inventory response-loss retry reuses the original request and accepts its committed balance", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((r) => r.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const source = masterRow(381, { locationQuantities: { [locationId]: 10 }, studentLocationQuantities: { [locationId]: 10 }, teacherLocationQuantities: {}, totalQuantity: 10, studentQuantity: 10, teacherQuantity: 0, stockValue: 100000,
    locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 10 }] })
  const row = { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 10, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  const page = { rows: [row], page: 1, pageSize: 10, totalCount: 1 }
  const summary = masterSummary(1, { auditCounts: { all: 1, recommended: 1, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] })
  await h.resolve(h.requests.find((r) => r.name === "list_textbook_inventory_page_v1"), page)
  await h.resolve(h.requests.find((r) => r.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((r) => r.name === "get_textbook_inventory_summary_v1"), summary)
  const input = document.querySelector('[aria-label="교재 381 본관 실사 수량"]')
  await h.act(() => input[Object.keys(input).find((k) => k.startsWith("__reactProps$"))].onChange({ target: { value: "7" } }))
  const balance = (quantity) => ({ locationId, rows: [{ textbookId: source.id, currentQuantity: quantity, locationQuantities: { [locationId]: quantity }, studentLocationQuantities: { [locationId]: quantity }, teacherLocationQuantities: {}, totalQuantity: quantity, studentQuantity: quantity, teacherQuantity: 0, stockValue: quantity * 10000 }] })
  await h.act(() => document.querySelector('[aria-label="교재 381 본관 7권 반영"]').click())
  await h.resolve(h.requests.findLast((r) => r.name === "get_textbook_inventory_balance_v1"), balance(10))
  const first = h.requests.findLast((r) => r.name === "create_textbook_stock_count_v1")
  const committed = stockCountResult(first)
  await h.reject(first, { code: "", message: "TypeError: Failed to fetch" })
  assert.equal(input.value, "7", "unknown outcome keeps the user's draft for replay")
  await h.act(() => document.querySelector('[aria-label="교재 381 본관 7권 반영"]').click())
  await h.resolve(h.requests.findLast((r) => r.name === "get_textbook_inventory_balance_v1"), balance(7))
  const retry = h.requests.findLast((r) => r.name === "create_textbook_stock_count_v1")
  assert.equal(retry.args.p_request_id, first.args.p_request_id)
  assert.equal(retry.args.p_counted_at, first.args.p_counted_at)
  assert.equal(retry.args.p_expected_quantity, 7)
  await h.resolve(retry, committed)
  const settleReads = async (requests) => {
    for (const request of requests) {
      if (request.name === "list_textbook_inventory_page_v1") await h.resolve(request, page)
      else if (request.name === "list_textbook_inventory_history_page_v1") await h.resolve(request, { rows: [], page: 1, pageSize: 10, totalCount: 0 })
      else if (request.name === "get_textbook_inventory_summary_v1") await h.resolve(request, summary)
      else await h.resolve(request, { requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0 })
    }
  }
  const refreshes = h.requests.slice(h.requests.indexOf(retry) + 1)
  await settleReads(refreshes)
  await settleReads(h.requests.slice(h.requests.indexOf(refreshes.at(-1)) + 1))
  assert.equal(document.querySelector('[aria-label="교재 381 본관 실사 수량"]')?.value, "", "confirmed replay acknowledges the original draft")
  assert.equal(h.requests.some((r) => r.table), false, "save and retry each remain one atomic RPC")
})

test("bulk inventory stops remaining writes when the actor leaves during the first transaction", async (t) => {
  const h = await setup(t, { search: "?textbookTab=inventory&textbookPage=1&textbookPageSize=10" })
  const locationId = id(900)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [{ value: locationId, label: "본관", searchText: "본관 main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: locationId, code: "main", name: "본관" },
  })
  const makeRow = (n) => {
    const source = masterRow(n, { locationQuantities: { [locationId]: 3 }, studentLocationQuantities: { [locationId]: 3 }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 3, studentQuantity: 3, teacherQuantity: 0, stockValue: 30000,
      locationSummary: [{ id: locationId, code: "main", name: "본관", sortOrder: 1, quantity: 3 }] })
    return { source, id: source.id, title: source.title, publisher: "출판사", locationId, locationName: "본관", currentQuantity: 3, latestCountAt: "", daysSinceLatestCount: null, isCountedThisCycle: false, isRecommended: true, status: "recommended", reason: "실사 필요", dueLabel: "지금" }
  }
  const rows = [makeRow(341), makeRow(342)]
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_page_v1"), { rows, page: 1, pageSize: 10, totalCount: 2 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_inventory_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_inventory_summary_v1"), masterSummary(2, { auditCounts: { all: 2, recommended: 2, pending: 0, done: 0 }, locations: [{ id: locationId, code: "main", name: "본관", sortOrder: 1 }] }))
  for (const [row, quantity, memo] of [[rows[0], "7", "A 메모"], [rows[1], "8", "B 메모"]]) {
    const quantityInput = document.querySelector(`[aria-label="${row.title} 본관 실사 수량"]`)
    const memoInput = document.querySelector(`[aria-label="${row.title} 본관 실사 메모"]`)
    await h.act(() => quantityInput[Object.keys(quantityInput).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: quantity } }))
    await h.act(() => memoInput[Object.keys(memoInput).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: memo } }))
    await h.act(() => document.querySelector(`[aria-label="${row.title} 본관 재고 선택"]`).click())
  }
  await h.act(() => document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').click())
  const balance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1")
  await h.resolve(balance, { locationId, rows: rows.map((row, index) => ({ textbookId: row.id, currentQuantity: 10 + index, locationQuantities: { [locationId]: 10 + index }, studentLocationQuantities: { [locationId]: 10 + index }, teacherLocationQuantities: { [locationId]: 0 }, totalQuantity: 10 + index, studentQuantity: 10 + index, teacherQuantity: 0, stockValue: (10 + index) * 10000 })) })

  const firstCount = h.requests.find((request) => request.name === "create_textbook_stock_count_v1")
  await h.auth({ user: null, role: null, isAdmin: false, isStaff: false, canManageAll: false })
  await h.resolve(firstCount, stockCountResult(firstCount))
  assert.equal(h.requests.filter((request) => request.name === "create_textbook_stock_count_v1").length, 1,
    "an old batch cannot submit its remaining rows under a different authenticated session")
})


test("textbook tabs keep arrow-key exploration separate from an activated remote workflow", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const master = document.querySelector('[role="tab"][aria-label="교재 재고"]')
  const requests = document.querySelector('[role="tab"][aria-label="요청"]')
  const panel = document.getElementById(master.getAttribute('aria-controls'))
  assert.equal(panel?.getAttribute('role'), 'tabpanel', 'initial loading retains its accessible panel')
  const before = h.requests.length
  await h.act(async () => {
    master.focus()
    master.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 5))
  })
  assert.equal(document.activeElement, requests)
  assert.equal(master.getAttribute('aria-selected'), 'true')
  assert.equal(h.requests.length, before, 'focus does not dispatch another workflow read')
  await h.act(() => requests.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(requests.getAttribute('aria-selected'), 'true')
  assert.equal(h.requests.some(request => request.name === 'list_textbook_purchase_page_v1' && request.args.p_filters.mode === 'request'), true)
  assert.equal(document.getElementById(requests.getAttribute('aria-controls'))?.getAttribute('role'), 'tabpanel')
  await h.assertNoLegacyReads()
})

test("inactive catalog toggle resets paging and selection while retaining search and classification", async (t) => {
  const filters = { ...masterFilters, search: "", subject: "english" }
  const h = await setup(t, { search: `?${new URLSearchParams({ textbookTab: "master", textbookPage: "2", textbookPageSize: "10", textbookFilters: JSON.stringify(filters) })}` })
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_master_page_v1'), {
    rows: Array.from({ length: 10 }, (_, index) => masterRow(index + 11)), page: 2, pageSize: 10, totalCount: 25,
  })
  await h.resolve(h.requests.find(request => request.name === 'get_textbook_master_summary_v1'), masterSummary(25))
  await h.act(() => document.querySelector('[data-testid="textbook-master-desktop-row-' + id(11) + '"] [role="checkbox"]').click())
  assert.ok(document.querySelector('[aria-label="선택한 교재 일괄 작업"]'))
  await h.act(() => document.querySelector('[aria-label="선택 교재 선택 해제"]').click())
  const toggle = document.querySelector('[aria-label="미사용 교재 보기"]')
  assert.equal(toggle.getAttribute('aria-pressed'), 'false')
  await h.act(() => toggle.click())
  let request = h.requests.findLast(request => request.name === 'list_textbook_master_page_v1')
  assert.equal(request.args.p_page, 1)
  assert.deepEqual(request.args.p_filters, { ...filters, quality: 'inactive' })
  assert.equal(toggle.getAttribute('aria-pressed'), 'true')
  assert.equal(document.querySelectorAll('[data-prepared-surface="master-desktop"] [role="checkbox"][data-state="checked"]').length, 0)
  await h.resolve(request, { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  assert.equal(document.querySelector('[aria-label="미사용 교재 보기"]'), toggle, 'empty archive keeps its return control')
  await h.act(() => toggle.click())
  request = h.requests.findLast(request => request.name === 'list_textbook_master_page_v1')
  assert.deepEqual(request.args.p_filters, filters)
  assert.equal(request.args.p_page, 1)
  assert.equal(h.requests.some(request => request.table), false)
})

test("retired catalog bookmarks normalize before the first read and external navigation", async (t) => {
  const oldFilters = { ...masterFilters, quality: 'missingCode', inventory: 'shortage' }
  const params = new URLSearchParams({ textbookTab: 'master', textbookPage: '8', textbookPageSize: '20', textbookFilters: JSON.stringify(oldFilters), unrelated: 'keep' })
  const h = await setup(t, { search: `?${params}` })
  let request = h.requests.find(request => request.name === 'list_textbook_master_page_v1')
  assert.equal(request.args.p_page, 1)
  assert.equal(request.args.p_page_size, 20)
  assert.deepEqual(request.args.p_filters, masterFilters)
  await h.resolve(request, { rows: [], page: 1, pageSize: 20, totalCount: 0 })
  assert.equal(document.querySelector('[aria-label="교재관리 할 일 보기"]'), null)
  assert.equal(document.querySelector('[aria-label="교재 재고 상태"]'), null)
  assert.equal(document.querySelector('[aria-label="교재 정리 상태"]'), null)
  assert.equal(document.querySelectorAll('[aria-label="교재관리 새로고침"]').length, 1)
  params.set('textbookFilters', JSON.stringify({ ...oldFilters, quality: 'inactive', inventory: 'surplus' }))
  await h.navigate(`?${params}`)
  request = h.requests.findLast(request => request.name === 'list_textbook_master_page_v1')
  assert.equal(request.args.p_page, 1)
  assert.deepEqual(request.args.p_filters, { ...masterFilters, quality: 'inactive' })
  await h.assertNoLegacyReads()
})

test("interleaved subject groups keep unique identities when an accepted master page changes", async (t) => {
  const errors = []
  const previousError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')); previousError(...args) }
  t.after(() => { console.error = previousError })
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  const mixedRows = (start) => Array.from({ length: 10 }, (_, index) => masterRow(start + index, { subject: index % 2 ? 'math' : 'english' }))
  const first = mixedRows(300)
  await h.resolve(h.requests.find(request => request.name === 'list_textbook_master_page_v1'), { rows: first, page: 1, pageSize: 10, totalCount: 20 })
  await h.act(() => document.querySelector('[aria-label="2 페이지"]').click())
  const second = mixedRows(400)
  await h.resolve(h.requests.findLast(request => request.name === 'list_textbook_master_page_v1'), { rows: second, page: 2, pageSize: 10, totalCount: 20 })
  assert.deepEqual(preparedRowIds('master-desktop'), second.map(row => row.id))
  assert.deepEqual(preparedRowIds('master-mobile'), second.map(row => row.id))
  assert.equal(errors.some(message => message.includes('same key')), false, 'repeated subject labels must not collide across contiguous groups')
})

test('sale selection reuses unchanged display data and refreshed records invalidate it', async t => {
  const h = await setup(t, {search:'?textbookTab=sales&textbookPage=1&textbookPageSize=10'});
  const model = h.load('src/features/textbooks/textbook-read-model.ts');
  const original = model.getTextbookById;
  let lookups = 0;
  model.getTextbookById = (...args) => { lookups++; return original(...args); };
  const rows = [saleRow(0),saleRow(1)];
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_sale_page_v1'),{rows,page:1,pageSize:10,totalCount:2});
  assert.match(document.querySelector('[aria-label="교재 출고 목록"]').textContent,/집계 확인 필요/,'unavailable summary must not be shown as zero');
  await h.resolve(h.requests.find(r=>r.name==='get_textbook_sale_summary_v1'),saleSummary(2));
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_sale_history_page_v1'),{rows:[],page:1,pageSize:10,totalCount:0});
  await h.resolve(h.requests.find(r=>r.name==='get_textbook_sale_history_summary_v1'),{...saleHistorySummary(0),yearOptions:[],monthOptions:[],classOptions:[]});
  assert.equal(document.querySelector('[aria-label="출고 이력 페이지 탐색"]'),null,'no orphaned pager for an empty history');
  const requests = h.requests.length;
  lookups = 0;
  await h.act(()=>document.querySelector('[data-prepared-surface="sales-process-desktop"] [role="checkbox"]').click());
  assert.equal(lookups,0,'changing selection must not recompute unchanged display references');
  assert.equal(h.requests.length,requests);
  for(const surface of ['sales-process-mobile','sales-process-desktop']) assert.deepEqual(preparedRowIds(surface),rows.map(r=>r.id));
  await h.act(()=>button('교재관리 새로고침').click());
  const refreshed = rows.map(r=>({...r,textbook:{...r.textbook,title:'수정한 긴 교재명',name:'수정한 긴 교재명'}}));
  await h.resolve(h.requests.findLast(r=>r.name==='list_textbook_sale_page_v1'),{rows:refreshed,page:1,pageSize:10,totalCount:2});
  assert.ok(lookups>0,'new data must invalidate the cached display values');
  for(const surface of ['sales-process-mobile','sales-process-desktop']) assert.match(document.querySelector(`[data-prepared-surface="${surface}"]`).textContent,/수정한 긴 교재명/);
  await h.assertNoLegacyReads();
});

test('sale more menu keeps cancellation behind its existing fresh-read boundary', async t => {
  const h = await setup(t,{search:'?textbookTab=sales'});
  const row = saleRow();
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_sale_page_v1'),{rows:[row],page:1,pageSize:10,totalCount:1});
  const more=document.querySelector('[data-prepared-surface="sales-process-desktop"] [aria-label="김선생 교재 101 출고 더보기"]');
  await h.act(()=>more.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  assert.ok(document.querySelector('[role="menuitem"][aria-label="김선생 교재 101 출고 전 취소"]'));
  assert.equal(document.querySelector('[role="menuitem"][aria-label="김선생 교재 101 고객 반품"]'),null);
  assert.equal(h.requests.some(r=>r.table),false);
  await h.act(()=>document.querySelector('[role="menuitem"][aria-label="김선생 교재 101 출고 전 취소"]').click());
  assert.ok(h.requests.some(r=>r.name==='get_textbook_sale_detail_v1'));
  assert.equal(h.requests.some(r=>r.table),false,'menu selection still requires a fresh detail before any writer');
});

test('inventory mobile selection and zero count share the desktop draft and block repeated Enter while saving', async t => {
  const h = await setup(t,{search:'?textbookTab=inventory'});
  const locationId=id(900);
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_location_reference_page_v1'),{rows:[{value:locationId,label:'본관',searchText:'본관 main'}],page:1,pageSize:20,totalCount:1,defaultLocation:{id:locationId,code:'main',name:'본관'}});
  const source=masterRow(399,{locationQuantities:{[locationId]:3},studentLocationQuantities:{[locationId]:3},teacherLocationQuantities:{},totalQuantity:3,studentQuantity:3,stockValue:30000,locationSummary:[{id:locationId,code:'main',name:'본관',sortOrder:1,quantity:3}]});
  const row={source,id:source.id,title:source.title,publisher:source.publisher,locationId,locationName:'본관',currentQuantity:3,latestCountAt:'',daysSinceLatestCount:null,isCountedThisCycle:false,isRecommended:true,status:'recommended',reason:'실사 필요',dueLabel:'지금'};
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_inventory_page_v1'),{rows:[row],page:1,pageSize:10,totalCount:1});
  await h.resolve(h.requests.find(r=>r.name==='get_textbook_inventory_summary_v1'),masterSummary(1,{locations:[{id:locationId,code:'main',name:'본관',sortOrder:1}],auditCounts:{all:1,recommended:1,pending:1,done:0}}));
  const props=e=>e[Object.keys(e).find(k=>k.startsWith('__reactProps$'))];
  const mobile=()=>document.querySelector('[data-prepared-surface="inventory-mobile"]');
  const quantity=()=>mobile().querySelector('input[aria-label$="실사 수량"]');
  const memo=()=>mobile().querySelector('input[aria-label$="실사 메모"]');
  const bulkApply=document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]');
  assert.ok(bulkApply);
  assert.equal(bulkApply.disabled,true);
  assert.match(document.querySelector('[aria-label="재고 실사 목록"] table').className,/min-w-\[1164px\]/);
  await h.act(()=>mobile().querySelector('[role="checkbox"]').click());
  assert.equal(document.querySelector('[data-prepared-surface="inventory-desktop"] [role="checkbox"]').getAttribute('data-state'),'checked');
  await h.act(()=>props(quantity()).onChange({target:{value:'0'}}));
  await h.act(()=>props(memo()).onChange({target:{value:'수량 없음 확인'}}));
  assert.equal(document.querySelector('[data-prepared-surface="inventory-desktop"] input[aria-label$="실사 수량"]').value,'0');
  assert.match(mobile().textContent,/차이 -3/);
  assert.equal(document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').disabled,false);
  const pressEnter=()=>props(quantity()).onKeyDown({key:'Enter',preventDefault(){}});
  await h.act(pressEnter);
  const balance=h.requests.find(r=>r.name==='get_textbook_inventory_balance_v1');
  assert.ok(balance);
  assert.equal(mobile().querySelector('[aria-label$="반영 중"]').disabled,true);
  await h.act(pressEnter);
  assert.equal(h.requests.filter(r=>r.name==='get_textbook_inventory_balance_v1').length,1);
  assert.equal(h.requests.some(r=>r.name==='create_textbook_stock_count_v1'),false);
  await h.reject(balance,{message:'합성 재고 조회 실패'});
  assert.equal(quantity().value,'0');
  assert.equal(memo().value,'수량 없음 확인');
  assert.equal(mobile().querySelector('[role="checkbox"]').getAttribute('data-state'),'checked');
  await h.act(()=>mobile().querySelector('[aria-label$="실사 입력 초기화"]').click());
  assert.equal(quantity().value,'');
  assert.equal(memo().value,'');
  assert.equal(document.querySelector('[aria-label="선택 재고 실사 일괄 반영"]').disabled,true);
  await h.act(()=>mobile().querySelector('[aria-label$="현재 수량 입력"]').click());
  assert.equal(quantity().value,'3');
  assert.equal(h.requests.some(r=>r.table || r.name==='create_textbook_stock_count_v1'),false);
});

test('retired closing bookmarks return to stock page one and discard closing-only navigation', async t => {
  const params=new URLSearchParams({textbookTab:'closing',textbookPage:'7',textbookPageSize:'15',textbookFilters:JSON.stringify({month:'2026-08',subject:'science',status:'locked'}),textbookDetailKind:'closing',textbookDetail:id(700),textbookMovementPage:'4',textbookMovementPageSize:'20',textbookMovementSearch:'교재',selectedClosingIds:id(700),unrelated:'keep'});
  const parsed=parseTextbookNavigation(params);
  assert.equal(parsed.tab,'master');
  assert.equal(parsed.primary.page,1);
  assert.equal(parsed.primary.pageSize,15);
  assert.equal(parsed.detail,null);
  const serialized=serializeTextbookNavigation(params,parsed);
  for(const key of ['textbookDetail','textbookDetailKind','textbookMovementPage','textbookMovementPageSize','textbookMovementSearch','selectedClosingIds']) assert.equal(serialized.has(key),false,key);
  assert.equal(serialized.get('unrelated'),'keep');
  const h=await setup(t,{search:`?${params}`});
  const page=h.requests.find(r=>r.name==='list_textbook_master_page_v1');
  assert.equal(page.args.p_page,1);
  assert.equal(page.args.p_page_size,15);
  await h.resolve(page,{rows:[masterRow(1)],page:1,pageSize:15,totalCount:1});
  assert.equal(document.querySelector('[role="tab"][aria-label="교재 재고"]').getAttribute('aria-selected'),'true');
  assert.equal(document.querySelector('[role="tab"][aria-label="정산"]'),null);
  assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(h.requests.some(r=>/closing/.test(r.name||'')||r.table),false);
  await h.popstate(`?textbookTab=master&textbookDetailKind=closing&textbookDetail=${id(701)}&textbookMovementSearch=legacy`);
  assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(h.requests.some(r=>/closing/.test(r.name||'')),false);
  await h.assertNoLegacyReads();
});

test('request table ignores retired column preferences and keeps its fixed workflow columns aligned', async t => {
  const retiredPreferences={decision:true,requester:false,requested:false,textbook:false};
  const h=await setup(t,{search:'?textbookTab=requests',localStorage:{'textbook-purchase-process-request':retiredPreferences}});
  const row=purchaseRow('request');
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_purchase_page_v1'),{rows:[row],page:1,pageSize:10,totalCount:1});
  await h.resolve(h.requests.find(r=>r.name==='get_textbook_purchase_summary_v1'),purchaseSummary('request',1));
  for(const surface of ['requests-mobile','requests-desktop']){
    const element=document.querySelector(`[data-prepared-surface="${surface}"]`);
    assert.ok(element.querySelector('[aria-label="학생용 요청 2"]'));
    assert.ok(element.querySelector('[aria-label="교사용 요청 2"]'));
    assert.doesNotMatch(element.textContent,/판단|\d+권 부족|\d+권 여유|수량 일치/);
  }
  const table=document.querySelector('[data-prepared-surface="requests-desktop"]').closest('table');
  assert.deepEqual([...table.querySelectorAll('thead th')].map(cell=>cell.textContent.trim()),['교재','요청','요청자','수업 · 위치','작업']);
  assert.equal(table.querySelector('[data-prepared-surface="requests-desktop"]').querySelectorAll('td').length,5);
  assert.equal(table.querySelector('tbody tr:last-child').querySelectorAll('td').length,5);
  assert.match(table.querySelector('[data-prepared-surface="requests-desktop"]').textContent,/선생님/);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('textbook-purchase-process-request')),retiredPreferences);
  assert.equal(button('컬럼 구성'),undefined);
  assert.equal(h.requests.some(r=>r.table||/closing/.test(r.name||'')),false);
});

test('inventory counts use all books without heuristic filters or badges and preserve zero drafts', async t => {
  const h=await setup(t,{search:'?textbookTab=inventory'});
  const locationId=id(900);
  await h.resolve(h.requests.find(r=>r.name==='list_textbook_location_reference_page_v1'),{rows:[{value:locationId,label:'본관',searchText:'본관 main'}],page:1,pageSize:20,totalCount:1,defaultLocation:{id:locationId,code:'main',name:'본관'}});
  const page=h.requests.find(r=>r.name==='list_textbook_inventory_page_v1');
  assert.equal(page.args.p_filters.audit,'all');
  const source=masterRow(331,{totalQuantity:3,studentQuantity:3,stockValue:30000,locationQuantities:{[locationId]:3},studentLocationQuantities:{[locationId]:3},teacherLocationQuantities:{}});
  const row={source,id:source.id,title:source.title,publisher:source.publisher,locationId,locationName:'본관',currentQuantity:3,latestCountAt:'',daysSinceLatestCount:null,isCountedThisCycle:false,isRecommended:true,status:'recommended',reason:'재고 부족 권장',dueLabel:'지금'};
  await h.resolve(page,{rows:[row],page:1,pageSize:10,totalCount:1});
  await h.resolve(h.requests.find(r=>r.name==='get_textbook_inventory_summary_v1'),masterSummary(1,{auditCounts:{all:1,recommended:1,pending:1,done:0},locations:[{id:locationId,code:'main',name:'본관',sortOrder:1}]}));
  const countRegion=document.querySelector('[aria-label="재고 실사 입력"]');
  assert.doesNotMatch(countRegion.textContent,/실사 권장|재고 부족 권장|실사 대기|지금/);
  assert.equal([...countRegion.querySelectorAll('button')].some(el=>['전체','대기','완료'].includes(el.textContent.trim())),false);
  const input=countRegion.querySelector('[aria-label="교재 331 본관 실사 수량"]');
  await h.act(()=>input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:'0'}}));
  assert.ok(countRegion.querySelector('[aria-label="교재 331 본관 0권 반영"]'));
  assert.match(countRegion.textContent,/-3/);
  assert.equal(h.requests.some(r=>r.table||r.name==='create_textbook_stock_count_v1'),false);
  await h.assertNoLegacyReads();
});
