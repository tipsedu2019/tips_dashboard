function text(value) {
  return String(value || "").trim();
}

function numberValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

export const TIPS_TEXTBOOK_SOURCE_NAME = "팁스서점";
export const TEXTBOOK_EXTERNAL_PURCHASE_RATE = 0.9;
export const TEXTBOOK_COPY_SCOPE_STUDENT = "student";
export const TEXTBOOK_COPY_SCOPE_TEACHER = "teacher";

function normalizeBusinessLabel(value) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

export function normalizeTextbookLookupValue(value, { compact = false } = {}) {
  const normalized = text(value).normalize("NFKC").toLowerCase();
  if (compact) {
    return normalized.replace(/[^\p{L}\p{N}]+/gu, "");
  }

  return normalized.replace(/\s+/g, " ");
}

function getTextbookReferenceAliases(textbook = {}) {
  return [
    getTextbookTitle(textbook),
    textbook.name,
    textbook.textbook_title,
    textbook.textbookTitle,
    textbook.isbn13,
    textbook.isbn,
    textbook.barcode,
  ];
}

export function getTextbookByExactReference(textbooks = [], reference = "") {
  const target = text(reference);
  if (!target) {
    return undefined;
  }

  const exactMatch = arrayValue(textbooks).find((textbook) => getRecordId(textbook) === target);
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedTarget = normalizeTextbookLookupValue(target);
  const normalizedMatch = arrayValue(textbooks).find((textbook) =>
    getTextbookReferenceAliases(textbook).some((alias) => normalizeTextbookLookupValue(alias) === normalizedTarget));

  return normalizedMatch;
}

export function getTextbookByReference(textbooks = [], reference = "") {
  const exactMatch = getTextbookByExactReference(textbooks, reference);
  if (exactMatch) {
    return exactMatch;
  }

  const compactTarget = normalizeTextbookLookupValue(reference, { compact: true });
  const candidates = arrayValue(textbooks).map((textbook) => ({
    textbook,
    aliases: getTextbookReferenceAliases(textbook),
  }));
  const compactMatch = candidates.find(({ aliases }) =>
    compactTarget && aliases.some((alias) => normalizeTextbookLookupValue(alias, { compact: true }) === compactTarget));
  return compactMatch?.textbook;
}

export function normalizeTextbookCopyScope(value) {
  const normalized = normalizeBusinessLabel(value);
  if (
    normalized === "teacher" ||
    normalized === "teachercopy" ||
    normalized === "teacheredition" ||
    normalized === "teacheruse" ||
    normalized === "교사용" ||
    normalized === "선생님용" ||
    normalized === "교사용교재"
  ) {
    return TEXTBOOK_COPY_SCOPE_TEACHER;
  }

  return TEXTBOOK_COPY_SCOPE_STUDENT;
}

export function getTextbookCopyScope(row = {}) {
  return normalizeTextbookCopyScope(
    row.copy_scope ||
      row.copyScope ||
      row.stock_scope ||
      row.stockScope ||
      row.issue_scope ||
      row.issueScope ||
      row.target_scope ||
      row.targetScope ||
      row.audience ||
      row.copy_type ||
      row.copyType,
  );
}

export function normalizeBarcodeValue(value) {
  return text(value).replace(/\D/g, "");
}

