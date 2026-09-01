import { readTextbookPurpose, textbookPurposeValidation, validateClosingMovementFilters, type TextbookReadOptions } from "./textbook-read-service";
import { getClosingDetailSearchHaystack } from "./textbook-closing-model";
import { buildPurchaseSupplierHandoffGroups, buildPurchaseSupplierReturnHandoffGroups, buildMakeEduBillingHandoffGroups, getSaleLineMonth, getSaleLineStatus, isBillableSaleLineStatus, normalizeMonthInput } from "./textbook-handoff-model";
import { filterStockMovesForClosing, getTextbookByReference, listIds } from "./textbook-ledger.js";
import { normalizeTextbookLookup, text } from "./textbook-read-model";
import type { Row, PurchaseFilters, SaleFilters, ClosingMovementFilters, TextbookHandoffResult, TextbookClosingSaveContext, TextbookClosingMovementExport, ClassTextbookSaleContextInput, ClassTextbookSaleContext, ClassTextbookSaleStudentRecord } from "./textbook-read-types";
const v: typeof textbookPurposeValidation = textbookPurposeValidation;

function rows(value: unknown, parser: (item: unknown) => void): Row[] {
  if (!Array.isArray(value)) v.fail();
  value.forEach(parser);
  if (new Set(value.map((item) => item.id)).size !== value.length) v.fail();
  return value;
}
function byId(source: Row[]) { return new Map(source.map((row) => [String(row.id), row])); }
function sameIds(actual: unknown, expected: unknown[]) {
  if (!v.stringArray(actual) || !v.sameValue(actual, expected)) v.fail();
}
function exactReferenceSet(source: Row[], ids: Iterable<unknown>) {
  const expected = new Set([...ids].filter((id) => id !== null && id !== undefined && id !== ""));
  if (source.length !== expected.size || source.some((row) => !expected.has(row.id))) v.fail();
}
function countSources(data: Row, source: Row[], count = "sourceLineCount", ids = "sourceLineIds") {
  if (data.complete !== true || !v.integer(data[count]) || data[count] !== source.length) v.fail();
  sameIds(data[ids], source.map((row) => row.id));
}
function books(value: unknown) { return rows(value, (row) => v.fields(row, v.workflowBookShape)); }
function classes(value: unknown) { return rows(value, (row) => { v.reference(row, "class"); if (row === null) v.fail(); }); }
function students(value: unknown) { return rows(value, (row) => v.fields(row, { id: "uuid", name: "text", grade: "nullableText" })); }
function classStudents(value: unknown) {
  return rows(value, (row) => v.fields(row, { id: "uuid", name: "text", grade: "nullableText", school: "nullableText" })) as ClassTextbookSaleStudentRecord[];
}
function saleLines(value: unknown) {
  return rows(value, (row) => {
    // Complete contexts carry the physical raw line; the existing workflow
    // selected-line projection deliberately remains a separate smaller shape.
    v.fields(row, { ...v.saleMemberShape, makeedu_card_company: "nullableText", makeedu_charge_amount: "number", makeedu_charge_month: "nullableText",
      makeedu_discount_amount: "number", makeedu_import_key: "nullableText", makeedu_item_name: "nullableText", makeedu_memo: "nullableText",
      makeedu_paid_amount: "number", makeedu_paid_at: "nullableText", makeedu_payment_method: "nullableText", makeedu_payment_method_detail: "nullableText",
      makeedu_payment_status: "nullableText", makeedu_saved_point_amount: "number", makeedu_student_no: "nullableText", makeedu_synced_at: "nullableText", makeedu_unpaid_amount: "number" });
    v.sourceTimes(row, ["created_at", "updated_at", "makeedu_synced_at"], ["makeedu_paid_at"]);
    if (!["charged", "paid", "issued", "excluded", "cancelled", "returned"].includes(String(row.status)) || !["student", "teacher"].includes(String(row.copy_scope))) v.fail();
  });
}
function sales(value: unknown) {
  return rows(value, (row) => {
    v.fields(row, { id: "uuid", class_id: "nullableUuid", charge_month: "text", sale_date: "text", status: "text", memo: "text", created_by: "nullableUuid", created_at: "nullableText", updated_at: "nullableText" });
    v.sourceTimes(row, ["created_at", "updated_at"], ["sale_date"]);
    if (!["draft", "charged", "paid", "issued", "cancelled"].includes(String(row.status))) v.fail();
  });
}
function references(data: Row, closing: boolean, extraSuppliers: unknown[] = []) {
  const textbooks = books(data.textbooks);
  const publishers = rows(data.publishers, (row) => v.fields(row, { id: "uuid", name: "text" }));
  const suppliers = rows(data.suppliers, (row) => v.fields(row, { id: "uuid", name: "text", contact: "text" }));
  const links = rows(data.publisherSupplierLinks, (row) => v.fields(row, { id: "uuid", publisher_id: "uuid", supplier_id: "uuid", priority: "integer", is_primary: "boolean" }));
  const normalize = closing ? (value: unknown) => text(value).replace(/\s+/g, "").toLowerCase() : normalizeTextbookLookup;
  const publisherIds = textbooks.map((book) => book.publisher_id || (text(book.publisher) ? publishers.find((publisher) => normalize(publisher.name) === normalize(book.publisher))?.id : null));
  exactReferenceSet(publishers, publisherIds);
  if (links.some((link) => !publisherIds.includes(link.publisher_id))) v.fail();
  exactReferenceSet(suppliers, [...extraSuppliers, ...textbooks.map((book) => book.default_supplier_id), ...links.map((link) => link.supplier_id)]);
  return { textbooks, publishers, suppliers, publisherSupplierLinks: links };
}

