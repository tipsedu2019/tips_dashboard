import { supabase as sharedSupabase, supabaseConfigError } from "@/lib/supabase";
import type { NumberedPage } from "@/lib/numbered-pagination";
import { getClosingDetailSearchHaystack, getClosingStoredMetrics, hasClosingMetricMismatch } from "./textbook-closing-model";
import type {
  InventoryCountRow, InventoryFilters, InventoryHistoryFilters, MasterFilters, PageRequest,
  TextbookInventoryBalance, TextbookInventoryBalanceInput, TextbookInventoryBalanceRow,
  TextbookInventoryHistoryTransport, TextbookInventorySummary, TextbookMasterDetail,
  TextbookMasterDuplicate, TextbookMasterDuplicateInput, TextbookMasterRow, TextbookMasterSummary,
  SaleHistoryFilters, SaleHistorySummaryRow, TextbookSaleHistorySummary,
  PurchaseFilters, SaleFilters, TextbookPurchaseCaseRow, PurchaseMemberSource, PurchaseQuantities,
  SaleLineRow, TextbookPurchaseSummary, TextbookSaleSummary, TextbookOperationsSummary,
  TextbookPurchaseDetailInput, TextbookPurchaseDetail, TextbookSaleDetail,
  ClosingFilters, ClosingMovementFilters, ClosingMovementRow, ClosingRow, ClosingPreviewInput,
  TextbookClosingPreview, TextbookClosingDetail,
} from "./textbook-read-types";

