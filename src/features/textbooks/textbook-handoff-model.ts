import type { Row, TextbookCopyScope } from "./textbook-read-types";
import { getRecordId, getTextbookCopyScope, getTextbookPurchaseUnitCost, getTextbookSalePrice, getTextbookTitle } from "./textbook-ledger.js";
import { text, numberValue, formatQuantity, currentMonth, getSubjectLabel, getPublisherLabel, getClassName, getLocationName, normalizeTextbookLookup, getTextbookById, getPurchaseTextbookTitle, getPurchaseLineOrder, getClassById, buildPurchaseCardDraft } from "./textbook-read-model";

export type TextbookHandoffLine = {
  id: string;
  title: string;
  detail: string;
  note: string;
  quantityLabel: string;
  amountLabel: string;
  locationLabel?: string;
  locationQuantities?: TextbookHandoffLocationQuantity[];
  publisherLabel?: string;
  studentQuantityLabel?: string;
  teacherQuantityLabel?: string;
  unitCostLabel?: string;
};

type TextbookHandoffLocationQuantity = {
  locationLabel: string;
  studentQuantityLabel: string;
  teacherQuantityLabel: string;
};

type PurchaseSupplierHandoffLineAccumulator = {
  id: string;
  title: string;
  publisherLabel: string;
  classLabels: string[];
  locationLabels: string[];
  locationScopeQuantities: Map<string, Record<TextbookCopyScope, number>>;
  requesterLabels: string[];
  statusLabels: string[];
  scopeQuantities: Record<TextbookCopyScope, number>;
  unitCostLabels: string[];
  remainingQuantity: number;
  totalQuantity: number;
  totalAmount: number;
};

export type TextbookHandoffGroup = {
  id: string;
  title: string;
  subtitle: string;
  summary: string[];
  message: string;
  lines: TextbookHandoffLine[];
  totalQuantity: number;
  totalAmount: number;
};

type PurchaseSupplierHandoffGroupDraft = TextbookHandoffGroup & {
  lineAccumulators: Map<string, PurchaseSupplierHandoffLineAccumulator>;
};

export const saleStatusLabels: Record<string, string> = {
  charged: "출고 대기",
  issued: "출고 완료",
  cancelled: "취소",
  returned: "반품",
};

export function getKnownPublisherLabel(row: Row) {
  const publisherLabel = getPublisherLabel(row);
  return publisherLabel === "미분류" ? "" : publisherLabel;
}