export function normalizeOptionalUuid(value) {
  const normalized = text(value);
  if (!normalized) {
    return null;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

export function getTextbookActionErrorMessage(error) {
  const code = text(error?.code);
  const message = text(error?.message);
  const details = text(error?.details);
  const hint = text(error?.hint);
  const combined = [message, details, hint].filter(Boolean).join(" ");
  const lowerCombined = combined.toLowerCase();
  const missingColumnMatch =
    combined.match(/could not find the '([^']+)' column of '([^']+)' in the schema cache/i) ||
    combined.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of\s+relation\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i) ||
    combined.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);

  if (
    code === "42703" ||
    code === "PGRST204" ||
    (lowerCombined.includes("could not find") && lowerCombined.includes("column")) ||
    (lowerCombined.includes("column") && lowerCombined.includes("does not exist"))
  ) {
    const column = text(missingColumnMatch?.[1]) || "unknown_column";
    const table = text(missingColumnMatch?.[2]);
    const schemaItem = table ? `${table}.${column}` : column;
    return `교재 관리 DB 스키마가 최신이 아닙니다. 누락 컬럼: ${schemaItem}. Supabase SQL 마이그레이션을 적용한 뒤 새로고침하세요.`;
  }

  if (
    code === "42P01" ||
    code === "PGRST205" ||
    lowerCombined.includes("could not find the table") ||
    lowerCombined.includes("relation") && lowerCombined.includes("does not exist")
  ) {
    return "교재 관리 DB 마이그레이션이 아직 적용되지 않았습니다. Supabase SQL 마이그레이션을 적용한 뒤 새로고침하세요.";
  }

  if (message) {
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "처리 중 오류가 발생했습니다.";
}

export function getTextbookTitle(row = {}) {
  return text(row.title || row.name || row.textbook_title || row.textbookTitle);
}

export function getTextbookSalePrice(row = {}) {
  return numberValue(row.sale_price || row.salePrice || row.price || row.list_price || row.listPrice);
}

function getTextbookPublisherLabel(row = {}) {
  return text(row.publisher || row.publisher_name || row.publisherName);
}

function getTextbookSupplierLabel(row = {}) {
  return text(
    row.supplier ||
      row.supplier_name ||
      row.supplierName ||
      row.supplier_label ||
      row.supplierLabel ||
      row.default_supplier ||
      row.defaultSupplier,
  );
}

export function isTipsTextbookSource(row = {}) {
  const tipsLabel = normalizeBusinessLabel(TIPS_TEXTBOOK_SOURCE_NAME);
  return [
    getTextbookPublisherLabel(row),
    getTextbookSupplierLabel(row),
  ].some((label) => normalizeBusinessLabel(label) === tipsLabel);
}

export function getTextbookPurchaseUnitCost(row = {}) {
  if (getTextbookCopyScope(row) === TEXTBOOK_COPY_SCOPE_TEACHER) {
    return 0;
  }

  const salePrice = getTextbookSalePrice(row);
  if (salePrice <= 0) {
    return 0;
  }

  return isTipsTextbookSource(row)
    ? 0
    : Math.round(salePrice * TEXTBOOK_EXTERNAL_PURCHASE_RATE);
}

export function getTextbookUnitMargin(row = {}) {
  const salePrice = getTextbookSalePrice(row);
  if (salePrice <= 0) {
    return 0;
  }

  return Math.max(0, salePrice - getTextbookPurchaseUnitCost(row));
}

export function getTextbookSubject(row = {}) {
  return text(row.subject);
}

export function getRecordId(row = {}) {
  return text(row.id);
}

export function listIds(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(text).filter(Boolean);
      }
    } catch {
      // Keep comma separated fallback below.
    }

    return trimmed.split(",").map(text).filter(Boolean);
  }

  return [];
}

function getMoveTextbookId(move = {}) {
  return text(move.textbook_id || move.textbookId);
}

function getMoveLocationId(move = {}) {
  return text(move.location_id || move.locationId || "unassigned");
}

function getMoveQuantity(move = {}) {
  return numberValue(move.quantity);
}

function getMoveAmount(move = {}) {
  const explicitAmount = numberValue(move.amount);
  if (explicitAmount) {
    return explicitAmount;
  }

  return numberValue(move.unit_amount || move.unitAmount) * getMoveQuantity(move);
}

