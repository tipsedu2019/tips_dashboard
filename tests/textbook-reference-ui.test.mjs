import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { flushSync } from "react-dom"

import { button, id, masterRow, masterSummary, purchaseRow, purchaseSummary, saleHistorySummary, saleRow, saleSummary, setup, setupReferenceHook } from "./helpers/textbook-numbered-harness.mjs"

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

test("shared action feedback uses status semantics without stealing focus and returns it on dismiss", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master" })
  const ActionFeedback = h.load("src/components/ui/action-feedback.tsx").ActionFeedback
  const origin = document.createElement("button")
  origin.textContent = "원래 작업"
  document.body.appendChild(origin)
  origin.focus()
  let dismissCount = 0
  const mounted = await h.mountTestComponent(ActionFeedback, {
    message: "작업이 완료되었습니다.",
    onDismiss: () => { dismissCount += 1 },
  })

  const feedback = mounted.node.querySelector('[data-slot="action-feedback"]')
  assert.ok(feedback)
  assert.ok(feedback.querySelector('[role="status"]'))
  assert.equal(feedback.querySelector('[role="alert"]'), null)
  assert.equal(feedback.querySelector('[aria-label="처리 결과"]')?.textContent, "작업이 완료되었습니다.")
  assert.equal(document.activeElement, origin, "mounting non-modal feedback keeps the current work control focused")

  await h.act(() => feedback.querySelector('[aria-label="처리 결과 닫기"]').click())
  assert.equal(dismissCount, 1)
  assert.equal(document.activeElement, origin, "dismiss returns focus to the control active when feedback appeared")
  await mounted.cleanup()
  origin.remove()
})
const classOption = {
  value: classSaleWire.input.classId, label: classSaleWire.class.name, description: "담당", searchText: `${classSaleWire.class.name} 담당`,
  metaRows: [{ label: "학생", value: "24명" }],
  filterValues: {
    subject: [{ value: "english", label: "영어" }], grade: [{ value: "m2", label: "중2" }], teacher: [{ value: "teacher", label: "담당" }],
  },
}
const locationOption = { value: classSaleWire.input.locationId, label: classSaleWire.location.name, searchText: classSaleWire.location.code }
const requestLocationOption = { value: id(900), label: "본관", searchText: "main" }
const safeUnexpectedError = "처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요."

async function waitForOption(h, label, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const option = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes(label))
    if (option) return option
    await h.act(() => new Promise((resolve) => window.setTimeout(resolve, 10)))
  }
  const options = [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent.trim())
  const comboboxes = [...document.querySelectorAll('[role="combobox"]')].map((node) => ({ label: node.getAttribute("aria-label"), expanded: node.getAttribute("aria-expanded"), disabled: node.disabled }))
  assert.fail(`timed out waiting for option: ${label}; options=${JSON.stringify(options)}; comboboxes=${JSON.stringify(comboboxes)}; active=${document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName}`)
}

async function waitForComboboxFocus(h, label, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (document.activeElement?.getAttribute("aria-label") === label) return
    await h.act(() => new Promise((resolve) => window.setTimeout(resolve, 10)))
  }
  assert.fail(`timed out waiting for focus: ${label}`)
}

const selectedWireBook = {
  ...classSaleWire.textbook,
  category: null, school_level: "middle", grade_level: "2", school_levels: ["middle"], grade_levels: ["2"],
  sub_subject: "문법", subject_area_key: null,
}
const selectedBook = (n, title = `서버 교재 ${n}`) => ({ ...selectedWireBook, id: id(n), name: title, title })
const selectedBookResult = (h, n, title) => {
  const textbook = selectedBook(n, title)
  const option = h.load("src/features/textbooks/textbook-reference-model.ts").buildTextbookReferenceOptions([textbook])[0]
  return { row: { textbook, option, configuredSupplierId: "", supplier: null } }
}
const masterOptions = (patch = {}) => ({
  publisherOptions: [], subSubjectOptions: ["문법"], categoryOptions: ["서비스 목록 분류"], bulkCategoryOptions: ["서비스 일괄 분류"], scienceSubjectAreas: [],
  counts: { publisherOptions: 0, subSubjectOptions: 1, categoryOptions: 1, bulkCategoryOptions: 1, scienceSubjectAreas: 0 }, complete: true,
  ...patch,
})
const unregisteredPurchaseRow = () => {
  const original = purchaseRow("request")
  const lines = original.lines.map((line) => ({ ...line, textbook_id: null, requested_textbook_title: "Legacy title" }))
  const primary = { ...lines[0], purchaseScopeLines: lines }
  const key = ["requested", "legacy title", primary.class_id, primary.location_id, primary.order.requested_by, "", primary.order.order_date, ""].join("||")
  return { ...original, id: key, anchorLineId: lines[0].id, memberLineIds: lines.map((line) => line.id), line: primary, lines, references: { ...original.references, textbook: null, configuredSupplierId: "", unitCost: 0 } }
}

