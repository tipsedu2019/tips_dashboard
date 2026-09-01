import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { inspectQuerySurfaceSource } from "../src/lib/query-surface-budget.js";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const serviceUrl = new URL("textbook-reference-service.ts", feature);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/supabase" && context.parentURL?.startsWith(feature.href)) return { url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";', shortCircuit: true };
  if (specifier.startsWith("./") && context.parentURL?.startsWith(feature.href)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });
async function service() {
  assert.ok(existsSync(serviceUrl), "independent reference service must exist");
  return import(serviceUrl.href);
}
const id = (n) => `4d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function wire(data, error = null, settled) {
  const calls = [];
  return { calls, client: { rpc(name, args) {
    const call = { name, args }; calls.push(call);
    return { abortSignal(signal) { call.signal = signal; return this; }, retry(value) { call.retry = value; return this; },
      then(resolve, reject) { return Promise.resolve().then(() => { settled?.(); return { data, error }; }).then(resolve, reject); } };
  }, from() { throw new Error("full catalog fallback forbidden"); } } };
}
const pageCases = [
  ["listTextbookReferencePage", "list_textbook_reference_page_v1", "match-title", { search: "", selectedFilters: {} }, { baseFilterGroups: [], visibleFilterGroups: [], activeFilterCount: 0 }],
  ["listTextbookClassReferencePage", "list_textbook_class_reference_page_v1", "match-name", { search: "", selectedFilters: {} }, { baseFilterGroups: [], visibleFilterGroups: [], activeFilterCount: 0 }],
  ["listTextbookTeacherReferencePage", "list_textbook_teacher_reference_page_v1", "match-name", { search: "" }, {}],
  ["listTextbookLocationReferencePage", "list_textbook_location_reference_page_v1", "match-order", { search: "" }, { defaultLocation: { id: id(300), code: "main", name: "본관" } }],
];
for (const [method, rpc, sort, filters, extra] of pageCases) {
  test(`${method} directly reads requested page 11 with full count and no traversal`, async () => {
    const api = await service(); const request = { page: 11, pageSize: 10, sort, filters };
    const option = method.includes("Teacher") ? { value: "사용자 이름", label: "사용자 이름" }
      : method.includes("Location") ? { value: id(101), label: "별관", searchText: "annex" }
      : { value: id(101), label: "교재 101", description: "", searchText: "", metaRows: [], filterValues: method.includes("Class") ? { subject: [], grade: [], teacher: [] } : { subject: [], grade: [], subSubject: [] } };
    const response = { rows: [option], page: 11, pageSize: 10, totalCount: 101, ...extra };
    const transport = wire(response); assert.deepEqual(await api[method](request, { client: transport.client }), response);
    assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].name, rpc); assert.equal(transport.calls[0].retry, false);
    assert.deepEqual(transport.calls[0].args, { p_filters: filters, p_sort: sort, p_page: 11, p_page_size: 10 });
    for (const pageSize of [10, 15, 20]) {
      const data = { ...response, rows: [], page: 100, pageSize };
      assert.deepEqual(await api[method]({ ...request, page: 100, pageSize }, { client: wire(data).client }), data);
    }
    for (const bad of [null, {}, { ...response, rows: [] }, { ...response, rows: [{ ...option, unexpected: true }] }, { ...response, totalCount: -1 }, { ...response, extra: 1 }]) {
      await assert.rejects(() => api[method](request, { client: wire(bad).client }), /response_invalid/);
    }
    for (const patch of [{ page: 0 }, { page: null }, { pageSize: 30 }, { sort: "unknown" }, { filters: { ...filters, search: null } }, { filters: { ...filters, unknown: "" } }]) {
      const invalid = wire(null); await assert.rejects(() => api[method]({ ...request, ...patch }, { client: invalid.client }), /invalid/); assert.equal(invalid.calls.length, 0);
    }
  });
  test(`${method} fails closed on missing APIs and stale/aborted reads`, async () => {
    const api = await service(); const request = { page: 1, pageSize: 10, sort, filters };
    for (const code of ["PGRST202", "42883", "42501"]) {
      const transport = wire(null, { code }); await assert.rejects(() => api[method](request, { client: transport.client }), error => error.code === (code === "42501" ? code : "textbook_read_rpc_unavailable")); assert.equal(transport.calls.length, 1);
    }
    const controller = new AbortController(); controller.abort(); const pre = wire(null);
    await assert.rejects(() => api[method](request, { client: pre.client, signal: controller.signal }), { name: "AbortError" }); assert.equal(pre.calls.length, 0);
    const late = new AbortController(); const post = wire(null, null, () => late.abort());
    await assert.rejects(() => api[method](request, { client: post.client, signal: late.signal }), { name: "AbortError" }); assert.equal(post.calls[0].signal.aborted, true);
  });
}
test("selected reference absence stays distinct from malformed and unavailable context", async () => {
  const api = await service();
  for (const [method, input, rpc, args] of [
    ["resolveTextbookReference", { reference: "unknown", activeOnly: false, scope: "request", fallbackSupplier: "custom" }, "resolve_textbook_reference_v1", { p_reference: "unknown", p_active_only: false, p_scope: "request", p_fallback_supplier: "custom" }],
    ["getTextbookClassReference", id(200), "get_textbook_class_reference_v1", { p_class_id: id(200) }],
    ["getTextbookLocationReference", id(300), "get_textbook_location_reference_v1", { p_location_id: id(300) }],
  ]) {
    const t = wire({ row: null }); assert.deepEqual(await api[method](input, { client: t.client }), { row: null });
    assert.equal(t.calls[0].name, rpc); assert.deepEqual(t.calls[0].args, args); assert.equal(t.calls[0].retry, false);
    for (const bad of [null, {}, { row: {} }, { row: null, complete: true }]) await assert.rejects(() => api[method](input, { client: wire(bad).client }), /response_invalid/);
  }
});
test("metadata and inactive cleanup require complete internally consistent responses", async () => {
  const api = await service(); const filters = { subject: "math", listSubject: "all", bulkSubject: "keep" };
  const metadata = { publisherOptions: [], subSubjectOptions: [], categoryOptions: [], bulkCategoryOptions: [], scienceSubjectAreas: [], counts: { publisherOptions: 0, subSubjectOptions: 0, categoryOptions: 0, bulkCategoryOptions: 0, scienceSubjectAreas: 0 }, complete: true };
  assert.deepEqual(await api.getTextbookMasterOptions(filters, { client: wire(metadata).client }), metadata);
  const targetIds = Array.from({ length: 121 }, (_, n) => id(n + 1));
  const cleanup = { targetIds, totalCount: 121, previewRows: targetIds.slice(0, 5).map((id, n) => ({ id, title: `교재 ${n}`, detail: "미사용" })), complete: true };
  assert.deepEqual(await api.getTextbookInactiveCleanupContext({ client: wire(cleanup).client }), cleanup);
  for (const bad of [null, { ...cleanup, complete: false }, { ...cleanup, totalCount: 5 }, { ...cleanup, targetIds: targetIds.slice(0, 100) }, { ...cleanup, previewRows: [] }, { ...cleanup, previewRows: [...cleanup.previewRows].reverse() }]) await assert.rejects(() => api.getTextbookInactiveCleanupContext({ client: wire(bad).client }), /response_invalid/);
  for (const bad of [null, { ...metadata, complete: false }, { ...metadata, counts: { ...metadata.counts, categoryOptions: 1 } }]) await assert.rejects(() => api.getTextbookMasterOptions(filters, { client: wire(bad).client }), /response_invalid/);
});

test("selected book retains raw status and taxonomy aliases while restoring original command-value key order", async () => {
  const api = await service(); const model = await import(new URL("textbook-reference-model.ts", feature));
  const textbook = { id: id(121), title: "교재", name: "교재", status: "사용중", subject: "math", publisher: "출판사", publisher_id: null, default_supplier_id: null,
    price: 10001, sale_price: 10001, list_price: 0, isbn13: null, barcode: null, is_returnable: false, category: "독해", school_level: "middle", grade_level: "m2",
    school_levels: ["middle", "middle"], grade_levels: ["m2", "m2"], sub_subject: "독해", subject_area_key: null };
  const original = model.buildTextbookReferenceOptions([textbook])[0];
  const reordered = { ...original, filterValues: { grade: original.filterValues.grade, subject: original.filterValues.subject, subSubject: original.filterValues.subSubject } };
  const data = { row: { textbook, option: reordered, configuredSupplierId: " custom ", supplier: null } };
  const input = { reference: "교재", activeOnly: true, scope: "request", fallbackSupplier: " custom " };
  const result = await api.resolveTextbookReference(input, { client: wire(data).client });
  assert.equal(result.row.textbook.status, "사용중");
  assert.deepEqual(Object.keys(result.row.option.filterValues), ["subject", "grade", "subSubject"]);
  assert.equal(model.buildSearchSelectCommandValue(result.row.option), model.buildSearchSelectCommandValue(original));
  await assert.rejects(() => api.resolveTextbookReference({ ...input, reference: "다른 교재" }, { client: wire(data).client }), /response_invalid/);
  for (const mutate of [row => { row.option.label = "wrong"; }, row => { row.option.filterValues.unknown = []; }, row => { row.supplier = { id: id(1), name: "forbidden" }; }, row => { delete row.textbook.category; }]) {
    const bad = structuredClone(data); mutate(bad.row); await assert.rejects(() => api.resolveTextbookReference(input, { client: wire(bad).client }), /response_invalid/);
  }
});

test("reference pages reject rows contradicting facets, teacher name normalization or full-source default presence", async () => {
  const api = await service();
  const classOption = { value: id(1), label: "수업", description: "", searchText: "", metaRows: [], filterValues: { subject: [{ value: "수학", label: "수학" }], grade: [], teacher: [] } };
  const base = [{ key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"], options: [{ value: "수학", label: "수학", count: 1 }] }];
  await assert.rejects(() => api.listTextbookClassReferencePage({ page: 1, pageSize: 10, sort: "match-name", filters: { search: "", selectedFilters: { subject: ["unknown"] } } },
    { client: wire({ rows: [classOption], page: 1, pageSize: 10, totalCount: 1, baseFilterGroups: base, visibleFilterGroups: base, activeFilterCount: 0 }).client }), /response_invalid/);
  await assert.rejects(() => api.listTextbookTeacherReferencePage({ page: 1, pageSize: 10, sort: "match-name", filters: { search: "" } },
    { client: wire({ rows: [{ value: " ", label: " " }], page: 1, pageSize: 10, totalCount: 1 }).client }), /response_invalid/);
  await assert.rejects(() => api.listTextbookLocationReferencePage({ page: 1, pageSize: 10, sort: "match-order", filters: { search: "" } },
    { client: wire({ rows: [{ value: id(1), label: "본관", searchText: "main" }], page: 1, pageSize: 10, totalCount: 1, defaultLocation: null }).client }), /response_invalid/);
});

test("management fallback retains legacy case-sensitive id-or-trimmed-name association without input normalization", async () => {
  const api = await service(); const model = await import(new URL("textbook-reference-model.ts", feature));
  const legacy = await import(new URL("textbook-handoff-model.ts", feature));
  const suppliers = [{ id: id(3900), name: id(4001) }, { id: id(3901), name: "  Legacy Vendor  " }, { id: id(4001), name: "외부 공급처" }];
  assert.equal(legacy.getSupplierName(suppliers, id(4001)), id(4001));
  assert.equal(legacy.getSupplierName(suppliers, "Legacy Vendor"), "Legacy Vendor");
  assert.equal(legacy.getSupplierName(suppliers, "legacy vendor"), "legacy vendor");
  const textbook = { id: id(131), title: "Basic Grammar", name: "Basic Grammar", status: "active", subject: "english", publisher: null, publisher_id: null, default_supplier_id: null,
    price: 0, sale_price: 0, list_price: 0, isbn13: null, barcode: null, is_returnable: false, category: null, school_level: "middle", grade_level: "m2",
    school_levels: ["middle"], grade_levels: ["m2"], sub_subject: "문법", subject_area_key: null };
  for (const [fallbackSupplier, supplier] of [["Legacy Vendor", suppliers[1]], [id(4001), suppliers[0]], ["외부 공급처", suppliers[2]], [" Legacy Vendor ", null], ["legacy vendor", null], ["unknown", null]]) {
    const input = { reference: id(131), activeOnly: true, scope: "management", fallbackSupplier };
    const data = { row: { textbook, option: model.buildTextbookReferenceOptions([textbook])[0], configuredSupplierId: fallbackSupplier, supplier } };
    assert.deepEqual(await api.resolveTextbookReference(input, { client: wire(data).client }), data);
    if (supplier === null) await assert.rejects(() => api.resolveTextbookReference(input, { client: wire({ row: { ...data.row, supplier: suppliers[1] } }).client }), /response_invalid/);
  }
});

test("all five purpose reads propagate eight-second cancellation and never retry or fallback", async () => {
  const api = await service(); const savedTimeout = AbortSignal.timeout; const timeouts = [];
  const cases = [
    ["resolveTextbookReference", [{ reference: "", activeOnly: false, scope: "request", fallbackSupplier: "" }]],
    ["getTextbookClassReference", [id(1)]], ["getTextbookLocationReference", [id(1)]],
    ["getTextbookMasterOptions", [{ subject: "math", listSubject: "all", bulkSubject: "keep" }]], ["getTextbookInactiveCleanupContext", []],
  ];
  try {
    AbortSignal.timeout = ms => { timeouts.push(ms); return savedTimeout(1000); };
    for (const [method, args] of cases) {
      const cancelled = new AbortController(); const t = wire(null, null, () => cancelled.abort());
      await assert.rejects(() => api[method](...args, { client: t.client, signal: cancelled.signal }), { name: "AbortError" });
      assert.equal(t.calls.length, 1); assert.equal(t.calls[0].retry, false); assert.equal(t.calls[0].signal.aborted, true);
      const missing = wire(null, { code: "PGRST202" });
      await assert.rejects(() => api[method](...args, { client: missing.client }), { code: "textbook_read_rpc_unavailable" }); assert.equal(missing.calls.length, 1);
    }
    assert.ok(timeouts.every(ms => ms === 8000)); assert.equal(timeouts.length, 10);
  } finally { AbortSignal.timeout = savedTimeout; }
});

test("final-proven reference contracts classify exactly four pages and five independent purpose reads", () => {
  const inspect = (name, args, suffix = ".abortSignal(AbortSignal.timeout(8000)).retry(false)") => inspectQuerySurfaceSource({
    surface: "management", file: "src/features/textbooks/reference-fixture.ts",
    source: `async function read(client, request) { return client.rpc(${JSON.stringify(name)}, ${args})${suffix} }`,
  }).map(item => item.reason);
  for (const [, rpc] of pageCases) {
    for (const size of ["10", "15", "20", "request.pageSize"]) assert.deepEqual(inspect(rpc, `{p_page:11,p_page_size:${size}}`), []);
    for (const size of ["5", "30", "null"]) assert.deepEqual(inspect(rpc, `{p_page_size:${size}}`), ["rpc_page_limit_invalid"]);
    assert.deepEqual(inspect(rpc, "{...request,p_page_size:10}"), ["rpc_page_limit_unresolved"]);
    assert.deepEqual(inspect(rpc.replace("v1", "v2"), "{p_page_size:10}"), ["rpc_page_limit_missing"]);
    assert.ok(inspect(rpc, "{p_page_size:10}", ".retry(false)").includes("list_abort_signal_missing"));
    assert.ok(inspect(rpc, "{p_page_size:10}", ".abortSignal(AbortSignal.timeout(8000))").includes("list_retry_false_missing"));
  }
  for (const rpc of ["resolve_textbook_reference_v1", "get_textbook_class_reference_v1", "get_textbook_location_reference_v1", "get_textbook_master_options_v1", "get_textbook_inactive_cleanup_context_v1"]) {
    assert.deepEqual(inspect(rpc, "{}"), []);
    assert.deepEqual(inspect(rpc.replace("v1", "v2"), "{}"), ["rpc_page_limit_missing"]);
    assert.ok(inspect(rpc, "{}", ".retry(false)").includes("list_abort_signal_missing"));
    assert.ok(inspect(rpc, "{}", ".abortSignal(AbortSignal.timeout(8000))").includes("list_retry_false_missing"));
  }
});
test("actual reference service retains literal exact RPCs with caller signal and eight-second deadlines", () => {
  const source = readFileSync(serviceUrl, "utf8");
  const inspect = text => inspectQuerySurfaceSource({ surface: "management", file: "src/features/textbooks/textbook-reference-service.ts", source: text });
  assert.deepEqual(inspect(source), []);
  assert.ok(inspect(source.replaceAll("AbortSignal.timeout(8000)", "AbortSignal.timeout(9000)")).some(item => item.reason === "list_abort_signal_missing"));
  assert.ok(inspect(source.replaceAll(".retry(false)", "")).some(item => item.reason === "list_retry_false_missing"));
});

// Untouched JSON payloads from the distinct require-final run; only '# TASK4_WIRE ' was removed.
// Final log SHA256: 802cfe2b36af96d94a185b7b9250675569e0087116174651f23e891634d5cfba
// Manifest SHA256 at capture: 3bcf41c5e7bd7aea88dfc6c5ca6cbf23af3fa01784955e82f9042ab753be3b0a
const finalReferenceSqlWirePayloads = [
  String.raw`{"data": {"page": 1, "rows": [{"label": "수학의 정석 기본", "value": "4d000000-0000-4000-8000-000000000121", "metaRows": [{"label": "출판사", "value": "legacy 출판사"}, {"label": "구분", "value": "중등 · 중2 · 독해"}, {"label": "ISBN", "value": "978-121"}, {"label": "바코드", "value": "code-121"}], "searchText": "수학의정석기본 legacy 출판사 독해 중등 · 중2 · 독해 중등 중2 독해 978-121 code-121", "description": "수학", "filterValues": {"grade": [{"label": "중2", "value": "m2"}], "subject": [{"label": "수학", "value": "수학"}], "subSubject": [{"label": "독해", "value": "독해"}]}}], "pageSize": 10, "totalCount": 1, "baseFilterGroups": [{"key": "subject", "label": "과목", "options": [{"count": 63, "label": "영어", "value": "영어"}, {"count": 60, "label": "수학", "value": "수학"}], "optionOrder": ["영어", "수학", "과학", "기타"]}, {"key": "grade", "label": "학년", "options": [{"count": 123, "label": "중2", "value": "m2"}]}, {"key": "subSubject", "label": "세부과목", "options": [{"count": 120, "label": "독해", "value": "독해"}, {"count": 3, "label": "문법", "value": "문법"}]}], "activeFilterCount": 0, "visibleFilterGroups": [{"key": "subject", "label": "과목", "options": [{"count": 63, "label": "영어", "value": "영어"}, {"count": 60, "label": "수학", "value": "수학"}], "optionOrder": ["영어", "수학", "과학", "기타"]}, {"key": "grade", "label": "학년", "options": [{"count": 123, "label": "중2", "value": "m2"}]}, {"key": "subSubject", "label": "세부과목", "options": [{"count": 120, "label": "독해", "value": "독해"}, {"count": 3, "label": "문법", "value": "문법"}]}]}, "input": {"page": 1, "sort": "match-title", "filters": {"search": "수정", "selectedFilters": {}}, "pageSize": 10}, "method": "listTextbookReferencePage", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"page": 1, "rows": [{"label": "유일선택반", "value": "4d000000-0000-4000-8000-000000001121", "metaRows": [{"label": "선생님", "value": "김, 이, 박, 최"}, {"label": "강의실", "value": "별 2"}, {"label": "학생", "value": "3명"}, {"label": "시간", "value": "월 수"}], "searchText": "김 / 이·박|최   수학 중2 사용중 월 수", "description": "수학 · 중2", "filterValues": {"grade": [{"label": "중2", "value": "중2"}], "subject": [{"label": "수학", "value": "수학"}], "teacher": [{"label": "김", "value": "김"}, {"label": "이", "value": "이"}, {"label": "박", "value": "박"}, {"label": "최", "value": "최"}]}}], "pageSize": 10, "totalCount": 1, "baseFilterGroups": [{"key": "subject", "label": "과목", "options": [{"count": 120, "label": "수학", "value": "수학"}], "optionOrder": ["영어", "수학", "과학", "기타"]}, {"key": "grade", "label": "학년", "options": [{"count": 120, "label": "중2", "value": "중2"}]}, {"key": "teacher", "label": "선생님", "options": [{"count": 120, "label": "김", "value": "김"}, {"count": 120, "label": "박", "value": "박"}, {"count": 120, "label": "이", "value": "이"}, {"count": 120, "label": "최", "value": "최"}]}], "activeFilterCount": 0, "visibleFilterGroups": [{"key": "subject", "label": "과목", "options": [{"count": 120, "label": "수학", "value": "수학"}], "optionOrder": ["영어", "수학", "과학", "기타"]}, {"key": "grade", "label": "학년", "options": [{"count": 120, "label": "중2", "value": "중2"}]}, {"key": "teacher", "label": "선생님", "options": [{"count": 120, "label": "김", "value": "김"}, {"count": 120, "label": "박", "value": "박"}, {"count": 120, "label": "이", "value": "이"}, {"count": 120, "label": "최", "value": "최"}]}]}, "input": {"page": 1, "sort": "match-name", "filters": {"search": "유일선택반", "selectedFilters": {}}, "pageSize": 10}, "method": "listTextbookClassReferencePage", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"page": 1, "rows": [{"label": "가유일교사", "value": "가유일교사"}], "pageSize": 10, "totalCount": 1}, "input": {"page": 1, "sort": "match-name", "filters": {"search": "가유일교사"}, "pageSize": 10}, "method": "listTextbookTeacherReferencePage", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"page": 1, "rows": [{"label": "유일창고", "value": "4d000000-0000-4000-8000-000000005119", "searchText": "loc-119"}], "pageSize": 10, "totalCount": 1, "defaultLocation": {"id": "4d000000-0000-4000-8000-000000005121", "code": "main", "name": "본관"}}, "input": {"page": 1, "sort": "match-order", "filters": {"search": "유일창고"}, "pageSize": 10}, "method": "listTextbookLocationReferencePage", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"row": {"option": {"label": "수학의 정석 기본", "value": "4d000000-0000-4000-8000-000000000121", "metaRows": [{"label": "출판사", "value": "legacy 출판사"}, {"label": "구분", "value": "중등 · 중2 · 독해"}, {"label": "ISBN", "value": "978-121"}, {"label": "바코드", "value": "code-121"}], "searchText": "수학의정석기본 legacy 출판사 독해 중등 · 중2 · 독해 중등 중2 독해 978-121 code-121", "description": "수학", "filterValues": {"grade": [{"label": "중2", "value": "m2"}], "subject": [{"label": "수학", "value": "수학"}], "subSubject": [{"label": "독해", "value": "독해"}]}}, "supplier": null, "textbook": {"id": "4d000000-0000-4000-8000-000000000121", "name": "수학의 정석 기본", "price": 10001, "title": "수학의 정석 기본", "isbn13": "978-121", "status": "active", "barcode": "code-121", "subject": "math", "category": "독해", "publisher": "legacy 출판사", "list_price": 0, "sale_price": 10001, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": "4d000000-0000-4000-8000-000000003001", "school_level": "middle", "is_returnable": false, "school_levels": ["middle"], "subject_area_key": null, "default_supplier_id": null}, "configuredSupplierId": "legacy"}}, "input": {"scope": "request", "reference": "수학의 정석 기본", "activeOnly": true, "fallbackSupplier": "legacy"}, "method": "resolveTextbookReference", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"row": null}, "input": {"scope": "request", "reference": "unknown", "activeOnly": false, "fallbackSupplier": ""}, "method": "resolveTextbookReference", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"row": {"id": "4d000000-0000-4000-8000-000000001121", "name": "유일선택반", "option": {"label": "유일선택반", "value": "4d000000-0000-4000-8000-000000001121", "metaRows": [{"label": "선생님", "value": "김, 이, 박, 최"}, {"label": "강의실", "value": "별 2"}, {"label": "학생", "value": "3명"}, {"label": "시간", "value": "월 수"}], "searchText": "김 / 이·박|최   수학 중2 사용중 월 수", "description": "수학 · 중2", "filterValues": {"grade": [{"label": "중2", "value": "중2"}], "subject": [{"label": "수학", "value": "수학"}], "teacher": [{"label": "김", "value": "김"}, {"label": "이", "value": "이"}, {"label": "박", "value": "박"}, {"label": "최", "value": "최"}]}}, "inferredLocation": {"id": "4d000000-0000-4000-8000-000000005120", "code": "annex", "name": "별관"}, "defaultTeacherName": "김", "enrolledStudentCount": 3}}, "input": "4d000000-0000-4000-8000-000000001121", "method": "getTextbookClassReference", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"row": {"id": "4d000000-0000-4000-8000-000000005121", "code": "main", "name": "본관", "option": {"label": "본관", "value": "4d000000-0000-4000-8000-000000005121", "searchText": "main"}}}, "input": "4d000000-0000-4000-8000-000000005121", "method": "getTextbookLocationReference", "actorId": "4d000000-0000-4000-8000-000000000903"}`,
  String.raw`{"data": {"row": {"option": {"label": "수학의 정석 기본", "value": "4d000000-0000-4000-8000-000000000121", "metaRows": [{"label": "출판사", "value": "legacy 출판사"}, {"label": "구분", "value": "중등 · 중2 · 독해"}, {"label": "ISBN", "value": "978-121"}, {"label": "바코드", "value": "code-121"}], "searchText": "수학의정석기본 legacy 출판사 독해 중등 · 중2 · 독해 중등 중2 독해 978-121 code-121", "description": "수학", "filterValues": {"grade": [{"label": "중2", "value": "m2"}], "subject": [{"label": "수학", "value": "수학"}], "subSubject": [{"label": "독해", "value": "독해"}]}}, "supplier": {"id": "4d000000-0000-4000-8000-000000004001", "name": "외부 공급처"}, "textbook": {"id": "4d000000-0000-4000-8000-000000000121", "name": "수학의 정석 기본", "price": 10001, "title": "수학의 정석 기본", "isbn13": "978-121", "status": "active", "barcode": "code-121", "subject": "math", "category": "독해", "publisher": "legacy 출판사", "list_price": 0, "sale_price": 10001, "grade_level": "m2", "sub_subject": "독해", "grade_levels": ["m2"], "publisher_id": "4d000000-0000-4000-8000-000000003001", "school_level": "middle", "is_returnable": false, "school_levels": ["middle"], "subject_area_key": null, "default_supplier_id": null}, "configuredSupplierId": "4d000000-0000-4000-8000-000000004001"}}, "input": {"scope": "management", "reference": "수학의 정석 기본", "activeOnly": true, "fallbackSupplier": "legacy"}, "method": "resolveTextbookReference", "actorId": "4d000000-0000-4000-8000-000000000904"}`,
  String.raw`{"data": {"counts": {"categoryOptions": 21, "publisherOptions": 2, "subSubjectOptions": 10, "bulkCategoryOptions": 21, "scienceSubjectAreas": 2}, "complete": true, "categoryOptions": ["공통수학1", "공통수학2", "기타", "기하", "내신", "단어", "대수", "독해", "듣기", "모고", "문법", "물리학", "분류 10", "분류 2", "생명과학", "수1", "수2", "지구과학", "통합과학", "화학", "확률과 통계"], "publisherOptions": [{"label": "설정 출판사 1", "value": "설정 출판사 1", "description": "설정"}, {"label": "legacy 출판사", "value": "legacy 출판사", "description": "기존"}], "subSubjectOptions": ["공통수학1", "공통수학2", "기하", "내신", "대수", "분류 2", "분류 10", "수1", "수2", "확률과 통계"], "bulkCategoryOptions": ["공통수학1", "공통수학2", "기타", "기하", "내신", "단어", "대수", "독해", "듣기", "모고", "문법", "물리학", "분류 2", "분류 10", "생명과학", "수1", "수2", "지구과학", "통합과학", "화학", "확률과 통계"], "scienceSubjectAreas": [{"label": "통합과학", "subject": "과학", "area_key": "integrated_science", "is_active": true, "sort_order": 10}, {"label": "물리학", "subject": "과학", "area_key": "physics", "is_active": true, "sort_order": 20}]}, "input": {"subject": "math", "bulkSubject": "keep", "listSubject": "all"}, "method": "getTextbookMasterOptions", "actorId": "4d000000-0000-4000-8000-000000000904"}`,
  String.raw`{"data": {"complete": true, "targetIds": ["4d000000-0000-4000-8000-000000000501"], "totalCount": 1, "previewRows": [{"id": "4d000000-0000-4000-8000-000000000501", "title": "미사용 교재 1", "detail": "legacy 출판사 · 중등 · 중2 · 독해 · 미사용"}]}, "input": {}, "method": "getTextbookInactiveCleanupContext", "actorId": "4d000000-0000-4000-8000-000000000904"}`,
  String.raw`{"data": {"row": {"option": {"label": "Basic  Grammar", "value": "4d000000-0000-4000-8000-000000000131", "metaRows": [{"label": "출판사", "value": "미분류"}, {"label": "구분", "value": "중등 · 중2 · 문법"}], "searchText": "basicgrammar   중등 · 중2 · 문법 중등 중2 문법  ", "description": "영어", "filterValues": {"grade": [{"label": "중2", "value": "m2"}], "subject": [{"label": "영어", "value": "영어"}], "subSubject": [{"label": "문법", "value": "문법"}]}}, "supplier": {"id": "4d000000-0000-4000-8000-000000003901", "name": "  Legacy Vendor  "}, "textbook": {"id": "4d000000-0000-4000-8000-000000000131", "name": "Basic  Grammar", "price": 0, "title": "Basic  Grammar", "isbn13": null, "status": "active", "barcode": null, "subject": "english", "category": null, "publisher": null, "list_price": 0, "sale_price": 0, "grade_level": "m2", "sub_subject": "문법", "grade_levels": ["m2"], "publisher_id": null, "school_level": "middle", "is_returnable": false, "school_levels": ["middle"], "subject_area_key": null, "default_supplier_id": null}, "configuredSupplierId": "Legacy Vendor"}}, "input": {"scope": "management", "reference": "4d000000-0000-4000-8000-000000000131", "activeOnly": true, "fallbackSupplier": "Legacy Vendor"}, "method": "resolveTextbookReference", "actorId": "4d000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"row": {"id": "4d000000-0000-4000-8000-000000001801", "name": "4d000000-0000-4000-8000-000000001801", "option": {"label": "4d000000-0000-4000-8000-000000001801", "value": "4d000000-0000-4000-8000-000000001801", "metaRows": [{"label": "선생님", "value": "김, 김, 이"}, {"label": "강의실", "value": "본 1"}, {"label": "학생", "value": "2명"}, {"label": "시간", "value": "월"}], "searchText": "김 , 김 / 이   영어 중2 사용중 월", "description": "영어 · 중2", "filterValues": {"grade": [{"label": "중2", "value": "중2"}], "subject": [{"label": "영어", "value": "영어"}], "teacher": [{"label": "김", "value": "김"}, {"label": "이", "value": "이"}]}}, "inferredLocation": {"id": "4d000000-0000-4000-8000-000000005121", "code": "main", "name": "본관"}, "defaultTeacherName": "김", "enrolledStudentCount": 2}}, "input": "4d000000-0000-4000-8000-000000001801", "method": "getTextbookClassReference", "actorId": "4d000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"counts": {"categoryOptions": 5, "publisherOptions": 2, "subSubjectOptions": 5, "bulkCategoryOptions": 5, "scienceSubjectAreas": 2}, "complete": true, "categoryOptions": ["가", "가", "기타", "분류 02", "분류 2"], "publisherOptions": [{"label": "설정 출판사 1", "value": "설정 출판사 1", "description": "설정"}, {"label": "legacy 출판사", "value": "legacy 출판사", "description": "기존"}], "subSubjectOptions": ["가", "가", "기타", "분류 2", "분류 02"], "bulkCategoryOptions": ["가", "가", "기타", "분류 2", "분류 02"], "scienceSubjectAreas": [{"label": "통합과학", "subject": "과학", "area_key": "integrated_science", "is_active": true, "sort_order": 10}, {"label": "물리학", "subject": "과학", "area_key": "physics", "is_active": true, "sort_order": 20}]}, "input": {"subject": "other", "bulkSubject": "other", "listSubject": "other"}, "method": "getTextbookMasterOptions", "actorId": "4d000000-0000-4000-8000-000000000904"}`,
];
const finalReferenceWireHashes = [
  "9bf53f2d6abae64244d4f867895c2251c78fd927a4ab233af1e2721297500e05",
  "6e73eff6a3a0281991497f28c3ab98bb4da61ff222e6f6834b008dbddb6feaac",
  "a5e702f12bca5ab69eb94e7facbd341692b0bf798a5e482b6408db1559ec81cb",
  "417139ddce158a92cd2d775017b37b266d16195c96f3083d7f899f3c5fb9c84b",
  "564f63b1798dd2696f998c6b553650ae42bf10295f9aa4fe4075ac3f1557aeb6",
  "e6a7635108f326ef6c202430c3906bdc2d6bc99cc692e00785928c0978084f7e",
  "6b3f7cd531381ceb8faa98a3f8514b9a5918cf82edad097026a71447ca8f6461",
  "0c7d1675a5b6810bbcfe71c342c292f293dfc7ec786abd202111fe1170763d71",
  "c8d1ea075061fa28799e352c6a699453e08b1654c4fc70a0622262bcb86ec330",
  "ae84f2d0620b3d53965e9da70659a52c21b4f354e80f576ce6792a7a77882de3",
  "04b818b23977620dec153fc9878c8da4370d44ee0867800eaf6553c1d6024f54",
  "7106dd8364697884d62b4e6f82b110b72654233da05569d0610662fdeea5e32d",
  "d32989a549692e82fa7da52314b5a7fe3a735b275138182e8ec6a73b0050012e",
  "c47078969149b275f24f3d4be4f9d57cc8ef92e0101eadaef18a83977990b2e8"
];

const referencePurposeRpcs = {
  resolveTextbookReference: "resolve_textbook_reference_v1",
  getTextbookClassReference: "get_textbook_class_reference_v1",
  getTextbookLocationReference: "get_textbook_location_reference_v1",
  getTextbookMasterOptions: "get_textbook_master_options_v1",
  getTextbookInactiveCleanupContext: "get_textbook_inactive_cleanup_context_v1",
};
const finalFixtureTaxonomy = { school_level: "middle", grade_level: "m2", school_levels: ["middle"], grade_levels: ["m2"] };
function finalFixtureBook(value = id(121)) {
  if (value === id(121)) return { id: value, title: "수학의 정석 기본", name: "수학의 정석 기본", subject: "math",
    publisher: "legacy 출판사", category: "독해", sub_subject: "독해", isbn13: "978-121", barcode: "code-121", ...finalFixtureTaxonomy };
  assert.equal(value, id(131));
  return { id: value, title: "Basic  Grammar", name: "Basic  Grammar", subject: "english", publisher: null, category: null,
    sub_subject: "문법", isbn13: null, barcode: null, ...finalFixtureTaxonomy };
}
function finalFixtureClass(value) {
  if (value === id(1121)) return { id: value, name: "유일선택반", subject: "수학", grade: "중2", teacher: "김 / 이·박|최",
    room: "별 2", status: "active", student_ids: ["a", "a", "b"], schedule: "월 수" };
  assert.equal(value, id(1801));
  return { id: value, name: "", subject: "English", grade: "중2", teacher: " 김 , 김 / 이 ",
    room: " 본 1 ", status: " ACTIVE ", student_ids: ["a", "a"], schedule: " 월 " };
}
test("final reference provenance binds immutable SQL, TAP and all fourteen original responses", () => {
  const digest = value => createHash("sha256").update(value).digest("hex");
  const migration = "20260831184952_textbook_reference_numbered_reads.sql";
  assert.equal(digest(readFileSync(new URL("../supabase/migrations/" + migration, import.meta.url))), "d963654d5a55bb10102f52b91dcc8402f1f89c8797688139a8393a4670b445e7");
  assert.equal(digest(readFileSync(new URL("../supabase/tests/textbook_reference_numbered_reads_test.sql", import.meta.url))), "74c57e652c7d0ba15c2c831a9908ebf904a1a6fcd0a197885445506d80bd8660");
  // Later tasks may append their own entries; this final entry and SQL remain immutable.
  const manifest = JSON.parse(readFileSync(new URL("../supabase/test-baselines/dashboard-free-tier-v1.manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.orderedNewMigrations.find(entry => entry.fileName === migration), {
    fileName: migration, status: "final", sha256: "d963654d5a55bb10102f52b91dcc8402f1f89c8797688139a8393a4670b445e7",
  });
  assert.equal(finalReferenceSqlWirePayloads.length, 14);
  assert.equal(digest(finalReferenceSqlWirePayloads.join("\n")), "5eb50ca37d946e6afaca42d7c4c8de4f9d52ec4fbe18289439d830b53a30bc3e");
  const captures = finalReferenceSqlWirePayloads.map((payload, index) => {
    assert.ok(payload.length + "# TASK4_WIRE ".length <= 8000);
    assert.doesNotMatch(payload, /\[redacted/i);
    assert.equal(digest(payload), finalReferenceWireHashes[index]);
    const capture = JSON.parse(payload);
    assert.deepEqual(Object.keys(capture).sort(), ["actorId", "data", "input", "method"]);
    assert.match(capture.actorId, /^4d000000-0000-4000-8000-/);
    return capture;
  });
  assert.deepEqual([...new Set(captures.map(capture => capture.method))].sort(), [...pageCases.map(entry => entry[0]), ...Object.keys(referencePurposeRpcs)].sort());
  assert.deepEqual([...new Set(captures.map(capture => capture.actorId))].sort(), [id(901), id(903), id(904)]);
});
for (const [index, payload] of finalReferenceSqlWirePayloads.entries()) {
  const capture = JSON.parse(payload);
  test("final original reference response " + (index + 1) + " passes actual " + capture.method + " transport and projection", async () => {
    const api = await service(); const model = await import(new URL("textbook-reference-model.ts", feature));
    const original = structuredClone(capture.data); const before = JSON.stringify(capture.data); const transport = wire(capture.data);
    const result = capture.method === "getTextbookInactiveCleanupContext"
      ? await api[capture.method]({ client: transport.client })
      : await api[capture.method](capture.input, { client: transport.client });
    assert.equal(JSON.stringify(capture.data), before, "adapter must not repair or mutate original captured data");
    assert.deepEqual(result, original);
    assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].retry, false);
    assert.ok(transport.calls[0].signal instanceof AbortSignal);
    const pageCase = pageCases.find(entry => entry[0] === capture.method);
    assert.equal(transport.calls[0].name, pageCase?.[1] || referencePurposeRpcs[capture.method]);
    const expectedArgs = pageCase
      ? { p_filters: capture.input.filters, p_sort: capture.input.sort, p_page: capture.input.page, p_page_size: capture.input.pageSize }
      : capture.method === "resolveTextbookReference"
        ? { p_reference: capture.input.reference, p_active_only: capture.input.activeOnly, p_scope: capture.input.scope, p_fallback_supplier: capture.input.fallbackSupplier }
        : capture.method === "getTextbookClassReference" ? { p_class_id: capture.input }
          : capture.method === "getTextbookLocationReference" ? { p_location_id: capture.input }
            : capture.method === "getTextbookMasterOptions" ? { p_filters: capture.input } : undefined;
    assert.deepEqual(transport.calls[0].args, expectedArgs);
    let actualOption, expectedOption;
    if (capture.method === "listTextbookReferencePage") {
      actualOption = result.rows[0]; expectedOption = model.buildTextbookReferenceOptions([finalFixtureBook()])[0];
    } else if (capture.method === "listTextbookClassReferencePage") {
      actualOption = result.rows[0]; expectedOption = model.buildTextbookClassReferenceOptions([finalFixtureClass(actualOption.value)])[0];
    } else if (capture.method === "getTextbookClassReference") {
      actualOption = result.row.option; expectedOption = model.buildTextbookClassReferenceOptions([finalFixtureClass(result.row.id)])[0];
    } else if (capture.method === "resolveTextbookReference" && result.row) {
      actualOption = result.row.option; expectedOption = model.buildTextbookReferenceOptions([finalFixtureBook(result.row.textbook.id)])[0];
    }
    if (actualOption) {
      assert.deepEqual(actualOption, expectedOption);
      assert.deepEqual(Object.keys(actualOption.filterValues), Object.keys(expectedOption.filterValues));
      assert.deepEqual(Buffer.from(model.buildSearchSelectCommandValue(actualOption)), Buffer.from(model.buildSearchSelectCommandValue(expectedOption)),
        "unchanged helper must receive original command-value bytes after JSONB key-order restoration");
    }
    if (capture.method === "getTextbookMasterOptions" && capture.input.subject === "other") {
      assert.deepEqual(result.subSubjectOptions, ["가", "가", "기타", "분류 2", "분류 02"]);
      assert.deepEqual(result.categoryOptions, ["가", "가", "기타", "분류 02", "분류 2"]);
      assert.deepEqual(result.bulkCategoryOptions, ["가", "가", "기타", "분류 2", "분류 02"]);
    }
  });
}
test("final searched page facet metadata equals the original complete caller-visible source projection", async () => {
  const model = await import(new URL("textbook-reference-model.ts", feature));
  const books = Array.from({ length: 121 }, (_, i) => i + 1).filter(n => n !== 1).map(n => ({
    id: id(n), title: n === 121 ? "수학의 정석 기본" : "교재 " + n, subject: n % 2 ? "math" : "english", sub_subject: "독해", ...finalFixtureTaxonomy,
  }));
  for (const n of [131, 132, 133]) books.push({ id: id(n), title: ["Basic  Grammar", "Basic-Grammar", "Basic Grammar 개정"][n - 131], subject: "english", sub_subject: "문법", ...finalFixtureTaxonomy });
  books.sort((a, b) => a.title.localeCompare(b.title, "ko", { numeric: true }) || a.id.localeCompare(b.id));
  const classes = Array.from({ length: 121 }, (_, i) => i + 1).filter(n => n !== 1).map(n => ({
    id: id(1000 + n), name: n === 121 ? "유일선택반" : "수업 " + n, subject: "수학", grade: "중2", teacher: "김 / 이·박|최",
  }));
  classes.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }) || a.id.localeCompare(b.id));
  for (const [method, rows, key, label, project] of [
    ["listTextbookReferencePage", books, "subSubject", "세부과목", model.buildTextbookReferenceOptions],
    ["listTextbookClassReferencePage", classes, "teacher", "선생님", model.buildTextbookClassReferenceOptions],
  ]) {
    const capture = finalReferenceSqlWirePayloads.map(payload => JSON.parse(payload)).find(item => item.method === method);
    const options = project(rows);
    const base = model.buildSearchSelectFilterGroups(options, [{ key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"] }, { key: "grade", label: "학년" }, { key, label }]);
    // Serialize ONLY expected helper objects to omit optional undefined properties.
    assert.deepEqual(capture.data.baseFilterGroups, JSON.parse(JSON.stringify(base)));
    assert.deepEqual(capture.data.visibleFilterGroups, JSON.parse(JSON.stringify(model.buildVisibleSearchSelectFilterGroups(options, base, capture.input.filters.selectedFilters))));
    assert.equal(capture.data.rows.length, 1);
    assert.ok(rows.length > 100, "expected facets are never computed from the current one-row search result");
  }
});