export function buildTextbookInventorySnapshot({
  textbooks = [],
  locations = [],
  stockMoves = [],
} = {}) {
  const orderedLocations = arrayValue(locations)
    .map((location) => ({
      id: getRecordId(location) || text(location.code),
      code: text(location.code),
      name: text(location.name || location.code),
      sortOrder: numberValue(location.sort_order || location.sortOrder),
    }))
    .filter((location) => location.id)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko"));

  const movesByTextbook = new Map();
  for (const move of arrayValue(stockMoves)) {
    const textbookId = getMoveTextbookId(move);
    if (!textbookId) {
      continue;
    }
    const list = movesByTextbook.get(textbookId) || [];
    list.push(move);
    movesByTextbook.set(textbookId, list);
  }

  return arrayValue(textbooks)
    .map((textbook) => {
      const id = getRecordId(textbook);
      const moves = movesByTextbook.get(id) || [];
      const locationQuantities = Object.fromEntries(
        orderedLocations.map((location) => [location.id, 0]),
      );
      const studentLocationQuantities = Object.fromEntries(
        orderedLocations.map((location) => [location.id, 0]),
      );
      const teacherLocationQuantities = Object.fromEntries(
        orderedLocations.map((location) => [location.id, 0]),
      );
      let totalQuantity = 0;
      let studentQuantity = 0;
      let teacherQuantity = 0;
      let stockValue = 0;

      for (const move of moves) {
        const locationId = getMoveLocationId(move);
        const quantity = getMoveQuantity(move);
        const copyScope = getTextbookCopyScope(move);
        locationQuantities[locationId] = numberValue(locationQuantities[locationId]) + quantity;
        if (copyScope === TEXTBOOK_COPY_SCOPE_TEACHER) {
          teacherLocationQuantities[locationId] = numberValue(teacherLocationQuantities[locationId]) + quantity;
          teacherQuantity += quantity;
        } else {
          studentLocationQuantities[locationId] = numberValue(studentLocationQuantities[locationId]) + quantity;
          studentQuantity += quantity;
        }
        totalQuantity += quantity;
        stockValue += getMoveAmount(move);
      }

      return {
        ...textbook,
        id,
        title: getTextbookTitle(textbook),
        salePrice: getTextbookSalePrice(textbook),
        locationQuantities,
        studentLocationQuantities,
        teacherLocationQuantities,
        totalQuantity,
        studentQuantity,
        teacherQuantity,
        stockValue,
        locationSummary: orderedLocations
          .map((location) => ({
            ...location,
            quantity: numberValue(locationQuantities[location.id]),
          }))
          .filter((location) => location.quantity !== 0),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, "ko", { numeric: true }));
}

function getStudentRoster(classRecord = {}) {
  const directStudents = arrayValue(classRecord.registered_students || classRecord.registeredStudents);
  if (directStudents.length > 0) {
    return directStudents.map((student) => ({
      id: getRecordId(student),
      name: text(student.name),
    })).filter((student) => student.id);
  }

  return listIds(classRecord.student_ids || classRecord.studentIds).map((id) => ({ id, name: id }));
}

export function buildTextbookSaleDraft({
  classRecord = {},
  students = [],
  textbook = {},
  chargeMonth = "",
  excludedStudentIds = [],
  locationId = "",
  quantity = 1,
  availableQuantity = 0,
} = {}) {
  const classId = getRecordId(classRecord);
  const textbookId = getRecordId(textbook);
  const excluded = new Set(arrayValue(excludedStudentIds).map(text));
  const studentsById = new Map(arrayValue(students).map((student) => [getRecordId(student), student]));
  const unitPrice = getTextbookSalePrice(textbook);
  const safeQuantity = Math.max(1, numberValue(quantity) || 1);
  const roster = getStudentRoster(classRecord)
    .filter((student) => student.id && !excluded.has(student.id))
    .map((student) => ({
      ...student,
      name: text(studentsById.get(student.id)?.name) || student.name,
    }));

  const lines = roster.map((student) => ({
    student_id: student.id,
    class_id: classId,
    textbook_id: textbookId,
    charge_month: text(chargeMonth),
    quantity: safeQuantity,
    unit_price: unitPrice,
    location_id: text(locationId) || null,
    status: "charged",
    copy_scope: TEXTBOOK_COPY_SCOPE_STUDENT,
  }));

  return {
    sale: {
      class_id: classId,
      charge_month: text(chargeMonth),
      status: "draft",
    },
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + numberValue(line.quantity), 0),
    totalAmount: lines.reduce((sum, line) => sum + numberValue(line.quantity) * numberValue(line.unit_price), 0),
    availableQuantity: numberValue(availableQuantity),
    stockShortage: Math.max(0, lines.reduce((sum, line) => sum + numberValue(line.quantity), 0) - numberValue(availableQuantity)),
    hasStockShortage: lines.reduce((sum, line) => sum + numberValue(line.quantity), 0) > numberValue(availableQuantity),
  };
}