export type TextbookReadOptions = { client?: NonNullable<typeof sharedSupabase> | null; signal?: AbortSignal };
type ObjectValue = Record<string, unknown>;
const qualities = ["all", "attention", "duplicate", "missingCode", "missingPublisher", "missingCategory", "missingPrice", "subjectMismatch", "inactive"];
const inventories = ["all", "shortage", "surplus", "unused", "negative"];
const audits = ["recommended", "pending", "done", "all"];
const purchaseStatuses = ["requested", "ordered", "partially_received", "received", "returned", "cancelled"];
const saleStatuses = ["charged", "issued", "cancelled", "returned"];
const purchaseRequests = ["all", "unregistered", "orderable"];
const purchaseOrders = ["all", "waiting", "partial", "returnable", "returned"];
const purchaseBoards = ["active", "recent", "all"];
const saleFilters = ["all", "waiting", "issued", "returned", "cancelled"];
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
function validateSaleHistoryFilters(filters: unknown): asserts filters is SaleHistoryFilters {
  if (!object(filters) || Object.keys(filters).length !== 4 || filters.search !== "" || !["year", "month", "classId"].every((key) => typeof filters[key] === "string")) fail("filters");
}
function parseSaleHistoryRow(data: unknown): SaleHistorySummaryRow {
  exact(data, ["id", "year", "month", "classId", "className", "textbookId", "textbookTitle", "waitingQuantity", "issuedQuantity", "totalQuantity", "latestAt"]);
  if (!["id", "year", "month", "classId", "className", "textbookId", "textbookTitle", "latestAt"].every((key) => typeof data[key] === "string")
    || !["waitingQuantity", "issuedQuantity", "totalQuantity"].every((key) => integer(data[key]) && data[key] >= 0)
    || !uuid(data.textbookId) || !(data.classId === "" || uuid(data.classId)) || (data.totalQuantity as number) < 1
    || data.totalQuantity !== (data.waitingQuantity as number) + (data.issuedQuantity as number)
    || data.id !== `${data.month}:${data.classId || "-"}:${data.textbookId || "-"}` || data.year !== String(data.month).slice(0, 4)) fail();
  return data as SaleHistorySummaryRow;
}
function parseSaleHistorySummary(data: unknown, filters: SaleHistoryFilters): TextbookSaleHistorySummary {
  exact(data, ["totalCount", "totalWaitingQuantity", "totalIssuedQuantity", "sourceTotalCount", "yearOptions", "monthOptions", "classOptions", "effectiveMonth"]);
  if (!["totalCount", "totalWaitingQuantity", "totalIssuedQuantity", "sourceTotalCount"].every((key) => integer(data[key]) && data[key] >= 0)
    || (data.totalCount as number) > (data.sourceTotalCount as number)
    || !stringArray(data.yearOptions) || !stringArray(data.monthOptions)
    || new Set(data.yearOptions).size !== data.yearOptions.length || new Set(data.monthOptions).size !== data.monthOptions.length
    || !Array.isArray(data.classOptions) || !data.classOptions.every((entry) => stringArray(entry) && entry.length === 2 && uuid(entry[0]))
    || new Set(data.classOptions.map((entry) => entry[0])).size !== data.classOptions.length
    || data.effectiveMonth !== (data.monthOptions.includes(filters.month) ? filters.month : "all")
    || (data.totalCount === 0 && (data.totalWaitingQuantity !== 0 || data.totalIssuedQuantity !== 0))
    || (data.totalWaitingQuantity as number) + (data.totalIssuedQuantity as number) < (data.totalCount as number)
    || (data.sourceTotalCount === 0 && (data.yearOptions.length !== 0 || data.monthOptions.length !== 0 || data.classOptions.length !== 0))) fail();
  return data as TextbookSaleHistorySummary;
}
type ReadKind = "master" | "inventory" | "history" | "sale-history" | "purchase" | "sale";
function validateFilters(filters: unknown, kind: ReadKind) {
  if (kind === "sale-history") { validateSaleHistoryFilters(filters); return; }
  if (kind === "purchase" || kind === "sale") {
    const keys = kind === "purchase" ? ["mode", "search", "boardScope", "requestFilter", "orderFilter"] : ["search", "status"];
    if (!object(filters) || Object.keys(filters).length !== keys.length || !keys.every((key) => typeof filters[key] === "string")) fail("filters");
    if (kind === "purchase" ? !["request", "order"].includes(filters.mode as string) || !purchaseBoards.includes(filters.boardScope as string)
      || !purchaseRequests.includes(filters.requestFilter as string) || !purchaseOrders.includes(filters.orderFilter as string) : !saleFilters.includes(filters.status as string)) fail("filters");
    return;
  }
  const keys = kind === "history" ? ["textbookId", "locationId"] : ["search", "subject", "schoolLevel", "gradeLevel", "subSubject", "quality", "inventory", ...(kind === "inventory" ? ["locationId", "audit"] : [])];
  if (!object(filters) || Object.keys(filters).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(filters, key))) fail("filters");
  if (kind === "history") { if (!keys.every((key) => nullableUuid(filters[key]))) fail("filters"); return; }
  if (!keys.every((key) => typeof filters[key] === "string") || !qualities.includes(filters.quality as string) || !inventories.includes(filters.inventory as string)
    || (kind === "inventory" && (!(filters.locationId === "" || uuid(filters.locationId)) || !audits.includes(filters.audit as string)))) fail("filters");
}
function validatePage(request: PageRequest<unknown, string>, kind: ReadKind, sort: string) {
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

export async function listTextbookSaleHistoryPage(request: PageRequest<SaleHistoryFilters, "month-class-title">, options: TextbookReadOptions = {}): Promise<NumberedPage<SaleHistorySummaryRow>> {
  validatePage(request, "sale-history", "month-class-title");
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("list_textbook_sale_history_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => parsePage(data, request, parseSaleHistoryRow));
}
export async function getTextbookSaleHistorySummary(filters: SaleHistoryFilters, options: TextbookReadOptions = {}): Promise<TextbookSaleHistorySummary> {
  validateSaleHistoryFilters(filters);
  const deadline = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_sale_history_summary_v1", { p_filters: filters }).abortSignal(signal).retry(false), (data) => parseSaleHistorySummary(data, filters));
}

type FieldKind = "text" | "nullableText" | "uuid" | "nullableUuid" | "integer" | "number" | "nullableNumber" | "boolean";
function fields(value: unknown, shape: Record<string, FieldKind>, extra: string[] = []): asserts value is ObjectValue {
  exact(value, [...Object.keys(shape), ...extra]);
  for (const [key, kind] of Object.entries(shape)) {
    const item = value[key];
    const valid = kind === "text" ? typeof item === "string" : kind === "nullableText" ? item === null || typeof item === "string"
      : kind === "uuid" ? uuid(item) : kind === "nullableUuid" ? nullableUuid(item) : kind === "integer" ? integer(item)
      : kind === "number" ? finite(item) : kind === "nullableNumber" ? item === null || finite(item) : typeof item === "boolean";
    if (!valid) fail();
  }
}
const workflowBookShape = {
  id: "uuid", title: "nullableText", name: "text", status: "text", subject: "nullableText", publisher: "nullableText",
  publisher_id: "nullableUuid", default_supplier_id: "nullableUuid", price: "nullableNumber", sale_price: "number", list_price: "number",
  isbn13: "nullableText", barcode: "nullableText", is_returnable: "boolean",
} satisfies Record<string, FieldKind>;
const purchaseOrderShape = {
  id: "uuid", supplier_id: "nullableUuid", requested_by: "text", requested_date: "text", order_date: "text", expected_date: "nullableText",
  ordered_at: "nullableText", received_at: "nullableText", status: "text", statement_number: "text", memo: "text", created_by: "nullableUuid", created_at: "nullableText", updated_at: "nullableText",
} satisfies Record<string, FieldKind>;
const purchaseMemberShape = {
  id: "uuid", purchase_order_id: "uuid", textbook_id: "nullableUuid", requested_textbook_title: "text", class_id: "nullableUuid", location_id: "nullableUuid",
  requested_quantity: "integer", ordered_quantity: "integer", received_quantity: "integer", teacher_ordered_quantity: "integer", teacher_received_quantity: "integer",
  unit_cost: "number", copy_scope: "text", memo: "text", created_at: "nullableText", updated_at: "nullableText", status: "text",
} satisfies Record<string, FieldKind>;
const saleMemberShape = {
  id: "uuid", sale_id: "uuid", student_id: "nullableUuid", class_id: "nullableUuid", textbook_id: "uuid", charge_month: "text", quantity: "integer", unit_price: "number",
  location_id: "nullableUuid", status: "text", exclusion_reason: "text", memo: "text", created_at: "nullableText", updated_at: "nullableText", copy_scope: "text", teacher_id: "nullableUuid", teacher_name: "text",
} satisfies Record<string, FieldKind>;
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  return object(left) && object(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}
function sourceTimes(value: ObjectValue, timestampKeys: string[], dateKeys: string[] = []) {
  for (const key of timestampKeys) {
    const at = value[key];
    if (at !== null && !(typeof at === "string" && (["infinity", "-infinity"].includes(at)
      || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(at) && Number.isFinite(Date.parse(at)))))) fail();
  }
  for (const key of dateKeys) if (value[key] !== null && !dates(value[key])) fail();
}
function reference(value: unknown, kind: "book" | "class" | "location" | "named", id?: unknown) {
  if (value === null) return; // RLS-hidden/missing references are explicitly null, never fabricated records.
  fields(value, kind === "book" ? workflowBookShape : kind === "class" ? { id: "uuid", name: "text", studentCount: "integer" }
    : kind === "location" ? { id: "uuid", code: "text", name: "text" } : { id: "uuid", name: "text" });
  if ((id !== undefined && value.id !== id) || (kind === "class" && (value.studentCount as number) < 0)) fail();
}
function parsePurchaseMember(value: unknown, primary = false): PurchaseMemberSource {
  fields(value, purchaseMemberShape, ["order", ...(primary ? ["purchaseScopeLines"] : [])]);
  sourceTimes(value, ["created_at", "updated_at"]);
  if (!["student", "teacher"].includes(value.copy_scope as string) || !purchaseStatuses.includes(value.status as string)) fail();
  if (value.order !== null) {
    fields(value.order, purchaseOrderShape);
    sourceTimes(value.order, ["ordered_at", "received_at", "created_at", "updated_at"], ["requested_date", "order_date", "expected_date"]);
    if (value.order.id !== value.purchase_order_id || !purchaseStatuses.includes(value.order.status as string)) fail();
  }
  return value as PurchaseMemberSource;
}
function parseQuantities(value: unknown): PurchaseQuantities {
  exact(value, ["requested", "ordered", "received", "student", "teacher"]);
  for (const scope of [value.student, value.teacher]) fields(scope, { requested: "integer", ordered: "integer", received: "integer" });
  for (const key of ["requested", "ordered", "received"]) {
    if (!integer(value[key]) || value[key] !== ((value.student as ObjectValue)[key] as number) + ((value.teacher as ObjectValue)[key] as number)) fail();
  }
  return value as PurchaseQuantities;
}
function parsePurchaseRow(value: unknown, mode: "request" | "order"): TextbookPurchaseCaseRow {
  exact(value, ["id", "anchorLineId", "memberLineIds", "line", "lines", "mode", "status", "eventAt", "references", "quantities"]);
  if (typeof value.id !== "string" || !value.id || !uuid(value.anchorLineId) || !stringArray(value.memberLineIds)
    || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 2 || value.mode !== mode
    || !purchaseStatuses.includes(value.status as string) || (mode === "request" && value.status !== "requested") || typeof value.eventAt !== "string") fail();
  const lines = value.lines.map((line) => parsePurchaseMember(line));
  const primary = parsePurchaseMember(value.line, true);
  const primarySource = { ...primary }; delete primarySource.purchaseScopeLines;
  if (value.anchorLineId !== lines[0].id || !sameValue(value.memberLineIds, lines.map((line) => line.id)) || new Set(value.memberLineIds).size !== lines.length
    || new Set(lines.map((line) => line.copy_scope)).size !== lines.length || !sameValue(primary.purchaseScopeLines, lines)
    || !sameValue(primarySource, lines.find((line) => line.copy_scope === "student") || lines[0]) || lines.some((line) => line.status !== value.status)) fail();
  const quantities = parseQuantities(value.quantities);
  for (const scope of ["student", "teacher"] as const) for (const kind of ["requested", "ordered", "received"] as const) {
    if (quantities[scope][kind] !== lines.filter((line) => line.copy_scope === scope).reduce((sum, line) => sum + (line[`${kind}_quantity`] as number), 0)) fail();
  }
  exact(value.references, ["textbook", "class", "location", "publisher", "supplier", "configuredSupplierId", "unitCost"]);
  const refs = value.references;
  reference(refs.textbook, "book", primary.textbook_id || undefined); reference(refs.class, "class", primary.class_id); reference(refs.location, "location", primary.location_id);
  reference(refs.publisher, "named"); reference(refs.supplier, "named", refs.configuredSupplierId);
  if (!(refs.configuredSupplierId === "" || uuid(refs.configuredSupplierId)) || !finite(refs.unitCost) || (mode === "request" && refs.supplier !== null)) fail();
  const order = primary.order;
  const expectedEvent = primary.status === "received" || primary.status === "partially_received" ? order?.received_at || order?.updated_at || primary.updated_at || ""
    : primary.status === "ordered" ? order?.ordered_at || order?.order_date || order?.updated_at || primary.updated_at || "" : order?.created_at || primary.created_at || "";
  const bookKey = (refs.textbook as ObjectValue | null)?.id || (primary.requested_textbook_title || primary.textbook_id || "-").trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  const baseKey = [primary.status, bookKey, primary.class_id || "", primary.location_id || "", order?.requested_by.trim() || "", order?.supplier_id || "", order?.order_date || "", order?.statement_number.trim() || ""].join("||");
  if (value.eventAt !== expectedEvent || (value.id !== baseKey && !(lines.length === 1 && value.id === `${baseKey}||${primary.id}`))) fail();
  return value as TextbookPurchaseCaseRow;
}
function parseSaleRow(value: unknown): SaleLineRow {
  exact(value, ["id", "line", "sale", "textbook", "class", "student", "location", "status", "groupStatus", "eventAt", "quantity", "amount", "recipientName"]);
  fields(value.line, saleMemberShape); const line = value.line;
  sourceTimes(line, ["created_at", "updated_at"]);
  if (!["charged", "paid", "issued", "excluded", "cancelled", "returned"].includes(line.status as string)) fail();
  if (value.sale !== null) fields(value.sale, { id: "uuid", class_id: "nullableUuid", charge_month: "text", sale_date: "text", status: "text", memo: "text", created_by: "nullableUuid", created_at: "nullableText", updated_at: "nullableText" });
  const sale = value.sale as ObjectValue | null;
  if (sale) {
    sourceTimes(sale, ["created_at", "updated_at"], ["sale_date"]);
    if (!["draft", "charged", "paid", "issued", "cancelled"].includes(sale.status as string)) fail();
  }
  reference(value.textbook, "book", line.textbook_id); reference(value.class, "class", line.class_id || sale?.class_id || null);
  reference(value.student, "named", line.student_id); reference(value.location, "location", line.location_id);
  const status = line.status === "paid" ? "charged" : line.status;
  if (value.id !== line.id || (sale && sale.id !== line.sale_id) || !["student", "teacher"].includes(line.copy_scope as string) || value.textbook === null
    || value.status !== status || value.groupStatus !== (saleStatuses.includes(status as string) ? status : "charged")
    || typeof value.eventAt !== "string" || typeof value.recipientName !== "string" || value.quantity !== Math.max(1, (line.quantity as number) || 1) || !finite(value.amount)) fail();
  const book = value.textbook as ObjectValue;
  const price = (line.unit_price as number) || (book.sale_price as number) || (book.price as number) || (book.list_price as number) || 0;
  const expectedAmount = price * (value.quantity as number);
  const scale = Math.max(Math.abs(value.amount), Math.abs(expectedAmount));
  if (!Number.isFinite(expectedAmount) || (scale !== 0 && Math.abs(value.amount / scale - expectedAmount / scale) > Number.EPSILON * 4)) fail();
  const expectedEvent = status === "issued" ? line.updated_at || "" : sale?.created_at || line.created_at || "";
  const recipient = line.copy_scope === "teacher" ? String(line.teacher_name).trim() || "선생님 미지정" : String((value.student as ObjectValue | null)?.name || line.student_id || "").trim() || "-";
  if (value.eventAt !== expectedEvent || value.recipientName !== recipient) fail();
  return value as SaleLineRow;
}
function parsePurchaseSummary(value: unknown, mode: "request" | "order"): TextbookPurchaseSummary {
  exact(value, ["mode", "totalCount", "rawLineCount", "quantities", "groups", "requestCounts", "orderCounts", "boardScopeCounts"]);
  if (value.mode !== mode || !integer(value.totalCount) || value.totalCount < 0 || !integer(value.rawLineCount) || value.rawLineCount < value.totalCount || value.rawLineCount > value.totalCount * 2 || !Array.isArray(value.groups)) fail();
  const quantities = parseQuantities(value.quantities); let total = 0; let raw = 0; let previous = -1;
  const groups = value.groups.map((group) => {
    exact(group, ["status", "totalCount", "rawLineCount", "quantities"]);
    const index = purchaseStatuses.indexOf(group.status as string);
    if (index <= previous || (mode === "request" && group.status !== "requested") || !integer(group.totalCount) || group.totalCount <= 0 || !integer(group.rawLineCount) || group.rawLineCount < group.totalCount || group.rawLineCount > 2 * group.totalCount) fail();
    previous = index; total += group.totalCount; raw += group.rawLineCount; return parseQuantities(group.quantities);
  });
  if (total !== value.totalCount || raw !== value.rawLineCount) fail();
  for (const kind of ["requested", "ordered", "received"] as const) {
    if (groups.reduce((sum, q) => sum + q[kind], 0) !== quantities[kind]) fail();
    for (const scope of ["student", "teacher"] as const) if (groups.reduce((sum, q) => sum + q[scope][kind], 0) !== quantities[scope][kind]) fail();
  }
  countMap(value.requestCounts, purchaseRequests); countMap(value.orderCounts, purchaseOrders); countMap(value.boardScopeCounts, purchaseBoards);
  return value as TextbookPurchaseSummary;
}
function parseSaleSummary(value: unknown): TextbookSaleSummary {
  exact(value, ["totalCount", "totalQuantity", "studentCount", "classCount", "totalAmount", "groups", "statusCounts"]);
  if (!["totalCount", "totalQuantity", "studentCount", "classCount"].every((key) => integer(value[key]) && value[key] >= 0) || !finite(value.totalAmount)
    || (value.studentCount as number) > (value.totalCount as number) || (value.classCount as number) > (value.totalCount as number) || !Array.isArray(value.groups)) fail();
  let total = 0; let previous = -1;
  for (const group of value.groups) {
    fields(group, { status: "text", totalCount: "integer", totalQuantity: "integer" });
    const index = saleStatuses.indexOf(group.status as string);
    if (index <= previous || (group.totalCount as number) <= 0) fail(); previous = index; total += group.totalCount as number;
  }
  if (total !== value.totalCount || (value.totalQuantity as number) < total) fail();
  countMap(value.statusCounts, saleFilters);
  return value as TextbookSaleSummary;
}

export async function listTextbookPurchasePage(request: PageRequest<PurchaseFilters, "status-event">, options: TextbookReadOptions = {}): Promise<NumberedPage<TextbookPurchaseCaseRow>> {
  validatePage(request, "purchase", "status-event");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("list_textbook_purchase_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => parsePage(data, request, (row) => parsePurchaseRow(row, request.filters.mode)));
}
export async function listTextbookSalePage(request: PageRequest<SaleFilters, "status-event">, options: TextbookReadOptions = {}): Promise<NumberedPage<SaleLineRow>> {
  validatePage(request, "sale", "status-event");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("list_textbook_sale_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => parsePage(data, request, parseSaleRow));
}
export async function getTextbookPurchaseSummary(filters: PurchaseFilters, options: TextbookReadOptions = {}): Promise<TextbookPurchaseSummary> {
  validateFilters(filters, "purchase");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_purchase_summary_v1", { p_filters: filters }).abortSignal(signal).retry(false), (data) => parsePurchaseSummary(data, filters.mode));
}
export async function getTextbookSaleSummary(filters: SaleFilters, options: TextbookReadOptions = {}): Promise<TextbookSaleSummary> {
  validateFilters(filters, "sale");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_sale_summary_v1", { p_filters: filters }).abortSignal(signal).retry(false), parseSaleSummary);
}
export async function getTextbookOperationsSummary(options: TextbookReadOptions = {}): Promise<TextbookOperationsSummary> {
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_operations_summary_v1", {}).abortSignal(signal).retry(false), (data) => {
    countMap(data, ["requestCount", "unregisteredRequestCount", "orderNeededCount", "receivingBacklogCount", "partialReceiptCount", "issueWaitingCount", "stockRiskCount"]);
    const result = data as TextbookOperationsSummary;
    if (result.requestCount !== result.unregisteredRequestCount + result.orderNeededCount) fail(); return result;
  });
}
export async function getTextbookPurchaseDetail(input: TextbookPurchaseDetailInput, options: TextbookReadOptions = {}): Promise<TextbookPurchaseDetail> {
  if (!object(input) || Object.keys(input).length !== 2 || !uuid(input.anchorLineId) || !["request", "order"].includes(input.mode)) fail("input");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_purchase_detail_v1", { p_anchor_line_id: input.anchorLineId, p_mode: input.mode }).abortSignal(signal).retry(false), (data) => {
    exact(data, ["row"]); const row = data.row === null ? null : parsePurchaseRow(data.row, input.mode);
    if (row && !row.memberLineIds.some((id) => id.toLowerCase() === input.anchorLineId.toLowerCase())) fail(); return { row };
  });
}
export async function getTextbookSaleDetail(id: string, options: TextbookReadOptions = {}): Promise<TextbookSaleDetail> {
  if (!uuid(id)) fail("id");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return read({ ...options, signal }, (client) => client.rpc("get_textbook_sale_detail_v1", { p_id: id }).abortSignal(signal).retry(false), (data) => {
    exact(data, ["row"]); const row = data.row === null ? null : parseSaleRow(data.row);
    if (row && row.id.toLowerCase() !== id.toLowerCase()) fail(); return { row };
  });
}

