import { supabase as sharedSupabase, supabaseConfigError } from "@/lib/supabase";

import {
  buildPurchaseLifecycleDraft,
  buildSaleLineStatusTransition,
  buildTextbookInventorySnapshot,
  buildTextbookMonthlyClosing,
  buildTextbookSaleDraft,
  filterStockMovesForClosing,
  getRecordId,
  getTextbookSalePrice,
  listIds,
  normalizeBarcodeValue,
  normalizeOptionalUuid,
  validatePurchaseLifecycleDraft,
  validateMonthlyClosingDraft,
} from "./textbook-ledger.js";

type SupabaseClientLike = NonNullable<typeof sharedSupabase>;
type Row = Record<string, unknown>;
type TextbookOperationsDataScope = "management" | "request";
type TextbookOperationsDataOptions = {
  client?: SupabaseClientLike | null;
  scope?: TextbookOperationsDataScope;
};

const OPTIONAL_TABLES = new Set([
  "textbook_publishers",
  "textbook_suppliers",
  "textbook_supplier_links",
  "textbook_publisher_supplier_links",
  "textbook_sub_subject_settings",
  "textbook_inventory_locations",
  "textbook_purchase_orders",
  "textbook_purchase_order_lines",
  "textbook_stock_moves",
  "textbook_sales",
  "textbook_sale_lines",
  "textbook_stock_counts",
  "textbook_monthly_closings",
  "students",
  "classes",
  "teacher_catalogs",
]);

const TEXTBOOK_OPERATION_TABLES = [
  "textbook_publishers",
  "textbook_suppliers",
  "textbook_supplier_links",
  "textbook_publisher_supplier_links",
  "textbook_inventory_locations",
  "textbook_purchase_orders",
  "textbook_purchase_order_lines",
  "textbook_stock_moves",
  "textbook_sales",
  "textbook_sale_lines",
  "textbook_stock_counts",
  "textbook_monthly_closings",
];
const TEXTBOOK_OPERATION_SCHEMA_ITEMS = [
  ...TEXTBOOK_OPERATION_TABLES,
  "textbook_purchase_order_lines.requested_textbook_title",
];
const TEXTBOOK_PURCHASE_ORDER_LINE_SELECT = "*,requested_textbook_title";
const TEXTBOOK_MASTER_REFERENCE_TABLES = [
  { table: "textbook_stock_moves", column: "textbook_id" },
  { table: "textbook_purchase_order_lines", column: "textbook_id" },
  { table: "textbook_sale_lines", column: "textbook_id" },
  { table: "textbook_stock_counts", column: "textbook_id" },
];

function text(value: unknown) {
  return String(value || "").trim();
}

function numberValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isMissingTableError(error: unknown) {
  const code = text((error as { code?: string })?.code);
  const message = text((error as { message?: string })?.message).toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function isMissingColumnError(error: unknown) {
  const code = text((error as { code?: string })?.code);
  const message = text((error as { message?: string })?.message).toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (message.includes("could not find") && message.includes("column")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function getMissingColumnSchemaItem(table: string, columns: string, error: unknown) {
  const message = text((error as { message?: string })?.message);
  const quotedColumn = message.match(/'([^']+)'\s+column/i)?.[1];
  const postgresColumn = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i)?.[1];
  const fallbackColumn = columns
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column && column !== "*")[0];
  const column = quotedColumn || postgresColumn || fallbackColumn || "unknown_column";
  return `${table}.${column}`;
}

function ensureClient(client?: SupabaseClientLike | null) {
  const resolved = client || sharedSupabase;
  if (!resolved) {
    throw new Error(supabaseConfigError || "Supabase 연결 설정을 확인하세요.");
  }
  return resolved;
}

function resolveTextbookOperationsDataOptions(input?: SupabaseClientLike | TextbookOperationsDataOptions | null) {
  if (input && typeof input === "object" && ("scope" in input || "client" in input)) {
    return {
      client: ensureClient((input as TextbookOperationsDataOptions).client),
      scope: (input as TextbookOperationsDataOptions).scope || "management",
    };
  }

  return {
    client: ensureClient(input as SupabaseClientLike | null | undefined),
    scope: "management" as TextbookOperationsDataScope,
  };
}

