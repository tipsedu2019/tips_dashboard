import {
  getRecordId, getTextbookByReference, getTextbookCopyScope, getTextbookSalePrice,
  getTextbookTitle, normalizeBarcodeValue, normalizeTextbookLookupValue,
} from "./textbook-ledger.js";
import {
  TEXTBOOK_SUBJECT_OPTIONS, TEXTBOOK_SUBJECT_ALIASES,
  getTextbookCategoryLabel, getTextbookSchoolLevel, getTextbookGradeLevel,
  getTextbookSubSubject, getTextbookSchoolLevelSummary, getTextbookGradeSummary,
  getTextbookGradeLabel, getTextbookTaxonomySelection, matchesTextbookTaxonomy,
} from "./textbook-taxonomy";
import type {
  Row, InventoryFilter, InventoryAuditFilter, TextbookQualityFilter,
  PurchaseKanbanDraft, InventoryCountRow, TextbookSearchIndex, SaleHistorySummaryRow,
  MasterFilters, TextbookMasterRow, PurchaseCaseRow,
} from "./textbook-read-types";

export const subjectOptions = TEXTBOOK_SUBJECT_OPTIONS;

export const subjectAliases: Record<string, string> = TEXTBOOK_SUBJECT_ALIASES;

export const statusAliases: Record<string, string> = {
  active: "active",
  "사용중": "active",
  inactive: "inactive",
  "미사용": "inactive",
};

export const INVENTORY_COUNT_CYCLE_DAYS = 30;

export const INVENTORY_LOW_STOCK_THRESHOLD = 3;

export function text(value: unknown) {
  return String(value || "").trim();
}