// Shared strict transport primitives for the separate complete-purpose adapter.
// Existing finalized page parsers above retain their original contracts.
export async function readTextbookPurpose<T>(options: TextbookReadOptions, query: (client: NonNullable<typeof sharedSupabase>) => PromiseLike<{ data: unknown; error: unknown }>, parser: (data: unknown) => T): Promise<T> {
  return read(options, query, parser);
}
export function validateClosingMovementFilters(filters: unknown): asserts filters is ClosingMovementFilters {
  if (!object(filters) || Object.keys(filters).length !== 3 || !["closingMonth", "subject", "search"].every((key) => typeof filters[key] === "string")) fail("filters");
}
export function parseClosingMovement(value: unknown): ClosingMovementRow {
  fields(value, { id: "uuid", at: "text", typeLabel: "text", textbookTitle: "text", locationName: "text", quantity: "integer", amount: "number", marginAmount: "number" });
  sourceTimes(value, ["at"]);
  if ((value.marginAmount as number) < 0) fail();
  return value as ClosingMovementRow;
}
const closingRowShape = {
  id: "uuid", closing_month: "text", subject: "text", opening_quantity: "integer", opening_amount: "number", purchase_quantity: "integer", purchase_amount: "number",
  sale_quantity: "integer", sale_amount: "number", adjustment_quantity: "integer", adjustment_amount: "number", ending_quantity: "integer", ending_amount: "number",
  received_amount: "number", supplier_payment_amount: "number", settlement_difference: "number", status: "text", memo: "text", created_by: "nullableUuid", created_at: "nullableText", updated_at: "nullableText",
} satisfies Record<string, FieldKind>;
function parseClosingRow(value: unknown): ClosingRow {
  fields(value, closingRowShape); sourceTimes(value, ["created_at", "updated_at"]);
  if (!["draft", "locked"].includes(value.status as string)) fail(); return value as ClosingRow;
}
function closingAmountMatches(parts: number[], total: number) {
  const scale = Math.max(Math.abs(total), ...parts.map(Math.abs)); if (scale === 0) return true;
  const sum = parts.reduce((value, part) => value + part / scale, 0);
  const magnitude = parts.reduce((value, part) => value + Math.abs(part / scale), Math.abs(total / scale));
  return Math.abs(sum - total / scale) <= Number.EPSILON * (parts.length + 2) * magnitude;
}
function parseClosingPreview(value: unknown, input: ClosingPreviewInput): TextbookClosingPreview {
  exact(value, ["closingMonth", "subject", "sourceLineCount", "closing"]);
  if (value.closingMonth !== input.closingMonth.trim() || value.subject !== input.subject.trim() || !integer(value.sourceLineCount) || value.sourceLineCount < 0) fail();
  const quantities = ["openingQuantity", "purchaseQuantity", "saleQuantity", "adjustmentQuantity", "endingQuantity"];
  const amounts = ["openingAmount", "purchaseAmount", "saleAmount", "adjustmentAmount", "endingAmount", "receivedAmount", "supplierPaymentAmount", "paymentDifference", "textbookMarginAmount", "settlementDifference"];
  exact(value.closing, [...quantities, ...amounts, "teamMargins", "needsReview"]); const c = value.closing;
  if (!["purchaseQuantity", "saleQuantity", "adjustmentQuantity"].every((key) => integer(c[key])) || !["openingQuantity", "endingQuantity", ...amounts].every((key) => finite(c[key])) || !Array.isArray(c.teamMargins) || c.teamMargins.length !== 4
    || c.openingQuantity !== input.openingQuantity || c.openingAmount !== input.openingAmount || c.receivedAmount !== 0 || c.supplierPaymentAmount !== 0 || c.paymentDifference !== 0
    || c.settlementDifference !== c.textbookMarginAmount || c.needsReview !== ((c.endingQuantity as number) < 0)
    || c.endingQuantity !== input.openingQuantity + (c.purchaseQuantity as number) - (c.saleQuantity as number) + (c.adjustmentQuantity as number)) fail();
  c.teamMargins.forEach((team, i) => {
    fields(team, { team: "text", saleQuantity: "integer", saleAmount: "number", purchaseCostAmount: "number", marginAmount: "number" });
    if (team.team !== ["english", "math", "science", "other"][i] || (team.saleQuantity as number) < 0 || (team.marginAmount as number) < 0 || (team.purchaseCostAmount as number) < 0) fail();
  });
  if (!closingAmountMatches(c.teamMargins.map((team) => team.marginAmount as number), c.textbookMarginAmount as number)
    || !closingAmountMatches([input.openingAmount, c.purchaseAmount as number, -(c.saleAmount as number), c.adjustmentAmount as number], c.endingAmount as number)
    || (value.sourceLineCount === 0 && (["purchaseQuantity", "purchaseAmount", "saleQuantity", "saleAmount", "adjustmentQuantity", "adjustmentAmount", "textbookMarginAmount"].some((key) => c[key] !== 0)
      || c.teamMargins.some((team) => ["saleQuantity", "saleAmount", "purchaseCostAmount", "marginAmount"].some((key) => team[key] !== 0))))) fail();
  return value as TextbookClosingPreview;
}
function validateClosingPage(request: PageRequest<unknown, string>, movement: boolean) {
  if (!object(request) || !integer(request.page) || request.page < 1 || request.page > 2147483647) fail("page");
  if (![10, 15, 20].includes(request.pageSize)) fail("page_size");
  if (request.sort !== (movement ? "event-desc" : "month-desc")) fail("sort");
  if (movement) validateClosingMovementFilters(request.filters);
  else if (!object(request.filters) || Object.keys(request.filters).length !== 3 || !["month", "subject", "status"].every((key) => typeof (request.filters as ObjectValue)[key] === "string")) fail("filters");
}
export async function listTextbookClosingPage(request: PageRequest<ClosingFilters, "month-desc">, options: TextbookReadOptions = {}): Promise<NumberedPage<ClosingRow>> {
  validateClosingPage(request, false);
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("list_textbook_closing_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => {
    const page = parsePage(data, request, parseClosingRow);
    if (page.rows.some((row) => (request.filters.month !== "all" && row.closing_month !== request.filters.month)
      || (request.filters.subject !== "all" && row.subject !== request.filters.subject) || (request.filters.status !== "all" && row.status !== request.filters.status))) fail();
    return page;
  });
}
export async function listTextbookClosingMovementPage(request: PageRequest<ClosingMovementFilters, "event-desc">, options: TextbookReadOptions = {}): Promise<NumberedPage<ClosingMovementRow>> {
  validateClosingPage(request, true);
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("list_textbook_closing_movement_page_v1", { p_filters: request.filters, p_sort: request.sort, p_page: request.page, p_page_size: request.pageSize }).abortSignal(signal).retry(false), (data) => {
    const page = parsePage(data, request, parseClosingMovement);
    const search = request.filters.search.trim().replace(/\s+/g, " ").toLowerCase();
    if (page.rows.some((row) => !row.at.startsWith(request.filters.closingMonth.trim()) || !getClosingDetailSearchHaystack(row).includes(search))) fail();
    return page;
  });
}
export async function getTextbookClosingPreview(input: ClosingPreviewInput, options: TextbookReadOptions = {}): Promise<TextbookClosingPreview> {
  if (!object(input) || Object.keys(input).length !== 4 || typeof input.closingMonth !== "string" || typeof input.subject !== "string" || !finite(input.openingQuantity) || !finite(input.openingAmount)) fail("input");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_textbook_closing_preview_v1", { p_input: input }).abortSignal(signal).retry(false), (data) => parseClosingPreview(data, input));
}
export async function getTextbookClosingDetail(id: string, options: TextbookReadOptions = {}): Promise<TextbookClosingDetail> {
  if (!uuid(id)) fail("id");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_textbook_closing_detail_v1", { p_id: id }).abortSignal(signal).retry(false), (data) => {
    exact(data, ["row", "preview"]);
    if (data.row === null) { if (data.preview !== null) fail(); return { row: null, preview: null, storedMetrics: null, metricMismatches: null, metricMismatchCount: 0 }; }
    const row = parseClosingRow(data.row); if (row.id.toLowerCase() !== id.toLowerCase() || data.preview === null) fail();
    const preview = parseClosingPreview(data.preview, { closingMonth: row.closing_month.trim(), subject: row.subject.trim() || "all", openingQuantity: row.opening_quantity, openingAmount: row.opening_amount });
    const storedMetrics = getClosingStoredMetrics(row);
    const metricMismatches = { purchase: hasClosingMetricMismatch(storedMetrics.purchaseQuantity, preview.closing.purchaseQuantity), sale: hasClosingMetricMismatch(storedMetrics.saleQuantity, preview.closing.saleQuantity),
      ending: hasClosingMetricMismatch(storedMetrics.endingQuantity, preview.closing.endingQuantity), margin: hasClosingMetricMismatch(storedMetrics.marginAmount, preview.closing.textbookMarginAmount) };
    return { row, preview, storedMetrics, metricMismatches, metricMismatchCount: Object.values(metricMismatches).filter(Boolean).length };
  });
}
export const textbookPurposeValidation: {
  fail: typeof fail; exact: typeof exact; fields: typeof fields; integer: typeof integer; finite: typeof finite; uuid: typeof uuid;
  nullableUuid: typeof nullableUuid; stringArray: typeof stringArray; sourceTimes: typeof sourceTimes; sameValue: typeof sameValue;
  validateFilters: typeof validateFilters; parsePurchaseMember: typeof parsePurchaseMember; parseSaleRow: typeof parseSaleRow;
  reference: typeof reference; validateBalance: typeof validateBalance; workflowBookShape: typeof workflowBookShape;
  saleMemberShape: typeof saleMemberShape; parseClosingMovement: typeof parseClosingMovement;
} = { fail, exact, fields, integer, finite, uuid, nullableUuid, stringArray, sourceTimes, sameValue, validateFilters,
  parsePurchaseMember, parseSaleRow, reference, validateBalance, workflowBookShape, saleMemberShape, parseClosingMovement };