export async function getTextbookPurchaseHandoff(filters: PurchaseFilters, kind: "order" | "return", options: TextbookReadOptions = {}): Promise<TextbookHandoffResult> {
  v.validateFilters(filters, "purchase"); if (!["order", "return"].includes(kind)) v.fail("input");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_textbook_purchase_handoff_context_v1", { p_filters: filters, p_kind: kind }).abortSignal(signal).retry(false), (data) => {
    v.exact(data, ["kind", "sourceLineCount", "sourceLineIds", "resolvedTextbookIds", "lines", "textbooks", "publishers", "suppliers", "publisherSupplierLinks", "locations", "classes", "complete"]);
    const lines = rows(data.lines, (line) => v.parsePurchaseMember(line)); countSources(data, lines);
    if (data.kind !== kind || !Array.isArray(data.resolvedTextbookIds) || data.resolvedTextbookIds.length !== lines.length || !data.resolvedTextbookIds.every(v.nullableUuid)) v.fail();
    const orderMap = new Map<string, Row>();
    for (const line of lines) {
      const order = line.order as Row | null; if (!order || line.status !== order.status) v.fail();
      if (orderMap.has(String(order.id)) && !v.sameValue(orderMap.get(String(order.id)), order)) v.fail(); orderMap.set(String(order.id), order);
      if (kind === "order" ? !["ordered", "partially_received"].includes(String(line.status)) || Number(line.ordered_quantity) <= 0
        : !["received", "partially_received"].includes(String(line.status)) || Number(line.received_quantity) <= 0) v.fail();
    }
    const refs = references(data, false, [...orderMap.values()].map((order) => order.supplier_id));
    exactReferenceSet(refs.textbooks, data.resolvedTextbookIds);
    lines.forEach((line, i) => {
      const resolved = getTextbookByReference(refs.textbooks, line.textbook_id || line.requested_textbook_title)?.id || null;
      if (resolved !== (data.resolvedTextbookIds as unknown[])[i]) v.fail();
    });
    const classRows = classes(data.classes); exactReferenceSet(classRows, lines.map((line) => line.class_id));
    const locations = rows(data.locations, (row) => { v.reference(row, "location"); if (row === null) v.fail(); }); exactReferenceSet(locations, lines.map((line) => line.location_id));
    const build = kind === "order" ? buildPurchaseSupplierHandoffGroups : buildPurchaseSupplierReturnHandoffGroups;
    const groups = build({ rows: lines, ordersById: orderMap, ...refs, locations, classes: classRows });
    return { groups, sourceLineCount: lines.length, complete: true };
  });
}
export async function getTextbookBillingHandoff(filters: SaleFilters, options: TextbookReadOptions = {}): Promise<TextbookHandoffResult> {
  v.validateFilters(filters, "sale");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_textbook_billing_handoff_context_v1", { p_filters: filters }).abortSignal(signal).retry(false), (data) => {
    v.exact(data, ["sourceLineCount", "sourceLineIds", "lines", "sales", "textbooks", "classes", "students", "complete"]);
    const lines = saleLines(data.lines); countSources(data, lines);
    const saleRows = sales(data.sales); exactReferenceSet(saleRows, lines.map((line) => line.sale_id)); const salesById = byId(saleRows);
    if (lines.some((line) => line.copy_scope === "teacher" || !isBillableSaleLineStatus(getSaleLineStatus(line, salesById.get(String(line.sale_id)))))) v.fail();
    const textbooks = books(data.textbooks); exactReferenceSet(textbooks, lines.map((line) => line.textbook_id));
    const classRows = classes(data.classes); exactReferenceSet(classRows, lines.map((line) => line.class_id || salesById.get(String(line.sale_id))?.class_id));
    const studentRows = students(data.students); exactReferenceSet(studentRows, lines.map((line) => line.student_id));
    const groups = buildMakeEduBillingHandoffGroups({ rows: lines, salesById, textbooks, classes: classRows, studentsById: byId(studentRows) });
    return { groups, sourceLineCount: lines.length, complete: true };
  });
}
export async function getTextbookClosingSaveContext(closingMonth: string, subject: string, options: TextbookReadOptions = {}): Promise<TextbookClosingSaveContext> {
  if (typeof closingMonth !== "string" || typeof subject !== "string") v.fail("input");
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_textbook_closing_save_context_v1", { p_closing_month: closingMonth, p_subject: subject }).abortSignal(signal).retry(false), (data) => {
    v.exact(data, ["closingMonth", "subject", "sourceLineCount", "sourceLineIds", "stockMoves", "textbooks", "publishers", "suppliers", "publisherSupplierLinks", "complete"]);
    if (data.closingMonth !== closingMonth.trim() || data.subject !== subject.trim()) v.fail();
    const stockMoves = rows(data.stockMoves, (move) => {
      v.fields(move, { id: "uuid", textbook_id: "uuid", location_id: "nullableUuid", purchase_order_line_id: "nullableUuid", sale_line_id: "nullableUuid", move_type: "text", quantity: "integer", unit_amount: "number", amount: "number", moved_at: "text", memo: "text", created_by: "nullableUuid", created_at: "nullableText", copy_scope: "text" });
      v.sourceTimes(move, ["moved_at", "created_at"]);
      if (!["opening", "purchase_receipt", "sale_issue", "return_in", "return_out", "transfer_in", "transfer_out", "stock_adjustment"].includes(String(move.move_type)) || !["student", "teacher"].includes(String(move.copy_scope))) v.fail();
    });
    countSources(data, stockMoves); const refs = references(data, true); exactReferenceSet(refs.textbooks, stockMoves.map((move) => move.textbook_id));
    if (filterStockMovesForClosing({ closingMonth, subject, stockMoves, ...refs }).length !== stockMoves.length) v.fail();
    return data as TextbookClosingSaveContext;
  });
}
export async function getTextbookClosingMovementExport(filters: ClosingMovementFilters, options: TextbookReadOptions = {}): Promise<TextbookClosingMovementExport> {
  validateClosingMovementFilters(filters);
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_textbook_closing_movement_export_v1", { p_filters: filters }).abortSignal(signal).retry(false), (data) => {
    v.exact(data, ["sourceLineCount", "sourceLineIds", "rows", "complete"]);
    const source = rows(data.rows, v.parseClosingMovement); countSources(data, source);
    const movementRows = source as TextbookClosingMovementExport["rows"];
    const search = filters.search.trim().replace(/\s+/g, " ").toLowerCase();
    if (movementRows.some((row) => !row.at.startsWith(filters.closingMonth.trim()) || !getClosingDetailSearchHaystack(row).includes(search))) v.fail();
    return { rows: movementRows, sourceLineCount: source.length, complete: true };
  });
}
export async function getClassTextbookSaleContext(input: ClassTextbookSaleContextInput, options: TextbookReadOptions = {}): Promise<ClassTextbookSaleContext> {
  v.fields(input, { classId: "uuid", textbookId: "uuid", locationId: "uuid", chargeMonth: "text" });
  const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return readTextbookPurpose({ ...options, signal }, (client) => client.rpc("get_class_textbook_sale_context_v1", { p_input: input }).abortSignal(signal).retry(false), (data) => {
    v.exact(data, ["input", "class", "enrolledStudentIds", "students", "missingStudentIds", "textbook", "location", "inventory", "duplicateLines", "duplicateSales", "duplicateLineIds", "duplicateLineCount", "duplicateStudentIds", "duplicateCount", "complete"]);
    if (!v.sameValue(data.input, { classId: input.classId.toLowerCase(), textbookId: input.textbookId.toLowerCase(), locationId: input.locationId.toLowerCase(), chargeMonth: normalizeMonthInput(input.chargeMonth) })) v.fail();
    v.exact(data.class, ["id", "name", "student_ids"]); if (data.class.id !== input.classId.toLowerCase() || typeof data.class.name !== "string") v.fail();
    const enrolled = listIds(data.class.student_ids); sameIds(data.enrolledStudentIds, enrolled);
    const studentRows = classStudents(data.students); const studentMap = byId(studentRows);
    if (studentRows.some((row) => !enrolled.includes(String(row.id)))) v.fail();
    sameIds(data.missingStudentIds, enrolled.filter((id) => !studentMap.has(id)));
    v.reference(data.textbook, "book", input.textbookId.toLowerCase()); v.reference(data.location, "location", input.locationId.toLowerCase());
    if (data.textbook === null || data.location === null) v.fail();
    v.exact(data.inventory, ["textbookId", "currentQuantity", "locationQuantities", "studentLocationQuantities", "teacherLocationQuantities", "totalQuantity", "studentQuantity", "teacherQuantity", "stockValue"]);
    v.validateBalance(data.inventory);
    if (data.inventory.textbookId !== input.textbookId.toLowerCase() || data.inventory.currentQuantity !== ((data.inventory.locationQuantities as Row)[input.locationId.toLowerCase()] || 0)) v.fail();
    const lines = saleLines(data.duplicateLines); countSources(data, lines, "duplicateLineCount", "duplicateLineIds");
    const saleRows = sales(data.duplicateSales); exactReferenceSet(saleRows, lines.map((line) => line.sale_id)); const salesById = byId(saleRows);
    for (const line of lines) {
      const sale = salesById.get(String(line.sale_id));
      if (line.textbook_id !== input.textbookId.toLowerCase() || (line.class_id || sale?.class_id) !== input.classId.toLowerCase() || getSaleLineMonth(line, sale) !== (data.input as Row).chargeMonth
        || line.copy_scope === "teacher" || !isBillableSaleLineStatus(getSaleLineStatus(line, sale))) v.fail();
    }
    const duplicateIds = [...new Set(lines.map((line) => text(line.student_id)).filter(Boolean))].sort(); sameIds(data.duplicateStudentIds, duplicateIds);
    if (data.duplicateCount !== (duplicateIds.length || lines.length)) v.fail();
    return data as ClassTextbookSaleContext;
  });
}