test("mounted request form starts bounded independent reference pickers without legacy catalog fallback", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_purchase_page_v1"), {
    rows: [], page: 1, pageSize: 10, totalCount: 0,
  })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_summary_v1"), purchaseSummary("request", 0))
  await h.assertNoLegacyReads()

  const addRequest = button("교재 요청 추가")
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
  assert.deepEqual(h.requests.filter((request) => request.table), [], "bounded reference startup must not start legacy tables")
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
  })
  const expected = [
    "list_textbook_reference_page_v1", "list_textbook_class_reference_page_v1", "list_textbook_teacher_reference_page_v1", "list_textbook_location_reference_page_v1",
    "resolve_textbook_reference_v1", "get_textbook_class_reference_v1", "get_textbook_location_reference_v1", "get_textbook_master_options_v1",
    "get_textbook_master_detail_v1", "get_textbook_purchase_detail_v1", "get_textbook_sale_detail_v1", "check_textbook_master_duplicate_v1",
    "get_class_textbook_sale_context_v1", "get_textbook_inventory_balance_v1",
  ]
  assert.deepEqual(h.requests.map((request) => request.name).sort(), expected.sort())
  assert.ok(h.requests.every((request) => request.retry === false && request.signal instanceof AbortSignal))
  assert.deepEqual(h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1").args, { p_anchor_line_id: id(301), p_mode: "request" })
  assert.deepEqual(h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1").args, { p_input: { textbookIds: [id(101)], locationId: id(900) } })


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

test("same input never publishes a former actor value across role user or auth boundaries", async (t) => {
  const selectedBook = { reference: id(101), activeOnly: true, scope: "management", fallbackSupplier: "" }
  const adminInput = { ...actor, selectedBook }
  const h = await setupReferenceHook(t, adminInput)
  await h.resolve(h.requests.find((request) => request.name === "resolve_textbook_reference_v1"), { row: null })
  assert.deepEqual(h.current.selectedBook.acceptedInput, selectedBook)

  const staffInput = { ...adminInput, viewerRole: "staff" }
  h.rerenderSync(staffInput)
  assert.equal(h.current.selectedBook.value, null, "admin acceptance is hidden synchronously under staff actor")
  assert.equal(h.current.selectedBook.acceptedInput, null)
  await h.rerender(staffInput)
  const staffRequest = h.requests.findLast((request) => request.name === "resolve_textbook_reference_v1")
  await h.resolve(staffRequest, { row: null })

  const otherUserInput = { ...staffInput, viewerId: id(805) }
  h.rerenderSync(otherUserInput)
  assert.equal(h.current.selectedBook.acceptedInput, null, "former user acceptance is hidden synchronously")
  await h.rerender(otherUserInput)
  const otherUserRequest = h.requests.findLast((request) => request.name === "resolve_textbook_reference_v1")
  await h.resolve(otherUserRequest, { row: null })

  h.rerenderSync({ ...otherUserInput, authReady: false })
  assert.equal(h.current.selectedBook.acceptedInput, null, "disabled auth boundary synchronously hides acceptance")
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
  await h.assertNoLegacyReads()
  await h.act(() => button("교재 출고 추가").click())
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

  await h.act(() => {
    const props = monthInput[Object.keys(monthInput).find((key) => key.startsWith("__reactProps$"))]
    props.onChange({ target: { value: "2099-09" } })
  })
  const positiveInput = { ...classSaleWire.input, chargeMonth: "2099-09" }
  const positiveContext = {
    ...classSaleWire, input: positiveInput, duplicateCount: 0, duplicateLineCount: 0,
    duplicateLines: [], duplicateSales: [], duplicateLineIds: [], duplicateStudentIds: [],
  }
  const positivePreview = h.requests.findLast((request) => request.name === "get_class_textbook_sale_context_v1")
  assert.deepEqual(positivePreview.args.p_input, positiveInput)
  await h.resolve(positivePreview, positiveContext)
  await h.act(() => button("출고 대기 저장").click())
  const saveContext = h.requests.findLast((request) => request.name === "get_class_textbook_sale_context_v1")
  assert.notEqual(saveContext, positivePreview, "save re-reads the full off-page roster instead of using its preview")
  assert.deepEqual(saveContext.args.p_input, positiveInput)
  assert.equal(h.requests.some((request) => request.table), false, "class writer waits for the complete fresh roster context")
  const visibleStudent = document.querySelector('[aria-label$="출고 대상 선택"]')
  await h.act(() => visibleStudent.click())
  await h.resolve(saveContext, positiveContext)
  assert.equal(h.requests.some((request) => request.table), false, "changing excluded students while save context is pending keeps every writer closed")

  await h.act(() => button("출고 대기 저장").click())
  const retryContext = h.requests.findLast((request) => request.name === "get_class_textbook_sale_context_v1")
  assert.notEqual(retryContext, saveContext)
  await h.resolve(retryContext, positiveContext)
  const firstWriter = h.requests.find((request) => request.table)
  assert.equal(firstWriter.table, "textbook_sales")
  assert.equal(firstWriter.steps.find((step) => step.method === "insert").args[0].charge_month, "2099-09")
})

test("mounted teacher sale preserves a manual name and re-reads its exact accepted balance before writing", async (t) => {
  const h = await setup(t, { search: "?textbookTab=sales&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_summary_v1"), saleSummary(0))
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_sale_history_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_history_summary_v1"), saleHistorySummary(0))
  await h.act(() => button("교재 출고 추가").click())
  await h.act(() => button("교사용").click())
  const option = bookOption(101)
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_reference_page_v1"), { rows: [option], page: 1, pageSize: 20, totalCount: 1, baseFilterGroups: facetGroups(1), visibleFilterGroups: facetGroups(1), activeFilterCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_teacher_reference_page_v1"), { rows: [{ value: "수동 선생님", label: "수동 선생님" }], page: 1, pageSize: 20, totalCount: 1 })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), { rows: [requestLocationOption], page: 1, pageSize: 20, totalCount: 1, defaultLocation: { id: id(900), code: "main", name: "본관" } })
  await h.act(async () => { document.querySelector('[aria-label="교사용 수령 선생님 선택"]').click(); await new Promise((resolve) => window.requestAnimationFrame(resolve)) })
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("수동 선생님")).click())
  await waitForComboboxFocus(h, "교사용 수령 선생님 선택")
  await h.act(() => document.querySelector('[aria-label="교재 선택"]').click())
  const book = await waitForOption(h, "서버 교재 101")
  await h.act(() => book.click())
  await h.resolve(h.requests.find((request) => request.name === "resolve_textbook_reference_v1"), selectedBookResult(h, 101, "서버 교재 101"))
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_location_reference_v1"), { row: { id: id(900), code: "main", name: "본관", option: requestLocationOption } })
  const balancePayload = { locationId: id(900), rows: [{ textbookId: id(101), currentQuantity: 7, locationQuantities: { [id(900)]: 7 }, studentLocationQuantities: {}, teacherLocationQuantities: { [id(900)]: 7 }, totalQuantity: 7, studentQuantity: 0, teacherQuantity: 7, stockValue: 70000 }] }
  const previewBalance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1")
  await h.resolve(previewBalance, balancePayload)
  await h.act(() => button("출고 대기 저장").click())
  const saveBalance = h.requests.findLast((request) => request.name === "get_textbook_inventory_balance_v1")
  assert.notEqual(saveBalance, previewBalance)
  assert.deepEqual(saveBalance.args.p_input, { textbookIds: [id(101)], locationId: id(900) })
  assert.equal(h.requests.some((request) => request.table), false)
  await h.reject(saveBalance, { message: "합성 출고 저장 전 조회 실패" })
  const saleDialog = document.querySelector('[role="dialog"]')
  assert.ok(saleDialog.querySelector('[role="alert"]').textContent.includes(safeUnexpectedError))
  assert.equal(saleDialog.textContent.includes("합성 출고 저장 전 조회 실패"), false)
  assert.equal(saleDialog.querySelector('[aria-label="교사용 수령 선생님 선택"]').textContent.includes("수동 선생님"), true)
  assert.equal(button("출고 대기 저장").disabled, false)
  const form = button("출고 대기 저장").closest('form')
  const requestCount = h.requests.length
  await h.act(() => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
  })
  const retries = h.requests.slice(requestCount).filter(r => r.name === "get_textbook_inventory_balance_v1")
  assert.equal(retries.length, 1, "a repeated sale submission starts one fresh balance read")
  await h.resolve(retries[0], balancePayload)
  const saleWrite = h.requests.find((request) => request.table === "textbook_sales")
  await h.resolve(saleWrite, { id: id(500) })
  const lineWrite = h.requests.find((request) => request.table === "textbook_sale_lines")
  const linePayload = lineWrite.steps.find((step) => step.method === "insert").args[0][0]
  assert.equal(linePayload.teacher_name, "수동 선생님")
  assert.equal(linePayload.teacher_id, null, "manual teacher identity is not fabricated")
})

