import { readTextbookPurpose, textbookPurposeValidation, type TextbookReadOptions } from "./textbook-read-service";
import { buildTextbookReferenceOptions, doesSearchOptionMatchFilters } from "./textbook-reference-model";
import { isActiveTextbook } from "./textbook-read-model";
import { getTextbookByReference } from "./textbook-ledger.js";
import type { NumberedPage } from "@/lib/numbered-pagination";
import type {
  Row, PageRequest, SearchSelectOption, SearchSelectFilterGroup, TextbookReferenceFilters, TextbookClassReferenceFilters,
  TextbookReferenceSearch, TextbookReferenceFacetPage, TextbookReferenceLocation, TextbookLocationReferencePage,
  TextbookReferenceInput, TextbookReferenceResult, TextbookClassReferenceResult, TextbookLocationReferenceResult,
  TextbookMasterOptionsInput, TextbookMasterOptions, TextbookInactiveCleanupContext,
} from "./textbook-read-types";

const v: typeof textbookPurposeValidation = textbookPurposeValidation;
type Kind = "book" | "class" | "teacher" | "location";
const groupKeys = (kind: Kind) => kind === "book" ? ["subject", "grade", "subSubject"] : kind === "class" ? ["subject", "grade", "teacher"] : [];
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
function strings(value: unknown): asserts value is string[] { if (!v.stringArray(value) || new Set(value).size !== value.length) v.fail(); }
function inputFilters(filters: unknown, kind: Kind) {
  const keys = groupKeys(kind);
  if (!object(filters) || typeof filters.search !== "string" || Object.keys(filters).length !== (keys.length ? 2 : 1)) v.fail("filters");
  if (keys.length) {
    if (!object(filters.selectedFilters) || Object.keys(filters.selectedFilters).some(key => !keys.includes(key))) v.fail("filters");
    for (const values of Object.values(filters.selectedFilters)) if (!v.stringArray(values) || new Set(values).size !== values.length) v.fail("filters");
  }
}
function pageInput(request: PageRequest<unknown, string>, kind: Kind, sort: string) {
  if (!object(request) || !v.integer(request.page) || request.page < 1 || request.page > 2147483647 || ![10, 15, 20].includes(request.pageSize) || request.sort !== sort) v.fail("input");
  inputFilters(request.filters, kind);
}
function option(value: unknown, kind: Kind): SearchSelectOption {
  const facets = groupKeys(kind);
  v.exact(value, facets.length ? ["value", "label", "description", "searchText", "metaRows", "filterValues"] : kind === "teacher" ? ["value", "label"] : ["value", "label", "searchText"]);
  if (typeof value.value !== "string" || typeof value.label !== "string" || (kind === "teacher" ? !value.value || value.value !== value.label || value.value !== value.value.trim() : !v.uuid(value.value))) v.fail();
  if (kind !== "teacher" && typeof value.searchText !== "string") v.fail();
  if (facets.length) {
    if (typeof value.description !== "string" || !Array.isArray(value.metaRows)) v.fail();
    value.metaRows.forEach(row => { v.fields(row, { label: "text", value: "text" }); if (!String(row.value).trim()) v.fail(); });
    v.exact(value.filterValues, facets);
    // PostgreSQL JSONB reorders object keys. Restore the original command-value
    // field iteration order without changing any string, array or metadata row.
    const filterValues: NonNullable<SearchSelectOption["filterValues"]> = {};
    for (const key of facets) {
      const values = value.filterValues[key]; if (!Array.isArray(values)) v.fail();
      values.forEach(row => { v.fields(row, { value: "text", label: "text" }); if (!String(row.value)) v.fail(); });
      if (new Set(values.map(row => row.value)).size !== values.length) v.fail();
      filterValues[key] = values;
    }
    return { ...value, filterValues } as SearchSelectOption;
  }
  return value as SearchSelectOption;
}
function groups(value: unknown, kind: Kind): SearchSelectFilterGroup[] {
  if (!Array.isArray(value)) v.fail(); const keys = groupKeys(kind); let previous = -1;
  for (const group of value) {
    if (!object(group)) v.fail();
    v.exact(group, ["key", "label", "options", ...(group.key === "subject" ? ["optionOrder"] : [])]);
    const index = keys.indexOf(String(group.key)); if (index <= previous || typeof group.label !== "string" || !Array.isArray(group.options) || !group.options.length) v.fail(); previous = index;
    if (group.key === "subject" && !v.sameValue(group.optionOrder, ["영어", "수학", "과학", "기타"])) v.fail();
    for (const entry of group.options) { v.fields(entry, { value: "text", label: "text", count: "integer" }); if (Number(entry.count) < 1 || !entry.value) v.fail(); }
    if (new Set(group.options.map(row => row.value)).size !== group.options.length) v.fail();
  }
  return value;
}
function location(value: unknown): TextbookReferenceLocation | null {
  if (value === null) return null; v.fields(value, { id: "uuid", code: "text", name: "text" }); return value as TextbookReferenceLocation;
}
function page(data: unknown, request: PageRequest<unknown, string>, kind: Kind) {
  const facets = groupKeys(kind);
  v.exact(data, ["rows", "page", "pageSize", "totalCount", ...(facets.length ? ["baseFilterGroups", "visibleFilterGroups", "activeFilterCount"] : kind === "location" ? ["defaultLocation"] : [])]);
  if (data.page !== request.page || data.pageSize !== request.pageSize || !v.integer(data.totalCount) || data.totalCount < 0 || !Array.isArray(data.rows)
    || data.rows.length !== Math.min(request.pageSize, Math.max(0, data.totalCount - (request.page - 1) * request.pageSize))) v.fail();
  const rows = data.rows.map(row => option(row, kind)); if (new Set(rows.map(row => row.value)).size !== rows.length) v.fail();
  if (facets.length) {
    const base = groups(data.baseFilterGroups, kind); const visible = groups(data.visibleFilterGroups, kind);
    for (const group of visible) {
      const original = base.find(item => item.key === group.key); if (!original) v.fail();
      for (const item of group.options) { const found = original.options.find(entry => entry.value === item.value); if (!found || found.label !== item.label || item.count > found.count) v.fail(); }
    }
    const selected = (request.filters as TextbookReferenceFilters).selectedFilters as Record<string, string[]>;
    const activeCount = base.reduce((sum, group) => sum + (selected[group.key] || []).filter(value => group.options.some(option => option.value === value)).length, 0);
    if (data.activeFilterCount !== activeCount) v.fail();
    if (rows.some(row => !doesSearchOptionMatchFilters(row, base, selected))) v.fail();
  } else if (kind === "location") {
    location(data.defaultLocation); if (data.totalCount > 0 && data.defaultLocation === null) v.fail();
  }
  return { ...data, rows };
}