export function normalizeMonthInput(value: unknown, fallback = currentMonth()) {
  const month = text(value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : fallback;
}

export function getSaleLineQuantity(line: Row) {
  return Math.max(1, numberValue(line.quantity) || 1);
}

function getSaleLineUnitPrice(line: Row, textbook: Row | undefined) {
  return numberValue(line.unit_price || line.unitPrice) || getTextbookSalePrice(textbook || {});
}

export function getSaleLineAmount(line: Row, textbook: Row | undefined) {
  return getSaleLineUnitPrice(line, textbook) * getSaleLineQuantity(line);
}

export function getSaleLineMonth(line: Row, sale: Row | undefined) {
  return normalizeMonthInput(line.charge_month || line.chargeMonth || sale?.charge_month || sale?.chargeMonth);
}

export function getSaleLineStatus(line: Row, sale: Row | undefined) {
  const rawStatus = text(line.status || sale?.status) || "charged";
  return rawStatus === "paid" ? "charged" : rawStatus;
}

export function isBillableSaleLineStatus(status: string) {
  return status !== "cancelled" && status !== "returned" && status !== "excluded";
}

export function formatCurrency(value: unknown) {
  const amount = numberValue(value);
  if (!amount) return "-";
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

export const TEXTBOOK_HANDOFF_BUSINESS_NAME = "TIPS 영어수학학원";

function formatKoreanDocumentDate(value: Date | string | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatKoreanDocumentDate();
  }
  return `${date.getFullYear()}년 ${formatQuantity(date.getMonth() + 1)}월 ${formatQuantity(date.getDate())}일`;
}

export function getTextbookHandoffDocumentMeta(format: "default" | "purchase-order" | "purchase-return") {
  if (format === "purchase-return") {
    return {
      documentTitle: "반품 요청서",
      contentLabel: "교재 반품 요청",
      documentDate: formatKoreanDocumentDate(),
      businessName: TEXTBOOK_HANDOFF_BUSINESS_NAME,
    };
  }

  if (format === "purchase-order") {
    return {
      documentTitle: "주문서",
      contentLabel: "교재 주문 요청",
      documentDate: formatKoreanDocumentDate(),
      businessName: TEXTBOOK_HANDOFF_BUSINESS_NAME,
    };
  }

  return {
    documentTitle: "전달서",
    contentLabel: "교재 업무 전달",
    documentDate: formatKoreanDocumentDate(),
    businessName: TEXTBOOK_HANDOFF_BUSINESS_NAME,
  };
}

export function formatPurchaseUnitCost(value: unknown, textbook: Row | undefined) {
  const amount = numberValue(value);
  if (amount > 0) {
    return formatCurrency(amount);
  }

  return getTextbookSalePrice(textbook || {}) > 0 ? "0원" : "-";
}

export function getStudentGradeLabel(row: Row | undefined) {
  return text(row?.grade || row?.grade_label || row?.gradeLabel || row?.school_grade || row?.schoolGrade) || "-";
}

export function getSupplierName(suppliers: Row[], id: string) {
  const match = suppliers.find((supplier) => getRecordId(supplier) === id || text(supplier.name) === id);
  return text(match?.name || id);
}

function getSupplierById(suppliers: Row[], id: string) {
  return suppliers.find((supplier) => getRecordId(supplier) === id || text(supplier.name) === id);
}

function getSupplierContact(supplier: Row | undefined) {
  return text(
    supplier?.contact ||
      supplier?.contact_name ||
      supplier?.contactName ||
      supplier?.manager ||
      supplier?.manager_name ||
      supplier?.managerName ||
      supplier?.phone ||
      supplier?.mobile,
  );
}

function getPublisherIdForTextbook(textbook: Row | undefined, publishers: Row[] = []) {
  if (!textbook) return "";
  const directPublisherId = text(textbook.publisher_id || textbook.publisherId);
  if (directPublisherId) return directPublisherId;

  const publisherLabel = getKnownPublisherLabel(textbook);
  if (!publisherLabel) return "";

  const normalizedPublisherLabel = normalizeTextbookLookup(publisherLabel);
  const publisher = publishers.find((row) => normalizeTextbookLookup(row.name || row.publisher || row.publisher_name || row.publisherName) === normalizedPublisherLabel);
  return text(getRecordId(publisher || {}));
}

export function getConfiguredSupplierIdForTextbook(textbook: Row | undefined, publisherSupplierLinks: Row[], publishers: Row[] = []) {
  if (!textbook) return "";
  const directSupplierId = text(
    textbook.default_supplier_id ||
      textbook.defaultSupplierId ||
      textbook.supplier_id ||
      textbook.supplierId,
  );
  if (directSupplierId) return directSupplierId;

  const publisherId = getPublisherIdForTextbook(textbook, publishers);
  if (!publisherId) return "";

  const links = publisherSupplierLinks
    .filter((link) => text(link.publisher_id || link.publisherId) === publisherId)
    .sort((left, right) => {
      const leftPrimary = left.is_primary === true || left.isPrimary === true ? 1 : 0;
      const rightPrimary = right.is_primary === true || right.isPrimary === true ? 1 : 0;
      if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
      return numberValue(left.priority) - numberValue(right.priority);
    });

  return text(links[0]?.supplier_id || links[0]?.supplierId);
}

function getTextbookPurchasePricingContext(textbook: Row | undefined, supplierId: string, suppliers: Row[], copyScope: unknown = "student") {
  const supplierName = supplierId ? getSupplierName(suppliers, supplierId) : "";
  const publisherName = getKnownPublisherLabel(textbook || {});
  return {
    ...(textbook || {}),
    ...(publisherName ? { publisher: publisherName, publisher_name: publisherName } : {}),
    ...(supplierName ? { supplier: supplierName, supplier_name: supplierName } : {}),
    copy_scope: getTextbookCopyScope({ copyScope }),
  };
}

export function getConfiguredTextbookPurchaseUnitCost(
  textbook: Row | undefined,
  supplierId: string,
  suppliers: Row[],
  fallback: unknown = 0,
  copyScope: unknown = "student",
) {
  if (getTextbookCopyScope({ copyScope }) === "teacher") {
    return 0;
  }

  if (getTextbookSalePrice(textbook || {}) <= 0) {
    return Math.max(0, numberValue(fallback));
  }

  return getTextbookPurchaseUnitCost(getTextbookPurchasePricingContext(textbook, supplierId, suppliers, copyScope));
}

export function getStudentNameById(studentsById: Map<string, Row>, id: string) {
  const student = studentsById.get(id);
  return text(student?.name || student?.student_name || student?.studentName || id) || "-";
}

export function getSaleLineRecipientName(line: Row, studentsById: Map<string, Row>) {
  if (getTextbookCopyScope(line) === "teacher") {
    return text(line.teacher_name || line.teacherName) || "선생님 미지정";
  }

  const studentId = text(line.student_id || line.studentId);
  return text(line.student_name || getStudentNameById(studentsById, studentId)) || "-";
}

export function purchaseStatusLabel(status: unknown, orderedQuantity: unknown, receivedQuantity: unknown) {
  const rawStatus = text(status);
  if (rawStatus === "requested") return "요청";
  if (rawStatus === "cancelled") return "취소";
  if (rawStatus === "returned") return "반품";
  const ordered = numberValue(orderedQuantity);
  const received = numberValue(receivedQuantity);
  if (received <= 0) return "주문";
  if (received < ordered) return "부분 입고";
  return "입고 완료";
}

function buildPurchaseSupplierMessage(group: TextbookHandoffGroup) {
  const documentMeta = getTextbookHandoffDocumentMeta("purchase-order");
  return [
    `[공급처 주문 전달] ${group.title} ${documentMeta.documentTitle}`,
    `문서일자: ${documentMeta.documentDate}`,
    "내용: 교재 주문 요청",
    `발신: ${TEXTBOOK_HANDOFF_BUSINESS_NAME}`,
    group.subtitle ? `담당: ${group.subtitle}` : "",
    `총 주문금액: ${formatCurrency(group.totalAmount)}`,
    `요약: ${group.summary.join(" / ")}`,
    "",
    ...group.lines.map((line, index) =>
      [
        `${index + 1}. 위치: ${line.locationLabel || "-"}`,
        `교재: ${line.title}`,
        `출판사: ${line.publisherLabel || "-"}`,
        `학생용: ${line.studentQuantityLabel || "0권"}`,
        `교사용: ${line.teacherQuantityLabel || "0권"}`,
        `매입단가: ${line.unitCostLabel || "-"}`,
        `주문금액: ${line.amountLabel}`,
        line.note ? `비고: ${line.note}` : "",
      ].filter(Boolean).join(" | "),
    ),
    "",
    "위치별 수량 확인 후 전달 부탁드립니다.",
  ].filter((line) => line !== "").join("\n");
}

function buildPurchaseSupplierReturnMessage(group: TextbookHandoffGroup) {
  const documentMeta = getTextbookHandoffDocumentMeta("purchase-return");
  return [
    `[공급처 반품 요청서] ${group.title} ${documentMeta.documentTitle}`,
    `문서일자: ${documentMeta.documentDate}`,
    "내용: 교재 반품 요청",
    `발신: ${TEXTBOOK_HANDOFF_BUSINESS_NAME}`,
    group.subtitle ? `담당: ${group.subtitle}` : "",
    `총 반품금액: ${formatCurrency(group.totalAmount)}`,
    `요약: ${group.summary.join(" / ")}`,
    "",
    ...group.lines.map((line, index) =>
      [
        `${index + 1}. 위치: ${line.locationLabel || "-"}`,
        `교재: ${line.title}`,
        `출판사: ${line.publisherLabel || "-"}`,
        `학생용: ${line.studentQuantityLabel || "0권"}`,
        `교사용: ${line.teacherQuantityLabel || "0권"}`,
        `매입단가: ${line.unitCostLabel || "-"}`,
        `반품금액: ${line.amountLabel}`,
        line.note ? `비고: ${line.note}` : "",
      ].filter(Boolean).join(" | "),
    ),
    "",
    "위치별 입고 수량 기준으로 반품 처리 부탁드립니다.",
  ].filter((line) => line !== "").join("\n");
}

function pushUniqueText(values: string[], value: unknown) {
  const normalized = text(value);
  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

function formatCompactHandoffLabels(values: string[]) {
  const uniqueValues = values.filter(Boolean);
  if (uniqueValues.length <= 2) {
    return uniqueValues.join(", ");
  }
  return `${uniqueValues.slice(0, 2).join(", ")} 외 ${formatQuantity(uniqueValues.length - 2)}`;
}

function getPurchaseSupplierHandoffScopeLabel(quantities: Record<TextbookCopyScope, number>) {
  const hasStudentCopies = quantities.student > 0;
  const hasTeacherCopies = quantities.teacher > 0;
  if (hasStudentCopies && hasTeacherCopies) return "학생용/교사용";
  if (hasTeacherCopies) return "교사용";
  return "학생용";
}

function getPurchaseSupplierHandoffQuantityLabel(quantities: Record<TextbookCopyScope, number>) {
  return [
    quantities.student > 0 ? `학생용 ${formatQuantity(quantities.student)}권` : "",
    quantities.teacher > 0 ? `교사용 ${formatQuantity(quantities.teacher)}권` : "",
  ].filter(Boolean).join(" · ") || "0권";
}

function getPurchaseSupplierHandoffLocationLabel(locationScopeQuantities: Map<string, Record<TextbookCopyScope, number>>) {
  return [...locationScopeQuantities.entries()].map(([location, quantities]) => {
    return `${location}: 학생용 ${formatQuantity(quantities.student)}권, 교사용 ${formatQuantity(quantities.teacher)}권`;
  }).join(" · ");
}

function getPurchaseSupplierHandoffUnitCostLabel(line: PurchaseSupplierHandoffLineAccumulator) {
  return line.unitCostLabels.length > 0 ? line.unitCostLabels.join(" · ") : "0원";
}

function getPurchaseSupplierHandoffLocationQuantities(locationScopeQuantities: Map<string, Record<TextbookCopyScope, number>>) {
  return [...locationScopeQuantities.entries()].map(([locationLabel, quantities]) => ({
    locationLabel,
    studentQuantityLabel: `${formatQuantity(quantities.student)}권`,
    teacherQuantityLabel: `${formatQuantity(quantities.teacher)}권`,
  }));
}

function buildMakeEduBillingMessage(group: TextbookHandoffGroup) {
  return [
    "[메이크에듀 기타수납 생성]",
    `수납명: ${group.title}`,
    group.summary.join(" / "),
    group.subtitle,
    "반복: 1회",
    "",
    ...group.lines.map((line, index) =>
      `${index + 1}. ${line.title} / ${line.detail} / ${line.amountLabel}${line.note ? ` / ${line.note}` : ""}`,
    ),
  ].filter((line) => line !== "").join("\n");
}

export function buildPurchaseSupplierHandoffGroups({
  rows,
  ordersById,
  textbooks,
  publishers,
  suppliers,
  publisherSupplierLinks,
  locations,
  classes,
}: {
  rows: Row[];
  ordersById: Map<string, Row>;
  textbooks: Row[];
  publishers: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  locations: Row[];
  classes: Row[];
}) {
  const groups = new Map<string, PurchaseSupplierHandoffGroupDraft>();

  for (const line of rows) {
    const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
    const draft = buildPurchaseCardDraft(line, order);
    const status = text(line.status || order.status) || "requested";
    if (status === "received" || status === "returned" || status === "cancelled") {
      continue;
    }

    const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
    const textbookTitle = getPurchaseTextbookTitle(line, textbook);
    const supplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks, publishers) || draft.supplierId || "unspecified";
    const supplier = getSupplierById(suppliers, supplierId);
    const supplierName = getSupplierName(suppliers, supplierId) || "공급처 미지정";
    const supplierContact = getSupplierContact(supplier);
    const classRecord = getClassById(classes, draft.classId);
    const classLabel = classRecord ? getClassName(classRecord) : "";
    const locationLabel = getLocationName(locations, draft.locationId) || "위치 미지정";
    const publisherLabel = getPublisherLabel(textbook || {});
    const orderedQuantity = numberValue(draft.orderedQuantity);
    const receivedQuantity = numberValue(draft.receivedQuantity);
    if (status !== "ordered" && status !== "partially_received") {
      continue;
    }
    if (orderedQuantity <= 0) {
      continue;
    }
    const quantity = orderedQuantity;
    const unitCost = getConfiguredTextbookPurchaseUnitCost(textbook, supplierId, suppliers, draft.unitCost, draft.copyScope);
    const lineAmount = unitCost * quantity;
    const group = groups.get(supplierId) || {
      id: supplierId,
      title: supplierName,
      subtitle: supplierContact,
      summary: [],
      message: "",
      lines: [],
      totalQuantity: 0,
      totalAmount: 0,
      lineAccumulators: new Map(),
    };
    const textbookKey = getRecordId(textbook || {}) || normalizeTextbookLookup(textbookTitle) || textbookTitle;
    const lineKey = `${supplierId}||${textbookKey}`;
    const lineAccumulator = group.lineAccumulators.get(lineKey) || {
      id: lineKey,
      title: textbookTitle,
      publisherLabel,
      classLabels: [],
      locationLabels: [],
      locationScopeQuantities: new Map(),
      requesterLabels: [],
      statusLabels: [],
      scopeQuantities: { student: 0, teacher: 0 },
      unitCostLabels: [],
      remainingQuantity: 0,
      totalQuantity: 0,
      totalAmount: 0,
    };

    pushUniqueText(lineAccumulator.classLabels, classLabel);
    pushUniqueText(lineAccumulator.locationLabels, locationLabel);
    pushUniqueText(lineAccumulator.requesterLabels, draft.requestBy);
    pushUniqueText(lineAccumulator.statusLabels, purchaseStatusLabel(status, draft.orderedQuantity, draft.receivedQuantity));
    if (draft.copyScope === "student" || unitCost > 0) {
      pushUniqueText(lineAccumulator.unitCostLabels, formatPurchaseUnitCost(unitCost, textbook));
    }
    const locationQuantities = lineAccumulator.locationScopeQuantities.get(locationLabel) || { student: 0, teacher: 0 };
    locationQuantities[draft.copyScope] += quantity;
    lineAccumulator.locationScopeQuantities.set(locationLabel, locationQuantities);
    lineAccumulator.scopeQuantities[draft.copyScope] += quantity;
    lineAccumulator.remainingQuantity += receivedQuantity > 0 && receivedQuantity < quantity ? quantity - receivedQuantity : 0;
    lineAccumulator.totalQuantity += quantity;
    lineAccumulator.totalAmount += lineAmount;

    group.lineAccumulators.set(lineKey, lineAccumulator);
    group.totalQuantity += quantity;
    group.totalAmount += lineAmount;
    groups.set(supplierId, group);
  }

  return [...groups.values()].map(({ lineAccumulators, ...group }) => {
    const accumulatorLines = [...lineAccumulators.values()];
    const lines = accumulatorLines.map((line) => ({
      id: line.id,
      title: line.title,
      detail: [
        getPurchaseSupplierHandoffScopeLabel(line.scopeQuantities),
        line.publisherLabel,
        formatCompactHandoffLabels(line.classLabels),
        formatCompactHandoffLabels(line.locationLabels),
      ].filter(Boolean).join(" · "),
      note: [
        formatCompactHandoffLabels(line.statusLabels),
        line.requesterLabels.length > 0 ? `요청 ${formatCompactHandoffLabels(line.requesterLabels)}` : "",
        line.remainingQuantity > 0 ? `잔여 ${formatQuantity(line.remainingQuantity)}권` : "",
      ].filter(Boolean).join(" · "),
      quantityLabel: getPurchaseSupplierHandoffQuantityLabel(line.scopeQuantities),
      amountLabel: formatCurrency(line.totalAmount),
      locationLabel: getPurchaseSupplierHandoffLocationLabel(line.locationScopeQuantities),
      locationQuantities: getPurchaseSupplierHandoffLocationQuantities(line.locationScopeQuantities),
      publisherLabel: line.publisherLabel || "-",
      studentQuantityLabel: `${formatQuantity(line.scopeQuantities.student)}권`,
      teacherQuantityLabel: `${formatQuantity(line.scopeQuantities.teacher)}권`,
      unitCostLabel: getPurchaseSupplierHandoffUnitCostLabel(line),
    }));
    const studentQuantity = accumulatorLines.reduce((sum, line) => sum + line.scopeQuantities.student, 0);
    const teacherQuantity = accumulatorLines.reduce((sum, line) => sum + line.scopeQuantities.teacher, 0);
    const summary = [
      `${formatQuantity(lines.length)}종`,
      studentQuantity > 0 ? `학생용 ${formatQuantity(studentQuantity)}권` : "",
      teacherQuantity > 0 ? `교사용 ${formatQuantity(teacherQuantity)}권` : "",
      `${formatQuantity(group.totalQuantity)}권`,
      group.totalAmount > 0 ? formatCurrency(group.totalAmount) : "",
    ].filter(Boolean);
    const nextGroup = { ...group, lines, summary };
    return {
      ...nextGroup,
      message: buildPurchaseSupplierMessage(nextGroup),
    };
  });
}

export function buildPurchaseSupplierReturnHandoffGroups({
  rows,
  ordersById,
  textbooks,
  publishers,
  suppliers,
  publisherSupplierLinks,
  locations,
  classes,
}: {
  rows: Row[];
  ordersById: Map<string, Row>;
  textbooks: Row[];
  publishers: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  locations: Row[];
  classes: Row[];
}) {
  const groups = new Map<string, PurchaseSupplierHandoffGroupDraft>();

  for (const line of rows) {
    const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
    const draft = buildPurchaseCardDraft(line, order);
    const status = text(line.status || order.status) || "requested";
    if (status !== "received" && status !== "partially_received") {
      continue;
    }

    const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
    const textbookTitle = getPurchaseTextbookTitle(line, textbook);
    const supplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks, publishers) || draft.supplierId || "unspecified";
    const supplier = getSupplierById(suppliers, supplierId);
    const supplierName = getSupplierName(suppliers, supplierId) || "공급처 미지정";
    const supplierContact = getSupplierContact(supplier);
    const classRecord = getClassById(classes, draft.classId);
    const classLabel = classRecord ? getClassName(classRecord) : "";
    const locationLabel = getLocationName(locations, draft.locationId) || "위치 미지정";
    const publisherLabel = getPublisherLabel(textbook || {});
    const receivedQuantity = numberValue(draft.receivedQuantity);
    const quantity = Math.max(0, receivedQuantity);
    if (quantity <= 0) {
      continue;
    }
    const unitCost = getConfiguredTextbookPurchaseUnitCost(textbook, supplierId, suppliers, draft.unitCost, draft.copyScope);
    const lineAmount = unitCost * quantity;
    const group = groups.get(supplierId) || {
      id: supplierId,
      title: supplierName,
      subtitle: supplierContact,
      summary: [],
      message: "",
      lines: [],
      totalQuantity: 0,
      totalAmount: 0,
      lineAccumulators: new Map(),
    };
    const textbookKey = getRecordId(textbook || {}) || normalizeTextbookLookup(textbookTitle) || textbookTitle;
    const lineKey = `${supplierId}||${textbookKey}`;
    const lineAccumulator = group.lineAccumulators.get(lineKey) || {
      id: lineKey,
      title: textbookTitle,
      publisherLabel,
      classLabels: [],
      locationLabels: [],
      locationScopeQuantities: new Map(),
      requesterLabels: [],
      statusLabels: [],
      scopeQuantities: { student: 0, teacher: 0 },
      unitCostLabels: [],
      remainingQuantity: 0,
      totalQuantity: 0,
      totalAmount: 0,
    };

    pushUniqueText(lineAccumulator.classLabels, classLabel);
    pushUniqueText(lineAccumulator.locationLabels, locationLabel);
    pushUniqueText(lineAccumulator.requesterLabels, draft.requestBy);
    pushUniqueText(lineAccumulator.statusLabels, purchaseStatusLabel(status, draft.orderedQuantity, draft.receivedQuantity));
    if (draft.copyScope === "student" || unitCost > 0) {
      pushUniqueText(lineAccumulator.unitCostLabels, formatPurchaseUnitCost(unitCost, textbook));
    }
    const locationQuantities = lineAccumulator.locationScopeQuantities.get(locationLabel) || { student: 0, teacher: 0 };
    locationQuantities[draft.copyScope] += quantity;
    lineAccumulator.locationScopeQuantities.set(locationLabel, locationQuantities);
    lineAccumulator.scopeQuantities[draft.copyScope] += quantity;
    lineAccumulator.totalQuantity += quantity;
    lineAccumulator.totalAmount += lineAmount;

    group.lineAccumulators.set(lineKey, lineAccumulator);
    group.totalQuantity += quantity;
    group.totalAmount += lineAmount;
    groups.set(supplierId, group);
  }

  return [...groups.values()].map(({ lineAccumulators, ...group }) => {
    const accumulatorLines = [...lineAccumulators.values()];
    const lines = accumulatorLines.map((line) => ({
      id: line.id,
      title: line.title,
      detail: [
        getPurchaseSupplierHandoffScopeLabel(line.scopeQuantities),
        line.publisherLabel,
        formatCompactHandoffLabels(line.classLabels),
        formatCompactHandoffLabels(line.locationLabels),
      ].filter(Boolean).join(" · "),
      note: [
        formatCompactHandoffLabels(line.statusLabels),
        line.requesterLabels.length > 0 ? `요청 ${formatCompactHandoffLabels(line.requesterLabels)}` : "",
      ].filter(Boolean).join(" · "),
      quantityLabel: getPurchaseSupplierHandoffQuantityLabel(line.scopeQuantities),
      amountLabel: formatCurrency(line.totalAmount),
      locationLabel: getPurchaseSupplierHandoffLocationLabel(line.locationScopeQuantities),
      locationQuantities: getPurchaseSupplierHandoffLocationQuantities(line.locationScopeQuantities),
      publisherLabel: line.publisherLabel || "-",
      studentQuantityLabel: `${formatQuantity(line.scopeQuantities.student)}권`,
      teacherQuantityLabel: `${formatQuantity(line.scopeQuantities.teacher)}권`,
      unitCostLabel: getPurchaseSupplierHandoffUnitCostLabel(line),
    }));
    const studentQuantity = accumulatorLines.reduce((sum, line) => sum + line.scopeQuantities.student, 0);
    const teacherQuantity = accumulatorLines.reduce((sum, line) => sum + line.scopeQuantities.teacher, 0);
    const returnDocumentLabel = "반품 요청서";
    const summary = [
      returnDocumentLabel,
      `${formatQuantity(lines.length)}종`,
      studentQuantity > 0 ? `학생용 ${formatQuantity(studentQuantity)}권` : "",
      teacherQuantity > 0 ? `교사용 ${formatQuantity(teacherQuantity)}권` : "",
      `${formatQuantity(group.totalQuantity)}권`,
      group.totalAmount > 0 ? formatCurrency(group.totalAmount) : "",
    ].filter(Boolean);
    const nextGroup = { ...group, lines, summary };
    return {
      ...nextGroup,
      message: buildPurchaseSupplierReturnMessage(nextGroup),
    };
  });
}