test("master duplicate read blocks pending/error/stale submit and opens an off-page duplicate by direct ID", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(0))
  await h.assertNoLegacyReads()
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
  assert.ok(document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'), "opening an existing book must confirm the current draft")
  assert.equal(h.requests.some(request => request.name === "get_textbook_master_detail_v1" && request.args.p_id === id(151)), false)
  await h.act(() => button("변경사항 버리기").click())
  await h.act(() => new Promise(resolve => setTimeout(resolve, 30)))
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

test("off-page direct purchase save re-reads its frozen direct identity and closes on identity change", async (t) => {
  const direct = purchaseRow("request", 4)
  const h = await setup(t, { search: `?textbookTab=requests&textbookPage=4&textbookPageSize=15&textbookDetailKind=purchase&textbookDetail=${direct.anchorLineId}` })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1"), { row: direct })
  await h.resolve(h.requests.find((request) => request.name === "resolve_textbook_reference_v1"), selectedBookResult(h, 105, "오프페이지 저장 교재"))
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_location_reference_v1"), {
    row: { id: id(900), code: "main", name: "본관", option: requestLocationOption },
  })
  const directClassOption = { ...classOption, value: id(800), label: "중2반", description: "담당", searchText: "중2반 담당" }
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_class_reference_v1"), { row: {
    id: id(800), name: "중2반", enrolledStudentCount: 3, defaultTeacherName: "담당", inferredLocation: { id: id(900), code: "main", name: "본관" },
    option: directClassOption,
  } })
  const requestCount = h.requests.filter((request) => request.name === "get_textbook_purchase_detail_v1").length
  assert.equal(button("변경 저장").disabled, false, document.body.textContent)
  await h.act(() => button("변경 저장").click())
  const fresh = h.requests.filter((request) => request.name === "get_textbook_purchase_detail_v1").at(-1)
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_purchase_detail_v1").length, requestCount + 1)
  assert.deepEqual(fresh.args, { p_anchor_line_id: direct.anchorLineId, p_mode: "request" })
  assert.equal(h.requests.some((request) => request.table), false)
  const freshOrderId = id(999)
  const freshLines = direct.lines.map((line) => ({ ...line, purchase_order_id: freshOrderId, order: { ...line.order, id: freshOrderId } }))
  const freshRow = { ...direct, line: { ...freshLines[0], purchaseScopeLines: freshLines }, lines: freshLines }
  await h.resolve(fresh, { row: freshRow })
  const writer = h.requests.find((request) => request.table)
  assert.equal(writer.table, "textbook_purchase_orders")
  assert.deepEqual(writer.steps.find((step) => step.method === "eq").args, ["id", freshOrderId])
  await h.unmount()

  const h2 = await setup(t, { search: `?textbookTab=requests&textbookPage=4&textbookPageSize=15&textbookDetailKind=purchase&textbookDetail=${direct.anchorLineId}` })
  await h2.resolve(h2.requests.find((request) => request.name === "get_textbook_purchase_detail_v1"), { row: direct })
  await h2.resolve(h2.requests.find((request) => request.name === "resolve_textbook_reference_v1"), selectedBookResult(h2, 105, "오프페이지 저장 교재"))
  await h2.resolve(h2.requests.find((request) => request.name === "get_textbook_location_reference_v1"), {
    row: { id: id(900), code: "main", name: "본관", option: requestLocationOption },
  })
  await h2.resolve(h2.requests.find((request) => request.name === "get_textbook_class_reference_v1"), { row: {
    id: id(800), name: "중2반", enrolledStudentCount: 3, defaultTeacherName: "담당", inferredLocation: { id: id(900), code: "main", name: "본관" },
    option: directClassOption,
  } })
  assert.equal(button("변경 저장").disabled, false)
  await h2.act(() => button("변경 저장").click())
  const pending = h2.requests.filter((request) => request.name === "get_textbook_purchase_detail_v1").at(-1)
  await h2.popstate("?textbookTab=requests&textbookPage=4&textbookPageSize=15")
  await h2.resolve(pending, { row: direct })
  assert.equal(h2.requests.some((request) => request.table), false)
  assert.equal(document.body.textContent.includes("요청 건이 저장되었습니다."), false)
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