export async function listTextbookReferencePage(request: PageRequest<TextbookReferenceFilters, "match-title">, options: TextbookReadOptions = {}): Promise<TextbookReferenceFacetPage> {
  pageInput(request, "book", "match-title"); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("list_textbook_reference_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), data => page(data, request, "book") as TextbookReferenceFacetPage);
}
export async function listTextbookClassReferencePage(request: PageRequest<TextbookClassReferenceFilters, "match-name">, options: TextbookReadOptions = {}): Promise<TextbookReferenceFacetPage> {
  pageInput(request, "class", "match-name"); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("list_textbook_class_reference_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), data => page(data, request, "class") as TextbookReferenceFacetPage);
}
export async function listTextbookTeacherReferencePage(request: PageRequest<TextbookReferenceSearch, "match-name">, options: TextbookReadOptions = {}): Promise<NumberedPage<SearchSelectOption>> {
  pageInput(request, "teacher", "match-name"); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("list_textbook_teacher_reference_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), data => page(data, request, "teacher") as NumberedPage<SearchSelectOption>);
}
export async function listTextbookLocationReferencePage(request: PageRequest<TextbookReferenceSearch, "match-order">, options: TextbookReadOptions = {}): Promise<TextbookLocationReferencePage> {
  pageInput(request, "location", "match-order"); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("list_textbook_location_reference_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), data => page(data, request, "location") as TextbookLocationReferencePage);
}
export async function resolveTextbookReference(input: TextbookReferenceInput, options: TextbookReadOptions = {}): Promise<TextbookReferenceResult> {
  if (!object(input) || Object.keys(input).length !== 4 || typeof input.reference !== "string" || typeof input.fallbackSupplier !== "string" || typeof input.activeOnly !== "boolean" || !["request", "management"].includes(input.scope)) v.fail("input");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("resolve_textbook_reference_v1", { p_reference: input.reference, p_active_only: input.activeOnly, p_scope: input.scope, p_fallback_supplier: input.fallbackSupplier }).abortSignal(signal).retry(false), data => {
    v.exact(data, ["row"]); if (data.row === null) return { row: null }; const row = data.row;
    v.exact(row, ["textbook", "option", "configuredSupplierId", "supplier"]);
    v.fields(row.textbook, { ...v.workflowBookShape, category: "nullableText", school_level: "text", grade_level: "text", sub_subject: "text", subject_area_key: "nullableText" }, ["school_levels", "grade_levels"]);
    if (!v.stringArray(row.textbook.school_levels) || !v.stringArray(row.textbook.grade_levels)) v.fail();
    const active = isActiveTextbook(row.textbook);
    if (typeof row.configuredSupplierId !== "string" || (input.activeOnly && !active) || !getTextbookByReference([row.textbook], input.reference)) v.fail();
    let selected: SearchSelectOption | null = null;
    if (active) {
      selected = option(row.option, "book"); if (!v.sameValue(selected, buildTextbookReferenceOptions([row.textbook])[0])) v.fail();
    } else if (row.option !== null) v.fail();
    if (row.supplier !== null) {
      v.fields(row.supplier, { id: "uuid", name: "text" });
      if (row.supplier.id !== row.configuredSupplierId && String(row.supplier.name).trim() !== row.configuredSupplierId) v.fail();
    }
    if (input.scope === "request" && (row.supplier !== null || row.configuredSupplierId !== (row.textbook.default_supplier_id || input.fallbackSupplier))) v.fail();
    return { row: { ...row, option: selected } } as TextbookReferenceResult;
  });
}
export async function getTextbookClassReference(classId: string, options: TextbookReadOptions = {}): Promise<TextbookClassReferenceResult> {
  if (!v.uuid(classId)) v.fail("input"); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("get_textbook_class_reference_v1", { p_class_id: classId }).abortSignal(signal).retry(false), data => {
    v.exact(data, ["row"]); if (data.row === null) return { row: null }; const row = data.row;
    v.exact(row, ["id", "name", "option", "enrolledStudentCount", "defaultTeacherName", "inferredLocation"]);
    if (row.id !== classId.toLowerCase() || typeof row.name !== "string" || typeof row.defaultTeacherName !== "string" || !v.integer(row.enrolledStudentCount) || row.enrolledStudentCount < 0) v.fail();
    const selected = option(row.option, "class"); if (selected.value !== row.id || selected.label !== row.name) v.fail();
    return { row: { ...row, option: selected, inferredLocation: location(row.inferredLocation) } } as TextbookClassReferenceResult;
  });
}
export async function getTextbookLocationReference(locationId: string, options: TextbookReadOptions = {}): Promise<TextbookLocationReferenceResult> {
  if (!v.uuid(locationId)) v.fail("input"); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("get_textbook_location_reference_v1", { p_location_id: locationId }).abortSignal(signal).retry(false), data => {
    v.exact(data, ["row"]); if (data.row === null) return { row: null }; const row = data.row; v.exact(row, ["id", "code", "name", "option"]);
    location({ id: row.id, code: row.code, name: row.name }); const selected = option(row.option, "location");
    if (row.id !== locationId.toLowerCase() || selected.value !== row.id || selected.label !== String(row.name || row.code).trim() || selected.searchText !== String(row.code).trim()) v.fail();
    return data as TextbookLocationReferenceResult;
  });
}
export async function getTextbookMasterOptions(input: TextbookMasterOptionsInput, options: TextbookReadOptions = {}): Promise<TextbookMasterOptions> {
  const subjects = ["english", "math", "science", "other"];
  if (!object(input) || Object.keys(input).length !== 3 || !subjects.includes(input.subject) || !["all", ...subjects].includes(input.listSubject) || !["keep", ...subjects].includes(input.bulkSubject)) v.fail("input");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("get_textbook_master_options_v1", { p_filters: input }).abortSignal(signal).retry(false), data => {
    const keys = ["publisherOptions", "subSubjectOptions", "categoryOptions", "bulkCategoryOptions", "scienceSubjectAreas"];
    v.exact(data, [...keys, "counts", "complete"]); v.exact(data.counts, keys); if (data.complete !== true) v.fail();
    for (const key of keys) if (!Array.isArray(data[key]) || data.counts[key] !== data[key].length) v.fail();
    for (const key of keys.slice(1, 4)) strings(data[key]);
    const publishers = data.publisherOptions as Row[]; publishers.forEach(row => { v.fields(row, { value: "text", label: "text", description: "text" }); if (!row.value || row.value !== row.label || !["설정", "기존"].includes(String(row.description))) v.fail(); });
    if (new Set(publishers.map(row => String(row.value).toLowerCase())).size !== publishers.length) v.fail();
    const areas = data.scienceSubjectAreas as Row[]; const areaKeys = ["integrated_science", "physics", "chemistry", "life_science", "earth_science"];
    areas.forEach(row => { v.fields(row, { subject: "text", area_key: "text", label: "text", sort_order: "integer", is_active: "boolean" }); if (row.subject !== "과학" || !areaKeys.includes(String(row.area_key)) || row.is_active !== true || Number(row.sort_order) < 0 || !String(row.label).trim()) v.fail(); });
    if (areas.length > 5 || new Set(areas.map(row => row.area_key)).size !== areas.length || new Set(areas.map(row => row.sort_order)).size !== areas.length) v.fail();
    return data as TextbookMasterOptions;
  });
}
export async function getTextbookInactiveCleanupContext(options: TextbookReadOptions = {}): Promise<TextbookInactiveCleanupContext> {
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, client => client.rpc("get_textbook_inactive_cleanup_context_v1").abortSignal(signal).retry(false), data => {
    v.exact(data, ["targetIds", "totalCount", "previewRows", "complete"]); strings(data.targetIds);
    if (!data.targetIds.every(v.uuid) || data.totalCount !== data.targetIds.length || data.complete !== true || !Array.isArray(data.previewRows) || data.previewRows.length !== Math.min(5, data.targetIds.length)) v.fail();
    data.previewRows.forEach((row, index) => { v.fields(row, { id: "uuid", title: "text", detail: "text" }); if (row.id !== (data.targetIds as string[])[index]) v.fail(); });
    return data as TextbookInactiveCleanupContext;
  });
}