export function textPreservingZero(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function getRowFieldText(row: Row | undefined, ...fieldNames: string[]) {
  if (!row) return "";
  for (const fieldName of fieldNames) {
    if (!Object.prototype.hasOwnProperty.call(row, fieldName)) continue;
    const value = textPreservingZero(row[fieldName]);
    if (value) return value;
  }
  return "";
}

export function normalizeOptionValue(value: unknown, aliases: Record<string, string>, fallback: string) {
  const raw = text(value);
  return aliases[raw] || aliases[raw.toLowerCase()] || fallback;
}

export function normalizeSubjectValue(value: unknown) {
  return normalizeOptionValue(value, subjectAliases, "other");
}

export function getSubjectLabel(value: unknown) {
  const raw = text(value);
  const normalized = normalizeSubjectValue(raw);
  return subjectOptions.find((option) => option.value === normalized)?.label || raw || "-";
}

export function getPublisherLabel(row: Row) {
  return text(row.publisher || row.publisher_name || row.publisherName) || "미분류";
}

export function getTextbookTitleKey(row: Row) {
  return normalizeTextbookLookupValue(getTextbookTitle(row), { compact: true });
}

export function getTaxonomyCategoryLabel(row: Row) {
  return getTextbookCategoryLabel(row);
}

export function hasTextbookTaxonomy(row: Row) {
  return Boolean(getTextbookSchoolLevel(row) || getTextbookGradeLevel(row) || getTextbookSubSubject(row) || text(row.category));
}

export function hasTextbookSubjectMismatch(row: Row) {
  const title = getTextbookTitle(row).toLowerCase().replace(/\s+/g, " ");
  const subject = normalizeSubjectValue(row.subject);
  const mathWordBoundary = /(^|[^가-힣a-z0-9])수\s?[12ⅠⅡ]($|[^가-힣a-z0-9])/i;
  const mathHints = ["수학", "rpm", "알피엠", "개념원리", "확률", "통계", "미적분", "대수"];
  const englishHints = ["영어", "english", "reading", "writing", "grammar", "독해", "구문", "어법", "영단어", "리스닝"];
  const hasMathHint = mathHints.some((keyword) => title.includes(keyword)) || mathWordBoundary.test(title);
  const hasEnglishHint = englishHints.some((keyword) => title.includes(keyword));

  if (subject === "english" && hasMathHint) {
    return true;
  }
  if (subject === "math" && hasEnglishHint) {
    return true;
  }
  return false;
}

export function getTextbookQualityIssues(row: Row, duplicateTitleKeys: Set<string>) {
  return {
    duplicate: duplicateTitleKeys.has(getTextbookTitleKey(row)),
    missingCode: !text(row.isbn13 || row.barcode),
    missingPublisher: getPublisherLabel(row) === "미분류",
    missingCategory: !hasTextbookTaxonomy(row),
    missingPrice: getTextbookSalePrice(row) <= 0,
    subjectMismatch: hasTextbookSubjectMismatch(row),
    inactive: !isActiveTextbook(row),
  };
}

export function hasTextbookActionableQualityIssue(row: Row, duplicateTitleKeys: Set<string>) {
  const issues = getTextbookQualityIssues(row, duplicateTitleKeys);
  return (
    issues.duplicate ||
    issues.missingCode ||
    issues.missingPublisher ||
    issues.missingCategory ||
    issues.missingPrice ||
    issues.subjectMismatch
  );
}

export function hasTextbookQualityIssue(row: Row, duplicateTitleKeys: Set<string>) {
  if (!isActiveTextbook(row)) return true;
  return hasTextbookActionableQualityIssue(row, duplicateTitleKeys);
}

export function getTextbookQualityScore(row: Row, duplicateTitleKeys: Set<string>) {
  const issues = getTextbookQualityIssues(row, duplicateTitleKeys);
  return (
    (issues.subjectMismatch ? 16 : 0) +
    (issues.duplicate ? 8 : 0) +
    (issues.missingPublisher ? 4 : 0) +
    (issues.missingCategory ? 4 : 0) +
    (issues.missingPrice ? 4 : 0) +
    (issues.missingCode ? 2 : 0) +
    (issues.inactive ? 1 : 0)
  );
}

export function matchesTextbookQualityFilter(row: Row, filter: TextbookQualityFilter, duplicateTitleKeys: Set<string>) {
  if (filter === "inactive") return !isActiveTextbook(row);
  if (!isActiveTextbook(row)) return false;
  if (filter === "all") return true;
  if (filter === "attention") return hasTextbookActionableQualityIssue(row, duplicateTitleKeys);
  const issues = getTextbookQualityIssues(row, duplicateTitleKeys);
  return Boolean(issues[filter]);
}

export function normalizeStatusValue(value: unknown) {
  return normalizeOptionValue(value, statusAliases, "active");
}

export function numberValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatQuantity(value: unknown) {
  return new Intl.NumberFormat("ko-KR").format(numberValue(value));
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function getClassName(row: Row) {
  return text(row.name || row.class_name || row.className || row.title || row.id);
}

export function getLocationName(locations: Row[], id: string) {
  const match = locations.find((location) => getRecordId(location) === id || text(location.code) === id);
  return text(match?.name || match?.code || id);
}

export function normalizeTextbookLookup(value: unknown) {
  return normalizeTextbookLookupValue(value);
}

export function getTextbookById(textbooks: Row[], id: string) {
  return getTextbookByReference(textbooks, id);
}

export function buildTextbookSearchIndex(row: Row): TextbookSearchIndex {
  const taxonomy = getTextbookTaxonomySelection(row);
  const compactTitle = normalizeTextbookLookupValue(getTextbookTitle(row), { compact: true });
  return {
    haystack: [
      getTextbookTitle(row),
      compactTitle,
      row.subject,
      getSubjectLabel(row.subject),
      getTaxonomyCategoryLabel(row),
      getTextbookSchoolLevelSummary(row),
      getTextbookGradeSummary(row),
      ...taxonomy.gradeLevels.map(getTextbookGradeLabel),
      getTextbookSubSubject(row),
      row.category,
      row.publisher,
      row.isbn13,
      row.barcode,
    ]
      .map(text)
      .join(" ")
      .toLowerCase(),
    barcodeText: normalizeBarcodeValue(`${text(row.isbn13)} ${text(row.barcode)}`),
  };
}

export function getRequestedTextbookTitle(line: Row) {
  return text(line.requested_textbook_title || line.requestedTextbookTitle || line.textbook_title || line.textbookTitle);
}

export function getPurchaseTextbookTitle(line: Row, textbook: Row | undefined) {
  return textbook ? getTextbookTitle(textbook) : getRequestedTextbookTitle(line) || text(line.textbook_id || line.textbookId) || "-";
}

export function getPurchaseLineOrder(line: Row, ordersById: Map<string, Row>) {
  return ordersById.get(text(line.purchase_order_id || line.purchaseOrderId));
}

export function getClassById(classes: Row[], id: string) {
  return classes.find((classItem) => getRecordId(classItem) === id);
}

export function getInventoryQuantity(inventoryRow: Row | undefined, locationId: string) {
  const locationQuantities = (inventoryRow?.locationQuantities || {}) as Record<string, unknown>;
  if (!locationId) return numberValue(inventoryRow?.totalQuantity);
  return numberValue(locationQuantities[locationId]);
}

export function getInventoryCountedAt(row: Row) {
  return text(row.counted_at || row.countedAt || row.created_at || row.createdAt);
}

export function getDaysSince(value: unknown, now = Date.now()) {
  const rawValue = text(value);
  if (!rawValue) return Number.POSITIVE_INFINITY;
  const time = new Date(rawValue).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.floor((now - time) / 86_400_000);
}

export function getLatestStockCount(stockCounts: Row[], textbookId: string, locationId: string) {
  return stockCounts
    .filter((count) => (
      text(count.textbook_id || count.textbookId) === textbookId &&
      text(count.location_id || count.locationId) === locationId
    ))
    .sort((left, right) => new Date(getInventoryCountedAt(right)).getTime() - new Date(getInventoryCountedAt(left)).getTime())[0];
}

export function getInventoryDueLabel(latestCountAt: string, daysSinceLatestCount: number) {
  if (!latestCountAt) return "실사 이력 없음";
  if (!Number.isFinite(daysSinceLatestCount)) return "실사일 확인 필요";
  if (daysSinceLatestCount >= INVENTORY_COUNT_CYCLE_DAYS) {
    return `${formatQuantity(daysSinceLatestCount)}일 경과`;
  }
  return `${formatQuantity(INVENTORY_COUNT_CYCLE_DAYS - daysSinceLatestCount)}일 남음`;
}

export function getInventoryRecommendationReason(
  row: Row,
  latestCountAt: string,
  daysSinceLatestCount: number,
  currentQuantity: number,
) {
  if (currentQuantity < 0) return "마이너스 재고";
  if (currentQuantity <= INVENTORY_LOW_STOCK_THRESHOLD) return "재고 부족";
  if (!latestCountAt) return "실사 이력 없음";
  if (!Number.isFinite(daysSinceLatestCount)) return "실사일 확인 필요";
  if (daysSinceLatestCount >= INVENTORY_COUNT_CYCLE_DAYS) return `${formatQuantity(daysSinceLatestCount)}일 경과`;
  if (!isActiveTextbook(row)) return "미사용 확인";
  return `${formatQuantity(INVENTORY_COUNT_CYCLE_DAYS - daysSinceLatestCount)}일 남음`;
}

export function buildInventoryCountRows({
  rows,
  stockCounts,
  locations,
  locationId,
  now = Date.now(),
}: {
  rows: Row[];
  stockCounts: Row[];
  locations: Row[];
  locationId: string;
  now?: number;
}) {
  return rows.map((row): InventoryCountRow => {
    const id = getRecordId(row);
    const latestCount = getLatestStockCount(stockCounts, id, locationId);
    const latestCountAt = getInventoryCountedAt(latestCount || {});
    const daysSinceLatestCount = getDaysSince(latestCountAt, now);
    const isCountedThisCycle = Boolean(latestCountAt && daysSinceLatestCount < INVENTORY_COUNT_CYCLE_DAYS);
    const currentQuantity = getInventoryQuantity(row, locationId);
    const isRecommended = isActiveTextbook(row) && (
      currentQuantity <= INVENTORY_LOW_STOCK_THRESHOLD ||
      !latestCountAt ||
      daysSinceLatestCount >= INVENTORY_COUNT_CYCLE_DAYS
    );
    const status: InventoryAuditFilter = isRecommended ? "recommended" : isCountedThisCycle ? "done" : "pending";
    const reason = getInventoryRecommendationReason(row, latestCountAt, daysSinceLatestCount, currentQuantity);
    return {
      source: row,
      id,
      title: getTextbookTitle(row),
      publisher: getPublisherLabel(row),
      locationId,
      locationName: getLocationName(locations, locationId) || "-",
      currentQuantity,
      latestCountAt,
      daysSinceLatestCount,
      isCountedThisCycle,
      isRecommended,
      status,
      reason,
      dueLabel: getInventoryDueLabel(latestCountAt, daysSinceLatestCount),
    };
  }).sort((left, right) => {
    const leftPriority = left.isRecommended ? 0 : left.status === "pending" ? 1 : 2;
    const rightPriority = right.isRecommended ? 0 : right.status === "pending" ? 1 : 2;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftDays = Number.isFinite(left.daysSinceLatestCount) ? left.daysSinceLatestCount : 99_999;
    const rightDays = Number.isFinite(right.daysSinceLatestCount) ? right.daysSinceLatestCount : 99_999;
    if (leftDays !== rightDays) return rightDays - leftDays;
    if (left.currentQuantity !== right.currentQuantity) return left.currentQuantity - right.currentQuantity;
    return left.title.localeCompare(right.title, "ko", { numeric: true });
  });
}

export function isActiveTextbook(row: Row) {
  return normalizeStatusValue(row.status || row.state) === "active";
}

export function getTextbookReferenceState(textbooks: Row[], reference: unknown) {
  const value = text(reference);
  if (!value) return "none";
  const textbook = getTextbookById(textbooks, value);
  if (!textbook) return "missing";
  return isActiveTextbook(textbook) ? "active" : "inactive";
}

export function shouldShowOperationalPurchaseLine(line: Row, order: Row | undefined, textbooks: Row[]) {
  const draft = buildPurchaseCardDraft(line, order);
  const reference = draft.textbookId || draft.requestedTextbookTitle;
  const state = getTextbookReferenceState(textbooks, reference);
  return state !== "inactive";
}

export function shouldShowOperationalSaleLine(line: Row, textbooks: Row[]) {
  const reference = text(line.textbook_id || line.textbookId);
  return getTextbookReferenceState(textbooks, reference) === "active";
}

export function matchesInventoryFilter(row: Row, filter: InventoryFilter) {
  const totalQuantity = numberValue(row.totalQuantity);
  if (filter === "negative") return totalQuantity < 0;
  if (filter === "unused") return totalQuantity === 0;
  if (filter === "shortage") return totalQuantity < 0 || (totalQuantity > 0 && totalQuantity <= 3);
  if (filter === "surplus") return totalQuantity >= 20;
  return true;
}

export function getSaleEventAt(line: Row, sale: Row | undefined, status: string) {
  if (status === "issued") {
    return line.issued_at || line.issuedAt || sale?.issued_at || sale?.issuedAt || line.updated_at || line.updatedAt;
  }

  return sale?.charge_date || sale?.chargeDate || sale?.created_at || sale?.createdAt || line.created_at || line.createdAt;
}

export function buildPurchaseCardDraft(line: Row, order: Row | undefined): PurchaseKanbanDraft {
  const requested = getRowFieldText(line, "requested_quantity", "requestedQuantity");
  const ordered = getRowFieldText(line, "ordered_quantity", "orderedQuantity");
  const received = getRowFieldText(line, "received_quantity", "receivedQuantity");
  const copyScope = getTextbookCopyScope(line);
  const isTeacherCopy = copyScope === "teacher";

  return {
    textbookId: text(line.textbook_id || line.textbookId),
    requestedTextbookTitle: text(line.requested_textbook_title || line.requestedTextbookTitle || line.textbook_title || line.textbookTitle),
    copyScope,
    classId: text(line.class_id || line.classId),
    supplierId: text(order?.supplier_id || order?.supplierId),
    locationId: text(line.location_id || line.locationId),
    requestBy: text(order?.requested_by || order?.requestedBy),
    requestedQuantity: requested || ordered || received || "1",
    orderedQuantity: ordered,
    receivedQuantity: received,
    studentRequestedQuantity: isTeacherCopy ? "" : requested || ordered || received || "1",
    teacherRequestedQuantity: isTeacherCopy ? requested || ordered || received || "1" : "",
    studentOrderedQuantity: isTeacherCopy ? "" : ordered,
    teacherOrderedQuantity: isTeacherCopy ? ordered : "",
    studentReceivedQuantity: isTeacherCopy ? "" : received,
    teacherReceivedQuantity: isTeacherCopy ? received : "",
    unitCost: text(line.unit_cost || line.unitCost),
    statementNumber: text(order?.statement_number || order?.statementNumber),
    memo: text(line.memo || order?.memo),
  };
}

export function getPurchaseScopeLines(line: Row) {
  const scopeLines = Array.isArray(line.purchaseScopeLines)
    ? (line.purchaseScopeLines as Row[]).filter(Boolean)
    : [];
  return scopeLines.length > 0 ? scopeLines : [line];
}

export function getPurchaseDisplayCaseKey(line: Row, order: Row | undefined, textbooks: Row[]) {
  const draft = buildPurchaseCardDraft(line, order);
  const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
  const textbookKey = getRecordId(textbook || {}) || normalizeTextbookLookup(draft.requestedTextbookTitle || getPurchaseTextbookTitle(line, textbook));
  return [
    text(line.status || order?.status),
    textbookKey,
    draft.classId,
    draft.locationId,
    draft.requestBy,
    draft.supplierId,
    text(order?.order_date || order?.orderDate),
    text(order?.statement_number || order?.statementNumber),
  ].join("||");
}

type PurchaseCreatedAt = { seconds: number; fraction: number } | null;

// PostgREST's canonical AD ISO timestamptz (4-digit year, explicit timezone,
// up to 6 fractional digits) plus PostgreSQL infinity endpoints. Extended/BC
// dates are unsupported, never silently treated as missing chronology.
function getPurchaseCreatedAt(value: unknown): PurchaseCreatedAt {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (value === "-infinity") return { seconds: Number.NEGATIVE_INFINITY, fraction: 0 };
  if (value === "infinity") return { seconds: Number.POSITIVE_INFINITY, fraction: 0 };
  const parts = typeof value === "string"
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  const seconds = parts ? Date.parse(`${parts[1]}${parts[3]}`) / 1000 : Number.NaN;
  if (!parts || !Number.isFinite(seconds)) throw new TypeError("Unsupported purchase created_at timestamp");
  const wallClock = new Date(`${parts[1]}Z`);
  if (parts[1].startsWith("0000-") || !Number.isFinite(wallClock.getTime()) || wallClock.toISOString().slice(0, 19) !== parts[1]) {
    throw new TypeError("Unsupported purchase created_at timestamp");
  }
  return { seconds, fraction: Number((parts[2] || "").padEnd(6, "0")) };
}

// Explicit stabilization of the old unspecified input order, not a claim that
// the legacy source query ordered its rows. Sort BEFORE forming display parents,
// but AFTER callers filter raw members. Never sort/mutate the supplied array.
function orderPurchaseSourceRows(rows: Row[]) {
  return rows.map((row) => ({ row, createdAt: getPurchaseCreatedAt(row.created_at) }))
    .sort((left, right) => {
      if (left.createdAt === null && right.createdAt !== null) return 1;
      if (left.createdAt !== null && right.createdAt === null) return -1;
      if (left.createdAt !== null && right.createdAt !== null) {
        if (left.createdAt.seconds !== right.createdAt.seconds) return left.createdAt.seconds < right.createdAt.seconds ? -1 : 1;
        if (left.createdAt.fraction !== right.createdAt.fraction) return left.createdAt.fraction - right.createdAt.fraction;
      }
      const leftId = getRecordId(left.row);
      const rightId = getRecordId(right.row);
      return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
    }).map(({ row }) => row);
}

export function buildPurchaseDisplayRows(rows: Row[], ordersById: Map<string, Row>, textbooks: Row[]): PurchaseCaseRow[] {
  const displayRows = new Map<string, PurchaseCaseRow>();
  for (const row of orderPurchaseSourceRows(rows)) {
    const order = ((row.order || getPurchaseLineOrder(row, ordersById)) || {}) as Row;
    const baseKey = getPurchaseDisplayCaseKey(row, order, textbooks);
    const copyScope = getTextbookCopyScope(row);
    const existing = displayRows.get(baseKey);
    const key = existing && existing.lines.some((line) => getTextbookCopyScope(line) === copyScope)
      ? `${baseKey}||${getRecordId(row)}`
      : baseKey;
    const current = displayRows.get(key);
    const nextLines = current ? [...current.lines, row] : [row];
    const primaryLine = nextLines.find((line) => getTextbookCopyScope(line) === "student") || nextLines[0];
    displayRows.set(key, {
      id: key,
      anchorLineId: getRecordId(nextLines[0]),
      memberLineIds: nextLines.map(getRecordId),
      line: { ...primaryLine, purchaseScopeLines: nextLines },
      lines: nextLines,
    });
  }
  return [...displayRows.values()];
}

export function getSaleHistoryPeriod(line: Row, sale: Row | undefined, fallbackMonth = currentMonth()) {
  const month = text(line.charge_month || line.chargeMonth || sale?.charge_month || sale?.chargeMonth);
  if (/^\d{4}-\d{2}/.test(month)) {
    return month.slice(0, 7);
  }

  const status = text(line.status || sale?.status) || "charged";
  const eventAt = text(getSaleEventAt(line, sale, status));
  if (/^\d{4}-\d{2}/.test(eventAt)) {
    return eventAt.slice(0, 7);
  }

  return fallbackMonth;
}

export function buildSaleHistorySummaryRows({
  sales,
  lines,
  textbooks,
  classes,
  fallbackMonth = currentMonth(),
}: {
  sales: Row[];
  lines: Row[];
  textbooks: Row[];
  classes: Row[];
  fallbackMonth?: string;
}) {
  const salesById = new Map(sales.map((sale) => [getRecordId(sale), sale]));
  const rowsByKey = new Map<string, SaleHistorySummaryRow>();

  for (const line of lines) {
    const sale = salesById.get(text(line.sale_id || line.saleId));
    const rawStatus = text(line.status || sale?.status) || "charged";
    if (rawStatus === "cancelled" || rawStatus === "returned" || rawStatus === "excluded") {
      continue;
    }

    const period = getSaleHistoryPeriod(line, sale, fallbackMonth);
    const year = period.slice(0, 4) || "-";
    const classId = text(line.class_id || line.classId || sale?.class_id || sale?.classId);
    const textbookId = text(line.textbook_id || line.textbookId);
    const classItem = getClassById(classes, classId);
    const textbook = getTextbookById(textbooks, textbookId);
    const key = `${period}:${classId || "-"}:${textbookId || "-"}`;
    const quantity = Math.max(1, numberValue(line.quantity) || 1);
    const latestAt = text(getSaleEventAt(line, sale, rawStatus));
    const current = rowsByKey.get(key) || {
      id: key,
      year,
      month: period,
      classId,
      className: getClassName(classItem || {}) || "-",
      textbookId,
      textbookTitle: textbook ? getTextbookTitle(textbook) : textbookId || "-",
      waitingQuantity: 0,
      issuedQuantity: 0,
      totalQuantity: 0,
      latestAt: "",
    };

    if (rawStatus === "issued") {
      current.issuedQuantity += quantity;
    } else {
      current.waitingQuantity += quantity;
    }
    current.totalQuantity += quantity;
    if (!current.latestAt || latestAt > current.latestAt) {
      current.latestAt = latestAt;
    }
    rowsByKey.set(key, current);
  }

  return [...rowsByKey.values()].sort((left, right) => {
    if (left.month !== right.month) return right.month.localeCompare(left.month);
    if (left.className !== right.className) return left.className.localeCompare(right.className, "ko", { numeric: true });
    return left.textbookTitle.localeCompare(right.textbookTitle, "ko", { numeric: true });
  });
}

// Always supply the whole inventory/catalog, not a selected page. Inactive
// titles do not make an active textbook a duplicate.
export function buildDuplicateTextbookTitleKeys(rows: Row[]) {
  const titleCounts = new Map<string, number>();
  for (const row of rows.filter(isActiveTextbook)) {
    const key = getTextbookTitleKey(row);
    if (!key) continue;
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  return new Set([...titleCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

// Inventory fields are supplied by the existing complete-source ledger snapshot;
// this projection enriches quality only and does not recalculate any balance.
export function buildTextbookMasterRows(inventory: Row[]): TextbookMasterRow[] {
  const duplicateTitleKeys = buildDuplicateTextbookTitleKeys(inventory);
  return inventory.map((row) => ({
    ...row,
    qualityIssues: getTextbookQualityIssues(row, duplicateTitleKeys),
    qualityScore: getTextbookQualityScore(row, duplicateTitleKeys),
  } as TextbookMasterRow));
}

export function matchesTextbookMasterFilters(
  row: Row,
  filters: MasterFilters,
  duplicateTitleKeys: Set<string>,
  searchIndex = buildTextbookSearchIndex(row),
) {
  if (!matchesTextbookTaxonomy(row, {
    subject: filters.subject === "all" ? "" : filters.subject,
    schoolLevel: filters.schoolLevel === "all" ? "" : filters.schoolLevel,
    gradeLevel: filters.gradeLevel === "all" ? "" : filters.gradeLevel,
    subSubject: filters.subSubject === "all" ? "" : filters.subSubject,
  })) return false;
  const keyword = filters.search.trim().toLowerCase();
  const normalizedBarcodeQuery = normalizeBarcodeValue(keyword);
  if (keyword && !searchIndex.haystack.includes(keyword) && !(normalizedBarcodeQuery && searchIndex.barcodeText.includes(normalizedBarcodeQuery))) return false;
  return matchesTextbookQualityFilter(row, filters.quality, duplicateTitleKeys) && matchesInventoryFilter(row, filters.inventory);
}