test("hydrated master and purchase forms close immediately on same-kind B or none navigation", async (t) => {
  const masterA = id(151)
  const masterB = id(152)
  const h = await setup(t, { search: `?textbookTab=master&textbookPage=7&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${masterA}` })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_detail_v1" && request.args.p_id === masterA), { row: masterRow(151) })
  const masterTitle = document.querySelector('[aria-label="교재명"]')
  const masterSave = document.querySelector('[aria-label="교재 저장"]')
  assert.equal(masterTitle.value, "교재 151")
  await h.popstate(`?textbookTab=master&textbookPage=7&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${masterB}`)
  assert.equal(masterTitle.isConnected, false, "accepted A master form closes before B settles")
  assert.equal(document.body.textContent.includes("상세 정보를 불러오는 중입니다."), true)
  assert.equal(masterSave.isConnected, false, "old master cannot save under B URL")
  const masterBRequest = h.requests.find((request) => request.name === "get_textbook_master_detail_v1" && request.args.p_id === masterB)
  await h.reject(masterBRequest, { code: "PGRST202", message: "master B missing" })
  assert.ok(button("다시 시도"), "B error remains visible")
  await h.popstate("?textbookTab=master&textbookPage=7&textbookPageSize=10")
  assert.equal(masterBRequest.signal.aborted, true)
  assert.equal(h.requests.filter((request) => request.name === "get_textbook_master_detail_v1").length, 2, "clearing URL cannot refetch hidden form A")
})

test("hydrated purchase A closes before same-kind B loading and error", async (t) => {
  const a = purchaseRow("request", 0)
  const b = purchaseRow("request", 1)
  const h = await setup(t, { search: `?textbookTab=requests&textbookPage=2&textbookPageSize=10&textbookDetailKind=purchase&textbookDetail=${a.anchorLineId}` })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1" && request.args.p_anchor_line_id === a.anchorLineId), { row: a })
  const purchasePicker = document.querySelector('[aria-label="교재 선택"]')
  assert.ok(purchasePicker)
  await h.popstate(`?textbookTab=requests&textbookPage=2&textbookPageSize=10&textbookDetailKind=purchase&textbookDetail=${b.anchorLineId}`)
  assert.equal(purchasePicker.isConnected, false)
  assert.equal(document.body.textContent.includes("상세 정보를 불러오는 중입니다."), true)
  const bRequest = h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1" && request.args.p_anchor_line_id === b.anchorLineId)
  await h.reject(bRequest, { code: "PGRST202", message: "purchase B missing" })
  assert.ok(button("다시 시도"))
})

test("invalid detail kind and tab pairs issue no direct request", async (t) => {
  const anchorLineId = id(301)
  const h = await setup(t, { search: `?textbookTab=master&textbookPage=4&textbookPageSize=15&textbookDetailKind=purchase&textbookDetail=${anchorLineId}` })
  assert.equal(h.requests.some((request) => request.name === "get_textbook_purchase_detail_v1"), false)
  assert.equal(h.requests.some((request) => request.name === "get_textbook_master_detail_v1"), false)
  assert.equal(document.body.textContent.includes("구매 상세"), false)
})

test("explicit direct detail close replaces its history entry", async (t) => {
  const masterId = id(151)
  const h = await setup(t, { search: `?textbookTab=master&textbookPage=7&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${masterId}` })
  const historyLength = window.history.length
  assert.ok(button("닫기"))
  await h.act(() => button("닫기").click())
  assert.equal(window.history.length, historyLength, "close must not append list/detail/list history")
  assert.equal(new URLSearchParams(window.location.search).get("textbookPage"), "7")
  assert.equal(new URLSearchParams(window.location.search).has("textbookDetail"), false)
})

test("former accepted sale values never render under changed detail input", async (t) => {
  const h = await setup(t, { search: "?textbookTab=sales" })
  const saleA = id(401)
  const saleB = id(402)
  await h.popstate(`?textbookTab=sales&textbookPage=3&textbookPageSize=20&textbookDetailKind=sale&textbookDetail=${saleA}`)
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_sale_detail_v1" && request.args.p_id === saleA), { row: saleRow(1) })
  assert.equal(document.body.textContent.includes("김선생1"), true)
  flushSync(() => {
    window.history.replaceState(null, "", `/admin/textbooks?textbookTab=sales&textbookPage=3&textbookPageSize=20&textbookDetailKind=sale&textbookDetail=${saleB}`)
    window.dispatchEvent(new window.PopStateEvent("popstate"))
  })
  assert.equal(document.body.textContent.includes("김선생1"), false, "accepted sale A is never shown under B")
  assert.equal(document.body.textContent.includes("상세 정보를 불러오는 중입니다."), true)
})

