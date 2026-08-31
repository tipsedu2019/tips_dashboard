import { supabase as sharedSupabase, supabaseConfigError } from "@/lib/supabase";
import type { NumberedPage } from "@/lib/numbered-pagination";
import type {
  InventoryCountRow, InventoryFilters, InventoryHistoryFilters, MasterFilters, PageRequest,
  TextbookInventoryBalance, TextbookInventoryBalanceInput, TextbookInventoryBalanceRow,
  TextbookInventoryHistoryTransport, TextbookInventorySummary, TextbookMasterDetail,
  TextbookMasterDuplicate, TextbookMasterDuplicateInput, TextbookMasterRow, TextbookMasterSummary,
} from "./textbook-read-types";

export type TextbookReadOptions = { client?: NonNullable<typeof sharedSupabase> | null; signal?: AbortSignal };
type ObjectValue = Record<string, unknown>;
const qualities = ["all", "attention", "duplicate", "missingCode", "missingPublisher", "missingCategory", "missingPrice", "subjectMismatch", "inactive"];
const inventories = ["all", "shortage", "surplus", "unused", "negative"];
const audits = ["recommended", "pending", "done", "all"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const balanceKeys = ["locationQuantities", "studentLocationQuantities", "teacherLocationQuantities", "totalQuantity", "studentQuantity", "teacherQuantity", "stockValue"];
const masterStrings = ["id", "title", "name", "status", "school_level", "grade_level", "sub_subject"];
const masterNullableStrings = ["subject", "publisher", "category", "isbn13", "barcode", "subject_area_key"];
const masterKeys = [...masterStrings, ...masterNullableStrings, "price", "sale_price", "list_price", "salePrice", "publisher_id", "default_supplier_id", "school_levels", "grade_levels", "is_returnable", ...balanceKeys, "locationSummary", "qualityIssues", "qualityScore"];

function fail(kind = "response"): never { throw new TypeError(`textbook_read_${kind}_invalid`); }
function object(value: unknown): value is ObjectValue { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: string[]): asserts value is ObjectValue {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail();
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function nullableUuid(value: unknown) { return value === null || uuid(value); }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === "string"); }
function dates(value: unknown, empty = false) {
  if (typeof value !== "string") return false;
  if (empty && value === "") return true;
  if (["infinity", "-infinity"].includes(value)) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function numericMap(value: unknown) {
  return object(value) && Object.entries(value).every(([key, amount]) => (uuid(key) || key === "unassigned") && integer(amount));
}
function validateBalance(row: ObjectValue) {
  if (!balanceKeys.slice(0, 3).every((key) => numericMap(row[key])) || !balanceKeys.slice(3, 6).every((key) => integer(row[key])) || !finite(row.stockValue)) fail();
}
function parseLocation(value: unknown, quantity = false) {
  exact(value, ["id", "code", "name", "sortOrder", ...(quantity ? ["quantity"] : [])]);
  if (!uuid(value.id) || typeof value.code !== "string" || typeof value.name !== "string" || !integer(value.sortOrder) || (quantity && (!integer(value.quantity) || value.quantity === 0))) fail();
  return value;
}
function parseMaster(value: unknown): TextbookMasterRow {
  exact(value, masterKeys);
  if (!masterStrings.every((key) => typeof value[key] === "string") || !uuid(value.id)
    || !masterNullableStrings.every((key) => value[key] === null || typeof value[key] === "string")
    || !nullableUuid(value.publisher_id) || !nullableUuid(value.default_supplier_id)
    || !stringArray(value.school_levels) || !stringArray(value.grade_levels) || typeof value.is_returnable !== "boolean"
    || !(value.price === null || finite(value.price)) || !["sale_price", "list_price", "salePrice"].every((key) => finite(value[key]))) fail();
  validateBalance(value);
  exact(value.qualityIssues, qualities.slice(2));
  if (!Object.values(value.qualityIssues).every((flag) => typeof flag === "boolean") || !integer(value.qualityScore) || value.qualityScore < 0 || value.qualityScore > 39) fail();
  if (!Array.isArray(value.locationSummary)) fail();
  value.locationSummary.forEach((location) => parseLocation(location, true));
  return value as TextbookMasterRow;
}
function parseInventory(value: unknown): InventoryCountRow {
  exact(value, ["source", "id", "title", "publisher", "locationId", "locationName", "currentQuantity", "latestCountAt", "daysSinceLatestCount", "isCountedThisCycle", "isRecommended", "status", "reason", "dueLabel"]);
  const source = parseMaster(value.source);
  if (!uuid(value.id) || value.id !== source.id || !["title", "publisher", "locationId", "locationName", "reason", "dueLabel"].every((key) => typeof value[key] === "string")
    || !(value.locationId === "" || uuid(value.locationId)) || !integer(value.currentQuantity) || !dates(value.latestCountAt, true)
    || !(value.daysSinceLatestCount === null || integer(value.daysSinceLatestCount)) || typeof value.isCountedThisCycle !== "boolean"
    || typeof value.isRecommended !== "boolean" || !audits.slice(0, 3).includes(value.status as string)) fail();
  const nonfiniteDate = ["", "infinity", "-infinity"].includes(value.latestCountAt as string);
  if (nonfiniteDate !== (value.daysSinceLatestCount === null)) fail();
  return {
    source, id: value.id, title: value.title as string, publisher: value.publisher as string,
    locationId: value.locationId as string, locationName: value.locationName as string,
    currentQuantity: value.currentQuantity, latestCountAt: value.latestCountAt as string,
    daysSinceLatestCount: value.daysSinceLatestCount === null ? Infinity : value.daysSinceLatestCount,
    isCountedThisCycle: value.isCountedThisCycle, isRecommended: value.isRecommended,
    status: value.status as InventoryCountRow["status"], reason: value.reason as string, dueLabel: value.dueLabel as string,
  };
}
function parseHistory(value: unknown): TextbookInventoryHistoryTransport {
  exact(value, ["id", "kind", "sourceId", "linkedMoveId", "at", "textbookTitle", "locationName", "change", "action", "actor", "memo", "actorId", "actorLabel"]);
  if (!Object.values(value).every((entry) => typeof entry === "string") || !["move", "count"].includes(value.kind as string)
    || !uuid(value.sourceId) || value.id !== `${value.kind}-${value.sourceId}` || !(value.linkedMoveId === "" || uuid(value.linkedMoveId))
    || !(value.actorId === "" || uuid(value.actorId)) || (value.kind === "move" && value.linkedMoveId !== "")) fail();
  if (value.kind === "count" ? !dates(value.at) : !(typeof value.at === "string" && (["infinity", "-infinity"].includes(value.at) || (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(value.at) && Number.isFinite(Date.parse(value.at)))))) fail();
  return value as TextbookInventoryHistoryTransport;
}
function parsePage<T>(data: unknown, request: PageRequest<unknown, string>, parser: (value: unknown) => T): NumberedPage<T> {
  exact(data, ["rows", "page", "pageSize", "totalCount"]);
  if (data.page !== request.page || data.pageSize !== request.pageSize || !integer(data.totalCount) || data.totalCount < 0 || !Array.isArray(data.rows)) fail();
  const expected = Math.min(request.pageSize, Math.max(0, data.totalCount - (request.page - 1) * request.pageSize));
  if (data.rows.length !== expected) fail();
  const rows = data.rows.map(parser);
  if (new Set(rows.map((row) => (row as ObjectValue).id)).size !== rows.length) fail();
  return { rows, page: request.page, pageSize: request.pageSize, totalCount: data.totalCount };
}
function countMap(value: unknown, keys: string[]) {
  exact(value, keys); if (!Object.values(value).every((count) => integer(count) && count >= 0)) fail();
}
function parseSummary(data: unknown, inventory = false): TextbookMasterSummary | TextbookInventorySummary {
  exact(data, ["totalCount", "totalQuantity", "studentQuantity", "teacherQuantity", "stockValue", "salePriceTotal", "locationQuantities", "subjectTotals", "qualityCounts", "inventoryCounts", "subSubjectOptions", "locations", ...(inventory ? ["auditCounts"] : [])]);
  if (!integer(data.totalCount) || data.totalCount < 0 || !["totalQuantity", "studentQuantity", "teacherQuantity"].every((key) => integer(data[key])) || !finite(data.stockValue) || !finite(data.salePriceTotal) || !numericMap(data.locationQuantities) || !Array.isArray(data.subjectTotals)) fail();
  const subjects = ["english", "math", "science", "other"];
  const totals = { totalCount: 0, totalQuantity: 0 };
  const amounts: { salePriceTotal: number[]; stockValue: number[] } = { salePriceTotal: [], stockValue: [] };
  let previousSubject = -1;
  for (const group of data.subjectTotals) {
    exact(group, ["subject", "totalCount", "totalQuantity", "salePriceTotal", "stockValue"]);
    const subject = subjects.indexOf(group.subject as string);
    if (subject <= previousSubject || !integer(group.totalCount) || group.totalCount <= 0 || !integer(group.totalQuantity) || !finite(group.salePriceTotal) || !finite(group.stockValue)) fail();
    previousSubject = subject;
    totals.totalCount += group.totalCount; totals.totalQuantity += group.totalQuantity;
    amounts.salePriceTotal.push(group.salePriceTotal); amounts.stockValue.push(group.stockValue);
  }
  const sameAmount = (parts: number[], total: number) => {
    // All operands are finite; at most four ordered subjects were admitted above.
    // Scale before summing so neither signed sums nor absolute magnitudes overflow.
    const scale = Math.max(Math.abs(total), ...parts.map(Math.abs));
    if (scale === 0) return true;
    const normalizedTotal = total / scale;
    let sum = 0; let magnitude = Math.abs(normalizedTotal);
    for (const part of parts) { const normalized = part / scale; sum += normalized; magnitude += Math.abs(normalized); }
    // SQL numeric→double, normalization and additions incur operand-sized roundoff,
    // even when the net total cancels. No currency rounding or absolute-value floor.
    return Math.abs(sum - normalizedTotal) <= Number.EPSILON * (parts.length + 2) * magnitude;
  };
  if (totals.totalCount !== data.totalCount || totals.totalQuantity !== data.totalQuantity || !sameAmount(amounts.salePriceTotal, data.salePriceTotal) || !sameAmount(amounts.stockValue, data.stockValue)
    || Object.values(data.locationQuantities as Record<string, number>).reduce((sum, qty) => sum + qty, 0) !== data.totalQuantity) fail();
  countMap(data.qualityCounts, qualities); countMap(data.inventoryCounts, inventories);
  if (inventory) countMap(data.auditCounts, audits);
  if (!stringArray(data.subSubjectOptions) || new Set(data.subSubjectOptions).size !== data.subSubjectOptions.length || !Array.isArray(data.locations)) fail();
  data.locations.forEach((location) => parseLocation(location));
  return data as TextbookMasterSummary | TextbookInventorySummary;
}
function validateFilters(filters: unknown, kind: "master" | "inventory" | "history") {
  const keys = kind === "history" ? ["textbookId", "locationId"] : ["search", "subject", "schoolLevel", "gradeLevel", "subSubject", "quality", "inventory", ...(kind === "inventory" ? ["locationId", "audit"] : [])];
  if (!object(filters) || Object.keys(filters).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(filters, key))) fail("filters");
  if (kind === "history") { if (!keys.every((key) => nullableUuid(filters[key]))) fail("filters"); return; }
  if (!keys.every((key) => typeof filters[key] === "string") || !qualities.includes(filters.quality as string) || !inventories.includes(filters.inventory as string)
    || (kind === "inventory" && (!(filters.locationId === "" || uuid(filters.locationId)) || !audits.includes(filters.audit as string)))) fail("filters");
}
function validatePage(request: PageRequest<unknown, string>, kind: "master" | "inventory" | "history", sort: string) {
  if (!object(request) || !integer(request.page) || request.page < 1 || request.page > 2147483647) fail("page");
  if (![10, 15, 20].includes(request.pageSize)) fail("page_size");
  if (request.sort !== sort) fail("sort"); validateFilters(request.filters, kind);
}
async function read<T>(options: TextbookReadOptions, query: (client: NonNullable<typeof sharedSupabase>) => PromiseLike<{ data: unknown; error: unknown }>, parser: (data: unknown) => T): Promise<T> {
  options.signal?.throwIfAborted();
  const client = options.client || sharedSupabase;
  if (!client) throw new Error(supabaseConfigError || "Supabase client unavailable");
  const { data, error } = await query(client);
  options.signal?.throwIfAborted();
  if (error) {
    if (object(error) && ["PGRST202", "42883"].includes(String(error.code))) {
      throw Object.assign(new Error("교재 읽기 API가 아직 적용되지 않았습니다."), { code: "textbook_read_rpc_unavailable", cause: error });
    }
    throw error;
  }
  return parser(data);
}

