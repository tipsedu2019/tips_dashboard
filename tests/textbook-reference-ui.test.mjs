import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { button, id, masterRow, masterSummary, purchaseRow, purchaseSummary, saleHistorySummary, saleSummary, setup, setupReferenceHook } from "./helpers/textbook-numbered-harness.mjs"

const actor = { viewerId: id(804), viewerRole: "admin", authReady: true, managementEnabled: true }
const facetGroups = (count) => [
  { key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"], options: [{ value: "english", label: "영어", count }] },
  { key: "grade", label: "학년", options: [{ value: "m2", label: "중2", count }] },
  { key: "subSubject", label: "세부과목", options: [{ value: "grammar", label: "문법", count }] },
]
const bookOption = (n) => ({
  value: id(n), label: `서버 교재 ${n}`, description: "출판사", searchText: `서버 교재 ${n} 출판사`,
  metaRows: [{ label: "과목", value: "영어" }],
  filterValues: {
    subject: [{ value: "english", label: "영어" }],
    grade: [{ value: "m2", label: "중2" }],
    subSubject: [{ value: "grammar", label: "문법" }],
  },
})
const workContextSource = readFileSync(new URL("./textbook-work-context.test.mjs", import.meta.url), "utf8")
const finalWireLiteral = workContextSource.match(/const finalTask5b2WirePayload = (".*");/)?.[1]
assert.ok(finalWireLiteral, "accepted Task5b2 wire remains available")
const classSaleWire = JSON.parse(JSON.parse(finalWireLiteral)).data

const classGroups = (count) => [
  { key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"], options: [{ value: "english", label: "영어", count }] },
  { key: "grade", label: "학년", options: [{ value: "m2", label: "중2", count }] },
  { key: "teacher", label: "선생님", options: [{ value: "teacher", label: "담당", count }] },
]
const classOption = {
  value: classSaleWire.input.classId, label: classSaleWire.class.name, description: "담당", searchText: `${classSaleWire.class.name} 담당`,
  metaRows: [{ label: "학생", value: "24명" }],
  filterValues: {
    subject: [{ value: "english", label: "영어" }], grade: [{ value: "m2", label: "중2" }], teacher: [{ value: "teacher", label: "담당" }],
  },
}
const locationOption = { value: classSaleWire.input.locationId, label: classSaleWire.location.name, searchText: classSaleWire.location.code }
const selectedWireBook = {
  ...classSaleWire.textbook,
  category: null, school_level: "middle", grade_level: "2", school_levels: ["middle"], grade_levels: ["2"],
  sub_subject: "문법", subject_area_key: null,
}

test("mounted request form starts bounded independent reference pickers without legacy catalog fallback", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_purchase_page_v1"), {
    rows: [], page: 1, pageSize: 10, totalCount: 0,
  })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_summary_v1"), purchaseSummary("request", 0))
  await h.settleLegacy()

  const addRequest = button("요청 바로 추가")
  assert.ok(addRequest, document.body.textContent)
  await h.act(() => addRequest.click())

  const book = h.requests.find((request) => request.name === "list_textbook_reference_page_v1")
  const klass = h.requests.find((request) => request.name === "list_textbook_class_reference_page_v1")
  const location = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  assert.ok(book, "request form owns a book reference page")
  assert.ok(klass, "request form owns a class reference page")
  assert.ok(location, "request form owns a location reference page")
  assert.deepEqual(book.args, {
    p_filters: { search: "", selectedFilters: {} }, p_sort: "match-title", p_page: 1, p_page_size: 20,
  })
  assert.deepEqual(klass.args, {
    p_filters: { search: "", selectedFilters: {} }, p_sort: "match-name", p_page: 1, p_page_size: 20,
  })
  assert.deepEqual(location.args, {
    p_filters: { search: "" }, p_sort: "match-order", p_page: 1, p_page_size: 20,
  })
  assert.equal(h.requests.filter((request) => request.table).length > 0, true, "legacy action bundle still loads during Task5c")
})