test("purchase catalog B owns its picker and stays blocked until exact book and real location are accepted", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_purchase_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_summary_v1"), purchaseSummary("request", 0))
  await h.assertNoLegacyReads()
  await h.act(() => button("교재 요청 추가").click())
  const page = h.requests.find((request) => request.name === "list_textbook_reference_page_v1")
  const locationPage = h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1")
  await h.resolve(page, { rows: [bookOption(101), bookOption(102)], page: 1, pageSize: 20, totalCount: 2, baseFilterGroups: facetGroups(2), visibleFilterGroups: facetGroups(2), activeFilterCount: 0 })
  await h.resolve(locationPage, { rows: [requestLocationOption], page: 1, pageSize: 20, totalCount: 1, defaultLocation: { id: id(900), code: "main", name: "본관" } })
  await h.act(() => document.querySelector('[aria-label="교재 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("서버 교재 101")).click())
  const selectedA = h.requests.find((request) => request.name === "resolve_textbook_reference_v1" && request.args.p_reference === id(101))
  await h.resolve(selectedA, selectedBookResult(h, 101, "서버 교재 101"))
  const selectedLocation = h.requests.find((request) => request.name === "get_textbook_location_reference_v1" && request.args.p_location_id === id(900))
  assert.ok(selectedLocation, "default location resolves independently")
  await h.resolve(selectedLocation, { row: { id: id(900), code: "main", name: "본관", option: requestLocationOption } })

  await h.act(() => document.querySelector('[aria-label="교재 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("서버 교재 102")).click())
  const trigger = document.querySelector('[aria-label="교재 선택"]')
  assert.equal(trigger.textContent.includes("서버 교재 102"), true, "current form selection controls the trigger")
  const quantity = document.querySelector('[aria-label="학생용 요청 수량"]')
  await h.act(() => quantity[Object.keys(quantity).find((key) => key.startsWith("__reactProps$"))].onChange({ target: { value: "2" } }))
  const submit = [...document.querySelectorAll('form button[type="submit"]')].at(-1)
  assert.equal(submit.disabled, true, "unaccepted B cannot submit with accepted A")
  const selectedB = h.requests.find((request) => request.name === "resolve_textbook_reference_v1" && request.args.p_reference === id(102))
  await h.reject(selectedB, { code: "PGRST202", message: "B unavailable" })
  assert.equal(submit.disabled, true)
  assert.equal(trigger.textContent.includes(id(102)), false)
  assert.ok(button("다시 시도"))
})

test("accepted catalog request skips inventory balance transport and its irrelevant error UI", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_purchase_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_summary_v1"), purchaseSummary("request", 0))
  await h.assertNoLegacyReads()
  await h.act(() => button("교재 요청 추가").click())
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_reference_page_v1"), {
    rows: [bookOption(101)], page: 1, pageSize: 20, totalCount: 1,
    baseFilterGroups: facetGroups(1), visibleFilterGroups: facetGroups(1), activeFilterCount: 0,
  })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_location_reference_page_v1"), {
    rows: [requestLocationOption], page: 1, pageSize: 20, totalCount: 1,
    defaultLocation: { id: id(900), code: "main", name: "본관" },
  })
  await h.act(() => document.querySelector('[aria-label="교재 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("서버 교재 101")).click())
  await h.resolve(h.requests.find((request) => request.name === "resolve_textbook_reference_v1"), selectedBookResult(h, 101, "서버 교재 101"))
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_location_reference_v1"), {
    row: { id: id(900), code: "main", name: "본관", option: requestLocationOption },
  })

  const balanceRequests = h.requests.filter((request) => request.name === "get_textbook_inventory_balance_v1")
  if (balanceRequests[0]) await h.reject(balanceRequests[0], { code: "PGRST202", message: "request-stage balance must stay disabled" })
  const submit = [...document.querySelectorAll('form button[type="submit"]')].at(-1)
  const purchaseDialog = submit.closest('[role="dialog"]')
  assert.deepEqual({
    balanceRequestCount: balanceRequests.length,
    irrelevantRetryVisible: [...purchaseDialog.querySelectorAll('button')].some((node) => node.textContent.trim() === "다시 시도"),
    submitDisabled: submit.disabled,
  }, {
    balanceRequestCount: 0,
    irrelevantRetryVisible: false,
    submitDisabled: false,
  })
})