export function buildTeacherTextbookIssueDraft({
  textbook = {},
  teacherId = "",
  teacherName = "",
  chargeMonth = "",
  locationId = "",
  quantity = 1,
  availableQuantity = 0,
} = {}) {
  const textbookId = getRecordId(textbook);
  const safeQuantity = Math.max(1, numberValue(quantity) || 1);
  const unitPrice = 0;
  const resolvedTeacherName = text(teacherName);
  const line = {
    student_id: null,
    class_id: null,
    teacher_id: normalizeOptionalUuid(teacherId),
    teacher_name: resolvedTeacherName,
    textbook_id: textbookId,
    charge_month: text(chargeMonth),
    quantity: safeQuantity,
    unit_price: unitPrice,
    location_id: text(locationId) || null,
    status: "charged",
    copy_scope: TEXTBOOK_COPY_SCOPE_TEACHER,
  };

  return {
    sale: {
      class_id: null,
      charge_month: text(chargeMonth),
      status: "draft",
    },
    lines: [line],
    totalQuantity: safeQuantity,
    totalAmount: safeQuantity * unitPrice,
    availableQuantity: numberValue(availableQuantity),
    stockShortage: Math.max(0, safeQuantity - numberValue(availableQuantity)),
    hasStockShortage: safeQuantity > numberValue(availableQuantity),
  };
}

export function filterStockMovesForClosing({
  closingMonth = "",
  subject = "all",
  textbooks = [],
  publishers = [],
  suppliers = [],
  publisherSupplierLinks = [],
  stockMoves = [],
} = {}) {
  const month = text(closingMonth);
  const targetSubject = text(subject);
  const textbooksById = new Map(arrayValue(textbooks).map((textbook) => [getRecordId(textbook), textbook]));
  const publishersById = new Map(arrayValue(publishers).map((publisher) => [getRecordId(publisher), publisher]));
  const suppliersById = new Map(arrayValue(suppliers).map((supplier) => [getRecordId(supplier), supplier]));

  function getPublisherIdForTextbook(textbook = {}) {
    const directPublisherId = text(textbook.publisher_id || textbook.publisherId);
    if (directPublisherId) {
      return directPublisherId;
    }

    const publisherLabel = getTextbookPublisherLabel(textbook);
    if (!publisherLabel) {
      return "";
    }

    const normalizedPublisherLabel = normalizeBusinessLabel(publisherLabel);
    const publisher = arrayValue(publishers).find((row) =>
      normalizeBusinessLabel(row.name || row.publisher || row.publisher_name || row.publisherName) === normalizedPublisherLabel);
    return getRecordId(publisher || {});
  }

  function getConfiguredSupplierIdForTextbook(textbook = {}) {
    const directSupplierId = text(
      textbook.default_supplier_id ||
        textbook.defaultSupplierId ||
        textbook.supplier_id ||
        textbook.supplierId,
    );
    if (directSupplierId) {
      return directSupplierId;
    }

    const publisherId = getPublisherIdForTextbook(textbook);
    if (!publisherId) {
      return "";
    }

    const links = arrayValue(publisherSupplierLinks)
      .filter((link) => text(link.publisher_id || link.publisherId) === publisherId)
      .sort((left, right) => {
        const leftPrimary = left.is_primary === true || left.isPrimary === true ? 1 : 0;
        const rightPrimary = right.is_primary === true || right.isPrimary === true ? 1 : 0;
        if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
        return numberValue(left.priority) - numberValue(right.priority);
      });

    return text(links[0]?.supplier_id || links[0]?.supplierId);
  }

  function enrichMove(move = {}) {
    const textbook = textbooksById.get(getMoveTextbookId(move));
    if (!textbook) {
      return move;
    }

    const publisherId = getPublisherIdForTextbook(textbook);
    const publisher = publishersById.get(publisherId);
    const supplierId = getConfiguredSupplierIdForTextbook(textbook);
    const supplier = suppliersById.get(supplierId);
    const publisherName = getTextbookPublisherLabel(textbook) || text(publisher?.name);
    const supplierName = getTextbookSupplierLabel(textbook) || text(supplier?.name);

    return {
      ...move,
      textbook,
      subject: getTextbookSubject(textbook),
      textbook_subject: getTextbookSubject(textbook),
      publisher: publisherName,
      publisher_name: publisherName,
      supplier: supplierName,
      supplier_name: supplierName,
      sale_price: getTextbookSalePrice(textbook),
    };
  }

  return arrayValue(stockMoves).filter((move) => {
    const movedAt = text(move.moved_at || move.movedAt);
    if (month && !movedAt.startsWith(month)) {
      return false;
    }

    if (!targetSubject || targetSubject === "all") {
      return true;
    }

    const textbook = textbooksById.get(getMoveTextbookId(move));
    return getTextbookSubject(textbook) === targetSubject;
  }).map(enrichMove);
}