export async function listTextbookMasterPage(request: PageRequest<MasterFilters, "quality-title">, options: TextbookReadOptions = {}): Promise<NumberedPage<TextbookMasterRow>> {
  validatePage(request, "master", "quality-title");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("list_textbook_master_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => parsePage(data, request, parseMaster));
}
export async function listTextbookInventoryPage(request: PageRequest<InventoryFilters, "audit-priority">, options: TextbookReadOptions = {}): Promise<NumberedPage<InventoryCountRow>> {
  validatePage(request, "inventory", "audit-priority");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("list_textbook_inventory_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => parsePage(data, request, parseInventory));
}
export async function listTextbookInventoryHistoryPage(request: PageRequest<InventoryHistoryFilters, "event-desc">, options: TextbookReadOptions = {}): Promise<NumberedPage<TextbookInventoryHistoryTransport>> {
  validatePage(request, "history", "event-desc");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("list_textbook_inventory_history_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => parsePage(data, request, parseHistory));
}
export async function getTextbookMasterSummary(filters: MasterFilters, options: TextbookReadOptions = {}): Promise<TextbookMasterSummary> {
  validateFilters(filters, "master");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_master_summary_v1", { p_filters: filters }).abortSignal(signal).retry(false), (data) => parseSummary(data));
}
export async function getTextbookInventorySummary(filters: InventoryFilters, options: TextbookReadOptions = {}): Promise<TextbookInventorySummary> {
  validateFilters(filters, "inventory");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_inventory_summary_v1", { p_filters: filters }).abortSignal(signal).retry(false), (data) => parseSummary(data, true) as TextbookInventorySummary);
}
export async function getTextbookMasterDetail(id: string, options: TextbookReadOptions = {}): Promise<TextbookMasterDetail> {
  if (!uuid(id)) fail("id");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_master_detail_v1", { p_id: id }).abortSignal(signal).retry(false), (data) => {
    exact(data, ["row"]); const row = data.row === null ? null : parseMaster(data.row);
    if (row && String(row.id).toLowerCase() !== id.toLowerCase()) fail(); return { row };
  });
}
export async function getTextbookInventoryBalance(input: TextbookInventoryBalanceInput, options: TextbookReadOptions = {}): Promise<TextbookInventoryBalance> {
  if (!object(input) || Object.keys(input).length !== 2 || !Array.isArray(input.textbookIds) || !input.textbookIds.every(uuid) || !nullableUuid(input.locationId)
    || new Set(input.textbookIds.map((id) => id.toLowerCase())).size !== input.textbookIds.length) fail("balance_input");
  const requestedIds = new Set(input.textbookIds.map((id) => id.toLowerCase()));
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_inventory_balance_v1", { p_input: input }).abortSignal(signal).retry(false), (data) => {
    exact(data, ["locationId", "rows"]);
    if (!nullableUuid(data.locationId) || (data.locationId as string | null)?.toLowerCase() !== input.locationId?.toLowerCase() || !Array.isArray(data.rows) || data.rows.length !== input.textbookIds.length) fail();
    const rows = data.rows.map((row) => { exact(row, ["textbookId", "currentQuantity", ...balanceKeys]); validateBalance(row);
      if (!uuid(row.textbookId) || !requestedIds.has(row.textbookId.toLowerCase()) || !integer(row.currentQuantity)) fail(); return row as TextbookInventoryBalanceRow; });
    if (new Set(rows.map((row) => row.textbookId.toLowerCase())).size !== input.textbookIds.length) fail();
    return { locationId: data.locationId as string | null, rows };
  });
}
export async function checkTextbookMasterDuplicate(input: TextbookMasterDuplicateInput, options: TextbookReadOptions = {}): Promise<TextbookMasterDuplicate> {
  if (!object(input) || Object.keys(input).length !== 5 || !nullableUuid(input.excludeId) || !["title", "subject", "publisher", "category"].every((key) => typeof input[key as keyof TextbookMasterDuplicateInput] === "string")) fail("duplicate_input");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("check_textbook_master_duplicate_v1", { p_input: input }).abortSignal(signal).retry(false), (data) => {
    exact(data, ["totalCount", "previewRows"]);
    if (!integer(data.totalCount) || data.totalCount < 0 || !Array.isArray(data.previewRows) || data.previewRows.length !== Math.min(10, data.totalCount)) fail();
    const previewRows = data.previewRows.map(parseMaster);
    if (new Set(previewRows.map((row) => String(row.id).toLowerCase())).size !== previewRows.length || previewRows.some((row) => String(row.id).toLowerCase() === input.excludeId?.toLowerCase())) fail();
    return { totalCount: data.totalCount, previewRows };
  });
}