test("purchase projected stock comes from exact accepted purchase balance and direct null detail ignores legacy books", async (t) => {
  const direct = purchaseRow("order")
  const h = await setup(t, { search: `?textbookTab=purchase&textbookPage=1&textbookPageSize=10&textbookDetailKind=purchase&textbookDetail=${direct.anchorLineId}` })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_purchase_detail_v1"), { row: direct })
  const bookRequest = h.requests.find((request) => request.name === "resolve_textbook_reference_v1" && request.args.p_reference === id(101))
  await h.resolve(bookRequest, selectedBookResult(h, 101, "잔액 교재"))
  const balance = h.requests.find((request) => request.name === "get_textbook_inventory_balance_v1" && request.args.p_input?.textbookIds?.[0] === id(101))
  assert.ok(balance, "purchase form owns a narrow inventory balance read")
  assert.deepEqual(balance.args.p_input, { textbookIds: [id(101)], locationId: id(900) })
  await h.resolve(balance, { locationId: id(900), rows: [{
    textbookId: id(101), currentQuantity: 7,
    locationQuantities: { [id(900)]: 7 }, studentLocationQuantities: { [id(900)]: 7 }, teacherLocationQuantities: {},
    totalQuantity: 7, studentQuantity: 7, teacherQuantity: 0, stockValue: 70000,
  }] })
  await h.act(() => document.querySelector('[aria-label="처리 단계 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("입고 처리")).click())
  assert.equal(document.body.textContent.includes("입고 후7권"), true, "accepted balance owns the projected stock display")
  await h.unmount()

  const unregistered = unregisteredPurchaseRow()
  const h2 = await setup(t, { search: `?textbookTab=requests&textbookPage=1&textbookPageSize=10&textbookDetailKind=purchase&textbookDetail=${unregistered.anchorLineId}` })
  assert.deepEqual(h2.requests.filter((request) => request.table), [], "direct detail hydration has no legacy catalog scan")
  await h2.resolve(h2.requests.find((request) => request.name === "get_textbook_purchase_detail_v1"), { row: unregistered })
  const selectedRequest = h2.requests.find((request) => request.name === "resolve_textbook_reference_v1")
  assert.equal(selectedRequest.args.p_reference, "Legacy title", "authoritative null detail never substitutes legacy textbook UUID")
})

test("master option consumers use exact accepted category and bulk metadata and expose errors", async (t) => {
  const h = await setup(t, { search: "?textbookTab=master&textbookPage=1&textbookPageSize=10" })
  await h.resolve(h.requests.find((request) => request.name === "list_textbook_master_page_v1"), { rows: [masterRow(101)], page: 1, pageSize: 10, totalCount: 1 })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_summary_v1"), masterSummary(1, { subSubjectOptions: ["요약 전용 분류"] }))
  await h.assertNoLegacyReads()
  const optionsRequest = h.requests.find((request) => request.name === "get_textbook_master_options_v1")
  await h.resolve(optionsRequest, masterOptions())
  await h.act(() => document.querySelector('[aria-label="교재 세부과목 필터"]').click())
  assert.equal(document.body.textContent.includes("서비스 목록 분류"), true)
  assert.equal(document.body.textContent.includes("요약 전용 분류"), false)
  await h.act(() => document.querySelector('[aria-label="현재 교재 전체 선택"]').click())
  await h.act(() => button("속성 변경").click())
  await h.act(() => document.querySelector('[aria-label="일괄 세부과목"]').click())
  assert.equal(document.body.textContent.includes("서비스 일괄 분류"), true)

  await h.act(() => document.querySelector('[aria-label="일괄 과목 선택"]').click())
  await h.act(() => [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes("수학")).click())
  const nextOptions = h.requests.findLast((request) => request.name === "get_textbook_master_options_v1")
  assert.notEqual(nextOptions, optionsRequest)
  await h.reject(nextOptions, { code: "PGRST202", message: "options missing" })
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.ok([...dialog.querySelectorAll("button")].some((node) => node.textContent.trim() === "다시 시도"), "metadata retry stays in the bulk form")
  const save = button("선택 교재 변경 저장")
  assert.equal(save.textContent.trim(), "변경 저장")
  assert.equal(save.disabled, true, "bulk action is blocked without exact options")
  await h.act(() => [...dialog.querySelectorAll("button")].find((node) => node.textContent.trim() === "다시 시도").click())
  const retriedOptions = h.requests.findLast((request) => request.name === "get_textbook_master_options_v1")
  assert.notEqual(retriedOptions, nextOptions)
  await h.resolve(retriedOptions, masterOptions())
  assert.equal(button("선택 교재 변경 저장").disabled, false)
})

test("duplicate identity uses canonical category, excludeId, and authoritative totalCount", async (t) => {
  const a = id(151)
  const b = id(152)
  const h = await setup(t, { search: `?textbookTab=master&textbookPage=1&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${a}` })
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_detail_v1"), { row: masterRow(151, { grade_level: "m2", grade_levels: ["m2"] }) })
  const duplicateA = h.requests.find((request) => request.name === "check_textbook_master_duplicate_v1")
  assert.deepEqual(duplicateA.args.p_input, { excludeId: a, title: "교재 151", subject: "english", publisher: "출판사", category: "중등 · 중2 · 문법" })
  await h.resolve(duplicateA, { totalCount: 111, previewRows: Array.from({ length: 10 }, (_, index) => masterRow(160 + index)) })
  assert.equal(document.body.textContent.includes("이미 등록된 교재 111건"), true)
  await h.popstate(`?textbookTab=master&textbookPage=1&textbookPageSize=10&textbookDetailKind=master&textbookDetail=${b}`)
  await h.resolve(h.requests.find((request) => request.name === "get_textbook_master_detail_v1" && request.args.p_id === b), { row: masterRow(152, { title: "교재 151", name: "교재 151", grade_level: "m2", grade_levels: ["m2"] }) })
  const duplicateB = h.requests.findLast((request) => request.name === "check_textbook_master_duplicate_v1")
  assert.equal(duplicateB.args.p_input.excludeId, b)
  assert.notEqual(duplicateB, duplicateA)
  assert.equal(document.querySelector('[aria-label="교재 저장"]').disabled, true, "A duplicate acceptance cannot authorize edit B")
})

test("static TeacherSelect retains Radix combobox and explicit unassigned option", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests&textbookPage=1&textbookPageSize=10" })
  const TeacherSelect = h.load("src/features/textbooks/textbook-operations-workspace.tsx").__testOnlyTeacherSelect
  const mounted = await h.mountTestComponent(TeacherSelect, { teachers: [{ id: id(901), name: "정적 선생님" }], value: "", onValueChange() {} })
  const trigger = [...document.querySelectorAll('[aria-label="선생님 선택"]')].at(-1)
  assert.equal(trigger.getAttribute("role"), "combobox")
  await h.act(() => trigger.click())
  assert.equal(document.body.textContent.includes("미지정"), true)
  await mounted.cleanup()
})

test("request form keeps failed input and stable save controls, rejects double submits, and clears a cancelled error", async (t) => {
  const h = await setup(t, { search: "?textbookTab=requests" })
  await h.resolve(h.requests.find(r => r.name === "list_textbook_purchase_page_v1"), { rows: [], page: 1, pageSize: 10, totalCount: 0 })
  await h.resolve(h.requests.find(r => r.name === "get_textbook_purchase_summary_v1"), purchaseSummary("request", 0))
  await h.act(() => button("교재 요청 추가").click())
  await h.act(() => button("직접 입력").click())
  const change = async (label, value) => {
    const input = document.querySelector(`[aria-label="${label}"]`)
    await h.act(() => input[Object.keys(input).find(key => key.startsWith("__reactProps$"))].onChange({ target: { value } }))
  }
  await change("요청 교재명", "실패해도 남을 교재")
  await change("학생용 요청 수량", "7")
  await change("요청 메모", "다음 수업 전 필요")
  await h.resolve(h.requests.find(r => r.name === "list_textbook_location_reference_page_v1"), {
    rows: [requestLocationOption], page: 1, pageSize: 20, totalCount: 1, defaultLocation: { id: id(900), code: "main", name: "본관" },
  })
  await h.resolve(h.requests.find(r => r.name === "get_textbook_location_reference_v1"), {
    row: { id: id(900), code: "main", name: "본관", option: requestLocationOption },
  })
  const submit = button("요청 저장")
  const dialog = submit.closest('[role="dialog"]')
  const form = submit.closest('form')
  assert.equal(submit.disabled, false)
  // Dispatch twice in one React turn, before disabled state can be committed.
  await h.act(() => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
  })
  const writes = h.requests.filter(r => r.name === "create_textbook_request_v1")
  assert.equal(writes.length, 1)
  assert.equal(writes[0].args.p_student_requested_quantity, 7)
  assert.equal(button("요청 저장"), submit, "pending state preserves the same labeled button")
  assert.equal(submit.disabled, true)
  assert.equal(form.getAttribute("aria-busy"), "true")
  await h.reject(writes[0], { message: "합성 요청 저장 실패" })
  const error = dialog.querySelector('[role="alert"]')
  assert.ok(error.textContent.includes(safeUnexpectedError))
  assert.equal(error.textContent.includes("합성 요청 저장 실패"), false)
  assert.equal(document.activeElement, error, "failure is focused inside the visible dialog")
  assert.equal([...document.querySelectorAll('[role="alert"]')].filter(node => node.textContent.includes(safeUnexpectedError)).length, 1, "no duplicate announcement behind the dialog")
  assert.equal(dialog.querySelector('[aria-label="요청 교재명"]').value, "실패해도 남을 교재")
  assert.equal(dialog.querySelector('[aria-label="요청 메모"]').value, "다음 수업 전 필요")
  assert.equal(submit.disabled, false)
  await h.act(() => submit.click())
  const retry = h.requests.findLast(r => r.name === "create_textbook_request_v1")
  assert.notEqual(retry, writes[0], "a completed failure releases the submission guard")
  assert.equal(dialog.querySelector('[role="alert"]'), null)
  await h.reject(retry, { message: "합성 재시도 실패" })
  await h.act(() => button("교재 요청·주문 창 닫기").click())
  assert.ok(document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'))
  await h.act(() => button("변경사항 버리기").click())
  await h.act(() => new Promise(resolve => setTimeout(resolve, 30)))
  await h.act(() => button("교재 요청 추가").click())
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]'), null, "a new form does not inherit the explicitly discarded failure")
})