export function validateMonthlyClosingDraft(closing = {}, { memo = "" } = {}) {
  if (closing.needsReview && !text(memo)) {
    throw new Error("review memo required: 차이가 있으면 사유를 입력하세요.");
  }

  return closing;
}

export function buildPurchaseLifecycleDraft({
  stage = "receive",
  requestedQuantity = 0,
  orderedQuantity = 0,
  receivedQuantity = 0,
  statementNumber = "",
  copyScope = TEXTBOOK_COPY_SCOPE_STUDENT,
} = {}) {
  const normalizedStage = text(stage) || "receive";
  const requested = Math.max(0, numberValue(requestedQuantity));
  const ordered = normalizedStage === "request" ? 0 : Math.max(0, numberValue(orderedQuantity));
  const received = normalizedStage === "receive" ? Math.max(0, numberValue(receivedQuantity)) : 0;
  let status = "requested";

  if (normalizedStage === "order") {
    status = "ordered";
  }

  if (normalizedStage === "receive") {
    status = received > 0 && ordered > 0 && received < ordered ? "partially_received" : "received";
  }

  return {
    stage: normalizedStage,
    requestedQuantity: requested,
    orderedQuantity: ordered,
    receivedQuantity: received,
    statementNumber: text(statementNumber),
    copyScope: normalizeTextbookCopyScope(copyScope),
    status,
    createsStockMove: normalizedStage === "receive" && received > 0,
  };
}

export function validatePurchaseLifecycleDraft(draft = {}) {
  if (draft.requestedQuantity <= 0 && draft.orderedQuantity <= 0 && draft.receivedQuantity <= 0) {
    throw new Error("requested quantity required: 요청 수량을 입력하세요.");
  }

  if (draft.stage === "order" && draft.orderedQuantity <= 0) {
    throw new Error("ordered quantity required: 주문 수량을 입력하세요.");
  }

  if (draft.stage === "receive") {
    if (draft.receivedQuantity <= 0) {
      throw new Error("received quantity required: 입고 수량을 입력하세요.");
    }
    if (!text(draft.statementNumber)) {
      throw new Error("statement number required: 거래명세표 번호를 입력하세요.");
    }
  }

  return draft;
}