async function readTable(client: SupabaseClientLike, table: string, columns = "*", missingTables?: string[]) {
  const { data, error } = await client.from(table).select(columns);
  if (error) {
    if (OPTIONAL_TABLES.has(table) && isMissingColumnError(error)) {
      missingTables?.push(getMissingColumnSchemaItem(table, columns, error));
      return [] as Row[];
    }
    if (OPTIONAL_TABLES.has(table) && isMissingTableError(error)) {
      missingTables?.push(table);
      return [] as Row[];
    }
    throw error;
  }
  return (data || []) as unknown as Row[];
}

async function collectReferencedTextbookIds(client: SupabaseClientLike, ids: string[]) {
  const referencedIds = new Set<string>();

  await Promise.all(
    TEXTBOOK_MASTER_REFERENCE_TABLES.map(async ({ table, column }) => {
      const { data, error } = await client
        .from(table)
        .select(column)
        .in(column, ids);

      if (error) {
        if (OPTIONAL_TABLES.has(table) && (isMissingTableError(error) || isMissingColumnError(error))) {
          return;
        }
        throw error;
      }

      for (const row of (data || []) as unknown as Row[]) {
        const referencedId = text(row[column]);
        if (referencedId) {
          referencedIds.add(referencedId);
        }
      }
    }),
  );

  return referencedIds;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getDefaultLocationId(locations: Row[]) {
  return text(locations.find((location) => text(location.code) === "main")?.id || locations[0]?.id);
}

function getClassStudents(classRecord: Row, students: Row[]) {
  const enrolledIds = listIds(classRecord.student_ids || classRecord.studentIds);
  const studentsById = new Map(students.map((student) => [getRecordId(student), student]));
  return enrolledIds.map((id) => studentsById.get(id) || { id, name: id });
}

function getInventoryQuantity(inventoryRow: Row | undefined, locationId: string) {
  const locationQuantities = (inventoryRow?.locationQuantities || {}) as Record<string, unknown>;
  if (!locationId) return numberValue(inventoryRow?.totalQuantity);
  return numberValue(locationQuantities[locationId]);
}

export async function listTextbookOperationsData(clientInput?: SupabaseClientLike | TextbookOperationsDataOptions | null) {
  const { client, scope } = resolveTextbookOperationsDataOptions(clientInput);
  const canLoadManagementTables = scope === "management";
  const missingTables: string[] = [];
  const [
    textbooks,
    publishers,
    suppliers,
    publisherSupplierLinks,
    locations,
    purchaseOrders,
    purchaseOrderLines,
    stockMoves,
    sales,
    saleLines,
    stockCounts,
    monthlyClosings,
    students,
    classes,
    teacherCatalogs,
  ] = await Promise.all([
    readTable(client, "textbooks", "*", missingTables),
    readTable(client, "textbook_publishers", "*", missingTables),
    canLoadManagementTables ? readTable(client, "textbook_suppliers", "*", missingTables) : Promise.resolve([] as Row[]),
    canLoadManagementTables ? readTable(client, "textbook_publisher_supplier_links", "*", missingTables) : Promise.resolve([] as Row[]),
    readTable(client, "textbook_inventory_locations", "*", missingTables),
    readTable(client, "textbook_purchase_orders", "*", missingTables),
    readTable(client, "textbook_purchase_order_lines", TEXTBOOK_PURCHASE_ORDER_LINE_SELECT, missingTables),
    canLoadManagementTables ? readTable(client, "textbook_stock_moves", "*", missingTables) : Promise.resolve([] as Row[]),
    canLoadManagementTables ? readTable(client, "textbook_sales", "*", missingTables) : Promise.resolve([] as Row[]),
    canLoadManagementTables ? readTable(client, "textbook_sale_lines", "*", missingTables) : Promise.resolve([] as Row[]),
    canLoadManagementTables ? readTable(client, "textbook_stock_counts", "*", missingTables) : Promise.resolve([] as Row[]),
    canLoadManagementTables ? readTable(client, "textbook_monthly_closings", "*", missingTables) : Promise.resolve([] as Row[]),
    canLoadManagementTables ? readTable(client, "students", "*", missingTables) : Promise.resolve([] as Row[]),
    readTable(client, "classes", "*", missingTables),
    readTable(client, "teacher_catalogs", "*", missingTables),
  ]);
  const missingOperationTables = [...new Set(missingTables)]
    .filter((table) => TEXTBOOK_OPERATION_SCHEMA_ITEMS.includes(table));
  const textbookSubSubjectSettings: Row[] = [];

  return {
    textbooks,
    publishers,
    suppliers,
    publisherSupplierLinks,
    textbookSubSubjectSettings,
    locations,
    purchaseOrders,
    purchaseOrderLines,
    stockMoves,
    sales,
    saleLines,
    stockCounts,
    monthlyClosings,
    students,
    classes,
    teacherCatalogs,
    inventory: buildTextbookInventorySnapshot({ textbooks, locations, stockMoves }),
    defaultLocationId: getDefaultLocationId(locations),
    currentMonth: getCurrentMonth(),
    missingTables: missingOperationTables,
    isSchemaReady: missingOperationTables.length === 0,
  };
}

export async function upsertTextbookMaster(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const title = text(record.title || record.name);
  if (!title) {
    throw new Error("교재명을 입력하세요.");
  }

  const payload = {
    id: text(record.id) || undefined,
    title,
    name: title,
    subject: text(record.subject),
    category: text(record.category),
    school_level: text(record.schoolLevel || record.school_level),
    grade_level: text(record.gradeLevel || record.grade_level),
    sub_subject: text(record.subSubject || record.sub_subject),
    publisher: text(record.publisher),
    isbn13: normalizeBarcodeValue(record.isbn13),
    barcode: normalizeBarcodeValue(record.barcode || record.isbn13),
    price: numberValue(record.price || record.sale_price || record.salePrice),
    list_price: numberValue(record.list_price || record.listPrice || record.price),
    sale_price: numberValue(record.sale_price || record.salePrice || record.price),
    status: text(record.status) || "active",
    is_returnable: record.is_returnable === true || record.isReturnable === true,
    source_notion_url: text(record.source_notion_url || record.sourceNotionUrl),
    updated_at: new Date().toISOString().slice(0, 10),
  };

  const { data, error } = await client.from("textbooks").upsert(payload).select().single();
  if (error) throw error;
  return data as Row;
}

export async function deleteTextbookMasters(idList: string[] | string, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const ids = (Array.isArray(idList) ? idList : [idList]).map(text).filter(Boolean);
  if (ids.length === 0) {
    return { ids: [], deletedIds: [], archivedIds: [] };
  }

  const referencedIds = await collectReferencedTextbookIds(client, ids);
  const deletedIds = ids.filter((id) => !referencedIds.has(id));
  const archivedIds = ids.filter((id) => referencedIds.has(id));

  if (archivedIds.length > 0) {
    const { error: archiveError } = await client
      .from("textbooks")
      .update({
        status: "inactive",
        updated_at: new Date().toISOString().slice(0, 10),
      })
      .in("id", archivedIds);
    if (archiveError) throw archiveError;
  }

  if (deletedIds.length > 0) {
    const { error } = await client.from("textbooks").delete().in("id", deletedIds);
    if (error) throw error;
  }

  return { ids, deletedIds, archivedIds };
}

export async function createPurchaseReceipt(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const textbookId = text(record.textbookId || record.textbook_id);
  const normalizedTextbookId = normalizeOptionalUuid(textbookId);
  const requestedTextbookTitle = text(record.requestedTextbookTitle || record.requested_textbook_title || record.textbookTitle || record.textbook_title);
  const locationId = normalizeOptionalUuid(record.locationId || record.location_id);
  const createdBy = normalizeOptionalUuid(record.createdBy || record.created_by);
  const unitCost = Math.max(0, numberValue(record.unitCost || record.unit_cost));
  const lifecycle = validatePurchaseLifecycleDraft(buildPurchaseLifecycleDraft({
    stage: text(record.stage || record.requestStage || record.request_stage) || "receive",
    requestedQuantity: numberValue(record.requestedQuantity || record.requested_quantity),
    orderedQuantity: numberValue(record.orderedQuantity || record.ordered_quantity),
    receivedQuantity: numberValue(record.receivedQuantity || record.received_quantity),
    statementNumber: text(record.statementNumber || record.statement_number),
  }));

  if (lifecycle.stage === "request" && !textbookId && !requestedTextbookTitle) {
    throw new Error("요청 교재명을 입력하세요.");
  }

  if (lifecycle.stage !== "request" && !normalizedTextbookId) {
    throw new Error("주문할 등록 교재를 선택하세요.");
  }

  const { data: order, error: orderError } = await client
    .from("textbook_purchase_orders")
    .insert({
      supplier_id: normalizeOptionalUuid(record.supplierId || record.supplier_id),
      requested_by: text(record.requestBy || record.request_by || record.requestedBy || record.requested_by),
      requested_date: text(record.requestDate || record.request_date) || new Date().toISOString().slice(0, 10),
      order_date: text(record.orderDate || record.order_date) || new Date().toISOString().slice(0, 10),
      ordered_at: lifecycle.stage === "order" || lifecycle.stage === "receive" ? new Date().toISOString() : null,
      received_at: lifecycle.stage === "receive" ? new Date().toISOString() : null,
      status: lifecycle.status,
      statement_number: lifecycle.statementNumber,
      memo: text(record.memo),
      created_by: createdBy,
    })
    .select()
    .single();
  if (orderError) throw orderError;

  const { data: line, error: lineError } = await client
    .from("textbook_purchase_order_lines")
    .insert({
      purchase_order_id: order.id,
      textbook_id: normalizedTextbookId,
      requested_textbook_title: requestedTextbookTitle,
      class_id: normalizeOptionalUuid(record.classId || record.class_id),
      location_id: locationId,
      requested_quantity: lifecycle.requestedQuantity,
      ordered_quantity: lifecycle.orderedQuantity,
      received_quantity: lifecycle.receivedQuantity,
      unit_cost: unitCost,
      memo: text(record.memo),
    })
    .select()
    .single();
  if (lineError) throw lineError;

  if (lifecycle.createsStockMove) {
    const { error: moveError } = await client.from("textbook_stock_moves").insert({
      textbook_id: normalizedTextbookId,
      location_id: locationId,
      purchase_order_line_id: line.id,
      move_type: "purchase_receipt",
      quantity: lifecycle.receivedQuantity,
      unit_amount: unitCost,
      amount: lifecycle.receivedQuantity * unitCost,
      memo: text(record.memo),
      created_by: createdBy,
    });
    if (moveError) throw moveError;
  }

  return { order: order as Row, line: line as Row };
}

export async function updatePurchaseLifecycle(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const purchaseOrderId = text(record.purchaseOrderId || record.purchase_order_id);
  const purchaseOrderLineId = text(record.purchaseOrderLineId || record.purchase_order_line_id || record.id);
  const textbookId = text(record.textbookId || record.textbook_id);
  const normalizedTextbookId = normalizeOptionalUuid(textbookId);
  const requestedTextbookTitle = text(record.requestedTextbookTitle || record.requested_textbook_title || record.textbookTitle || record.textbook_title);
  const locationId = normalizeOptionalUuid(record.locationId || record.location_id);
  const createdBy = normalizeOptionalUuid(record.createdBy || record.created_by);
  const unitCost = Math.max(0, numberValue(record.unitCost || record.unit_cost));
  const lifecycle = validatePurchaseLifecycleDraft(buildPurchaseLifecycleDraft({
    stage: text(record.stage || record.requestStage || record.request_stage) || "receive",
    requestedQuantity: numberValue(record.requestedQuantity || record.requested_quantity),
    orderedQuantity: numberValue(record.orderedQuantity || record.ordered_quantity),
    receivedQuantity: numberValue(record.receivedQuantity || record.received_quantity),
    statementNumber: text(record.statementNumber || record.statement_number),
  }));

  if (!purchaseOrderId || !purchaseOrderLineId) {
    throw new Error("기존 요청 건과 교재를 확인하세요.");
  }

  if (lifecycle.stage === "request" && !textbookId && !requestedTextbookTitle) {
    throw new Error("요청 교재명을 입력하세요.");
  }

  if (lifecycle.stage !== "request" && !normalizedTextbookId) {
    throw new Error("주문할 등록 교재를 선택하세요.");
  }

  const now = new Date().toISOString();
  const { data: order, error: orderError } = await client
    .from("textbook_purchase_orders")
    .update({
      supplier_id: normalizeOptionalUuid(record.supplierId || record.supplier_id),
      requested_by: text(record.requestBy || record.request_by || record.requestedBy || record.requested_by),
      order_date: text(record.orderDate || record.order_date) || new Date().toISOString().slice(0, 10),
      ordered_at: lifecycle.stage === "order" || lifecycle.stage === "receive" ? now : null,
      received_at: lifecycle.stage === "receive" ? now : null,
      status: lifecycle.status,
      statement_number: lifecycle.statementNumber,
      memo: text(record.memo),
    })
    .eq("id", purchaseOrderId)
    .select()
    .single();
  if (orderError) throw orderError;

  const { data: line, error: lineError } = await client
    .from("textbook_purchase_order_lines")
    .update({
      textbook_id: normalizedTextbookId,
      requested_textbook_title: requestedTextbookTitle,
      class_id: normalizeOptionalUuid(record.classId || record.class_id),
      location_id: locationId,
      requested_quantity: lifecycle.requestedQuantity,
      ordered_quantity: lifecycle.orderedQuantity,
      received_quantity: lifecycle.receivedQuantity,
      unit_cost: unitCost,
      memo: text(record.memo),
    })
    .eq("id", purchaseOrderLineId)
    .select()
    .single();
  if (lineError) throw lineError;

  const { data: existingMoves, error: existingMoveError } = await client
    .from("textbook_stock_moves")
    .select("*")
    .eq("purchase_order_line_id", purchaseOrderLineId)
    .eq("move_type", "purchase_receipt");
  if (existingMoveError) throw existingMoveError;

  if (!lifecycle.createsStockMove) {
    if ((existingMoves || []).length > 0) {
      const { error: deleteMoveError } = await client
        .from("textbook_stock_moves")
        .delete()
        .eq("purchase_order_line_id", purchaseOrderLineId)
        .eq("move_type", "purchase_receipt");
      if (deleteMoveError) throw deleteMoveError;
    }
  } else {
    const stockMove = {
      textbook_id: normalizedTextbookId,
      location_id: locationId,
      purchase_order_line_id: purchaseOrderLineId,
      move_type: "purchase_receipt",
      quantity: lifecycle.receivedQuantity,
      unit_amount: unitCost,
      amount: lifecycle.receivedQuantity * unitCost,
      memo: text(record.memo),
      created_by: createdBy,
    };
    const existingMove = ((existingMoves || []) as Row[])[0];

    if (existingMove) {
      const { error: updateMoveError } = await client
        .from("textbook_stock_moves")
        .update(stockMove)
        .eq("id", existingMove.id);
      if (updateMoveError) throw updateMoveError;
    } else {
      const { error: insertMoveError } = await client.from("textbook_stock_moves").insert(stockMove);
      if (insertMoveError) throw insertMoveError;
    }
  }

  return { order: order as Row, line: line as Row };
}

export async function deletePurchaseLifecycle(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const purchaseOrderId = text(record.purchaseOrderId || record.purchase_order_id);
  const purchaseOrderLineId = text(record.purchaseOrderLineId || record.purchase_order_line_id || record.id);

  if (!purchaseOrderLineId) {
    throw new Error("삭제할 요청 건을 확인하세요.");
  }

  const { error: moveError } = await client
    .from("textbook_stock_moves")
    .delete()
    .eq("purchase_order_line_id", purchaseOrderLineId);
  if (moveError) throw moveError;

  const { error: lineError } = await client
    .from("textbook_purchase_order_lines")
    .delete()
    .eq("id", purchaseOrderLineId);
  if (lineError) throw lineError;

  if (purchaseOrderId) {
    const { data: remainingLines, error: remainingError } = await client
      .from("textbook_purchase_order_lines")
      .select("id")
      .eq("purchase_order_id", purchaseOrderId);
    if (remainingError) throw remainingError;

    if ((remainingLines || []).length === 0) {
      const { error: orderError } = await client
        .from("textbook_purchase_orders")
        .delete()
        .eq("id", purchaseOrderId);
      if (orderError) throw orderError;
    }
  }

  return { purchaseOrderId, purchaseOrderLineId };
}

export async function returnPurchaseLifecycle(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const purchaseOrderId = text(record.purchaseOrderId || record.purchase_order_id);
  const purchaseOrderLineId = text(record.purchaseOrderLineId || record.purchase_order_line_id || record.id);
  const createdBy = normalizeOptionalUuid(record.createdBy || record.created_by);

  if (!purchaseOrderLineId) {
    throw new Error("반품할 입고 건을 확인하세요.");
  }

  const { data: line, error: lineError } = await client
    .from("textbook_purchase_order_lines")
    .select("*")
    .eq("id", purchaseOrderLineId)
    .single();
  if (lineError) throw lineError;

  const receivedQuantity = Math.max(0, numberValue((line as Row).received_quantity || (line as Row).receivedQuantity));
  const textbookId = normalizeOptionalUuid((line as Row).textbook_id || (line as Row).textbookId);
  const locationId = normalizeOptionalUuid((line as Row).location_id || (line as Row).locationId);
  const unitCost = Math.max(0, numberValue((line as Row).unit_cost || (line as Row).unitCost));

  if (!textbookId || receivedQuantity <= 0) {
    return deletePurchaseLifecycle({ purchaseOrderId, purchaseOrderLineId }, client);
  }

  const { data: existingMoves, error: existingMoveError } = await client
    .from("textbook_stock_moves")
    .select("*")
    .eq("purchase_order_line_id", purchaseOrderLineId)
    .eq("move_type", "return_out");
  if (existingMoveError) throw existingMoveError;

  const stockMove = {
    textbook_id: textbookId,
    location_id: locationId,
    purchase_order_line_id: purchaseOrderLineId,
    move_type: "return_out",
    quantity: -receivedQuantity,
    unit_amount: unitCost,
    amount: -receivedQuantity * unitCost,
    memo: text(record.memo) || "공급처 반품",
    created_by: createdBy,
  };
  const existingMove = ((existingMoves || []) as Row[])[0];

  if (existingMove) {
    const { error: updateMoveError } = await client
      .from("textbook_stock_moves")
      .update(stockMove)
      .eq("id", existingMove.id);
    if (updateMoveError) throw updateMoveError;
  } else {
    const { error: insertMoveError } = await client.from("textbook_stock_moves").insert(stockMove);
    if (insertMoveError) throw insertMoveError;
  }

  if (purchaseOrderId) {
    const { error: orderError } = await client
      .from("textbook_purchase_orders")
      .update({
        status: "returned",
        memo: text(record.memo) || "공급처 반품",
      })
      .eq("id", purchaseOrderId);
    if (orderError) throw orderError;
  }

  return { purchaseOrderId, purchaseOrderLineId };
}

export async function createClassTextbookSale(record: Row, data: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const classes = (data.classes || []) as Row[];
  const students = (data.students || []) as Row[];
  const textbooks = (data.textbooks || []) as Row[];
  const inventory = (data.inventory || []) as Row[];
  const createdBy = normalizeOptionalUuid(record.createdBy || record.created_by);
  const classRecord = classes.find((item) => getRecordId(item) === text(record.classId || record.class_id));
  const textbook = textbooks.find((item) => getRecordId(item) === text(record.textbookId || record.textbook_id));
  const locationId = normalizeOptionalUuid(record.locationId || record.location_id || data.defaultLocationId);
  const inventoryRow = inventory.find((item) => getRecordId(item) === getRecordId(textbook || {}));
  const availableQuantity = getInventoryQuantity(inventoryRow, locationId || "");

  if (!classRecord || !textbook) {
    throw new Error("수업과 교재를 선택하세요.");
  }

  const classStudents = getClassStudents(classRecord, students);
  const draft = buildTextbookSaleDraft({
    classRecord,
    students: classStudents,
    textbook,
    chargeMonth: text(record.chargeMonth || record.charge_month) || getCurrentMonth(),
    excludedStudentIds: Array.isArray(record.excludedStudentIds) ? record.excludedStudentIds : [],
    locationId: locationId || "",
    availableQuantity,
  });

  if (draft.lines.length === 0) {
    throw new Error("출고할 학생이 없습니다.");
  }
  const saleStatus = "charged";

  const { data: sale, error: saleError } = await client
    .from("textbook_sales")
    .insert({
      class_id: draft.sale.class_id || null,
      charge_month: draft.sale.charge_month,
      status: saleStatus,
      memo: text(record.memo),
      created_by: createdBy,
    })
    .select()
    .single();
  if (saleError) throw saleError;

  const linePayload = draft.lines.map((line) => ({
    sale_id: sale.id,
    ...line,
    status: saleStatus,
  }));
  const { data: lines, error: linesError } = await client
    .from("textbook_sale_lines")
    .insert(linePayload)
    .select();
  if (linesError) throw linesError;

  return { sale: sale as Row, lines: (lines || []) as Row[], draft };
}

export async function updateSaleLineStatus(record: Row, data: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const saleLineId = text(record.saleLineId || record.sale_line_id || record.id);
  const targetStatus = text(record.status || record.targetStatus || record.target_status);
  const createdBy = normalizeOptionalUuid(record.createdBy || record.created_by);
  const saleLines = (data.saleLines || []) as Row[];
  const inventory = (data.inventory || []) as Row[];
  const line = saleLines.find((item) => getRecordId(item) === saleLineId);

  if (!line || !targetStatus) {
    throw new Error("출고 라인과 상태를 확인하세요.");
  }

  if (targetStatus !== "issued" && targetStatus !== "returned") {
    throw new Error("지원하지 않는 출고 상태입니다.");
  }

  const locationId = normalizeOptionalUuid(line.location_id || line.locationId || data.defaultLocationId);
  const inventoryRow = inventory.find((item) => getRecordId(item) === text(line.textbook_id || line.textbookId));
  const transition = buildSaleLineStatusTransition({
    line,
    targetStatus,
    availableQuantity: getInventoryQuantity(inventoryRow, locationId || ""),
  });

  if (transition.shouldCreateStockMove && transition.stockMove) {
    const moveType = text(transition.stockMove.move_type || transition.stockMove.moveType);
    const { data: existingMoves, error: existingMoveError } = await client
      .from("textbook_stock_moves")
      .select("*")
      .eq("sale_line_id", saleLineId)
      .eq("move_type", moveType);
    if (existingMoveError) throw existingMoveError;

    const existingMove = ((existingMoves || []) as Row[])[0];
    const stockMove = {
      ...transition.stockMove,
      created_by: createdBy,
    };
    if (existingMove) {
      const { error: moveError } = await client
        .from("textbook_stock_moves")
        .update(stockMove)
        .eq("id", existingMove.id);
      if (moveError) throw moveError;
    } else {
      const { error: moveError } = await client.from("textbook_stock_moves").insert(stockMove);
      if (moveError) throw moveError;
    }
  }

  const { data: updated, error } = await client
    .from("textbook_sale_lines")
    .update({ status: transition.targetStatus })
    .eq("id", saleLineId)
    .select()
    .single();
  if (error) throw error;

  return updated as Row;
}

export async function deleteSaleLineLifecycle(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const saleLineId = text(record.saleLineId || record.sale_line_id || record.id);
  const saleId = text(record.saleId || record.sale_id);

  if (!saleLineId) {
    throw new Error("취소할 출고 건을 확인하세요.");
  }

  const { error: moveError } = await client
    .from("textbook_stock_moves")
    .delete()
    .eq("sale_line_id", saleLineId);
  if (moveError) throw moveError;

  const { data: deletedLines, error: lineError } = await client
    .from("textbook_sale_lines")
    .delete()
    .eq("id", saleLineId)
    .select("sale_id");
  if (lineError) throw lineError;

  const resolvedSaleId = saleId || text(((deletedLines || []) as Row[])[0]?.sale_id);
  if (resolvedSaleId) {
    const { data: remainingLines, error: remainingError } = await client
      .from("textbook_sale_lines")
      .select("id")
      .eq("sale_id", resolvedSaleId);
    if (remainingError) throw remainingError;

    if ((remainingLines || []).length === 0) {
      const { error: saleError } = await client
        .from("textbook_sales")
        .delete()
        .eq("id", resolvedSaleId);
      if (saleError) throw saleError;
    }
  }

  return { saleId: resolvedSaleId, saleLineId };
}

export async function createStockCountAdjustment(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const expectedQuantity = numberValue(record.expectedQuantity || record.expected_quantity);
  const countedQuantity = numberValue(record.countedQuantity || record.counted_quantity);
  const difference = countedQuantity - expectedQuantity;
  const textbookId = text(record.textbookId || record.textbook_id);
  const locationId = normalizeOptionalUuid(record.locationId || record.location_id);
  const createdBy = normalizeOptionalUuid(record.createdBy || record.created_by);

  if (!textbookId) {
    throw new Error("교재와 위치를 선택하세요.");
  }

  const { data: count, error: countError } = await client
    .from("textbook_stock_counts")
    .insert({
      counted_at: text(record.countedAt || record.counted_at) || new Date().toISOString().slice(0, 10),
      textbook_id: textbookId,
      location_id: locationId,
      expected_quantity: expectedQuantity,
      counted_quantity: countedQuantity,
      memo: text(record.memo),
      created_by: createdBy,
    })
    .select()
    .single();
  if (countError) throw countError;

  if (difference !== 0) {
    const { data: move, error: moveError } = await client
      .from("textbook_stock_moves")
      .insert({
        textbook_id: textbookId,
        location_id: locationId,
        move_type: "stock_adjustment",
        quantity: difference,
        unit_amount: getTextbookSalePrice(record),
        amount: difference * getTextbookSalePrice(record),
        memo: text(record.memo),
        created_by: createdBy,
      })
      .select()
      .single();
    if (moveError) throw moveError;

    await client
      .from("textbook_stock_counts")
      .update({ adjustment_move_id: move.id })
      .eq("id", count.id);
  }

  return count as Row;
}

export async function upsertMonthlyClosing(record: Row, data: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const closingMonth = text(record.closingMonth || record.closing_month) || getCurrentMonth();
  const subject = text(record.subject) || "all";
  const stockMoves = filterStockMovesForClosing({
    closingMonth,
    subject,
    textbooks: (data.textbooks || []) as Row[],
    stockMoves: (data.stockMoves || []) as Row[],
  });
  const closing = buildTextbookMonthlyClosing({
    openingQuantity: numberValue(record.openingQuantity || record.opening_quantity),
    openingAmount: numberValue(record.openingAmount || record.opening_amount),
    stockMoves,
    receivedAmount: numberValue(record.receivedAmount || record.received_amount),
    supplierPaymentAmount: numberValue(record.supplierPaymentAmount || record.supplier_payment_amount),
  });
  validateMonthlyClosingDraft(closing, { memo: text(record.memo) });

  const payload = {
    closing_month: closingMonth,
    subject,
    opening_quantity: closing.openingQuantity,
    opening_amount: closing.openingAmount,
    purchase_quantity: closing.purchaseQuantity,
    purchase_amount: closing.purchaseAmount,
    sale_quantity: closing.saleQuantity,
    sale_amount: closing.saleAmount,
    adjustment_quantity: closing.adjustmentQuantity,
    adjustment_amount: closing.adjustmentAmount,
    ending_quantity: closing.endingQuantity,
    ending_amount: closing.endingAmount,
    received_amount: closing.receivedAmount,
    supplier_payment_amount: closing.supplierPaymentAmount,
    settlement_difference: closing.settlementDifference,
    status: record.lock === true ? "locked" : "draft",
    memo: text(record.memo),
  };

  const { data: saved, error } = await client
    .from("textbook_monthly_closings")
    .upsert(payload, { onConflict: "closing_month,subject" })
    .select()
    .single();
  if (error) throw error;
  return { closing, saved: saved as Row };
}

export async function updateMonthlyClosingStatus(record: Row, clientInput?: SupabaseClientLike | null) {
  const client = ensureClient(clientInput);
  const ids = Array.isArray(record.ids)
    ? record.ids.map(text).filter(Boolean)
    : [text(record.id || record.monthlyClosingId || record.monthly_closing_id)].filter(Boolean);
  const status = text(record.status) || "locked";

  if (ids.length === 0) {
    throw new Error("정산 항목을 선택하세요.");
  }

  const { data: updated, error } = await client
    .from("textbook_monthly_closings")
    .update({ status })
    .in("id", ids)
    .select();
  if (error) throw error;
  return (updated || []) as Row[];
}

export const textbookService = {
  listTextbookOperationsData,
  upsertTextbookMaster,
  deleteTextbookMasters,
  createPurchaseReceipt,
  updatePurchaseLifecycle,
  deletePurchaseLifecycle,
  returnPurchaseLifecycle,
  createClassTextbookSale,
  updateSaleLineStatus,
  deleteSaleLineLifecycle,
  createStockCountAdjustment,
  upsertMonthlyClosing,
  updateMonthlyClosingStatus,
};