test("bulk order keeps quantities and selection after a fresh-detail failure and permits one retry", async (t) => {
  const row = purchaseRow("order")
  const h = await setup(t, { search: "?textbookTab=purchase" })
  await h.resolve(h.requests.find(r => r.name === "list_textbook_purchase_page_v1"), { rows: [row], page: 1, pageSize: 10, totalCount: 1 })
  await h.resolve(h.requests.find(r => r.name === "get_textbook_purchase_summary_v1"), purchaseSummary("order", 1))
  const checkbox = document.querySelector('[data-prepared-surface="purchase-desktop"] [aria-label$="일괄 처리 선택"]')
  assert.ok(checkbox)
  await h.act(() => checkbox.click())
  assert.ok(document.body.textContent.includes("2개 선택"), "grouped checkbox owns both student and teacher members")
  await h.act(() => button("선택 요청 일괄 주문").click())
  const dialog = document.querySelector('[role="dialog"]')
  const studentQuantity = dialog.querySelector('[aria-label="교재 101 학생용 주문 수량"]')
  const teacherQuantity = dialog.querySelector('[aria-label="교재 101 교사용 주문 수량"]')
  assert.equal(studentQuantity.value, "2")
  assert.equal(teacherQuantity.value, "2")
  await h.act(() => studentQuantity[Object.keys(studentQuantity).find(key => key.startsWith("__reactProps$"))].onChange({ target: { value: "9" } }))
  await h.act(() => teacherQuantity[Object.keys(teacherQuantity).find(key => key.startsWith("__reactProps$"))].onChange({ target: { value: "4" } }))
  const form = studentQuantity.closest('form')
  await h.act(() => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
  })
  const reads = h.requests.filter(r => r.name === "get_textbook_purchase_detail_v1")
  assert.equal(reads.length, 1, "two scope lines share one fresh detail read and repeated submit stays locked")
  assert.equal(button("일괄 주문").disabled, true)
  await h.reject(reads[0], { message: "합성 일괄 주문 조회 실패" })
  assert.ok(dialog.querySelector('[role="alert"]').textContent.includes(safeUnexpectedError))
  assert.equal(dialog.textContent.includes("합성 일괄 주문 조회 실패"), false)
  assert.equal(studentQuantity.value, "9")
  assert.equal(teacherQuantity.value, "4")
  assert.equal(h.requests.some(r => r.table), false, "failed authoritative read never reaches a writer")
  assert.equal(button("일괄 주문").disabled, false)
  await h.act(() => button("일괄 주문").click())
  const retry = h.requests.findLast(r => r.name === "get_textbook_purchase_detail_v1")
  assert.notEqual(retry, reads[0])
  assert.deepEqual(retry.args, reads[0].args)
})