export function buildSaleLineStatusTransition({
  line = {},
  targetStatus = "",
} = {}) {
  const target = text(targetStatus);
  const quantity = Math.max(1, numberValue(line.quantity) || 1);
  const copyScope = getTextbookCopyScope(line);
  const recipientMemo = text(line.teacher_name || line.teacherName || line.student_name || line.studentName);

  if (target === "issued") {
    return {
      targetStatus: "issued",
      shouldCreateStockMove: true,
      stockMove: {
        textbook_id: text(line.textbook_id || line.textbookId),
        location_id: text(line.location_id || line.locationId) || null,
        sale_line_id: text(line.id) || null,
        move_type: "sale_issue",
        quantity: -quantity,
        unit_amount: numberValue(line.unit_price || line.unitPrice),
        amount: -quantity * numberValue(line.unit_price || line.unitPrice),
        memo: recipientMemo,
        copy_scope: copyScope,
      },
    };
  }

  if (target === "returned") {
    return {
      targetStatus: "returned",
      shouldCreateStockMove: true,
      stockMove: {
        textbook_id: text(line.textbook_id || line.textbookId),
        location_id: text(line.location_id || line.locationId) || null,
        sale_line_id: text(line.id) || null,
        move_type: "return_in",
        quantity,
        unit_amount: numberValue(line.unit_price || line.unitPrice),
        amount: quantity * numberValue(line.unit_price || line.unitPrice),
        memo: recipientMemo,
        copy_scope: copyScope,
      },
    };
  }

  throw new Error("unsupported sale status transition");
}

function resolvePurchaseLineStatus(line = {}, order = {}) {
  const explicitStatus = text(order.status || line.status);
  if (explicitStatus) {
    return explicitStatus;
  }

  const ordered = numberValue(line.ordered_quantity || line.orderedQuantity);
  const received = numberValue(line.received_quantity || line.receivedQuantity);
  if (received > 0 && ordered > 0 && received < ordered) {
    return "partially_received";
  }
  if (received > 0) {
    return "received";
  }
  if (ordered > 0) {
    return "ordered";
  }
  return "requested";
}

export function groupPurchaseLinesByStatus({
  orders = [],
  lines = [],
} = {}) {
  const ordersById = new Map(arrayValue(orders).map((order) => [getRecordId(order), order]));
  const groups = {
    requested: [],
    ordered: [],
    partially_received: [],
    received: [],
    cancelled: [],
    returned: [],
  };

  for (const line of arrayValue(lines)) {
    const order = ordersById.get(text(line.purchase_order_id || line.purchaseOrderId)) || {};
    const status = resolvePurchaseLineStatus(line, order);
    const key = Object.hasOwn(groups, status) ? status : "requested";
    groups[key].push({
      ...line,
      id: getRecordId(line),
      order,
      status,
    });
  }

  return groups;
}

export function groupSaleLinesByStatus({
  lines = [],
} = {}) {
  const groups = {
    charged: [],
    issued: [],
    cancelled: [],
    returned: [],
  };

  for (const line of arrayValue(lines)) {
    const rawStatus = text(line.status) || "charged";
    const status = rawStatus === "paid" ? "charged" : rawStatus;
    const key = Object.hasOwn(groups, status) ? status : "charged";
    groups[key].push({
      ...line,
      id: getRecordId(line),
      status,
    });
  }

  return groups;
}

function isPurchaseMove(move = {}) {
  return ["opening", "purchase_receipt", "return_in", "transfer_in"].includes(text(move.move_type || move.moveType));
}

function isSaleMove(move = {}) {
  return ["sale_issue", "return_out", "transfer_out"].includes(text(move.move_type || move.moveType));
}

function isAdjustmentMove(move = {}) {
  return text(move.move_type || move.moveType) === "stock_adjustment";
}

function isSaleIssueMove(move = {}) {
  return text(move.move_type || move.moveType) === "sale_issue";
}

function getMoveUnitSalePrice(move = {}) {
  const unitAmount = Math.abs(numberValue(move.unit_amount || move.unitAmount));
  if (unitAmount) {
    return unitAmount;
  }

  const quantity = Math.abs(getMoveQuantity(move));
  const amount = Math.abs(getMoveAmount(move));
  if (quantity > 0 && amount > 0) {
    return amount / quantity;
  }

  return getTextbookSalePrice(move);
}