test("reference hook addresses every named service and aborts the old same-user role lifetime", async (t) => {
  const h = await setupReferenceHook(t, {
    ...actor,
    bookOptions: { enabled: true }, classOptions: { enabled: true }, teacherOptions: { enabled: true }, locationOptions: { enabled: true },
    selectedBook: { reference: id(101), activeOnly: true, scope: "management", fallbackSupplier: "" },
    selectedClassId: id(800), selectedLocationId: id(900),
    masterOptions: { subject: "english", listSubject: "all", bulkSubject: "keep" }, masterDetailId: id(101),
    purchaseDetailInput: { anchorLineId: id(301), mode: "request" }, saleDetailId: id(401),
    masterDuplicateInput: { excludeId: null, title: "문법", subject: "english", publisher: "출판사", category: "문법" },
    classSalePreviewInput: { classId: id(800), textbookId: id(101), chargeMonth: "2026-08", locationId: id(900) },
    teacherSaleBalanceInput: { textbookIds: [id(101)], locationId: id(900) },
    closingPreviewInput: { closingMonth: "2026-08", subject: "all", openingQuantity: 0, openingAmount: 0 },
  })
  const expected = [
    "list_textbook_reference_page_v1", "list_textbook_class_reference_page_v1", "list_textbook_teacher_reference_page_v1", "list_textbook_location_reference_page_v1",
    "resolve_textbook_reference_v1", "get_textbook_class_reference_v1", "get_textbook_location_reference_v1", "get_textbook_master_options_v1",
    "get_textbook_master_detail_v1", "get_textbook_purchase_detail_v1", "get_textbook_sale_detail_v1", "check_textbook_master_duplicate_v1",
    "get_class_textbook_sale_context_v1", "get_textbook_inventory_balance_v1", "get_textbook_closing_preview_v1",
  ]
  assert.deepEqual(h.requests.map((request) => request.name).sort(), expected.sort())
  assert.ok(h.requests.every((request) => request.retry === false && request.signal instanceof AbortSignal))
  assert.deepEqual(h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1").args, { p_anchor_line_id: id(301), p_mode: "request" })
  assert.deepEqual(h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1").args, { p_input: { textbookIds: [id(101)], locationId: id(900) } })
  assert.deepEqual(h.requests.find((request) => request.name === "get_textbook_closing_preview_v1").args.p_input, {
    closingMonth: "2026-08", subject: "all", openingQuantity: 0, openingAmount: 0,
  })

  const oldRequests = [...h.requests]
  await h.rerender({ ...actor, viewerRole: "staff", managementEnabled: true })
  assert.ok(oldRequests.every((request) => request.signal.aborted), "same ID role change aborts every resource lifetime")
})

test("book picker keeps authoritative facets and server order across bounded page navigation", async (t) => {
  const h = await setupReferenceHook(t, { ...actor, bookOptions: { enabled: true } })
  const first = h.requests.find((request) => request.name === "list_textbook_reference_page_v1")
  assert.deepEqual(first.args, { p_filters: { search: "", selectedFilters: {} }, p_sort: "match-title", p_page: 1, p_page_size: 20 })
  const rows = Array.from({ length: 20 }, (_, index) => bookOption(100 + index))
  await h.resolve(first, { rows, page: 1, pageSize: 20, totalCount: 21, baseFilterGroups: facetGroups(21), visibleFilterGroups: facetGroups(21), activeFilterCount: 0 })
  assert.deepEqual(h.current.bookOptions.rows.map((row) => row.value), rows.map((row) => row.value))
  assert.deepEqual(h.current.bookOptions.visibleFilterGroups, facetGroups(21))

  await h.act(() => h.current.bookOptions.goToPage(2))
  const second = h.requests.find((request) => request.name === "list_textbook_reference_page_v1" && request.args.p_page === 2)
  assert.ok(second)
  assert.equal(h.current.bookOptions.page, 2, "controlled target page advances before transport settles")
  await h.resolve(second, { rows: [bookOption(120)], page: 2, pageSize: 20, totalCount: 21, baseFilterGroups: facetGroups(21), visibleFilterGroups: facetGroups(21), activeFilterCount: 0 })
  assert.deepEqual(h.current.bookOptions.rows.map((row) => row.value), [id(120)])
  assert.equal(h.current.bookOptions.totalCount, 21)

  await h.act(() => h.current.bookOptions.setSearch("typed server search"))
  const searched = h.requests.find((request) => request.name === "list_textbook_reference_page_v1" && request.args.p_filters.search === "typed server search")
  assert.ok(searched)
  assert.equal(searched.args.p_page, 1)
  await h.reject(searched, { code: "PGRST202", message: "strict missing rpc" })
  assert.equal(h.current.bookOptions.search, "typed server search", "typed search survives an error")
  assert.equal(h.requests.some((request) => request.table), false, "strict reference error never falls back to legacy tables")
})

test("location picker publishes only the real nonempty server default and never fabricates a location", async (t) => {
  const h = await setupReferenceHook(t, { ...actor, locationOptions: { enabled: true } })
  const request = h.requests.find((item) => item.name === "list_textbook_location_reference_page_v1")
  await h.resolve(request, {
    rows: [{ value: id(900), label: "실제 본관", searchText: "real-main" }], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: id(900), code: "real-main", name: "실제 본관" },
  })
  assert.deepEqual(h.current.locationOptions.defaultLocation, { id: id(900), code: "real-main", name: "실제 본관" })
  assert.deepEqual(h.current.locationOptions.rows.map((row) => row.value), [id(900)])
  assert.equal(h.current.locationOptions.rows.some((row) => ["main", "annex"].includes(row.value)), false)
})

test("accepted null is distinct from transport error and retained retry callbacks die on unmount", async (t) => {
  const input = { ...actor, selectedBook: { reference: id(101), activeOnly: true, scope: "management", fallbackSupplier: "" } }
  const h = await setupReferenceHook(t, input)
  const first = h.requests.find((request) => request.name === "resolve_textbook_reference_v1")
  await h.resolve(first, { row: null })
  assert.deepEqual(h.current.selectedBook.value, { row: null })
  assert.deepEqual(h.current.selectedBook.acceptedInput, input.selectedBook)
  assert.equal(h.current.selectedBook.error, null)

  const retainedRetry = h.current.selectedBook.retry
  await h.act(() => { void retainedRetry() })
  const second = h.requests.findLast((request) => request.name === "resolve_textbook_reference_v1")
  await h.reject(second, { code: "PGRST202", message: "strict missing rpc" })
  assert.equal(h.current.selectedBook.value, null)
  assert.equal(h.current.selectedBook.acceptedInput, null)
  assert.ok(h.current.selectedBook.error)
  assert.equal(h.requests.some((request) => request.table), false, "strict selected-reference failure has zero fallback reads")

  const beforeUnmount = h.requests.length
  await h.unmount()
  await retainedRetry()
  assert.equal(h.requests.length, beforeUnmount, "retained retry cannot request after owner unmount")
})

test("changed input and same-actor remount invalidate retained callbacks while the new owner remains live", async (t) => {
  const firstInput = { ...actor, selectedClassId: id(800) }
  const h = await setupReferenceHook(t, firstInput)
  const oldRetry = h.current.selectedClass.retry
  const first = h.requests.find((request) => request.name === "get_textbook_class_reference_v1")
  await h.rerender({ ...actor, selectedClassId: id(801) })
  assert.equal(first.signal.aborted, true)
  const afterChange = h.requests.length
  await oldRetry()
  assert.equal(h.requests.length, afterChange, "old input retry is dead")

  const currentRetry = h.current.selectedClass.retry
  await h.setOwnerPresent(false)
  const afterBoundary = h.requests.length
  await currentRetry()
  assert.equal(h.requests.length, afterBoundary, "removed owner retry is dead")
  await h.setOwnerPresent(true)
  const remounted = h.requests.findLast((request) => request.name === "get_textbook_class_reference_v1")
  assert.ok(remounted)
  assert.notEqual(remounted, first)
})

test("mounted class sale uses the complete off-page school roster, duplicates, and negative balance preview", async (t) => {
  const h = await setup(t, { search: "?textbookTab=sales&textbookPage=1&textbookPageSize=10" })
  const selectedWireBookOption = h.load("src/features/textbooks/textbook-reference-model.ts").buildTextbookReferenceOptions([selectedWireBook])[0]
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_summary_v1"), saleSummary(0))
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1"), saleHistorySummary(0))
  await h.settleLegacy()
  await h.act(() => button("출고 바로 추가").click())
  const monthInput = document.querySelector('[aria-label="출고월"]')
  await h.act(() => {
    const props = monthInput[Object.keys(monthInput).find((key) => key.startsWith("__reactProps$"))]
    props.onChange({ target: { value: "2099-08" } })
  })

  const bookPage = h.requests.find((request) => request.name === "list_textbook_reference_page_v1")
  const classPage = h.requests.find((request) => request.name === "list_textbook_class_reference_page_v1")
  const locationPage = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  await h.resolve(bookPage, { rows: [selectedWireBookOption], page: 1, pageSize: 20, totalCount: 1, baseFilterGroups: facetGroups(1), visibleFilterGroups: facetGroups(1), activeFilterCount: 0 })
  await h.resolve(classPage, { rows: [classOption], page: 1, pageSize: 20, totalCount: 1, baseFilterGroups: classGroups(1), visibleFilterGroups: classGroups(1), activeFilterCount: 0 })
  await h.resolve(locationPage, { rows: [locationOption], page: 1, pageSize: 20, totalCount: 1, defaultLocation: classSaleWire.location })

  await h.act(() => document.querySelector('[aria-label="수업 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes(classSaleWire.class.name)).click())
  await h.act(() => document.querySelector('[aria-label="교재 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes(classSaleWire.textbook.name)).click())

  const classDetail = h.requests.find((request) => request.name === "get_textbook_class_reference_v1")
  const bookDetail = h.requests.find((request) => request.name === "resolve_textbook_reference_v1")
  const locationDetail = h.requests.find((request) => request.name === "get_textbook_location_reference_v1")
  assert.ok(classDetail && bookDetail && locationDetail)
  await h.resolve(classDetail, { row: { id: classSaleWire.input.classId, name: classSaleWire.class.name, option: classOption, enrolledStudentCount: 24, defaultTeacherName: "담당", inferredLocation: classSaleWire.location } })
  await h.resolve(bookDetail, { row: { textbook: selectedWireBook, option: selectedWireBookOption, configuredSupplierId: "", supplier: null } })
  await h.resolve(locationDetail, { row: { ...classSaleWire.location, option: locationOption } })

  const preview = h.requests.find((request) => request.name === "get_class_textbook_sale_context_v1")
  assert.ok(preview)
  assert.deepEqual(preview.args.p_input, classSaleWire.input)
  await h.resolve(preview, classSaleWire)
  assert.equal(document.body.textContent.includes("이미 2099-08에 같은 수업·교재 출고 1명분"), true)
  assert.equal(document.body.textContent.includes("-2권"), true)

  const search = document.querySelector('[aria-label="출고 학생 검색"]')
  await h.act(() => {
    const props = search[Object.keys(search).find((key) => key.startsWith("__reactProps$"))]
    props.onChange({ target: { value: "__t5b2_school_offpage" } })
  })
  assert.equal(document.body.textContent.includes("1/1명 표시"), true)
  assert.equal([...document.querySelectorAll('[aria-label$="출고 대상 선택"]')].some((node) => node.getAttribute("aria-label").includes("__t5b2_same_name")), true)
})

test("master duplicate read blocks pending/error/stale submit and opens an off-page duplicate by direct ID", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(0))
  await h.settleLegacy()
  await h.act(() => button("신규 등록").click())
  const title = document.querySelector('[aria-label="교재명"]')
  await h.act(() => {
    const props = title[Object.keys(title).find((key) => key.startsWith("__reactProps$"))]
    props.onChange({ target: { value: "첫 제목" } })
  })
  const first = h.requests.find((request) => request.name === "check_textbook_master_duplicate_v1")
  assert.deepEqual(first.args.p_input, { excludeId: null, title: "첫 제목", subject: "english", publisher: "", category: "" })
  assert.equal(document.querySelector('[aria-label="교재 저장"]').disabled, true)

  await h.act(() => {
    const props = title[Object.keys(title).find((key) => key.startsWith("__reactProps$"))]
    props.onChange({ target: { value: "최종 제목" } })
  })
  const second = h.requests.findLast((request) => request.name === "check_textbook_master_duplicate_v1")
  assert.notEqual(second, first)
  assert.equal(first.signal.aborted, true)
  await h.resolve(first, { totalCount: 1, previewRows: [masterRow(150)] })
  assert.equal(document.body.textContent.includes("교재 150 기존 교재 열기"), false, "stale duplicate cannot publish")
  await h.reject(second, { code: "PGRST202", message: "strict duplicate rpc missing" })
  assert.ok(document.querySelector('[role="alert"]'))
  assert.ok(button("다시 시도"), "strict duplicate error exposes retry")
  assert.equal(document.querySelector('[aria-label="교재 저장"]').disabled, true)

  await h.act(() => button("다시 시도").click())
  const retry = h.requests.findLast((request) => request.name === "check_textbook_master_duplicate_v1")
  await h.resolve(retry, { totalCount: 1, previewRows: [masterRow(151)] })
  const duplicate = document.querySelector('[aria-label="교재 151 기존 교재 열기"]')
  assert.ok(duplicate)
  await h.act(() => duplicate.click())
  assert.ok(h.requests.find((request) => request.name === "get_textbook_master_detail_v1" && request.args.p_id === id(151)))
})

test("external direct detail navigation replaces and clears master requests without reopening late data", async (t) => {
  const a = id(151)
  const b = id(152)
  const h = await setup(t, { search: `?textbookTab=master&textbookPage=7&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${a}` })
  const detailA = h.requests.find((request) => request.name === "get_textbook_master_detail_v1" && request.args.p_id === a)
  assert.ok(detailA)
  await h.popstate(`?textbookTab=master&textbookPage=7&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${b}`)
  const detailB = h.requests.find((request) => request.name === "get_textbook_master_detail_v1" && request.args.p_id === b)
  assert.ok(detailB)
  assert.equal(detailA.signal.aborted, true)
  await h.popstate("?textbookTab=master&textbookPage=7&textbookPageSize=10")
  assert.equal(detailB.signal.aborted, true)
  await h.resolve(detailA, { row: null })
  await h.resolve(detailB, { row: null })
  assert.equal(document.body.textContent.includes("교재 수정"), false)
  assert.equal(new URLSearchParams(window.location.search).get("textbookPage"), "7")
})

test("external purchase detail uses the URL anchor identity and preserves numbered state when cleared", async (t) => {
  const anchorLineId = id(301)
  const h = await setup(t, { search: `?textbookTab=requests&textbookPage=4&textbookPageSize=15&textbookDetailKind=purchase&textbookDetail=${anchorLineId}` })
  const detail = h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1")
  assert.ok(detail)
  assert.deepEqual(detail.args, { p_anchor_line_id: anchorLineId, p_mode: "request" })
  await h.popstate("?textbookTab=requests&textbookPage=4&textbookPageSize=15")
  assert.equal(detail.signal.aborted, true)
  assert.equal(new URLSearchParams(window.location.search).get("textbookPage"), "4")
})

test("direct purchase hydration pins an off-page selected book label without a raw UUID", async (t) => {
  const row = purchaseRow("request")
  const h = await setup(t, { search: `?textbookTab=requests&textbookPage=4&textbookPageSize=15&textbookDetailKind=purchase&textbookDetail=${row.anchorLineId}` })
  const detail = h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1")
  await h.resolve(detail, { row })
  const page = h.requests.find((request) => request.name === "list_textbook_reference_page_v1")
  const teacherPage = h.requests.find((request) => request.name === "list_textbook_teacher_reference_page_v1")
  const locationPage = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  const selected = h.requests.find((request) => request.name === "resolve_textbook_reference_v1")
  const selectedClass = h.requests.find((request) => request.name === "get_textbook_class_reference_v1")
  assert.ok(page && teacherPage && locationPage && selected && selectedClass)
  await h.resolve(page, { rows: [], page: 1, pageSize: 20, totalCount: 0, baseFilterGroups: facetGroups(0), visibleFilterGroups: facetGroups(0), activeFilterCount: 0 })
  await h.resolve(teacherPage, { rows: [{ value: "수동 선생님", label: "수동 선생님" }], page: 1, pageSize: 20, totalCount: 1 })
  await h.resolve(locationPage, {
    rows: [{ value: id(900), label: "본관" }, { value: id(901), label: "수동 별관" }], page: 1, pageSize: 20, totalCount: 2,
    defaultLocation: { id: id(900), code: "main", name: "본관" },
  })
  const directBook = { ...selectedWireBook, id: id(101), name: "오프페이지 선택 교재", title: "오프페이지 선택 교재" }
  const option = h.load("src/features/textbooks/textbook-reference-model.ts").buildTextbookReferenceOptions([directBook])[0]
  await h.resolve(selected, { row: { textbook: directBook, option, configuredSupplierId: "", supplier: null } })
  const trigger = document.querySelector('[aria-label="교재 선택"]')
  assert.equal(trigger.textContent.includes("오프페이지 선택 교재"), true)
  assert.equal(trigger.textContent.includes(id(101)), false)

  await h.act(() => document.querySelector('[aria-label="선생님 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("수동 선생님")).click())
  await h.resolve(selectedClass, { row: {
    id: id(800), name: "중2반", enrolledStudentCount: 3, defaultTeacherName: "늦은 자동 선생님",
    inferredLocation: { id: id(902), code: "late", name: "늦은 자동 위치" },
    option: { value: id(800), label: "중2반", searchText: "중2반", filterValues: {} },
  } })
  assert.equal(document.querySelector('[aria-label="선생님 선택"]').textContent.includes("수동 선생님"), true)
})

test("external sale detail owns a cancellable direct read without reopening stale data", async (t) => {
  const saleLineId = id(401)
  const h = await setup(t, { search: `?textbookTab=sales&textbookPage=3&textbookPageSize=20&textbookDetailKind=sale&textbookDetail=${saleLineId}` })
  const detail = h.requests.find((request) => request.name === "get_textbook_sale_detail_v1")
  assert.ok(detail)
  assert.deepEqual(detail.args, { p_id: saleLineId })
  await h.popstate("?textbookTab=sales&textbookPage=3&textbookPageSize=20")
  assert.equal(detail.signal.aborted, true)
  await h.resolve(detail, { row: null })
  assert.equal(document.body.textContent.includes("출고 상세"), false)
})

test("mounted closing preview rejects a late manual-input result and displays only the accepted service calculation", async (t) => {
  const h = await setup(t, { search: "?textbookTab=closing&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_closing_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.settleLegacy()
  await h.act(() => button("월마감 추가").click())
  const first = h.requests.find((request) => request.name === "get_textbook_closing_preview_v1")
  assert.ok(first)

  const opening = document.querySelector('[aria-label="기초 수량"]')
  await h.act(() => {
    const props = opening[Object.keys(opening).find((key) => key.startsWith("__reactProps$"))]
    props.onChange({ target: { value: "7" } })
  })
  const second = h.requests.findLast((request) => request.name === "get_textbook_closing_preview_v1")
  assert.notEqual(second, first)
  assert.equal(first.signal.aborted, true)
  assert.equal(second.args.p_input.openingQuantity, 7)
  const closing = {
    openingQuantity: 7, purchaseQuantity: 0, saleQuantity: 0, adjustmentQuantity: 0, endingQuantity: 7,
    openingAmount: 0, purchaseAmount: 0, saleAmount: 0, adjustmentAmount: 0, endingAmount: 0,
    receivedAmount: 0, supplierPaymentAmount: 0, paymentDifference: 0, textbookMarginAmount: 0, settlementDifference: 0,
    teamMargins: ["english", "math", "science", "other"].map((team) => ({ team, saleQuantity: 0, saleAmount: 0, purchaseCostAmount: 0, marginAmount: 0 })),
    needsReview: false,
  }
  await h.resolve(first, { closingMonth: first.args.p_input.closingMonth, subject: "all", sourceLineCount: 0, closing: { ...closing, openingQuantity: 0, endingQuantity: 0 } })
  assert.equal(document.body.textContent.includes("기말0권"), false)
  await h.resolve(second, { closingMonth: second.args.p_input.closingMonth, subject: "all", sourceLineCount: 0, closing })
  assert.equal(document.body.textContent.includes("기말7권"), true)
})