test("master common form keeps ISBN and price after failed save and admits only one concurrent write", async (t) => {
  const row = masterRow(151)
  const h = await setup(t, { search: `?textbookTab=master&textbookDetailKind=master&textbookDetail=${row.id}` })
  await h.resolve(h.requests.find(r => r.name === "get_textbook_master_detail_v1"), { row })
  await h.resolve(h.requests.findLast(r => r.name === "get_textbook_master_options_v1"), masterOptions())
  await h.resolve(h.requests.findLast(r => r.name === "check_textbook_master_duplicate_v1"), { totalCount: 0, previewRows: [] })
  const change = async (label, value) => {
    const input = document.querySelector(`[aria-label="${label}"]`)
    await h.act(() => input[Object.keys(input).find(k => k.startsWith("__reactProps$"))].onChange({ target: { value } }))
  }
  await change("ISBN", "9781234567890")
  await change("판매가", "14500")
  const save = document.querySelector('[aria-label="교재 저장"]')
  assert.equal(save.disabled, false, document.querySelector('[role="dialog"]').textContent)
  const form = save.closest('form')
  await h.act(() => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
  })
  const writes = h.requests.filter(r => r.table === "textbooks")
  assert.equal(writes.length, 1)
  const payload = writes[0].steps.find(s => s.method === "upsert").args[0]
  assert.equal(payload.isbn13, "9781234567890")
  assert.equal(payload.barcode, "9781234567890")
  assert.equal(payload.sale_price, 14500)
  assert.equal(save.textContent.trim(), "변경 저장")
  await h.reject(writes[0], { message: "합성 교재 저장 실패" })
  const dialog = document.querySelector('[role="dialog"]')
  const alert = dialog.querySelector('[role="alert"]')
  assert.equal(document.activeElement, alert)
  assert.ok(alert.textContent.includes(safeUnexpectedError))
  assert.equal(alert.textContent.includes("합성 교재 저장 실패"), false)
  assert.equal(dialog.querySelector('[aria-label="ISBN"]').value, "9781234567890")
  assert.equal(dialog.querySelector('[aria-label="판매가"]').value, "14500")
  assert.equal(save.disabled, false)
  await h.act(() => save.click())
  assert.equal(h.requests.filter(r => r.table === "textbooks").length, 2)
  assert.equal(dialog.querySelector('[role="alert"]'), null)
})

test("sale detail retries in place and shows complete long identity and operational fields without writes", async (t) => {
  const row = saleRow()
  const h = await setup(t, { search: `?textbookTab=sales&textbookDetailKind=sale&textbookDetail=${row.id}` })
  const detail = h.requests.find(r => r.name === "get_textbook_sale_detail_v1")
  const body = document.querySelector('[data-slot="detail-dialog-body"]')
  assert.ok(body.querySelector('[role="status"]'))
  await h.reject(detail, { message: "합성 상세 조회 실패" })
  assert.equal(document.querySelector('[data-slot="detail-dialog-body"]'), body)
  assert.ok(body.querySelector('[role="alert"]').textContent.includes(safeUnexpectedError))
  assert.equal(body.textContent.includes("합성 상세 조회 실패"), false)
  await h.act(() => button("다시 시도").click())
  const retry = h.requests.findLast(r => r.name === "get_textbook_sale_detail_v1")
  const title = "줄임 없이 보여야 하는 매우 긴 영어 교재명 ".repeat(8)
  const recipient = "긴 이름의 교사용 수령인"
  await h.resolve(retry, { row: { ...row, textbook: { ...row.textbook, title, name: title }, recipientName: recipient, line: { ...row.line, teacher_name: recipient, memo: "첫째 줄\n둘째 줄" } } })
  const values = Object.fromEntries([...body.querySelectorAll('dl > div')].map(node => [node.querySelector('dt').textContent, node.querySelector('dd').textContent]))
  assert.equal(values.교재, title.trim())
  assert.equal(values.대상, recipient)
  assert.equal(values.구분, "교사용")
  assert.equal(values.위치, "본관")
  assert.equal(values.수량, "2권")
  assert.equal(values.메모, "첫째 줄\n둘째 줄")
  assert.equal(h.requests.some(r => r.table), false)
  await h.act(() => button("닫기").click())
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(new URLSearchParams(window.location.search).has('textbookDetail'), false)
})