function getClosingTeamKey(move = {}) {
  const subject = getTextbookSubject(move) || text(move.textbook_subject || move.textbookSubject);
  if (subject === "english" || subject === "math") {
    return subject;
  }

  return "other";
}

function createClosingTeamMargin(team) {
  return {
    team,
    saleQuantity: 0,
    saleAmount: 0,
    purchaseCostAmount: 0,
    marginAmount: 0,
  };
}

export function buildTextbookMonthlyClosing({
  openingQuantity = 0,
  openingAmount = 0,
  stockMoves = [],
  receivedAmount = 0,
  supplierPaymentAmount = 0,
} = {}) {
  const moves = arrayValue(stockMoves);
  const purchaseMoves = moves.filter(isPurchaseMove);
  const saleMoves = moves.filter(isSaleMove);
  const adjustmentMoves = moves.filter(isAdjustmentMove);
  const sumQuantity = (list) => list.reduce((sum, move) => sum + getMoveQuantity(move), 0);
  const sumAmount = (list) => list.reduce((sum, move) => sum + getMoveAmount(move), 0);
  const purchaseQuantity = sumQuantity(purchaseMoves);
  const purchaseAmount = sumAmount(purchaseMoves);
  const saleQuantity = Math.abs(sumQuantity(saleMoves));
  const saleAmount = Math.abs(sumAmount(saleMoves));
  const adjustmentQuantity = sumQuantity(adjustmentMoves);
  const adjustmentAmount = sumAmount(adjustmentMoves);
  const endingQuantity = numberValue(openingQuantity) + purchaseQuantity - saleQuantity + adjustmentQuantity;
  const endingAmount = numberValue(openingAmount) + purchaseAmount - saleAmount + adjustmentAmount;
  const teamMargins = {
    english: createClosingTeamMargin("english"),
    math: createClosingTeamMargin("math"),
    other: createClosingTeamMargin("other"),
  };

  for (const move of moves.filter(isSaleIssueMove)) {
    const quantity = Math.abs(getMoveQuantity(move));
    if (quantity <= 0) {
      continue;
    }

    const unitSalePrice = getMoveUnitSalePrice(move);
    const pricingContext = {
      ...move,
      sale_price: unitSalePrice || getTextbookSalePrice(move),
      price: unitSalePrice || getTextbookSalePrice(move),
    };
    const unitPurchaseCost = getTextbookPurchaseUnitCost(pricingContext);
    const saleLineAmount = unitSalePrice * quantity;
    const purchaseCostAmount = unitPurchaseCost * quantity;
    const marginAmount = Math.max(0, saleLineAmount - purchaseCostAmount);
    const teamKey = getClosingTeamKey(move);
    const teamMargin = teamMargins[teamKey] || teamMargins.other;

    teamMargin.saleQuantity += quantity;
    teamMargin.saleAmount += saleLineAmount;
    teamMargin.purchaseCostAmount += purchaseCostAmount;
    teamMargin.marginAmount += marginAmount;
  }

  const textbookMarginAmount = Object.values(teamMargins).reduce((sum, item) => sum + item.marginAmount, 0);
  const paymentDifference = numberValue(receivedAmount) - numberValue(supplierPaymentAmount);
  const settlementDifference = textbookMarginAmount + paymentDifference;

  return {
    openingQuantity: numberValue(openingQuantity),
    openingAmount: numberValue(openingAmount),
    purchaseQuantity,
    purchaseAmount,
    saleQuantity,
    saleAmount,
    adjustmentQuantity,
    adjustmentAmount,
    endingQuantity,
    endingAmount,
    receivedAmount: numberValue(receivedAmount),
    supplierPaymentAmount: numberValue(supplierPaymentAmount),
    paymentDifference,
    textbookMarginAmount,
    teamMargins: Object.values(teamMargins),
    settlementDifference,
    needsReview: paymentDifference !== 0 || endingQuantity < 0,
  };
}