export function buildMakeEduBillingHandoffGroups({
  rows,
  salesById,
  textbooks,
  classes,
  studentsById,
}: {
  rows: Row[];
  salesById: Map<string, Row>;
  textbooks: Row[];
  classes: Row[];
  studentsById: Map<string, Row>;
}) {
  const groups = new Map<string, TextbookHandoffGroup>();

  for (const line of rows) {
    const sale = salesById.get(text(line.sale_id || line.saleId));
    const status = getSaleLineStatus(line, sale);
    if (getTextbookCopyScope(line) === "teacher" || !isBillableSaleLineStatus(status)) {
      continue;
    }

    const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
    const textbookTitle = textbook ? getTextbookTitle(textbook) : text(line.textbook_id || line.textbookId) || "-";
    const quantity = getSaleLineQuantity(line);
    const lineAmount = getSaleLineAmount(line, textbook);
    const chargeMonth = getSaleLineMonth(line, sale);
    const feeName = `[${getSubjectLabel(textbook?.subject)} 교재] ${textbookTitle} ${Math.round(lineAmount)}`;
    const key = `${chargeMonth}:${feeName}:${lineAmount}`;
    const classItem = getClassById(classes, text(line.class_id || line.classId || sale?.class_id || sale?.classId));
    const studentId = text(line.student_id || line.studentId);
    const student = studentsById.get(studentId);
    const studentName = getSaleLineRecipientName(line, studentsById);
    const group = groups.get(key) || {
      id: key,
      title: feeName,
      subtitle: `수납시작: ${chargeMonth}`,
      summary: [],
      message: "",
      lines: [],
      totalQuantity: 0,
      totalAmount: 0,
    };

    group.lines.push({
      id: getRecordId(line) || `${key}-${group.lines.length}`,
      title: studentName,
      detail: [getStudentGradeLabel(student), classItem ? getClassName(classItem) : ""].filter(Boolean).join(" · "),
      note: [`수량 ${formatQuantity(quantity)}`, saleStatusLabels[status] || status].filter(Boolean).join(" · "),
      quantityLabel: "1명",
      amountLabel: formatCurrency(lineAmount),
    });
    group.totalQuantity += quantity;
    group.totalAmount += lineAmount;
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    summary: [
      `${formatQuantity(group.lines.length)}명`,
      `${formatQuantity(group.totalQuantity)}권`,
      group.lines[0]?.amountLabel || "",
    ].filter(Boolean),
    message: buildMakeEduBillingMessage({
      ...group,
      summary: [
        `${formatQuantity(group.lines.length)}명`,
        `${formatQuantity(group.totalQuantity)}권`,
        group.lines[0]?.amountLabel || "",
      ].filter(Boolean),
    }),
  })).sort((left, right) => left.title.localeCompare(right.title, "ko", { numeric: true }));
}
